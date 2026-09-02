export type AssistantChatRouteTarget =
    | { kind: 'chat'; sessionId: string; threadId: string | null }
    | { kind: 'assistant-root' }
    | { kind: 'invalid-chat' }
    | { kind: 'reserved' }
    | { kind: 'outside-assistant' }

function decodeRouteIdentity(value: string): string | null {
    try {
        return decodeURIComponent(value).trim() || null
    } catch {
        return null
    }
}

export function buildAssistantChatRoute(sessionId: string, threadId?: string | null): string {
    const sessionSegment = encodeURIComponent(sessionId)
    if (!threadId) return `/assistant/chat/${sessionSegment}`
    return `/assistant/chat/${sessionSegment}/thread/${encodeURIComponent(threadId)}`
}

export function buildAssistantMessageSearchRoute(sessionId: string, threadId: string, messageId: string): string {
    return `${buildAssistantChatRoute(sessionId, threadId)}?message=${encodeURIComponent(messageId)}`
}

export function parseAssistantMessageSearchTarget(search: string): string | null {
    const value = new URLSearchParams(search).get('message')
    return value?.trim() || null
}

export function parseAssistantChatRoute(pathname: string): AssistantChatRouteTarget {
    const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
    if (normalized === '/assistant') return { kind: 'assistant-root' }
    if (!normalized.startsWith('/assistant/')) return { kind: 'outside-assistant' }
    if (normalized.startsWith('/assistant/dev/')) return { kind: 'reserved' }

    const segments = normalized.split('/').filter(Boolean)
    if (segments[0] !== 'assistant' || segments[1] !== 'chat') return { kind: 'reserved' }
    if (segments.length !== 3 && segments.length !== 5) return { kind: 'invalid-chat' }
    if (segments.length === 5 && segments[3] !== 'thread') return { kind: 'invalid-chat' }

    const sessionId = decodeRouteIdentity(segments[2])
    const threadId = segments.length === 5 ? decodeRouteIdentity(segments[4]) : null
    if (!sessionId || (segments.length === 5 && !threadId)) return { kind: 'invalid-chat' }
    return { kind: 'chat', sessionId, threadId }
}
