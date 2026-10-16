import assert from 'node:assert/strict'
import initSqlJs from 'sql.js/dist/sql-asm.js'
import type { Database } from 'sql.js/dist/sql-asm.js'
import type { AssistantDomainEvent, AssistantPendingApproval, AssistantPendingUserInput } from '../src/shared/assistant/contracts'
import { createDefaultAssistantSnapshot, applyAssistantDomainEvent } from '../src/shared/assistant/projector'
import { createAssistantThread } from '../src/main/assistant/service-state'
import { createAssistantSessionRecord } from '../src/main/assistant/service-records'
import { initializeAssistantPersistenceSchema } from '../src/main/assistant/persistence-utils'
import { persistAssistantEvent, replaceAssistantSnapshot } from '../src/main/assistant/persistence-write'
import { readAssistantPendingUserInput, readAssistantTimelineProjectionRows } from '../src/main/assistant/persistence-read'
import { openNativeAssistantDatabase } from '../src/main/assistant/native-sqlite-adapter'

const at = '2026-10-01T19:00:00.000Z'
const question: AssistantPendingUserInput = {
    id: 'durable-question', requestId: 'legacy-request',
    questions: [{ id: 'choice', header: 'Choice', question: 'Which?', type: 'text', options: [], required: true, allowOther: false }],
    status: 'resolved', answers: { choice: 'Small fix' }, responseMessageId: 'answer',
    turnId: 'turn', createdAt: at, resolvedAt: at
}
const approval: AssistantPendingApproval = {
    id: 'durable-approval', requestId: 'legacy-approval-request', requestType: 'command',
    title: 'Allow command', status: 'resolved', decision: 'acceptOnce', turnId: 'turn', createdAt: at, resolvedAt: at
}

function checkPersistence(db: Database, backend: string) {
    initializeAssistantPersistenceSchema(db)
    const thread = createAssistantThread(at)
    thread.id = 'request-thread'
    thread.state = 'ready'
    thread.pendingUserInputs = [question]
    thread.pendingApprovals = [approval]
    const snapshot = createDefaultAssistantSnapshot()
    snapshot.sessions = [createAssistantSessionRecord({ sessionId: 'request-session', title: 'Requests', projectPath: null, createdAt: at, thread })]
    replaceAssistantSnapshot(db, snapshot)
    let sequence = 0
    const write = (type: 'thread.user-input.updated' | 'thread.approval.updated', value: AssistantPendingUserInput | AssistantPendingApproval) => {
        if (type === 'thread.user-input.updated') thread.pendingUserInputs = [value as AssistantPendingUserInput]
        else thread.pendingApprovals = [value as AssistantPendingApproval]
        const event: AssistantDomainEvent = {
            eventId: `event-${++sequence}`, type, sequence, occurredAt: at, sessionId: 'request-session', threadId: thread.id,
            payload: { threadId: thread.id, [type === 'thread.user-input.updated' ? 'userInput' : 'approval']: value }
        }
        persistAssistantEvent(db, event, snapshot)
        return event
    }

    // Recovery preserves the durable row ID while enriching its request identity.
    const recovered = { ...question, requestId: 'canonical-request' }
    const event = write('thread.user-input.updated', recovered)
    persistAssistantEvent(db, event, snapshot)
    assert.deepEqual(readAssistantTimelineProjectionRows(db, thread.id).pendingUserInputs, [recovered], `${backend}: stable row ID accepts recovered request identity and repeated event`)
    write('thread.user-input.updated', { ...recovered, id: 'new-projection-id' })
    assert.equal(readAssistantTimelineProjectionRows(db, thread.id).pendingUserInputs.length, 1, `${backend}: request identity still reconciles changed projection IDs`)
    write('thread.approval.updated', { ...approval, requestId: 'canonical-approval-request' })
    assert.equal(db.exec('SELECT request_id FROM assistant_pending_approvals WHERE id = ?', [approval.id])[0]!.values[0]![0], 'canonical-approval-request', `${backend}: approvals accept stable row ID updates`)
    assert.equal(readAssistantPendingUserInput(db, recovered.requestId), null, `${backend}: resolved records never restore a pending form`)
    const pending = { ...question, id: 'cold-pending', requestId: 'cold-request', status: 'pending' as const, answers: null, resolvedAt: null, responseMessageId: null }
    write('thread.user-input.updated', pending)
    assert.deepEqual(readAssistantPendingUserInput(db, pending.requestId), { threadId: thread.id, userInput: pending }, `${backend}: exact indexed lookup restores saved request ownership and schema`)
    assert.equal(readAssistantPendingUserInput(db, 'missing-request'), null)
    assert.equal(readAssistantPendingUserInput(db, "' OR 1=1 --"), null, `${backend}: request identity is bound, not interpreted as SQL`)
    console.log(`${backend}: stable IDs, request IDs, replay, and approval writes: ok`)

    for (const [type, original, table] of [
        ['thread.user-input.updated', question, 'assistant_pending_user_inputs'],
        ['thread.approval.updated', approval, 'assistant_pending_approvals']
    ] as const) {
        const left = { ...original, id: `${table}-left`, requestId: `${table}-legacy` }
        const right = { ...original, id: `${table}-right`, requestId: `${table}-canonical` }
        const unrelated = { ...original, id: `${table}-unrelated`, requestId: `${table}-unrelated-request`, status: 'pending' as const }
        write(type, left); write(type, right); write(type, unrelated)
        const merged = { ...left, requestId: right.requestId }
        const replay = write(type, merged)
        for (let retry = 0; retry < 3; retry++) persistAssistantEvent(db, replay, snapshot)
        assert.deepEqual(db.exec(`SELECT id, request_id FROM ${table} WHERE id IN (?, ?) ORDER BY id`, [left.id, right.id])[0]!.values, [[left.id, right.requestId]], `${backend}: both stored aliases converge without another unique-constraint failure`)
        assert.equal(db.exec(`SELECT status FROM ${table} WHERE id = ?`, [unrelated.id])[0]!.values[0]![0], 'pending', 'Unrelated pending requests survive alias reconciliation')

        const projectedAliases = structuredClone(snapshot)
        const target = projectedAliases.sessions[0]!.threads[0]!
        if (type === 'thread.user-input.updated') target.pendingUserInputs = [left, right, unrelated] as AssistantPendingUserInput[]
        else target.pendingApprovals = [left, right, unrelated] as AssistantPendingApproval[]
        const projected = applyAssistantDomainEvent(projectedAliases, replay).sessions[0]!.threads[0]!
        const values = type === 'thread.user-input.updated' ? projected.pendingUserInputs : projected.pendingApprovals
        assert.deepEqual(values.map(value => value.id), [merged.id, unrelated.id], 'Projection collapses both aliases while keeping unrelated requests')
        assert.equal((type === 'thread.user-input.updated' ? target.pendingUserInputs : target.pendingApprovals).length, 3, 'Projection preserves its previous snapshot')

        // A colliding provider ID from another chat must never steal this row.
        const foreignThread = createAssistantThread(at)
        foreignThread.id = `${table}-foreign-thread`
        snapshot.sessions[0]!.threads.push(foreignThread)
        snapshot.sessions[0]!.threadIds.push(foreignThread.id)
        persistAssistantEvent(db, { ...replay, type: 'thread.created', threadId: foreignThread.id }, snapshot)
        const foreign = { ...merged, requestId: `${table}-foreign-request` }
        if (type === 'thread.user-input.updated') foreignThread.pendingUserInputs = [foreign as AssistantPendingUserInput]
        else foreignThread.pendingApprovals = [foreign as AssistantPendingApproval]
        assert.throws(() => persistAssistantEvent(db, { ...replay, threadId: foreignThread.id, payload: { [type === 'thread.user-input.updated' ? 'userInput' : 'approval']: foreign } }, snapshot), /collision across threads/, 'Cross-thread collision rolls back instead of overwriting a different question')
        assert.deepEqual(db.exec(`SELECT thread_id, request_id FROM ${table} WHERE id = ?`, [merged.id])[0]!.values, [[thread.id, merged.requestId]])
    }
    console.log(`${backend}: existing aliases, replay retries, projection deduplication, unrelated requests, and cross-thread rollback: ok`)

    // A failed batch must not prevent subsequent, unrelated writes once replayed.
    thread.messages = [{ id: 'later-answer', role: 'assistant', text: 'Saved after the recovered question', turnId: 'turn', streaming: false, createdAt: at, updatedAt: at }]
    persistAssistantEvent(db, { ...event, eventId: 'later-event', sequence: ++sequence, type: 'thread.message.assistant.completed', payload: { messageId: 'later-answer' } }, snapshot)
    assert.equal(readAssistantTimelineProjectionRows(db, thread.id).messages[0]!.id, 'later-answer')

    const projected = applyAssistantDomainEvent(snapshot, { ...event, payload: { userInput: { ...thread.pendingUserInputs[0]!, requestId: 'latest-request' }, threadId: thread.id } })
    assert.equal(projected.sessions[0]!.threads[0]!.pendingUserInputs.length, 1, 'Question projection updates a stable ID instead of appending a duplicate')
}

const SQL = await initSqlJs()
for (const [backend, db] of [['sql.js', new SQL.Database()], ['native SQLite', await openNativeAssistantDatabase(':memory:')]] as const) {
    try { checkPersistence(db, backend) } finally { db.close() }
}
