import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { LegendList, type LegendListRef, type LegendListRenderItemProps } from '@legendapp/list/react'
import { ChevronUp } from 'lucide-react'
import { usePresentationReducedMotion } from '@/lib/use-presentation-reduced-motion'
import {
    rendererVisibility,
    shouldSnapRendererPresentation,
    useRendererVisibilitySnapshot
} from '@/lib/renderer-visibility'
import type { TimelineDisplayRow } from './assistant-timeline-helpers'
import { markMarkdownScrollActivity } from '@/components/ui/markdown/markdownScrollActivity'
import {
    ASSISTANT_TIMELINE_DISCLOSURE_TOGGLE_EVENT,
    ASSISTANT_TIMELINE_FOLLOW_END_EVENT,
    didAssistantTimelineWorkComplete,
    type AssistantTimelineDisclosureToggleDetail,
    type AssistantActivityRevealRequest
} from './assistant-timeline-scroll-events'
import {
    resolveAssistantTimelineModeAfterScroll,
    resolveAssistantTimelineScrollMode,
    type AssistantTimelineScrollMode
} from './assistant-timeline-scroll-policy'
import {
    normalizeAssistantHistoryWheelDelta,
    resolveAssistantInitialHistoryBackfill,
    shouldRevealAssistantInitialHistory,
    resolveAssistantHistoryStreamPlan,
    resolveAssistantScrollbarHistoryDemand,
    resolveAssistantScrollbarTrackDirection,
    resolveAssistantSpaceScrollDirection,
    resolveAssistantScrollbarReleaseDirection,
    updateAssistantHistoryScrollVelocity
} from './assistant-history-streaming-policy'

import {
    captureAssistantTimelineMediaAnchor,
    measureAssistantTimelineMediaAnchorDelta,
    type AssistantTimelineMediaAnchor
} from './assistant-timeline-media-anchor'

const keyExtractor = (row: TimelineDisplayRow) => row.id
const getItemType = (row: TimelineDisplayRow) => row.kind
const DEFAULT_DISCLOSURE_SETTLE_MS = 420
const DISCLOSURE_SETTLE_PADDING_MS = 80
const COMPLETION_LAYOUT_SETTLE_MS = 720
const ASSISTANT_TIMELINE_USER_JUMP_EVENT = 'assistant:timeline-user-jump'
const SPACE_CONSUMING_CONTROL_SELECTOR = 'button,input,textarea,select,summary,audio[controls],video[controls],[role~="button"],[role~="checkbox"],[role~="radio"],[role~="switch"],[role~="tab"],[role~="option"],[role~="menuitem"],[role~="menuitemcheckbox"],[role~="menuitemradio"],[role~="treeitem"],[role~="slider"],[role~="spinbutton"],[role~="combobox"],[role~="listbox"],[role~="textbox"],[role~="searchbox"],[role~="scrollbar"]'

type LegendScrollViewHandle = {
    getScrollableNode?: () => HTMLElement | null
}

type HistoryLoadRequestOwner = {
    windowKey: string
    requestId: number
}

function resolveScrollElement(value: unknown): HTMLDivElement | null {
    if (value instanceof HTMLDivElement) return value
    if (!value || typeof value !== 'object') return null
    const node = (value as LegendScrollViewHandle).getScrollableNode?.()
    return node instanceof HTMLDivElement ? node : null
}

export const AssistantVirtualTimeline = memo(function AssistantVirtualTimeline(props: {
    rows: TimelineDisplayRow[]
    windowKey: string
    focusMessageId?: string | null
    activityRevealRequest?: AssistantActivityRevealRequest | null
    followLatestRequestKey?: string | null
    listRef: RefObject<LegendListRef | null>
    scrollContainerRef?: RefObject<HTMLDivElement | null>
    contentInsetEndAdjustment: number
    isWorking: boolean
    selectionHydrating: boolean
    coldStart?: boolean
    hasOlder: boolean
    hasNewer: boolean
    loadingOlder: boolean
    loadingNewer: boolean
    loadOlderError: string | null
    loadNewerError: string | null
    onLoadOlder?: (turnLimit?: number) => Promise<boolean> | boolean | void
    onLoadNewer?: (turnLimit?: number) => Promise<boolean> | boolean | void
    onScrollContainer?: (element: HTMLDivElement) => void
    onInitialLayout?: () => void
    renderRow: (row: TimelineDisplayRow) => ReactNode
}) {
    const visibilitySnapshot = useRendererVisibilitySnapshot()
    const reducedMotion = usePresentationReducedMotion()
    const textStreaming = props.rows.some(row => row.kind === 'message' && row.message.streaming)
    const latestWork = [...props.rows].reverse().find(row => row.kind === 'turn-work-summary')
    const stoppedPresentation = latestWork?.kind === 'turn-work-summary'
        && (latestWork.outcome === 'interrupted' || latestWork.outcome === 'failed')
    const renderRowRef = useRef(props.renderRow)
    const rowDisclosureState = useMemo(() => ({
        activityRevealRequest: props.activityRevealRequest,
        focusMessageId: props.focusMessageId
    }), [props.activityRevealRequest, props.focusMessageId])
    const disclosureTimerRef = useRef(0)
    const completionFollowTimerRef = useRef(0)
    const endAlignmentFrameRef = useRef<number | null>(null)
    const startupAlignmentFrameRef = useRef<number | null>(null)
    const disclosureAnchorRowIdRef = useRef<string | null>(null)
    const touchStartYRef = useRef<number | null>(null)
    const scrollbarDragActiveRef = useRef(false)
    const scrollbarDragDirectionRef = useRef<'older' | 'newer' | null>(null)
    const scrollbarDragLastYRef = useRef<number | null>(null)
    const olderLoadRequestPendingRef = useRef(false)
    const newerLoadRequestPendingRef = useRef(false)
    const nextHistoryLoadRequestIdRef = useRef(0)
    const olderLoadRequestOwnerRef = useRef<HistoryLoadRequestOwner | null>(null)
    const newerLoadRequestOwnerRef = useRef<HistoryLoadRequestOwner | null>(null)
    const initialHistoryBackfillFrameRef = useRef<number | null>(null)
    const initialHistoryBackfillWindowKeyRef = useRef(props.windowKey)
    const initialHistoryBackfillReadyRef = useRef(false)
    const initialHistoryBackfillActiveRef = useRef(true)
    const initialHistoryBackfillPagesRef = useRef(0)
    const mediaAnchorRef = useRef<AssistantTimelineMediaAnchor | null>(null)
    const previousScrollTopRef = useRef(0)
    const previousScrollSampleAtRef = useRef(0)
    const previousInputSampleAtRef = useRef(0)
    const scrollVelocityRef = useRef(0)
    const lastUpwardIntentAtRef = useRef(Number.NEGATIVE_INFINITY)
    const lastDownwardIntentAtRef = useRef(Number.NEGATIVE_INFINITY)
    const userNavigationAwayRef = useRef(false)
    const handledFollowRequestRef = useRef<{ windowKey: string; key: string | null }>({ windowKey: props.windowKey, key: null })
    const previousRowsRef = useRef(props.rows)
    const previousCompletionWindowKeyRef = useRef(props.windowKey)
    const scrollModeRef = useRef<AssistantTimelineScrollMode>('following-end')
    const completionFollowActiveRef = useRef(false)
    const handledResumeRevisionRef = useRef(visibilitySnapshot.resumeRevision)
    const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)
    const [scrollMode, setScrollMode] = useState<AssistantTimelineScrollMode>('following-end')
    const [disclosureLayoutActive, setDisclosureLayoutActive] = useState(false)
    const [settledWindowKey, setSettledWindowKey] = useState<string | null>(null)
    const activeWindowKeyRef = useRef(props.windowKey)
    const settledWindowKeyRef = useRef<string | null>(null)
    const startupSettled = settledWindowKey === props.windowKey
    const coldWindowRef = useRef({ key: props.windowKey, cold: props.coldStart === true })
    const [coldHistoryReadyKey, setColdHistoryReadyKey] = useState<string | null>(null)
    const [historyFillRevision, setHistoryFillRevision] = useState(0)
    if (coldWindowRef.current.key !== props.windowKey) {
        coldWindowRef.current = { key: props.windowKey, cold: props.coldStart === true }
    }
    if (props.focusMessageId) coldWindowRef.current.cold = false
    const coldHistoryPending = coldWindowRef.current.cold
        && coldHistoryReadyKey !== props.windowKey && !userNavigationAwayRef.current
    if (initialHistoryBackfillWindowKeyRef.current !== props.windowKey) {
        initialHistoryBackfillWindowKeyRef.current = props.windowKey
        initialHistoryBackfillReadyRef.current = false
        initialHistoryBackfillActiveRef.current = true
        initialHistoryBackfillPagesRef.current = 0
        olderLoadRequestPendingRef.current = false
        newerLoadRequestPendingRef.current = false
        olderLoadRequestOwnerRef.current = null
        newerLoadRequestOwnerRef.current = null
    }
    activeWindowKeyRef.current = props.windowKey
    renderRowRef.current = props.renderRow

    const cancelEndAlignment = useCallback(() => {
        if (endAlignmentFrameRef.current === null) return
        window.cancelAnimationFrame(endAlignmentFrameRef.current)
        endAlignmentFrameRef.current = null
    }, [])

    const cancelStartupAlignment = useCallback(() => {
        if (startupAlignmentFrameRef.current === null) return
        window.cancelAnimationFrame(startupAlignmentFrameRef.current)
        startupAlignmentFrameRef.current = null
    }, [])

    const cancelInitialHistoryBackfillCheck = useCallback(() => {
        if (initialHistoryBackfillFrameRef.current === null) return
        window.cancelAnimationFrame(initialHistoryBackfillFrameRef.current)
        initialHistoryBackfillFrameRef.current = null
    }, [])

    const stopInitialHistoryBackfill = useCallback(() => {
        cancelInitialHistoryBackfillCheck()
        initialHistoryBackfillActiveRef.current = false
    }, [cancelInitialHistoryBackfillCheck])

    const settleInitialPresentation = useCallback((windowKey: string, onInitialLayout?: () => void) => {
        if (activeWindowKeyRef.current !== windowKey || settledWindowKeyRef.current === windowKey) return
        settledWindowKeyRef.current = windowKey
        setSettledWindowKey(windowKey)
        onInitialLayout?.()
    }, [])

    const cancelDisclosureAnchor = useCallback(() => {
        disclosureAnchorRowIdRef.current = null
    }, [])

    const requestEndAlignment = useCallback(() => {
        if (endAlignmentFrameRef.current !== null) return
        const targetWindowKey = activeWindowKeyRef.current
        endAlignmentFrameRef.current = window.requestAnimationFrame(() => {
            endAlignmentFrameRef.current = null
            if (activeWindowKeyRef.current !== targetWindowKey || scrollModeRef.current !== 'following-end') return
            // Ownership, not old prompt geometry, decides whether to follow.
            void props.listRef.current?.scrollToEnd({ animated: false })
        })
    }, [props.listRef])

    const beginDisclosureLayout = useCallback((
        duration = DEFAULT_DISCLOSURE_SETTLE_MS,
        anchorRowId: string | null = null
    ) => {
        window.clearTimeout(disclosureTimerRef.current)
        mediaAnchorRef.current = null
        disclosureAnchorRowIdRef.current = anchorRowId
        setDisclosureLayoutActive(true)
        disclosureTimerRef.current = window.setTimeout(() => {
            disclosureTimerRef.current = 0
            disclosureAnchorRowIdRef.current = null
            setDisclosureLayoutActive(false)
        }, Math.max(0, duration) + DISCLOSURE_SETTLE_PADDING_MS)
    }, [])

    const maintainVisibleContentPosition = useMemo(() => ({
        data: true,
        size: startupSettled && scrollMode === 'free-scrolling',
        shouldRestorePosition: (row: TimelineDisplayRow) => {
            const anchorRowId = disclosureAnchorRowIdRef.current
            return anchorRowId === null || row.id === anchorRowId
        }
    }), [scrollMode, startupSettled])

    const clearCompletionEndFollow = useCallback(() => {
        completionFollowActiveRef.current = false
        window.clearTimeout(completionFollowTimerRef.current)
        completionFollowTimerRef.current = 0
    }, [])

    const updateScrollMode = useCallback((nextMode: AssistantTimelineScrollMode) => {
        scrollModeRef.current = nextMode
        if (nextMode === 'following-end') mediaAnchorRef.current = null
        setScrollMode((current) => current === nextMode ? current : nextMode)
    }, [])

    const canAnchorMedia = useCallback(() => (
        activeWindowKeyRef.current === props.windowKey
        && settledWindowKeyRef.current === props.windowKey
        && scrollModeRef.current === 'free-scrolling'
        && !completionFollowActiveRef.current
        && !disclosureTimerRef.current
        && !props.selectionHydrating
    ), [props.selectionHydrating, props.windowKey])

    const compensateIntraRowMedia = useCallback(() => {
        const element = props.scrollContainerRef?.current || scrollElement
        const anchor = mediaAnchorRef.current
        if (!element || !anchor || !canAnchorMedia()) {
            mediaAnchorRef.current = null
            return
        }
        const delta = measureAssistantTimelineMediaAnchorDelta(anchor, element, props.windowKey)
        if (delta === null) {
            mediaAnchorRef.current = null
            return
        }
        // Row-origin movement belongs to LegendList MVCP. Only restore the
        // visible character's changing offset INSIDE its existing row.
        if (Math.abs(delta) > 0.01) element.scrollTop += delta
    }, [canAnchorMedia, props.scrollContainerRef, props.windowKey, scrollElement])

    const followLatest = useCallback((animated = false) => {
        clearCompletionEndFollow()
        cancelEndAlignment()
        cancelStartupAlignment()
        stopInitialHistoryBackfill()
        cancelDisclosureAnchor()
        window.clearTimeout(disclosureTimerRef.current)
        disclosureTimerRef.current = 0
        setDisclosureLayoutActive(false)
        userNavigationAwayRef.current = false
        lastUpwardIntentAtRef.current = Number.NEGATIVE_INFINITY
        lastDownwardIntentAtRef.current = Number.NEGATIVE_INFINITY
        scrollbarDragActiveRef.current = false
        scrollbarDragDirectionRef.current = null
        coldWindowRef.current.cold = false
        setColdHistoryReadyKey(props.windowKey)
        updateScrollMode('following-end')
        settleInitialPresentation(props.windowKey, props.onInitialLayout)
        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches || document.body.classList.contains('zyra-reduce-motion')
        void props.listRef.current?.scrollToEnd({ animated: animated && !reduceMotion })
    }, [cancelDisclosureAnchor, cancelEndAlignment, cancelStartupAlignment, clearCompletionEndFollow, props.listRef, props.onInitialLayout, props.windowKey, settleInitialPresentation, stopInitialHistoryBackfill, updateScrollMode])

    const requestInitialHistoryBackfill = useCallback((targetWindowKey: string) => {
        if (
            activeWindowKeyRef.current !== targetWindowKey
            || initialHistoryBackfillWindowKeyRef.current !== targetWindowKey
            || !initialHistoryBackfillActiveRef.current
        ) return
        const state = props.listRef.current?.getState()
        const element = props.scrollContainerRef?.current
        const initialHistory = {
            initialLayoutReady: initialHistoryBackfillReadyRef.current,
            selectionSettled: !props.selectionHydrating,
            hasOlder: props.hasOlder,
            loadingOlder: props.loadingOlder,
            hasLoadError: Boolean(props.loadOlderError),
            requestPending: olderLoadRequestPendingRef.current,
            contentLength: state?.contentLength || 0,
            viewportSize: state?.scrollLength || element?.clientHeight || 0,
            pagesRequested: initialHistoryBackfillPagesRef.current
        }
        const plan = resolveAssistantInitialHistoryBackfill(initialHistory)
        if (!plan.shouldRequest || !props.onLoadOlder) {
            // A queued frame may predate the render that marks startup settled.
            // Read the current window's completion instead of that frame's closure.
            if (settledWindowKeyRef.current === targetWindowKey && (!props.onLoadOlder || shouldRevealAssistantInitialHistory(initialHistory))) {
                setColdHistoryReadyKey(targetWindowKey)
            }
            return
        }

        const requestOwner = {
            windowKey: targetWindowKey,
            requestId: ++nextHistoryLoadRequestIdRef.current
        }
        olderLoadRequestPendingRef.current = true
        olderLoadRequestOwnerRef.current = requestOwner
        initialHistoryBackfillPagesRef.current += 1
        void Promise.resolve(props.onLoadOlder(plan.turnLimit)).then((accepted) => {
            if (olderLoadRequestOwnerRef.current !== requestOwner) return
            olderLoadRequestOwnerRef.current = null
            olderLoadRequestPendingRef.current = false
            setHistoryFillRevision(value => value + 1)
            if (accepted === false) {
                setColdHistoryReadyKey(targetWindowKey)
                initialHistoryBackfillPagesRef.current = Math.max(0, initialHistoryBackfillPagesRef.current - 1)
            }
        }).catch(() => {
            if (olderLoadRequestOwnerRef.current !== requestOwner) return
            olderLoadRequestOwnerRef.current = null
            olderLoadRequestPendingRef.current = false
            initialHistoryBackfillActiveRef.current = false
            setColdHistoryReadyKey(targetWindowKey)
        })
    }, [
        props.hasOlder,
        props.listRef,
        props.loadOlderError,
        props.loadingOlder,
        props.onLoadOlder,
        props.scrollContainerRef,
        props.selectionHydrating
    ])
    const requestInitialHistoryBackfillRef = useRef(requestInitialHistoryBackfill)
    requestInitialHistoryBackfillRef.current = requestInitialHistoryBackfill

    const scheduleInitialHistoryBackfillCheck = useCallback(() => {
        if (initialHistoryBackfillFrameRef.current !== null) return
        const targetWindowKey = props.windowKey
        initialHistoryBackfillFrameRef.current = window.requestAnimationFrame(() => {
            initialHistoryBackfillFrameRef.current = null
            // Hydration can finish while this frame is queued. Use its latest state.
            requestInitialHistoryBackfillRef.current(targetWindowKey)
        })
    }, [props.windowKey])

    const scheduleInitialPresentation = useCallback(() => {
        cancelStartupAlignment()
        const targetWindowKey = props.windowKey
        const onInitialLayout = props.onInitialLayout
        startupAlignmentFrameRef.current = window.requestAnimationFrame(() => {
            startupAlignmentFrameRef.current = null
            if (
                activeWindowKeyRef.current !== targetWindowKey
                || settledWindowKeyRef.current === targetWindowKey
            ) return
            startupAlignmentFrameRef.current = window.requestAnimationFrame(() => {
                startupAlignmentFrameRef.current = null
                if (activeWindowKeyRef.current !== targetWindowKey) return
                initialHistoryBackfillReadyRef.current = true
                scheduleInitialHistoryBackfillCheck()
                requestEndAlignment()
                settleInitialPresentation(targetWindowKey, onInitialLayout)
            })
        })
    }, [cancelStartupAlignment, props.onInitialLayout, props.windowKey, requestEndAlignment, scheduleInitialHistoryBackfillCheck, settleInitialPresentation])

    const stopFollowingForUserNavigation = useCallback(() => {
        clearCompletionEndFollow()
        cancelEndAlignment()
        cancelStartupAlignment()
        stopInitialHistoryBackfill()
        userNavigationAwayRef.current = true
        updateScrollMode('free-scrolling')
        settleInitialPresentation(props.windowKey, props.onInitialLayout)
    }, [cancelEndAlignment, cancelStartupAlignment, clearCompletionEndFollow, props.onInitialLayout, props.windowKey, settleInitialPresentation, stopInitialHistoryBackfill, updateScrollMode])

    useLayoutEffect(() => {
        if (!props.focusMessageId) return
        stopFollowingForUserNavigation()
    }, [props.focusMessageId, stopFollowingForUserNavigation])

    useLayoutEffect(() => {
        if (handledFollowRequestRef.current.windowKey !== props.windowKey) {
            handledFollowRequestRef.current = { windowKey: props.windowKey, key: null }
        }
        const key = props.followLatestRequestKey
        if (!key || handledFollowRequestRef.current.key === key) return
        handledFollowRequestRef.current.key = key
        followLatest()
    }, [followLatest, props.followLatestRequestKey, props.windowKey])

    useLayoutEffect(() => {
        const shouldSnap = shouldSnapRendererPresentation(
            visibilitySnapshot,
            handledResumeRevisionRef.current
        )
        handledResumeRevisionRef.current = visibilitySnapshot.resumeRevision
        if (!shouldSnap) return

        const shouldFollowEnd = completionFollowActiveRef.current
            || scrollModeRef.current === 'following-end'
        clearCompletionEndFollow()
        cancelEndAlignment()
        window.clearTimeout(disclosureTimerRef.current)
        disclosureTimerRef.current = 0
        setDisclosureLayoutActive(false)

        if (!shouldFollowEnd) return
        userNavigationAwayRef.current = false
        updateScrollMode('following-end')
        void props.listRef.current?.scrollToEnd({ animated: false })
    }, [
        cancelEndAlignment,
        clearCompletionEndFollow,
        props.listRef,
        updateScrollMode,
        visibilitySnapshot.resumeRevision,
        visibilitySnapshot.visible
    ])

    const assignScrollViewRef = useCallback((value: unknown) => {
        const element = resolveScrollElement(value)
        if (props.scrollContainerRef) props.scrollContainerRef.current = element
        setScrollElement((current) => current === element ? current : element)
    }, [props.scrollContainerRef])

    const requestOlderPage = useCallback(() => {
        const element = props.scrollContainerRef?.current || scrollElement
        if (!element || !props.onLoadOlder) return
        if (olderLoadRequestPendingRef.current || props.loadingOlder) return
        const plan = resolveAssistantHistoryStreamPlan({
            startupSettled,
            upwardIntent: Number.isFinite(lastUpwardIntentAtRef.current),
            hasOlder: props.hasOlder,
            loadingOlder: props.loadingOlder,
            hasLoadError: Boolean(props.loadOlderError),
            distanceFromStart: element.scrollTop,
            viewportSize: element.clientHeight,
            velocityPxPerMs: scrollVelocityRef.current
        })
        if (!plan.shouldRequest) return
        const requestOwner = {
            windowKey: props.windowKey,
            requestId: ++nextHistoryLoadRequestIdRef.current
        }
        olderLoadRequestPendingRef.current = true
        olderLoadRequestOwnerRef.current = requestOwner
        void Promise.resolve(props.onLoadOlder(plan.turnLimit)).catch(() => undefined).finally(() => {
            if (olderLoadRequestOwnerRef.current !== requestOwner) return
            olderLoadRequestOwnerRef.current = null
            olderLoadRequestPendingRef.current = false
        })
    }, [props.hasOlder, props.loadOlderError, props.loadingOlder, props.onLoadOlder, props.scrollContainerRef, props.windowKey, scrollElement, startupSettled])

    const requestNewerPage = useCallback(() => {
        const element = props.scrollContainerRef?.current || scrollElement
        if (!element || !props.onLoadNewer) return
        if (newerLoadRequestPendingRef.current || props.loadingNewer) return
        const plan = resolveAssistantHistoryStreamPlan({
            startupSettled,
            upwardIntent: Number.isFinite(lastDownwardIntentAtRef.current),
            hasOlder: props.hasNewer,
            loadingOlder: props.loadingNewer,
            hasLoadError: Boolean(props.loadNewerError),
            distanceFromStart: Math.max(0, element.scrollHeight - element.scrollTop - element.clientHeight),
            viewportSize: element.clientHeight,
            velocityPxPerMs: scrollVelocityRef.current
        })
        if (!plan.shouldRequest) return
        const requestOwner = {
            windowKey: props.windowKey,
            requestId: ++nextHistoryLoadRequestIdRef.current
        }
        newerLoadRequestPendingRef.current = true
        newerLoadRequestOwnerRef.current = requestOwner
        void Promise.resolve(props.onLoadNewer(plan.turnLimit)).catch(() => undefined).finally(() => {
            if (newerLoadRequestOwnerRef.current !== requestOwner) return
            newerLoadRequestOwnerRef.current = null
            newerLoadRequestPendingRef.current = false
        })
    }, [props.hasNewer, props.loadNewerError, props.loadingNewer, props.onLoadNewer, props.scrollContainerRef, props.windowKey, scrollElement, startupSettled])

    const retryOlderPage = useCallback(() => {
        if (!props.onLoadOlder || olderLoadRequestPendingRef.current || props.loadingOlder) return
        const requestOwner = {
            windowKey: props.windowKey,
            requestId: ++nextHistoryLoadRequestIdRef.current
        }
        olderLoadRequestPendingRef.current = true
        olderLoadRequestOwnerRef.current = requestOwner
        void Promise.resolve(props.onLoadOlder(1)).catch(() => undefined).finally(() => {
            if (olderLoadRequestOwnerRef.current !== requestOwner) return
            olderLoadRequestOwnerRef.current = null
            olderLoadRequestPendingRef.current = false
        })
    }, [props.loadingOlder, props.onLoadOlder, props.windowKey])

    const requestOrRetryNewerPage = useCallback(() => {
        if (props.loadNewerError) {
            if (!props.onLoadNewer || newerLoadRequestPendingRef.current || props.loadingNewer) return
            const requestOwner = {
                windowKey: props.windowKey,
                requestId: ++nextHistoryLoadRequestIdRef.current
            }
            newerLoadRequestPendingRef.current = true
            newerLoadRequestOwnerRef.current = requestOwner
            void Promise.resolve(props.onLoadNewer(1)).catch(() => undefined).finally(() => {
                if (newerLoadRequestOwnerRef.current !== requestOwner) return
                newerLoadRequestOwnerRef.current = null
                newerLoadRequestPendingRef.current = false
            })
            return
        }
        requestNewerPage()
    }, [props.loadNewerError, props.loadingNewer, props.onLoadNewer, props.windowKey, requestNewerPage])

    const handleInitialLoad = useCallback(() => {
        const now = performance.now()
        previousScrollTopRef.current = props.scrollContainerRef?.current?.scrollTop || 0
        previousScrollSampleAtRef.current = now
        previousInputSampleAtRef.current = now
        scrollVelocityRef.current = 0
        lastUpwardIntentAtRef.current = Number.NEGATIVE_INFINITY
        lastDownwardIntentAtRef.current = Number.NEGATIVE_INFINITY
        if (!userNavigationAwayRef.current) {
            updateScrollMode('following-end')
        }
        initialHistoryBackfillReadyRef.current = true
        scheduleInitialHistoryBackfillCheck()
        scheduleInitialPresentation()
    }, [props.scrollContainerRef, scheduleInitialHistoryBackfillCheck, scheduleInitialPresentation, updateScrollMode])

    useLayoutEffect(() => {
        if (settledWindowKeyRef.current === props.windowKey) return
        cancelInitialHistoryBackfillCheck()
        scheduleInitialPresentation()
        return cancelStartupAlignment
    }, [cancelInitialHistoryBackfillCheck, cancelStartupAlignment, props.windowKey, scheduleInitialPresentation])

    useLayoutEffect(() => {
        if (
            !initialHistoryBackfillReadyRef.current
            || !initialHistoryBackfillActiveRef.current
            || props.loadingOlder
        ) return
        scheduleInitialHistoryBackfillCheck()
        return cancelInitialHistoryBackfillCheck
    }, [
        cancelInitialHistoryBackfillCheck,
        historyFillRevision,
        props.loadingOlder,
        props.rows.length,
        props.windowKey,
        requestInitialHistoryBackfill,
        scheduleInitialHistoryBackfillCheck,
        startupSettled
    ])

    useEffect(() => {
        if (!scrollElement) return
        const previousOverscrollBehaviorY = scrollElement.style.overscrollBehaviorY
        scrollElement.style.overscrollBehaviorY = 'none'
        const handleDisclosureToggle = (event: Event) => {
            const detail = (event as CustomEvent<AssistantTimelineDisclosureToggleDetail>).detail
            const anchor = detail?.anchor
            const anchorRowId = anchor
                ?.closest<HTMLElement>('[data-assistant-timeline-row-id]')
                ?.dataset.assistantTimelineRowId || null
            beginDisclosureLayout(detail?.duration, anchorRowId)
        }
        const handleTimelinePointerDown = (event: PointerEvent) => {
            const target = event.target
            if (!(target instanceof Element)) return
            if (target === scrollElement) {
                const bounds = scrollElement.getBoundingClientRect()
                const scrollbarGutter = Math.max(12, scrollElement.offsetWidth - scrollElement.clientWidth)
                if (event.clientX < bounds.right - scrollbarGutter) return
                cancelDisclosureAnchor()
                stopFollowingForUserNavigation()
                const css = getComputedStyle(scrollElement)
                const actualGutter = scrollElement.offsetWidth - scrollElement.clientWidth
                    || parseFloat(getComputedStyle(scrollElement, '::-webkit-scrollbar').width) || 0
                const nativeScrollbarPress = event.button === 0 && event.clientX >= bounds.right - actualGutter
                const direction = nativeScrollbarPress ? resolveAssistantScrollbarTrackDirection({
                    pointerOffset: event.clientY - bounds.top - scrollElement.clientTop,
                    viewportSize: scrollElement.clientHeight,
                    scrollHeight: scrollElement.scrollHeight,
                    scrollTop: scrollElement.scrollTop,
                    minimumThumbSize: parseFloat(css.getPropertyValue('--assistant-scrollbar-thumb-min-height'))
                }) : null
                scrollbarDragActiveRef.current = nativeScrollbarPress
                scrollbarDragDirectionRef.current = direction
                // Native track presses keep their click direction. Thumb drags
                // can reverse direction through subsequent primary motion.
                scrollbarDragLastYRef.current = nativeScrollbarPress && !direction ? event.clientY : null
                if (direction === 'older') {
                    lastDownwardIntentAtRef.current = Number.NEGATIVE_INFINITY
                    recordUpwardIntent(scrollElement.clientHeight)
                    requestOlderPage()
                } else if (direction === 'newer') {
                    recordDownwardIntent(scrollElement.clientHeight)
                    requestOrRetryNewerPage()
                }
                return
            }
            const button = target.closest('button[aria-expanded]')
            if (!button || !scrollElement.contains(button) || !button.closest('[data-assistant-timeline-row-id]')) return
            cancelDisclosureAnchor()
            stopFollowingForUserNavigation()
            beginDisclosureLayout()
        }
        const handleKeyboardClick = (event: MouseEvent) => {
            if (event.detail !== 0) return
            handleTimelinePointerDown(event as unknown as PointerEvent)
        }
        const trackScrollbarDragDirection = (event: PointerEvent) => {
            if (!scrollbarDragActiveRef.current || !(event.buttons & 1)) return
            const previousY = scrollbarDragLastYRef.current
            if (previousY === null) return
            const deltaY = event.clientY - previousY
            if (Math.abs(deltaY) <= 2) return
            scrollbarDragLastYRef.current = event.clientY
            scrollbarDragDirectionRef.current = deltaY < 0 ? 'older' : 'newer'
            const now = performance.now()
            lastUpwardIntentAtRef.current = deltaY < 0 ? now : Number.NEGATIVE_INFINITY
            lastDownwardIntentAtRef.current = deltaY > 0 ? now : Number.NEGATIVE_INFINITY
        }
        const finishScrollbarDrag = (event?: Event) => {
            // Native thumbs may capture movement without DOM pointermove. A
            // release displacement is still explicit input; layout delta isn't.
            if (scrollbarDragActiveRef.current && event?.type === 'pointerup' && (event as PointerEvent).button === 0) {
                const direction = resolveAssistantScrollbarReleaseDirection({
                    previousY: scrollbarDragLastYRef.current,
                    pointerY: (event as PointerEvent).clientY,
                    direction: scrollbarDragDirectionRef.current
                })
                if (direction === 'older') {
                    lastDownwardIntentAtRef.current = Number.NEGATIVE_INFINITY
                    lastUpwardIntentAtRef.current = performance.now()
                    requestOlderPage()
                } else if (direction === 'newer') {
                    lastUpwardIntentAtRef.current = Number.NEGATIVE_INFINITY
                    lastDownwardIntentAtRef.current = performance.now()
                    requestOrRetryNewerPage()
                    const followState = resolveAssistantTimelineModeAfterScroll({
                        userNavigatedAway: userNavigationAwayRef.current,
                        resolvedMode: resolveAssistantTimelineScrollMode(scrollElement),
                        movingTowardEnd: true,
                        disclosureLayoutActive: disclosureTimerRef.current !== 0
                    })
                    userNavigationAwayRef.current = followState.userNavigatedAway
                    updateScrollMode(followState.mode)
                }
            }
            scrollbarDragActiveRef.current = false
            scrollbarDragDirectionRef.current = null
            scrollbarDragLastYRef.current = null
        }
        const recordUpwardIntent = (distancePx: number, now = performance.now()) => {
            const elapsed = previousInputSampleAtRef.current > 0 ? now - previousInputSampleAtRef.current : 16
            previousInputSampleAtRef.current = now
            scrollVelocityRef.current = updateAssistantHistoryScrollVelocity(
                scrollVelocityRef.current,
                distancePx,
                elapsed
            )
            lastUpwardIntentAtRef.current = now
        }
        const recordDownwardIntent = (distancePx: number, now = performance.now()) => {
            const elapsed = previousInputSampleAtRef.current > 0 ? now - previousInputSampleAtRef.current : 16
            previousInputSampleAtRef.current = now
            scrollVelocityRef.current = updateAssistantHistoryScrollVelocity(scrollVelocityRef.current, distancePx, elapsed)
            lastUpwardIntentAtRef.current = Number.NEGATIVE_INFINITY
            lastDownwardIntentAtRef.current = now
        }
        const handleWheel = (event: WheelEvent) => {
            if (event.ctrlKey || Math.abs(event.deltaY) < Math.abs(event.deltaX)) return
            cancelDisclosureAnchor()
            if (event.deltaY > 0 && !props.hasNewer && resolveAssistantTimelineScrollMode(scrollElement) === 'following-end') {
                lastUpwardIntentAtRef.current = Number.NEGATIVE_INFINITY
                lastDownwardIntentAtRef.current = Number.NEGATIVE_INFINITY
                userNavigationAwayRef.current = false
                updateScrollMode('following-end')
                return
            }
            stopFollowingForUserNavigation()
            markMarkdownScrollActivity()
            const wheelDistance = normalizeAssistantHistoryWheelDelta(
                event.deltaY,
                event.deltaMode,
                scrollElement.clientHeight
            )
            if (event.deltaY < 0) {
                lastDownwardIntentAtRef.current = Number.NEGATIVE_INFINITY
                recordUpwardIntent(wheelDistance)
                requestOlderPage()
            } else if (event.deltaY > 0) {
                recordDownwardIntent(wheelDistance)
                requestOrRetryNewerPage()
            }
        }
        const handleKeyDown = (event: KeyboardEvent) => {
            const isSpace = [' ', 'Spacebar'].includes(event.key)
            const target = isSpace && event.target instanceof Element ? event.target : null
            const editable = target?.closest<HTMLElement>('[contenteditable]')
            const consumesSpace = Boolean(editable?.isContentEditable || target?.closest(SPACE_CONSUMING_CONTROL_SELECTOR))
            const spaceDirection = resolveAssistantSpaceScrollDirection(event, consumesSpace)
            if (['ArrowDown', 'PageDown', 'End'].includes(event.key) || spaceDirection === 'newer') {
                recordDownwardIntent(event.key === 'ArrowDown' ? 36 : scrollElement.clientHeight)
                requestOrRetryNewerPage()
                return
            }
            const upwardIntent = ['ArrowUp', 'PageUp', 'Home'].includes(event.key) || spaceDirection === 'older'
            if (!upwardIntent) return
            cancelDisclosureAnchor()
            stopFollowingForUserNavigation()
            lastDownwardIntentAtRef.current = Number.NEGATIVE_INFINITY
            recordUpwardIntent(event.key === 'ArrowUp' ? 36 : scrollElement.clientHeight)
            requestOlderPage()
        }
        const handleTouchStart = (event: TouchEvent) => {
            touchStartYRef.current = event.touches[0]?.clientY ?? null
            previousInputSampleAtRef.current = performance.now()
        }
        const handleTouchMove = (event: TouchEvent) => {
            const nextY = event.touches[0]?.clientY ?? null
            const previousY = touchStartYRef.current
            if (nextY !== null && previousY !== null && Math.abs(nextY - previousY) > 4) {
                cancelDisclosureAnchor()
                stopFollowingForUserNavigation()
                const upwardIntent = nextY > previousY
                if (upwardIntent) {
                    lastDownwardIntentAtRef.current = Number.NEGATIVE_INFINITY
                    recordUpwardIntent(Math.abs(nextY - previousY))
                    requestOlderPage()
                } else {
                    recordDownwardIntent(Math.abs(nextY - previousY))
                    requestOrRetryNewerPage()
                }
            }
            touchStartYRef.current = nextY
        }
        const handleUserJump = () => {
            cancelDisclosureAnchor()
            stopFollowingForUserNavigation()
        }
        const handleFollowEnd = (event: Event) => followLatest((event as CustomEvent<{ animated?: boolean }>).detail?.animated === true)
        scrollElement.addEventListener(ASSISTANT_TIMELINE_FOLLOW_END_EVENT, handleFollowEnd)
        scrollElement.addEventListener(ASSISTANT_TIMELINE_DISCLOSURE_TOGGLE_EVENT, handleDisclosureToggle)
        scrollElement.addEventListener(ASSISTANT_TIMELINE_USER_JUMP_EVENT, handleUserJump)
        scrollElement.addEventListener('pointerdown', handleTimelinePointerDown, { passive: true })
        scrollElement.addEventListener('click', handleKeyboardClick)
        scrollElement.addEventListener('wheel', handleWheel, { passive: true })
        scrollElement.addEventListener('keydown', handleKeyDown)
        scrollElement.addEventListener('touchstart', handleTouchStart, { passive: true })
        scrollElement.addEventListener('touchmove', handleTouchMove, { passive: true })
        window.addEventListener('pointermove', trackScrollbarDragDirection, { passive: true })
        window.addEventListener('pointerup', finishScrollbarDrag, { passive: true })
        window.addEventListener('pointercancel', finishScrollbarDrag, { passive: true })
        return () => {
            scrollElement.removeEventListener(ASSISTANT_TIMELINE_FOLLOW_END_EVENT, handleFollowEnd)
            scrollElement.removeEventListener(ASSISTANT_TIMELINE_DISCLOSURE_TOGGLE_EVENT, handleDisclosureToggle)
            scrollElement.removeEventListener(ASSISTANT_TIMELINE_USER_JUMP_EVENT, handleUserJump)
            scrollElement.removeEventListener('pointerdown', handleTimelinePointerDown)
            scrollElement.removeEventListener('click', handleKeyboardClick)
            scrollElement.removeEventListener('wheel', handleWheel)
            scrollElement.removeEventListener('keydown', handleKeyDown)
            scrollElement.removeEventListener('touchstart', handleTouchStart)
            scrollElement.removeEventListener('touchmove', handleTouchMove)
            window.removeEventListener('pointermove', trackScrollbarDragDirection)
            window.removeEventListener('pointerup', finishScrollbarDrag)
            window.removeEventListener('pointercancel', finishScrollbarDrag)
            finishScrollbarDrag()
            scrollElement.style.overscrollBehaviorY = previousOverscrollBehaviorY
        }
    }, [
        beginDisclosureLayout,
        cancelDisclosureAnchor,
        followLatest,
        props.hasNewer,
        props.hasOlder,
        props.loadOlderError,
        props.loadingOlder,
        props.windowKey,
        requestNewerPage,
        requestOlderPage,
        requestOrRetryNewerPage,
        scrollElement,
        startupSettled,
        stopFollowingForUserNavigation,
        updateScrollMode
    ])

    useLayoutEffect(() => {
        if (previousCompletionWindowKeyRef.current !== props.windowKey) {
            previousCompletionWindowKeyRef.current = props.windowKey
            previousRowsRef.current = props.rows
            clearCompletionEndFollow()
            cancelEndAlignment()
            // Opening a search result is deliberate history navigation, not
            // a request for the live end. Keep that ownership through startup.
            userNavigationAwayRef.current = Boolean(props.focusMessageId)
            updateScrollMode(props.focusMessageId ? 'free-scrolling' : 'following-end')
            return
        }

        const previousRows = previousRowsRef.current
        previousRowsRef.current = props.rows
        if (
            !scrollElement
            || scrollModeRef.current !== 'following-end'
            || !didAssistantTimelineWorkComplete(previousRows, props.rows)
        ) return

        clearCompletionEndFollow()
        const visibility = rendererVisibility.getSnapshot()
        if (shouldSnapRendererPresentation(visibility, visibility.resumeRevision)) {
            void props.listRef.current?.scrollToEnd({ animated: false })
            return
        }

        completionFollowActiveRef.current = true
        beginDisclosureLayout(COMPLETION_LAYOUT_SETTLE_MS - DISCLOSURE_SETTLE_PADDING_MS)
        completionFollowTimerRef.current = window.setTimeout(() => {
            completionFollowTimerRef.current = 0
            completionFollowActiveRef.current = false
            requestEndAlignment()
        }, COMPLETION_LAYOUT_SETTLE_MS)
    }, [
        beginDisclosureLayout,
        cancelEndAlignment,
        cancelStartupAlignment,
        clearCompletionEndFollow,
        props.listRef,
        props.focusMessageId,
        props.rows,
        props.windowKey,
        requestEndAlignment,
        scrollElement,
        updateScrollMode
    ])

    useLayoutEffect(() => {
        // LegendList owns live size/data follow. A second instant alignment on
        // every token canceled its animation and produced visible line jumps.
        if (startupSettled && textStreaming) return
        if (!stoppedPresentation && !props.selectionHydrating && !disclosureLayoutActive && !props.focusMessageId
            && scrollModeRef.current === 'following-end') requestEndAlignment()
    }, [disclosureLayoutActive, props.focusMessageId, props.rows, props.selectionHydrating, props.windowKey, requestEndAlignment, startupSettled, stoppedPresentation, textStreaming])

    useEffect(() => () => {
        window.clearTimeout(disclosureTimerRef.current)
        cancelDisclosureAnchor()
        clearCompletionEndFollow()
        cancelEndAlignment()
        cancelStartupAlignment()
        cancelInitialHistoryBackfillCheck()
    }, [cancelDisclosureAnchor, cancelEndAlignment, cancelInitialHistoryBackfillCheck, cancelStartupAlignment, clearCompletionEndFollow])

    const renderItem = useCallback(({ item }: LegendListRenderItemProps<TimelineDisplayRow>) => (
        <div
            id={item.kind === 'message' ? `assistant-message-${encodeURIComponent(item.message.id)}` : undefined}
            className="pb-4"
            data-assistant-timeline-row-id={item.id}
            data-assistant-timeline-row-kind={item.kind}
            data-assistant-message-role={item.kind === 'message' ? item.message.role : undefined}
        >
            {renderRowRef.current(item)}
        </div>
    ), [])

    const header = (
        <div className="flex min-h-11 justify-center pt-2">
            {props.loadOlderError ? (
                <>
                    <button
                        type="button"
                        onClick={retryOlderPage}
                        className="assistant-older-messages-loader inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-sparkle-card/95 px-2.5 py-1 text-[10px] font-medium text-sparkle-text-muted shadow-lg shadow-black/20 backdrop-blur-md hover:text-sparkle-text-secondary"
                    >
                        <ChevronUp size={11} aria-hidden="true" />
                        Retry earlier messages
                    </button>
                    <span className="sr-only">{props.loadOlderError}</span>
                </>
            ) : props.loadingOlder ? (
                <span className="sr-only" role="status">Loading earlier messages</span>
            ) : null}
            {props.loadingNewer ? <span className="sr-only" role="status">Loading newer messages</span> : null}
            {props.loadNewerError ? <span className="sr-only">Newer messages could not load. Continue downward to retry.</span> : null}
        </div>
    )

    return (
        <div className="relative h-full w-full">
        <LegendList
            ref={props.listRef}
            refScrollView={assignScrollViewRef}
            data={props.rows}
            extraData={rowDisclosureState}
            dataKey={props.windowKey}
            keyExtractor={keyExtractor}
            getItemType={getItemType}
            renderItem={renderItem}
            estimatedItemSize={90}
            initialScrollAtEnd
            onLoad={handleInitialLoad}
            onItemSizeChanged={compensateIntraRowMedia}
            maintainVisibleContentPosition={maintainVisibleContentPosition}
            maintainScrollAtEnd={scrollMode === 'following-end' && !(startupSettled && stoppedPresentation) ? {
                animated: startupSettled && textStreaming && !reducedMotion,
                on: {
                    dataChange: true,
                    itemLayout: !disclosureLayoutActive,
                    layout: !disclosureLayoutActive
                }
            } : false}
            // Follow is owned by opening/send/latest intent, not by geometry
            // after a tall prompt or late measurement moves the end farther away.
            maintainScrollAtEndThreshold={scrollMode === 'following-end' ? Number.POSITIVE_INFINITY : 0.12}
            contentInsetEndAdjustment={props.contentInsetEndAdjustment}
            ListHeaderComponent={header}
            estimatedHeaderSize={44}
            onScroll={() => {
                markMarkdownScrollActivity()
                const element = props.scrollContainerRef?.current || scrollElement
                if (!element) return
                if (!completionFollowActiveRef.current) {
                    const now = performance.now()
                    const resolvedMode = resolveAssistantTimelineScrollMode(element)
                    const previousScrollTop = previousScrollTopRef.current
                    const scrollDelta = element.scrollTop - previousScrollTop
                    // MVCP/media compensation can increase scrollTop without
                    // user motion. Reacquire follow only after real down intent.
                    const movingTowardEnd = scrollDelta > 0.5
                        && lastDownwardIntentAtRef.current > lastUpwardIntentAtRef.current
                        && now - lastDownwardIntentAtRef.current < 1500
                    const scrollbarDemand = resolveAssistantScrollbarHistoryDemand({
                        dragActive: scrollbarDragActiveRef.current,
                        dragDirection: scrollbarDragDirectionRef.current,
                        scrollDelta
                    })
                    scrollbarDragDirectionRef.current = scrollbarDemand.dragDirection
                    if (scrollbarDemand.requestDirection === 'older' && userNavigationAwayRef.current) {
                        const elapsed = previousScrollSampleAtRef.current > 0 ? now - previousScrollSampleAtRef.current : 16
                        scrollVelocityRef.current = updateAssistantHistoryScrollVelocity(
                            scrollVelocityRef.current,
                            previousScrollTop - element.scrollTop,
                            elapsed
                        )
                        lastDownwardIntentAtRef.current = Number.NEGATIVE_INFINITY
                        lastUpwardIntentAtRef.current = now
                        requestOlderPage()
                    } else if (scrollbarDemand.requestDirection === 'newer' && userNavigationAwayRef.current) {
                        const elapsed = previousScrollSampleAtRef.current > 0 ? now - previousScrollSampleAtRef.current : 16
                        scrollVelocityRef.current = updateAssistantHistoryScrollVelocity(
                            scrollVelocityRef.current,
                            element.scrollTop - previousScrollTop,
                            elapsed
                        )
                        lastUpwardIntentAtRef.current = Number.NEGATIVE_INFINITY
                        lastDownwardIntentAtRef.current = now
                        requestOrRetryNewerPage()
                    }
                    const followState = resolveAssistantTimelineModeAfterScroll({
                        userNavigatedAway: userNavigationAwayRef.current,
                        resolvedMode,
                        movingTowardEnd: movingTowardEnd || scrollbarDemand.requestDirection === 'newer',
                        disclosureLayoutActive
                    })
                    userNavigationAwayRef.current = followState.userNavigatedAway
                    updateScrollMode(followState.mode)
                    previousScrollTopRef.current = element.scrollTop
                    previousScrollSampleAtRef.current = now
                }
                mediaAnchorRef.current = canAnchorMedia()
                    ? captureAssistantTimelineMediaAnchor(element, props.windowKey)
                    : null
                props.onScrollContainer?.(element)
            }}
            style={{ visibility: coldHistoryPending ? 'hidden' : undefined }}
            aria-busy={coldHistoryPending || !startupSettled}
            className="assistant-chat-scrollbar assistant-timeline-scrollbar h-full w-full overflow-x-hidden [overflow-anchor:none]"
            contentContainerClassName="mx-auto w-full max-w-3xl px-4 pt-0 md:translate-x-[2px]"
        />
        {coldHistoryPending ? <div role="status" className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-sparkle-text-muted">Loading chat…</div> : null}
        </div>
    )
})
