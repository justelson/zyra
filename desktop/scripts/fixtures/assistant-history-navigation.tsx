import { createRef, useCallback, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import type { LegendListRef } from '@legendapp/list/react'
import { AssistantStore } from '../../src/renderer/src/lib/assistant/assistant-store-core'
import { getAssistantThreadHydrationRevision } from '../../src/renderer/src/lib/assistant/assistant-thread-hydration-revision'
import { AssistantVirtualTimeline } from '../../src/renderer/src/pages/assistant/AssistantVirtualTimeline'
import { AssistantTimelineLatestButton } from '../../src/renderer/src/pages/assistant/AssistantTimelineLatestButton'
import { useAssistantTimelineLatestNavigation } from '../../src/renderer/src/pages/assistant/useAssistantTimelineLatestNavigation'
import { CompletedAssistantMarkdown } from '../../src/renderer/src/pages/assistant/AssistantTimelineText'
import { ASSISTANT_TIMELINE_FOLLOW_END_EVENT } from '../../src/renderer/src/pages/assistant/assistant-timeline-scroll-events'
import { createAssistantLongHistoryFixture } from './assistant-long-history-fixture'

const sourceMessages = [...(window as any).longChatReplayPages].reverse().flatMap((page: any) => page.messages)
if (sourceMessages.length < 40) throw new Error('Navigation replay requires at least 40 real messages')
const snapshot = createAssistantLongHistoryFixture(1)
const session = snapshot.sessions[0]!, thread = session.threads[0]!
thread.messageCount = sourceMessages.length
thread.activities = []
const history = (messages: any[], hasNewer: boolean) => ({ threadId: thread.id, messages, activities: [], proposedPlans: [], initialLoading: false, loadingOlder: false, loadingNewer: false, loadOlderError: null, loadNewerError: null, fullyLoaded: false, pageInfo: { oldestCursor: 'older-cursor', newestCursor: hasNewer ? 'newer-cursor' : null, hasOlder: true, hasNewer, turnCount: messages.filter(message => message.role === 'user').length }, lastUsedAt: Date.now(), shellRevision: getAssistantThreadHydrationRevision(thread) })
const oldHistory = history(sourceMessages.slice(10, 30), true)
const latestHistory = history(sourceMessages.slice(-12), false)
thread.messages = oldHistory.messages
const otherThread = { ...thread, id: 'other-thread', messages: [{ ...sourceMessages[0], id: 'other-message', text: 'Other chat remains selected.' }], activities: [] }
const otherSession = { ...session, id: 'other-session', activeThreadId: otherThread.id, threads: [otherThread] }
const otherHistory = { ...history(otherThread.messages, false), threadId: otherThread.id, pageInfo: { ...oldHistory.pageInfo, hasOlder: false, hasNewer: false } }
snapshot.sessions.push(otherSession)
const store = new AssistantStore()
const update = (patch: any) => (store as any).setState(patch)
update({ snapshot, hydrated: true, historyByThreadId: { [thread.id]: oldHistory, [otherThread.id]: otherHistory } })
let delay: (() => void) | null = null, fail = false, contextBackfill = false
let contextPage: any = null
const requests: any[] = [], follows: Array<{ threadId: string; animated: boolean }> = []
;(window as any).devscope = { assistant: { getHistoryPage: async (input: any) => {
    requests.push(input)
    if (contextBackfill && input.before) { await new Promise(resolve => setTimeout(resolve, 100)); return { success: true, page: contextPage } }
    await new Promise<void>(resolve => { delay = resolve })
    return fail ? { success: false, error: 'Temporary offline fixture' } : { success: true, page: latestHistory }
} } }
const scrollRef = createRef<HTMLDivElement>(), listRef = createRef<LegendListRef>()
const root = createRoot(document.getElementById('root')!)
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms))
const until = async (predicate: () => unknown, message: string) => { for (let i = 0; i < 140; i++) { if (predicate()) return; await pause(40) } throw new Error(message) }
const loadLatest = (id: string) => store.loadLatestHistory(id)
const renderRow = (row: any) => <article data-message-id={row.id}><CompletedAssistantMarkdown cacheKey={row.id} content={row.message.text} /></article>
function Surface() {
    const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
    const selected = state.snapshot.sessions.find(session => session.id === state.snapshot.selectedSessionId)!
    const selectedThread = selected.threads.find(thread => thread.id === selected.activeThreadId)!
    const current = state.historyByThreadId[selectedThread.id]!
    const follow = useCallback((animated: boolean) => {
        follows.push({ threadId: selectedThread.id, animated })
        scrollRef.current!.dispatchEvent(new CustomEvent(ASSISTANT_TIMELINE_FOLLOW_END_EVENT, { detail: { animated } }))
    }, [selectedThread.id])
    const navigation = useAssistantTimelineLatestNavigation({ threadId: selectedThread.id, hasNewer: current.pageInfo.hasNewer, loadError: current.loadNewerError, scrollRef, loadLatestHistory: loadLatest, onFollowEnd: follow })
    const rows: any[] = current.messages.map(message => ({ kind: 'message', id: message.id, createdAt: message.createdAt, message }))
    return <><div id="controls" style={{ position: 'fixed', top: 0, right: 0, zIndex: 100 }}><AssistantTimelineLatestButton visible label={navigation.label} pending={navigation.pending} onClick={navigation.onNavigate} /></div>
        <AssistantVirtualTimeline rows={rows} windowKey={selectedThread.id} listRef={listRef} scrollContainerRef={scrollRef}
            contentInsetEndAdjustment={0} isWorking={selectedThread.state === 'running'} selectionHydrating={false} hasOlder={current.pageInfo.hasOlder} hasNewer={current.pageInfo.hasNewer}
            loadingOlder={current.loadingOlder} loadingNewer={current.loadingNewer} loadOlderError={current.loadOlderError} loadNewerError={current.loadNewerError}
            renderRow={renderRow} onScrollContainer={navigation.measure} onLoadOlder={contextBackfill ? limit => store.loadOlderHistory(selectedThread.id, limit) : undefined} />
    </>
}
const button = () => document.querySelector<HTMLButtonElement>('#controls button')!
const containsMessage = (id: string) => [...document.querySelectorAll('article')].some(node => node.getAttribute('data-message-id') === id)
function select(id: string) { update({ snapshot: { ...store.getState().snapshot, selectedSessionId: id } }) }
function resetOlder() { const state = store.getState(); update({ snapshot: { ...state.snapshot, selectedSessionId: session.id, sessions: state.snapshot.sessions.map(item => item.id === session.id ? { ...item, threads: [{ ...thread, messages: oldHistory.messages }] } : item) }, historyByThreadId: { ...state.historyByThreadId, [thread.id]: oldHistory } }) }

;(window as any).longChatReplayCheck = (async () => {
    const checks: string[] = []
    flushSync(() => root.render(<Surface />))
    await until(() => scrollRef.current && button(), 'Real controls must mount')
    await pause(400)
    if (button().textContent !== 'Jump to latest') throw new Error('A resident-window bottom must still offer Jump to latest')
    button().click()
    await until(() => Boolean(delay) && button().disabled, 'Latest shows pending feedback and prevents repeat clicks')
    if (button().textContent !== 'Loading latest…') throw new Error('Pending Latest label is incorrect')
    delay!(); delay = null
    await until(() => follows.length > 0 && containsMessage(sourceMessages.at(-1).id), 'Latest must reveal the actual last source message')
    await pause(500)
    const distance = () => scrollRef.current!.scrollHeight - scrollRef.current!.clientHeight - scrollRef.current!.scrollTop
    if (distance() > 3 || follows.at(-1)?.animated !== false || requests.length !== 1 || requests[0].before || requests[0].after) throw new Error('Latest must use one direct read and an immediate true-tail jump')
    checks.push('false window-bottom -> one direct source-tail read -> actual latest ID, no animation')

    resetOlder(); await pause(250); fail = true
    button().click(); await until(() => Boolean(delay), 'Failure request must start'); delay!(); delay = null
    await until(() => button().textContent === 'Retry jump to latest', 'Failure provides a retry control')
    if (store.getState().historyByThreadId[thread.id]!.messages[0]?.id !== oldHistory.messages[0]?.id) throw new Error('Failed Latest discarded the visible transcript')
    fail = false; button().click(); await until(() => Boolean(delay), 'Retry starts'); delay!(); delay = null
    await until(() => store.getState().historyByThreadId[thread.id]!.pageInfo.hasNewer === false, 'Retry reaches latest')
    checks.push('failure preserves old transcript; retry reaches latest')

    resetOlder(); await pause(250)
    button().click(); await until(() => Boolean(delay), 'Switch race starts')
    select(otherSession.id); await until(() => containsMessage('other-message'), 'Other chat mounts')
    const before = follows.length
    delay!(); delay = null; await pause(350)
    if (store.getState().snapshot.selectedSessionId !== otherSession.id || follows.length !== before || !containsMessage('other-message')) throw new Error('A late Latest reply stole another chat or its viewport')
    select(session.id); await until(() => containsMessage(sourceMessages.at(-1).id), 'Returning sees fetched latest source message')
    checks.push('switch during pending Latest cannot steal destination or its viewport')

    const full = history(sourceMessages, false)
    const state = store.getState()
    update({ historyByThreadId: { ...state.historyByThreadId, [thread.id]: full }, snapshot: { ...state.snapshot, sessions: state.snapshot.sessions.map(item => item.id === session.id ? { ...item, threads: [{ ...thread, messages: full.messages }] } : item) } })
    await pause(300)
    scrollRef.current!.dispatchEvent(new WheelEvent('wheel', { deltaY: -500, bubbles: true }))
    await listRef.current!.scrollToIndex({ index: 0, animated: false })
    await until(() => button().textContent === 'Jump to latest', 'A far loaded target is labeled Jump to latest')
    const requestsBefore = requests.length
    button().click(); await until(() => containsMessage(sourceMessages.at(-1).id) && distance() <= 3, 'Far loaded jump reaches bottom')
    if (requests.length !== requestsBefore || follows.at(-1)?.animated !== false) throw new Error('A far resident jump must not fetch or animate')
    await pause(300)
    scrollRef.current!.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true }))
    scrollRef.current!.scrollTop = Math.max(0, scrollRef.current!.scrollHeight - scrollRef.current!.clientHeight - 150)
    await until(() => button().textContent === 'Scroll to bottom', 'Nearby resident target has Scroll to bottom label')
    checks.push('far resident jump skips fetch/animation; near target uses Scroll to bottom label')
    // Clear the earlier manual wheel intent. This phase must be automatic fill,
    // not a delayed lookahead request caused by the preceding scroll test.
    scrollRef.current!.dispatchEvent(new CustomEvent(ASSISTANT_TIMELINE_FOLLOW_END_EVENT, { detail: { animated: false } }))
    await pause(150)
    contextBackfill = true
    const runningMessages = [
        { ...sourceMessages.at(-2), id: 'running-user', role: 'user', text: 'Continue working.', turnId: 'working-context' },
        { ...sourceMessages.at(-1), id: 'running-response', role: 'assistant', text: 'Working…', turnId: 'working-context', streaming: true }
    ]
    const runningThread = { ...thread, state: 'running', messages: runningMessages, latestTurn: { ...thread.latestTurn, id: 'working-context', state: 'running' } }
    const runningHistory = { ...history(runningMessages, false), shellRevision: getAssistantThreadHydrationRevision(runningThread as any) }
    contextPage = { ...history(sourceMessages.slice(-40, -12), false), pageInfo: { oldestCursor: null, newestCursor: 'working-start', hasOlder: false, hasNewer: false, turnCount: 3 } }
    const running = store.getState()
    const beforeBackfill = requests.length
    update({ snapshot: { ...running.snapshot, sessions: running.snapshot.sessions.map(item => item.id === session.id ? { ...item, threads: [runningThread] } : item) }, historyByThreadId: { ...running.historyByThreadId, [thread.id]: runningHistory } })
    await pause(80)
    scrollRef.current!.dispatchEvent(new CustomEvent(ASSISTANT_TIMELINE_FOLLOW_END_EVENT, { detail: { animated: false } }))
    await until(() => store.getState().historyByThreadId[thread.id]!.messages.length > 2, 'A sparse working view must backfill context without another upward wheel')
    if (requests.length - beforeBackfill > 3) throw new Error('Automatic context fill exceeded its bounded request cap')
    checks.push('sparse working view backfills older context without manual upward scrolling')
    root.unmount()
    return { checks, sourceMessages: sourceMessages.length, requests: requests.map(request => ({ threadId: request.threadId, turnLimit: request.turnLimit, directLatest: !request.before && !request.after })), followEvents: follows, limitations: ['Provider transport is a deferred fixture; actual native pagination is tested separately.', 'This mounts the real store, Latest hook/button and virtual timeline in a hidden window.'] }
})()
