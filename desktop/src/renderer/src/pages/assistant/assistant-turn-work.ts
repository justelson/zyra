import type { AssistantActivity, AssistantMessage, AssistantSessionTurnUsageEntry } from '@shared/assistant/contracts'
import { normalizeAssistantMessageReferenceId } from '@shared/assistant/message-identity'
import {
    getActivityRenderGroupKind,
    getContextCompactionStatus,
    isContextCompactionActivity,
    isModelNoticeActivity,
    type TimelineDisplayRow,
    type TimelineRenderRow,
    type TimelineTurnWorkSummaryRow
} from './assistant-timeline-helpers'

function isVoiceConversationMessage(message: AssistantMessage): boolean {
    return message.modality === 'voice'
        || message.id.startsWith('voice_')
        || message.id.startsWith('voice-live-')
}

function getRowTurnId(row: TimelineRenderRow): string | null {
    if (row.kind === 'message') return row.message.turnId
    if (row.kind === 'plan') return row.plan.turnId
    if (row.kind === 'activity') return row.activity.turnId
    if (row.kind === 'user-input') return row.input.turnId
    if (
        row.kind === 'activity-group'
        || row.kind === 'thought-group'
        || row.kind === 'command-checkpoint-group'
        || row.kind === 'work-trace-group'
    ) return row.activities[0]?.turnId || null
    return null
}

function getActionRowActivities(row: TimelineRenderRow): AssistantActivity[] | null {
    const isAction = (activity: AssistantActivity) => {
        const kind = getActivityRenderGroupKind(activity)
        return kind === 'tool' || kind === 'subagent'
    }
    if (row.kind === 'activity') return isAction(row.activity) ? [row.activity] : null
    if (row.kind === 'activity-group' && row.activities.length > 0 && row.activities.every(isAction)) {
        return row.activities
    }
    return null
}

function groupConsecutiveActionRows(rows: TimelineRenderRow[]): TimelineRenderRow[] {
    const groupedRows: TimelineRenderRow[] = []
    for (const row of rows) {
        const activities = getActionRowActivities(row)
        const previous = groupedRows[groupedRows.length - 1]
        const previousActivities = previous ? getActionRowActivities(previous) : null
        if (!activities || !previous || !previousActivities) {
            groupedRows.push(row)
            continue
        }
        groupedRows[groupedRows.length - 1] = {
            kind: 'activity-group',
            id: previous.id,
            createdAt: previousActivities[0]?.createdAt || activities[0]?.createdAt || '',
            activities: [...previousActivities, ...activities]
        }
    }
    return groupedRows
}

type ProjectedTerminalOutcome = 'interrupted' | 'failed'

function getProjectedActivityTerminalOutcome(activity: AssistantActivity): ProjectedTerminalOutcome | null {
    return activity.turnTerminalOutcome === 'failed' || activity.turnTerminalOutcome === 'interrupted'
        ? activity.turnTerminalOutcome
        : null
}

function getRowActivities(row: TimelineRenderRow): AssistantActivity[] {
    if (row.kind === 'activity') return [row.activity]
    return 'activities' in row ? row.activities : []
}

function getProjectedTerminalOutcomeFromRows(rows: TimelineRenderRow[]): ProjectedTerminalOutcome | null {
    let outcome: ProjectedTerminalOutcome | null = null
    for (const row of rows) {
        for (const activity of getRowActivities(row)) {
            outcome = getProjectedActivityTerminalOutcome(activity) || outcome
        }
    }
    return outcome
}

function withoutProjectedInterruption(row: TimelineRenderRow): TimelineRenderRow | null {
    if (row.kind === 'activity') {
        return getProjectedActivityTerminalOutcome(row.activity) === 'interrupted' ? null : row
    }
    if (row.kind !== 'activity-group') return row
    const activities = row.activities.filter((activity) => getProjectedActivityTerminalOutcome(activity) !== 'interrupted')
    if (activities.length === row.activities.length) return row
    if (activities.length === 0) return null
    return {
        ...row,
        id: activities[0]!.id,
        createdAt: activities[0]!.createdAt,
        activities
    }
}

function stripProjectedInterruptions(rows: TimelineRenderRow[]): TimelineRenderRow[] {
    return rows.map(withoutProjectedInterruption).filter((row): row is TimelineRenderRow => Boolean(row))
}

function buildProjectedTerminalOutcomeByTurn(rows: TimelineRenderRow[]): Map<string, ProjectedTerminalOutcome> {
    const outcomes = new Map<string, ProjectedTerminalOutcome>()
    for (const row of rows) {
        const turnId = getRowTurnId(row)
        if (!turnId) continue
        for (const activity of getRowActivities(row)) {
            const outcome = getProjectedActivityTerminalOutcome(activity)
            if (outcome) outcomes.set(turnId, outcome)
        }
    }
    return outcomes
}

function rowMustStayVisible(row: TimelineRenderRow): boolean {
    if (row.kind === 'working' || row.kind === 'user-input') return true
    if (row.kind === 'activity') return isModelNoticeActivity(row.activity)
    if (row.kind === 'activity-group') {
        return row.activities.some(isModelNoticeActivity)
    }
    return false
}

function getRowCompletedAt(row: TimelineRenderRow): string {
    if (row.kind === 'message') return row.message.updatedAt || row.createdAt
    if (row.kind === 'plan') return row.plan.updatedAt || row.createdAt
    if (row.kind === 'activity') {
        return typeof row.activity.payload?.completedAt === 'string'
            ? row.activity.payload.completedAt
            : row.createdAt
    }
    if ('activities' in row) {
        return row.activities.reduce((latest, activity) => (
            activity.createdAt.localeCompare(latest) > 0 ? activity.createdAt : latest
        ), row.createdAt)
    }
    return row.createdAt || ''
}

function inferLegacyUserTurnId(
    userMessage: AssistantMessage,
    boundaryRows: TimelineRenderRow[],
    turnUsageById: ReadonlyMap<string, AssistantSessionTurnUsageEntry> | undefined
): string | null {
    if (userMessage.turnId) return userMessage.turnId

    const boundaryTurnIds = new Set(boundaryRows.map(getRowTurnId).filter((value): value is string => Boolean(value)))
    const exactUsageMatches = [...(turnUsageById?.values() || [])].filter((usage) => (
        usage.requestedAt === userMessage.createdAt
    ))
    const exactBoundaryMatch = exactUsageMatches.find((usage) => boundaryTurnIds.has(usage.id))
    if (exactBoundaryMatch) return exactBoundaryMatch.id
    if (exactUsageMatches.length === 1) return exactUsageMatches[0]?.id || null

    return boundaryRows.map(getRowTurnId).find((turnId) => turnId && turnUsageById?.has(turnId)) || null
}

function buildAssistantMessageIndexes(messages: AssistantMessage[]): {
    byId: Map<string, AssistantMessage>
    resolvedAssistantIdByReference: Map<string, string>
} {
    const byId = new Map<string, AssistantMessage>()
    const resolvedAssistantIdByReference = new Map<string, string>()
    for (const message of messages) {
        byId.set(message.id, message)
        if (message.role !== 'assistant') continue
        resolvedAssistantIdByReference.set(message.id, message.id)
        const normalizedId = normalizeAssistantMessageReferenceId(message.id)
        if (normalizedId) resolvedAssistantIdByReference.set(normalizedId, message.id)
        if (message.providerItemId) {
            resolvedAssistantIdByReference.set(message.providerItemId, message.id)
            const normalizedProviderId = normalizeAssistantMessageReferenceId(message.providerItemId)
            if (normalizedProviderId) resolvedAssistantIdByReference.set(normalizedProviderId, message.id)
        }
    }
    return { byId, resolvedAssistantIdByReference }
}

function resolveIndexedAssistantMessageId(
    index: ReadonlyMap<string, string>,
    reference: string | null | undefined
): string | null {
    const raw = String(reference || '').trim()
    if (!raw) return null
    return index.get(raw) || index.get(normalizeAssistantMessageReferenceId(raw) || '') || null
}

function getFinalAssistantIdByTurn(
    messages: AssistantMessage[],
    turnUsageById: ReadonlyMap<string, AssistantSessionTurnUsageEntry> | undefined,
    latestAssistantMessageId: string | null,
    messageById: ReadonlyMap<string, AssistantMessage>,
    resolvedAssistantIdByReference: ReadonlyMap<string, string>
): Map<string, string> {
    const finalByTurn = new Map<string, string>()
    for (const message of messages) {
        if (message.role === 'assistant' && message.turnId) finalByTurn.set(message.turnId, message.id)
    }
    for (const [turnId, usage] of turnUsageById || []) {
        const resolvedMessageId = resolveIndexedAssistantMessageId(resolvedAssistantIdByReference, usage.assistantMessageId)
        if (!resolvedMessageId) continue
        const resolvedMessage = messageById.get(resolvedMessageId)
        finalByTurn.set(turnId, resolvedMessageId)
        if (resolvedMessage?.turnId) finalByTurn.set(resolvedMessage.turnId, resolvedMessageId)
    }
    const resolvedLatestMessageId = resolveIndexedAssistantMessageId(resolvedAssistantIdByReference, latestAssistantMessageId)
    if (resolvedLatestMessageId) {
        const latest = messageById.get(resolvedLatestMessageId)
        if (latest?.turnId) finalByTurn.set(latest.turnId, resolvedLatestMessageId)
    }
    return finalByTurn
}

export function groupTimelineRowsIntoWorkSummaries(input: {
    rows: TimelineRenderRow[]
    messages: AssistantMessage[]
    turnUsageById?: ReadonlyMap<string, AssistantSessionTurnUsageEntry>
    latestAssistantMessageId: string | null
    latestTurnStartedAt: string | null
    isWorking: boolean
}): TimelineDisplayRow[] {
    const {
        rows,
        messages,
        turnUsageById,
        latestAssistantMessageId,
        latestTurnStartedAt,
        isWorking
    } = input
    const { byId: messageById, resolvedAssistantIdByReference } = buildAssistantMessageIndexes(messages)
    const resolvedLatestAssistantMessageId = resolveIndexedAssistantMessageId(resolvedAssistantIdByReference, latestAssistantMessageId)
    const finalByTurn = getFinalAssistantIdByTurn(
        messages,
        turnUsageById,
        latestAssistantMessageId,
        messageById,
        resolvedAssistantIdByReference
    )
    const projectedTerminalOutcomeByTurn = buildProjectedTerminalOutcomeByTurn(rows)
    const messageRowIndexById = new Map<string, number>()
    const previousUserIndexByRow = new Int32Array(rows.length)
    const nextUserIndexByRow = new Int32Array(rows.length)
    let previousUserIndex = -1
    for (let index = 0; index < rows.length; index += 1) {
        previousUserIndexByRow[index] = previousUserIndex
        const row = rows[index]
        if (row.kind === 'message') {
            messageRowIndexById.set(row.message.id, index)
            if (row.message.role === 'user') previousUserIndex = index
        }
    }
    let nextUserIndex = rows.length
    for (let index = rows.length - 1; index >= 0; index -= 1) {
        nextUserIndexByRow[index] = nextUserIndex
        const row = rows[index]
        if (row.kind === 'message' && row.message.role === 'user') nextUserIndex = index
    }
    const runningTurnId = [...(turnUsageById?.entries() || [])]
        .reverse()
        .find(([, usage]) => usage.state === 'running')?.[0] || null
    let latestUserIndex = -1
    for (let index = rows.length - 1; index >= 0; index -= 1) {
        const row = rows[index]
        if (row.kind === 'message' && row.message.role === 'user') {
            latestUserIndex = index
            break
        }
    }
    const latestUserRow = latestUserIndex >= 0 ? rows[latestUserIndex] : undefined
    const latestUserTurnId = latestUserRow?.kind === 'message'
        ? latestUserRow.message.turnId
        : null
    let latestBoundaryTurnId: string | null = null
    for (let index = rows.length - 1; index > latestUserIndex; index -= 1) {
        const turnId = getRowTurnId(rows[index])
        if (turnId) {
            latestBoundaryTurnId = turnId
            break
        }
    }
    const activeTurnId = isWorking
        ? latestUserIndex >= 0
            ? latestUserTurnId || latestBoundaryTurnId
            : latestBoundaryTurnId || runningTurnId
        : null
    const latestAssistantIndex = resolvedLatestAssistantMessageId
        ? messageRowIndexById.get(resolvedLatestAssistantMessageId) ?? -1
        : -1
    const activeFinalMessageId = activeTurnId
        ? finalByTurn.get(activeTurnId)
            || (latestAssistantIndex > latestUserIndex ? resolvedLatestAssistantMessageId : null)
        : null
    const activeFinalRowIndex = activeFinalMessageId ? messageRowIndexById.get(activeFinalMessageId) ?? -1 : -1
    const activeFinalRow = activeFinalRowIndex >= 0 ? rows[activeFinalRowIndex] : null
    const settledFinalIndex = activeFinalRow?.kind === 'message'
        && !activeFinalRow.message.streaming
        && Boolean(activeFinalRow.message.text.trim())
        ? activeFinalRowIndex
        : -1
    let terminalResponseVisible = false
    if (settledFinalIndex >= 0) {
        for (let index = settledFinalIndex + 1; index < rows.length; index += 1) {
            const row = rows[index]
            if (
                row.kind === 'activity'
                && isContextCompactionActivity(row.activity)
                && getContextCompactionStatus(row.activity) === 'running'
                && (!row.activity.turnId || row.activity.turnId === activeTurnId)
            ) {
                terminalResponseVisible = true
                break
            }
        }
    }
    const ranges = new Map<number, { endIndex: number; summary: TimelineTurnWorkSummaryRow; visibleRows?: TimelineRenderRow[] }>()
    let activeRange: {
        startIndex: number
        endIndex: number
        summary: TimelineTurnWorkSummaryRow
        visibleRows: TimelineRenderRow[]
    } | null = null

    if (isWorking) {
        let userIndex = -1
        for (let index = rows.length - 1; index >= 0; index -= 1) {
            const candidate = rows[index]
            if (
                candidate.kind === 'message'
                && candidate.message.role === 'user'
                && (!activeTurnId || candidate.message.turnId === activeTurnId || !candidate.message.turnId)
            ) {
                userIndex = index
                break
            }
        }

        const activeUserRow = userIndex >= 0 ? rows[userIndex] : null
        const activeUserMessage = activeUserRow?.kind === 'message'
            ? activeUserRow.message
            : null
        if (userIndex >= 0 && activeUserMessage && !isVoiceConversationMessage(activeUserMessage)) {
            const nextBoundaryIndex = nextUserIndexByRow[userIndex] ?? rows.length
            const endIndex = nextBoundaryIndex < rows.length ? nextBoundaryIndex - 1 : rows.length - 1

            const activeEndIndex = terminalResponseVisible
                ? Math.min(endIndex, settledFinalIndex - 1)
                : endIndex
            const activeRows = rows.slice(userIndex + 1, activeEndIndex + 1)
            const projectedTerminalOutcome = getProjectedTerminalOutcomeFromRows(activeRows)
            if (!projectedTerminalOutcome) {
                const workRows = activeRows.filter((row) => (
                    row.kind !== 'working'
                    && !rowMustStayVisible(row)
                ))
                const groupedWorkRows = groupConsecutiveActionRows(workRows)
                const visibleRows = activeRows.filter((row) => (
                    row.kind !== 'working'
                    && rowMustStayVisible(row)
                ))
                const startedAt = activeTurnId
                    ? turnUsageById?.get(activeTurnId)?.startedAt || turnUsageById?.get(activeTurnId)?.requestedAt
                    : null

                activeRange = activeEndIndex >= userIndex + 1 && workRows.length > 0 ? {
                    startIndex: userIndex + 1,
                    endIndex: activeEndIndex,
                    summary: {
                        kind: 'turn-work-summary',
                        id: `turn-work-summary-${rows[userIndex]?.id || activeTurnId || 'active'}`,
                        createdAt: workRows[0]?.createdAt || rows[userIndex]?.createdAt || latestTurnStartedAt || '',
                        turnId: activeTurnId,
                        startedAt: startedAt || latestTurnStartedAt || rows[userIndex]?.createdAt || '',
                        completedAt: null,
                        running: true,
                        terminalResponseVisible,
                        outcome: null,
                        rows: groupedWorkRows,
                        liveNarrationRow: null
                    },
                    visibleRows
                } : null
            }
        }
    }

    for (let finalIndex = 0; finalIndex < rows.length; finalIndex += 1) {
        const finalRow = rows[finalIndex]
        if (finalRow.kind !== 'message' || finalRow.message.role !== 'assistant' || !finalRow.message.turnId) continue
        const turnId = finalRow.message.turnId
        if (finalByTurn.get(turnId) !== finalRow.message.id) continue

        // The optimistic local turn id can differ from the provider turn id until
        // canonical reconciliation. The nearest user boundary still owns this response.
        const userIndex = previousUserIndexByRow[finalIndex] ?? -1
        if (userIndex < 0 || finalIndex - userIndex <= 1) continue
        const boundaryEndIndex = nextUserIndexByRow[userIndex] ?? rows.length
        const boundaryRows = rows.slice(userIndex + 1, boundaryEndIndex)
        if (boundaryRows.some((row) => row.kind === 'user-input')) continue
        const usage = turnUsageById?.get(turnId)
        const projectedTerminalOutcome = usage?.state === 'completed'
            ? null
            : projectedTerminalOutcomeByTurn.get(turnId)
                || getProjectedTerminalOutcomeFromRows(boundaryRows)
                || null
        const isLatestFinal = finalRow.message.id === resolvedLatestAssistantMessageId
        const turnCompleted = usage?.state === 'completed'
        const safeHistoricalFallback = turnId !== activeTurnId
            && !finalRow.message.streaming
            && usage?.state !== 'error'
            && usage?.state !== 'interrupted'
            && !projectedTerminalOutcome
        if (!isLatestFinal && !turnCompleted && !safeHistoricalFallback) continue
        if (usage?.state === 'error' || usage?.state === 'interrupted' || projectedTerminalOutcome) continue
        const matchedUserRow = rows[userIndex]
        const userMessage = matchedUserRow?.kind === 'message' ? matchedUserRow.message : null
        if (userMessage && isVoiceConversationMessage(userMessage)) continue

        const workRows = rows.slice(userIndex + 1, finalIndex)
        if (workRows.length === 0 || workRows.some(rowMustStayVisible)) continue
        const groupedWorkRows = groupConsecutiveActionRows(workRows)

        const startedAt = usage?.startedAt
            || usage?.requestedAt
            || (isLatestFinal ? latestTurnStartedAt : null)
            || rows[userIndex]?.createdAt
            || workRows[0]?.createdAt
            || finalRow.createdAt
        const completedAt = finalRow.message.streaming
            ? finalRow.message.createdAt
            : usage?.completedAt || finalRow.message.updatedAt || finalRow.message.createdAt

        ranges.set(userIndex + 1, {
            endIndex: finalIndex,
            summary: {
                kind: 'turn-work-summary',
                id: `turn-work-summary-${rows[userIndex]?.id || turnId}`,
                createdAt: workRows[0]?.createdAt || finalRow.createdAt,
                turnId,
                startedAt,
                completedAt,
                running: false,
                terminalResponseVisible: false,
                outcome: 'completed',
                rows: groupedWorkRows,
                liveNarrationRow: null
            }
        })
    }

    for (let userIndex = 0; userIndex < rows.length; userIndex += 1) {
        const userRow = rows[userIndex]
        if (userRow.kind !== 'message' || userRow.message.role !== 'user') continue
        if (isVoiceConversationMessage(userRow.message)) continue
        if (ranges.has(userIndex + 1)) continue

        const endIndex = nextUserIndexByRow[userIndex] ?? rows.length

        const turnRows = rows.slice(userIndex + 1, endIndex)
        if (turnRows.length === 0) continue
        const turnId = inferLegacyUserTurnId(userRow.message, turnRows, turnUsageById)
        if (!turnId) continue

        const usage = turnUsageById?.get(turnId)
        const handoffRows = turnRows.filter((row) => row.kind === 'user-input')
        if (handoffRows.length > 0) {
            const firstHandoffIndex = turnRows.findIndex((row) => row.kind === 'user-input')
            const handoffBoundaryIndex = firstHandoffIndex < 0 ? turnRows.length : firstHandoffIndex
            let handoffResponseIndex = -1
            for (let index = handoffBoundaryIndex - 1; index >= 0; index -= 1) {
                const row = turnRows[index]
                if (row?.kind !== 'message' || row.message.role !== 'assistant' || !row.message.text.trim()) continue
                handoffResponseIndex = index
                break
            }
            const actionFollowsResponse = handoffResponseIndex >= 0 && turnRows
                .slice(handoffResponseIndex + 1, handoffBoundaryIndex)
                .some((row) => Boolean(getActionRowActivities(row)))
            const handoffResponseRow = handoffResponseIndex >= 0 && !actionFollowsResponse
                ? turnRows[handoffResponseIndex] || null
                : null
            const workRows = turnRows.filter((row) => (
                row !== handoffResponseRow
                && row.kind !== 'working'
                && !rowMustStayVisible(row)
            ))
            if (workRows.length === 0) continue
            const lastWorkRow = workRows[workRows.length - 1]
            ranges.set(userIndex + 1, {
                endIndex,
                summary: {
                    kind: 'turn-work-summary',
                    id: `turn-work-summary-${userRow.id || turnId}`,
                    createdAt: workRows[0]?.createdAt || userRow.message.createdAt,
                    turnId,
                    startedAt: usage?.startedAt || usage?.requestedAt || userRow.message.createdAt,
                    completedAt: usage?.completedAt || (lastWorkRow ? getRowCompletedAt(lastWorkRow) : null) || handoffRows[0]!.createdAt,
                    running: false,
                    terminalResponseVisible: false,
                    outcome: 'completed',
                    rows: groupConsecutiveActionRows(workRows),
                    liveNarrationRow: null
                },
                visibleRows: turnRows.filter((row) => (
                    row === handoffResponseRow
                    || (row.kind !== 'working' && rowMustStayVisible(row))
                ))
            })
            continue
        }
        const projectedTerminalOutcome = usage?.state === 'completed'
            ? null
            : projectedTerminalOutcomeByTurn.get(turnId)
                || getProjectedTerminalOutcomeFromRows(turnRows)
                || null
        const terminalIncomplete = usage?.state === 'interrupted' || usage?.state === 'error' || Boolean(projectedTerminalOutcome)
        if (finalByTurn.has(turnId) && !terminalIncomplete) continue
        if ((usage?.state === 'running' && !projectedTerminalOutcome) || (isWorking && turnId === activeTurnId && !projectedTerminalOutcome)) continue
        const outcome = usage?.state === 'interrupted'
            ? 'interrupted'
            : usage?.state === 'error'
                ? 'failed'
                : projectedTerminalOutcome || 'no-response'
        const displayTurnRows = outcome === 'interrupted' ? stripProjectedInterruptions(turnRows) : turnRows
        const workRows = displayTurnRows.filter((row) => row.kind !== 'working' && !rowMustStayVisible(row))
        const groupedWorkRows = groupConsecutiveActionRows(workRows)
        const visibleRows = displayTurnRows.filter((row) => row.kind !== 'working' && rowMustStayVisible(row))
        if (workRows.length === 0 && outcome !== 'interrupted') continue

        const startedAt = usage?.startedAt
            || usage?.requestedAt
            || userRow.message.createdAt
            || workRows[0]?.createdAt
            || ''
        const lastWorkRow = workRows[workRows.length - 1]
        const completedAt = usage?.completedAt
            || (lastWorkRow ? getRowCompletedAt(lastWorkRow) : null)
            || userRow.message.updatedAt
            || userRow.message.createdAt

        ranges.set(userIndex + 1, {
            endIndex,
            summary: {
                kind: 'turn-work-summary',
                id: `turn-work-summary-${userRow.id || turnId}`,
                createdAt: workRows[0]?.createdAt || userRow.message.createdAt,
                turnId,
                startedAt,
                completedAt,
                running: false,
                terminalResponseVisible: false,
                outcome,
                rows: groupedWorkRows,
                liveNarrationRow: null
            },
            visibleRows
        })
    }

    const displayRows: TimelineDisplayRow[] = []
    for (let index = 0; index < rows.length; index += 1) {
        if (activeRange && index === activeRange.startIndex) {
            displayRows.push(activeRange.summary, ...activeRange.visibleRows)
            index = activeRange.endIndex
            continue
        }
        const range = ranges.get(index)
        if (range) {
            displayRows.push(range.summary, ...(range.visibleRows || []))
            index = range.endIndex - 1
            continue
        }
        displayRows.push(rows[index])
    }
    return displayRows
}
