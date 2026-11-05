import assert from 'node:assert/strict'
import { AssistantStore } from '../src/renderer/src/lib/assistant/assistant-store-core'
import { createAssistantDevelopmentChatFixtures } from '../src/main/assistant/development-chat-fixtures'
import { AssistantHistoryReadJournal, replayAssistantHistoryRead } from '../src/renderer/src/lib/assistant/assistant-history-live-read'

const fixture = createAssistantDevelopmentChatFixtures({ cwd: 'C:/fixture', now: Date.parse('2026-11-05T00:00:00Z') })
const session = fixture.sessions[0]!
const fullThread = session.threads[0]!
const live = { ...fullThread.messages.at(-1)!, id: 'live-answer', role: 'assistant' as const, text: 'Before', streaming: true }
const shell = { ...fullThread, state: 'running', messages: [live], activities: [], proposedPlans: [] }
const store = new AssistantStore()
;(store as any).state = { ...store.getState(), hydrated: true, snapshot: { ...store.getState().snapshot, selectedSessionId: session.id, sessions: [{ ...session, threads: [shell] }] } }
let calls = 0
let sequence = 0
;(globalThis as any).window = {
    setTimeout, clearTimeout,
    requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout,
    devscope: { assistant: { getThreadDetailBootstrap: async () => {
        calls++
        const watermark = sequence
        const storedLive = { ...store.getState().snapshot.sessions[0]!.threads[0]!.messages.find(message => message.id === live.id)! }
        const event = { sequence: ++sequence, eventId: `event-${sequence}`, type: 'thread.message.assistant.delta', occurredAt: new Date(Date.parse(live.updatedAt) + sequence * 1000).toISOString(),
            sessionId: session.id, threadId: shell.id, payload: { threadId: shell.id, messageId: live.id, delta: ' after' } }
        ;(store as any).queueAssistantEvent(event)
        ;(store as any).flushPendingAssistantEvents()
        return { success: true, detail: { threadId: shell.id, activePlan: null, pendingApprovals: [], pendingUserInputs: [], history: {
            threadId: shell.id, snapshotSequence: watermark, messages: [...fullThread.messages, storedLive], activities: [], proposedPlans: [],
            pageInfo: { oldestCursor: 'oldest', newestCursor: null, hasOlder: false, hasNewer: false, turnCount: 3 },
            initialLoading: false, loadingOlder: false, loadingNewer: false, loadOlderError: null, loadNewerError: null, fullyLoaded: true
        } } }
    } } }
}
await (store as any).requestSessionHydration(session.id, shell.id)
assert.equal(calls, 1, 'a live append during the read must not discard/retry the authoritative history')
const loaded = store.getState().snapshot.sessions[0]!.threads[0]!
assert.ok(loaded.messages.some(message => message.id === fullThread.messages[0]!.id), 'cold hydration restores the older conversation while work continues')
assert.equal(loaded.messages.find(message => message.id === live.id)?.text, 'Before after', 'replay only events newer than the persisted read, exactly once')
assert.equal(store.getState().selectionHydrationKey, null)

const journal = new AssistantHistoryReadJournal()
const read = journal.begin(shell.id)
const basePage = { threadId: shell.id, snapshotSequence: 10, messages: [live], activities: [], proposedPlans: [], pageInfo: { oldestCursor: 'oldest', newestCursor: null, hasOlder: false, hasNewer: false, turnCount: 1 } }
const delta = (sequence: number, text: string) => ({ sequence, eventId: `event-${sequence}`, type: 'thread.message.assistant.delta' as const, occurredAt: live.updatedAt, threadId: shell.id, payload: { threadId: shell.id, messageId: live.id, delta: text } })
journal.record(delta(10, ' already persisted'))
journal.record(delta(11, ' appended'))
const replayed = replayAssistantHistoryRead(store.getState().snapshot, basePage, read)
assert.equal(replayed.messages[0]!.text, 'Before appended', 'the watermark excludes events already present in the database read')
journal.record({ sequence: 12, eventId: 'delete', type: 'thread.updated', occurredAt: live.updatedAt, threadId: shell.id, payload: { threadId: shell.id, removedMessageIds: [live.id], patch: {} } })
assert.equal(replayAssistantHistoryRead(store.getState().snapshot, basePage, read).messages.length, 0, 'a deletion arriving during a read cannot resurrect a row')
journal.finish(read)
journal.record(delta(13, ' after release'))
assert.equal(read.events.length, 3, 'completed reads release their event journal')

// Older paging must survive a simultaneous newer stream update without applying
// the newest delta twice or abandoning the requested older cursor.
const retained = store.getState().historyByThreadId[shell.id]!
;(store as any).state = { ...store.getState(), historyByThreadId: { [shell.id]: { ...retained, pageInfo: { ...retained.pageInfo, hasOlder: true } } } }
const oldMessage = { ...live, id: 'previous-turn', role: 'user' as const, text: 'Previous prompt', streaming: false, createdAt: '2026-01-01T00:00:00.000Z' }
;(globalThis as any).window.devscope.assistant.getHistoryPage = async () => {
    const watermark = sequence
    ;(store as any).queueAssistantEvent(delta(++sequence, ' paging'))
    ;(store as any).flushPendingAssistantEvents()
    return { success: true, page: { ...basePage, snapshotSequence: watermark, messages: [oldMessage] } }
}
await store.loadOlderHistory(shell.id)
const paged = store.getState().snapshot.sessions[0]!.threads[0]!
assert.ok(paged.messages.some(message => message.id === oldMessage.id))
assert.equal(paged.messages.find(message => message.id === live.id)?.text, 'Before after paging', 'older paging neither loses nor duplicates concurrent live text')

let invalidatedCalls = 0
;(globalThis as any).window.devscope.assistant.getThreadDetailBootstrap = async () => {
    invalidatedCalls++
    const current = store.getState().snapshot.sessions[0]!.threads[0]!
    if (invalidatedCalls === 1) (store as any).historyReads.invalidate()
    return { success: true, detail: { threadId: shell.id, activePlan: null, pendingApprovals: [], pendingUserInputs: [], history: {
        ...store.getState().historyByThreadId[shell.id], snapshotSequence: sequence,
        messages: invalidatedCalls === 1 ? [live] : current.messages
    } } }
}
await (store as any).requestSessionHydration(session.id, shell.id, 0, true)
assert.equal(invalidatedCalls, 2, 'an invalidated journal retries even when the canonical shell revision did not change')
assert.equal(store.getState().snapshot.sessions[0]!.threads[0]!.messages.find(message => message.id === live.id)?.text, 'Before after paging', 'invalidated reads cannot overwrite newer live text')
console.log('Live history read: authoritative history plus in-flight stream delta without retry or lost text: ok')
