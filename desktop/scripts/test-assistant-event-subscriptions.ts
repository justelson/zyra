import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mock } from 'bun:test'
import { ASSISTANT_IPC, type AssistantDomainEvent } from '../src/shared/assistant/contracts'
import { createDefaultAssistantSnapshot } from '../src/shared/assistant/projector'
import { createAssistantThread } from '../src/main/assistant/service-state'
import { createAssistantSessionRecord, createRunningLatestTurn } from '../src/main/assistant/service-records'
import { isAssistantThreadActivelyWorking } from '../src/renderer/src/lib/assistant/selectors'
import { resolveAssistantThreadStatusPill } from '../src/renderer/src/pages/assistant/assistant-sessions-rail-utils'

// Model Electron's actual per-WebContents Set membership: a second subscriber
// doesn't acquire a second server-side subscription.
const ipc = new EventEmitter()
let nativeSubscribed = false
const calls: string[] = []
mock.module('electron', () => ({
    webUtils: {},
    ipcRenderer: {
        on: (channel: string, listener: (...args: any[]) => void) => ipc.on(channel, listener),
        removeListener: (channel: string, listener: (...args: any[]) => void) => ipc.removeListener(channel, listener),
        invoke: async (channel: string) => {
            calls.push(channel)
            if (channel === ASSISTANT_IPC.subscribe) nativeSubscribed = true
            if (channel === ASSISTANT_IPC.unsubscribe) nativeSubscribed = false
            return { success: true }
        }
    }
}))
const { createAssistantAdapter } = await import('../src/preload/adapters/assistant-adapter')
const { AssistantStore } = await import('../src/renderer/src/lib/assistant/assistant-store-core')
const { subscribeSettingsModels } = await import('../src/renderer/src/pages/settings/settings-model-catalog-cache')
const adapter = createAssistantAdapter().assistant
;(globalThis as any).window = {
    devscope: { assistant: adapter },
    requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0),
    cancelAnimationFrame: clearTimeout,
    setTimeout,
    clearTimeout
}

const now = '2026-10-01T12:00:00.000Z'
const thread = createAssistantThread(now)
const session = createAssistantSessionRecord({ sessionId: 'subscription-chat', title: 'Chat', projectPath: null, createdAt: now, thread })
const snapshot = { ...createDefaultAssistantSnapshot(), sessions: [session], selectedSessionId: session.id }
const store = new AssistantStore()
// Seed a hydrated chat, then use the real store's event stream and projector.
;(store as any).state = { ...store.getState(), snapshot, hydrated: true }
;(store as any).ensureEventStream()
let sequence = 0
function deliver(type: AssistantDomainEvent['type'], payload: Record<string, unknown>) {
    const event: AssistantDomainEvent = { sequence: ++sequence, eventId: `event-${sequence}`, type, occurredAt: now, sessionId: session.id, threadId: thread.id, payload }
    if (nativeSubscribed) ipc.emit(ASSISTANT_IPC.eventStream, {}, { event })
    ;(store as any).flushPendingAssistantEvents()
}
const readThread = () => store.getState().snapshot.sessions[0]!.threads[0]!
const running = createRunningLatestTurn('subscription-turn', now)
deliver('thread.updated', { threadId: thread.id, patch: { state: 'running' } })
deliver('thread.latest-turn.updated', { threadId: thread.id, latestTurn: running })
assert.equal(readThread().latestTurn?.state, 'running', 'chat initially receives live events')
assert.equal(resolveAssistantThreadStatusPill(readThread(), true)?.label, 'Working')

// Reproduce staying in Chat while the settings model catalog mounts and leaves.
const closeSettings = subscribeSettingsModels(() => {})
closeSettings()
deliver('thread.message.assistant.delta', { threadId: thread.id, messageId: 'subscription-answer', turnId: running.id, phase: 'final_answer', delta: 'Finished answer' })
deliver('thread.message.assistant.completed', {
    threadId: thread.id,
    messageId: 'subscription-answer', text: 'Finished answer',
    message: { id: 'subscription-answer', role: 'assistant', phase: 'final_answer', text: 'Finished answer', turnId: running.id, streaming: false, createdAt: now, updatedAt: now }
})
deliver('thread.updated', { threadId: thread.id, patch: { state: 'ready' } })
deliver('thread.latest-turn.updated', { threadId: thread.id, latestTurn: { ...running, state: 'completed', completedAt: now } })
assert.equal(readThread().latestTurn?.state, 'completed', 'leaving model settings must not strand the live chat on Working')
assert.equal(readThread().messages.at(-1)?.text, 'Finished answer', 'the final answer arrives without switching chats')
assert.equal(readThread().state, 'ready', 'the composer and sidebar receive completion together')
assert.equal(isAssistantThreadActivelyWorking(readThread()), false)
assert.notEqual(resolveAssistantThreadStatusPill(readThread(), true)?.label, 'Working')

for (let visit = 0; visit < 100; visit++) {
    const leave = subscribeSettingsModels(() => {})
    leave()
    leave()
    assert.equal(nativeSubscribed, true, 'repeated/idempotent settings cleanup keeps the chat subscription alive')
}
assert.equal(calls.filter(channel => channel === ASSISTANT_IPC.subscribe).length, 1, 'one native subscription serves concurrent consumers')
assert.equal(calls.filter(channel => channel === ASSISTANT_IPC.unsubscribe).length, 0)
store.release()
assert.equal(nativeSubscribed, false, 'the final chat consumer releases the native subscription')
assert.equal(ipc.listenerCount(ASSISTANT_IPC.eventStream), 0, 'no event listener leaks after all consumers leave')

let catalogUpdates = 0
const leaveCatalog = subscribeSettingsModels(() => { catalogUpdates++ })
const secondChat = adapter.onEvent(() => {})
secondChat()
ipc.emit(ASSISTANT_IPC.eventStream, {}, { event: { type: 'models.updated', payload: { models: [] } } })
assert.equal(catalogUpdates, 1, 'leaving Chat also preserves the remaining real settings consumer')
leaveCatalog()
assert.equal(nativeSubscribed, false)

// Both mount orders, same callback identity, last-consumer cleanup and remount.
for (const leaveFirst of [0, 1]) {
    let received = 0
    const callback = () => { received++ }
    const leave = [adapter.onEvent(callback), adapter.onEvent(callback)]
    leave[leaveFirst]!()
    leave[leaveFirst]!()
    assert.equal(nativeSubscribed, true)
    ipc.emit(ASSISTANT_IPC.eventStream, {}, { events: [] })
    assert.equal(received, 1, 'only the remaining callback receives the payload')
    leave[1 - leaveFirst]!()
    assert.equal(nativeSubscribed, false)
    assert.equal(ipc.listenerCount(ASSISTANT_IPC.eventStream), 0)
}
console.log('Assistant event subscription ownership: ok (real preload, settings cache and chat store)')
