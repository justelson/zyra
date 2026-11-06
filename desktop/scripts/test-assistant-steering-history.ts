import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import initSqlJs from 'sql.js/dist/sql-asm.js'
import { createUserTurnContinuity } from '../../src/user-turn-continuity.mjs'
import { createAssistantThread } from '../src/main/assistant/service-state'
import { createAssistantSessionRecord } from '../src/main/assistant/service-records'
import { createDefaultAssistantSnapshot } from '../src/shared/assistant/projector'
import { initializeAssistantPersistenceSchema } from '../src/main/assistant/persistence-utils'
import { replaceAssistantSnapshot } from '../src/main/assistant/persistence-write'
import { readAssistantThreadDetail, readAssistantHistoryPage, readAssistantHistoryAroundMessage } from '../src/main/assistant/persistence-history'
import { buildTimelineRows, getTimelineEntries } from '../src/renderer/src/pages/assistant/assistant-timeline-helpers'
import { groupTimelineRowsIntoWorkSummaries } from '../src/renderer/src/pages/assistant/assistant-turn-work'
const noop = () => undefined
mock.module('electron-log', () => ({ default: { info: noop, warn: noop, error: noop, debug: noop } }))
mock.module('electron', () => ({ app: { getPath: () => process.env.TEMP || process.cwd(), isReady: () => true, on: noop, once: noop }, BrowserWindow: class { static getAllWindows() { return [] } }, screen: { getAllDisplays: () => [] }, globalShortcut: { register: () => true, unregister: noop, unregisterAll: noop }, shell: { openExternal: noop }, nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) }, webContents: { fromId: () => null }, safeStorage: { isEncryptionAvailable: () => false } }))
const { projectCanonicalTimeline } = await import('../src/main/assistant/service')
const base = 1793966400000
const at = new Date(base).toISOString()
const continuity = createUserTurnContinuity()
const entries: any[] = []
function append(role: string, text: string, n: number, final = false) {
    if (n === 2 || n === 4) continuity.expectSteeringMessage()
    const message = { role, content: [{ type: 'text', text, ...(final ? { textSignature: JSON.stringify({ v: 1, id: `fixture-${n}`, phase: 'final_answer' }) } : {}) }], timestamp: base + n * 1000 }
    continuity.observe({ type: 'message_end', message })
    entries.push(JSON.parse(JSON.stringify({ type: 'message', id: `entry-${n}`, timestamp: new Date(message.timestamp).toISOString(), message })))
}
continuity.observe({ type: 'agent_start' })
append('user', 'Original task', 0); append('assistant', 'First progress', 1)
append('user', 'Steer the running task', 2); append('assistant', 'Following the correction', 3)
append('user', 'One more correction', 4); append('assistant', 'Final result', 5, true)
continuity.observe({ type: 'agent_end' })
continuity.observe({ type: 'agent_start' })
append('user', 'A separate task', 6); append('assistant', 'Working on the next task', 7)
const projected = projectCanonicalTimeline(entries, 'canonical-chat', 'fixture', at, 0)
assert(projected.messages.slice(0, 6).every(message => message.turnId === projected.messages[0]!.turnId), 'canonical history retains one task ID across steering messages')
assert.notEqual(projected.messages[6]!.turnId, projected.messages[0]!.turnId, 'new execution remains a separate history turn')
const partial = projectCanonicalTimeline(entries.slice(2, 6), 'canonical-chat', 'fixture', at, 2)
assert.equal(partial.messages[0]!.turnId, projected.messages[0]!.turnId, 'a partial page beginning at steering retains the original saved task ID')
const thread = createAssistantThread(at)
thread.messages = projected.messages
thread.activities = projected.activities
const session = createAssistantSessionRecord({ sessionId: 'steering-history', title: 'Synthetic fixture', projectPath: null, createdAt: at, thread })
const snapshot = { ...createDefaultAssistantSnapshot(), selectedSessionId: session.id, sessions: [session] }
const SQL = await initSqlJs()
const originalDb = new SQL.Database()
initializeAssistantPersistenceSchema(originalDb)
replaceAssistantSnapshot(originalDb, snapshot)
const bytes = originalDb.export(); originalDb.close()
const reopened = new SQL.Database(bytes)
try {
    const history = readAssistantThreadDetail(reopened, thread.id).history
    assert.equal(new Set(history.messages.slice(0, 6).map(message => message.turnId)).size, 1, 'native SQLite reopen retains the steering relation')
    const latest = readAssistantHistoryPage(reopened, { threadId: thread.id, turnLimit: 1 })
    assert.equal(latest.messages.length, 2, 'one latest task excludes the previous task and its steering')
    const older = readAssistantHistoryPage(reopened, { threadId: thread.id, before: latest.pageInfo.oldestCursor!, turnLimit: 1 })
    assert.equal(older.messages.length, 6, 'paging backward includes the original prompt and every correction as one task')
    const forward = readAssistantHistoryPage(reopened, { threadId: thread.id, after: older.pageInfo.newestCursor!, turnLimit: 1 })
    assert.deepEqual(forward.messages.map(message => message.id), latest.messages.map(message => message.id), 'forward paging preserves real task boundaries')
    const anchored = readAssistantHistoryAroundMessage(reopened, { threadId: thread.id, messageId: projected.messages[2]!.id, turnLimit: 1 })
    assert.equal(anchored.page.messages.length, 6, 'searching a correction opens its original task rather than treating the correction as a separate turn')
    const rows = groupTimelineRowsIntoWorkSummaries({ rows: buildTimelineRows(getTimelineEntries(history.messages, history.activities), true, at), messages: history.messages, latestAssistantMessageId: history.messages.at(-1)!.id, latestTurnStartedAt: new Date(base + 6000).toISOString(), isWorking: true })
    assert.equal(rows.filter(row => row.kind === 'turn-work-summary').length, 2, 'canonical projection through SQLite to the timeline shows the two actual tasks')
    const firstWork = rows.find(row => row.kind === 'turn-work-summary')!
    assert.equal(firstWork.kind === 'turn-work-summary' ? firstWork.rows.filter(row => row.kind === 'message' && row.message.role === 'user').length : -1, 2, 'both steering bubbles remain chronological members of the original historical task')
} finally { reopened.close() }
console.log('Steering history: bridge metadata to canonical projection, partial pages, SQLite reopen and actual turn grouping: ok')
