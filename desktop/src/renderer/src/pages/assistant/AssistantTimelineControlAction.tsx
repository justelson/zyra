import { Monitor, MousePointer2 } from 'lucide-react'
import type { AssistantActivity } from '@shared/assistant/contracts'
import { AssistantBrowserPageIcon } from './AssistantBrowserPageIcon'
import { AssistantTimelineActionShell } from './AssistantTimelineActionShell'
import {
    getAssistantActionFamily,
    getAssistantActionTarget,
    getAssistantActionTitle,
    getAssistantActivityArgs
} from './assistant-action-presentation'
import { getActivityElapsed, getActivityStatus } from './assistant-timeline-helpers'

function stringValue(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function AssistantTimelineControlAction(props: {
    activity: AssistantActivity
    projectRootPath?: string | null
    onOpenUrl?: (url: string) => Promise<boolean | void> | boolean | void
}) {
    const family = getAssistantActionFamily(props.activity)
    const browser = family === 'browser'
    const args = getAssistantActivityArgs(props.activity)
    const url = stringValue(props.activity.payload?.url) || stringValue(args.url)
    const faviconUrl = stringValue(props.activity.payload?.faviconUrl)
    const openUrl = browser && url && props.onOpenUrl ? () => { void props.onOpenUrl?.(url) } : undefined
    return (
        <AssistantTimelineActionShell
            activityId={props.activity.id}
            icon={browser
                ? url ? <AssistantBrowserPageIcon faviconUrl={faviconUrl} pageUrl={url} size={13} /> : <MousePointer2 size={13} />
                : <Monitor size={13} />}
            title={getAssistantActionTitle(props.activity, props.projectRootPath)}
            target={getAssistantActionTarget(props.activity, props.projectRootPath)}
            createdAt={props.activity.createdAt}
            elapsed={getActivityElapsed(props.activity)}
            status={getActivityStatus(props.activity)}
            onToggle={openUrl}
        />
    )
}
