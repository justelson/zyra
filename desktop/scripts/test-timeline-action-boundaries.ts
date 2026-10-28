import assert from 'node:assert/strict'
import type { AssistantActivity, AssistantMessage, AssistantSessionTurnUsageEntry } from '../src/shared/assistant/contracts'
import { areActivitiesEquivalent, buildTimelineRows, estimateTimelineRowHeight, getTimelineEntries, type TimelineRenderRow } from '../src/renderer/src/pages/assistant/assistant-timeline-helpers'
import { groupTimelineRowsIntoWorkSummaries } from '../src/renderer/src/pages/assistant/assistant-turn-work'
const time = (n: number) => `2026-01-01T00:00:${String(n).padStart(2, '0')}.000Z`
const message = (id: string, role: 'user' | 'assistant', n: number, text: string, turnId = 'local-turn'): AssistantMessage => ({ id, role, text, turnId, streaming: false, createdAt: time(n), updatedAt: time(n), timelineSequence: n })
const action = (id: string, n: number, turnId: string | null): AssistantActivity => ({ id, kind: 'command', tone: 'tool', summary: 'Running command', detail: 'echo fixture', turnId, createdAt: time(n), timelineSequence: n, payload: { toolName: 'bash', command: 'echo fixture', status: 'running', actionBatchIntent: 'Checking the requested behavior' } })
const user = message('user', 'user', 0, 'Do the requested work')
const narration = message('narration', 'assistant', 1, 'I will inspect the relevant behavior.')
const next = message('next-user', 'user', 9, 'Here is the next request', 'next-turn')
const tools = [action('live-a', 2, 'local-turn'), action('live-b', 3, 'local-turn'), action('canonical-a', 4, 'canonical-turn'), action('canonical-b', 5, 'canonical-turn'), action('unreconciled', 6, null)]
const pipeline = (messages: AssistantMessage[], activities: AssistantActivity[]) => {
    const entries = getTimelineEntries(messages, [...activities].reverse())
    return groupTimelineRowsIntoWorkSummaries({ rows: buildTimelineRows(entries, false, null), messages, latestAssistantMessageId: null, latestTurnStartedAt: null, isWorking: false })
}
const flatten = (rows: ReturnType<typeof pipeline>): TimelineRenderRow[] => rows.flatMap(row => row.kind === 'turn-work-summary' ? row.rows : [row])
const actionRows = (rows: TimelineRenderRow[]) => rows.filter(row => row.kind === 'activity' || row.kind === 'activity-group')
const ids = (row: TimelineRenderRow) => row.kind === 'activity' ? [row.activity.id] : 'activities' in row ? row.activities.map(activity => activity.id) : []
const merged = actionRows(flatten(pipeline([user, narration, next], tools)))
assert.equal(merged.length, 1, 'live/canonical/null turn aliases inside one visible user turn cannot split a consecutive action block')
assert.deepEqual(ids(merged[0]), tools.map(tool => tool.id), 'all action evidence remains in chronological order')
const ping: AssistantActivity = { id: 'model-ping:request-1', kind: 'model.ping', tone: 'info', summary: 'Pinged model due to suspected hang.', turnId: 'local-turn', createdAt: time(7), timelineSequence: 7, payload: { category: 'model-ping', status: 'completed' } }
const pingRows = actionRows(flatten(pipeline([user, narration, next], [...tools, ping])))
assert.equal(pingRows.length, 1, 'Ping belongs inside the latest action block, not a separate message or issue')
assert.deepEqual(ids(pingRows[0]), [...tools.map(tool => tool.id), ping.id])
assert.equal(actionRows(flatten(pipeline([user, narration, message('fresh-narration', 'assistant', 8, 'The checks are done; continuing the remaining task.'), next], [...tools, ping]))).length, 1, 'fresh narration follows recovered action evidence')
const recoveryNotice: AssistantActivity = { id: 'temporary-issue', kind: 'error', tone: 'error', summary: 'Temporary provider error', turnId: 'local-turn', createdAt: time(4), payload: {} }
assert.equal(actionRows(flatten(pipeline([user, narration, next], [tools[0], tools[1], recoveryNotice, tools[3]]))).length, 1, 'a recoverable issue does not split an otherwise consecutive action run in the fallback path')
const empty = message('empty-placeholder', 'assistant', 4, '   ')
assert.equal(actionRows(flatten(pipeline([user, narration, empty, next], [tools[0], tools[1], action('after-empty', 5, 'local-turn')]))).length, 1, 'a settled invisible placeholder cannot divide visible actions')
const liveEmpty = { ...empty, streaming: true }
assert.equal(actionRows(flatten(pipeline([user, narration, liveEmpty, next], [tools[0], tools[1], tools[3]]))).length, 1, 'an empty streaming placeholder cannot split consecutive visible actions')
assert.ok(buildTimelineRows(getTimelineEntries([user, liveEmpty], []), true, time(0)).some(row => row.kind === 'working'), 'working feedback survives without an empty assistant bubble')
assert.ok(getTimelineEntries([{ ...liveEmpty, text: 'Checking the next result.' }], []).some(entry => entry.type === 'message'), 'actual streamed narration remains visible')
const failedToolOnly = pipeline([user, next], [{ ...tools[0], tone: 'error', payload: { ...tools[0].payload, status: 'failed' } }])
assert.ok(failedToolOnly.every(row => row.kind !== 'turn-work-summary' || row.outcome !== 'interrupted'), 'a failed final tool is not evidence of an interrupted turn')
const visibleNarration = message('narration-two', 'assistant', 4, 'Now I will check the other file.')
assert.equal(actionRows(flatten(pipeline([user, narration, visibleNarration, next], [tools[0], tools[1], tools[3]]))).length, 2, 'visible narration remains a real boundary')
assert.equal(actionRows(flatten(pipeline([user, message('user-two', 'user', 4, 'Another task', 'another-turn')], [tools[0], tools[1], tools[3]]))).length, 2, 'user messages keep distinct turns separate')
const unanchored = getTimelineEntries([], [tools[3], tools[2], tools[1], tools[0]])
assert.equal(unanchored.length, 1, 'a paged-in action run cannot split solely because internal turn IDs differ')
const terminalBoundary = { ...recoveryNotice, id: 'terminal-boundary', turnTerminalOutcome: 'interrupted' as const }
assert.equal(getTimelineEntries([], [tools[3], terminalBoundary, tools[1], tools[0]]).length, 3, 'an authoritative terminal marker is a real boundary even without its user message loaded')
assert.equal(areActivitiesEquivalent(tools[0], { ...tools[0], turnTerminalOutcome: 'interrupted' }), false, 'late authoritative interruption metadata must invalidate cached action rendering')
assert.equal(areActivitiesEquivalent(tools[0], { ...tools[0], turnTerminalOutcome: 'failed' }), false)
assert.equal(estimateTimelineRowHeight({ kind: 'activity-group', id: 'mixed', createdAt: time(2), activities: [tools[0], recoveryNotice] }), 36, 'mixed fallback batches reserve one collapsed action header')
assert.equal(estimateTimelineRowHeight({ kind: 'activity', id: 'stop', createdAt: time(8), activity: { ...recoveryNotice, turnTerminalOutcome: 'interrupted' } }), 28, 'a standalone interruption reserves the boundary marker height')
const interrupted = { ...recoveryNotice, id: 'actual-stop', turnTerminalOutcome: 'interrupted' as const, createdAt: time(8), timelineSequence: 8 }
const legacyLedger: AssistantSessionTurnUsageEntry = { id: 'local-turn', sessionId: 'session', threadId: 'thread', model: 'fixture', state: 'error', requestedAt: time(0), startedAt: time(0), completedAt: time(8), assistantMessageId: null, usage: null, updatedAt: time(8) }
const stoppedRows = groupTimelineRowsIntoWorkSummaries({ rows: buildTimelineRows(getTimelineEntries([user, narration, next], [interrupted, tools[1], tools[0]]), false, null), messages: [user, narration, next], turnUsageById: new Map([['local-turn', legacyLedger]]), latestAssistantMessageId: null, latestTurnStartedAt: null, isWorking: false })
const stopped = stoppedRows.find(row => row.kind === 'turn-work-summary')
assert.equal(stopped?.kind === 'turn-work-summary' ? stopped.outcome : null, 'interrupted', 'specific terminal interruption evidence overrides a legacy generic-error ledger state')
assert.ok(stopped?.kind === 'turn-work-summary' && stopped.rows.every(row => !('activities' in row) || row.activities.every(activity => !activity.turnTerminalOutcome)), 'the authoritative marker is represented once at the summary boundary')
const staleCompletedRows = groupTimelineRowsIntoWorkSummaries({ rows: buildTimelineRows(getTimelineEntries([user, narration, next], [interrupted, tools[1], tools[0]]), false, null), messages: [user, narration, next], turnUsageById: new Map([['local-turn', { ...legacyLedger, state: 'completed' }]]), latestAssistantMessageId: null, latestTurnStartedAt: null, isWorking: false })
assert.equal(staleCompletedRows.find(row => row.kind === 'turn-work-summary')?.outcome, 'interrupted', 'canonical terminal interruption evidence corrects a legacy ledger that recorded completion')
console.log('Timeline action boundaries: contiguous aliases, invisible placeholders, narration/user boundaries and terminal metadata refresh: ok')
