import { createHash } from 'node:crypto'
import type {
    CanonicalLedgerAppendInput,
    CanonicalMessageCommitInput,
    CanonicalMessageCommitReceipt,
    CanonicalMessageOperation,
    CanonicalMessageOperationReceipt,
    CanonicalMessageWriter,
    ForegroundRoute
} from '../../../shared/assistant/contracts'
import type { ForegroundControllerStore } from './foreground-controller-store'
import {
    cancelCanonicalMessageOperation,
    completeCanonicalMessageOperation,
    createCanonicalMessageOperation,
    dispatchCanonicalMessageOperation,
    markCanonicalMessageOutcomeUnknown
} from './canonical-message-operation-reducer'
import { ForegroundRouteConflictError } from './foreground-route-reducer'
import type { ForegroundClock } from './foreground-route-controller'
import { routeExpectation, systemForegroundClock } from './foreground-route-controller'

const GATEWAY_ADAPTER_ID = 'zyra_conversation_gateway_v1'

export class ConversationGateway {
    constructor(
        private readonly store: ForegroundControllerStore,
        private readonly writer: CanonicalMessageWriter,
        private readonly clock: ForegroundClock = systemForegroundClock
    ) {}

    async commitMessage(input: CanonicalMessageCommitInput): Promise<CanonicalMessageCommitReceipt> {
        const active = this.requireActiveRoute(input.conversationId)
        assertCommitInput(input, active, this.clock.now())
        const payloadSha256 = sha256(stableJson({
            conversationId: input.conversationId,
            messageId: input.messageId,
            role: input.role,
            producer: input.producer,
            modality: input.modality,
            text: input.text,
            attachmentIds: input.attachmentIds,
            providerItemId: input.providerItemId,
            providerCompletedAt: input.providerCompletedAt,
            ...(input.providerStartedAt ? { providerStartedAt: input.providerStartedAt } : {}),
            routeClaim: input.routeClaim
        }))
        const idempotencyKey = input.idempotencyKey
            || `canonical-message:${input.conversationId}:${input.messageId}`
        const operationId = `op_msg_${sha256(idempotencyKey).slice(0, 40)}`
        const protectedPayloadRef = `payload_${payloadSha256.slice(0, 40)}`
        const prepared = createCanonicalMessageOperation({
            operationId,
            conversationId: input.conversationId,
            canonicalMessageId: input.messageId,
            idempotencyKey,
            routeClaim: input.routeClaim,
            adapterId: GATEWAY_ADAPTER_ID,
            protectedPayloadRef,
            payloadSha256,
            redactedSummary: `${input.role} ${input.modality} canonical message commit`,
            intentAt: this.clock.now()
        })
        let operation = this.store.prepareCanonicalMessageOperation(routeExpectation(input.routeClaim), prepared)
        if (operation.status === 'succeeded') return this.requireWriterReceipt(operation, input)
        if (operation.status === 'failed' || operation.status === 'cancelled' || operation.status === 'outcome_unknown') {
            throw new ForegroundRouteConflictError(
                `Canonical-message operation ${operation.operation_id} is terminal with status ${operation.status}.`,
                'route_conflict'
            )
        }

        const appendInput = buildLedgerAppendInput(input, operation, payloadSha256)
        if (operation.status === 'dispatched') {
            const recovered = await this.writer.findReceipt(operation.operation_id)
            if (recovered) return this.completeWithReceipt(operation, recovered)
        } else {
            const dispatched = dispatchCanonicalMessageOperation(operation, this.clock.now())
            operation = this.store.commitCanonicalMessageOperationRevision(operation.revision, dispatched)
        }

        try {
            const receipt = await this.writer.append(appendInput)
            validateWriterReceipt(receipt, appendInput)
            return this.completeWithReceipt(operation, receipt)
        } catch (error) {
            const recovered = await this.writer.findReceipt(operation.operation_id).catch(() => null)
            if (recovered) {
                validateWriterReceipt(recovered, appendInput)
                return this.completeWithReceipt(operation, recovered)
            }
            const reason = error instanceof Error ? error.message : 'Canonical ledger append outcome is unknown.'
            const unknown = markCanonicalMessageOutcomeUnknown(operation, reason, this.clock.now())
            this.store.commitCanonicalMessageOperationRevision(operation.revision, unknown)
            throw new Error(`Canonical message commit outcome is unknown for ${operation.operation_id}.`, { cause: error })
        }
    }

    async reconcilePendingOperations(conversationId: string): Promise<CanonicalMessageOperation[]> {
        const route = this.requireActiveRoute(conversationId)
        const pending = this.store.pendingCanonicalMessageOperations(route.foreground_route_id)
        const reconciled: CanonicalMessageOperation[] = []
        for (const operation of pending) {
            if (operation.status === 'intended') {
                reconciled.push(this.cancelPrepared(
                    operation.operation_id,
                    'Canonical message intent was abandoned before dispatch during restart recovery.'
                ))
                continue
            }
            const receipt = await this.writer.findReceipt(operation.operation_id)
            if (receipt) {
                validateRecoveredReceipt(receipt, operation)
                reconciled.push(this.completeOperationWithReceipt(operation, receipt))
                continue
            }
            const unknown = markCanonicalMessageOutcomeUnknown(
                operation,
                'No canonical ledger receipt was found during restart recovery.',
                this.clock.now()
            )
            reconciled.push(this.store.commitCanonicalMessageOperationRevision(operation.revision, unknown))
        }
        return reconciled
    }

    cancelPrepared(operationId: string, reason = 'Canonical message commit cancelled before dispatch.'): CanonicalMessageOperation {
        const operation = this.store.canonicalMessageOperation(operationId)
        if (!operation) throw new Error(`Unknown canonical-message operation ${operationId}.`)
        if (operation.status !== 'intended') {
            throw new ForegroundRouteConflictError('Only an intended canonical-message operation can be cancelled safely.', 'route_conflict')
        }
        const observedAt = this.clock.now()
        const receipt: CanonicalMessageOperationReceipt = {
            receipt_id: `receipt_cancel_${sha256(`${operation.operation_id}:${observedAt}:${reason}`).slice(0, 32)}`,
            outcome: 'cancelled',
            external_receipt_id: null,
            observed_at: observedAt,
            result_ref: null
        }
        const cancelled = cancelCanonicalMessageOperation(operation, receipt, observedAt)
        return this.store.commitCanonicalMessageOperationRevision(operation.revision, cancelled)
    }

    private async requireWriterReceipt(
        operation: CanonicalMessageOperation,
        input: CanonicalMessageCommitInput
    ): Promise<CanonicalMessageCommitReceipt> {
        const receipt = await this.writer.findReceipt(operation.operation_id)
        if (!receipt) throw new Error(`Canonical operation ${operation.operation_id} succeeded without a readable ledger receipt.`)
        validateWriterReceipt(receipt, buildLedgerAppendInput(input, operation, operation.payload_sha256))
        return receipt
    }

    private completeWithReceipt(
        operation: CanonicalMessageOperation,
        receipt: CanonicalMessageCommitReceipt
    ): CanonicalMessageCommitReceipt {
        const current = this.store.canonicalMessageOperation(operation.operation_id) || operation
        if (current.status === 'succeeded') return receipt
        this.completeOperationWithReceipt(current, receipt)
        return receipt
    }

    private completeOperationWithReceipt(
        operation: CanonicalMessageOperation,
        receipt: CanonicalMessageCommitReceipt
    ): CanonicalMessageOperation {
        const current = this.store.canonicalMessageOperation(operation.operation_id) || operation
        if (current.status === 'succeeded') return current
        const operationReceipt: CanonicalMessageOperationReceipt = {
            receipt_id: receipt.receiptId,
            outcome: 'succeeded',
            external_receipt_id: receipt.receiptId,
            observed_at: receipt.observedAt,
            result_ref: null
        }
        const completed = completeCanonicalMessageOperation(current, operationReceipt, receipt.observedAt)
        return this.store.commitCanonicalMessageOperationRevision(current.revision, completed)
    }

    private requireActiveRoute(conversationId: string): ForegroundRoute {
        const route = this.store.activeRoute(conversationId)
        if (!route) throw new ForegroundRouteConflictError('The canonical conversation has no active route.', 'route_conflict')
        return route
    }
}

function assertCommitInput(input: CanonicalMessageCommitInput, route: ForegroundRoute, observedAt: string): void {
    if (!input.messageId || !input.providerItemId) throw new TypeError('Canonical message and provider item IDs are required.')
    if (!input.text.trim() && input.attachmentIds.length === 0) throw new TypeError('A canonical message requires text or attachments.')
    if (input.role === 'user' && input.producer !== 'user') throw new TypeError('User messages require the user producer.')
    if (input.role === 'assistant' && input.producer !== route.response_owner) {
        throw new ForegroundRouteConflictError(
            `${input.producer} cannot commit while ${route.response_owner} owns the foreground route.`,
            'route_conflict'
        )
    }
    if (input.conversationId !== route.conversation_id
        || input.routeClaim.conversationId !== route.conversation_id
        || input.routeClaim.foregroundRouteId !== route.foreground_route_id
        || input.routeClaim.routeEpoch !== route.route_epoch
        || input.routeClaim.ownerClaimId !== route.owner_claim_id
        || input.routeClaim.responseOwner !== route.response_owner
        || input.routeClaim.realtimeSessionId !== route.realtime_session_id
        || input.routeClaim.realtimeSessionGeneration !== route.realtime_session_generation) {
        throw new ForegroundRouteConflictError('Canonical message commit carries a stale foreground claim.', 'route_conflict')
    }
    const completedMs = Date.parse(input.providerCompletedAt)
    const observedMs = Date.parse(observedAt)
    if (!Number.isFinite(completedMs) || completedMs < Date.parse(route.created_at) || completedMs > observedMs) {
        throw new ForegroundRouteConflictError('Provider completion lies outside the active route ownership interval.', 'route_conflict')
    }
    if (input.providerStartedAt !== undefined) {
        const startedMs = Date.parse(input.providerStartedAt)
        if (!Number.isFinite(startedMs) || startedMs < Date.parse(route.created_at) || startedMs > completedMs) {
            throw new ForegroundRouteConflictError('Provider start lies outside the active route ownership interval.', 'route_conflict')
        }
    }
}

function buildLedgerAppendInput(
    input: CanonicalMessageCommitInput,
    operation: CanonicalMessageOperation,
    payloadSha256: string
): CanonicalLedgerAppendInput {
    return {
        operationId: operation.operation_id,
        idempotencyKey: operation.idempotency_key,
        conversationId: input.conversationId,
        messageId: input.messageId,
        role: input.role,
        producer: input.producer,
        modality: input.modality,
        text: input.text,
        attachmentIds: [...input.attachmentIds],
        providerItemId: input.providerItemId,
        providerCompletedAt: input.providerCompletedAt,
        ...(input.providerStartedAt ? { providerStartedAt: input.providerStartedAt } : {}),
        payloadSha256,
        routeClaim: input.routeClaim
    }
}

function validateRecoveredReceipt(receipt: CanonicalMessageCommitReceipt, operation: CanonicalMessageOperation): void {
    if (receipt.operationId !== operation.operation_id
        || receipt.canonicalMessageId !== operation.canonical_message_id
        || receipt.conversationId !== operation.conversation_id
        || receipt.foregroundRouteId !== operation.foreground_route_id
        || receipt.routeEpoch !== operation.foreground_route_epoch
        || receipt.ownerClaimId !== operation.foreground_owner_claim_id
        || receipt.contentSha256 !== operation.payload_sha256) {
        throw new Error('Canonical ledger returned a mismatched recovery receipt.')
    }
}

function validateWriterReceipt(receipt: CanonicalMessageCommitReceipt, input: CanonicalLedgerAppendInput): void {
    if (receipt.operationId !== input.operationId
        || receipt.canonicalMessageId !== input.messageId
        || receipt.conversationId !== input.conversationId
        || receipt.foregroundRouteId !== input.routeClaim.foregroundRouteId
        || receipt.routeEpoch !== input.routeClaim.routeEpoch
        || receipt.ownerClaimId !== input.routeClaim.ownerClaimId
        || receipt.contentSha256 !== input.payloadSha256) {
        throw new Error('Canonical ledger returned a mismatched commit receipt.')
    }
    if (!Number.isSafeInteger(receipt.canonicalSequence) || receipt.canonicalSequence < 1) {
        throw new Error('Canonical ledger returned an invalid conversation sequence.')
    }
}

function stableJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value)
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex')
}
