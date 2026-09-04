import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronRight, ListTree, Loader2 } from 'lucide-react'
import type { AssistantActivity } from '@shared/assistant/contracts'
import { AnimatedHeight } from '@/components/ui/AnimatedHeight'
import { cn } from '@/lib/utils'
import { getAssistantActionTitle } from './assistant-action-presentation'
import { formatAssistantActionTime } from './AssistantTimelineActionShell'
import { getActivityElapsed, getActivityStatus } from './assistant-timeline-helpers'
import { requestAssistantTimelineDisclosureAnchor } from './assistant-timeline-scroll-events'

const ACTION_BATCH_MOTION_MS = 220

export function AssistantTimelineActionBatch(props: {
    activities: AssistantActivity[]
    projectRootPath?: string | null
    children: ReactNode
}) {
    const [expanded, setExpanded] = useState(false)
    const triggerRef = useRef<HTMLButtonElement | null>(null)
    const [nowIso, setNowIso] = useState(() => new Date().toISOString())
    const currentActivity = [...props.activities].reverse().find((activity) => getActivityStatus(activity) === 'running')
        || props.activities.at(-1)!
    const running = props.activities.some((activity) => getActivityStatus(activity) === 'running')
    const failed = props.activities.some((activity) => getActivityStatus(activity) === 'failed')
    const title = getAssistantActionTitle(currentActivity, props.projectRootPath)
    const elapsed = useMemo(
        () => getActivityElapsed(currentActivity, running ? nowIso : null),
        [currentActivity, nowIso, running]
    )
    useEffect(() => {
        if (!running) return
        const intervalId = window.setInterval(() => setNowIso(new Date().toISOString()), 1000)
        return () => window.clearInterval(intervalId)
    }, [running])
    const meta = [
        `${props.activities.length} ${props.activities.length === 1 ? 'action' : 'actions'}`,
        formatAssistantActionTime(currentActivity.createdAt),
        elapsed
    ].filter(Boolean).join(' · ')

    return (
        <div
            className="max-w-4xl py-0.5"
            data-assistant-action-batch="true"
            data-current-action-intent={title}
        >
            <button
                ref={triggerRef}
                type="button"
                aria-expanded={expanded}
                data-assistant-action-batch-trigger="true"
                onClick={() => {
                    const nextExpanded = !expanded
                    requestAssistantTimelineDisclosureAnchor(triggerRef.current, ACTION_BATCH_MOTION_MS, nextExpanded)
                    setExpanded(nextExpanded)
                }}
                className="group/action-batch flex min-h-7 w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color-mix(in_srgb,var(--color-text)_25%,transparent)]"
                title={expanded ? 'Hide actions' : 'Show actions'}
            >
                <span className={cn(
                    'inline-flex size-4 shrink-0 items-center justify-center',
                    running ? 'text-[color-mix(in_srgb,var(--status-warning)_72%,var(--color-text))]' : failed ? 'text-[color-mix(in_srgb,var(--status-danger)_72%,var(--color-text))]' : 'text-sparkle-text-muted'
                )}>
                    {running ? <Loader2 size={13} className="animate-spin" /> : <ListTree size={13} />}
                </span>
                <span className={cn(
                    'min-w-0 flex-1 truncate text-[12px] font-medium leading-5 text-sparkle-text-secondary group-hover/action-batch:text-sparkle-text',
                    running && 'assistant-action-intent-shimmer assistant-model-name-shimmer'
                )}>
                    {title}
                </span>
                {meta ? <span className="shrink-0 font-mono text-[9px] tabular-nums text-sparkle-text-muted/70">{meta}</span> : null}
                {failed ? <span className="size-1.5 shrink-0 rounded-full bg-[var(--status-danger)] opacity-70" aria-label="Failed action in batch" /> : null}
                <ChevronRight
                    size={11}
                    className={cn('shrink-0 text-sparkle-text-muted transition-transform duration-200', expanded && 'rotate-90')}
                    aria-hidden="true"
                />
            </button>
            <AnimatedHeight isOpen={expanded} duration={ACTION_BATCH_MOTION_MS} crispContent>
                <div className="ml-3 border-l border-[var(--surface-divider)] pl-2 pt-0.5" data-assistant-action-batch-items="all">
                    {props.children}
                </div>
            </AnimatedHeight>
        </div>
    )
}
