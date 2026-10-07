import type { AssistantMessage } from './contracts'

/** SQLite/legacy history rows omit provider phase. Keep known metadata for
 * the same assistant message without changing text, streaming or turn state. */
export function preserveAssistantMessagePhases(existing: readonly AssistantMessage[], incoming: AssistantMessage[]): AssistantMessage[] {
    if (!existing.some(message => message.role === 'assistant' && message.phase)) return incoming
    const phases = new Map(existing.filter(message => message.role === 'assistant' && message.phase)
        .map(message => [message.id, message.phase] as const))
    let changed = false
    const result = incoming.map(message => {
        const phase = message.role === 'assistant' && !message.phase ? phases.get(message.id) : undefined
        if (!phase) return message
        changed = true
        return { ...message, phase }
    })
    return changed ? result : incoming
}
