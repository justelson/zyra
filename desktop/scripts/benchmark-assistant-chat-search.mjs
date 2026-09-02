import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';

const SESSION_COUNT = Math.max(1, Number(process.env.ZYRA_SEARCH_BENCHMARK_SESSIONS) || 10_000);
const MESSAGE_COUNT = Math.max(SESSION_COUNT * 2, Number(process.env.ZYRA_SEARCH_BENCHMARK_MESSAGES) || 1_000_000);
const WARM_RUNS = Math.max(10, Number(process.env.ZYRA_SEARCH_BENCHMARK_WARM_RUNS) || 80);
const COLD_RUNS = Math.max(5, Number(process.env.ZYRA_SEARCH_BENCHMARK_COLD_RUNS) || 20);
const workerUrl = pathToFileURL(resolve(import.meta.dirname, '../../src/desktop-assistant-search-worker.mjs'));

function percentile(values, percentage) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentage) - 1)] || 0;
}

function createFixture(databasePath) {
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = OFF;
    PRAGMA temp_store = MEMORY;
    CREATE TABLE assistant_sessions (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, project_path TEXT, archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE assistant_threads (id TEXT PRIMARY KEY, session_id TEXT NOT NULL);
    CREATE TABLE assistant_messages (
      id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL,
      streaming INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
    );
    CREATE TABLE assistant_turns (
      id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, assistant_message_id TEXT
    );
    CREATE TABLE assistant_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE INDEX idx_assistant_threads_session ON assistant_threads(session_id);
    CREATE INDEX idx_assistant_messages_thread ON assistant_messages(thread_id, created_at, id);
    CREATE INDEX idx_assistant_turns_search_message ON assistant_turns(thread_id, assistant_message_id);
    CREATE VIRTUAL TABLE assistant_search_bucket_search USING fts5(
      text,
      archive_scope,
      bucket_id UNINDEXED,
      tokenize='unicode61 remove_diacritics 2', prefix='2 3'
    );
    CREATE VIRTUAL TABLE assistant_message_search USING fts5(
      text,
      bucket_key,
      archive_scope,
      thread_id UNINDEXED,
      message_id UNINDEXED,
      role UNINDEXED,
      created_at UNINDEXED,
      tokenize='unicode61 remove_diacritics 2', prefix='2 3'
    );
    CREATE TABLE assistant_search_dirty_buckets (bucket_id INTEGER PRIMARY KEY);
    CREATE TABLE assistant_search_dirty_sessions (session_id TEXT PRIMARY KEY);
  `);
  const insertSession = database.prepare(`INSERT INTO assistant_sessions VALUES (?, ?, ?, ?, ?, ?)`);
  const insertThread = database.prepare(`INSERT INTO assistant_threads VALUES (?, ?)`);
  const insertMessage = database.prepare(`INSERT INTO assistant_messages VALUES (?, ?, ?, ?, 0, ?)`);
  const insertTurn = database.prepare(`INSERT INTO assistant_turns VALUES (?, ?, ?)`);
  const vocabulary = [
    'release packaging windows desktop', 'browser popup transfer stable', 'voice transcript restart canonical',
    'settings theme appearance paper', 'analytics consent diagnostics privacy', 'terminal pty continuity cwd',
    'files preview markdown editor', 'agent inbox working disclosure', 'history compaction canonical identity',
    'authentication refresh connected session', 'search ranking excerpt navigation', 'project workspace source control'
  ];
  const messagesPerSession = Math.floor(MESSAGE_COUNT / SESSION_COUNT);
  let remaining = MESSAGE_COUNT;
  database.exec('BEGIN IMMEDIATE');
  for (let sessionIndex = 0; sessionIndex < SESSION_COUNT; sessionIndex += 1) {
    const sessionId = `session-${sessionIndex}`;
    const threadId = `thread-${sessionIndex}`;
    const archived = sessionIndex % 9 === 0 ? 1 : 0;
    const timestamp = new Date(Date.UTC(2026, 0, 1) + sessionIndex * 60_000).toISOString();
    insertSession.run(sessionId, `Chat ${sessionIndex} ${vocabulary[sessionIndex % vocabulary.length]}`, `C:/projects/project-${sessionIndex % 250}`, archived, timestamp, timestamp);
    insertThread.run(threadId, sessionId);
    const count = sessionIndex === SESSION_COUNT - 1 ? remaining : Math.min(remaining, messagesPerSession);
    for (let messageIndex = 0; messageIndex < count; messageIndex += 1) {
      const globalIndex = sessionIndex * messagesPerSession + messageIndex;
      const isUser = messageIndex % 2 === 0;
      const messageId = `message-${globalIndex}`;
      const role = isUser ? 'user' : 'assistant';
      const topic = vocabulary[(sessionIndex + messageIndex) % vocabulary.length];
      const rareMarker = globalIndex % 9_973 === 0 ? ' quicksilver needle exact navigation ' : ' ';
      const text = `${role === 'user' ? 'Please investigate' : 'Completed investigation for'} ${topic}.${rareMarker}Record ${globalIndex} keeps realistic durable chat content for local full text search.`;
      const createdAt = new Date(Date.UTC(2026, 0, 1) + globalIndex * 1_000).toISOString();
      insertMessage.run(messageId, threadId, role, text, createdAt);
      if (!isUser) insertTurn.run(`turn-${globalIndex}`, threadId, messageId);
    }
    remaining -= count;
  }
  database.exec(`
    COMMIT;
    INSERT INTO assistant_search_bucket_search(rowid, text, archive_scope, bucket_id)
    SELECT
      CAST((messages.rowid - 1) / 128 AS INTEGER) * 2 + sessions.archived + 1,
      GROUP_CONCAT(messages.text, ' '),
      CASE sessions.archived WHEN 1 THEN 'archived' ELSE 'active' END,
      CAST((messages.rowid - 1) / 128 AS INTEGER)
    FROM assistant_messages AS messages
    INNER JOIN assistant_threads AS threads ON threads.id = messages.thread_id
    INNER JOIN assistant_sessions AS sessions ON sessions.id = threads.session_id
    GROUP BY CAST((messages.rowid - 1) / 128 AS INTEGER), sessions.archived;
    INSERT INTO assistant_message_search(rowid, text, bucket_key, archive_scope, thread_id, message_id, role, created_at)
    SELECT
      messages.rowid,
      messages.text,
      'b' || CAST((messages.rowid - 1) / 128 AS INTEGER),
      CASE sessions.archived WHEN 1 THEN 'archived' ELSE 'active' END,
      messages.thread_id,
      messages.id,
      messages.role,
      messages.created_at
    FROM assistant_messages AS messages
    INNER JOIN assistant_threads AS threads ON threads.id = messages.thread_id
    INNER JOIN assistant_sessions AS sessions ON sessions.id = threads.session_id;
    INSERT INTO assistant_meta VALUES('assistantSearchIndexReady', '1');
    PRAGMA optimize;
    PRAGMA wal_checkpoint(TRUNCATE);
  `);
  database.close();
}

function createSearchWorker() {
  const startedAt = performance.now();
  const worker = new Worker(workerUrl);
  const constructorMilliseconds = performance.now() - startedAt;
  let nextId = 1;
  const pending = new Map();
  worker.on('message', (message) => {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.type === 'result') request.resolve(message.result);
    else request.reject(new Error(message.error || 'Search worker failed.'));
  });
  worker.on('error', (error) => {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  });
  return {
    constructorMilliseconds,
    search(databasePath, query, scope = 'active') {
      const id = nextId++;
      let resolveRequest;
      let rejectRequest;
      const result = new Promise((resolve, reject) => {
        resolveRequest = resolve;
        rejectRequest = reject;
      });
      pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
      const dispatchStartedAt = performance.now();
      worker.postMessage({ id, operation: 'search', databasePath, input: { query, scope, limit: 24 } });
      const dispatchMilliseconds = performance.now() - dispatchStartedAt;
      return { result, dispatchMilliseconds };
    },
    terminate() { return worker.terminate(); }
  };
}

const directory = mkdtempSync(join(tmpdir(), 'zyra-search-benchmark-'));
const databasePath = join(directory, 'assistant.sqlite');
try {
  const fixtureStartedAt = performance.now();
  createFixture(databasePath);
  const fixtureMilliseconds = performance.now() - fixtureStartedAt;
  const queries = ['voice transcript restart', 'browser popup transfer', 'release packaging', 'quicksilver needle'];
  const warmWorker = createSearchWorker();
  const warmLatencies = [];
  const dispatchLatencies = [];
  for (let run = 0; run < WARM_RUNS; run += 1) {
    const startedAt = performance.now();
    const scope = run % 13 === 0 ? 'archived' : run % 11 === 0 ? 'all' : 'active';
    const request = warmWorker.search(databasePath, queries[run % queries.length], scope);
    dispatchLatencies.push(request.dispatchMilliseconds);
    const result = await request.result;
    warmLatencies.push(performance.now() - startedAt);
    assert.equal(result.searchBackend, 'fts5');
    assert.ok(result.matches.length > 0);
  }
  await warmWorker.terminate();

  const coldLatencies = [];
  const constructorLatencies = [];
  for (let run = 0; run < COLD_RUNS; run += 1) {
    const worker = createSearchWorker();
    constructorLatencies.push(worker.constructorMilliseconds);
    const startedAt = performance.now();
    const request = worker.search(databasePath, queries[run % queries.length]);
    const result = await request.result;
    coldLatencies.push(performance.now() - startedAt);
    assert.ok(result.matches.length > 0);
    await worker.terminate();
  }

  const summary = {
    sessions: SESSION_COUNT,
    messages: MESSAGE_COUNT,
    fixtureSeconds: Number((fixtureMilliseconds / 1_000).toFixed(2)),
    warm: {
      runs: WARM_RUNS,
      p50Ms: Number(percentile(warmLatencies, 0.5).toFixed(2)),
      p95Ms: Number(percentile(warmLatencies, 0.95).toFixed(2)),
      maxMs: Number(Math.max(...warmLatencies).toFixed(2))
    },
    cold: {
      runs: COLD_RUNS,
      p50Ms: Number(percentile(coldLatencies, 0.5).toFixed(2)),
      p95Ms: Number(percentile(coldLatencies, 0.95).toFixed(2)),
      maxMs: Number(Math.max(...coldLatencies).toFixed(2))
    },
    mainDispatch: {
      p95Ms: Number(percentile(dispatchLatencies, 0.95).toFixed(3)),
      maxMs: Number(Math.max(...dispatchLatencies).toFixed(3)),
      coldConstructorP95Ms: Number(percentile(constructorLatencies, 0.95).toFixed(3))
    }
  };
  console.log(JSON.stringify(summary, null, 2));
  assert.ok(summary.warm.p95Ms < 50, `warm p95 exceeded 50 ms: ${summary.warm.p95Ms}`);
  assert.ok(summary.cold.p95Ms < 200, `cold p95 exceeded 200 ms: ${summary.cold.p95Ms}`);
  assert.ok(summary.mainDispatch.p95Ms < 2, `main dispatch p95 exceeded 2 ms: ${summary.mainDispatch.p95Ms}`);
} finally {
  rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
process.exit(0);
