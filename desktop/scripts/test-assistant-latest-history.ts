import assert from 'node:assert/strict'
import { createAssistantLongHistoryFixture } from './fixtures/assistant-long-history-fixture'
import { getAssistantThreadHydrationRevision } from '../src/renderer/src/lib/assistant/assistant-thread-hydration-revision'
import { resolveAssistantTimelineLatestAction } from '../src/renderer/src/pages/assistant/assistant-timeline-latest-policy'
import { applyAssistantLatestHistoryPage } from '../src/renderer/src/lib/assistant/assistant-latest-history'
const snapshot = createAssistantLongHistoryFixture(12)
const thread = snapshot.sessions[0]!.threads[0]!
const stateHistory = (start: number, end: number, hasNewer: boolean) => ({ threadId: thread.id, messages: thread.messages.slice(start * 2, end * 2), activities: thread.activities.slice(start * 4, end * 4), proposedPlans: [], initialLoading: false, loadingOlder: false, loadingNewer: false, loadOlderError: null, loadNewerError: null, fullyLoaded: false, pageInfo: { oldestCursor: `before-${start}`, newestCursor: hasNewer ? `after-${end}` : null, hasOlder: true, hasNewer, turnCount: end - start }, lastUsedAt: Date.now(), shellRevision: getAssistantThreadHydrationRevision(thread) })
const old = stateHistory(2, 5, true), newest = stateHistory(9, 12, false)
const requests: any[] = []
let readPage = async (_input: any): Promise<any> => ({ success: true, page: newest })
Object.defineProperty(globalThis, 'window', { configurable: true, value: { setTimeout, clearTimeout, requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout, devscope: { assistant: { getHistoryPage: (input: any) => { requests.push(input); return readPage(input) } } } } })
const { AssistantStore } = await import('../src/renderer/src/lib/assistant/assistant-store-core')
function setup() {
    const store = new AssistantStore()
    const current = store.getState()
    ;(store as any).state = { ...current, hydrated: true, snapshot: { ...snapshot, sessions: [{ ...snapshot.sessions[0], threads: [{ ...thread, messages: old.messages, activities: old.activities }] }] }, historyByThreadId: { [thread.id]: old } }
    return store
}
const store = setup()
assert.equal(await store.loadLatestHistory(thread.id), true)
assert.equal(requests.length, 1, 'Latest fetches the newest page directly, independent of distance')
assert.deepEqual(requests[0], { threadId: thread.id, turnLimit: 3 })
assert.deepEqual(store.getState().historyByThreadId[thread.id]!.messages.map(message => message.id), newest.messages.map(message => message.id))
assert.equal(store.getState().historyByThreadId[thread.id]!.pageInfo.hasNewer, false, 'Latest reaches the actual tail, not the current resident end')
assert.equal(await store.loadLatestHistory(thread.id), true)
assert.equal(requests.length, 1, 'a resident true tail needs no fetch')
const defer = <T,>() => { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const streamingStore = setup(), streamingPage = defer<any>()
readPage = () => streamingPage.promise
const liveRead = streamingStore.loadLatestHistory(thread.id)
const assistantReply = newest.messages.at(-1)!
const watermark = snapshot.snapshotSequence + 1
;(streamingStore as any).queueAssistantEvent({ type: 'thread.message.assistant.delta', sequence: watermark + 1,
    eventId: 'detached-reply-update', occurredAt: new Date(Date.parse(assistantReply.updatedAt) + 1000).toISOString(),
    sessionId: snapshot.sessions[0]!.id, threadId: thread.id, payload: { threadId: thread.id, messageId: assistantReply.id, delta: ' live suffix' } })
streamingPage.resolve({ success: true, page: { ...newest, snapshotSequence: watermark } })
assert.equal(await liveRead, true)
assert.equal(streamingStore.getState().historyByThreadId[thread.id]!.messages.at(-1)!.text, assistantReply.text + ' live suffix', 'Latest replays the in-flight delta for a nonresident reply exactly once')
for (const rejectOlder of [false, true]) {
    const racing = setup(), older = defer<any>()
    readPage = input => input.before ? older.promise : Promise.resolve({ success: true, page: newest })
    const oldRequest = racing.loadOlderHistory(thread.id)
    await Promise.resolve() // The old page is in flight before the later Latest intent.
    await racing.loadLatestHistory(thread.id)
    if (rejectOlder) older.reject(new Error('obsolete old-page error'))
    else older.resolve({ success: true, page: old })
    await oldRequest
    const history = racing.getState().historyByThreadId[thread.id]!
    assert.deepEqual(history.messages.map(message => message.id), newest.messages.map(message => message.id), 'an old page or error cannot undo Latest')
    assert.equal(history.loadOlderError, null)
}
const duplicate = setup(), waiting = defer<any>()
readPage = () => waiting.promise
const count = requests.length
const first = duplicate.loadLatestHistory(thread.id), second = duplicate.loadLatestHistory(thread.id)
assert.equal(requests.length, count + 1, 'duplicate Latest shares one request')
waiting.resolve({ success: true, page: newest })
assert.deepEqual(await Promise.all([first, second]), [true, true])
const failed = setup()
readPage = async () => ({ success: false, error: 'offline' })
assert.equal(await failed.loadLatestHistory(thread.id), false)
assert.deepEqual(failed.getState().historyByThreadId[thread.id]!.messages, old.messages, 'a failed Latest preserves the visible transcript')
assert.equal(failed.getState().historyByThreadId[thread.id]!.loadNewerError, 'offline')
readPage = async () => ({ success: true, page: newest })
assert.equal(await failed.loadLatestHistory(thread.id), true, 'Latest can be retried')
const lateBootstrap = setup(), bootstrap = defer<any>()
;(window.devscope.assistant as any).getThreadDetailBootstrap = () => bootstrap.promise
const hydrating = (lateBootstrap as any).requestSessionHydration(snapshot.sessions[0]!.id, thread.id, 0, true)
await lateBootstrap.loadLatestHistory(thread.id)
bootstrap.resolve({ success: true, detail: { threadId: thread.id, history: old, pendingApprovals: [], pendingUserInputs: [], activePlan: null } })
await hydrating
assert.equal(lateBootstrap.getState().historyByThreadId[thread.id]!.pageInfo.hasNewer, false, 'late detail hydration cannot undo explicit Latest')
const switched = setup(), switching = defer<any>()
readPage = () => switching.promise
const switchingLoad = switched.loadLatestHistory(thread.id)
const state = switched.getState()
const other = { ...snapshot.sessions[0]!, id: 'other-session', activeThreadId: 'other-thread', threads: [{ ...thread, id: 'other-thread', messages: [], activities: [] }] }
;(switched as any).state = { ...state, snapshot: { ...state.snapshot, selectedSessionId: other.id, sessions: [...state.snapshot.sessions, other] } }
switching.resolve({ success: true, page: newest }); await switchingLoad
assert.equal(switched.getState().snapshot.selectedSessionId, other.id, 'Latest completion never changes the selected chat')
assert.equal(switched.getState().snapshot.sessions.find(session => session.id === other.id)!.threads[0]!.messages.length, 0)
assert.deepEqual(resolveAssistantTimelineLatestAction({ hasNewer: true, distanceFromBottom: 0, viewportHeight: 800 }), { label: 'Jump to latest', animated: false })
assert.deepEqual(resolveAssistantTimelineLatestAction({ hasNewer: false, distanceFromBottom: 20_000, viewportHeight: 800 }), { label: 'Jump to latest', animated: false })
assert.deepEqual(resolveAssistantTimelineLatestAction({ hasNewer: false, distanceFromBottom: 500, viewportHeight: 800 }), { label: 'Scroll to bottom', animated: true })
const completedActivity = { ...newest.activities.at(-1)!, payload: { status: 'completed', toolLifecyclePhase: 'end', completedAt: '2026-12-01T00:00:00Z' } }
const updatedMessage = { ...newest.messages.at(-1)!, text: 'Live text arrived during Latest.', updatedAt: '2026-12-01T00:00:00Z' }
const fresh = { ...newest, messages: [...newest.messages.slice(0, -1), updatedMessage], activities: [...newest.activities.slice(0, -1), completedActivity] }
const merged = applyAssistantLatestHistoryPage(snapshot, fresh, { ...newest, activities: newest.activities.map(activity => ({ ...activity, payload: { status: 'running' } })) })
assert.equal(merged.history.messages.at(-1)?.text, updatedMessage.text, 'Latest cannot regress live text that arrived during its read')
assert.equal(merged.history.activities.at(-1)?.payload?.status, 'completed', 'Latest cannot restart a completed live tool from a stale page')
const syncFailure = setup()
readPage = () => { throw new Error('synchronous preload failure') }
await syncFailure.loadOlderHistory(thread.id)
const afterFailure = requests.length
readPage = async () => ({ success: true, page: old })
await syncFailure.loadOlderHistory(thread.id)
assert.equal(requests.length, afterFailure + 1, 'a synchronous preload failure cannot leave the paging lock permanently occupied')
console.log('Latest history: direct tail, duplicate/retry, late page/error/bootstrap, chat switching and distance labels passed')
