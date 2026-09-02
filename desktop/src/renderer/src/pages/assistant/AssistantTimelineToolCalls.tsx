import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { AssistantActivity } from '@shared/assistant/contracts'
import type { AssistantToolOutputDefaultMode } from '@/lib/settings'
import { cn } from '@/lib/utils'
import type { AssistantDiffTarget } from './assistant-diff-types'
import {
    areActivityListsEqual,
    countRunningCommandActivities,
    getActivityPaths,
    getCreatedFilePaths,
    isSubagentActivity
} from './assistant-timeline-helpers'
import { TimelineSubagentActivityCard } from './AssistantTimelineSubagentActivityCard'
import { TimelineToolCallCard } from './AssistantTimelineToolCallCard'
import { AnimatedHeight } from '@/components/ui/AnimatedHeight'

export const COLLAPSED_TOOL_CALL_COUNT = 5
const TOOL_CALL_DISCLOSURE_MS = 280

function normalizeTimelineFilePath(value: string): string {
    return value.trim().replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase()
}

function buildDisplayActivityList(activities: AssistantActivity[]): AssistantActivity[] {
    const seenFilePaths = new Set<string>()

    return activities.flatMap((activity) => {
        if (activity.kind !== 'file-change') return [activity]

        const filePaths = getActivityPaths(activity)
        if (filePaths.length === 0) return [activity]

        const nextPaths: string[] = []
        const seenInActivity = new Set<string>()
        for (const filePath of filePaths) {
            const comparablePath = normalizeTimelineFilePath(filePath)
            if (!comparablePath || seenInActivity.has(comparablePath)) continue
            seenInActivity.add(comparablePath)
            if (!seenFilePaths.has(comparablePath)) nextPaths.push(filePath)
        }

        for (const filePath of filePaths) {
            const comparablePath = normalizeTimelineFilePath(filePath)
            if (comparablePath) seenFilePaths.add(comparablePath)
        }

        if (nextPaths.length === 0) return []
        if (nextPaths.length === filePaths.length) return [activity]

        const nextPathKeys = new Set(nextPaths.map(normalizeTimelineFilePath))
        const nextCreatedPaths = getCreatedFilePaths(activity).filter((filePath) => (
            nextPathKeys.has(normalizeTimelineFilePath(filePath))
        ))

        return [{
            ...activity,
            detail: nextPaths.join('\n'),
            payload: {
                ...(activity.payload || {}),
                paths: nextPaths,
                createdPaths: nextCreatedPaths,
                fileCount: nextPaths.length,
                patch: undefined
            }
        }]
    })
}

export const TimelineToolCallList = memo(({
    activities,
    runningCommandCount,
    projectRootPath,
    toolOutputDefaultMode = 'expanded',
    onOpenFilePath,
    onViewDiff,
    onRevealActivity
}: {
    activities: AssistantActivity[]
    runningCommandCount?: number
    projectRootPath?: string | null
    toolOutputDefaultMode?: AssistantToolOutputDefaultMode
    onOpenFilePath?: (filePath: string) => Promise<void> | void
    onViewDiff?: (target: AssistantDiffTarget) => void
    onRevealActivity?: (activityId: string) => void
}) => {
    const [expanded, setExpanded] = useState(false)
    const [olderMounted, setOlderMounted] = useState(false)
    const olderUnmountTimerRef = useRef<number | null>(null)
    const displayActivities = useMemo(() => buildDisplayActivityList(activities), [activities])
    const localRunningCommandCount = useMemo(() => countRunningCommandActivities(displayActivities), [displayActivities])
    const activeRunningCommandCount = runningCommandCount ?? localRunningCommandCount
    const containsSubagentActivities = useMemo(() => displayActivities.some((activity) => isSubagentActivity(activity)), [displayActivities])
    const header = useMemo(() => {
        if (containsSubagentActivities) {
            return displayActivities.length > 1 ? `Subagent Activity (${displayActivities.length})` : 'Subagent Activity'
        }
        return displayActivities.length > 1 ? `Tool Calls (${displayActivities.length})` : 'Tool Calls'
    }, [containsSubagentActivities, displayActivities.length])
    const hasMore = displayActivities.length > COLLAPSED_TOOL_CALL_COUNT
    const olderActivities = useMemo(
        () => hasMore ? displayActivities.slice(0, -COLLAPSED_TOOL_CALL_COUNT) : [],
        [displayActivities, hasMore]
    )
    const recentActivities = useMemo(
        () => hasMore ? displayActivities.slice(-COLLAPSED_TOOL_CALL_COUNT) : displayActivities,
        [displayActivities, hasMore]
    )
    useEffect(() => () => {
        if (olderUnmountTimerRef.current !== null) window.clearTimeout(olderUnmountTimerRef.current)
    }, [])
    const toggleOlderActivities = () => {
        if (olderUnmountTimerRef.current !== null) {
            window.clearTimeout(olderUnmountTimerRef.current)
            olderUnmountTimerRef.current = null
        }
        if (!expanded) {
            setOlderMounted(true)
            setExpanded(true)
            return
        }
        setExpanded(false)
        olderUnmountTimerRef.current = window.setTimeout(() => {
            olderUnmountTimerRef.current = null
            setOlderMounted(false)
        }, TOOL_CALL_DISCLOSURE_MS)
    }
    const renderActivity = (activity: AssistantActivity) => (
        <div key={activity.id}>
            {isSubagentActivity(activity) ? (
                <TimelineSubagentActivityCard activity={activity} />
            ) : (
                <TimelineToolCallCard
                    activity={activity}
                    runningCommandCount={activeRunningCommandCount}
                    projectRootPath={projectRootPath}
                    toolOutputDefaultMode={toolOutputDefaultMode}
                    onOpenFilePath={onOpenFilePath}
                    onViewDiff={onViewDiff}
                    onRevealActivity={onRevealActivity}
                />
            )}
        </div>
    )
    return (
        <div className="max-w-4xl py-2">
            <div className={cn(
                'overflow-hidden rounded-xl',
                containsSubagentActivities
                    ? 'border border-[color-mix(in_srgb,var(--accent-primary)_18%,var(--surface-divider))] bg-[color-mix(in_srgb,var(--accent-primary)_4%,var(--color-card))]'
                    : 'border border-[var(--surface-divider)] bg-[color-mix(in_srgb,var(--color-card)_58%,transparent)]'
            )}>
                <div className="flex items-center justify-between gap-2 px-2 pb-0 pt-1.5">
                    <div className="text-[9px] font-medium uppercase tracking-[0.22em] text-sparkle-text-muted">{header}</div>
                    {hasMore ? (
                        <button
                            type="button"
                            onClick={toggleOlderActivities}
                            className="rounded border border-[var(--surface-divider)] bg-[var(--surface-hover)] px-1.5 py-0.5 text-[9px] text-sparkle-text-muted transition-colors hover:border-[color-mix(in_srgb,var(--color-text)_18%,transparent)] hover:bg-[var(--surface-active)] hover:text-sparkle-text-secondary"
                            title={expanded ? `Show last ${COLLAPSED_TOOL_CALL_COUNT}` : 'Show all'}
                        >
                            {expanded ? `Show last ${COLLAPSED_TOOL_CALL_COUNT}` : `Show all ${displayActivities.length}`}
                        </button>
                    ) : null}
                </div>
                <div>
                    <AnimatedHeight isOpen={expanded} duration={TOOL_CALL_DISCLOSURE_MS}>
                        {olderMounted ? <div>{olderActivities.map(renderActivity)}</div> : null}
                    </AnimatedHeight>
                    {recentActivities.map(renderActivity)}
                </div>
            </div>
        </div>
    )
}, (prev, next) => {
    return prev.projectRootPath === next.projectRootPath
        && prev.runningCommandCount === next.runningCommandCount
        && prev.toolOutputDefaultMode === next.toolOutputDefaultMode
        && prev.onOpenFilePath === next.onOpenFilePath
        && prev.onViewDiff === next.onViewDiff
        && prev.onRevealActivity === next.onRevealActivity
        && areActivityListsEqual(prev.activities, next.activities)
})
