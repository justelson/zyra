import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { MemoryRouter } from 'react-router-dom'
import { AssistantChatSessionsRail } from '../../src/renderer/src/pages/assistant/AssistantChatSessionsRail'
import { AssistantConversationHeader } from '../../src/renderer/src/pages/assistant/AssistantConversationHeader'
import { createChatActionMenuItems } from '../../src/renderer/src/pages/assistant/assistant-chat-actions-menu'
import { resolveChatMenuSettlement, setChatSettlement, toggleChatPinned } from '../../src/renderer/src/pages/assistant/assistant-chat-menu-state'
import { usePinnedSessionIds } from '../../src/renderer/src/pages/assistant/assistant-pinned-sessions'
import { useAssistantSettlementOverrides } from '../../src/renderer/src/pages/assistant/assistant-settlement-store'
import type { AssistantSession, AssistantThread } from '../../src/shared/assistant/contracts'

const root = createRoot(document.getElementById('root')!)
const now = new Date().toISOString()
const sleep = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms))
function check(value: unknown, message: string) { if (!value) throw Error(message) }
function session(id: string): AssistantSession {
    const thread = { id: `${id}-thread`, providerThreadId: `${id}-canonical`, source: 'root', state: 'ready',
        model: 'openai-codex/gpt-6.1-sol', messages: [{ id: `${id}-answer`, role: 'assistant', text: 'Saved answer', createdAt: now, updatedAt: now }], messageCount: 1, activities: [], pendingApprovals: [], pendingUserInputs: [],
        createdAt: now, updatedAt: now, canonicalPresence: { state: 'ready', clients: [] } } as unknown as AssistantThread
    return { id, title: `${id} chat`, createdAt: now, updatedAt: now, projectPath: null,
        threads: [thread], activeThreadId: thread.id, threadIds: [thread.id], archived: false } as AssistantSession
}
const sessions = [session('selected'), session('other')]
const calls: string[] = []
;(window as any).devscope = { copyToClipboard: async (value: string) => { calls.push(`copy:${value}`); return { success: true } } }
function Header() {
    const target = sessions[0]
    const pins = usePinnedSessionIds()
    const [overrides] = useAssistantSettlementOverrides()
    const state = resolveChatMenuSettlement(target, overrides, pins.has(target.id), target.activeThreadId!)
    return <div className="h-9" data-menu-header><AssistantConversationHeader
        rightPanelOpen={false} rightPanelMode="none" selectedSessionTitle={target.title} canonicalThreadId="selected-canonical"
        activeThreadIsSubagent={false} activeThreadLabel={null} latestProjectLabel="Chat" selectedProjectTooltip="" selectedProjectPath={null}
        projectDirectoryLocked={false} pinned={pins.has(target.id)} settled={state.settled} settlementDisabled={state.priority}
        onTogglePinned={() => { toggleChatPinned(target.id) }} onToggleSettlement={() => setChatSettlement(target, !state.settled)}
        onRegenerateTitle={() => { calls.push(`regenerate:${target.id}`) }}
        onCreateThread={() => { calls.push(`thread:${target.id}`) }} onRenameChat={() => { calls.push(`rename:${target.id}`) }}
        onCreateProjectChat={() => {}} onChooseProject={() => { calls.push(`project:${target.id}`) }}
        onArchiveChat={() => { calls.push(`archive:${target.id}`) }} onDeleteChat={() => { calls.push(`delete:${target.id}`) }} onToggleRightSidebar={() => {}} />
    </div>
}
flushSync(() => root.render(<MemoryRouter><Header /><div className="flex h-[620px]">
    <AssistantChatSessionsRail collapsed={false} width={322} previewPinned={false} agentInboxEnabled
        projectIconOverrides={{}} projects={[]} sessions={sessions} activeSessionId="selected" activeThreadId="selected-thread"
        commandPending={false} pendingControlThreadIds={new Set()} onCreateChat={() => {}} onCreateProjectChat={() => {}}
        onSelectSession={() => {}} onSelectThread={() => {}} onRenameSession={() => {}}
        onCreateThread={id => { calls.push(`thread:${id}`) }} onChooseSessionProject={target => { calls.push(`project:${target.id}`) }}
        onArchiveSession={id => { calls.push(`archive:${id}`) }} onDeleteSession={async () => ({ success: true })}
        onPreviewPinnedChange={() => {}} onShowToast={() => {}} />
</div></MemoryRouter>))
function button(label: string) {
    return Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')).find(item => (item.getAttribute('aria-label') || item.textContent?.trim()) === label)!
}
async function move(x: number, y: number) {
    const request = { x, y, type: 'mouseMove', done: false }
    ;(window as any).sidebarPointerRequest = request
    for (let count = 0; !request.done && count < 100; count++) await sleep(10)
    check(request.done, 'Electron delivered pointer movement'); await sleep()
}
async function hover(label: string) {
    check(button(label), `Hover target ${label} exists; menu: ${Array.from(document.querySelectorAll('[role="menu"]')).map(menu => menu.textContent).join(' | ')}`)
    const rect = button(label).getBoundingClientRect()
    await move(rect.left + 40, rect.top + rect.height / 2)
}
async function sidebar(id = 'other') {
    const row = document.querySelector<HTMLElement>(`[data-agent-inbox-layout-id="${id}"] [role="button"]`)!
    check(row, `Sidebar target ${id} exists; rows: ${Array.from(document.querySelectorAll('[data-agent-inbox-layout-id]')).map(item => item.getAttribute('data-agent-inbox-layout-id')).join(',')}`)
    const rect = row.getBoundingClientRect()
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: rect.left + 45, clientY: rect.top + rect.height / 2 }))
    await sleep(100)
}
async function header() {
    document.querySelector<HTMLButtonElement>('[data-menu-header] [aria-label="Chat actions"]')!.click(); await sleep(100)
}
;(window as any).chatMenuReview = async (surface: string) => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await sleep(100)
    if (surface === 'header') await header()
    else { await sidebar(); await hover('Thread') }
    await sleep(250)
}
async function run() {
    const noop = () => {}
    const options = { canonicalThreadId: 'test', projectPath: null, projectLocked: false, onCopyThreadId: noop, onRename: noop, onArchive: noop, onDelete: noop }
    const flatten = (items: ReturnType<typeof createChatActionMenuItems>) => items.flatMap(item => [
        ...(item.submenuOnly ? item.choices!.map(choice => choice.id) : [item.id]), ...(item.secondaryAction ? [item.secondaryAction.id] : [])
    ]).sort().join(',')
    check(flatten(createChatActionMenuItems(options)) === flatten(createChatActionMenuItems(options, true)), 'Header/sidebar share the complete action union')
    await sleep(150)
    await header()
    for (const label of ['Settle chat', 'Pin chat', 'Rename chat', 'Regenerate chat title', 'New thread', 'Copy thread ID', 'Attach project', 'Archive chat', 'Delete chat']) check(button(label), `Header contains ${label}`)
    button('Pin chat').click(); await sleep(100)
    await sidebar('selected'); check(button('Unpin chat') && button('Unpin chat to settle').disabled, 'Header pin reaches sidebar and prevents settlement')
    button('Unpin chat').click(); await sleep(100)
    await header(); check(button('Pin chat'), 'Sidebar unpin reaches header'); button('Settle chat').click(); await sleep(100)
    await sidebar('selected'); check(button('Un-settle chat'), 'Header settlement reaches sidebar'); button('Un-settle chat').click(); await sleep(100)
    await header(); check(button('Settle chat'), 'Sidebar unsettle reaches header'); button('Regenerate chat title').click(); await sleep()
    check(calls.includes('regenerate:selected'), 'Header regeneration callback is wired')
    await sidebar(); check(!button('New thread') && !button('Attach project'), 'Sidebar keeps secondary actions in submenus')
    const rowHeight = button('Thread').getBoundingClientRect().height
    check(rowHeight >= 30 && rowHeight <= 34, `Sidebar rows stay compact (${rowHeight}px during menu animation)`)
    await hover('Thread'); check(button('New thread') && button('Copy thread ID'), 'Thread submenu opens on hover')
    const rect = button('Copy thread ID').getBoundingClientRect(); await move(rect.left + 40, rect.top + rect.height / 2); await sleep(200)
    check(button('Copy thread ID'), 'Pointer can cross the submenu gap'); button('Copy thread ID').click(); await sleep()
    check(calls.includes('copy:other-canonical'), 'Copy targets the clicked, unselected chat canonical thread')
    await sidebar(); await hover('Thread'); button('New thread').click(); await sleep(); check(calls.includes('thread:other'), 'New thread targets clicked chat')
    await sidebar(); await hover('Project'); button('Attach project').click(); await sleep(); check(calls.includes('project:other'), 'Project picker targets clicked chat')
    await sidebar(); button('Thread').focus(); button('Thread').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); await sleep()
    check(document.activeElement === button('New thread'), 'Keyboard enters submenu')
    button('New thread').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); await sleep()
    check(document.activeElement === button('Thread') && !button('New thread'), 'Keyboard returns to submenu parent')
    button('Thread').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(); check(!document.querySelector('[role="menu"]'), 'Escape dismisses context menu')
    await sidebar(); button('Delete chat').click(); await sleep(); check(document.body.textContent?.includes('Delete chat?'), 'Sidebar preserves delete confirmation')
    Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === 'Cancel')!.click(); await sleep()
    return ['shared complete chat actions; compact hover submenus and gap crossing; keyboard enter/return/Escape; unselected chat targeting; header/sidebar pin and settlement synchronization; delete confirmation retained']
}
;(window as any).sidebarEdgeCheck = run()
