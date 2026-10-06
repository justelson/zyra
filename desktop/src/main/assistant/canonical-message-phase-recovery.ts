import type { AssistantMessage, AssistantThread } from '../../shared/assistant/contracts'
import { normalizeAssistantMessageReferenceId, resolveAssistantMessageReferenceId } from '../../shared/assistant/message-identity'
import { extractAssistantEventMessagePhase } from './assistant-message-content'
import { canonicalDesktopMessageId, canonicalPiMessageSourceId } from './canonical-message-identity'

type MessagePhase = NonNullable<AssistantMessage['phase']>
const asRecord = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' ? value as Record<string, unknown> : null

/** Recover metadata only: canonical text and tool records are not imported. */
function findCanonicalPhase(entries: readonly unknown[], target: AssistantMessage): MessagePhase | undefined {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = asRecord(entries[index])
        if (entry?.['type'] !== 'message') continue
        const message = asRecord(entry['message'])
        if (message?.['role'] !== 'assistant') continue
        const sourceId = canonicalPiMessageSourceId(message, String(message['id'] || entry['id'] || ''))
        if (!sourceId) continue
        const id = canonicalDesktopMessageId('assistant', sourceId)
        if (normalizeAssistantMessageReferenceId(id) !== normalizeAssistantMessageReferenceId(target.id)) continue
        return extractAssistantEventMessagePhase({ message })
    }
    return undefined
}

/** One single-flight lookup per chat/turn/message identity, including unknown
 * metadata. Repeated hydration cannot turn this into a network polling path. */
export class CanonicalMessagePhaseRecovery {
    private readonly lookups = new Map<string, { key: string; phase: Promise<MessagePhase | undefined> }>()

    async recover(thread: AssistantThread, messages: AssistantMessage[], readLatestEntries: () => Promise<readonly unknown[] | null>): Promise<AssistantMessage[]> {
        const chatId = thread.providerThreadId
        if (!chatId || !(thread.latestTurn?.state === 'running'
            || thread.canonicalPresence?.state === 'running' || thread.canonicalPresence?.state === 'background')) return messages
        const targetId = resolveAssistantMessageReferenceId(messages, thread.latestTurn?.assistantMessageId || thread.canonicalPresence?.latestTurn?.assistantMessageId)
        const target = messages.find(message => message.id === targetId && message.role === 'assistant')
        if (!target || target.phase) return messages
        const key = `${thread.latestTurn?.id || thread.canonicalPresence?.activeTurnId || ''}\u0000${target.id}`
        let lookup = this.lookups.get(chatId)
        if (!lookup || lookup.key !== key) {
            lookup = { key, phase: readLatestEntries().then(entries => entries ? findCanonicalPhase(entries, target) : undefined) }
            this.lookups.set(chatId, lookup)
        }
        const phase = await lookup.phase
        return phase ? messages.map(message => message === target ? { ...message, phase } : message) : messages
    }
}
