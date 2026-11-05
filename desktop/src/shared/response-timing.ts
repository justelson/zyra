import { isAssistantReasoningEffort } from './assistant/reasoning-efforts'

export const RESPONSE_TIMING_IPC = {
    read: 'zyra:diagnostics:response-timings',
    displayed: 'zyra:diagnostics:response-displayed'
} as const

export const RESPONSE_TIMING_MODELS = ['gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.5', 'other'] as const
export type ResponseTimingModel = typeof RESPONSE_TIMING_MODELS[number]
export function responseTimingModel(model: string): ResponseTimingModel {
    const name = model.split('/').pop()
    return RESPONSE_TIMING_MODELS.find(value => value === name) || 'other'
}
export type ResponseTimingEffort = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'unknown'
export function responseTimingEffort(value: unknown): ResponseTimingEffort {
    if (value === 'none') return 'off'
    return isAssistantReasoningEffort(value) && value !== 'none' ? value : 'unknown'
}
export type ResponseTimingOutcome = 'running' | 'completed' | 'failed' | 'cancelled' | 'unfinished'
export type ResponseTimingRequest = {
    startedMs: number
    firstEventMs: number | null
    firstTextMs: number | null
    lastEventMs: number | null
    durationMs: number | null
    maxGapMs: number | null
}
export type ResponseTimingRecord = {
    turnId: string
    startedAt: number
    model: ResponseTimingModel
    effort: ResponseTimingEffort
    outcome: ResponseTimingOutcome
    mainReceivedMs: number
    dispatchMs: number | null
    acceptedMs: number | null
    firstEventMs: number | null
    firstTextMs: number | null
    firstTextReceivedMs: number | null
    firstDisplayMs: number | null
    completedMs: number | null
    requestCount: number
    retryCount: number
    compactionCount: number
    compactionMs: number
    maxStreamingGapMs: number | null
    stallCount: number
    mainStallMs: number
    rendererStallMs: number
    maxStallMs: number
    requests: ResponseTimingRequest[]
}
export interface ResponseTimingApi {
    read(): Promise<{ success: true; records: ResponseTimingRecord[]; storageLimitBytes: number } | { success: false; error: string }>
    displayed(input: { turnId: string; at: number }): Promise<boolean>
}

// Electron processes share the OS performance clock. Preserve sub-millisecond
// ordering without mixing wall-clock Date.now() with monotonic measurements.
export function responseTimingNow(): number {
    return performance.timeOrigin + performance.now()
}
