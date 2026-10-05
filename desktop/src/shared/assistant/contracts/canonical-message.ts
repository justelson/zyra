import type { ForegroundRouteClaim } from './foreground-route'

export const OPERATION_INTENT_SCHEMA_VERSION = 2 as const

export type CanonicalMessageRole = 'user' | 'assistant'
export type CanonicalMessageModality = 'text' | 'voice' | 'image'
export type CanonicalMessageOperationStatus =
    | 'intended'
    | 'dispatched'
    | 'succeeded'
    | 'failed'
    | 'cancelled'
    | 'outcome_unknown'

export interface CanonicalMessageCommitReceipt {
    receiptId: string
    operationId: string
    canonicalMessageId: string
    conversationId: string
    foregroundRouteId: string
    routeEpoch: number
    ownerClaimId: string
    canonicalSequence: number
    contentSha256: string
    observedAt: string
}

export interface CanonicalMessageOperationReceipt {
    receipt_id: string
    outcome: 'succeeded' | 'failed' | 'cancelled'
    external_receipt_id: string | null
    observed_at: string
    result_ref: null
}

/** Persisted append-only operation revision for one canonical message commit. */
export interface CanonicalMessageOperation {
    schema_version: typeof OPERATION_INTENT_SCHEMA_VERSION
    operation_id: string
    revision: number
    previous_revision: number | null
    conversation_id: string
    task_id: null
    attempt_id: null
    foreground_route_id: string
    foreground_route_epoch: number
    foreground_owner_claim_id: string
    canonical_message_id: string
    idempotency_key: string
    operation_class: 'canonical_message_commit'
    consequence: 'reversible'
    action_hash: null
    capability_lease_id: null
    adapter_id: string
    protected_payload_ref: string
    payload_sha256: string
    redacted_summary: string
    status: CanonicalMessageOperationStatus
    intent_at: string
    dispatched_at: string | null
    terminal_at: string | null
    receipt: CanonicalMessageOperationReceipt | null
    unknown_reason: string | null
}

export interface CanonicalMessageCommitInput {
    conversationId: string
    messageId: string
    role: CanonicalMessageRole
    producer: 'user' | 'strong_primary' | 'realtime_foreground'
    modality: CanonicalMessageModality
    text: string
    attachmentIds: string[]
    routeClaim: ForegroundRouteClaim
    providerItemId: string
    providerCompletedAt: string
    providerStartedAt?: string
    idempotencyKey?: string
}

export interface CanonicalLedgerAppendInput {
    operationId: string
    idempotencyKey: string
    conversationId: string
    messageId: string
    role: CanonicalMessageRole
    producer: 'user' | 'strong_primary' | 'realtime_foreground'
    modality: CanonicalMessageModality
    text: string
    attachmentIds: string[]
    providerItemId: string
    providerCompletedAt: string
    providerStartedAt?: string
    payloadSha256: string
    routeClaim: ForegroundRouteClaim
}

export interface CanonicalMessageWriter {
    append(input: CanonicalLedgerAppendInput): Promise<CanonicalMessageCommitReceipt>
    findReceipt(operationId: string): Promise<CanonicalMessageCommitReceipt | null>
}
