import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { Bot } from 'lucide-react'
import { AssistantConversationHeader } from '../../src/renderer/src/pages/assistant/AssistantConversationHeader'
import { AssistantAgentInboxSidebar } from '../../src/renderer/src/pages/assistant/AssistantAgentInboxSidebar'
import { RailButton } from '../../src/renderer/src/pages/assistant/AssistantRailButton'
import { AssistantTimelineThreadMessage } from '../../src/renderer/src/pages/assistant/AssistantTimelineThreadMessage'
import { TimelineMessage } from '../../src/renderer/src/pages/assistant/AssistantTimelineRows'
import { TimelineTurnWorkSummary } from '../../src/renderer/src/pages/assistant/AssistantTimelineWorkSummary'
import { buildTimelineRows, getTimelineEntries } from '../../src/renderer/src/pages/assistant/assistant-timeline-helpers'
import { groupTimelineRowsIntoWorkSummaries } from '../../src/renderer/src/pages/assistant/assistant-turn-work'
import { projectThreadMessage } from '../../src/shared/assistant/thread-message'
import { applyAssistantDomainEvents, createDefaultAssistantSnapshot } from '../../src/shared/assistant/projector'
import { assistantStore } from '../../src/renderer/src/lib/assistant/assistant-store-core'
import type { AssistantSession, AssistantThread } from '../../src/shared/assistant/contracts'
import { checkVoiceRecorderInput } from './voice-recorder-input'
import { checkConversationMarkers } from './conversation-markers'

const root = createRoot(document.getElementById('root')!)
const now = new Date().toISOString()
const results: string[] = []
const sleep = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms))
function check(value: unknown, label: string) { if (!value) throw new Error(label) }
async function waitForCheck(condition: () => boolean, label: string) {
    const deadline = performance.now() + 2000
    while (!condition() && performance.now() < deadline) await sleep(30)
    check(condition(), label)
}
async function movePointer(x: number, y: number, click = false) {
    const request = { x, y, click, done: false }
    ;(window as any).sidebarPointerRequest = request
    for (let frame = 0; !request.done && frame < 120; frame++) await sleep(16)
    check(request.done, 'Hidden Electron delivered the pointer event')
}
function header(displayMode: 'minimal' | 'detailed', isAgent = true) {
    const thread = sessions.find(item => item.id === 'child')!.threads[0]
    return <div className="h-10 w-[640px] [--accent-secondary:var(--color-secondary)]" data-header-fixture>
        <AssistantConversationHeader displayMode={displayMode} rightPanelOpen={false} rightPanelMode="none"
            selectedSessionTitle="Hi" canonicalThreadId={thread.id} canonicalPresence={thread.canonicalPresence}
            activeThreadIsSubagent={isAgent} activeThreadLabel="Xara" selectedProjectTooltip="" selectedProjectPath={null}
            latestProjectLabel="" projectDirectoryLocked={false} onCreateThread={() => undefined} onRenameChat={() => undefined}
            onCreateProjectChat={() => undefined} onChooseProject={() => undefined} onArchiveChat={() => undefined}
            onDeleteChat={() => undefined} onToggleRightSidebar={() => undefined} />
    </div>
}
function session(id: string, working = false): AssistantSession {
    const thread = { id: `${id}-thread`, source: 'root', providerThreadId: id,
        agentNickname: id === 'child' ? 'Xara' : null, providerParentThreadId: id === 'child' ? 'parent-canonical' : null,
        model: 'openai/gpt-test', messages: [{ id: `${id}-answer`, role: 'assistant', text: 'Saved answer', createdAt: now, updatedAt: now }],
        activities: [], pendingApprovals: [], pendingUserInputs: [], state: 'ready', messageCount: 1, activityCount: 0,
        createdAt: now, updatedAt: now, canonicalPresence: { state: working ? 'running' : 'ready', clients: id === 'child' ? [
            { clientId: 'tui', surface: 'tui' }, { clientId: 'phone', surface: 'mobile', displayName: 'Test phone' }
        ] : [] },
        latestTurn: { id: `${id}-turn`, state: working ? 'running' : 'completed', requestedAt: now, startedAt: now, completedAt: working ? null : now },
        lastSeenCompletedTurnId: working ? null : `${id}-turn`
    } as unknown as AssistantThread
    return { id, title: `${id} chat with a long readable title`, createdAt: now, updatedAt: now, projectPath: null, threads: [thread], activeThreadId: thread.id, threadIds: [thread.id], archived: false } as AssistantSession
}
let sessions = [session('drawing'), session('child'), session('other', true)]
let selected = 'drawing'
let disabled = false
function render() {
    flushSync(() => root.render(<div id="rail" className="flex h-full w-[300px] flex-col p-2">
        <AssistantAgentInboxSidebar sessions={sessions} activeSessionId={selected} activeThreadId={`${selected}-thread`} commandPending={disabled}
            pendingControlThreadIds={new Set()} projectIconOverrides={{}} onSelectSession={id => { selected = id; render() }}
            onCreateProjectChat={() => undefined} onRename={() => undefined} getSessionMenuItems={() => []} onOpenContextMenu={() => undefined}
            headerActions={<RailButton label="New chat" icon={<Bot size={16} />} disabled={disabled} onClick={() => undefined} />} />
        <div hidden data-agent-reference><Bot size={15} strokeWidth={1.9} /></div>
    </div>))
}
function row(id: string) { return document.querySelector<HTMLElement>(`[data-agent-inbox-layout-id="${id}"]`)! }
function section(id: string) {
    let sibling = row(id)?.previousElementSibling
    while (sibling?.hasAttribute('data-agent-inbox-layout-id')) sibling = sibling.previousElementSibling
    return sibling?.textContent?.trim()
}
function titleReadable(id: string) {
    const element = row(id).querySelector<HTMLElement>('span[aria-label]:not([aria-label="Agent-created chat"])')!
    const inner = element.firstElementChild as HTMLElement
    check(element.getBoundingClientRect().width > 40, `${id}: title has usable width ${JSON.stringify({ title: element.getBoundingClientRect().width, row: row(id).getBoundingClientRect().width, parent: element.parentElement?.getBoundingClientRect().width, html: element.parentElement?.outerHTML.slice(0, 1800) })}`)
    check(Number(getComputedStyle(inner).opacity) >= .8, `${id}: first animation frame never hides title`)
    check(getComputedStyle(row(id)).contentVisibility !== 'auto', `${id}: rows remain painted during switching`)
    check(getComputedStyle(row(id)).clipPath === 'none', `${id}: row animation does not clip labels`)
}

async function checkAgentColors() {
    let previousColor = ''
    for (const color of ['#ab87ff', '#53bdec', '#da68a4']) {
        document.documentElement.style.setProperty('--agent-presence-accent', color)
        render()
        const sidebarRobot = row('child').querySelector<HTMLElement>('[data-agent-presence]')!
        const sidebarColor = getComputedStyle(sidebarRobot).color
        const sidebarBackground = getComputedStyle(sidebarRobot).backgroundColor
        check(sidebarColor !== previousColor, 'Robot responds to each changed theme/accent')
        previousColor = sidebarColor
        for (const mode of ['minimal', 'detailed'] as const) {
            flushSync(() => root.render(header(mode)))
            const headerRobot = document.querySelector<HTMLElement>('[data-header-fixture] [data-agent-presence]')!
            check(getComputedStyle(headerRobot).color === sidebarColor, 'Header and sidebar share the theme agent color despite local accent overrides')
            check(getComputedStyle(headerRobot).backgroundColor === sidebarBackground, 'Header and sidebar share the same badge tint')
            check(sidebarColor !== 'rgb(0, 0, 0)', 'Theme accent resolves to a visible badge color')
        }
    }
    results.push('three theme/accent changes keep sidebar and minimal/detailed header robot colors and tints identical')
}
async function keyboardFocusStyle(id: string, enabled: boolean) {
    const request = { focusSelector: `[data-agent-inbox-layout-id="${id}"] [role="button"]`, enabled, done: false }
    ;(window as any).sidebarPointerRequest = request
    for (let frame = 0; !request.done && frame < 120; frame++) await sleep(16)
    check(request.done, 'Hidden Electron applied the focus-visible test state')
}

async function checkUnreadCompletion() {
    selected = 'drawing'
    sessions = [session('drawing'), session('child', true)]
    render(); await sleep(250)
    const cardHeight = row('child').getBoundingClientRect().height
    check(cardHeight > 60 && section('child') === 'Priority', 'Background working chat starts as a full-size Priority card')
    let sequence = 0
    const project = (type: string, payload: Record<string, unknown>) => {
        sessions = applyAssistantDomainEvents({ ...createDefaultAssistantSnapshot(), sessions, selectedSessionId: selected }, [{
            eventId: `completion-event-${++sequence}`, sequence, occurredAt: now,
            type, sessionId: 'child', threadId: 'child-thread', payload
        } as any]).sessions
    }
    const completedTurn = session('child').threads[0].latestTurn!
    project('thread.latest-turn.updated', { threadId: 'child-thread', latestTurn: completedTurn })
    project('thread.updated', { threadId: 'child-thread', patch: { state: 'ready', canonicalPresence: { state: 'ready', clients: [] } } })
    render(); await sleep(250)
    check(row('child').getBoundingClientRect().height === cardHeight && section('child') === 'Recent', 'Unread completed chat keeps a full-size Recent card, not Priority')
    check(row('child').textContent?.includes('Done'), 'Retained completion card says Done')
    selected = 'child'; render(); await sleep(250)
    project('thread.updated', { threadId: 'child-thread', patch: { lastSeenCompletedTurnId: completedTurn.id } })
    selected = 'drawing'; render(); await sleep(250)
    check(row('child').getBoundingClientRect().height === cardHeight && section('child') === 'Recent', 'Read completion keeps the full-size Recent card')
    project('thread.latest-turn.updated', { threadId: 'child-thread', latestTurn: { ...completedTurn, id: 'child-new-turn' } })
    render(); await sleep(250)
    await waitForCheck(() => row('child').getBoundingClientRect().height === cardHeight && Boolean(row('child').textContent?.includes('Done')), 'A new unread completion remains a readable Done card in Recent')
    const stoppedTurn = { ...completedTurn, id: 'child-stopped-turn', state: 'interrupted' }
    project('thread.latest-turn.updated', { threadId: 'child-thread', latestTurn: stoppedTurn })
    project('thread.updated', { threadId: 'child-thread', patch: { state: 'interrupted' } })
    render(); await sleep(250)
    await waitForCheck(() => row('child').getBoundingClientRect().height === cardHeight && Boolean(row('child').textContent?.includes('Stopped')), 'Unread stopped work retains a large Stopped card, never Failed')
    selected = 'child'; render(); await sleep(250)
    project('thread.updated', { threadId: 'child-thread', patch: { lastSeenCompletedTurnId: stoppedTurn.id } })
    selected = 'drawing'; render(); await sleep(250)
    check(row('child').getBoundingClientRect().height === cardHeight, 'Opening stopped work keeps its full-size Recent card')
    project('thread.latest-turn.updated', { threadId: 'child-thread', latestTurn: { ...stoppedTurn } })
    render(); await sleep(250)
    check(row('child').getBoundingClientRect().height === cardHeight, 'Repeated stop preserves the same full-size Recent card')
    sessions = structuredClone(sessions); render(); await sleep(250)
    check(row('child').getBoundingClientRect().height === cardHeight, 'Rehydrated read state preserves the Recent card')
    project('thread.latest-turn.updated', { threadId: 'child-thread', latestTurn: { ...stoppedTurn, id: 'child-new-stopped-turn' } })
    render(); await sleep(250)
    await waitForCheck(() => row('child').getBoundingClientRect().height === cardHeight, 'Only a newly stopped unread turn restores its current card')
    return ['working Priority -> full-size unread/read Done and Stopped Recent; duplicate events preserve read state and card geometry']
}

async function checkRowHoverActions() {
    render(); await sleep(250)
    for (const id of ['child', 'other']) {
        const target = row(id).querySelector<HTMLElement>('[role="button"]')!
        const settle = row(id).querySelector<HTMLButtonElement>('[aria-label="Settle chat"], [aria-label="Working chat stays in Priority"]')!
        const actions = settle.parentElement!.parentElement!
        const rect = target.getBoundingClientRect()
        await movePointer(rect.left + 45, rect.top + rect.height / 2, true)
        await waitForCheck(() => getComputedStyle(actions).opacity === '1', 'Hover reveals row actions')
        check(selected === id && target.getAttribute('aria-current') === 'page', 'Clicked chat is selected')
        check(document.activeElement === target && !target.matches(':focus-visible'), 'A real pointer click retains ordinary focus')
        const selectedBackground = getComputedStyle(target).backgroundColor
        await movePointer(900, 750)
        await sleep(200)
        check(getComputedStyle(actions).opacity === '0', `${id}: clicking then leaving hides hover actions`)
        check(actions.getBoundingClientRect().width < .5, `${id}: leaving releases the action slot`)
        check(getComputedStyle(target).backgroundColor === selectedBackground, 'Selected highlight remains after pointer leaves')
        if (id === 'child') check(row(id).querySelector<HTMLElement>('span.whitespace-nowrap.tabular-nums')!.getBoundingClientRect().width > 0, 'Recency remains readable after leaving the selected card')
        // Offscreen windows cannot acquire OS keyboard focus. Test the actual
        // stylesheet's keyboard state through Chromium's pseudo-state API.
        target.focus()
        await keyboardFocusStyle(id, true)
        await waitForCheck(() => getComputedStyle(actions).opacity === '1', 'Focus-visible styling exposes accessible row actions')
        await keyboardFocusStyle(id, false)
        await movePointer(rect.left + 45, rect.top + rect.height / 2, true)
        await movePointer(900, 750)
        await sleep(200)
        check(getComputedStyle(actions).opacity === '0', 'Switching back to pointer selection does not retain keyboard reveal')
        await movePointer(rect.left + 45, rect.top + rect.height / 2)
        await sleep(200)
        const menu = row(id).querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!
        const menuRect = menu.getBoundingClientRect()
        await movePointer(menuRect.left + menuRect.width / 2, menuRect.top + menuRect.height / 2, true)
        await movePointer(900, 750)
        await sleep(200)
        check(menu.getAttribute('aria-expanded') === 'true' && getComputedStyle(actions).opacity === '1', 'An open menu keeps its anchor available')
        await movePointer(900, 750, true)
        await sleep(200)
        await waitForCheck(() => menu.getAttribute('aria-expanded') === 'false' && getComputedStyle(actions).opacity === '0', 'Closing the menu releases pointer hover actions')
    }
    return ['selected compact and working rows hide pointer-hover actions on exit; highlight and recency remain; keyboard and open-menu access pass']
}

async function run() {
    render(); await sleep(300)
    const presence = row('child').querySelector<HTMLElement>('[data-assistant-presence-group]')!
    const agent = presence.querySelector<HTMLElement>('[data-agent-presence]')!
    check(Boolean(agent), 'Agent belongs to the surface-indicator group')
    check(presence.querySelector('[data-tui-presence]') && presence.querySelector('[data-mobile-presence]'), 'Agent, terminal, and mobile indicators coexist')
    check(agent.querySelector('svg')!.innerHTML === document.querySelector('[data-agent-reference] svg')!.innerHTML, 'The thread uses the existing robot icon')
    check(!agent.querySelector('img'), 'Agent origin does not use an inspector avatar')
    check(getComputedStyle(agent).color !== getComputedStyle(presence.querySelector('[data-tui-presence]')!).color, 'Agent has its own category color')
    const title = row('child').querySelector<HTMLElement>('span[aria-label]')!
    check(title.getBoundingClientRect().right <= presence.getBoundingClientRect().left || title.getBoundingClientRect().bottom <= presence.getBoundingClientRect().top, 'Agent indicator does not overlap the title on the full-size card')
    check(getComputedStyle(row('drawing').querySelector('[role="button"]')!).boxShadow === 'none', 'Selected row has no added stripe')
    results.push('selection stripe removed; existing robot icon grouped with terminal/mobile indicators in its own color')
    for (const fontSize of [12, 14, 16, 20]) {
        document.documentElement.style.fontSize = `${fontSize}px`
        await sleep(200)
        const child = row('child')
        child.querySelector<HTMLElement>('[role="button"]')!.focus()
        await keyboardFocusStyle('child', true)
        await sleep(180)
        const settle = child.querySelector<HTMLButtonElement>('[aria-label="Settle chat"]')!
        const actions = settle.parentElement!.parentElement!
        const menu = child.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!
        check(menu.getBoundingClientRect().right <= actions.getBoundingClientRect().right + .5, `Menu button fits its reveal slot at ${fontSize}px: ${JSON.stringify({slot: actions.getBoundingClientRect().width, content: actions.firstElementChild!.getBoundingClientRect().width, focused: document.activeElement?.outerHTML.slice(0, 250), focusWithin: child.matches(':focus-within'), opacity: getComputedStyle(actions).opacity, columns: getComputedStyle(actions).gridTemplateColumns})}`)
        check(menu.getBoundingClientRect().right <= child.querySelector('[role="button"]')!.getBoundingClientRect().right - 2, 'Menu button retains right-edge clearance')
        ;(document.activeElement as HTMLElement).blur()
        await keyboardFocusStyle('child', false)
        await movePointer(900, 750, true)
        await sleep(180)
        check(actions.getBoundingClientRect().width < .5, 'Hidden controls release all of their layout width')
    }
    document.documentElement.style.fontSize = ''
    results.push('action slots fit their full controls at compact and enlarged interface text sizes')
    for (const width of [240, 300, 420]) {
        document.getElementById('rail')!.style.width = `${width}px`
        const child = row('child')
        const group = child.querySelector<HTMLElement>('[data-assistant-presence-group]')!
        const settle = child.querySelector<HTMLButtonElement>('[aria-label="Settle chat"]')!
        const actions = settle.parentElement!.parentElement!
        const target = child.getBoundingClientRect()
        const inspectAnimation = async () => {
            for (let frame = 0; frame < 12; frame++) {
                await new Promise(requestAnimationFrame)
                const a = actions.getBoundingClientRect()
                const b = settle.getBoundingClientRect()
                check(b.left >= a.left - .5, `Settle control cannot extend left of its allocated slot: ${JSON.stringify({width, frame, action: a.toJSON(), button: b.toJSON()})}`)
                const surfaces = group.getBoundingClientRect()
                check(a.left >= surfaces.right - .5 || a.bottom <= surfaces.top || a.top >= surfaces.bottom, 'Animated actions cannot cover surface indicators on either card row')
                const robot = group.querySelector<HTMLElement>('[data-agent-presence]')!.getBoundingClientRect()
                check(!document.elementFromPoint(robot.left + robot.width / 2, robot.top + robot.height / 2)?.closest('[aria-label="Settle chat"]'), 'Robot is never a settle-button hit target')
            }
        }
        await movePointer(target.left + 45, target.top + target.height / 2)
        await inspectAnimation()
        check(getComputedStyle(actions).opacity === '1', 'Pointer hover reveals actions')
        await movePointer(900, 750)
        await inspectAnimation()
        check(getComputedStyle(actions).opacity === '0', 'Unhovered settle control stays hidden')
        child.querySelector<HTMLElement>('[role="button"]')!.focus()
        await keyboardFocusStyle('child', true)
        await inspectAnimation()
        check(getComputedStyle(actions).opacity === '1', 'Keyboard focus reveals actions')
        ;(document.activeElement as HTMLElement).blur()
        await keyboardFocusStyle('child', false)
        await movePointer(900, 750, true)
        await sleep(180)
        const menu = child.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!
        menu.click(); await sleep(180)
        check(getComputedStyle(actions).opacity === '1', 'Open menu keeps its action slot revealed')
        await inspectAnimation()
        menu.click(); await sleep(180)
    }
    document.getElementById('rail')!.style.width = '300px'
    results.push('completed agent rows keep robot and settle/menu controls separate during pointer, focus, and menu animations')
    const drawingTop = row('drawing').getBoundingClientRect().top
    for (const id of ['child', 'drawing', 'child', 'drawing']) {
        selected = id; render(); titleReadable('drawing'); titleReadable('child')
        check(row('child').getBoundingClientRect().height === row('drawing').getBoundingClientRect().height && row('child').getBoundingClientRect().height > 60, 'Completed chats keep matching full-size card geometry across selection')
        check(row('drawing').getBoundingClientRect().top === drawingTop, 'Selecting a completed chat does not reshuffle Recent')
    }
    results.push('rapid completed-chat switching keeps titles painted and row geometry stable')
    const scroll = document.querySelector<HTMLElement>('.assistant-sidebar-scrollbar')!
    scroll.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); await sleep()
    const targetTop = row('child').getBoundingClientRect().top
    sessions = sessions.map(item => item.id === 'child' ? session('child', true) : item)
    render(); await sleep(300)
    check(row('child').getBoundingClientRect().top === targetTop, 'Background status changes cannot move a hovered navigation target')
    check(row('child').textContent?.includes('Working'), 'A held card still updates its live status')
    scroll.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body })); await sleep(300)
    check(row('child').textContent?.includes('Working'), 'Releasing navigation updates Active work membership')
    results.push('pointer-held targets remain stable while live work status continues updating')
    const button = document.querySelector<HTMLButtonElement>('#rail button')!
    const color = getComputedStyle(button).color
    disabled = true; render()
    check(getComputedStyle(document.querySelector('#rail button')!).color === color, 'Header button color remains stable during pending changes')
    results.push('pending state preserves sidebar action colors')
    for (const width of [240, 300, 420]) {
        document.getElementById('rail')!.style.width = `${width}px`
        row('child').querySelector<HTMLElement>('[role="button"]')!.focus()
        await keyboardFocusStyle('child', true)
        await sleep(180)
        titleReadable('child')
        const status = Array.from(row('child').querySelectorAll('span')).find(element => element.classList.contains('assistant-agent-inbox-working-text'))!
        const settle = row('child').querySelector<HTMLButtonElement>('[aria-label="Working chat stays in Priority"]')!
        const actions = settle.parentElement!.parentElement!
        const menu = row('child').querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!
        check(menu.getBoundingClientRect().right <= actions.getBoundingClientRect().right + .5, 'Active card menu fits its reveal slot')
        check(menu.getBoundingClientRect().right <= row('child').querySelector('[role="button"]')!.getBoundingClientRect().right - 2, 'Active card menu stays inside the right edge')
        check(status.getBoundingClientRect().right <= settle.getBoundingClientRect().left, 'Working state and hover actions never overlap')
        check(getComputedStyle(settle.parentElement!.parentElement!).opacity === '1', 'Focus reveals the animated actions')
    }
    results.push('titles, status, and animated actions fit 240/300/420px sidebars without overlap')
    await checkAgentColors()
    for (const mode of ['minimal', 'detailed'] as const) {
        flushSync(() => root.render(header(mode)))
        const headerGroup = document.querySelector<HTMLElement>('[data-assistant-conversation-header] [data-assistant-presence-group]')!
        const robot = headerGroup.querySelector<HTMLElement>('[data-agent-presence]')!
        const terminal = headerGroup.querySelector<HTMLElement>('[data-tui-presence]')!
        const mobile = headerGroup.querySelector<HTMLElement>('[data-mobile-presence]')!
        check(robot && terminal && mobile, `${mode} header has one grouped robot, terminal, and mobile indicator`)
        check(robot.getBoundingClientRect().width === terminal.getBoundingClientRect().width, 'Header robot has the same size as surface indicators')
        check(robot.getBoundingClientRect().right <= terminal.getBoundingClientRect().left, 'Header robot and terminal do not overlap')
        check(terminal.getBoundingClientRect().right <= mobile.getBoundingClientRect().left, 'Header terminal and mobile do not overlap')
        check(getComputedStyle(robot).color !== getComputedStyle(terminal).color, 'Header retains distinct robot color')
        check(robot.getAttribute('title')?.includes('Xara'), 'Agent identity is retained in the header tooltip')
        check(!document.querySelector('[data-header-fixture]')!.textContent?.includes('Agent thread'), 'Header avoids a second labeled agent pill')
        flushSync(() => root.render(header(mode, false)))
        check(!document.querySelector('[data-agent-presence]'), 'Ordinary chat header has no robot indicator')
        check(document.querySelector('[data-tui-presence]'), 'Ordinary chat still shows terminal presence')
    }
    results.push('minimal and detailed headers reuse the robot treatment alongside surface indicators')
    return checkThreadMessages()
}

async function checkThreadMessages() {
    const details = { messageId: 'a', senderThreadId: 'parent', recipientThreadId: 'child', senderLabel: 'Xara', text: 'Read every line.\n'.repeat(30), origin: 'delegation', createdAt: now }
    const receipt = projectThreadMessage(details, now)!
    ;(assistantStore as any).getState = () => ({ snapshot: { sessions: [session('parent'), session('child')], fleetByThreadId: { parent: { agents: { child: { providerSessionId: 'child' } } } } } })
    ;(assistantStore as any).refresh = async () => { throw new Error('Loaded thread links should not need a refresh') }
    flushSync(() => root.render(<div style={{ width: 700 }}><AssistantTimelineThreadMessage activity={receipt} /><AssistantTimelineThreadMessage activity={{ ...receipt, id: 'b' }} /></div>))
    check(document.body.textContent?.includes('Message from Xara in another thread'), 'Delegation has durable sender attribution above its user-style bubble')
    check(document.querySelectorAll('[data-assistant-thread-message-bubble]').length === 2, 'Each incoming message is its own bubble')
    Array.from(document.querySelectorAll('button')).find(button => button.textContent?.includes('Message from Xara'))!.click(); await sleep()
    check(location.hash === '#/assistant/chat/parent/thread/parent-thread', 'Sender link opens the exact parent with one click')
    const body = document.querySelector<HTMLElement>('[data-assistant-thread-message-body]')!
    const bubble = document.querySelector<HTMLElement>('[data-assistant-thread-message-bubble]')!
    const label = document.querySelector<HTMLElement>('[data-assistant-thread-message-label]')!
    const showMore = Array.from(body.querySelectorAll('button')).find(button => button.textContent === 'Show more')!
    check(showMore, 'Long agent messages use the same Show more treatment as user messages')
    showMore.click(); await sleep(300)
    check(body.textContent?.includes('Show less') && body.textContent.includes('Read every line.'), 'Expanded message exposes full text and Show less')
    check(label.getBoundingClientRect().bottom <= body.getBoundingClientRect().top, 'Sender label stays above the bubble')
    check(Math.abs(bubble.getBoundingClientRect().right - bubble.parentElement!.getBoundingClientRect().right) < 1 && Number.parseFloat(getComputedStyle(body).borderRadius) >= 8, `Received message uses the right aligned user-bubble treatment: ${getComputedStyle(body).borderRadius}`)
    Array.from(body.querySelectorAll('button')).find(button => button.textContent === 'Show less')!.click(); await sleep(300)
    check(body.textContent?.includes('Show more'), 'Expanded peer text can collapse again')
    check(!document.querySelector('[data-assistant-thread-message-notice]'), 'Composer notice is absent')
    flushSync(() => root.render(<AssistantTimelineThreadMessage activity={{ ...receipt, kind: 'thread-collaboration', summary: 'Started an agent thread', payload: { targetThreadId: 'agent-run:child' } }} />))
    Array.from(document.querySelectorAll('button')).find(button => button.textContent?.includes('Open thread'))!.click(); await sleep()
    check(location.hash === '#/assistant/chat/child/thread/child-thread', 'Creation result opens the exact child with one click')
    check(document.querySelector('[data-assistant-action-row]')!.getBoundingClientRect().height < 40, 'Outgoing thread actions use compact rows')
    results.push('right aligned peer bubbles retain complete text and one-click sender navigation; outgoing actions are compact')
    const at = (seconds: number) => new Date(Date.parse(now) + seconds * 1000).toISOString()
    const msg = (id: string, role: 'user' | 'assistant', seconds: number, text: string) => ({ id, role, text, turnId: null, streaming: false, createdAt: at(seconds), updatedAt: at(seconds) })
    const prompt = msg('task-prompt', 'user', 0, 'Check the adapter')
    const progress = msg('task-progress', 'assistant', 1, 'I am checking the adapter now.')
    const send = { id: 'sent-result', kind: 'thread-collaboration', tone: 'tool', summary: 'Sent a message to another thread', detail: 'Verified the adapter and its tests.', turnId: null, createdAt: at(4), payload: { action: 'send', status: 'completed', targetThreadId: 'parent', sentMessageId: 'result-receipt', args: { action: 'send', prompt: 'Verified the adapter and its tests.' } } } as any
    const final = msg('task-final', 'assistant', 5, 'The adapter is ready. Both checks passed.')
    for (const readableFinal of [false, true]) {
        const messages = readableFinal ? [prompt, progress, final] : [prompt, progress]
        const display = groupTimelineRowsIntoWorkSummaries({ rows: buildTimelineRows(getTimelineEntries(messages, [send]), false, null), messages,
            latestAssistantMessageId: readableFinal ? final.id : progress.id, latestTurnStartedAt: at(0), isWorking: false })
        const renderRow = (row: any): any => row.kind === 'message' ? <TimelineMessage message={row.message} peerReply={row.peerReply} isLastAssistantInTurn={row.message.role === 'assistant'} displayMode="minimal" />
            : row.kind === 'turn-work-summary' ? <TimelineTurnWorkSummary key={`${readableFinal}:${row.id}`} displayMode="minimal" startedAt={row.startedAt} completedAt={row.completedAt} outcome={row.outcome} hasWork renderChildren={() => <div data-expanded-task-work>{row.rows.map((nested: any) => <div key={nested.id}>{nested.kind === 'message' ? renderRow(nested) : <AssistantTimelineThreadMessage activity={nested.kind === 'activity' ? nested.activity : nested.activities[0]} />}</div>)}</div>} /> : null
        flushSync(() => root.render(<div style={{ width: 700 }} data-agent-ending-fixture>{display.map(row => <div key={row.id}>{renderRow(row)}</div>)}</div>))
        await sleep(500)
        check(document.body.textContent?.includes('Worked for') && !document.body.textContent?.includes(progress.text), 'Saved task opens with its progress and tool work collapsed')
        const ending = document.querySelector<HTMLButtonElement>(`[data-assistant-peer-reply="${readableFinal ? 'card' : 'timestamp'}"]`)!
        check(ending, 'A sent result is visibly attributed at the task ending')
        const timestamp = document.querySelector('[data-agent-ending-fixture] [data-assistant-message-timestamp]')!
        if (readableFinal) {
            check(document.body.textContent?.includes(final.text) && !document.body.textContent?.includes(send.detail), 'Readable final stays visible and the sent body stays in work')
            check(ending.getBoundingClientRect().width >= 695 && ending.getBoundingClientRect().height <= 44, 'Reply card spans the chat width and stays compact')
            check(Boolean(ending.compareDocumentPosition(timestamp) & Node.DOCUMENT_POSITION_FOLLOWING), 'Reply card is below the answer and before its timestamp')
        } else {
            check(document.body.textContent?.includes(send.detail), 'A peer-only result serves as the readable final for saved history')
            check(timestamp.getAttribute('dateTime') === send.createdAt && timestamp.parentElement === ending.parentElement, 'Peer-only ending has the original sent timestamp with attribution beside it')
        }
        ending.click(); await sleep()
        check(location.hash === '#/assistant/chat/parent/thread/parent-thread?message=zyra-thread-message%3Aresult-receipt', 'Reply ending opens the exact receiving message with one click')
        document.querySelector<HTMLButtonElement>('button[title="Show work"]')!.click(); await sleep(350)
        check(document.body.textContent?.includes(progress.text), 'Collapsed task exposes its original progress on request')
    }
    results.push('legacy peer-only result becomes a readable ending; separate final uses a full-width compact reply card before its timestamp; exact receiving message links and work expansion pass')
    return results
}
;(window as any).sidebarContinuityCheck = location.search.includes('threadMessages=1') ? checkThreadMessages() : location.search.includes('unreadCompletion=1') ? checkUnreadCompletion()
    : location.search.includes('agentColors=1') ? checkAgentColors().then(() => results) : location.search.includes('rowHoverActions=1') ? checkRowHoverActions() : location.search.includes('voiceRecorderInput=1') ? checkVoiceRecorderInput(root) : location.search.includes('conversationMarkers=1') ? checkConversationMarkers(root) : run()
