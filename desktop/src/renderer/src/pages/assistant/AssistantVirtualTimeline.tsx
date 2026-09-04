import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { LegendList, type LegendListRef, type LegendListRenderItemProps } from '@legendapp/list/react'
import { ChevronUp } from 'lucide-react'
import {
    rendererVisibility,
    shouldSnapRendererPresentation,
    useRendererVisibilitySnapshot
} from '@/lib/renderer-visibility'
import type { TimelineDisplayRow } from './assistant-timeline-helpers'
import {
    ASSISTANT_TIMELINE_DISCLOSURE_TOGGLE_EVENT,
    didAssistantTimelineWorkComplete,
    type AssistantTimelineDisclosureToggleDetail
} from './assistant-timeline-scroll-events'
import {
    resolveAssistantTimelineModeAfterScroll,
    resolveAssistantTimelineScrollMode,
    type AssistantTimelineScrollMode
} from './assistant-timeline-scroll-policy'
import {
    normalizeAssistantHistoryWheelDelta,
    resolveAssistantInitialHistoryBackfill,
    resolveAssistantHistoryStreamPlan,
    resolveAssistantScrollbarHistoryDemand,
    updateAssistantHistoryScrollVelocity
} from './assistant-history-streaming-policy'

const keyExtractor = (row: TimelineDisplayRow) => row.id
const getItemType = (row: TimelineDisplayRow) => row.kind
const DEFAULT_DISCLOSURE_SETTLE_MS = 420
const DISCLOSURE_SETTLE_PADDING_MS = 80
const COMPLETION_LAYOUT_SETTLE_MS = 720
const ASSISTANT_TIMELINE_USER_JUMP_EVENT = 'assistant:timeline-user-jump'

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
    listRef: RefObject<LegendListRef | null>
    scrollContainerRef?: RefObject<HTMLDivElement | null>
    contentInsetEndAdjustment: number
    isWorking: boolean
    selectionHydrating: boolean
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
    const renderRowRef = useRef(props.renderRow)
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
    const previousScrollTopRef = useRef(0)
    const previousScrollSampleAtRef = useRef(0)
    const previousInputSampleAtRef = useRef(0)
    const scrollVelocityRef = useRef(0)
    const lastUpwardIntentAtRef = useRef(Number.NEGATIVE_INFINITY)
    const lastDownwardIntentAtRef = useRef(Number.NEGATIVE_INFINITY)
    const userNavigationAwayRef = useRef(false)
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
        endAlignmentFrameRef.current = window.requestAnimationFrame(() => {
            endAlignmentFrameRef.current = null
            if (scrollModeRef.current !== 'following-end') return
            const element = props.scrollContainerRef?.current
            if (element && Math.max(0, element.scrollHeight - element.scrollTop - element.clientHeight) > 1) return
            void props.listRef.current?.scrollToEnd({ animated: false })
        })
    }, [props.listRef, props.scrollContainerRef])

    const beginDisclosureLayout = useCallback((
        duration = DEFAULT_DISCLOSURE_SETTLE_MS,
        anchorRowId: string | null = null
    ) => {
        window.clearTimeout(disclosureTimerRef.current)
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
        setScrollMode((current) => current === nextMode ? current : nextMode)
    }, [])

    const requestInitialHistoryBackfill = useCallback((targetWindowKey: string) => {
        if (
            activeWindowKeyRef.current !== targetWindowKey
            || initialHistoryBackfillWindowKeyRef.current !== targetWindowKey
            || !initialHistoryBackfillActiveRef.current
            || !props.onLoadOlder
        ) return
        const state = props.listRef.current?.getState()
        const element = props.scrollContainerRef?.current
        const plan = resolveAssistantInitialHistoryBackfill({
            initialLayoutReady: initialHistoryBackfillReadyRef.current,
            selectionSettled: !props.selectionHydrating,
            isWorking: props.isWorking,
            hasOlder: props.hasOlder,
            loadingOlder: props.loadingOlder,
            hasLoadError: Boolean(props.loadOlderError),
            requestPending: olderLoadRequestPendingRef.current,
            contentLength: state?.contentLength || 0,
            viewportSize: state?.scrollLength || element?.clientHeight || 0,
            pagesRequested: initialHistoryBackfillPagesRef.current
        })
        if (!plan.shouldRequest) return

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
            if (accepted === false) {
                initialHistoryBackfillPagesRef.current = Math.max(0, initialHistoryBackfillPagesRef.current - 1)
            }
        }).catch(() => {
            if (olderLoadRequestOwnerRef.current !== requestOwner) return
            olderLoadRequestOwnerRef.current = null
            olderLoadRequestPendingRef.current = false
            initialHistoryBackfillActiveRef.current = false
        })
    }, [
        props.hasOlder,
        props.isWorking,
        props.listRef,
        props.loadOlderError,
        props.loadingOlder,
        props.onLoadOlder,
        props.scrollContainerRef,
        props.selectionHydrating
    ])

    const scheduleInitialHistoryBackfillCheck = useCallback(() => {
        if (initialHistoryBackfillFrameRef.current !== null) return
        const targetWindowKey = props.windowKey
        initialHistoryBackfillFrameRef.current = window.requestAnimationFrame(() => {
            initialHistoryBackfillFrameRef.current = null
            requestInitialHistoryBackfill(targetWindowKey)
        })
    }, [props.windowKey, requestInitialHistoryBackfill])

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
                settleInitialPresentation(targetWindowKey, onInitialLayout)
            })
        })
    }, [cancelStartupAlignment, props.onInitialLayout, props.windowKey, scheduleInitialHistoryBackfillCheck, settleInitialPresentation])

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
            || props.isWorking
        ) return
        scheduleInitialHistoryBackfillCheck()
        return cancelInitialHistoryBackfillCheck
    }, [
        cancelInitialHistoryBackfillCheck,
        props.isWorking,
        props.loadingOlder,
        props.rows.length,
        props.windowKey,
        scheduleInitialHistoryBackfillCheck
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
                scrollbarDragActiveRef.current = true
                scrollbarDragDirectionRef.current = null
                scrollbarDragLastYRef.current = event.clientY
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
            if (!scrollbarDragActiveRef.current) return
            const previousY = scrollbarDragLastYRef.current
            scrollbarDragLastYRef.current = event.clientY
            if (scrollbarDragDirectionRef.current || previousY === null) return
            const deltaY = event.clientY - previousY
            if (Math.abs(deltaY) <= 2) return
            scrollbarDragDirectionRef.current = deltaY < 0 ? 'older' : 'newer'
        }
        const finishScrollbarDrag = () => {
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
                const now = performance.now()
                const elapsed = previousInputSampleAtRef.current > 0 ? now - previousInputSampleAtRef.current : 16
                previousInputSampleAtRef.current = now
                scrollVelocityRef.current = updateAssistantHistoryScrollVelocity(scrollVelocityRef.current, wheelDistance, elapsed)
                lastUpwardIntentAtRef.current = Number.NEGATIVE_INFINITY
                lastDownwardIntentAtRef.current = now
                requestOrRetryNewerPage()
            }
        }
        const handleKeyDown = (event: KeyboardEvent) => {
            if (['ArrowDown', 'PageDown', 'End'].includes(event.key)) {
                const now = performance.now()
                const distance = event.key === 'ArrowDown' ? 36 : scrollElement.clientHeight
                const elapsed = previousInputSampleAtRef.current > 0 ? now - previousInputSampleAtRef.current : 16
                previousInputSampleAtRef.current = now
                scrollVelocityRef.current = updateAssistantHistoryScrollVelocity(scrollVelocityRef.current, distance, elapsed)
                lastUpwardIntentAtRef.current = Number.NEGATIVE_INFINITY
                lastDownwardIntentAtRef.current = now
                requestOrRetryNewerPage()
                return
            }
            const upwardIntent = ['ArrowUp', 'PageUp', 'Home'].includes(event.key)
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
                    const now = performance.now()
                    const elapsed = previousInputSampleAtRef.current > 0 ? now - previousInputSampleAtRef.current : 16
                    previousInputSampleAtRef.current = now
                    scrollVelocityRef.current = updateAssistantHistoryScrollVelocity(scrollVelocityRef.current, Math.abs(nextY - previousY), elapsed)
                    lastUpwardIntentAtRef.current = Number.NEGATIVE_INFINITY
                    lastDownwardIntentAtRef.current = now
                    requestOrRetryNewerPage()
                }
            }
            touchStartYRef.current = nextY
        }
        const handleUserJump = () => {
            cancelDisclosureAnchor()
            stopFollowingForUserNavigation()
        }
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
            cancelStartupAlignment()
            userNavigationAwayRef.current = false
            updateScrollMode('following-end')
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
        props.rows,
        props.windowKey,
        requestEndAlignment,
        scrollElement,
        updateScrollMode
    ])

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
        <LegendList
            ref={props.listRef}
            refScrollView={assignScrollViewRef}
            data={props.rows}
            dataKey={props.windowKey}
            keyExtractor={keyExtractor}
            getItemType={getItemType}
            renderItem={renderItem}
            estimatedItemSize={90}
            initialScrollAtEnd
            onLoad={handleInitialLoad}
            maintainVisibleContentPosition={maintainVisibleContentPosition}
            maintainScrollAtEnd={scrollMode === 'following-end' ? {
                animated: false,
                on: {
                    dataChange: true,
                    itemLayout: !disclosureLayoutActive,
                    layout: !disclosureLayoutActive
                }
            } : false}
            maintainScrollAtEndThreshold={0.12}
            contentInsetEndAdjustment={props.contentInsetEndAdjustment}
            ListHeaderComponent={header}
            estimatedHeaderSize={44}
            onScroll={() => {
                const element = props.scrollContainerRef?.current || scrollElement
                if (!element) return
                if (!completionFollowActiveRef.current) {
                    const now = performance.now()
                    const resolvedMode = resolveAssistantTimelineScrollMode(element)
                    const previousScrollTop = previousScrollTopRef.current
                    const scrollDelta = element.scrollTop - previousScrollTop
                    const movingTowardEnd = scrollDelta > 0.5
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
                    } else if (scrollbarDemand.requestDirection === 'newer' && userNavigationAwayRef.current && props.hasNewer) {
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
                        movingTowardEnd,
                        disclosureLayoutActive
                    })
                    userNavigationAwayRef.current = followState.userNavigatedAway
                    updateScrollMode(followState.mode)
                    previousScrollTopRef.current = element.scrollTop
                    previousScrollSampleAtRef.current = now
                }
                props.onScrollContainer?.(element)
            }}
            aria-busy={!startupSettled}
            className="assistant-chat-scrollbar h-full w-full overflow-x-hidden [overflow-anchor:none]"
            contentContainerClassName="mx-auto w-full max-w-3xl px-4 pt-0 md:translate-x-[2px]"
        />
    )
})
