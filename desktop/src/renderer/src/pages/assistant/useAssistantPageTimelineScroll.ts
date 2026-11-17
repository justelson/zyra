import { useCallback, useRef } from 'react'
import { ASSISTANT_TIMELINE_FOLLOW_END_EVENT } from './assistant-timeline-scroll-events'

interface UseAssistantPageTimelineScrollArgs {
    sessionId: string | null
    threadId: string | null
    loading: boolean
    timelineMessageCount: number
    lastTimelineMessageId: string | null
    lastTimelineMessageUpdatedAt: string | null
    activityFeedCount: number
    latestTimelineActivityId: string | null
    latestTimelineActivityCreatedAt: string | null
    shouldShowWorkingIndicator: boolean
    latestTurnStartedAt: string | null
    latestTurnState: string | null
    threadState: string | null
}

/**
 * LegendList owns follow-end and measured anchoring. This hook only exposes the
 * native viewport for the surrounding controls; keeping a second auto-scroll
 * controller here would fight virtualization during prepends and row resizes.
 */
export function useAssistantPageTimelineScroll(_args: UseAssistantPageTimelineScrollArgs) {
    const timelineScrollRef = useRef<HTMLDivElement | null>(null)
    const timelineContentRef = useRef<HTMLDivElement | null>(null)

    const onScrollTimeline = useCallback((_element: HTMLDivElement) => {}, [])

    const onScrollToBottom = useCallback((animated = false) => {
        const element = timelineScrollRef.current
        if (!element) return
        element.dispatchEvent(new CustomEvent(ASSISTANT_TIMELINE_FOLLOW_END_EVENT, { detail: { animated } }))
    }, [])

    return {
        timelineContentRef,
        timelineScrollRef,
        onScrollTimeline,
        onScrollToBottom
    }
}
