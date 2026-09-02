import type {
    AssistantRealtimeVoiceEvent,
    HydrationReceipt,
    InstructorOutputModality,
    InstructorRealtimeVoice,
    RealtimeConnectInput,
    RealtimeDomainEvent,
    RealtimeForegroundAdapter,
    RealtimeHydrationDelta,
    RealtimeHydrationItem,
    RealtimeHydrationSeed,
    RealtimeProviderCapabilityReport,
    RealtimeSessionHandle,
    RealtimeSpeechItem,
    SessionCloseReceipt,
    SpeechSubmissionReceipt
} from '../../../shared/assistant/contracts'
import { evaluateRealtimeAudioCapabilities } from '../../../shared/assistant/contracts'
import type { ForegroundClock } from '../foreground/foreground-route-controller'
import { systemForegroundClock } from '../foreground/foreground-route-controller'
import type { ChatGptRealtimeCapabilityEvidence } from './codex-realtime-capabilities'
import { createChatGptRealtimeCapabilityReport } from './codex-realtime-capabilities'
import {
    applyRealtimeHydrationDelta,
    validateRealtimeHydrationDelta,
    validateRealtimeHydrationSeed
} from './realtime-hydration'

export interface ChatGptRealtimeTransport {
    start(input: {
        cwd: string
        sdp: string
        instructions?: string
        voice?: InstructorRealtimeVoice
        outputModality?: InstructorOutputModality
        initialItems?: Array<{ role: 'developer' | 'user' | 'assistant'; text: string }>
        clientManagedHandoffs?: boolean
        adapterSessionId: string
        conversationId: string
        realtimeSessionGeneration: number
        signal: AbortSignal
    }): Promise<{
        threadId: string
        sdp: string
        realtimeVersion: string
        realtimeSessionId?: string
        realtimeSessionGeneration?: number
    }>
    appendContext(items: Array<{ role: 'developer' | 'user' | 'assistant'; text: string }>): Promise<void>
    requestSpeech(text: string, canonicalMessageId?: string): Promise<void>
    presentComposerResponse(input: { turnId: string; text?: string; error?: string; canonicalMessageId?: string }): void
    stop(): Promise<void>
    on(event: 'event', listener: (payload: AssistantRealtimeVoiceEvent) => void): unknown
    off(event: 'event', listener: (payload: AssistantRealtimeVoiceEvent) => void): unknown
}

export type CodexRealtimeTransport = ChatGptRealtimeTransport

interface ChatGptAdapterSession {
    input: RealtimeConnectInput
    handle: RealtimeSessionHandle | null
    currentWatermarks: RealtimeHydrationSeed['sourceWatermarks']
    closed: boolean
    webRtcTurnRoles: Map<string, 'user' | 'assistant'>
    hydrationReplayBudget: Map<string, number>
    suppressedHydrationProviderItemIds: Set<string>
    completedTranscriptProviderItemIds: Set<string>
    pendingCanonicalSpeechReplays: Array<{ canonicalMessageId: string; normalizedText: string }>
}

export class ChatGptRealtimeForegroundAdapter implements RealtimeForegroundAdapter {
    private readonly listeners = new Set<(event: RealtimeDomainEvent) => void>()
    private readonly sessions = new Map<string, ChatGptAdapterSession>()
    private readonly runtimeListener: (event: AssistantRealtimeVoiceEvent) => void
    private currentAdapterSessionId: string | null = null
    private nextSessionOrdinal = 0

    constructor(
        private readonly runtime: ChatGptRealtimeTransport,
        private readonly capabilityEvidence: ChatGptRealtimeCapabilityEvidence,
        private readonly clock: ForegroundClock = systemForegroundClock
    ) {
        this.runtimeListener = (event) => this.handleRuntimeEvent(event)
        runtime.on('event', this.runtimeListener)
    }

    async capabilities(): Promise<RealtimeProviderCapabilityReport> {
        return createChatGptRealtimeCapabilityReport(this.capabilityEvidence, this.clock.now())
    }

    async connect(input: RealtimeConnectInput): Promise<RealtimeSessionHandle> {
        const gate = evaluateRealtimeAudioCapabilities(await this.capabilities(), new Date(this.clock.now()))
        if (!gate.ok) throw new Error(gate.reason || 'ChatGPT Voice is unavailable.')
        validateRealtimeHydrationSeed(input.hydrationSeed)
        if (input.signal.aborted) throw input.signal.reason || new Error('Realtime connection cancelled.')
        if (input.hydrationSeed.conversationId !== input.conversationId) {
            throw new Error('Realtime hydration belongs to another canonical conversation.')
        }
        const adapterSessionId = `chatgpt_adapter_session_${++this.nextSessionOrdinal}`
        const previousSessionId = this.currentAdapterSessionId
        if (previousSessionId) {
            const previous = this.sessions.get(previousSessionId)
            if (previous) previous.closed = true
        }
        const session: ChatGptAdapterSession = {
            input: cloneConnectInput(input),
            handle: null,
            currentWatermarks: structuredClone(input.hydrationSeed.sourceWatermarks),
            closed: false,
            webRtcTurnRoles: new Map(),
            hydrationReplayBudget: createHydrationReplayBudget(input.hydrationSeed.items),
            suppressedHydrationProviderItemIds: new Set(),
            completedTranscriptProviderItemIds: new Set(),
            pendingCanonicalSpeechReplays: []
        }
        this.sessions.set(adapterSessionId, session)
        this.currentAdapterSessionId = adapterSessionId
        this.emit({
            ...pendingEventBase(adapterSessionId, input, this.clock.now()),
            type: 'realtime.session.connecting'
        })

        const abortRuntimeStart = () => {
            void this.runtime.stop().catch(() => undefined)
        }
        input.signal.addEventListener('abort', abortRuntimeStart, { once: true })
        try {
            const result = await this.runtime.start({
                cwd: input.projectCwd,
                sdp: input.offerSdp,
                instructions: input.instructions,
                voice: input.voice as InstructorRealtimeVoice,
                outputModality: input.output,
                initialItems: input.hydrationSeed.items.map(({ role, text }) => ({ role, text })),
                clientManagedHandoffs: true,
                adapterSessionId,
                conversationId: input.conversationId,
                realtimeSessionGeneration: input.requestedSessionGeneration,
                signal: input.signal
            })
            if (input.signal.aborted) {
                await this.runtime.stop().catch(() => undefined)
                throw input.signal.reason || new Error('Realtime connection cancelled.')
            }
            if (result.realtimeVersion !== 'v3') throw new Error(`ChatGPT negotiated unsupported Voice version ${result.realtimeVersion}.`)
            if (!result.realtimeSessionId) throw new Error('ChatGPT did not return a stable Voice session ID.')
            if (result.realtimeSessionGeneration !== undefined
                && result.realtimeSessionGeneration !== input.requestedSessionGeneration) {
                throw new Error('ChatGPT returned a stale Voice session generation.')
            }
            const handle: RealtimeSessionHandle = {
                adapterSessionId,
                realtimeProviderThreadId: result.threadId,
                realtimeSessionId: result.realtimeSessionId,
                realtimeSessionGeneration: input.requestedSessionGeneration,
                answerSdp: result.sdp,
                realtimeVersion: result.realtimeVersion,
                hydratedPacketId: input.hydrationSeed.packetId,
                hydratedThrough: structuredClone(input.hydrationSeed.sourceWatermarks)
            }
            session.handle = handle
            this.emit({ ...eventBase(session, this.clock.now()), type: 'realtime.session.ready', realtimeVersion: result.realtimeVersion })
            return structuredClone(handle)
        } catch (error) {
            session.closed = true
            if (this.currentAdapterSessionId === adapterSessionId) this.currentAdapterSessionId = null
            throw error
        } finally {
            input.signal.removeEventListener('abort', abortRuntimeStart)
        }
    }

    async appendContext(sessionId: string, delta: RealtimeHydrationDelta): Promise<HydrationReceipt> {
        validateRealtimeHydrationDelta(delta)
        const session = this.requireCurrentSession(sessionId)
        const next = applyRealtimeHydrationDelta(session.input.hydrationSeed, session.currentWatermarks, delta)
        addHydrationReplayBudget(session.hydrationReplayBudget, delta.items)
        await this.runtime.appendContext(delta.items.map(({ role, text }) => ({ role, text })))
        session.currentWatermarks = next
        const appliedAt = this.clock.now()
        const receipt: HydrationReceipt = {
            sessionId,
            deltaId: delta.deltaId,
            appliedThrough: structuredClone(next),
            appliedAt
        }
        this.emit({
            ...eventBase(session, appliedAt),
            type: 'realtime.context.applied',
            deltaId: delta.deltaId,
            appliedThrough: structuredClone(next)
        })
        return receipt
    }

    async appendTransientContext(sessionId: string, text: string): Promise<void> {
        this.requireCurrentSession(sessionId)
        const normalized = text.trim()
        if (!normalized) return
        await this.runtime.appendContext([{ role: 'developer', text: normalized.slice(0, 4000) }])
    }

    async deliverComposerResponse(
        sessionId: string,
        input: { turnId: string; text?: string; error?: string; canonicalMessageId?: string }
    ): Promise<{ mode: 'text-turn' }> {
        const session = this.requireCurrentSession(sessionId)
        this.runtime.presentComposerResponse(input)
        const text = String(input.text || '').trim()
        if (text && input.canonicalMessageId) addCanonicalSpeechReplay(session, input.canonicalMessageId, text)
        if (text) {
            try {
                await this.runtime.requestSpeech(text, input.canonicalMessageId)
            } catch (error) {
                if (input.canonicalMessageId) removeCanonicalSpeechReplay(session, input.canonicalMessageId)
                throw error
            }
        }
        return { mode: 'text-turn' }
    }

    ingestWebRtcEvent(sessionId: string, value: unknown): void {
        const session = this.requireCurrentSession(sessionId)
        const delegation = normalizeWebRtcDelegationEvent(value)
        if (delegation) {
            this.emit({
                ...eventBase(session, this.clock.now()),
                type: 'realtime.delegation.requested',
                providerItemId: delegation.providerItemId,
                text: delegation.text
            })
            return
        }
        const event = normalizeWebRtcTranscriptEvent(value, session.webRtcTurnRoles)
        if (event && session.suppressedHydrationProviderItemIds.has(event.providerItemId)) return
        if (event && session.completedTranscriptProviderItemIds.has(event.providerItemId)) return
        if (event?.kind === 'completed' && event.role === 'assistant'
            && consumeCanonicalSpeechReplay(session, event.text, event.providerItemId)) return
        if (event?.kind === 'completed' && consumeHydrationReplay(
            session,
            event.role,
            event.text,
            event.providerItemId
        )) return
        if (!event) {
            if (isWebRtcTranscriptCompletion(value)) {
                this.emit({
                    ...eventBase(session, this.clock.now()),
                    type: 'realtime.session.error',
                    category: 'incompatible_protocol',
                    message: 'ChatGPT completed a Voice turn without the stable item identity and transcript required for canonical delivery.'
                })
            }
            return
        }
        if (event.kind === 'completed') session.completedTranscriptProviderItemIds.add(event.providerItemId)
        this.emit({
            ...eventBase(session, this.clock.now()),
            type: `realtime.${event.role}.transcript.${event.kind}`,
            providerItemId: event.providerItemId,
            ...(event.kind === 'completed' ? { text: event.text } : { delta: event.delta })
        } as RealtimeDomainEvent)
    }

    async requestSpeech(sessionId: string, item: RealtimeSpeechItem): Promise<SpeechSubmissionReceipt> {
        const session = this.requireCurrentSession(sessionId)
        const handle = session.handle as RealtimeSessionHandle
        if (item.routeClaim.conversationId !== session.input.conversationId
            || item.routeClaim.realtimeSessionId !== handle.realtimeSessionId
            || item.routeClaim.realtimeSessionGeneration !== handle.realtimeSessionGeneration) {
            throw new Error('ChatGPT speech request carries a stale Voice route claim.')
        }
        if (Date.parse(item.expiresAt) <= Date.parse(this.clock.now())) throw new Error('ChatGPT speech request expired.')
        addCanonicalSpeechReplay(session, item.canonicalMessageId, item.text)
        try {
            await this.runtime.requestSpeech(item.text, item.canonicalMessageId)
        } catch (error) {
            removeCanonicalSpeechReplay(session, item.canonicalMessageId)
            throw error
        }
        return {
            sessionId,
            deliveryId: item.deliveryId,
            providerItemId: null,
            submittedAt: this.clock.now()
        }
    }

    async close(sessionId: string, reason: string): Promise<SessionCloseReceipt> {
        const session = this.sessions.get(sessionId)
        const closedAt = this.clock.now()
        if (session && !session.closed) {
            session.closed = true
            if (this.currentAdapterSessionId === sessionId) {
                this.currentAdapterSessionId = null
                await this.runtime.stop()
            }
            if (session.handle) this.emit({ ...eventBase(session, closedAt), type: 'realtime.session.closed', reason })
        }
        return { sessionId, reason, closedAt }
    }

    subscribe(listener: (event: RealtimeDomainEvent) => void): () => void {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    dispose(): void {
        this.runtime.off('event', this.runtimeListener)
        this.listeners.clear()
        this.sessions.clear()
        this.currentAdapterSessionId = null
    }

    private requireCurrentSession(sessionId: string): ChatGptAdapterSession {
        const session = this.sessions.get(sessionId)
        if (!session || session.closed || !session.handle || this.currentAdapterSessionId !== sessionId) {
            throw new Error(`ChatGPT Voice session ${sessionId} is not current.`)
        }
        return session
    }

    private handleRuntimeEvent(event: AssistantRealtimeVoiceEvent): void {
        const sessionId = this.currentAdapterSessionId
        const session = sessionId ? this.sessions.get(sessionId) : null
        if (!session || session.closed || !session.handle) return
        if (event.threadId && event.threadId !== session.handle.realtimeProviderThreadId) return
        if (event.type === 'transcript.delta' || event.type === 'transcript.done') {
            if (event.providerItemId && session.suppressedHydrationProviderItemIds.has(event.providerItemId)) return
            if (event.providerItemId && session.completedTranscriptProviderItemIds.has(event.providerItemId)) return
            if (event.type === 'transcript.done'
                && event.providerItemId
                && event.role === 'assistant'
                && consumeCanonicalSpeechReplay(session, event.text, event.providerItemId)) return
            if (event.type === 'transcript.done'
                && event.providerItemId
                && consumeHydrationReplay(
                    session,
                    event.role === 'user' ? 'user' : 'assistant',
                    event.text,
                    event.providerItemId
                )) return
            // Flat legacy notifications may omit item identity. The
            // production Desktop bridge supplies the identity-bearing WebRTC
            // event instead; never guess or commit the flat notification.
            if (!event.providerItemId) return
            if (event.type === 'transcript.done') session.completedTranscriptProviderItemIds.add(event.providerItemId)
            const role = event.role === 'user' ? 'user' : 'assistant'
            const type = `realtime.${role}.transcript.${event.type === 'transcript.done' ? 'completed' : 'delta'}`
            this.emit({
                ...eventBase(session, this.clock.now()),
                type,
                providerItemId: event.providerItemId,
                ...(event.type === 'transcript.done' ? { text: event.text } : { delta: event.delta })
            } as RealtimeDomainEvent)
            return
        }
        if (event.type === 'composer.response.delta' || event.type === 'composer.response.done' || event.type === 'client.command') return
        if (event.type === 'session.error') {
            this.emit({
                ...eventBase(session, this.clock.now()),
                type: 'realtime.session.error',
                category: normalizeChatGptErrorCategory(event.message),
                message: event.message
            })
        } else if (event.type === 'session.closed') {
            session.closed = true
            this.currentAdapterSessionId = null
            this.emit({ ...eventBase(session, this.clock.now()), type: 'realtime.session.closed', reason: event.reason || null })
        }
    }

    private emit(event: RealtimeDomainEvent): void {
        for (const listener of this.listeners) listener(event)
    }
}

export { ChatGptRealtimeForegroundAdapter as CodexRealtimeForegroundAdapter }

function createHydrationReplayBudget(items: RealtimeHydrationItem[]): Map<string, number> {
    const budget = new Map<string, number>()
    addHydrationReplayBudget(budget, items)
    return budget
}

function addHydrationReplayBudget(budget: Map<string, number>, items: RealtimeHydrationItem[]): void {
    for (const item of items) {
        if (item.role !== 'user' && item.role !== 'assistant') continue
        const key = hydrationReplayKey(item.role, item.text)
        budget.set(key, (budget.get(key) || 0) + 1)
    }
}

function consumeHydrationReplay(
    session: ChatGptAdapterSession,
    role: 'user' | 'assistant',
    text: string,
    providerItemId: string
): boolean {
    const key = hydrationReplayKey(role, text)
    const remaining = session.hydrationReplayBudget.get(key) || 0
    if (remaining <= 0) return false
    if (remaining === 1) session.hydrationReplayBudget.delete(key)
    else session.hydrationReplayBudget.set(key, remaining - 1)
    session.suppressedHydrationProviderItemIds.add(providerItemId)
    return true
}

function hydrationReplayKey(role: 'user' | 'assistant', text: string): string {
    return `${role}\0${text.replace(/\s+/gu, ' ').trim()}`
}

function normalizeCanonicalSpeechText(text: string): string {
    return text.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function addCanonicalSpeechReplay(session: ChatGptAdapterSession, canonicalMessageId: string, text: string): void {
    const normalizedText = normalizeCanonicalSpeechText(text)
    if (!normalizedText) return
    session.pendingCanonicalSpeechReplays.push({ canonicalMessageId, normalizedText })
    if (session.pendingCanonicalSpeechReplays.length > 32) session.pendingCanonicalSpeechReplays.shift()
}

function removeCanonicalSpeechReplay(session: ChatGptAdapterSession, canonicalMessageId: string): void {
    session.pendingCanonicalSpeechReplays = session.pendingCanonicalSpeechReplays
        .filter((entry) => entry.canonicalMessageId !== canonicalMessageId)
}

function consumeCanonicalSpeechReplay(
    session: ChatGptAdapterSession,
    text: string,
    providerItemId: string
): boolean {
    const normalizedText = normalizeCanonicalSpeechText(text)
    const index = session.pendingCanonicalSpeechReplays
        .findIndex((entry) => entry.normalizedText === normalizedText)
    if (index < 0) return false
    session.pendingCanonicalSpeechReplays.splice(index, 1)
    session.completedTranscriptProviderItemIds.add(providerItemId)
    return true
}

type NormalizedWebRtcTranscriptEvent =
    | { kind: 'delta'; role: 'user' | 'assistant'; providerItemId: string; delta: string }
    | { kind: 'completed'; role: 'user' | 'assistant'; providerItemId: string; text: string }

export function normalizeWebRtcDelegationEvent(
    value: unknown
): { providerItemId: string; text: string } | null {
    const payload = asRecord(value)
    if (asText(payload?.['type']) !== 'delegation.created') return null
    const item = asRecord(payload?.['item'])
    if (asText(item?.['type']) !== 'delegation' || asText(item?.['target']) !== 'client') return null
    const providerItemId = boundedProviderItemId(asText(item?.['id']))
    const content = Array.isArray(item?.['content']) ? item.content : []
    const text = content
        .map((entry) => asRecord(entry))
        .filter((entry) => asText(entry?.['type']) === 'input_text')
        .map((entry) => asText(entry?.['text']) || '')
        .join('')
        .trim()
    return providerItemId && text && text.length <= 8_000 ? { providerItemId, text } : null
}

export function normalizeWebRtcTranscriptEvent(
    value: unknown,
    turnRoles = new Map<string, 'user' | 'assistant'>()
): NormalizedWebRtcTranscriptEvent | null {
    const payload = asRecord(value)
    const type = asText(payload?.['type'])
    if (!type) return null
    const turn = asRecord(payload?.['turn'])
    const item = asRecord(payload?.['item'])
    const turnId = boundedProviderItemId(
        asText(turn?.['id']) || asText(item?.['id']) || asText(payload?.['turn_id']) || asText(payload?.['item_id'])
    )
    const explicitRole = normalizeTranscriptRole(
        asText(turn?.['role']) || asText(item?.['role']) || asText(payload?.['role'])
    )
    if (turnId && explicitRole) turnRoles.set(turnId, explicitRole)

    if (type === 'turn.created' || type === 'conversation.item.created') return null
    const role = explicitRole
        || (turnId ? turnRoles.get(turnId) : undefined)
        || (type.includes('input_transcript') || type.includes('input_audio_transcription')
            ? 'user'
            : type.includes('output_transcript') || type.includes('audio_transcript') || type.includes('transcript')
                ? 'assistant'
                : undefined)
    if (!turnId || !role) return null

    const delta = typeof payload?.['delta'] === 'string'
        ? payload['delta']
        : typeof item?.['text'] === 'string'
            ? item['text']
            : ''
    if (type === 'turn.delta'
        || type === 'input_transcript.added'
        || type === 'output_transcript.added'
        || type.endsWith('.transcript.delta')
        || type.endsWith('.audio_transcript.delta')
        || type.endsWith('.input_audio_transcription.delta')) {
        return delta ? { kind: 'delta', role, providerItemId: turnId, delta } : null
    }

    if (type === 'turn.done'
        || type.endsWith('.transcript.done')
        || type.endsWith('.audio_transcript.done')
        || type.endsWith('.input_audio_transcription.completed')) {
        const text = String(turn?.['transcript'] ?? payload?.['transcript'] ?? payload?.['text'] ?? '').trim()
        if (role === 'assistant' && type !== 'turn.done') {
            return text ? { kind: 'delta', role, providerItemId: turnId, delta: text } : null
        }
        turnRoles.delete(turnId)
        return text ? { kind: 'completed', role, providerItemId: turnId, text } : null
    }
    return null
}

function isWebRtcTranscriptCompletion(value: unknown): boolean {
    const type = asText(asRecord(value)?.['type']) || ''
    return type === 'turn.done'
        || type.endsWith('.transcript.done')
        || type.endsWith('.audio_transcript.done')
        || type.endsWith('.input_audio_transcription.completed')
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function asText(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeTranscriptRole(value: string | null): 'user' | 'assistant' | null {
    if (value === 'user') return 'user'
    if (value === 'assistant') return 'assistant'
    return null
}

function boundedProviderItemId(value: string | null): string | null {
    return value && value.length <= 512 ? value : null
}

function normalizeChatGptErrorCategory(message: string): string {
    const normalized = message.toLowerCase()
    if (normalized.includes('auth') || normalized.includes('login')) return 'authentication_required'
    if (normalized.includes('unsupported') || normalized.includes('unavailable')) return 'feature_unavailable'
    if (normalized.includes('limit')) return 'session_limit_reached'
    if (normalized.includes('timeout') || normalized.includes('transport')) return 'transport_failed'
    return 'request_rejected'
}

function pendingEventBase(adapterSessionId: string, input: RealtimeConnectInput, occurredAt: string) {
    return {
        adapterSessionId,
        conversationId: input.conversationId,
        realtimeProviderThreadId: 'pending',
        realtimeSessionId: 'pending',
        realtimeSessionGeneration: input.requestedSessionGeneration,
        occurredAt
    }
}

function eventBase(session: ChatGptAdapterSession, occurredAt: string) {
    const handle = session.handle as RealtimeSessionHandle
    return {
        adapterSessionId: handle.adapterSessionId,
        conversationId: session.input.conversationId,
        realtimeProviderThreadId: handle.realtimeProviderThreadId,
        realtimeSessionId: handle.realtimeSessionId,
        realtimeSessionGeneration: handle.realtimeSessionGeneration,
        occurredAt
    }
}

function cloneConnectInput(input: RealtimeConnectInput): RealtimeConnectInput {
    return { ...input, signal: input.signal, hydrationSeed: structuredClone(input.hydrationSeed) }
}
