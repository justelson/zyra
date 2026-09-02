import type { Database as SqlDatabase } from 'sql.js/dist/sql-asm.js'
import type {
    AssistantChatSearchMatch,
    AssistantChatSearchScope,
    AssistantSearchChatsInput,
    AssistantSearchChatsResult
} from '../../shared/assistant/contracts'
import {
    ASSISTANT_CHAT_SEARCH_MAX_INDEXED_MESSAGE_CHARACTERS,
    ASSISTANT_CHAT_SEARCH_MAX_QUERY_LENGTH,
    canSearchAssistantChatContent,
    clampAssistantChatSearchLimit
} from '../../shared/assistant/chat-search'

const SEARCH_INDEX_VERSION = 8
const SEARCH_INDEX_VERSION_KEY = 'assistantSearchIndexVersion'
const SEARCH_INDEX_CURSOR_KEY = 'assistantSearchIndexCursor'
const SEARCH_INDEX_READY_KEY = 'assistantSearchIndexReady'
const SEARCH_BACKFILL_BATCH_SIZE = 400
const SEARCH_BUCKET_MESSAGE_SPAN = 128
const SEARCH_FALLBACK_SCAN_MAX_MESSAGES = 5_000
const SEARCH_SNIPPET_MAX_CHARACTERS = 240

function readMeta(db: SqlDatabase, key: string): string | null {
    const row = db.exec('SELECT value FROM assistant_meta WHERE key = ? LIMIT 1', [key])[0]?.values?.[0]
    return row ? String(row[0] ?? '') : null
}

function writeMeta(db: SqlDatabase, key: string, value: string): void {
    db.run('INSERT OR REPLACE INTO assistant_meta (key, value) VALUES (?, ?)', [key, value])
}

function dropSearchProjection(db: SqlDatabase): void {
    db.run(`
        DROP TRIGGER IF EXISTS assistant_message_search_insert;
        DROP TRIGGER IF EXISTS assistant_message_search_delete;
        DROP TRIGGER IF EXISTS assistant_message_search_update_delete;
        DROP TRIGGER IF EXISTS assistant_message_search_update_insert;
        DROP TRIGGER IF EXISTS assistant_turn_search_insert;
        DROP TRIGGER IF EXISTS assistant_turn_search_update_delete;
        DROP TRIGGER IF EXISTS assistant_turn_search_update_insert;
        DROP TRIGGER IF EXISTS assistant_turn_search_delete;
        DROP TRIGGER IF EXISTS assistant_session_search_delete;
        DROP TRIGGER IF EXISTS assistant_session_search_archive_update;
        DROP TRIGGER IF EXISTS assistant_message_search_session_delete;
        DROP TRIGGER IF EXISTS assistant_search_bucket_message_insert;
        DROP TRIGGER IF EXISTS assistant_search_bucket_message_delete;
        DROP TRIGGER IF EXISTS assistant_search_bucket_message_update;
        DROP TRIGGER IF EXISTS assistant_search_bucket_turn_insert;
        DROP TRIGGER IF EXISTS assistant_search_bucket_turn_update_old;
        DROP TRIGGER IF EXISTS assistant_search_bucket_turn_update_new;
        DROP TRIGGER IF EXISTS assistant_search_bucket_turn_delete;
        DROP TRIGGER IF EXISTS assistant_search_bucket_archive_update;
        DROP TABLE IF EXISTS assistant_message_search;
        DROP TABLE IF EXISTS assistant_session_search;
        DROP TABLE IF EXISTS assistant_search_dirty_sessions;
        DROP TABLE IF EXISTS assistant_search_dirty_buckets;
        DROP TABLE IF EXISTS assistant_search_bucket_search;
    `)
}

function eligibleRowPredicate(alias: string): string {
    return `${alias}.streaming = 0
      AND length(${alias}.text) <= ${ASSISTANT_CHAT_SEARCH_MAX_INDEXED_MESSAGE_CHARACTERS}
      AND (
        ${alias}.role = 'user'
        OR (
            ${alias}.role = 'assistant'
            AND EXISTS (
                SELECT 1 FROM assistant_turns AS turns
                WHERE turns.thread_id = ${alias}.thread_id AND turns.assistant_message_id = ${alias}.id
            )
        )
    )`
}

function createSearchProjection(db: SqlDatabase): void {
    db.run(`
        CREATE INDEX IF NOT EXISTS idx_assistant_turns_search_message
        ON assistant_turns(thread_id, assistant_message_id);

        CREATE VIRTUAL TABLE IF NOT EXISTS assistant_search_bucket_search USING fts5(
            text,
            archive_scope,
            bucket_id UNINDEXED,
            tokenize='unicode61 remove_diacritics 2',
            prefix='2 3'
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS assistant_message_search USING fts5(
            text,
            bucket_key,
            archive_scope,
            thread_id UNINDEXED,
            message_id UNINDEXED,
            role UNINDEXED,
            created_at UNINDEXED,
            tokenize='unicode61 remove_diacritics 2',
            prefix='2 3'
        );

        CREATE TABLE IF NOT EXISTS assistant_search_dirty_buckets (
            bucket_id INTEGER PRIMARY KEY
        );
        CREATE TABLE IF NOT EXISTS assistant_search_dirty_sessions (
            session_id TEXT PRIMARY KEY
        );

        CREATE TRIGGER IF NOT EXISTS assistant_search_bucket_message_insert
        AFTER INSERT ON assistant_messages
        WHEN NEW.streaming = 0
        BEGIN
            INSERT INTO assistant_search_dirty_buckets(bucket_id)
            SELECT CAST((NEW.rowid - 1) / ${SEARCH_BUCKET_MESSAGE_SPAN} AS INTEGER)
            WHERE NOT EXISTS (
                SELECT 1 FROM assistant_search_dirty_buckets
                WHERE bucket_id = CAST((NEW.rowid - 1) / ${SEARCH_BUCKET_MESSAGE_SPAN} AS INTEGER)
            );
        END;

        CREATE TRIGGER IF NOT EXISTS assistant_search_bucket_message_delete
        AFTER DELETE ON assistant_messages
        WHEN OLD.streaming = 0
        BEGIN
            INSERT INTO assistant_search_dirty_buckets(bucket_id)
            SELECT CAST((OLD.rowid - 1) / ${SEARCH_BUCKET_MESSAGE_SPAN} AS INTEGER)
            WHERE NOT EXISTS (
                SELECT 1 FROM assistant_search_dirty_buckets
                WHERE bucket_id = CAST((OLD.rowid - 1) / ${SEARCH_BUCKET_MESSAGE_SPAN} AS INTEGER)
            );
        END;

        CREATE TRIGGER IF NOT EXISTS assistant_search_bucket_message_update
        AFTER UPDATE ON assistant_messages
        WHEN OLD.streaming = 0 OR NEW.streaming = 0
        BEGIN
            INSERT INTO assistant_search_dirty_buckets(bucket_id)
            SELECT CAST((NEW.rowid - 1) / ${SEARCH_BUCKET_MESSAGE_SPAN} AS INTEGER)
            WHERE NOT EXISTS (
                SELECT 1 FROM assistant_search_dirty_buckets
                WHERE bucket_id = CAST((NEW.rowid - 1) / ${SEARCH_BUCKET_MESSAGE_SPAN} AS INTEGER)
            );
        END;

        CREATE TRIGGER IF NOT EXISTS assistant_search_bucket_turn_insert
        AFTER INSERT ON assistant_turns
        WHEN NEW.assistant_message_id IS NOT NULL
        BEGIN
            INSERT INTO assistant_search_dirty_buckets(bucket_id)
            SELECT CAST((messages.rowid - 1) / ${SEARCH_BUCKET_MESSAGE_SPAN} AS INTEGER)
            FROM assistant_messages AS messages
            WHERE messages.thread_id = NEW.thread_id
              AND messages.id = NEW.assistant_message_id
              AND NOT EXISTS (
                SELECT 1 FROM assistant_search_dirty_buckets AS dirty
                WHERE dirty.bucket_id = CAST((messages.rowid - 1) / ${SEARCH_BUCKET_MESSAGE_SPAN} AS INTEGER)
              );
        END;

        CREATE TRIGGER IF NOT EXISTS assistant_search_bucket_turn_update_old
        AFTER UPDATE OF assistant_message_id ON assistant_turns
        WHEN OLD.assistant_message_id IS NOT NULL AND OLD.assistant_message_id IS NOT NEW.assistant_message_id
        BEGIN
            INSERT INTO assistant_search_dirty_buckets(bucket_id)
            SELECT CAST((messages.rowid - 1) / ${SEARCH_BUCKET_MESSAGE_SPAN} AS INTEGER)
            FROM assistant_messages AS messages
            WHERE messages.thread_id = OLD.thread_id
              AND messages.id = OLD.assistant_message_id
              AND NOT EXISTS (
                SELECT 1 FROM assistant_search_dirty_buckets AS dirty
                WHERE dirty.bucket_id = CAST((messages.rowid - 1) / ${SEARCH_BUCKET_MESSAGE_SPAN} AS INTEGER)
              );
        END;

        CREATE TRIGGER IF NOT EXISTS assistant_search_bucket_turn_update_new
        AFTER UPDATE OF assistant_message_id ON assistant_turns
        WHEN NEW.assistant_message_id IS NOT NULL AND OLD.assistant_message_id IS NOT NEW.assistant_message_id
        BEGIN
            INSERT INTO assistant_search_dirty_buckets(bucket_id)
            SELECT CAST((messages.rowid - 1) / ${SEARCH_BUCKET_MESSAGE_SPAN} AS INTEGER)
            FROM assistant_messages AS messages
            WHERE messages.thread_id = NEW.thread_id
              AND messages.id = NEW.assistant_message_id
              AND NOT EXISTS (
                SELECT 1 FROM assistant_search_dirty_buckets AS dirty
                WHERE dirty.bucket_id = CAST((messages.rowid - 1) / ${SEARCH_BUCKET_MESSAGE_SPAN} AS INTEGER)
              );
        END;

        CREATE TRIGGER IF NOT EXISTS assistant_search_bucket_turn_delete
        AFTER DELETE ON assistant_turns
        WHEN OLD.assistant_message_id IS NOT NULL
        BEGIN
            INSERT INTO assistant_search_dirty_buckets(bucket_id)
            SELECT CAST((messages.rowid - 1) / ${SEARCH_BUCKET_MESSAGE_SPAN} AS INTEGER)
            FROM assistant_messages AS messages
            WHERE messages.thread_id = OLD.thread_id
              AND messages.id = OLD.assistant_message_id
              AND NOT EXISTS (
                SELECT 1 FROM assistant_search_dirty_buckets AS dirty
                WHERE dirty.bucket_id = CAST((messages.rowid - 1) / ${SEARCH_BUCKET_MESSAGE_SPAN} AS INTEGER)
              );
        END;

        CREATE TRIGGER IF NOT EXISTS assistant_search_bucket_archive_update
        AFTER UPDATE OF archived ON assistant_sessions
        WHEN OLD.archived IS NOT NEW.archived
        BEGIN
            INSERT INTO assistant_search_dirty_sessions(session_id)
            SELECT NEW.id
            WHERE NOT EXISTS (
                SELECT 1 FROM assistant_search_dirty_sessions WHERE session_id = NEW.id
            );
        END;
    `)
}
function hasEligibleMessages(db: SqlDatabase): boolean {
    return Boolean(db.exec(`
        SELECT 1 FROM assistant_messages AS messages
        WHERE ${eligibleRowPredicate('messages')}
        LIMIT 1
    `)[0]?.values?.[0])
}

export function initializeAssistantSearchIndex(db: SqlDatabase): boolean {
    try {
        const storedVersion = Number(readMeta(db, SEARCH_INDEX_VERSION_KEY) || 0)
        const hasBucketSearchTable = Boolean(db.exec(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'assistant_search_bucket_search' LIMIT 1`)[0]?.values?.[0])
        const hasMessageSearchTable = Boolean(db.exec(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'assistant_message_search' LIMIT 1`)[0]?.values?.[0])
        const hasDirtyBucketTable = Boolean(db.exec(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'assistant_search_dirty_buckets' LIMIT 1`)[0]?.values?.[0])
        const needsRebuild = storedVersion !== SEARCH_INDEX_VERSION || !hasBucketSearchTable || !hasMessageSearchTable || !hasDirtyBucketTable
        if (needsRebuild) dropSearchProjection(db)
        createSearchProjection(db)
        if (needsRebuild) {
            writeMeta(db, SEARCH_INDEX_VERSION_KEY, String(SEARCH_INDEX_VERSION))
            writeMeta(db, SEARCH_INDEX_CURSOR_KEY, '0')
            writeMeta(db, SEARCH_INDEX_READY_KEY, hasEligibleMessages(db) ? '0' : '1')
        }
        return true
    } catch {
        try { dropSearchProjection(db) } catch {}
        return false
    }
}

function rebuildSearchBucket(db: SqlDatabase, bucketId: number): void {
    const lowerRowId = bucketId * SEARCH_BUCKET_MESSAGE_SPAN + 1
    const upperRowId = (bucketId + 1) * SEARCH_BUCKET_MESSAGE_SPAN
    db.run('DELETE FROM assistant_search_bucket_search WHERE bucket_id = ?', [bucketId])
    db.run('DELETE FROM assistant_message_search WHERE rowid BETWEEN ? AND ?', [lowerRowId, upperRowId])
    db.run(`
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
          AND ${eligibleRowPredicate('messages')}
        GROUP BY sessions.archived
    `, [bucketId, bucketId, lowerRowId, upperRowId])
    db.run(`
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
          AND ${eligibleRowPredicate('messages')}
    `, [bucketId, lowerRowId, upperRowId])
}

function expandDirtySearchSessions(db: SqlDatabase): void {
    db.run(`
        INSERT INTO assistant_search_dirty_buckets(bucket_id)
        SELECT DISTINCT CAST((messages.rowid - 1) / ${SEARCH_BUCKET_MESSAGE_SPAN} AS INTEGER)
        FROM assistant_search_dirty_sessions AS dirty_sessions
        INNER JOIN assistant_threads AS threads ON threads.session_id = dirty_sessions.session_id
        INNER JOIN assistant_messages AS messages ON messages.thread_id = threads.id
        WHERE NOT EXISTS (
            SELECT 1 FROM assistant_search_dirty_buckets AS dirty_buckets
            WHERE dirty_buckets.bucket_id = CAST((messages.rowid - 1) / ${SEARCH_BUCKET_MESSAGE_SPAN} AS INTEGER)
        )
    `)
    db.run('DELETE FROM assistant_search_dirty_sessions')
}

function backfillSearchBuckets(db: SqlDatabase, cursor: number, limit: number): { indexed: number; lastRowId: number } {
    expandDirtySearchSessions(db)
    const rows = db.exec(`
        SELECT messages.rowid
        FROM assistant_messages AS messages
        WHERE messages.rowid > ? AND ${eligibleRowPredicate('messages')}
        ORDER BY messages.rowid ASC
        LIMIT ?
    `, [cursor, limit])[0]?.values || []
    const lastRowId = rows.length > 0 ? Number(rows.at(-1)?.[0] || cursor) : cursor
    const bucketIds = new Set(rows.map((row) => (
        Math.floor(Math.max(0, Number(row[0] || 1) - 1) / SEARCH_BUCKET_MESSAGE_SPAN)
    )))
    const dirtyRows = db.exec(`
        SELECT bucket_id FROM assistant_search_dirty_buckets
        ORDER BY bucket_id DESC
        LIMIT 64
    `)[0]?.values || []
    for (const row of dirtyRows) bucketIds.add(Number(row[0]))
    for (const bucketId of bucketIds) {
        rebuildSearchBucket(db, bucketId)
        db.run('DELETE FROM assistant_search_dirty_buckets WHERE bucket_id = ?', [bucketId])
    }
    if (rows.length > 0) writeMeta(db, SEARCH_INDEX_CURSOR_KEY, String(lastRowId))
    return { indexed: rows.length + dirtyRows.length, lastRowId }
}
function hasEligibleMessageAfter(db: SqlDatabase, rowId: number): boolean {
    return Boolean(db.exec(`
        SELECT 1 FROM assistant_messages AS messages
        WHERE messages.rowid > ? AND ${eligibleRowPredicate('messages')}
        LIMIT 1
    `, [rowId])[0]?.values?.[0])
}

export function backfillAssistantSearchIndexBatch(
    db: SqlDatabase,
    batchSize = SEARCH_BACKFILL_BATCH_SIZE
): { complete: boolean; indexed: number } {
    const hasDirtyProjection = Boolean(db.exec(`
        SELECT 1 FROM assistant_search_dirty_buckets
        UNION ALL
        SELECT 1 FROM assistant_search_dirty_sessions
        LIMIT 1
    `)[0]?.values?.[0])
    if (readMeta(db, SEARCH_INDEX_READY_KEY) === '1' && !hasDirtyProjection) return { complete: true, indexed: 0 }
    const cursor = Math.max(0, Number(readMeta(db, SEARCH_INDEX_CURSOR_KEY) || 0) || 0)
    const limit = Math.max(1, Math.min(2_000, Math.floor(batchSize || SEARCH_BACKFILL_BATCH_SIZE)))
    const messageBatch = backfillSearchBuckets(db, cursor, limit)
    const hasMoreMessages = hasEligibleMessageAfter(db, messageBatch.lastRowId)
    const hasRemainingDirtyProjection = Boolean(db.exec(`
        SELECT 1 FROM assistant_search_dirty_buckets
        UNION ALL
        SELECT 1 FROM assistant_search_dirty_sessions
        LIMIT 1
    `)[0]?.values?.[0])
    const complete = !hasMoreMessages && !hasRemainingDirtyProjection
    writeMeta(db, SEARCH_INDEX_READY_KEY, complete ? '1' : '0')
    return { complete, indexed: messageBatch.indexed }
}

function normalizeScope(value: AssistantSearchChatsInput['scope']): AssistantChatSearchScope {
    return value === 'archived' || value === 'all' ? value : 'active'
}

function collapseWhitespace(value: string): string {
    return value.replace(/\s+/g, ' ').trim()
}

function buildSnippet(text: string, query: string): string {
    const normalizedText = collapseWhitespace(text)
    if (normalizedText.length <= SEARCH_SNIPPET_MAX_CHARACTERS) return normalizedText
    const normalizedQuery = collapseWhitespace(query).replace(/^"|"$/g, '').toLowerCase()
    const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean)
    const foldedText = normalizedText.toLowerCase()
    let matchIndex = normalizedQuery ? foldedText.indexOf(normalizedQuery) : -1
    if (matchIndex < 0) {
        matchIndex = queryTokens.reduce((best, token) => {
            const index = foldedText.indexOf(token)
            return index >= 0 && (best < 0 || index < best) ? index : best
        }, -1)
    }
    const bodyLength = SEARCH_SNIPPET_MAX_CHARACTERS - 2
    const idealStart = Math.max(0, matchIndex - 24)
    const start = Math.min(idealStart, Math.max(0, normalizedText.length - bodyLength))
    const end = Math.min(normalizedText.length, start + bodyLength)
    return `${start > 0 ? '…' : ''}${normalizedText.slice(start, end)}${end < normalizedText.length ? '…' : ''}`
}

export function searchAssistantChatsFallback(
    db: SqlDatabase,
    input: AssistantSearchChatsInput
): AssistantSearchChatsResult {
    const query = collapseWhitespace(String(input.query || '')).slice(0, ASSISTANT_CHAT_SEARCH_MAX_QUERY_LENGTH)
    const scope = normalizeScope(input.scope)
    const limit = clampAssistantChatSearchLimit(input.limit)
    if (!canSearchAssistantChatContent(query)) {
        return { query, scope, matches: [], indexingOlderChats: false, searchBackend: 'scan' }
    }
    const escaped = query.replace(/[\\%_]/g, (character) => `\\${character}`)
    const scopeSql = scope === 'active' ? 'AND sessions.archived = 0'
        : scope === 'archived' ? 'AND sessions.archived = 1' : ''
    const rows = db.exec(`
        SELECT
            sessions.id,
            threads.id,
            messages.id,
            messages.role,
            sessions.title,
            sessions.project_path,
            messages.text,
            messages.created_at,
            sessions.archived
        FROM (
            SELECT id, thread_id, role, text, turn_id, streaming, created_at
            FROM assistant_messages
            WHERE streaming = 0
              AND role IN ('user', 'assistant')
              AND length(text) <= ${ASSISTANT_CHAT_SEARCH_MAX_INDEXED_MESSAGE_CHARACTERS}
            ORDER BY rowid DESC
            LIMIT ?
        ) AS messages
        INNER JOIN assistant_threads AS threads ON threads.id = messages.thread_id
        INNER JOIN assistant_sessions AS sessions ON sessions.id = threads.session_id
        WHERE LOWER(messages.text) LIKE LOWER(?) ESCAPE '\\'
          ${scopeSql}
          AND (
            messages.role = 'user'
            OR EXISTS (
                SELECT 1 FROM assistant_turns AS turns
                WHERE turns.thread_id = messages.thread_id
                  AND turns.assistant_message_id = messages.id
            )
          )
        ORDER BY
          CASE messages.role WHEN 'user' THEN 0 ELSE 1 END ASC,
          sessions.updated_at DESC,
          messages.created_at DESC,
          messages.id ASC
        LIMIT ?
    `, [SEARCH_FALLBACK_SCAN_MAX_MESSAGES, `%${escaped}%`, Math.min(300, limit * 8)])[0]?.values || []
    const seenSessions = new Set<string>()
    const matches: AssistantChatSearchMatch[] = []
    for (const row of rows) {
        const sessionId = String(row[0] || '')
        if (!sessionId || seenSessions.has(sessionId)) continue
        seenSessions.add(sessionId)
        matches.push({
            sessionId,
            threadId: String(row[1] || ''),
            messageId: String(row[2] || ''),
            role: String(row[3] || '') === 'user' ? 'user' : 'assistant',
            title: String(row[4] || 'Untitled chat'),
            projectPath: row[5] == null ? null : String(row[5]),
            snippet: buildSnippet(String(row[6] || ''), query),
            createdAt: String(row[7] || ''),
            archived: Number(row[8]) === 1
        })
        if (matches.length >= limit) break
    }
    return { query, scope, matches, indexingOlderChats: false, searchBackend: 'scan' }
}
