import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AssistantMessage } from '@shared/assistant/contracts'
import { findAssistantMessageReplayDuplicateIds } from '@shared/assistant/message-reconciliation'
import type { ComposerContextFile } from './assistant-composer-types'
import { buildPromptWithContextFiles } from './assistant-composer-utils'
import { rememberSentAttachmentPreviews } from './assistant-sent-attachment-previews'

type PendingMessage = { sessionId: string; threadId: string; message: AssistantMessage }
const pendingObjects = new WeakSet<AssistantMessage>()
export const isPendingAssistantUserMessage = (message: AssistantMessage): boolean => pendingObjects.has(message)

export function createPendingAssistantUserMessage(input: {
    sessionId: string; threadId: string; prompt: string; files: ComposerContextFile[]; queueEntryId?: string; targetTurnId?: string; startedAt: string
}): PendingMessage {
    const id = input.queueEntryId ? `assistant-message-queued:${input.sessionId}:${input.queueEntryId}` : `assistant-message-${crypto.randomUUID()}`
    const message: AssistantMessage = { id, role: 'user', text: buildPromptWithContextFiles(input.prompt, input.files), turnId: input.targetTurnId || `pending-turn:${id}`,
        streaming: false, createdAt: input.startedAt, updatedAt: input.startedAt }
    pendingObjects.add(message)
    rememberSentAttachmentPreviews(id, input.files)
    return { sessionId: input.sessionId, threadId: input.threadId, message }
}

export function useAssistantPendingMessages(sessionId: string | null, threadId: string | null, canonicalMessages: AssistantMessage[], showPending = true) {
    const [pending, setPending] = useState<PendingMessage[]>([])
    const [followRequest, setFollowRequest] = useState<{ sessionId: string; threadId: string; key: string } | null>(null)
    const begin = useCallback((entry: PendingMessage, follow = true) => {
        setPending(current => current.some(item => item.message.id === entry.message.id) ? current : [...current, entry])
        if (follow) setFollowRequest({ sessionId: entry.sessionId, threadId: entry.threadId, key: `${entry.message.id}:${entry.message.createdAt}` })
    }, [])
    const remove = useCallback((id: string) => setPending(current => current.filter(entry => entry.message.id !== id)), [])
    const accept = useCallback((id: string, turnId: string | undefined) => {
        if (!turnId) return
        setPending(current => current.map(entry => {
            if (entry.message.id !== id || entry.message.turnId === turnId) return entry
            const message = { ...entry.message, turnId }
            pendingObjects.add(message)
            return { ...entry, message }
        }))
    }, [])
    const acknowledgedIds = useMemo(() => {
        if (!pending.length) return null
        const ids = new Set(canonicalMessages.map(message => message.id))
        const owned = pending.filter(entry => entry.sessionId === sessionId && entry.threadId === threadId)
        // A provider replay may replace our UUID. Use the established replay
        // identity rules, scoped to admitted turns so repeated prompts stay distinct.
        const turnIds = new Set(owned.map(entry => entry.message.turnId).filter((id): id is string => !!id && !id.startsWith('pending-turn:')))
        for (const turnId of turnIds) {
            const messages = [...canonicalMessages.filter(message => message.turnId === turnId), ...owned.filter(entry => entry.message.turnId === turnId).map(entry => entry.message)]
            for (const id of findAssistantMessageReplayDuplicateIds(messages)) ids.add(id)
        }
        return ids
    }, [canonicalMessages, pending, sessionId, threadId])
    useEffect(() => {
        const ids = acknowledgedIds
        if (!ids) return
        setPending(current => current.some(entry => entry.sessionId === sessionId && entry.threadId === threadId && ids.has(entry.message.id))
            ? current.filter(entry => entry.sessionId !== sessionId || entry.threadId !== threadId || !ids.has(entry.message.id)) : current)
    }, [acknowledgedIds, sessionId, threadId])
    const messages = useMemo(() => {
        const ids = acknowledgedIds
        if (!ids || !showPending) return canonicalMessages
        const missing = pending.filter(entry => entry.sessionId === sessionId && entry.threadId === threadId && !ids.has(entry.message.id))
        return missing.length ? [...canonicalMessages, ...missing.map(entry => entry.message)] : canonicalMessages
    }, [canonicalMessages, acknowledgedIds, pending, sessionId, threadId, showPending])
    const followRequestKey = followRequest?.sessionId === sessionId && followRequest.threadId === threadId ? followRequest.key : null
    return { messages, begin, accept, remove, followRequestKey }
}
