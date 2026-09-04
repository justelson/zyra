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
import { TimelineVoiceTaskStatus } from './AssistantTimelineVoiceTask'
import { AssistantTimelineNetworkRecovery } from './AssistantTimelineNetworkRecovery'
import { AssistantTimelineQuestionSet } from './AssistantTimelineQuestionSet'
import { AssistantVirtualTimeline } from './AssistantVirtualTimeline'
import { computeStableAssistantTimelineRows, type StableTimelineRowsState } from './assistant-virtual-timeline-rows'
import {
    buildCommandCheckpointDisplayActivity,
    buildTimelineRows,
    countRunningCommandActivities,
    findRelatedCommandActivityId,
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
import { buildAssistantWorkSteps, shouldInheritAssistantWorkStepTitle } from './assistant-work-steps'
import { useAssistantTimelineEntries } from './useAssistantTimelineEntries'

const ASSISTANT_MARKDOWN_PREWARM_MAX_LENGTH = 32_000

function countTimelineWorkActions(rows: TimelineRenderRow[]): number {
    return rows.reduce((count, row) => {
        if (row.kind === 'activity') return count + 1
        if ('activities' in row) return count + row.activities.length
        return count
    }, 0)
}

type AssistantTimelineProps = {
    messages: AssistantMessage[]
    activities: AssistantActivity[]
    proposedPlans?: AssistantProposedPlan[]
    userInputs?: AssistantPendingUserInput[]
    userInputResponding?: boolean
    onRespondUserInput?: (requestId: string, answers: Record<string, string | string[]>) => Promise<void>
    projectLabel?: string | null
    projectTitle?: string | null
    sessionMode?: 'work' | 'playground'
    projectRootPath?: string | null
    assistantMessageFilePath?: string | null
    windowKey?: string
    scrollContainerRef?: RefObject<HTMLDivElement | null>
    overlayContainerRef?: RefObject<HTMLDivElement | null>
    isWorking?: boolean
    workingLabel?: string
    activeWorkStartedAt?: string | null
    latestAssistantMessageId?: string | null
    latestTurnStartedAt?: string | null
    turnUsageById?: ReadonlyMap<string, AssistantSessionTurnUsageEntry>
    deletingMessageId?: string | null
    focusMessageId?: string | null
    loadingChats?: boolean
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

function AssistantTimelineImpl({
    messages,
    activities,
    proposedPlans = [],
    userInputs = [],
    userInputResponding = false,
    onRespondUserInput,
    projectLabel = null,
    projectTitle = null,
    sessionMode = 'work',
    projectRootPath = null,
    assistantMessageFilePath = null,
    windowKey = 'default',
    scrollContainerRef,
    overlayContainerRef,
    isWorking = false,
    workingLabel = 'Working...',
    activeWorkStartedAt = null,
    latestAssistantMessageId = null,
    latestTurnStartedAt = null,
    turnUsageById,
    deletingMessageId = null,
    focusMessageId = null,
    loadingChats = false,
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
                prewarmCodeBlocks: false
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
    const pendingActivityRevealRef = useRef<string | null>(null)
    const revealActivityInDom = useCallback((activityId: string): boolean => {
        const target = document.getElementById(getTimelineActivityDomId(activityId))
        if (!target) return false
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
        return true
    }, [])
    const revealActivity = useCallback((activityId: string) => {
        if (revealActivityInDom(activityId)) return
        pendingActivityRevealRef.current = activityId
    }, [revealActivityInDom])

    const baseRows = useMemo(
        () => buildTimelineRows(entries, isWorking, activeWorkStartedAt),
        [activeWorkStartedAt, entries, isWorking]
    )
    const rows = useMemo(
        () => groupTimelineRowsIntoWorkSummaries({
            rows: baseRows,
            messages,
            turnUsageById,
            latestAssistantMessageId: resolvedLatestAssistantMessageId,
            latestTurnStartedAt,
            isWorking
        }),
        [baseRows, isWorking, latestTurnStartedAt, messages, resolvedLatestAssistantMessageId, turnUsageById]
    )
    const lastAssistantMessageIdByTurn = useMemo(() => {
        const next = new Map<string, string>()
        for (const message of messages) {
            if (message.role !== 'assistant' || !message.turnId) continue
            next.set(message.turnId, message.id)
        }
        return next
    }, [messages])
    const commandCheckpointTargetById = useMemo(() => new Map(
        activities
            .filter(isCommandCheckpointActivity)
            .map((activity) => [activity.id, findRelatedCommandActivityId(activity, activities)] as const)
    ), [activities])
    const commandCheckpointDisplayById = useMemo(() => new Map(
        activities
            .filter(isCommandCheckpointActivity)
            .map((activity) => [activity.id, buildCommandCheckpointDisplayActivity(activity, activities)] as const)
    ), [activities])
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
        const activityId = pendingActivityRevealRef.current
        if (!activityId) return
        const rowIndex = stableRows.findIndex((row) => (
            row.kind === 'activity' ? row.activity.id === activityId
                : 'activities' in row ? row.activities.some((activity) => activity.id === activityId)
                    : row.kind === 'turn-work-summary' ? row.rows.some((nested) => (
                        nested.kind === 'activity' ? nested.activity.id === activityId : 'activities' in nested && nested.activities.some((activity) => activity.id === activityId)
                    )) : false
        ))
        if (rowIndex < 0) return
        void listRef.current?.scrollToIndex({ index: rowIndex, viewPosition: 0.5, animated: true })
        const frame = window.requestAnimationFrame(() => {
            if (revealActivityInDom(activityId)) pendingActivityRevealRef.current = null
        })
        return () => window.cancelAnimationFrame(frame)
    }, [revealActivityInDom, stableRows])

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
        options: { compactLiveNarration?: boolean; liveNarration?: boolean; purposeTitle?: string | null } = {}
    ): ReactNode => {
        if (row.kind === 'turn-work-summary') {
            return (
                <TimelineTurnWorkSummary
                    key={row.id}
                    startedAt={row.startedAt}
                    completedAt={row.completedAt}
                    running={row.running}
                    collapseForTerminalResponse={row.terminalResponseVisible}
                    outcome={row.outcome}
                    displayMode={assistantChatDisplayMode}
                    actionCount={countTimelineWorkActions(row.rows)}
                    hasWork={row.rows.length > 0}
                    revealContent={Boolean(focusMessageId && row.rows.some((nested) => nested.kind === 'message' && nested.message.id === focusMessageId))}
                    renderChildren={() => (
                        <div className="[&>*:last-child]:pb-0" data-assistant-work-steps="true">
                            {buildAssistantWorkSteps(row.rows).map((step) => {
                                const inheritTitle = shouldInheritAssistantWorkStepTitle(step)
                                return (
                                    <section key={step.id} className="pb-3 last:pb-0" data-assistant-work-step={step.id}>
                                        {step.title && !inheritTitle ? (
                                            <p className="mb-1.5 px-1 text-[11px] font-medium leading-5 text-sparkle-text-secondary">{step.title}</p>
                                        ) : null}
                                        {step.rows.map((workRow) => renderRowContainer(
                                            workRow,
                                            renderRow(workRow, { purposeTitle: inheritTitle ? step.title : null }),
                                            true
                                        ))}
                                    </section>
                                )
                            })}
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
                    purposeTitle={options.purposeTitle}
                    onOpenFilePath={onOpenFilePath}
                    onOpenUrl={onOpenInternalLink}
                    onViewDiff={onViewDiff}
                    onRevealActivity={revealActivity}
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
                            activities={visibleActivities}
                            displayMode={assistantChatDisplayMode}
                            runningCommandCount={runningCommandCount}
                            projectRootPath={projectRootPath}
                            toolOutputDefaultMode={assistantToolOutputDefaultMode}
                            purposeTitle={options.purposeTitle}
                            onOpenFilePath={onOpenFilePath}
                            onOpenUrl={onOpenInternalLink}
                            onViewDiff={onViewDiff}
                        />
                    )
            return interruptionActivities.length > 0 ? (
                <div key={row.id}>
                    {activityContent}
                    <TimelineTurnInterruptionMarker />
                </div>
            ) : activityContent
        }
        if (row.kind === 'activity') {
            if (row.activity.turnTerminalOutcome === 'interrupted') {
                return <TimelineTurnInterruptionMarker key={row.id} />
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
                        purposeTitle={options.purposeTitle}
                        onOpenFilePath={onOpenFilePath}
                        onOpenUrl={onOpenInternalLink}
                        onViewDiff={onViewDiff}
                        onRevealActivity={revealActivity}
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
                    purposeTitle={options.purposeTitle}
                    onOpenFilePath={onOpenFilePath}
                    onOpenUrl={onOpenInternalLink}
                    onViewDiff={onViewDiff}
                />
            )
        }
        if (row.kind === 'user-input') {
            return onRespondUserInput ? (
                <AssistantTimelineQuestionSet
                    key={row.id}
                    input={row.input}
                    responding={userInputResponding}
                    submissionBlocked={isWorking}
                    onRespond={onRespondUserInput}
                />
            ) : null
        }
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
        return (
            <TimelineMessage
                key={options.liveNarration ? 'active-live-narration' : row.id}
                message={row.message}
                isLatestAssistant={row.message.role === 'assistant' && row.message.id === resolvedLatestAssistantMessageId}
                isLastAssistantInTurn={row.message.role === 'assistant' && !!row.message.turnId && lastAssistantMessageIdByTurn.get(row.message.turnId) === row.message.id}
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
        <AssistantVirtualTimeline
            rows={stableRows}
            windowKey={windowKey}
            focusMessageId={focusMessageId}
            listRef={listRef}
            scrollContainerRef={scrollContainerRef}
            contentInsetEndAdjustment={contentInsetEndAdjustment}
            isWorking={isWorking}
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
    )
}

export const AssistantTimeline = memo(AssistantTimelineImpl)
