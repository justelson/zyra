import { parseAssistantCitation } from '@shared/assistant/assistant-citations'
import type { AssistantComposerSendOptions, ComposerContextFile } from './assistant-composer-types'

export type PendingComposerDispatch = {
    id: string
    sessionId: string
    prompt: string
    contextFiles: ComposerContextFile[]
    options: AssistantComposerSendOptions
    previewOnly?: boolean
}

export type AssistantComposerQueueSnapshot = {
    version: 1
    entries: Record<string, PendingComposerDispatch[]>
    held: Record<string, boolean>
}

export interface AssistantComposerQueueStorage {
    read(): AssistantComposerQueueSnapshot
    write(snapshot: AssistantComposerQueueSnapshot): void
}

export const ASSISTANT_COMPOSER_QUEUE_STORAGE_KEY = 'zyra.assistant.composer-queue.v1'
export const emptyAssistantComposerQueue = (): AssistantComposerQueueSnapshot => ({ version: 1, entries: {}, held: {} })

// Device/profile-local recovery, not canonical server storage. Keep all attachment
// fields (including inline content/data URLs); quota errors must reject acceptance.
export function createAssistantComposerQueueStorage(
    getStorage: () => Pick<Storage, 'getItem' | 'setItem'> = () => window.localStorage
): AssistantComposerQueueStorage {
    return {
        read() {
            const raw = getStorage().getItem(ASSISTANT_COMPOSER_QUEUE_STORAGE_KEY)
            if (!raw) return emptyAssistantComposerQueue()
            const parsed = JSON.parse(raw) as AssistantComposerQueueSnapshot
            if (parsed.version !== 1 || !parsed.entries || typeof parsed.entries !== 'object' || Array.isArray(parsed.entries)) {
                throw new Error('Unsupported composer queue data')
            }
            const entries: Record<string, PendingComposerDispatch[]> = {}
            const held: Record<string, boolean> = {}
            for (const [sessionId, messages] of Object.entries(parsed.entries)) {
                if (!Array.isArray(messages)) throw new Error('Invalid composer queue')
                entries[sessionId] = messages.map(message => {
                    if (!message || message.sessionId !== sessionId || typeof message.id !== 'string'
                        || typeof message.prompt !== 'string' || !Array.isArray(message.contextFiles)
                        || !message.options || typeof message.options !== 'object'
                        || message.contextFiles.some(file => !file || typeof file.id !== 'string' || typeof file.path !== 'string')) {
                        throw new Error('Invalid queued message')
                    }
                    // Legacy Force is recovered as Steer; never interrupt a turn.
                    return { ...message, contextFiles: message.contextFiles.map(file => ({ ...file, ...(file.citation !== undefined ? { citation: parseAssistantCitation(file.citation) || undefined } : {}) })), options: { ...message.options, dispatchMode: message.options.dispatchMode === 'force' ? 'steer' : message.options.dispatchMode } }
                })
                if (messages.length) held[sessionId] = true
            }
            // Recovery always holds. Delivery may have been accepted just before a
            // renderer crash; resuming is an explicit user decision, not a replay.
            return { version: 1, entries, held }
        },
        write(snapshot) {
            const serialized = JSON.stringify(snapshot)
            const storage = getStorage()
            storage.setItem(ASSISTANT_COMPOSER_QUEUE_STORAGE_KEY, serialized)
            if (storage.getItem(ASSISTANT_COMPOSER_QUEUE_STORAGE_KEY) !== serialized) {
                throw new Error('Composer queue could not be saved')
            }
        }
    }
}

export function cloneComposerQueueValue<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
}

export function moveQueuedDispatch(entries: PendingComposerDispatch[], messageId: string, targetMessageId: string): PendingComposerDispatch[] {
    const from = entries.findIndex(entry => entry.id === messageId)
    const to = entries.findIndex(entry => entry.id === targetMessageId)
    if (from < 0 || to < 0 || from === to) return entries
    const next = [...entries]
    const [moved] = next.splice(from, 1)
    const target = next.findIndex(entry => entry.id === targetMessageId)
    next.splice(from < to ? target + 1 : target, 0, moved)
    return next
}
