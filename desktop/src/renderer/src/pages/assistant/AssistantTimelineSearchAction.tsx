import { useState } from 'react'
import { Search } from 'lucide-react'
import type { AssistantActivity } from '@shared/assistant/contracts'
import { AssistantTimelineActionShell } from './AssistantTimelineActionShell'
import { getAssistantActionTarget, getAssistantActionTitle } from './assistant-action-presentation'
import { getActivityElapsed, getActivityOutput, getActivityStatus } from './assistant-timeline-helpers'
import { useAssistantHydratedActivity } from './useAssistantHydratedActivity'

export function AssistantTimelineSearchAction(props: {
    activity: AssistantActivity
    projectRootPath?: string | null
    purposeTitle?: string | null
}) {
    const hydrated = useAssistantHydratedActivity(props.activity)
    const [expanded, setExpanded] = useState(false)
    const output = getActivityOutput(hydrated.activity)
    const toggle = async () => {
        if (!expanded) await hydrated.hydrate()
        setExpanded((current) => !current)
    }
    return (
        <AssistantTimelineActionShell
            activityId={props.activity.id}
            icon={<Search size={13} />}
            title={getAssistantActionTitle(hydrated.activity, props.projectRootPath, props.purposeTitle)}
            target={props.purposeTitle ? getAssistantActionTarget(hydrated.activity, props.projectRootPath) : null}
            createdAt={props.activity.createdAt}
            elapsed={getActivityElapsed(hydrated.activity)}
            status={getActivityStatus(hydrated.activity)}
            expandable={Boolean(output || hydrated.historyBodyRef || hydrated.error)}
            expanded={expanded}
            onToggle={() => { void toggle() }}
        >
            {hydrated.loading ? <p className="font-mono text-[10px] text-sparkle-text-muted">Loading captured results…</p> : null}
            {hydrated.error ? <p className="text-[10px] text-red-300/75">{hydrated.error}</p> : null}
            {output ? <pre className="custom-scrollbar max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/15 px-3 py-2 font-mono text-[10px] leading-5 text-sparkle-text-secondary">{output}</pre> : null}
        </AssistantTimelineActionShell>
    )
}
