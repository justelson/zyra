import type { Database as SqlDatabase, SqlValue } from 'sql.js/dist/sql-asm.js'
import type {
    AssistantActivity,
    AssistantDomainEvent,
    AssistantLatestTurn,
    AssistantMessage,
    AssistantPendingApproval,
    AssistantPendingUserInput,
    AssistantPlaygroundLab,
    AssistantProposedPlan,
    AssistantSession,
    AssistantSessionTurnUsageEntry,
    AssistantSnapshot,
    AssistantThread
} from '../../shared/assistant/contracts'
import { reconcileAssistantMessageReplays } from '../../shared/assistant/message-reconciliation'
import { sanitizeAssistantProjectPath } from '../../shared/assistant/session-routing'
import { recoverPersistedSnapshot } from './projector'
import {
    type AssistantHydratedThreadData,
    hydrateSnapshotThreads,
    shouldKeepHydratedThread,
    summarizeThread
} from './persistence-snapshot'
import { deriveSessionTitleFromPrompt, isDefaultSessionTitle } from './utils'
import { readAssistantChatScopes } from './assistant-project-persistence'
import {
    type AssistantMetaRow,
    PERSISTENCE_VERSION,
    parseJson,
    runSqlTransaction,
    shouldDeleteInvalidSession,
    toNullableString,
    toNumber
} from './persistence-utils'
import { assistantActivityPayloadColumns, parseAssistantActivityPayload } from './persistence-activity-payload'
import { persistAssistantSnapshotMeta } from './persistence-write'

function readAssistantUserMessageText(db: SqlDatabase, sessionId: string, direction: 'ASC' | 'DESC'): string | null {
    const row = db.exec(`
        SELECT assistant_messages.text
        FROM assistant_messages
        INNER JOIN assistant_threads ON assistant_threads.id = assistant_messages.thread_id
        WHERE assistant_threads.session_id = ? AND assistant_messages.role = 'user'
        ORDER BY assistant_messages.created_at ${direction}, assistant_messages.id ${direction}
        LIMIT 1
    `, [sessionId])[0]?.values?.[0]
    const messageText = String(row?.[0] || '').trim()
    return messageText || null
}

export function readAssistantFirstUserMessageText(db: SqlDatabase, sessionId: string): string | null {
    return readAssistantUserMessageText(db, sessionId, 'ASC')
}

export function readAssistantLatestUserMessageText(db: SqlDatabase, sessionId: string): string | null {
    return readAssistantUserMessageText(db, sessionId, 'DESC')
}

export function readAssistantPersistenceRecord(db: SqlDatabase): { version: number; snapshot: AssistantSnapshot; events: AssistantDomainEvent[] } {
    return {
        version: PERSISTENCE_VERSION,
        snapshot: readAssistantSnapshot(db),
        events: []
    }
}

export function readAssistantSnapshot(db: SqlDatabase): AssistantSnapshot {
    const meta = readAssistantMeta(db)
    const playground = readAssistantPlaygroundState(db)
    pruneOrphanedAssistantThreadRows(db)
    const sessions = removeInvalidSessions(db, readAssistantSessionSummaries(db, playground))
    let selectedSessionId = meta.selectedSessionId

    if (selectedSessionId && !sessions.some((session) => session.id === selectedSessionId)) {
        selectedSessionId = sessions[0]?.id || null
    }

    let snapshot: AssistantSnapshot = {
        snapshotSequence: meta.snapshotSequence,
        updatedAt: meta.updatedAt,
        selectedSessionId,
        playground,
        sessions,
        knownModels: meta.knownModels,
        fleetByThreadId: {}
    }
    snapshot = recoverPersistedSnapshot(snapshot)
    if (selectedSessionId !== meta.selectedSessionId) {
        persistAssistantSnapshotMeta(db, snapshot)
    }
    return snapshot
}

export function readActiveThreadDetails(db: SqlDatabase, sessionId: string, snapshot: AssistantSnapshot): AssistantHydratedThreadData | null {
    const session = snapshot.sessions.find((entry) => entry.id === sessionId)
    const threadId = session?.activeThreadId || session?.threadIds[0] || null
    return threadId ? readThreadDetails(db, threadId) : null
}

export function readHydratedThreadDetails(
    db: SqlDatabase,
    snapshot: AssistantSnapshot,
    focusedSessionId: string | null
): Map<string, AssistantHydratedThreadData> {
    const detailsByThreadId = new Map<string, AssistantHydratedThreadData>()
    const threadIds = new Set<string>()

    for (const session of snapshot.sessions) {
        const shouldHydrateActiveThread = session.id === focusedSessionId
        const activeThreadId = session.activeThreadId || session.threadIds[0] || null
        if (shouldHydrateActiveThread && activeThreadId) {
            threadIds.add(activeThreadId)
        }
        for (const thread of session.threads) {
            if (shouldKeepHydratedThread(thread)) {
                threadIds.add(thread.id)
            }
        }
    }

    for (const threadId of threadIds) {
        const details = readThreadDetails(db, threadId)
        if (details) {
            detailsByThreadId.set(threadId, details)
        }
    }

    return detailsByThreadId
}

export function readAssistantTimelineProjectionRows(
    db: SqlDatabase,
    threadId: string
): Pick<AssistantHydratedThreadData, 'messages' | 'activities'> {
    return {
        messages: readAssistantMessages(db, threadId),
        activities: readAssistantActivities(db, threadId, false)
    }
}

function readAssistantMessages(db: SqlDatabase, threadId: string): AssistantMessage[] {
    return reconcileAssistantMessageReplays(readThreadRows<AssistantMessage>(db, 'assistant_messages', threadId, [
        'id', 'role', 'text', 'turn_id', 'streaming', 'timeline_sequence', 'created_at', 'updated_at', 'provider_item_id', 'modality'
    ], (row) => ({
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
    })))
}

function readAssistantActivities(db: SqlDatabase, threadId: string, includePayload: boolean): AssistantActivity[] {
    const payloadColumns = includePayload ? [assistantActivityPayloadColumns()] : []
    return readThreadRows<AssistantActivity>(db, 'assistant_activities', threadId, [
        'id', 'kind', 'tone', 'summary', 'detail', 'turn_id', 'timeline_sequence', 'created_at', ...payloadColumns
    ], (row) => ({
        id: String(row[0] || ''),
        kind: String(row[1] || ''),
        tone: String(row[2] || 'info') as AssistantActivity['tone'],
        summary: String(row[3] || ''),
        detail: toNullableString(row[4]) || undefined,
        turnId: toNullableString(row[5]),
        timelineSequence: typeof row[6] === 'number' ? row[6] : undefined,
        createdAt: String(row[7] || new Date(0).toISOString()),
        ...(includePayload ? { payload: parseAssistantActivityPayload(row[8], row[9]) } : {})
    }))
}

function readThreadDetails(db: SqlDatabase, threadId: string): AssistantHydratedThreadData | null {
    if (!threadId) return null

    const activePlanRow = db.exec('SELECT active_plan_json FROM assistant_threads WHERE id = ?', [threadId])[0]?.values?.[0] || null
    return {
        activePlan: parseJson(activePlanRow?.[0] ?? null, null),
        messages: readAssistantMessages(db, threadId),
        proposedPlans: readThreadRows<AssistantProposedPlan>(db, 'assistant_proposed_plans', threadId, [
            'id', 'turn_id', 'plan_markdown', 'timeline_sequence', 'created_at', 'updated_at'
        ], (row) => ({
            id: String(row[0] || ''),
            turnId: toNullableString(row[1]),
            planMarkdown: String(row[2] || ''),
            timelineSequence: typeof row[3] === 'number' ? row[3] : undefined,
            createdAt: String(row[4] || new Date(0).toISOString()),
            updatedAt: String(row[5] || new Date(0).toISOString())
        })),
        activities: readAssistantActivities(db, threadId, true),
        pendingApprovals: readThreadRows<AssistantPendingApproval>(db, 'assistant_pending_approvals', threadId, [
            'id', 'request_id', 'request_type', 'title', 'detail', 'command', 'paths_json', 'status', 'decision', 'turn_id', 'created_at', 'resolved_at'
        ], (row) => ({
            id: String(row[0] || ''),
            requestId: String(row[1] || ''),
            requestType: String(row[2] || 'command') as AssistantPendingApproval['requestType'],
            title: toNullableString(row[3]) || undefined,
            detail: toNullableString(row[4]) || undefined,
            command: toNullableString(row[5]) || undefined,
            paths: parseJson<string[] | undefined>(row[6], undefined),
            status: String(row[7] || 'pending') as AssistantPendingApproval['status'],
            decision: toNullableString(row[8]) as AssistantPendingApproval['decision'],
            turnId: toNullableString(row[9]),
            createdAt: String(row[10] || new Date(0).toISOString()),
            resolvedAt: toNullableString(row[11])
        })),
        pendingUserInputs: readThreadRows<AssistantPendingUserInput>(db, 'assistant_pending_user_inputs', threadId, [
            'id', 'request_id', 'questions_json', 'status', 'answers_json', 'response_message_id', 'turn_id', 'created_at', 'resolved_at'
        ], (row) => ({
            id: String(row[0] || ''),
            requestId: String(row[1] || ''),
            questions: parseJson(row[2], []),
            status: String(row[3] || 'pending') as AssistantPendingUserInput['status'],
            answers: parseJson<Record<string, string | string[]> | null>(row[4], null),
            responseMessageId: toNullableString(row[5]),
            turnId: toNullableString(row[6]),
            createdAt: String(row[7] || new Date(0).toISOString()),
            resolvedAt: toNullableString(row[8])
        }))
    }
}

export function readAssistantSessionTurnUsage(db: SqlDatabase, sessionId: string): AssistantSessionTurnUsageEntry[] {
    const rows = db.exec(`
        SELECT
            assistant_turns.id,
            assistant_threads.session_id,
            assistant_turns.thread_id,
            assistant_turns.model,
            assistant_turns.state,
            assistant_turns.requested_at,
            assistant_turns.started_at,
            assistant_turns.completed_at,
            assistant_turns.assistant_message_id,
            assistant_turns.effort,
            assistant_turns.service_tier,
            assistant_turns.usage_json,
            assistant_turns.updated_at
        FROM assistant_turns
        INNER JOIN assistant_threads ON assistant_threads.id = assistant_turns.thread_id
        WHERE assistant_threads.session_id = ?
        ORDER BY assistant_turns.requested_at ASC, assistant_turns.id ASC
    `, [sessionId])[0]?.values || []

    return rows.map((row) => ({
        id: String(row[0] || ''),
        sessionId: String(row[1] || ''),
        threadId: String(row[2] || ''),
        model: String(row[3] || ''),
        state: String(row[4] || 'running') as AssistantLatestTurn['state'],
        requestedAt: String(row[5] || new Date(0).toISOString()),
        startedAt: toNullableString(row[6]),
        completedAt: toNullableString(row[7]),
        assistantMessageId: toNullableString(row[8]),
        effort: toNullableString(row[9]) as AssistantLatestTurn['effort'],
        serviceTier: toNullableString(row[10]) as AssistantLatestTurn['serviceTier'],
        usage: parseJson(row[11], null),
        updatedAt: String(row[12] || new Date(0).toISOString())
    }))
}

function readAssistantMeta(db: SqlDatabase): AssistantMetaRow {
    const rows = db.exec('SELECT key, value FROM assistant_meta')
    const values = new Map<string, string>()
    for (const row of rows[0]?.values || []) {
        const key = typeof row[0] === 'string' ? row[0] : ''
        const value = typeof row[1] === 'string' ? row[1] : ''
        if (key) values.set(key, value)
    }
    return {
        snapshotSequence: Number(values.get('snapshotSequence') || '0') || 0,
        updatedAt: values.get('updatedAt') || new Date(0).toISOString(),
        selectedSessionId: values.get('selectedSessionId') || null,
        playgroundRootPath: values.get('playgroundRootPath') || null,
        knownModels: parseJson(values.get('knownModels') || '', [])
    }
}

function readAssistantSessionSummaries(db: SqlDatabase, playground: AssistantSnapshot['playground']): AssistantSession[] {
    const sessions = new Map<string, AssistantSession>()
    const chatScopes = readAssistantChatScopes(db)
    const sessionRoutePatches: Array<{
        sessionId: string
        mode: AssistantSession['mode']
        projectPath: string | null
        playgroundLabId: string | null
        pendingLabRequest: null
    }> = []
    const threadCwdPatches: Array<{ threadId: string; cwd: string | null }> = []
    const threadMessageCountPatches: Array<{ threadId: string; messageCount: number }> = []
    const sessionRows = db.exec(`
        SELECT id, title, mode, project_path, playground_lab_id, pending_lab_request_json, archived, created_at, updated_at, active_thread_id
        FROM assistant_sessions
        ORDER BY updated_at DESC, id DESC
    `)[0]?.values || []

    for (const row of sessionRows) {
        const sessionId = String(row[0] || '')
        const chatScope = chatScopes.get(sessionId) || null
        const session: AssistantSession = {
            id: sessionId,
            title: String(row[1] || 'New Session'),
            mode: String(row[2] || 'work') === 'playground' ? 'playground' : 'work',
            projectPath: toNullableString(row[3]),
            projectId: chatScope?.projectId || null,
            workingRoot: chatScope?.workingRoot || toNullableString(row[3]),
            chatScope,
            playgroundLabId: toNullableString(row[4]),
            pendingLabRequest: parseJson(row[5], null),
            archived: toNumber(row[6]) === 1,
            createdAt: String(row[7] || new Date(0).toISOString()),
            updatedAt: String(row[8] || new Date(0).toISOString()),
            activeThreadId: toNullableString(row[9]),
            threadIds: [],
            threads: []
        }
        sessions.set(session.id, session)
    }

    const firstUserMessageTextBySessionId = new Map<string, string>()
    const firstUserMessageRows = db.exec(`
        SELECT assistant_threads.session_id, assistant_messages.text
        FROM assistant_messages
        INNER JOIN assistant_threads ON assistant_threads.id = assistant_messages.thread_id
        WHERE assistant_messages.role = 'user'
        ORDER BY assistant_threads.session_id ASC, assistant_messages.created_at ASC, assistant_messages.id ASC
    `)[0]?.values || []

    for (const row of firstUserMessageRows) {
        const sessionId = String(row[0] || '')
        if (!sessionId || firstUserMessageTextBySessionId.has(sessionId)) continue
        const messageText = String(row[1] || '').trim()
        if (!messageText) continue
        firstUserMessageTextBySessionId.set(sessionId, messageText)
    }

    const readCountMap = (table: string, where = '') => {
        const counts = new Map<string, number>()
        const rows = db.exec(`SELECT thread_id, COUNT(*) FROM ${table}${where} GROUP BY thread_id`)[0]?.values || []
        for (const row of rows) {
            const threadId = String(row[0] || '')
            if (threadId) counts.set(threadId, toNumber(row[1]))
        }
        return counts
    }
    const messageCountByThreadId = readCountMap('assistant_messages')
    const activityCountByThreadId = readCountMap('assistant_activities')
    const proposedPlanCountByThreadId = readCountMap('assistant_proposed_plans')
    const pendingApprovalCountByThreadId = readCountMap('assistant_pending_approvals', ` WHERE status = 'pending'`)
    const pendingUserInputCountByThreadId = readCountMap('assistant_pending_user_inputs', ` WHERE status = 'pending'`)

    const threadRows = db.exec(`
        SELECT
            id,
            session_id,
            provider_thread_id,
            source,
            parent_thread_id,
            provider_parent_thread_id,
            subagent_depth,
            agent_nickname,
            agent_role,
            model,
            thinking,
            profile,
            cwd,
            message_count,
            last_seen_completed_turn_id,
            runtime_mode,
            interaction_mode,
            web_search,
            web_fetch,
            state,
            canonical_presence_json,
            last_error,
            created_at,
            updated_at,
            latest_turn_json,
            active_plan_json,
            canonical_history_modified_at,
            canonical_history_entry_count
        FROM assistant_threads
        ORDER BY session_id ASC, updated_at DESC, id DESC
    `)[0]?.values || []

    for (const row of threadRows) {
        const threadId = String(row[0] || '')
        const sessionId = String(row[1] || '')
        const session = sessions.get(sessionId)
        if (!session) continue
        const persistedMessageCount = toNumber(row[13])
        const messageCount = messageCountByThreadId.get(threadId) ?? 0
        const thread: AssistantThread = summarizeThread({
            id: threadId,
            providerThreadId: toNullableString(row[2]),
            source: String(row[3] || 'root') as AssistantThread['source'],
            parentThreadId: toNullableString(row[4]),
            providerParentThreadId: toNullableString(row[5]),
            subagentDepth: typeof row[6] === 'number' && Number.isFinite(row[6]) ? row[6] : null,
            agentNickname: toNullableString(row[7]),
            agentRole: toNullableString(row[8]),
            model: String(row[9] || ''),
            thinking: toNullableString(row[10]) as AssistantThread['thinking'],
            profile: toNullableString(row[11]),
            cwd: toNullableString(row[12]),
            messageCount,
            activityCount: activityCountByThreadId.get(threadId) ?? 0,
            proposedPlanCount: proposedPlanCountByThreadId.get(threadId) ?? 0,
            lastSeenCompletedTurnId: toNullableString(row[14]),
            runtimeMode: String(row[15] || 'approval-required') as AssistantThread['runtimeMode'],
            interactionMode: 'default',
            webSearch: typeof row[17] === 'number' ? row[17] === 1 : null,
            webFetch: typeof row[18] === 'number' ? row[18] === 1 : null,
            state: String(row[19] || 'idle') as AssistantThread['state'],
            canonicalHistoryModifiedAt: toNullableString(row[26]),
            canonicalHistoryEntryCount: typeof row[27] === 'number' ? row[27] : null,
            canonicalPresence: parseJson(row[20], undefined),
            lastError: toNullableString(row[21]),
            createdAt: String(row[22] || new Date(0).toISOString()),
            updatedAt: String(row[23] || new Date(0).toISOString()),
            latestTurn: parseJson(row[24], null),
            hasPendingApprovals: (pendingApprovalCountByThreadId.get(threadId) ?? 0) > 0,
            hasPendingUserInputs: (pendingUserInputCountByThreadId.get(threadId) ?? 0) > 0,
            hasActivePlan: Boolean(parseJson(row[25], null)),
            activePlan: null,
            messages: [],
            proposedPlans: [],
            activities: [],
            pendingApprovals: [],
            pendingUserInputs: []
        })
        session.threads.push(thread)
        session.threadIds.push(thread.id)
        if (messageCount !== persistedMessageCount) {
            threadMessageCountPatches.push({ threadId: thread.id, messageCount })
        }
    }

    for (const session of sessions.values()) {
        const originalMode = session.mode
        const originalProjectPath = session.projectPath
        const originalPlaygroundLabId = session.playgroundLabId
        const originalPendingLabRequest = session.pendingLabRequest
        const sanitizedProjectPath = sanitizeAssistantProjectPath(session.projectPath)
        const firstUserMessageText = firstUserMessageTextBySessionId.get(session.id) || ''

        session.mode = 'work'
        session.projectPath = sanitizedProjectPath
        session.playgroundLabId = null
        session.pendingLabRequest = null
        for (const thread of session.threads) {
            if (!isLegacyPlaygroundThreadCwd(thread.cwd)) continue
            const nextCwd = sanitizedProjectPath || null
            if (thread.cwd === nextCwd) continue
            thread.cwd = nextCwd
            threadCwdPatches.push({ threadId: thread.id, cwd: nextCwd })
        }

        if (
            session.mode !== originalMode
            || session.projectPath !== originalProjectPath
            || session.playgroundLabId !== originalPlaygroundLabId
            || originalPendingLabRequest !== null
        ) {
            sessionRoutePatches.push({
                sessionId: session.id,
                mode: session.mode,
                projectPath: session.projectPath,
                playgroundLabId: session.playgroundLabId,
                pendingLabRequest: null
            })
        }

        if (!firstUserMessageText) continue
        if (!isDefaultSessionTitle(session.title)) continue

        session.title = deriveSessionTitleFromPrompt(firstUserMessageText)
    }

    if (sessionRoutePatches.length > 0) {
        runSqlTransaction(db, () => {
            for (const patch of sessionRoutePatches) {
                db.run(`
                    UPDATE assistant_sessions
                    SET mode = ?, project_path = ?, playground_lab_id = ?, pending_lab_request_json = ?
                    WHERE id = ?
                `, [patch.mode, patch.projectPath, patch.playgroundLabId, patch.pendingLabRequest, patch.sessionId])
            }
        })
    }
    if (threadCwdPatches.length > 0) {
        runSqlTransaction(db, () => {
            for (const patch of threadCwdPatches) {
                db.run('UPDATE assistant_threads SET cwd = ? WHERE id = ?', [patch.cwd, patch.threadId])
            }
        })
    }
    if (threadMessageCountPatches.length > 0) {
        runSqlTransaction(db, () => {
            for (const patch of threadMessageCountPatches) {
                db.run('UPDATE assistant_threads SET message_count = ? WHERE id = ?', [patch.messageCount, patch.threadId])
            }
        })
    }

    return [...sessions.values()]
}

function isLegacyPlaygroundThreadCwd(value?: string | null): boolean {
    const normalized = String(value || '').trim().replace(/[\\/]+$/, '')
    return /[\\/]assistant[\\/]playground-chat-only$/i.test(normalized)
}

function pruneOrphanedAssistantThreadRows(db: SqlDatabase): void {
    const childTables = [
        'assistant_turns',
        'assistant_messages',
        'assistant_activities',
        'assistant_proposed_plans',
        'assistant_pending_approvals',
        'assistant_pending_user_inputs'
    ]
    runSqlTransaction(db, () => {
        for (const table of childTables) {
            db.run(`DELETE FROM ${table} WHERE thread_id NOT IN (SELECT id FROM assistant_threads)`)
        }
        db.run('DELETE FROM assistant_threads WHERE session_id NOT IN (SELECT id FROM assistant_sessions)')
        for (const table of childTables) {
            db.run(`DELETE FROM ${table} WHERE thread_id NOT IN (SELECT id FROM assistant_threads)`)
        }
    })
}

function readAssistantPlaygroundState(db: SqlDatabase): AssistantSnapshot['playground'] {
    const rootPath = readAssistantMeta(db).playgroundRootPath
    const labRows = db.exec(`
        SELECT id, title, root_path, source, repo_url, created_at, updated_at
        FROM assistant_playground_labs
        ORDER BY updated_at DESC, id DESC
    `)[0]?.values || []

    const labs: AssistantPlaygroundLab[] = labRows.map((row) => ({
        id: String(row[0] || ''),
        title: String(row[1] || 'Lab'),
        rootPath: String(row[2] || ''),
        source: String(row[3] || 'empty') as AssistantPlaygroundLab['source'],
        repoUrl: toNullableString(row[4]),
        createdAt: String(row[5] || new Date(0).toISOString()),
        updatedAt: String(row[6] || new Date(0).toISOString())
    }))

    return {
        rootPath,
        labs
    }
}

function removeInvalidSessions(db: SqlDatabase, sessions: AssistantSession[]): AssistantSession[] {
    const invalidSessionIds = sessions.filter(shouldDeleteInvalidSession).map((session) => session.id)
    if (invalidSessionIds.length === 0) return sessions

    runSqlTransaction(db, () => {
        for (const sessionId of invalidSessionIds) {
            db.run('DELETE FROM assistant_sessions WHERE id = ?', [sessionId])
        }
    })

    return sessions.filter((session) => !invalidSessionIds.includes(session.id))
}

function readThreadRows<T>(db: SqlDatabase, tableName: string, threadId: string, columns: string[], mapRow: (row: SqlValue[]) => T): T[] {
    const result = db.exec(`
        SELECT ${columns.join(', ')}
        FROM ${tableName}
        WHERE thread_id = ?
        ORDER BY created_at ASC, id ASC
    `, [threadId])[0]?.values || []
    return result.map((row) => mapRow(row))
}
