import { memo } from 'react'
import { Check, ShieldAlert, ShieldCheck, X } from 'lucide-react'
import type { AssistantApprovalDecision, AssistantPendingApproval } from '@shared/assistant/contracts'
import { cn } from '@/lib/utils'

export const AssistantPendingApprovalPanel = memo(function AssistantPendingApprovalPanel(props: {
    pendingApprovals: AssistantPendingApproval[]
    responding: boolean
    onRespond: (requestId: string, decision: AssistantApprovalDecision) => Promise<void> | void
}) {
    const approval = props.pendingApprovals[0] || null
    if (!approval) return null

    const subject = approval.command || approval.detail || approval.paths?.join('\n') || 'This tool call can change local state.'
    const scopeLabel = approval.requestType === 'file-change'
        ? 'file changes'
        : approval.requestType === 'file-read'
            ? 'file reads'
            : 'commands'

    const respond = (decision: AssistantApprovalDecision) => {
        if (props.responding) return
        void props.onRespond(approval.requestId, decision)
    }

    return (
        <div className="pointer-events-auto mx-auto w-full max-w-[760px]" data-assistant-composer-hitbox="true">
            <section className="overflow-hidden rounded-[20px] border border-amber-400/20 bg-sparkle-card shadow-[0_22px_70px_rgba(0,0,0,0.34)]">
                <div className="flex items-start gap-3 border-b border-white/[0.07] px-4 py-4 sm:px-5">
                    <div className="mt-0.5 rounded-xl border border-amber-400/20 bg-amber-500/10 p-2 text-amber-200"><ShieldAlert size={17} /></div>
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-semibold text-sparkle-text">{approval.title || 'Tool approval required'}</h3>
                            {props.pendingApprovals.length > 1 ? <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[10px] text-sparkle-text-muted">{props.pendingApprovals.length} pending</span> : null}
                        </div>
                        <p className="mt-1 text-xs leading-5 text-sparkle-text-secondary">Zyra paused before this action ran.</p>
                    </div>
                </div>

                <div className="px-4 py-3 sm:px-5">
                    <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2.5 font-mono text-[11px] leading-5 text-sparkle-text-secondary">{subject}</pre>
                    {approval.paths?.length ? (
                        <p className="mt-2 truncate text-[10px] text-sparkle-text-muted" title={approval.paths.join('\n')}>{approval.paths.join(' · ')}</p>
                    ) : null}
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/[0.07] px-4 py-3 sm:px-5">
                    <ApprovalButton disabled={props.responding} icon={<X size={13} />} label="Deny" onClick={() => respond('decline')} />
                    <ApprovalButton disabled={props.responding} icon={<Check size={13} />} label="Allow once" onClick={() => respond('acceptOnce')} accent="safe" />
                    <ApprovalButton disabled={props.responding} icon={<ShieldCheck size={13} />} label={`Allow ${scopeLabel} for chat`} onClick={() => respond('acceptForSession')} accent="session" />
                </div>
            </section>
        </div>
    )
})

function ApprovalButton(props: { disabled: boolean; icon: React.ReactNode; label: string; onClick: () => void; accent?: 'safe' | 'session' }) {
    return (
        <button
            type="button"
            disabled={props.disabled}
            onClick={props.onClick}
            className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                props.accent === 'safe'
                    ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/15'
                    : props.accent === 'session'
                        ? 'border-sky-400/20 bg-sky-500/10 text-sky-100 hover:bg-sky-500/15'
                        : 'border-white/10 bg-white/[0.035] text-sparkle-text-secondary hover:bg-white/[0.06] hover:text-sparkle-text'
            )}
        >
            {props.icon}{props.label}
        </button>
    )
}
