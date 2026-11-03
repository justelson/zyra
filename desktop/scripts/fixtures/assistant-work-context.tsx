import { createRoot } from 'react-dom/client'
import { AssistantAgentInboxSidebar } from '../../src/renderer/src/pages/assistant/AssistantAgentInboxSidebar'
import type { AssistantSession, AssistantThread } from '../../src/shared/assistant/contracts'

document.body.style.fontFamily = 'Segoe UI, sans-serif'
document.documentElement.style.setProperty('--surface-active', '#292929')
const now = new Date().toISOString()
const artwork = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="7" fill="#7cb4bd"/><path d="M9 9h14L9 23h14" fill="none" stroke="#122027" stroke-width="3"/></svg>')
let releaseArtwork!: () => void
const ready = new Promise<void>(resolve => { releaseArtwork = resolve })
const calls: string[] = []
Object.assign(window, { devscope: { getProjectDetails: async (path: string) => {
    calls.push(path)
    if (path.endsWith('/zyra')) await ready
    return { success: true, project: { name: path.split('/').pop(), type: 'unknown', frameworks: [], markers: [], projectIconPath: path.endsWith('/zyra') ? artwork : path.endsWith('/broken') ? 'data:image/png;base64,notanimage' : null } }
} } })
const make = (id: string, title: string, cwd: string) => {
    const thread = { id: 'thread-' + id, source: 'root', state: 'ready', cwd, model: 'fixture/model', lastError: null, messages: [{ id: 'answer-' + id, role: 'assistant', text: 'Saved answer', createdAt: now, updatedAt: now }], activities: [], pendingApprovals: [], pendingUserInputs: [], messageCount: 1, activityCount: 0, hasPendingApprovals: false, hasPendingUserInputs: false, latestTurn: null, createdAt: now, updatedAt: now } as unknown as AssistantThread
    return { id, title, mode: 'work', projectPath: null, workingRoot: cwd, projectId: null, chatScope: null, threads: [thread], threadIds: [thread.id], activeThreadId: thread.id, archived: false, createdAt: now, updatedAt: now } as AssistantSession
}
let sessions = [make('a', 'Investigate transcription and voice chat', 'C:/workspace'), make('b', 'Make latest MIDI piano-only and slower', 'C:/workspace/Music'), make('c', 'Compare model usage', 'C:/workspace/Research')]
const initial = sessions.map(session => ({ id: session.id, cwd: session.threads[0].cwd, projectId: session.projectId }))
let selections = 0
const root = createRoot(document.getElementById('root')!)
const render = () => root.render(<div id="work-context-sidebar-fixture" style={{ width: 330, height: 690, display: 'flex', flexDirection: 'column', padding: 12, background: '#171717', borderRight: '1px solid #292929' }}><input id="preserved-focus" style={{ position: 'absolute', left: -1000 }} /><div style={{ padding: '12px 10px', fontSize: 13, fontWeight: 600 }}>Chats</div><AssistantAgentInboxSidebar sessions={sessions} activeSessionId="b" activeThreadId="thread-b" commandPending={false} pendingControlThreadIds={new Set()} projectIconOverrides={{}} headerActions={null} onCreateProjectChat={() => {}} onSelectSession={() => { selections++ }} onRename={() => {}} getSessionMenuItems={() => []} onOpenContextMenu={() => {}} /></div>)
const row = (id: string) => document.querySelector<HTMLElement>(`[data-agent-inbox-layout-id="${id}"]`)!
const check = (value: unknown, message: string) => { if (!value) throw new Error(message) }
const until = async (predicate: () => unknown, message: string) => { const deadline = Date.now() + 5000; while (!predicate()) { if (Date.now() > deadline) throw new Error('Timeout: ' + message); await new Promise(resolve => setTimeout(resolve, 10)) } }
const update = (id: string, folderPath: string | null, kind: NonNullable<AssistantSession['workContext']>['kind'], shortName = kind === 'music' ? 'Piano arrangement' : kind === 'research' ? 'Model comparison' : 'Chat scroll') => { sessions = sessions.map(session => session.id === id ? { ...session, workContext: { folderPath, kind, shortName, updatedAt: new Date().toISOString() } } : session); render() }
render()
Object.assign(window, { sidebarContinuityCheck: (async () => {
    await until(() => row('a'), 'initial rows')
    check(row('a').textContent?.includes('Chat'), 'unreported Chat stays neutral')
    document.getElementById('preserved-focus')!.focus()
    update('a', 'C:/workspace/zyra', 'coding')
    await until(() => row('a').querySelector('.lucide-code'), 'work fallback before artwork arrives')
    check(row('a').querySelector('[data-work-label]')?.textContent === 'Chat scroll', 'semantic task name leads without a generic category prefix')
    update('a', 'C:/workspace/zyra', 'coding', 'Preview build')
    await until(() => row('a').querySelector('[data-work-label]')?.textContent === 'Preview build', 'same folder supports a different actual task')
    update('a', 'C:/workspace/2026-10-31_122530', 'video', 'Classic edit')
    await until(() => row('a').querySelector('[data-work-label]')?.textContent === 'Classic edit', 'timestamp folder uses supplied semantic name')
    const fixture = document.getElementById('work-context-sidebar-fixture')!
    for (const width of [240, 280, 330, 400]) {
        fixture.style.width = `${width}px`
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        const label = row('a').querySelector<HTMLElement>('[data-work-label]')!
        check(label.textContent === 'Classic edit', `full work name at ${width}px`)
        check(getComputedStyle(label).whiteSpace === 'nowrap' && label.scrollWidth <= label.clientWidth + 1 && label.scrollHeight <= label.clientHeight + 1, `short work name stays fully readable on one line at ${width}px`)
        const card = row('a').querySelector<HTMLElement>('[role="button"]')!
        const status = card.querySelector<HTMLElement>('[data-agent-inbox-status]')!
        const subtitle = card.querySelector<HTMLElement>('[data-agent-inbox-title]')!
        check(Math.abs(card.getBoundingClientRect().right - status.getBoundingClientRect().right - 10) < 1, `timestamp sits at normal 10px right padding at ${width}px`)
        check(parseFloat(getComputedStyle(label).fontSize) > parseFloat(getComputedStyle(subtitle.firstElementChild!).fontSize), 'short name has stronger hierarchy than the chat title')
        check(!card.textContent?.includes('model') && label.title.includes('fixture/model'), 'model detail moves to the work-label tooltip without a third line')
        check(card.getBoundingClientRect().height === 64, `ordinary two-line row stays compact at ${width}px`)
    }
    fixture.style.width = '330px'
    update('a', 'C:/workspace/Tracks', 'music')
    await until(() => row('a').querySelector('.lucide-music'), 'changed work replaces its icon')
    releaseArtwork()
    await new Promise(resolve => setTimeout(resolve, 80))
    check(row('a').querySelector('.lucide-music') && !row('a').querySelector('img'), 'late old-folder artwork cannot overwrite newer work')
    update('a', 'C:/workspace/zyra', 'coding')
    await until(() => { const image = row('a').querySelector('img'); return image && image.naturalWidth > 0 }, 'real image loads through existing artwork component')
    check(!row('a').querySelector('.lucide-code'), 'artwork takes precedence')
    update('a', 'C:/workspace/broken', 'music')
    await until(() => row('a').querySelector('.lucide-music') && !row('a').querySelector('img'), 'broken artwork uses the current work icon')
    update('b', null, 'music')
    update('c', null, 'research')
    await until(() => row('b').querySelector('.lucide-music') && row('c').querySelector('.lucide-search'), 'per-chat fallback icons')
    check(row('b').querySelector('[data-work-label]')?.textContent === 'Piano arrangement' && row('c').querySelector('[data-work-label]')?.textContent === 'Model comparison', 'missing work folder keeps the semantic name independent of artwork fallback')
    update('a', 'C:/workspace/zyra', 'coding')
    await until(() => row('a').querySelector('img')?.naturalWidth, 'restore branded final state')
    check(row('b').querySelector('.lucide-music') && row('c').querySelector('.lucide-search'), 'updating one Chat retains other Chats\' work metadata')
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    check(selections === 0 && row('b').querySelector('[aria-current="page"]'), 'updates preserve selected Chat')
    check(document.activeElement?.id === 'preserved-focus', 'updates do not move focus')
    check(JSON.stringify(sessions.map(session => ({ id: session.id, cwd: session.threads[0].cwd, projectId: session.projectId }))) === JSON.stringify(initial), 'metadata never changes execution cwd or Project')
    check(calls.some(path => path.endsWith('/zyra')), 'app resolves artwork from reported folder')
    update('a', 'C:/workspace/zyra', 'coding', 'Chat row redesign')
    sessions = sessions.map(session => session.id === 'a' ? { ...session, threads: session.threads.map(thread => ({ ...thread, canonicalPresence: { state: 'running' as const, clients: [] }, latestTurn: { id: 'running-turn', state: 'running' as const, requestedAt: now, startedAt: new Date(Date.parse(now) - 6 * 60_000).toISOString(), completedAt: null } })) } : session)
    render()
    await until(() => row('a').textContent?.includes('Working'), 'running timer appears beside the reported work name')
    for (const width of [240, 280, 330, 400]) {
        fixture.style.width = `${width}px`
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        const label = row('a').querySelector<HTMLElement>('[data-work-label]')!
        const card = row('a').querySelector<HTMLElement>('[role="button"]')!
        const status = card.querySelector<HTMLElement>('[data-agent-inbox-status]')!
        const style = getComputedStyle(label)
        check(label.textContent === 'Chat row redesign', 'the complete semantic name stays in the DOM, not a rewritten abbreviation')
        check(style.whiteSpace === 'nowrap' && label.getBoundingClientRect().height <= parseFloat(style.lineHeight) + 1, `work name never wraps beside the running timer at ${width}px`)
        check(card.getBoundingClientRect().height === 64, `running timer does not add a third text level at ${width}px`)
        check(Math.abs(card.getBoundingClientRect().right - status.getBoundingClientRect().right - 10) < 1, `working timer aligns to the same 10px right padding as recency at ${width}px`)
        check(label.getBoundingClientRect().right <= status.getBoundingClientRect().left, 'single-line label stays separate from the unchanged running timer')
        if (width === 400) check(label.scrollWidth <= label.clientWidth + 1, 'normal-width sidebar shows the complete work name beside the running timer')
    }
    return ['actual sidebar live folder/category updates and existing artwork', 'missing/broken artwork fallback and stale old-folder isolation', 'per-chat current-directory fallback without focus, selection or authority changes', 'single-line work names beside running timers at 240/280/330/400px; normal width retains the full name']
})() })
