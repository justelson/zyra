export const MAX_ASSISTANT_CITATION_TEXT = 8_000
export const MAX_ASSISTANT_CITATION_COMMENT = 8_000

/** Offsets address the rendered response's textContent, not Markdown source. */
export type AssistantCitation = {
    version: 1
    sessionId: string
    threadId?: string
    messageId: string
    text: string
    start: number
    end: number
    prefix: string
    suffix: string
    comment: string
    /** Rendered-text change detector, not an authorization proof. */
    sourceFingerprint?: string
}

export function parseAssistantCitation(value: unknown): AssistantCitation | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const v = value as Record<string, unknown>
    const validId = (id: unknown): id is string => typeof id === 'string' && id.trim().length > 0 && id.length <= 512 && !/[\r\n\u0000]/.test(id)
    if (v.version !== 1 || !validId(v.sessionId) || !validId(v.messageId)) return null
    if (v.threadId !== undefined && !validId(v.threadId)) return null
    if (typeof v.text !== 'string' || !v.text.trim() || v.text.length > MAX_ASSISTANT_CITATION_TEXT) return null
    if (typeof v.start !== 'number' || typeof v.end !== 'number' || !Number.isSafeInteger(v.start) || !Number.isSafeInteger(v.end) || v.start < 0 || v.end <= v.start || v.end - v.start !== v.text.length) return null
    if (typeof v.prefix !== 'string' || v.prefix.length > 120 || typeof v.suffix !== 'string' || v.suffix.length > 120) return null
    if (typeof v.comment !== 'string' || v.comment.length > MAX_ASSISTANT_CITATION_COMMENT) return null
    if (v.sourceFingerprint !== undefined && (typeof v.sourceFingerprint !== 'string' || !/^\d{1,12}:[a-f0-9]{8}$/.test(v.sourceFingerprint))) return null
    return { ...(v.sourceFingerprint ? { sourceFingerprint: v.sourceFingerprint as string } : {}), version: 1, sessionId: v.sessionId, ...(v.threadId ? { threadId: v.threadId as string } : {}), messageId: v.messageId, text: v.text, start: v.start, end: v.end, prefix: v.prefix, suffix: v.suffix, comment: v.comment }
}

export function assistantCitationFingerprint(source: string): string {
    let hash = 2166136261
    for (let index = 0; index < source.length; index++) hash = Math.imul(hash ^ source.charCodeAt(index), 16777619)
    return `${source.length}:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function locateAssistantCitation(source: string, citation: AssistantCitation): { start: number; end: number } | null {
    if ((!citation.sourceFingerprint || assistantCitationFingerprint(source) === citation.sourceFingerprint) && source.slice(citation.start, citation.end) === citation.text) return { start: citation.start, end: citation.end }
    const matches: number[] = []
    for (let start = source.indexOf(citation.text); start >= 0; start = source.indexOf(citation.text, start + 1)) matches.push(start)
    const contextual = matches.filter(start => (!citation.prefix || source.slice(Math.max(0, start - citation.prefix.length), start) === citation.prefix)
        && (!citation.suffix || source.slice(start + citation.text.length, start + citation.text.length + citation.suffix.length) === citation.suffix))
    const start = contextual.length === 1 ? contextual[0] : matches.length === 1 ? matches[0] : null
    return start === null ? null : { start, end: start + citation.text.length }
}

export function assistantCitationSourceHref(citation: AssistantCitation): string {
    return `/assistant/chat/${encodeURIComponent(citation.sessionId)}${citation.threadId ? `/thread/${encodeURIComponent(citation.threadId)}` : ''}?message=${encodeURIComponent(citation.messageId)}`
}

export function formatAssistantCitation(citation: AssistantCitation): string {
    return `Quoted assistant response (preserved snapshot)\nSource: ${assistantCitationSourceHref(citation)}\nSession: ${citation.sessionId}\n${citation.threadId ? `Thread: ${citation.threadId}\n` : ''}Message: ${citation.messageId}\n\n${citation.text.split(/\r?\n/).map(line => `> ${line}`).join('\n')}${citation.comment ? `\n\nUser comment:\n${citation.comment}` : ''}`
}
