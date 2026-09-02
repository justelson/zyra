import type { ForegroundRouteClaim } from './foreground-route'
import type { RealtimeProviderCapabilityReport } from './provider-capabilities'

export const REALTIME_HYDRATION_SCHEMA_VERSION = 1 as const

export interface RealtimeHydrationWatermarks {
    conversation: number
    foregroundRoutes: number
    context: number
    tasks: number
    operations: number
    narration: number
}

export interface RealtimeHydrationItem {
    itemId: string
    role: 'developer' | 'user' | 'assistant'
    text: string
    canonicalMessageId: string | null
    conversationSequence: number | null
    modality: 'text' | 'voice' | 'image' | 'system'
}

/**
 * Provider-neutral, replaceable adapter input. Canonical records remain in the
 * ledgers; this bounded value is safe to regenerate from their watermarks.
 */
export interface RealtimeHydrationSeed {
    schemaVersion: typeof REALTIME_HYDRATION_SCHEMA_VERSION
    packetId: string
    conversationId: string
    contextVersion: number
    activeRouteClaim: ForegroundRouteClaim
    sourceWatermarks: RealtimeHydrationWatermarks
    items: RealtimeHydrationItem[]
    retrievalReferenceIds: string[]
    generatedAt: string
    canonicalSha256: string
}

export interface RealtimeHydrationDelta {
    schemaVersion: typeof REALTIME_HYDRATION_SCHEMA_VERSION
    deltaId: string
    basePacketId: string
    conversationId: string
    fromWatermarks: RealtimeHydrationWatermarks
    toWatermarks: RealtimeHydrationWatermarks
    items: RealtimeHydrationItem[]
    generatedAt: string
    canonicalSha256: string
}

export interface RealtimeConnectInput {
    conversationId: string
    projectCwd: string
    offerSdp: string
    instructions: string
    voice: string
    output: 'audio' | 'text'
    requestedSessionGeneration: number
    hydrationSeed: RealtimeHydrationSeed
    signal: AbortSignal
}

export interface RealtimeSessionHandle {
    adapterSessionId: string
    realtimeProviderThreadId: string
    realtimeSessionId: string
    realtimeSessionGeneration: number
    answerSdp: string
    realtimeVersion: string
    hydratedPacketId: string
    hydratedThrough: RealtimeHydrationWatermarks
}

export interface HydrationReceipt {
    sessionId: string
    deltaId: string
    appliedThrough: RealtimeHydrationWatermarks
    appliedAt: string
}

export interface RealtimeSpeechItem {
    narrationId: string
    deliveryId: string
    canonicalMessageId: string
    text: string
    safeFacts: string[]
    expiresAt: string
    routeClaim: ForegroundRouteClaim
}

export interface SpeechSubmissionReceipt {
    sessionId: string
    deliveryId: string
    providerItemId: string | null
    submittedAt: string
}

export interface SessionCloseReceipt {
    sessionId: string
    reason: string
    closedAt: string
}

interface RealtimeEventBase {
    adapterSessionId: string
    conversationId: string
    realtimeProviderThreadId: string
    realtimeSessionId: string
    realtimeSessionGeneration: number
    occurredAt: string
}

export type RealtimeDomainEvent =
    | (RealtimeEventBase & { type: 'realtime.session.connecting' })
    | (RealtimeEventBase & { type: 'realtime.session.ready'; realtimeVersion: string })
    | (RealtimeEventBase & { type: 'realtime.session.closed'; reason: string | null })
    | (RealtimeEventBase & { type: 'realtime.session.error'; category: string; message: string })
    | (RealtimeEventBase & {
        type: 'realtime.user.transcript.delta' | 'realtime.assistant.transcript.delta'
        providerItemId: string
        delta: string
    })
    | (RealtimeEventBase & {
        type: 'realtime.user.transcript.completed' | 'realtime.assistant.transcript.completed'
        providerItemId: string
        text: string
    })
    | (RealtimeEventBase & {
        type: 'realtime.delegation.requested'
        providerItemId: string
        text: string
    })
    | (RealtimeEventBase & { type: 'realtime.audio.started' | 'realtime.audio.stopped'; providerItemId: string | null })
    | (RealtimeEventBase & { type: 'realtime.interrupted'; providerItemId: string | null })
    | (RealtimeEventBase & { type: 'realtime.usage.updated'; inputTokens: number; outputTokens: number })
    | (RealtimeEventBase & { type: 'realtime.context.applied'; deltaId: string; appliedThrough: RealtimeHydrationWatermarks })
    | (RealtimeEventBase & { type: 'realtime.speech.completed'; deliveryId: string; providerItemId: string | null })

export interface RealtimeForegroundAdapter {
    capabilities(): Promise<RealtimeProviderCapabilityReport>
    connect(input: RealtimeConnectInput): Promise<RealtimeSessionHandle>
    appendContext(sessionId: string, delta: RealtimeHydrationDelta): Promise<HydrationReceipt>
    requestSpeech(sessionId: string, item: RealtimeSpeechItem): Promise<SpeechSubmissionReceipt>
    close(sessionId: string, reason: string): Promise<SessionCloseReceipt>
    subscribe(listener: (event: RealtimeDomainEvent) => void): () => void
}

export interface RealtimeContinuitySource {
    materialize(conversationId: string, routeClaim: ForegroundRouteClaim): Promise<RealtimeHydrationSeed>
    deltaAfter(seed: RealtimeHydrationSeed, current: RealtimeHydrationWatermarks): Promise<RealtimeHydrationDelta | null>
}

export function equalRealtimeWatermarks(left: RealtimeHydrationWatermarks, right: RealtimeHydrationWatermarks): boolean {
    return left.conversation === right.conversation
        && left.foregroundRoutes === right.foregroundRoutes
        && left.context === right.context
        && left.tasks === right.tasks
        && left.operations === right.operations
        && left.narration === right.narration
}
