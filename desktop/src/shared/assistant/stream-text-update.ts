/** Append ordinary tokens; explicitly replace when a provider revises its snapshot. */
export function assistantTextUpdate(previous: string, next: string): { delta: string; replaceText?: string } | null {
    if (previous === next) return null
    return next.startsWith(previous)
        ? { delta: next.slice(previous.length) }
        : { delta: '', replaceText: next }
}
export function applyAssistantTextUpdate(previous: string, update: { delta?: unknown; replaceText?: unknown }): string {
    return typeof update.replaceText === 'string' ? update.replaceText : previous + String(update.delta || '')
}
