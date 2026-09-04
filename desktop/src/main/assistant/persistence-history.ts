import type { Database as SqlDatabase, SqlValue } from 'sql.js/dist/sql-asm.js'
import type {
    AssistantActivity,
    AssistantGetHistoryPageInput,
    AssistantGetHistoryAroundMessageInput,
    AssistantHistoryAroundMessageResult,
    AssistantHistoryPage,
    AssistantReviewChangeIndexEntry,
    AssistantReviewIndex,
    AssistantReviewMessagePreview,
    AssistantTurnDetail,
    AssistantMessage,
    AssistantPendingApproval,
    AssistantPendingUserInput,
    AssistantProposedPlan,
    AssistantSearchTurnsResult,
    AssistantThreadDetail
} from '../../shared/assistant/contracts'
import {
    getFileChangePatchStats,
    normalizeFileChangePath,
    normalizeFileChangePayload
} from '../../shared/assistant/contracts/file-change'
import { reconcileAssistantMessageReplays } from '../../shared/assistant/message-reconciliation'
import {
    findAssistantPersistedTurnAt,
    reconcileAssistantUserTurnIds,
    resolveAssistantTurnIdAlias
} from '../../shared/assistant/turn-reconciliation'
import { ASSISTANT_CHAT_SEARCH_MAX_INDEXED_MESSAGE_CHARACTERS } from '../../shared/assistant/chat-search'
import { decodeAssistantHistoryCursor, encodeAssistantHistoryCursor } from '../../shared/assistant/history-cursor'
import {
    ASSISTANT_TIMELINE_KIND_RANK,
    compareAssistantTimelineOrderKeys,
    getAssistantTimelineOrderKey,
    normalizeAssistantTimelineSequence,
    type AssistantTimelineOrderKey,
    type AssistantTimelineRecordKind
} from '../../shared/assistant/timeline-order'
import {
    ASSISTANT_ACTIVITY_PAYLOAD_MAX_CHARACTERS,
    ASSISTANT_TRUNCATED_ACTIVITY_PAYLOAD_ESTIMATED_CHARACTERS,
    assistantActivityPayloadColumns,
    parseAssistantActivityPayload
} from './persistence-activity-payload'
import { parseJson, toNullableString, toNumber } from './persistence-utils'

export const INITIAL_ASSISTANT_HISTORY_TURN_LIMIT = 3
export const OLDER_ASSISTANT_HISTORY_TURN_LIMIT = 1
export const INITIAL_ASSISTANT_HISTORY_PAGE_MAX_RECORDS = 120
export const ASSISTANT_HISTORY_PAGE_MAX_RECORDS = 160
export const INITIAL_ASSISTANT_HISTORY_PAGE_MAX_CHARACTERS = 900_000
export const ASSISTANT_HISTORY_PAGE_MAX_CHARACTERS = 900_000
const LEGACY_RECORDS_PER_TURN = 8

function clampTurnLimit(value: number | undefined, fallback: number): number {
    if (!Number.isFinite(value)) return fallback
    return Math.max(1, Math.min(50, Math.floor(value!)))
}

function tupleValues(key: AssistantTimelineOrderKey): SqlValue[] {
    return [key.createdAt, normalizeAssistantTimelineSequence(key.timelineSequence), key.kindRank, key.id]
}

function keyRangeSql(kind: AssistantTimelineRecordKind, lower: AssistantTimelineOrderKey | null, upper: AssistantTimelineOrderKey | null): { sql: string; params: SqlValue[] } {
    const rank = ASSISTANT_TIMELINE_KIND_RANK[kind]
    const clauses: string[] = []
    const params: SqlValue[] = []
    if (lower) {
        clauses.push('(created_at, COALESCE(timeline_sequence, -1), ?, id) >= (?, ?, ?, ?)')
        params.push(rank, ...tupleValues(lower))
    }
    if (upper) {
        clauses.push('(created_at, COALESCE(timeline_sequence, -1), ?, id) < (?, ?, ?, ?)')
        params.push(rank, ...tupleValues(upper))
    }
    return { sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', params }
}

function mapMessage(row: SqlValue[]): AssistantMessage {
    return {
        id: String(row[0] || ''),
        role: String(row[1] || 'assistant') as AssistantMessage['role'],
        text: String(row[2] || ''),
        turnId: toNullableString(row[3]),
        streaming: toNumber(row[4]) === 1,
        timelineSequence: typeof row[5] === 'number' ? row[5] : undefined,
        createdAt: String(row[6] || new Date(0).toISOString()),
        updatedAt: String(row[7] || new Date(0).toISOString()),
        providerItemId: toNullableString(row[8]) || undefined,
        modality: (toNullableString(row[9]) || undefined) as AssistantMessage['modality']
    }
}

function mapActivity(row: SqlValue[]): AssistantActivity {
    return {
        id: String(row[0] || ''),
        kind: String(row[1] || ''),
        tone: String(row[2] || 'info') as AssistantActivity['tone'],
        summary: String(row[3] || ''),
        detail: toNullableString(row[4]) || undefined,
        turnId: toNullableString(row[5]),
        timelineSequence: typeof row[6] === 'number' ? row[6] : undefined,
        createdAt: String(row[7] || new Date(0).toISOString()),
        payload: parseAssistantActivityPayload(row[8], row[9])
    }
}

function mapPlan(row: SqlValue[]): AssistantProposedPlan {
    return {
        id: String(row[0] || ''),
        turnId: toNullableString(row[1]),
        planMarkdown: String(row[2] || ''),
        timelineSequence: typeof row[3] === 'number' ? row[3] : undefined,
        createdAt: String(row[4] || new Date(0).toISOString()),
        updatedAt: String(row[5] || new Date(0).toISOString())
    }
}

function readMessages(db: SqlDatabase, threadId: string, lower: AssistantTimelineOrderKey | null, upper: AssistantTimelineOrderKey | null, limit?: number): AssistantMessage[] {
    const range = keyRangeSql('message', lower, upper)
    const descending = typeof limit === 'number'
    const rows = db.exec(`SELECT id, role, text, turn_id, streaming, timeline_sequence, created_at, updated_at, provider_item_id, modality FROM assistant_messages WHERE thread_id = ?${range.sql} ORDER BY created_at ${descending ? 'DESC' : 'ASC'}, COALESCE(timeline_sequence, -1) ${descending ? 'DESC' : 'ASC'}, id ${descending ? 'DESC' : 'ASC'}${descending ? ' LIMIT ?' : ''}`, [threadId, ...range.params, ...(descending ? [limit!] : [])])[0]?.values || []
    const records = rows.map(mapMessage)
    return reconcileAssistantMessageReplays(descending ? records.reverse() : records)
}

function readMessageById(db: SqlDatabase, threadId: string, messageId: string): AssistantMessage | null {
    const row = db.exec(`SELECT id, role, text, turn_id, streaming, timeline_sequence, created_at, updated_at, provider_item_id, modality FROM assistant_messages WHERE thread_id = ? AND id = ? LIMIT 1`, [threadId, messageId])[0]?.values?.[0]
    return row ? mapMessage(row) : null
}

function readActivities(db: SqlDatabase, threadId: string, lower: AssistantTimelineOrderKey | null, upper: AssistantTimelineOrderKey | null, limit?: number): AssistantActivity[] {
    const range = keyRangeSql('activity', lower, upper)
    const descending = typeof limit === 'number'
    const rows = db.exec(`SELECT id, kind, tone, summary, detail, turn_id, timeline_sequence, created_at, ${assistantActivityPayloadColumns()} FROM assistant_activities WHERE thread_id = ?${range.sql} ORDER BY created_at ${descending ? 'DESC' : 'ASC'}, COALESCE(timeline_sequence, -1) ${descending ? 'DESC' : 'ASC'}, id ${descending ? 'DESC' : 'ASC'}${descending ? ' LIMIT ?' : ''}`, [threadId, ...range.params, ...(descending ? [limit!] : [])])[0]?.values || []
    const records = rows.map(mapActivity)
    return descending ? records.reverse() : records
}

export function readAssistantActivity(db: SqlDatabase, threadId: string, activityId: string): AssistantActivity | null {
    const row = db.exec(`SELECT id, kind, tone, summary, detail, turn_id, timeline_sequence, created_at, ${assistantActivityPayloadColumns()} FROM assistant_activities WHERE thread_id = ? AND id = ? LIMIT 1`, [threadId, activityId])[0]?.values?.[0]
    return row ? mapActivity(row) : null
}

function readPlans(db: SqlDatabase, threadId: string, lower: AssistantTimelineOrderKey | null, upper: AssistantTimelineOrderKey | null, limit?: number): AssistantProposedPlan[] {
    const range = keyRangeSql('plan', lower, upper)
    const descending = typeof limit === 'number'
    const rows = db.exec(`SELECT id, turn_id, plan_markdown, timeline_sequence, created_at, updated_at FROM assistant_proposed_plans WHERE thread_id = ?${range.sql} ORDER BY created_at ${descending ? 'DESC' : 'ASC'}, COALESCE(timeline_sequence, -1) ${descending ? 'DESC' : 'ASC'}, id ${descending ? 'DESC' : 'ASC'}${descending ? ' LIMIT ?' : ''}`, [threadId, ...range.params, ...(descending ? [limit!] : [])])[0]?.values || []
    const records = rows.map(mapPlan)
    return descending ? records.reverse() : records
}

function readHistoryRangeSize(
    db: SqlDatabase,
    threadId: string,
    lower: AssistantTimelineOrderKey,
    upper: AssistantTimelineOrderKey | null
): { records: number; characters: number } {
    let records = 0
    let characters = 0
    for (const [table, kind, characterExpression] of [
        ['assistant_messages', 'message', "LENGTH(COALESCE(text, ''))"],
        ['assistant_activities', 'activity', `LENGTH(COALESCE(summary, '')) + LENGTH(COALESCE(detail, '')) + CASE WHEN LENGTH(COALESCE(payload_json, '')) <= ${ASSISTANT_ACTIVITY_PAYLOAD_MAX_CHARACTERS} THEN LENGTH(COALESCE(payload_json, '')) ELSE ${ASSISTANT_TRUNCATED_ACTIVITY_PAYLOAD_ESTIMATED_CHARACTERS} END`],
        ['assistant_proposed_plans', 'plan', "LENGTH(COALESCE(plan_markdown, ''))"]
    ] as const) {
        const range = keyRangeSql(kind, lower, upper)
        const row = db.exec(`SELECT COUNT(*), COALESCE(SUM(${characterExpression}), 0) FROM ${table} WHERE thread_id = ?${range.sql}`, [threadId, ...range.params])[0]?.values?.[0]
        records += toNumber(row?.[0])
        characters += toNumber(row?.[1])
    }
    return { records, characters }
}

function historyRangeExceedsBudget(
    db: SqlDatabase,
    threadId: string,
    lower: AssistantTimelineOrderKey,
    upper: AssistantTimelineOrderKey | null,
    maxRecords: number,
    maxCharacters: number
): boolean {
    let records = 0
    let characters = 0
    for (const [table, kind, characterExpression] of [
        ['assistant_messages', 'message', "LENGTH(COALESCE(text, ''))"],
        ['assistant_activities', 'activity', `LENGTH(COALESCE(summary, '')) + LENGTH(COALESCE(detail, '')) + CASE WHEN LENGTH(COALESCE(payload_json, '')) <= ${ASSISTANT_ACTIVITY_PAYLOAD_MAX_CHARACTERS} THEN LENGTH(COALESCE(payload_json, '')) ELSE ${ASSISTANT_TRUNCATED_ACTIVITY_PAYLOAD_ESTIMATED_CHARACTERS} END`],
        ['assistant_proposed_plans', 'plan', "LENGTH(COALESCE(plan_markdown, ''))"]
    ] as const) {
        const remainingRecordBudget = maxRecords - records
        if (remainingRecordBudget < 0) return true
        const range = keyRangeSql(kind, lower, upper)
        const rows = db.exec(`SELECT ${characterExpression} FROM ${table} WHERE thread_id = ?${range.sql} LIMIT ?`, [
            threadId,
            ...range.params,
            remainingRecordBudget + 1
        ])[0]?.values || []
        records += rows.length
        if (records > maxRecords) return true
        for (const row of rows) {
            characters += toNumber(row[0])
            if (characters > maxCharacters) return true
        }
    }
    return false
}

function hasRecordBefore(db: SqlDatabase, threadId: string, key: AssistantTimelineOrderKey): boolean {
    for (const [table, kind] of [
        ['assistant_messages', 'message'],
        ['assistant_activities', 'activity'],
        ['assistant_proposed_plans', 'plan']
    ] as const) {
        const rank = ASSISTANT_TIMELINE_KIND_RANK[kind]
        const row = db.exec(`SELECT 1 FROM ${table} WHERE thread_id = ? AND (created_at, COALESCE(timeline_sequence, -1), ?, id) < (?, ?, ?, ?) LIMIT 1`, [threadId, rank, ...tupleValues(key)])[0]?.values?.[0]
        if (row) return true
    }
    return false
}

function readLegacyFallbackPage(db: SqlDatabase, threadId: string, upper: AssistantTimelineOrderKey | null, turnLimit: number): AssistantHistoryPage {
    const recordLimit = turnLimit * LEGACY_RECORDS_PER_TURN
    const candidates = [
        ...readMessages(db, threadId, null, upper, recordLimit).map((record) => ({ kind: 'message' as const, record })),
        ...readActivities(db, threadId, null, upper, recordLimit).map((record) => ({ kind: 'activity' as const, record })),
        ...readPlans(db, threadId, null, upper, recordLimit).map((record) => ({ kind: 'plan' as const, record }))
    ].sort((left, right) => compareAssistantTimelineOrderKeys(
        getAssistantTimelineOrderKey(left.kind, left.record),
        getAssistantTimelineOrderKey(right.kind, right.record)
    ))
    const selected = candidates.slice(Math.max(0, candidates.length - recordLimit))
    const selectedIds = new Set(selected.map(({ kind, record }) => `${kind}:${record.id}`))
    const messages = selected.filter(({ kind, record }) => kind === 'message' && selectedIds.has(`${kind}:${record.id}`)).map(({ record }) => record as AssistantMessage)
    const activities = selected.filter(({ kind }) => kind === 'activity').map(({ record }) => record as AssistantActivity)
    const proposedPlans = selected.filter(({ kind }) => kind === 'plan').map(({ record }) => record as AssistantProposedPlan)
    const oldest = selected[0]
    const oldestKey = oldest ? getAssistantTimelineOrderKey(oldest.kind, oldest.record) : null
    return {
        threadId,
        messages,
        activities,
        proposedPlans,
        pageInfo: {
            oldestCursor: oldestKey ? encodeAssistantHistoryCursor(threadId, oldestKey) : null,
            newestCursor: upper ? encodeAssistantHistoryCursor(threadId, upper) : null,
            hasOlder: oldestKey ? hasRecordBefore(db, threadId, oldestKey) : false,
            hasNewer: Boolean(upper),
            turnCount: new Set(messages.map((message) => message.turnId).filter(Boolean)).size
        }
    }
}

function historyBoundaryKey(row: SqlValue[]): AssistantTimelineOrderKey {
    return {
        id: String(row[0] || ''),
        timelineSequence: typeof row[1] === 'number' ? row[1] : null,
        createdAt: String(row[2] || new Date(0).toISOString()),
        kindRank: ASSISTANT_TIMELINE_KIND_RANK.message
    }
}

function readForwardAssistantHistoryPage(
    db: SqlDatabase,
    threadId: string,
    lower: AssistantTimelineOrderKey,
    turnLimit: number,
    maxRecords: number,
    maxCharacters: number
): AssistantHistoryPage {
    const boundaryRows = db.exec(`SELECT id, timeline_sequence, created_at FROM assistant_messages WHERE thread_id = ? AND role = 'user' AND (created_at, COALESCE(timeline_sequence, -1), 0, id) >= (?, ?, ?, ?) ORDER BY created_at ASC, COALESCE(timeline_sequence, -1) ASC, id ASC LIMIT ?`, [threadId, ...tupleValues(lower), turnLimit + 1])[0]?.values || []
    if (boundaryRows.length === 0) {
        return {
            threadId,
            messages: [],
            activities: [],
            proposedPlans: [],
            pageInfo: {
                oldestCursor: encodeAssistantHistoryCursor(threadId, lower),
                newestCursor: null,
                hasOlder: hasRecordBefore(db, threadId, lower),
                hasNewer: false,
                turnCount: 0
            }
        }
    }

    const pageLower = historyBoundaryKey(boundaryRows[0]!)
    let selectedTurnCount = 1
    const availableTurns = Math.min(turnLimit, boundaryRows.length)
    for (let count = 2; count <= availableTurns; count += 1) {
        const candidateUpper = boundaryRows[count] ? historyBoundaryKey(boundaryRows[count]!) : null
        if (historyRangeExceedsBudget(db, threadId, pageLower, candidateUpper, maxRecords, maxCharacters)) break
        selectedTurnCount = count
    }
    const upperRow = boundaryRows[selectedTurnCount]
    const pageUpper = upperRow ? historyBoundaryKey(upperRow) : null
    return {
        threadId,
        messages: readMessages(db, threadId, pageLower, pageUpper),
        activities: readActivities(db, threadId, pageLower, pageUpper),
        proposedPlans: readPlans(db, threadId, pageLower, pageUpper),
        pageInfo: {
            oldestCursor: encodeAssistantHistoryCursor(threadId, pageLower),
            newestCursor: pageUpper ? encodeAssistantHistoryCursor(threadId, pageUpper) : null,
            hasOlder: hasRecordBefore(db, threadId, pageLower),
            hasNewer: Boolean(pageUpper),
            turnCount: selectedTurnCount
        }
    }
}

export function readAssistantHistoryPage(db: SqlDatabase, input: AssistantGetHistoryPageInput): AssistantHistoryPage {
    const threadId = String(input.threadId || '').trim()
    if (!threadId) throw new Error('Assistant thread id is required.')
    if (!db.exec('SELECT 1 FROM assistant_threads WHERE id = ? LIMIT 1', [threadId])[0]?.values?.[0]) {
        throw new Error('Assistant thread not found.')
    }

    if (input.before && input.after) throw new Error('Assistant history accepts either a before or after cursor, not both.')
    const upper = decodeAssistantHistoryCursor(threadId, input.before)
    const forwardLower = decodeAssistantHistoryCursor(threadId, input.after)
    const maxRecords = input.before ? ASSISTANT_HISTORY_PAGE_MAX_RECORDS : INITIAL_ASSISTANT_HISTORY_PAGE_MAX_RECORDS
    const maxCharacters = input.before ? ASSISTANT_HISTORY_PAGE_MAX_CHARACTERS : INITIAL_ASSISTANT_HISTORY_PAGE_MAX_CHARACTERS
    const turnLimit = clampTurnLimit(input.turnLimit, input.before || input.after ? OLDER_ASSISTANT_HISTORY_TURN_LIMIT : INITIAL_ASSISTANT_HISTORY_TURN_LIMIT)
    if (forwardLower) {
        return readForwardAssistantHistoryPage(
            db,
            threadId,
            forwardLower,
            turnLimit,
            ASSISTANT_HISTORY_PAGE_MAX_RECORDS,
            ASSISTANT_HISTORY_PAGE_MAX_CHARACTERS
        )
    }
    const beforeClause = upper
        ? ' AND (created_at, COALESCE(timeline_sequence, -1), 0, id) < (?, ?, ?, ?)'
        : ''
    const boundaryRows = db.exec(`SELECT id, timeline_sequence, created_at FROM assistant_messages WHERE thread_id = ? AND role = 'user'${beforeClause} ORDER BY created_at DESC, COALESCE(timeline_sequence, -1) DESC, id DESC LIMIT ?`, [threadId, ...(upper ? tupleValues(upper) : []), turnLimit])[0]?.values || []

    if (boundaryRows.length === 0) return readLegacyFallbackPage(db, threadId, upper, turnLimit)

    // Range size grows monotonically as the boundary moves toward older turns.
    // Binary search keeps initial hydration bounded to O(log turnLimit) aggregate
    // checks instead of issuing three COUNT/SUM queries for every candidate turn.
    let selectedBoundaryIndex = 0
    let low = 0
    let high = boundaryRows.length - 1
    while (low <= high) {
        const index = Math.floor((low + high) / 2)
        const candidateBoundary = boundaryRows[index]!
        const candidateLower: AssistantTimelineOrderKey = {
            id: String(candidateBoundary[0] || ''),
            timelineSequence: typeof candidateBoundary[1] === 'number' ? candidateBoundary[1] : null,
            createdAt: String(candidateBoundary[2] || new Date(0).toISOString()),
            kindRank: ASSISTANT_TIMELINE_KIND_RANK.message
        }
        const size = readHistoryRangeSize(db, threadId, candidateLower, upper)
        const withinBudget = index === 0 || (
            size.records <= maxRecords
            && size.characters <= maxCharacters
        )
        if (withinBudget) {
            selectedBoundaryIndex = index
            low = index + 1
        } else {
            high = index - 1
        }
    }
    const selectedBoundary = boundaryRows[selectedBoundaryIndex]!
    const selectedTurnCount = selectedBoundaryIndex + 1

    const lower: AssistantTimelineOrderKey = {
        id: String(selectedBoundary[0] || ''),
        timelineSequence: typeof selectedBoundary[1] === 'number' ? selectedBoundary[1] : null,
        createdAt: String(selectedBoundary[2] || new Date(0).toISOString()),
        kindRank: ASSISTANT_TIMELINE_KIND_RANK.message
    }
    return {
        threadId,
        messages: readMessages(db, threadId, lower, upper),
        activities: readActivities(db, threadId, lower, upper),
        proposedPlans: readPlans(db, threadId, lower, upper),
        pageInfo: {
            oldestCursor: encodeAssistantHistoryCursor(threadId, lower),
            newestCursor: upper ? encodeAssistantHistoryCursor(threadId, upper) : null,
            hasOlder: hasRecordBefore(db, threadId, lower),
            hasNewer: Boolean(upper),
            turnCount: selectedTurnCount
        }
    }
}

function constrainAssistantHistoryAnchorPage(
    page: AssistantHistoryPage,
    messageId: string
): AssistantHistoryPage {
    const recordCount = page.messages.length + page.activities.length + page.proposedPlans.length
    if (recordCount <= ASSISTANT_HISTORY_PAGE_MAX_RECORDS
        && JSON.stringify(page).length <= ASSISTANT_HISTORY_PAGE_MAX_CHARACTERS) {
        return page
    }
    const targetMessage = page.messages.find((message) => message.id === messageId)
    if (!targetMessage) throw new Error('Assistant search message was not found.')
    const targetOnlyPage: AssistantHistoryPage = {
        ...page,
        messages: [targetMessage],
        activities: [],
        proposedPlans: [],
        pageInfo: { ...page.pageInfo, turnCount: 1 }
    }
    if (JSON.stringify(targetOnlyPage).length > ASSISTANT_HISTORY_PAGE_MAX_CHARACTERS) {
        throw new Error('Assistant search message was not found.')
    }
    return targetOnlyPage
}

function readAssistantTargetOnlyPage(
    db: SqlDatabase,
    threadId: string,
    messageId: string,
    lower: AssistantTimelineOrderKey,
    upper: AssistantTimelineOrderKey | null
): AssistantHistoryPage {
    const targetMessage = readMessageById(db, threadId, messageId)
    if (!targetMessage) throw new Error('Assistant search message was not found.')
    const page: AssistantHistoryPage = {
        threadId,
        messages: [targetMessage],
        activities: [],
        proposedPlans: [],
        pageInfo: {
            oldestCursor: encodeAssistantHistoryCursor(threadId, lower),
            newestCursor: upper ? encodeAssistantHistoryCursor(threadId, upper) : null,
            hasOlder: hasRecordBefore(db, threadId, lower),
            hasNewer: Boolean(upper),
            turnCount: 1
        }
    }
    if (JSON.stringify(page).length > ASSISTANT_HISTORY_PAGE_MAX_CHARACTERS) {
        throw new Error('Assistant search message was not found.')
    }
    return page
}

export function readAssistantHistoryAroundMessage(
    db: SqlDatabase,
    input: AssistantGetHistoryAroundMessageInput
): AssistantHistoryAroundMessageResult {
    const threadId = String(input.threadId || '').trim()
    const messageId = String(input.messageId || '').trim()
    if (!threadId || !messageId) throw new Error('Assistant thread and message ids are required.')
    const targetRow = db.exec(`
        SELECT id, timeline_sequence, created_at
        FROM assistant_messages
        WHERE thread_id = ? AND id = ? AND streaming = 0
          AND length(text) <= ${ASSISTANT_CHAT_SEARCH_MAX_INDEXED_MESSAGE_CHARACTERS}
          AND (
            role = 'user'
            OR (
              role = 'assistant'
              AND EXISTS (
                SELECT 1 FROM assistant_turns AS turns
                WHERE turns.thread_id = assistant_messages.thread_id
                  AND turns.assistant_message_id = assistant_messages.id
              )
            )
          )
        LIMIT 1
    `, [threadId, messageId])[0]?.values?.[0]
    if (!targetRow) throw new Error('Assistant search message was not found.')
    const targetKey = historyBoundaryKey(targetRow)
    const boundaryRow = db.exec(`
        SELECT id, timeline_sequence, created_at
        FROM assistant_messages
        WHERE thread_id = ?
          AND role = 'user'
          AND (created_at, COALESCE(timeline_sequence, -1), 0, id) <= (?, ?, ?, ?)
        ORDER BY created_at DESC, COALESCE(timeline_sequence, -1) DESC, id DESC
        LIMIT 1
    `, [threadId, ...tupleValues(targetKey)])[0]?.values?.[0]
    const turnLimit = clampTurnLimit(input.turnLimit, 4)
    if (boundaryRow) {
        const lower = historyBoundaryKey(boundaryRow)
        const nextBoundaryRow = db.exec(`
            SELECT id, timeline_sequence, created_at
            FROM assistant_messages
            WHERE thread_id = ?
              AND role = 'user'
              AND (created_at, COALESCE(timeline_sequence, -1), 0, id) > (?, ?, ?, ?)
            ORDER BY created_at ASC, COALESCE(timeline_sequence, -1) ASC, id ASC
            LIMIT 1
        `, [threadId, ...tupleValues(lower)])[0]?.values?.[0]
        const firstUpper = nextBoundaryRow ? historyBoundaryKey(nextBoundaryRow) : null
        if (historyRangeExceedsBudget(
            db,
            threadId,
            lower,
            firstUpper,
            ASSISTANT_HISTORY_PAGE_MAX_RECORDS,
            ASSISTANT_HISTORY_PAGE_MAX_CHARACTERS
        )) {
            return { messageId, page: readAssistantTargetOnlyPage(db, threadId, messageId, lower, firstUpper) }
        }
        const page = readForwardAssistantHistoryPage(
            db,
            threadId,
            lower,
            turnLimit,
            ASSISTANT_HISTORY_PAGE_MAX_RECORDS,
            ASSISTANT_HISTORY_PAGE_MAX_CHARACTERS
        )
        return {
            messageId,
            page: constrainAssistantHistoryAnchorPage(page, messageId)
        }
    }

    const nextBoundaryRow = db.exec(`
        SELECT id, timeline_sequence, created_at
        FROM assistant_messages
        WHERE thread_id = ?
          AND role = 'user'
          AND (created_at, COALESCE(timeline_sequence, -1), 0, id) > (?, ?, ?, ?)
        ORDER BY created_at ASC, COALESCE(timeline_sequence, -1) ASC, id ASC
        LIMIT 1
    `, [threadId, ...tupleValues(targetKey)])[0]?.values?.[0]
    const upper = nextBoundaryRow ? historyBoundaryKey(nextBoundaryRow) : null
    if (historyRangeExceedsBudget(
        db,
        threadId,
        targetKey,
        upper,
        ASSISTANT_HISTORY_PAGE_MAX_RECORDS,
        ASSISTANT_HISTORY_PAGE_MAX_CHARACTERS
    )) {
        return { messageId, page: readAssistantTargetOnlyPage(db, threadId, messageId, targetKey, upper) }
    }
    const page: AssistantHistoryPage = {
        threadId,
        messages: readMessages(db, threadId, targetKey, upper),
        activities: readActivities(db, threadId, targetKey, upper),
        proposedPlans: readPlans(db, threadId, targetKey, upper),
        pageInfo: {
            oldestCursor: encodeAssistantHistoryCursor(threadId, targetKey),
            newestCursor: upper ? encodeAssistantHistoryCursor(threadId, upper) : null,
            hasOlder: hasRecordBefore(db, threadId, targetKey),
            hasNewer: Boolean(upper),
            turnCount: 1
        }
    }
    return { messageId, page: constrainAssistantHistoryAnchorPage(page, messageId) }
}

function readPendingApprovals(db: SqlDatabase, threadId: string): AssistantPendingApproval[] {
    const rows = db.exec(`SELECT id, request_id, request_type, title, detail, command, paths_json, status, decision, turn_id, created_at, resolved_at FROM assistant_pending_approvals WHERE thread_id = ? ORDER BY created_at ASC, id ASC`, [threadId])[0]?.values || []
    return rows.map((row) => ({
        id: String(row[0] || ''), requestId: String(row[1] || ''), requestType: String(row[2] || 'command') as AssistantPendingApproval['requestType'],
        title: toNullableString(row[3]) || undefined, detail: toNullableString(row[4]) || undefined, command: toNullableString(row[5]) || undefined,
        paths: parseJson<string[] | undefined>(row[6], undefined), status: String(row[7] || 'pending') as AssistantPendingApproval['status'],
        decision: toNullableString(row[8]) as AssistantPendingApproval['decision'], turnId: toNullableString(row[9]), createdAt: String(row[10] || new Date(0).toISOString()), resolvedAt: toNullableString(row[11])
    }))
}

function readPendingUserInputs(db: SqlDatabase, threadId: string): AssistantPendingUserInput[] {
    const rows = db.exec(`SELECT id, request_id, questions_json, status, answers_json, response_message_id, turn_id, created_at, resolved_at FROM assistant_pending_user_inputs WHERE thread_id = ? ORDER BY created_at ASC, id ASC`, [threadId])[0]?.values || []
    return rows.map((row) => ({
        id: String(row[0] || ''), requestId: String(row[1] || ''), questions: parseJson(row[2], []), status: String(row[3] || 'pending') as AssistantPendingUserInput['status'],
        answers: parseJson<Record<string, string | string[]> | null>(row[4], null), responseMessageId: toNullableString(row[5]), turnId: toNullableString(row[6]), createdAt: String(row[7] || new Date(0).toISOString()), resolvedAt: toNullableString(row[8])
    }))
}

const REVIEW_INDEX_PREVIEW_LIMIT = 900

type MutableReviewIndexTurn = {
    id: string
    state: 'running' | 'completed' | 'interrupted' | 'error'
    requestedAt: string
    updatedAt: string
    assistantMessageId: string | null
    prompt: AssistantReviewMessagePreview | null
    response: AssistantReviewMessagePreview | null
    changes: AssistantReviewChangeIndexEntry[]
}

function reconcileDuplicateReviewLedgerTurns(turnsById: Map<string, MutableReviewIndexTurn>): void {
    const turnsByAssistantMessageId = new Map<string, MutableReviewIndexTurn[]>()
    for (const turn of turnsById.values()) {
        if (!turn.assistantMessageId) continue
        const matches = turnsByAssistantMessageId.get(turn.assistantMessageId) || []
        matches.push(turn)
        turnsByAssistantMessageId.set(turn.assistantMessageId, matches)
    }

    const evidenceScore = (turn: MutableReviewIndexTurn): number => (
        (turn.prompt ? 4 : 0)
        + (turn.response ? 2 : 0)
        + (turn.changes.length > 0 ? 1 : 0)
    )
    for (const duplicates of turnsByAssistantMessageId.values()) {
        if (duplicates.length < 2) continue
        const ordered = duplicates.slice().sort((left, right) => (
            evidenceScore(right) - evidenceScore(left)
            || left.requestedAt.localeCompare(right.requestedAt)
            || left.id.localeCompare(right.id)
        ))
        const keeper = ordered[0]!
        for (const duplicate of ordered.slice(1)) {
            if (!keeper.prompt && duplicate.prompt) keeper.prompt = duplicate.prompt
            if (!keeper.response || (duplicate.response && keeper.response.createdAt < duplicate.response.createdAt)) {
                keeper.response = duplicate.response || keeper.response
            }
            const knownChangeIds = new Set(keeper.changes.map((change) => `${change.activityId}:${change.filePath}`))
            keeper.changes.push(...duplicate.changes.filter((change) => !knownChangeIds.has(`${change.activityId}:${change.filePath}`)))
            keeper.updatedAt = laterTimestamp(keeper.updatedAt, duplicate.updatedAt)
            turnsById.delete(duplicate.id)
        }
    }
}

function buildReviewMessagePreview(message: AssistantMessage): AssistantReviewMessagePreview {
    const truncated = message.text.length > REVIEW_INDEX_PREVIEW_LIMIT
    return {
        id: message.id,
        text: truncated ? `${message.text.slice(0, REVIEW_INDEX_PREVIEW_LIMIT).trimEnd()}…` : message.text,
        truncated,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt
    }
}

function laterTimestamp(left: string, right: string): string {
    return left.localeCompare(right) >= 0 ? left : right
}

function readReviewFileChanges(activity: AssistantActivity, turnId: string): AssistantReviewChangeIndexEntry[] {
    const payload = activity.payload || {}
    const normalized = normalizeFileChangePayload(payload, {
        provider: payload.provider === 'pi' ? 'pi' : 'codex',
        startedAt: activity.createdAt,
        status: 'completed'
    })
    if (normalized.status === 'failed') return []
    const status: AssistantReviewChangeIndexEntry['status'] = normalized.status === 'running' ? 'running' : 'completed'

    const pathEntries = normalized.changes.length > 0
        ? normalized.changes.map((change) => ({
            path: change.path,
            previousPath: change.previousPath,
            changeKind: change.kind,
            isNew: change.isNew,
            ...getFileChangePatchStats(change.diff)
        }))
        : normalized.paths.map((path) => ({
            path,
            previousPath: undefined,
            changeKind: undefined,
            isNew: normalized.createdPaths.some((createdPath) => normalizeFileChangePath(createdPath) === normalizeFileChangePath(path)),
            additions: 0,
            deletions: 0
        }))
    if (pathEntries.length === 0) return []

    const knownAdditions = pathEntries.reduce((sum, entry) => sum + entry.additions, 0)
    const knownDeletions = pathEntries.reduce((sum, entry) => sum + entry.deletions, 0)
    pathEntries[0]!.additions += Math.max(0, (normalized.additions || 0) - knownAdditions)
    pathEntries[0]!.deletions += Math.max(0, (normalized.deletions || 0) - knownDeletions)

    return pathEntries.flatMap((entry) => {
        const filePath = normalizeFileChangePath(entry.path)
        if (!filePath) return []
        return [{
            activityId: activity.id,
            turnId,
            filePath,
            previousPath: entry.previousPath ? normalizeFileChangePath(entry.previousPath) : undefined,
            changeKind: entry.changeKind,
            isNew: entry.isNew,
            additions: entry.additions,
            deletions: entry.deletions,
            status,
            authoritative: normalized.authoritative,
            truncated: normalized.truncated,
            unavailableReason: normalized.diffUnavailableReason,
            createdAt: activity.createdAt
        }]
    })
}

export function readAssistantReviewIndex(db: SqlDatabase, threadId: string): AssistantReviewIndex {
    const normalizedThreadId = String(threadId || '').trim()
    if (!normalizedThreadId) throw new Error('Assistant thread id is required.')
    const threadRow = db.exec('SELECT source, agent_nickname, agent_role FROM assistant_threads WHERE id = ? LIMIT 1', [normalizedThreadId])[0]?.values?.[0]
    if (!threadRow) throw new Error('Assistant thread not found.')
    const agentLabel = toNullableString(threadRow[1])
        || toNullableString(threadRow[2])
        || (String(threadRow[0] || 'root') === 'subagent' ? 'Subagent' : 'Agent')

    const persistedTurnRows = db.exec(`
        SELECT id, state, requested_at, updated_at, completed_at, assistant_message_id
        FROM assistant_turns
        WHERE thread_id = ?
        ORDER BY requested_at ASC, id ASC
    `, [normalizedThreadId])[0]?.values || []
    const turnsById = new Map<string, MutableReviewIndexTurn>()
    const persistedTurns = persistedTurnRows.map((row) => {
        const id = String(row[0] || '')
        const requestedAt = String(row[2] || new Date(0).toISOString())
        const turn: MutableReviewIndexTurn = {
            id,
            state: String(row[1] || 'completed') as MutableReviewIndexTurn['state'],
            requestedAt,
            updatedAt: String(row[3] || requestedAt),
            assistantMessageId: toNullableString(row[5]),
            prompt: null,
            response: null,
            changes: []
        }
        if (id) turnsById.set(id, turn)
        return {
            id,
            requestedAt,
            completedAt: toNullableString(row[4])
        }
    }).filter((turn) => Boolean(turn.id))

    const ensureTurn = (id: string, createdAt: string): MutableReviewIndexTurn => {
        const existing = turnsById.get(id)
        if (existing) return existing
        const turn: MutableReviewIndexTurn = {
            id,
            state: 'completed',
            requestedAt: createdAt,
            updatedAt: createdAt,
            assistantMessageId: null,
            prompt: null,
            response: null,
            changes: []
        }
        turnsById.set(id, turn)
        return turn
    }

    const users = reconcileAssistantMessageReplays((db.exec(`
        SELECT id, role, text, turn_id, streaming, timeline_sequence, created_at, updated_at, provider_item_id, modality
        FROM assistant_messages
        WHERE thread_id = ? AND role = 'user'
        ORDER BY created_at ASC, COALESCE(timeline_sequence, -1) ASC, id ASC
    `, [normalizedThreadId])[0]?.values || []).map(mapMessage))
    const { resolvedTurnIdByMessageId, turnIdAliases } = reconcileAssistantUserTurnIds(users, persistedTurns)

    for (const user of users) {
        const resolvedTurnId = resolvedTurnIdByMessageId.get(user.id) || user.turnId || `message:${user.id}`
        const turn = ensureTurn(resolvedTurnId, user.createdAt)
        if (!turn.prompt) turn.prompt = buildReviewMessagePreview(user)
        turn.updatedAt = laterTimestamp(turn.updatedAt, user.updatedAt)
    }

    const responseRows = db.exec(`
        WITH ranked_responses AS (
            SELECT id, role, text, turn_id, streaming, timeline_sequence, created_at, updated_at, provider_item_id, modality,
                ROW_NUMBER() OVER (
                    PARTITION BY turn_id
                    ORDER BY created_at DESC, COALESCE(timeline_sequence, -1) DESC, id DESC
                ) AS response_rank
            FROM assistant_messages
            WHERE thread_id = ? AND role = 'assistant' AND turn_id IS NOT NULL
        )
        SELECT id, role, text, turn_id, streaming, timeline_sequence, created_at, updated_at, provider_item_id, modality
        FROM ranked_responses
        WHERE response_rank = 1
    `, [normalizedThreadId])[0]?.values || []
    const nullTurnResponses = (db.exec(`
        SELECT id, role, text, turn_id, streaming, timeline_sequence, created_at, updated_at, provider_item_id, modality
        FROM assistant_messages
        WHERE thread_id = ? AND role = 'assistant' AND turn_id IS NULL
        ORDER BY created_at ASC, COALESCE(timeline_sequence, -1) ASC, id ASC
    `, [normalizedThreadId])[0]?.values || []).map(mapMessage)
    const resolveTimelineTurnId = (createdAt: string): string | null => {
        for (let index = users.length - 1; index >= 0; index -= 1) {
            const user = users[index]
            if (user && user.createdAt <= createdAt) return resolvedTurnIdByMessageId.get(user.id) || null
        }
        return null
    }

    for (const response of reconcileAssistantMessageReplays([...responseRows.map(mapMessage), ...nullTurnResponses])) {
        const sourceTurnId = resolveAssistantTurnIdAlias(response.turnId, turnIdAliases)
        const sourceTurnAlreadyKnown = Boolean(sourceTurnId && turnsById.has(sourceTurnId))
        const persistedTurn = sourceTurnAlreadyKnown
            ? null
            : findAssistantPersistedTurnAt(persistedTurns, response.createdAt)
        const timelineTurnId = resolveTimelineTurnId(response.createdAt)
        const resolvedTurnId = sourceTurnAlreadyKnown
            ? sourceTurnId
            : sourceTurnId
                ? persistedTurn?.id || timelineTurnId || sourceTurnId
                : timelineTurnId || persistedTurn?.id
        if (!resolvedTurnId) continue
        const turn = ensureTurn(resolvedTurnId, response.createdAt)
        if (!turn.response || turn.response.createdAt <= response.createdAt) {
            turn.response = buildReviewMessagePreview(response)
        }
        turn.updatedAt = laterTimestamp(turn.updatedAt, response.updatedAt)
    }

    const fileActivities = (db.exec(`
        SELECT id, kind, tone, summary, detail, turn_id, timeline_sequence, created_at, ${assistantActivityPayloadColumns()}
        FROM assistant_activities
        WHERE thread_id = ? AND kind = 'file-change'
        ORDER BY created_at ASC, COALESCE(timeline_sequence, -1) ASC, id ASC
    `, [normalizedThreadId])[0]?.values || []).map(mapActivity)
    for (const activity of fileActivities) {
        const sourceTurnId = resolveAssistantTurnIdAlias(activity.turnId, turnIdAliases)
        const sourceTurnAlreadyKnown = Boolean(sourceTurnId && turnsById.has(sourceTurnId))
        const persistedTurn = sourceTurnAlreadyKnown
            ? null
            : findAssistantPersistedTurnAt(persistedTurns, activity.createdAt)
        const timelineTurnId = resolveTimelineTurnId(activity.createdAt)
        const resolvedTurnId = sourceTurnAlreadyKnown
            ? sourceTurnId
            : sourceTurnId
                ? persistedTurn?.id || timelineTurnId || sourceTurnId
                : timelineTurnId || persistedTurn?.id
        if (!resolvedTurnId) continue
        const turn = ensureTurn(resolvedTurnId, activity.createdAt)
        turn.changes.push(...readReviewFileChanges(activity, resolvedTurnId))
        turn.updatedAt = laterTimestamp(turn.updatedAt, activity.createdAt)
    }

    reconcileDuplicateReviewLedgerTurns(turnsById)
    const chronological = [...turnsById.values()]
        .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt) || left.id.localeCompare(right.id))
    const turns = chronological.map((turn, index) => ({
        id: turn.id,
        number: index + 1,
        state: turn.state,
        prompt: turn.prompt,
        response: turn.response,
        agentLabel,
        requestedAt: turn.requestedAt,
        updatedAt: turn.updatedAt,
        changes: turn.changes
    })).reverse()

    return { threadId: normalizedThreadId, totalTurns: turns.length, turns }
}

export function searchAssistantTurns(db: SqlDatabase, threadId: string, query: string, requestedLimit?: number): AssistantSearchTurnsResult {
    const normalized = String(query || '').trim().toLowerCase()
    if (!normalized) return { threadId, turnIds: [] }
    const like = `%${normalized}%`
    const limit = Math.max(1, Math.min(200, Math.floor(requestedLimit || 100)))
    const rows = db.exec(`
        SELECT assistant_turns.id
        FROM assistant_turns
        WHERE assistant_turns.thread_id = ?
          AND (
            LOWER(assistant_turns.id) LIKE ?
            OR EXISTS (
                SELECT 1 FROM assistant_messages
                WHERE assistant_messages.thread_id = assistant_turns.thread_id
                  AND (assistant_messages.turn_id = assistant_turns.id OR (assistant_messages.role = 'user' AND assistant_messages.created_at = assistant_turns.requested_at))
                  AND LOWER(assistant_messages.text) LIKE ?
            )
            OR EXISTS (
                SELECT 1 FROM assistant_activities
                WHERE assistant_activities.thread_id = assistant_turns.thread_id
                  AND assistant_activities.turn_id = assistant_turns.id
                  AND LOWER(
                    COALESCE(assistant_activities.summary, '') || ' '
                    || COALESCE(assistant_activities.detail, '') || ' '
                    || CASE
                        WHEN LENGTH(COALESCE(assistant_activities.payload_json, '')) <= ${ASSISTANT_ACTIVITY_PAYLOAD_MAX_CHARACTERS}
                        THEN COALESCE(assistant_activities.payload_json, '')
                        ELSE ''
                    END
                  ) LIKE ?
            )
        )
        ORDER BY assistant_turns.requested_at DESC, assistant_turns.id DESC
        LIMIT ?
    `, [threadId, like, like, like, limit])[0]?.values || []
    return { threadId, turnIds: rows.map((row) => String(row[0] || '')).filter(Boolean) }
}

export function mergeAssistantSearchTurnIds(
    db: SqlDatabase,
    threadId: string,
    existingTurnIds: string[],
    activityIds: string[],
    requestedLimit?: number
): AssistantSearchTurnsResult {
    if (activityIds.length === 0) return { threadId, turnIds: existingTurnIds }
    const limit = Math.max(1, Math.min(200, Math.floor(requestedLimit || 100)))
    const turnPlaceholders = existingTurnIds.map(() => '?').join(', ')
    const activityPlaceholders = activityIds.map(() => '?').join(', ')
    const existingCandidates = existingTurnIds.length > 0
        ? `UNION SELECT id FROM assistant_turns WHERE thread_id = ? AND id IN (${turnPlaceholders})`
        : ''
    const rows = db.exec(`
        WITH candidates(turn_id) AS (
            SELECT turn_id FROM assistant_activities
            WHERE thread_id = ? AND id IN (${activityPlaceholders}) AND turn_id IS NOT NULL
            ${existingCandidates}
        )
        SELECT turn_id
        FROM candidates
        ORDER BY COALESCE(
            (SELECT requested_at FROM assistant_turns WHERE assistant_turns.id = candidates.turn_id LIMIT 1),
            (SELECT MIN(created_at) FROM assistant_messages WHERE assistant_messages.thread_id = ? AND assistant_messages.turn_id = candidates.turn_id),
            (SELECT MIN(created_at) FROM assistant_activities WHERE assistant_activities.thread_id = ? AND assistant_activities.turn_id = candidates.turn_id),
            ''
        ) DESC, turn_id DESC
        LIMIT ?
    `, [threadId, ...activityIds, ...(existingTurnIds.length > 0 ? [threadId, ...existingTurnIds] : []), threadId, threadId, limit])[0]?.values || []
    return { threadId, turnIds: rows.map((row) => String(row[0] || '')).filter(Boolean) }
}

export function readAssistantTurnDetail(db: SqlDatabase, threadId: string, turnId: string): AssistantTurnDetail {
    const turnRow = db.exec('SELECT requested_at FROM assistant_turns WHERE id = ? AND thread_id = ? LIMIT 1', [turnId, threadId])[0]?.values?.[0]
    const directMessageRows = db.exec(`SELECT id, role, text, turn_id, streaming, timeline_sequence, created_at, updated_at, provider_item_id, modality FROM assistant_messages WHERE thread_id = ? AND turn_id = ? ORDER BY created_at ASC, COALESCE(timeline_sequence, -1) ASC, id ASC`, [threadId, turnId])[0]?.values || []
    const directActivityRows = db.exec(`SELECT id, kind, tone, summary, detail, turn_id, timeline_sequence, created_at, ${assistantActivityPayloadColumns()} FROM assistant_activities WHERE thread_id = ? AND turn_id = ? ORDER BY created_at ASC, COALESCE(timeline_sequence, -1) ASC, id ASC`, [threadId, turnId])[0]?.values || []
    const directPlanRows = db.exec(`SELECT id, turn_id, plan_markdown, timeline_sequence, created_at, updated_at FROM assistant_proposed_plans WHERE thread_id = ? AND turn_id = ? ORDER BY created_at ASC, COALESCE(timeline_sequence, -1) ASC, id ASC`, [threadId, turnId])[0]?.values || []

    if (turnRow || directMessageRows.length > 0 || directActivityRows.length > 0 || directPlanRows.length > 0) {
        const requestedAt = String(turnRow?.[0] || directMessageRows[0]?.[6] || directActivityRows[0]?.[7] || directPlanRows[0]?.[4] || '')
        const messages = directMessageRows.map(mapMessage)
        if (!messages.some((message) => message.role === 'user')) {
            const userRows = db.exec(`
                SELECT id, role, text, turn_id, streaming, timeline_sequence, created_at, updated_at, provider_item_id, modality
                FROM assistant_messages
                WHERE thread_id = ? AND role = 'user'
                ORDER BY created_at ASC, COALESCE(timeline_sequence, -1) ASC, id ASC
            `, [threadId])[0]?.values || []
            const users = reconcileAssistantMessageReplays(userRows.map(mapMessage))
            const persistedTurnRows = db.exec(`
                SELECT id, requested_at
                FROM assistant_turns
                WHERE thread_id = ?
                ORDER BY requested_at ASC, id ASC
            `, [threadId])[0]?.values || []
            const persistedTurns = persistedTurnRows.map((row) => ({ id: String(row[0] || ''), requestedAt: String(row[1] || '') }))
            const reconciliation = reconcileAssistantUserTurnIds(users, persistedTurns)
            const promptIndex = users.findIndex((user) => reconciliation.resolvedTurnIdByMessageId.get(user.id) === turnId)
            if (promptIndex >= 0) {
                const prompt = users[promptIndex]!
                const nextPrompt = users[promptIndex + 1] || null
                const lower = getAssistantTimelineOrderKey('message', prompt)
                const upper = nextPrompt ? getAssistantTimelineOrderKey('message', nextPrompt) : null
                return {
                    threadId,
                    turnId,
                    messages: readMessages(db, threadId, lower, upper),
                    activities: readActivities(db, threadId, lower, upper),
                    proposedPlans: readPlans(db, threadId, lower, upper)
                }
            }
            const promptRow = db.exec(`SELECT id, role, text, turn_id, streaming, timeline_sequence, created_at, updated_at, provider_item_id, modality FROM assistant_messages WHERE thread_id = ? AND role = 'user' AND created_at <= ? ORDER BY created_at DESC, COALESCE(timeline_sequence, -1) DESC, id DESC LIMIT 1`, [threadId, requestedAt])[0]?.values?.[0]
            if (promptRow) messages.unshift(mapMessage(promptRow))
        }
        return {
            threadId,
            turnId,
            messages,
            activities: directActivityRows.map(mapActivity),
            proposedPlans: directPlanRows.map(mapPlan)
        }
    }

    const syntheticMessageId = turnId.startsWith('message:') ? turnId.slice('message:'.length) : ''
    const promptRow = syntheticMessageId
        ? db.exec(`SELECT id, role, text, turn_id, streaming, timeline_sequence, created_at, updated_at, provider_item_id, modality FROM assistant_messages WHERE thread_id = ? AND id = ? AND role = 'user' LIMIT 1`, [threadId, syntheticMessageId])[0]?.values?.[0]
        : null
    if (!promptRow) throw new Error('Assistant turn not found.')
    const prompt = mapMessage(promptRow)
    const lower = getAssistantTimelineOrderKey('message', prompt)
    const nextPromptRow = db.exec(`
        SELECT id, role, text, turn_id, streaming, timeline_sequence, created_at, updated_at, provider_item_id, modality
        FROM assistant_messages
        WHERE thread_id = ? AND role = 'user'
          AND (created_at, COALESCE(timeline_sequence, -1), id) > (?, ?, ?)
        ORDER BY created_at ASC, COALESCE(timeline_sequence, -1) ASC, id ASC
        LIMIT 1
    `, [threadId, prompt.createdAt, normalizeAssistantTimelineSequence(prompt.timelineSequence), prompt.id])[0]?.values?.[0]
    const upper = nextPromptRow ? getAssistantTimelineOrderKey('message', mapMessage(nextPromptRow)) : null
    return {
        threadId,
        turnId,
        messages: readMessages(db, threadId, lower, upper),
        activities: readActivities(db, threadId, lower, upper),
        proposedPlans: readPlans(db, threadId, lower, upper)
    }
}

export function readAssistantThreadDetail(db: SqlDatabase, threadId: string): AssistantThreadDetail {
    const page = readAssistantHistoryPage(db, { threadId, turnLimit: INITIAL_ASSISTANT_HISTORY_TURN_LIMIT })
    const row = db.exec('SELECT active_plan_json FROM assistant_threads WHERE id = ?', [threadId])[0]?.values?.[0]
    return {
        threadId,
        activePlan: parseJson(row?.[0] ?? null, null),
        pendingApprovals: readPendingApprovals(db, threadId),
        pendingUserInputs: readPendingUserInputs(db, threadId),
        history: {
            ...page,
            initialLoading: false,
            loadingOlder: false,
            loadingNewer: false,
            loadOlderError: null,
            loadNewerError: null,
            fullyLoaded: !page.pageInfo.hasOlder && !page.pageInfo.hasNewer
        }
    }
}
