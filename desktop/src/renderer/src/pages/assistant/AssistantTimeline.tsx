import type { ReactNode, RefObject } from 'react'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { LegendListRef } from '@legendapp/list/react'
import type { AssistantActivity, AssistantMessage, AssistantPendingUserInput, AssistantProposedPlan, AssistantSessionTurnUsageEntry } from '@shared/assistant/contracts'
import { resolveAssistantMessageReferenceId } from '@shared/assistant/message-identity'
import type { PreviewOpenOptions } from '@/components/ui/file-preview/types'
import type { AssistantChatDisplayMode, AssistantTextStreamingMode, AssistantToolOutputDefaultMode } from '@/lib/settings'
import { prewarmMarkdownRenders } from '@/components/ui/MarkdownRenderer'
import { cn } from '@/lib/utils'
import type { AssistantDiffTarget } from './assistant-diff-types'
import {
    TimelineContextCompactionMarker,
    TimelineChatLoadingState,
    TimelineEmptyState,
    TimelineIssueList,
    TimelineModelNotice,
    TimelineMessage,
    TimelineProposedPlan,
    TimelineThought,
    TimelineThoughtGroup,
    TimelineToolCallList,
    TimelineWorkTraceGroup,
    TimelineWorkingIndicator
} from './AssistantTimelineRows'
import { TimelineTurnInterruptionMarker, TimelineTurnWorkSummary } from './AssistantTimelineWorkSummary'
import type { AssistantActivityRevealRequest } from './assistant-timeline-scroll-events'
import { TimelineVoiceTaskStatus } from './AssistantTimelineVoiceTask'
import { useVoiceAgentStatusPreference } from './useVoiceAgentStatusPreference'
import { AssistantTimelineNetworkRecovery } from './AssistantTimelineNetworkRecovery'
import { AssistantTimelineThreadMessage } from './AssistantTimelineThreadMessage'
import { getAssistantInterruptionLabel } from '@shared/assistant/interruption'
import { AssistantVirtualTimeline } from './AssistantVirtualTimeline'
import { computeStableAssistantTimelineRows, type StableTimelineRowsState } from './assistant-virtual-timeline-rows'
import {
    buildTimelineRows,
    countRunningCommandActivities,
    getTimelineActivityDomId,
    getTimelineMessageDomId,
    isCommandCheckpointActivity,
    isAssistantConnectionRecoveryActivity,
    isContextCompactionActivity,
    isInternalAssistantActivity,
    isIssueActivity,
    isModelNoticeActivity,
    isVoiceStrongTaskActivity,
    type TimelineDisplayRow,
    type TimelineRenderRow
} from './assistant-timeline-helpers'
import { stripProposedPlanBlocks } from './assistant-proposed-plan'
import { groupTimelineRowsIntoWorkSummaries } from './assistant-turn-work'
import { addAssistantConversationMarkers } from './assistant-conversation-markers'
import { AssistantConversationMarker } from './AssistantConversationMarker'
import { useAssistantTimelineEntries } from './useAssistantTimelineEntries'
import { buildCommandCheckpointMaps } from './assistant-command-checkpoint-index'
import { resolveAssistantTimelineFocusAfterFollow, type AssistantTimelineFocusOwnership } from './assistant-timeline-scroll-policy'

const ASSISTANT_MARKDOWN_PREWARM_MAX_LENGTH = 32_000

function countTimelineWorkActions(rows: TimelineRenderRow[]): number {
    return rows.reduce((count, row) => {
        if (row.kind === 'activity') return count + 1
        if ('activities' in row) return count + row.activities.length
        return count
    }, 0)
}

function revealTimelineActivityElement(target: HTMLElement): void {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' })
    target.animate(
        [
            { backgroundColor: 'rgba(93, 228, 199, 0)', boxShadow: '0 0 0 0 rgba(93, 228, 199, 0)' },
            { backgroundColor: 'rgba(93, 228, 199, 0.13)', boxShadow: '0 0 0 1px rgba(93, 228, 199, 0.28)' },
            { backgroundColor: 'rgba(93, 228, 199, 0)', boxShadow: '0 0 0 0 rgba(93, 228, 199, 0)' }
        ],
        { duration: reduceMotion ? 1 : 1350, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
    )
    target.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
}

import { VisualizationThreadContext } from '@/components/ui/visualization/visualization-thread-context'

type AssistantTimelineProps = {
    threadId?: string | null
    messages: AssistantMessage[]
    activities: AssistantActivity[]
    proposedPlans?: AssistantProposedPlan[]
    userInputs?: AssistantPendingUserInput[]
    projectLabel?: string | null
    projectTitle?: string | null
    sessionMode?: 'work' | 'playground'
    projectRootPath?: string | null
    assistantMessageFilePath?: string | null
    windowKey?: string
    scrollContainerRef?: RefObject<HTMLDivElement | null>
    overlayContainerRef?: RefObject<HTMLDivElement | null>
    isWorking?: boolean
    waitingForCompaction?: boolean
    workingLabel?: string
    activeWorkStartedAt?: string | null
    latestAssistantMessageId?: string | null
    latestTurnStartedAt?: string | null
    turnUsageById?: ReadonlyMap<string, AssistantSessionTurnUsageEntry>
    deletingMessageId?: string | null
    focusMessageId?: string | null
    followLatestRequestKey?: string | null
    loadingChats?: boolean
    selectionHydrating?: boolean
    coldStart?: boolean
    assistantTextStreamingMode?: AssistantTextStreamingMode
    assistantToolOutputDefaultMode?: AssistantToolOutputDefaultMode
    assistantChatDisplayMode?: AssistantChatDisplayMode
    isConnecting?: boolean
    onRequestDeleteUserMessage?: (message: AssistantMessage) => void
    onImplementProposedPlan?: (plan: AssistantProposedPlan) => Promise<void> | void
    onShowPlanPanel?: () => void
    onOpenAttachmentPreview?: (
        file: { name: string; path: string },
        ext: string,
        options?: PreviewOpenOptions
    ) => Promise<void> | void
    onOpenInternalLink?: (href: string) => Promise<boolean | void> | boolean | void
    onLinkNotice?: (message: string, tone: 'info' | 'error') => void
    onOpenFilePath?: (filePath: string) => Promise<void> | void
    onViewDiff?: (target: AssistantDiffTarget) => void
    contentInsetEndAdjustment?: number
    hasOlder?: boolean
    hasNewer?: boolean
    loadingOlder?: boolean
    loadingNewer?: boolean
    loadOlderError?: string | null
    loadNewerError?: string | null
    onLoadOlder?: (turnLimit?: number) => Promise<boolean> | boolean | void
    onLoadNewer?: (turnLimit?: number) => Promise<boolean> | boolean | void
    onScrollContainer?: (element: HTMLDivElement) => void
}

function timelineRowHasActivity(row: TimelineRenderRow, activityId: string): boolean {
    return row.kind === 'activity' ? row.activity.id === activityId
        : 'activities' in row && row.activities.some(activity => activity.id === activityId)
}

function AssistantTimelineImpl({
    threadId = null,
    messages,
    activities,
    proposedPlans = [],
    userInputs = [],
    projectLabel = null,
    projectTitle = null,
    sessionMode = 'work',
    projectRootPath = null,
    assistantMessageFilePath = null,
    windowKey = 'default',
    scrollContainerRef,
    overlayContainerRef,
    isWorking = false,
    waitingForCompaction = false,
    workingLabel = 'Working...',
    activeWorkStartedAt = null,
    latestAssistantMessageId = null,
    latestTurnStartedAt = null,
    turnUsageById,
    deletingMessageId = null,
    focusMessageId: requestedFocusMessageId = null,
    followLatestRequestKey = null,
    loadingChats = false,
    selectionHydrating = false,
    coldStart = false,
    assistantTextStreamingMode = 'stream',
    assistantToolOutputDefaultMode = 'expanded',
    assistantChatDisplayMode = 'detailed',
    isConnecting = false,
    onRequestDeleteUserMessage,
    onImplementProposedPlan,
    onShowPlanPanel,
    onOpenAttachmentPreview,
    onOpenInternalLink,
    onLinkNotice,
    onOpenFilePath,
    onViewDiff,
    contentInsetEndAdjustment = 0,
    hasOlder = false,
    hasNewer = false,
    loadingOlder = false,
    loadingNewer = false,
    loadOlderError = null,
    loadNewerError = null,
    onLoadOlder,
    onLoadNewer,
    onScrollContainer
}: AssistantTimelineProps) {
    // A send supersedes the current search/reveal target. A new target can still
    // take ownership later, but the old target must not reclaim the live edge.
    const focusOwnershipRef = useRef<AssistantTimelineFocusOwnership | null>(null)
    const focusOwnership = resolveAssistantTimelineFocusAfterFollow(focusOwnershipRef.current, { windowKey, followLatestRequestKey, focusMessageId: requestedFocusMessageId })
    focusOwnershipRef.current = focusOwnership.state
    const focusMessageId = focusOwnership.focusMessageId
    const [initialLayoutWindowKey, setInitialLayoutWindowKey] = useState<string | null>(null)
    useEffect(() => {
        if (initialLayoutWindowKey !== windowKey) return
        const items: Parameters<typeof prewarmMarkdownRenders>[0] = []
        for (let index = messages.length - 1; index >= 0; index -= 1) {
            const message = messages[index]!
            if (message.role !== 'assistant' || message.streaming) continue
            const content = stripProposedPlanBlocks(message.text || '')
            if (!content.trim() || content.length > ASSISTANT_MARKDOWN_PREWARM_MAX_LENGTH) continue
            items.push({
                content,
                cacheKey: `${message.id}:${message.updatedAt}:${content.length}`,
                filePath: assistantMessageFilePath || undefined,
                prewarmCodeBlocks: false,
                mediaMode: 'images-and-videos'
            })
            break
        }
        return prewarmMarkdownRenders(items)
    }, [assistantMessageFilePath, initialLayoutWindowKey, messages, windowKey])
    const handleInitialLayout = useCallback(() => {
        setInitialLayoutWindowKey(windowKey)
    }, [windowKey])

    const entries = useAssistantTimelineEntries(messages, activities, proposedPlans, userInputs)
    const resolvedLatestAssistantMessageId = useMemo(
        () => resolveAssistantMessageReferenceId(messages, latestAssistantMessageId),
        [latestAssistantMessageId, messages]
    )
    const turnUsageByAssistantMessageId = useMemo(() => {
        const next = new Map<string, AssistantSessionTurnUsageEntry>()
        for (const usage of turnUsageById?.values() || []) {
            const messageId = resolveAssistantMessageReferenceId(messages, usage.assistantMessageId)
            if (messageId) next.set(messageId, usage)
        }
        return next
    }, [messages, turnUsageById])
    const listRef = useRef<LegendListRef | null>(null)
    const pendingActivityRevealRef = useRef<AssistantActivityRevealRequest | null>(null)
    const [activityRevealRequest, setActivityRevealRequest] = useState<AssistantActivityRevealRequest | null>(null)
    useEffect(() => {
        pendingActivityRevealRef.current = null
        setActivityRevealRequest(null)
    }, [threadId])
    const revealActivityInDom = useCallback((activityId: string): boolean => {
        const target = document.getElementById(getTimelineActivityDomId(activityId))
        if (!target) return false
        const batchTriggers: HTMLButtonElement[] = []
        let actionBatch = target.closest<HTMLElement>('[data-assistant-action-batch="true"]')
        while (actionBatch) {
            const trigger = actionBatch.querySelector<HTMLButtonElement>('[data-assistant-action-batch-trigger="true"]')
            if (trigger?.getAttribute('aria-expanded') === 'false') batchTriggers.push(trigger)
            actionBatch = actionBatch.parentElement?.closest<HTMLElement>('[data-assistant-action-batch="true"]') || null
        }
        if (batchTriggers.length > 0) {
            batchTriggers.reverse().forEach((trigger) => trigger.click())
            window.setTimeout(() => {
                const revealedTarget = document.getElementById(getTimelineActivityDomId(activityId))
                if (revealedTarget) revealTimelineActivityElement(revealedTarget)
            }, 230)
            return true
        }
        revealTimelineActivityElement(target)
        return true
    }, [])
    const revealActivity = useCallback((activityId: string) => {
        pendingActivityRevealRef.current = null
        setActivityRevealRequest(null)
        if (revealActivityInDom(activityId)) return
        const request = { activityId }
        pendingActivityRevealRef.current = request
        setActivityRevealRequest(request)
    }, [revealActivityInDom])

    const showVoiceAgentStatus = useVoiceAgentStatusPreference()
    const baseRows = useMemo(
        () => buildTimelineRows(entries, isWorking, activeWorkStartedAt).filter(row => showVoiceAgentStatus
            || row.kind !== 'activity' || !isVoiceStrongTaskActivity(row.activity)),
        [activeWorkStartedAt, entries, isWorking, showVoiceAgentStatus]
    )
    const rows = useMemo(
        () => {
            const grouped = groupTimelineRowsIntoWorkSummaries({
                rows: baseRows,
                messages,
                turnUsageById,
                latestAssistantMessageId: resolvedLatestAssistantMessageId,
                latestTurnStartedAt,
                isWorking
            }).filter((row) => row.kind !== 'user-input')
            if (waitingForCompaction && !grouped.some(row => row.kind === 'working')) {
                grouped.push({ kind: 'working', id: 'compaction-waiting-message', createdAt: null })
            }
            return addAssistantConversationMarkers(grouped, turnUsageById)
        },
        [baseRows, isWorking, latestTurnStartedAt, messages, resolvedLatestAssistantMessageId, turnUsageById, waitingForCompaction]
    )
    const lastAssistantMessageIdByTurn = useMemo(() => {
        const next = new Map<string, string>()
        for (const row of rows) {
            const segment = row.kind === 'turn-work-summary' ? row.rows : [row]
            for (const nested of segment) {
                if (nested.kind !== 'message' || nested.message.role !== 'assistant' || !nested.message.turnId) continue
                next.set(nested.message.turnId, nested.message.id)
            }
        }
        return next
    }, [rows])
    const questionResponseByMessageId = useMemo(() => new Map(
        userInputs.flatMap((input) => (
            input.status === 'resolved' && input.responseMessageId
                ? [[input.responseMessageId, input] as const]
                : []
        ))
    ), [userInputs])
    const { targetById: commandCheckpointTargetById, displayById: commandCheckpointDisplayById } = useMemo(
        () => buildCommandCheckpointMaps(activities), [activities]
    )
    const runningCommandCount = useMemo(() => countRunningCommandActivities(activities), [activities])
    const stableRowsStateRef = useRef<StableTimelineRowsState | null>(null)
    const stableRows = useMemo(() => {
        const next = computeStableAssistantTimelineRows(stableRowsStateRef.current, rows)
        stableRowsStateRef.current = next
        return next.rows
    }, [rows])

    const lastMessageRevealRef = useRef<string | null>(null)
    const revealMessageInDom = useCallback((messageId: string): boolean => {
        const target = document.getElementById(getTimelineMessageDomId(messageId))
        if (!target) return false
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' })
        target.animate(
            [
                { backgroundColor: 'rgba(96, 165, 250, 0)', boxShadow: '0 0 0 0 rgba(96, 165, 250, 0)' },
                { backgroundColor: 'rgba(96, 165, 250, 0.12)', boxShadow: '0 0 0 1px rgba(96, 165, 250, 0.26)' },
                { backgroundColor: 'rgba(96, 165, 250, 0)', boxShadow: '0 0 0 0 rgba(96, 165, 250, 0)' }
            ],
            { duration: reduceMotion ? 1 : 1_350, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
        )
        target.focus({ preventScroll: true })
        return true
    }, [])
    useEffect(() => {
        if (!focusMessageId) lastMessageRevealRef.current = null
    }, [focusMessageId])

    useLayoutEffect(() => {
        const messageId = focusMessageId
        if (!messageId || lastMessageRevealRef.current === messageId) return
        const rowIndex = stableRows.findIndex((row) => (
            row.kind === 'message' ? row.message.id === messageId
                : row.kind === 'turn-work-summary' ? row.rows.some((nested) => nested.kind === 'message' && nested.message.id === messageId)
                    : false
        ))
        if (rowIndex < 0) return
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        void listRef.current?.scrollToIndex({ index: rowIndex, viewPosition: 0.5, animated: !reduceMotion })
        let secondFrame = 0
        let retryTimer = 0
        const finishReveal = () => {
            if (!revealMessageInDom(messageId)) return false
            lastMessageRevealRef.current = messageId
            return true
        }
        const firstFrame = window.requestAnimationFrame(() => {
            secondFrame = window.requestAnimationFrame(() => {
                if (!finishReveal()) retryTimer = window.setTimeout(finishReveal, 360)
            })
        })
        return () => {
            window.cancelAnimationFrame(firstFrame)
            if (secondFrame) window.cancelAnimationFrame(secondFrame)
            if (retryTimer) window.clearTimeout(retryTimer)
        }
    }, [focusMessageId, revealMessageInDom, stableRows])

    useLayoutEffect(() => {
        const request = pendingActivityRevealRef.current
        if (!request) return
        const { activityId } = request
        const rowIndex = stableRows.findIndex(row => row.kind === 'turn-work-summary'
            ? row.rows.some(nested => timelineRowHasActivity(nested, activityId))
            : timelineRowHasActivity(row, activityId))
        if (rowIndex < 0) return
        void listRef.current?.scrollToIndex({ index: rowIndex, viewPosition: 0.5, animated: true })
        let observer: MutationObserver | null = null
        let timer = 0
        const finish = () => {
            observer?.disconnect()
            window.clearTimeout(timer)
            if (pendingActivityRevealRef.current !== request) return
            pendingActivityRevealRef.current = null
            setActivityRevealRequest(current => current === request ? null : current)
        }
        const tryReveal = () => {
            const target = document.getElementById(getTimelineActivityDomId(activityId))
            if (target?.closest('[inert]')) return
            if (pendingActivityRevealRef.current === request && revealActivityInDom(activityId)) finish()
        }
        // Explicit jumps open lazy disclosures over multiple commits. Observe
        // the mounted target instead of relying on hidden descendant DOM.
        observer = new MutationObserver(tryReveal)
        observer.observe(scrollContainerRef?.current || document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['inert'] })
        const frame = window.requestAnimationFrame(tryReveal)
        timer = window.setTimeout(finish, 5000)
        return () => { observer?.disconnect(); window.cancelAnimationFrame(frame); window.clearTimeout(timer) }
    }, [activityRevealRequest, revealActivityInDom, scrollContainerRef, stableRows])

    if (loadingChats) {
        return <TimelineChatLoadingState />
    }

    if (rows.length === 0) {
        return (
            <TimelineEmptyState
                projectLabel={projectLabel}
                projectTitle={projectTitle}
                sessionMode={sessionMode}
                showStatusIndicator={isConnecting || isWorking}
                statusIndicatorLabel={workingLabel}
            />
        )
    }

    const renderRow = (
        row: TimelineDisplayRow,
        options: { compactLiveNarration?: boolean; liveNarration?: boolean; inlineWorkNarration?: boolean } = {}
    ): ReactNode => {
        if (row.kind === 'turn-work-summary') {
            return (
                <TimelineTurnWorkSummary
                    key={row.id}
                    startedAt={row.startedAt}
                    completedAt={row.completedAt}
                    running={row.running}
                    statusLabel={row.running && waitingForCompaction ? 'Letting compaction finish' : null}
                    collapseForTerminalResponse={row.terminalResponseVisible}
                    outcome={row.outcome}
                    interruptionLabel={row.interruptionLabel}
                    displayMode={assistantChatDisplayMode}
                    actionCount={countTimelineWorkActions(row.rows)}
                    hasWork={row.rows.length > 0}
                    revealContent={Boolean(focusMessageId && row.rows.some((nested) => nested.kind === 'message' && nested.message.id === focusMessageId))}
                    activityRevealRequest={activityRevealRequest && row.rows.some(nested => timelineRowHasActivity(nested, activityRevealRequest.activityId)) ? activityRevealRequest : null}
                    renderChildren={() => (
                        <div className="[&>*:last-child]:pb-0" data-assistant-work-sequence="chronological">
                            {row.rows.map((workRow) => renderRowContainer(
                                workRow,
                                renderRow(workRow, {
                                    inlineWorkNarration: workRow.kind === 'message' && workRow.message.role === 'assistant'
                                }),
                                true
                            ))}
                        </div>
                    )}
                />
            )
        }
        if (row.kind === 'work-trace-group') {
            return (
                <TimelineWorkTraceGroup
                    key={row.id}
                    activities={row.activities}
                    targetActivityIdByCheckpointId={commandCheckpointTargetById}
                    onRevealCommand={revealActivity}
                />
            )
        }
        if (row.kind === 'thought-group') {
            return <TimelineThoughtGroup key={row.id} activities={row.activities} />
        }
        if (row.kind === 'command-checkpoint-group') {
            return (
                <TimelineToolCallList
                    key={row.id}
                    activities={row.activities.map((activity) => commandCheckpointDisplayById.get(activity.id) || activity)}
                    displayMode={assistantChatDisplayMode}
                    runningCommandCount={runningCommandCount}
                    projectRootPath={projectRootPath}
                    toolOutputDefaultMode={assistantToolOutputDefaultMode}
                    onOpenFilePath={onOpenFilePath}
                    onOpenUrl={onOpenInternalLink}
                    onViewDiff={onViewDiff}
                    onRevealActivity={revealActivity}
                    revealActivityRequest={activityRevealRequest}
                />
            )
        }
        if (row.kind === 'activity-group') {
            const interruptionActivities = row.activities.filter((activity) => activity.turnTerminalOutcome === 'interrupted')
            const visibleActivities = interruptionActivities.length > 0
                ? row.activities.filter((activity) => activity.turnTerminalOutcome !== 'interrupted')
                : row.activities
            const activityContent = visibleActivities.length === 0
                ? null
                : visibleActivities.every((activity) => isIssueActivity(activity))
                    ? <TimelineIssueList activities={visibleActivities} />
                    : (
                        <TimelineToolCallList
                            activities={visibleActivities.map((activity) => commandCheckpointDisplayById.get(activity.id) || activity)}
                            displayMode={assistantChatDisplayMode}
                            runningCommandCount={runningCommandCount}
                            projectRootPath={projectRootPath}
                            toolOutputDefaultMode={assistantToolOutputDefaultMode}
                            onOpenFilePath={onOpenFilePath}
                            onOpenUrl={onOpenInternalLink}
                            onViewDiff={onViewDiff}
                            onRevealActivity={revealActivity}
                            revealActivityRequest={activityRevealRequest}
                        />
                    )
            return interruptionActivities.length > 0 ? (
                <div key={row.id}>
                    {activityContent}
                    <TimelineTurnInterruptionMarker label={getAssistantInterruptionLabel(interruptionActivities[0]?.payload?.interruption)} />
                </div>
            ) : activityContent
        }
        if (row.kind === 'activity') {
            if (row.activity.kind === 'thread-message') {
                return <AssistantTimelineThreadMessage key={row.id} activity={row.activity} displayMode={assistantChatDisplayMode} />
            }
            if (row.activity.turnTerminalOutcome === 'interrupted') {
                return <TimelineTurnInterruptionMarker key={row.id} label={getAssistantInterruptionLabel(row.activity.payload?.interruption)} />
            }
            if (isAssistantConnectionRecoveryActivity(row.activity)) {
                return <AssistantTimelineNetworkRecovery key={row.id} activity={row.activity} />
            }
            if (isVoiceStrongTaskActivity(row.activity)) {
                return <TimelineVoiceTaskStatus key={row.id} activity={row.activity} />
            }
            if (isInternalAssistantActivity(row.activity)) {
                return <TimelineThought key={row.id} activity={row.activity} />
            }
            if (isModelNoticeActivity(row.activity)) {
                return <TimelineModelNotice key={row.id} activity={row.activity} />
            }
            if (isCommandCheckpointActivity(row.activity)) {
                return (
                    <TimelineToolCallList
                        key={row.id}
                        activities={[commandCheckpointDisplayById.get(row.activity.id) || row.activity]}
                        displayMode={assistantChatDisplayMode}
                        runningCommandCount={runningCommandCount}
                        projectRootPath={projectRootPath}
                        toolOutputDefaultMode={assistantToolOutputDefaultMode}
                        onOpenFilePath={onOpenFilePath}
                        onOpenUrl={onOpenInternalLink}
                        onViewDiff={onViewDiff}
                        onRevealActivity={revealActivity}
                        revealActivityRequest={activityRevealRequest}
                    />
                )
            }
            if (isContextCompactionActivity(row.activity)) {
                return (
                    <TimelineContextCompactionMarker
                        key={row.id}
                        activity={row.activity}
                    />
                )
            }
            if (isIssueActivity(row.activity)) {
                return (
                    <TimelineIssueList
                        key={row.id}
                        activities={[row.activity]}
                    />
                )
            }
            return (
                <TimelineToolCallList
                    key={row.id}
                    activities={[row.activity]}
                    displayMode={assistantChatDisplayMode}
                    runningCommandCount={runningCommandCount}
                    projectRootPath={projectRootPath}
                    toolOutputDefaultMode={assistantToolOutputDefaultMode}
                    onOpenFilePath={onOpenFilePath}
                    onOpenUrl={onOpenInternalLink}
                    onViewDiff={onViewDiff}
                />
            )
        }
        if (row.kind === 'model-change' || row.kind === 'conversation-time') return <AssistantConversationMarker row={row} />
        if (row.kind === 'user-input') return null
        if (row.kind === 'working') {
            return <TimelineWorkingIndicator key={row.id} startedAt={activeWorkStartedAt} label={workingLabel} />
        }
        if (row.kind === 'plan') {
            return (
                <TimelineProposedPlan
                    key={row.id}
                    plan={row.plan}
                    canImplement={row.canImplement && !isWorking}
                    onImplement={onImplementProposedPlan}
                    onShowPlanPanel={onShowPlanPanel}
                    scrollContainerRef={scrollContainerRef}
                    overlayContainerRef={overlayContainerRef}
                    filePath={assistantMessageFilePath}
                    onInternalLinkClick={onOpenInternalLink}
                    onLinkNotice={onLinkNotice}
                />
            )
        }
        if (row.kind === 'message' && row.threadMessage) {
            return <AssistantTimelineThreadMessage key={row.id} activity={row.threadMessage} displayMode={assistantChatDisplayMode} />
        }
        return (
            <TimelineMessage
                key={options.liveNarration ? 'active-live-narration' : row.id}
                message={row.message}
                peerReply={row.peerReply}
                isLatestAssistant={row.message.role === 'assistant' && row.message.id === resolvedLatestAssistantMessageId}
                isLastAssistantInTurn={Boolean(row.peerReply) || (row.message.role === 'assistant' && !!row.message.turnId && lastAssistantMessageIdByTurn.get(row.message.turnId) === row.message.id)}
                latestTurnStartedAt={latestTurnStartedAt}
                turnUsage={row.message.role === 'assistant'
                    ? (row.message.turnId ? turnUsageById?.get(row.message.turnId) : null)
                        || turnUsageByAssistantMessageId.get(row.message.id)
                        || null
                    : null}
                deleting={row.message.id === deletingMessageId}
                assistantTextStreamingMode={assistantTextStreamingMode}
                displayMode={assistantChatDisplayMode}
                compactLiveNarration={options.compactLiveNarration}
                inlineWorkNarration={options.inlineWorkNarration}
                questionResponse={row.message.role === 'user' ? questionResponseByMessageId.get(row.message.id) || null : null}
                onRequestDelete={row.message.role === 'user' ? onRequestDeleteUserMessage : undefined}
                onOpenFilePath={row.message.role === 'user' ? onOpenFilePath : undefined}
                filePath={row.message.role === 'assistant' ? assistantMessageFilePath : null}
                onInternalLinkClick={row.message.role === 'assistant' ? onOpenInternalLink : undefined}
                onLinkNotice={row.message.role === 'assistant' ? onLinkNotice : undefined}
                onOpenAttachmentPreview={row.message.role === 'user' ? onOpenAttachmentPreview : undefined}
            />
        )
    }

    const renderRowContainer = (row: TimelineDisplayRow, content: ReactNode, compact = false) => {
        if (!content) return null
        return (
            <div
                key={row.id}
                id={row.kind === 'message' ? getTimelineMessageDomId(row.message.id) : undefined}
                tabIndex={row.kind === 'message' ? -1 : undefined}
                className={cn(compact ? 'pb-1 outline-none' : 'pb-4 outline-none')}
                data-assistant-timeline-row-id={row.id}
                data-assistant-timeline-row-kind={row.kind}
                data-assistant-message-role={row.kind === 'message' ? row.message.role : undefined}
            >
                {content}
            </div>
        )
    }

    return (
        <VisualizationThreadContext.Provider value={threadId}>
        <AssistantVirtualTimeline
            rows={stableRows}
            windowKey={windowKey}
            focusMessageId={focusMessageId}
            activityRevealRequest={activityRevealRequest}
            followLatestRequestKey={followLatestRequestKey}
            listRef={listRef}
            scrollContainerRef={scrollContainerRef}
            contentInsetEndAdjustment={contentInsetEndAdjustment}
            isWorking={isWorking || waitingForCompaction}
            selectionHydrating={selectionHydrating}
            coldStart={coldStart}
            hasOlder={hasOlder}
            hasNewer={hasNewer}
            loadingOlder={loadingOlder}
            loadingNewer={loadingNewer}
            loadOlderError={loadOlderError}
            loadNewerError={loadNewerError}
            onLoadOlder={onLoadOlder}
            onLoadNewer={onLoadNewer}
            onScrollContainer={onScrollContainer}
            onInitialLayout={handleInitialLayout}
            renderRow={renderRow}
        />
        </VisualizationThreadContext.Provider>
    )
}

export const AssistantTimeline = memo(AssistantTimelineImpl)
