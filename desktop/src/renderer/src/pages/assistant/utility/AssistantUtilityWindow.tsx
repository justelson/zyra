import { AssistantControlStatus } from '../AssistantControlStatus'
import type { ControlStateSnapshot } from '@shared/agent-control/contracts'
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
import { SortableContext, horizontalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import {
    Bot,
    Copy,
    FileDiff,
    Files,
    FolderTree,
    GitCompareArrows,
    Globe2,
    Library,
    LoaderCircle,
    MessageSquareText,
    Minus,
    PanelRight,
    Plus,
    Square,
    SquareTerminal,
    TriangleAlert,
    X
} from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ASSISTANT_UTILITY_GROUP_COLORS, sanitizeAssistantUtilityStateCapsule, type AssistantUtilityStateCapsule, type AssistantUtilityTab, type AssistantUtilityWindowState } from '@shared/assistant/utility-window'
import { FileActionsMenu, type FileActionsMenuItem } from '@/components/ui/FileActionsMenu'
import { IncognitoIcon } from '@/components/ui/IncognitoIcon'
import { useAssistantStoreLifecycle } from '@/lib/assistant/store'
import { useWindowChrome } from '@/lib/useWindowChrome'
import { cn } from '@/lib/utils'
import {
    calculateWorkspaceTabWidth,
    assistantInspectorTabPreviewWidth,
    InspectorTabDragPreview,
    SortableInspectorTab,
    type AssistantInspectorTab,
    type AssistantInspectorTabPreview
} from '../AssistantInspectorSidebar'
import { AssistantBrowserPageIcon } from '../AssistantBrowserPageIcon'
import { ASSISTANT_BROWSER_DANGEROUS_TAB_TITLE } from '../assistant-browser-workspace-state'
import { captureAssistantBrowserTabHoverPreview } from '../assistant-browser-tab-hover-preview'
import { createAssistantTabDragWithTearOff } from '../assistant-tab-drag-modifier'
import { resolveAssistantUtilityTabContextTitle } from '../assistant-workspace-tab-context'
import { buildAssistantUtilityTabGroups, resolveVisibleAssistantUtilityTabs } from './assistant-utility-tab-groups'

const GROUP_COLORS = ASSISTANT_UTILITY_GROUP_COLORS
const GROUP_DISCLOSURE_MS = 180
const EMPTY_STATE: AssistantUtilityWindowState = { id: '', revision: 0, activeTabId: null, tabs: [] }
const RETAINED_WORKSPACE_KINDS = new Set<AssistantUtilityTab['workspace']>(['browser', 'terminal'])
const AssistantUtilityWorkspaceHost = lazy(async () => ({
    default: (await import('./AssistantUtilityWorkspaceHost')).AssistantUtilityWorkspaceHost
}))

export function AssistantUtilityWindow() {
    useAssistantStoreLifecycle()
    const [controlState, setControlState] = useState<ControlStateSnapshot | null>(null)
    useEffect(() => {
        let disposed = false
        void window.devscope.agentControl.getState().then(result => { if (!disposed && result.success) setControlState(result.state) }).catch(() => undefined)
        const unsubscribe = window.devscope.agentControl.onStateChange(setControlState)
        return () => { disposed = true; unsubscribe() }
    }, [])
    const windowId = decodeURIComponent(window.location.hash.match(/^#\/assistant-utility\/([^/?]+)/)?.[1] || 'default')
    const [state, setState] = useState<AssistantUtilityWindowState>({ ...EMPTY_STATE, id: windowId })
    const [activeDragId, setActiveDragId] = useState<string | null>(null)
    const [nativeTearOffTabId, setNativeTearOffTabId] = useState<string | null>(null)
    const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(() => new Set())
    const [animatingClosedGroupIds, setAnimatingClosedGroupIds] = useState<Set<string>>(() => new Set())
    const [closingTabIds, setClosingTabIds] = useState<Set<string>>(() => new Set())
    const [movingTabIds, setMovingTabIds] = useState<Set<string>>(() => new Set())
    const [tabPreview, setTabPreview] = useState<AssistantInspectorTabPreview | null>(null)
    const [railWidth, setRailWidth] = useState(0)
    const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    const { policy: windowChromePolicy, isMaximized } = useWindowChrome()
    const railRef = useRef<HTMLElement | null>(null)
    const dropZoneWindowPositionRef = useRef('')
    const lastPointerRef = useRef<{ screenX: number; screenY: number; clientX: number; clientY: number } | null>(null)
    const keyboardDragRef = useRef(false)
    const tearOffActiveRef = useRef(false)
    const activeDragIdRef = useRef<string | null>(null)
    const dragGrabOffsetRef = useRef<{ x: number; y: number } | null>(null)
    const tearOffSessionRef = useRef<{ tabId: string; sessionId: string } | null>(null)
    const tearOffBeginPromiseRef = useRef<Promise<string | null> | null>(null)
    const beginNativeTearOffRef = useRef<() => void>(() => undefined)
    const suppressTabSelectionRef = useRef<string | null>(null)
    const previousActiveTabIdRef = useRef<string | null>(null)
    const previewTimerRef = useRef(0)
    const previewDismissTimerRef = useRef(0)
    const previewRequestRef = useRef(0)
    const closeTimersRef = useRef(new Map<string, number>())
    const groupMotionTimersRef = useRef(new Map<string, number>())
    const groupMotionFramesRef = useRef(new Map<string, number[]>())
    const groupMotionDirectionsRef = useRef(new Map<string, 'collapse' | 'expand'>())
    const capsuleByTabIdRef = useRef(new Map<string, AssistantUtilityStateCapsule>())
    const capsulePersistTimersRef = useRef(new Map<string, number>())
    const tabsRef = useRef(state.tabs)
    tabsRef.current = state.tabs
    const cancelGroupMotion = useCallback((groupId: string) => {
        const timerId = groupMotionTimersRef.current.get(groupId)
        if (timerId !== undefined) window.clearTimeout(timerId)
        groupMotionTimersRef.current.delete(groupId)
        for (const frameId of groupMotionFramesRef.current.get(groupId) || []) {
            window.cancelAnimationFrame(frameId)
        }
        groupMotionFramesRef.current.delete(groupId)
        groupMotionDirectionsRef.current.delete(groupId)
    }, [])
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
            keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] }
        })
    )
    const tabDragModifier = useMemo(() => createAssistantTabDragWithTearOff((tearingOff) => {
        const enteringTearOff = tearingOff && !tearOffActiveRef.current
        tearOffActiveRef.current = tearingOff
        if (enteringTearOff) queueMicrotask(() => beginNativeTearOffRef.current())
    }), [])

    useEffect(() => {
        const query = window.matchMedia('(prefers-reduced-motion: reduce)')
        const update = () => setReducedMotion(query.matches)
        query.addEventListener('change', update)
        return () => query.removeEventListener('change', update)
    }, [])

    useEffect(() => {
        let cancelled = false
        void window.devscope.assistantUtility.getState(windowId).then((result) => {
            if (!cancelled && result.success) setState((current) => result.state.revision >= current.revision ? result.state : current)
        })
        const unsubscribe = window.devscope.assistantUtility.onStateChange((next) => {
            if (!cancelled && next.id === windowId) setState((current) => next.revision >= current.revision ? next : current)
        })
        return () => { cancelled = true; unsubscribe() }
    }, [windowId])

    useEffect(() => {
        for (const tab of state.tabs) {
            if (tab.stateCapsule && !capsuleByTabIdRef.current.has(tab.id)) capsuleByTabIdRef.current.set(tab.id, tab.stateCapsule)
        }
        const liveTabIds = new Set(state.tabs.map((tab) => tab.id))
        for (const tabId of capsuleByTabIdRef.current.keys()) if (!liveTabIds.has(tabId)) capsuleByTabIdRef.current.delete(tabId)
    }, [state.tabs])

    const handleStateCapsuleChange = useCallback((tabId: string, capsule: AssistantUtilityStateCapsule) => {
        const sanitized = sanitizeAssistantUtilityStateCapsule(capsule, capsule.workspace)
        if (!sanitized) return
        capsuleByTabIdRef.current.set(tabId, sanitized)
        const existingTimer = capsulePersistTimersRef.current.get(tabId)
        if (existingTimer !== undefined) window.clearTimeout(existingTimer)
        const timerId = window.setTimeout(() => {
            capsulePersistTimersRef.current.delete(tabId)
            const latest = capsuleByTabIdRef.current.get(tabId)
            const tab = tabsRef.current.find((entry) => entry.id === tabId)
            if (!latest || !tab) return
            const fallbackTitle = tab.workspace === 'explorer'
                ? 'Files'
                : tab.workspace === 'diff' ? 'Diff' : tab.title
            const contextualTitle = resolveAssistantUtilityTabContextTitle(tab.workspace, latest, fallbackTitle)
            void (async () => {
                await window.devscope.assistantUtility.updateStateCapsule(windowId, tabId, latest)
                if (contextualTitle !== tab.title) {
                    await window.devscope.assistantUtility.updateTab(windowId, tabId, { title: contextualTitle })
                }
            })()
        }, 120)
        capsulePersistTimersRef.current.set(tabId, timerId)
    }, [windowId])

    useEffect(() => {
        const track = (event: PointerEvent) => {
            lastPointerRef.current = { screenX: event.screenX, screenY: event.screenY, clientX: event.clientX, clientY: event.clientY }
        }
        window.addEventListener('pointermove', track, true)
        window.addEventListener('pointerup', track, true)
        return () => {
            window.removeEventListener('pointermove', track, true)
            window.removeEventListener('pointerup', track, true)
        }
    }, [])

    const publishDropZone = useCallback(() => {
        const rail = railRef.current
        if (!rail) return
        dropZoneWindowPositionRef.current = `${window.screenX}:${window.screenY}`
        const rect = rail.getBoundingClientRect()
        const nextWidth = Math.floor(rect.width)
        setRailWidth((current) => current === nextWidth ? current : nextWidth)
        const tabSlots = [...rail.querySelectorAll<HTMLElement>('[data-inspector-tab-id]')].map((element) => {
            const tabId = element.dataset.inspectorTabId || ''
            const tabRect = element.getBoundingClientRect()
            return {
                tabId,
                index: state.tabs.findIndex((tab) => tab.id === tabId),
                left: window.screenX + tabRect.left,
                right: window.screenX + tabRect.right
            }
        }).filter((slot) => slot.tabId && slot.index >= 0)
        void window.devscope.assistantUtility.registerDropZone({
            windowId,
            rect: { x: window.screenX + rect.left, y: window.screenY + rect.top, width: rect.width, height: rect.height },
            tabSlots
        })
    }, [animatingClosedGroupIds, collapsedGroupIds, state.tabs, windowId])
    useLayoutEffect(() => {
        publishDropZone()
        const observer = new ResizeObserver(publishDropZone)
        const refreshMovedDropZone = () => {
            const nextWindowPosition = `${window.screenX}:${window.screenY}`
            if (dropZoneWindowPositionRef.current === nextWindowPosition) return
            publishDropZone()
        }
        const intervalId = window.setInterval(refreshMovedDropZone, 500)
        if (railRef.current) observer.observe(railRef.current)
        window.addEventListener('resize', publishDropZone)
        return () => {
            observer.disconnect()
            window.clearInterval(intervalId)
            window.removeEventListener('resize', publishDropZone)
            void window.devscope.assistantUtility.registerDropZone(null)
        }
    }, [publishDropZone])

    const dismissTabPreview = useCallback(() => {
        previewRequestRef.current += 1
        window.clearTimeout(previewTimerRef.current)
        window.clearTimeout(previewDismissTimerRef.current)
        setTabPreview(null)
    }, [])

    const handleTabPreviewEnter = useCallback((event: React.PointerEvent<HTMLDivElement>, tab: AssistantInspectorTab) => {
        if (activeDragId || tab.previewDisabled) return
        dismissTabPreview()
        const requestId = ++previewRequestRef.current
        const rect = event.currentTarget.getBoundingClientRect()
        const previewWidth = assistantInspectorTabPreviewWidth(tab)
        const left = Math.max(8, Math.min(rect.left, window.innerWidth - previewWidth - 6))
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
                detail: tab.preview || 'Workspace tab',
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
    }, [activeDragId, dismissTabPreview])

    const handleDragStart = useCallback((event: DragStartEvent) => {
        const tabId = String(event.active.id)
        keyboardDragRef.current = event.activatorEvent instanceof KeyboardEvent
        tearOffActiveRef.current = false
        tearOffSessionRef.current = null
        tearOffBeginPromiseRef.current = null
        activeDragIdRef.current = tabId
        const activator = event.activatorEvent
        const activeElement = railRef.current
            ? Array.from(railRef.current.querySelectorAll<HTMLElement>('[data-inspector-tab-id]')).find((element) => element.dataset.inspectorTabId === tabId) || null
            : null
        const rect = event.active.rect.current.initial || activeElement?.getBoundingClientRect() || null
        if (activator instanceof PointerEvent && rect) {
            lastPointerRef.current = { screenX: activator.screenX, screenY: activator.screenY, clientX: activator.clientX, clientY: activator.clientY }
            dragGrabOffsetRef.current = {
                x: 80 + Math.max(0, Math.min(rect.width, activator.clientX - rect.left)),
                y: Math.max(0, Math.min(rect.height, activator.clientY - rect.top))
            }
        } else {
            dragGrabOffsetRef.current = null
        }
        suppressTabSelectionRef.current = tabId
        dismissTabPreview()
        setActiveDragId(tabId)
        document.body.style.cursor = 'grabbing'
        document.body.style.userSelect = 'none'
    }, [dismissTabPreview])
    const releaseDrag = useCallback(() => {
        setActiveDragId(null)
        document.body.style.removeProperty('cursor')
        document.body.style.removeProperty('user-select')
    }, [])
    const releaseSelectionSuppression = useCallback((tabId: string) => {
        window.setTimeout(() => {
            if (suppressTabSelectionRef.current === tabId) suppressTabSelectionRef.current = null
        }, 0)
    }, [])
    const restoreNativeTearOffSource = useCallback((tabId: string) => {
        setNativeTearOffTabId((current) => current === tabId ? null : current)
        setMovingTabIds((current) => {
            if (!current.has(tabId)) return current
            const next = new Set(current)
            next.delete(tabId)
            return next
        })
    }, [])
    const beginNativeTearOff = useCallback(() => {
        const tabId = activeDragIdRef.current
        const pointer = lastPointerRef.current
        const grabOffset = dragGrabOffsetRef.current
        const tab = tabId ? state.tabs.find((entry) => entry.id === tabId) || null : null
        if (keyboardDragRef.current || !tab || !pointer || !grabOffset || tearOffSessionRef.current || tearOffBeginPromiseRef.current) return
        if (tab.workspace === 'terminal' && !window.confirm('Moving this Terminal tab opens a new terminal view in the other window. Continue?')) return
        setNativeTearOffTabId(tab.id)
        setMovingTabIds((current) => new Set(current).add(tab.id))
        const pending = window.devscope.assistantUtility.beginTearOff({
            sourceWindowId: windowId,
            tab: { ...tab, stateCapsule: capsuleByTabIdRef.current.get(tab.id) || tab.stateCapsule },
            screenPoint: { x: pointer.screenX, y: pointer.screenY },
            grabOffset
        }).then((result) => {
            tearOffBeginPromiseRef.current = null
            if (!result.success || !result.sessionId) {
                restoreNativeTearOffSource(tab.id)
                return null
            }
            tearOffSessionRef.current = { tabId: tab.id, sessionId: result.sessionId }
            return result.sessionId
        }).catch(() => {
            tearOffBeginPromiseRef.current = null
            restoreNativeTearOffSource(tab.id)
            return null
        })
        tearOffBeginPromiseRef.current = pending
    }, [restoreNativeTearOffSource, state.tabs, windowId])
    beginNativeTearOffRef.current = beginNativeTearOff

    const handleDragEnd = useCallback((event: DragEndEvent) => {
        const tabId = String(event.active.id)
        const overId = event.over ? String(event.over.id) : null
        const pointer = lastPointerRef.current
        const wasNativeTearOff = Boolean(!keyboardDragRef.current && pointer && (tearOffSessionRef.current || tearOffBeginPromiseRef.current))
        keyboardDragRef.current = false
        tearOffActiveRef.current = false
        activeDragIdRef.current = null
        dragGrabOffsetRef.current = null
        releaseDrag()
        releaseSelectionSuppression(tabId)
        if (wasNativeTearOff && pointer) {
            void (async () => {
                const sessionId = tearOffSessionRef.current?.sessionId || await tearOffBeginPromiseRef.current
                tearOffBeginPromiseRef.current = null
                if (!sessionId) {
                    restoreNativeTearOffSource(tabId)
                    return
                }
                const result = await window.devscope.assistantUtility.finishTearOff({
                    sessionId,
                    screenPoint: { x: pointer.screenX, y: pointer.screenY }
                }).catch(() => ({ success: false as const, committed: false }))
                tearOffSessionRef.current = null
                if (result.success && result.committed) {
                    setNativeTearOffTabId(null)
                } else {
                    restoreNativeTearOffSource(tabId)
                    if (overId && overId !== tabId) void window.devscope.assistantUtility.reorderTab(windowId, tabId, overId)
                }
            })()
            return
        }
        if (overId && overId !== tabId) void window.devscope.assistantUtility.reorderTab(windowId, tabId, overId)
    }, [releaseDrag, releaseSelectionSuppression, restoreNativeTearOffSource, windowId])

    const handleDragCancel = useCallback((event: DragCancelEvent) => {
        const tabId = String(event.active.id)
        const pending = tearOffBeginPromiseRef.current
        const session = tearOffSessionRef.current
        keyboardDragRef.current = false
        tearOffActiveRef.current = false
        activeDragIdRef.current = null
        dragGrabOffsetRef.current = null
        tearOffBeginPromiseRef.current = null
        tearOffSessionRef.current = null
        releaseDrag()
        releaseSelectionSuppression(tabId)
        if (session || pending) {
            void (async () => {
                const sessionId = session?.sessionId || await pending
                if (sessionId) await window.devscope.assistantUtility.cancelTearOff(sessionId).catch(() => undefined)
                restoreNativeTearOffSource(tabId)
            })()
        } else {
            restoreNativeTearOffSource(tabId)
        }
    }, [releaseDrag, releaseSelectionSuppression, restoreNativeTearOffSource])

    const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId) || state.tabs[0] || null
    useEffect(() => {
        if (!activeTab || previousActiveTabIdRef.current === activeTab.id) return
        previousActiveTabIdRef.current = activeTab.id
        cancelGroupMotion(activeTab.canonicalChatId)
        setAnimatingClosedGroupIds((current) => {
            if (!current.has(activeTab.canonicalChatId)) return current
            const next = new Set(current)
            next.delete(activeTab.canonicalChatId)
            return next
        })
        setCollapsedGroupIds((current) => {
            if (!current.has(activeTab.canonicalChatId)) return current
            const next = new Set(current)
            next.delete(activeTab.canonicalChatId)
            return next
        })
    }, [activeTab, cancelGroupMotion])
    useEffect(() => {
        document.title = activeTab ? `${activeTab.title} · ${activeTab.chatTitle} · Zyra` : 'Zyra'
        if (activeTab && activeTab.workspace !== 'browser') {
            const workspace = activeTab.workspace === 'details' ? 'control' : activeTab.workspace === 'diff' ? 'review' : activeTab.workspace
            void window.devscope.agentControl.updateWorkspaceState({
                version: 1,
                threadId: activeTab.threadId,
                inspector: { open: true, width: window.innerWidth, activeWorkspace: workspace, openWorkspaces: [workspace] },
                browser: { open: false, activeTabId: null, splitTabId: null, visibleTabIds: [], tabs: [] },
                updatedAt: new Date().toISOString()
            })
        }
    }, [activeTab?.chatTitle, activeTab?.threadId, activeTab?.title, activeTab?.workspace])
    const dragTab = state.tabs.find((tab) => tab.id === activeDragId) || null
    const tabGroups = useMemo(() => buildAssistantUtilityTabGroups(state.tabs), [state.tabs])
    const groupedChrome = tabGroups.length > 1
    const visibleTabs = useMemo(
        () => resolveVisibleAssistantUtilityTabs(tabGroups, collapsedGroupIds),
        [collapsedGroupIds, tabGroups]
    )
    const layoutCollapsedGroupIds = useMemo(() => {
        const next = new Set(collapsedGroupIds)
        for (const groupId of animatingClosedGroupIds) {
            if (groupMotionDirectionsRef.current.get(groupId) === 'collapse') next.add(groupId)
        }
        return next
    }, [animatingClosedGroupIds, collapsedGroupIds])
    const layoutVisibleTabs = useMemo(
        () => resolveVisibleAssistantUtilityTabs(tabGroups, layoutCollapsedGroupIds),
        [layoutCollapsedGroupIds, tabGroups]
    )
    const inspectorTabsById = useMemo(() => new Map(
        state.tabs.map((tab) => [tab.id, toInspectorTab(tab, tab.id === state.activeTabId)] as const)
    ), [state.activeTabId, state.tabs])
    const dragInspectorTab = dragTab ? inspectorTabsById.get(dragTab.id) || null : null
    const targetWorkspaceTabWidth = calculateWorkspaceTabWidth(railWidth + 188, Math.max(1, layoutVisibleTabs.length))

    const requestTabClose = useCallback((tabId: string) => {
        if (closeTimersRef.current.has(tabId)) return
        if (reducedMotion) {
            void window.devscope.assistantUtility.closeTab(windowId, tabId)
            return
        }
        setClosingTabIds((current) => new Set(current).add(tabId))
        const timerId = window.setTimeout(() => {
            closeTimersRef.current.delete(tabId)
            void window.devscope.assistantUtility.closeTab(windowId, tabId).then((result) => {
                if (result.success) return
                setClosingTabIds((current) => {
                    const next = new Set(current)
                    next.delete(tabId)
                    return next
                })
            })
        }, 130)
        closeTimersRef.current.set(tabId, timerId)
    }, [reducedMotion, windowId])

    const addWorkspaceTab = useCallback((
        workspace: Exclude<AssistantUtilityTab['workspace'], 'turn'>,
        sourceTabId: string,
        sessionMode: 'normal' | 'incognito' = 'normal'
    ) => {
        const sourceTab = state.tabs.find((tab) => tab.id === sourceTabId)
        if (!sourceTab) return
        cancelGroupMotion(sourceTab.canonicalChatId)
        setAnimatingClosedGroupIds((current) => {
            if (!current.has(sourceTab.canonicalChatId)) return current
            const next = new Set(current)
            next.delete(sourceTab.canonicalChatId)
            return next
        })
        setCollapsedGroupIds((current) => {
            if (!current.has(sourceTab.canonicalChatId)) return current
            const next = new Set(current)
            next.delete(sourceTab.canonicalChatId)
            return next
        })
        void window.devscope.assistantUtility.addTab({ windowId, workspace, sourceTabId, sessionMode }).then((result) => {
            if (!result.success) window.alert(result.error || 'Could not open that tab.')
        })
    }, [cancelGroupMotion, state.tabs, windowId])

    const buildAddTabItems = useCallback((sourceTabId: string): FileActionsMenuItem[] => [
        { id: 'details', label: 'Thread Details', icon: <PanelRight size={14} />, onSelect: () => addWorkspaceTab('details', sourceTabId) },
        {
            id: 'browser',
            label: 'Browser',
            icon: <Globe2 size={14} />,
            onSelect: () => addWorkspaceTab('browser', sourceTabId, 'normal'),
            choicesLabel: 'Choose Browser tab type',
            choices: [
                { id: 'browser-normal', label: 'Normal tab', icon: <Globe2 size={13} />, onSelect: () => addWorkspaceTab('browser', sourceTabId, 'normal') },
                { id: 'browser-incognito', label: 'Incognito tab', icon: <IncognitoIcon size={13} />, onSelect: () => addWorkspaceTab('browser', sourceTabId, 'incognito') }
            ]
        },
        { id: 'terminal', label: 'Terminal', icon: <SquareTerminal size={14} />, onSelect: () => addWorkspaceTab('terminal', sourceTabId) },
        { id: 'explorer', label: 'Files', icon: <Files size={14} />, onSelect: () => addWorkspaceTab('explorer', sourceTabId) },
        { id: 'diff', label: 'Diff', icon: <FileDiff size={14} />, onSelect: () => addWorkspaceTab('diff', sourceTabId) },
        { id: 'resources', label: 'Resources', icon: <Library size={14} />, onSelect: () => addWorkspaceTab('resources', sourceTabId) },
        { id: 'agents', label: 'Agents', icon: <Bot size={14} />, onSelect: () => addWorkspaceTab('agents', sourceTabId) }
    ], [addWorkspaceTab])

    const addTabItems = useMemo<FileActionsMenuItem[]>(
        () => activeTab ? buildAddTabItems(activeTab.id) : [],
        [activeTab, buildAddTabItems]
    )

    useEffect(() => {
        const currentGroupIds = new Set(tabGroups.map((group) => group.id))
        const currentTabIds = new Set(state.tabs.map((tab) => tab.id))
        setCollapsedGroupIds((current) => {
            const next = new Set([...current].filter((groupId) => currentGroupIds.has(groupId)))
            return next.size === current.size ? current : next
        })
        setClosingTabIds((current) => {
            const next = new Set([...current].filter((tabId) => currentTabIds.has(tabId)))
            return next.size === current.size ? current : next
        })
        setMovingTabIds((current) => {
            const next = new Set([...current].filter((tabId) => currentTabIds.has(tabId)))
            return next.size === current.size ? current : next
        })
        setAnimatingClosedGroupIds((current) => {
            const next = new Set([...current].filter((groupId) => currentGroupIds.has(groupId)))
            return next.size === current.size ? current : next
        })
        for (const groupId of groupMotionDirectionsRef.current.keys()) {
            if (!currentGroupIds.has(groupId)) cancelGroupMotion(groupId)
        }
    }, [cancelGroupMotion, state.tabs, tabGroups])

    useEffect(() => () => {
        window.clearTimeout(previewTimerRef.current)
        window.clearTimeout(previewDismissTimerRef.current)
        for (const timerId of closeTimersRef.current.values()) window.clearTimeout(timerId)
        closeTimersRef.current.clear()
        for (const timerId of capsulePersistTimersRef.current.values()) window.clearTimeout(timerId)
        capsulePersistTimersRef.current.clear()
        for (const groupId of groupMotionDirectionsRef.current.keys()) cancelGroupMotion(groupId)
        const session = tearOffSessionRef.current
        const pending = tearOffBeginPromiseRef.current
        if (session) void window.devscope.assistantUtility.cancelTearOff(session.sessionId)
        else if (pending) void pending.then((sessionId) => sessionId ? window.devscope.assistantUtility.cancelTearOff(sessionId) : undefined)
        document.body.style.removeProperty('cursor')
        document.body.style.removeProperty('user-select')
    }, [cancelGroupMotion])

    const toggleGroup = useCallback((groupId: string) => {
        dismissTabPreview()
        const motionDirection = groupMotionDirectionsRef.current.get(groupId)
        const shouldExpand = collapsedGroupIds.has(groupId) || motionDirection === 'collapse'
        cancelGroupMotion(groupId)

        if (reducedMotion) {
            setAnimatingClosedGroupIds((current) => {
                if (!current.has(groupId)) return current
                const next = new Set(current)
                next.delete(groupId)
                return next
            })
            setCollapsedGroupIds((current) => {
                const next = new Set(current)
                if (shouldExpand) next.delete(groupId)
                else next.add(groupId)
                return next
            })
            return
        }

        if (shouldExpand) {
            groupMotionDirectionsRef.current.set(groupId, 'expand')
            setAnimatingClosedGroupIds((current) => new Set(current).add(groupId))
            setCollapsedGroupIds((current) => {
                const next = new Set(current)
                next.delete(groupId)
                return next
            })
            const firstFrameId = window.requestAnimationFrame(() => {
                const secondFrameId = window.requestAnimationFrame(() => {
                    groupMotionDirectionsRef.current.delete(groupId)
                    groupMotionFramesRef.current.delete(groupId)
                    setAnimatingClosedGroupIds((current) => {
                        const next = new Set(current)
                        next.delete(groupId)
                        return next
                    })
                })
                groupMotionFramesRef.current.set(groupId, [firstFrameId, secondFrameId])
            })
            groupMotionFramesRef.current.set(groupId, [firstFrameId])
            return
        }

        groupMotionDirectionsRef.current.set(groupId, 'collapse')
        setAnimatingClosedGroupIds((current) => new Set(current).add(groupId))
        const timerId = window.setTimeout(() => {
            groupMotionTimersRef.current.delete(groupId)
            groupMotionDirectionsRef.current.delete(groupId)
            setCollapsedGroupIds((current) => new Set(current).add(groupId))
            setAnimatingClosedGroupIds((current) => {
                const next = new Set(current)
                next.delete(groupId)
                return next
            })
        }, GROUP_DISCLOSURE_MS)
        groupMotionTimersRef.current.set(groupId, timerId)
    }, [cancelGroupMotion, collapsedGroupIds, dismissTabPreview, reducedMotion])

    return (
        <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-sparkle-bg text-sparkle-text [--accent-primary:var(--color-primary)] [--accent-secondary:var(--color-secondary)]">
            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                modifiers={[tabDragModifier]}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDragCancel={handleDragCancel}
            >
                <header className="zyra-topbar-surface drag-region relative z-[60] flex h-[34px] shrink-0 items-stretch border-b border-[var(--surface-panel-divider)]">
                    <div className="flex w-[76px] shrink-0 items-center border-r border-[var(--surface-panel-divider)] px-3 text-[11px] font-semibold tracking-tight text-sparkle-text-secondary">
                        Zyra
                    </div>
                    <nav ref={railRef} role="tablist" className="no-scrollbar flex min-w-0 flex-1 items-center overflow-x-auto overscroll-x-contain px-1" aria-label="Zyra tabs">
                        <SortableContext items={visibleTabs.map((tab) => tab.id)} strategy={horizontalListSortingStrategy}>
                            {tabGroups.map((group, groupIndex) => {
                                const color = GROUP_COLORS[group.colorIndex % GROUP_COLORS.length]
                                const collapsed = groupedChrome && collapsedGroupIds.has(group.id)
                                const groupSourceTab = group.tabs[0]
                                const groupAddTabItems = groupSourceTab ? buildAddTabItems(groupSourceTab.id) : []
                                return (
                                    <div key={group.id} className="contents">
                                        <div
                                            className="relative flex h-full shrink-0 items-center"
                                            style={groupedChrome ? { boxShadow: `inset 0 -2px 0 ${color}` } : undefined}
                                            data-utility-tab-group={group.id}
                                        >
                                            {groupedChrome ? (
                                                <div
                                                    className="no-drag my-[7px] ml-1.5 mr-1.5 inline-flex h-5 max-w-[134px] shrink-0 items-stretch rounded-md text-[#091015] shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]"
                                                    style={{ backgroundColor: color }}
                                                >
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleGroup(group.id)}
                                                        className="no-drag min-w-0 max-w-[112px] rounded-l-md pl-2 pr-1.5 text-left text-[10px] font-semibold leading-none outline-none transition-colors hover:bg-white/10 focus-visible:bg-white/15 motion-reduce:transition-none"
                                                        aria-expanded={!collapsed}
                                                        aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${group.title} tabs`}
                                                        title={`${collapsed ? 'Expand' : 'Collapse'} ${group.title} tabs`}
                                                    >
                                                        <span className="block truncate">{group.title}</span>
                                                    </button>
                                                    <FileActionsMenu
                                                        items={groupAddTabItems}
                                                        title={`Add tab to ${group.title}`}
                                                        menuLabel={group.title}
                                                        accentColor={color}
                                                        triggerIcon={<Plus size={12} strokeWidth={2.2} className="-translate-y-px" />}
                                                        presentation="portal"
                                                        preferredDirection="down"
                                                        density="compact"
                                                        menuWidth={184}
                                                        rootClassName="no-drag inline-flex h-5 shrink-0 items-center self-center border-l border-black/15"
                                                        buttonClassName="no-drag !h-5 !w-5 rounded-none rounded-r-md !text-[#091015]/70 leading-none hover:!bg-black/10 hover:!text-[#091015]"
                                                        openButtonClassName="!bg-black/[0.12] !text-[#091015]"
                                                    />
                                                </div>
                                            ) : null}
                                            {!collapsed ? group.tabs.map((tab) => {
                                                const inspectorTab = inspectorTabsById.get(tab.id)
                                                return inspectorTab ? (
                                                    <SortableInspectorTab
                                                        key={tab.id}
                                                        tab={inspectorTab}
                                                        active={tab.id === activeTab?.id}
                                                        closing={closingTabIds.has(tab.id) || movingTabIds.has(tab.id)}
                                                        collapsing={nativeTearOffTabId === tab.id || animatingClosedGroupIds.has(group.id)}
                                                        sortable={!animatingClosedGroupIds.has(group.id)}
                                                        reducedMotion={reducedMotion}
                                                        targetWorkspaceTabWidth={targetWorkspaceTabWidth}
                                                        onSelect={() => {
                                                            if (suppressTabSelectionRef.current === tab.id) {
                                                                suppressTabSelectionRef.current = null
                                                                return
                                                            }
                                                            dismissTabPreview()
                                                            void window.devscope.assistantUtility.selectTab(windowId, tab.id)
                                                        }}
                                                        onClose={() => requestTabClose(tab.id)}
                                                        onPreviewEnter={handleTabPreviewEnter}
                                                        onPreviewLeave={dismissTabPreview}
                                                    />
                                                ) : null
                                            }) : null}
                                        </div>
                                        {groupedChrome && groupIndex < tabGroups.length - 1 ? <span className="my-2 h-[18px] w-px shrink-0 bg-[var(--surface-panel-divider)]" aria-hidden="true" /> : null}
                                    </div>
                                )
                            })}
                        </SortableContext>
                        {activeTab && !groupedChrome ? (
                            <FileActionsMenu
                                items={addTabItems}
                                title="Add tab"
                                triggerIcon={<Plus size={13} />}
                                presentation="portal"
                                preferredDirection="down"
                                density="compact"
                                rootClassName="no-drag sticky right-0 z-20 shrink-0 bg-[var(--surface-topbar)]"
                                buttonClassName="no-drag size-7 shrink-0 rounded-md text-sparkle-text-muted/60 hover:bg-[var(--surface-hover)] hover:text-sparkle-text"
                                openButtonClassName="bg-[var(--surface-hover)] text-sparkle-text"
                            />
                        ) : null}
                    </nav>
                    {controlState && (controlState.active || controlState.pairing.state !== 'stopped' || controlState.pendingGrants.length > 0) ? <div className="no-drag flex items-center"><AssistantControlStatus state={controlState} /></div> : null}
                    {windowChromePolicy.customWindowControls ? (
                        <UtilityWindowControls isMaximized={isMaximized} />
                    ) : null}
                </header>
                <DragOverlay adjustScale={false} dropAnimation={reducedMotion ? null : { duration: 180, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }} zIndex={2_147_482_000}>
                    {dragInspectorTab && !nativeTearOffTabId ? <InspectorTabDragPreview tab={dragInspectorTab} active={dragTab?.id === activeTab?.id} width={targetWorkspaceTabWidth} /> : null}
                </DragOverlay>
            </DndContext>
            {tabPreview ? (
                <div
                    data-zyra-native-view-occluder="true"
                    className={cn(
                        'pointer-events-none fixed top-[38px] z-40 overflow-hidden border border-[color-mix(in_srgb,var(--color-text)_11%,transparent)] bg-[color-mix(in_srgb,var(--color-card)_94%,var(--color-bg))] shadow-[0_14px_34px_rgba(0,0,0,0.28),inset_0_1px_0_color-mix(in_srgb,var(--color-text)_5%,transparent)] animate-[inspector-tab-in_140ms_ease-out_both]',
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
            <main className="relative flex min-h-0 flex-1 overflow-hidden bg-[var(--color-bg)]">
                {state.provisional && activeTab ? (
                    <div className="flex min-h-0 flex-1 items-center justify-center bg-[radial-gradient(circle_at_50%_36%,color-mix(in_srgb,var(--accent-primary)_7%,transparent),transparent_42%)]">
                        <div className="flex items-center gap-2 text-[11px] font-medium text-sparkle-text-muted/75">
                            <UtilityWorkspaceIcon tab={activeTab} />
                            <span className="max-w-72 truncate">{activeTab.title}</span>
                        </div>
                    </div>
                ) : state.tabs.filter((tab) => tab.id === activeTab?.id || RETAINED_WORKSPACE_KINDS.has(tab.workspace)).map((tab) => {
                    const latestCapsule = capsuleByTabIdRef.current.get(tab.id) || tab.stateCapsule
                    const renderedTab = latestCapsule === tab.stateCapsule ? tab : { ...tab, stateCapsule: latestCapsule }
                    return (
                        <div key={tab.id} className={tab.id === activeTab?.id ? 'flex min-h-0 flex-1' : 'pointer-events-none invisible absolute inset-0 flex'} aria-hidden={tab.id !== activeTab?.id}>
                            <Suspense fallback={<UtilityWorkspaceLoading label={tab.title} />}>
                                <AssistantUtilityWorkspaceHost tab={renderedTab} active={tab.id === activeTab?.id} windowId={windowId} onStateCapsuleChange={handleStateCapsuleChange} />
                            </Suspense>
                        </div>
                    )
                })}
                {!activeTab ? <div className="flex flex-1 items-center justify-center text-sm text-sparkle-text-muted">Use a Zyra TUI command to open something here.</div> : null}
            </main>
        </div>
    )
}

function UtilityWorkspaceLoading({ label }: { label: string }) {
    return (
        <div className="flex min-h-0 flex-1 items-center justify-center bg-[var(--color-bg)]">
            <div className="flex items-center gap-2 text-[11px] font-medium text-sparkle-text-muted/70">
                <LoaderCircle size={12} className="animate-spin motion-reduce:animate-none" />
                <span className="max-w-72 truncate">{label}</span>
            </div>
        </div>
    )
}

function UtilityWindowControls({ isMaximized }: { isMaximized: boolean }) {
    const controlClass = 'no-drag inline-flex h-[34px] w-10 items-center justify-center text-sparkle-text-secondary/75 transition-colors hover:text-sparkle-text'
    return (
        <div className="no-drag relative z-[5] flex h-full shrink-0">
            <button type="button" className={cn(controlClass, 'hover:bg-[var(--surface-hover)]')} onClick={() => window.devscope.window.minimize()} aria-label="Minimize"><Minus size={14} /></button>
            <button type="button" className={cn(controlClass, 'hover:bg-[var(--surface-hover)]')} onClick={() => window.devscope.window.maximize()} aria-label={isMaximized ? 'Restore window' : 'Maximize window'}>{isMaximized ? <Copy size={12} /> : <Square size={12} />}</button>
            <button type="button" className={cn(controlClass, 'hover:bg-red-600 hover:text-white')} onClick={() => window.devscope.window.close()} aria-label="Close"><X size={14} /></button>
        </div>
    )
}

function UtilityWorkspaceIcon({ tab }: { tab: AssistantUtilityTab }) {
    const iconProps = { size: 12, strokeWidth: 1.75 }
    if (tab.workspace === 'browser') {
        if (tab.title === ASSISTANT_BROWSER_DANGEROUS_TAB_TITLE) {
            return <TriangleAlert size={13} strokeWidth={2.4} className="text-[#ff5a63]" aria-label="Dangerous site blocked" />
        }
        if (tab.sessionMode === 'incognito') return <IncognitoIcon size={12} className="text-violet-300/85" aria-label="Incognito tab" />
        return <AssistantBrowserPageIcon faviconUrl={tab.faviconUrl || null} pageUrl={tab.url || null} size={12} />
    }
    if (tab.workspace === 'details') return <PanelRight {...iconProps} />
    if (tab.workspace === 'explorer') return <FolderTree {...iconProps} />
    if (tab.workspace === 'resources') return <Library {...iconProps} />
    if (tab.workspace === 'agents') return <Bot {...iconProps} />
    if (tab.workspace === 'terminal') return <SquareTerminal {...iconProps} />
    if (tab.workspace === 'turn') return <MessageSquareText {...iconProps} />
    return <GitCompareArrows {...iconProps} />
}

function toInspectorTab(tab: AssistantUtilityTab, active: boolean): AssistantInspectorTab {
    const browserTab = tab.workspace === 'browser'
    return {
        id: tab.id,
        label: tab.title,
        icon: <UtilityWorkspaceIcon tab={tab} />,
        closable: true,
        preview: browserTab ? tab.url || tab.chatTitle : tab.chatTitle,
        previewDisabled: browserTab && active,
        loadPreviewImage: browserTab && !active && Boolean(tab.hasLivePage || tab.url)
            ? () => captureAssistantBrowserTabHoverPreview(tab.id)
            : undefined
    }
}
