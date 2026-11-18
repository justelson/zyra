import { useEffect, useMemo, useState } from 'react'
import { AssistantPermissionQuestion } from './AssistantPermissionQuestion'
import type {
    ControlPendingActionApproval,
    ControlPendingGrant,
    ControlTarget
} from '@shared/agent-control/contracts'
import {
    controlCapabilitySummary,
    controlSideEffectLabel,
    controlTargetLabel,
    controlTargetScope
} from './assistant-control-presentation'

export function AssistantPendingControlApprovalPanel(props: {
    pendingActions: ControlPendingActionApproval[]
    pendingGrants: ControlPendingGrant[]
    targets: ControlTarget[]
}) {
    const pendingAction = props.pendingActions[0] || null
    const pendingGrant = pendingAction ? null : props.pendingGrants[0] || null
    const pending = pendingAction || pendingGrant
    const [responding, setResponding] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const target = useMemo(
        () => props.targets.find((entry) => entry.targetId === pending?.targetId),
        [pending?.targetId, props.targets]
    )

    useEffect(() => {
        setResponding(false)
        setError(null)
    }, [pending?.requestId])

    if (!pending) return null

    const title = pendingAction
        ? `Allow ${controlSideEffectLabel(pendingAction.sideEffect)} on ${controlTargetLabel(target)}?`
        : `Allow ${controlCapabilitySummary(pendingGrant?.capabilities || [])} on ${controlTargetLabel(target)}?`
    const description = pendingAction
        ? `Zyra is ready to ${controlSideEffectLabel(pendingAction.sideEffect)} on ${controlTargetLabel(target)}. This action needs your attention in the current permission mode.`
        : `${pendingGrant?.principal.type === 'agent' ? 'A child agent' : 'This chat'} wants to ${controlCapabilitySummary(pendingGrant?.capabilities || [])}. Access stays limited to this target and expires automatically.`
    const targetScope = controlTargetScope(target)
    const scope = [
        controlTargetLabel(target),
        targetScope,
        pendingAction
            ? pendingAction.actionType
            : `${pendingGrant?.maxActions || 0} operation${pendingGrant?.maxActions === 1 ? '' : 's'} maximum`
    ].filter(Boolean).join(' · ')

    const respond = async (approved: boolean) => {
        if (responding) return
        setResponding(true)
        setError(null)
        try {
            const result = pendingAction
                ? approved
                    ? await window.devscope.agentControl.approveAction(pendingAction.requestId)
                    : await window.devscope.agentControl.rejectAction(pendingAction.requestId)
                : approved
                    ? await window.devscope.agentControl.approveGrant({
                        pendingRequestId: pendingGrant!.requestId,
                        targetId: pendingGrant!.targetId,
                        capabilities: pendingGrant!.capabilities,
                        durationMs: Math.max(1_000, Date.parse(pendingGrant!.expiresAt) - Date.now()),
                        maxActions: pendingGrant!.maxActions,
                        allowedOrigins: pendingGrant!.allowedOrigins,
                        allowedExecutableIdentities: pendingGrant!.allowedExecutableIdentities
                    })
                    : await window.devscope.agentControl.rejectGrant(pendingGrant!.requestId)
            if (!result.success) throw new Error(result.error || 'The permission response could not be saved.')
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'The permission response could not be saved.')
            setResponding(false)
        }
    }

    return <AssistantPermissionQuestion key={pending.requestId} title={title} busy={responding}
        details={<>{scope}{error && <p role="alert">{error}</p>}</>}
        choices={[{ label: 'Deny', description: 'Keep the current access.' }, { label: pendingAction ? 'Allow this action' : 'Allow for this task', description }]}
        onAnswer={label => respond(label !== 'Deny')} />
}
