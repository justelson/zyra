import { memo, startTransition, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { AnimatedHeight } from '@/components/ui/AnimatedHeight'
import type { AssistantChatDisplayMode } from '@/lib/settings'
import { cn } from '@/lib/utils'
import { formatWorkingTimer } from './assistant-timeline-helpers'
import {
    requestAssistantTimelineDisclosureAnchor,
    resolveAssistantTimelineCompletionAnchor
} from './assistant-timeline-scroll-events'

const WORK_SUMMARY_MOTION_MS = 260
const WORK_SUMMARY_UNMOUNT_DELAY_MS = WORK_SUMMARY_MOTION_MS + 40
const WORK_SUMMARY_EXPANDED_PREFERENCE_KEY = 'zyra:assistant-work-expanded:v1'

function readWorkSummaryExpandedPreference(): boolean {
    try {
        return localStorage.getItem(WORK_SUMMARY_EXPANDED_PREFERENCE_KEY) !== 'false'
    } catch {
        return true
    }
}

function writeWorkSummaryExpandedPreference(expanded: boolean): void {
    try {
        localStorage.setItem(WORK_SUMMARY_EXPANDED_PREFERENCE_KEY, String(expanded))
    } catch {}
}

function formatWorkSummaryStatus(
    startedAt: string,
    completedAt: string | null,
    running: boolean,
    actionCount: number
): string {
    const elapsed = formatWorkingTimer(
        startedAt,
        running ? new Date().toISOString() : completedAt || new Date().toISOString()
    )
    const duration = elapsed
        ? `${running ? 'Working' : 'Worked'} for ${elapsed}`
        : running ? 'Working' : 'Worked'
    if (actionCount < 1) return duration
    return `${duration} · ${actionCount} ${actionCount === 1 ? 'action' : 'actions'}`
}

export function TimelineTurnInterruptionMarker() {
    return (
        <div
            className="flex min-h-7 w-full max-w-4xl items-center gap-3 py-1"
            role="status"
            aria-label="Interrupted"
            data-assistant-turn-interruption="true"
        >
            <span className="h-px min-w-6 flex-1 bg-white/[0.06]" aria-hidden="true" />
            <span className="shrink-0 text-[10px] font-medium tracking-[0.04em] text-white/24">Interrupted</span>
            <span className="h-px min-w-6 flex-1 bg-white/[0.06]" aria-hidden="true" />
        </div>
    )
}

export const TimelineTurnWorkSummary = memo(function TimelineTurnWorkSummary({
    startedAt,
    completedAt,
    running = false,
    collapseForTerminalResponse = false,
    outcome = null,
    displayMode = 'detailed',
    actionCount = 0,
    hasWork = true,
    revealContent = false,
    renderChildren
}: {
    startedAt: string
    completedAt: string | null
    running?: boolean
    collapseForTerminalResponse?: boolean
    outcome?: 'completed' | 'interrupted' | 'failed' | 'no-response' | null
    displayMode?: AssistantChatDisplayMode
    actionCount?: number
    hasWork?: boolean
    revealContent?: boolean
    renderChildren: () => ReactNode
}) {
    const initialExpandedRef = useRef<boolean | null>(null)
    if (initialExpandedRef.current === null) {
        initialExpandedRef.current = running && readWorkSummaryExpandedPreference()
    }
    const initialExpanded = initialExpandedRef.current
    const [expanded, setExpanded] = useState(initialExpanded)
    const [contentMounted, setContentMounted] = useState(initialExpanded)
    const [contentVisible, setContentVisible] = useState(false)
    const panelId = useId()
    const triggerRef = useRef<HTMLButtonElement | null>(null)
    const statusTextRef = useRef<HTMLSpanElement | null>(null)
    const previousRunningRef = useRef(running)
    const previousTerminalResponseRef = useRef(collapseForTerminalResponse)
    const contentRevealFrameRef = useRef<number | null>(null)
    const contentUnmountTimerRef = useRef<number | null>(null)
    const pendingExpansionAnchorRef = useRef<HTMLElement | null>(null)
    const minimal = displayMode === 'minimal'
    const statusText = formatWorkSummaryStatus(startedAt, completedAt, running, actionCount)
    useEffect(() => {
        const updateStatusText = () => {
            if (statusTextRef.current) {
                statusTextRef.current.textContent = formatWorkSummaryStatus(startedAt, completedAt, running, actionCount)
            }
        }
        updateStatusText()
        if (!running) return
        const intervalId = window.setInterval(updateStatusText, 1000)
        return () => window.clearInterval(intervalId)
    }, [actionCount, completedAt, displayMode, running, startedAt])
    const outcomeLabel = outcome === 'failed'
        ? 'Failed'
        : outcome === 'no-response'
            ? 'No response'
            : null
    const interruptionMarker = outcome === 'interrupted' ? <TimelineTurnInterruptionMarker /> : null
    const cancelPendingContentWork = () => {
        if (contentRevealFrameRef.current !== null) {
            window.cancelAnimationFrame(contentRevealFrameRef.current)
            contentRevealFrameRef.current = null
        }
        if (contentUnmountTimerRef.current !== null) {
            window.clearTimeout(contentUnmountTimerRef.current)
            contentUnmountTimerRef.current = null
        }
    }
    const setWorkExpanded = (nextExpanded: boolean, anchor: HTMLElement | null) => {
        cancelPendingContentWork()
        if (running) writeWorkSummaryExpandedPreference(nextExpanded)
        setExpanded(nextExpanded)
        if (nextExpanded) {
            pendingExpansionAnchorRef.current = anchor
            if (contentMounted) {
                requestAssistantTimelineDisclosureAnchor(anchor, WORK_SUMMARY_MOTION_MS, true)
                setContentVisible(true)
            } else {
                setContentVisible(false)
                startTransition(() => setContentMounted(true))
            }
            return
        }
        pendingExpansionAnchorRef.current = null
        requestAssistantTimelineDisclosureAnchor(anchor, WORK_SUMMARY_MOTION_MS, false)
        setContentVisible(false)
        contentUnmountTimerRef.current = window.setTimeout(() => {
            contentUnmountTimerRef.current = null
            setContentMounted(false)
        }, WORK_SUMMARY_UNMOUNT_DELAY_MS)
    }

    const previousRevealContentRef = useRef(false)
    useEffect(() => {
        const shouldReveal = revealContent && !previousRevealContentRef.current
        previousRevealContentRef.current = revealContent
        if (shouldReveal) setWorkExpanded(true, triggerRef.current)
    }, [revealContent])

    useEffect(() => {
        if (!expanded || !contentMounted || contentVisible || contentRevealFrameRef.current !== null) return
        contentRevealFrameRef.current = window.requestAnimationFrame(() => {
            contentRevealFrameRef.current = null
            requestAssistantTimelineDisclosureAnchor(
                pendingExpansionAnchorRef.current || triggerRef.current,
                WORK_SUMMARY_MOTION_MS,
                true
            )
            pendingExpansionAnchorRef.current = null
            setContentVisible(true)
        })
    }, [contentMounted, contentVisible, expanded])

    useEffect(() => {
        const wasRunning = previousRunningRef.current
        const runningChanged = wasRunning !== running
        const terminalResponseBecameVisible = !previousTerminalResponseRef.current && collapseForTerminalResponse
        previousRunningRef.current = running
        previousTerminalResponseRef.current = collapseForTerminalResponse
        if (!runningChanged && !terminalResponseBecameVisible) return
        cancelPendingContentWork()
        pendingExpansionAnchorRef.current = null
        if (!wasRunning && running && !collapseForTerminalResponse) {
            const restoreExpanded = readWorkSummaryExpandedPreference()
            setExpanded(restoreExpanded)
            setContentVisible(false)
            setContentMounted(restoreExpanded)
            return
        }
        requestAssistantTimelineDisclosureAnchor(
            resolveAssistantTimelineCompletionAnchor(triggerRef.current),
            WORK_SUMMARY_MOTION_MS,
            false
        )
        setExpanded(false)
        setContentVisible(false)
        contentUnmountTimerRef.current = window.setTimeout(() => {
            contentUnmountTimerRef.current = null
            setContentMounted(false)
        }, WORK_SUMMARY_UNMOUNT_DELAY_MS)
    }, [collapseForTerminalResponse, running])

    useEffect(() => () => {
        if (contentRevealFrameRef.current !== null) {
            window.cancelAnimationFrame(contentRevealFrameRef.current)
            contentRevealFrameRef.current = null
        }
        if (contentUnmountTimerRef.current !== null) {
            window.clearTimeout(contentUnmountTimerRef.current)
            contentUnmountTimerRef.current = null
        }
    }, [])

    if (interruptionMarker && !hasWork) {
        return <div className="max-w-4xl py-0.5">{interruptionMarker}</div>
    }

    return (
        <div
            className={cn('max-w-4xl', minimal ? 'py-0' : 'py-0.5')}
            data-assistant-work-summary-shell="true"
            data-assistant-work-summary-display={displayMode}
        >
            <div className={cn(
                'transition-[background-color,backdrop-filter] duration-150',
                expanded && 'sticky top-0 z-10 bg-sparkle-bg/95 backdrop-blur-md'
            )}>
                <button
                    ref={triggerRef}
                    type="button"
                    onClick={() => setWorkExpanded(!expanded, triggerRef.current)}
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    className={cn(
                        'group/work inline-flex min-h-7 items-center rounded-sm pr-1 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30',
                        minimal ? 'gap-1.5' : 'gap-1'
                    )}
                    title={expanded ? 'Hide work' : 'Show work'}
                >
                    {running ? (
                        <span data-assistant-working-dots="true" className="inline-flex shrink-0 items-center gap-[3px]" aria-hidden="true">
                            <span className="h-1 w-1 rounded-full bg-white/25 motion-safe:animate-pulse" />
                            <span className="h-1 w-1 rounded-full bg-white/25 motion-safe:animate-pulse [animation-delay:200ms]" />
                            <span className="h-1 w-1 rounded-full bg-white/25 motion-safe:animate-pulse [animation-delay:400ms]" />
                        </span>
                    ) : null}
                    <span ref={statusTextRef} className={cn(
                        'shrink-0 text-[11px] font-medium transition-colors',
                        minimal ? 'text-sparkle-text-muted/65 group-hover/work:text-sparkle-text-secondary' : 'text-white/32 group-hover/work:text-white/48'
                    )}>
                        {statusText}
                    </span>
                    {outcomeLabel ? (
                        <span className={cn(
                            'shrink-0 text-[10px] font-medium',
                            outcome === 'failed' ? 'text-red-300/55' : 'text-white/25'
                        )}>
                            · {outcomeLabel}
                        </span>
                    ) : null}
                    <ChevronRight
                        size={12}
                        aria-hidden="true"
                        className={cn('shrink-0 text-white/20 transition-[transform,color] duration-[260ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] group-hover/work:text-white/35 motion-reduce:transition-none', expanded && 'rotate-90')}
                    />
                </button>
                {!minimal && outcome !== 'interrupted' ? <div className="h-px w-full bg-white/[0.07]" aria-hidden="true" /> : null}
            </div>
            {interruptionMarker}
            <div id={panelId}>
                <AnimatedHeight isOpen={contentVisible} duration={WORK_SUMMARY_MOTION_MS} crispContent>
                    {contentMounted ? (
                        <div className={minimal ? 'pt-1' : 'pt-2'}>
                            {renderChildren()}
                        </div>
                    ) : null}
                </AnimatedHeight>
            </div>
        </div>
    )
})
