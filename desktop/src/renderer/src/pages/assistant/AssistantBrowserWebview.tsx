import { forwardRef, memo, useCallback, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import type { DevScopeBrowserGuestTargetInput, DevScopeBrowserPreviewConfig } from '@shared/contracts/devscope-api'
import type { ControlCursorState } from '@shared/agent-control/contracts'
import type { BrowserViewEvent, BrowserViewState } from '@shared/browser-view'
import { dismissTransientMenus } from '@/lib/transient-menu'
import type { AssistantBrowserTabState } from './assistant-browser-workspace-state'
import { useAssistantBrowserNativeViewOcclusion } from './assistant-browser-native-view-occlusion'
import { shouldShowAssistantBrowserNativeView } from './assistant-browser-native-view-visibility'
import { nextAssistantBrowserSlotRevision } from './assistant-browser-slot-revision'

export type AssistantBrowserWebviewHandle = {
    navigate: (url: string) => Promise<void>
    openLocalFile: () => Promise<boolean>
    preparePresentation: () => Promise<boolean>
    showNewTab: () => Promise<Pick<BrowserViewState, 'canGoBack' | 'canGoForward'>>
    goBack: () => void
    goForward: () => void
    reload: () => void
    stop: () => void
    blur: () => void
    getDeveloperTarget: () => DevScopeBrowserGuestTargetInput
    getViewportSize: () => { width: number; height: number }
}

type BrowserStatePatch = Partial<Omit<AssistantBrowserTabState, 'id'>>
type BrowserViewCommandInput = Parameters<typeof window.devscope.browserView.command>[0]
type BrowserStateChangeOptions = { suppressHistory?: boolean }

function browserStatePatch(state: BrowserViewState): BrowserStatePatch {
    return {
        sessionMode: state.sessionMode,
        url: state.url,
        displayAddress: state.displayAddress,
        title: state.title,
        status: state.status,
        error: state.error,
        canGoBack: state.canGoBack,
        canGoForward: state.canGoForward,
        faviconUrl: state.faviconUrl,
        audible: state.audible
    }
}

export const AssistantBrowserWebview = memo(forwardRef<AssistantBrowserWebviewHandle, {
    tab: AssistantBrowserTabState
    threadId: string
    config: DevScopeBrowserPreviewConfig
    active: boolean
    visible: boolean
    placement: 'full' | 'primary' | 'secondary'
    controlled: boolean
    cursor: ControlCursorState | null
    onStateChange: (tabId: string, patch: BrowserStatePatch, options?: BrowserStateChangeOptions) => void
    onControlTargetChange: (tabId: string, targetId: string | null) => void
    onFullscreenChange: (tabId: string, fullscreen: boolean) => void
    onViewportRectChange: (tabId: string, rect: { x: number; y: number; width: number; height: number } | null) => void
}>(function AssistantBrowserWebview({
    tab,
    threadId,
    config: _config,
    active,
    visible,
    placement,
    controlled,
    cursor,
    onStateChange,
    onControlTargetChange,
    onFullscreenChange,
    onViewportRectChange
}, forwardedRef) {
    const slotRef = useRef<HTMLDivElement | null>(null)
    const [snapshotDataUrl, setSnapshotDataUrl] = useState<string | null>(null)
    const snapshotDataUrlRef = useRef<string | null>(null)
    const snapshotReadyRef = useRef(false)
    const snapshotGenerationRef = useRef(0)
    const presentationPreparationRef = useRef<Promise<boolean> | null>(null)
    const stateRef = useRef<BrowserViewState | null>(null)
    const ensurePromiseRef = useRef<Promise<BrowserViewState> | null>(null)
    const controlTargetIdRef = useRef<string | null>(null)
    const controlBindingRef = useRef(false)
    const controlBindAttemptsRef = useRef(0)
    const controlBindTimerRef = useRef(0)
    const disposedRef = useRef(false)
    const skipMatchingNavigationRef = useRef<{ url: string; expiresAt: number } | null>(null)
    const controlOverlayRequestRef = useRef<BrowserViewCommandInput | null>(null)
    const controlOverlayInFlightRef = useRef(false)
    const controlOverlayPublishedRef = useRef(false)
    const nativeViewOccludedRef = useRef(false)
    const callbacksRef = useRef({ onStateChange, onControlTargetChange, onFullscreenChange, onViewportRectChange })
    const reportNativeViewOcclusion = useCallback((occluded: boolean) => {
        nativeViewOccludedRef.current = occluded
        if (!active) return
        const slot = slotRef.current
        if (!slot) return
        const rect = slot.getBoundingClientRect()
        const bounds = rect.width >= 1 && rect.height >= 1
            ? { x: Math.max(0, rect.left), y: Math.max(0, rect.top), width: rect.width, height: rect.height }
            : null
        const nativeViewVisible = shouldShowAssistantBrowserNativeView({
            hasPage: Boolean(tab.url),
            requestedVisible: visible,
            nativeViewOccluded: occluded
        })
        window.devscope.browserView.reportSlot({
            tabId: tab.id,
            revision: nextAssistantBrowserSlotRevision(window),
            bounds,
            contentSize: bounds ? { width: Math.max(1, slot.offsetWidth), height: Math.max(1, slot.offsetHeight) } : null,
            active,
            visible: nativeViewVisible
        })
        callbacksRef.current.onViewportRectChange(tab.id, nativeViewVisible && bounds ? bounds : null)
    }, [active, tab.id, tab.url, visible])
    const nativeViewOccluded = useAssistantBrowserNativeViewOcclusion(slotRef, active, reportNativeViewOcclusion)
    const presentationRequested = !visible || nativeViewOccluded
    const effectiveVisible = shouldShowAssistantBrowserNativeView({
        hasPage: Boolean(tab.url),
        requestedVisible: visible,
        nativeViewOccluded
    })
    callbacksRef.current = { onStateChange, onControlTargetChange, onFullscreenChange, onViewportRectChange }

    const bindControlTarget = useCallback(() => {
        const state = stateRef.current
        if (disposedRef.current || !state || controlBindingRef.current || controlTargetIdRef.current) return
        controlBindAttemptsRef.current += 1
        controlBindingRef.current = true
        void window.devscope.agentControl.bindBrowserTab({
            guestWebContentsId: state.guestWebContentsId,
            tabId: tab.id,
            threadId,
            sessionMode: state.sessionMode
        }).then((result) => {
            controlBindingRef.current = false
            if (disposedRef.current) return
            if (result.success) {
                controlTargetIdRef.current = result.target.targetId
                callbacksRef.current.onControlTargetChange(tab.id, result.target.targetId)
                return
            }
            scheduleControlBind()
        }).catch(() => {
            controlBindingRef.current = false
            if (!disposedRef.current) scheduleControlBind()
        })
    }, [tab.id, threadId])

    const scheduleControlBind = useCallback(() => {
        if (disposedRef.current || controlTargetIdRef.current || controlBindTimerRef.current || controlBindAttemptsRef.current >= 8) return
        controlBindTimerRef.current = window.setTimeout(() => {
            controlBindTimerRef.current = 0
            bindControlTarget()
        }, Math.min(800, 50 * (2 ** Math.max(0, controlBindAttemptsRef.current - 1))))
    }, [bindControlTarget])

    const applyState = useCallback((state: BrowserViewState, suppressHistory: boolean) => {
        const previous = stateRef.current
        if (previous && previous.guestWebContentsId === state.guestWebContentsId && state.revision < previous.revision) return
        stateRef.current = state
        callbacksRef.current.onStateChange(tab.id, browserStatePatch(state), { suppressHistory })
        callbacksRef.current.onFullscreenChange(tab.id, state.fullscreen)
        bindControlTarget()
    }, [bindControlTarget, tab.id])

    useLayoutEffect(() => {
        disposedRef.current = false
        const unsubscribe = window.devscope.browserView.onEvent((event: BrowserViewEvent) => {
            if (event.type === 'focus') {
                if (event.tabId === tab.id) dismissTransientMenus()
                return
            }
            if (event.state.tabId !== tab.id) return
            const ownershipSnapshot = event.cause === 'snapshot' || event.cause === 'ownership'
            if (event.cause === 'ownership') {
                controlBindAttemptsRef.current = 0
                window.clearTimeout(controlBindTimerRef.current)
                controlBindTimerRef.current = 0
            }
            applyState(event.state, ownershipSnapshot)
        })
        const ensure = window.devscope.browserView.ensure({
            tabId: tab.id,
            threadId,
            sessionMode: tab.sessionMode,
            initialUrl: tab.url || undefined
        }).then((result) => {
            if (!result.success) throw new Error(result.error)
            if (!result.created && result.state.url) {
                skipMatchingNavigationRef.current = { url: result.state.url, expiresAt: Date.now() + 2_500 }
            }
            applyState(result.state, true)
            scheduleControlBind()
            return result.state
        }).catch((error: unknown) => {
            if (!disposedRef.current) callbacksRef.current.onStateChange(tab.id, {
                status: 'error',
                error: error instanceof Error ? error.message : 'The Browser view could not be prepared.'
            }, { suppressHistory: true })
            throw error
        })
        ensurePromiseRef.current = ensure
        void ensure.catch(() => undefined)
        return () => {
            disposedRef.current = true
            unsubscribe()
            window.clearTimeout(controlBindTimerRef.current)
            controlBindTimerRef.current = 0
            controlBindingRef.current = false
            controlBindAttemptsRef.current = 0
            controlTargetIdRef.current = null
            window.devscope.browserView.release(tab.id)
            callbacksRef.current.onFullscreenChange(tab.id, false)
            callbacksRef.current.onControlTargetChange(tab.id, null)
        }
    }, [applyState, scheduleControlBind, tab.id, tab.sessionMode, threadId])

    const runCommand = useCallback(async (command: BrowserViewCommandInput) => {
        await ensurePromiseRef.current
        const result = await window.devscope.browserView.command(command)
        if (!result.success) throw new Error(result.error)
        if (command.type !== 'control-overlay' && command.type !== 'capture') applyState(result.state, true)
        return result
    }, [applyState])

    const refreshPresentationSnapshot = useCallback(async (): Promise<boolean> => {
        const generation = ++snapshotGenerationRef.current
        await ensurePromiseRef.current
        const result = await window.devscope.browserView.command({ tabId: tab.id, type: 'capture' })
        if (!result.success || !result.snapshotDataUrl || disposedRef.current || generation !== snapshotGenerationRef.current) return false
        const presentation = new Image()
        presentation.src = result.snapshotDataUrl
        await presentation.decode()
        if (disposedRef.current || generation !== snapshotGenerationRef.current) return false
        snapshotReadyRef.current = false
        snapshotDataUrlRef.current = result.snapshotDataUrl
        setSnapshotDataUrl(result.snapshotDataUrl)
        await new Promise<void>((resolve) => {
            window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))
        })
        if (disposedRef.current || generation !== snapshotGenerationRef.current) return false
        snapshotReadyRef.current = true
        return true
    }, [tab.id])

    const preparePresentationSnapshot = useCallback((): Promise<boolean> => {
        if (!tab.url) return Promise.resolve(true)
        if (presentationPreparationRef.current) return presentationPreparationRef.current
        const preparation = refreshPresentationSnapshot()
            .then((refreshed) => refreshed || snapshotReadyRef.current)
            .catch(() => snapshotReadyRef.current)
            .finally(() => {
                if (presentationPreparationRef.current === preparation) presentationPreparationRef.current = null
            })
        presentationPreparationRef.current = preparation
        return preparation
    }, [refreshPresentationSnapshot, tab.url])

    useLayoutEffect(() => {
        snapshotGenerationRef.current += 1
        snapshotDataUrlRef.current = null
        snapshotReadyRef.current = false
        setSnapshotDataUrl(null)
    }, [tab.url])

    useLayoutEffect(() => {
        if (!active) {
            snapshotGenerationRef.current += 1
            snapshotDataUrlRef.current = null
            snapshotReadyRef.current = false
            setSnapshotDataUrl(null)
            return
        }
        if (presentationRequested) {
            // Page readiness can precede app hydration (canvas editors, sign-in flows).
            // Refresh each time a menu/overlay covers the native view, even if an earlier image exists.
            if (tab.url) void refreshPresentationSnapshot().catch(() => undefined)
            return
        }
        if (tab.status !== 'ready' || snapshotDataUrlRef.current) return
        const timerId = window.setTimeout(() => {
            void refreshPresentationSnapshot().catch(() => undefined)
        }, 160)
        return () => window.clearTimeout(timerId)
    }, [active, presentationRequested, refreshPresentationSnapshot, tab.status, tab.url])

    const flushControlOverlay = useCallback(async () => {
        if (controlOverlayInFlightRef.current) return
        controlOverlayInFlightRef.current = true
        try {
            while (controlOverlayRequestRef.current) {
                const request = controlOverlayRequestRef.current
                controlOverlayRequestRef.current = null
                await runCommand(request).catch(() => undefined)
            }
        } finally {
            controlOverlayInFlightRef.current = false
        }
    }, [runCommand])

    useLayoutEffect(() => {
        const overlayCursor = cursor?.visible ? {
            x: cursor.x,
            y: cursor.y,
            visible: true,
            phase: cursor.phase,
            label: cursor.principal?.type === 'agent' ? 'Agent' as const : 'Zyra' as const
        } : null
        const shouldPublishOverlay = active && (controlled || Boolean(overlayCursor))
        if (!shouldPublishOverlay && !controlOverlayPublishedRef.current) return
        controlOverlayPublishedRef.current = shouldPublishOverlay
        controlOverlayRequestRef.current = {
            tabId: tab.id,
            type: 'control-overlay',
            controlled: active && controlled,
            cursor: active ? overlayCursor : null
        }
        void flushControlOverlay()
    }, [active, controlled, cursor?.phase, cursor?.principal?.type, cursor?.updatedAt, cursor?.visible, cursor?.x, cursor?.y, flushControlOverlay, tab.id])

    useLayoutEffect(() => () => {
        if (!controlOverlayPublishedRef.current) return
        controlOverlayPublishedRef.current = false
        controlOverlayRequestRef.current = { tabId: tab.id, type: 'control-overlay', controlled: false, cursor: null }
        void flushControlOverlay()
    }, [flushControlOverlay, tab.id])

    const navigate = useCallback(async (url: string) => {
        await ensurePromiseRef.current
        const skip = skipMatchingNavigationRef.current
        skipMatchingNavigationRef.current = null
        if (skip && skip.expiresAt >= Date.now() && skip.url === url && stateRef.current?.url === url) return
        await runCommand({ tabId: tab.id, type: 'navigate', url })
    }, [runCommand, tab.id])

    useImperativeHandle(forwardedRef, () => ({
        navigate,
        openLocalFile: async () => {
            const result = await runCommand({ tabId: tab.id, type: 'open-local-file' })
            return result.accepted
        },
        preparePresentation: preparePresentationSnapshot,
        showNewTab: async () => {
            const result = await runCommand({ tabId: tab.id, type: 'new-tab' })
            return { canGoBack: result.state.canGoBack, canGoForward: result.state.canGoForward }
        },
        goBack: () => { void runCommand({ tabId: tab.id, type: 'back' }).catch(() => undefined) },
        goForward: () => { void runCommand({ tabId: tab.id, type: 'forward' }).catch(() => undefined) },
        reload: () => { void runCommand({ tabId: tab.id, type: 'reload' }).catch(() => undefined) },
        stop: () => { void runCommand({ tabId: tab.id, type: 'stop' }).catch(() => undefined) },
        blur: () => { void runCommand({ tabId: tab.id, type: 'blur' }).catch(() => undefined) },
        getDeveloperTarget: () => {
            const state = stateRef.current
            if (!state) throw new Error('Browser view is not ready yet.')
            return { guestWebContentsId: state.guestWebContentsId, tabId: tab.id }
        },
        getViewportSize: () => {
            const rect = slotRef.current?.getBoundingClientRect()
            return { width: Math.max(1, Math.round(rect?.width || 1)), height: Math.max(1, Math.round(rect?.height || 1)) }
        }
    }), [navigate, preparePresentationSnapshot, runCommand, tab.id])

    useLayoutEffect(() => {
        const slot = slotRef.current
        if (!slot) return
        let lastKey = ''
        const report = (force = false) => {
            const rect = slot.getBoundingClientRect()
            const bounds = rect.width >= 1 && rect.height >= 1
                ? { x: Math.max(0, rect.left), y: Math.max(0, rect.top), width: rect.width, height: rect.height }
                : null
            const liveEffectiveVisible = shouldShowAssistantBrowserNativeView({
                hasPage: Boolean(tab.url),
                requestedVisible: visible,
                nativeViewOccluded: nativeViewOccludedRef.current
            })
            const key = `${active}:${liveEffectiveVisible}:${bounds?.x || 0}:${bounds?.y || 0}:${bounds?.width || 0}:${bounds?.height || 0}`
            if (force || key !== lastKey) {
                lastKey = key
                window.devscope.browserView.reportSlot({
                    tabId: tab.id,
                    revision: nextAssistantBrowserSlotRevision(window),
                    bounds,
                    contentSize: bounds ? { width: Math.max(1, slot.offsetWidth), height: Math.max(1, slot.offsetHeight) } : null,
                    active,
                    visible: liveEffectiveVisible
                })
                callbacksRef.current.onViewportRectChange(tab.id, active && liveEffectiveVisible && bounds ? bounds : null)
            }
        }
        report(true)
        const observer = active ? new ResizeObserver(() => report(true)) : null
        const handleViewportChange = () => report(true)
        observer?.observe(slot)
        if (active) window.addEventListener('resize', handleViewportChange)
        return () => {
            observer?.disconnect()
            window.removeEventListener('resize', handleViewportChange)
            window.devscope.browserView.reportSlot({
                tabId: tab.id,
                revision: nextAssistantBrowserSlotRevision(window),
                bounds: null,
                contentSize: null,
                active: false,
                visible: false
            })
            callbacksRef.current.onViewportRectChange(tab.id, null)
        }
    }, [active, effectiveVisible, placement, tab.id, tab.url, visible])

    return (
        <div
            ref={slotRef}
            className="absolute inset-0 h-full w-full overflow-hidden bg-white"
            aria-hidden={active ? undefined : true}
            data-assistant-browser-view-slot={tab.id}
        >
            {active && snapshotDataUrl ? (
                <img
                    src={snapshotDataUrl}
                    alt=""
                    className="pointer-events-none absolute inset-0 h-full w-full object-fill"
                    aria-hidden="true"
                    data-assistant-browser-view-snapshot
                />
            ) : null}
        </div>
    )
}))
