const ASSISTANT_TRANSPORT_FAILURE_PATTERN = /\bfetch failed\b|network request failed|network issue|network(?: is)? (?:unavailable|offline)|socket hang up|agent-server (?:connection )?closed|agent server is disconnected|econnreset|econnrefused|etimedout|enotfound|eai_again|epipe|und_err_/i
const ASSISTANT_TRANSPORT_FAILURE_CODES = new Set([
    'AGENT_SERVER_DISCONNECTED',
    'AGENT_SERVER_UNAVAILABLE',
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EAI_AGAIN',
    'EPIPE',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_SOCKET'
])

export function isAssistantTransportFailure(value: unknown): boolean {
    const message = value instanceof Error ? value.message : String(value || '')
    const code = value && typeof value === 'object' && 'code' in value
        ? String((value as { code?: unknown }).code || '').toUpperCase()
        : ''
    return ASSISTANT_TRANSPORT_FAILURE_CODES.has(code)
        || ASSISTANT_TRANSPORT_FAILURE_PATTERN.test(message)
}
