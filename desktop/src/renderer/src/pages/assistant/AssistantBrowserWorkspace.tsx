import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    ArrowLeft,
    ArrowRight,
    Camera,
    Circle,
    Clock3,
    Code2,
    Crosshair,
    Download,
    Ellipsis,
    ExternalLink,
    FileUp,
    FolderX,
    Globe2,
    House,
    LoaderCircle,
    Minus,
    Monitor,
    MonitorSmartphone,
    Moon,
    PanelsTopLeft,
    Plus,
    RefreshCw,
    RotateCcw,
    RotateCw,
    Search,
    ShieldAlert,
    ShieldCheck,
    Square,
    Sun,
    TriangleAlert,
    Trash2
} from 'lucide-react'
import type {
    DevScopeBrowserAdDetection,
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
import { AssistantBrowserAdBlockPrompt } from './AssistantBrowserAdBlockPrompt'
import { AssistantBrowserDeviceToolbar } from './AssistantBrowserDeviceToolbar'
import { AssistantBrowserDownloadsButton } from './AssistantBrowserDownloadsButton'
import { AssistantBrowserDownloadsPanel } from './AssistantBrowserDownloadsPanel'
import { AssistantBrowserHistoryImportDialog } from './AssistantBrowserHistoryImportDialog'
import { AssistantBrowserHistoryPanel } from './AssistantBrowserHistoryPanel'
import { AssistantBrowserNewTab } from './AssistantBrowserNewTab'
import { AssistantBrowserPageIcon } from './AssistantBrowserPageIcon'
import { AssistantBrowserThreatWarning } from './AssistantBrowserThreatWarning'
import { AssistantBrowserViewportFrame } from './AssistantBrowserViewportFrame'
import { AssistantBrowserWebview, type AssistantBrowserWebviewHandle } from './AssistantBrowserWebview'
import {
    buildAssistantBrowserOmniboxSuggestions,
    filterAssistantBrowserHistory,
    mergeAssistantBrowserHistoryEntry,
    resolveAssistantBrowserOmniboxActiveDescendant,
    resolveAssistantBrowserOmniboxKeyboardAction,
    resolveAssistantBrowserHistoryRecord,
    transitionAssistantBrowserProfileReloadHistory,
    type AssistantBrowserProfileReloadHistoryPhase
} from './assistant-browser-history'
import type { AssistantInspectorDeveloperToastInput } from './AssistantInspectorDeveloperToast'
import { publishAssistantBrowserAnnotationAttachment } from './assistant-browser-annotation-composer'
import {
    readActiveAssistantBrowserRecordingTabId,
    startAssistantBrowserRecording,
    stopAssistantBrowserRecording
} from './assistant-browser-recording'
import {
    activateAssistantBrowserTab,
    addAssistantBrowserTab,
    ASSISTANT_BROWSER_DANGEROUS_TAB_TITLE,
    ASSISTANT_BROWSER_TAB_LIMIT,
    browserTabFallbackTitle,
    closeAssistantBrowserTab,
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
const BROWSER_MENU_ROW_CLASS = 'flex h-7 w-full items-center gap-2 rounded-[4px] px-2 text-[10px] text-[color-mix(in_srgb,var(--color-text)_76%,transparent)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--color-text)] disabled:opacity-35'
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
    onOpenPreview
}: {
    workspaceKey: string
    threadId: string
    projectPath: string | null
    active: boolean
    selectedTabId: string | null
    controlState: ControlStateSnapshot | null
    navigationRequest: { id: number; tabId: string; url: string; sessionMode: BrowserSessionMode } | null
    surfaceRequest: BrowserSurfaceOpenRequest | null
    onNavigationRequestHandled: (requestId: number) => void
    onSurfaceRequestHandled: (requestId: string) => void
    onWorkspaceStateChange: (state: ControlWorkspaceSnapshot['browser']) => void
    onLocalControlTargetChange?: (tabId: string, targetId: string) => void
    onTabsChange: (state: AssistantBrowserWorkspaceState) => void
    onRequestTabSelection: (tabId: string) => void
    onControllerChange: (controller: AssistantBrowserWorkspaceController | null) => void
    onDeveloperToast: (toast: AssistantInspectorDeveloperToastInput) => void
    onOpenPreview: (file: { name: string; path: string }, ext: string, options?: PreviewOpenOptions) => Promise<void>
}) {
    const { settings } = useSettings()
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
        const restored = {
            ...loadAssistantBrowserWorkspaceState(workspaceKey),
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
            ? surfaceRequest?.sessionMode || 'incognito'
            : initialTabId && initialTabId === initialNavigationTabId
                ? navigationRequest?.sessionMode || 'normal'
                : 'normal'
        return initialTabId ? ensureAssistantBrowserWorkspaceTab(restored, initialTabId, initialSessionMode) : restored
    })
    const [viewportRects, setViewportRects] = useState<Record<string, { x: number; y: number; width: number; height: number }>>({})
    const [config, setConfig] = useState<DevScopeBrowserPreviewConfig | null>(null)
    const [configLoading, setConfigLoading] = useState(Boolean(normalizedProjectPath))
    const [configError, setConfigError] = useState<string | null>(null)
    const [addressValue, setAddressValue] = useState('')
    const [addressError, setAddressError] = useState<string | null>(null)
    const [profileMenuOpen, setProfileMenuOpen] = useState(false)
    const [downloadsOverlayOpen, setDownloadsOverlayOpen] = useState(false)
    const [downloadsPanelOpen, setDownloadsPanelOpen] = useState(false)
    const [popupWindows, setPopupWindows] = useState<BrowserPopupSummary[]>([])
    const [clearProfileArmed, setClearProfileArmed] = useState(false)
    const [siteSignOutArmed, setSiteSignOutArmed] = useState(false)
    const [clearingProfile, setClearingProfile] = useState(false)
    const [profileNotice, setProfileNotice] = useState<{ tone: 'info' | 'error'; message: string } | null>(null)
    const [annotationTabId, setAnnotationTabId] = useState<string | null>(null)
    const [fullscreenTabId, setFullscreenTabId] = useState<string | null>(null)
    const [recordingTabId, setRecordingTabId] = useState<string | null>(() => readActiveAssistantBrowserRecordingTabId())
    const [localServers, setLocalServers] = useState<DevScopeLocalServer[]>([])
    const [browserHistory, setBrowserHistory] = useState<DevScopeBrowserHistoryEntry[]>([])
    const [historySearch, setHistorySearch] = useState<{ query: string; entries: DevScopeBrowserHistoryEntry[] }>({ query: '', entries: [] })
    const [googleSearchSuggestions, setGoogleSearchSuggestions] = useState<{ query: string; suggestions: string[] }>({ query: '', suggestions: [] })
    const [omniboxLoading, setOmniboxLoading] = useState(false)
    const [historyPanelOpen, setHistoryPanelOpen] = useState(false)
    const [historyImportOpen, setHistoryImportOpen] = useState(false)
    const [historyPanelQuery, setHistoryPanelQuery] = useState('')
    const [historyPanelSearch, setHistoryPanelSearch] = useState<{ query: string; entries: DevScopeBrowserHistoryEntry[] }>({ query: '', entries: [] })
    const [historyPanelLoading, setHistoryPanelLoading] = useState(false)
    const [historyActiveIndex, setHistoryActiveIndex] = useState(-1)
    const [addressFocused, setAddressFocused] = useState(false)
    const [omniboxPresentationReady, setOmniboxPresentationReady] = useState(false)
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
    const controlTargetsByTab = useMemo<Record<string, string>>(() => Object.fromEntries(
        (controlState?.targets || []).flatMap((target): Array<[string, string]> => (
            target.kind === 'zyra-browser' && target.ownerThreadId === threadId ? [[target.tabId, target.targetId]] : []
        ))
    ), [controlState?.targets, threadId])
    const controlTargetsByTabRef = useRef(controlTargetsByTab)
    const webviewRefs = useRef(new Map<string, AssistantBrowserWebviewHandle>())
    const webviewRefCallbacks = useRef(new Map<string, (handle: AssistantBrowserWebviewHandle | null) => void>())
    const closedTabsRef = useRef<AssistantBrowserTabState[]>([])
    const pendingNavigationRef = useRef(new Map<string, string>())
    const consumedNavigationRequestsRef = useRef(new Set<number>())
    const consumedSurfaceRequestsRef = useRef(new Set<string>())
    const cancelledSurfaceRequestsRef = useRef(new Set<string>())
    const pendingSurfaceRequestsRef = useRef(new Map<string, BrowserSurfaceOpenRequest>())
    const onSurfaceRequestHandledRef = useRef(onSurfaceRequestHandled)
    const tabSequenceRef = useRef(tabSequenceSeed(workspaceState))
    const addressFocusedRef = useRef(false)
    const omniboxPreparationGenerationRef = useRef(0)
    const addressContainerRef = useRef<HTMLDivElement | null>(null)
    const suppressHistoryUntilRef = useRef(0)
    const profileReloadHistorySuppressionRef = useRef(new Map<string, AssistantBrowserProfileReloadHistoryPhase>())
    const profileMenuRef = useRef<HTMLDivElement | null>(null)
    const annotationTabIdRef = useRef<string | null>(annotationTabId)
    const fullscreenTabIdRef = useRef<string | null>(fullscreenTabId)

    workspaceStateRef.current = workspaceState
    annotationTabIdRef.current = annotationTabId
    fullscreenTabIdRef.current = fullscreenTabId
    controlTargetsByTabRef.current = controlTargetsByTab
    onSurfaceRequestHandledRef.current = onSurfaceRequestHandled
    const activeTab = workspaceState.tabs.find((tab) => tab.id === workspaceState.activeTabId)
        || workspaceState.tabs[0]
    const activeAddress = browserTabAddress(activeTab)
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
    const historySuggestionEntries = useMemo(() => historyQuery
        ? historySearch.query === historyQuery
            ? historySearch.entries
            : filterAssistantBrowserHistory(browserHistory, historyQuery, 24)
        : [], [browserHistory, historyQuery, historySearch])
    const activeGoogleSearchSuggestions = googleSearchSuggestions.query === historyQuery
        ? googleSearchSuggestions.suggestions
        : []
    const omniboxSuggestions = useMemo(() => buildAssistantBrowserOmniboxSuggestions(
        activeGoogleSearchSuggestions,
        historySuggestionEntries,
        8
    ), [activeGoogleSearchSuggestions, historySuggestionEntries])
    const omniboxOpen = Boolean(addressFocused && historyQuery && omniboxPresentationReady)
    const historyPanelEntries = historyPanelQuery && historyPanelSearch.query === historyPanelQuery
        ? historyPanelSearch.entries
        : historyPanelQuery
            ? filterAssistantBrowserHistory(browserHistory, historyPanelQuery, 50)
            : browserHistory
    const historyPanelSearching = Boolean(historyPanelQuery.trim() && historyPanelSearch.query !== historyPanelQuery.trim()) || historyPanelLoading
    const activeControlTargetId = activeTab ? controlTargetsByTab[activeTab.id] : undefined
    const activeControlGrant = controlState?.grants.find((grant) => grant.targetId === activeControlTargetId && grant.state === 'active') || null
    const activePendingGrant = controlState?.pendingGrants.find((grant) => grant.targetId === activeControlTargetId) || null
    const prepareActiveBrowserOverlay = useCallback(async (): Promise<boolean> => {
        const state = workspaceStateRef.current
        const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId)
        if (!tab?.url) return true
        return webviewRefs.current.get(tab.id)?.preparePresentation() ?? false
    }, [])
    const prepareOmniboxPresentation = useCallback(() => {
        const generation = ++omniboxPreparationGenerationRef.current
        const state = workspaceStateRef.current
        const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId)
        if (!tab?.url) {
            setOmniboxPresentationReady(true)
            return
        }
        setOmniboxPresentationReady(false)
        void prepareActiveBrowserOverlay().finally(() => {
            if (generation !== omniboxPreparationGenerationRef.current || !addressFocusedRef.current) return
            setOmniboxPresentationReady(true)
        })
    }, [prepareActiveBrowserOverlay])
    useEffect(() => {
        if (!shouldFocusAssistantBrowserOmnibox(active, browserChromeReady, activeTab)) return
        const animationFrame = window.requestAnimationFrame(() => {
            addressContainerRef.current?.querySelector<HTMLInputElement>('input')?.focus()
        })
        return () => window.cancelAnimationFrame(animationFrame)
    }, [active, activeTab?.id, activeTab?.url, browserChromeReady])

    const commitWorkspaceState = useCallback((nextState: AssistantBrowserWorkspaceState) => {
        workspaceStateRef.current = nextState
        setWorkspaceState(nextState)
        persistAssistantBrowserWorkspaceState(workspaceKey, nextState)
    }, [workspaceKey])

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
        omniboxPreparationGenerationRef.current += 1
        setAddressFocused(false)
        setOmniboxPresentationReady(false)
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

    useEffect(() => window.devscope.agentControl.onBrowserSurfaceCancel((requestId) => {
        cancelledSurfaceRequestsRef.current.add(requestId)
        pendingSurfaceRequestsRef.current.delete(requestId)
        if (cancelledSurfaceRequestsRef.current.size > 100) {
            const oldest = cancelledSurfaceRequestsRef.current.values().next().value
            if (oldest) cancelledSurfaceRequestsRef.current.delete(oldest)
        }
    }), [])

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
        omniboxPreparationGenerationRef.current += 1
        setAddressFocused(false)
        setOmniboxPresentationReady(false)
        addressContainerRef.current?.querySelector<HTMLInputElement>('input')?.blur()
        cancelAnnotation()
    }, [active, cancelAnnotation])

    useEffect(() => () => cancelAnnotation(), [cancelAnnotation])

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
            const target = event.target
            if (target instanceof Node && profileMenuRef.current?.contains(target)) return
            dismissProfileMenu()
        }
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') dismissProfileMenu()
        }
        document.addEventListener('pointerdown', handlePointerDown, true)
        window.addEventListener('keydown', handleEscape)
        window.addEventListener('blur', dismissProfileMenu)
        window.addEventListener(TRANSIENT_MENU_DISMISS_EVENT, dismissProfileMenu)
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown, true)
            window.removeEventListener('keydown', handleEscape)
            window.removeEventListener('blur', dismissProfileMenu)
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

    useEffect(() => {
        if (!active) return
        const popupApi = window.devscope.browserPopup
        if (typeof popupApi?.listOpenWindows !== 'function' || typeof popupApi.onOpenWindowsChange !== 'function') return
        let disposed = false
        const scopeWindows = (windows: BrowserPopupSummary[]) => windows.filter((popup) => popup.ownerThreadId === threadId)
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
    }, [active, threadId])

    useEffect(() => {
        if (!historyQuery) {
            setHistorySearch({ query: '', entries: [] })
            setGoogleSearchSuggestions({ query: '', suggestions: [] })
            setOmniboxLoading(false)
            return
        }
        let cancelled = false
        setOmniboxLoading(true)
        const timeoutId = window.setTimeout(() => {
            const requests: Promise<void>[] = []
            if (typeof window.devscope.getBrowserHistory === 'function') {
                requests.push(window.devscope.getBrowserHistory({ query: historyQuery, limit: 24 }).then((result) => {
                    if (!cancelled && result.success) setHistorySearch({ query: historyQuery, entries: result.entries })
                }).catch(() => {
                    // Keep filtering the already loaded local history when the deeper lookup is unavailable.
                }))
            }
            if (settings.assistantBrowserGoogleSuggestions && typeof window.devscope.getBrowserSearchSuggestions === 'function') {
                requests.push(window.devscope.getBrowserSearchSuggestions({ query: historyQuery }).then((result) => {
                    if (!cancelled) setGoogleSearchSuggestions({ query: historyQuery, suggestions: result.success ? result.suggestions : [] })
                }).catch(() => {
                    if (!cancelled) setGoogleSearchSuggestions({ query: historyQuery, suggestions: [] })
                }))
            } else {
                setGoogleSearchSuggestions({ query: historyQuery, suggestions: [] })
            }
            void Promise.allSettled(requests).then(() => {
                if (!cancelled) setOmniboxLoading(false)
            })
        }, 120)
        return () => {
            cancelled = true
            window.clearTimeout(timeoutId)
        }
    }, [historyQuery, settings.assistantBrowserGoogleSuggestions])

    useEffect(() => {
        setHistoryActiveIndex(-1)
    }, [addressFocused, googleSearchSuggestions, historyQuery, historySearch])

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
        omniboxPreparationGenerationRef.current += 1
        setAddressFocused(false)
        setOmniboxPresentationReady(false)
        setAddressError(null)
        setAddressValue('')
        setHistoryActiveIndex(-1)
        setProfileMenuOpen(false)
        setDownloadsOverlayOpen(false)
        setDownloadsPanelOpen(false)
        setHistoryPanelOpen(false)
        setHistoryImportOpen(false)

        try {
            const browserHistoryState = await webviewRefs.current.get(tabId)?.showNewTab()
            mutateWorkspaceState((current) => updateAssistantBrowserTab(current, tabId, {
                url: '',
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

    const navigateHistorySuggestion = useCallback((url: string) => {
        addressContainerRef.current?.querySelector<HTMLInputElement>('input')?.blur()
        addressFocusedRef.current = false
        omniboxPreparationGenerationRef.current += 1
        setAddressFocused(false)
        setOmniboxPresentationReady(false)
        setHistoryActiveIndex(-1)
        void navigateActiveTab(url)
    }, [navigateActiveTab])

    const createTab = useCallback((url = '', options?: { activate?: boolean; tabId?: string; sessionMode?: BrowserSessionMode }) => {
        const activate = options?.activate !== false
        const requestedTabId = options?.tabId
        const sessionMode = options?.sessionMode || 'normal'
        if (requestedTabId && workspaceStateRef.current.tabs.some((tab) => tab.id === requestedTabId)) {
            if (activate) transitionToBrowserTab(requestedTabId)
            return requestedTabId
        }
        if (workspaceStateRef.current.tabs.length >= ASSISTANT_BROWSER_TAB_LIMIT) {
            onDeveloperToast({ tone: 'error', message: `Browser tabs are limited to ${ASSISTANT_BROWSER_TAB_LIMIT}.` })
            return workspaceStateRef.current.activeTabId
        }
        const tabId = requestedTabId && /^browser:[a-zA-Z0-9][a-zA-Z0-9:._-]{0,127}$/.test(requestedTabId)
            ? requestedTabId
            : `browser:${tabSequenceRef.current++}`
        if (activate) onRequestTabSelection(tabId)
        mutateWorkspaceState((current) => addAssistantBrowserTab(current, tabId, url, activate, sessionMode))
        if (activate) {
            setAddressValue(url)
            setAddressError(null)
        }
        return tabId
    }, [mutateWorkspaceState, onDeveloperToast, onRequestTabSelection, transitionToBrowserTab])

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
        addressFocusedRef.current = false
        omniboxPreparationGenerationRef.current += 1
        setAddressFocused(false)
        setOmniboxPresentationReady(false)
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
        if (transferred && recordingTabId === tabId) setRecordingTabId(null)
        if (!transferred && closingHandle && recordingTabId === tabId) {
            try {
                const target = closingHandle.getDeveloperTarget()
                setRecordingTabId(null)
                void stopAssistantBrowserRecording(target).then((artifact) => {
                    onDeveloperToast({ message: 'Browser recording saved before the tab closed.', artifact })
                }).catch((error: unknown) => {
                    onDeveloperToast({ tone: 'error', message: error instanceof Error ? error.message : 'Could not save the closing Browser recording.' })
                })
            } catch (error) {
                setRecordingTabId(readActiveAssistantBrowserRecordingTabId())
                onDeveloperToast({ tone: 'error', message: error instanceof Error ? error.message : 'Could not stop the closing Browser recording.' })
            }
        }
        webviewRefs.current.delete(tabId)
        webviewRefCallbacks.current.delete(tabId)
        profileReloadHistorySuppressionRef.current.delete(tabId)
        pendingNavigationRef.current.delete(tabId)
        const replacementTabId = `browser:${tabSequenceRef.current++}`
        let nextState = workspaceStateRef.current
        mutateWorkspaceState((current) => {
            nextState = closeAssistantBrowserTab(current, tabId, replacementTabId)
            return nextState
        })
        const nextActiveTab = nextState.tabs.find((tab) => tab.id === nextState.activeTabId)
        setAddressValue(browserTabAddress(nextActiveTab))
        return nextState
    }, [cancelAnnotation, mutateWorkspaceState, onDeveloperToast, recordingTabId])

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
            if (workspaceStateRef.current.tabs.length >= ASSISTANT_BROWSER_TAB_LIMIT) {
                onDeveloperToast({ tone: 'error', message: `Close a tab before restoring the previous one (${ASSISTANT_BROWSER_TAB_LIMIT} tab limit).` })
                return
            }
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
    }, [closeTab, createTab, onDeveloperToast, onRequestTabSelection, openLocalFileInTab, selectBrowserTab])

    const controller = useMemo<AssistantBrowserWorkspaceController>(() => ({
        createTab,
        closeTab,
        activateTab
    }), [activateTab, closeTab, createTab])

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
            if (!tabId) {
                void window.devscope.dismissBrowserThreatWarning(warning.decisionId).catch(() => undefined)
                return
            }
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
            if (event.defaultPrevented) return
            if (browserFullscreen && event.key === 'Escape') {
                event.preventDefault()
                fullscreenTabIdRef.current = null
                setFullscreenTabId(null)
                window.devscope.window.setFullScreen(false)
                return
            }
            const action = resolveBrowserShortcut({
                type: event.type,
                key: event.key,
                control: event.ctrlKey,
                meta: event.metaKey,
                shift: event.shiftKey,
                alt: event.altKey
            }, rendererBrowserShortcutPlatform())
            if (!action) return
            event.preventDefault()
            event.stopPropagation()
            executeBrowserShortcut(action, workspaceStateRef.current.activeTabId)
        }
        window.addEventListener('keydown', handleBrowserShortcut, true)
        return () => window.removeEventListener('keydown', handleBrowserShortcut, true)
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
        if (!surfaceRequest || consumedSurfaceRequestsRef.current.has(surfaceRequest.requestId) || cancelledSurfaceRequestsRef.current.has(surfaceRequest.requestId)) return
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
            mode === 'open' ? surfaceRequest.sessionMode || 'incognito' : 'normal'
        )
        if (requestedTabIds.some((tabId) => !requestedState.tabs.some((tab) => tab.id === tabId))) {
            failSurfaceRequest(surfaceRequest, `Close a Browser tab first; the ${ASSISTANT_BROWSER_TAB_LIMIT}-tab limit is full.`)
            return
        }
        mutateWorkspaceState(() => requestedState)
        transitionToBrowserTab(surfaceRequest.tabId)
        if (knownTargetId) {
            void complete(true).finally(() => onSurfaceRequestHandledRef.current(surfaceRequest.requestId))
        } else {
            pendingSurfaceRequestsRef.current.set(surfaceRequest.requestId, surfaceRequest)
        }
    }, [closeTab, configError, controlTargetsByTab, failSurfaceRequest, mutateWorkspaceState, normalizedProjectPath, surfaceRequest, threadId, transitionToBrowserTab])

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

    const openActiveDevTools = useCallback(async () => {
        try {
            const { tabId, target } = getActiveDeveloperTarget()
            if (annotationTabIdRef.current === tabId) cancelAnnotation()
            const result = await window.devscope.openBrowserPreviewDevTools(target)
            if (!result.success) throw new Error(result.error || 'Could not open Browser DevTools.')
            setProfileMenuOpen(false)
        } catch (error) {
            onDeveloperToast({ tone: 'error', message: error instanceof Error ? error.message : 'Could not open Browser DevTools.' })
        }
    }, [cancelAnnotation, getActiveDeveloperTarget, onDeveloperToast])

    const captureActiveScreenshot = useCallback(async () => {
        try {
            const { target } = getActiveDeveloperTarget()
            const result = await window.devscope.captureBrowserPreviewScreenshot(target)
            if (!result.success) throw new Error(result.error || 'Could not capture the Browser tab.')
            onDeveloperToast({ message: '', artifact: result.artifact })
        } catch (error) {
            onDeveloperToast({ tone: 'error', message: error instanceof Error ? error.message : 'Could not capture the Browser tab.' })
        }
    }, [getActiveDeveloperTarget, onDeveloperToast])

    const toggleAnnotation = useCallback(async () => {
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
                theme: readBrowserAnnotationTheme()
            })
            if (!result.success) throw new Error(result.error || 'Could not annotate the Browser tab.')
            if (result.annotation && result.artifact) {
                const staged = await window.devscope.stageBrowserPreviewArtifactForAssistant(result.artifact.artifactId)
                if (!staged.success) throw new Error(staged.error || 'Could not attach the Browser annotation to chat.')
                publishAssistantBrowserAnnotationAttachment({
                    sessionId: workspaceKey,
                    reference: staged.reference,
                    annotation: result.annotation,
                    artifact: result.artifact
                })
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
    }, [cancelAnnotation, getActiveDeveloperTarget, onDeveloperToast, workspaceKey])

    const toggleActiveRecording = useCallback(async () => {
        try {
            const { tabId, target, handle } = getActiveDeveloperTarget()
            if (annotationTabIdRef.current === tabId) cancelAnnotation()
            if (recordingTabId) {
                if (recordingTabId !== tabId) throw new Error('Another Browser tab is already recording.')
                const artifact = await stopAssistantBrowserRecording(target)
                setRecordingTabId(null)
                onDeveloperToast({ message: 'Browser recording saved.', artifact })
                return
            }
            await startAssistantBrowserRecording(target, handle.getViewportSize())
            setRecordingTabId(tabId)
            onDeveloperToast({ message: 'Recording this Browser tab.' })
        } catch (error) {
            setRecordingTabId(readActiveAssistantBrowserRecordingTabId())
            onDeveloperToast({ tone: 'error', message: error instanceof Error ? error.message : 'Could not change Browser recording state.' })
        }
    }, [cancelAnnotation, getActiveDeveloperTarget, onDeveloperToast, recordingTabId])

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
            setHistorySearch({ query: '', entries: [] })
            setHistoryClearArmed(false)
            setProfileMenuOpen(false)
            onDeveloperToast({ message: 'Zyra Browser history cleared.' })
        } catch (error: unknown) {
            onDeveloperToast({ tone: 'error', message: error instanceof Error ? error.message : 'Could not clear Browser history.' })
        }
    }, [historyClearArmed, onDeveloperToast])

    const clearHistoryFromPanel = useCallback(async () => {
        if (!window.confirm('Clear visited addresses and omnibox suggestions from Zyra Browser?')) return
        try {
            const result = await window.devscope.clearBrowserHistory()
            if (!result.success) throw new Error(result.error || 'Could not clear Browser history.')
            setBrowserHistory([])
            setHistorySearch({ query: '', entries: [] })
            setHistoryPanelSearch({ query: '', entries: [] })
            setHistoryPanelQuery('')
            onDeveloperToast({ message: 'Zyra Browser history cleared.' })
        } catch (error: unknown) {
            onDeveloperToast({ tone: 'error', message: error instanceof Error ? error.message : 'Could not clear Browser history.' })
        }
    }, [onDeveloperToast])

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
            setHistorySearch({ query: '', entries: [] })
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
    }, [clearProfileArmed, onDeveloperToast])

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
        <section className={cn('flex min-h-0 flex-1 flex-col overflow-hidden bg-sparkle-bg', browserFullscreen && 'fixed inset-0 z-[1100] bg-black')} aria-label="Browser workspace" data-browser-fullscreen={browserFullscreen ? 'true' : undefined}>
            <form
                className={cn('relative z-30 flex h-10 shrink-0 items-center gap-1 border-b border-[var(--surface-divider)] bg-sparkle-bg px-2', browserFullscreen && 'hidden')}
                onSubmit={(event) => {
                    event.preventDefault()
                    addressContainerRef.current?.querySelector<HTMLInputElement>('input')?.blur()
                    addressFocusedRef.current = false
                    omniboxPreparationGenerationRef.current += 1
                    setAddressFocused(false)
                    setOmniboxPresentationReady(false)
                    const selectedSuggestion = historyActiveIndex >= 0 ? omniboxSuggestions[historyActiveIndex] : null
                    void navigateActiveTab(selectedSuggestion?.value || addressValue)
                }}
            >
                <button type="button" onClick={() => activeTab && webviewRefs.current.get(activeTab.id)?.goBack()} disabled={!activeTab?.canGoBack} className={BROWSER_CHROME_BUTTON_CLASS} title="Back"><ArrowLeft size={14} /></button>
                <button type="button" onClick={() => activeTab && webviewRefs.current.get(activeTab.id)?.goForward()} disabled={!activeTab?.canGoForward} className={BROWSER_CHROME_BUTTON_CLASS} title="Forward"><ArrowRight size={14} /></button>
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
                    title={activeTab?.status === 'loading' ? 'Stop loading' : 'Reload'}
                >
                    {activeTab?.status === 'loading' ? <Square size={10} fill="currentColor" /> : <RotateCw size={13} />}
                </button>
                <button type="button" onClick={() => void showNewTabInActiveTab()} disabled={!activeTab?.url} className={BROWSER_CHROME_BUTTON_CLASS} title="New tab" aria-label="Show New Tab in the current Browser tab"><House size={13} /></button>
                <div
                    ref={addressContainerRef}
                    onBlurCapture={() => {
                        window.setTimeout(() => {
                            if (addressContainerRef.current?.contains(document.activeElement)) return
                            addressFocusedRef.current = false
                            omniboxPreparationGenerationRef.current += 1
                            setAddressFocused(false)
                            setOmniboxPresentationReady(false)
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
                                    prepareOmniboxPresentation()
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
                                        omniboxPreparationGenerationRef.current += 1
                                        setAddressFocused(false)
                                        setOmniboxPresentationReady(false)
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
                        </div>
                        {omniboxOpen ? (
                            <div id={BROWSER_HISTORY_LISTBOX_ID} role="listbox" className="max-h-72 overflow-y-auto border-t border-[color-mix(in_srgb,var(--color-text)_10%,transparent)] p-1" aria-label="Address and search suggestions">
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
                                                    <span aria-hidden="true" className="shrink-0 text-[9px] text-[color-mix(in_srgb,var(--color-text)_36%,transparent)]">—</span>
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
                            </div>
                        ) : null}
                    </div>
                </div>
                <AssistantBrowserDownloadsButton
                    api={browserDownloadsApi}
                    onOpenHere={openDownloadHere}
                    onBeforeOverlayOpen={prepareActiveBrowserOverlay}
                    onOverlayChange={setDownloadsOverlayOpen}
                />
                <button
                    type="button"
                    onClick={() => void toggleAnnotation()}
                    disabled={!activeTab?.url}
                    className={cn(BROWSER_CHROME_BUTTON_CLASS, annotationTabId === activeTab?.id && 'bg-[var(--surface-hover)] text-[var(--accent-primary)]')}
                    title={annotationTabId === activeTab?.id ? 'Cancel annotation' : 'Annotate page'}
                    aria-pressed={annotationTabId === activeTab?.id}
                >
                    <Crosshair size={13} />
                </button>
                <button type="button" onClick={() => void captureActiveScreenshot()} disabled={!activeTab?.url} className={BROWSER_CHROME_BUTTON_CLASS} title="Capture screenshot"><Camera size={13} /></button>
                {activePendingGrant ? (
                    <div className="flex h-5 items-center gap-1 border border-sky-300/25 bg-sky-400/[0.08] px-1.5 text-[8px] text-sky-100" title="Review this Browser request in chat.">
                        <ShieldAlert size={9} />
                        <span>Waiting in chat</span>
                    </div>
                ) : activeControlGrant ? (
                    <div className="flex h-5 items-center gap-1 border border-amber-300/25 bg-amber-400/[0.08] px-1 text-[8px] text-amber-100" title={`Controlled by ${activeControlGrant.principal.type === 'root' ? 'root agent' : activeControlGrant.principal.agentRunId}`}>
                        <ShieldAlert size={9} />
                        <span>{Math.max(0, activeControlGrant.maxActions - activeControlGrant.actionCount)}</span>
                        <button type="button" onClick={() => void window.devscope.agentControl.revokeGrant(activeControlGrant.grantId)} className="px-0.5 hover:bg-white/[0.08]" title="Revoke Browser control">Revoke</button>
                        <button type="button" onClick={() => void window.devscope.agentControl.emergencyStop()} className="px-0.5 text-red-200 hover:bg-red-400/[0.12]" title="Emergency stop all control">Stop all</button>
                    </div>
                ) : null}
                <div ref={profileMenuRef} className="relative">
                    <button
                        type="button"
                        onClick={() => {
                            if (profileMenuOpen) {
                                setProfileMenuOpen(false)
                            } else {
                                void prepareActiveBrowserOverlay().then(() => setProfileMenuOpen(true))
                            }
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
                        <div className="absolute right-0 top-8 z-[380] w-64 rounded-[7px] border border-[var(--surface-divider)] bg-sparkle-card p-1 text-left shadow-[0_12px_30px_rgba(0,0,0,0.30)]">
                            <button type="button" onClick={() => activeTab && void openLocalFileInTab(activeTab.id)} disabled={!activeTab} title="Open file (Ctrl+O)" className={BROWSER_MENU_ROW_CLASS}><FileUp size={12} /><span>Open file</span></button>
                            <button type="button" onClick={() => void hardReloadActiveTab()} disabled={!activeTab?.url} className={BROWSER_MENU_ROW_CLASS}><RefreshCw size={12} /><span>Hard reload</span></button>
                            <button type="button" onClick={() => void openActiveDevTools()} disabled={!activeTab?.url} className={BROWSER_MENU_ROW_CLASS}><Code2 size={12} /><span>Open DevTools</span></button>
                            <button type="button" onClick={() => {
                                if (!activeTab) return
                                updateActiveViewport(activeTab.viewport.mode === 'fill'
                                    ? { mode: 'freeform', width: 1280, height: 800, presetId: null, aspectRatio: null }
                                    : { mode: 'fill' })
                                setProfileMenuOpen(false)
                            }} disabled={!activeTab} className={BROWSER_MENU_ROW_CLASS}><MonitorSmartphone size={12} /><span>{activeTab?.viewport.mode === 'fill' ? 'Show device toolbar' : 'Hide device toolbar'}</span></button>
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
                            <div className="my-1 h-px bg-[var(--surface-divider)]" />
                            <button type="button" onClick={() => void toggleActiveRecording()} disabled={!activeTab?.url || Boolean(recordingTabId && recordingTabId !== activeTab?.id)} className={cn(BROWSER_MENU_ROW_CLASS, recordingTabId === activeTab?.id && 'text-red-300')}><Circle size={11} fill={recordingTabId === activeTab?.id ? 'currentColor' : 'none'} /><span>{recordingTabId === activeTab?.id ? 'Stop and save recording' : 'Record Browser tab'}</span></button>
                            <button type="button" onClick={() => void openExternal()} disabled={!activeTab?.url || isBrowserLocalFileUrl(activeTab.url)} className={BROWSER_MENU_ROW_CLASS}><ExternalLink size={12} /><span>Open in default browser</span></button>
                            <div className="my-1 h-px bg-[var(--surface-divider)]" />
                            <button type="button" onClick={() => {
                                setProfileMenuOpen(false)
                                setDownloadsPanelOpen(false)
                                setHistoryPanelQuery('')
                                setHistoryPanelOpen(true)
                            }} className={BROWSER_MENU_ROW_CLASS}><Clock3 size={12} /><span>History</span></button>
                            <button type="button" onClick={() => {
                                setProfileMenuOpen(false)
                                setHistoryPanelOpen(false)
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
                            <button type="button" onClick={() => void clearHistory()} className={cn(BROWSER_MENU_ROW_CLASS, historyClearArmed && 'text-red-300')}><Clock3 size={12} /><span>{historyClearArmed ? 'Confirm clear history' : 'Clear history'}</span></button>
                            <button type="button" onClick={() => void clearBrowserCookies()} className={cn(BROWSER_MENU_ROW_CLASS, siteSignOutArmed && 'text-red-300')}><ShieldCheck size={12} /><span>{siteSignOutArmed ? 'Confirm sign out of websites' : 'Sign out of websites'}</span></button>
                            <button type="button" onClick={() => void clearBrowserCache()} className={BROWSER_MENU_ROW_CLASS}><Trash2 size={12} /><span>Clear temporary cache</span></button>
                            <button type="button" onClick={() => void clearLocalBrowserProfile()} disabled={clearingProfile} title="Clear the shared Local Zyra profile used by Browser tabs across chats and projects" className={cn(BROWSER_MENU_ROW_CLASS, clearProfileArmed && 'text-red-300')}>
                                {clearingProfile ? <LoaderCircle size={11} className="animate-spin" /> : <Trash2 size={11} />}
                                <span>{clearingProfile ? 'Resetting Browser profile' : clearProfileArmed ? 'Confirm reset Browser profile' : 'Reset Browser profile'}</span>
                            </button>
                            {profileNotice ? <p className="px-2 py-1 text-[9px] leading-3.5 text-[color-mix(in_srgb,var(--color-text)_58%,transparent)]">{profileNotice.message}</p> : null}
                        </div>
                    ) : null}
                </div>
            </form>

            {!browserFullscreen && addressError ? <div className="shrink-0 border-b border-red-500/15 bg-red-500/[0.06] px-2 py-1 text-[9px] text-red-300">{addressError}</div> : null}
            {!browserFullscreen && config.protectedMedia?.message ? <div className="shrink-0 border-b border-amber-400/15 bg-amber-400/[0.06] px-2 py-1 text-[9px] text-amber-200">{config.protectedMedia.message}</div> : null}
            {!browserFullscreen && spotifyNeedsProductionVmp ? <div className="shrink-0 border-b border-amber-400/15 bg-amber-400/[0.06] px-2 py-1 text-[9px] text-amber-100">Spotify may skip tracks in this development build because its DRM can require production signing. Your Spotify account is unaffected. Final playback must be checked in the signed Zyra release.</div> : null}
            {!browserFullscreen && activeTab?.viewport.mode !== 'fill' ? (
                <AssistantBrowserDeviceToolbar
                    viewport={activeTab.viewport}
                    onViewportChange={updateActiveViewport}
                    onClose={() => updateActiveViewport({ mode: 'fill' })}
                />
            ) : null}

            <div className="relative isolate min-h-0 flex-1 overflow-hidden bg-white">
                {workspaceState.tabs.map((tab) => {
                    const visible = active && tab.id === activeTab?.id
                    const shellOverlayOpen = visible && (
                        (!tab.url && tab.status === 'idle')
                        || tab.status === 'error'
                        || omniboxOpen
                        || profileMenuOpen
                        || downloadsOverlayOpen
                        || downloadsPanelOpen
                        || historyPanelOpen
                        || historyImportOpen
                        || threatWarning?.tabId === tab.id
                        || adBlockPrompt?.tabId === tab.id
                    )
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
                            onViewportChange={(viewport) => {
                                mutateWorkspaceState((current) => updateAssistantBrowserTab(current, tab.id, { viewport }))
                            }}
                        >
                            <AssistantBrowserWebview
                                ref={getWebviewRefCallback(tab.id)}
                                tab={tab}
                                threadId={threadId}
                                config={config}
                                active={visible}
                                visible={visible && !shellOverlayOpen}
                                placement="full"
                                controlled={Boolean(grant)}
                                cursor={cursor}
                                onStateChange={handleWebviewStateChange}
                                onControlTargetChange={handleControlTargetChange}
                                onFullscreenChange={handleFullscreenChange}
                                onViewportRectChange={handleViewportRectChange}
                            />
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

                {activeTab?.status === 'idle' && !activeTab.url ? (
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
                            setHistoryPanelQuery('')
                            setHistoryPanelOpen(true)
                        }}
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

                {activeTab?.status === 'error' && activeTab.error ? (
                    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 border-b border-red-500/15 bg-sparkle-bg px-2 py-1 text-[9px] text-red-300 shadow-sm">
                        {activeTab.error}
                    </div>
                ) : null}

                {activeTab?.status === 'loading' ? <div className="pointer-events-none absolute inset-x-0 top-0 z-30 h-px overflow-hidden bg-[var(--accent-primary)]/15 after:block after:h-full after:w-1/3 after:animate-[browser-loading-slide_1.1s_ease-in-out_infinite] after:bg-[var(--accent-primary)]" /> : null}
            </div>
        </section>
    )
})
