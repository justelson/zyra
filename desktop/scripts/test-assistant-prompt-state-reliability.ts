import assert from 'node:assert/strict'
import { createAssistantThread } from '../src/main/assistant/service-state'
import { createAssistantSessionRecord, createAssistantUserMessage, createRunningLatestTurn } from '../src/main/assistant/service-records'
import { createDefaultAssistantSnapshot, applyAssistantDomainEvents } from '../src/shared/assistant/projector'
import type { AssistantDomainEvent } from '../src/shared/assistant/contracts'

const at = '2026-10-06T12:00:00Z'
const thread = createAssistantThread(at)
const session = createAssistantSessionRecord({ sessionId: 'prompt-state-chat', title: 'Prompt test', projectPath: null, thread, createdAt: at })
const initial = { ...createDefaultAssistantSnapshot(), selectedSessionId: session.id, sessions: [session] }
const user = { ...createAssistantUserMessage('Repair the prompt UI', at, 'prompt-state-message'), turnId: 'prompt-state-turn' }
const events: AssistantDomainEvent[] = [
    { eventId: 'prompt-user', sequence: 1, type: 'thread.message.user', occurredAt: at, sessionId: session.id, threadId: thread.id, payload: { threadId: thread.id, message: user } },
    { eventId: 'prompt-turn', sequence: 2, type: 'thread.latest-turn.updated', occurredAt: at, sessionId: session.id, threadId: thread.id, payload: { threadId: thread.id, latestTurn: createRunningLatestTurn(user.turnId, at) } }
]
const canonical = applyAssistantDomainEvents(initial, events)
const status = { available: true, connected: true, connecting: false, selectedSessionId: session.id, activeThreadId: thread.id, providerThreadId: null, message: null }
let listener: ((payload: { events: AssistantDomainEvent[] }) => void) | null = null
let frames: FrameRequestCallback[] = []
let bootstrap = async () => ({ snapshot: initial, status })
let delivery: 'all' | 'user-only' | 'none' = 'all'
let promptSent = false
let snapshotReads = 0
let statusResponse = async () => status
const detail = () => ({ threadId: thread.id, activePlan: null, pendingApprovals: [], pendingUserInputs: [], history: {
    threadId: thread.id, messages: promptSent ? [user] : [], activities: [], proposedPlans: [], initialLoading: false, loadingOlder: false, loadingNewer: false,
    loadOlderError: null, loadNewerError: null, fullyLoaded: true,
    pageInfo: { oldestCursor: null, newestCursor: null, hasOlder: false, hasNewer: false, turnCount: 1 }
} })
Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    requestAnimationFrame: (callback: FrameRequestCallback) => frames.push(callback), cancelAnimationFrame: () => {}, setTimeout, clearTimeout,
    devscope: { assistant: {
        bootstrap: () => bootstrap(), onEvent: (callback: typeof listener) => { listener = callback; return () => { listener = null } },
        getStatus: () => statusResponse(),
        getSnapshot: async () => { snapshotReads++; return canonical },
        getThreadDetailBootstrap: async () => ({ success: true, detail: detail() }),
        sendPrompt: async () => { promptSent = true; if (delivery !== 'none') listener?.({ events: delivery === 'all' ? events : events.slice(0, 1) }); return { success: true, sessionId: session.id, threadId: thread.id, turnId: user.turnId } }
    } }
} })
const { AssistantStore } = await import('../src/renderer/src/lib/assistant/assistant-store-core')
const store = new AssistantStore()
store.retain(); await store.hydrate()
let resolveBootstrap!: (value: { snapshot: typeof initial; status: typeof status }) => void
bootstrap = () => new Promise(resolve => { resolveBootstrap = resolve })
const refreshing = store.hydrate()
promptSent = true; listener?.({ events })
assert.equal(store.getState().snapshot.sessions[0]?.threads[0]?.latestTurn?.id, user.turnId, 'turn lifecycle becomes visible immediately without waiting for a rendering frame')
for (const callback of frames.splice(0)) callback(performance.now())
assert.equal(store.getState().snapshot.snapshotSequence, 2)
resolveBootstrap({ snapshot: initial, status }); await refreshing
assert.equal(store.getState().snapshot.snapshotSequence, 2, 'an older bootstrap cannot rewind live prompt state')
assert.equal(store.getState().snapshot.sessions[0]?.threads[0]?.messages[0]?.id, user.id, 'an in-flight refresh cannot erase the sent prompt')
// A gap seen during an existing read needs a fresh read after that one.
const completedEvent: AssistantDomainEvent = { ...events[1]!, eventId: 'prompt-completed', sequence: 4,
    payload: { threadId: thread.id, latestTurn: { ...createRunningLatestTurn(user.turnId, at), state: 'completed', completedAt: at } } }
const completedSnapshot = applyAssistantDomainEvents(canonical, [completedEvent])
let bootstrapCalls = 0
bootstrap = () => ++bootstrapCalls === 1
    ? new Promise(resolve => { resolveBootstrap = resolve })
    : Promise.resolve({ snapshot: completedSnapshot, status })
const olderRecovery = store.hydrate()
listener?.({ events: [completedEvent] })
resolveBootstrap({ snapshot: canonical, status }); await olderRecovery
for (let tick = 0; tick < 20 && store.getState().snapshot.snapshotSequence < 4; tick++) await new Promise(resolve => setTimeout(resolve, 0))
assert.equal(store.getState().snapshot.sessions[0]?.threads[0]?.latestTurn?.state, 'completed', 'a gap during hydration cannot strand the final state behind the in-flight snapshot')
assert.equal(bootstrapCalls, 2, 'gap recovery coalesces to one fresh snapshot')
store.release()

bootstrap = async () => ({ snapshot: initial, status })
for (const sendsEvents of ['all', 'user-only', 'none'] as const) {
    delivery = sendsEvents; snapshotReads = 0; promptSent = false
    const next = new AssistantStore(); next.retain(); await next.hydrate()
    frames = []
    const sent = await next.sendPrompt(user.text)
    assert.equal(sent.success, true)
    assert.equal(next.getState().snapshot.sessions[0]?.threads[0]?.latestTurn?.id, user.turnId, 'acknowledgement exposes the real running turn even without animation frames or IPC events')
    assert.equal(next.getState().snapshot.sessions[0]?.threads[0]?.messages[0]?.id, user.id, 'acknowledgement recovers the persisted prompt without reload')
    assert.equal(snapshotReads, sendsEvents === 'all' ? 0 : 1, 'healthy delivery avoids a recovery snapshot')
    next.release()
}
delivery = 'none'; promptSent = false
const slowStatus = new AssistantStore(); slowStatus.retain(); await slowStatus.hydrate()
let releaseStatus!: (value: typeof status) => void
statusResponse = () => new Promise(resolve => { releaseStatus = resolve })
const sending = slowStatus.sendPrompt(user.text)
for (let tick = 0; tick < 20 && !releaseStatus; tick++) await new Promise(resolve => setTimeout(resolve, 0))
assert.equal(slowStatus.getState().snapshot.sessions[0]?.threads[0]?.latestTurn?.id, user.turnId, 'the visible acknowledged turn recovers before a slow status request settles')
releaseStatus(status); await sending; slowStatus.release()
console.log('Prompt UI state: stale snapshot, pending frame, missed event and acknowledgement recovery: ok')
