import type { AssistantSession } from '@shared/assistant/contracts'
import { getPrimarySessionThread, getSessionLastActivityAt, resolveAssistantSidebarRowStatus } from './assistant-sessions-rail-utils'
import { getSidebarSettlementActivityKey, isAssistantChatSettled, type SettlementOverrides } from './assistant-sidebar-settlement'
import { setAssistantSettlementOverrides } from './assistant-settlement-store'
import { getPinnedSessionIds, writePinnedSessionIds } from './assistant-pinned-sessions'
import { copyTextToClipboard } from '@/lib/copy-text'
import type { AssistantToastInput } from './AssistantPageHelpers'

export function resolveChatMenuSettlement(session: AssistantSession, overrides: SettlementOverrides, pinned: boolean, activeThreadId: string | null, pendingControl = false) {
    const thread = session.threads.find(entry => entry.id === session.activeThreadId) || getPrimarySessionThread(session)
    const status = resolveAssistantSidebarRowStatus(thread, thread?.id === activeThreadId)
    const priority = pendingControl || pinned || status === 'approval' || status === 'input' || status === 'working'
    return {
        priority,
        settled: isAssistantChatSettled(session, overrides, {
            priority,
            ready: status === 'ready',
            activityAt: getSessionLastActivityAt(session)
        })
    }
}

export function toggleChatPinned(sessionId: string) {
    const next = new Set(getPinnedSessionIds())
    const wasPinned = next.has(sessionId)
    if (wasPinned) next.delete(sessionId)
    else next.add(sessionId)
    writePinnedSessionIds(next)
    return !wasPinned
}

export function setChatSettlement(session: AssistantSession, settled: boolean) {
    setAssistantSettlementOverrides(current => ({
        ...current,
        [session.id]: { state: settled ? 'settled' : 'active', activityAt: getSessionLastActivityAt(session), activityKey: getSidebarSettlementActivityKey(session) }
    }))
}

export async function copyChatThreadId(threadId: string | null, showToast?: (input: AssistantToastInput) => void) {
    if (!threadId) return
    try {
        await copyTextToClipboard(threadId)
        showToast?.({ message: 'Thread ID copied', tone: 'success' })
        return true
    } catch (error) {
        showToast?.({ message: error instanceof Error ? `Could not copy thread ID: ${error.message}` : 'Could not copy thread ID', tone: 'error' })
        return false
    }
}
