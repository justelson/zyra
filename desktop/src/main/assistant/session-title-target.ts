import type { AssistantSession } from '../../shared/assistant/contracts'

export function findSessionTitleThread(session: AssistantSession, canonicalChatId?: string) {
    return canonicalChatId !== undefined
        ? session.threads.find(entry => entry.providerThreadId === canonicalChatId)
        : session.threads.find(entry => entry.source === 'root' && !entry.parentThreadId)
            || session.threads.find(entry => entry.id === session.activeThreadId)
}

/** Mobile selects an authorized canonical chat, never its parent or siblings. */
export function resolveSessionTitleTarget(session: AssistantSession, canonicalChatId?: string) {
    const thread = findSessionTitleThread(session, canonicalChatId)
    if (!thread) throw new Error('Assistant thread not found.')
    const canonicalIds = (canonicalChatId !== undefined ? [thread] : session.threads)
        .map(entry => entry.providerThreadId).filter((id): id is string => Boolean(id))
    return { thread, canonicalIds: [...new Set(canonicalIds)] }
}
