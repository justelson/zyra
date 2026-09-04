import { Waypoints } from 'lucide-react'
import type { AssistantActivity } from '@shared/assistant/contracts'
import { AssistantAgentAvatar } from './AssistantAgentPrimitives'
import { resolveAssistantAgentIdentity } from './assistant-agent-presentation'
import { AssistantTimelineActionShell } from './AssistantTimelineActionShell'
import {
    getAssistantActionFamily,
    getAssistantActionTitle,
    getAssistantAgentActionEvidence
} from './assistant-action-presentation'
import { requestAssistantInspectorNavigation } from './assistant-inspector-navigation'
import { formatWorkingTimer, getActivityElapsed, getActivityStatus } from './assistant-timeline-helpers'
import { useAssistantHydratedActivity } from './useAssistantHydratedActivity'

export function AssistantTimelineAgentAction(props: {
    activity: AssistantActivity
    projectRootPath?: string | null
    purposeTitle?: string | null
}) {
    const hydrated = useAssistantHydratedActivity(props.activity)
    const evidence = getAssistantAgentActionEvidence(hydrated.activity)
    const family = getAssistantActionFamily(hydrated.activity)
    const workflow = family === 'workflow'
    const source = {
        agentRunId: evidence.runId || props.activity.id,
        agentId: evidence.definitionName || 'agent',
        definitionName: evidence.definitionName || 'agent',
        label: evidence.label || evidence.definitionName || 'Agent',
        goal: evidence.goal || evidence.label || ''
    }
    const identity = resolveAssistantAgentIdentity(source)
    const elapsed = evidence.elapsedMs !== null
        ? formatWorkingTimer(new Date(0).toISOString(), new Date(evidence.elapsedMs).toISOString())
        : getActivityElapsed(hydrated.activity)
    const canOpenInspector = Boolean(evidence.runId || hydrated.historyBodyRef)
    const openInspector = canOpenInspector ? async () => {
        const activity = evidence.runId ? hydrated.activity : await hydrated.hydrate()
        const resolvedEvidence = getAssistantAgentActionEvidence(activity)
        if (!resolvedEvidence.runId) return
        requestAssistantInspectorNavigation(workflow
            ? { workspace: 'agents', workflowRunId: resolvedEvidence.runId }
            : { workspace: 'agents', agentRunId: resolvedEvidence.runId }
        )
    } : undefined

    return (
        <AssistantTimelineActionShell
            activityId={props.activity.id}
            icon={workflow ? <Waypoints size={13} /> : <AssistantAgentAvatar run={source} size={16} />}
            title={getAssistantActionTitle(hydrated.activity, props.projectRootPath, props.purposeTitle)}
            target={workflow
                ? evidence.label || evidence.definitionName || 'workflow'
                : `${identity.name} · ${identity.roleTitle}`}
            createdAt={props.activity.createdAt}
            elapsed={elapsed}
            status={getActivityStatus(hydrated.activity)}
            onToggle={openInspector ? () => { void openInspector() } : undefined}
        />
    )
}
