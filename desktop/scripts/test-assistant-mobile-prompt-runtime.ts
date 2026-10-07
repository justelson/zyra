import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import initSqlJs from 'sql.js/dist/sql-asm.js'
import { initializeAssistantPersistenceSchema } from '../src/main/assistant/persistence-utils'
import { persistAssistantEvent, replaceAssistantSnapshot } from '../src/main/assistant/persistence-write'
import { readAssistantThreadDetail } from '../src/main/assistant/persistence-history'
import { createAssistantThread } from '../src/main/assistant/service-state'
import { createAssistantSessionRecord, createAssistantUserMessage, createRunningLatestTurn } from '../src/main/assistant/service-records'
import { createDefaultAssistantSnapshot, applyAssistantDomainEvent } from '../src/shared/assistant/projector'
import { buildTimelineRows, getTimelineEntries } from '../src/renderer/src/pages/assistant/assistant-timeline-helpers'
import { groupTimelineRowsIntoWorkSummaries } from '../src/renderer/src/pages/assistant/assistant-turn-work'
const noop = () => undefined
mock.module('electron-log', () => ({ default: { info: noop, warn: noop, error: noop, debug: noop } }))
mock.module('../src/main/agent-control', () => ({ getAgentControlBroker: () => ({ revokePrincipal: noop }) }))
mock.module('electron', () => ({ app: { getPath: () => process.env.TEMP || process.cwd(), isReady: () => true, on: noop, once: noop },
    BrowserWindow: class { static getAllWindows() { return [] } }, screen: { getAllDisplays: () => [] },
    nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) }, webContents: { fromId: () => null }, safeStorage: { isEncryptionAvailable: () => false } }))
const { ZyraRuntime } = await import('../src/main/assistant/zyra-runtime')
const { ZyraAgentServerWorker } = await import('../src/main/assistant/zyra-agent-server-worker')
const { handleAssistantRuntimeEvent } = await import('../src/main/assistant/service-runtime-events')
const before = '2026-10-06T15:24:37.689Z'
const next = '2026-10-06T15:28:53.288Z'
const thread = createAssistantThread(before)
thread.providerThreadId = 'mobile-prompt-canonical'
thread.latestTurn = { ...createRunningLatestTurn('desktop-turn', before), state: 'completed', completedAt: before }
thread.messages = [{ ...createAssistantUserMessage('Earlier Desktop prompt', before, 'desktop-prompt'), turnId: 'desktop-turn' }]
const session = createAssistantSessionRecord({ sessionId: 'mobile-prompt-session', title: 'Mobile prompt', thread, createdAt: before, projectPath: null })
let snapshot = { ...createDefaultAssistantSnapshot(), sessions: [session], selectedSessionId: session.id }
const SQL = await initSqlJs()
const db = new SQL.Database()
initializeAssistantPersistenceSchema(db)
replaceAssistantSnapshot(db, snapshot)
const record = () => ({ session: snapshot.sessions[0]!, thread: snapshot.sessions[0]!.threads[0]! })
const deps = {
    findThreadRecord: record, findSessionByThreadId: () => record().session, requireThread: () => record().thread,
    assistantTextBuffers: new Map(), isAssistantTextSuppressed: () => false, flushAssistantTextDelta: noop,
    updateLatestTurnAssistantMessage: noop,
    appendEvent: (type: any, occurredAt: string, payload: Record<string, unknown>) => {
        const sequence = snapshot.snapshotSequence + 1
        const event = { eventId: `mobile-${sequence}`, sequence, type, occurredAt, payload, sessionId: session.id, threadId: thread.id }
        snapshot = applyAssistantDomainEvent(snapshot, event)
        persistAssistantEvent(db, event, snapshot)
    },
    queueAssistantTextDelta: (delta: any) => deps.appendEvent('thread.message.assistant.delta', delta.occurredAt, delta)
}
const runtime = new ZyraRuntime()
const context: any = { localThreadId: thread.id, providerThreadId: thread.providerThreadId, activeTurnId: null,
    completedTurnIds: new Set(['desktop-turn']), usageAccountedAssistantMessageIds: new Set(), toolArgsByCallId: new Map(),
    toolStartedAtByCallId: new Map(), assistantTextByItemId: new Map(), assistantCompletedItemIds: new Set(),
    internalTextByItemId: new Map(), internalCompletedItemIds: new Set(), sessionUsage: null }
runtime.on('runtime', event => handleAssistantRuntimeEvent(event, deps as never))
const worker = new ZyraAgentServerWorker({ detach: noop } as any, process.cwd())
worker.onEvent((event, metadata) => (runtime as any).handleZyraEvent(context, event, metadata))
const origin = { turnId: 'mobile:prompt-one', localThreadId: 'mobile-device:paired-phone' }
const message = { id: 'zyra-message:user:1791300533249', role: 'user', content: [{ type: 'text', text: 'New prompt from the phone' }] }
worker.receive({ sequence: 1, occurredAt: next, requestContext: origin, event: { type: 'zyra_server_prompt_accepted', message: { role: message.role, content: message.content } } }, false)
assert.equal(record().thread.messages.filter(m => m.role === 'user').length, 2, 'an accepted phone prompt is visible before preflight compaction or provider work')
assert.equal(record().thread.latestTurn?.startedAt, next, 'server receipt starts a distinct turn and clock immediately')
worker.receive({ sequence: 2, requestContext: origin, event: { type: 'agent_start', timestamp: next } }, false)
worker.receive({ sequence: 3, requestContext: origin, event: { type: 'message_start', message, timestamp: next } }, false)
assert.equal(record().thread.messages.filter(m => m.role === 'user').length, 2, 'mobile message passes worker -> runtime -> service -> domain projector')
assert.equal(record().thread.latestTurn?.startedAt, next)
worker.receive({ sequence: 4, requestContext: origin, event: { type: 'message_end', message, timestamp: next } }, false)
assert.equal(record().thread.messages.filter(m => m.role === 'user').length, 2, 'receipt, canonical start and canonical end render one user message')
const persistedMessages = readAssistantThreadDetail(db, thread.id).history.messages
assert.equal(persistedMessages.filter(message => message.role === 'user').length, 2, 'the receipt replacement is durable without dropping or duplicating the phone message')
assert.equal(persistedMessages.some(message => message.id.startsWith('assistant-message-remote-prompt-')), false, 'a canonical transcript replaces the presentation-only receipt')
assert.equal(persistedMessages.find(entry => entry.id === `assistant-message-user-${message.id}`)?.createdAt, next, 'a fresh history read restores the original mobile turn boundary')
worker.receive({ sequence: 5, requestContext: origin, event: { type: 'message_start', timestamp: next, message: { id: 'phone-answer', role: 'assistant', content: [{ type: 'text', text: 'Checking the requested change.' }] } } }, false)
const rows = groupTimelineRowsIntoWorkSummaries({ rows: buildTimelineRows(getTimelineEntries(record().thread.messages, []), true, next), messages: record().thread.messages,
    isWorking: true, latestTurnStartedAt: record().thread.latestTurn!.startedAt, latestAssistantMessageId: null })
assert.ok(rows.some(row => row.kind === 'message' && row.message.text === 'New prompt from the phone'), 'the new phone prompt remains visible in the rendered timeline rows')
assert.ok(rows.some(row => row.kind === 'turn-work-summary' && row.running && row.startedAt === next), 'the working timer starts at the phone turn, independent of the previous Desktop turn')
const messageCount = record().thread.messages.length
worker.receive({ sequence: 6, occurredAt: next, requestContext: origin, event: { type: 'zyra_server_prompt_accepted', message } }, true)
assert.equal(record().thread.messages.length, messageCount, 'a replayed receipt cannot duplicate its canonical message')
worker.receive({ sequence: 7, requestContext: { turnId: origin.turnId, localThreadId: thread.id }, event: { type: 'message_start', timestamp: next, message: { ...message, id: 'own-desktop-echo' } } }, false)
assert.equal(record().thread.messages.length, messageCount, 'Desktop optimistic echoes remain suppressed')
const replayAt = '2026-10-06T15:35:00.000Z'
worker.receive({ sequence: 8, occurredAt: replayAt, requestContext: { ...origin, turnId: 'mobile:prompt-two' }, event: { type: 'message_end', message: { ...message, id: 'remote-end-only', content: [{ type: 'text', text: 'Second phone prompt' }] } } }, true)
assert.equal(record().thread.messages.at(-1)?.text, 'Second phone prompt', 'a durable user end event recovers a missing start event')
assert.equal(record().thread.messages.at(-1)?.createdAt, replayAt, 'replay preserves server time instead of moving a user boundary to the current time')
assert.equal(record().thread.latestTurn?.id, origin.turnId, 'historical replay does not start a fresh running clock')
runtime.dispose()
db.close()
console.log('Mobile prompt: worker -> runtime -> service -> SQLite history -> visible turn boundary and fresh timer: ok')
