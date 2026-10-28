import { ListFilter } from 'lucide-react'
import type { AssistantActivity } from '@shared/assistant/contracts'
import { AssistantTimelineActionShell } from './AssistantTimelineActionShell'
import { getActivityElapsed, getActivityStatus } from './assistant-timeline-helpers'

/** Never hydrate or mount tool-definition payloads in the chat timeline. */
export function AssistantTimelineToolDiscovery({ activity }: { activity: AssistantActivity }) {
    const status = getActivityStatus(activity)
    return <AssistantTimelineActionShell
        activityId={activity.id}
        icon={<ListFilter size={13} />}
        title={status === 'failed' ? "Couldn't get available tools" : 'Getting available tools'}
        createdAt={activity.createdAt}
        elapsed={getActivityElapsed(activity)}
        status={status}
    />
}
