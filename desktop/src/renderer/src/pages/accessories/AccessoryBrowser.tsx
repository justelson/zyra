import { useSettings } from '@/lib/settings'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { LoaderCircle, Plus, X } from 'lucide-react'
import type { AccessoryNavigationRequest } from '@shared/accessories'
import type { BrowserSessionMode } from '@shared/browser-view'
import FilePreviewModal from '@/components/ui/FilePreviewModal'
import { useFilePreview } from '@/components/ui/file-preview/useFilePreview'
import { IncognitoIcon } from '@/components/ui/IncognitoIcon'
import { AssistantInspectorDeveloperToast, useAssistantInspectorDeveloperToast } from '../assistant/AssistantInspectorDeveloperToast'
import { cn } from '@/lib/utils'
import { AssistantBrowserPageIcon } from '../assistant/AssistantBrowserPageIcon'
import { AssistantBrowserWorkspace, type AssistantBrowserWorkspaceController } from '../assistant/AssistantBrowserWorkspace'
import type { AssistantBrowserWorkspaceState } from '../assistant/assistant-browser-workspace-state'
import { AccessoryHeaderPortal } from './AccessoryHeaderContext'
import {
    accessoryBrowserGrabOffset,
    isAccessoryBrowserTabTearOff,
    movedAccessoryBrowserTabBounds
} from './accessory-browser-tab-drag'
import { useAccessoryBrowserTabSync } from './useAccessoryBrowserTabSync'

type ActiveTabDrag = {
    pointerId: number
    tabId: string
    startClient: { x: number; y: number }
    tabBounds: { left: number; right: number; top: number; bottom: number }
    stripBounds: { left: number; right: number; top: number; bottom: number }
    lastScreenPoint: { x: number; y: number }
    tearingOff: boolean
    beginPromise: Promise<string | null> | null
}

export function AccessoryBrowser({
    workspaceId,
    sessionMode,
    request,
    onRequestHandled,
    onError,
    onPreviewOpenChange
}: {
    workspaceId: string
    sessionMode: BrowserSessionMode
    request: AccessoryNavigationRequest | null
    onRequestHandled: (requestId: string) => void
    onError: (error: string) => void
    onPreviewOpenChange?: (open: boolean) => void
}) {
    const tabIdPrefix = `browser:accessory:${workspaceId}`
    const fallbackTabId = `${tabIdPrefix}:0`
    const {
        rootPath,
        initialized,
        workspaceState,
        selectedTabId,
        setSelectedTabId,
        controller,
        setController,
        onTabsChange
    } = useAccessoryBrowserTabSync({ workspaceId, sessionMode, fallbackTabId, onError })
    const controllerRef = useRef<AssistantBrowserWorkspaceController | null>(null)
    const workspaceStateRef = useRef<AssistantBrowserWorkspaceState>(workspaceState)
    const tabStripRef = useRef<HTMLDivElement | null>(null)
    const [tabStripWidth, setTabStripWidth] = useState(0)
    const [tabRailOverflow, setTabRailOverflow] = useState(false)
    const dragRef = useRef<ActiveTabDrag | null>(null)
    const suppressClickRef = useRef<string | null>(null)
    const [draggingTabId, setDraggingTabId] = useState<string | null>(null)
    const preview = useFilePreview()
    const { settings } = useSettings()
    const { developerToast, showDeveloperToast, dismissDeveloperToast } = useAssistantInspectorDeveloperToast()
    const handledRequest = useRef<string | null>(null)
    const [navigationRequest, setNavigationRequest] = useState<{ id: string; tabId: string; url: string; sessionMode: BrowserSessionMode } | null>(null)
    const hasPreview = Boolean(preview.previewFile)
    workspaceStateRef.current = workspaceState
    controllerRef.current = controller

    useEffect(() => { onPreviewOpenChange?.(hasPreview); return () => onPreviewOpenChange?.(false) }, [hasPreview, onPreviewOpenChange])

    const publishDropZone = useCallback(() => {
        const strip = tabStripRef.current
        if (!strip || !initialized) return
        const rect = (strip.closest<HTMLElement>('[data-accessory-header-slot]') || strip).getBoundingClientRect()
        if (rect.width < 1 || rect.height < 1) return
        const tabSlots = [...strip.querySelectorAll<HTMLElement>('[data-accessory-browser-tab-id]')].map((element, index) => {
            const tabRect = element.getBoundingClientRect()
            return {
                tabId: element.dataset.accessoryBrowserTabId || '',
                index,
                left: window.screenX + tabRect.left,
                right: window.screenX + tabRect.right
            }
        }).filter((slot) => slot.tabId)
        void window.devscope.accessories.registerBrowserDropZone({
            workspaceId,
            rect: {
                x: window.screenX + rect.left,
                y: window.screenY + rect.top,
                width: rect.width,
                height: rect.height
            },
            tabSlots
        })
    }, [initialized, workspaceId])

    useLayoutEffect(() => {
        if (!initialized) return
        publishDropZone()
        const strip = tabStripRef.current
        const measure = () => {
            if (!strip) return
            setTabStripWidth(Math.floor(strip.clientWidth))
            setTabRailOverflow(strip.scrollWidth > strip.clientWidth + 1)
            publishDropZone()
        }
        const observer = new ResizeObserver(measure)
        if (strip) observer.observe(strip)
        measure()
        const settled = window.setTimeout(measure, 200)
        strip?.addEventListener('scroll', publishDropZone)
        let lastPosition = `${window.screenX}:${window.screenY}`
        const intervalId = window.setInterval(() => {
            const position = `${window.screenX}:${window.screenY}`
            if (position === lastPosition) return
            lastPosition = position
            publishDropZone()
        }, 500)
        window.addEventListener('resize', measure)
        return () => {
            observer.disconnect()
            window.clearTimeout(settled)
            window.clearInterval(intervalId)
            strip?.removeEventListener('scroll', publishDropZone)
            window.removeEventListener('resize', measure)
            void window.devscope.accessories.registerBrowserDropZone(null)
        }
    }, [initialized, publishDropZone, workspaceState.tabs])

    const clearDragPresentation = useCallback(() => {
        setDraggingTabId(null)
        document.body.style.removeProperty('cursor')
        document.body.style.removeProperty('user-select')
    }, [])

    useEffect(() => {
        const beginTearOff = (drag: ActiveTabDrag) => {
            if (drag.tearingOff) return
            drag.tearingOff = true
            suppressClickRef.current = drag.tabId
            setDraggingTabId(drag.tabId)
            document.body.style.cursor = 'grabbing'
            document.body.style.userSelect = 'none'
            const screenPoint = drag.lastScreenPoint
            const grabOffset = accessoryBrowserGrabOffset(screenPoint, { x: window.screenX, y: window.screenY })
            drag.beginPromise = window.devscope.accessories.beginBrowserTabTearOff({
                workspaceId,
                tabId: drag.tabId,
                screenPoint,
                grabOffset
            }).then((result) => {
                if (!result.success) {
                    onError(result.error)
                    return null
                }
                return result.sessionId
            }).catch((error: unknown) => {
                onError(error instanceof Error ? error.message : 'The Browser tab could not detach.')
                return null
            })
        }
        const move = (event: PointerEvent) => {
            const drag = dragRef.current
            if (!drag || event.pointerId !== drag.pointerId) return
            drag.lastScreenPoint = { x: event.screenX, y: event.screenY }
            if (drag.tearingOff) {
                event.preventDefault()
                return
            }
            const moved = movedAccessoryBrowserTabBounds(drag.tabBounds, {
                x: event.clientX - drag.startClient.x,
                y: event.clientY - drag.startClient.y
            })
            if (isAccessoryBrowserTabTearOff(moved, drag.stripBounds)) {
                event.preventDefault()
                beginTearOff(drag)
            }
        }
        const finish = (event: PointerEvent) => {
            const drag = dragRef.current
            if (!drag || event.pointerId !== drag.pointerId) return
            drag.lastScreenPoint = { x: event.screenX, y: event.screenY }
            dragRef.current = null
            clearDragPresentation()
            if (!drag.tearingOff || !drag.beginPromise) return
            event.preventDefault()
            void drag.beginPromise.then(async (sessionId) => {
                if (!sessionId) return
                const result = await window.devscope.accessories.finishBrowserTabTearOff({
                    sessionId,
                    screenPoint: drag.lastScreenPoint
                }).catch((error: unknown) => ({ success: false as const, error: error instanceof Error ? error.message : 'The Browser tab drop failed.' }))
                if (!result.success) onError(result.error)
            })
        }
        const cancel = (event?: PointerEvent) => {
            const drag = dragRef.current
            if (!drag || (event && event.pointerId !== drag.pointerId)) return
            dragRef.current = null
            suppressClickRef.current = null
            clearDragPresentation()
            if (!drag.tearingOff || !drag.beginPromise) return
            void drag.beginPromise.then(async (sessionId) => {
                if (!sessionId) return
                const result = await window.devscope.accessories.cancelBrowserTabTearOff(sessionId).catch(() => null)
                if (result && !result.success) onError(result.error)
            })
        }
        const keydown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') cancel()
        }
        window.addEventListener('pointermove', move, true)
        window.addEventListener('pointerup', finish, true)
        window.addEventListener('pointercancel', cancel, true)
        window.addEventListener('keydown', keydown, true)
        return () => {
            window.removeEventListener('pointermove', move, true)
            window.removeEventListener('pointerup', finish, true)
            window.removeEventListener('pointercancel', cancel, true)
            window.removeEventListener('keydown', keydown, true)
            const drag = dragRef.current
            dragRef.current = null
            clearDragPresentation()
            if (drag?.beginPromise) void drag.beginPromise.then((sessionId) => sessionId ? window.devscope.accessories.cancelBrowserTabTearOff(sessionId) : undefined)
        }
    }, [clearDragPresentation, onError, workspaceId])

    const startTabDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>, tabId: string) => {
        if (event.button !== 0 || !tabStripRef.current) return
        const tabElement = event.currentTarget.closest<HTMLElement>('[data-accessory-browser-tab-id]')
        if (!tabElement) return
        const tabRect = tabElement.getBoundingClientRect()
        const stripRect = (tabStripRef.current.closest<HTMLElement>('[data-accessory-header-slot]') || tabStripRef.current).getBoundingClientRect()
        event.currentTarget.setPointerCapture(event.pointerId)
        setSelectedTabId(tabId)
        controllerRef.current?.activateTab(tabId)
        dragRef.current = {
            pointerId: event.pointerId,
            tabId,
            startClient: { x: event.clientX, y: event.clientY },
            tabBounds: { left: tabRect.left, right: tabRect.right, top: tabRect.top, bottom: tabRect.bottom },
            stripBounds: { left: stripRect.left, right: stripRect.right, top: stripRect.top, bottom: stripRect.bottom },
            lastScreenPoint: { x: event.screenX, y: event.screenY },
            tearingOff: false,
            beginPromise: null
        }
    }, [])

    useEffect(() => {
        if (!request || request.sessionMode === sessionMode) return
        onError('This navigation request belongs to a different Browser session.')
        onRequestHandled(request.id)
    }, [onError, onRequestHandled, request, sessionMode])

    useEffect(() => {
        if (!request || request.sessionMode !== sessionMode || !controller || handledRequest.current === request.id) return
        handledRequest.current = request.id
        const current = workspaceState.tabs.find(tab => tab.id === workspaceState.activeTabId)
        const tabId = current?.url ? controller.createTab('', { sessionMode }) : workspaceState.activeTabId
        setSelectedTabId(tabId)
        setNavigationRequest({ id: request.id, tabId, url: request.url, sessionMode })
    }, [controller, onError, onRequestHandled, request, sessionMode, workspaceState])

    const previewModal = preview.previewFile ? (
        <FilePreviewModal
            file={preview.previewFile}
            previewTabs={preview.previewTabs}
            activePreviewTabId={preview.activePreviewTabId}
            content={preview.previewContent}
            loading={preview.loadingPreview}
            truncated={preview.previewTruncated}
            size={preview.previewSize}
            previewBytes={preview.previewBytes}
            modifiedAt={preview.previewModifiedAt}
            projectPath={rootPath || undefined}
            active
            chromeContext="peek"
            mediaItems={preview.previewMediaItems}
            onOpenLinkedPreview={preview.openPreview}
            onOpenLinkedPreviewInNewTab={preview.openPreviewInNewTab}
            onSelectPreviewTab={preview.setActivePreviewTab}
            onClosePreviewTab={preview.closePreviewTab}
            onReorderPreviewTabs={preview.reorderPreviewTabs}
            onClose={preview.closePreview}
        />
    ) : null

    const tabWidth = Math.max(112, Math.min(168, Math.floor((tabStripWidth - 36 - workspaceState.tabs.length * 4) / Math.max(1, workspaceState.tabs.length))))
    const displayedActiveTabId = workspaceState.tabs.some((tab) => tab.id === selectedTabId) ? selectedTabId : workspaceState.activeTabId

    useLayoutEffect(() => {
        const strip = tabStripRef.current
        if (!strip) return
        const frame = window.requestAnimationFrame(() => {
            const activeTab = [...strip.querySelectorAll<HTMLElement>('[data-accessory-browser-tab-id]')]
                .find((element) => element.dataset.accessoryBrowserTabId === workspaceState.activeTabId)
            if (!activeTab) return
            const left = activeTab.getBoundingClientRect().left - strip.getBoundingClientRect().left + strip.scrollLeft
            const right = left + activeTab.offsetWidth
            if (left < strip.scrollLeft) strip.scrollLeft = left
            else if (right > strip.scrollLeft + strip.clientWidth - 32) strip.scrollLeft = right - strip.clientWidth + 32
        })
        return () => window.cancelAnimationFrame(frame)
    }, [workspaceState.activeTabId, workspaceState.tabs.length, tabWidth])

    if (!rootPath || !initialized) {
        return <div className="flex min-h-0 flex-1 items-center justify-center bg-sparkle-bg"><LoaderCircle size={18} className="animate-spin text-[var(--accent-primary)]/75" /></div>
    }

    const tabStrip = (
        <AccessoryHeaderPortal>
            <div ref={tabStripRef} role="tablist" aria-label="Browser tabs" style={{ WebkitAppRegion: 'drag' } as CSSProperties} onWheel={(event) => {
                const strip = event.currentTarget
                if (strip.scrollWidth <= strip.clientWidth) return
                const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
                if (!delta) return
                event.preventDefault()
                strip.scrollLeft += delta
            }} className="no-scrollbar flex h-full min-w-0 flex-1 items-center gap-1 overflow-x-auto overscroll-x-contain px-1">
                {workspaceState.tabs.map((tab) => {
                    const selected = tab.id === displayedActiveTabId
                    const moving = tab.id === draggingTabId
                    return (
                        <div key={tab.id} data-accessory-browser-tab-id={tab.id} style={{ WebkitAppRegion: 'no-drag', width: tabWidth } as CSSProperties} onPointerDown={(event) => startTabDrag(event, tab.id)} onClick={() => {
                            if (suppressClickRef.current === tab.id) { suppressClickRef.current = null; return }
                            setSelectedTabId(tab.id)
                            controller?.activateTab(tab.id)
                        }} className={cn('group flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-transparent px-2 transition-[width,background-color,border-color,opacity] duration-[180ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none', selected ? 'border-[color-mix(in_srgb,var(--color-text)_13%,transparent)] bg-[color-mix(in_srgb,var(--color-text)_9%,var(--surface-inspector-tab))] text-sparkle-text shadow-[0_1px_3px_color-mix(in_srgb,var(--color-bg)_48%,transparent)]' : 'text-sparkle-text-secondary/82 hover:bg-[color-mix(in_srgb,var(--color-text)_6%,transparent)] hover:text-sparkle-text', moving && 'opacity-45')}>
                            <button
                                type="button"
                                role="tab"
                                aria-selected={selected}
                                className="flex h-full min-w-0 flex-1 touch-none select-none items-center gap-1.5 text-left"
                            >
                                {tab.sessionMode === 'incognito'
                                    ? <IncognitoIcon size={12} className="shrink-0 text-violet-300/85" />
                                    : <AssistantBrowserPageIcon faviconUrl={tab.faviconUrl} pageUrl={tab.url} size={12} />}
                                <span className="truncate text-[10px]">{tab.title || 'New tab'}</span>
                            </button>
                            <button type="button" aria-label={`Close ${tab.title || 'tab'}`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => {
                                event.stopPropagation()
                                const next = controller?.closeTab(tab.id)
                                if (next) setSelectedTabId(next.activeTabId)
                            }} className="inline-flex size-4 shrink-0 items-center justify-center rounded opacity-55 hover:bg-[var(--surface-hover)] hover:opacity-100"><X size={10} /></button>
                        </div>
                    )
                })}
                <button type="button" aria-label="New Browser tab" title="New tab" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties} onClick={() => {
                    const tabId = controller?.createTab('', { sessionMode })
                    if (tabId) setSelectedTabId(tabId)
                }} className={cn('sticky right-0 z-20 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--surface-topbar)] text-sparkle-text-muted hover:bg-[var(--surface-hover)] hover:text-sparkle-text', tabRailOverflow && 'before:pointer-events-none before:absolute before:inset-y-0 before:-left-5 before:w-5 before:bg-gradient-to-r before:from-transparent before:to-[var(--surface-topbar)]')}><Plus size={13} /></button>
            </div>
        </AccessoryHeaderPortal>
    )

    return (
        <div className="accessory-browser-workspace flex min-h-0 flex-1 flex-col overflow-hidden bg-sparkle-bg">
            {tabStrip}
            <AssistantBrowserWorkspace
                workspaceKey={`accessory:${workspaceId}`}
                threadId={`accessory:${workspaceId}`}
                projectPath={rootPath}
                active
                selectedTabId={selectedTabId}
                controlState={null}
                navigationRequest={navigationRequest}
                surfaceRequest={null}
                onNavigationRequestHandled={(requestId) => { setNavigationRequest(current => current?.id === requestId ? null : current); onRequestHandled(String(requestId)) }}
                onSurfaceRequestHandled={() => undefined}
                onWorkspaceStateChange={() => undefined}
                onTabsChange={onTabsChange}
                onRequestTabSelection={setSelectedTabId}
                onControllerChange={setController}
                onDeveloperToast={showDeveloperToast}
                onOpenPreview={preview.openPreview}
                chatIntegration={false}
                defaultSessionMode={sessionMode}
                tabIdPrefix={tabIdPrefix}
                persistState={false}
            />
            <AssistantInspectorDeveloperToast allowChatAttachment={settings.assistantBrowserStandaloneAiTools !== false} toast={developerToast} onDismiss={dismissDeveloperToast} />
            {previewModal}
        </div>
    )
}
