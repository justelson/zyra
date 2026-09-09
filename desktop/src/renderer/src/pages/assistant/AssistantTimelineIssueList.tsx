import { memo, useCallback, useMemo, useState } from 'react'
import type { AssistantActivity } from '@shared/assistant/contracts'
import { cn } from '@/lib/utils'
import { areActivityListsEqual } from './assistant-timeline-helpers'
import {
    DismissedIssueRow,
    getIssueActivityDismissKey,
    groupIssueActivities,
    IssueLogDetailsModal,
    IssueLogRow,
    readPersistedIssueDismissState,
    type IssueDismissScope,
    type LogDetailsTab,
    writePersistedIssueDismissState
} from './AssistantPageHelpers'

export const TimelineIssueList = memo(({
    activities
}: {
    activities: AssistantActivity[]
}) => {
    const groupedActivities = useMemo(() => groupIssueActivities(activities), [activities])
    const [selectedLogActivity, setSelectedLogActivity] = useState<AssistantActivity | null>(null)
    const [selectedLogActivities, setSelectedLogActivities] = useState<AssistantActivity[] | null>(null)
    const [logDetailsTab, setLogDetailsTab] = useState<LogDetailsTab>('rendered')
    const [dismissedIssueKeys, setDismissedIssueKeys] = useState<string[]>(() => readPersistedIssueDismissState().keys)
    const [dismissedTones, setDismissedTones] = useState<Array<AssistantActivity['tone']>>(() => readPersistedIssueDismissState().tones)

    const handleShowLogDetails = useCallback((activity: AssistantActivity, detailActivities?: AssistantActivity[]) => {
        setSelectedLogActivity(activity)
        setSelectedLogActivities(detailActivities && detailActivities.length > 0 ? detailActivities : null)
        setLogDetailsTab('rendered')
    }, [])

    const handleDismissIssue = useCallback((activity: AssistantActivity, scope: IssueDismissScope) => {
        if (scope === 'tone') {
            setDismissedTones((current) => {
                const next = current.includes(activity.tone) ? current : [...current, activity.tone]
                writePersistedIssueDismissState({ keys: dismissedIssueKeys, tones: next })
                return next
            })
            return
        }
        const dismissKey = getIssueActivityDismissKey(activity)
        setDismissedIssueKeys((current) => {
            const next = current.includes(dismissKey) ? current : [...current, dismissKey]
            writePersistedIssueDismissState({ keys: next, tones: dismissedTones })
            return next
        })
    }, [dismissedIssueKeys, dismissedTones])

    const renderedGroups = useMemo(() => groupedActivities.map((group) => {
        const dismissKey = getIssueActivityDismissKey(group.activity)
        const dismissed = dismissedTones.includes(group.activity.tone) || dismissedIssueKeys.includes(dismissKey)
        return { ...group, dismissKey, dismissed }
    }), [dismissedIssueKeys, dismissedTones, groupedActivities])

    return (
        <>
            <div className="w-full max-w-4xl py-0.5">
                <div className={cn('w-full overflow-hidden')}>
                        {renderedGroups.map((group) => (
                            group.dismissed ? (
                                <DismissedIssueRow
                                    key={group.activity.id}
                                    activity={group.activity}
                                    activities={group.activities}
                                    count={group.count}
                                    onOpen={handleShowLogDetails}
                                />
                            ) : (
                            <IssueLogRow
                                key={group.activity.id}
                                activity={group.activity}
                                activities={group.activities}
                                count={group.count}
                                onDismiss={handleDismissIssue}
                                onShowMore={handleShowLogDetails}
                                compact
                            />
                            )
                        ))}
                </div>
            </div>
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
}, (prev, next) => areActivityListsEqual(prev.activities, next.activities))
