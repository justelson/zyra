import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { AssistantAgentInboxSidebar } from '../../src/renderer/src/pages/assistant/AssistantAgentInboxSidebar'
import type { AssistantSession, AssistantThread } from '../../src/shared/assistant/contracts'
import { toAssistantShellSnapshot } from '../../src/main/assistant/persistence-snapshot'
import { materializeAssistantShellSnapshot } from '../../src/renderer/src/lib/assistant/assistant-history-state'
import { applyAssistantDomainEvents, createDefaultAssistantSnapshot } from '../../src/shared/assistant/projector'
import { areAssistantSessionsRailSelectionsEqual } from '../../src/renderer/src/lib/assistant/assistant-store-selection-helpers'

const root = createRoot(document.getElementById('root')!)
const now = new Date().toISOString()
const messageAt = new Date(Date.parse(now) + 1000).toISOString()
const hydratedThread = {
    id: 'settled-thread', source: 'root', model: 'openai/gpt-test',
    messages: [{ id: 'answer', role: 'assistant', text: 'Saved answer', createdAt: messageAt, updatedAt: messageAt }],
    activities: [], pendingApprovals: [], pendingUserInputs: [], state: 'ready', messageCount: 1,
    createdAt: now, updatedAt: now,
    latestTurn: { id: 'turn', state: 'completed', requestedAt: now, startedAt: now, completedAt: now },
    lastSeenCompletedTurnId: 'turn'
} as unknown as AssistantThread
const hydrated = { id: 'settled', title: 'Settled chat', createdAt: now, updatedAt: now, projectPath: null,
    threads: [hydratedThread], activeThreadId: hydratedThread.id, threadIds: [hydratedThread.id], archived: false } as AssistantSession
let sessions = [hydrated]
;(window as any).devscope = { assistant: { settleSession: async (id: string, settled: boolean) => {
    for (const session of [hydrated, ...sessions]) if (session.id === id) Object.assign(session, { settled, settlementManual: true })
    return { success: true }
} } }
;(window as any).settlementRefresh = async () => render()
let selected: string | null = 'settled'
function render(mounted = true) {
    flushSync(() => root.render(mounted ? <div className="flex h-full w-[300px] flex-col p-2">
        <AssistantAgentInboxSidebar sessions={sessions} activeSessionId={selected} activeThreadId={selected ? 'settled-thread' : null}
            commandPending={false} pendingControlThreadIds={new Set()} projectIconOverrides={{}} headerActions={null}
            onSelectSession={() => undefined} onCreateProjectChat={() => undefined} onRename={() => undefined}
            getSessionMenuItems={() => []} onOpenContextMenu={() => undefined} />
    </div> : null))
}
const sleep = () => new Promise(resolve => setTimeout(resolve, 300))
function check(value: unknown, label: string) { if (!value) throw new Error(label) }
function row() { return document.querySelector<HTMLElement>('[data-agent-inbox-layout-id="settled"]') }
function isSettled() { return Boolean(row()?.querySelector('[aria-label="Un-settle chat"]')) }
async function expandSettled() {
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-expanded="false"]')).find(button => button.textContent?.startsWith('Settled'))
    if (button) { button.click(); await sleep() }
}
function renderedIds() { return Array.from(document.querySelectorAll<HTMLElement>('[data-agent-inbox-layout-id]')).map(element => element.dataset.agentInboxLayoutId) }

async function run() {
    localStorage.clear()
    render(); await sleep()
    // Match the production selector: a canonical update replaces records rather
    // than mutating props, and selection stays on the same open chat.
    const before = { sessions, activeSessionId: selected, activeThreadId: 'settled-thread', connected: true,
        commandPending: false, playground: { rootPath: null, labs: [] } }
    const after = { ...before, sessions: sessions.map(session => ({ ...session, settled: true, settlementManual: true })) }
    check(!areAssistantSessionsRailSelectionsEqual(before as any, after as any), 'Settlement-only update must notify the sidebar selector')
    const scroller = document.querySelector<HTMLElement>('.assistant-sidebar-scrollbar')!
    scroller.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }))
    row()!.querySelector<HTMLElement>('[role="button"]')!.focus()
    sessions = after.sessions; render(); await sleep()
    check(isSettled() && selected === 'settled', 'Canonical settlement moves the focused selected chat immediately while hovered')
    sessions = sessions.map(session => ({ ...session, settled: false })); render(); await sleep()
    check(!isSettled(), 'Canonical un-settle immediately restores the open hovered chat to Recent')
    scroller.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse', relatedTarget: document.body }))
    row()!.querySelector<HTMLElement>('[role="button"]')!.blur()
    row()!.querySelector<HTMLButtonElement>('[aria-label="Settle chat"]')!.click(); await sleep()
    check(isSettled(), 'Explicit settlement moves the chat to Settled')
    const settledHeader = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.startsWith('Settled'))!
    check(settledHeader.getAttribute('aria-expanded') === 'false', 'Settled defaults collapsed; the active settled chat remains accessible')
    await expandSettled()
    const shell = materializeAssistantShellSnapshot(toAssistantShellSnapshot({ ...createDefaultAssistantSnapshot(), sessions: [hydrated] })).sessions[0]
    selected = null; sessions = [shell]; render(); await sleep()
    check(isSettled(), 'Settled chat stays settled when navigation replaces hydrated history with a shell')
    selected = 'settled'; sessions = [hydrated]; render(); await sleep()
    check(isSettled(), 'Opening history keeps the settled chat in Settled')
    // Selection, model changes and canonical settings writes are metadata,
    // rather than new conversational activity.
    const refreshed = structuredClone(shell)
    refreshed.updatedAt = messageAt
    Object.assign(refreshed.threads[0], { updatedAt: messageAt, model: 'openai/another-model', canonicalHistoryModifiedAt: messageAt })
    selected = null; sessions = [refreshed]; render(); await sleep()
    check(isSettled(), 'Metadata refresh does not revive the chat')
    render(false); render(); await sleep()
    check(!row(), 'Collapsed Settled hides inactive chats after remount')
    await expandSettled()
    check(isSettled(), 'Persisted settlement survives sidebar remount')
    sessions = applyAssistantDomainEvents({ ...createDefaultAssistantSnapshot(), sessions }, [{
        eventId: 'new-turn', sequence: 1, occurredAt: messageAt, type: 'thread.latest-turn.updated',
        sessionId: 'settled', threadId: 'settled-thread', payload: { threadId: 'settled-thread',
            latestTurn: { ...hydratedThread.latestTurn, id: 'next-turn', state: 'running', completedAt: null } }
    } as any]).sessions
    render(); await sleep()
    check(!isSettled() && Boolean(row()?.textContent?.includes('Working')), 'A new projected turn revives the chat as Working')

    render(false)
    delete shell.settled; delete shell.settlementManual; delete hydrated.settled; delete hydrated.settlementManual
    localStorage.setItem('assistant:agent-inbox-settled-overrides:v1', JSON.stringify({ settled: { state: 'settled', activityAt: messageAt } }))
    sessions = [shell]; render(); await sleep()
    await expandSettled()
    check(isSettled(), 'Legacy timestamp-only settlement is retained on first catalog load')
    sessions = [hydrated]; selected = 'settled'; render(); await sleep()
    check(isSettled(), 'Legacy settlement survives history loading')
    check(Boolean(JSON.parse(localStorage.getItem('assistant:agent-inbox-settled-overrides:v1')!).settled.activityKey), 'Legacy settlement is upgraded to catalog metadata')
    sessions = [{ ...hydrated, threads: [{ ...hydratedThread, messageCount: 2 }] }]; render(); await sleep()
    check(!isSettled(), 'A new message revives a chat with migrated settlement')
    row()!.querySelector<HTMLButtonElement>('[aria-label="Settle chat"]')!.click(); await sleep()
    check(isSettled(), 'Revived chat can be settled again')
    row()!.querySelector<HTMLButtonElement>('[aria-label="Un-settle chat"]')!.click(); await sleep()
    check(!isSettled(), 'Explicit un-settle returns the chat to Chats')
    render(false); render(); await sleep()
    check(!isSettled(), 'Explicit un-settle survives remount')

    // The restored chat is deliberately older than every active chat. Its place
    // must be an explicit restore decision, not an incidental timestamp sort.
    render(false)
    const older = { ...hydrated, createdAt: new Date(Date.parse(now) - 86_400_000).toISOString(), settled: true, settlementManual: true }
    const peers = Array.from({ length: 24 }, (_, index) => {
        const id = `peer-${String(index).padStart(2, '0')}`
        const thread = { ...hydratedThread, id: `${id}-thread`, messages: [...hydratedThread.messages] }
        return { ...hydrated, id, title: id, createdAt: new Date(Date.parse(now) + index * 1000).toISOString(), settled: false, settlementManual: true,
            threads: [thread], threadIds: [thread.id], activeThreadId: thread.id }
    })
    selected = 'settled'; sessions = [older, ...peers]; render(); await sleep()
    check(isSettled() && renderedIds()[0] !== 'settled', 'Old settled chat starts below newer active chats')
    const scroll = document.querySelector<HTMLElement>('.assistant-sidebar-scrollbar')!
    scroll.scrollTop = 180
    scroll.dispatchEvent(new Event('scroll', { bubbles: true }))
    await sleep()
    const beforeRestoreScroll = scroll.scrollTop
    check(beforeRestoreScroll === 180, 'Restore fixture has a real nonzero scroll position')
    row()!.querySelector<HTMLButtonElement>('[aria-label="Un-settle chat"]')!.click(); await sleep()
    check(!isSettled() && renderedIds()[0] === 'settled', 'Explicitly restoring an old chat places it above all newer chats')
    check(scroll.scrollTop === beforeRestoreScroll, 'Restoring to the top preserves the sidebar scroll position')
    sessions = structuredClone(sessions); render(); await sleep()
    check(renderedIds()[0] === 'settled' && scroll.scrollTop === beforeRestoreScroll, 'Snapshot refresh preserves restored order and scroll')
    render(false); render(); await sleep()
    check(renderedIds()[0] === 'settled' && !isSettled(), 'Restored top position survives saved-order reload on remount')
    return ['collapsed Settled retains active-row access; settlement survives shell/history navigation, metadata refresh and remount; legacy choices upgrade; projected work revives chats; explicit restore puts old chats first, preserves scroll and survives order reload']
}
;(window as any).sidebarContinuityCheck = run()
