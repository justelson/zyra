import { createRef, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { assistantStore } from '../../src/renderer/src/lib/assistant/assistant-store-core'
import { createDefaultAssistantSnapshot } from '../../src/shared/assistant/projector'
import type { AssistantDomainEvent, AssistantSession, AssistantThread } from '../../src/shared/assistant/contracts'
import { AssistantAgentInboxSidebar } from '../../src/renderer/src/pages/assistant/AssistantAgentInboxSidebar'
import { AssistantConversationComposerPane } from '../../src/renderer/src/pages/assistant/AssistantConversationComposerPane'
import { AssistantTransientToast, useAssistantTransientToast, type AssistantToastInput } from '../../src/renderer/src/pages/assistant/AssistantToast'
import { createChatSettlementToast, setChatSettlement } from '../../src/renderer/src/pages/assistant/assistant-chat-menu-state'

document.documentElement.style.setProperty('--surface-floating', '#111820')
document.documentElement.style.setProperty('--status-danger', '#f57777')
const now = new Date().toISOString()
const thread = { id: 'toast-thread', source: 'root', providerThreadId: 'canonical:toast', model: 'fixture/model',
    messages: [{ id: 'answer', role: 'assistant', text: 'Keep this answer.', createdAt: now, updatedAt: now }],
    activities: [], proposedPlans: [], pendingApprovals: [], pendingUserInputs: [], messageCount: 1,
    state: 'ready', createdAt: now, updatedAt: now,
    latestTurn: { id: 'done', state: 'completed', requestedAt: now, completedAt: now }, lastSeenCompletedTurnId: 'done'
} as unknown as AssistantThread
const session = { id: 'toast-chat', title: 'Toast chat', createdAt: now, updatedAt: now, mode: 'work',
    threads: [thread], activeThreadId: thread.id, threadIds: [thread.id], projectPath: null,
    archived: false, settled: false, settlementManual: true
} as AssistantSession
let listener: ((input: { event: AssistantDomainEvent }) => void) | null = null
let sequence = 0, reloads = 0, mutations = 0
;(window as any).devscope = { assistant: {
    onEvent: (callback: typeof listener) => { listener = callback; return () => { listener = null } },
    bootstrap: async () => { reloads++; return { snapshot: assistantStore.getState().snapshot, status: assistantStore.getState().status } },
    hydrateSession: async () => { reloads++; return { success: false, error: 'Unexpected history reload' } },
    getVoiceTranscriptionState: async () => ({ success: true, provider: 'codex', available: false, signedIn: false, status: 'unavailable' }),
    settleSession: async (id: string, settled: boolean) => {
        mutations++
        listener?.({ event: { eventId: `toast-${++sequence}`, sequence, type: 'session.updated', occurredAt: now,
            sessionId: id, threadId: thread.id, payload: { sessionId: id, patch: { settled, settlementManual: true } } } })
        ;(assistantStore as any).flushPendingAssistantEvents()
        return { success: true }
    }
} }
;(assistantStore as any).state = { ...assistantStore.getState(), snapshot: { ...createDefaultAssistantSnapshot(), sessions: [session], selectedSessionId: session.id }, hydrated: true }
;(assistantStore as any).ensureEventStream()
const paneRef = createRef<HTMLDivElement>()
let show: (input: AssistantToastInput) => void
function App() {
    const state = useSyncExternalStore(assistantStore.subscribe, assistantStore.getState)
    const { toast, showToast, dismissToast } = useAssistantTransientToast()
    show = showToast
    const current = state.snapshot.sessions[0]!
    return <MemoryRouter><div className="flex h-full min-h-0">
        <aside style={{ width: 260, display: innerWidth < 600 ? 'none' : 'flex' }} className="min-h-0 shrink-0 flex-col p-2" data-test-sidebar>
            <AssistantAgentInboxSidebar sessions={state.snapshot.sessions} activeSessionId={session.id} activeThreadId={thread.id}
                commandPending={false} pendingControlThreadIds={new Set()} projectIconOverrides={{}} headerActions={null}
                onSelectSession={() => undefined} onCreateProjectChat={() => undefined} onRename={() => undefined}
                getSessionMenuItems={() => []} onOpenContextMenu={() => undefined} onShowToast={showToast} />
        </aside>
        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col" data-test-conversation>
            <button type="button" data-header-settle className="h-8 shrink-0" onClick={() => void setChatSettlement(current, !current.settled).then(() => showToast(createChatSettlementToast(current, !current.settled)))}>Toggle settlement</button>
            <div data-test-timeline className="min-h-0 flex-1 overflow-auto"><div style={{ height: 1200 }}>Keep this answer and scroll position.</div></div>
            <AssistantConversationComposerPane {...{
                paneRef, placement: 'bottom', selectedSessionId: session.id, selectedSessionMode: 'work',
                assistantAvailable: true, assistantConnected: true, selectedProjectPath: null,
                availableModels: [{ id: 'fixture/model', label: 'Model', inputModes: ['text'], supportedEfforts: ['off', 'medium'] }],
                activeModel: 'fixture/model', modelsLoading: false, runtimeMode: 'full-access', interactionMode: 'default', activeProfile: 'yolo-fast', activeStatusLabel: 'Ready',
                pendingUserInputs: [], pendingApprovals: [], pendingControlActions: [], pendingControlGrants: [], controlTargets: [], pendingPlaygroundLabRequest: null,
                thinking: false, sending: false, userInputResponding: false, queuedMessages: [], queuedMessageCount: 0, commandPending: false,
                refreshModels: () => {}, sendPrompt: async () => true, respondUserInput: async () => {}, onStop: () => {}
            } as any} />
        </main>
        <AssistantTransientToast toast={toast} onDismiss={dismissToast} />
    </div></MemoryRouter>
}
createRoot(document.getElementById('root')!).render(<App />)
const sleep = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms))
const check = (value: unknown, message: string) => { if (!value) throw Error(message) }
const wait = async (ready: () => unknown, message: string) => {
    for (let i = 0; i < 100; i++) { if (ready()) return; await sleep(25) }
    throw Error(message)
}
const pointer = async (x: number, y: number, click = false) => {
    const request = { x, y, click, done: false }
    ;(window as any).sidebarPointerRequest = request
    await wait(() => request.done, 'Hidden Electron delivered the pointer event')
}
const toast = () => document.querySelector<HTMLElement>('[data-assistant-toast][aria-hidden="false"]')
const undo = () => [...document.querySelectorAll<HTMLButtonElement>('[data-assistant-toast] button')].find(button => button.textContent === 'Undo')!
const dismiss = async () => { document.querySelector<HTMLButtonElement>('[aria-label="Dismiss notification"]')?.click(); await sleep(340) }

async function run() {
    await wait(() => document.querySelector('[data-composer-text-input]'), 'Actual composer mounts')
    const composer = document.querySelector<HTMLElement>('[data-composer-text-input]')!
    composer.focus(); composer.textContent = 'Keep this draft'
    composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'Keep this draft' }))
    const timeline = document.querySelector<HTMLElement>('[data-test-timeline]')!
    timeline.scrollTop = 280
    const scroll = timeline.scrollTop
    const top = paneRef.current!.getBoundingClientRect().top
    const settle = innerWidth < 600 ? document.querySelector<HTMLButtonElement>('[data-header-settle]')! : document.querySelector<HTMLButtonElement>('[aria-label="Settle chat"]')!
    settle.click()
    await wait(() => toast()?.textContent?.includes('Chat settled'), 'Settlement produces a toast')
    check(assistantStore.getState().snapshot.sessions[0]!.settled, 'Canonical event updates the settled state')
    check(reloads === 0 && !assistantStore.getState().hydrating, 'No bootstrap, history refresh or loading transition')
    check(document.querySelector('[data-composer-text-input]') === composer && composer.textContent === 'Keep this draft', 'Settlement retains the exact composer and its draft')
    check(document.activeElement === composer, 'Toast arrival never takes focus from drafting')
    check(timeline.scrollTop === scroll && paneRef.current!.getBoundingClientRect().top === top, 'Settlement toast does not move the timeline or composer')
    check(!document.querySelector('.assistant-sidebar-scrollbar [data-assistant-toast]') && !document.body.textContent!.includes('Send a message to unsettle this thread'), 'No sticky sidebar Undo or composer settlement banner remains')
    await wait(() => toast() && getComputedStyle(toast()!).opacity === '1', 'Toast finishes its entrance before hit testing')
    const bounds = toast()!.getBoundingClientRect()
    check(getComputedStyle(toast()!).position === 'fixed' && bounds.left >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight, 'Toast floats within the viewport')
    check(getComputedStyle(toast()!).backgroundColor !== 'rgba(0, 0, 0, 0)', 'Toast has an opaque themed background')
    const action = undo(), hit = action.getBoundingClientRect()
    check(action.contains(document.elementFromPoint(hit.left + hit.width / 2, hit.top + hit.height / 2)), 'Floating Undo stays above the composer and can actually be clicked')
    await pointer(hit.left + hit.width / 2, hit.top + hit.height / 2, true)
    await wait(() => !assistantStore.getState().snapshot.sessions[0]!.settled, 'Undo restores settlement through the canonical API')
    check(mutations === 2 && reloads === 0, 'Settle and Undo each mutate once without a reload')
    await sleep(340)
    check(!toast(), 'Successful Undo dismisses its toast')
    await pointer(5, 5)
    // Replacing a toast must not inherit the previous notification's expiry.
    show({ message: 'Older notice', durationMs: 90 }); await sleep(50)
    show({ message: 'Newer notice', durationMs: 200 }); await sleep(80)
    check(toast()?.textContent?.includes('Newer notice'), 'Old expiry cannot dismiss a newer notification')
    const notice = toast()!
    notice.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await sleep(250)
    check(toast(), 'Hover pauses toast expiry')
    notice.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })); await sleep(540)
    check(!toast(), 'Idle expiry resumes after pointer exit')
    show({ message: 'Focusable action', durationMs: 100, action: { label: 'Undo', run: () => {} } }); await wait(() => toast(), 'Action toast appears')
    undo().focus(); undo().dispatchEvent(new FocusEvent('focusin', { bubbles: true })); await sleep(180)
    check(toast(), 'Keyboard focus pauses action expiry')
    show({ message: 'Replaced while focused', durationMs: 100, action: { label: 'Undo', run: () => {} } }); await sleep(180)
    check(toast()?.textContent?.includes('Replaced while focused'), 'Replacing a focused toast retains the focus pause'); await dismiss()
    show({ message: 'Undo can fail', action: { label: 'Undo', run: () => { throw Error('Synthetic Undo failure') } } }); await wait(() => toast(), 'Failure test toast appears')
    undo().click(); await wait(() => document.querySelector('[data-assistant-toast][role="alert"]')?.textContent?.includes('Synthetic Undo failure'), 'Failed Undo remains visible as an error')
    await dismiss()
    let finish: (() => void) | null = null, actionCalls = 0
    show({ message: 'Pending Undo', durationMs: 60, action: { label: 'Undo', run: () => { actionCalls++; return new Promise<void>(resolve => { finish = resolve }) } } })
    await wait(() => toast(), 'Pending test toast appears')
    undo().click(); undo().click(); await sleep(100)
    check(actionCalls === 1 && toast(), 'Pending Undo is single-flight and does not expire')
    show({ message: 'Keep the newer notification', durationMs: 500 }); await sleep()
    finish!(); await sleep()
    check(toast()?.textContent?.includes('Keep the newer notification'), 'An older action completion cannot dismiss a replacement toast')
    await dismiss()
    // Leave the real settled/Undo presentation available for an optional screenshot.
    document.querySelector<HTMLButtonElement>('[data-header-settle]')!.click()
    await wait(() => toast()?.textContent?.includes('Chat settled') && getComputedStyle(toast()!).opacity === '1', 'Final settlement toast is fully painted')
    return ['real canonical settlement preserves composer identity, draft, focus and scroll; floating Undo restores without reloading', 'toast replacement, expiry, hover/focus pause, single-flight actions, action errors and stale completions']
}
;(window as any).sidebarContinuityCheck = run()
