import { memo, useId, useRef } from 'react'
import { Check, ChevronDown, FileText, LoaderCircle, ShieldAlert, ShieldCheck, Terminal, X } from 'lucide-react'
import type { AssistantApprovalDecision, AssistantPendingApproval } from '@shared/assistant/contracts'
import { FileActionsMenu } from '@/components/ui/FileActionsMenu'
import { compactApprovalGrantLabel, getApprovalPresentation, type ApprovalPathPresentation } from './assistant-approval-presentation'
import { ApprovalExpandableText } from './ApprovalExpandableText'
import { AssistantComposerAttentionShelf } from './AssistantComposerAttentionShelf'

export const AssistantPendingApprovalPanel = memo(function AssistantPendingApprovalPanel(props: {
    pendingApprovals: AssistantPendingApproval[]
    responding: boolean
    onRespond: (requestId: string, decision: AssistantApprovalDecision) => Promise<void> | void
}) {
    const headingId = useId()
    const actionAnchor = useRef<HTMLDivElement>(null)
    const pending = props.pendingApprovals.filter(entry => entry.status === 'pending')
    const approval = pending[0]
    if (!approval) return null
    const presentation = getApprovalPresentation(approval)
    const respond = (decision: AssistantApprovalDecision) => {
        if (!props.responding) void props.onRespond(approval.requestId, decision)
    }

    return (
        <AssistantComposerAttentionShelf title="Permissions">
            <section key={approval.requestId} aria-label="Action approval" aria-labelledby={headingId} aria-busy={props.responding}
                className="text-sparkle-text" data-permission-tray="true">
                <header className="flex items-start gap-2.5 px-3 pb-2 pt-2">
                    <ShieldAlert size={17} className="mt-0.5 shrink-0 text-[var(--status-warning)]" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                        <h3 id={headingId} className="text-[13px] font-semibold leading-5">{presentation.title}</h3>
                        <p role="status" className="mt-0.5 text-[11px] leading-4 text-sparkle-text-secondary">
                            {props.responding ? 'Saving your choice…' : 'This action has not run.'}
                        </p>
                    </div>
                    {pending.length > 1 ? <span className="shrink-0 pt-0.5 text-[11px] tabular-nums text-sparkle-text-muted" title={`${pending.length} actions need approval`}>1 of {pending.length}</span> : null}
                </header>

                <div className="custom-scrollbar max-h-[min(18rem,36vh)] space-y-2.5 overflow-auto overscroll-contain px-3 pb-2">
                    {presentation.command ? (
                        <div className="overflow-hidden rounded-md border border-[var(--surface-divider)] bg-[var(--surface-chrome)]">
                            <div className="flex items-center gap-1.5 px-3 pt-2 text-[10px] text-sparkle-text-muted"><Terminal size={12} aria-hidden="true" />Command</div>
                            <div className="px-3 pb-2.5 pt-1"><ApprovalExpandableText text={presentation.command} command /></div>
                        </div>
                    ) : null}
                    {presentation.detail ? <ApprovalExpandableText text={presentation.detail} /> : null}
                    {presentation.paths.length ? presentation.command ? (
                        <details className="text-[11px] text-sparkle-text-muted">
                            <summary className="w-fit cursor-pointer py-0.5 hover:text-sparkle-text">Referenced paths · {presentation.paths.length}</summary>
                            <div className="mt-2"><ApprovalPaths paths={presentation.paths} /></div>
                        </details>
                    ) : <ApprovalPaths paths={presentation.paths} /> : null}
                </div>

                <footer className="flex items-center justify-between gap-3 border-t border-[var(--surface-divider)] px-3 py-2">
                    <button type="button" disabled={props.responding} onClick={() => respond('decline')}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--surface-divider)] px-3 text-xs font-medium text-sparkle-text-secondary transition-colors hover:bg-[var(--surface-hover)] hover:text-sparkle-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)] disabled:cursor-not-allowed disabled:opacity-45">
                        <X size={13} aria-hidden="true" />Deny
                    </button>
                    <div ref={actionAnchor} data-approval-actions="true" className="inline-flex shrink-0 items-stretch rounded-md bg-[var(--accent-primary)] text-[var(--accent-contrast)]">
                        <button type="button" disabled={props.responding} onClick={() => respond('acceptOnce')}
                            className="inline-flex h-8 items-center gap-1.5 rounded-l-md px-3 text-xs font-semibold transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)] disabled:cursor-not-allowed disabled:opacity-45">
                            {props.responding ? <LoaderCircle size={13} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Check size={13} aria-hidden="true" />}Allow once
                        </button>
                        <FileActionsMenu
                            title="Other approval options"
                            containEscape
                            disabled={props.responding}
                            preferredDirection="up"
                            density="compact"
                            anchorRef={actionAnchor}
                            matchTriggerWidth
                            buttonClassName="h-8 w-8 rounded-l-none rounded-r-md border-l border-black/15 text-[var(--accent-contrast)] hover:bg-white/10 hover:text-[var(--accent-contrast)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)] disabled:cursor-not-allowed disabled:opacity-45"
                            openButtonClassName="bg-white/10 text-[var(--accent-contrast)]"
                            triggerIcon={<ChevronDown size={14} aria-hidden="true" />}
                            items={[{ id: 'allow-for-chat', label: compactApprovalGrantLabel(presentation.grantLabel), ariaLabel: presentation.grantLabel, icon: <ShieldCheck size={14} />, onSelect: () => respond('acceptForSession'), disabled: props.responding }]}
                        />
                    </div>
                </footer>
            </section>
        </AssistantComposerAttentionShelf>
    )
})

function ApprovalPaths({ paths }: { paths: ApprovalPathPresentation[] }) {
    return <ul aria-label="File targets" className="max-h-40 divide-y divide-[var(--surface-divider)] overflow-auto rounded-md border border-[var(--surface-divider)] bg-[var(--surface-chrome)]">
        {paths.map(path => <li key={path.path} className="flex min-w-0 items-start gap-2.5 px-3 py-2.5" title={path.path}>
            <FileText size={16} className="mt-0.5 shrink-0 text-sparkle-text-muted" aria-hidden="true" />
            <div className="min-w-0 flex-1 select-text">
                <p className="truncate text-[12px] font-medium leading-5 text-sparkle-text">{path.name}</p>
                {path.directory ? <p className="truncate font-mono text-[11px] leading-4 text-sparkle-text-secondary">{path.directory}</p> : null}
            </div>
        </li>)}
    </ul>
}
