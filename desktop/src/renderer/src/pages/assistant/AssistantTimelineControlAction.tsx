import { useState } from 'react'
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
import { useAssistantHydratedActivity } from './useAssistantHydratedActivity'
import { getActivityElapsed, getActivityStatus, getActivityOutput } from './assistant-timeline-helpers'

function stringValue(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function AssistantTimelineControlAction(props: {
    activity: AssistantActivity
    projectRootPath?: string | null
    onOpenUrl?: (url: string) => Promise<boolean | void> | boolean | void
}) {
    const [expanded, setExpanded] = useState(false)
    const hydrated = useAssistantHydratedActivity(props.activity)
    const output = expanded ? getActivityOutput(hydrated.activity).replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, '[Screenshot]').slice(0, 16000) : ''
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
            expandable
            expanded={expanded}
            onToggle={() => { setExpanded(value => !value); if (!expanded) void hydrated.hydrate() }}
        >
            {openUrl ? <button type="button" onClick={openUrl} className="mb-2 text-[11px] text-[var(--accent-primary)] hover:underline">Open page</button> : null}
            {hydrated.loading ? <p className="text-[11px] text-sparkle-text-muted">Loading action details…</p> : hydrated.error ? <p role="alert" className="text-[11px] text-[var(--status-danger)]">{hydrated.error}</p> : output ? <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-[10px] leading-5 text-sparkle-text-secondary">{output}</pre> : <p className="text-[11px] text-sparkle-text-muted">{props.activity.summary || getAssistantActionTitle(props.activity)}</p>}
        </AssistantTimelineActionShell>
    )
}
