import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import initSqlJs from 'sql.js/dist/sql-asm.js'
import type { AssistantActivity, AssistantDomainEvent, AssistantMessage, AssistantSession, AssistantThread } from '../src/shared/assistant/contracts'
import { initializeAssistantPersistenceSchema } from '../src/main/assistant/persistence-utils'
import { readAssistantPersistenceRecord, readAssistantTimelineProjectionRows } from '../src/main/assistant/persistence-read'
import { persistAssistantEvent, replaceAssistantSnapshot } from '../src/main/assistant/persistence-write'
import { createDefaultSnapshot } from '../src/main/assistant/projector'
import { applyAssistantDomainEvent } from '../src/shared/assistant/projector'

const createdAt = '2026-07-15T12:00:00.000Z'
const oldMessage: AssistantMessage = {
    id: 'message-old',
    role: 'user',
    text: 'Keep this older prompt.',
    turnId: null,
    streaming: false,
    createdAt,
    updatedAt: createdAt
}
const currentMessage: AssistantMessage = {
    id: 'message-current',
    role: 'assistant',
    text: 'Keep this current response.',
    turnId: 'turn-current',
    streaming: false,
    providerItemId: 'voice-provider-current',
    modality: 'voice',
    createdAt: '2026-07-15T12:01:00.000Z',
    updatedAt: '2026-07-15T12:01:00.000Z'
}
const oldActivity: AssistantActivity = {
    id: 'activity-old',
    kind: 'command',
    tone: 'tool',
    summary: 'Older command',
    turnId: 'turn-old',
    createdAt
}
const currentActivity: AssistantActivity = {
    id: 'activity-current',
    kind: 'error',
    tone: 'error',
    summary: 'Assistant error',
    turnId: 'turn-current',
    turnTerminalOutcome: 'failed',
    createdAt: '2026-07-15T12:01:00.000Z'
}

const thread: AssistantThread = {
    id: 'thread-history',
    providerThreadId: 'canonical:history',
    source: 'root',
    parentThreadId: null,
    providerParentThreadId: null,
    subagentDepth: null,
    agentNickname: null,
    agentRole: null,
    model: 'test-model',
    cwd: 'C:/project',
    messageCount: 2,
    lastSeenCompletedTurnId: null,
    runtimeMode: 'approval-required',
    interactionMode: 'default',
    state: 'ready',
    canonicalHistoryModifiedAt: '2026-07-15T12:01:00.000Z',
    canonicalHistoryEntryCount: 42,
    lastError: null,
    createdAt,
    updatedAt: currentMessage.updatedAt,
    latestTurn: null,
    activePlan: null,
    messages: [oldMessage, currentMessage],
    proposedPlans: [],
    activities: [oldActivity, currentActivity],
    pendingApprovals: [],
    pendingUserInputs: []
}
const session: AssistantSession = {
    id: 'session-history',
    title: 'History persistence test',
    titleManuallySet: true,
    mode: 'work',
    projectPath: 'C:/project',
    playgroundLabId: null,
    pendingLabRequest: null,
    archived: false,
    settled: true,
    settlementManual: true,
    createdAt,
    updatedAt: currentMessage.updatedAt,
    activeThreadId: thread.id,
    threadIds: [thread.id],
    threads: [thread]
}
const snapshot = createDefaultSnapshot()
snapshot.selectedSessionId = session.id
snapshot.sessions = [session]

const SQL = await initSqlJs()
const db = new SQL.Database()
initializeAssistantPersistenceSchema(db)
replaceAssistantSnapshot(db, snapshot)
assert.equal(readAssistantPersistenceRecord(db).snapshot.sessions[0]?.titleManuallySet, true, 'A manual name survives restart even before canonical attachment')
assert.equal(readAssistantPersistenceRecord(db).snapshot.sessions[0]?.settled, true, 'Cold desktop catalog retains server settlement without reapplying local age rules')
assert.equal(readAssistantPersistenceRecord(db).snapshot.sessions[0]?.settlementManual, true, 'Canonical migration marker survives catalog cache hydration')
const clearSettlementEvent: AssistantDomainEvent = {
    sequence: 2, eventId: 'clear-legacy-canonical-settlement', type: 'session.updated',
    occurredAt: createdAt, sessionId: session.id,
    payload: { sessionId: session.id, patch: { settled: null, settlementManual: null } }
}
const replayedClear = JSON.parse(JSON.stringify(clearSettlementEvent))
const clearedSettlement = applyAssistantDomainEvent(snapshot, replayedClear)
assert.equal(clearedSettlement.sessions[0]?.settled, undefined, 'Serializable clearing markers remove canonical authority in every client projector')
assert.equal(clearedSettlement.sessions[0]?.settlementManual, undefined)
persistAssistantEvent(db, replayedClear, clearedSettlement)
const reopenedSettlementDb = new SQL.Database(db.export())
assert.equal(readAssistantPersistenceRecord(reopenedSettlementDb).snapshot.sessions[0]?.settled, undefined, 'Cleared metadata stays absent after database reopen')
assert.equal(readAssistantPersistenceRecord(reopenedSettlementDb).snapshot.sessions[0]?.settlementManual, undefined)
reopenedSettlementDb.close()
replaceAssistantSnapshot(db, snapshot)
const persistedThread = readAssistantPersistenceRecord(db).snapshot.sessions[0]?.threads[0]
assert.equal(persistedThread?.canonicalHistoryModifiedAt, thread.canonicalHistoryModifiedAt)
assert.equal(persistedThread?.canonicalHistoryEntryCount, thread.canonicalHistoryEntryCount)
const persistedVoiceMessage = readAssistantTimelineProjectionRows(db, thread.id).messages.find((message) => message.id === currentMessage.id)
assert.equal(persistedVoiceMessage?.providerItemId, currentMessage.providerItemId, 'Voice provider identity must survive Assistant SQLite hydration')
assert.equal(persistedVoiceMessage?.modality, 'voice', 'Voice modality must survive Assistant SQLite hydration')
const persistedTerminalActivity = readAssistantTimelineProjectionRows(db, thread.id).activities.find((activity) => activity.id === currentActivity.id)
assert.equal(persistedTerminalActivity?.turnTerminalOutcome, 'failed', 'canonical reconciliation reads retain persisted terminal outcomes')

const streamingVoiceMessageId = 'voice_assistant_projector_handoff'
const streamingVoiceDeltaEvent: AssistantDomainEvent = {
    sequence: 10,
    eventId: 'event-voice-assistant-delta',
    type: 'thread.message.assistant.delta',
    occurredAt: '2026-07-15T12:02:00.000Z',
    sessionId: session.id,
    threadId: thread.id,
    payload: {
        threadId: thread.id,
        messageId: streamingVoiceMessageId,
        delta: 'Streaming Voice answer.',
        turnId: null
    }
}
const streamingVoiceCompletedEvent: AssistantDomainEvent = {
    sequence: 11,
    eventId: 'event-voice-assistant-completed',
    type: 'thread.message.assistant.completed',
    occurredAt: '2026-07-15T12:02:01.000Z',
    sessionId: session.id,
    threadId: thread.id,
    payload: {
        threadId: thread.id,
        messageId: streamingVoiceMessageId,
        text: 'Streaming Voice answer.',
        message: {
            id: streamingVoiceMessageId,
            role: 'assistant',
            text: 'Streaming Voice answer.',
            turnId: null,
            streaming: false,
            providerItemId: 'voice-provider-projector-handoff',
            modality: 'voice',
            createdAt: streamingVoiceDeltaEvent.occurredAt,
            updatedAt: '2026-07-15T12:02:01.000Z'
        }
    }
}
const projectedVoiceDelta = applyAssistantDomainEvent(snapshot, streamingVoiceDeltaEvent)
const projectedVoiceCompletion = applyAssistantDomainEvent(projectedVoiceDelta, streamingVoiceCompletedEvent)
const projectedVoiceMessage = projectedVoiceCompletion.sessions[0]?.threads[0]?.messages.find((message) => message.id === streamingVoiceMessageId)
assert.equal(projectedVoiceMessage?.providerItemId, 'voice-provider-projector-handoff', 'the canonical completion must transfer provider identity onto its existing streaming row')
assert.equal(projectedVoiceMessage?.modality, 'voice', 'the canonical completion must transfer Voice modality onto its existing streaming row')

const lateTurnMessageId = 'assistant-message-late-turn-identity'
const projectedLateTurnDelta = applyAssistantDomainEvent(projectedVoiceCompletion, {
    sequence: 12,
    eventId: 'event-late-turn-delta',
    type: 'thread.message.assistant.delta',
    occurredAt: '2026-07-15T12:03:00.000Z',
    sessionId: session.id,
    threadId: thread.id,
    payload: {
        threadId: thread.id,
        messageId: lateTurnMessageId,
        delta: 'Final response',
        turnId: null
    }
})
const projectedLateTurnCompletion = applyAssistantDomainEvent(projectedLateTurnDelta, {
    sequence: 13,
    eventId: 'event-late-turn-completed',
    type: 'thread.message.assistant.completed',
    occurredAt: '2026-07-15T12:03:01.000Z',
    sessionId: session.id,
    threadId: thread.id,
    payload: {
        threadId: thread.id,
        messageId: lateTurnMessageId,
        text: 'Final response',
        turnId: 'turn-late-identity'
    }
})
const projectedLateTurnMessage = projectedLateTurnCompletion.sessions[0]?.threads[0]?.messages.find((message) => message.id === lateTurnMessageId)
assert.equal(projectedLateTurnMessage?.turnId, 'turn-late-identity', 'a completed live response backfills turn identity so work can collapse without reloading history')

const partialThread: AssistantThread = {
    ...thread,
    messageCount: 1,
    messages: [currentMessage],
    activities: [currentActivity]
}
const partialSnapshot = {
    ...snapshot,
    snapshotSequence: snapshot.snapshotSequence + 1,
    sessions: [{ ...session, threads: [partialThread] }]
}
const partialEvent: AssistantDomainEvent = {
    sequence: 1,
    eventId: 'event-partial-history',
    type: 'thread.updated',
    occurredAt: currentMessage.updatedAt,
    sessionId: session.id,
    threadId: thread.id,
    payload: {
        threadId: thread.id,
        patch: {
            messages: partialThread.messages,
            activities: partialThread.activities
        }
    }
}
const projectedPartialSnapshot = applyAssistantDomainEvent(snapshot, partialEvent)
const projectedPartialThread = projectedPartialSnapshot.sessions[0]?.threads[0]
assert.equal(projectedPartialThread?.messages.length, 2, 'partial message patches must not erase older rows from live UI state')
assert.equal(projectedPartialThread?.activities.length, 2, 'partial activity patches must not erase older rows from live UI state')

persistAssistantEvent(db, partialEvent, partialSnapshot)

assert.equal(db.exec("SELECT COUNT(*) FROM assistant_messages WHERE thread_id = 'thread-history'")[0]?.values[0]?.[0], 2, 'partial message snapshots must not erase older persisted rows')
assert.equal(db.exec("SELECT COUNT(*) FROM assistant_activities WHERE thread_id = 'thread-history'")[0]?.values[0]?.[0], 2, 'partial activity snapshots must not erase older persisted rows')

const explicitDeleteEvent: AssistantDomainEvent = {
    ...partialEvent,
    sequence: 2,
    eventId: 'event-explicit-delete',
    payload: {
        ...partialEvent.payload,
        removedMessageIds: [oldMessage.id],
        removedActivityIds: [oldActivity.id]
    }
}
const projectedDeleteSnapshot = applyAssistantDomainEvent(projectedPartialSnapshot, explicitDeleteEvent)
const projectedDeleteThread = projectedDeleteSnapshot.sessions[0]?.threads[0]
assert.deepEqual(projectedDeleteThread?.messages.map((entry) => entry.id), [currentMessage.id], 'explicit deletion removes only the requested message from live UI state')
assert.deepEqual(projectedDeleteThread?.activities.map((entry) => entry.id), [currentActivity.id], 'explicit deletion removes only the requested activity from live UI state')

persistAssistantEvent(db, explicitDeleteEvent, partialSnapshot)

assert.deepEqual(db.exec("SELECT id FROM assistant_messages WHERE thread_id = 'thread-history' ORDER BY id")[0]?.values, [[currentMessage.id]], 'explicit deletion removes only the requested message row')
assert.deepEqual(db.exec("SELECT id FROM assistant_activities WHERE thread_id = 'thread-history' ORDER BY id")[0]?.values, [[currentActivity.id]], 'explicit deletion removes only the requested activity row')

const unloadedDeleteEvent: AssistantDomainEvent = {
    ...partialEvent,
    sequence: 3,
    eventId: 'event-unloaded-delete',
    payload: {
        threadId: thread.id,
        patch: { messageCount: 0, activityCount: 0, updatedAt: currentMessage.updatedAt },
        removedMessageIds: [currentMessage.id],
        removedActivityIds: [currentActivity.id]
    }
}
const projectedUnloadedDelete = applyAssistantDomainEvent(projectedDeleteSnapshot, unloadedDeleteEvent)
assert.equal(projectedUnloadedDelete.sessions[0]?.threads[0]?.messages.length, 0, 'exact removed IDs update loaded renderer rows without a complete replacement array')
persistAssistantEvent(db, unloadedDeleteEvent, partialSnapshot)
assert.equal(db.exec("SELECT COUNT(*) FROM assistant_messages WHERE thread_id = 'thread-history'")[0]?.values[0]?.[0], 0, 'persistence deletes unloaded messages from exact IDs without renderer history bodies')
assert.equal(db.exec("SELECT COUNT(*) FROM assistant_activities WHERE thread_id = 'thread-history'")[0]?.values[0]?.[0], 0, 'persistence deletes unloaded activities from exact IDs without renderer history bodies')

const persistenceSource = readFileSync(new URL('../src/main/assistant/persistence.ts', import.meta.url), 'utf8')
assert.match(persistenceSource, /this\.pendingEvents\.unshift\(\.\.\.eventsToPersist\)/, 'a failed persistence batch remains queued for retry')
assert.match(persistenceSource, /async close\(\): Promise<void>[\s\S]*await this\.flush\(\)[\s\S]*this\.db\?\.close\(\)/, 'Assistant shutdown flushes pending events before closing SQLite')
assert.match(persistenceSource, /if \(databaseWriteError\) throw databaseWriteError/, 'SQL.js shutdown cannot report success after its database export fails')

const asyncQuestionEvent: AssistantDomainEvent = {
    sequence: 100, eventId: 'async-question', type: 'thread.user-input.updated', occurredAt: createdAt, sessionId: session.id, threadId: thread.id,
    payload: { threadId: thread.id, userInput: { id: 'async-input', requestId: 'async-request', mode: 'async',
        questions: [{ id: 'choice', header: 'Choice', question: 'Which branch?', type: 'text', options: [], required: true, allowOther: true }],
        status: 'pending', answers: null, turnId: null, createdAt, resolvedAt: null } }
}
const withAsync = applyAssistantDomainEvent(snapshot, asyncQuestionEvent)
assert.equal(withAsync.sessions[0].threads[0].hasPendingUserInputs, false, 'Answer-later questions do not put the running thread into a blocking phase')
replaceAssistantSnapshot(db, withAsync)
assert.equal(readAssistantTimelineProjectionRows(db, thread.id).pendingUserInputs[0]?.mode, 'async', 'Async question mode survives SQLite history hydration')
assert.equal(readAssistantPersistenceRecord(db).snapshot.sessions[0].threads[0].hasPendingUserInputs, false, 'Cold shell does not mistake async questions for blockers')

db.close()
console.log('Assistant history persistence contract: ok')
