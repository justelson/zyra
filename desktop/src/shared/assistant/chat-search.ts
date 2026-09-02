export const ASSISTANT_CHAT_SEARCH_MIN_QUERY_LENGTH = 2
export const ASSISTANT_CHAT_SEARCH_MAX_QUERY_LENGTH = 200
export const ASSISTANT_CHAT_SEARCH_DEFAULT_LIMIT = 24
export const ASSISTANT_CHAT_SEARCH_MAX_LIMIT = 50
export const ASSISTANT_CHAT_SEARCH_MAX_INDEXED_MESSAGE_CHARACTERS = 16_384

export type AssistantChatSearchScope = 'active' | 'archived' | 'all'

export type ParsedAssistantChatSearchQuery = {
    query: string
    scope: AssistantChatSearchScope
}

const SCOPE_PATTERN = /(?:^|\s)is:(active|archived|all)(?=\s|$)/gi

export function parseAssistantChatSearchQuery(value: string): ParsedAssistantChatSearchQuery {
    let scope: AssistantChatSearchScope = 'active'
    const query = String(value || '')
        .replace(SCOPE_PATTERN, (_match, requestedScope: string) => {
            scope = requestedScope.toLowerCase() as AssistantChatSearchScope
            return ' '
        })
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, ASSISTANT_CHAT_SEARCH_MAX_QUERY_LENGTH)
    return { query, scope }
}

export function clampAssistantChatSearchLimit(value?: number): number {
    if (!Number.isFinite(value)) return ASSISTANT_CHAT_SEARCH_DEFAULT_LIMIT
    return Math.max(1, Math.min(ASSISTANT_CHAT_SEARCH_MAX_LIMIT, Math.floor(value!)))
}

export function canSearchAssistantChatContent(query: string): boolean {
    return query.trim().length >= ASSISTANT_CHAT_SEARCH_MIN_QUERY_LENGTH
}
