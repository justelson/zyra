import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Database } from 'bun:sqlite'
import type { Database as SqlDatabase, SqlValue } from 'sql.js/dist/sql-asm.js'
import { initializeAssistantPersistenceSchema } from '../src/main/assistant/persistence-utils'
import {
    backfillAssistantSearchIndexBatch,
    initializeAssistantSearchIndex,
    searchAssistantChatsFallback
} from '../src/main/assistant/assistant-search-index'
import { parseAssistantChatSearchQuery } from '../src/shared/assistant/chat-search'
import { readAssistantHistoryAroundMessage } from '../src/main/assistant/persistence-history'

const searchIndexSource = readFileSync(new URL('../src/main/assistant/assistant-search-index.ts', import.meta.url), 'utf8')
const persistenceSource = readFileSync(new URL('../src/main/assistant/persistence.ts', import.meta.url), 'utf8')
const persistenceHistorySource = readFileSync(new URL('../src/main/assistant/persistence-history.ts', import.meta.url), 'utf8')
const searchWorkerSource = readFileSync(new URL('../../src/desktop-assistant-search-worker.mjs', import.meta.url), 'utf8')
assert.equal(searchIndexSource.includes('const SEARCH_BUCKET_MESSAGE_SPAN = 128'), true, 'candidate text aggregation must remain capped to a fixed global message bucket')
assert.equal(searchIndexSource.includes('bucket_id INTEGER PRIMARY KEY'), true, 'worker-owned bucket maintenance must deduplicate queued projection work')
assert.equal(searchIndexSource.includes('session_id TEXT PRIMARY KEY'), true, 'archive maintenance must queue each dirty session once')
assert.equal(persistenceSource.includes("throw new Error('Indexed chat search is unavailable.')"), true, 'native FTS initialization failure must never fall through to an Electron-main compatibility scan')
assert.equal(persistenceHistorySource.includes('remainingRecordBudget + 1'), true, 'exact navigation must stop sizing an oversized turn after its bounded record budget')
assert.equal(searchWorkerSource.includes('const MAX_CANONICAL_CANDIDATE_ROWS = 300'), true, 'worker-owned search must cap canonical candidate hydration')
assert.equal(searchWorkerSource.includes('archive_scope : (${quoteFtsValue(scope)})'), true, 'archive scope must be applied inside FTS before each shard limit')
assert.equal(searchWorkerSource.includes('isMultiTokenQuery && hasCrossMessageOnlyBucket'), true, 'multi-token samples with any cross-message-only bucket must merge exact message documents')
assert.equal(searchWorkerSource.includes('new Set(candidateSample.bucketIds)'), true, 'cross-message detection must retain every sampled bucket even when canonical hydration reaches its row cap')

function compatibleDatabase(raw: Database): SqlDatabase {
    return {
        run(sql: string, params: SqlValue[] = []) {
            if (params.length === 0) raw.run(sql)
            else {
                const statement = raw.prepare(sql)
                try { statement.run(...params) } finally { statement.finalize() }
            }
            return this
        },
        exec(sql: string, params: SqlValue[] = []) {
            const statement = raw.prepare(sql)
            try {
                const values = statement.values(...params) as SqlValue[][]
                return values.length > 0 ? [{ columns: statement.columnNames, values }] : []
            } finally {
                statement.finalize()
            }
        },
        close() { raw.close(true) }
    } as unknown as SqlDatabase
}

function cleanupTemporaryDirectory(directory: string) {
    try {
        rmSync(directory, { recursive: true, force: true })
    } catch (error: any) {
        if (error?.code !== 'EBUSY') throw error
        const script = `setTimeout(() => require('node:fs').rmSync(${JSON.stringify(directory)}, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }), 1000)`
        const cleanup = spawn('node', ['-e', script], { detached: true, stdio: 'ignore' })
        cleanup.unref()
    }
}

function runWorkerOperation(databasePath: string, operation: 'search' | 'backfill', input?: { query: string; scope: 'active' | 'archived' | 'all'; limit?: number }) {
    const workerPath = resolve(import.meta.dir, '../../src/desktop-assistant-search-worker.mjs').replace(/\\/g, '/')
    const script = `
        const { Worker } = require('node:worker_threads');
        const worker = new Worker(${JSON.stringify(workerPath)});
        const timer = setTimeout(() => { console.error('timeout'); process.exit(2); }, 5000);
        worker.once('message', (message) => {
            clearTimeout(timer);
            console.log(JSON.stringify(message));
            worker.terminate().then(() => process.exit(message.type === 'result' ? 0 : 1));
        });
        worker.postMessage({ id: 1, operation: ${JSON.stringify(operation)}, databasePath: ${JSON.stringify(databasePath)}, input: ${JSON.stringify(input || {})} });
    `
    return new Promise<any>((resolvePromise, reject) => {
        const child = spawn('node', ['--experimental-sqlite', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] })
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', (chunk) => { stdout += chunk })
        child.stderr.on('data', (chunk) => { stderr += chunk })
        child.once('error', reject)
        child.once('exit', (code) => {
            if (code !== 0) {
                reject(new Error(`Search worker exited ${code}: ${stderr || stdout}`))
                return
            }
            const line = stdout.trim().split(/\r?\n/).at(-1)
            resolvePromise(JSON.parse(line || '{}'))
        })
    })
}

function runWorker(databasePath: string, query: string, scope: 'active' | 'archived' | 'all', limit?: number) {
    return runWorkerOperation(databasePath, 'search', { query, scope, limit })
}

const tempDirectory = mkdtempSync(join(tmpdir(), 'zyra-chat-search-'))
const databasePath = join(tempDirectory, 'assistant.sqlite')
try {
    const raw = new Database(databasePath, { create: true })
    raw.run('PRAGMA journal_mode = WAL')
    const db = compatibleDatabase(raw)
    initializeAssistantPersistenceSchema(db)

    db.run(`INSERT INTO assistant_sessions (id, title, mode, project_path, archived, created_at, updated_at, active_thread_id) VALUES (?, ?, 'work', ?, 0, ?, ?, ?)`, [
        'session-active', 'Voice duplication repair', 'C:/projects/zyra', '2026-08-01T00:00:00.000Z', '2026-08-03T00:00:00.000Z', 'thread-active'
    ])
    db.run(`INSERT INTO assistant_sessions (id, title, mode, project_path, archived, created_at, updated_at, active_thread_id) VALUES (?, ?, 'work', ?, 1, ?, ?, ?)`, [
        'session-archived', 'Old browser investigation', 'C:/projects/zyra', '2026-07-01T00:00:00.000Z', '2026-07-02T00:00:00.000Z', 'thread-archived'
    ])
    db.run(`INSERT INTO assistant_sessions (id, title, mode, project_path, archived, created_at, updated_at, active_thread_id) VALUES (?, ?, 'work', ?, 0, ?, ?, ?)`, [
        'session-lower-range', 'Lower range exact result', 'C:/projects/zyra', '2026-07-30T00:00:00.000Z', '2026-07-30T00:00:00.000Z', 'thread-lower-range'
    ])
    for (const [threadId, sessionId] of [['thread-active', 'session-active'], ['thread-archived', 'session-archived'], ['thread-lower-range', 'session-lower-range']]) {
        db.run(`INSERT INTO assistant_threads (id, session_id, source, model, message_count, runtime_mode, interaction_mode, state, created_at, updated_at) VALUES (?, ?, 'root', 'test', 0, 'approval-required', 'default', 'idle', ?, ?)`, [
            threadId, sessionId, '2026-08-01T00:00:00.000Z', '2026-08-03T00:00:00.000Z'
        ])
    }
    db.run(`INSERT INTO assistant_messages (id, thread_id, role, text, turn_id, streaming, created_at, updated_at) VALUES (?, ?, 'user', ?, ?, 0, ?, ?)`, [
        'message-user', 'thread-active', 'Please fix the duplicated voice transcript after restart.', 'turn-active', '2026-08-02T00:00:00.000Z', '2026-08-02T00:00:00.000Z'
    ])
    db.run(`INSERT INTO assistant_messages (id, thread_id, role, text, turn_id, streaming, created_at, updated_at) VALUES (?, ?, 'assistant', ?, ?, 0, ?, ?)`, [
        'message-final', 'thread-active', 'Canonical identity now keeps one voice transcript after restart.', 'turn-active', '2026-08-02T00:00:01.000Z', '2026-08-02T00:00:01.000Z'
    ])
    db.run(`INSERT INTO assistant_messages (id, thread_id, role, text, turn_id, streaming, created_at, updated_at) VALUES (?, ?, 'assistant', ?, ?, 0, ?, ?)`, [
        'message-interim', 'thread-active', 'Interim private needle should never appear.', null, '2026-08-02T00:00:00.500Z', '2026-08-02T00:00:00.500Z'
    ])
    db.run(`INSERT INTO assistant_messages (id, thread_id, role, text, turn_id, streaming, created_at, updated_at) VALUES (?, ?, 'user', ?, ?, 0, ?, ?)`, [
        'message-diacritic', 'thread-active', 'Café résumé navigation remains searchable.', 'turn-diacritic', '2026-08-02T00:00:02.000Z', '2026-08-02T00:00:02.000Z'
    ])
    db.run(`INSERT INTO assistant_messages (id, thread_id, role, text, turn_id, streaming, created_at, updated_at) VALUES (?, ?, 'user', ?, ?, 0, ?, ?)`, [
        'message-technical', 'thread-active', `node:sqlite can't lose the foo-bar marker.`, 'turn-technical', '2026-08-02T00:00:03.000Z', '2026-08-02T00:00:03.000Z'
    ])
    db.run(`INSERT INTO assistant_messages (id, thread_id, role, text, turn_id, streaming, created_at, updated_at) VALUES (?, ?, 'user', ?, ?, 0, ?, ?)`, [
        'message-cooccurrence-exact', 'thread-active', 'alpha beta exact message', 'turn-cooccurrence', '2026-08-02T00:00:04.000Z', '2026-08-02T00:00:04.000Z'
    ])
    db.run(`INSERT INTO assistant_messages (id, thread_id, role, text, turn_id, streaming, created_at, updated_at) VALUES (?, ?, 'user', ?, ?, 0, ?, ?)`, [
        'message-alpha-only', 'thread-active', 'alpha appears without the other term', 'turn-alpha', '2026-08-02T00:00:05.000Z', '2026-08-02T00:00:05.000Z'
    ])
    db.run(`INSERT INTO assistant_messages (id, thread_id, role, text, turn_id, streaming, created_at, updated_at) VALUES (?, ?, 'user', ?, ?, 0, ?, ?)`, [
        'message-beta-only', 'thread-active', 'beta appears without the other term', 'turn-beta', '2026-08-02T00:00:06.000Z', '2026-08-02T00:00:06.000Z'
    ])
    db.run(`INSERT INTO assistant_messages (id, thread_id, role, text, turn_id, streaming, created_at, updated_at) VALUES (?, ?, 'user', ?, ?, 0, ?, ?)`, [
        'message-lower-range-exact', 'thread-lower-range', 'alpha beta lower range target', 'turn-lower-range', '2026-07-30T00:00:00.000Z', '2026-07-30T00:00:00.000Z'
    ])
    db.run(`INSERT INTO assistant_messages (id, thread_id, role, text, turn_id, streaming, created_at, updated_at) VALUES (?, ?, 'user', ?, ?, 0, ?, ?)`, [
        'message-archived', 'thread-archived', 'The browser popup retained an archived needle.', 'turn-archived', '2026-07-02T00:00:00.000Z', '2026-07-02T00:00:00.000Z'
    ])
    db.run(`INSERT INTO assistant_turns (id, thread_id, model, state, requested_at, completed_at, assistant_message_id, updated_at) VALUES (?, ?, 'test', 'completed', ?, ?, ?, ?)`, [
        'turn-active', 'thread-active', '2026-08-02T00:00:00.000Z', '2026-08-02T00:00:01.000Z', 'message-final', '2026-08-02T00:00:01.000Z'
    ])

    assert.equal(initializeAssistantSearchIndex(db), true)
    const refreshProjection = () => {
        while (!backfillAssistantSearchIndexBatch(db).complete) {}
    }
    assert.deepEqual(backfillAssistantSearchIndexBatch(db, 1), { complete: false, indexed: 1 })
    const partialBackfillResult = await runWorker(databasePath, 'voice transcript', 'active')
    assert.equal(partialBackfillResult.result.matches[0]?.messageId, 'message-user', 'each committed backfill batch must become searchable immediately')
    while (!backfillAssistantSearchIndexBatch(db, 1).complete) {}

    const indexedCount = Number(db.exec(`SELECT COUNT(*) FROM assistant_search_bucket_search WHERE assistant_search_bucket_search MATCH 'voice*'`)[0]?.values?.[0]?.[0] || 0)
    assert.ok(indexedCount >= 1, 'FTS backfill must index existing completed text')
    assert.equal(Number(db.exec(`SELECT COUNT(*) FROM assistant_search_bucket_search WHERE assistant_search_bucket_search MATCH 'private*'`)[0]?.values?.[0]?.[0] || 0), 0, 'interim assistant text must never enter the index')
    db.run(`UPDATE assistant_sessions SET archived = 1 WHERE id = 'session-active'`)
    refreshProjection()
    assert.equal(Number(db.exec(`SELECT COUNT(*) FROM assistant_search_bucket_search WHERE assistant_search_bucket_search MATCH 'text : (voice*) AND archive_scope : ("active")'`)[0]?.values?.[0]?.[0] || 0), 0, 'archive changes must remove matching text from active candidate rows')
    assert.ok(Number(db.exec(`SELECT COUNT(*) FROM assistant_search_bucket_search WHERE assistant_search_bucket_search MATCH 'text : (voice*) AND archive_scope : ("archived")'`)[0]?.values?.[0]?.[0] || 0) >= 1, 'archive changes must rebuild scoped candidate rows before search')
    db.run(`UPDATE assistant_sessions SET archived = 0 WHERE id = 'session-active'`)
    refreshProjection()

    db.run(`INSERT INTO assistant_messages (id, thread_id, role, text, turn_id, streaming, created_at, updated_at) VALUES (?, ?, 'assistant', ?, ?, 0, ?, ?)`, [
        'message-late-final', 'thread-active', 'late canonical marker', 'turn-late', '2026-08-02T01:00:00.000Z', '2026-08-02T01:00:00.000Z'
    ])
    assert.equal(Number(db.exec(`SELECT COUNT(*) FROM assistant_search_bucket_search WHERE assistant_search_bucket_search MATCH 'canonical*'`)[0]?.values?.[0]?.[0] || 0), 1, 'only the already-canonical assistant message should be indexed')
    db.run(`INSERT INTO assistant_turns (id, thread_id, model, state, requested_at, completed_at, assistant_message_id, updated_at) VALUES (?, ?, 'test', 'completed', ?, ?, ?, ?)`, [
        'turn-late', 'thread-active', '2026-08-02T01:00:00.000Z', '2026-08-02T01:00:01.000Z', 'message-late-final', '2026-08-02T01:00:01.000Z'
    ])
    refreshProjection()
    assert.equal(Number(db.exec(`SELECT COUNT(*) FROM assistant_search_bucket_search WHERE assistant_search_bucket_search MATCH 'late*'`)[0]?.values?.[0]?.[0] || 0), 1, 'turn completion must index its final assistant message')
    db.run(`INSERT OR REPLACE INTO assistant_turns (id, thread_id, model, state, requested_at, completed_at, assistant_message_id, updated_at) VALUES (?, ?, 'test', 'completed', ?, ?, ?, ?)`, [
        'turn-late', 'thread-active', '2026-08-02T01:00:00.000Z', '2026-08-02T01:00:01.000Z', 'message-late-final', '2026-08-02T01:00:01.000Z'
    ])
    refreshProjection()
    assert.equal(Number(db.exec(`SELECT COUNT(*) FROM assistant_search_bucket_search WHERE assistant_search_bucket_search MATCH 'late*'`)[0]?.values?.[0]?.[0] || 0), 1, 'replayed turn upserts must not duplicate or block the projection')
    db.run(`UPDATE assistant_turns SET assistant_message_id = NULL WHERE id = 'turn-late'`)
    refreshProjection()
    assert.equal(Number(db.exec(`SELECT COUNT(*) FROM assistant_search_bucket_search WHERE assistant_search_bucket_search MATCH 'late*'`)[0]?.values?.[0]?.[0] || 0), 0, 'removing canonical ownership must remove assistant text from the index')

    db.run(`INSERT INTO assistant_messages (id, thread_id, role, text, turn_id, streaming, created_at, updated_at) VALUES (?, ?, 'user', ?, ?, 1, ?, ?)`, [
        'message-streaming', 'thread-active', 'stream transition target', 'turn-streaming', '2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z'
    ])
    assert.equal(Number(db.exec(`SELECT COUNT(*) FROM assistant_search_bucket_search WHERE assistant_search_bucket_search MATCH 'transition*'`)[0]?.values?.[0]?.[0] || 0), 0)
    db.run(`UPDATE assistant_messages SET streaming = 0 WHERE id = 'message-streaming'`)
    refreshProjection()
    assert.equal(Number(db.exec(`SELECT COUNT(*) FROM assistant_search_bucket_search WHERE assistant_search_bucket_search MATCH 'transition*'`)[0]?.values?.[0]?.[0] || 0), 1, 'completion must add the message once')
    db.run(`DELETE FROM assistant_messages WHERE id = 'message-streaming'`)
    refreshProjection()
    assert.equal(Number(db.exec(`SELECT COUNT(*) FROM assistant_search_bucket_search WHERE assistant_search_bucket_search MATCH 'transition*'`)[0]?.values?.[0]?.[0] || 0), 0, 'deletion must remove the indexed row immediately')

    const anchoredHistory = readAssistantHistoryAroundMessage(db, {
        threadId: 'thread-active',
        messageId: 'message-user',
        turnLimit: 1
    })
    assert.equal(anchoredHistory.messageId, 'message-user')
    assert.ok(anchoredHistory.page.messages.some((message) => message.id === 'message-user'))
    const anchoredFinalAssistant = readAssistantHistoryAroundMessage(db, {
        threadId: 'thread-active', messageId: 'message-final', turnLimit: 1
    })
    assert.ok(anchoredFinalAssistant.page.messages.some((message) => message.id === 'message-final'), 'durable final assistant ownership must remain navigable')
    for (const ineligibleMessageId of ['missing-message', 'message-interim', 'message-late-final']) {
        assert.throws(() => readAssistantHistoryAroundMessage(db, {
            threadId: 'thread-active',
            messageId: ineligibleMessageId,
            turnLimit: 1
        }), /not found/i, 'exact navigation must reject stale or non-canonical message identities')
    }

    db.run(`INSERT INTO assistant_messages (id, thread_id, role, text, turn_id, streaming, created_at, updated_at) VALUES (?, ?, 'user', ?, ?, 0, ?, ?)`, [
        'message-bounded-target', 'thread-active', 'bounded anchor target', 'turn-bounded', '2026-08-02T02:00:00.000Z', '2026-08-02T02:00:00.000Z'
    ])
    db.run(`INSERT INTO assistant_activities (id, thread_id, kind, tone, summary, detail, turn_id, created_at) VALUES (?, ?, 'tool', 'neutral', ?, ?, ?, ?)`, [
        'activity-oversized', 'thread-active', 'oversized activity', 'x'.repeat(1_000_000), 'turn-bounded', '2026-08-02T02:00:01.000Z'
    ])
    db.run(`INSERT INTO assistant_messages (id, thread_id, role, text, turn_id, streaming, created_at, updated_at) VALUES (?, ?, 'user', ?, ?, 0, ?, ?)`, [
        'message-after-bounded', 'thread-active', 'next turn', 'turn-after-bounded', '2026-08-02T02:01:00.000Z', '2026-08-02T02:01:00.000Z'
    ])
    const boundedHistory = readAssistantHistoryAroundMessage(db, {
        threadId: 'thread-active', messageId: 'message-bounded-target', turnLimit: 1
    })
    assert.deepEqual(boundedHistory.page.messages.map((message) => message.id), ['message-bounded-target'])
    assert.equal(boundedHistory.page.activities.length, 0, 'an oversized turn must collapse to the exact canonical target before IPC')

    const fallback = searchAssistantChatsFallback(db, { query: 'voice transcript', scope: 'active' })
    assert.equal(fallback.matches[0]?.sessionId, 'session-active')
    assert.equal(fallback.matches[0]?.role, 'user')
    assert.equal(searchAssistantChatsFallback(db, { query: 'private needle', scope: 'active' }).matches.length, 0, 'interim assistant rows must be filtered')
    assert.equal(searchAssistantChatsFallback(db, { query: 'archived needle', scope: 'active' }).matches.length, 0)
    assert.equal(searchAssistantChatsFallback(db, { query: 'archived needle', scope: 'archived' }).matches[0]?.sessionId, 'session-archived')
    assert.deepEqual(parseAssistantChatSearchQuery('  voice  is:archived  '), { query: 'voice', scope: 'archived' })

    db.run(`INSERT INTO assistant_messages (id, thread_id, role, text, turn_id, streaming, created_at, updated_at) VALUES (?, ?, 'user', ?, ?, 0, ?, ?)`, [
        'message-worker-refresh', 'thread-active', 'worker refreshed marker', 'turn-worker-refresh', '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z'
    ])
    for (let index = 0; index < 600; index += 1) {
        const timestamp = new Date(Date.UTC(2026, 7, 5, 0, 0, index)).toISOString()
        db.run(`INSERT INTO assistant_messages (id, thread_id, role, text, turn_id, streaming, created_at, updated_at) VALUES (?, ?, 'user', ?, ?, 0, ?, ?)`, [
            `message-cross-bucket-${index}`,
            'thread-active',
            index % 128 === 0
                ? 'alpha beta exact in a hydrated recent bucket'
                : index % 2 === 0 ? 'alpha without its partner' : 'beta without its partner',
            `turn-cross-bucket-${index}`,
            timestamp,
            timestamp
        ])
    }
    refreshProjection()
    raw.run('PRAGMA wal_checkpoint(TRUNCATE)')
    raw.run('PRAGMA journal_mode = DELETE')
    db.close()
    const beforeWorkerBackfill = await runWorker(databasePath, 'worker refreshed', 'active')
    assert.equal(beforeWorkerBackfill.result.matches[0]?.messageId, 'message-worker-refresh', 'new canonical writes must be searchable immediately')
    const resetRaw = new Database(databasePath)
    resetRaw.run('DELETE FROM assistant_search_bucket_search')
    resetRaw.run('DELETE FROM assistant_message_search')
    resetRaw.run(`INSERT OR REPLACE INTO assistant_meta (key, value) VALUES ('assistantSearchIndexCursor', '0')`)
    resetRaw.run(`INSERT OR REPLACE INTO assistant_meta (key, value) VALUES ('assistantSearchIndexReady', '0')`)
    resetRaw.close(true)
    let workerBackfill = await runWorkerOperation(databasePath, 'backfill')
    let workerIndexed = Number(workerBackfill.result.indexed || 0)
    while (!workerBackfill.result.complete) {
        workerBackfill = await runWorkerOperation(databasePath, 'backfill')
        workerIndexed += Number(workerBackfill.result.indexed || 0)
    }
    assert.ok(workerIndexed >= 1, 'the worker must own write-side projection backfill')
    const afterWorkerBackfill = await runWorker(databasePath, 'worker refreshed', 'active')
    assert.equal(afterWorkerBackfill.result.matches[0]?.messageId, 'message-worker-refresh', 'worker-owned backfill must preserve immediate exact-message coverage')

    const workerResult = await runWorker(databasePath, 'voice transcript', 'active')
    assert.equal(workerResult.type, 'result')
    assert.equal(workerResult.result.searchBackend, 'fts5')
    assert.equal(workerResult.result.matches[0]?.sessionId, 'session-active')
    assert.equal(workerResult.result.matches[0]?.messageId, 'message-user')
    const phraseResult = await runWorker(databasePath, '"voice transcript"', 'active')
    assert.equal(phraseResult.result.matches[0]?.messageId, 'message-user')
    for (const technicalQuery of ['node:sqlite', `can't`, 'foo-bar']) {
        const technicalResult = await runWorker(databasePath, technicalQuery, 'active')
        assert.equal(technicalResult.result.matches[0]?.messageId, 'message-technical', `technical query ${technicalQuery} must remain worker-owned and globally indexed`)
    }
    const diacriticResult = await runWorker(databasePath, 'cafe res', 'active')
    assert.equal(diacriticResult.result.matches[0]?.messageId, 'message-diacritic')
    const cooccurrenceResult = await runWorker(databasePath, 'alpha beta', 'active')
    assert.ok(cooccurrenceResult.result.matches.length > 0, 'bucket-level cross-message terms must retain exact message-level matches')
    const cappedCooccurrenceResult = await runWorker(databasePath, 'alpha beta', 'active', 50)
    assert.equal(
        cappedCooccurrenceResult.result.matches.some((match: any) => match.sessionId === 'session-lower-range'),
        true,
        'the canonical row cap must not hide that a sampled lower-range bucket still needs exact-message fallback'
    )
    const interimResult = await runWorker(databasePath, 'private needle', 'active')
    assert.equal(interimResult.result.matches.length, 0)
    const archivedResult = await runWorker(databasePath, 'archived needle', 'archived')
    assert.equal(archivedResult.result.matches[0]?.sessionId, 'session-archived')

    console.log('assistant scalable chat search: ok')
} finally {
    cleanupTemporaryDirectory(tempDirectory)
}
