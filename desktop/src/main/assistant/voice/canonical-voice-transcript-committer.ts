import { createHash } from 'node:crypto'
import type { CanonicalMessageCommitReceipt, RealtimeDomainEvent } from '../../../shared/assistant/contracts'
import { foregroundRouteClaim } from '../../../shared/assistant/contracts'
import { isExtendedVoiceTranscriptPrefix } from '../../../shared/assistant/voice-transcript-reconciliation'
import type { ConversationGateway } from '../foreground/conversation-gateway'
import type { ForegroundRouteController } from '../foreground/foreground-route-controller'
import type { CanonicalVoiceSessionController } from './canonical-voice-session-controller'

type TranscriptEventFields = Omit<Extract<RealtimeDomainEvent, { text: string }>, 'type'>
type TranscriptCompletionEvent = TranscriptEventFields & {
    type: 'realtime.user.transcript.completed' | 'realtime.assistant.transcript.completed'
}
type UserTranscriptCompletionEvent = TranscriptEventFields & {
    type: 'realtime.user.transcript.completed'
}

function isUserTranscriptCompletionEvent(event: RealtimeDomainEvent): event is UserTranscriptCompletionEvent {
    return event.type === 'realtime.user.transcript.completed'
}

const USER_TRANSCRIPT_STABILIZATION_MS = 5_000

export class CanonicalVoiceTranscriptCommitter {
    private queue: Promise<void> = Promise.resolve()
    private readonly unsubscribe: () => void
    private readonly listeners = new Set<(receipt: CanonicalMessageCommitReceipt) => void>()
    private readonly errorListeners = new Set<(error: Error, event: RealtimeDomainEvent) => void>()
    private readonly firstCompletionAt = new Map<string, string>()
    private pendingUserCompletion: UserTranscriptCompletionEvent | null = null
    private pendingUserTimer: ReturnType<typeof setTimeout> | null = null

    constructor(
        sessionController: CanonicalVoiceSessionController,
        private readonly routes: ForegroundRouteController,
        private readonly gateway: ConversationGateway
    ) {
        this.unsubscribe = sessionController.subscribe((event) => {
            if (isUserTranscriptCompletionEvent(event)) {
                this.stageUserCompletion(event)
                return
            }
            if (event.type === 'realtime.assistant.transcript.completed') {
                this.flushPendingUserCompletion()
                this.enqueueCommit(event)
                return
            }
            if (event.type === 'realtime.delegation.requested') this.flushPendingUserCompletion()
        })
    }

    onCommit(listener: (receipt: CanonicalMessageCommitReceipt) => void): () => void {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    onError(listener: (error: Error, event: RealtimeDomainEvent) => void): () => void {
        this.errorListeners.add(listener)
        return () => this.errorListeners.delete(listener)
    }

    async flush(): Promise<void> {
        this.flushPendingUserCompletion()
        await this.queue
    }

    dispose(): void {
        this.unsubscribe()
        if (this.pendingUserTimer) clearTimeout(this.pendingUserTimer)
        this.pendingUserTimer = null
        this.pendingUserCompletion = null
        this.listeners.clear()
        this.errorListeners.clear()
        this.firstCompletionAt.clear()
    }

    private stageUserCompletion(event: UserTranscriptCompletionEvent): void {
        const pending = this.pendingUserCompletion
        if (pending) {
            const sameSession = pending.conversationId === event.conversationId
                && pending.realtimeSessionId === event.realtimeSessionId
                && pending.realtimeSessionGeneration === event.realtimeSessionGeneration
            if (sameSession && pending.providerItemId === event.providerItemId) {
                this.pendingUserCompletion = event
                this.schedulePendingUserFlush()
                return
            }
            if (sameSession && isExtendedVoiceTranscriptPrefix(pending.text, event.text)) {
                this.pendingUserCompletion = event
                this.schedulePendingUserFlush()
                return
            }
            this.flushPendingUserCompletion()
        }
        this.pendingUserCompletion = event
        this.schedulePendingUserFlush()
    }

    private schedulePendingUserFlush(): void {
        if (this.pendingUserTimer) clearTimeout(this.pendingUserTimer)
        this.pendingUserTimer = setTimeout(() => {
            this.pendingUserTimer = null
            this.flushPendingUserCompletion()
        }, USER_TRANSCRIPT_STABILIZATION_MS)
        this.pendingUserTimer.unref?.()
    }

    private flushPendingUserCompletion(): void {
        if (this.pendingUserTimer) clearTimeout(this.pendingUserTimer)
        this.pendingUserTimer = null
        const pending = this.pendingUserCompletion
        this.pendingUserCompletion = null
        if (pending) this.enqueueCommit(pending)
    }

    private enqueueCommit(event: TranscriptCompletionEvent): void {
        this.queue = this.queue.then(() => this.commit(event)).catch((error) => {
            const normalized = error instanceof Error ? error : new Error('Voice transcript commit failed.')
            for (const listener of this.errorListeners) listener(normalized, event)
        })
    }

    private async commit(event: TranscriptCompletionEvent): Promise<void> {
        const route = this.routes.activeRoute(event.conversationId)
        if (route.surface_mode !== 'voice'
            || route.realtime_session_id !== event.realtimeSessionId
            || route.realtime_session_generation !== event.realtimeSessionGeneration) return
        const role = event.type === 'realtime.user.transcript.completed' ? 'user' : 'assistant'
        const messageId = deterministicTranscriptMessageId(event.conversationId, route.foreground_route_id, role, event.providerItemId)
        const completionKey = `${route.foreground_route_id}:${role}:${event.providerItemId}`
        const providerCompletedAt = this.firstCompletionAt.get(completionKey) || event.occurredAt
        this.firstCompletionAt.set(completionKey, providerCompletedAt)
        const receipt = await this.gateway.commitMessage({
            conversationId: event.conversationId,
            messageId,
            role,
            producer: role === 'user' ? 'user' : 'realtime_foreground',
            modality: 'voice',
            text: event.text,
            attachmentIds: [],
            routeClaim: foregroundRouteClaim(route),
            providerItemId: event.providerItemId,
            providerCompletedAt,
            idempotencyKey: `voice-transcript:${event.conversationId}:${route.foreground_route_id}:${role}:${event.providerItemId}`
        })
        for (const listener of this.listeners) listener(receipt)
    }
}

export function deterministicTranscriptMessageId(
    conversationId: string,
    routeId: string,
    role: 'user' | 'assistant',
    providerItemId: string
): string {
    return `voice_${role}_${createHash('sha256')
        .update(`${conversationId}\0${routeId}\0${role}\0${providerItemId}`)
        .digest('hex')
        .slice(0, 40)}`
}
