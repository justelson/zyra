import { Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { AssistantAgentInboxSidebar } from '../../src/renderer/src/pages/assistant/AssistantAgentInboxSidebar'
import type { AssistantSession, AssistantThread } from '../../src/shared/assistant/contracts'

const root = createRoot(document.getElementById('root')!)
const at = new Date().toISOString()
let caught: Error | null = null
const measurements: unknown[] = []
let transientHeaderGeometry = false
const bounds = Element.prototype.getBoundingClientRect
Element.prototype.getBoundingClientRect = function () {
    let rect = bounds.call(this)
    // Fault injection at the production crash boundary. Native cases below
    // cover actual layout; this case supplies changing visual geometry while
    // layout coordinates stay fixed, as can happen during interrupted motion.
    if (transientHeaderGeometry && this instanceof HTMLElement && this.tagName === 'LI' && this.textContent === 'Settled') {
        const scroller = document.querySelector<HTMLElement>('.assistant-sidebar-scrollbar')!
        const count = document.querySelectorAll('[data-agent-inbox-layout-id]').length
        const available = count === 2 ? 74.000001 : 73.999999
        const bottom = bounds.call(scroller).bottom - available - scroller.scrollTop
        rect = new DOMRect(rect.x, bottom - rect.height, rect.width, rect.height)
    }
    if (this instanceof HTMLElement && (this.classList.contains('assistant-sidebar-scrollbar') || this.tagName === 'LI' && this.textContent === 'Settled')) {
        measurements.push({ tag: this.tagName, top: rect.top, height: rect.height, scrollTop: this.scrollTop, offsetTop: this.offsetTop, rows: document.querySelectorAll('[data-agent-inbox-layout-id]').length })
        if (measurements.length > 32) measurements.shift()
    }
    return rect
}
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
    state = { failed: false }
    static getDerivedStateFromError(error: Error) { caught = error; return { failed: true } }
    render() { return this.state.failed ? <div data-sidebar-failed /> : this.props.children }
}
function session(index: number, settled: boolean): AssistantSession {
    const id = `${settled ? 'settled' : 'recent'}-${index}`
    const thread = { id: `${id}-thread`, source: 'root', state: 'ready', messages: [], activities: [], pendingApprovals: [], pendingUserInputs: [], messageCount: 1, activityCount: 0,
        createdAt: at, updatedAt: at, latestTurn: { id: `${id}-turn`, state: 'completed', requestedAt: at, startedAt: at, completedAt: at }, lastSeenCompletedTurnId: `${id}-turn` } as unknown as AssistantThread
    return { id, title: `Synthetic ${id}`, mode: 'work', projectPath: null, threads: [thread], activeThreadId: thread.id, threadIds: [thread.id], archived: false, settled, settlementManual: true, createdAt: at, updatedAt: at } as AssistantSession
}
const sleep = () => new Promise(resolve => setTimeout(resolve, 20))
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function run() {
    localStorage.clear()
    let cases = 0
    if (!(window as any).sidebarStressOnly) {
    for (const mode of ['fixed', 'max-height'] as const) for (const height of [210, 300, 480, 640, 800]) for (const recentCount of [0, 2, 6]) for (const settledCount of [2, 5, 20]) {
        const key = `${mode}:${height}:${recentCount}:${settledCount}`
        const sessions = [...Array.from({ length: recentCount }, (_, i) => session(i, false)), ...Array.from({ length: settledCount }, (_, i) => session(i, true))]
        const render = (activeSessionId: string) => flushSync(() => root.render(<Boundary key={key}>
            <div style={{ width: 300, display: 'flex', flexDirection: 'column', ...(mode === 'fixed' ? { height } : { maxHeight: height }) }}>
                <AssistantAgentInboxSidebar sessions={sessions} activeSessionId={activeSessionId} activeThreadId={`${activeSessionId}-thread`} commandPending={false} pendingControlThreadIds={new Set()} projectIconOverrides={{}} headerActions={null}
                    onCreateProjectChat={() => {}} onSelectSession={() => {}} onRename={() => {}} getSessionMenuItems={() => []} onOpenContextMenu={() => {}} />
            </div>
        </Boundary>))
        caught = null
        measurements.length = 0
        render(sessions[0]!.id)
        await sleep()
        const scroller = document.querySelector<HTMLElement>('.assistant-sidebar-scrollbar')
        if (scroller) scroller.scrollTop = scroller.scrollHeight
        render(sessions.at(-1)!.id)
        await sleep()
        check(!caught, `${key}: ${String(caught)}; native measurements=${JSON.stringify(measurements)}`)
        check(!document.querySelector('[data-sidebar-failed]'), `${key}: sidebar crashed`)
        cases++
    }
    // Switching at the bottom of a long list can clamp/anchor scrolling while
    // the viewport-sized first batch adds or removes one row. Exercise exact
    // row boundaries and fractional text zoom with hover holding row order.
    document.body.classList.add('zyra-code-zoom')
    for (const zoom of [1, 1.1, 1.25, 1.3]) for (const recentCount of [0, 2]) {
        document.body.style.setProperty('--code-zoom', String(zoom))
        const sessions = [...Array.from({ length: recentCount }, (_, i) => session(i, false)), ...Array.from({ length: 60 }, (_, i) => session(i, true))]
        const key = `boundary:${zoom}:${recentCount}`
        let height = 640
        const render = (selected: string) => flushSync(() => root.render(<Boundary key={key}>
            <div data-window-host style={{ width: 300, height, display: 'flex', flexDirection: 'column' }}>
                <AssistantAgentInboxSidebar sessions={sessions} activeSessionId={selected} activeThreadId={`${selected}-thread`} commandPending={false} pendingControlThreadIds={new Set()} projectIconOverrides={{}} headerActions={null}
                    onCreateProjectChat={() => {}} onSelectSession={() => {}} onRename={() => {}} getSessionMenuItems={() => []} onOpenContextMenu={() => {}} />
            </div>
        </Boundary>))
        caught = null
        render(sessions[0]!.id)
        await sleep()
        const scroller = document.querySelector<HTMLElement>('.assistant-sidebar-scrollbar')!
        const header = [...scroller.querySelectorAll('li')].find(row => row.textContent === 'Settled')!
        const headerBottom = header.getBoundingClientRect().bottom - scroller.getBoundingClientRect().top + scroller.scrollTop
        const overhead = height - scroller.getBoundingClientRect().height + headerBottom
        for (const rows of [1, 2, 5, 10]) for (const fraction of [-1 / 64, 0, 1 / 64]) {
            height = overhead + rows * 37 + fraction
            scroller.scrollTop = scroller.scrollHeight
            scroller.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }))
            render(sessions.at(-1)!.id)
            await sleep()
            check(!caught, `${key}:${rows}:${fraction}: ${String(caught)}; native measurements=${JSON.stringify(measurements)}`)
            const current = document.querySelector<HTMLElement>('.assistant-sidebar-scrollbar')!
            current.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse', relatedTarget: document.body }))
            render(sessions[0]!.id)
            await sleep()
            check(!caught, `${key}:${rows}:${fraction}: selection return: ${String(caught)}; native measurements=${JSON.stringify(measurements)}`)
            cases++
        }
    }
    document.body.classList.remove('zyra-code-zoom')
    for (const height of [600, 650, 700, 720, 740, 760]) {
        let sessions = [...Array.from({ length: 5 }, (_, i) => session(i, false)), ...Array.from({ length: 17 }, (_, i) => session(i, true))]
        const key = `selection:${height}`
        let selected = sessions[0]!.id
        const render = () => flushSync(() => root.render(<Boundary key={key}>
            <div style={{ width: 300, height, position: 'relative' }}>
                <aside className="absolute inset-0 h-full overflow-hidden [contain:layout_paint]">
                    <div className="flex h-full flex-col px-2 py-2.5">
                        <AssistantAgentInboxSidebar sessions={sessions} activeSessionId={selected} activeThreadId={`${selected}-thread`} commandPending={false} pendingControlThreadIds={new Set()} projectIconOverrides={{}}
                            headerActions={<div style={{ height: 110 }}>Actions</div>} onCreateProjectChat={() => {}}
                            onSelectSession={id => {
                                selected = id
                                sessions = sessions.map(entry => entry.id === id ? { ...entry, threads: entry.threads.map(thread => ({ ...thread, lastSeenCompletedTurnId: thread.latestTurn?.id })) } : entry)
                                render()
                            }} onRename={() => {}} getSessionMenuItems={() => []} onOpenContextMenu={() => {}} />
                        <div className="mt-auto h-10 shrink-0">Footer</div>
                    </div>
                </aside>
            </div>
        </Boundary>))
        caught = null
        render()
        await sleep()
        for (let index = 0; index < 25; index++) {
            sessions = sessions.map((entry, i) => i === index % 5 ? { ...entry, threads: entry.threads.map(thread => ({ ...thread,
                latestTurn: { ...thread.latestTurn!, state: index % 3 ? 'completed' : 'running', completedAt: index % 3 ? at : null },
                lastSeenCompletedTurnId: null })) } : entry)
            render()
            const row = document.querySelector<HTMLElement>(`[data-agent-inbox-layout-id="recent-${index % 5}"] [role="button"]`)!
            row?.focus()
            row?.click()
            await sleep()
            check(!caught, `${key}:${index}: ${String(caught)}; native measurements=${JSON.stringify(measurements)}`)
            cases++
        }
    }
    }
    const oldAt = '2026-09-01T10:00:00.000Z'
    const latestAt = '2026-09-03T10:00:00.000Z'
    let legacy = [session(0, false), session(1, false)].map((entry, index) => ({ ...entry, createdAt: oldAt,
        threads: entry.threads.map(thread => ({ ...thread, latestTurn: null, createdAt: oldAt, lastMessageAt: index ? latestAt : '2026-09-02T10:00:00.000Z' })) }))
    const renderLegacy = () => flushSync(() => root.render(<Boundary key="legacy-recency"><div className="flex h-full w-[300px] flex-col">
        <AssistantAgentInboxSidebar sessions={legacy} activeSessionId={legacy[0]!.id} activeThreadId={legacy[0]!.activeThreadId} commandPending={false} pendingControlThreadIds={new Set()}
            projectIconOverrides={{}} headerActions={null} onCreateProjectChat={() => {}} onSelectSession={() => {}} onRename={() => {}} getSessionMenuItems={() => []} onOpenContextMenu={() => {}} />
    </div></Boundary>))
    const order = () => [...document.querySelectorAll<HTMLElement>('[data-agent-inbox-layout-id]')].map(element => element.dataset.agentInboxLayoutId).join(',')
    renderLegacy()
    check(order() === 'recent-1,recent-0', 'Legacy shells sort by retained message time')
    legacy = legacy.map((entry, index) => index ? { ...entry, threads: entry.threads.map(thread => ({ ...thread,
        messages: [{ id: 'legacy-message', role: 'assistant' as const, text: 'Saved response', createdAt: latestAt, updatedAt: latestAt }] })) } : entry)
    renderLegacy()
    check(order() === 'recent-1,recent-0', 'Opening legacy history preserves rendered chat order')
    legacy = legacy.map(entry => ({ ...entry, threads: entry.threads.map(thread => ({ ...thread, messages: [] })) }))
    renderLegacy()
    check(order() === 'recent-1,recent-0', 'Closing legacy history preserves rendered chat order')
    transientHeaderGeometry = true
    caught = null
    const stressSessions = Array.from({ length: 20 }, (_, i) => session(i, true))
    flushSync(() => root.render(<Boundary key="transient-geometry">
        <div style={{ width: 300, height: 350, display: 'flex', flexDirection: 'column' }}>
            <AssistantAgentInboxSidebar sessions={stressSessions} activeSessionId={stressSessions[0]!.id} activeThreadId={stressSessions[0]!.activeThreadId} commandPending={false}
                pendingControlThreadIds={new Set()} projectIconOverrides={{}} headerActions={null} onCreateProjectChat={() => {}} onSelectSession={() => {}}
                onRename={() => {}} getSessionMenuItems={() => []} onOpenContextMenu={() => {}} />
        </div>
    </Boundary>))
    await sleep()
    check(!caught, `Transient visual geometry must not feed back through row count: ${String(caught)}`)
    transientHeaderGeometry = false
    const beforePage = document.querySelectorAll('[data-agent-inbox-layout-id]').length
    const nextPage = [...document.querySelectorAll('button')].find(button => button.textContent?.startsWith('See '))!
    nextPage.click()
    await sleep()
    check(document.querySelectorAll('[data-agent-inbox-layout-id]').length > beforePage, 'Settled pagination still reveals more chats')
    const settledTrigger = [...document.querySelectorAll('button')].find(button => button.textContent === 'Settled')!
    settledTrigger.click()
    await sleep()
    check(document.querySelectorAll('[data-agent-inbox-layout-id]').length === 1, 'Collapsing Settled preserves the active chat')
    settledTrigger.click()
    await sleep()
    check(document.querySelectorAll('[data-agent-inbox-layout-id]').length === stressSessions.length, 'Reopening Settled preserves revealed pages')
    root.unmount()
    return [`Settled sidebar: ${cases} native cases, legacy chat order, transient geometry, pagination and collapse passed`]
}
;(window as any).sidebarContinuityCheck = run()
