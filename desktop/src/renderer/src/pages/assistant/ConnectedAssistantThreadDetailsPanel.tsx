import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import type {
    AssistantActivity,
    AssistantAccountOverview,
    AssistantLatestTurn,
    AssistantRuntimeMode
} from '@shared/assistant/contracts'
import {
    estimateAssistantSessionCostUsd,
    formatAssistantUsd,
    getAssistantCostLabel
} from '@shared/assistant/pricing'
import { useAssistantStoreActions, useAssistantStoreSelector } from '@/lib/assistant/store'
import {
    getActiveAssistantThread,
    getAssistantActivityFeed,
    getAssistantPendingApprovals,
    getAssistantPendingUserInputs,
    getSelectedAssistantSession
} from '@/lib/assistant/selectors'
import { resolveSessionProjectPath } from './assistant-sessions-rail-utils'
import {
    buildIssueLogEntry,
    copyTextToClipboard,
    formatCompactMetric,
    formatContextMetric,
    getIssueActivities,
    groupIssueActivities,
    IssueLogDetailsModal,
    resolveUsageMetricTone,
    type LogDetailsTab,
    type UsageMetricTone
} from './AssistantPageHelpers'
import { AssistantThreadDetailsPanel } from './AssistantThreadDetailsPanel'
import { formatAssistantModelLabel } from './assistant-model-labels'
import {
    readAssistantComposerSessionState,
    subscribeAssistantComposerSessionState,
    type AssistantComposerSessionState
} from './assistant-composer-session-state'
import { SIDEBAR_EFFORT_LABELS } from './useAssistantPageSidebarState'
import { getProfileLabel } from './assistant-composer-controller-constants'
import { useAssistantSessionTurnUsage } from './useAssistantSessionTurnUsage'

type ThreadDetailsSelection = {
    assistantConnected: boolean
    commandPending: boolean
    commandError: string | null
    selectedSessionId: string | null
    selectedSessionMode: 'work' | 'playground'
    selectedSessionUpdatedAt: string | null
    activeThreadId: string | null
    selectionHydrating: boolean
    selectedProjectPath: string
    selectedPlaygroundLabId: string | null
    selectedPlaygroundLabTitle: string | null
    activeThreadModel: string
    activeThreadThinking: AssistantLatestTurn['effort']
    activeThreadRuntimeMode: AssistantRuntimeMode
    latestTurn: AssistantLatestTurn | null
    activityFeed: AssistantActivity[]
    pendingApprovalsCount: number
    pendingUserInputsCount: number
}

const CLOSED_THREAD_DETAILS_SELECTION: ThreadDetailsSelection = {
    assistantConnected: false,
    commandPending: false,
    commandError: null,
    selectedSessionId: null,
    selectedSessionMode: 'work',
    selectedSessionUpdatedAt: null,
    activeThreadId: null,
    selectionHydrating: false,
    selectedProjectPath: '',
    selectedPlaygroundLabId: null,
    selectedPlaygroundLabTitle: null,
    activeThreadModel: '',
    activeThreadThinking: null,
    activeThreadRuntimeMode: 'approval-required',
    latestTurn: null,
    activityFeed: [],
    pendingApprovalsCount: 0,
    pendingUserInputsCount: 0
}

function areLatestTurnsEqual(left: AssistantLatestTurn | null, right: AssistantLatestTurn | null): boolean {
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
}

function getActivitySignature(activities: AssistantActivity[]): string {
    if (activities.length === 0) return '0'
    const newest = activities[0]
    const oldest = activities[activities.length - 1]
    return [
        activities.length,
        newest?.id || '',
        newest?.createdAt || '',
        oldest?.id || '',
        oldest?.createdAt || ''
    ].join('|')
}

function areThreadDetailsSelectionsEqual(left: ThreadDetailsSelection, right: ThreadDetailsSelection): boolean {
    return left.assistantConnected === right.assistantConnected
        && left.commandPending === right.commandPending
        && left.commandError === right.commandError
        && left.selectedSessionId === right.selectedSessionId
        && left.selectedSessionMode === right.selectedSessionMode
        && left.selectedSessionUpdatedAt === right.selectedSessionUpdatedAt
        && left.activeThreadId === right.activeThreadId
        && left.selectionHydrating === right.selectionHydrating
        && left.selectedProjectPath === right.selectedProjectPath
        && left.selectedPlaygroundLabId === right.selectedPlaygroundLabId
        && left.selectedPlaygroundLabTitle === right.selectedPlaygroundLabTitle
        && left.activeThreadModel === right.activeThreadModel
        && left.activeThreadThinking === right.activeThreadThinking
        && left.activeThreadRuntimeMode === right.activeThreadRuntimeMode
        && left.pendingApprovalsCount === right.pendingApprovalsCount
        && left.pendingUserInputsCount === right.pendingUserInputsCount
        && areLatestTurnsEqual(left.latestTurn, right.latestTurn)
        && getActivitySignature(left.activityFeed) === getActivitySignature(right.activityFeed)
}

export function ConnectedAssistantThreadDetailsPanel(props: {
    open: boolean
    compact?: boolean
    onClose: () => void
    onShowPlan: () => void
}) {
    const { clearCommandError, clearLogsResult, connect, disconnect } = useAssistantStoreActions()
    const selection = useAssistantStoreSelector<ThreadDetailsSelection>((state) => {
        if (!props.open) return CLOSED_THREAD_DETAILS_SELECTION

        const selectedSession = getSelectedAssistantSession(state.snapshot)
        const activeThread = getActiveAssistantThread(selectedSession)
        const selectedLab = selectedSession?.playgroundLabId
            ? (state.snapshot.playground.labs.find((lab) => lab.id === selectedSession.playgroundLabId) || null)
            : null
        const activeSelectionKey = selectedSession && activeThread ? `${selectedSession.id}:${activeThread.id}` : null
        const selectionHydrating = Boolean(activeSelectionKey && (
            state.selectionTransitionKey === activeSelectionKey
            || state.selectionHydrationKey === activeSelectionKey
        ))

        return {
            assistantConnected: state.status.connected,
            commandPending: state.commandPending,
            commandError: state.error,
            selectedSessionId: selectedSession?.id || null,
            selectedSessionMode: selectedSession?.mode || 'work',
            selectedSessionUpdatedAt: selectedSession?.updatedAt || null,
            activeThreadId: activeThread?.id || null,
            selectionHydrating,
            selectedProjectPath: selectedSession ? resolveSessionProjectPath(selectedSession) : '',
            selectedPlaygroundLabId: selectedSession?.playgroundLabId || null,
            selectedPlaygroundLabTitle: selectedLab?.title || null,
            activeThreadModel: String(activeThread?.model || '').trim(),
            activeThreadThinking: activeThread?.thinking || null,
            activeThreadRuntimeMode: activeThread?.runtimeMode || 'approval-required',
            latestTurn: activeThread?.latestTurn || null,
            activityFeed: getAssistantActivityFeed(activeThread),
            pendingApprovalsCount: getAssistantPendingApprovals(activeThread).length,
            pendingUserInputsCount: getAssistantPendingUserInputs(activeThread).length
        }
    }, areThreadDetailsSelectionsEqual)

    const [showFullProjectPath, setShowFullProjectPath] = useState(false)
    const [projectPathCopied, setProjectPathCopied] = useState(false)
    const [selectedLogActivity, setSelectedLogActivity] = useState<AssistantActivity | null>(null)
    const [selectedLogActivities, setSelectedLogActivities] = useState<AssistantActivity[] | null>(null)
    const [logDetailsTab, setLogDetailsTab] = useState<LogDetailsTab>('rendered')
    const [copiedLogId, setCopiedLogId] = useState<string | null>(null)
    const [copyErrorByLogId, setCopyErrorByLogId] = useState<Record<string, string | null>>({})
    const [allLogsCopied, setAllLogsCopied] = useState(false)
    const [clearingLogs, setClearingLogs] = useState(false)
    const [logsExpanded, setLogsExpanded] = useState(false)
    const [composerSessionState, setComposerSessionState] = useState<AssistantComposerSessionState>({})
    const [accountOverview, setAccountOverview] = useState<AssistantAccountOverview | null>(null)
    const {
        sessionTurnUsage,
        sessionTurnUsageLoading,
        sessionTurnUsageError
    } = useAssistantSessionTurnUsage({
        sessionId: selection.selectedSessionId,
        enabled: props.open,
        refreshKey: `${selection.latestTurn?.id || ''}:${selection.latestTurn?.completedAt || ''}:${selection.latestTurn?.state || ''}`
    })

    useLayoutEffect(() => {
        setComposerSessionState(readAssistantComposerSessionState(selection.selectedSessionId))
    }, [selection.selectedSessionId])

    useEffect(() => subscribeAssistantComposerSessionState((updatedSessionId, nextState) => {
        if (!selection.selectedSessionId || updatedSessionId !== selection.selectedSessionId) return
        setComposerSessionState(nextState)
    }), [selection.selectedSessionId])

    useEffect(() => {
        if (!props.open) {
            setSelectedLogActivity(null)
            setSelectedLogActivities(null)
            setLogsExpanded(false)
            setProjectPathCopied(false)
            setShowFullProjectPath(false)
        }
    }, [props.open])

    useEffect(() => {
        setSelectedLogActivity(null)
        setSelectedLogActivities(null)
        setLogsExpanded(false)
        setProjectPathCopied(false)
        setShowFullProjectPath(false)
        setCopiedLogId(null)
        setCopyErrorByLogId({})
        setAllLogsCopied(false)
    }, [selection.activeThreadId, selection.selectedSessionId])

    useEffect(() => {
        if (!props.open) return
        let cancelled = false

        void (async () => {
            const result = await window.devscope.assistant.getAccountOverview()
            if (cancelled || !result.success) return
            setAccountOverview(result.overview)
        })()

        return () => {
            cancelled = true
        }
    }, [props.open])

    const selectedProjectPath = selection.selectedProjectPath
    const selectedChatTypeLabel = selection.selectedProjectPath ? 'Project chat' : 'Chat'
    const selectedProjectLabel = selection.selectedPlaygroundLabTitle
        || (selectedProjectPath
            ? selectedProjectPath.split(/[\\/]/).filter(Boolean).pop() || selectedProjectPath
            : (selection.selectedSessionMode === 'work' ? 'No project selected' : 'Chat-only'))
    const selectedProjectPathWithTilde = selectedProjectPath
        ? selectedProjectPath.replace(/^[A-Z]:\\Users\\[^\\]+/, '~').replace(/\\/g, '/')
        : ''
    const displayProjectPath = showFullProjectPath ? selectedProjectPathWithTilde : selectedProjectLabel

    const latestTurnUsage = selection.selectionHydrating ? null : selection.latestTurn?.usage || null
    const contextUsedTokens = latestTurnUsage?.totalTokens ?? null
    const contextWindowTokens = latestTurnUsage?.modelContextWindow ?? null
    const contextUsedDisplay = selection.selectionHydrating ? 'Syncing…' : contextUsedTokens != null ? formatCompactMetric(contextUsedTokens) : selection.latestTurn ? 'Not reported' : 'No turn yet'
    const contextAvailableDisplay = selection.selectionHydrating ? 'Syncing…' : contextWindowTokens != null ? formatCompactMetric(contextWindowTokens) : selection.latestTurn ? 'Not reported' : 'No turn yet'
    const contextPercentage = contextUsedTokens != null && contextWindowTokens != null && contextWindowTokens > 0
        ? Math.round((contextUsedTokens / contextWindowTokens) * 100)
        : null
    const contextColor = contextPercentage != null
        ? contextPercentage >= 90 ? 'text-red-300' : contextPercentage >= 70 ? 'text-amber-300' : 'text-emerald-300'
        : 'text-sparkle-text'

    const sidebarSelectedModel = selection.selectionHydrating
        ? 'Syncing…'
        : formatAssistantModelLabel(selection.activeThreadModel || composerSessionState.model || '')
    const selectedThinkingLabel = selection.selectionHydrating
        ? 'Syncing…'
        : SIDEBAR_EFFORT_LABELS[selection.latestTurn?.effort || selection.activeThreadThinking || composerSessionState.effort || 'high']
    const selectedSpeedLabel = selection.selectionHydrating
        ? 'Syncing…'
        : (selection.latestTurn?.serviceTier === 'fast' || (selection.latestTurn?.serviceTier == null && composerSessionState.fastModeEnabled) ? 'Fast' : 'Standard')
    const selectedRuntimeLabel = selection.selectionHydrating
        ? 'Syncing…'
        : getProfileLabel(selection.activeThreadRuntimeMode)
    const activeSessionTurnUsage = sessionTurnUsage?.sessionId === selection.selectedSessionId ? sessionTurnUsage : null
    const sessionCostEstimate = useMemo(
        () => estimateAssistantSessionCostUsd(activeSessionTurnUsage?.turns || []),
        [activeSessionTurnUsage?.turns]
    )
    const sessionCostLabel = getAssistantCostLabel(accountOverview?.authMode)
    const sessionCostDisplay = useMemo(() => {
        if (sessionTurnUsageLoading && !activeSessionTurnUsage) return 'Loading...'
        if (sessionTurnUsageError) return 'Unavailable'
        if (!activeSessionTurnUsage || sessionCostEstimate.meteredTurnCount === 0) {
            return selection.latestTurn ? 'Not reported' : 'No turns'
        }
        if (sessionCostEstimate.totalUsd != null) return formatAssistantUsd(sessionCostEstimate.totalUsd)
        if (sessionCostEstimate.unpricedTurnCount > 0) return 'Model pricing not available for now'
        return 'Unavailable'
    }, [activeSessionTurnUsage, selection.latestTurn, sessionCostEstimate.meteredTurnCount, sessionCostEstimate.totalUsd, sessionCostEstimate.unpricedTurnCount, sessionTurnUsageError, sessionTurnUsageLoading])
    const sidebarMetricChips = useMemo(() => {
        return [
            {
                label: 'Input tokens',
                value: latestTurnUsage?.inputTokens != null ? formatCompactMetric(latestTurnUsage.inputTokens) : null,
                tone: resolveUsageMetricTone(latestTurnUsage?.inputTokens, contextWindowTokens, { normal: 12_000, high: 40_000 })
            },
            {
                label: 'Output tokens',
                value: latestTurnUsage?.outputTokens != null ? formatCompactMetric(latestTurnUsage.outputTokens) : null,
                tone: resolveUsageMetricTone(latestTurnUsage?.outputTokens, contextWindowTokens, { normal: 4_000, high: 16_000 })
            },
            {
                label: 'Cached input',
                value: latestTurnUsage?.cachedInputTokens != null ? formatCompactMetric(latestTurnUsage.cachedInputTokens) : null,
                tone: resolveUsageMetricTone(latestTurnUsage?.cachedInputTokens, contextWindowTokens, { normal: 8_000, high: 24_000 })
            },
            {
                label: 'Total tokens',
                value: latestTurnUsage?.totalTokens != null ? formatCompactMetric(latestTurnUsage.totalTokens) : null,
                tone: resolveUsageMetricTone(latestTurnUsage?.totalTokens, contextWindowTokens, { normal: 16_000, high: 48_000 })
            },
            {
                label: 'Context usage',
                value: contextWindowTokens ? formatContextMetric(contextUsedTokens, contextWindowTokens) : null,
                tone: resolveUsageMetricTone(contextUsedTokens, contextWindowTokens, { normal: 0, high: 0 })
            }
        ].filter((entry): entry is { label: string; value: string; tone: UsageMetricTone } => Boolean(entry.value))
    }, [contextUsedTokens, contextWindowTokens, latestTurnUsage])

    const issueActivities = useMemo(() => {
        const nextActivities = [...getIssueActivities(selection.activityFeed)]
        if (selection.commandError) {
            nextActivities.unshift({
                id: `assistant-local-error-${selection.commandError}`,
                kind: 'ui.command-error',
                tone: 'error',
                summary: 'Assistant command failed',
                detail: selection.commandError,
                turnId: selection.latestTurn?.id || null,
                createdAt: selection.activityFeed[0]?.createdAt
                    || selection.latestTurn?.completedAt
                    || selection.latestTurn?.startedAt
                    || selection.selectedSessionUpdatedAt
                    || new Date(0).toISOString()
            })
        }
        return nextActivities
    }, [selection.activityFeed, selection.commandError, selection.latestTurn?.completedAt, selection.latestTurn?.id, selection.latestTurn?.startedAt, selection.selectedSessionUpdatedAt])

    const groupedIssueActivities = useMemo(() => groupIssueActivities(issueActivities), [issueActivities])

    const latestIssueGroup = groupedIssueActivities[0] || null
    const olderIssueGroups = groupedIssueActivities.slice(1)

    useEffect(() => {
        if (olderIssueGroups.length === 0 && logsExpanded) setLogsExpanded(false)
    }, [logsExpanded, olderIssueGroups.length])

    const handleToggleAssistantConnection = useCallback(() => {
        if (selection.assistantConnected) {
            void disconnect(selection.selectedSessionId || undefined)
            return
        }
        void connect(selection.selectedSessionId || undefined)
    }, [connect, disconnect, selection.assistantConnected, selection.selectedSessionId])

    const handleCopyProjectPath = useCallback(async () => {
        if (!selectedProjectPath) return
        try {
            await copyTextToClipboard(selectedProjectPath)
            setProjectPathCopied(true)
            window.setTimeout(() => setProjectPathCopied(false), 1600)
        } catch {}
    }, [selectedProjectPath])

    const handleCopyLog = useCallback(async (activity: AssistantActivity) => {
        try {
            await copyTextToClipboard(JSON.stringify(buildIssueLogEntry(activity), null, 2))
            setCopiedLogId(activity.id)
            setCopyErrorByLogId((current) => ({ ...current, [activity.id]: null }))
            window.setTimeout(() => setCopiedLogId((current) => current === activity.id ? null : current), 1600)
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to copy to clipboard'
            setCopyErrorByLogId((current) => ({ ...current, [activity.id]: message }))
            window.setTimeout(() => {
                setCopyErrorByLogId((current) => {
                    const next = { ...current }
                    if (next[activity.id] === message) delete next[activity.id]
                    return next
                })
            }, 2400)
        }
    }, [])

    const handleCopyAllLogs = useCallback(async () => {
        if (issueActivities.length === 0) return
        try {
            const allLogs = issueActivities.map((activity) => JSON.stringify(buildIssueLogEntry(activity), null, 2)).join('\n\n---\n\n')
            await copyTextToClipboard(allLogs)
            setAllLogsCopied(true)
            window.setTimeout(() => setAllLogsCopied(false), 1600)
        } catch {}
    }, [issueActivities])

    const handleClearLogs = useCallback(async () => {
        if (!selection.selectedSessionId || !latestIssueGroup || clearingLogs) return
        try {
            setClearingLogs(true)
            setLogsExpanded(false)
            const result = await clearLogsResult(selection.selectedSessionId)
            if (result.success) clearCommandError()
        } finally {
            setClearingLogs(false)
        }
    }, [clearCommandError, clearLogsResult, clearingLogs, latestIssueGroup, selection.selectedSessionId])

    const handleShowLogDetails = useCallback((activity: AssistantActivity, activities?: AssistantActivity[]) => {
        setSelectedLogActivity(activity)
        setSelectedLogActivities(activities && activities.length > 0 ? activities : null)
        setLogDetailsTab('rendered')
    }, [])

    return (
        <>
            <AssistantThreadDetailsPanel
                open={props.open}
                compact={props.compact}
                selectedChatTypeLabel={selectedChatTypeLabel}
                selectedProjectPath={selectedProjectPath}
                selectedProjectLabel={selectedProjectLabel}
                displayProjectPath={displayProjectPath}
                showFullProjectPath={showFullProjectPath}
                projectPathCopied={projectPathCopied}
                contextPercentage={contextPercentage}
                contextColor={contextColor}
                contextUsedDisplay={contextUsedDisplay}
                contextAvailableDisplay={contextAvailableDisplay}
                pendingApprovalsCount={selection.pendingApprovalsCount}
                pendingUserInputsCount={selection.pendingUserInputsCount}
                sidebarSelectedModel={sidebarSelectedModel}
                selectedRuntimeLabel={selectedRuntimeLabel}
                selectedThinkingLabel={selectedThinkingLabel}
                selectedSpeedLabel={selectedSpeedLabel}
                sessionCostLabel={sessionCostLabel}
                sessionCostDisplay={sessionCostDisplay}
                sessionCostTone={sessionTurnUsageError ? 'neutral' : 'low'}
                sidebarMetricChips={sidebarMetricChips}
                issueActivities={issueActivities}
                latestIssueGroup={latestIssueGroup}
                olderIssueGroups={olderIssueGroups}
                copiedLogId={copiedLogId}
                copyErrorByLogId={copyErrorByLogId}
                allLogsCopied={allLogsCopied}
                clearingLogs={clearingLogs}
                logsExpanded={logsExpanded}
                selectedSessionId={selection.selectedSessionId}
                assistantConnected={selection.assistantConnected}
                commandPending={selection.commandPending}
                onClose={props.onClose}
                onShowPlan={props.onShowPlan}
                onToggleProjectPath={() => setShowFullProjectPath((current) => !current)}
                onCopyProjectPath={handleCopyProjectPath}
                onToggleLogsExpanded={() => setLogsExpanded((current) => !current)}
                onCopyAllLogs={handleCopyAllLogs}
                onClearLogs={handleClearLogs}
                onCopyLog={handleCopyLog}
                onShowLogDetails={handleShowLogDetails}
                onToggleAssistantConnection={handleToggleAssistantConnection}
            />
            <IssueLogDetailsModal
                activity={selectedLogActivity}
                activities={selectedLogActivities}
                tab={logDetailsTab}
                onChangeTab={setLogDetailsTab}
                onClose={() => {
                    setSelectedLogActivity(null)
                    setSelectedLogActivities(null)
                }}
            />
        </>
    )
}
