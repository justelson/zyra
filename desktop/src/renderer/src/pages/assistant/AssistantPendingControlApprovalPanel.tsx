import { useEffect, useMemo, useState } from 'react'
import { Check, ShieldAlert, X } from 'lucide-react'
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

    const pendingCount = props.pendingActions.length + props.pendingGrants.length
    const title = pendingAction
        ? `Approve ${controlSideEffectLabel(pendingAction.sideEffect)}?`
        : `Allow Zyra to use ${controlTargetLabel(target)}?`
    const description = pendingAction
        ? `Zyra is ready to ${controlSideEffectLabel(pendingAction.sideEffect)} on ${controlTargetLabel(target)}. This action needs your attention even in Full access.`
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

    return (
        <div className="pointer-events-auto mx-auto w-full max-w-[760px]" data-assistant-composer-hitbox="true">
            <section className="overflow-hidden rounded-[20px] border border-amber-400/20 bg-sparkle-card shadow-[0_22px_70px_rgba(0,0,0,0.34)]" aria-label="Computer-use approval">
                <div className="flex items-start gap-3 border-b border-white/[0.07] px-4 py-4 sm:px-5">
                    <div className="mt-0.5 rounded-xl border border-amber-400/20 bg-amber-500/10 p-2 text-amber-200"><ShieldAlert size={17} /></div>
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-semibold text-sparkle-text">{title}</h3>
                            {pendingCount > 1 ? <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[10px] text-sparkle-text-muted">{pendingCount} pending</span> : null}
                        </div>
                        <p className="mt-1 text-xs leading-5 text-sparkle-text-secondary">{description}</p>
                    </div>
                </div>
                <div className="px-4 py-3 sm:px-5">
                    <p className="rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2.5 text-[11px] leading-5 text-sparkle-text-secondary">{scope}</p>
                    {error ? <p className="mt-2 text-[11px] text-red-200" role="alert">{error}</p> : null}
                </div>
                <div className="flex items-center justify-end gap-2 border-t border-white/[0.07] px-4 py-3 sm:px-5">
                    <button type="button" disabled={responding} onClick={() => void respond(false)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.035] px-3 text-xs font-medium text-sparkle-text-secondary hover:bg-white/[0.06] disabled:opacity-50"><X size={13} />Deny</button>
                    <button type="button" disabled={responding} onClick={() => void respond(true)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-3 text-xs font-medium text-emerald-100 hover:bg-emerald-500/15 disabled:opacity-50"><Check size={13} />{pendingAction ? 'Allow this action' : 'Allow for this task'}</button>
                </div>
            </section>
        </div>
    )
}
