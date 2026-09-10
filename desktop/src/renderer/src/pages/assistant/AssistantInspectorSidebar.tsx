import {
    DndContext,
    DragOverlay,
    KeyboardSensor,
    PointerSensor,
    closestCenter,
    useSensor,
    useSensors,
    type DragCancelEvent,
    type DragEndEvent,
    type DragStartEvent
} from '@dnd-kit/core'
import {
    SortableContext,
    horizontalListSortingStrategy,
    sortableKeyboardCoordinates,
    useSortable
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { LoaderCircle, Plus, X } from 'lucide-react'
import { FileActionsMenu, type FileActionsMenuItem } from '@/components/ui/FileActionsMenu'
import { usePublishAssistantTitleBarEndRegion } from '@/lib/assistant/assistant-title-bar'
import { cn } from '@/lib/utils'
import { ASSISTANT_MIN_INSPECTOR_WIDTH } from './assistant-pane-layout'
import { createAssistantTabDragWithTearOff } from './assistant-tab-drag-modifier'

export type AssistantInspectorTab = {
    id: string
    label: string
    icon?: ReactNode
    statusIcon?: ReactNode
    count?: number
    closable?: boolean
    loading?: boolean
    attention?: boolean
    preview?: string
    previewDisabled?: boolean
    loadPreviewImage?: () => Promise<string | null>
}

export type AssistantInspectorTabPreview = {
    tabId: string
    label: string
    detail: string
    left: number
    imageRequested: boolean
    imageLoading: boolean
    imageUrl: string | null
}

type ResizeState = {
    pointerId: number
    startX: number
    startWidth: number
    width: number
}

const MAX_WORKSPACE_TAB_WIDTH = 168
const MIN_WORKSPACE_TAB_WIDTH = 74
const TITLE_BAR_RESERVED_WIDTH = 188
const TEXT_TAB_PREVIEW_WIDTH = 184
const BROWSER_TAB_PREVIEW_WIDTH = 256
export const ASSISTANT_INSPECTOR_TAB_KEYBOARD_CODES = {
    start: ['Space'],
    cancel: ['Escape'],
    end: ['Space']
}

export function calculateWorkspaceTabWidth(inspectorWidth: number, tabCount: number): number {
    const availableWidth = Math.floor(
        (inspectorWidth - TITLE_BAR_RESERVED_WIDTH - Math.max(0, tabCount - 1) * 4) / Math.max(1, tabCount)
    )
    return Math.max(MIN_WORKSPACE_TAB_WIDTH, Math.min(MAX_WORKSPACE_TAB_WIDTH, availableWidth))
}

export function assistantInspectorTabPreviewWidth(tab: AssistantInspectorTab): number {
    return tab.loadPreviewImage ? BROWSER_TAB_PREVIEW_WIDTH : TEXT_TAB_PREVIEW_WIDTH
}

function clampInspectorWidth(width: number, maxWidth: number): number {
    const resolvedMaxWidth = Math.max(ASSISTANT_MIN_INSPECTOR_WIDTH, Math.round(maxWidth))
    return Math.max(ASSISTANT_MIN_INSPECTOR_WIDTH, Math.min(resolvedMaxWidth, Math.round(width)))
}

function readPrefersReducedMotion(): boolean {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function InspectorTabIdentity({ tab, active }: { tab: AssistantInspectorTab; active: boolean }) {
    return (
        <>
            <span className={cn(active ? 'text-[var(--accent-primary)]/85' : 'text-current')}>
                {tab.loading ? <LoaderCircle size={11} className="animate-spin" /> : tab.icon}
            </span>
            <span className="min-w-0 flex-1 truncate text-left">{tab.label}</span>
            {tab.statusIcon ? <span className="shrink-0 text-[var(--accent-primary)]" title={`${tab.label} is playing audio`}>{tab.statusIcon}</span> : null}
            {tab.count !== undefined ? <span className="shrink-0 font-mono text-[8px] text-sparkle-text-muted/55">{tab.count}</span> : null}
        </>
    )
}

export function SortableInspectorTab({
    tab,
    active,
    closing,
    collapsing = false,
    sortable,
    reducedMotion,
    targetWorkspaceTabWidth,
    onSelect,
    onClose,
    onPreviewEnter,
    onPreviewLeave
}: {
    tab: AssistantInspectorTab
    active: boolean
    closing: boolean
    collapsing?: boolean
    sortable: boolean
    reducedMotion: boolean
    targetWorkspaceTabWidth: number
    onSelect: () => void
    onClose: () => void
    onPreviewEnter: (event: React.PointerEvent<HTMLDivElement>, tab: AssistantInspectorTab) => void
    onPreviewLeave: () => void
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: tab.id,
        disabled: closing || !sortable,
        data: { type: 'assistant-inspector-tab', tabId: tab.id }
    })

    return (
        <div
            ref={setNodeRef}
            data-inspector-tab-id={tab.id}
            data-inspector-tab-dragging={isDragging ? 'true' : undefined}
            role="tab"
            aria-selected={active}
            onPointerEnter={(event) => onPreviewEnter(event, tab)}
            onPointerLeave={onPreviewLeave}
            style={{
                width: collapsing ? 0 : targetWorkspaceTabWidth,
                transform: CSS.Transform.toString(transform),
                transition: collapsing
                    ? reducedMotion ? undefined : 'width 180ms cubic-bezier(0.22, 1, 0.36, 1), opacity 140ms ease-out'
                    : reducedMotion || isDragging
                        ? undefined
                        : `${transition || 'transform 180ms cubic-bezier(0.22, 1, 0.36, 1)'}, width 180ms cubic-bezier(0.22, 1, 0.36, 1), background-color 90ms ease-out, border-color 90ms ease-out, opacity 120ms ease-out`,
                opacity: isDragging ? 0.15 : undefined,
                zIndex: isDragging ? 20 : undefined
            }}
            className={cn(
                'inspector-workspace-tab no-drag group/tab relative flex h-7 shrink-0 select-none items-center overflow-hidden rounded-md border border-transparent will-change-transform',
                collapsing && 'pointer-events-none border-0 opacity-0',
                closing && cn('pointer-events-none', !reducedMotion && !collapsing && 'animate-[inspector-tab-out_130ms_ease-in_both]'),
                active
                    ? 'border-[color-mix(in_srgb,var(--color-text)_13%,transparent)] bg-[color-mix(in_srgb,var(--color-text)_9%,var(--surface-inspector-tab))] text-sparkle-text shadow-[0_1px_3px_color-mix(in_srgb,var(--color-bg)_48%,transparent),inset_0_1px_0_color-mix(in_srgb,var(--color-text)_8%,transparent)]'
                    : tab.attention
                        ? 'border-amber-300/25 bg-amber-400/[0.09] text-amber-100'
                        : 'text-sparkle-text-secondary/82 hover:bg-[color-mix(in_srgb,var(--color-text)_6%,transparent)] hover:text-sparkle-text'
            )}
        >
            <button
                type="button"
                {...attributes}
                {...listeners}
                onClick={onSelect}
                className={cn(
                    'inline-flex h-full min-w-0 flex-1 touch-none items-center justify-start gap-1.5 overflow-hidden pl-2 pr-1 text-left text-[10px] font-medium outline-none',
                    isDragging && 'cursor-grabbing'
                )}
                aria-current={active ? 'page' : undefined}
            >
                <InspectorTabIdentity tab={tab} active={active} />
            </button>
            {tab.loading ? (
                <span className="pointer-events-none absolute inset-x-1 bottom-0 h-px overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--accent-primary)_12%,transparent)]">
                    <span className="block h-full w-full origin-left bg-[var(--accent-primary)] inspector-tab-loading" />
                </span>
            ) : null}
            {tab.closable ? (
                <button
                    type="button"
                    onClick={onClose}
                    className="mr-1 inline-flex size-4 shrink-0 items-center justify-center rounded text-sparkle-text-muted/50 opacity-0 transition-opacity hover:bg-[var(--surface-hover)] hover:text-sparkle-text focus:opacity-100 group-hover/tab:opacity-100"
                    aria-label={`Close ${tab.label}`}
                >
                    <X size={9} />
                </button>
            ) : null}
        </div>
    )
}

export function InspectorTabDragPreview({
    tab,
    active,
    width
}: {
    tab: AssistantInspectorTab
    active: boolean
    width: number
}) {
    return (
        <div
            data-inspector-tab-drag-preview=""
            className={cn(
                'no-drag pointer-events-none relative flex h-7 scale-[1.025] items-center rounded-md border text-[10px] font-medium shadow-[0_14px_32px_rgba(0,0,0,0.38),0_0_0_1px_color-mix(in_srgb,var(--accent-primary)_18%,transparent)]',
                active
                    ? 'border-[color-mix(in_srgb,var(--accent-primary)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-text)_11%,var(--surface-inspector-tab))] text-sparkle-text'
                    : 'border-[color-mix(in_srgb,var(--color-text)_15%,transparent)] bg-[color-mix(in_srgb,var(--color-card)_96%,var(--color-bg))] text-sparkle-text-secondary'
            )}
            style={{ width }}
            aria-hidden="true"
        >
            <span className="inline-flex h-full min-w-0 flex-1 items-center justify-start gap-1.5 overflow-hidden pl-2 pr-1 text-left">
                <InspectorTabIdentity tab={tab} active={active} />
            </span>
            {tab.closable ? <span className="mr-1 inline-flex size-4 shrink-0 items-center justify-center text-sparkle-text-muted/45"><X size={9} /></span> : null}
            {tab.loading ? (
                <span className="pointer-events-none absolute inset-x-1 bottom-0 h-px overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--accent-primary)_12%,transparent)]">
                    <span className="block h-full w-full origin-left bg-[var(--accent-primary)] inspector-tab-loading" />
                </span>
            ) : null}
        </div>
    )
}

export type AssistantTabTearOffController = {
    begin: (tabId: string, screenPoint: { x: number; y: number }, grabOffset: { x: number; y: number }) => Promise<string | null>
    finish: (tabId: string, sessionId: string, screenPoint: { x: number; y: number }) => Promise<boolean>
    cancel: (sessionId: string) => Promise<void>
}

export function AssistantInspectorSidebar({
    open,
    width,
    maxWidth,
    tabs,
    activeTabId,
    onWidthChange,
    onClose,
    onSelectTab,
    onCloseTab,
    onReorderTab,
    tabTearOff,
    dropZoneCanonicalChatId,
    addTabItems,
    children
}: {
    open: boolean
    width: number
    maxWidth: number
    tabs: AssistantInspectorTab[]
    activeTabId: string
    onWidthChange: (width: number) => void
    onClose: () => void
    onSelectTab: (tabId: string) => void
    onCloseTab: (tabId: string) => void
    onReorderTab: (fromTabId: string, toTabId: string) => void
    tabTearOff?: AssistantTabTearOffController
    dropZoneCanonicalChatId?: string | null
    addTabItems: FileActionsMenuItem[]
    children: ReactNode
}) {
    const rootRef = useRef<HTMLDivElement | null>(null)
    const titleBarSurfaceRef = useRef<HTMLDivElement | null>(null)
    const tabRailRef = useRef<HTMLDivElement | null>(null)
    const dropZoneWindowPositionRef = useRef('')
    const resizeStateRef = useRef<ResizeState | null>(null)
    const resizeFrameRef = useRef(0)
    const suppressTabSelectionRef = useRef<string | null>(null)
    const lastDragPointerRef = useRef<{ screenX: number; screenY: number; clientX: number; clientY: number } | null>(null)
    const keyboardDragRef = useRef(false)
    const tearOffActiveRef = useRef(false)
    const activeDragTabIdRef = useRef<string | null>(null)
    const dragGrabOffsetRef = useRef<{ x: number; y: number } | null>(null)
    const tearOffSessionRef = useRef<{ tabId: string; sessionId: string } | null>(null)
    const tearOffBeginPromiseRef = useRef<Promise<string | null> | null>(null)
    const beginNativeTearOffRef = useRef<() => void>(() => undefined)
    const tabTearOffRef = useRef(tabTearOff)
    tabTearOffRef.current = tabTearOff
    const previewTimerRef = useRef(0)
    const previewDismissTimerRef = useRef(0)
    const previewRequestRef = useRef(0)
    const closeTimersRef = useRef(new Map<string, number>())
    const onCloseTabRef = useRef(onCloseTab)
    const tabWidthAnimationsRef = useRef(new Map<string, Animation>())
    const previousTabWidthsRef = useRef(new Map<string, number>())
    const [resizing, setResizing] = useState(false)
    const [reducedMotion, setReducedMotion] = useState(readPrefersReducedMotion)
    const [activeDragTabId, setActiveDragTabId] = useState<string | null>(null)
    const [nativeTearOffTabId, setNativeTearOffTabId] = useState<string | null>(null)
    const [closingTabIds, setClosingTabIds] = useState<Set<string>>(() => new Set())
    const [tabPreview, setTabPreview] = useState<AssistantInspectorTabPreview | null>(null)
    const [presented, setPresented] = useState(false)
    useLayoutEffect(() => {
        if (!open) { setPresented(false); return }
        const frame = window.requestAnimationFrame(() => setPresented(true))
        return () => window.cancelAnimationFrame(frame)
    }, [open])
    const resolvedWidth = clampInspectorWidth(width, maxWidth)
    const tabIdentity = tabs.map((tab) => tab.id).join('|')
    const targetWorkspaceTabWidth = calculateWorkspaceTabWidth(resolvedWidth, tabs.length)
    onCloseTabRef.current = onCloseTab
    const activeDragTab = activeDragTabId ? tabs.find((tab) => tab.id === activeDragTabId) || null : null
    const dndSensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
            keyboardCodes: ASSISTANT_INSPECTOR_TAB_KEYBOARD_CODES
        })
    )
    const tabDragModifier = useMemo(() => createAssistantTabDragWithTearOff((tearingOff) => {
        const enteringTearOff = tearingOff && !tearOffActiveRef.current
        tearOffActiveRef.current = tearingOff
        if (enteringTearOff) queueMicrotask(() => beginNativeTearOffRef.current())
    }), [])

    useEffect(() => {
        const trackPointer = (event: PointerEvent) => {
            lastDragPointerRef.current = { screenX: event.screenX, screenY: event.screenY, clientX: event.clientX, clientY: event.clientY }
        }
        window.addEventListener('pointermove', trackPointer, true)
        window.addEventListener('pointerup', trackPointer, true)
        return () => {
            window.removeEventListener('pointermove', trackPointer, true)
            window.removeEventListener('pointerup', trackPointer, true)
        }
    }, [])

    useEffect(() => {
        const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
        const handleMotionPreference = () => setReducedMotion(motionQuery.matches)
        motionQuery.addEventListener('change', handleMotionPreference)
        return () => motionQuery.removeEventListener('change', handleMotionPreference)
    }, [])

    const synchronizeTabWidths = useCallback((inspectorWidth: number) => {
        const rail = tabRailRef.current
        if (!rail) return
        const tabWidth = calculateWorkspaceTabWidth(inspectorWidth, tabs.length)
        for (const element of rail.querySelectorAll<HTMLElement>('[data-inspector-tab-id]')) {
            const tabId = element.dataset.inspectorTabId
            if (!tabId) continue
            tabWidthAnimationsRef.current.get(tabId)?.cancel()
            tabWidthAnimationsRef.current.delete(tabId)
            element.style.width = `${tabWidth}px`
            previousTabWidthsRef.current.set(tabId, tabWidth)
        }
    }, [tabs.length])

    useLayoutEffect(() => {
        if (!open) {
            void window.devscope.assistantUtility?.registerDropZone(null)
            return
        }
        const publishDropZone = () => {
            const rail = tabRailRef.current
            if (!rail) return
            dropZoneWindowPositionRef.current = `${window.screenX}:${window.screenY}`
            const rect = rail.getBoundingClientRect()
            const tabSlots = [...rail.querySelectorAll<HTMLElement>('[data-inspector-tab-id]')].map((element) => {
                const tabId = element.dataset.inspectorTabId || ''
                const tabRect = element.getBoundingClientRect()
                return {
                    tabId,
                    index: tabs.findIndex((tab) => tab.id === tabId),
                    left: window.screenX + tabRect.left,
                    right: window.screenX + tabRect.right
                }
            }).filter((slot) => slot.tabId && slot.index >= 0)
            void window.devscope.assistantUtility?.registerDropZone({
                windowId: 'main',
                rect: { x: window.screenX + rect.left, y: window.screenY + rect.top, width: rect.width, height: rect.height },
                canonicalChatId: dropZoneCanonicalChatId || null,
                tabSlots
            })
        }
        publishDropZone()
        const refreshMovedDropZone = () => {
            const nextWindowPosition = `${window.screenX}:${window.screenY}`
            if (dropZoneWindowPositionRef.current === nextWindowPosition) return
            publishDropZone()
        }
        const intervalId = window.setInterval(refreshMovedDropZone, 500)
        window.addEventListener('resize', publishDropZone)
        return () => {
            window.clearInterval(intervalId)
            window.removeEventListener('resize', publishDropZone)
            void window.devscope.assistantUtility?.registerDropZone(null)
        }
    }, [dropZoneCanonicalChatId, open, resolvedWidth, tabIdentity])

    useLayoutEffect(() => {
        const rail = tabRailRef.current
        if (!rail) return
        const currentTabIds = new Set<string>()
        for (const element of rail.querySelectorAll<HTMLElement>('[data-inspector-tab-id]')) {
            const tabId = element.dataset.inspectorTabId
            if (!tabId) continue
            currentTabIds.add(tabId)
            const runningAnimation = tabWidthAnimationsRef.current.get(tabId)
            const displayedWidth = runningAnimation
                ? element.getBoundingClientRect().width
                : previousTabWidthsRef.current.get(tabId) ?? targetWorkspaceTabWidth
            runningAnimation?.cancel()
            tabWidthAnimationsRef.current.delete(tabId)
            if (reducedMotion) {
                element.style.width = `${targetWorkspaceTabWidth}px`
                previousTabWidthsRef.current.set(tabId, targetWorkspaceTabWidth)
                continue
            }
            if (Math.abs(displayedWidth - targetWorkspaceTabWidth) > 0.5) {
                const animation = element.animate(
                    [
                        { width: `${displayedWidth}px` },
                        { width: `${targetWorkspaceTabWidth}px` }
                    ],
                    {
                        duration: 240,
                        easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
                    }
                )
                tabWidthAnimationsRef.current.set(tabId, animation)
                animation.addEventListener('finish', () => {
                    if (tabWidthAnimationsRef.current.get(tabId) === animation) {
                        tabWidthAnimationsRef.current.delete(tabId)
                    }
                }, { once: true })
            }
            previousTabWidthsRef.current.set(tabId, targetWorkspaceTabWidth)
        }
        for (const [tabId, animation] of tabWidthAnimationsRef.current) {
            if (currentTabIds.has(tabId)) continue
            animation.cancel()
            tabWidthAnimationsRef.current.delete(tabId)
            previousTabWidthsRef.current.delete(tabId)
        }
    }, [reducedMotion, tabIdentity, targetWorkspaceTabWidth])

    const stopResize = useCallback((pointerId: number, handle: HTMLButtonElement) => {
        const state = resizeStateRef.current
        if (!state || state.pointerId !== pointerId) return
        resizeStateRef.current = null
        if (resizeFrameRef.current) window.cancelAnimationFrame(resizeFrameRef.current)
        resizeFrameRef.current = 0
        synchronizeTabWidths(state.width)
        rootRef.current?.style.setProperty('width', `${state.width}px`)
        rootRef.current?.style.removeProperty('transition')
        titleBarSurfaceRef.current?.style.setProperty('width', `${state.width}px`)
        titleBarSurfaceRef.current?.style.removeProperty('transition')
        setResizing(false)
        if (state.width < ASSISTANT_MIN_INSPECTOR_WIDTH * 0.7) onClose()
        else onWidthChange(clampInspectorWidth(state.width, maxWidth))
        if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
        document.body.style.removeProperty('cursor')
        document.body.style.removeProperty('user-select')
    }, [onClose, maxWidth, onWidthChange, synchronizeTabWidths])

    const handleResizePointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
        if (!open || event.button !== 0) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        rootRef.current?.style.setProperty('transition', 'none')
        titleBarSurfaceRef.current?.style.setProperty('transition', 'none')
        resizeStateRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startWidth: resolvedWidth,
            width: resolvedWidth
        }
        synchronizeTabWidths(resolvedWidth)
        setResizing(true)
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
    }, [open, resolvedWidth, synchronizeTabWidths])

    const handleResizePointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
        const state = resizeStateRef.current
        if (!state || state.pointerId !== event.pointerId) return
        state.width = Math.max(120, Math.min(maxWidth, state.startWidth + state.startX - event.clientX))
        if (resizeFrameRef.current) return
        resizeFrameRef.current = window.requestAnimationFrame(() => {
            resizeFrameRef.current = 0
            const latest = resizeStateRef.current
            if (!latest) return
            rootRef.current?.style.setProperty('width', `${latest.width}px`)
            titleBarSurfaceRef.current?.style.setProperty('width', `${latest.width}px`)
            synchronizeTabWidths(latest.width)
        })
    }, [maxWidth, synchronizeTabWidths])

    const handleResizePointerEnd = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
        stopResize(event.pointerId, event.currentTarget)
    }, [stopResize])

    const handleResizeKeyDown = useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        const step = event.shiftKey ? 24 : 8
        const nextWidth = clampInspectorWidth(resolvedWidth + (event.key === 'ArrowLeft' ? step : -step), maxWidth)
        synchronizeTabWidths(nextWidth)
        onWidthChange(nextWidth)
    }, [maxWidth, onWidthChange, resolvedWidth, synchronizeTabWidths])

    const dismissTabPreview = useCallback(() => {
        previewRequestRef.current += 1
        window.clearTimeout(previewTimerRef.current)
        window.clearTimeout(previewDismissTimerRef.current)
        setTabPreview(null)
    }, [])

    const requestTabClose = useCallback((tabId: string) => {
        if (closeTimersRef.current.has(tabId)) return
        dismissTabPreview()
        if (reducedMotion) {
            onCloseTabRef.current(tabId)
            return
        }
        setClosingTabIds((current) => new Set(current).add(tabId))
        const timeoutId = window.setTimeout(() => {
            closeTimersRef.current.delete(tabId)
            onCloseTabRef.current(tabId)
            setClosingTabIds((current) => {
                if (!current.has(tabId)) return current
                const next = new Set(current)
                next.delete(tabId)
                return next
            })
        }, 130)
        closeTimersRef.current.set(tabId, timeoutId)
    }, [dismissTabPreview, reducedMotion])

    const handleTabPreviewEnter = useCallback((event: React.PointerEvent<HTMLDivElement>, tab: AssistantInspectorTab) => {
        if (activeDragTabId || tab.previewDisabled) return
        dismissTabPreview()
        const requestId = ++previewRequestRef.current
        const visibleTabLeft = event.currentTarget.offsetLeft - (event.currentTarget.parentElement?.scrollLeft || 0)
        const previewWidth = assistantInspectorTabPreviewWidth(tab)
        const left = Math.max(8, Math.min(visibleTabLeft, resolvedWidth - previewWidth - 6))
        previewTimerRef.current = window.setTimeout(() => {
            let imageRequest: Promise<string | null> | null = null
            try {
                imageRequest = tab.loadPreviewImage?.() || null
            } catch {
                imageRequest = null
            }
            setTabPreview({
                tabId: tab.id,
                label: tab.label,
                detail: tab.preview || 'Inspector workspace',
                left,
                imageRequested: Boolean(tab.loadPreviewImage),
                imageLoading: Boolean(imageRequest),
                imageUrl: null
            })
            if (imageRequest) {
                void imageRequest.then(
                    (imageUrl) => {
                        if (previewRequestRef.current !== requestId) return
                        setTabPreview((current) => current?.tabId === tab.id
                            ? { ...current, imageLoading: false, imageUrl }
                            : current)
                    },
                    () => {
                        if (previewRequestRef.current !== requestId) return
                        setTabPreview((current) => current?.tabId === tab.id
                            ? { ...current, imageLoading: false }
                            : current)
                    }
                )
            }
            if (!tab.loadPreviewImage) {
                previewDismissTimerRef.current = window.setTimeout(() => setTabPreview(null), 1600)
            }
        }, 650)
    }, [activeDragTabId, dismissTabPreview, resolvedWidth])

    const handleTabPreviewLeave = useCallback(() => {
        dismissTabPreview()
    }, [dismissTabPreview])

    const releaseTabDragStyles = useCallback(() => {
        document.body.style.removeProperty('cursor')
        document.body.style.removeProperty('user-select')
    }, [])

    const restoreNativeTearOffSource = useCallback((tabId: string) => {
        setNativeTearOffTabId((current) => current === tabId ? null : current)
        setClosingTabIds((current) => {
            if (!current.has(tabId)) return current
            const next = new Set(current)
            next.delete(tabId)
            return next
        })
    }, [])

    const beginNativeTearOff = useCallback(() => {
        const tabId = activeDragTabIdRef.current
        const pointer = lastDragPointerRef.current
        const grabOffset = dragGrabOffsetRef.current
        if (!tabTearOff || keyboardDragRef.current || !tabId || !pointer || !grabOffset || tearOffSessionRef.current || tearOffBeginPromiseRef.current) return
        setNativeTearOffTabId(tabId)
        setClosingTabIds((current) => new Set(current).add(tabId))
        const pending = tabTearOff.begin(
            tabId,
            { x: pointer.screenX, y: pointer.screenY },
            grabOffset
        ).then((sessionId) => {
            tearOffBeginPromiseRef.current = null
            if (!sessionId) {
                restoreNativeTearOffSource(tabId)
                return null
            }
            tearOffSessionRef.current = { tabId, sessionId }
            return sessionId
        }).catch(() => {
            tearOffBeginPromiseRef.current = null
            restoreNativeTearOffSource(tabId)
            return null
        })
        tearOffBeginPromiseRef.current = pending
    }, [restoreNativeTearOffSource, tabTearOff])
    beginNativeTearOffRef.current = beginNativeTearOff

    const handleTabDragStart = useCallback((event: DragStartEvent) => {
        const tabId = String(event.active.id)
        if (!tabs.some((tab) => tab.id === tabId)) return
        keyboardDragRef.current = event.activatorEvent instanceof KeyboardEvent
        tearOffActiveRef.current = false
        tearOffSessionRef.current = null
        tearOffBeginPromiseRef.current = null
        activeDragTabIdRef.current = tabId
        const activator = event.activatorEvent
        const activeElement = tabRailRef.current
            ? Array.from(tabRailRef.current.querySelectorAll<HTMLElement>('[data-inspector-tab-id]')).find((element) => element.dataset.inspectorTabId === tabId) || null
            : null
        const rect = event.active.rect.current.initial || activeElement?.getBoundingClientRect() || null
        if (activator instanceof PointerEvent && rect) {
            lastDragPointerRef.current = { screenX: activator.screenX, screenY: activator.screenY, clientX: activator.clientX, clientY: activator.clientY }
            dragGrabOffsetRef.current = {
                x: 80 + Math.max(0, Math.min(rect.width, activator.clientX - rect.left)),
                y: Math.max(0, Math.min(rect.height, activator.clientY - rect.top))
            }
        } else {
            dragGrabOffsetRef.current = null
        }
        dismissTabPreview()
        suppressTabSelectionRef.current = tabId
        setActiveDragTabId(tabId)
        document.body.style.cursor = 'grabbing'
        document.body.style.userSelect = 'none'
    }, [dismissTabPreview, tabs])

    const handleTabDragEnd = useCallback((event: DragEndEvent) => {
        const draggedTabId = String(event.active.id)
        const targetTabId = event.over ? String(event.over.id) : ''
        const pointer = lastDragPointerRef.current
        const wasNativeTearOff = Boolean(!keyboardDragRef.current && pointer && (tearOffSessionRef.current || tearOffBeginPromiseRef.current))
        keyboardDragRef.current = false
        tearOffActiveRef.current = false
        activeDragTabIdRef.current = null
        dragGrabOffsetRef.current = null
        setActiveDragTabId(null)
        releaseTabDragStyles()
        if (wasNativeTearOff && pointer && tabTearOff) {
            void (async () => {
                const sessionId = tearOffSessionRef.current?.sessionId || await tearOffBeginPromiseRef.current
                tearOffBeginPromiseRef.current = null
                if (!sessionId) {
                    restoreNativeTearOffSource(draggedTabId)
                    return
                }
                const committed = await tabTearOff.finish(
                    draggedTabId,
                    sessionId,
                    { x: pointer.screenX, y: pointer.screenY }
                ).catch(() => false)
                tearOffSessionRef.current = null
                if (committed) {
                    setNativeTearOffTabId(null)
                } else {
                    restoreNativeTearOffSource(draggedTabId)
                    if (targetTabId && draggedTabId !== targetTabId) onReorderTab(draggedTabId, targetTabId)
                }
            })()
        } else if (targetTabId && draggedTabId !== targetTabId) {
            onReorderTab(draggedTabId, targetTabId)
        }
        window.setTimeout(() => {
            if (suppressTabSelectionRef.current === draggedTabId) suppressTabSelectionRef.current = null
        }, 0)
    }, [onReorderTab, releaseTabDragStyles, restoreNativeTearOffSource, tabTearOff])

    const handleTabDragCancel = useCallback((event: DragCancelEvent) => {
        const draggedTabId = String(event.active.id)
        const pending = tearOffBeginPromiseRef.current
        const session = tearOffSessionRef.current
        keyboardDragRef.current = false
        tearOffActiveRef.current = false
        activeDragTabIdRef.current = null
        dragGrabOffsetRef.current = null
        tearOffBeginPromiseRef.current = null
        tearOffSessionRef.current = null
        setActiveDragTabId(null)
        releaseTabDragStyles()
        if (tabTearOff && (session || pending)) {
            void (async () => {
                const sessionId = session?.sessionId || await pending
                if (sessionId) await tabTearOff.cancel(sessionId).catch(() => undefined)
                restoreNativeTearOffSource(draggedTabId)
            })()
        } else {
            restoreNativeTearOffSource(draggedTabId)
        }
        window.setTimeout(() => {
            if (suppressTabSelectionRef.current === draggedTabId) suppressTabSelectionRef.current = null
        }, 0)
    }, [releaseTabDragStyles, restoreNativeTearOffSource, tabTearOff])

    useEffect(() => {
        dismissTabPreview()
        const rail = tabRailRef.current
        const activeTab = rail
            ? Array.from(rail.querySelectorAll<HTMLElement>('[data-inspector-tab-id]')).find((element) => element.dataset.inspectorTabId === activeTabId)
            : null
        if (!rail || !activeTab) return
        const timeoutId = window.setTimeout(() => {
            const tabLeft = activeTab.offsetLeft
            const tabRight = tabLeft + activeTab.offsetWidth
            if (tabLeft < rail.scrollLeft) rail.scrollLeft = tabLeft
            else if (tabRight > rail.scrollLeft + rail.clientWidth) rail.scrollLeft = tabRight - rail.clientWidth
        }, 250)
        return () => window.clearTimeout(timeoutId)
    }, [activeTabId, dismissTabPreview, tabIdentity, targetWorkspaceTabWidth])

    const handleTabRailWheel = useCallback((event: React.WheelEvent<HTMLElement>) => {
        const rail = event.currentTarget
        if (rail.scrollWidth <= rail.clientWidth) return
        const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
        if (delta === 0) return
        event.preventDefault()
        dismissTabPreview()
        rail.scrollLeft += delta
    }, [dismissTabPreview])

    useEffect(() => {
        if (open) return
        dismissTabPreview()
        suppressTabSelectionRef.current = null
        setActiveDragTabId(null)
        releaseTabDragStyles()
    }, [dismissTabPreview, open, releaseTabDragStyles])

    useEffect(() => {
        if (!activeDragTabId || tabs.some((tab) => tab.id === activeDragTabId)) return
        suppressTabSelectionRef.current = null
        setActiveDragTabId(null)
        releaseTabDragStyles()
    }, [activeDragTabId, releaseTabDragStyles, tabs])

    useEffect(() => () => {
        window.cancelAnimationFrame(resizeFrameRef.current)
        window.clearTimeout(previewTimerRef.current)
        window.clearTimeout(previewDismissTimerRef.current)
        for (const timeoutId of closeTimersRef.current.values()) window.clearTimeout(timeoutId)
        closeTimersRef.current.clear()
        for (const animation of tabWidthAnimationsRef.current.values()) animation.cancel()
        tabWidthAnimationsRef.current.clear()
        previousTabWidthsRef.current.clear()
        const session = tearOffSessionRef.current
        const pending = tearOffBeginPromiseRef.current
        if (session) void tabTearOffRef.current?.cancel(session.sessionId)
        else if (pending) void pending.then((sessionId) => sessionId ? tabTearOffRef.current?.cancel(sessionId) : undefined)
        document.body.style.removeProperty('cursor')
        document.body.style.removeProperty('user-select')
    }, [])

    const titleBarRegion = useMemo(() => (
        <div
            ref={titleBarSurfaceRef}
            className={cn(
                'drag-region relative h-full shrink-0 overflow-visible transition-[width,opacity] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
                !open && 'pointer-events-none opacity-0'
            )}
            style={{ width: open && presented ? `${resolvedWidth}px` : '0px' }}
            data-assistant-inspector-titlebar=""
            data-open={open ? 'true' : 'false'}
        >
            {open ? (
                <button
                    type="button"
                    className={cn(
                        'group absolute left-0 top-0 z-[4] flex h-full w-3 -translate-x-1/2 cursor-col-resize items-center justify-center outline-none',
                        resizing && 'bg-[var(--accent-primary)]/[0.04]'
                    )}
                    role="separator"
                    aria-orientation="vertical"
                    aria-valuemin={ASSISTANT_MIN_INSPECTOR_WIDTH}
                    aria-valuemax={maxWidth}
                    aria-valuenow={resolvedWidth}
                    aria-label="Resize inspector workspace from title bar"
                    onKeyDown={handleResizeKeyDown}
                    onPointerDown={handleResizePointerDown}
                    onPointerMove={handleResizePointerMove}
                    onPointerUp={handleResizePointerEnd}
                    onPointerCancel={handleResizePointerEnd}
                >
                    <span className="h-full w-px bg-transparent transition-colors group-hover:bg-[var(--accent-primary)]/45" />
                </button>
            ) : null}
            <div
                className="zyra-inspector-surface flex h-full min-w-0 items-center overflow-hidden border-l border-[var(--surface-panel-divider)]"
                style={{ paddingRight: 'var(--zyra-titlebar-controls-width, 120px)' }}
            >
                <DndContext
                    sensors={dndSensors}
                    collisionDetection={closestCenter}
                    modifiers={[tabDragModifier]}
                    onDragStart={handleTabDragStart}
                    onDragEnd={handleTabDragEnd}
                    onDragCancel={handleTabDragCancel}
                >
                    <nav
                        className="flex h-full min-w-0 flex-1 items-center gap-1 overflow-hidden px-2"
                        aria-label="Workspace tabs"
                        role="tablist"
                    >
                        <div
                            ref={tabRailRef}
                            onWheel={handleTabRailWheel}
                            className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overscroll-x-contain"
                        >
                        <SortableContext items={tabs.map((tab) => tab.id)} strategy={horizontalListSortingStrategy}>
                            {tabs.map((tab) => (
                                <SortableInspectorTab
                                    key={tab.id}
                                    tab={tab}
                                    active={tab.id === activeTabId}
                                    closing={closingTabIds.has(tab.id)}
                                    collapsing={nativeTearOffTabId === tab.id}
                                    sortable={tabs.length > 1 || Boolean(tabTearOff)}
                                    reducedMotion={reducedMotion}
                                    targetWorkspaceTabWidth={targetWorkspaceTabWidth}
                                    onSelect={() => {
                                        if (suppressTabSelectionRef.current === tab.id) {
                                            suppressTabSelectionRef.current = null
                                            return
                                        }
                                        dismissTabPreview()
                                        onSelectTab(tab.id)
                                    }}
                                    onClose={() => requestTabClose(tab.id)}
                                    onPreviewEnter={handleTabPreviewEnter}
                                    onPreviewLeave={handleTabPreviewLeave}
                                />
                            ))}
                        </SortableContext>
                        <FileActionsMenu
                            items={addTabItems}
                            title="Add tab"
                            triggerIcon={<Plus size={13} />}
                            presentation="portal"
                            preferredDirection="down"
                            density="compact"
                            rootClassName="no-drag sticky right-0 z-20 shrink-0 bg-[var(--surface-inspector)]"
                            buttonClassName="no-drag size-7 shrink-0 rounded-md text-sparkle-text-muted/60 hover:bg-[var(--surface-hover)] hover:text-sparkle-text"
                            openButtonClassName="bg-[var(--surface-hover)] text-sparkle-text"
                        />
                        </div>
                    </nav>
                    <DragOverlay
                        adjustScale={false}
                        dropAnimation={reducedMotion ? null : { duration: 180, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }}
                        zIndex={2_147_482_000}
                    >
                        {activeDragTab && !nativeTearOffTabId ? (
                            <InspectorTabDragPreview
                                tab={activeDragTab}
                                active={activeDragTab.id === activeTabId}
                                width={targetWorkspaceTabWidth}
                            />
                        ) : null}
                    </DragOverlay>
                </DndContext>
            </div>
        </div>
    ), [
        activeDragTab,
        activeTabId,
        addTabItems,
        closingTabIds,
        dismissTabPreview,
        dndSensors,
        handleResizeKeyDown,
        handleResizePointerDown,
        handleResizePointerEnd,
        handleResizePointerMove,
        handleTabDragCancel,
        handleTabDragEnd,
        handleTabDragStart,
        handleTabPreviewEnter,
        handleTabPreviewLeave,
        handleTabRailWheel,
        nativeTearOffTabId,
        onSelectTab,
        open,
        presented,
        requestTabClose,
        reducedMotion,
        resizing,
        resolvedWidth,
        tabs,
        tabDragModifier,
        tabTearOff,
        targetWorkspaceTabWidth
    ])
    usePublishAssistantTitleBarEndRegion(titleBarRegion, open)

    return (
        <div
            ref={rootRef}
            className={cn(
                'relative shrink-0 overflow-visible [contain:layout]',
                !resizing && 'transition-[width] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
                !open && 'pointer-events-none'
            )}
            style={{ width: open && presented ? `${resolvedWidth}px` : '0px' }}
        >
            {open ? (
                <button
                    type="button"
                    className={cn(
                        'group absolute left-0 top-0 z-30 flex h-full w-3 -translate-x-1/2 cursor-col-resize items-center justify-center outline-none',
                        resizing && 'bg-[var(--accent-primary)]/[0.04]'
                    )}
                    role="separator"
                    aria-orientation="vertical"
                    aria-valuemin={ASSISTANT_MIN_INSPECTOR_WIDTH}
                    aria-valuemax={maxWidth}
                    aria-valuenow={resolvedWidth}
                    aria-label="Resize inspector workspace"
                    onKeyDown={handleResizeKeyDown}
                    onPointerDown={handleResizePointerDown}
                    onPointerMove={handleResizePointerMove}
                    onPointerUp={handleResizePointerEnd}
                    onPointerCancel={handleResizePointerEnd}
                >
                    <span className="h-full w-px bg-transparent transition-colors group-hover:bg-[var(--accent-primary)]/45" />
                </button>
            ) : null}

            <div className="absolute inset-0 overflow-hidden">
            <aside
                className={cn(
                    'flex h-full min-h-0 flex-col overflow-hidden border-l border-[var(--surface-panel-divider)] bg-sparkle-bg [contain:layout_paint] transform-gpu transition-[transform,opacity] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
                    resizing ? 'relative w-full' : 'absolute inset-y-0 right-0',
                    open && presented ? 'translate-x-0 opacity-100' : 'translate-x-2 opacity-0'
                )}
                style={resizing ? undefined : { width: `${resolvedWidth}px` }}
                aria-label="Assistant inspector workspace"
                aria-hidden={!open}
                inert={!open ? true : undefined}
            >
                {tabPreview ? (
                    <div
                        data-zyra-native-view-occluder="true"
                        className={cn(
                            'pointer-events-none absolute top-2 z-40 overflow-hidden border border-[color-mix(in_srgb,var(--color-text)_11%,transparent)] bg-[color-mix(in_srgb,var(--color-card)_94%,var(--color-bg))] shadow-[0_14px_34px_rgba(0,0,0,0.28),inset_0_1px_0_color-mix(in_srgb,var(--color-text)_5%,transparent)] animate-[inspector-tab-in_140ms_ease-out_both]',
                            tabPreview.imageRequested ? 'w-64 rounded-xl' : 'w-[184px] rounded-2xl'
                        )}
                        style={{ left: tabPreview.left }}
                        role="tooltip"
                    >
                        <div className="px-3 py-2.5">
                            <div className="truncate text-[10px] font-semibold text-sparkle-text">{tabPreview.label}</div>
                            <div className="mt-0.5 line-clamp-2 text-[9px] leading-3.5 text-sparkle-text-muted/75">{tabPreview.detail}</div>
                        </div>
                        {tabPreview.imageRequested ? (
                            <div className="relative aspect-video w-full overflow-hidden border-t border-[color-mix(in_srgb,var(--color-text)_9%,transparent)] bg-[color-mix(in_srgb,var(--color-bg)_88%,var(--color-card))]">
                                {tabPreview.imageUrl ? (
                                    <img src={tabPreview.imageUrl} alt="" className="h-full w-full object-cover animate-[inspector-tab-in_120ms_ease-out_both]" aria-hidden="true" />
                                ) : tabPreview.imageLoading ? (
                                    <div className="flex h-full items-center justify-center text-sparkle-text-muted/45"><LoaderCircle size={14} className="animate-spin" /></div>
                                ) : (
                                    <div className="flex h-full items-center justify-center text-[9px] text-sparkle-text-muted/55">Preview unavailable</div>
                                )}
                            </div>
                        ) : null}
                    </div>
                ) : null}

                {children}
            </aside>
            </div>
        </div>
    )
}
