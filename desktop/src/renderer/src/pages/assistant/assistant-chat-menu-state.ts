import type { AssistantSession } from '@shared/assistant/contracts'
import { getPrimarySessionThread, getSessionLastActivityAt, resolveAssistantSidebarRowStatus } from './assistant-sessions-rail-utils'
import { isAssistantChatSettled, type SettlementOverrides } from './assistant-sidebar-settlement'
import { getPinnedSessionIds, writePinnedSessionIds } from './assistant-pinned-sessions'
import { copyTextToClipboard } from '@/lib/copy-text'
import type { AssistantToastInput } from './AssistantPageHelpers'
import { beginAssistantSettlement } from './assistant-settlement-store'

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

const settlementWrites = new Map<string, Promise<void>>()
export async function setChatSettlement(session: AssistantSession, settled: boolean, migrateLegacy = false) {
    const intent = beginAssistantSettlement(session, settled)
    const previous = settlementWrites.get(session.id)
    const write = (async () => {
        // Rapid toggles keep their latest UI intent, but reach the server in order.
        if (previous) await previous.catch(() => undefined)
        try {
            const result = await window.devscope.assistant.settleSession(session.id, settled, migrateLegacy)
            if (!result.success) throw new Error(result.error || 'Could not update chat settlement.')
            intent.confirm()
        } catch (error) { intent.rollback(); throw error }
    })()
    settlementWrites.set(session.id, write)
    try { await write }
    finally { if (settlementWrites.get(session.id) === write) settlementWrites.delete(session.id) }
    // Canonical metadata acknowledges intent without a bootstrap/history refresh.
}

export function createChatSettlementToast(session: AssistantSession, settled: boolean, undo?: () => void | Promise<void>): AssistantToastInput {
    return {
        message: settled ? 'Chat settled. Send a message to continue.' : 'Chat restored',
        tone: 'success',
        action: { label: 'Undo', run: undo || (() => setChatSettlement(session, !settled)) }
    }
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
