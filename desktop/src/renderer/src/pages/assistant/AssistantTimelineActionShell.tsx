import type { ReactNode } from 'react'
import { ChevronDown, Loader2 } from 'lucide-react'
import { AnimatedHeight } from '@/components/ui/AnimatedHeight'
import { cn } from '@/lib/utils'
import { getTimelineActivityDomId } from './assistant-timeline-helpers'

export function formatAssistantActionTime(value: string): string {
    const date = new Date(value)
    if (!Number.isFinite(date.getTime())) return ''
    const now = new Date()
    const sameDay = date.getFullYear() === now.getFullYear()
        && date.getMonth() === now.getMonth()
        && date.getDate() === now.getDate()
    return new Intl.DateTimeFormat(undefined, sameDay
        ? { hour: 'numeric', minute: '2-digit' }
        : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
    ).format(date)
}

export function AssistantTimelineActionShell(props: {
    activityId: string
    icon: ReactNode
    title: string
    target?: string | null
    createdAt: string
    elapsed?: string | null
    status: 'success' | 'running' | 'failed'
    expanded?: boolean
    expandable?: boolean
    onToggle?: () => void
    children?: ReactNode
}) {
    const actionable = Boolean(props.onToggle)
    const canToggle = Boolean(props.expandable && props.onToggle)
    const meta = [formatAssistantActionTime(props.createdAt), props.elapsed].filter(Boolean).join(' · ')
    return (
        <div id={getTimelineActivityDomId(props.activityId)} className="group/action" data-assistant-typed-action={props.activityId}>
            <button
                type="button"
                disabled={!actionable}
                onClick={props.onToggle}
                aria-expanded={canToggle ? props.expanded : undefined}
                className={cn(
                    'flex min-h-7 w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors',
                    actionable ? 'hover:bg-[var(--surface-hover)]' : 'cursor-default'
                )}
            >
                <span className={cn(
                    'inline-flex size-4 shrink-0 items-center justify-center',
                    props.status === 'running' ? 'text-[color-mix(in_srgb,var(--status-warning)_72%,var(--color-text))]'
                        : props.status === 'failed' ? 'text-[color-mix(in_srgb,var(--status-danger)_72%,var(--color-text))]'
                            : 'text-sparkle-text-muted'
                )}>
                    {props.status === 'running' ? <Loader2 size={13} className="animate-spin" /> : props.icon}
                </span>
                <span className={cn(
                    'min-w-0 flex-1 truncate text-[12px] font-medium leading-5 text-sparkle-text-secondary group-hover/action:text-sparkle-text',
                    props.status === 'running' && 'assistant-title-shimmer'
                )}>
                    {props.title}
                </span>
                {props.target ? (
                    <span className="hidden max-w-[34%] truncate rounded bg-[var(--surface-hover)] px-1.5 py-0.5 font-mono text-[9px] text-sparkle-text-muted sm:inline">
                        {props.target}
                    </span>
                ) : null}
                {meta ? <span className="shrink-0 font-mono text-[9px] tabular-nums text-sparkle-text-muted/70">{meta}</span> : null}
                {props.status === 'failed' ? <span className="size-1.5 shrink-0 rounded-full bg-[var(--status-danger)] opacity-70" aria-label="Failed" /> : null}
                {canToggle ? (
                    <ChevronDown size={11} className={cn('shrink-0 text-sparkle-text-muted transition-transform duration-200', props.expanded && 'rotate-180')} />
                ) : <span className="w-[11px] shrink-0" />}
            </button>
            <AnimatedHeight isOpen={Boolean(props.expanded && canToggle)} duration={220}>
                <div className="pb-2 pl-6 pr-1 pt-1">{props.children}</div>
            </AnimatedHeight>
        </div>
    )
}
