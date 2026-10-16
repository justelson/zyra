import type { AssistantCreateSessionInput, AssistantLatestTurn, AssistantModelInfo, AssistantSnapshot } from '@shared/assistant/contracts'
import type {
    AssistantConversationSelection,
    AssistantPageSelection,
    AssistantSessionsRailSelection,
    AssistantWorkspaceSelection
} from './assistant-store-selection-types'

const ACTIVITY_SIGNATURE_WINDOW_SIZE = 96

function areAssistantModelsEqual(left: AssistantModelInfo[], right: AssistantModelInfo[]): boolean {
    if (left === right) return true
    if (left.length !== right.length) return false
    for (let index = 0; index < left.length; index += 1) {
        if (
            left[index]?.id !== right[index]?.id
            || left[index]?.label !== right[index]?.label
            || left[index]?.description !== right[index]?.description
        ) return false
    }
    return true
}

function areAssistantCreateSessionInputsEqual(
    left: AssistantCreateSessionInput | null,
    right: AssistantCreateSessionInput | null
): boolean {
    if (left === right) return true
    if (!left || !right) return left === right
    return left.title === right.title
        && left.projectPath === right.projectPath
        && left.mode === right.mode
        && left.playgroundLabId === right.playgroundLabId
}

function areAssistantLatestTurnsEqual(left: AssistantLatestTurn | null, right: AssistantLatestTurn | null): boolean {
    if (left === right) return true
    if (!left || !right) return left === right
    return left.id === right.id
        && left.state === right.state
        && left.requestedAt === right.requestedAt
        && left.startedAt === right.startedAt
        && left.completedAt === right.completedAt
        && left.assistantMessageId === right.assistantMessageId
        && left.effort === right.effort
        && left.serviceTier === right.serviceTier
        && left.usage?.totalTokens === right.usage?.totalTokens
        && left.usage?.inputTokens === right.usage?.inputTokens
        && left.usage?.outputTokens === right.usage?.outputTokens
        && left.usage?.reasoningOutputTokens === right.usage?.reasoningOutputTokens
        && left.usage?.cachedInputTokens === right.usage?.cachedInputTokens
        && left.usage?.cacheWriteTokens === right.usage?.cacheWriteTokens
        && left.usage?.modelContextWindow === right.usage?.modelContextWindow
        && left.usage?.costUsd === right.usage?.costUsd
        && left.usage?.sessionCostUsd === right.usage?.sessionCostUsd
        && left.usage?.sessionCostComplete === right.usage?.sessionCostComplete
}

function areAssistantSessionsEqual(
    left: AssistantWorkspaceSelection['selectedSession'],
    right: AssistantWorkspaceSelection['selectedSession']
): boolean {
    if (left === right) return true
    if (!left || !right) return left === right
    return left.id === right.id
        && left.title === right.title
        && left.titleGenerating === right.titleGenerating
        && left.mode === right.mode
        && left.projectPath === right.projectPath
        && left.playgroundLabId === right.playgroundLabId
        && left.pendingLabRequest?.id === right.pendingLabRequest?.id
        && left.pendingLabRequest?.kind === right.pendingLabRequest?.kind
        && left.pendingLabRequest?.repoUrl === right.pendingLabRequest?.repoUrl
        && left.archived === right.archived
        && left.createdAt === right.createdAt
        && left.updatedAt === right.updatedAt
        && left.activeThreadId === right.activeThreadId
}

function areAssistantThreadsEqual(
    left: AssistantWorkspaceSelection['activeThread'],
    right: AssistantWorkspaceSelection['activeThread']
): boolean {
    if (left === right) return true
    if (!left || !right) return left === right
    return left.id === right.id
        && left.providerThreadId === right.providerThreadId
        && left.source === right.source
        && left.parentThreadId === right.parentThreadId
        && left.providerParentThreadId === right.providerParentThreadId
        && left.subagentDepth === right.subagentDepth
        && left.agentNickname === right.agentNickname
        && left.agentRole === right.agentRole
        && left.model === right.model
        && left.thinking === right.thinking
        && left.profile === right.profile
        && left.cwd === right.cwd
        && left.messageCount === right.messageCount
        && left.lastMessageAt === right.lastMessageAt
        && left.activityCount === right.activityCount
        && left.proposedPlanCount === right.proposedPlanCount
        && left.lastSeenCompletedTurnId === right.lastSeenCompletedTurnId
        && left.runtimeMode === right.runtimeMode
        && left.interactionMode === right.interactionMode
        && left.webSearch === right.webSearch
        && left.webFetch === right.webFetch
        && left.state === right.state
        && left.hasActivePlan === right.hasActivePlan
        && left.hasPendingApprovals === right.hasPendingApprovals
        && left.hasPendingUserInputs === right.hasPendingUserInputs
        && left.mobileVoice?.deviceName === right.mobileVoice?.deviceName
        && left.canonicalPresence?.state === right.canonicalPresence?.state
        && left.canonicalPresence?.activeTurnId === right.canonicalPresence?.activeTurnId
        && left.canonicalPresence?.latestSequence === right.canonicalPresence?.latestSequence
        && left.canonicalPresence?.observedSequence === right.canonicalPresence?.observedSequence
        && left.lastError === right.lastError
        && left.createdAt === right.createdAt
        && left.updatedAt === right.updatedAt
        && areAssistantLatestTurnsEqual(left.latestTurn, right.latestTurn)
}

function getMessageListSignature(messages: AssistantWorkspaceSelection['timelineMessages']): string {
    if (messages.length === 0) return '0'
    const first = messages[0]
    const last = messages[messages.length - 1]
    return [messages.length, first?.id || '', first?.updatedAt || '', first?.streaming ? '1' : '0', last?.id || '', last?.updatedAt || '', last?.streaming ? '1' : '0'].join('|')
}

function getActivityListSignature(activities: AssistantWorkspaceSelection['activityFeed']): string {
    if (activities.length === 0) return '0'
    const visibleActivities = activities.length > ACTIVITY_SIGNATURE_WINDOW_SIZE
        ? activities.slice(0, ACTIVITY_SIGNATURE_WINDOW_SIZE)
        : activities
    const signature = visibleActivities.map((activity) => {
        const payload = activity.payload || {}
        const output = typeof payload.output === 'string' ? payload.output : ''
        const patch = typeof payload.patch === 'string' ? payload.patch : ''
        const status = typeof payload.status === 'string'
            ? payload.status
            : typeof payload.state === 'string'
                ? payload.state
                : typeof payload.phase === 'string'
                    ? payload.phase
                    : ''
        return [
            activity.id,
            activity.kind,
            activity.tone,
            activity.summary,
            activity.detail || '',
            activity.createdAt,
            status,
            output.length,
            patch.length,
            payload.exitCode ?? '',
            payload.durationMs ?? ''
        ].join(':')
    }).join('|')

    if (visibleActivities.length === activities.length) return signature

    const oldest = activities[activities.length - 1]
    return [
        activities.length,
        signature,
        oldest?.id || '',
        oldest?.createdAt || ''
    ].join('|')
}

function getPendingApprovalSignature(items: AssistantWorkspaceSelection['pendingApprovals']): string {
    if (items.length === 0) return '0'
    const first = items[0]
    const last = items[items.length - 1]
    return [items.length, first?.requestId || '', first?.status || '', last?.requestId || '', last?.status || ''].join('|')
}

function getPendingUserInputSignature(items: AssistantWorkspaceSelection['pendingUserInputs']): string {
    if (items.length === 0) return '0'
    const first = items[0]
    const last = items[items.length - 1]
    return [items.length, first?.requestId || '', first?.status || '', last?.requestId || '', last?.status || ''].join('|')
}

function areAssistantPlansEqual(left: AssistantWorkspaceSelection['activePlan'], right: AssistantWorkspaceSelection['activePlan']): boolean {
    if (left === right) return true
    if (!left || !right) return left === right
    return left.turnId === right.turnId
        && left.updatedAt === right.updatedAt
        && left.explanation === right.explanation
        && left.plan.length === right.plan.length
}

function areAssistantLatestProposedPlansEqual(
    left: AssistantWorkspaceSelection['latestProposedPlan'],
    right: AssistantWorkspaceSelection['latestProposedPlan']
): boolean {
    if (left === right) return true
    if (!left || !right) return left === right
    return left.id === right.id
        && left.turnId === right.turnId
        && left.createdAt === right.createdAt
        && left.updatedAt === right.updatedAt
        && left.planMarkdown === right.planMarkdown
}

export function areAssistantWorkspaceSelectionsEqual(left: AssistantWorkspaceSelection, right: AssistantWorkspaceSelection): boolean {
    return left.available === right.available
        && left.connected === right.connected
        && left.loading === right.loading
        && left.bootstrapped === right.bootstrapped
        && left.modelsLoading === right.modelsLoading
        && left.commandPending === right.commandPending
        && left.commandError === right.commandError
        && left.phase.key === right.phase.key
        && left.phase.label === right.phase.label
        && areAssistantModelsEqual(left.knownModels, right.knownModels)
        && areAssistantSessionsEqual(left.selectedSession, right.selectedSession)
        && areAssistantThreadsEqual(left.activeThread, right.activeThread)
        && getMessageListSignature(left.timelineMessages) === getMessageListSignature(right.timelineMessages)
        && getActivityListSignature(left.activityFeed) === getActivityListSignature(right.activityFeed)
        && getPendingApprovalSignature(left.pendingApprovals) === getPendingApprovalSignature(right.pendingApprovals)
        && getPendingUserInputSignature(left.pendingUserInputs) === getPendingUserInputSignature(right.pendingUserInputs)
        && areAssistantPlansEqual(left.activePlan, right.activePlan)
        && areAssistantLatestProposedPlansEqual(left.latestProposedPlan, right.latestProposedPlan)
}

export function areAssistantPageSelectionsEqual(left: AssistantPageSelection, right: AssistantPageSelection): boolean {
    return left.available === right.available
        && left.connected === right.connected
        && left.loading === right.loading
        && left.bootstrapped === right.bootstrapped
        && left.commandPending === right.commandPending
        && left.commandError === right.commandError
        && left.phase.key === right.phase.key
        && left.phase.label === right.phase.label
        && areAssistantSessionsEqual(left.selectedSession, right.selectedSession)
        && areAssistantThreadsEqual(left.activeThread, right.activeThread)
        && getActivityListSignature(left.activityFeed) === getActivityListSignature(right.activityFeed)
        && getPendingApprovalSignature(left.pendingApprovals) === getPendingApprovalSignature(right.pendingApprovals)
        && getPendingUserInputSignature(left.pendingUserInputs) === getPendingUserInputSignature(right.pendingUserInputs)
        && areAssistantPlansEqual(left.activePlan, right.activePlan)
        && areAssistantLatestProposedPlansEqual(left.latestProposedPlan, right.latestProposedPlan)
}

export function areAssistantConversationSelectionsEqual(left: AssistantConversationSelection, right: AssistantConversationSelection): boolean {
    return left.available === right.available
        && left.connected === right.connected
        && left.loading === right.loading
        && left.modelsLoading === right.modelsLoading
        && left.sessions === right.sessions
        && left.commandPending === right.commandPending
        && areAssistantCreateSessionInputsEqual(left.pendingCreateSessionInput, right.pendingCreateSessionInput)
        && left.commandError === right.commandError
        && left.selectionHydrating === right.selectionHydrating
        && left.history?.pageInfo.oldestCursor === right.history?.pageInfo.oldestCursor
        && left.history?.pageInfo.hasOlder === right.history?.pageInfo.hasOlder
        && left.history?.loadingOlder === right.history?.loadingOlder
        && left.history?.loadOlderError === right.history?.loadOlderError
        && left.phase.key === right.phase.key
        && left.phase.label === right.phase.label
        && areAssistantModelsEqual(left.knownModels, right.knownModels)
        && areAssistantSessionsEqual(left.selectedSession, right.selectedSession)
        && areAssistantThreadsEqual(left.activeThread, right.activeThread)
        && getMessageListSignature(left.timelineMessages) === getMessageListSignature(right.timelineMessages)
        && getActivityListSignature(left.activityFeed) === getActivityListSignature(right.activityFeed)
        && getPendingUserInputSignature(left.pendingUserInputs) === getPendingUserInputSignature(right.pendingUserInputs)
        && areAssistantPlansEqual(left.activePlan, right.activePlan)
        && areAssistantLatestProposedPlansEqual(left.latestProposedPlan, right.latestProposedPlan)
}

function getRailThreadSignature(thread: AssistantSnapshot['sessions'][number]['threads'][number]): string {
    const presence = thread.canonicalPresence
    return [
        thread.id,
        thread.providerThreadId || '',
        thread.source,
        thread.parentThreadId || '',
        thread.providerParentThreadId || '',
        thread.subagentDepth ?? '',
        thread.agentNickname || '',
        thread.agentRole || '',
        thread.state,
        thread.updatedAt,
        thread.lastMessageAt || '',
        thread.latestTurn?.id || '',
        thread.latestTurn?.state || '',
        thread.hasPendingApprovals ? '1' : '0',
        thread.hasPendingUserInputs ? '1' : '0',
        thread.hasActivePlan ? '1' : '0',
        thread.lastError || '',
        presence?.state || '',
        presence?.activeTurnId || '',
        presence?.backgroundWorkActive ? '1' : '0',
        presence?.latestSequence ?? '',
        (presence?.clients || [])
            .map((client) => JSON.stringify([client.clientId, client.surface, client.displayName || '']))
            .sort()
            .join(',')
    ].join(':')
}

function getRailSessionSignature(session: AssistantSnapshot['sessions'][number]): string {
    const activeThread = session.threads.find((thread) => thread.id === session.activeThreadId) || null
    const earliestCreatedThread = session.threads.reduce<typeof activeThread>((earliest, thread) => {
        if (!earliest) return thread
        if (thread.createdAt.localeCompare(earliest.createdAt) < 0) return thread
        return earliest
    }, null)
    const hasVisibleChats = session.threads.some((thread) => (thread.messageCount || 0) > 0)
    return [
        session.id, session.title, session.titleGenerating ? 'title-loading' : '', session.mode, session.projectPath || '', session.playgroundLabId || '', session.pendingLabRequest?.id || '', session.pendingLabRequest?.kind || '', session.archived ? '1' : '0', session.createdAt, session.activeThreadId || '',
        session.threads.map(getRailThreadSignature).join('|'),
        hasVisibleChats ? '1' : '0', activeThread?.state || '', activeThread?.messageCount || 0, activeThread?.lastSeenCompletedTurnId || '', activeThread?.latestTurn?.id || '', activeThread?.latestTurn?.state || '', activeThread?.cwd || '', earliestCreatedThread?.cwd || ''
    ].join('|')
}

export function areAssistantSessionsRailSelectionsEqual(left: AssistantSessionsRailSelection, right: AssistantSessionsRailSelection): boolean {
    if (left.activeSessionId !== right.activeSessionId || left.activeThreadId !== right.activeThreadId || left.connected !== right.connected || left.commandPending !== right.commandPending) return false
    if (left.playground.rootPath !== right.playground.rootPath || left.playground.labs.length !== right.playground.labs.length) return false
    for (let index = 0; index < left.playground.labs.length; index += 1) {
        const leftLab = left.playground.labs[index]
        const rightLab = right.playground.labs[index]
        if (leftLab?.id !== rightLab?.id || leftLab?.title !== rightLab?.title || leftLab?.rootPath !== rightLab?.rootPath || leftLab?.updatedAt !== rightLab?.updatedAt || leftLab?.repoUrl !== rightLab?.repoUrl) return false
    }
    if (left.sessions.length !== right.sessions.length) return false
    for (let index = 0; index < left.sessions.length; index += 1) {
        if (getRailSessionSignature(left.sessions[index]) !== getRailSessionSignature(right.sessions[index])) return false
    }
    return true
}
