import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronRight, ListTree, Loader2, Monitor, MousePointer2, Wifi } from 'lucide-react'
import type { AssistantActivity } from '@shared/assistant/contracts'
import { readAssistantActionBatchIntent } from '@shared/assistant/action-batch-intent'
import { isAssistantBackgroundProcessActivity } from '@shared/assistant/activity-settlement'
import { AnimatedHeight } from '@/components/ui/AnimatedHeight'
import { cn } from '@/lib/utils'
import { getAssistantActionFamily, getAssistantActionTitle } from './assistant-action-presentation'
import { useSettings } from '@/lib/settings'
import { formatAssistantActionTime } from './AssistantTimelineActionShell'
import { getActivityDiffStats, getActivityElapsed, getActivityStatus, isAssistantConnectionRecoveryActivity } from './assistant-timeline-helpers'
import { InlineDiffStats } from './AssistantInlineDiffStats'
import { AssistantActionBatchScroll } from './AssistantActionBatchScroll'
import { ASSISTANT_ACTION_ICON_CLASS, ASSISTANT_ACTION_ROW_CLASS } from './assistant-action-row-layout'
import { requestAssistantTimelineDisclosureAnchor } from './assistant-timeline-scroll-events'

const ACTION_BATCH_MOTION_MS = 220

export function AssistantTimelineActionBatch(props: {
    activities: AssistantActivity[]
    projectRootPath?: string | null
    controlRun?: boolean
    children: ReactNode
}) {
    const { settings } = useSettings()
    const [expanded, setExpanded] = useState(false)
    const triggerRef = useRef<HTMLButtonElement | null>(null)
    const [nowIso, setNowIso] = useState(() => new Date().toISOString())
    const isRunning = (activity: AssistantActivity) => getActivityStatus(activity) === 'running'
        && !isAssistantBackgroundProcessActivity(activity)
        && (!isAssistantConnectionRecoveryActivity(activity) || activity === props.activities.at(-1))
    const currentActivity = [...props.activities].reverse().find(isRunning)
        || [...props.activities].reverse().find(activity => !isAssistantConnectionRecoveryActivity(activity))
        || props.activities.at(-1)!
    const running = props.activities.some(isRunning)
    const failed = props.activities.some((activity) => getActivityStatus(activity) === 'failed')
    const connecting = running && isAssistantConnectionRecoveryActivity(currentActivity)
    const currentActionTitle = connecting
        ? String(currentActivity.payload?.status).toLowerCase() === 'connecting' ? 'Connecting' : 'Reconnecting'
        : getAssistantActionTitle(currentActivity, props.projectRootPath)
    const settledIntent = [...props.activities].reverse()
        .map(readAssistantActionBatchIntent)
        .find((value): value is string => Boolean(value)) || null
    const browserRun = props.controlRun && getAssistantActionFamily(currentActivity) === 'browser'
    const title = running ? currentActionTitle : settledIntent || (props.controlRun ? browserRun ? 'Using the browser' : 'Using the computer' : currentActionTitle)
    const elapsed = useMemo(
        () => getActivityElapsed(currentActivity, running ? nowIso : null),
        [currentActivity, nowIso, running]
    )
    useEffect(() => {
        if (!running) return
        const intervalId = window.setInterval(() => setNowIso(new Date().toISOString()), 1000)
        return () => window.clearInterval(intervalId)
    }, [running])
    const diffTotals = useMemo(() => props.activities.reduce((totals, activity) => {
        if (activity.payload?.approvalPending === true || getActivityStatus(activity) !== 'success') return totals
        const stats = getActivityDiffStats(activity)
        if (stats) {
            totals.additions += stats.additions
            totals.deletions += stats.deletions
        }
        return totals
    }, { additions: 0, deletions: 0 }), [props.activities])
    const meta = [
        `${props.activities.length} ${props.activities.length === 1 ? 'action' : 'actions'}`,
        formatAssistantActionTime(currentActivity.createdAt),
        elapsed
    ].filter(Boolean).join(' · ')

    return (
        <div
            className="max-w-4xl py-0.5"
            data-assistant-action-batch="true"
            data-assistant-control-run={props.controlRun ? 'true' : undefined}
            data-action-batch-intent={settledIntent || undefined}
            data-current-action-intent={currentActionTitle}
            data-settled-action-intent={!running && settledIntent ? settledIntent : undefined}
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
                data-assistant-action-row="true"
                className={cn(ASSISTANT_ACTION_ROW_CLASS, 'group/action-batch transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color-mix(in_srgb,var(--color-text)_25%,transparent)]')}
                title={expanded ? 'Hide actions' : 'Show actions'}
            >
                <span data-assistant-action-icon="true" className={cn(
                    ASSISTANT_ACTION_ICON_CLASS,
                    connecting ? 'text-[var(--status-success)]' : running ? 'text-[color-mix(in_srgb,var(--status-warning)_72%,var(--color-text))]' : failed ? 'text-[color-mix(in_srgb,var(--status-danger)_72%,var(--color-text))]' : 'text-sparkle-text-muted'
                )}>
                    {connecting ? <Wifi size={13} className="motion-safe:animate-pulse" /> : running ? <Loader2 size={13} className="motion-safe:animate-spin" /> : browserRun ? <MousePointer2 size={13} /> : props.controlRun ? <Monitor size={13} /> : <ListTree size={13} />}
                </span>
                <span data-assistant-action-title="true" className={cn(
                    'min-w-0 flex-1 truncate text-[12px] font-medium leading-5 text-sparkle-text-secondary group-hover/action-batch:text-sparkle-text',
                    running && 'assistant-title-shimmer'
                )}>
                    {title}
                </span>
                {diffTotals.additions > 0 || diffTotals.deletions > 0 ? <InlineDiffStats {...diffTotals} animated={!settings.accessibilityReduceMotion} className="shrink-0" /> : null}
                {settings.assistantShowActionStats && meta ? <span className="shrink-0 font-mono text-[9px] tabular-nums text-sparkle-text-muted/70">{meta}</span> : null}
                {failed ? <span className="size-1.5 shrink-0 rounded-full bg-[var(--status-danger)] opacity-70" aria-label="Failed action in batch" /> : null}
                <ChevronRight
                    size={11}
                    className={cn('shrink-0 text-sparkle-text-muted transition-transform duration-200', expanded && 'rotate-90')}
                    aria-hidden="true"
                />
            </button>
            <AnimatedHeight isOpen={expanded} duration={ACTION_BATCH_MOTION_MS} crispContent>
                <AssistantActionBatchScroll expanded={expanded}>
                    {props.children}
                </AssistantActionBatchScroll>
            </AnimatedHeight>
        </div>
    )
}
