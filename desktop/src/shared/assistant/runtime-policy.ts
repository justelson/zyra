import { normalizeModelCompactionOverrides } from '../../../../src/assistant-runtime-policy.mjs'
export { resolveModelCompactionPolicy, getModelCompactionPresets, normalizeModelCompactionOverrides } from '../../../../src/assistant-runtime-policy.mjs'
export type { CompactionModel, ModelCompactionPolicy, ModelCompactionOverrides } from '../../../../src/assistant-runtime-policy.mjs'

export type AssistantReasoningSummaryMode = 'auto' | 'detailed' | 'concise'

export type AssistantRuntimePolicy = {
    reasoningSummary: AssistantReasoningSummaryMode
    /** Retained for legacy storage only; never applied to every model. */
    contextCompactionThresholdTokens: number
    modelCompactionOverrides: Record<string, number>
}

export const DEFAULT_ASSISTANT_REASONING_SUMMARY: AssistantReasoningSummaryMode = 'detailed'
export const DEFAULT_ASSISTANT_CONTEXT_COMPACTION_THRESHOLD_TOKENS = 256_000
export const MIN_ASSISTANT_CONTEXT_COMPACTION_THRESHOLD_TOKENS = 64_000
export const MAX_ASSISTANT_CONTEXT_COMPACTION_THRESHOLD_TOKENS = 372_000
export const ASSISTANT_CONTEXT_COMPACTION_OUTPUT_RESERVE_TOKENS = 16_000

export const ASSISTANT_CONTEXT_COMPACTION_THRESHOLD_OPTIONS = [
    128_000,
    200_000,
    256_000,
    320_000,
    372_000
] as const

export function normalizeAssistantReasoningSummaryMode(value: unknown): AssistantReasoningSummaryMode {
    return value === 'auto' || value === 'concise' || value === 'detailed'
        ? value
        : DEFAULT_ASSISTANT_REASONING_SUMMARY
}

export function normalizeAssistantContextCompactionThresholdTokens(value: unknown): number {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return DEFAULT_ASSISTANT_CONTEXT_COMPACTION_THRESHOLD_TOKENS
    return Math.max(1, Math.round(parsed))
}

export function resolveAssistantContextCompactionLimitTokens(
    modelContextWindow: number | null | undefined,
    configuredThreshold: unknown
): number {
    const threshold = normalizeAssistantContextCompactionThresholdTokens(configuredThreshold)
    const contextWindow = Number(modelContextWindow)
    if (!Number.isFinite(contextWindow) || contextWindow <= 0) return threshold
    return Math.min(
        threshold,
        Math.max(1, Math.floor(contextWindow) - ASSISTANT_CONTEXT_COMPACTION_OUTPUT_RESERVE_TOKENS)
    )
}

export function normalizeAssistantRuntimePolicy(value: Partial<AssistantRuntimePolicy> | null | undefined): AssistantRuntimePolicy {
    return {
        reasoningSummary: normalizeAssistantReasoningSummaryMode(value?.reasoningSummary),
        modelCompactionOverrides: normalizeModelCompactionOverrides(value?.modelCompactionOverrides),
        contextCompactionThresholdTokens: normalizeAssistantContextCompactionThresholdTokens(
            value?.contextCompactionThresholdTokens
        )
    }
}
