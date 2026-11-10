import assert from 'node:assert/strict'
import { AssistantStore } from '../src/renderer/src/lib/assistant/assistant-store-core'
import { createAssistantDevelopmentChatFixtures } from '../src/main/assistant/development-chat-fixtures'
import { AssistantHistoryReadJournal, replayAssistantHistoryRead } from '../src/renderer/src/lib/assistant/assistant-history-live-read'
import { getAssistantThreadHydrationRevision } from '../src/renderer/src/lib/assistant/assistant-thread-hydration-revision'
import { hasAssistantWarmSelection } from '../src/renderer/src/lib/assistant/assistant-warm-selection'
import { hasUsableAssistantTimelineHistory } from '../src/renderer/src/lib/assistant/assistant-history-readiness'

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
const replacingRead = journal.begin(shell.id)
journal.record(delta(11, ' A'))
journal.record({ sequence: 12, eventId: 'replacement', type: 'thread.updated', occurredAt: live.updatedAt, threadId: shell.id,
    payload: { threadId: shell.id, patch: { messages: [{ ...live, text: 'Before A' }] } } })
journal.record(delta(13, ' B'))
assert.equal(replayAssistantHistoryRead(store.getState().snapshot, basePage, replacingRead).messages[0]!.text, 'Before A B', 'a canonical row replacement is a batching boundary between live deltas')
journal.finish(replacingRead)
journal.finish(read)
const deletingRead = journal.begin(shell.id)
journal.record(delta(11, ' obsolete'))
journal.record({ sequence: 12, eventId: 'delete-before-next-delta', type: 'thread.updated', occurredAt: live.updatedAt, threadId: shell.id,
    payload: { threadId: shell.id, removedMessageIds: [live.id], patch: {} } })
journal.record(delta(13, ' New'))
assert.equal(replayAssistantHistoryRead(store.getState().snapshot, basePage, deletingRead).messages[0]!.text, ' New', 'a deletion cannot move an obsolete delta into the recreated row')
journal.finish(deletingRead)
const removalRead = journal.begin(shell.id)
journal.record(delta(11, ' appended'))
journal.record({ sequence: 12, eventId: 'delete', type: 'thread.updated', occurredAt: live.updatedAt, threadId: shell.id, payload: { threadId: shell.id, removedMessageIds: [live.id], patch: {} } })
assert.equal(replayAssistantHistoryRead(store.getState().snapshot, basePage, removalRead).messages.length, 0, 'a deletion arriving during a read cannot resurrect a row')
journal.finish(removalRead)
journal.record(delta(13, ' after release'))
assert.equal(removalRead.events.length, 2, 'completed reads release their event journal')

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

const legacyId = 'legacy-cache-thread'
const legacy = { ...live, id: 'assistant-message-legacy-cache', text: 'AB', streaming: false }
const legacyThread = { ...fullThread, id: legacyId, state: 'ready', latestTurn: null, messages: [], activities: [], proposedPlans: [], messageCount: 1, activityCount: 0, proposedPlanCount: 0,
    hasActivePlan: false, hasPendingApprovals: false, hasPendingUserInputs: false, activePlan: null, pendingApprovals: [], pendingUserInputs: [] }
;(store as any).state = { ...store.getState(),
    snapshot: { ...store.getState().snapshot, sessions: [...store.getState().snapshot.sessions, { ...session, id: 'legacy-cache-session', activeThreadId: legacyId, threadIds: [legacyId], threads: [legacyThread] }] },
    historyByThreadId: { ...store.getState().historyByThreadId, [legacyId]: { ...retained, threadId: legacyId, messages: [legacy], activities: [], proposedPlans: [] } }
}
for (const text of ['A', 'B', 'C']) {
    const event = delta(++sequence, text)
    event.threadId = legacyId
    event.payload.threadId = legacyId
    event.payload.messageId = 'canonical-legacy-current'
    ;(store as any).queueAssistantEvent(event)
}
;(store as any).flushPendingAssistantEvents()
const legacyHistory = store.getState().historyByThreadId[legacyId]!
assert.deepEqual(legacyHistory.messages.map(message => [message.id, message.text]), [['canonical-legacy-current', 'ABC']], 'inactive retained legacy rows are materialized before deciding whether live replay can coalesce')
assert.equal(store.getState().snapshot.sessions.find(session => session.id === 'legacy-cache-session')!.threads[0]!.messages.length, 0, 'inactive legacy recovery preserves timeline dematerialization')
console.log('Live history read: authoritative history plus in-flight stream delta without retry or lost text: ok')

const beforeNonProgress = store.getState().historyByThreadId[shell.id]!
;(store as any).state = { ...store.getState(), selectionHydrationKey: null, selectionTransitionKey: null,
    historyByThreadId: { ...store.getState().historyByThreadId, [shell.id]: { ...beforeNonProgress, pageInfo: { ...beforeNonProgress.pageInfo, hasOlder: true, oldestCursor: 'repeated-cursor' } } } }
;(globalThis as any).window.devscope.assistant.getHistoryPage = async () => ({ success: true, page: { ...basePage, snapshotSequence: sequence,
    messages: beforeNonProgress.messages, activities: beforeNonProgress.activities,
    pageInfo: { ...beforeNonProgress.pageInfo, hasOlder: true, oldestCursor: 'repeated-cursor' } } })
assert.equal(await store.loadOlderHistory(shell.id), false, 'a repeated frontier stops initial fill without an arbitrary page-count cap')
assert.ok(store.getState().historyByThreadId[shell.id]?.loadOlderError, 'a genuinely non-progressing page exposes retry rather than claiming the whole chat loaded')

// Settings can release Chat's event stream after the final-answer placeholder
// exists, before its text/completion events arrive. The returning shell may
// have the same history timestamp/counts, but now advertises a finished answer.
for (const cachedAnswer of ['missing', 'empty', 'empty-settled', 'streaming', 'complete'] as const) {
    const final = { ...live, id: 'navigation-final', text: 'Finished background work.', streaming: false, phase: 'final_answer' as const }
    const prior = fullThread.messages.filter(message => message.id !== final.id)
    const cachedMessages = [...prior, ...(cachedAnswer === 'missing' ? [] : [{ ...final,
        text: cachedAnswer.startsWith('empty') ? '' : cachedAnswer === 'streaming' ? 'Finished' : final.text,
        streaming: cachedAnswer === 'empty' || cachedAnswer === 'streaming' }])]
    const completed = { ...shell, messages: cachedMessages, state: 'ready' as const, messageCount: prior.length + 1,
        latestTurn: { id: final.turnId || 'navigation-turn', state: 'completed' as const, requestedAt: final.createdAt,
            startedAt: final.createdAt, completedAt: final.updatedAt, assistantMessageId: final.id } }
    const history = { ...beforeNonProgress, messages: cachedMessages, activities: [], proposedPlans: [],
        pageInfo: { oldestCursor: 'navigation-start', newestCursor: null, hasOlder: false, hasNewer: false, turnCount: 1 },
        fullyLoaded: true, lastUsedAt: Date.now(), shellRevision: getAssistantThreadHydrationRevision(completed) }
    const snapshot = { ...store.getState().snapshot, selectedSessionId: session.id, sessions: [{ ...session, threads: [completed] }] }
    const warm = hasAssistantWarmSelection({ snapshot, sessionId: session.id, threadId: shell.id,
        historyByThreadId: { [shell.id]: history }, hydratedThreadCache: new Map() })
    assert.equal(warm, cachedAnswer === 'complete', `${cachedAnswer}: a current shell cannot validate an absent or unfinished final answer`)
    assert.equal(hasUsableAssistantTimelineHistory({ ...history, pageInfo: { hasNewer: true } }, completed), true,
        'a deliberate older page remains usable without the newest answer')
    assert.equal(hasUsableAssistantTimelineHistory(history, { ...completed, latestTurn: { ...completed.latestTurn, state: 'running' } }), true,
        'ongoing work may retain its unfinished answer without forcing reloads')
    assert.equal(hasUsableAssistantTimelineHistory(history, { ...completed, latestTurn: { ...completed.latestTurn, assistantMessageId: null } }), true,
        'a completed tool-only turn need not invent an answer')
    assert.equal(hasUsableAssistantTimelineHistory({ ...history, messages: [{ ...final, providerItemId: 'zyra-message:assistant:123' }] },
        { ...completed, latestTurn: { ...completed.latestTurn, assistantMessageId: 'pi-message:assistant:123' } }), true,
        'canonical/provider/legacy answer references use the existing identity resolver')
    const cachedThread = { ...completed, messages: [] }
    const cachedSnapshot = { ...snapshot, sessions: [{ ...session, threads: [cachedThread] }] }
    const hydratedThreadCache = new Map([[shell.id, { ...completed, sessionId: session.id, threadId: shell.id,
        revision: getAssistantThreadHydrationRevision(completed) }]])
    assert.equal(hasAssistantWarmSelection({ snapshot: cachedSnapshot, sessionId: session.id, threadId: shell.id,
        historyByThreadId: {}, hydratedThreadCache }), cachedAnswer === 'complete', 'the synchronous preview cache must apply the same completeness check')
    const returned = new AssistantStore()
    const beforeNavigation = { ...completed, state: 'running' as const, latestTurn: { ...completed.latestTurn, state: 'running' as const, completedAt: null } }
    assert.equal(getAssistantThreadHydrationRevision(beforeNavigation), history.shellRevision,
        'the completion edge really can keep the same timestamp/count cache revision')
    ;(returned as any).state = { ...returned.getState(), hydrated: true,
        snapshot: { ...snapshot, sessions: [{ ...session, threads: [beforeNavigation] }] }, historyByThreadId: { [shell.id]: history } }
    let reads = 0
    window.devscope.assistant.bootstrap = async () => ({ status: returned.getState().status,
        snapshot: { ...snapshot, sessions: [{ ...session, threads: [{ ...completed, messages: [], activities: [], proposedPlans: [] }] }] } })
    window.devscope.assistant.getThreadDetailBootstrap = async () => {
        reads++
        return { success: true, detail: { threadId: shell.id, activePlan: null, pendingApprovals: [], pendingUserInputs: [],
            history: { ...history, messages: [...prior, final] } } }
    }
    await returned.hydrate()
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(reads, cachedAnswer === 'complete' ? 0 : 1, `${cachedAnswer}: recover incomplete background completion once; keep complete warm history instant`)
    assert.equal(returned.getState().snapshot.sessions[0]!.threads[0]!.messages.at(-1)!.text, final.text)
}
console.log('Background completion navigation: incomplete warm answers rehydrate; complete warm answers stay immediate: ok')
