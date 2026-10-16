import { useCallback, useId, useState } from 'react'
import { ChevronDown, Globe2, Monitor, ShieldCheck, Square } from 'lucide-react'
import chromeLogo from '@/assets/browser-logos/chrome.svg'
import type { ControlStateSnapshot } from '@shared/agent-control/contracts'
import { cn } from '@/lib/utils'
import type { AssistantThreadControlSummary } from './assistant-thread-details'
import { controlTargetLabel } from './assistant-control-presentation'

function formatClock(value: string | null | undefined): string {
    if (!value) return ''
    const timestamp = Date.parse(value)
    if (!Number.isFinite(timestamp)) return ''
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(timestamp))
}

export function AssistantThreadDetailsComputerUse({
    controlState,
    threadControl,
    className
}: {
    controlState: ControlStateSnapshot | null
    threadControl: AssistantThreadControlSummary
    className?: string
}) {
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [advancedOpen, setAdvancedOpen] = useState(false)
    const setupId = useId()
    const pendingAction = threadControl.pendingActionApprovals[0] || null
    const pendingGrant = threadControl.pendingGrants[0] || null
    const hasPendingApproval = Boolean(pendingAction || pendingGrant)
    const targetById = new Map(threadControl.targets.map((target) => [target.targetId, target]))

    const run = useCallback(async (operation: () => Promise<{ success: boolean; error?: string } | unknown>) => {
        setBusy(true)
        setError(null)
        try {
            const result = await operation()
            const actionResult = result && typeof result === 'object'
                ? result as { success?: boolean; error?: unknown }
                : null
            if (actionResult?.success === false) {
                throw new Error(typeof actionResult.error === 'string' ? actionResult.error : 'The action could not be completed.')
            }
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'The action could not be completed.')
        } finally {
            setBusy(false)
        }
    }, [])

    return (
        <section className={cn('border-t border-white/[0.06]', className || 'mt-5 pt-4')} aria-labelledby="thread-control-heading">
            <div className="flex items-center justify-between gap-3">
                <h3 id="thread-control-heading" className="text-[10px] font-semibold text-sparkle-text-secondary">Computer use</h3>
                <span className={cn(
                    'inline-flex items-center gap-1.5 text-[8px] font-medium',
                    hasPendingApproval ? 'text-amber-200/75' : threadControl.activeGrants.length > 0 ? 'text-emerald-200/70' : 'text-sparkle-text-muted/40'
                )}>
                    <span className={cn('size-1 rounded-full', hasPendingApproval ? 'bg-amber-300' : threadControl.activeGrants.length > 0 ? 'bg-emerald-300' : 'bg-white/20')} />
                    {hasPendingApproval ? 'Review' : threadControl.activeGrants.length > 0 ? 'Active' : 'Idle'}
                </span>
            </div>

            {hasPendingApproval ? (
                <div className="mt-3 border-y border-amber-300/10 bg-amber-400/[0.025] py-2.5 text-[9px] leading-4 text-amber-100/65">
                    {pendingAction ? 'Review this critical action in chat.' : 'Review this computer-use request in chat.'}
                </div>
            ) : null}

            {threadControl.activeGrants.length > 0 ? (
                <div className="mt-3 divide-y divide-white/[0.05] border-y border-white/[0.055]">
                    {threadControl.activeGrants.map((grant) => {
                        const target = targetById.get(grant.targetId)
                        return (
                            <div key={grant.grantId} className="flex items-center gap-2.5 py-2.5">
                                {target?.kind === 'windows-window' ? <Monitor size={12} className="text-sparkle-text-muted/55" /> : <Globe2 size={12} className="text-sparkle-text-muted/55" />}
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-[10px] font-medium text-sparkle-text-secondary">{controlTargetLabel(target)}</p>
                                    <p className="mt-0.5 text-[8px] text-sparkle-text-muted/45">{Math.max(0, grant.maxActions - grant.actionCount)} actions left · until {formatClock(grant.expiresAt)}</p>
                                </div>
                                <button type="button" onClick={() => void run(() => window.devscope.agentControl.revokeGrant(grant.grantId))} className="text-[8px] font-medium text-sparkle-text-muted/55 hover:text-red-200">Stop</button>
                            </div>
                        )
                    })}
                </div>
            ) : !hasPendingApproval ? (
                <div className="mt-2.5 flex min-w-0 items-center gap-2.5 border-y border-white/[0.05] py-2.5">
                    <ShieldCheck size={12} className="shrink-0 text-sparkle-text-muted/45" />
                    <div className="min-w-0 flex-1">
                        <p className="text-[9px] font-medium text-sparkle-text-secondary/80">No active access</p>
                        {threadControl.latestEvent ? (
                            <p className="mt-0.5 truncate text-[8px] text-sparkle-text-muted/35">
                                Last {threadControl.latestEvent.actionType || threadControl.latestEvent.eventType.replace(/[.-]/g, ' ')} · {threadControl.latestEvent.outcome} · {formatClock(threadControl.latestEvent.occurredAt)}
                            </p>
                        ) : <p className="mt-0.5 text-[8px] text-sparkle-text-muted/35">This thread has no computer-control grant.</p>}
                    </div>
                </div>
            ) : null}

            {threadControl.activeGrants.length > 0 && threadControl.latestEvent ? (
                <p className="mt-2 truncate text-[8px] text-sparkle-text-muted/35">Last {threadControl.latestEvent.actionType || threadControl.latestEvent.eventType.replace(/[.-]/g, ' ')} · {threadControl.latestEvent.outcome} · {formatClock(threadControl.latestEvent.occurredAt)}</p>
            ) : null}

            <button
                type="button"
                onClick={() => setAdvancedOpen((current) => !current)}
                className="mt-2 flex w-full items-center justify-between gap-2 rounded-md py-2 text-[10px] font-medium text-sparkle-text-muted transition-colors hover:text-sparkle-text-secondary focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-primary)]"
                aria-expanded={advancedOpen}
                aria-controls={setupId}
            >
                <span>Setup</span>
                <ChevronDown size={12} className={cn('transition-transform duration-150 motion-reduce:transition-none', advancedOpen && 'rotate-180')} />
            </button>
            {advancedOpen ? (
                <div id={setupId} className="space-y-2 pb-1">
                    <div className="flex min-w-0 items-center gap-2.5 py-1">
                        <img src={chromeLogo} width={16} height={16} alt="" className="shrink-0" />
                        <span className="min-w-0 flex-1 text-[11px] font-medium text-sparkle-text-secondary">Chrome</span>
                        <button type="button" disabled={busy || controlState?.pairing.state === 'waiting'} onClick={() => void run(() => window.devscope.agentControl.startChromePairing())} className="inline-flex h-7 shrink-0 items-center justify-center rounded-md border border-[var(--surface-divider)] bg-[var(--surface-hover)] px-2.5 text-[10px] font-medium text-sparkle-text-secondary transition-colors hover:bg-[var(--surface-active)] hover:text-sparkle-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-primary)] disabled:cursor-default disabled:opacity-50">{controlState?.pairing.state === 'waiting' ? 'Waiting for Chrome' : 'Pair Chrome'}</button>
                    </div>
                    {controlState?.pairing.state === 'waiting' ? <div role="status" className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-md bg-[var(--surface-hover)] px-2.5 py-2"><span className="text-[10px] text-sparkle-text-muted">Pairing code <span className="ml-1.5 select-all font-mono font-medium tracking-wider text-sparkle-text-secondary">{controlState.pairing.code}</span></span><span className="text-[9px] text-sparkle-text-muted">Port {controlState.pairing.port}</span></div> : null}
                    {controlState?.active ? <button type="button" onClick={() => void run(() => window.devscope.agentControl.emergencyStop())} className="inline-flex min-h-7 items-center gap-1.5 rounded-md px-1 text-[10px] text-[var(--status-danger)] hover:bg-[color-mix(in_srgb,var(--status-danger)_8%,transparent)]"><Square size={11} />Stop all computer use</button> : null}
                </div>
            ) : null}
            {error ? <p role="alert" className="mt-2 text-[10px] leading-4 text-[var(--status-danger)]">{error}</p> : null}
        </section>
    )
}
