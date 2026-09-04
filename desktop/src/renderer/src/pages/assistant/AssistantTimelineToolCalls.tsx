import { memo, useMemo } from 'react'
import type { AssistantActivity } from '@shared/assistant/contracts'
import type { AssistantChatDisplayMode, AssistantToolOutputDefaultMode } from '@/lib/settings'
import type { AssistantDiffTarget } from './assistant-diff-types'
import {
    areActivityListsEqual,
    countRunningCommandActivities,
    getActivityPaths,
    getCreatedFilePaths
} from './assistant-timeline-helpers'
import { getAssistantActionFamily } from './assistant-action-presentation'
import { AssistantTimelineAgentAction } from './AssistantTimelineAgentAction'
import { AssistantTimelineControlAction } from './AssistantTimelineControlAction'
import { AssistantTimelineReadAction } from './AssistantTimelineReadAction'
import { AssistantTimelineSearchAction } from './AssistantTimelineSearchAction'
import { AssistantTimelineSkillAction } from './AssistantTimelineSkillAction'
import { AssistantTimelineWebAction } from './AssistantTimelineWebAction'
import { TimelineToolCallCard } from './AssistantTimelineToolCallCard'

function normalizeTimelineFilePath(value: string): string {
    return value.trim().replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase()
}

function buildDisplayActivityList(activities: AssistantActivity[]): AssistantActivity[] {
    const seenFilePaths = new Set<string>()

    return activities.flatMap((activity) => {
        if (activity.kind !== 'file-change') return [activity]

        const filePaths = getActivityPaths(activity)
        if (filePaths.length === 0) return [activity]
        const supplementalTurnDiff = activity.payload?.category === 'turn-diff'
            || activity.payload?.source === 'turn-final'
        if (!supplementalTurnDiff) {
            for (const filePath of filePaths) {
                const comparablePath = normalizeTimelineFilePath(filePath)
                if (comparablePath) seenFilePaths.add(comparablePath)
            }
            return [activity]
        }

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
    displayMode = 'detailed',
    runningCommandCount,
    projectRootPath,
    toolOutputDefaultMode = 'expanded',
    purposeTitle,
    onOpenFilePath,
    onOpenUrl,
    onViewDiff,
    onRevealActivity
}: {
    activities: AssistantActivity[]
    displayMode?: AssistantChatDisplayMode
    runningCommandCount?: number
    projectRootPath?: string | null
    toolOutputDefaultMode?: AssistantToolOutputDefaultMode
    purposeTitle?: string | null
    onOpenFilePath?: (filePath: string) => Promise<void> | void
    onOpenUrl?: (url: string) => Promise<boolean | void> | boolean | void
    onViewDiff?: (target: AssistantDiffTarget) => void
    onRevealActivity?: (activityId: string) => void
}) => {
    const displayActivities = useMemo(() => buildDisplayActivityList(activities), [activities])
    const localRunningCommandCount = useMemo(() => countRunningCommandActivities(displayActivities), [displayActivities])
    const activeRunningCommandCount = runningCommandCount ?? localRunningCommandCount
    const inheritedPurpose = displayActivities.length === 1 ? purposeTitle : null

    return (
        <div className="max-w-4xl space-y-0.5 py-0.5" data-assistant-tool-call-list={displayMode}>
            {displayActivities.map((activity) => {
                const family = getAssistantActionFamily(activity)
                const common = { activity, projectRootPath, purposeTitle: inheritedPurpose }
                return (
                    <div key={activity.id}>
                        {family === 'web-search' || family === 'web-fetch' ? (
                            <AssistantTimelineWebAction {...common} onOpenUrl={onOpenUrl} />
                        ) : family === 'skill' ? (
                            <AssistantTimelineSkillAction {...common} />
                        ) : family === 'read' ? (
                            <AssistantTimelineReadAction {...common} />
                        ) : family === 'agent' || family === 'workflow' ? (
                            <AssistantTimelineAgentAction {...common} />
                        ) : family === 'browser' || family === 'computer' ? (
                            <AssistantTimelineControlAction {...common} onOpenUrl={onOpenUrl} />
                        ) : family === 'search' ? (
                            <AssistantTimelineSearchAction {...common} />
                        ) : (
                            <TimelineToolCallCard
                                activity={activity}
                                displayMode={displayMode}
                                runningCommandCount={activeRunningCommandCount}
                                projectRootPath={projectRootPath}
                                toolOutputDefaultMode={toolOutputDefaultMode}
                                purposeTitle={inheritedPurpose}
                                onOpenFilePath={onOpenFilePath}
                                onOpenUrl={onOpenUrl}
                                onViewDiff={onViewDiff}
                                onRevealActivity={onRevealActivity}
                            />
                        )}
                    </div>
                )
            })}
        </div>
    )
}, (prev, next) => {
    return prev.projectRootPath === next.projectRootPath
        && prev.displayMode === next.displayMode
        && prev.runningCommandCount === next.runningCommandCount
        && prev.toolOutputDefaultMode === next.toolOutputDefaultMode
        && prev.purposeTitle === next.purposeTitle
        && prev.onOpenFilePath === next.onOpenFilePath
        && prev.onOpenUrl === next.onOpenUrl
        && prev.onViewDiff === next.onViewDiff
        && prev.onRevealActivity === next.onRevealActivity
        && areActivityListsEqual(prev.activities, next.activities)
})
