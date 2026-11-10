import { COMMANDS, resolveShortcut, type CommandId } from '@shared/keybindings'
import { isShortcutRecording, isProtectedShortcutTarget, isBrowserShortcutContext, useShortcutLabel, keyboardInput } from '@/lib/keybindings'
import { AnchoredNativeOverlay } from '@/components/ui/AnchoredNativeOverlay'
import { AnimatedHeight } from '@/components/ui/AnimatedHeight'
import { getOverlayActiveElement, isOverlayEventInside, NativeOverlayVisibilityScope } from '@/components/ui/native-overlay-portal'
import { addOverlayEventListener, addOverlayWindowBlurListener } from '@/components/ui/native-overlay-portal'
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
    ArrowLeft,
    ArrowRight,
    ArrowUpRight,
    Bookmark,
    Camera,
    ChevronDown,
    ChevronRight,
    Circle,
    Clock3,
    Code2,
    Crosshair,
    Download,
    Ellipsis,
    ExternalLink,
    FolderOpen,
    FolderX,
    Globe2,
    House,
    LoaderCircle,
    Minus,
    Monitor,
    MonitorSmartphone,
    Moon,
    PanelsTopLeft,
    Puzzle,
    Plus,
    RefreshCw,
    RotateCcw,
    RotateCw,
    Search,
    Star,
    ShieldAlert,
    ShieldCheck,
    Square,
    Sun,
    TriangleAlert,
    Trash2
} from 'lucide-react'
import type {
    DevScopeBrowserAdDetection,
    DevScopeBrowserBookmark,
    DevScopeBrowserAnnotationTheme,
    DevScopeBrowserColorScheme,
    DevScopeBrowserHistoryEntry,
    DevScopeBrowserOpenTabRequest,
    DevScopeBrowserPreviewConfig,
    DevScopeBrowserShortcutEvent,
    DevScopeBrowserThreatWarning,
    DevScopeLocalServer
} from '@shared/contracts/devscope-api'
import type { ControlStateSnapshot, ControlWorkspaceSnapshot } from '@shared/agent-control/contracts'
import type { BrowserSurfaceOpenRequest } from '@shared/agent-control/protocol'
import { resolveBrowserShortcut, type BrowserShortcutAction, type BrowserShortcutPlatform } from '@shared/browser-shortcuts'
import type { BrowserPopupSummary } from '@shared/browser-popup'
import { BROWSER_LOCAL_FILE_SCHEME, type BrowserSessionMode } from '@shared/browser-view'
import type { BrowserDownloadRecord } from '@shared/browser-downloads'
import type { PreviewOpenOptions } from '@/components/ui/file-preview/types'
import { IncognitoIcon } from '@/components/ui/IncognitoIcon'
import { useSettings } from '@/lib/settings'
import { TRANSIENT_MENU_DISMISS_EVENT } from '@/lib/transient-menu'
import { cn } from '@/lib/utils'
import { forgetBrowserViewState } from '@/lib/browser-view-state'
import { AssistantBrowserAdBlockPrompt } from './AssistantBrowserAdBlockPrompt'
import { AssistantBrowserDeviceToolbar } from './AssistantBrowserDeviceToolbar'
import { AssistantBrowserErrorPage } from './AssistantBrowserErrorPage'
import { AssistantBrowserDownloadsButton } from './AssistantBrowserDownloadsButton'
import { AssistantBrowserDownloadsPanel } from './AssistantBrowserDownloadsPanel'
import { AssistantBrowserHistoryImportDialog } from './AssistantBrowserHistoryImportDialog'
import { AssistantBrowserHistoryPanel } from './AssistantBrowserHistoryPanel'
import { AssistantBrowserBookmarksPanel } from './AssistantBrowserBookmarksPanel'
import { sanitizeBrowserPersistentUrl } from '@shared/browser-url-sanitization'
import { AssistantBrowserNewTab } from './AssistantBrowserNewTab'
import { AssistantBrowserPageIcon } from './AssistantBrowserPageIcon'
import { AssistantBrowserThreatWarning } from './AssistantBrowserThreatWarning'
import { AssistantBrowserViewportFrame } from './AssistantBrowserViewportFrame'
import { AssistantBrowserWebview, type AssistantBrowserWebviewHandle } from './AssistantBrowserWebview'
import { browserTabsToMount } from './assistant-browser-lazy-restore'
import { useBackgroundBrowserState } from './useBackgroundBrowserState'
import { useAssistantBrowserOmniboxSuggestions } from './useAssistantBrowserOmniboxSuggestions'
import {
    filterAssistantBrowserHistory,
    mergeAssistantBrowserHistoryEntry,
    resolveAssistantBrowserOmniboxActiveDescendant,
    resolveAssistantBrowserOmniboxKeyboardAction,
    resolveAssistantBrowserHistoryRecord,
    transitionAssistantBrowserProfileReloadHistory,
    type AssistantBrowserProfileReloadHistoryPhase
} from './assistant-browser-history'
import type { AssistantInspectorDeveloperToastInput } from './AssistantInspectorDeveloperToast'
import {
    readAssistantBrowserRecording,
    subscribeAssistantBrowserRecording,
    prepareAssistantBrowserRecording,
    stopAssistantBrowserRecording
} from './assistant-browser-recording'
import {
    activateAssistantBrowserTab,
    addAssistantBrowserTab,
    ASSISTANT_BROWSER_DANGEROUS_TAB_TITLE,
    browserTabFallbackTitle,
    closeAssistantBrowserTab,
    createAssistantBrowserWorkspaceState,
    ensureAssistantBrowserSurfaceTabs,
    ensureAssistantBrowserWorkspaceTab,
    loadAssistantBrowserWorkspaceState,
    normalizeAssistantBrowserNavigation,
    normalizeAssistantBrowserZoom,
    persistAssistantBrowserWorkspaceState,
    resolveAssistantBrowserSurfaceTabSessionMode,
    shouldFocusAssistantBrowserOmnibox,
    updateAssistantBrowserTab,
    type AssistantBrowserTabState,
    type AssistantBrowserWorkspaceState
} from './assistant-browser-workspace-state'
import { reorderBrowserTabs } from './assistant-browser-tab-order'

function isChromeWebStoreUrl(value: string): boolean {
    try {
        const url = new URL(value)
        return (url.hostname === 'chromewebstore.google.com' && url.pathname.startsWith('/detail/')) || (url.hostname === 'chrome.google.com' && url.pathname.startsWith('/webstore/detail/'))
    } catch { return false }
}

function isSpotifyBrowserUrl(value: string): boolean {
    try {
        const hostname = new URL(value).hostname.toLowerCase()
        return hostname === 'open.spotify.com' || hostname.endsWith('.spotify.com')
    } catch {
        return false
    }
}

function isBrowserLocalFileUrl(value: string): boolean {
    try {
        return new URL(value).protocol === `${BROWSER_LOCAL_FILE_SCHEME}:`
    } catch {
        return false
    }
}

function browserTabAddress(tab: AssistantBrowserTabState | null | undefined): string {
    return tab?.displayAddress || tab?.url || ''
}

function rendererBrowserShortcutPlatform(): BrowserShortcutPlatform {
    return /mac|iphone|ipad|ipod/i.test(navigator.platform) ? 'darwin' : /win/i.test(navigator.platform) ? 'win32' : 'linux'
}

function tabSequenceSeed(state: AssistantBrowserWorkspaceState): number {
    return state.tabs.reduce((maximum, tab) => {
        const suffix = Number(tab.id.split(':').pop())
        return Number.isFinite(suffix) ? Math.max(maximum, suffix + 1) : maximum
    }, 1)
}

const BROWSER_HISTORY_LISTBOX_ID = 'assistant-browser-history-suggestions'
const BROWSER_CHROME_BUTTON_CLASS = 'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-sparkle-text-muted/70 transition-colors hover:bg-[var(--surface-hover)] hover:text-sparkle-text disabled:pointer-events-none disabled:opacity-25'
const BROWSER_MENU_ROW_CLASS = 'flex h-7 w-full items-center gap-2 rounded-[4px] px-2 text-left text-[10px] text-[color-mix(in_srgb,var(--color-text)_76%,transparent)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--color-text)] disabled:opacity-35'
const BROWSER_MENU_SECTION_CLASS = 'text-[10px] font-medium text-[color-mix(in_srgb,var(--color-text)_88%,transparent)]'

function readBrowserAnnotationTheme(): DevScopeBrowserAnnotationTheme {
    const root = getComputedStyle(document.documentElement)
    const read = (property: string, fallback: string) => root.getPropertyValue(property).trim() || fallback
    const colorScheme = document.documentElement.classList.contains('light')
        || (!document.documentElement.classList.contains('dark') && window.matchMedia('(prefers-color-scheme: light)').matches)
        ? 'light'
        : 'dark'
    return {
        colorScheme,
        background: read('--color-bg', colorScheme === 'light' ? '#ffffff' : '#111318'),
        foreground: read('--color-text', colorScheme === 'light' ? '#202124' : '#f4f5f7'),
        popover: read('--color-card', colorScheme === 'light' ? '#ffffff' : '#181b21'),
        mutedForeground: read('--color-text-muted', colorScheme === 'light' ? '#667085' : '#9ba3b0'),
        border: read('--surface-divider', colorScheme === 'light' ? 'rgba(0,0,0,.12)' : 'rgba(255,255,255,.12)'),
        primary: read('--accent-primary', '#7c3aed'),
        primaryForeground: read('--accent-contrast', '#ffffff'),
        fontFamily: root.fontFamily || 'system-ui, sans-serif'
    }
}

export type AssistantBrowserWorkspaceController = {
    createTab: (url?: string, options?: { activate?: boolean; tabId?: string; sessionMode?: BrowserSessionMode }) => string
    closeTab: (tabId: string, options?: { transferred?: boolean }) => AssistantBrowserWorkspaceState
    activateTab: (tabId: string) => void
    reorderTabs: (tabIds: string[]) => void
}

export const AssistantBrowserWorkspace = memo(function AssistantBrowserWorkspace({
    workspaceKey,
    threadId,
    projectPath,
    active,
    selectedTabId,
    controlState,
    navigationRequest,
    surfaceRequest,
    onNavigationRequestHandled,
    onSurfaceRequestHandled,
    onWorkspaceStateChange,
    onLocalControlTargetChange,
    onTabsChange,
    onRequestTabSelection,
    onControllerChange,
    onDeveloperToast,
    onOpenPreview,
    captureSessionId,
    chatIntegration = true,
    defaultSessionMode = 'normal',
    tabIdPrefix = 'browser',
    persistState = true
}: {
    workspaceKey: string
    threadId: string
    projectPath: string | null
    active: boolean
    selectedTabId: string | null
    controlState: ControlStateSnapshot | null
    navigationRequest: { id: string | number; tabId: string; url: string; sessionMode: BrowserSessionMode } | null
    surfaceRequest: BrowserSurfaceOpenRequest | null
    onNavigationRequestHandled: (requestId: string | number) => void
    onSurfaceRequestHandled: (requestId: string) => void
    onWorkspaceStateChange: (state: ControlWorkspaceSnapshot['browser']) => void
    onLocalControlTargetChange?: (tabId: string, targetId: string) => void
    onTabsChange: (state: AssistantBrowserWorkspaceState) => void
    onRequestTabSelection: (tabId: string) => void
    onControllerChange: (controller: AssistantBrowserWorkspaceController | null) => void
    onDeveloperToast: (toast: AssistantInspectorDeveloperToastInput) => void
    onOpenPreview: (file: { name: string; path: string }, ext: string, options?: PreviewOpenOptions) => Promise<void>
    captureSessionId?: string | null
    chatIntegration?: boolean
    defaultSessionMode?: BrowserSessionMode
    tabIdPrefix?: string
    persistState?: boolean
}) {
    const { settings } = useSettings()
    const browserToolsEnabled = chatIntegration || settings.assistantBrowserStandaloneAiTools !== false
    const captureChatId = chatIntegration ? (captureSessionId ?? workspaceKey) : null
    const shortcut = useShortcutLabel()
    const shortcutTitle = (label: string, id: CommandId) => `${label}${shortcut(id) ? ` (${shortcut(id)})` : ''}`
    const browserDownloadsApi = useMemo(() => ({
        list: () => window.devscope.listBrowserDownloads(),
        act: (action: Parameters<typeof window.devscope.actOnBrowserDownload>[0]) => window.devscope.actOnBrowserDownload(action),
        subscribe: (callback: Parameters<typeof window.devscope.onBrowserDownloadsChanged>[0]) => window.devscope.onBrowserDownloadsChanged(callback),
        listFolder: () => typeof window.devscope.listBrowserDownloadsFolder === 'function'
            ? window.devscope.listBrowserDownloadsFolder()
            : Promise.resolve({ success: false as const, error: 'Restart Zyra once to enable the Downloads folder view.' }),
        actOnFolderEntry: (action: Parameters<typeof window.devscope.actOnBrowserDownloadsFolderEntry>[0]) => typeof window.devscope.actOnBrowserDownloadsFolderEntry === 'function'
            ? window.devscope.actOnBrowserDownloadsFolderEntry(action)
            : Promise.resolve({ success: false as const, error: 'Restart Zyra once to enable Downloads folder actions.' })
    }), [])
    const openDownloadHere = useCallback(async (download: BrowserDownloadRecord) => {
        const result = await window.devscope.getBrowserDownloadPreviewTarget(download.id)
        if (!result.success) throw new Error(result.error)
        await onOpenPreview({ name: result.target.name, path: result.target.path }, result.target.extension)
    }, [onOpenPreview])
    const normalizedProjectPath = String(projectPath || '').trim()
    const [workspaceState, setWorkspaceState] = useState<AssistantBrowserWorkspaceState>(() => {
        const fallbackTabId = `${tabIdPrefix}:0`
        const restored = {
            ...(persistState
                ? loadAssistantBrowserWorkspaceState(workspaceKey, fallbackTabId, defaultSessionMode)
                : createAssistantBrowserWorkspaceState(fallbackTabId, defaultSessionMode)),
            splitTabId: null
        }
        const initialSurfaceMode = surfaceRequest?.mode || 'open'
        const initialSurfaceTabId = surfaceRequest
            && initialSurfaceMode !== 'close'
            && initialSurfaceMode !== 'refresh'
            && initialSurfaceMode !== 'external'
            ? surfaceRequest.tabId
            : null
        const initialNavigationTabId = navigationRequest?.tabId || null
        const initialTabId = selectedTabId || initialSurfaceTabId || initialNavigationTabId
        const initialSessionMode = initialTabId && initialTabId === initialSurfaceTabId
            ? surfaceRequest?.sessionMode || 'normal'
            : initialTabId && initialTabId === initialNavigationTabId
                ? navigationRequest?.sessionMode || defaultSessionMode
                : defaultSessionMode
        return initialTabId ? ensureAssistantBrowserWorkspaceTab(restored, initialTabId, initialSessionMode) : restored
    })
    const [viewportRects, setViewportRects] = useState<Record<string, { x: number; y: number; width: number; height: number }>>({})
    const [config, setConfig] = useState<DevScopeBrowserPreviewConfig | null>(null)
    const [configLoading, setConfigLoading] = useState(Boolean(normalizedProjectPath))
    const [configError, setConfigError] = useState<string | null>(null)
    const [addressValue, setAddressValue] = useState('')
    const [addressError, setAddressError] = useState<string | null>(null)
    const [profileMenuOpen, setProfileMenuOpen] = useState(false)
    const [browserDataOpen, setBrowserDataOpen] = useState(false)
    const [downloadsPanelOpen, setDownloadsPanelOpen] = useState(false)
    const [popupWindows, setPopupWindows] = useState<BrowserPopupSummary[]>([])
    const [clearProfileArmed, setClearProfileArmed] = useState(false)
    const [siteSignOutArmed, setSiteSignOutArmed] = useState(false)
    const [clearingProfile, setClearingProfile] = useState(false)
    const [profileNotice, setProfileNotice] = useState<{ tone: 'info' | 'error'; message: string } | null>(null)
    const [annotationTabId, setAnnotationTabId] = useState<string | null>(null)
    const [fullscreenTabId, setFullscreenTabId] = useState<string | null>(null)
    const recordingState = useSyncExternalStore(subscribeAssistantBrowserRecording, readAssistantBrowserRecording)
    const recordingTabId = ['starting', 'recording', 'paused', 'stopping'].includes(recordingState.status) ? recordingState.tabId : null
    const [localServers, setLocalServers] = useState<DevScopeLocalServer[]>([])
    const [browserHistory, setBrowserHistory] = useState<DevScopeBrowserHistoryEntry[]>([])
    const [browserBookmarks, setBrowserBookmarks] = useState<DevScopeBrowserBookmark[]>([])
    const [bookmarksPanelOpen, setBookmarksPanelOpen] = useState(false)
    const [historyPanelOpen, setHistoryPanelOpen] = useState(false)
    const [historyImportOpen, setHistoryImportOpen] = useState(false)
    const [historyPanelQuery, setHistoryPanelQuery] = useState('')
    const [historyPanelSearch, setHistoryPanelSearch] = useState<{ query: string; entries: DevScopeBrowserHistoryEntry[] }>({ query: '', entries: [] })
    const [historyPanelLoading, setHistoryPanelLoading] = useState(false)
    const [historyActiveIndex, setHistoryActiveIndex] = useState(-1)
    const [addressFocused, setAddressFocused] = useState(false)
    const [historyClearArmed, setHistoryClearArmed] = useState(false)
    const [adBlockPrompt, setAdBlockPrompt] = useState<{ tabId: string; origin: string } | null>(null)
    const [adBlockEnabling, setAdBlockEnabling] = useState(false)
    const [adBlockError, setAdBlockError] = useState<string | null>(null)
    const [threatWarning, setThreatWarning] = useState<{ tabId: string; warning: DevScopeBrowserThreatWarning } | null>(null)
    const [threatActionBusy, setThreatActionBusy] = useState(false)
    const [threatActionError, setThreatActionError] = useState<string | null>(null)
    const [serversLoading, setServersLoading] = useState(false)
    const [serversError, setServersError] = useState<string | null>(null)
    const workspaceStateRef = useRef(workspaceState)
    const controlTargetsByTab = useMemo<Record<string, string>>(() => chatIntegration ? Object.fromEntries(
        (controlState?.targets || []).flatMap((target): Array<[string, string]> => (
            target.kind === 'zyra-browser' && target.ownerThreadId === threadId ? [[target.tabId, target.targetId]] : []
        ))
    ) : {}, [chatIntegration, controlState?.targets, threadId])
    const controlTargetsByTabRef = useRef(controlTargetsByTab)
    const webviewRefs = useRef(new Map<string, AssistantBrowserWebviewHandle>())
    const mountedBrowserTabIdsRef = useRef<Set<string>>(new Set())
    const accessoryNewTabMountedRef = useRef(false)
    const webviewRefCallbacks = useRef(new Map<string, (handle: AssistantBrowserWebviewHandle | null) => void>())
    const closedTabsRef = useRef<AssistantBrowserTabState[]>([])
    const pendingNavigationRef = useRef(new Map<string, string>())
    const consumedNavigationRequestsRef = useRef(new Set<string | number>())
    const consumedSurfaceRequestsRef = useRef(new Set<string>())
    const cancelledSurfaceRequestsRef = useRef(new Set<string>())
    const pendingSurfaceRequestsRef = useRef(new Map<string, BrowserSurfaceOpenRequest>())
    const onSurfaceRequestHandledRef = useRef(onSurfaceRequestHandled)
    const tabSequenceRef = useRef(tabSequenceSeed(workspaceState))
    const addressFocusedRef = useRef(false)
    const omniboxMenuRef = useRef<HTMLDivElement | null>(null)
    const addressContainerRef = useRef<HTMLDivElement | null>(null)
    const suppressHistoryUntilRef = useRef(0)
    const profileReloadHistorySuppressionRef = useRef(new Map<string, AssistantBrowserProfileReloadHistoryPhase>())
    const profileMenuRef = useRef<HTMLDivElement | null>(null)
    const annotationTabIdRef = useRef<string | null>(annotationTabId)
    const fullscreenTabIdRef = useRef<string | null>(fullscreenTabId)
    const captureActiveScreenshotRef = useRef<() => Promise<void>>(async () => {})

    workspaceStateRef.current = workspaceState
    annotationTabIdRef.current = annotationTabId
    fullscreenTabIdRef.current = fullscreenTabId
    controlTargetsByTabRef.current = controlTargetsByTab
    onSurfaceRequestHandledRef.current = onSurfaceRequestHandled
    const activeTab = workspaceState.tabs.find((tab) => tab.id === workspaceState.activeTabId)
    const accessoryNewTabVisible = !chatIntegration && activeTab?.status === 'idle' && !activeTab.url
    if (accessoryNewTabVisible) accessoryNewTabMountedRef.current = true
    mountedBrowserTabIdsRef.current = browserTabsToMount(mountedBrowserTabIdsRef.current, active, workspaceState.activeTabId, workspaceState.splitTabId)
    const browserDevToolsAvailable = Boolean(activeTab?.url)
    const activeAddress = browserTabAddress(activeTab)
    const bookmarkableUrl = sanitizeBrowserPersistentUrl(activeTab?.url || '', 2_048)
    const activeBookmarked = Boolean(bookmarkableUrl && browserBookmarks.some((entry) => entry.url === bookmarkableUrl))
    const browserFullscreen = Boolean(activeTab && fullscreenTabId === activeTab.id)
    const browserChromeReady = Boolean(normalizedProjectPath && config && !configLoading && !configError)
    const spotifyNeedsProductionVmp = Boolean(
        activeTab?.url
        && isSpotifyBrowserUrl(activeTab.url)
        && config?.protectedMedia.ready
        && config.protectedMedia.vmpLevel !== 'production'
    )
    const projectServers = useMemo(() => localServers.filter((server) => server.attachedToProject), [localServers])
    const otherLocalServers = useMemo(() => localServers.filter((server) => !server.attachedToProject), [localServers])
    const historyQuery = addressFocused && addressValue !== activeAddress ? addressValue.trim() : ''
    const { suggestions: omniboxSuggestions, loading: omniboxLoading, clear: clearOmniboxSuggestions } = useAssistantBrowserOmniboxSuggestions(
        historyQuery, browserHistory, settings.assistantBrowserGoogleSuggestions
    )
    const historyPanelEntries = historyPanelQuery && historyPanelSearch.query === historyPanelQuery
        ? historyPanelSearch.entries
        : historyPanelQuery
            ? filterAssistantBrowserHistory(browserHistory, historyPanelQuery, 50)
            : browserHistory
    const historyPanelSearching = Boolean(historyPanelQuery.trim() && historyPanelSearch.query !== historyPanelQuery.trim()) || historyPanelLoading
    const activeControlTargetId = activeTab ? controlTargetsByTab[activeTab.id] : undefined
    const activePendingGrant = controlState?.pendingGrants.find((grant) => grant.targetId === activeControlTargetId) || null
    const browserOverlayScope = JSON.stringify([workspaceKey, activeTab?.id, activeTab?.url])
    const omniboxOpen = active && addressFocused && Boolean(historyQuery)
    useEffect(() => {
        if (!addressFocused) return
        return addOverlayEventListener('pointerdown', event => {
            if (isOverlayEventInside(event, addressContainerRef.current, omniboxMenuRef.current)) return
            setAddressFocused(false)
            addressFocusedRef.current = false
            addressContainerRef.current?.querySelector<HTMLInputElement>('input')?.blur()
        }, true)
    }, [addressFocused])
    useEffect(() => { setProfileMenuOpen(false) }, [active, browserOverlayScope])
    useEffect(() => { if (!profileMenuOpen) setBrowserDataOpen(false) }, [profileMenuOpen])
    useEffect(() => {
        if (!shouldFocusAssistantBrowserOmnibox(active, browserChromeReady, activeTab)) return
        const animationFrame = window.requestAnimationFrame(() => {
            addressContainerRef.current?.querySelector<HTMLInputElement>('input')?.focus()
        })
        return () => window.cancelAnimationFrame(animationFrame)
    }, [active, activeTab?.id, activeTab?.url, browserChromeReady])

    // A fresh New Tab can remain unchanged for its entire lifetime. Save it on
    // mount as well as mutation so the inspector can restore its Browser entry.
    useEffect(() => {
        if (persistState) persistAssistantBrowserWorkspaceState(workspaceKey, workspaceStateRef.current)
    }, [persistState, workspaceKey])

    const commitWorkspaceState = useCallback((nextState: AssistantBrowserWorkspaceState) => {
        workspaceStateRef.current = nextState
        setWorkspaceState(nextState)
        if (persistState) persistAssistantBrowserWorkspaceState(workspaceKey, nextState)
    }, [persistState, workspaceKey])

    const mutateWorkspaceState = useCallback((
        updater: (current: AssistantBrowserWorkspaceState) => AssistantBrowserWorkspaceState
    ) => {
        const nextState = updater(workspaceStateRef.current)
        if (nextState !== workspaceStateRef.current) commitWorkspaceState(nextState)
    }, [commitWorkspaceState])

    const transitionToBrowserTab = useCallback((tabId: string) => {
        const previousTabId = workspaceStateRef.current.activeTabId
        if (previousTabId !== tabId) webviewRefs.current.get(previousTabId)?.blur()
        const fullscreenTab = fullscreenTabIdRef.current
        if (fullscreenTab && fullscreenTab !== tabId) {
            fullscreenTabIdRef.current = null
            setFullscreenTabId(null)
            window.devscope.window.setFullScreen(false)
        }
        addressFocusedRef.current = false
        setAddressFocused(false)
        addressContainerRef.current?.querySelector<HTMLInputElement>('input')?.blur()
        mutateWorkspaceState((current) => activateAssistantBrowserTab(current, tabId))
    }, [mutateWorkspaceState])

    const cancelAnnotation = useCallback(() => {
        const tabId = annotationTabIdRef.current
        annotationTabIdRef.current = null
        setAnnotationTabId(null)
        if (!tabId) return
        const handle = webviewRefs.current.get(tabId)
        if (!handle) return
        try {
            void window.devscope.cancelBrowserPreviewAnnotation(handle.getDeveloperTarget()).catch(() => undefined)
        } catch {
            // A closing or navigating guest is already tearing its isolated annotation world down.
        }
    }, [])

    const failSurfaceRequest = useCallback((request: BrowserSurfaceOpenRequest, error: string) => {
        pendingSurfaceRequestsRef.current.delete(request.requestId)
        void window.devscope.agentControl.completeBrowserSurfaceRequest({
            requestId: request.requestId,
            threadId: request.threadId,
            tabId: request.tabId,
            success: false,
            error
        }).finally(() => onSurfaceRequestHandledRef.current(request.requestId))
    }, [])

    useEffect(() => {
        if (!configError) return
        for (const request of [...pendingSurfaceRequestsRef.current.values()]) {
            failSurfaceRequest(request, configError)
        }
    }, [configError, failSurfaceRequest])

    useEffect(() => {
        if (!chatIntegration) return
        return window.devscope.agentControl.onBrowserSurfaceCancel((requestId) => {
            cancelledSurfaceRequestsRef.current.add(requestId)
            pendingSurfaceRequestsRef.current.delete(requestId)
            if (cancelledSurfaceRequestsRef.current.size > 100) {
                const oldest = cancelledSurfaceRequestsRef.current.values().next().value
                if (oldest) cancelledSurfaceRequestsRef.current.delete(oldest)
            }
        })
    }, [chatIntegration])

    const handleFullscreenChange = useCallback((tabId: string, fullscreen: boolean) => {
        setFullscreenTabId((current) => fullscreen ? tabId : current === tabId ? null : current)
    }, [])

    const handleViewportRectChange = useCallback((tabId: string, rect: { x: number; y: number; width: number; height: number } | null) => {
        setViewportRects((current) => {
            if (!rect) {
                if (!current[tabId]) return current
                const next = { ...current }
                delete next[tabId]
                return next
            }
            const previous = current[tabId]
            if (previous && previous.x === rect.x && previous.y === rect.y && previous.width === rect.width && previous.height === rect.height) return current
            return { ...current, [tabId]: rect }
        })
    }, [])

    const handleControlTargetChange = useCallback((tabId: string, targetId: string | null) => {
        if (!targetId) return
        onLocalControlTargetChange?.(tabId, targetId)
        const request = [...pendingSurfaceRequestsRef.current.values()].find((entry) => entry.tabId === tabId)
        if (!request) return
        pendingSurfaceRequestsRef.current.delete(request.requestId)
        onSurfaceRequestHandledRef.current(request.requestId)
    }, [onLocalControlTargetChange])

    useEffect(() => {
        onTabsChange(threatWarning ? {
            ...workspaceState,
            tabs: workspaceState.tabs.map((tab) => threatWarning.tabId === tab.id
                ? { ...tab, title: ASSISTANT_BROWSER_DANGEROUS_TAB_TITLE, threatStatus: 'dangerous' as const }
                : tab)
        } : workspaceState)
    }, [onTabsChange, threatWarning, workspaceState])

    useEffect(() => {
        if (!selectedTabId || workspaceStateRef.current.activeTabId === selectedTabId) return
        const trustedTarget = controlState?.targets.find((target) => (
            target.kind === 'zyra-browser' && target.tabId === selectedTabId
        ))
        const trustedSessionMode = trustedTarget?.kind === 'zyra-browser' ? trustedTarget.sessionMode : undefined
        const sessionMode = resolveAssistantBrowserSurfaceTabSessionMode(
            selectedTabId,
            surfaceRequest,
            trustedSessionMode
        )
        mutateWorkspaceState((current) => ensureAssistantBrowserWorkspaceTab(current, selectedTabId, sessionMode))
        transitionToBrowserTab(selectedTabId)
    }, [controlState?.targets, mutateWorkspaceState, selectedTabId, surfaceRequest, transitionToBrowserTab])

    useEffect(() => {
        if (!chatIntegration || !threadId) return
        const owned = (controlState?.targets || []).filter(target => target.kind === 'zyra-browser' && target.ownerThreadId === threadId)
        if (!owned.some(target => target.kind === 'zyra-browser' && !workspaceStateRef.current.tabs.some(tab => tab.id === target.tabId))) return
        mutateWorkspaceState(current => {
            let next = current
            for (const target of owned) {
                if (target.kind === 'zyra-browser' && !next.tabs.some(tab => tab.id === target.tabId)) {
                    next = addAssistantBrowserTab(next, target.tabId, target.url || '', false, target.sessionMode)
                }
            }
            return next
        })
    }, [chatIntegration, controlState?.targets, mutateWorkspaceState, threadId])

    useEffect(() => {
        const visibleTabIds = active && activeTab ? [activeTab.id] : []
        onWorkspaceStateChange({
            open: true,
            activeTabId: activeTab?.id || null,
            splitTabId: null,
            visibleTabIds,
            tabs: workspaceState.tabs.map((tab) => {
                const targetId = controlTargetsByTab[tab.id] || null
                const target = targetId ? controlState?.targets.find((entry) => entry.targetId === targetId) : null
                return {
                    tabId: tab.id,
                    sessionMode: tab.sessionMode,
                    targetId,
                    trusted: Boolean(targetId && target?.kind === 'zyra-browser' && target.tabId === tab.id),
                    url: tab.url || null,
                    title: tab.title || null,
                    origin: target?.kind === 'zyra-browser' ? target.origin : null,
                    status: tab.status,
                    position: active && tab.id === activeTab?.id ? 'primary' : null,
                    visible: visibleTabIds.includes(tab.id),
                    viewportRect: viewportRects[tab.id] || null
                }
            })
        })
    }, [active, activeTab?.id, controlState?.targets, controlTargetsByTab, onWorkspaceStateChange, viewportRects, workspaceState.tabs])

    useEffect(() => {
        if (!addressFocusedRef.current) setAddressValue(activeAddress)
        setAddressError(null)
        const activeAnnotationTabId = annotationTabIdRef.current
        if (activeAnnotationTabId && activeAnnotationTabId !== activeTab?.id) cancelAnnotation()
    }, [activeAddress, activeTab?.id, cancelAnnotation])

    useEffect(() => {
        if (active) return
        addressFocusedRef.current = false
        setAddressFocused(false)
        addressContainerRef.current?.querySelector<HTMLInputElement>('input')?.blur()
        cancelAnnotation()
    }, [active, cancelAnnotation])

    useEffect(() => () => cancelAnnotation(), [cancelAnnotation])
    useEffect(() => { if (!browserToolsEnabled) cancelAnnotation() }, [browserToolsEnabled, cancelAnnotation])

    useEffect(() => {
        if (!normalizedProjectPath) {
            setConfig(null)
            setConfigLoading(false)
            setConfigError(null)
            return
        }
        let cancelled = false
        setConfigLoading(true)
        setConfigError(null)
        void window.devscope.getBrowserPreviewConfig()
            .then((result) => {
                if (cancelled) return
                if (!result.success) {
                    setConfig(null)
                    setConfigError(result.error || 'Integrated Browser is unavailable.')
                    return
                }
                setConfig({
                    partition: result.partition,
                    webPreferences: result.webPreferences,
                    profileScope: result.profileScope,
                    persistent: result.persistent,
                    protectedMedia: result.protectedMedia
                })
            })
            .catch((error: unknown) => {
                if (!cancelled) {
                    setConfig(null)
                    setConfigError(error instanceof Error ? error.message : 'Integrated Browser is unavailable.')
                }
            })
            .finally(() => {
                if (!cancelled) setConfigLoading(false)
            })
        return () => {
            cancelled = true
        }
    }, [normalizedProjectPath])

    useEffect(() => {
        if (!active || !config || config.protectedMedia.ready || config.protectedMedia.restartRequired) return
        let cancelled = false
        let timer = 0
        const poll = () => {
            timer = window.setTimeout(() => {
                void window.devscope.getBrowserPreviewConfig().then((result) => {
                    if (cancelled || !result.success) return
                    setConfig((current) => current ? { ...current, protectedMedia: result.protectedMedia } : current)
                    if (!result.protectedMedia.ready && !result.protectedMedia.restartRequired) poll()
                }).catch(() => {
                    if (!cancelled) poll()
                })
            }, 2_000)
        }
        poll()
        return () => {
            cancelled = true
            window.clearTimeout(timer)
        }
    }, [active, config?.protectedMedia.ready, config?.protectedMedia.restartRequired, config?.protectedMedia.message])

    useEffect(() => {
        if (settings.assistantBrowserAdBlockEnabled || settings.assistantBrowserAdBlockPromptDismissed) {
            setAdBlockPrompt(null)
            setAdBlockError(null)
            return
        }
        if (typeof window.devscope.onBrowserAdDetected !== 'function') return
        const retryTimers = new Set<number>()
        let disposed = false
        const resolveDetection = (event: DevScopeBrowserAdDetection, attempt = 0) => {
            if (disposed) return
            let detectedTabId: string | null = null
            for (const [tabId, handle] of webviewRefs.current) {
                try {
                    if (handle.getDeveloperTarget().guestWebContentsId === event.guestWebContentsId) {
                        detectedTabId = tabId
                        break
                    }
                } catch {
                    // A guest can still be attaching when its first subresources arrive.
                }
            }
            if (!detectedTabId && attempt < 8) {
                const timer = window.setTimeout(() => {
                    retryTimers.delete(timer)
                    resolveDetection(event, attempt + 1)
                }, 250)
                retryTimers.add(timer)
                return
            }
            if (!detectedTabId) return
            setAdBlockError(null)
            setAdBlockPrompt({ tabId: detectedTabId, origin: event.pageOrigin })
        }
        const unsubscribe = window.devscope.onBrowserAdDetected((event) => resolveDetection(event))
        return () => {
            disposed = true
            unsubscribe()
            for (const timer of retryTimers) window.clearTimeout(timer)
        }
    }, [settings.assistantBrowserAdBlockEnabled, settings.assistantBrowserAdBlockPromptDismissed])

    useEffect(() => {
        if (!profileMenuOpen) return
        const dismissProfileMenu = () => {
            setProfileMenuOpen(false)
            setClearProfileArmed(false)
            setSiteSignOutArmed(false)
            setHistoryClearArmed(false)
        }
        const handlePointerDown = (event: PointerEvent) => {
                        if (isOverlayEventInside(event, profileMenuRef.current)) return
            dismissProfileMenu()
        }
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') dismissProfileMenu()
        }
        const removeOverlayListener1 = addOverlayEventListener('pointerdown', handlePointerDown, true)
        const removeOverlayListener2 = addOverlayEventListener('keydown', handleEscape)
        const removeOverlayBlurListener4 = addOverlayWindowBlurListener(dismissProfileMenu)
        window.addEventListener(TRANSIENT_MENU_DISMISS_EVENT, dismissProfileMenu)
        return () => {
            removeOverlayListener1()
            removeOverlayListener2()
            removeOverlayBlurListener4()
            window.removeEventListener(TRANSIENT_MENU_DISMISS_EVENT, dismissProfileMenu)
        }
    }, [profileMenuOpen])

    const getSearchSuggestions = useCallback(async (query: string): Promise<string[]> => {
        if (!settings.assistantBrowserGoogleSuggestions || typeof window.devscope.getBrowserSearchSuggestions !== 'function') return []
        try {
            const result = await window.devscope.getBrowserSearchSuggestions({ query })
            return result.success ? result.suggestions : []
        } catch {
            return []
        }
    }, [settings.assistantBrowserGoogleSuggestions])

    const refreshLocalServers = useCallback(async () => {
        if (!normalizedProjectPath) return
        setServersLoading(true)
        setServersError(null)
        try {
            const result = await window.devscope.getRunningLocalServers(normalizedProjectPath)
            if (!result.success) {
                setLocalServers([])
                setServersError(result.error || 'Could not inspect local servers.')
                return
            }
            setLocalServers(result.servers)
        } catch (error: unknown) {
            setLocalServers([])
            setServersError(error instanceof Error ? error.message : 'Could not inspect local servers.')
        } finally {
            setServersLoading(false)
        }
    }, [normalizedProjectPath])

    useEffect(() => {
        if (active && normalizedProjectPath) void refreshLocalServers()
    }, [active, normalizedProjectPath, refreshLocalServers])

    const reloadBrowserHistory = useCallback(async () => {
        if (typeof window.devscope.getBrowserHistory !== 'function') return
        try {
            const result = await window.devscope.getBrowserHistory({ limit: 50 })
            if (result.success) setBrowserHistory((current) => result.entries.reduce(mergeAssistantBrowserHistoryEntry, current))
        } catch {
            // History is supplementary; older preload builds can continue browsing until restart.
        }
    }, [])

    useEffect(() => {
        if (active) void reloadBrowserHistory()
    }, [active, reloadBrowserHistory])

    const reloadBrowserBookmarks = useCallback(async () => {
        try {
            const result = await window.devscope.getBrowserBookmarks()
            if (result.success) setBrowserBookmarks(result.entries)
        } catch {
            // A previous preload can continue browsing until restart.
        }
    }, [])

    useEffect(() => {
        if (active) void reloadBrowserBookmarks()
    }, [active, reloadBrowserBookmarks])

    const toggleActiveBookmark = useCallback(async () => {
        if (!activeTab?.url) return
        try {
            const existingUrl = sanitizeBrowserPersistentUrl(activeTab.url, 2_048)
            if (!existingUrl) return
            if (browserBookmarks.some((entry) => entry.url === existingUrl)) {
                const result = await window.devscope.removeBrowserBookmark(existingUrl)
                if (!result.success) throw new Error(result.error)
                setBrowserBookmarks((current) => current.filter((entry) => entry.url !== existingUrl))
            } else {
                const result = await window.devscope.saveBrowserBookmark({ url: activeTab.url, title: activeTab.title, faviconUrl: activeTab.faviconUrl })
                if (!result.success) throw new Error(result.error)
                if (!result.entry) throw new Error('This page cannot be bookmarked.')
                setBrowserBookmarks((current) => [result.entry!, ...current.filter((entry) => entry.url !== result.entry!.url)])
            }
        } catch (error) {
            onDeveloperToast({ tone: 'error', message: error instanceof Error ? error.message : 'Could not update bookmark.' })
        }
    }, [activeTab?.url, activeTab?.title, activeTab?.faviconUrl, browserBookmarks, onDeveloperToast])

    const removeBookmark = useCallback(async (url: string) => {
        try {
            const result = await window.devscope.removeBrowserBookmark(url)
            if (!result.success) throw new Error(result.error)
            setBrowserBookmarks((current) => current.filter((entry) => entry.url !== url))
        } catch (error) {
            onDeveloperToast({ tone: 'error', message: error instanceof Error ? error.message : 'Could not remove bookmark.' })
        }
    }, [onDeveloperToast])

    useEffect(() => {
        if (!active) return
        const popupApi = window.devscope.browserPopup
        if (typeof popupApi?.listOpenWindows !== 'function' || typeof popupApi.onOpenWindowsChange !== 'function') return
        let disposed = false
        const scopeWindows = (windows: BrowserPopupSummary[]) => chatIntegration
            ? windows.filter((popup) => popup.ownerThreadId === threadId)
            : windows
        void popupApi.listOpenWindows().then((result) => {
            if (!disposed && result.success) setPopupWindows(scopeWindows(result.windows))
        }).catch(() => undefined)
        const unsubscribe = popupApi.onOpenWindowsChange((windows) => {
            if (!disposed) setPopupWindows(scopeWindows(windows))
        })
        return () => {
            disposed = true
            unsubscribe()
        }
    }, [active, chatIntegration, threadId])

    useEffect(() => {
        setHistoryActiveIndex(-1)
    }, [addressFocused, historyQuery, omniboxSuggestions])

    useEffect(() => {
        if (!historyPanelOpen || !historyPanelQuery.trim() || typeof window.devscope.getBrowserHistory !== 'function') {
            setHistoryPanelSearch({ query: '', entries: [] })
            setHistoryPanelLoading(false)
            return
        }
        let cancelled = false
        let settleTimer = 0
        const startedAt = performance.now()
        setHistoryPanelLoading(true)
        const query = historyPanelQuery.trim()
        const timer = window.setTimeout(() => {
            void window.devscope.getBrowserHistory({ query, limit: 50 }).then((result) => {
                if (!cancelled && result.success) setHistoryPanelSearch({ query, entries: result.entries })
            }).catch(() => {
                if (!cancelled) setHistoryPanelSearch({ query, entries: [] })
            }).finally(() => {
                if (cancelled) return
                settleTimer = window.setTimeout(() => {
                    if (!cancelled) setHistoryPanelLoading(false)
                }, Math.max(0, 320 - (performance.now() - startedAt)))
            })
        }, 120)
        return () => {
            cancelled = true
            window.clearTimeout(timer)
            window.clearTimeout(settleTimer)
        }
    }, [historyPanelOpen, historyPanelQuery])

    const recordHistory = useCallback((input: { url: string; title?: string | null; faviconUrl?: string | null; incrementVisit?: boolean }) => {
        if (Date.now() < suppressHistoryUntilRef.current || typeof window.devscope.recordBrowserHistory !== 'function') return
        void window.devscope.recordBrowserHistory(input).then((result) => {
            if (result.success && result.entry) {
                setBrowserHistory((current) => mergeAssistantBrowserHistoryEntry(current, result.entry!))
            }
        }).catch(() => undefined)
    }, [])

    const handleWebviewStateChange = useCallback((
        tabId: string,
        patch: Partial<Omit<AssistantBrowserTabState, 'id'>>,
        options?: { suppressHistory?: boolean }
    ) => {
        const previous = workspaceStateRef.current.tabs.find((tab) => tab.id === tabId)
        const incognito = previous?.sessionMode === 'incognito' || patch.sessionMode === 'incognito'
        const historyRecord = options?.suppressHistory || incognito ? null : resolveAssistantBrowserHistoryRecord(previous, patch)
        const profileReloadTransition = transitionAssistantBrowserProfileReloadHistory(
            profileReloadHistorySuppressionRef.current.get(tabId),
            patch.status,
            historyRecord
        )
        if (profileReloadTransition.nextPhase) {
            profileReloadHistorySuppressionRef.current.set(tabId, profileReloadTransition.nextPhase)
        } else {
            profileReloadHistorySuppressionRef.current.delete(tabId)
        }
        mutateWorkspaceState((current) => updateAssistantBrowserTab(current, tabId, patch))
        if (historyRecord && !profileReloadTransition.suppressRecord) recordHistory(historyRecord)
        if (annotationTabIdRef.current === tabId && (
            (patch.url !== undefined && patch.url !== previous?.url)
            || (patch.status === 'loading' && previous?.status !== 'loading')
            || patch.status === 'error'
        )) cancelAnnotation()
        if (tabId === workspaceStateRef.current.activeTabId && !addressFocusedRef.current && (patch.url !== undefined || patch.displayAddress !== undefined)) {
            const current = workspaceStateRef.current.tabs.find((tab) => tab.id === tabId)
            setAddressValue(patch.displayAddress || patch.url || browserTabAddress(current))
        }
    }, [cancelAnnotation, mutateWorkspaceState, recordHistory])

    useBackgroundBrowserState(workspaceState.tabs, mountedBrowserTabIdsRef, handleWebviewStateChange)

    const navigateActiveTab = useCallback(async (rawInput: string) => {
        const active = workspaceStateRef.current.tabs.find((tab) => tab.id === workspaceStateRef.current.activeTabId)
        if (active?.displayAddress && rawInput.trim() === active.displayAddress) {
            webviewRefs.current.get(active.id)?.reload()
            return
        }
        const target = normalizeAssistantBrowserNavigation(rawInput)
        if (!target.success) {
            setAddressError(target.error)
            return
        }
        const tabId = workspaceStateRef.current.activeTabId
        const handle = webviewRefs.current.get(tabId)
        if (annotationTabIdRef.current === tabId) cancelAnnotation()
        setAddressValue(target.url)
        setAddressError(null)
        if (!handle) {
            mutateWorkspaceState((current) => updateAssistantBrowserTab(current, tabId, {
                url: target.url,
                displayAddress: null,
                title: browserTabFallbackTitle(target.url),
                status: 'loading',
                error: null,
                faviconUrl: null
            }))
            pendingNavigationRef.current.set(tabId, target.url)
            return
        }
        try {
            await handle.navigate(target.url)
        } catch (error: unknown) {
            mutateWorkspaceState((current) => updateAssistantBrowserTab(current, tabId, {
                status: 'error',
                error: error instanceof Error ? error.message : 'The page could not be loaded.'
            }))
        }
    }, [cancelAnnotation, mutateWorkspaceState])

    const showNewTabInActiveTab = useCallback(async () => {
        const tabId = workspaceStateRef.current.activeTabId
        const tab = workspaceStateRef.current.tabs.find((candidate) => candidate.id === tabId)
        if (!tab) return
        if (annotationTabIdRef.current === tabId) cancelAnnotation()
        addressContainerRef.current?.querySelector<HTMLInputElement>('input')?.blur()
        addressFocusedRef.current = false
        setAddressFocused(false)
        setAddressError(null)
        setAddressValue('')
        setHistoryActiveIndex(-1)
        setProfileMenuOpen(false)
        setDownloadsPanelOpen(false)
        setHistoryPanelOpen(false)
        setBookmarksPanelOpen(false)
        setHistoryImportOpen(false)

        try {
            const browserHistoryState = await webviewRefs.current.get(tabId)?.showNewTab()
            mutateWorkspaceState((current) => updateAssistantBrowserTab(current, tabId, {
                url: '',
                viewport: { mode: 'fill' },
                displayAddress: null,
                title: 'New tab',
                status: 'idle',
                error: null,
                canGoBack: browserHistoryState?.canGoBack || false,
                canGoForward: browserHistoryState?.canGoForward || false,
                audible: false,
                faviconUrl: null,
                threatStatus: undefined
            }))
        } catch (error) {
            onDeveloperToast({ tone: 'error', message: error instanceof Error ? error.message : 'Could not return this Browser tab to New Tab.' })
        }
    }, [cancelAnnotation, mutateWorkspaceState, onDeveloperToast])

    const openLocalFileInTab = useCallback(async (tabId: string) => {
        const handle = webviewRefs.current.get(tabId)
        if (!handle) {
            onDeveloperToast({ tone: 'error', message: 'The Browser tab is still starting. Try opening the file again.' })
            return
        }
        try {
            if (annotationTabIdRef.current === tabId) cancelAnnotation()
            setAddressError(null)
            await handle.openLocalFile()
            setProfileMenuOpen(false)
        } catch (error) {
            onDeveloperToast({ tone: 'error', message: error instanceof Error ? error.message : 'The local file could not be opened.' })
        }
    }, [cancelAnnotation, onDeveloperToast])

    const installActiveWebStoreExtension = useCallback(async () => {
        const url = workspaceStateRef.current.tabs.find(tab => tab.id === workspaceStateRef.current.activeTabId)?.url || ''
        if (!isChromeWebStoreUrl(url)) return
        const review = await window.devscope.inspectBrowserExtensionFromWebStore(url)
        if (!review.success) {
            onDeveloperToast({ tone: 'error', message: review.error || 'Could not download this Chrome Web Store extension.' })
            return
        }
        const permissions = [...review.extension.permissions, ...review.extension.hostPermissions]
        const approved = window.confirm(`Install ${review.extension.name} v${review.extension.version} in Zyra Browser?\n\n${permissions.length > 0 ? `Requested permissions:\n${permissions.join(', ')}` : 'This extension declares no permissions.'}\n\n${review.extension.warnings.length ? review.extension.warnings.join('\n') + '\n\n' : ''}Only approve extensions you trust. Some Chrome APIs may not work in Zyra.`)
        if (!approved) {
            await window.devscope.discardBrowserExtensionFromWebStore(review.extension.id).catch(() => undefined)
            onDeveloperToast({ message: `${review.extension.name} was not kept.` })
            return
        }
        const result = await window.devscope.approveBrowserExtensionFromWebStore(review.extension.id)
        if (!result.success) {
            onDeveloperToast({ tone: 'error', message: result.error || 'Could not install the approved extension.' })
            return
        }
        onDeveloperToast({ message: `${result.extension.name} is installed in Zyra Browser.` })
    }, [onDeveloperToast])

    const navigateHistorySuggestion = useCallback((url: string) => {
        addressContainerRef.current?.querySelector<HTMLInputElement>('input')?.blur()
        addressFocusedRef.current = false
        setAddressFocused(false)
        setHistoryActiveIndex(-1)
        void navigateActiveTab(url)
    }, [navigateActiveTab])

    const createTab = useCallback((url = '', options?: { activate?: boolean; tabId?: string; sessionMode?: BrowserSessionMode }) => {
        const activate = options?.activate !== false
        const requestedTabId = options?.tabId
        const sessionMode = options?.sessionMode || defaultSessionMode
        if (requestedTabId && workspaceStateRef.current.tabs.some((tab) => tab.id === requestedTabId)) {
            if (activate) transitionToBrowserTab(requestedTabId)
            return requestedTabId
        }
        const tabId = requestedTabId && /^browser:[a-zA-Z0-9][a-zA-Z0-9:._-]{0,127}$/.test(requestedTabId)
            ? requestedTabId
            : `${tabIdPrefix}:${tabSequenceRef.current++}`
        if (activate) onRequestTabSelection(tabId)
        mutateWorkspaceState((current) => addAssistantBrowserTab(current, tabId, url, activate, sessionMode))
        if (activate) {
            setAddressValue(url)
            setAddressError(null)
        }
        return tabId
    }, [defaultSessionMode, mutateWorkspaceState, onDeveloperToast, onRequestTabSelection, tabIdPrefix, transitionToBrowserTab])

    useEffect(() => {
        if (!config || !navigationRequest || consumedNavigationRequestsRef.current.has(navigationRequest.id)) return
        consumedNavigationRequestsRef.current.add(navigationRequest.id)
        if (consumedNavigationRequestsRef.current.size > 100) {
            const oldestRequestId = consumedNavigationRequestsRef.current.values().next().value
            if (oldestRequestId !== undefined) consumedNavigationRequestsRef.current.delete(oldestRequestId)
        }
        mutateWorkspaceState((current) => ensureAssistantBrowserWorkspaceTab(
            current,
            navigationRequest.tabId,
            navigationRequest.sessionMode
        ))
        transitionToBrowserTab(navigationRequest.tabId)
        if (!navigationRequest.url) {
            onNavigationRequestHandled(navigationRequest.id)
            return
        }
        void navigateActiveTab(navigationRequest.url).finally(() => {
            onNavigationRequestHandled(navigationRequest.id)
        })
    }, [config, mutateWorkspaceState, navigateActiveTab, navigationRequest, onNavigationRequestHandled, transitionToBrowserTab])

    const closeTab = useCallback((tabId: string, options?: { transferred?: boolean }): AssistantBrowserWorkspaceState => {
        const transferred = options?.transferred === true
        const closingTab = workspaceStateRef.current.tabs.find((tab) => tab.id === tabId)
        if (!closingTab) return workspaceStateRef.current
        forgetBrowserViewState(tabId)
        addressFocusedRef.current = false
        setAddressFocused(false)
        addressContainerRef.current?.querySelector<HTMLInputElement>('input')?.blur()
        if (!transferred && closingTab.url && closingTab.sessionMode === 'normal' && !isBrowserLocalFileUrl(closingTab.url)) {
            closedTabsRef.current = [...closedTabsRef.current.slice(-9), closingTab]
        }
        const closingHandle = webviewRefs.current.get(tabId)
        closingHandle?.blur()
        if (!transferred) void window.devscope.browserView.close(tabId).catch(() => undefined)
        if (fullscreenTabIdRef.current === tabId) {
            fullscreenTabIdRef.current = null
            setFullscreenTabId(null)
            window.devscope.window.setFullScreen(false)
        }
        if (annotationTabIdRef.current === tabId) {
            if (transferred) {
                annotationTabIdRef.current = null
                setAnnotationTabId(null)
            } else {
                cancelAnnotation()
            }
        }
        if (!transferred && closingHandle && recordingTabId === tabId) {
            try {
                const target = closingHandle.getDeveloperTarget()
                // The persistent recorder host owns saved/error recovery after tab closure.
                void stopAssistantBrowserRecording(target).catch(() => {})
            } catch (error) {
                onDeveloperToast({ tone: 'error', message: error instanceof Error ? error.message : 'Could not stop the closing Browser recording.' })
            }
        }
        webviewRefs.current.delete(tabId)
        webviewRefCallbacks.current.delete(tabId)
        profileReloadHistorySuppressionRef.current.delete(tabId)
        pendingNavigationRef.current.delete(tabId)
        const replacementTabId = `${tabIdPrefix}:${tabSequenceRef.current++}`
        let nextState = workspaceStateRef.current
        mutateWorkspaceState((current) => {
            nextState = closeAssistantBrowserTab(current, tabId, replacementTabId, defaultSessionMode)
            return nextState
        })
        const nextActiveTab = nextState.tabs.find((tab) => tab.id === nextState.activeTabId)
        setAddressValue(browserTabAddress(nextActiveTab))
        return nextState
    }, [cancelAnnotation, defaultSessionMode, mutateWorkspaceState, onDeveloperToast, recordingTabId, tabIdPrefix])

    const activateTab = transitionToBrowserTab

    const selectBrowserTab = useCallback((tabId: string) => {
        if (!workspaceStateRef.current.tabs.some((tab) => tab.id === tabId)) return
        onRequestTabSelection(tabId)
        activateTab(tabId)
    }, [activateTab, onRequestTabSelection])

    const findTabIdByGuestWebContentsId = useCallback((guestWebContentsId: number): string | null => {
        for (const [tabId, handle] of webviewRefs.current) {
            try {
                if (handle.getDeveloperTarget().guestWebContentsId === guestWebContentsId) return tabId
            } catch {
                // A guest can detach between the main event and renderer lookup.
            }
        }
        return null
    }, [])

    const dismissThreatWarning = useCallback(async () => {
        const current = threatWarning
        if (!current || threatActionBusy) return
        setThreatActionBusy(true)
        setThreatActionError(null)
        try {
            await window.devscope.dismissBrowserThreatWarning(current.warning.decisionId).catch(() => undefined)
            if (current.warning.navigationKind === 'current-tab') {
                const tab = workspaceStateRef.current.tabs.find((candidate) => candidate.id === current.tabId)
                if (tab?.url === current.warning.url) {
                    const previousUrl = current.warning.previousUrl === 'about:blank' ? '' : current.warning.previousUrl
                    mutateWorkspaceState((state) => updateAssistantBrowserTab(state, current.tabId, {
                        url: previousUrl,
                        title: previousUrl ? browserTabFallbackTitle(previousUrl) : 'New tab',
                        status: previousUrl ? 'ready' : 'idle',
                        error: null,
                        faviconUrl: previousUrl ? tab.faviconUrl : null
                    }))
                }
                const restored = workspaceStateRef.current.tabs.find((candidate) => candidate.id === current.tabId)
                if (restored) setAddressValue(restored.url)
            }
            setThreatWarning(null)
        } finally {
            setThreatActionBusy(false)
        }
    }, [mutateWorkspaceState, threatActionBusy, threatWarning])

    const proceedThroughThreatWarning = useCallback(async () => {
        const current = threatWarning
        if (!current || threatActionBusy) return
        setThreatActionBusy(true)
        setThreatActionError(null)
        try {
            const result = await window.devscope.proceedBrowserThreatWarning(current.warning.decisionId)
            if (!result.success) throw new Error(result.error)
            if (current.warning.navigationKind === 'current-tab') {
                mutateWorkspaceState((state) => updateAssistantBrowserTab(state, current.tabId, {
                    url: current.warning.url,
                    displayAddress: null,
                    title: browserTabFallbackTitle(current.warning.url),
                    status: 'loading',
                    error: null,
                    faviconUrl: null
                }))
                setAddressValue(current.warning.url)
            }
            setThreatWarning(null)
        } catch (error) {
            setThreatActionError(error instanceof Error ? error.message : 'The page could not be opened.')
        } finally {
            setThreatActionBusy(false)
        }
    }, [mutateWorkspaceState, threatActionBusy, threatWarning])

    const executeBrowserShortcut = useCallback((action: BrowserShortcutAction, sourceTabId: string) => {
        const state = workspaceStateRef.current
        const sourceIndex = state.tabs.findIndex((tab) => tab.id === sourceTabId)
        if (sourceIndex < 0) return
        const sourceHandle = webviewRefs.current.get(sourceTabId)
        if (action.type === 'new-tab') {
            createTab('', { sessionMode: state.tabs[sourceIndex].sessionMode })
            return
        }
        if (action.type === 'close-tab') {
            const next = closeTab(sourceTabId)
            if (next.activeTabId) onRequestTabSelection(next.activeTabId)
            return
        }
        if (action.type === 'reopen-closed-tab') {
            const closedTab = closedTabsRef.current.at(-1)
            if (!closedTab?.url) return
            closedTabsRef.current.pop()
            createTab(closedTab.url)
            return
        }
        if (action.type === 'focus-address') {
            selectBrowserTab(sourceTabId)
            window.requestAnimationFrame(() => {
                addressContainerRef.current?.querySelector<HTMLInputElement>('input')?.focus()
            })
            return
        }
        if (action.type === 'open-file') {
            void openLocalFileInTab(sourceTabId)
            return
        }
        if (action.type === 'devtools') {
            if (!sourceHandle) return
            try {
                if (annotationTabIdRef.current === sourceTabId) cancelAnnotation()
                void window.devscope.openBrowserPreviewDevTools({ ...sourceHandle.getDeveloperTarget(), mode: 'docked' }).then(result => {
                    if (!result.success) onDeveloperToast({ tone: 'error', message: result.error || 'Could not open Browser DevTools.' })
                }).catch(error => onDeveloperToast({ tone: 'error', message: error instanceof Error ? error.message : 'Could not open Browser DevTools.' }))
            } catch (error) {
                onDeveloperToast({ tone: 'error', message: error instanceof Error ? error.message : 'Browser view is not ready yet.' })
            }
            return
        }
        if (action.type === 'reload') {
            if (!sourceHandle) return
            if (action.bypassCache) {
                try {
                    void window.devscope.hardReloadBrowserPreview(sourceHandle.getDeveloperTarget())
                } catch {
                    sourceHandle.reload()
                }
            } else {
                sourceHandle.reload()
            }
            return
        }
        if (action.type === 'back') {
            sourceHandle?.goBack()
            return
        }
        if (action.type === 'forward') {
            sourceHandle?.goForward()
            return
        }
        if (action.type === 'next-tab' || action.type === 'previous-tab') {
            const offset = action.type === 'next-tab' ? 1 : -1
            const nextIndex = (sourceIndex + offset + state.tabs.length) % state.tabs.length
            const nextTab = state.tabs[nextIndex]
            if (nextTab) selectBrowserTab(nextTab.id)
            return
        }
        if (action.type === 'toggle-fullscreen') {
            const enabled = fullscreenTabIdRef.current !== sourceTabId
            fullscreenTabIdRef.current = enabled ? sourceTabId : null
            setFullscreenTabId(enabled ? sourceTabId : null)
            if (enabled) selectBrowserTab(sourceTabId)
            window.devscope.window.setFullScreen(enabled)
            return
        }
        const targetIndex = action.index === 'last'
            ? state.tabs.length - 1
            : Math.min(action.index, state.tabs.length - 1)
        const targetTab = state.tabs[targetIndex]
        if (targetTab) selectBrowserTab(targetTab.id)
    }, [cancelAnnotation, closeTab, createTab, onDeveloperToast, onRequestTabSelection, openLocalFileInTab, selectBrowserTab])

    const reorderTabs = useCallback((tabIds: string[]) => {
        mutateWorkspaceState(current => {
            const tabs = reorderBrowserTabs(current.tabs, tabIds)
            return tabs === current.tabs ? current : { ...current, tabs }
        })
    }, [mutateWorkspaceState])

    const controller = useMemo<AssistantBrowserWorkspaceController>(() => ({
        createTab,
        closeTab,
        activateTab,
        reorderTabs
    }), [activateTab, closeTab, createTab, reorderTabs])

    useEffect(() => {
        onControllerChange(controller)
        return () => onControllerChange(null)
    }, [controller, onControllerChange])

    useEffect(() => {
        if (typeof window.devscope.onBrowserOpenTabRequested !== 'function' || typeof window.devscope.onBrowserShortcut !== 'function') return
        const unsubscribeOpenTab = window.devscope.onBrowserOpenTabRequested((request: DevScopeBrowserOpenTabRequest) => {
            const sourceTabId = findTabIdByGuestWebContentsId(request.sourceGuestWebContentsId)
            if (!sourceTabId) return
            const sessionMode = workspaceStateRef.current.tabs.find((tab) => tab.id === sourceTabId)?.sessionMode || 'normal'
            createTab(request.url, { activate: request.activate, sessionMode })
        })
        const unsubscribeShortcut = window.devscope.onBrowserShortcut((event: DevScopeBrowserShortcutEvent) => {
            const sourceTabId = findTabIdByGuestWebContentsId(event.sourceGuestWebContentsId)
            if (sourceTabId) executeBrowserShortcut(event.action, sourceTabId)
        })
        return () => {
            unsubscribeOpenTab()
            unsubscribeShortcut()
        }
    }, [createTab, executeBrowserShortcut, findTabIdByGuestWebContentsId])

    useEffect(() => {
        if (typeof window.devscope.onBrowserThreatBlocked !== 'function') return
        return window.devscope.onBrowserThreatBlocked((warning) => {
            const tabId = findTabIdByGuestWebContentsId(warning.sourceGuestWebContentsId)
            // Other Browser surfaces in this shell own their own warnings.
            if (!tabId) return
            setThreatWarning((current) => {
                if (current && current.warning.decisionId !== warning.decisionId) {
                    void window.devscope.dismissBrowserThreatWarning(current.warning.decisionId).catch(() => undefined)
                }
                return { tabId, warning }
            })
            setThreatActionBusy(false)
            setThreatActionError(null)
            setAddressValue(warning.url)
            onRequestTabSelection(tabId)
            transitionToBrowserTab(tabId)
        })
    }, [findTabIdByGuestWebContentsId, onRequestTabSelection, transitionToBrowserTab])

    useEffect(() => {
        if (!threatWarning) return
        if (workspaceState.tabs.some((tab) => tab.id === threatWarning.tabId)) return
        void window.devscope.dismissBrowserThreatWarning(threatWarning.warning.decisionId).catch(() => undefined)
        setThreatWarning(null)
        setThreatActionBusy(false)
        setThreatActionError(null)
    }, [threatWarning, workspaceState.tabs])

    useEffect(() => {
        if (active || !fullscreenTabIdRef.current) return
        fullscreenTabIdRef.current = null
        setFullscreenTabId(null)
        window.devscope.window.setFullScreen(false)
    }, [active])

    useEffect(() => {
        if (typeof window.devscope.window.onFullScreenChange !== 'function') return
        return window.devscope.window.onFullScreenChange((fullscreen) => {
            if (!fullscreen) {
                fullscreenTabIdRef.current = null
                setFullscreenTabId(null)
            }
        })
    }, [])

    useEffect(() => {
        if (!active) return
        const handleBrowserShortcut = (event: KeyboardEvent) => {
            if (event.defaultPrevented || isShortcutRecording() || isProtectedShortcutTarget(event) || !isBrowserShortcutContext(event)) return
            const localCommand = resolveShortcut(keyboardInput(event), rendererBrowserShortcutPlatform(), 'browser')
            if (localCommand === 'browser.history' || localCommand === 'browser.downloads' || localCommand === 'browser.screenshot') {
                event.preventDefault()
                event.stopPropagation()
                if (localCommand === 'browser.history') { setDownloadsPanelOpen(false); setBookmarksPanelOpen(false); setHistoryPanelQuery(''); setHistoryPanelOpen(true) }
                else if (localCommand === 'browser.downloads') { setHistoryPanelOpen(false); setBookmarksPanelOpen(false); setDownloadsPanelOpen(true) }
                else void captureActiveScreenshotRef.current()
                return
            }
            if (browserFullscreen && event.key === 'Escape') {
                event.preventDefault()
                fullscreenTabIdRef.current = null
                setFullscreenTabId(null)
                window.devscope.window.setFullScreen(false)
                return
            }
            const action = resolveBrowserShortcut(keyboardInput(event), rendererBrowserShortcutPlatform())
            if (!action) {
                // Clearing/rebinding also disables Chromium's original reload/close keys.
                if (!resolveShortcut(keyboardInput(event), rendererBrowserShortcutPlatform(), 'app') && resolveBrowserShortcut(keyboardInput(event), rendererBrowserShortcutPlatform(), {})) { event.preventDefault(); event.stopPropagation() }
                return
            }
            event.preventDefault()
            event.stopPropagation()
            executeBrowserShortcut(action, workspaceStateRef.current.activeTabId)
        }
        const removeOverlayListener3 = addOverlayEventListener('keydown', handleBrowserShortcut, true)
        return () => removeOverlayListener3()
    }, [active, browserFullscreen, executeBrowserShortcut])

    const getWebviewRefCallback = useCallback((tabId: string) => {
        const existing = webviewRefCallbacks.current.get(tabId)
        if (existing) return existing
        const callback = (handle: AssistantBrowserWebviewHandle | null) => {
            if (!handle) {
                webviewRefs.current.delete(tabId)
                return
            }
            webviewRefs.current.set(tabId, handle)
            const pendingUrl = pendingNavigationRef.current.get(tabId)
            if (!pendingUrl) return
            pendingNavigationRef.current.delete(tabId)
            void handle.navigate(pendingUrl).catch((error: unknown) => {
                mutateWorkspaceState((current) => updateAssistantBrowserTab(current, tabId, {
                    status: 'error',
                    error: error instanceof Error ? error.message : 'The page could not be loaded.'
                }))
            })
        }
        webviewRefCallbacks.current.set(tabId, callback)
        return callback
    }, [mutateWorkspaceState])

    useEffect(() => {
        if (!chatIntegration || !surfaceRequest || consumedSurfaceRequestsRef.current.has(surfaceRequest.requestId) || cancelledSurfaceRequestsRef.current.has(surfaceRequest.requestId)) return
        if (surfaceRequest.threadId !== threadId) {
            failSurfaceRequest(surfaceRequest, 'The Browser surface request belongs to another chat thread.')
            return
        }
        const mode = surfaceRequest.mode || 'open'
        const knownTargetId = controlTargetsByTabRef.current[surfaceRequest.tabId]
        const knownSecondaryTargetId = surfaceRequest.secondaryTabId
            ? controlTargetsByTabRef.current[surfaceRequest.secondaryTabId]
            : undefined
        if (surfaceRequest.targetId && !knownTargetId) return
        if (surfaceRequest.secondaryTargetId && !knownSecondaryTargetId) return
        consumedSurfaceRequestsRef.current.add(surfaceRequest.requestId)
        if (consumedSurfaceRequestsRef.current.size > 100) {
            const oldest = consumedSurfaceRequestsRef.current.values().next().value
            if (oldest) consumedSurfaceRequestsRef.current.delete(oldest)
        }
        if (surfaceRequest.targetId && knownTargetId !== surfaceRequest.targetId) {
            failSurfaceRequest(surfaceRequest, 'The selected Browser tab no longer matches its trusted target.')
            return
        }
        if (surfaceRequest.secondaryTargetId && knownSecondaryTargetId !== surfaceRequest.secondaryTargetId) {
            failSurfaceRequest(surfaceRequest, 'The secondary Browser tab no longer matches its trusted target.')
            return
        }
        if (!normalizedProjectPath) {
            failSurfaceRequest(surfaceRequest, 'Attach a project to this chat before using the in-app Browser.')
            return
        }
        if (configError) {
            failSurfaceRequest(surfaceRequest, configError)
            return
        }
        const complete = (success: true | false, error?: string) => window.devscope.agentControl.completeBrowserSurfaceRequest({
            requestId: surfaceRequest.requestId,
            threadId: surfaceRequest.threadId,
            tabId: surfaceRequest.tabId,
            ...(success ? { success: true as const, targetId: knownTargetId! } : { success: false as const, error: error || 'Browser command failed.' })
        })

        if (mode === 'close' || mode === 'refresh' || mode === 'navigate' || mode === 'external') {
            if (!knownTargetId) {
                failSurfaceRequest(surfaceRequest, 'The selected Browser tab is no longer registered.')
                return
            }
            void (async () => {
                try {
                    if (cancelledSurfaceRequestsRef.current.has(surfaceRequest.requestId)) return
                    const claim = await window.devscope.agentControl.claimBrowserSurfaceRequest({
                        requestId: surfaceRequest.requestId,
                        threadId: surfaceRequest.threadId,
                        tabId: surfaceRequest.tabId
                    })
                    if (!claim.success) throw new Error(claim.error || 'The Browser command was cancelled before it started.')
                    if (!claim.claimed) throw new Error('The Browser command was cancelled before it started.')
                    if (mode === 'external') {
                        const url = surfaceRequest.url || workspaceStateRef.current.tabs.find((tab) => tab.id === surfaceRequest.tabId)?.url || ''
                        const result = await window.devscope.openBrowserPreviewExternal(url)
                        if (!result.success) throw new Error(result.error || 'Could not open the default browser.')
                    } else if (mode !== 'close') {
                        const handle = webviewRefs.current.get(surfaceRequest.tabId)
                        if (!handle) throw new Error('The selected Browser view is not ready.')
                        if (mode === 'navigate') {
                            if (!surfaceRequest.url) throw new Error('The Browser navigation URL is missing.')
                            await handle.navigate(surfaceRequest.url)
                        } else {
                            handle.reload()
                        }
                    }
                    if (mode === 'close') {
                        closeTab(surfaceRequest.tabId)
                        if (workspaceStateRef.current.tabs.some((tab) => tab.id === surfaceRequest.tabId)) {
                            throw new Error('The selected Browser tab did not leave the retained workspace.')
                        }
                    }
                    const result = await complete(true)
                    if (!result.success) throw new Error(result.error || 'Could not finish the Browser command.')
                } catch (error) {
                    await complete(false, error instanceof Error ? error.message : 'Browser command failed.')
                } finally {
                    onSurfaceRequestHandledRef.current(surfaceRequest.requestId)
                }
            })()
            return
        }

        const requestedTabIds = [surfaceRequest.tabId, surfaceRequest.secondaryTabId]
            .filter((tabId): tabId is string => Boolean(tabId))
        const requestedState = ensureAssistantBrowserSurfaceTabs(
            workspaceStateRef.current,
            surfaceRequest.tabId,
            surfaceRequest.secondaryTabId || null,
            mode === 'open' ? surfaceRequest.sessionMode || 'normal' : 'normal'
        )
        if (requestedTabIds.some((tabId) => !requestedState.tabs.some((tab) => tab.id === tabId))) {
            failSurfaceRequest(surfaceRequest, 'The requested Browser tabs could not be opened.')
            return
        }
        mutateWorkspaceState(() => requestedState)
        transitionToBrowserTab(surfaceRequest.tabId)
        if (knownTargetId) {
            void complete(true).finally(() => onSurfaceRequestHandledRef.current(surfaceRequest.requestId))
        } else {
            pendingSurfaceRequestsRef.current.set(surfaceRequest.requestId, surfaceRequest)
        }
    }, [chatIntegration, closeTab, configError, controlTargetsByTab, failSurfaceRequest, mutateWorkspaceState, normalizedProjectPath, surfaceRequest, threadId, transitionToBrowserTab])

    const getActiveDeveloperTarget = useCallback(() => {
        const tabId = workspaceStateRef.current.activeTabId
        const handle = webviewRefs.current.get(tabId)
        if (!handle) throw new Error('Browser view is not ready yet.')
        return { tabId, handle, target: handle.getDeveloperTarget() }
    }, [])

    const updateActiveViewport = useCallback((viewport: AssistantBrowserTabState['viewport']) => {
        const tabId = workspaceStateRef.current.activeTabId
        mutateWorkspaceState((current) => updateAssistantBrowserTab(current, tabId, { viewport }))
    }, [mutateWorkspaceState])

    const updateActiveZoom = useCallback(async (requested: number) => {
        try {
            const { tabId, target } = getActiveDeveloperTarget()
            const factor = normalizeAssistantBrowserZoom(requested)
            const result = await window.devscope.setBrowserPreviewZoom({ ...target, factor })
            if (!result.success) throw new Error(result.error || 'Could not change Browser zoom.')
            mutateWorkspaceState((current) => updateAssistantBrowserTab(current, tabId, { zoomFactor: result.factor }))
        } catch (error) {
            onDeveloperToast({ tone: 'error', message: error instanceof Error ? error.message : 'Could not change Browser zoom.' })
        }
    }, [getActiveDeveloperTarget, mutateWorkspaceState, onDeveloperToast])

    const updateActiveColorScheme = useCallback(async (colorScheme: DevScopeBrowserColorScheme) => {
        try {
            const { tabId, target } = getActiveDeveloperTarget()
            const result = await window.devscope.setBrowserPreviewColorScheme({ ...target, colorScheme })
            if (!result.success) throw new Error(result.error || 'Could not emulate the Browser color scheme.')
            mutateWorkspaceState((current) => updateAssistantBrowserTab(current, tabId, { colorScheme }))
            onDeveloperToast({ message: colorScheme === 'system' ? 'Page appearance follows the system.' : `Page appearance is ${colorScheme}.` })
            setProfileMenuOpen(false)
            window.requestAnimationFrame(() => profileMenuRef.current?.querySelector<HTMLButtonElement>(':scope > button')?.focus())
        } catch (error) {
            onDeveloperToast({ tone: 'error', message: error instanceof Error ? error.message : 'Could not emulate the Browser color scheme.' })
        }
    }, [getActiveDeveloperTarget, mutateWorkspaceState, onDeveloperToast])

    useEffect(() => {
        if (!activeTab || !controlTargetsByTab[activeTab.id]) return
        const handle = webviewRefs.current.get(activeTab.id)
        if (!handle) return
        let cancelled = false
        try {
            const target = handle.getDeveloperTarget()
            void Promise.all([
                window.devscope.setBrowserPreviewZoom({ ...target, factor: activeTab.zoomFactor }),
                window.devscope.setBrowserPreviewColorScheme({ ...target, colorScheme: activeTab.colorScheme })
            ]).then((results) => {
                if (cancelled) return
                const failure = results.find((result) => !result.success)
                if (failure && !failure.success) onDeveloperToast({ tone: 'error', message: failure.error })
            })
        } catch {
            // The bound target can arrive one layout pass before the webview handle.
        }
        return () => {
            cancelled = true
        }
    }, [activeTab?.colorScheme, activeTab?.id, activeTab?.zoomFactor, controlTargetsByTab, onDeveloperToast])

    const hardReloadActiveTab = useCallback(async () => {
        try {
            const { tabId, target } = getActiveDeveloperTarget()
            if (annotationTabIdRef.current === tabId) cancelAnnotation()
            const result = await window.devscope.hardReloadBrowserPreview(target)
            if (!result.success) throw new Error(result.error || 'Could not hard reload the Browser tab.')
            mutateWorkspaceState((current) => updateAssistantBrowserTab(current, tabId, { status: 'loading', error: null }))
            onDeveloperToast({ message: 'Hard reload started with cache bypassed.' })
            setProfileMenuOpen(false)
        } catch (error) {
            onDeveloperToast({ tone: 'error', message: error instanceof Error ? error.message : 'Could not hard reload the Browser tab.' })
        }
    }, [cancelAnnotation, getActiveDeveloperTarget, mutateWorkspaceState, onDeveloperToast])

    const openActiveDevTools = useCallback(async (mode: 'docked' | 'popout' = 'docked') => {
        try {
            const { tabId, target } = getActiveDeveloperTarget()
            if (annotationTabIdRef.current === tabId) cancelAnnotation()
            const result = await window.devscope.openBrowserPreviewDevTools({ ...target, mode })
            if (!result.success) throw new Error(result.error || 'Could not open Browser DevTools.')
            setProfileMenuOpen(false)
        } catch (error) {
            onDeveloperToast({ tone: 'error', message: error instanceof Error ? error.message : 'Could not open Browser DevTools.' })
        }
    }, [cancelAnnotation, getActiveDeveloperTarget, onDeveloperToast])

    const captureActiveScreenshot = useCallback(async () => {
        if (!browserToolsEnabled) return
        try {
            const { target } = getActiveDeveloperTarget()
            const result = await window.devscope.captureBrowserPreviewScreenshot(target)
            if (!result.success) throw new Error(result.error || 'Could not capture the Browser tab.')
            onDeveloperToast({ message: '', artifact: result.artifact, captureSessionId: captureChatId })
        } catch (error) {
            onDeveloperToast({ tone: 'error', message: error instanceof Error ? error.message : 'Could not capture the Browser tab.' })
        }
    }, [browserToolsEnabled, captureChatId, getActiveDeveloperTarget, onDeveloperToast])
    captureActiveScreenshotRef.current = captureActiveScreenshot
    useEffect(() => {
        if (!active) return
        const run = (event: Event) => {
            const id = (event as CustomEvent<CommandId>).detail
            if (id === 'browser.history') { setDownloadsPanelOpen(false); setBookmarksPanelOpen(false); setHistoryPanelQuery(''); setHistoryPanelOpen(true); return }
            if (id === 'browser.downloads') { setHistoryPanelOpen(false); setBookmarksPanelOpen(false); setDownloadsPanelOpen(true); return }
            if (id === 'browser.screenshot') { void captureActiveScreenshot(); return }
            const command = COMMANDS.find(command => command.id === id)
            if (command?.scope === 'browser' && 'action' in command && command.action && workspaceStateRef.current.activeTabId) executeBrowserShortcut(command.action, workspaceStateRef.current.activeTabId)
        }
        window.addEventListener('zyra:run-scoped-command', run)
        return () => window.removeEventListener('zyra:run-scoped-command', run)
    }, [active, captureActiveScreenshot, executeBrowserShortcut])

    const toggleAnnotation = useCallback(async () => {
        if (!browserToolsEnabled) return
        if (annotationTabIdRef.current) {
            cancelAnnotation()
            return
        }
        let tabId: string | null = null
        try {
            const activeDeveloper = getActiveDeveloperTarget()
            tabId = activeDeveloper.tabId
            annotationTabIdRef.current = tabId
            setAnnotationTabId(tabId)
            const result = await window.devscope.startBrowserPreviewAnnotation({
                ...activeDeveloper.target,
                theme: readBrowserAnnotationTheme(),
                standalone: !chatIntegration
            })
            if (!result.success) throw new Error(result.error || 'Could not annotate the Browser tab.')
            if (result.annotation && result.artifact) {
                const attached = await window.devscope.attachBrowserCaptureToChat({ artifactId: result.artifact.artifactId, sessionId: captureChatId, annotation: result.annotation })
                if (!attached.success) throw new Error(attached.error || 'Could not attach the Browser selection.')
            }
        } catch (error) {
            if (tabId && annotationTabIdRef.current !== tabId) return
            onDeveloperToast({ tone: 'error', message: error instanceof Error ? error.message : 'Could not annotate the Browser tab.' })
        } finally {
            if (tabId && annotationTabIdRef.current === tabId) {
                annotationTabIdRef.current = null
                setAnnotationTabId(null)
            }
        }
    }, [browserToolsEnabled, cancelAnnotation, captureChatId, chatIntegration, getActiveDeveloperTarget, onDeveloperToast])

    const toggleActiveRecording = useCallback(async () => {
        if (!browserToolsEnabled && !recordingTabId) return
        try {
            setProfileMenuOpen(false)
            const { tabId, target, handle } = getActiveDeveloperTarget()
            if (annotationTabIdRef.current === tabId) cancelAnnotation()
            if (recordingTabId) {
                if (recordingTabId !== tabId) throw new Error('Another Browser tab is already recording.')
                await stopAssistantBrowserRecording(target)
                return
            }
            prepareAssistantBrowserRecording(target, handle.getViewportSize(), { sessionId: captureChatId, enabled: browserToolsEnabled })
        } catch (error) {
            if (!readAssistantBrowserRecording().error) {
                onDeveloperToast({ tone: 'error', message: error instanceof Error ? error.message : 'Could not change Browser recording state.' })
            }
        }
    }, [browserToolsEnabled, cancelAnnotation, captureChatId, getActiveDeveloperTarget, onDeveloperToast, recordingTabId])

    const keepAdBlockingOff = useCallback(async () => {
        if (adBlockEnabling) return
        setAdBlockEnabling(true)
        setAdBlockError(null)
        try {
            const result = await window.devscope.setBrowserAdBlockEnabled({ enabled: false, promptDismissed: true })
            if (!result.success) throw new Error(result.error || 'Could not keep built-in ad blocking off.')
            setAdBlockPrompt(null)
        } catch (error) {
            setAdBlockError(error instanceof Error ? error.message : 'Could not keep built-in ad blocking off.')
        } finally {
            setAdBlockEnabling(false)
        }
    }, [adBlockEnabling])

    const enableAdBlocking = useCallback(async () => {
        if (!adBlockPrompt || adBlockEnabling) return
        setAdBlockEnabling(true)
        setAdBlockError(null)
        try {
            if (typeof window.devscope.setBrowserAdBlockEnabled !== 'function') throw new Error('Restart Zyra Desktop to load built-in ad blocking.')
            const result = await window.devscope.setBrowserAdBlockEnabled({ enabled: true, promptDismissed: true })
            if (!result.success) throw new Error(result.error || 'Built-in ad blocking could not be enabled.')
            const handle = webviewRefs.current.get(adBlockPrompt.tabId)
            setAdBlockPrompt(null)
            handle?.reload()
        } catch (error) {
            setAdBlockError(error instanceof Error ? error.message : 'Built-in ad blocking could not be enabled.')
        } finally {
            setAdBlockEnabling(false)
        }
    }, [adBlockEnabling, adBlockPrompt])

    const clearBrowserCache = useCallback(async () => {
        const result = await window.devscope.clearBrowserPreviewCache()
        onDeveloperToast(result.success
            ? { message: 'Integrated Browser cache cleared.' }
            : { tone: 'error', message: result.error || 'Could not clear the Browser cache.' })
        if (result.success) setProfileMenuOpen(false)
    }, [onDeveloperToast])

    const clearBrowserCookies = useCallback(async () => {
        if (!siteSignOutArmed) {
            setSiteSignOutArmed(true)
            setHistoryClearArmed(false)
            setClearProfileArmed(false)
            setProfileNotice({ tone: 'info', message: 'Click again to sign out of websites. History and cached files will stay.' })
            return
        }
        const result = await window.devscope.clearBrowserPreviewCookies()
        onDeveloperToast(result.success
            ? { message: 'Website sign-ins cleared from the local Browser profile.' }
            : { tone: 'error', message: result.error || 'Could not clear website sign-ins.' })
        if (result.success) {
            for (const handle of webviewRefs.current.values()) handle.reload()
            setSiteSignOutArmed(false)
            setProfileMenuOpen(false)
        }
    }, [onDeveloperToast, siteSignOutArmed])

    const openExternal = useCallback(async () => {
        if (!activeTab?.url || isBrowserLocalFileUrl(activeTab.url)) return
        const result = await window.devscope.openBrowserPreviewExternal(activeTab.url)
        if (!result.success) setAddressError(result.error || 'Could not open the page externally.')
    }, [activeTab?.url])

    const clearHistory = useCallback(async () => {
        if (!historyClearArmed) {
            setHistoryClearArmed(true)
            setClearProfileArmed(false)
            setSiteSignOutArmed(false)
            setProfileNotice({ tone: 'info', message: 'Click again to clear Zyra Browser history. Cookies and site data will stay.' })
            return
        }
        try {
            const result = await window.devscope.clearBrowserHistory()
            if (!result.success) {
                onDeveloperToast({ tone: 'error', message: result.error || 'Could not clear Browser history.' })
                return
            }
            setBrowserHistory([])
            clearOmniboxSuggestions()
            setHistoryClearArmed(false)
            setProfileMenuOpen(false)
            onDeveloperToast({ message: 'Zyra Browser history cleared.' })
        } catch (error: unknown) {
            onDeveloperToast({ tone: 'error', message: error instanceof Error ? error.message : 'Could not clear Browser history.' })
        }
    }, [historyClearArmed, onDeveloperToast, clearOmniboxSuggestions])

    const clearHistoryFromPanel = useCallback(async () => {
        if (!window.confirm('Clear visited addresses and omnibox suggestions from Zyra Browser?')) return
        try {
            const result = await window.devscope.clearBrowserHistory()
            if (!result.success) throw new Error(result.error || 'Could not clear Browser history.')
            setBrowserHistory([])
            clearOmniboxSuggestions()
            setHistoryPanelSearch({ query: '', entries: [] })
            setHistoryPanelQuery('')
            onDeveloperToast({ message: 'Zyra Browser history cleared.' })
        } catch (error: unknown) {
            onDeveloperToast({ tone: 'error', message: error instanceof Error ? error.message : 'Could not clear Browser history.' })
        }
    }, [onDeveloperToast, clearOmniboxSuggestions])

    const clearLocalBrowserProfile = useCallback(async () => {
        if (!clearProfileArmed) {
            setClearProfileArmed(true)
            setSiteSignOutArmed(false)
            setHistoryClearArmed(false)
            setProfileNotice({ tone: 'info', message: 'Click Clear now to sign every integrated Browser tab out and remove Browser history.' })
            return
        }
        const previousHistorySuppression = suppressHistoryUntilRef.current
        suppressHistoryUntilRef.current = Date.now() + 30_000
        setClearingProfile(true)
        setProfileNotice(null)
        try {
            const result = await window.devscope.clearBrowserPreviewData()
            if (!result.success) {
                suppressHistoryUntilRef.current = previousHistorySuppression
                onDeveloperToast({ tone: 'error', message: result.error || 'Could not clear local Browser data.' })
                return
            }
            for (const tab of workspaceStateRef.current.tabs) {
                profileReloadHistorySuppressionRef.current.set(tab.id, 'awaiting-start')
            }
            for (const handle of webviewRefs.current.values()) handle.reload()
            setBrowserHistory([])
            clearOmniboxSuggestions()
            setClearProfileArmed(false)
            setSiteSignOutArmed(false)
            setHistoryClearArmed(false)
            setProfileMenuOpen(false)
            onDeveloperToast({ message: 'Local Browser history, cookies, and site data were cleared.' })
        } catch (error: unknown) {
            suppressHistoryUntilRef.current = previousHistorySuppression
            onDeveloperToast({
                tone: 'error',
                message: error instanceof Error ? error.message : 'Could not clear local Browser data.'
            })
        } finally {
            setClearingProfile(false)
        }
    }, [clearProfileArmed, onDeveloperToast, clearOmniboxSuggestions])

    if (!normalizedProjectPath) {
        return (
            <section className="flex min-h-0 flex-1 items-center justify-center px-6 text-center" aria-label="Browser workspace">
                <div className="max-w-[250px]">
                    <span className="mx-auto inline-flex size-10 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.025] text-sparkle-text-muted/55"><FolderX size={18} /></span>
                    <h3 className="mt-3 text-[12px] font-semibold text-sparkle-text-secondary">No project attached</h3>
                    <p className="mt-1 text-[10px] leading-4 text-sparkle-text-muted/65">Open a project chat to preview its development server.</p>
                </div>
            </section>
        )
    }

    if (configLoading) {
        return <div className="flex min-h-0 flex-1 items-center justify-center"><LoaderCircle size={18} className="animate-spin text-[var(--accent-primary)]/75" /></div>
    }

    if (!config || configError) {
        return (
            <section className="flex min-h-0 flex-1 items-center justify-center px-6 text-center" aria-label="Browser workspace unavailable">
                <div className="max-w-[270px]">
                    <Globe2 size={20} className="mx-auto text-sparkle-text-muted/55" />
                    <h3 className="mt-3 text-[12px] font-semibold text-sparkle-text-secondary">Integrated Browser unavailable</h3>
                    <p className="mt-1 text-[10px] leading-4 text-sparkle-text-muted/65">{configError || 'Restart the Zyra desktop app to load its browser bridge.'}</p>
                </div>
            </section>
        )
    }

    return (
        <NativeOverlayVisibilityScope visible={active}>
        <section className={cn('flex min-h-0 flex-1 flex-col overflow-hidden bg-sparkle-bg', browserFullscreen && 'fixed inset-0 z-[1100] bg-black')} aria-label="Browser workspace" data-shortcut-scope="browser" data-browser-fullscreen={browserFullscreen ? 'true' : undefined}>
            <form
                className={cn('relative z-30 flex h-10 shrink-0 items-center gap-1 border-b border-[var(--surface-divider)] bg-sparkle-bg px-2', browserFullscreen && 'hidden')}
                onSubmit={(event) => {
                    event.preventDefault()
                    addressContainerRef.current?.querySelector<HTMLInputElement>('input')?.blur()
                    addressFocusedRef.current = false
                    setAddressFocused(false)
                    const selectedSuggestion = historyActiveIndex >= 0 ? omniboxSuggestions[historyActiveIndex] : null
                    void navigateActiveTab(selectedSuggestion?.value || addressValue)
                }}
            >
                <button type="button" onClick={() => activeTab && webviewRefs.current.get(activeTab.id)?.goBack()} disabled={!activeTab?.canGoBack} className={BROWSER_CHROME_BUTTON_CLASS} title={shortcutTitle('Back', 'browser.back')}><ArrowLeft size={14} /></button>
                <button type="button" onClick={() => activeTab && webviewRefs.current.get(activeTab.id)?.goForward()} disabled={!activeTab?.canGoForward} className={BROWSER_CHROME_BUTTON_CLASS} title={shortcutTitle('Forward', 'browser.forward')}><ArrowRight size={14} /></button>
                <button
                    type="button"
                    onClick={() => {
                        if (!activeTab) return
                        const handle = webviewRefs.current.get(activeTab.id)
                        if (activeTab.status === 'loading') handle?.stop()
                        else handle?.reload()
                    }}
                    disabled={!activeTab?.url}
                    className={BROWSER_CHROME_BUTTON_CLASS}
                    title={activeTab?.status === 'loading' ? 'Stop loading' : shortcutTitle('Reload', 'browser.reload')}
                >
                    {activeTab?.status === 'loading' ? <Square size={10} fill="currentColor" /> : <RotateCw size={13} />}
                </button>
                <button type="button" onClick={() => void showNewTabInActiveTab()} disabled={!activeTab?.url} className={BROWSER_CHROME_BUTTON_CLASS} title="New tab" aria-label="Show New Tab in the current Browser tab"><House size={13} /></button>
                <div
                    ref={addressContainerRef}
                    onBlurCapture={() => {
                        window.setTimeout(() => {
                            if (addressContainerRef.current?.contains(getOverlayActiveElement()) || omniboxMenuRef.current?.contains(getOverlayActiveElement())) return
                            addressFocusedRef.current = false
                            setAddressFocused(false)
                            if (!addressError) {
                                const current = workspaceStateRef.current.tabs.find((tab) => tab.id === workspaceStateRef.current.activeTabId)
                                setAddressValue(browserTabAddress(current))
                            }
                        }, 0)
                    }}
                    className="relative h-7 min-w-0 flex-1"
                >
                    <div className={cn(
                        'absolute inset-x-0 top-0 z-[390] overflow-hidden rounded-[13px] border transition-colors',
                        addressFocused
                            ? 'border-[color-mix(in_srgb,var(--color-text)_12%,transparent)] bg-[color-mix(in_srgb,var(--color-card)_96%,var(--color-bg))] shadow-[0_18px_38px_rgba(0,0,0,0.34)]'
                            : 'border-transparent bg-transparent hover:bg-[var(--surface-hover)]',
                        omniboxOpen && 'rounded-b-none border-b-transparent',
                        addressError && 'border-red-400/35'
                    )}>
                        <div className="group/address flex h-7 items-center gap-1.5 px-2">
                            {threatWarning && threatWarning.tabId === activeTab?.id
                                ? <TriangleAlert size={13} strokeWidth={2.4} className="shrink-0 text-[#ff5a63]" aria-label="Dangerous site blocked" />
                                : activeTab?.sessionMode === 'incognito'
                                    ? <IncognitoIcon size={13} className="shrink-0 text-violet-300/85" aria-label="Incognito tab" />
                                : activeTab?.url
                                    ? <AssistantBrowserPageIcon faviconUrl={activeTab.faviconUrl} pageUrl={activeTab.url} size={12} />
                                    : <Search size={12} className="shrink-0 text-sparkle-text-muted/45" />}
                            <input
                                value={addressValue}
                                onChange={(event) => {
                                    setAddressValue(event.target.value)
                                    setHistoryActiveIndex(-1)
                                    setAddressError(null)
                                }}
                                onFocus={(event) => {
                                    addressFocusedRef.current = true
                                    setAddressFocused(true)
                                    event.currentTarget.select()
                                }}
                                onKeyDown={(event) => {
                                    const historyAction = resolveAssistantBrowserOmniboxKeyboardAction(historyActiveIndex, event.key, omniboxSuggestions)
                                    if (historyAction.handled) {
                                        event.preventDefault()
                                        setHistoryActiveIndex(historyAction.activeIndex)
                                        if (historyAction.navigateValue) navigateHistorySuggestion(historyAction.navigateValue)
                                        return
                                    }
                                    if (event.key === 'Escape') {
                                        setAddressValue(activeAddress)
                                        setAddressError(null)
                                        setAddressFocused(false)
                                        event.currentTarget.blur()
                                    }
                                }}
                                className="min-w-0 flex-1 bg-transparent text-[11px] text-[var(--color-text)] outline-none placeholder:text-[color-mix(in_srgb,var(--color-text)_42%,transparent)]"
                                placeholder="Search or enter address"
                                spellCheck={false}
                                aria-label="Browser address"
                                role="combobox"
                                aria-autocomplete="list"
                                aria-expanded={omniboxOpen}
                                aria-controls={omniboxOpen ? BROWSER_HISTORY_LISTBOX_ID : undefined}
                                aria-activedescendant={resolveAssistantBrowserOmniboxActiveDescendant(BROWSER_HISTORY_LISTBOX_ID, historyActiveIndex, omniboxSuggestions)}
                            />
                            {activeTab?.url && !isBrowserLocalFileUrl(activeTab.url) ? <button type="button" onClick={() => void openExternal()} className={BROWSER_CHROME_BUTTON_CLASS} title="Open in default browser" aria-label="Open in default browser"><ArrowUpRight size={14} /></button> : null}
                        </div>
                        {omniboxOpen ? (
                            <AnchoredNativeOverlay anchorRef={addressContainerRef} autoFocus={false}><div ref={omniboxMenuRef} id={BROWSER_HISTORY_LISTBOX_ID} role="listbox" className="absolute inset-x-0 top-7 max-h-72 overflow-y-auto rounded-b-[13px] border border-[color-mix(in_srgb,var(--color-text)_12%,transparent)] bg-[color-mix(in_srgb,var(--color-card)_96%,var(--color-bg))] p-1 shadow-[0_18px_38px_rgba(0,0,0,0.34)]" aria-label="Address and search suggestions" aria-busy={omniboxLoading}>
                                {omniboxSuggestions.length > 0 ? omniboxSuggestions.map((suggestion, index) => (
                                    <button
                                        key={suggestion.id}
                                        id={`${BROWSER_HISTORY_LISTBOX_ID}-option-${index}`}
                                        type="button"
                                        role="option"
                                        aria-selected={historyActiveIndex === index}
                                        aria-label={suggestion.kind === 'history' ? `${suggestion.label}, ${suggestion.detail}` : suggestion.label}
                                        onPointerEnter={() => setHistoryActiveIndex(index)}
                                        onClick={() => navigateHistorySuggestion(suggestion.value)}
                                        className={cn('flex h-10 w-full min-w-0 items-center gap-2 rounded-[9px] px-2 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--color-text)_7%,transparent)]', historyActiveIndex === index && 'bg-[color-mix(in_srgb,var(--color-text)_11%,transparent)]')}
                                    >
                                        <span className="inline-flex size-6 shrink-0 items-center justify-center">
                                            {suggestion.kind === 'search' ? <Search size={12} className="text-[color-mix(in_srgb,var(--color-text)_62%,transparent)]" /> : <AssistantBrowserPageIcon faviconUrl={suggestion.faviconUrl} pageUrl={suggestion.value} size={13} />}
                                        </span>
                                        <span className="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden">
                                            <span className="max-w-[58%] shrink-0 truncate text-[11px] font-medium text-[var(--color-text)]">{suggestion.label}</span>
                                            {suggestion.kind === 'history' ? (
                                                <>
                                                    <span aria-hidden="true" className="shrink-0 text-[9px] text-[color-mix(in_srgb,var(--color-text)_36%,transparent)]">&mdash;</span>
                                                    <span className="min-w-0 flex-1 truncate text-[9px] text-[color-mix(in_srgb,var(--color-text)_52%,transparent)]">{suggestion.detail}</span>
                                                </>
                                            ) : null}
                                        </span>
                                    </button>
                                )) : (
                                    <div role="status" className="flex h-10 items-center gap-2 px-2 text-[10px] text-[color-mix(in_srgb,var(--color-text)_52%,transparent)]">
                                        <Search size={12} />
                                        <span>{omniboxLoading ? 'Finding suggestions…' : 'Press Enter to search'}</span>
                                    </div>
                                )}
                            </div></AnchoredNativeOverlay>
                        ) : null}
                    </div>
                </div>
                <AssistantBrowserDownloadsButton
                    api={browserDownloadsApi}
                    active={active}
                    scopeKey={browserOverlayScope}
                    onOpenHere={openDownloadHere}
                />
                <button type="button" onClick={() => void toggleActiveBookmark()} disabled={!bookmarkableUrl} className={cn(BROWSER_CHROME_BUTTON_CLASS, activeBookmarked && 'text-[var(--accent-primary)]')} title={activeBookmarked ? 'Remove bookmark' : 'Bookmark this page'} aria-label={activeBookmarked ? 'Remove bookmark' : 'Bookmark this page'} aria-pressed={activeBookmarked}><Star size={13} fill={activeBookmarked ? 'currentColor' : 'none'} /></button>
                <>
                    {browserToolsEnabled ? <button
                        type="button"
                        onClick={() => void toggleAnnotation()}
                        disabled={!activeTab?.url}
                        className={cn(BROWSER_CHROME_BUTTON_CLASS, annotationTabId === activeTab?.id && 'bg-[var(--surface-hover)] text-[var(--accent-primary)]')}
                        title={annotationTabId === activeTab?.id ? 'Cancel annotation' : 'Annotate page'}
                        aria-pressed={annotationTabId === activeTab?.id}
                    >
                        <Crosshair size={13} />
                    </button> : null}
                    {browserToolsEnabled ? <button type="button" onClick={() => void captureActiveScreenshot()} disabled={!activeTab?.url} className={BROWSER_CHROME_BUTTON_CLASS} title="Capture screenshot"><Camera size={13} /></button> : null}
                </>
                {activePendingGrant ? (
                    <div className="flex h-5 items-center gap-1 border border-sky-300/25 bg-sky-400/[0.08] px-1.5 text-[8px] text-sky-100" title="Review this Browser request in chat.">
                        <ShieldAlert size={9} />
                        <span>Waiting in chat</span>
                    </div>
                ) : null}
                <div ref={profileMenuRef} className="relative">
                    <button
                        type="button"
                        onClick={() => {
                            setProfileMenuOpen(current => !current)
                            setClearProfileArmed(false)
                            setSiteSignOutArmed(false)
                            setHistoryClearArmed(false)
                            setProfileNotice(null)
                        }}
                        className={cn(
                            BROWSER_CHROME_BUTTON_CLASS,
                            'relative',
                            profileMenuOpen && 'bg-[var(--surface-hover)] text-emerald-300/80'
                        )}
                        title={popupWindows.length > 0 ? `Browser menu · ${popupWindows.length} open window${popupWindows.length === 1 ? '' : 's'}` : 'Browser menu'}
                        aria-label="Browser menu"
                        aria-expanded={profileMenuOpen}
                    >
                        <Ellipsis size={14} />
                        {popupWindows.length > 0 ? <span className="absolute -right-0.5 -top-0.5 inline-flex min-w-3.5 items-center justify-center rounded-full bg-[var(--accent-primary)] px-0.5 text-[7px] font-semibold leading-3.5 text-white">{popupWindows.length}</span> : null}
                    </button>
                    {profileMenuOpen ? (
                        <AnchoredNativeOverlay><div className="absolute right-0 top-8 z-[380] w-64 rounded-[7px] border border-[var(--surface-divider)] bg-sparkle-card p-1 text-left shadow-[0_12px_30px_rgba(0,0,0,0.30)]">
                            <button type="button" onClick={() => activeTab && void openLocalFileInTab(activeTab.id)} disabled={!activeTab} title={shortcutTitle('Open file', 'browser.openFile')} className={BROWSER_MENU_ROW_CLASS}><FolderOpen size={12} /><span>Open file</span></button>
                            {activeTab?.url ? <button type="button" onClick={() => void hardReloadActiveTab()} title={shortcutTitle('Hard reload', 'browser.hardReload')} className={BROWSER_MENU_ROW_CLASS}><RefreshCw size={12} /><span>Hard reload</span></button> : null}
                            {browserDevToolsAvailable ? (
                                <div className="group/devtools relative">
                                    <button type="button" className={cn(BROWSER_MENU_ROW_CLASS, 'justify-start')} aria-haspopup="menu">
                                        <Code2 size={12} /><span className="flex-1">DevTools</span><ChevronRight size={11} className="text-sparkle-text-muted/55 transition-transform group-hover/devtools:translate-x-0.5" />
                                    </button>
                                    <div role="menu" className="invisible absolute right-full top-0 z-10 mr-1 w-44 rounded-[7px] border border-[var(--surface-divider)] bg-sparkle-card p-1 opacity-0 shadow-[0_12px_30px_rgba(0,0,0,0.30)] transition-[opacity,visibility] group-hover/devtools:visible group-hover/devtools:opacity-100 group-focus-within/devtools:visible group-focus-within/devtools:opacity-100">
                                    <button type="button" role="menuitem" onClick={() => void openActiveDevTools()} title={shortcutTitle('In-page DevTools', 'browser.devtools')} className={BROWSER_MENU_ROW_CLASS}><Code2 size={12} /><span>In-page DevTools</span></button>
                                    <button type="button" role="menuitem" onClick={() => void openActiveDevTools('popout')} className={BROWSER_MENU_ROW_CLASS}><PanelsTopLeft size={12} /><span>Pop out DevTools</span></button>
                                    </div>
                                </div>
                            ) : null}
                            {activeTab?.url ? <button type="button" onClick={() => {
                                if (!activeTab) return
                                updateActiveViewport(activeTab.viewport.mode === 'fill'
                                    ? { mode: 'freeform', width: 1280, height: 800, presetId: null, aspectRatio: null }
                                    : { mode: 'fill' })
                                setProfileMenuOpen(false)
                            }} className={BROWSER_MENU_ROW_CLASS}><MonitorSmartphone size={12} /><span>{activeTab.viewport.mode === 'fill' ? 'Show device toolbar' : 'Hide device toolbar'}</span></button> : null}
                            {activeTab?.url ? <>
                            <div className="my-1 h-px bg-[var(--surface-divider)]" />
                            <div className="flex h-8 items-center gap-2 px-2">
                                <span className={cn(BROWSER_MENU_SECTION_CLASS, 'mr-auto')}>Page appearance</span>
                                <div role="group" aria-label="Page appearance" className="flex items-center gap-0.5 rounded-[5px] bg-[color-mix(in_srgb,var(--color-text)_5%,transparent)] p-0.5">
                                    {([
                                        { scheme: 'system' as const, label: 'System appearance', icon: <Monitor size={11} /> },
                                        { scheme: 'light' as const, label: 'Light appearance', icon: <Sun size={11} /> },
                                        { scheme: 'dark' as const, label: 'Dark appearance', icon: <Moon size={11} /> }
                                    ]).map((option) => (
                                        <button key={option.scheme} type="button" onClick={() => void updateActiveColorScheme(option.scheme)} aria-label={option.label} title={option.label} aria-pressed={activeTab?.colorScheme === option.scheme} className={cn('inline-flex size-6 items-center justify-center rounded-[3px] text-[color-mix(in_srgb,var(--color-text)_55%,transparent)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-text)_7%,transparent)] hover:text-[var(--color-text)]', activeTab?.colorScheme === option.scheme && 'bg-[var(--color-card)] text-[var(--accent-primary)] shadow-sm')}>{option.icon}</button>
                                    ))}
                                </div>
                            </div>
                            <div className="flex h-8 items-center px-2 text-[10px] text-[color-mix(in_srgb,var(--color-text)_76%,transparent)]">
                                <span className="mr-auto">Zoom</span>
                                <button type="button" onClick={() => void updateActiveZoom((activeTab?.zoomFactor || 1) - 0.1)} disabled={(activeTab?.zoomFactor || 1) <= 0.25} className="inline-flex size-6 items-center justify-center rounded border border-[var(--surface-divider)] text-sparkle-text-muted hover:bg-[var(--surface-hover)] disabled:opacity-30" aria-label="Zoom out"><Minus size={10} /></button>
                                <button type="button" onClick={() => void updateActiveZoom(1)} className="h-6 min-w-11 text-[9px] tabular-nums text-sparkle-text-muted hover:text-sparkle-text" aria-label="Reset zoom">{Math.round((activeTab?.zoomFactor || 1) * 100)}%</button>
                                <button type="button" onClick={() => void updateActiveZoom((activeTab?.zoomFactor || 1) + 0.1)} disabled={(activeTab?.zoomFactor || 1) >= 2} className="inline-flex size-6 items-center justify-center rounded border border-[var(--surface-divider)] text-sparkle-text-muted hover:bg-[var(--surface-hover)] disabled:opacity-30" aria-label="Zoom in"><Plus size={10} /></button>
                                <button type="button" onClick={() => void updateActiveZoom(1)} className="ml-1 inline-flex size-6 items-center justify-center rounded text-sparkle-text-muted hover:bg-[var(--surface-hover)]" aria-label="Reset zoom"><RotateCcw size={10} /></button>
                            </div>
                            </> : null}
                            {activeTab?.url ? <>
                                <div className="my-1 h-px bg-[var(--surface-divider)]" />
                                {browserToolsEnabled || recordingTabId ? <button type="button" onClick={() => void toggleActiveRecording()} disabled={recordingState.status === 'starting' || recordingState.status === 'stopping' || Boolean(recordingTabId && recordingTabId !== activeTab.id)} className={cn(BROWSER_MENU_ROW_CLASS, recordingTabId === activeTab.id && 'text-red-300')}><Circle size={11} fill={recordingTabId === activeTab.id ? 'currentColor' : 'none'} /><span>{recordingTabId === activeTab.id ? 'Stop and save recording' : 'Record Browser tab'}</span></button> : null}
                            </> : null}
                            {isChromeWebStoreUrl(activeTab?.url || '') ? <button type="button" onClick={() => { setProfileMenuOpen(false); void installActiveWebStoreExtension() }} className={BROWSER_MENU_ROW_CLASS}><Puzzle size={12} /><span>Install extension in Zyra</span></button> : null}
                            <div className="my-1 h-px bg-[var(--surface-divider)]" />
                            <button type="button" onClick={() => {
                                setProfileMenuOpen(false)
                                setHistoryPanelOpen(false)
                                setDownloadsPanelOpen(false)
                                setBookmarksPanelOpen(true)
                                void reloadBrowserBookmarks()
                            }} className={BROWSER_MENU_ROW_CLASS}><Bookmark size={12} /><span>Bookmarks</span></button>
                            <button type="button" onClick={() => {
                                setProfileMenuOpen(false)
                                setDownloadsPanelOpen(false)
                                setBookmarksPanelOpen(false)
                                setHistoryPanelQuery('')
                                setHistoryPanelOpen(true)
                            }} className={BROWSER_MENU_ROW_CLASS}><Clock3 size={12} /><span>History</span></button>
                            <button type="button" onClick={() => {
                                setProfileMenuOpen(false)
                                setHistoryPanelOpen(false)
                                setBookmarksPanelOpen(false)
                                setDownloadsPanelOpen(true)
                            }} className={BROWSER_MENU_ROW_CLASS}><Download size={12} /><span>Downloads</span></button>
                            {popupWindows.length > 0 ? (
                                <>
                                    <div className="my-1 h-px bg-[var(--surface-divider)]" />
                                    <p className="px-2 pb-1 pt-0.5 text-[9px] font-medium text-[color-mix(in_srgb,var(--color-text)_58%,transparent)]">Open windows</p>
                                    {popupWindows.map((popupWindow) => (
                                        <button key={popupWindow.id} type="button" onClick={() => {
                                            setProfileMenuOpen(false)
                                            void window.devscope.browserPopup.focusWindow(popupWindow.id).then((result) => {
                                                if (!result.success) onDeveloperToast({ tone: 'error', message: result.error })
                                            })
                                        }} className="flex min-h-9 w-full items-center gap-2 px-2 py-1 text-left text-sparkle-text-secondary hover:bg-[var(--surface-hover)]">
                                            <PanelsTopLeft size={12} className="shrink-0 text-[var(--accent-primary)]" />
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-[10px] font-medium text-[var(--color-text)]">{popupWindow.title}</span>
                                                <span className="block truncate text-[8px] text-[color-mix(in_srgb,var(--color-text)_48%,transparent)]">{popupWindow.minimized ? 'Minimized · ' : ''}{popupWindow.origin}</span>
                                            </span>
                                        </button>
                                    ))}
                                </>
                            ) : null}
                            <div className="my-1 h-px bg-[var(--surface-divider)]" />
                            <div>
                                <button type="button" onClick={() => setBrowserDataOpen((open) => !open)} aria-expanded={browserDataOpen} className={BROWSER_MENU_ROW_CLASS}><Trash2 size={12} /><span className="flex-1">Clear browser data</span><ChevronDown size={11} className={cn('transition-transform duration-[180ms] motion-reduce:transition-none', browserDataOpen && 'rotate-180')} /></button>
                                <AnimatedHeight isOpen={browserDataOpen} duration={180} unmountOnExit>
                                <div className="ml-2 border-l border-[var(--surface-divider)] pl-1">
                            <button type="button" onClick={() => void clearHistory()} className={cn(BROWSER_MENU_ROW_CLASS, historyClearArmed && 'text-red-300')}><Clock3 size={12} /><span>{historyClearArmed ? 'Confirm clear history' : 'Clear history'}</span></button>
                            <button type="button" onClick={() => void clearBrowserCookies()} className={cn(BROWSER_MENU_ROW_CLASS, siteSignOutArmed && 'text-red-300')}><ShieldCheck size={12} /><span>{siteSignOutArmed ? 'Confirm sign out of websites' : 'Sign out of websites'}</span></button>
                            <button type="button" onClick={() => void clearBrowserCache()} className={BROWSER_MENU_ROW_CLASS}><Trash2 size={12} /><span>Clear temporary cache</span></button>
                            <button type="button" onClick={() => void clearLocalBrowserProfile()} disabled={clearingProfile} title="Clear the shared Local Zyra profile used by Browser tabs across chats and projects" className={cn(BROWSER_MENU_ROW_CLASS, clearProfileArmed && 'text-red-300')}>
                                {clearingProfile ? <LoaderCircle size={11} className="animate-spin" /> : <Trash2 size={11} />}
                                <span>{clearingProfile ? 'Resetting Browser profile' : clearProfileArmed ? 'Confirm reset Browser profile' : 'Reset Browser profile'}</span>
                            </button>
                            {profileNotice ? <p className="px-2 py-1 text-[9px] leading-3.5 text-[color-mix(in_srgb,var(--color-text)_58%,transparent)]">{profileNotice.message}</p> : null}
                                </div>
                                </AnimatedHeight>
                            </div>
                        </div></AnchoredNativeOverlay>
                    ) : null}
                </div>
            </form>

            {!browserFullscreen && addressError ? <div className="shrink-0 border-b border-red-500/15 bg-red-500/[0.06] px-2 py-1 text-[9px] text-red-300">{addressError}</div> : null}
            {!browserFullscreen && config.protectedMedia?.message ? <div className="shrink-0 border-b border-amber-400/15 bg-amber-400/[0.06] px-2 py-1 text-[9px] text-amber-200">{config.protectedMedia.message}</div> : null}
            {!browserFullscreen && spotifyNeedsProductionVmp ? <div className="shrink-0 border-b border-amber-400/15 bg-amber-400/[0.06] px-2 py-1 text-[9px] text-amber-100">Spotify may skip tracks in this development build because its DRM can require production signing. Your Spotify account is unaffected. Final playback must be checked in the signed Zyra release.</div> : null}
            {!browserFullscreen && activeTab?.url && activeTab.viewport.mode !== 'fill' ? (
                <AssistantBrowserDeviceToolbar
                    viewport={activeTab.viewport}
                    onViewportChange={updateActiveViewport}
                    onClose={() => updateActiveViewport({ mode: 'fill' })}
                />
            ) : null}

            <div className="relative isolate min-h-0 flex-1 overflow-hidden bg-white">
                {workspaceState.tabs.map((tab) => {
                    const visible = active && tab.id === activeTab?.id
                    const pageReplaced = (!tab.url && tab.status === 'idle') || tab.status === 'error'
                    const targetId = controlTargetsByTab[tab.id]
                    const grant = targetId ? controlState?.grants.find((entry) => entry.targetId === targetId && entry.state === 'active') : null
                    const cursor = targetId ? controlState?.cursors.find((entry) => entry.targetId === targetId) || null : null
                    return (
                        <AssistantBrowserViewportFrame
                            key={tab.id}
                            viewport={browserFullscreen && tab.id === activeTab?.id ? { mode: 'fill' } : tab.viewport}
                            zoomFactor={tab.zoomFactor}
                            visible={visible}
                            controlled={Boolean(grant)}
                            cursor={cursor}
                            cursorTargetId={targetId}
                            onViewportChange={(viewport) => {
                                mutateWorkspaceState((current) => updateAssistantBrowserTab(current, tab.id, { viewport }))
                            }}
                        >
                            {mountedBrowserTabIdsRef.current.has(tab.id) ? <AssistantBrowserWebview
                                ref={getWebviewRefCallback(tab.id)}
                                tab={tab}
                                threadId={threadId}
                                config={config}
                                active={visible}
                                visible={visible && !pageReplaced}
                                placement="full"
                                controlled={Boolean(grant)}
                                agentControlEnabled={chatIntegration}
                                cursor={cursor}
                            cursorTargetId={targetId}
                                onStateChange={handleWebviewStateChange}
                                onControlTargetChange={handleControlTargetChange}
                                onFullscreenChange={handleFullscreenChange}
                                onViewportRectChange={handleViewportRectChange}
                                onGuestFocus={(tabId) => {
                                    if (workspaceStateRef.current.activeTabId !== tabId) return
                                    addressContainerRef.current?.querySelector<HTMLInputElement>('input')?.blur()
                                    addressFocusedRef.current = false
                                    setAddressFocused(false)
                                }}
                            /> : null}
                        </AssistantBrowserViewportFrame>
                    )
                })}

                {threatWarning && threatWarning.tabId === activeTab?.id ? (
                    <AssistantBrowserThreatWarning
                        warning={threatWarning.warning}
                        busy={threatActionBusy}
                        error={threatActionError}
                        onBack={() => void dismissThreatWarning()}
                        onProceed={() => void proceedThroughThreatWarning()}
                    />
                ) : null}


                {adBlockPrompt && adBlockPrompt.tabId === activeTab?.id ? (
                    <AssistantBrowserAdBlockPrompt
                        origin={adBlockPrompt.origin}
                        enabling={adBlockEnabling}
                        error={adBlockError}
                        onEnable={() => void enableAdBlocking()}
                        onKeepOff={keepAdBlockingOff}
                    />
                ) : null}

                {!chatIntegration && accessoryNewTabMountedRef.current ? (
                    <div className={cn('absolute inset-0 z-10', !accessoryNewTabVisible && 'invisible pointer-events-none')} aria-hidden={!accessoryNewTabVisible}>
                        <AssistantBrowserNewTab
                            projectServers={projectServers}
                            otherServers={otherLocalServers}
                            loading={serversLoading}
                            error={serversError}
                            onRefresh={() => void refreshLocalServers()}
                            onNavigate={(url) => void navigateActiveTab(url)}
                            onOpenInNewTab={(url) => { createTab(url) }}
                            onOpenHistory={() => {
                                setBookmarksPanelOpen(false)
                                setDownloadsPanelOpen(false)
                                setHistoryPanelQuery('')
                                setHistoryPanelOpen(true)
                            }}
                            searchSuggestionsEnabled={settings.assistantBrowserGoogleSuggestions}
                            getSearchSuggestions={getSearchSuggestions}
                        />
                    </div>
                ) : null}

                {chatIntegration && activeTab?.status === 'idle' && !activeTab.url ? (
                    <AssistantBrowserNewTab
                        key={activeTab.id}
                        projectServers={projectServers}
                        otherServers={otherLocalServers}
                        loading={serversLoading}
                        error={serversError}
                        onRefresh={() => void refreshLocalServers()}
                        onNavigate={(url) => void navigateActiveTab(url)}
                        onOpenInNewTab={(url) => { createTab(url) }}
                        onOpenHistory={() => {
                            setBookmarksPanelOpen(false)
                            setDownloadsPanelOpen(false)
                            setHistoryPanelQuery('')
                            setHistoryPanelOpen(true)
                        }}
                        searchSuggestionsEnabled={settings.assistantBrowserGoogleSuggestions}
                        getSearchSuggestions={getSearchSuggestions}
                    />
                ) : null}

                {historyPanelOpen ? (
                    <AssistantBrowserHistoryPanel
                        entries={historyPanelEntries}
                        loading={historyPanelSearching}
                        query={historyPanelQuery}
                        onQueryChange={setHistoryPanelQuery}
                        onClose={() => setHistoryPanelOpen(false)}
                        onNavigate={(url) => {
                            setHistoryPanelOpen(false)
                            void navigateActiveTab(url)
                        }}
                        onOpenInNewTab={(url) => {
                            setHistoryPanelOpen(false)
                            createTab(url)
                        }}
                        onClear={() => void clearHistoryFromPanel()}
                        onImport={() => {
                            setHistoryPanelOpen(false)
                            setHistoryImportOpen(true)
                        }}
                    />
                ) : null}

                {downloadsPanelOpen ? (
                    <AssistantBrowserDownloadsPanel
                        api={browserDownloadsApi}
                        onOpenHere={openDownloadHere}
                        onClose={() => setDownloadsPanelOpen(false)}
                    />
                ) : null}

                {historyImportOpen ? (
                    <AssistantBrowserHistoryImportDialog
                        onClose={() => setHistoryImportOpen(false)}
                        onImported={() => void reloadBrowserHistory()}
                    />
                ) : null}

                {activeTab?.status === 'error' ? (
                    <AssistantBrowserErrorPage
                        url={activeTab.url}
                        error={activeTab.error}
                        canGoBack={activeTab.canGoBack}
                        onBack={() => webviewRefs.current.get(activeTab.id)?.goBack()}
                        onRetry={() => webviewRefs.current.get(activeTab.id)?.reload()}
                    />
                ) : null}

                {bookmarksPanelOpen ? <AssistantBrowserBookmarksPanel
                    entries={browserBookmarks}
                    onClose={() => setBookmarksPanelOpen(false)}
                    onNavigate={(url) => { setBookmarksPanelOpen(false); void navigateActiveTab(url) }}
                    onOpenInNewTab={(url) => { setBookmarksPanelOpen(false); createTab(url) }}
                    onRemove={(url) => void removeBookmark(url)}
                /> : null}

                {activeTab?.status === 'loading' ? <AnchoredNativeOverlay passive><div className="pointer-events-none absolute inset-x-0 top-0 z-30 h-px overflow-hidden bg-[var(--accent-primary)]/15 after:block after:h-full after:w-1/3 after:animate-[browser-loading-slide_1.1s_ease-in-out_infinite] after:bg-[var(--accent-primary)]" /></AnchoredNativeOverlay> : null}
            </div>
        </section>
        </NativeOverlayVisibilityScope>
    )
})
