import { normalizeCanonicalMessageSourceId } from '../../shared/assistant/message-identity'

export function remoteAssistantPromptMessageId(turnId: string): string {
    return `assistant-message-remote-prompt-${turnId}`
}

export function canonicalPiMessageSourceId(message: Record<string, unknown>, fallback: string): string {
    const value = message['zyraCanonicalMessage']
    const zyraCanonical = value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
    const canonicalMessageId = String(zyraCanonical?.['canonicalMessageId'] || '').trim()
    if (canonicalMessageId) return normalizeCanonicalMessageSourceId(canonicalMessageId)
    const timestamp = Number(message['timestamp'])
    const role = String(message['role'] || 'unknown')
    return Number.isFinite(timestamp) && timestamp > 0
        ? `zyra-message:${role}:${Math.trunc(timestamp)}`
        : fallback
}

export function canonicalDesktopMessageId(role: string, sourceMessageId: string): string {
    if (sourceMessageId.startsWith('voice_')) return sourceMessageId
    if (role === 'assistant') return `assistant-message-${sourceMessageId}`
    if (role === 'user') return `assistant-message-user-${sourceMessageId}`
    return sourceMessageId
}
