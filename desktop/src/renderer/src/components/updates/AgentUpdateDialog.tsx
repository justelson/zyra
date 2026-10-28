import { useEffect, useId, useRef } from 'react'
import { CircleHelp, Loader2, MessageSquare, Server, ShieldQuestion, Square, Terminal, Wrench, X } from 'lucide-react'
import { NativeOverlayPortal, addOverlayEventListener } from '@/components/ui/native-overlay-portal'
import { SettingsInfoTooltip } from '@/pages/settings/SettingsInfoTooltip'
import type { AgentUpdatePlan } from '@shared/agent-update'
import './update-install-confirmation.css'

export const updateBlockerRows = [
    ['activeTurns', 'Running turns', MessageSquare], ['backgroundChats', 'Background work', Terminal],
    ['attention', 'Questions and approvals', ShieldQuestion], ['requests', 'In-flight requests', Loader2],
    ['workspaceRequests', 'Desktop operations', Wrench], ['externalTools', 'External tool sessions', Server]
] as const

export function AgentUpdateDialog({ plan, kind, busy = false, checking = false, error, onLater, onConfirm, onRefresh }: {
    plan: AgentUpdatePlan | null
    kind: 'install' | 'runtime'
    busy?: boolean
    checking?: boolean
    error?: string | null
    onLater: () => void
    onConfirm: (stopBlockers: boolean) => void
    onRefresh: () => void
}) {
    const ref = useRef<HTMLDialogElement>(null)
    const titleId = useId(), descriptionId = useId()
    const blocked = plan?.state === 'blocked'
    const canConfirm = plan && plan.state !== 'unknown' && !busy && !checking
    const cancel = () => { if (!busy) onLater() }
    useEffect(() => {
        const previous = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        const remove = addOverlayEventListener('keydown', event => {
            if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); if (!busy) onLater() }
        })
        return () => { remove(); document.body.style.overflow = previous }
    }, [busy, onLater])
    return <NativeOverlayPortal onReady={() => { if (ref.current && !ref.current.open) { ref.current.showModal(); ref.current.querySelector<HTMLButtonElement>('[data-update-later]')?.focus() } }}>
        <dialog ref={ref} className="update-install-confirmation" aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={busy || checking}
            onCancel={event => { event.preventDefault(); cancel() }}>
            <header>
                <div className="agent-update-heading"><h2 id={titleId}>{plan?.repair ? 'Repair installation?' : kind === 'install' ? 'Install update?' : 'Update agent?'}</h2>
                    <SettingsInfoTooltip label="About this update">{plan?.repair ? 'The prior agent has stopped. Repair replaces files without starting work. Later keeps the installation paused.' : 'Save unsent messages and unsaved edits first. Stop all ends agent-owned work in this installation only. Chat history stays. Later keeps work running.'}</SettingsInfoTooltip>
                </div>
                <button type="button" aria-label="Close update dialog" className="agent-update-close" disabled={busy} onClick={cancel}><X size={16} /></button>
                <p id={descriptionId}>{busy ? 'Preparing the agent for update.' : blocked ? 'Stop running work or update later.' : 'The agent is checked before installation.'}</p>
            </header>
            <div className="agent-update-content">
                <div className="agent-update-target"><Server size={15} /><span>{kind === 'install' ? 'App + agent' : 'Agent only'}</span><span className="agent-update-version">{plan?.version ? `v${plan.version}` : checking ? 'Checking…' : 'Installed code'}</span></div>
                {checking ? <div className="agent-update-check"><Loader2 size={15} className="animate-spin" />Checking update blockers…</div>
                    : plan?.state === 'unknown' || !plan ? <div className="agent-update-check"><CircleHelp size={16} /><span>Agent status is unconfirmed.</span><SettingsInfoTooltip label="Why the update is blocked">{plan?.message || 'Refresh to confirm the selected agent. Installation stays blocked until its status is known.'}</SettingsInfoTooltip></div>
                    : blocked ? <ul className="agent-update-blockers" aria-label="Update blockers">{updateBlockerRows.map(([key, label, Icon]) => {
                        const count = plan.activity?.[key] || 0
                        return count > 0 ? <li key={key}><Icon size={14} /><span>{label}</span><span className="agent-update-count">{count}</span></li> : null
                    })}</ul>
                    : <div className="agent-update-check agent-update-ready"><span className="agent-update-ready-dot" />{plan.repair ? 'Agent stopped. Ready to repair.' : 'No blocking work.'}</div>}
                {error ? <div role="alert" className="agent-update-error"><span>Update did not start.</span><SettingsInfoTooltip label="Update error">{error}</SettingsInfoTooltip></div> : null}
            </div>
            <footer>
                <button type="button" data-update-later onClick={cancel} autoFocus disabled={busy}>Later</button>
                {plan?.state === 'unknown' || !plan ? <button type="button" disabled={checking || busy} onClick={onRefresh}>Check again</button>
                    : <button type="button" className={`update-install-confirm ${blocked ? 'agent-update-stop' : ''}`} disabled={!canConfirm} onClick={() => onConfirm(blocked)}>
                        {busy ? <Loader2 size={14} className="animate-spin" /> : blocked ? <Square size={12} /> : <Server size={14} />}
                        {busy ? 'Preparing…' : blocked ? 'Stop all and update' : plan?.repair ? 'Repair and restart' : kind === 'install' ? 'Restart and install' : 'Update agent'}
                    </button>}
            </footer>
        </dialog>
    </NativeOverlayPortal>
}
