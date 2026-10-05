import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { MemoryRouter } from 'react-router-dom'
import { AssistantChatSessionsRail } from '../../src/renderer/src/pages/assistant/AssistantChatSessionsRail'
import type { AssistantSession, AssistantThread } from '../../src/shared/assistant/contracts'

const root = createRoot(document.getElementById('root')!)
const pinKey = 'assistant:pinned-session-ids:v1'
const settleKey = 'assistant:agent-inbox-settled-overrides:v1'
const now = new Date().toISOString()
const old = new Date(Date.now() - 7 * 86400000).toISOString()
const sleep = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms))
function check(value: unknown, message: string) { if (!value) throw Error(message) }
function session(id: string, working = false, timestamp = now): AssistantSession {
    const thread = { id: `${id}-thread`, source: 'root', model: 'openai-codex/gpt-6.1-sol',
        messages: [{ id: `${id}-answer`, role: 'assistant', text: 'Saved answer', createdAt: timestamp, updatedAt: timestamp }],
        activities: [], pendingApprovals: [], pendingUserInputs: [], state: 'ready', messageCount: 1, activityCount: 0,
        createdAt: timestamp, updatedAt: timestamp, canonicalPresence: { state: working ? 'running' : 'ready', clients: [] },
        latestTurn: { id: `${id}-turn`, state: working ? 'running' : 'completed', requestedAt: timestamp, startedAt: timestamp, completedAt: working ? null : timestamp },
        lastSeenCompletedTurnId: working ? null : `${id}-turn`
    } as unknown as AssistantThread
    return { id, title: `${id} chat`, createdAt: timestamp, updatedAt: timestamp, projectPath: null,
        threads: [thread], activeThreadId: thread.id, threadIds: [thread.id], archived: false } as AssistantSession
}
let sessions = [session('idle'), session('running', true), session('old', false, old), session('manual'), session('unread')]
sessions[4].threads[0].lastSeenCompletedTurnId = null
const privateWorker = session('private-review', true)
privateWorker.threads[0].source = 'subagent'
privateWorker.threads[0].providerParentThreadId = 'parent-canonical'
sessions.push(privateWorker)
const independent = session('independent', true)
independent.threads[0].agentNickname = 'Independent workstream'
sessions.push(independent)
let selected = 'idle'
let collapsed = false
let mount = 0
function render() {
    flushSync(() => root.render(<MemoryRouter><div className="flex h-full pt-[34px]">
        <AssistantChatSessionsRail key={mount} collapsed={collapsed} width={322} previewPinned={collapsed} agentInboxEnabled
            projectIconOverrides={{}} projects={[]} sessions={sessions} activeSessionId={selected} activeThreadId={`${selected}-thread`}
            commandPending={false} pendingControlThreadIds={new Set()} onCreateChat={() => {}} onCreateProjectChat={() => {}}
            onSelectSession={id => { selected = id; render() }} onSelectThread={() => {}} onRenameSession={() => {}}
            onArchiveSession={() => {}} onDeleteSession={async () => ({ success: true })} onPreviewPinnedChange={() => {}} onShowToast={() => {}} />
        <main className="h-full flex-1" data-chat-area />
    </div></MemoryRouter>))
}
function row(id: string) { return document.querySelector<HTMLElement>(`[data-agent-inbox-layout-id="${id}"]`)! }
function section(id: string) {
    let sibling = row(id)?.previousElementSibling
    while (sibling?.hasAttribute('data-agent-inbox-layout-id')) sibling = sibling.previousElementSibling
    return sibling?.textContent?.trim()
}
function card(id: string) {
    check(row(id)?.getBoundingClientRect().height > 60, `${id}: pinned thread must use the large card`)
    check(section(id) === 'Priority', `${id}: large card belongs in Priority`)
    check(document.querySelectorAll(`[data-agent-inbox-layout-id="${id}"]`).length === 1, `${id}: rendered once`)
}
async function move(x: number, y: number) {
    const request = { x, y, type: 'mouseMove', done: false }
    ;(window as any).sidebarPointerRequest = request
    for (let count = 0; !request.done && count < 100; count++) await sleep(10)
    check(request.done, 'Hidden Electron delivered the pointer movement')
    await sleep()
}
async function menu(id: string) {
    const target = row(id).querySelector<HTMLElement>('[role="button"]')!
    const rect = target.getBoundingClientRect()
    await move(rect.left + 45, rect.top + rect.height / 2)
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: rect.left + 45, clientY: rect.top + rect.height / 2 }))
    await sleep()
}
function menuButton(label: string) {
    return Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')).find(button => button.textContent?.trim() === label)!
}
async function action(id: string, label: string) {
    await menu(id)
    const button = menuButton(label)
    check(button && !button.disabled, `${label}: actual chat menu is available`)
    button.click(); await sleep(100)
}
async function run() {
    localStorage.removeItem(pinKey)
    localStorage.setItem(settleKey, JSON.stringify({ manual: { state: 'settled', activityAt: now } }))
    render(); await sleep(150)
    check(!row('private-review'), 'Supporting subagents never become top-level sidebar cards')
    check(section('independent') === 'Priority', 'An explicitly independent working conversation stays visible')
    check(row('running').querySelector<HTMLButtonElement>('[aria-label="Working chat stays in Priority"]')?.disabled === true, 'Working chats cannot be manually hidden from Priority')
    check(section('idle') === 'Recent' && row('idle').getBoundingClientRect().height > 60, 'Recent uses the same full-size cards as Priority')
    check(row('idle').getBoundingClientRect().height === row('running').getBoundingClientRect().height, 'Recent and Priority share card geometry')
    check(section('old') === 'Settled' && section('manual') === 'Settled', 'Existing automatic and manual settlement respected')
    await action('idle', 'Pin chat')
    check(JSON.parse(localStorage.getItem(pinKey)!).includes('idle'), 'Actual pin action persists chat ID')
    card('idle') // Regression: saved pins previously never reached the card sidebar.
    check(!document.getElementById('root')!.textContent?.includes('Active work'), 'Section is named Priority')
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-agent-inbox-layout-id]'))
    check(rows[0].dataset.agentInboxLayoutId === 'idle', 'Pinned cards precede other Priority cards')
    check(row('idle').querySelector('[aria-label="Pinned chat"]'), 'Pinned card has a small pin indicator')
    await menu('idle')
    check(menuButton('Unpin chat') && menuButton('Unpin chat').disabled === false, 'Unpin remains available')
    check(menuButton('Unpin chat to settle').disabled, 'Settling cannot hide a pinned thread')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await sleep()
    const settle = row('idle').querySelector<HTMLButtonElement>('[aria-label="Unpin chat to settle"]')!
    check(settle.disabled, 'Quick settle also communicates the pin constraint')
    settle.click(); await sleep(); card('idle')
    await action('running', 'Pin chat'); card('running')
    await move(550, 650)
    let thread = sessions[1].threads[0]
    thread.canonicalPresence = { state: 'ready', clients: [] } as any
    thread.latestTurn = { ...thread.latestTurn!, state: 'completed', completedAt: now }
    sessions = structuredClone(sessions); render(); await sleep(100)
    card('running'); check(row('running').textContent?.includes('Done'), 'Pinned completion still shows truthful Done status')
    selected = 'running'
    sessions[1].threads[0].lastSeenCompletedTurnId = sessions[1].threads[0].latestTurn!.id
    render(); await sleep(100); card('running')
    selected = 'idle'; render(); await sleep(); card('running')
    thread = sessions[1].threads[0]
    thread.state = 'interrupted'; thread.latestTurn = { ...thread.latestTurn!, id: 'running-stop', state: 'interrupted' }
    sessions = structuredClone(sessions); render(); await sleep(100)
    card('running'); check(row('running').textContent?.includes('Stopped'), 'Pinned stop stays large with Stopped status')
    sessions[1].threads[0].lastSeenCompletedTurnId = 'running-stop'; render(); await sleep(); card('running')
    await action('old', 'Pin chat'); card('old')
    await action('manual', 'Pin chat'); card('manual')
    await move(550, 650)
    collapsed = true; mount++; render(); await sleep(150)
    for (const id of ['idle', 'running', 'old', 'manual']) card(id)
    check(document.querySelector('.zyra-sidebar-floating-surface')?.getAttribute('aria-hidden') === 'false', 'Saved pins render in floating preview after rail remount')
    await action('manual', 'Unpin chat'); check(section('manual') === 'Settled', 'Unpin restores previous manual settlement')
    await action('old', 'Unpin chat'); check(section('old') === 'Settled', 'Unpin restores automatic settlement')
    await action('running', 'Unpin chat'); check(section('running') === 'Recent', 'Read stopped unpinned thread returns to Recent')
    await action('idle', 'Unpin chat'); check(section('idle') === 'Recent', 'Unpin immediately restores Recent while pointer remains inside sidebar')
    await move(550, 650)
    check(section('unread') === 'Recent' && row('unread').getBoundingClientRect().height > 60, 'Unpinned completed work stays readable in Recent without claiming Priority')
    sessions[4].threads[0].lastSeenCompletedTurnId = sessions[4].threads[0].latestTurn!.id
    sessions = structuredClone(sessions); render(); await sleep(100)
    check(section('unread') === 'Recent', 'Reading an unpinned completed turn still returns it to Recent')
    sessions[0].threads[0].canonicalPresence = { state: 'running', clients: [] } as any
    sessions[0].threads[0].latestTurn = { ...sessions[0].threads[0].latestTurn!, id: 'idle-next', state: 'running', completedAt: null }
    sessions = structuredClone(sessions); render(); await sleep(100)
    check(section('idle') === 'Priority', 'Unpinned working threads still use large Priority cards')
    await action('idle', 'Pin chat'); await action('idle', 'Unpin chat'); card('idle')
    check(!JSON.parse(localStorage.getItem(pinKey)!).includes('idle'), 'Unpin removes the persisted ID')
    return ['real chat menu -> saved pin -> Priority large cards; ready, read, completed, stopped, old and manually settled chats; immediate pin/unpin under hover hold; persisted rail remount and floating preview; unpinned grouping preserved']
}
;(window as any).sidebarEdgeCheck = run()
