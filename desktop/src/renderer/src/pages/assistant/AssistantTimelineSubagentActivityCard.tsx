import { memo, useMemo, useState } from 'react'
import { Bot, ChevronDown } from 'lucide-react'
import type { AssistantActivity } from '@shared/assistant/contracts'
import { AnimatedHeight } from '@/components/ui/AnimatedHeight'
import { cn } from '@/lib/utils'
import { formatAssistantDateTime } from '@/lib/assistant/selectors'
import {
    areActivitiesEquivalent,
    getActivityElapsed,
    getActivityStatus,
    getActivityTitle,
    getSubagentActivityModel,
    getSubagentActivityPrompt,
    getSubagentActivityReasoning,
    getSubagentActivityTargets,
    getSubagentActivityThreadLabels
} from './assistant-timeline-helpers'

export const TimelineSubagentActivityCard = memo(({
    activity
}: {
    activity: AssistantActivity
}) => {
    const [expanded, setExpanded] = useState(activity.kind === 'subagent.send-input')
    const title = useMemo(() => getActivityTitle(activity), [activity])
    const status = useMemo(() => getActivityStatus(activity), [activity])
    const elapsed = useMemo(() => getActivityElapsed(activity), [activity])
    const targets = useMemo(() => getSubagentActivityTargets(activity), [activity])
    const prompt = useMemo(() => getSubagentActivityPrompt(activity), [activity])
    const model = useMemo(() => getSubagentActivityModel(activity), [activity])
    const reasoning = useMemo(() => getSubagentActivityReasoning(activity), [activity])
    const threadLabels = useMemo(() => getSubagentActivityThreadLabels(activity), [activity])
    const hasExpandedContent = Boolean(prompt || model || reasoning || threadLabels.length > 0)

    return (
        <div className="px-2 py-1.5">
            <div className="overflow-hidden rounded-xl border border-[color-mix(in_srgb,var(--accent-primary)_20%,var(--surface-divider))] bg-[color-mix(in_srgb,var(--accent-primary)_5%,var(--color-card))]">
                <button
                    type="button"
                    onClick={() => {
                        if (hasExpandedContent) setExpanded((current) => !current)
                    }}
                    className={cn(
                        'flex w-full items-start gap-3 px-3 py-3 text-left transition-colors',
                        hasExpandedContent && 'hover:bg-[var(--surface-hover)]'
                    )}
                >
                    <span className={cn(
                        'mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border',
                        status === 'running'
                            ? 'border-[color-mix(in_srgb,var(--status-info)_24%,transparent)] bg-[color-mix(in_srgb,var(--status-info)_12%,transparent)] text-[color-mix(in_srgb,var(--status-info)_70%,var(--color-text))]'
                            : status === 'failed'
                                ? 'border-[color-mix(in_srgb,var(--status-danger)_24%,transparent)] bg-[color-mix(in_srgb,var(--status-danger)_12%,transparent)] text-[color-mix(in_srgb,var(--status-danger)_70%,var(--color-text))]'
                                : 'border-[color-mix(in_srgb,var(--accent-primary)_24%,transparent)] bg-[color-mix(in_srgb,var(--accent-primary)_12%,transparent)] text-[color-mix(in_srgb,var(--accent-primary)_70%,var(--color-text))]'
                    )}>
                        <Bot size={14} />
                    </span>
                    <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <p className="min-w-0 flex-1 truncate text-[12px] font-medium text-sparkle-text">{title}</p>
                            <span className={cn(
                                'rounded-full px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.14em]',
                                status === 'running'
                                    ? 'bg-[color-mix(in_srgb,var(--status-info)_12%,transparent)] text-[color-mix(in_srgb,var(--status-info)_70%,var(--color-text))]'
                                    : status === 'failed'
                                        ? 'bg-[color-mix(in_srgb,var(--status-danger)_12%,transparent)] text-[color-mix(in_srgb,var(--status-danger)_70%,var(--color-text))]'
                                        : 'bg-[color-mix(in_srgb,var(--accent-primary)_12%,transparent)] text-[color-mix(in_srgb,var(--accent-primary)_70%,var(--color-text))]'
                            )}>
                                {status === 'running' ? 'Running' : status === 'failed' ? 'Failed' : 'Completed'}
                            </span>
                        </div>
                        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-sparkle-text-muted/65">
                            {targets.length > 0 ? <span className="truncate">Targets: {targets.join(', ')}</span> : null}
                            {elapsed ? <span>{elapsed}</span> : null}
                            {!targets.length && !elapsed ? <span>Subagent orchestration event</span> : null}
                        </div>
                    </div>
                    {hasExpandedContent ? (
                        <ChevronDown size={12} className={cn('mt-1 shrink-0 text-sparkle-text-muted transition-transform', expanded && 'rotate-180')} />
                    ) : null}
                </button>
                <AnimatedHeight isOpen={expanded && hasExpandedContent} duration={220}>
                    <div className="border-t border-[var(--surface-divider)] px-3 pb-3 pt-2">
                        <p className="text-[10px] text-sparkle-text-muted">{formatAssistantDateTime(activity.createdAt)}</p>
                        {threadLabels.length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                {threadLabels.map((entry, index) => (
                                    <span
                                        key={`${activity.id}-target-${entry.threadId || index}`}
                                        className="inline-flex items-center gap-1 rounded-full border border-[var(--surface-divider)] bg-[color-mix(in_srgb,var(--color-bg)_72%,var(--color-card))] px-2 py-1 text-[10px] text-sparkle-text-secondary"
                                        title={entry.role || entry.nickname || entry.label}
                                    >
                                        <span className={cn(
                                            'h-1.5 w-1.5 rounded-full',
                                            entry.state === 'running' || entry.state === 'waiting' ? 'bg-[var(--status-info)]'
                                                : entry.state === 'error' ? 'bg-[var(--status-danger)]'
                                                    : 'bg-[var(--accent-primary)]'
                                        )} />
                                        <span className="max-w-[220px] truncate">{entry.label}</span>
                                    </span>
                                ))}
                            </div>
                        ) : null}
                        {prompt ? (
                            <div className="mt-2 rounded-lg border border-[var(--surface-divider)] bg-[color-mix(in_srgb,var(--color-bg)_72%,var(--color-card))] px-2.5 py-2">
                                <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-sparkle-text-muted">Prompt</p>
                                <p className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-5 text-sparkle-text-secondary">{prompt}</p>
                            </div>
                        ) : null}
                        {model || reasoning ? (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                {model ? <span className="rounded-full border border-[var(--surface-divider)] bg-[var(--surface-hover)] px-2 py-0.5 text-[10px] text-sparkle-text-secondary">Model: {model}</span> : null}
                                {reasoning ? <span className="rounded-full border border-[var(--surface-divider)] bg-[var(--surface-hover)] px-2 py-0.5 text-[10px] text-sparkle-text-secondary">Reasoning: {reasoning}</span> : null}
                            </div>
                        ) : null}
                    </div>
                </AnimatedHeight>
            </div>
        </div>
    )
}, (prev, next) => areActivitiesEquivalent(prev.activity, next.activity))
