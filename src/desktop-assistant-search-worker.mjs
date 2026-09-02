import { parentPort } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';

const MAX_QUERY_LENGTH = 200;
const MAX_LIMIT = 50;
const MAX_INDEXED_MESSAGE_CHARACTERS = 16_384;
const SEARCH_BUCKET_MESSAGE_SPAN = 128;
const CANDIDATE_BUCKET_SHARDS = 2;
const MIN_CANDIDATE_BUCKETS_PER_SHARD = 1;
const MAX_CANDIDATE_BUCKETS_PER_SHARD = 128;
const MAX_CANONICAL_CANDIDATE_ROWS = 300;
const MAX_SNIPPET_CHARACTERS = 240;

let database = null;
let databasePath = null;
let indexDatabase = null;
let indexDatabasePath = null;

function closeDatabase() {
  try { database?.close(); } catch {}
  try { indexDatabase?.close(); } catch {}
  database = null;
  databasePath = null;
  indexDatabase = null;
  indexDatabasePath = null;
}

function openDatabase(path) {
  if (database && databasePath === path) return database;
  closeDatabase();
  const next = new DatabaseSync(path, { readOnly: true });
  next.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 1500;');
  database = next;
  databasePath = path;
  return next;
}

function openIndexDatabase(path) {
  if (indexDatabase && indexDatabasePath === path) return indexDatabase;
  try { indexDatabase?.close(); } catch {}
  const next = new DatabaseSync(path);
  next.exec('PRAGMA busy_timeout = 5000;');
  indexDatabase = next;
  indexDatabasePath = path;
  return next;
}

function normalizeScope(value) {
  return value === 'archived' || value === 'all' ? value : 'active';
}

function clampLimit(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(MAX_LIMIT, Math.floor(parsed))) : 24;
}

function collapseWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function foldSearchText(text) {
  return collapseWhitespace(text).toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '');
}

function tokenizeSearchableText(text) {
  return foldSearchText(text).split(/[^\p{L}\p{N}_]+/u).filter(Boolean);
}

function tokenizeQuery(query) {
  const tokens = [];
  const pattern = /"([^"]+)"|(\S+)/g;
  let match;
  while ((match = pattern.exec(query)) !== null) {
    const value = collapseWhitespace(match[1] || match[2] || '');
    if (!value) continue;
    tokens.push({ value, phrase: Boolean(match[1]) });
  }
  return tokens;
}

function quoteFtsValue(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function buildFtsExpression(query) {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return null;
  const clauses = tokens.map((token) => {
    const parts = tokenizeSearchableText(token.value);
    if (parts.length === 0) return null;
    const phrase = quoteFtsValue(parts.join(' '));
    return token.phrase ? phrase : `${phrase}*`;
  }).filter(Boolean);
  return clauses.length > 0 ? clauses.join(' AND ') : null;
}

function includesTokenSequence(searchableTokens, expectedTokens, prefixLast) {
  if (expectedTokens.length === 0) return false;
  return searchableTokens.some((_token, start) => expectedTokens.every((expected, offset) => {
    const candidate = searchableTokens[start + offset];
    if (!candidate) return false;
    return prefixLast && offset === expectedTokens.length - 1
      ? candidate.startsWith(expected)
      : candidate === expected;
  }));
}

function matchesCanonicalQuery(text, queryTokens) {
  const searchableTokens = tokenizeSearchableText(text);
  return queryTokens.every((token) => {
    const expectedTokens = tokenizeSearchableText(token.value);
    if (token.phrase) return includesTokenSequence(searchableTokens, expectedTokens, false);
    if (expectedTokens.length > 1) return includesTokenSequence(searchableTokens, expectedTokens, true);
    return searchableTokens.some((candidate) => candidate.startsWith(expectedTokens[0] || ''));
  });
}

function countOccurrences(text, value) {
  let count = 0;
  let offset = 0;
  while (count < 8) {
    const index = text.indexOf(value, offset);
    if (index < 0) break;
    count += 1;
    offset = index + Math.max(1, value.length);
  }
  return count;
}

function scoreCandidate(row, queryTokens) {
  const text = foldSearchText(row.text);
  let score = 0;
  let firstIndex = Number.POSITIVE_INFINITY;
  let lastIndex = -1;
  for (const token of queryTokens) {
    const value = foldSearchText(token.value);
    const index = text.indexOf(value);
    if (index < 0) continue;
    firstIndex = Math.min(firstIndex, index);
    lastIndex = Math.max(lastIndex, index + value.length);
    score += (token.phrase ? 10 : 2) + Math.min(6, countOccurrences(text, value)) * 0.65;
  }
  if (lastIndex >= 0 && Number.isFinite(firstIndex)) score += 4 / (1 + Math.max(0, lastIndex - firstIndex) / 80);
  if (row.role === 'user') score += 0.12;
  const timestamp = Date.parse(String(row.createdAt || ''));
  if (Number.isFinite(timestamp)) score += Math.max(0, timestamp) / 1e16;
  return score;
}

function buildSnippet(text, query) {
  const normalizedText = collapseWhitespace(text);
  if (normalizedText.length <= MAX_SNIPPET_CHARACTERS) return normalizedText;
  const normalizedQuery = collapseWhitespace(query).replace(/^"|"$/g, '').toLowerCase();
  const foldedText = normalizedText.toLowerCase();
  const queryTokens = tokenizeQuery(query).map((token) => token.value.toLowerCase());
  let matchIndex = normalizedQuery ? foldedText.indexOf(normalizedQuery) : -1;
  if (matchIndex < 0) {
    matchIndex = queryTokens.reduce((best, token) => {
      const index = foldedText.indexOf(token);
      return index >= 0 && (best < 0 || index < best) ? index : best;
    }, -1);
  }
  const bodyLength = MAX_SNIPPET_CHARACTERS - 2;
  const idealStart = Math.max(0, matchIndex - 24);
  const start = Math.min(idealStart, Math.max(0, normalizedText.length - bodyLength));
  const end = Math.min(normalizedText.length, start + bodyLength);
  return `${start > 0 ? '…' : ''}${normalizedText.slice(start, end)}${end < normalizedText.length ? '…' : ''}`;
}

function readMeta(db, key) {
  return db.prepare('SELECT value FROM assistant_meta WHERE key = ? LIMIT 1').get(key)?.value ?? null;
}

function writeMeta(db, key, value) {
  db.prepare('INSERT OR REPLACE INTO assistant_meta (key, value) VALUES (?, ?)').run(key, value);
}

function backfill(path, dirtyBucketLimit = 64) {
  const db = openIndexDatabase(path);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      INSERT INTO assistant_search_dirty_buckets(bucket_id)
      SELECT DISTINCT CAST((messages.rowid - 1) / ${SEARCH_BUCKET_MESSAGE_SPAN} AS INTEGER)
      FROM assistant_search_dirty_sessions AS dirty_sessions
      INNER JOIN assistant_threads AS threads ON threads.session_id = dirty_sessions.session_id
      INNER JOIN assistant_messages AS messages ON messages.thread_id = threads.id
      WHERE NOT EXISTS (
        SELECT 1 FROM assistant_search_dirty_buckets AS dirty_buckets
        WHERE dirty_buckets.bucket_id = CAST((messages.rowid - 1) / ${SEARCH_BUCKET_MESSAGE_SPAN} AS INTEGER)
      );
      DELETE FROM assistant_search_dirty_sessions;
    `);
    const hasDirtyProjection = Boolean(db.prepare('SELECT 1 FROM assistant_search_dirty_buckets LIMIT 1').get());
    if (String(readMeta(db, 'assistantSearchIndexReady') ?? '') === '1' && !hasDirtyProjection) {
      db.exec('COMMIT');
      return { complete: true, indexed: 0 };
    }

    const cursor = Math.max(0, Number(readMeta(db, 'assistantSearchIndexCursor') || 0) || 0);
    const rows = db.prepare(`
      SELECT messages.rowid AS rowId
      FROM assistant_messages AS messages
      WHERE messages.rowid > ?
        AND messages.streaming = 0
        AND length(messages.text) <= ?
        AND (
          messages.role = 'user'
          OR (
            messages.role = 'assistant'
            AND EXISTS (
              SELECT 1 FROM assistant_turns AS turns
              WHERE turns.thread_id = messages.thread_id AND turns.assistant_message_id = messages.id
            )
          )
        )
      ORDER BY messages.rowid ASC
      LIMIT 400
    `).all(cursor, MAX_INDEXED_MESSAGE_CHARACTERS);

    let lastRowId = cursor;
    const bucketIds = new Set();
    if (rows.length > 0) {
      lastRowId = Number(rows.at(-1)?.rowId || cursor);
      for (const row of rows) {
        bucketIds.add(Math.floor(Math.max(0, Number(row.rowId || 1) - 1) / SEARCH_BUCKET_MESSAGE_SPAN));
      }
      writeMeta(db, 'assistantSearchIndexCursor', String(lastRowId));
    }
    const dirtyRows = db.prepare(`
      SELECT bucket_id AS bucketId FROM assistant_search_dirty_buckets
      ORDER BY bucket_id DESC
      LIMIT ?
    `).all(Math.max(1, Math.min(512, dirtyBucketLimit)));
    for (const row of dirtyRows) bucketIds.add(Number(row.bucketId));

    const deleteBucket = db.prepare('DELETE FROM assistant_search_bucket_search WHERE bucket_id = ?');
    const deleteMessages = db.prepare('DELETE FROM assistant_message_search WHERE rowid BETWEEN ? AND ?');
    const insertBucket = db.prepare(`
      INSERT OR REPLACE INTO assistant_search_bucket_search(rowid, text, archive_scope, bucket_id)
      SELECT
        ? * 2 + sessions.archived + 1,
        GROUP_CONCAT(messages.text, ' '),
        CASE sessions.archived WHEN 1 THEN 'archived' ELSE 'active' END,
        ?
      FROM assistant_messages AS messages
      INNER JOIN assistant_threads AS threads ON threads.id = messages.thread_id
      INNER JOIN assistant_sessions AS sessions ON sessions.id = threads.session_id
      WHERE messages.rowid BETWEEN ? AND ?
        AND messages.streaming = 0
        AND length(messages.text) <= ?
        AND (
          messages.role = 'user'
          OR (
            messages.role = 'assistant'
            AND EXISTS (
              SELECT 1 FROM assistant_turns AS turns
              WHERE turns.thread_id = messages.thread_id AND turns.assistant_message_id = messages.id
            )
          )
        )
      GROUP BY sessions.archived
    `);
    const insertMessages = db.prepare(`
      INSERT OR REPLACE INTO assistant_message_search(rowid, text, bucket_key, archive_scope, thread_id, message_id, role, created_at)
      SELECT
        messages.rowid,
        messages.text,
        'b' || ?,
        CASE sessions.archived WHEN 1 THEN 'archived' ELSE 'active' END,
        messages.thread_id,
        messages.id,
        messages.role,
        messages.created_at
      FROM assistant_messages AS messages
      INNER JOIN assistant_threads AS threads ON threads.id = messages.thread_id
      INNER JOIN assistant_sessions AS sessions ON sessions.id = threads.session_id
      WHERE messages.rowid BETWEEN ? AND ?
        AND messages.streaming = 0
        AND length(messages.text) <= ?
        AND (
          messages.role = 'user'
          OR (
            messages.role = 'assistant'
            AND EXISTS (
              SELECT 1 FROM assistant_turns AS turns
              WHERE turns.thread_id = messages.thread_id AND turns.assistant_message_id = messages.id
            )
          )
        )
    `);
    const clearDirtyBucket = db.prepare('DELETE FROM assistant_search_dirty_buckets WHERE bucket_id = ?');
    for (const bucketId of bucketIds) {
      if (!Number.isSafeInteger(bucketId) || bucketId < 0) continue;
      const lowerRowId = bucketId * SEARCH_BUCKET_MESSAGE_SPAN + 1;
      const upperRowId = (bucketId + 1) * SEARCH_BUCKET_MESSAGE_SPAN;
      deleteBucket.run(bucketId);
      deleteMessages.run(lowerRowId, upperRowId);
      insertBucket.run(bucketId, bucketId, lowerRowId, upperRowId, MAX_INDEXED_MESSAGE_CHARACTERS);
      insertMessages.run(bucketId, lowerRowId, upperRowId, MAX_INDEXED_MESSAGE_CHARACTERS);
      clearDirtyBucket.run(bucketId);
    }

    const hasMoreMessages = Boolean(db.prepare(`
      SELECT 1 FROM assistant_messages AS messages
      WHERE messages.rowid > ?
        AND messages.streaming = 0
        AND length(messages.text) <= ?
        AND (
          messages.role = 'user'
          OR (
            messages.role = 'assistant'
            AND EXISTS (
              SELECT 1 FROM assistant_turns AS turns
              WHERE turns.thread_id = messages.thread_id AND turns.assistant_message_id = messages.id
            )
          )
        )
      LIMIT 1
    `).get(lastRowId, MAX_INDEXED_MESSAGE_CHARACTERS));
    const hasRemainingDirty = Boolean(db.prepare('SELECT 1 FROM assistant_search_dirty_buckets LIMIT 1').get());
    const complete = !hasMoreMessages && !hasRemainingDirty;
    writeMeta(db, 'assistantSearchIndexReady', complete ? '1' : '0');
    db.exec('COMMIT');
    return { complete, indexed: rows.length + dirtyRows.length };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}
function readStratifiedMatchingMessages(db, expression, scope, limit) {
  const maxProjectionRowId = Number(db.prepare('SELECT MAX(rowid) AS maxRowId FROM assistant_search_bucket_search').get()?.maxRowId || 0);
  if (maxProjectionRowId <= 0) return { rows: [], bucketIds: [] };
  const bucketsPerShard = Math.min(
    MAX_CANDIDATE_BUCKETS_PER_SHARD,
    Math.max(MIN_CANDIDATE_BUCKETS_PER_SHARD, Math.ceil(limit / 24)),
  );
  const statement = db.prepare(`
    SELECT bucket_id AS bucketId
    FROM assistant_search_bucket_search
    WHERE assistant_search_bucket_search MATCH ?
      AND rowid >= ? AND rowid <= ?
    ORDER BY rowid DESC
    LIMIT ?
  `);
  const ftsExpression = scope === 'all'
    ? `text : (${expression})`
    : `text : (${expression}) AND archive_scope : (${quoteFtsValue(scope)})`;
  const shardWidth = Math.max(1, Math.ceil(maxProjectionRowId / CANDIDATE_BUCKET_SHARDS));
  const bucketIds = [];
  for (let shard = CANDIDATE_BUCKET_SHARDS - 1; shard >= 0; shard -= 1) {
    const lower = shard * shardWidth + 1;
    const upper = Math.min(maxProjectionRowId, (shard + 1) * shardWidth);
    bucketIds.push(...statement.all(ftsExpression, lower, upper, bucketsPerShard).map((row) => Number(row.bucketId)));
  }
  const uniqueBucketIds = Array.from(new Set(bucketIds.filter((bucketId) => Number.isSafeInteger(bucketId) && bucketId >= 0)));
  if (uniqueBucketIds.length === 0) return { rows: [], bucketIds: [] };
  const messageRowIds = uniqueBucketIds.flatMap((bucketId) => Array.from(
    { length: SEARCH_BUCKET_MESSAGE_SPAN },
    (_unused, offset) => bucketId * SEARCH_BUCKET_MESSAGE_SPAN + offset + 1,
  ));
  const placeholders = messageRowIds.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT
      sessions.id AS sessionId,
      messages.rowid AS messageRowId,
      messages.thread_id AS threadId,
      messages.id AS messageId,
      messages.role AS role,
      sessions.title AS title,
      sessions.project_path AS projectPath,
      messages.text AS text,
      messages.created_at AS createdAt,
      sessions.archived AS archived
    FROM assistant_messages AS messages
    INNER JOIN assistant_threads AS threads ON threads.id = messages.thread_id
    INNER JOIN assistant_sessions AS sessions ON sessions.id = threads.session_id
    WHERE messages.rowid IN (${placeholders})
      AND messages.streaming = 0
      AND length(messages.text) <= ?
      AND (
        messages.role = 'user'
        OR EXISTS (
          SELECT 1 FROM assistant_turns AS turns
          WHERE turns.thread_id = messages.thread_id AND turns.assistant_message_id = messages.id
        )
      )
      AND (? = 'all' OR (? = 'archived' AND sessions.archived = 1) OR (? = 'active' AND sessions.archived = 0))
    ORDER BY messages.rowid DESC
    LIMIT ${MAX_CANONICAL_CANDIDATE_ROWS}
  `).all(
    ...messageRowIds,
    MAX_INDEXED_MESSAGE_CHARACTERS,
    scope,
    scope,
    scope,
  );
  return { rows, bucketIds: uniqueBucketIds };
}
function readExactRangeFallback(db, expression, scope, limit) {
  const maxRowId = Number(db.prepare('SELECT MAX(rowid) AS maxRowId FROM assistant_message_search').get()?.maxRowId || 0);
  if (maxRowId <= 0) return [];
  const scopedExpression = scope === 'all'
    ? `text : (${expression})`
    : `text : (${expression}) AND archive_scope : (${quoteFtsValue(scope)})`;
  const rowsPerRange = Math.max(4, Math.ceil(limit / 2));
  const statement = db.prepare(`
    SELECT rowid
    FROM assistant_message_search
    WHERE assistant_message_search MATCH ?
      AND rowid >= ? AND rowid <= ?
    ORDER BY rowid DESC
    LIMIT ?
  `);
  const rangeWidth = Math.max(1, Math.ceil(maxRowId / 2));
  const rowIds = [];
  for (let range = 1; range >= 0; range -= 1) {
    const lower = range * rangeWidth + 1;
    const upper = Math.min(maxRowId, (range + 1) * rangeWidth);
    rowIds.push(...statement.all(scopedExpression, lower, upper, rowsPerRange).map((row) => Number(row.rowid)));
  }
  const uniqueRowIds = Array.from(new Set(rowIds.filter((rowId) => Number.isSafeInteger(rowId) && rowId > 0)));
  if (uniqueRowIds.length === 0) return [];
  const placeholders = uniqueRowIds.map(() => '?').join(', ');
  return db.prepare(`
    SELECT
      sessions.id AS sessionId,
      messages.rowid AS messageRowId,
      messages.thread_id AS threadId,
      messages.id AS messageId,
      messages.role AS role,
      sessions.title AS title,
      sessions.project_path AS projectPath,
      messages.text AS text,
      messages.created_at AS createdAt,
      sessions.archived AS archived
    FROM assistant_messages AS messages
    INNER JOIN assistant_threads AS threads ON threads.id = messages.thread_id
    INNER JOIN assistant_sessions AS sessions ON sessions.id = threads.session_id
    WHERE messages.rowid IN (${placeholders})
      AND messages.streaming = 0
      AND length(messages.text) <= ?
      AND (
        messages.role = 'user'
        OR EXISTS (
          SELECT 1 FROM assistant_turns AS turns
          WHERE turns.thread_id = messages.thread_id AND turns.assistant_message_id = messages.id
        )
      )
      AND (? = 'all' OR (? = 'archived' AND sessions.archived = 1) OR (? = 'active' AND sessions.archived = 0))
  `).all(...uniqueRowIds, MAX_INDEXED_MESSAGE_CHARACTERS, scope, scope, scope);
}

function search(path, input) {
  const query = collapseWhitespace(input?.query).slice(0, MAX_QUERY_LENGTH);
  const scope = normalizeScope(input?.scope);
  const limit = clampLimit(input?.limit);
  const expression = query.length >= 2 ? buildFtsExpression(query) : null;
  if (!expression) {
    return { query, scope, matches: [], indexingOlderChats: false, searchBackend: 'fts5' };
  }

  let db = openDatabase(path);
  const needsProjectionRefresh = String(readMeta(db, 'assistantSearchIndexReady') ?? '') !== '1'
    || Boolean(db.prepare('SELECT 1 FROM assistant_search_dirty_buckets LIMIT 1').get())
    || Boolean(db.prepare('SELECT 1 FROM assistant_search_dirty_sessions LIMIT 1').get());
  if (needsProjectionRefresh) {
    backfill(path, 64);
    db = openDatabase(path);
  }
  const indexingOlderChats = String(readMeta(db, 'assistantSearchIndexReady') ?? '') !== '1';
  const queryTokens = tokenizeQuery(query);
  const candidateSample = readStratifiedMatchingMessages(db, expression, scope, limit);
  const candidateRows = candidateSample.rows;
  const exactCandidateRows = candidateRows.filter((row) => matchesCanonicalQuery(row.text, queryTokens));
  const candidateBucketIds = new Set(candidateSample.bucketIds);
  const exactBucketIds = new Set(exactCandidateRows.map((row) => (
    Math.floor(Math.max(0, Number(row.messageRowId || 1) - 1) / SEARCH_BUCKET_MESSAGE_SPAN)
  )));
  const hasCrossMessageOnlyBucket = exactBucketIds.size < candidateBucketIds.size;
  const isMultiTokenQuery = queryTokens.length > 1
    || queryTokens.some((token) => tokenizeSearchableText(token.value).length > 1);
  const exactSessionCount = new Set(exactCandidateRows.map((row) => String(row.sessionId || '')).filter(Boolean)).size;
  if (exactSessionCount === 0 || (isMultiTokenQuery && hasCrossMessageOnlyBucket)) {
    const existingMessageIds = new Set(candidateRows.map((row) => String(row.messageId || '')));
    for (const row of readExactRangeFallback(db, expression, scope, limit)) {
      if (existingMessageIds.has(String(row.messageId || ''))) continue;
      candidateRows.push(row);
    }
  }
  const bestBySession = new Map();
  for (const row of candidateRows) {
    if (!matchesCanonicalQuery(row.text, queryTokens)) continue;
    const ranked = { row, score: scoreCandidate(row, queryTokens) };
    const sessionId = String(row.sessionId || '');
    const current = bestBySession.get(sessionId);
    if (!current
      || ranked.score > current.score
      || (ranked.score === current.score && Date.parse(String(row.createdAt || '')) > Date.parse(String(current.row.createdAt || '')))) {
      bestBySession.set(sessionId, ranked);
    }
  }
  const rows = Array.from(bestBySession.values());
  rows.sort((left, right) => right.score - left.score
    || Date.parse(String(right.row.createdAt || '')) - Date.parse(String(left.row.createdAt || ''))
    || String(left.row.messageId || '').localeCompare(String(right.row.messageId || '')));

  const matches = rows.slice(0, limit).map(({ row }) => ({
    sessionId: String(row.sessionId || ''),
    threadId: String(row.threadId || ''),
    messageId: String(row.messageId || ''),
    role: row.role === 'user' ? 'user' : 'assistant',
    title: String(row.title || 'Untitled chat'),
    projectPath: row.projectPath == null ? null : String(row.projectPath),
    snippet: buildSnippet(String(row.text || ''), query),
    createdAt: String(row.createdAt || ''),
    archived: Number(row.archived) === 1,
  }));

  return { query, scope, matches, indexingOlderChats, searchBackend: 'fts5' };
}

parentPort?.on('message', (message) => {
  const id = Number(message?.id);
  if (!Number.isSafeInteger(id)) return;
  try {
    if (message.operation === 'reset') {
      closeDatabase();
      parentPort.postMessage({ id, type: 'result', result: null });
      return;
    }
    if (message.operation === 'backfill') {
      const result = backfill(String(message.databasePath || ''));
      parentPort.postMessage({ id, type: 'result', result });
      return;
    }
    if (message.operation !== 'search') throw new Error('Unknown Assistant search worker operation.');
    const result = search(String(message.databasePath || ''), message.input || {});
    parentPort.postMessage({ id, type: 'result', result });
  } catch (error) {
    parentPort.postMessage({
      id,
      type: 'error',
      error: error instanceof Error ? error.message : String(error || 'Assistant search failed.'),
    });
  }
});

process.once('exit', closeDatabase);
