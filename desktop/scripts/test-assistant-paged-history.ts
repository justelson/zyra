import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import initSqlJs from 'sql.js/dist/sql-asm.js'
import type { AssistantActivity, AssistantMessage, AssistantProposedPlan, AssistantSession, AssistantThread } from '../src/shared/assistant/contracts'
import { compareAssistantTimelineOrderKeys, getAssistantTimelineOrderKey } from '../src/shared/assistant/timeline-order'
import {
    ASSISTANT_HISTORY_PAGE_MAX_CHARACTERS,
    ASSISTANT_HISTORY_PAGE_MAX_RECORDS,
    INITIAL_ASSISTANT_HISTORY_TURN_LIMIT,
    INITIAL_ASSISTANT_HISTORY_PAGE_MAX_CHARACTERS,
    INITIAL_ASSISTANT_HISTORY_PAGE_MAX_RECORDS,
    readAssistantHistoryPage,
    readAssistantReviewIndex,
    readAssistantThreadDetail,
    readAssistantTurnDetail,
    searchAssistantTurns
} from '../src/main/assistant/persistence-history'
import {
    ASSISTANT_ACTIVITY_PAYLOAD_MAX_CHARACTERS,
    serializeAssistantActivityPayload
} from '../src/main/assistant/persistence-activity-payload'
import { initializeAssistantPersistenceSchema } from '../src/main/assistant/persistence-utils'
import { CanonicalHistoryRefreshTracker, shouldRefreshCanonicalHistory } from '../src/main/assistant/canonical-history-refresh-policy'
import { replaceAssistantSnapshot, upsertAssistantCanonicalTimelineProjection } from '../src/main/assistant/persistence-write'
import { createDefaultSnapshot } from '../src/main/assistant/projector'
import { toAssistantShellSnapshot } from '../src/main/assistant/persistence-snapshot'
import {
    ACTIVE_ASSISTANT_HISTORY_MAX_RECORDS,
    applyAssistantRetainedHistory,
    applyAssistantThreadDetail,
    boundAssistantActiveHistoryWindow,
    dematerializeAssistantHistories,
    hasRenderableAssistantRetainedHistory,
    isAssistantRetainedHistoryFresh,
    DETAIL_CACHE_MAX_TIMELINE_CHARACTERS,
    formatAssistantHistoryLoadError,
    hasAssistantPersistedThreadContent,
    pruneAssistantHistoryCache,
    replaceAssistantVisibleHistory,
    shouldPreserveAssistantLoadedHistoryRange,
    shouldRehydrateAssistantHistoryAfterCanonicalEvent,
    shouldShowAssistantThreadHistoryLoader
} from '../src/renderer/src/lib/assistant/assistant-history-state'
import { computeStableAssistantTimelineRows } from '../src/renderer/src/pages/assistant/assistant-virtual-timeline-rows'
import { buildAssistantDiffTurns } from '../src/renderer/src/pages/assistant/assistant-diff-turns'
import { getAssistantThreadHydrationRevision } from '../src/renderer/src/lib/assistant/assistant-thread-hydration-revision'
import { estimateAssistantTimelineCollectionsCharacters } from '../src/renderer/src/lib/assistant/session-hydration-cache'
import type { TimelineDisplayRow } from '../src/renderer/src/pages/assistant/assistant-timeline-helpers'
import { createAssistantLongHistoryFixture } from './fixtures/assistant-long-history-fixture'
import {
    ASSISTANT_DEVELOPMENT_HEAVY_SESSION_ID,
    createAssistantDevelopmentChatFixtures
} from '../src/main/assistant/development-chat-fixtures'

const at = (minute: number) => new Date(Date.parse('2026-07-16T10:00:00.000Z') + minute * 60_000).toISOString()
assert.equal(shouldRefreshCanonicalHistory({ canonicalModifiedAt: at(1), persistedCanonicalModifiedAt: at(1), canonicalEntryCount: 50, persistedCanonicalEntryCount: 50 }), false, 'an up-to-date persisted chat must not rescan canonical history on every launch')
assert.equal(shouldRefreshCanonicalHistory({ canonicalModifiedAt: at(2), persistedCanonicalModifiedAt: at(1), canonicalEntryCount: 50, persistedCanonicalEntryCount: 50 }), true, 'a newer canonical transcript requests background reconciliation')
assert.equal(shouldRefreshCanonicalHistory({ canonicalModifiedAt: at(1), persistedCanonicalModifiedAt: at(1), canonicalEntryCount: 49, persistedCanonicalEntryCount: 50 }), true, 'canonical truncation requests background reconciliation even when local counters include extra activity kinds')
assert.equal(shouldRefreshCanonicalHistory({ canonicalModifiedAt: at(1), persistedCanonicalModifiedAt: null, canonicalEntryCount: 50, persistedCanonicalEntryCount: null }), true, 'legacy threads reconcile once to persist an explicit canonical revision')
const refreshTracker = new CanonicalHistoryRefreshTracker()
const firstRefreshGeneration = refreshTracker.mark('canonical:test')
const secondRefreshGeneration = refreshTracker.mark('canonical:test')
assert.equal(refreshTracker.clearIfCurrent('canonical:test', firstRefreshGeneration), false, 'an older in-flight refresh cannot erase a newer transcript change')
assert.equal(refreshTracker.current('canonical:test'), secondRefreshGeneration)
assert.equal(refreshTracker.clearIfCurrent('canonical:test', secondRefreshGeneration), true)
assert.equal(shouldRehydrateAssistantHistoryAfterCanonicalEvent({
    type: 'thread.updated',
    threadId: 'paged-thread',
    payload: { threadId: 'paged-thread', patch: { canonicalHistoryEntryCount: 500 } }
}, 'paged-thread'), true, 'canonical reconciliation invalidates stale local pageInfo for the selected thread')
assert.equal(shouldRehydrateAssistantHistoryAfterCanonicalEvent({
    type: 'thread.updated',
    threadId: 'paged-thread',
    payload: { threadId: 'paged-thread', patch: { state: 'ready' } }
}, 'paged-thread'), false, 'ordinary thread state changes do not remount history')
assert.equal(shouldRehydrateAssistantHistoryAfterCanonicalEvent({
    type: 'thread.updated',
    threadId: 'other-thread',
    payload: { threadId: 'other-thread', patch: { canonicalHistoryEntryCount: 500 } }
}, 'paged-thread'), false, 'another thread cannot invalidate the selected history page')
const messages: AssistantMessage[] = []
const activities: AssistantActivity[] = []
const proposedPlans: AssistantProposedPlan[] = []
for (let index = 1; index <= 4; index += 1) {
    const turnId = `turn-${index}`
    messages.push({ id: `user-${index}`, role: 'user', text: `Prompt ${index}`, turnId, streaming: false, timelineSequence: index * 10, createdAt: at(index), updatedAt: at(index) })
    activities.push({
        id: `activity-${index}`,
        kind: index === 2 ? 'file-change' : 'command',
        tone: 'tool',
        summary: `Tool ${index}`,
        turnId,
        timelineSequence: index * 10 + 1,
        createdAt: at(index),
        payload: index === 2 ? {
            category: 'file-change',
            provider: 'pi',
            status: 'completed',
            source: 'provider-result',
            authoritative: true,
            revision: 2,
            paths: ['src/review-index.ts'],
            createdPaths: [],
            changes: [{ path: 'src/review-index.ts', kind: 'update', diff: '@@ -1 +1 @@\n-old\n+new' }],
            patch: '--- a/src/review-index.ts\n+++ b/src/review-index.ts\n@@ -1 +1 @@\n-old\n+new',
            fileCount: 1,
            startedAt: at(index),
            completedAt: at(index)
        } : { status: 'completed' }
    })
    messages.push({ id: `assistant-${index}`, role: 'assistant', text: `Response ${index}`, turnId, streaming: false, timelineSequence: index * 10 + 2, createdAt: at(index), updatedAt: at(index) })
}
proposedPlans.push({ id: 'plan-3', turnId: 'turn-3', planMarkdown: 'Plan three', timelineSequence: 33, createdAt: at(3), updatedAt: at(3) })

const thread: AssistantThread = {
    id: 'paged-thread', providerThreadId: null, source: 'root', parentThreadId: null, providerParentThreadId: null,
    subagentDepth: null, agentNickname: null, agentRole: null, model: 'test', cwd: 'C:/fixture',
    messageCount: messages.length, activityCount: activities.length, proposedPlanCount: proposedPlans.length,
    lastSeenCompletedTurnId: 'turn-4', runtimeMode: 'approval-required', interactionMode: 'default', state: 'ready',
    lastError: null, createdAt: at(0), updatedAt: at(4), latestTurn: null,
    hasPendingApprovals: false, hasPendingUserInputs: false, hasActivePlan: false,
    activePlan: null, messages, activities, proposedPlans, pendingApprovals: [], pendingUserInputs: []
}
const session: AssistantSession = {
    id: 'paged-session', title: 'Paged fixture', mode: 'work', projectPath: 'C:/fixture', playgroundLabId: null,
    pendingLabRequest: null, archived: false, createdAt: at(0), updatedAt: at(4), activeThreadId: thread.id,
    threadIds: [thread.id], threads: [thread]
}
const snapshot = createDefaultSnapshot()
snapshot.selectedSessionId = session.id
snapshot.sessions = [session]

const SQL = await initSqlJs()
const db = new SQL.Database()
initializeAssistantPersistenceSchema(db)
const historyOrderPlan = db.exec(`EXPLAIN QUERY PLAN SELECT id FROM assistant_messages WHERE thread_id = ? ORDER BY created_at DESC, COALESCE(timeline_sequence, -1) DESC, id DESC LIMIT 20`, [thread.id])[0]?.values || []
assert.equal(historyOrderPlan.some((row) => String(row[3] || '').includes('USE TEMP B-TREE')), false, 'history ordering uses the expression-matched index instead of a temporary sort')
replaceAssistantSnapshot(db, snapshot)
for (let index = 1; index <= 4; index += 1) {
    db.run(`INSERT OR REPLACE INTO assistant_turns (id, thread_id, model, state, requested_at, started_at, completed_at, assistant_message_id, effort, service_tier, usage_json, updated_at) VALUES (?, ?, ?, 'completed', ?, ?, ?, ?, NULL, NULL, NULL, ?)`, [`turn-${index}`, thread.id, thread.model, at(index), at(index), at(index), `assistant-${index}`, at(index)])
}
db.run(`INSERT INTO assistant_messages (id, thread_id, role, text, turn_id, streaming, timeline_sequence, created_at, updated_at) VALUES (?, ?, 'assistant', ?, 'turn-2', 0, 23, ?, ?)`, ['assistant-2-final', thread.id, 'Final response 2 from the agent', at(2), at(2)])

const newest = readAssistantHistoryPage(db, { threadId: thread.id, turnLimit: 2 })
assert.deepEqual(newest.messages.filter((message) => message.role === 'user').map((message) => message.id), ['user-3', 'user-4'])
assert.equal(newest.pageInfo.turnCount, 2)
assert.equal(newest.pageInfo.hasOlder, true)
assert.deepEqual(newest.activities.map((activity) => activity.id), ['activity-3', 'activity-4'])
assert.deepEqual(newest.proposedPlans.map((plan) => plan.id), ['plan-3'])

const older = readAssistantHistoryPage(db, { threadId: thread.id, before: newest.pageInfo.oldestCursor, turnLimit: 2 })
assert.deepEqual(older.messages.filter((message) => message.role === 'user').map((message) => message.id), ['user-1', 'user-2'])
assert.equal(older.pageInfo.hasOlder, false)
assert.equal(older.pageInfo.hasNewer, true)
assert.equal(typeof older.pageInfo.newestCursor, 'string')
const forwardToNewest = readAssistantHistoryPage(db, { threadId: thread.id, after: older.pageInfo.newestCursor, turnLimit: 2 })
assert.deepEqual(forwardToNewest.messages.filter((message) => message.role === 'user').map((message) => message.id), ['user-3', 'user-4'], 'newer paging reverses the same complete-turn boundary without overlap')
assert.equal(forwardToNewest.pageInfo.hasNewer, false)
assert.throws(() => readAssistantHistoryPage(db, { threadId: thread.id, before: newest.pageInfo.oldestCursor, after: older.pageInfo.newestCursor }), /either a before or after cursor/)
assert.equal(ASSISTANT_HISTORY_PAGE_MAX_RECORDS, 160, 'older pages keep a strict renderer-work budget')
assert.equal(ASSISTANT_HISTORY_PAGE_MAX_CHARACTERS, 900_000, 'older pages keep a strict transfer-memory budget')
assert.equal(new Set([...newest.messages, ...older.messages].map((message) => message.id)).size, newest.messages.length + older.messages.length)
assert.throws(() => readAssistantHistoryPage(db, { threadId: thread.id, before: 'malformed' }), /malformed or stale/)

const detail = readAssistantThreadDetail(db, thread.id)
assert.equal(INITIAL_ASSISTANT_HISTORY_TURN_LIMIT, 3, 'first paint requests enough recent turns to read as an existing conversation')
assert.equal(detail.history.pageInfo.turnCount, 3, 'thread bootstrap exposes three recent turns before the first visible frame')
assert.deepEqual(detail.history.messages.filter((message) => message.role === 'user').map((message) => message.id), ['user-2', 'user-3', 'user-4'])
assert.equal(detail.history.fullyLoaded, false, 'older turns remain available to the scroll stream')
const turnDetail = readAssistantTurnDetail(db, thread.id, 'turn-2')
assert.deepEqual(turnDetail.messages.map((message) => message.id), ['user-2', 'assistant-2', 'assistant-2-final'])
assert.deepEqual(turnDetail.activities.map((activity) => activity.id), ['activity-2'])
assert.deepEqual(searchAssistantTurns(db, thread.id, 'Prompt 2').turnIds, ['turn-2'])
assert.deepEqual(searchAssistantTurns(db, thread.id, 'Tool 3').turnIds, ['turn-3'])

db.run(`INSERT INTO assistant_turns (id, thread_id, model, state, requested_at, started_at, completed_at, assistant_message_id, effort, service_tier, usage_json, updated_at) VALUES (?, ?, ?, 'completed', ?, ?, ?, 'assistant-2', NULL, NULL, NULL, ?)`, [
    'turn-2-replay-orphan',
    thread.id,
    thread.model,
    new Date(Date.parse(at(2)) + 30_000).toISOString(),
    new Date(Date.parse(at(2)) + 30_000).toISOString(),
    new Date(Date.parse(at(2)) + 30_000).toISOString(),
    new Date(Date.parse(at(2)) + 30_000).toISOString()
])
const reviewIndex = readAssistantReviewIndex(db, thread.id)
assert.equal(reviewIndex.totalTurns, 4, 'Review counts the complete persisted chat instead of the loaded page')
assert.equal(reviewIndex.turns.some((turn) => turn.id === 'turn-2-replay-orphan'), false, 'Review merges a replay-only ledger row that reuses an existing final assistant message')
assert.deepEqual(reviewIndex.turns.map((turn) => turn.number), [4, 3, 2, 1], 'Review numbering remains stable and chronological')
const indexedTurnTwo = reviewIndex.turns.find((turn) => turn.id === 'turn-2')
assert.equal(indexedTurnTwo?.prompt?.text, 'Prompt 2')
assert.equal(indexedTurnTwo?.response?.text, 'Final response 2 from the agent', 'Review keeps only the final agent message for the turn')
assert.deepEqual(indexedTurnTwo?.changes.map((change) => change.filePath), ['src/review-index.ts'], 'Review exposes persisted file links without loading full turn details')
assert.equal(indexedTurnTwo?.changes[0]?.additions, 1)
assert.equal(indexedTurnTwo?.changes[0]?.deletions, 1)

const canonicalReplayTurnId = 'shared-turn:review-replay:user-2'
const canonicalReplayCreatedAt = new Date(Date.parse(at(2)) + 148).toISOString()
const canonicalReplayAssistantAt = new Date(Date.parse(at(2)) + 224).toISOString()
const canonicalReplayActivityAt = new Date(Date.parse(at(2)) + 500).toISOString()
const canonicalReplayFinalAt = new Date(Date.parse(at(2)) + 1_000).toISOString()
db.run(`UPDATE assistant_messages SET turn_id = ?, created_at = ?, updated_at = ? WHERE id = 'user-2'`, [canonicalReplayTurnId, canonicalReplayCreatedAt, canonicalReplayCreatedAt])
db.run(`UPDATE assistant_messages SET turn_id = ?, created_at = ?, updated_at = ? WHERE id = 'assistant-2'`, [canonicalReplayTurnId, canonicalReplayAssistantAt, canonicalReplayAssistantAt])
db.run(`UPDATE assistant_messages SET turn_id = ?, created_at = ?, updated_at = ? WHERE id = 'assistant-2-final'`, [canonicalReplayTurnId, canonicalReplayFinalAt, canonicalReplayFinalAt])
db.run(`UPDATE assistant_activities SET turn_id = ?, created_at = ? WHERE id = 'activity-2'`, [canonicalReplayTurnId, canonicalReplayActivityAt])
db.run(`INSERT INTO assistant_messages (id, thread_id, role, text, turn_id, streaming, timeline_sequence, created_at, updated_at) VALUES (?, ?, 'user', 'Prompt 2', NULL, 0, 999, ?, ?)`, ['assistant-message-optimistic-user-2', thread.id, new Date(Date.parse(at(2)) + 50).toISOString(), new Date(Date.parse(at(2)) + 50).toISOString()])
const reconciledReviewIndex = readAssistantReviewIndex(db, thread.id)
const reconciledTurnTwo = reconciledReviewIndex.turns.find((turn) => turn.id === 'turn-2')
assert.equal(reconciledReviewIndex.totalTurns, 4, 'a canonical replay timestamped just after the local request must not duplicate one Review turn')
assert.equal(reconciledTurnTwo?.prompt?.text, 'Prompt 2')
assert.equal(reconciledTurnTwo?.response?.text, 'Final response 2 from the agent')
assert.deepEqual(reconciledTurnTwo?.changes.map((change) => change.filePath), ['src/review-index.ts'])
const reconciledTurnDetail = readAssistantTurnDetail(db, thread.id, 'turn-2')
assert.deepEqual(reconciledTurnDetail.messages.map((message) => message.id), ['user-2', 'assistant-2', 'assistant-2-final'])
assert.deepEqual(reconciledTurnDetail.activities.map((activity) => activity.id), ['activity-2'])

const replayMessages = [
    ...messages.map((message) => message.turnId === 'turn-2'
    ? {
        ...message,
        turnId: canonicalReplayTurnId,
        ...(message.role === 'user'
            ? { createdAt: canonicalReplayCreatedAt, updatedAt: canonicalReplayCreatedAt }
            : { createdAt: canonicalReplayAssistantAt, updatedAt: canonicalReplayAssistantAt })
    }
    : message),
    {
        id: 'assistant-message-optimistic-user-2',
        role: 'user' as const,
        text: 'Prompt 2',
        turnId: null,
        streaming: false,
        timelineSequence: 999,
        createdAt: new Date(Date.parse(at(2)) + 50).toISOString(),
        updatedAt: new Date(Date.parse(at(2)) + 50).toISOString()
    }
]
const replayActivities = activities.map((activity) => activity.turnId === 'turn-2'
    ? { ...activity, turnId: canonicalReplayTurnId, createdAt: canonicalReplayActivityAt }
    : activity)
const reconciledDetailedTurns = buildAssistantDiffTurns({
    messages: replayMessages,
    activities: replayActivities,
    turns: reconciledReviewIndex.turns,
    projectRootPath: thread.cwd
})
assert.equal(reconciledDetailedTurns.length, 4, 'loaded Review detail must reconcile canonical turn IDs and optimistic message replays')
assert.equal(reconciledDetailedTurns.find((turn) => turn.id === 'turn-2')?.response, 'Response 2')
upsertAssistantCanonicalTimelineProjection(db, { threadId: thread.id, messages: [], activities: [] })
assert.equal(db.exec(`SELECT COUNT(*) FROM assistant_messages WHERE id = 'assistant-message-optimistic-user-2'`)[0]?.values?.[0]?.[0], 0, 'canonical persistence removes an optimistic user-message replay atomically')

db.run(`UPDATE assistant_messages SET turn_id = 'turn-2', created_at = ?, updated_at = ? WHERE id IN ('user-2', 'assistant-2', 'assistant-2-final')`, [at(2), at(2)])
db.run(`UPDATE assistant_activities SET turn_id = 'turn-2', created_at = ? WHERE id = 'activity-2'`, [at(2)])

upsertAssistantCanonicalTimelineProjection(db, {
    threadId: thread.id,
    messages: [],
    activities: [{
        id: 'canonical-review-file-change',
        kind: 'file-change',
        tone: 'tool',
        summary: 'Edited file',
        detail: 'src/canonical-review.ts',
        turnId: 'turn-1',
        timelineSequence: 12,
        createdAt: at(1),
        payload: {
            category: 'file-change',
            provider: 'pi',
            status: 'completed',
            source: 'provider-result',
            authoritative: true,
            revision: 3,
            paths: ['src/canonical-review.ts'],
            createdPaths: [],
            changes: [{ path: 'src/canonical-review.ts', kind: 'update', diff: '@@ -1 +1 @@\n-old\n+new' }],
            patch: '--- a/src/canonical-review.ts\n+++ b/src/canonical-review.ts\n@@ -1 +1 @@\n-old\n+new',
            fileCount: 1
        }
    }]
})
const canonicalReviewIndex = readAssistantReviewIndex(db, thread.id)
assert.deepEqual(
    canonicalReviewIndex.turns.find((turn) => turn.id === 'turn-1')?.changes.map((change) => change.filePath),
    ['src/canonical-review.ts'],
    'canonical/TUI backfill rows must be visible through the unchanged Desktop Review index'
)

const shell = toAssistantShellSnapshot(snapshot)
assert.equal('messages' in shell.sessions[0]!.threads[0]!, false)
assert.equal(JSON.stringify(shell).includes('Response 4'), false)
assert.equal(shell.sessions[0]!.threads[0]!.messageCount, messages.length)

const shellSnapshot = {
    ...snapshot,
    sessions: [{
        ...snapshot.sessions[0]!,
        threads: [{
            ...snapshot.sessions[0]!.threads[0]!,
            activePlan: null,
            messages: [],
            activities: [],
            proposedPlans: [],
            pendingApprovals: [],
            pendingUserInputs: []
        }]
    }]
}
const retainedHistory = {
    threadId: thread.id,
    messages: [...older.messages, ...newest.messages],
    activities: [...older.activities, ...newest.activities],
    proposedPlans: [...older.proposedPlans, ...newest.proposedPlans],
    pageInfo: { ...older.pageInfo, newestCursor: newest.pageInfo.newestCursor, hasNewer: newest.pageInfo.hasNewer },
    initialLoading: false,
    loadingOlder: false,
    loadOlderError: null,
    fullyLoaded: true,
    lastUsedAt: Date.now(),
    shellRevision: getAssistantThreadHydrationRevision(shellSnapshot.sessions[0]!.threads[0]!)
}
assert.equal(isAssistantRetainedHistoryFresh(retainedHistory, shellSnapshot.sessions[0]!.threads[0]!), true)
const refreshedNewestHistory = {
    ...newest,
    initialLoading: false,
    loadingOlder: false,
    loadOlderError: null,
    fullyLoaded: false
}
assert.equal(shouldPreserveAssistantLoadedHistoryRange(retainedHistory, refreshedNewestHistory), true)
const reconciledAfterOlderPages = applyAssistantThreadDetail(shellSnapshot, {
    threadId: thread.id,
    activePlan: null,
    pendingApprovals: [],
    pendingUserInputs: [],
    history: refreshedNewestHistory
}, retainedHistory)
assert.equal(reconciledAfterOlderPages.history.pageInfo.oldestCursor, retainedHistory.pageInfo.oldestCursor, 'canonical refresh preserves the cursor for already-loaded older rows')
assert.equal(reconciledAfterOlderPages.history.fullyLoaded, true, 'canonical refresh cannot make a fully loaded older range partial again')
assert.equal(reconciledAfterOlderPages.history.messages.length, retainedHistory.messages.length, 'canonical refresh keeps non-overlapping older rows while replacing the newest page')
const reopenedAtLatest = applyAssistantThreadDetail(reconciledAfterOlderPages.snapshot, {
    threadId: thread.id,
    activePlan: null,
    pendingApprovals: [],
    pendingUserInputs: [],
    history: refreshedNewestHistory
})
assert.deepEqual(reopenedAtLatest.history.messages.map((message) => message.id), refreshedNewestHistory.messages.map((message) => message.id), 'reopening a long chat discards previously loaded older messages before painting the newest page')
assert.deepEqual(reopenedAtLatest.history.activities.map((activity) => activity.id), refreshedNewestHistory.activities.map((activity) => activity.id), 'reopening a long chat discards previously loaded older activities before timeline derivation')
assert.equal(reopenedAtLatest.history.pageInfo.oldestCursor, refreshedNewestHistory.pageInfo.oldestCursor, 'reopening resumes from the newest bounded cursor')
assert.equal(reopenedAtLatest.history.fullyLoaded, refreshedNewestHistory.fullyLoaded, 'reopening cannot inherit stale fully-loaded state from an expanded reader')
const staleOverlappingMessage = {
    ...refreshedNewestHistory.messages.at(-1)!,
    id: 'stale-overlapping-message'
}
const reconciledWithoutStaleOverlap = applyAssistantThreadDetail(shellSnapshot, {
    threadId: thread.id,
    activePlan: null,
    pendingApprovals: [],
    pendingUserInputs: [],
    history: refreshedNewestHistory
}, {
    ...retainedHistory,
    messages: [...retainedHistory.messages, staleOverlappingMessage]
})
assert.equal(reconciledWithoutStaleOverlap.history.messages.some((message) => message.id === staleOverlappingMessage.id), false, 'canonical refresh drops stale cached rows inside the refreshed newest-page range')
assert.equal(isAssistantRetainedHistoryFresh(retainedHistory, {
    ...shellSnapshot.sessions[0]!.threads[0]!,
    updatedAt: at(6),
    messageCount: thread.messageCount - 1
}), false, 'shell revisions invalidate retained rows after external deletion or replacement')
const restoredFromRetainedHistory = applyAssistantRetainedHistory(shellSnapshot, thread.id, retainedHistory)
assert.equal(hasRenderableAssistantRetainedHistory(retainedHistory), true)
assert.equal(
    restoredFromRetainedHistory.sessions[0]!.threads[0]!.messages.length,
    retainedHistory.messages.length,
    'fresh retained history must rematerialize a shell-only thread instead of leaving a blank selected chat'
)
assert.equal(
    restoredFromRetainedHistory.sessions[0]!.threads[0]!.activities.length,
    retainedHistory.activities.length,
    'retained activity rows must survive a shell refresh alongside chat messages'
)
const dematerializedSnapshot = dematerializeAssistantHistories(restoredFromRetainedHistory, new Set())
assert.equal(dematerializedSnapshot.sessions[0]!.threads[0]!.messages.length, 0, 'evicted inactive history releases message payloads from the renderer snapshot')
assert.equal(dematerializedSnapshot.sessions[0]!.threads[0]!.activities.length, 0, 'evicted inactive history releases activity payloads from the renderer snapshot')
assert.equal(dematerializedSnapshot.sessions[0]!.threads[0]!.messageCount, thread.messageCount, 'history eviction preserves shell counters for the chat rail')
assert.equal(
    hasRenderableAssistantRetainedHistory({
        ...retainedHistory,
        messages: [],
        activities: [],
        proposedPlans: []
    }),
    false,
    'an authoritative empty history remains cacheable without pretending it can restore timeline rows'
)

const oversizedInactiveHistories = Object.fromEntries(Array.from({ length: 6 }, (_, index) => [
    `oversized-history-${index}`,
    {
        ...retainedHistory,
        messages: [{ ...retainedHistory.messages.at(-1)!, id: `oversized-cache-message-${index}`, text: String(index).repeat(1_400_000) }],
        activities: [],
        proposedPlans: [],
        lastUsedAt: Date.now() - index
    }
]))
const prunedOversizedHistories = pruneAssistantHistoryCache(oversizedInactiveHistories, new Set())
const retainedInactiveCharacters = Object.values(prunedOversizedHistories).reduce((total, history) => (
    total + estimateAssistantTimelineCollectionsCharacters(history)
), 0)
assert.equal(retainedInactiveCharacters <= DETAIL_CACHE_MAX_TIMELINE_CHARACTERS, true, 'inactive long-chat history uses a renderer-wide content budget')
assert.equal(Object.keys(prunedOversizedHistories).length < Object.keys(oversizedInactiveHistories).length, true, 'switching chats releases oversized inactive timeline payloads')

const metadataOnlyThread: AssistantThread = {
    ...thread,
    messageCount: 0,
    activityCount: 0,
    proposedPlanCount: 0,
    hasActivePlan: false,
    hasPendingApprovals: false,
    hasPendingUserInputs: false,
    activePlan: null,
    messages: [],
    activities: [],
    proposedPlans: [],
    pendingApprovals: [],
    pendingUserInputs: [],
    latestTurn: {
        id: 'missing-history-turn', state: 'completed', requestedAt: at(5), startedAt: at(5), completedAt: at(5),
        assistantMessageId: 'missing-history-message', usage: null
    }
}
assert.equal(hasAssistantPersistedThreadContent(metadataOnlyThread), false, 'completed-turn metadata without persisted timeline rows is not loadable chat history')
assert.equal(shouldShowAssistantThreadHistoryLoader({
    selectionHydrating: false,
    snapshotLoading: false,
    historyLoaded: false,
    historyLoadFailed: false,
    hasPersistedContent: true
}), true, 'persisted timeline rows show a loader until initial hydration finishes')
assert.equal(shouldShowAssistantThreadHistoryLoader({
    selectionHydrating: false,
    snapshotLoading: false,
    historyLoaded: true,
    historyLoadFailed: false,
    hasPersistedContent: true
}), false, 'an authoritative empty hydration result ends the chat loader')
assert.equal(shouldShowAssistantThreadHistoryLoader({
    selectionHydrating: false,
    snapshotLoading: false,
    historyLoaded: false,
    historyLoadFailed: true,
    hasPersistedContent: true
}), false, 'a failed hydration cannot leave the chat loader spinning forever')
assert.match(formatAssistantHistoryLoadError(new Error('Aborted(OOM). Build with -sASSERTIONS for more info.')), /Restart Zyra/, 'SQL.js memory failures explain how to activate the bounded reader')

const tiedMessage = { ...messages[0]!, id: 'tie-message', timelineSequence: undefined, createdAt: at(9) }
const tiedActivity = { ...activities[0]!, id: 'tie-activity', timelineSequence: undefined, createdAt: at(9) }
assert.notEqual(compareAssistantTimelineOrderKeys(getAssistantTimelineOrderKey('message', tiedMessage), getAssistantTimelineOrderKey('activity', tiedActivity)), 0)
assert.ok(compareAssistantTimelineOrderKeys(getAssistantTimelineOrderKey('message', tiedMessage), getAssistantTimelineOrderKey('activity', tiedActivity)) < 0)

const initialRows: TimelineDisplayRow[] = newest.messages.map((message) => ({ kind: 'message', id: message.id, createdAt: message.createdAt, message }))
const stableInitial = computeStableAssistantTimelineRows(null, initialRows)
const changedLastMessage = { ...newest.messages[newest.messages.length - 1]!, text: 'Updated live response' }
const stableUpdate = computeStableAssistantTimelineRows(stableInitial, initialRows.map((row, index) => (
    index === initialRows.length - 1 && row.kind === 'message' ? { ...row, message: changedLastMessage } : row
)))
assert.equal(stableUpdate.rows[0], stableInitial.rows[0], 'updating one live message preserves unrelated row identity')
assert.notEqual(stableUpdate.rows[stableUpdate.rows.length - 1], stableInitial.rows[stableInitial.rows.length - 1])
const prependedRow: TimelineDisplayRow = { kind: 'message', id: older.messages[0]!.id, createdAt: older.messages[0]!.createdAt, message: older.messages[0]! }
const stablePrepend = computeStableAssistantTimelineRows(stableUpdate, [prependedRow, ...stableUpdate.rows])
assert.equal(stablePrepend.rows[1], stableUpdate.rows[0], 'prepending a page retains existing row object references')

const queryPlan = db.exec(`EXPLAIN QUERY PLAN SELECT id FROM assistant_messages WHERE thread_id = ? AND role = 'user' ORDER BY created_at DESC, timeline_sequence DESC, id DESC LIMIT 20`, [thread.id])[0]?.values || []
assert.equal(queryPlan.some((row) => row.some((value) => String(value).includes('idx_assistant_messages_history'))), true)

db.run(`INSERT INTO assistant_messages (id, thread_id, role, text, turn_id, streaming, timeline_sequence, created_at, updated_at) VALUES (?, ?, 'user', ?, NULL, 0, 80, ?, ?)`, ['legacy-user', thread.id, 'Legacy prompt without a ledger row', at(8), at(8)])
db.run(`INSERT INTO assistant_messages (id, thread_id, role, text, turn_id, streaming, timeline_sequence, created_at, updated_at) VALUES (?, ?, 'assistant', ?, NULL, 0, 81, ?, ?)`, ['legacy-assistant', thread.id, 'Legacy final response', at(8), at(8)])
const legacyReviewIndex = readAssistantReviewIndex(db, thread.id)
const legacyIndexTurn = legacyReviewIndex.turns.find((turn) => turn.id === 'message:legacy-user')
assert.equal(legacyReviewIndex.totalTurns, 5, 'legacy user prompts remain part of the complete Review count')
assert.equal(legacyIndexTurn?.response?.text, 'Legacy final response')
const legacyDetail = readAssistantTurnDetail(db, thread.id, 'message:legacy-user')
assert.deepEqual(legacyDetail.messages.map((message) => message.id), ['legacy-user', 'legacy-assistant'], 'opening a legacy index row lazily loads only its timeline window')

const largePrompt = 'x'.repeat(350_000)
for (let index = 1; index <= 6; index += 1) {
    const createdAt = at(20 + index)
    const sequenceBase = 1_000 + index * 100
    db.run(`INSERT INTO assistant_messages (id, thread_id, role, text, turn_id, streaming, timeline_sequence, created_at, updated_at) VALUES (?, ?, 'user', ?, ?, 0, ?, ?, ?)`, [`budget-user-${index}`, thread.id, largePrompt, `budget-turn-${index}`, sequenceBase, createdAt, createdAt])
    for (let activityIndex = 1; activityIndex <= 70; activityIndex += 1) {
        db.run(`INSERT INTO assistant_activities (id, thread_id, kind, tone, summary, detail, turn_id, timeline_sequence, created_at, payload_json) VALUES (?, ?, 'command', 'tool', ?, NULL, ?, ?, ?, '{}')`, [`budget-activity-${index}-${activityIndex}`, thread.id, `Activity ${activityIndex}`, `budget-turn-${index}`, sequenceBase + activityIndex, createdAt])
    }
    db.run(`INSERT INTO assistant_messages (id, thread_id, role, text, turn_id, streaming, timeline_sequence, created_at, updated_at) VALUES (?, ?, 'assistant', ?, ?, 0, ?, ?, ?)`, [`budget-assistant-${index}`, thread.id, `Budget response ${index}`, `budget-turn-${index}`, sequenceBase + 71, createdAt, createdAt])
}
const budgetedPage = readAssistantHistoryPage(db, { threadId: thread.id, turnLimit: 20 })
assert.equal(budgetedPage.pageInfo.turnCount, 1, 'initial history keeps complete newest turns within its smaller first-paint budget')
assert.equal(budgetedPage.messages.some((message) => message.id === 'budget-user-5'), false, 'the oldest over-budget turn remains on the next page')
assert.equal(budgetedPage.messages.some((message) => message.id === 'budget-user-6'), true, 'the newest turn is always retained')
assert.equal(budgetedPage.messages.reduce((total, message) => total + message.text.length, 0) <= INITIAL_ASSISTANT_HISTORY_PAGE_MAX_CHARACTERS, true)
assert.equal(budgetedPage.messages.length + budgetedPage.activities.length + budgetedPage.proposedPlans.length <= INITIAL_ASSISTANT_HISTORY_PAGE_MAX_RECORDS, true)
assert.equal(budgetedPage.pageInfo.hasOlder, true)

const oversizedCreatedAt = at(40)
const oversizedPayload = JSON.stringify({
    status: 'completed',
    toolName: 'read',
    toolCallId: 'oversized-read',
    historyBodyRef: {
        version: 1,
        canonicalChatId: 'canonical:oversized',
        entryIndex: 20,
        entryId: 'entry:oversized-read',
        entrySha256: 'd'.repeat(64),
        toolCallId: 'oversized-read',
        toolName: 'read',
        bodyBytes: ASSISTANT_ACTIVITY_PAYLOAD_MAX_CHARACTERS * 3
    },
    paths: ['assets/large-image.png'],
    surface: { version: 1, kind: 'file-read', lifecycle: 'completed' },
    result: { content: [{ type: 'image', data: 'a'.repeat(ASSISTANT_ACTIVITY_PAYLOAD_MAX_CHARACTERS * 3) }] }
})
db.run(`INSERT INTO assistant_messages (id, thread_id, role, text, turn_id, streaming, timeline_sequence, created_at, updated_at) VALUES (?, ?, 'user', 'Inspect image', 'oversized-turn', 0, 2000, ?, ?)`, ['oversized-user', thread.id, oversizedCreatedAt, oversizedCreatedAt])
db.run(`INSERT INTO assistant_activities (id, thread_id, kind, tone, summary, detail, turn_id, timeline_sequence, created_at, payload_json) VALUES (?, ?, 'file-read', 'tool', 'Read file', 'assets/large-image.png', 'oversized-turn', 2001, ?, ?)`, ['oversized-activity', thread.id, oversizedCreatedAt, oversizedPayload])
db.run(`INSERT INTO assistant_messages (id, thread_id, role, text, turn_id, streaming, timeline_sequence, created_at, updated_at) VALUES (?, ?, 'assistant', 'Image inspected', 'oversized-turn', 0, 2002, ?, ?)`, ['oversized-assistant', thread.id, oversizedCreatedAt, oversizedCreatedAt])
const oversizedPage = readAssistantHistoryPage(db, { threadId: thread.id, turnLimit: 1 })
assert.deepEqual(oversizedPage.messages.map((message) => message.id), ['oversized-user', 'oversized-assistant'], 'an oversized complete turn still loads')
assert.equal(oversizedPage.activities[0]?.payload?.persistencePayloadTruncated, true, 'historical reads omit oversized embedded result bodies before SQL.js materializes them')
assert.equal(oversizedPage.activities[0]?.payload?.originalPayloadCharacters, oversizedPayload.length)
const compactedPayload = serializeAssistantActivityPayload(JSON.parse(oversizedPayload))
const parsedCompactedPayload = JSON.parse(compactedPayload)
assert.equal(compactedPayload.length < ASSISTANT_ACTIVITY_PAYLOAD_MAX_CHARACTERS, true, 'new oversized activity payloads are compacted before persistence')
assert.deepEqual(parsedCompactedPayload.paths, ['assets/large-image.png'], 'payload compaction preserves useful file metadata')
assert.equal(parsedCompactedPayload.historyBodyRef.entryId, 'entry:oversized-read', 'payload compaction preserves deferred-output hydration identity')
assert.equal(parsedCompactedPayload.toolCallId, 'oversized-read')
assert.equal('result' in parsedCompactedPayload, false, 'payload compaction removes the embedded result body')

const serviceSource = readFileSync(new URL('../src/main/assistant/service.ts', import.meta.url), 'utf8')
const assistantPageSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantPage.tsx', import.meta.url), 'utf8')
const assistantStoreSource = readFileSync(new URL('../src/renderer/src/lib/assistant/assistant-store-core.ts', import.meta.url), 'utf8')
const detailBootstrapSource = serviceSource.split('async getThreadDetailBootstrap')[1]?.split('async getHistoryPage')[0] || ''
assert.ok(detailBootstrapSource.indexOf('await this.ensureCanonicalHistoryLoaded') < detailBootstrapSource.indexOf('const detail = await this.persistence.readThreadDetail'), 'chat bootstrap converges canonical history before exposing selected-thread rows')
assert.equal(serviceSource.includes('CANONICAL_CHAT_HISTORY_PAGE_LIMIT = 160'), true, 'canonical first-open acquisition is bounded to the renderer page scale')
assert.match(serviceSource, /!projection\.messages\.some\(\(message\) => message\.role === 'user'\)[\s\S]{0,420}CANONICAL_SINGLE_TURN_MAX_ENTRIES/, 'canonical bootstrap reads additional bounded pages only when needed to complete the latest turn')
assert.match(serviceSource.split('async selectSession')[1]?.split('async selectThread')[0] || '', /const snapshot = toAssistantShellSnapshot[\s\S]{0,180}scheduleSelectedCanonicalSessionSynchronization/, 'session selection returns its authoritative shell before canonical attachment')
assert.match(serviceSource.split('async selectThread')[1]?.split('async getThreadDetailBootstrap')[0] || '', /const snapshot = toAssistantShellSnapshot[\s\S]{0,180}scheduleSelectedCanonicalSessionSynchronization/, 'thread selection returns its authoritative shell before canonical attachment')
assert.match(assistantPageSource, /buildAssistantDiffTurns\(\{[\s\S]{0,180}turns: reviewIndex\?\.turns/, 'Review detail rows must receive persisted index boundaries before merging')
assert.match(assistantStoreSource, /const requestedRevision = currentHistory\.shellRevision[\s\S]{0,2200}getAssistantThreadHydrationRevision\(latestThread\) !== requestedRevision/, 'older-page responses are rejected when the thread revision changes in flight')
assert.match(assistantStoreSource, /queuedEvents\.some\(\(event\) => shouldRehydrateAssistantHistoryAfterCanonicalEvent\(event, selectedThreadId\)\)[\s\S]{0,180}scheduleCanonicalHistoryRehydration/, 'background canonical reconciliation refreshes stale pagination after the local-first paint')
assert.match(assistantStoreSource, /selectionTransitionKey === targetHydrationKey[\s\S]{0,120}selectionHydrationKey === targetHydrationKey/, 'history pagination is blocked while the selected chat is changing or resetting its loaded range')
assert.match(assistantStoreSource, /requestedTurnLimit = Math\.max\(1, Math\.min\(3, Math\.floor\(turnLimit \|\| 1\)\)\)/, 'scroll demand is defensively capped at one to three turns')
assert.equal(assistantStoreSource.includes('turnLimit: requestedTurnLimit'), true, 'the bounded adaptive turn count reaches the history-page IPC')
assert.doesNotMatch(assistantStoreSource, /olderLoadNotBeforeByThreadId|ASSISTANT_OLDER_HISTORY_MIN_INTERVAL_MS/, 'time-based cooldowns cannot stall continuous upward reading')
assert.match(assistantStoreSource, /if \(revisionChanged\)[\s\S]{0,700}requestSessionHydration\(targetSessionId, targetThreadId\)/, 'stale older-page work converges through a fresh bounded hydration')
assert.doesNotMatch(assistantStoreSource, /revisionRetryAttempt|loadOlderHistory\(targetThreadId, revisionRetryAttempt/, 'a revision-rejected older page cannot automatically chain another page onto a reopen')

const virtualTimelineSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantVirtualTimeline.tsx', import.meta.url), 'utf8')
assert.equal(virtualTimelineSource.includes('initialScrollAtEnd'), true, 'LegendList starts initial positioning at the newest row')
const initialTimelineLoadSource = virtualTimelineSource.split('const handleInitialLoad')[1]?.split('useLayoutEffect')[0] || ''
const startupTimelinePresentationSource = virtualTimelineSource.split('const scheduleInitialPresentation')[1]?.split('const stopFollowingForUserNavigation')[0] || ''
assert.doesNotMatch(initialTimelineLoadSource, /scrollToEnd/, 'measured initial layout is not overridden after LegendList reaches its correct end position')
assert.doesNotMatch(startupTimelinePresentationSource, /scrollToEnd/, 'chat switching does not stack estimated end corrections over LegendList anchoring')
assert.equal(virtualTimelineSource.includes('maintainVisibleContentPosition={maintainVisibleContentPosition}'), true, 'older-page prepends and row measurements preserve the visible anchor')
assert.equal(virtualTimelineSource.includes('onLoad={handleInitialLoad}'), true, 'the virtual list waits for measured initial layout before arming older history')
assert.equal(virtualTimelineSource.includes('INITIAL_END_FOLLOW_DELAYS_MS'), false, 'initial positioning does not replay timer-driven viewport corrections')
assert.match(virtualTimelineSource, /addEventListener\('wheel', handleWheel, \{ passive: true \}\)/, 'physical wheel motion stays compositor-owned during virtual history updates')
assert.equal(virtualTimelineSource.includes('wheelTargetRef'), false, 'virtual history cannot accumulate a delayed synthetic wheel target')
assert.equal(virtualTimelineSource.includes('key={props.windowKey}'), false, 'switching chats reuses the measured list surface while the explicit startup alignment establishes the new window')
assert.match(virtualTimelineSource, /resolveAssistantHistoryStreamPlan\(\{[\s\S]{0,160}startupSettled,[\s\S]{0,160}upwardIntent:/, 'ordinary older-history streaming requires measured startup plus current upward intent')
assert.equal(virtualTimelineSource.includes('resolveAssistantInitialHistoryBackfill'), true, 'an underfilled reopened transcript may backfill a bounded screen of local context without waiting for a fake scroll gesture')
assert.equal(virtualTimelineSource.includes('hasLoadError: Boolean(props.loadOlderError)'), true, 'a failed older page cannot enter an automatic retry loop')
assert.equal(virtualTimelineSource.includes('olderLoadRequestPendingRef.current = true'), true, 'only one cursor page can be in flight')
assert.equal(virtualTimelineSource.includes("event.deltaY < 0"), true, 'upward wheel intent arms automatic older-page loading')
assert.equal(virtualTimelineSource.includes('contentInsetEndAdjustment={props.contentInsetEndAdjustment}'), true, 'LegendList receives the real composer inset for its own measured scroll range')
assert.equal(virtualTimelineSource.includes('previousContentInsetEndRef'), false, 'composer resizing has no second viewport controller')

const residentFixtureThread = createAssistantLongHistoryFixture(500, 100).sessions[0]!.threads[0]!
const oversizedResidentHistory = {
    threadId: residentFixtureThread.id,
    messages: residentFixtureThread.messages,
    activities: residentFixtureThread.activities,
    proposedPlans: residentFixtureThread.proposedPlans,
    pageInfo: { oldestCursor: 'old-edge', newestCursor: null, hasOlder: true, hasNewer: false, turnCount: 500 },
    initialLoading: false,
    loadingOlder: false,
    loadingNewer: false,
    loadOlderError: null,
    loadNewerError: null,
    fullyLoaded: false,
    lastUsedAt: Date.now(),
    shellRevision: 'resident-fixture'
}
const olderBoundedWindow = boundAssistantActiveHistoryWindow(oversizedResidentHistory, 'older')
assert.ok(olderBoundedWindow.messages.length + olderBoundedWindow.activities.length + olderBoundedWindow.proposedPlans.length <= ACTIVE_ASSISTANT_HISTORY_MAX_RECORDS, 'older streaming evicts complete newest turns at the resident hard bound')
assert.equal(olderBoundedWindow.pageInfo.hasNewer, true)
assert.equal(typeof olderBoundedWindow.pageInfo.newestCursor, 'string')
const newerBoundedWindow = boundAssistantActiveHistoryWindow(oversizedResidentHistory, 'newer')
assert.ok(newerBoundedWindow.messages.length + newerBoundedWindow.activities.length + newerBoundedWindow.proposedPlans.length <= ACTIVE_ASSISTANT_HISTORY_MAX_RECORDS, 'newer streaming evicts complete oldest turns at the resident hard bound')
assert.equal(newerBoundedWindow.pageInfo.hasOlder, true)
assert.equal(typeof newerBoundedWindow.pageInfo.oldestCursor, 'string')
const detachedWindowSnapshot = replaceAssistantVisibleHistory(
    createAssistantLongHistoryFixture(500, 100),
    residentFixtureThread.id,
    olderBoundedWindow
)
const detachedWindowThread = detachedWindowSnapshot.sessions[0]!.threads[0]!
assert.deepEqual(detachedWindowThread.messages, olderBoundedWindow.messages, 'live-edge projection cannot inject a disjoint newest turn into an older detached window')

const developmentFixtureDb = new SQL.Database()
initializeAssistantPersistenceSchema(developmentFixtureDb)
const developmentFixtureSnapshot = createDefaultSnapshot()
const developmentFixtureSessions = createAssistantDevelopmentChatFixtures({
    cwd: 'C:/fixture-workspace',
    now: Date.parse('2026-09-04T12:00:00.000Z')
}).sessions
const heavyDevelopmentSession = developmentFixtureSessions.find((entry) => entry.id === ASSISTANT_DEVELOPMENT_HEAVY_SESSION_ID)!
developmentFixtureSnapshot.selectedSessionId = heavyDevelopmentSession.id
developmentFixtureSnapshot.sessions = developmentFixtureSessions
replaceAssistantSnapshot(developmentFixtureDb, developmentFixtureSnapshot)
const heavyDevelopmentThread = heavyDevelopmentSession.threads[0]!
const heavyDevelopmentFirstPage = readAssistantThreadDetail(developmentFixtureDb, heavyDevelopmentThread.id).history
assert.equal(heavyDevelopmentFirstPage.pageInfo.turnCount, 1, 'the heavy dev fixture deliberately opens on one short newest turn')
assert.equal(heavyDevelopmentFirstPage.pageInfo.hasOlder, true, 'the heavy dev fixture exposes older context for automatic backfill')
assert.deepEqual(
    heavyDevelopmentFirstPage.messages.filter((message) => message.role === 'user').map((message) => message.turnId),
    ['development-fixture:heavy:turn-220']
)
const heavyDevelopmentBackfill = readAssistantHistoryPage(developmentFixtureDb, {
    threadId: heavyDevelopmentThread.id,
    before: heavyDevelopmentFirstPage.pageInfo.oldestCursor,
    turnLimit: 1
})
assert.equal(heavyDevelopmentBackfill.activities.length, 132, 'the first fixture backfill carries the oversized penultimate Action batch intact')
assert.deepEqual(
    heavyDevelopmentBackfill.messages.filter((message) => message.role === 'user').map((message) => message.turnId),
    ['development-fixture:heavy:turn-219']
)
developmentFixtureDb.close()

db.close()
console.log('Assistant paged history contract: ok')
