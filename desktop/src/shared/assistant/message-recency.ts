import type { AssistantMessage } from './contracts'

/** Preserve the latest known message boundary when only a history page is loaded. */
export function latestAssistantMessageAt(messages: readonly AssistantMessage[], previous?: string | null): string | null {
    let latest = previous && Number.isFinite(Date.parse(previous)) ? previous : null
    for (const message of messages) {
        if (message.role === 'system') continue
        const timestamp = message.createdAt || message.updatedAt
        if (timestamp && Number.isFinite(Date.parse(timestamp)) && (!latest || Date.parse(timestamp) > Date.parse(latest))) latest = timestamp
    }
    return latest
}
