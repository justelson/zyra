import type { AssistantActivity } from './contracts'

export const ASSISTANT_ACTION_BATCH_TOOL_NAME = 'begin_action_batch'
export const ASSISTANT_ACTION_BATCH_INTENT_MAX_LENGTH = 72

export function normalizeAssistantActionBatchIntent(value: unknown): string | null {
    const normalized = typeof value === 'string'
        ? value
            .replace(/[\u0000-\u001f\u007f]/g, ' ')
            .replace(/^[#>*_`\s-]+|[#>*_`\s-]+$/g, '')
            .replace(/\s+/g, ' ')
            .trim()
        : ''
    if (!normalized) return null
    return normalized.slice(0, ASSISTANT_ACTION_BATCH_INTENT_MAX_LENGTH).trimEnd() || null
}

export function readAssistantActionBatchIntent(activity: AssistantActivity): string | null {
    return normalizeAssistantActionBatchIntent(activity.payload?.actionBatchIntent)
}
