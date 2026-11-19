import type { AssistantHistoryPage, AssistantSnapshot } from '@shared/assistant/contracts'
import { compareAssistantTimelineOrderKeys, getAssistantTimelineOrderKey, type AssistantTimelineOrderKey, type AssistantTimelineRecordKind } from '@shared/assistant/timeline-order'
import { applyAssistantHistoryAnchorPage, type AssistantRetainedHistory } from './assistant-history-state'

/** A direct latest read replaces an old window, while retaining events that
 * arrived after the persisted page and fresher text from the same live reply. */
export function applyAssistantLatestHistoryPage(snapshot: AssistantSnapshot, current: AssistantRetainedHistory, page: AssistantHistoryPage) {
    const keys = [
        ...page.messages.map(record => getAssistantTimelineOrderKey('message', record)),
        ...page.activities.map(record => getAssistantTimelineOrderKey('activity', record)),
        ...page.proposedPlans.map(record => getAssistantTimelineOrderKey('plan', record))
    ]
    const newest = keys.reduce<AssistantTimelineOrderKey | null>((latest, key) => !latest || compareAssistantTimelineOrderKeys(key, latest) > 0 ? key : latest, null)
    const tail = <T extends { id: string }>(kind: AssistantTimelineRecordKind, incoming: T[], resident: T[]) => {
        const incomingIds = new Set(incoming.map(record => record.id))
        return [...incoming, ...resident.filter(record => !incomingIds.has(record.id) && (!newest || compareAssistantTimelineOrderKeys(getAssistantTimelineOrderKey(kind, record as never), newest) > 0))]
    }
    const liveMessages = new Map(current.messages.map(message => [message.id, message]))
    const liveActivities = new Map(current.activities.map(activity => [activity.id, activity]))
    const messages = tail('message', page.messages, current.messages).map(message => {
        const live = liveMessages.get(message.id)
        return live && Date.parse(live.updatedAt) > Date.parse(message.updatedAt) ? live : message
    })
    return applyAssistantHistoryAnchorPage(snapshot, current, {
        ...page,
        messages,
        activities: tail('activity', page.activities, current.activities).map(activity => {
            const live = liveActivities.get(activity.id)
            const liveEnd = Date.parse(String(live?.payload?.completedAt || ''))
            const pageEnd = Date.parse(String(activity.payload?.completedAt || ''))
            return live && ((Number.isFinite(liveEnd) && (!Number.isFinite(pageEnd) || liveEnd > pageEnd))
                || (live.payload?.toolLifecyclePhase === 'end' && activity.payload?.toolLifecyclePhase !== 'end')) ? live : activity
        }),
        proposedPlans: tail('plan', page.proposedPlans, current.proposedPlans)
    })
}
