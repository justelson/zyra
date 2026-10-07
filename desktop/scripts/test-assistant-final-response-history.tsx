import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import initSqlJs from 'sql.js/dist/sql-asm.js'
import { createAssistantThread } from '../src/main/assistant/service-state'
import { createAssistantSessionRecord, createRunningLatestTurn } from '../src/main/assistant/service-records'
import { createDefaultAssistantSnapshot, applyAssistantDomainEvent } from '../src/shared/assistant/projector'
import type { AssistantMessage, AssistantSnapshot } from '../src/shared/assistant/contracts'
import { initializeAssistantPersistenceSchema } from '../src/main/assistant/persistence-utils'
import { replaceAssistantSnapshot } from '../src/main/assistant/persistence-write'
import { readAssistantThreadDetail } from '../src/main/assistant/persistence-history'
import { readAssistantSnapshot } from '../src/main/assistant/persistence-read'
import { CanonicalHistoryRefreshTracker } from '../src/main/assistant/canonical-history-refresh-policy'
import { CanonicalMessagePhaseRecovery } from '../src/main/assistant/canonical-message-phase-recovery'
import { hydrateFocusedSessionSnapshot, toAssistantShellSnapshot } from '../src/main/assistant/persistence-snapshot'
import { applyAssistantThreadDetail, mergeAssistantShellSnapshot } from '../src/renderer/src/lib/assistant/assistant-history-state'
import { buildTimelineRows, getTimelineEntries } from '../src/renderer/src/pages/assistant/assistant-timeline-helpers'
import { groupTimelineRowsIntoWorkSummaries } from '../src/renderer/src/pages/assistant/assistant-turn-work'
import { preserveAssistantMessagePhases } from '../src/shared/assistant/message-phase'

const noop = () => undefined
mock.module('electron-log', () => ({ default: { info: noop, warn: noop, error: noop, debug: noop } }))
mock.module('electron', () => ({ app: { getPath: () => process.env.TEMP || process.cwd(), isReady: () => true, on: noop, once: noop },
    BrowserWindow: class { static getAllWindows() { return [] } }, screen: { getAllDisplays: () => [] },
    globalShortcut: { register: () => true, unregister: noop, unregisterAll: noop }, shell: { openExternal: async () => {} },
    nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) }, webContents: { fromId: () => null }, safeStorage: { isEncryptionAvailable: () => false } }))
const { AssistantService, projectCanonicalTimeline } = await import('../src/main/assistant/service')
const at = '2026-10-06T10:00:00.000Z'
const failures: string[] = []
const check = (label: string, verify: () => void) => { try { verify() } catch (error) { failures.push(`${label}: ${String(error)}`) } }
const signature = JSON.stringify({ v: 1, id: 'history-final', phase: 'final_answer' })
const projection = projectCanonicalTimeline([
    { type: 'message', id: 'entry-user', timestamp: at, message: { id: 'history-user', role: 'user', content: [{ type: 'text', text: 'Fix it' }] } },
    { type: 'message', id: 'entry-final', timestamp: at, message: { id: 'history-final', role: 'assistant', content: [{ type: 'text', text: 'The final answer', textSignature: signature }] } }
], 'canonical-phase-chat', 'canonical-phase-chat', at, 0)
check('canonical projection', () => assert.equal(projection.messages.find(message => message.role === 'assistant')?.phase, 'final_answer', 'canonical textSignature phase survives message projection'))
const legacyProjection = projectCanonicalTimeline([{ type: 'message', id: 'legacy-phase', timestamp: at,
    message: { id: 'legacy-phase', role: 'assistant', content: [{ type: 'text', text: 'A literal final_answer marker.', textSignature: JSON.stringify({ v: 2, id: 'legacy-phase', phase: 'final_answer' }) }] } }], 'legacy-chat', 'legacy-chat', at, 0)
assert.equal(legacyProjection.messages[0]?.phase, undefined, 'unsupported signatures and visible tags cannot invent phase')

const thread = createAssistantThread(at)
thread.state = 'running'
thread.latestTurn = { ...createRunningLatestTurn('history-phase-turn', at), assistantMessageId: 'assistant-message-history-final' }
thread.messages = [
    { id: 'history-user', role: 'user', text: 'Fix it', turnId: thread.latestTurn.id, streaming: false, createdAt: at, updatedAt: at },
    { id: 'assistant-message-history-final', role: 'assistant', text: 'The final answer', turnId: thread.latestTurn.id, streaming: true, phase: 'final_answer', createdAt: '2026-10-06T10:00:02.000Z', updatedAt: at }
]
thread.activities = [{ id: 'history-action', kind: 'command', tone: 'tool', summary: 'Checking', turnId: thread.latestTurn.id, createdAt: '2026-10-06T10:00:01.000Z', payload: { status: 'running' } }]
const session = createAssistantSessionRecord({ sessionId: 'history-phase-session', title: 'History phase', projectPath: null, thread, createdAt: at })
const snapshot: AssistantSnapshot = { ...createDefaultAssistantSnapshot(), selectedSessionId: session.id, sessions: [session] }
const withoutPhase = (message: AssistantMessage) => { const { phase, ...rest } = message; return rest }
const SQL = await initSqlJs()
const db = new SQL.Database()
initializeAssistantPersistenceSchema(db)
replaceAssistantSnapshot(db, snapshot)
const detail = readAssistantThreadDetail(db, thread.id)
db.close()
assert.equal(detail.history.messages.at(-1)?.phase, undefined, 'the real SQLite history reader omits phase; this fixture reproduces its actual shape')
const explicit = [{ ...thread.messages[1]!, phase: 'commentary' as const }]
assert.equal(preserveAssistantMessagePhases(thread.messages, explicit), explicit, 'explicit incoming provider phase remains authoritative')
const unrelated = [{ ...withoutPhase(thread.messages[1]!), id: 'another-message' }]
assert.equal(preserveAssistantMessagePhases(thread.messages, unrelated), unrelated, 'phase never crosses message identity')
const changedRole = [{ ...withoutPhase(thread.messages[1]!), role: 'user' as const }]
assert.equal(preserveAssistantMessagePhases(thread.messages, changedRole), changedRole, 'phase is only copied to assistant messages')
function assertFinalPhase(state: AssistantSnapshot, label: string) {
    check(label, () => {
    const hydrated = state.sessions[0]!.threads[0]!
    assert.equal(hydrated.messages.at(-1)?.phase, 'final_answer', `${label}: phase survives a phase-less history row`)
    assert.equal(hydrated.latestTurn?.state, 'running', `${label}: hydration never completes the turn`)
    const rows = groupTimelineRowsIntoWorkSummaries({ rows: buildTimelineRows(getTimelineEntries(hydrated.messages, hydrated.activities), true, at), messages: hydrated.messages,
        isWorking: true, latestTurnStartedAt: at, latestAssistantMessageId: hydrated.latestTurn!.assistantMessageId })
    assert.ok(rows.some(row => row.kind === 'turn-work-summary' && row.running && row.terminalResponseVisible), `${label}: Work remains visually collapsed during final streaming`)
    })
}
assertFinalPhase(hydrateFocusedSessionSnapshot(snapshot, session.id, { ...detail, ...detail.history }), 'main selection hydration')
const patched = applyAssistantDomainEvent(snapshot, { eventId: 'canonical-phase-refresh', sequence: 1, type: 'thread.updated', occurredAt: at,
    sessionId: session.id, threadId: thread.id, payload: { threadId: thread.id, patch: { messages: detail.history.messages } } })
assertFinalPhase(patched, 'canonical thread update')
const hydrated = applyAssistantThreadDetail(snapshot, detail)
assertFinalPhase(hydrated.snapshot, 'renderer detail bootstrap')
const shell = toAssistantShellSnapshot(hydrated.snapshot)
const away = mergeAssistantShellSnapshot(hydrated.snapshot, { ...shell, selectedSessionId: null })
const back = mergeAssistantShellSnapshot(away, shell)
assertFinalPhase(applyAssistantThreadDetail(back, detail, hydrated.history).snapshot, 'navigation away and back')
const dematerialized = { ...snapshot, sessions: [{ ...session, threads: [{ ...thread, messages: [] }] }] }
assertFinalPhase(applyAssistantThreadDetail(dematerialized, detail, hydrated.history).snapshot, 'retained history fallback')
for (const text of ['', 'The final answer grows']) {
    const live = { ...snapshot, sessions: [{ ...session, threads: [{ ...thread, messages: [thread.messages[0]!, { ...thread.messages[1]!, text }] }] }] }
    const emptyDetail = { ...detail, history: { ...detail.history, messages: live.sessions[0]!.threads[0]!.messages.map(withoutPhase) } }
    assertFinalPhase(applyAssistantThreadDetail(live, emptyDetail).snapshot, `phase onset ${JSON.stringify(text)}`)
}

// Exercise the actual API boundary for a new renderer with no retained rows.
const apiResult = await AssistantService.prototype.getThreadDetailBootstrap.call({ ensureReady: async () => {}, state: { snapshot },
    ensureCanonicalHistoryLoaded: async () => {}, persistence: { readThreadDetail: async () => structuredClone(detail) } } as never, thread.id)
check('detail API', () => assert.equal(apiResult.detail.history.messages.at(-1)?.phase, 'final_answer', 'detail API carries main resident phase to a fresh renderer'))
assert.equal(thread.messages.at(-1)?.phase, 'final_answer', 'history reconciliation never mutates the source message')
assert.equal(detail.history.messages.at(-1)?.phase, undefined, 'phase-less persisted input remains immutable')

// A new service and renderer, not a clone of the live in-memory projection.
// The canonical catalog is already current, so its normal importer must not
// backfill history merely to recover message metadata.
const coldSource = structuredClone(snapshot)
const coldSourceThread = coldSource.sessions[0]!.threads[0]!
coldSourceThread.providerThreadId = 'cold-phase-chat'
coldSourceThread.canonicalHistoryModifiedAt = at
coldSourceThread.canonicalHistoryEntryCount = 10_000
const canonicalChat = { canonicalChatId: 'cold-phase-chat', title: session.title, createdAt: at, modifiedAt: at,
    cwd: '/fixture', project: '', archived: false, messageCount: 2, entryCount: 10_000,
    presence: { state: 'running', clients: [], activeTurnId: thread.latestTurn!.id, latestTurn: thread.latestTurn } }
const coldWriter = new SQL.Database()
initializeAssistantPersistenceSchema(coldWriter)
replaceAssistantSnapshot(coldWriter, coldSource)
const coldBytes = coldWriter.export()
coldWriter.close()
const coldDb = new SQL.Database(coldBytes)
const coldDetail = readAssistantThreadDetail(coldDb, thread.id)
const coldSnapshot = hydrateFocusedSessionSnapshot(readAssistantSnapshot(coldDb), session.id, { ...coldDetail, ...coldDetail.history })
assert.equal(coldSnapshot.sessions[0]!.threads[0]!.messages.at(-1)?.phase, undefined, 'cold SQL restore has no retained phase')
let metadataReads = 0
const coldService = Object.assign(Object.create(AssistantService.prototype), {
    ensureReady: async () => {}, state: { snapshot: coldSnapshot }, options: {},
    canonicalHistoryRefresh: new CanonicalHistoryRefreshTracker(), canonicalHistoryLoadPromises: new Map(),
    canonicalMessagePhaseRecovery: new CanonicalMessagePhaseRecovery(),
    runtime: { listCanonicalChats: async () => [canonicalChat], releaseNavigationBackgroundedThread: noop,
        readCanonicalChatHistory: async (_id: string, _cwd: string, options: Record<string, unknown>) => {
            metadataReads += 1
            assert.deepEqual(options, { limit: 160, toolResultBodies: 'lazy-v1' }, 'metadata recovery reads only one bounded latest page')
            return { chat: canonicalChat, entries: [{ type: 'message', id: 'entry-final', message: { id: 'history-final', role: 'assistant',
                content: [{ type: 'text', text: 'The final answer', textSignature: signature }] } }],
                pageInfo: { startCursor: '9999', oldestCursor: '9999', hasOlder: true, totalEntries: 10_000 } }
        } },
    persistence: { readThreadDetail: async () => readAssistantThreadDetail(coldDb, thread.id), getGlobalWorkspaceRoot: () => '/fixture' },
    resolveCanonicalProjectPath: (value: string) => value || null, getSessionRuntimeCwd: () => '/fixture', ensureLegacyProjectScopes: async () => {},
    loadCanonicalHistoryPage: async () => { throw new Error('Cold phase recovery must not import or backfill history') },
    appendEvent(type: string, occurredAt: string, payload: Record<string, unknown>, sessionId: string, threadId: string) {
        this.state.snapshot = applyAssistantDomainEvent(this.state.snapshot, { eventId: `cold-${this.state.snapshot.snapshotSequence + 1}`,
            sequence: this.state.snapshot.snapshotSequence + 1, type, occurredAt, payload, sessionId, threadId } as never)
    }
})
await coldService.importCanonicalChats()
assert.equal(coldService.canonicalHistoryRefresh.current('cold-phase-chat'), 0, 'a current canonical catalog does not request history reimport')
const coldTurnBefore = structuredClone(coldService.state.snapshot.sessions[0]!.threads[0]!.latestTurn)
const coldStateBefore = coldService.state.snapshot.sessions[0]!.threads[0]!.state
const coldResult = await coldService.getThreadDetailBootstrap(thread.id)
check('cold process detail', () => assert.equal(coldResult.detail.history.messages.at(-1)?.phase, 'final_answer', 'cold process restores phase from canonical metadata'))
assert.deepEqual(coldService.state.snapshot.sessions[0]!.threads[0]!.latestTurn, coldTurnBefore, 'phase recovery does not resurrect the interrupted turn')
assert.equal(coldService.state.snapshot.sessions[0]!.threads[0]!.state, coldStateBefore, 'phase recovery preserves restore ownership')
check('bounded cold lookup', () => assert.equal(metadataReads, 1))
assert.equal(coldService.state.snapshot.sessions[0]!.threads[0]!.messages.at(-1)?.phase, 'final_answer', 'cold metadata also enriches resident rows before later selection hydration')
await Promise.all([coldService.getThreadDetailBootstrap(thread.id), coldService.getThreadDetailBootstrap(thread.id)])
assert.equal(metadataReads, 1, 'repeated detail hydration does not poll canonical history')
assert.equal(readAssistantThreadDetail(coldDb, thread.id).history.messages.at(-1)?.phase, undefined, 'phase recovery never changes the SQL persistence contract')

// A fresh service can also discover an already-running external turn through
// the canonical catalog. The stored shell has no turn ledger for it yet.
const activeSource = structuredClone(coldSource)
activeSource.sessions[0]!.threads[0]!.state = 'ready'
activeSource.sessions[0]!.threads[0]!.latestTurn = null
const activeWriter = new SQL.Database()
initializeAssistantPersistenceSchema(activeWriter)
replaceAssistantSnapshot(activeWriter, activeSource)
const activeDb = new SQL.Database(activeWriter.export())
activeWriter.close()
const activeDetail = readAssistantThreadDetail(activeDb, thread.id)
const activeService = Object.assign(Object.create(AssistantService.prototype), coldService, {
    state: { snapshot: hydrateFocusedSessionSnapshot(readAssistantSnapshot(activeDb), session.id, { ...activeDetail, ...activeDetail.history }) },
    canonicalHistoryRefresh: new CanonicalHistoryRefreshTracker(), canonicalHistoryLoadPromises: new Map(),
    canonicalMessagePhaseRecovery: new CanonicalMessagePhaseRecovery(),
    persistence: { ...coldService.persistence, readThreadDetail: async () => readAssistantThreadDetail(activeDb, thread.id) }
})
await activeService.importCanonicalChats()
assert.equal(activeService.state.snapshot.sessions[0]!.threads[0]!.latestTurn?.state, 'running', 'actual cold catalog import discovers the external running turn')
const activeTurnBefore = structuredClone(activeService.state.snapshot.sessions[0]!.threads[0]!.latestTurn)
const activeResult = await activeService.getThreadDetailBootstrap(thread.id)
assertFinalPhase(applyAssistantThreadDetail(activeService.state.snapshot, activeResult.detail).snapshot, 'cold process running final response')
assert.deepEqual(activeService.state.snapshot.sessions[0]!.threads[0]!.latestTurn, activeTurnBefore, 'running turn ownership is untouched by phase recovery')
assert.equal(metadataReads, 2, 'a fresh process performs exactly one bounded metadata lookup')
activeDb.close()

// Metadata guards use the same real service boundary, starting with phase-less
// SQL rows each time. Unsupported, absent and unrelated signatures stay unknown.
const unknownSources = [
    [{ type: 'message', id: 'entry-final', message: { id: 'history-final', role: 'assistant', content: [{ type: 'text', text: 'final_answer' }] } }],
    [{ type: 'message', id: 'entry-final', message: { id: 'history-final', role: 'assistant', content: [{ type: 'text', text: 'Final', textSignature: JSON.stringify({ v: 2, id: 'history-final', phase: 'final_answer' }) }] } }],
    [{ type: 'message', id: 'entry-final', message: { id: 'unrelated-message', role: 'assistant', content: [{ type: 'text', text: 'Final', textSignature: signature }] } }],
    [{ type: 'message', id: 'entry-final', message: { id: 'history-final', role: 'user', content: [{ type: 'text', text: 'Final', textSignature: signature }] } }]
]
for (const entries of unknownSources) {
    let reads = 0
    const unknownService = Object.assign(Object.create(AssistantService.prototype), coldService, {
        state: { snapshot: structuredClone(coldSnapshot) }, canonicalMessagePhaseRecovery: new CanonicalMessagePhaseRecovery(),
        runtime: { ...coldService.runtime, readCanonicalChatHistory: async () => { reads += 1; return { entries } } }
    })
    await unknownService.importCanonicalChats()
    const result = await unknownService.getThreadDetailBootstrap(thread.id)
    assert.equal(result.detail.history.messages.at(-1)?.phase, undefined, 'unknown metadata cannot invent a final phase')
    await unknownService.getThreadDetailBootstrap(thread.id)
    assert.equal(reads, 1, 'unknown metadata does not become a repeated network path')
}

let releaseMetadata!: (value: unknown) => void
const metadataPending = new Promise(resolve => { releaseMetadata = resolve })
let racingReads = 0
const racingService = Object.assign(Object.create(AssistantService.prototype), coldService, {
    state: { snapshot: structuredClone(coldSnapshot) }, canonicalMessagePhaseRecovery: new CanonicalMessagePhaseRecovery(),
    runtime: { ...coldService.runtime, readCanonicalChatHistory: async () => { racingReads += 1; return metadataPending } }
})
await racingService.importCanonicalChats()
const racingResults = [racingService.getThreadDetailBootstrap(thread.id), racingService.getThreadDetailBootstrap(thread.id)]
while (!racingReads) await Promise.resolve()
const racingThread = racingService.state.snapshot.sessions[0]!.threads[0]!
racingService.appendEvent('thread.updated', at, { threadId: thread.id,
    patch: { messages: [{ ...racingThread.messages.at(-1)!, phase: 'final_answer', text: 'New live text' }] } }, session.id, thread.id)
releaseMetadata({ entries: [{ type: 'message', id: 'entry-final', message: { id: 'history-final', role: 'assistant',
    content: [{ type: 'text', text: 'Stale text', textSignature: JSON.stringify({ v: 1, id: 'history-final', phase: 'commentary' }) }] } }] })
for (const result of await Promise.all(racingResults)) assert.equal(result.detail.history.messages.at(-1)?.phase, 'final_answer', 'live phase arriving during lookup wins over stale canonical metadata')
assert.equal(racingReads, 1, 'concurrent cold bootstraps share a single canonical request')
assert.equal(racingService.state.snapshot.sessions[0]!.threads[0]!.messages.at(-1)?.text, 'New live text', 'metadata recovery cannot replace newer resident text')

const emptySource = structuredClone(coldSource)
emptySource.sessions[0]!.threads[0]!.messages.at(-1)!.text = ''
const emptyWriter = new SQL.Database()
initializeAssistantPersistenceSchema(emptyWriter)
replaceAssistantSnapshot(emptyWriter, emptySource)
const emptyDb = new SQL.Database(emptyWriter.export())
emptyWriter.close()
const emptySqlDetail = readAssistantThreadDetail(emptyDb, thread.id)
const emptyService = Object.assign(Object.create(AssistantService.prototype), coldService, {
    state: { snapshot: hydrateFocusedSessionSnapshot(readAssistantSnapshot(emptyDb), session.id, { ...emptySqlDetail, ...emptySqlDetail.history }) },
    canonicalMessagePhaseRecovery: new CanonicalMessagePhaseRecovery(),
    persistence: { ...coldService.persistence, readThreadDetail: async () => readAssistantThreadDetail(emptyDb, thread.id) },
    runtime: { ...coldService.runtime, readCanonicalChatHistory: async () => ({ entries: [{ type: 'message', id: 'entry-final',
        message: { id: 'history-final', role: 'assistant', content: [{ type: 'text', text: '', textSignature: signature }] } }] }) }
})
await emptyService.importCanonicalChats()
const emptyResult = await emptyService.getThreadDetailBootstrap(thread.id)
assert.equal(emptyResult.detail.history.messages.at(-1)?.phase, 'final_answer', 'cold SQL restore recovers phase before any final text exists')
assert.equal(emptyResult.detail.history.messages.at(-1)?.text, '', 'phase recovery never fabricates visible text')
emptyDb.close()

let failedReads = 0
const failedService = Object.assign(Object.create(AssistantService.prototype), coldService, {
    state: { snapshot: structuredClone(coldSnapshot) }, canonicalMessagePhaseRecovery: new CanonicalMessagePhaseRecovery(),
    runtime: { ...coldService.runtime, readCanonicalChatHistory: async () => { failedReads += 1; throw new Error('Canonical service unavailable') } }
})
await failedService.importCanonicalChats()
assert.equal((await failedService.getThreadDetailBootstrap(thread.id)).detail.history.messages.at(-1)?.phase, undefined, 'unavailable canonical metadata leaves the existing unknown fallback usable')
await failedService.getThreadDetailBootstrap(thread.id)
assert.equal(failedReads, 1, 'failed metadata recovery cannot poll the server on hydration')
const phaseLeaf = new CanonicalMessagePhaseRecovery()
const activeThread = activeService.state.snapshot.sessions[0]!.threads[0]!
for (const [source, id] of [
    [{ timestamp: 42 }, 'assistant-message-zyra-message:assistant:42'],
    [{ zyraCanonicalMessage: { canonicalMessageId: 'pi-message:assistant:42' } }, 'assistant-message-zyra-message:assistant:42'],
    [{ zyraCanonicalMessage: { canonicalMessageId: 'voice_result_fixture' } }, 'voice_result_fixture']
] as const) {
    const identityThread = { ...activeThread, providerThreadId: id, latestTurn: { ...activeThread.latestTurn!, assistantMessageId: id } }
    const messages = [{ ...thread.messages.at(-1)!, id, phase: undefined }]
    const recovered = await phaseLeaf.recover(identityThread, messages, async () => [{ type: 'message', id: 'entry-final', message: {
        ...source, role: 'assistant', content: [{ type: 'text', text: '', textSignature: signature }] } }])
    assert.equal(recovered[0]?.phase, 'final_answer', 'canonical timestamps, legacy aliases and voice identities use the existing Desktop message identity')
}
const noRead = async () => { throw new Error('Known phases and inactive threads must not request metadata') }
assert.equal(await phaseLeaf.recover(activeThread, thread.messages, noRead), thread.messages)
assert.equal(await phaseLeaf.recover({ ...activeThread, latestTurn: null, canonicalPresence: undefined }, detail.history.messages, noRead), detail.history.messages)
coldDb.close()
assert.equal(failures.length, 0, failures.join('\n\n'))
console.log('Final phase history: canonical signatures, cold SQL/service restore, bounded single-flight metadata, live races, unknown fallback, selection and empty onset preserve phase without changing turn ownership: ok')
process.exit(0)
