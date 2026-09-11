/**
 * Runtime adapters emit append deltas or an explicit whole-stream replacement.
 * The service assigns the monotonic session sequence; replay/projectors reject
 * already-applied sequences. A replacement (including empty text) supersedes
 * earlier text, and later deltas append to it. Presentation reveal is not truth.
 */
export type AssistantTextUpdate = { delta: string; replaceText?: string }
export function appendAssistantText(delta: string): AssistantTextUpdate { return { delta } }
/** Append ordinary tokens; explicitly replace when a provider revises its snapshot. */
export function assistantTextUpdate(previous: string, next: string): AssistantTextUpdate | null {
    if (previous === next) return null
    return next.startsWith(previous)
        ? { delta: next.slice(previous.length) }
        : { delta: '', replaceText: next }
}
export function applyAssistantTextUpdate(previous: string, update: { delta?: unknown; replaceText?: unknown }): string {
    return typeof update.replaceText === 'string' ? update.replaceText : previous + String(update.delta || '')
}
