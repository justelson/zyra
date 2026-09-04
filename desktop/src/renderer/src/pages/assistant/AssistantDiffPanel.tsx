import { lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type TransitionEvent as ReactTransitionEvent, type UIEvent } from 'react'
import { Bot, FileDiff, Files, Globe2, Library, LoaderCircle, MessageSquareText, PanelRight, ShieldAlert, SquareTerminal, TriangleAlert, Volume2 } from 'lucide-react'
import type { AssistantChatScopeRoot, FleetSnapshot } from '@shared/assistant/contracts'
import type { AssistantFilesShellLaunchRequest } from '@shared/assistant/files-shell-launch-route'
import type { ControlStateSnapshot, ControlWorkspaceSnapshot } from '@shared/agent-control/contracts'
import type { BrowserSurfaceOpenRequest } from '@shared/agent-control/protocol'
import type { BrowserSessionMode } from '@shared/browser-view'
import type {
    AssistantUtilityAgentsStateCapsule,
    AssistantUtilityExplorerStateCapsule,
    AssistantUtilityResourcesStateCapsule,
    AssistantUtilityStateCapsule,
    AssistantUtilityTab,
    AssistantUtilityWorkspaceKind
} from '@shared/assistant/utility-window'
import { isElectronRendererRuntime } from '@/lib/browser-file-url'
import type { PreviewOpenOptions } from '@/components/ui/file-preview/types'
import type { FileActionsMenuItem } from '@/components/ui/FileActionsMenu'
import { PreviewTreeSkeleton } from '@/components/ui/file-preview/PreviewLoadingSkeleton'
import { FileEntryIcon } from '@/components/ui/FileEntryIcon'
import { IncognitoIcon } from '@/components/ui/IncognitoIcon'
import { preloadPreviewRenderer } from '@/components/ui/file-preview/useFilePreview'
import { warmPreviewFileSearchIndex } from '@/components/ui/file-preview/usePreviewFileSearch'
import { useSettings } from '@/lib/settings'
import { captureProductEventOnce } from '@/lib/product-analytics'
import { normalizeAnalyticsWorkspaceKind as analyticsWorkspaceKind } from '@shared/analytics/contracts'
import type { AssistantDiffTarget, AssistantDiffTurn } from './assistant-diff-types'
import { AssistantBrowserPageIcon } from './AssistantBrowserPageIcon'
import type { AssistantBrowserWorkspaceController } from './AssistantBrowserWorkspace'
import { captureAssistantBrowserTabHoverPreview } from './assistant-browser-tab-hover-preview'
import {
    acknowledgeAssistantInspectorNavigation,
    subscribeAssistantInspectorNavigation
} from './assistant-inspector-navigation'
import {
    ASSISTANT_BROWSER_DANGEROUS_TAB_TITLE,
    ASSISTANT_BROWSER_TAB_LIMIT,
    hasPersistedAssistantBrowserWorkspaceState,
    loadAssistantBrowserWorkspaceState,
    type AssistantBrowserTabState,
    type AssistantBrowserWorkspaceState
} from './assistant-browser-workspace-state'
import {
    ensureAssistantInspectorBrowserTab,
    loadAssistantInspectorWorkspaceState,
    persistAssistantInspectorWorkspaceState,
    reconcileAssistantInspectorBrowserTabs,
    reorderAssistantInspectorWorkspaceTabs,
    restoreAssistantInspectorWorkspaceState,
    type AssistantInspectorWorkspaceTab
} from './assistant-inspector-workspace-state'
import { AssistantInspectorSidebar, type AssistantInspectorTab } from './AssistantInspectorSidebar'
import {
    AssistantInspectorDeveloperToast,
    useAssistantInspectorDeveloperToast
} from './AssistantInspectorDeveloperToast'
import { AssistantReviewLanding } from './AssistantReviewLanding'
import { AssistantTurnReview } from './AssistantTurnReview'
import { countAssistantThreadPendingControl } from './assistant-thread-details'
import { resolveDiffWorkspaceTabContext, resolveFilesWorkspaceTabContext } from './assistant-workspace-tab-context'
import { useAssistantFleetSnapshot } from './useAssistantFleetSnapshot'
import {
    capsuleWorkspaceForInspectorKind,
    captureAssistantUtilityScrollAnchor,
    resolveAssistantUtilityDiffSelection,
    restoreAssistantUtilityScrollAnchor,
    sanitizeRendererCapsule,
    toAssistantUtilityDiffSelection
} from './assistant-utility-state-capsules'

const AssistantFilesWorkspace = lazy(async () => ({
    default: (await import('./AssistantFilesWorkspace')).AssistantFilesWorkspace
}))
const AssistantTerminalWorkspace = lazy(async () => ({
    default: (await import('./AssistantTerminalWorkspace')).AssistantTerminalWorkspace
}))
const AssistantBrowserWorkspace = lazy(async () => ({
    default: (await import('./AssistantBrowserWorkspace')).AssistantBrowserWorkspace
}))
const AssistantResourcesWorkspace = lazy(async () => ({
    default: (await import('./AssistantResourcesWorkspace')).AssistantResourcesWorkspace
}))
const AssistantFleetWorkspace = lazy(async () => ({
    default: (await import('./AssistantFleetWorkspace')).AssistantFleetWorkspace
}))
const AssistantThreadDetailsWorkspace = lazy(async () => ({
    default: (await import('./AssistantControlWorkspace')).AssistantThreadDetailsWorkspace
}))

type WorkspaceTab = AssistantInspectorWorkspaceTab

const REVIEW_TAB: WorkspaceTab = { id: 'review', kind: 'review' }
const EXPLORER_TAB: WorkspaceTab = { id: 'explorer', kind: 'explorer' }
const TERMINAL_TAB: WorkspaceTab = { id: 'terminal', kind: 'terminal' }
const CONTROL_TAB: WorkspaceTab = { id: 'control', kind: 'control' }
const RESOURCES_TAB: WorkspaceTab = { id: 'resources', kind: 'resources' }
const AGENTS_TAB: WorkspaceTab = { id: 'agents', kind: 'agents' }
const MAIN_BROWSER_MOVE_READY_TIMEOUT_MS = 7_500
const REVIEW_NAVIGATION_MOTION_MS = 230

type AssistantBrowserNavigationRequest = {
    id: number
    tabId: string
    url: string
    sessionMode: BrowserSessionMode
}

export type AssistantDiffRevealRequest = {
    id: number
    turnId: string
}

export const AssistantDiffPanel = memo(function AssistantDiffPanel(props: {
    open: boolean
    sessionId: string | null
    threadId: string | null
    canonicalChatId: string | null
    chatTitle: string
    width: number
    maxWidth: number
    turns: AssistantDiffTurn[]
    reviewIndexReady: boolean
    reviewIndexLoading: boolean
    reviewIndexError: string | null
    turnDetailError: string | null
    activeTurnId: string | null
    revealRequest: AssistantDiffRevealRequest | null
    selectedTurnId: string | null
    selectedDiff: AssistantDiffTarget | null
    projectPath: string | null
    projectRoots: AssistantChatScopeRoot[]
    filesShellLaunchRequest: AssistantFilesShellLaunchRequest | null
    onFilesShellLaunchRequestHandled: (requestId: string) => void
    fleetSnapshot: FleetSnapshot | null
    browserSurfaceRequest: BrowserSurfaceOpenRequest | null
    onBrowserSurfaceRequestHandled: (requestId: string) => void
    onOpenPreview: (file: { name: string; path: string }, ext: string, options?: PreviewOpenOptions) => Promise<void>
    onOpenPreviewInNewTab: (file: { name: string; path: string }, ext: string, options?: PreviewOpenOptions) => Promise<void>
    onWidthChange: (width: number) => void
    onSelectTurn: (turnId: string) => void
    onSelectDiff: (target: AssistantDiffTarget) => void
    onRevealRequestHandled: (requestId: number) => void
    onClose: () => void
}) {
    const {
        open,
        sessionId,
        threadId,
        canonicalChatId,
        chatTitle,
        width,
        maxWidth,
        turns,
        reviewIndexReady,
        reviewIndexLoading,
        reviewIndexError,
        turnDetailError,
        activeTurnId,
        revealRequest,
        selectedTurnId,
        selectedDiff,
        projectPath,
        projectRoots,
        filesShellLaunchRequest,
        onFilesShellLaunchRequestHandled,
        fleetSnapshot,
        browserSurfaceRequest,
        onBrowserSurfaceRequestHandled,
        onOpenPreview,
        onOpenPreviewInNewTab,
        onWidthChange,
        onSelectTurn,
        onSelectDiff,
        onRevealRequestHandled,
        onClose
    } = props
    const { settings } = useSettings()
    const browserWorkspaceKey = sessionId || projectPath || 'detached'
    const reviewFileRevealSequenceRef = useRef(-1)
    const browserNavigationSequenceRef = useRef(1)
    const browserUiTabSequenceRef = useRef(1)
    const processedBrowserSurfaceRequestRef = useRef<string | null>(null)
    const processedFilesShellLaunchRequestRef = useRef<string | null>(null)
    const pendingBrowserTabIdsRef = useRef(new Set<string>())
    const pendingMainBrowserMovesRef = useRef(new Map<string, Set<string>>())
    const pendingMainBrowserMoveTimersRef = useRef(new Map<string, number>())
    const pendingMainTerminalMovesRef = useRef(new Set<string>())
    const browserControllerRef = useRef<AssistantBrowserWorkspaceController | null>(null)
    const loadingTimerRef = useRef(0)
    const capsuleRootRef = useRef<HTMLDivElement | null>(null)
    const reviewIndexSurfaceRef = useRef<HTMLDivElement | null>(null)
    const reviewDetailSurfaceRef = useRef<HTMLDivElement | null>(null)
    const reviewNavigationAnimationsRef = useRef<Animation[]>([])
    const previousReviewDetailPresentedRef = useRef(false)
    const utilityTabIdByWorkspaceIdRef = useRef(new Map<string, string>())
    const capsuleByUtilityTabIdRef = useRef(new Map<string, AssistantUtilityStateCapsule>())
    const [activeTabId, setActiveTabId] = useState<string>(REVIEW_TAB.id)
    const [workspaceTabs, setWorkspaceTabs] = useState<WorkspaceTab[]>([REVIEW_TAB])
    const defaultTerminalRuntimeId = `assistant-terminal:${sessionId || canonicalChatId || threadId || 'detached'}`
    const [terminalRuntimeId, setTerminalRuntimeId] = useState(defaultTerminalRuntimeId)
    const [terminalMountRevision, setTerminalMountRevision] = useState(0)
    const activeTabIdRef = useRef(activeTabId)
    const workspaceTabsRef = useRef(workspaceTabs)
    activeTabIdRef.current = activeTabId
    workspaceTabsRef.current = workspaceTabs
    const fleetWorkspaceRequested = workspaceTabs.some((tab) => tab.kind === 'agents' || tab.kind === 'control')
    const { snapshot: effectiveFleetSnapshot, loading: fleetSnapshotLoading } = useAssistantFleetSnapshot({
        threadId,
        projected: fleetSnapshot,
        enabled: open && fleetWorkspaceRequested
    })
    const [workspaceHydratedKey, setWorkspaceHydratedKey] = useState<string | null>(null)
    const [reviewTurnId, setReviewTurnId] = useState<string | null>(null)
    const [reviewTransitionTurnId, setReviewTransitionTurnId] = useState<string | null>(null)
    const [reviewDetailPresented, setReviewDetailPresented] = useState(false)
    const [focusedDiffRequestId, setFocusedDiffRequestId] = useState<number | null>(null)
    const [transitionLoadingTabId, setTransitionLoadingTabId] = useState<string | null>(null)
    const [contentLoadingTabId, setContentLoadingTabId] = useState<string | null>(null)
    const [browserTabs, setBrowserTabs] = useState<AssistantBrowserTabState[]>([])
    const [browserActiveTabId, setBrowserActiveTabId] = useState<string | null>(null)
    const [browserNavigationRequest, setBrowserNavigationRequest] = useState<AssistantBrowserNavigationRequest | null>(null)
    const [selectedAgentRunId, setSelectedAgentRunId] = useState<string | null>(null)
    const [selectedWorkflowRunId, setSelectedWorkflowRunId] = useState<string | null>(null)
    const [hydrationCapsules, setHydrationCapsules] = useState<Record<string, AssistantUtilityStateCapsule | undefined>>({})
    const [resourceDrillDownTurnId, setResourceDrillDownTurnId] = useState<string | null>(null)
    const [resourceDrillDownDiff, setResourceDrillDownDiff] = useState<AssistantDiffTarget | null>(null)
    const [explorerViewCapsule, setExplorerViewCapsule] = useState<AssistantUtilityExplorerStateCapsule | null>(null)
    const [filesShellLaunchRoot, setFilesShellLaunchRoot] = useState<{ workspaceKey: string; folderPath: string } | null>(null)
    const [controlState, setControlState] = useState<ControlStateSnapshot | null>(null)
    const [browserWorkspaceState, setBrowserWorkspaceState] = useState<ControlWorkspaceSnapshot['browser']>({
        open: false,
        activeTabId: null,
        splitTabId: null,
        visibleTabIds: [],
        tabs: []
    })
    const { developerToast, showDeveloperToast, dismissDeveloperToast } = useAssistantInspectorDeveloperToast()

    const filesProjectPath = filesShellLaunchRoot?.workspaceKey === browserWorkspaceKey
        ? filesShellLaunchRoot.folderPath
        : filesShellLaunchRequest?.folderPath || projectPath

    const ensureUtilityTabId = useCallback((workspaceTabId: string, workspace: AssistantUtilityWorkspaceKind) => {
        const existing = utilityTabIdByWorkspaceIdRef.current.get(workspaceTabId)
        if (existing) return existing
        const id = `utility:${canonicalChatId || threadId || 'detached'}:${workspace}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 9)}`
        utilityTabIdByWorkspaceIdRef.current.set(workspaceTabId, id)
        return id
    }, [canonicalChatId, threadId])

    const recordWorkspaceCapsule = useCallback((workspaceTabId: string, capsule: AssistantUtilityStateCapsule) => {
        const workspace = capsuleWorkspaceForInspectorKind(workspaceTabsRef.current.find((tab) => tab.id === workspaceTabId)?.kind || '')
        if (!workspace) return
        const sanitized = sanitizeRendererCapsule(capsule, workspace)
        if (!sanitized) return
        const utilityTabId = ensureUtilityTabId(workspaceTabId, workspace)
        capsuleByUtilityTabIdRef.current.set(utilityTabId, sanitized)
    }, [ensureUtilityTabId])

    const readWorkspaceCapsule = useCallback((workspaceTabId: string, workspace: AssistantUtilityWorkspaceKind) => {
        const utilityTabId = utilityTabIdByWorkspaceIdRef.current.get(workspaceTabId)
        const current = utilityTabId ? capsuleByUtilityTabIdRef.current.get(utilityTabId) : undefined
        if (current?.workspace === workspace) return current
        const hydrated = hydrationCapsules[workspaceTabId]
        return hydrated?.workspace === workspace ? hydrated : undefined
    }, [hydrationCapsules])

    const beginTabTransition = useCallback((tabId: string) => {
        window.clearTimeout(loadingTimerRef.current)
        setTransitionLoadingTabId(tabId)
        loadingTimerRef.current = window.setTimeout(() => {
            setTransitionLoadingTabId((current) => current === tabId ? null : current)
        }, 480)
    }, [])

    const handleTurnLoadingChange = useCallback((loading: boolean) => {
        setContentLoadingTabId((current) => loading ? activeTabId : current === activeTabId ? null : current)
    }, [activeTabId])

    useEffect(() => () => window.clearTimeout(loadingTimerRef.current), [])

    useEffect(() => {
        if (!filesProjectPath) return
        const warmFilesWorkspace = () => {
            void import('./AssistantFilesWorkspace')
            preloadPreviewRenderer('code')
            void warmPreviewFileSearchIndex(filesProjectPath)
        }
        if (typeof window.requestIdleCallback === 'function') {
            const idleId = window.requestIdleCallback(warmFilesWorkspace, { timeout: 1200 })
            return () => window.cancelIdleCallback(idleId)
        }
        const timeoutId = window.setTimeout(warmFilesWorkspace, 240)
        return () => window.clearTimeout(timeoutId)
    }, [filesProjectPath])

    useEffect(() => {
        let cancelled = false
        void window.devscope.agentControl.getState().then((result) => {
            if (!cancelled && result.success) setControlState(result.state)
        })
        const unsubscribe = window.devscope.agentControl.onStateChange((state) => {
            if (!cancelled) setControlState(state)
        })
        const unsubscribeCursor = window.devscope.agentControl.onCursorChange((cursor) => {
            if (cancelled) return
            setControlState((current) => current ? {
                ...current,
                cursors: [...current.cursors.filter((entry) => entry.targetId !== cursor.targetId), cursor]
            } : current)
        })
        return () => { cancelled = true; unsubscribe(); unsubscribeCursor() }
    }, [])

    const pendingControlCount = countAssistantThreadPendingControl(controlState, threadId)

    useEffect(() => {
        if (pendingControlCount === 0) return
        setWorkspaceTabs((current) => current.some((tab) => tab.kind === 'control') ? current : [...current, CONTROL_TAB])
        setActiveTabId((current) => current || CONTROL_TAB.id)
    }, [pendingControlCount])

    useEffect(() => {
        const utility = window.devscope.assistantUtility
        for (const [browserTabId, requestIds] of pendingMainBrowserMovesRef.current) {
            browserControllerRef.current?.closeTab(browserTabId)
            for (const requestId of requestIds) {
                window.clearTimeout(pendingMainBrowserMoveTimersRef.current.get(requestId))
                if (utility) void utility.completeIncomingMainTab(requestId, false, 'The destination chat changed before the Browser tab became ready.')
            }
        }
        pendingMainBrowserMoveTimersRef.current.clear()
        pendingMainBrowserMovesRef.current.clear()
        for (const requestId of pendingMainTerminalMovesRef.current) {
            if (utility) void utility.completeIncomingMainTab(requestId, false, 'The destination chat changed before the Terminal became ready.')
        }
        pendingMainTerminalMovesRef.current.clear()
        void window.devscope.agentControl.updateWorkspaceState(null)
        const hasPersistedBrowser = settings.assistantBrowserRestoreTabs
            && hasPersistedAssistantBrowserWorkspaceState(browserWorkspaceKey)
        const persistedBrowser: AssistantBrowserWorkspaceState = settings.assistantBrowserRestoreTabs
            ? loadAssistantBrowserWorkspaceState(browserWorkspaceKey)
            : { version: 1, activeTabId: '', splitTabId: null, tabs: [] }
        const restoredBrowserTabIds = hasPersistedBrowser
            ? persistedBrowser.tabs.map((tab) => tab.id)
            : []
        const restoredWorkspace = restoreAssistantInspectorWorkspaceState(
            loadAssistantInspectorWorkspaceState(browserWorkspaceKey),
            restoredBrowserTabIds
        )
        const desktopBrowserAvailable = isElectronRendererRuntime()
        const supportedWorkspaceTabs = desktopBrowserAvailable
            ? restoredWorkspace.tabs
            : restoredWorkspace.tabs.filter((tab) => tab.kind !== 'browser')
        const nextWorkspaceTabs = supportedWorkspaceTabs.length > 0 ? supportedWorkspaceTabs : [REVIEW_TAB]
        const nextActiveTabId = nextWorkspaceTabs.some((tab) => tab.id === restoredWorkspace.activeTabId)
            ? restoredWorkspace.activeTabId
            : nextWorkspaceTabs[0].id
        setActiveTabId(nextActiveTabId)
        setWorkspaceTabs(nextWorkspaceTabs)
        setTerminalRuntimeId(defaultTerminalRuntimeId)
        setTerminalMountRevision(0)
        setReviewTurnId(null)
        setReviewTransitionTurnId(null)
        setReviewDetailPresented(false)
        setFocusedDiffRequestId(null)
        setTransitionLoadingTabId(null)
        setContentLoadingTabId(null)
        setBrowserTabs(desktopBrowserAvailable ? persistedBrowser.tabs : [])
        setBrowserActiveTabId(desktopBrowserAvailable ? persistedBrowser.activeTabId : null)
        setBrowserNavigationRequest(null)
        setHydrationCapsules({})
        setResourceDrillDownTurnId(null)
        setResourceDrillDownDiff(null)
        setExplorerViewCapsule(null)
        utilityTabIdByWorkspaceIdRef.current.clear()
        capsuleByUtilityTabIdRef.current.clear()
        setBrowserWorkspaceState({ open: false, activeTabId: null, splitTabId: null, visibleTabIds: [], tabs: [] })
        browserControllerRef.current = null
        pendingBrowserTabIdsRef.current.clear()
        processedBrowserSurfaceRequestRef.current = null
        processedFilesShellLaunchRequestRef.current = null
        setWorkspaceHydratedKey(browserWorkspaceKey)
    }, [browserWorkspaceKey, defaultTerminalRuntimeId, settings.assistantBrowserRestoreTabs])

    useEffect(() => {
        if (
            !open
            || !filesShellLaunchRequest
            || workspaceHydratedKey !== browserWorkspaceKey
            || processedFilesShellLaunchRequestRef.current === filesShellLaunchRequest.id
        ) return

        const capsule: AssistantUtilityExplorerStateCapsule = {
            version: 1,
            workspace: 'explorer',
            currentFolderPath: filesShellLaunchRequest.folderPath
        }
        processedFilesShellLaunchRequestRef.current = filesShellLaunchRequest.id
        setFilesShellLaunchRoot({ workspaceKey: browserWorkspaceKey, folderPath: filesShellLaunchRequest.folderPath })
        setHydrationCapsules((current) => ({ ...current, [EXPLORER_TAB.id]: capsule }))
        setExplorerViewCapsule(capsule)
        setWorkspaceTabs((current) => current.some((tab) => tab.id === EXPLORER_TAB.id)
            ? current
            : [...current, EXPLORER_TAB])
        setActiveTabId(EXPLORER_TAB.id)
        beginTabTransition(EXPLORER_TAB.id)
        onFilesShellLaunchRequestHandled(filesShellLaunchRequest.id)
    }, [beginTabTransition, browserWorkspaceKey, filesShellLaunchRequest, onFilesShellLaunchRequestHandled, open, workspaceHydratedKey])

    useEffect(() => {
        if (workspaceHydratedKey !== browserWorkspaceKey) return
        persistAssistantInspectorWorkspaceState(browserWorkspaceKey, {
            version: 1,
            activeTabId,
            tabs: workspaceTabs
        })
    }, [activeTabId, browserWorkspaceKey, workspaceHydratedKey, workspaceTabs])

    useEffect(() => {
        if (!browserSurfaceRequest || processedBrowserSurfaceRequestRef.current === browserSurfaceRequest.requestId) return
        processedBrowserSurfaceRequestRef.current = browserSurfaceRequest.requestId
        if (!isElectronRendererRuntime()) {
            onBrowserSurfaceRequestHandled(browserSurfaceRequest.requestId)
            return
        }
        const mode = browserSurfaceRequest.mode || 'open'
        if (mode === 'close' || mode === 'external') return
        pendingBrowserTabIdsRef.current.add(browserSurfaceRequest.tabId)
        const browserTab: WorkspaceTab = {
            id: browserSurfaceRequest.tabId,
            kind: 'browser',
            browserTabId: browserSurfaceRequest.tabId
        }
        setWorkspaceTabs((current) => current.some((tab) => tab.id === browserTab.id)
            ? current
            : [...current, browserTab])
        if (browserSurfaceRequest.reveal) {
            setActiveTabId(browserTab.id)
            beginTabTransition(browserTab.id)
        }
    }, [beginTabTransition, browserSurfaceRequest, onBrowserSurfaceRequestHandled])

    useEffect(() => {
        if (!open || !revealRequest) return
        setWorkspaceTabs((current) => current.some((tab) => tab.kind === 'review')
            ? current
            : [...current, REVIEW_TAB])
        setActiveTabId('review')
        setReviewTurnId(revealRequest.turnId)
        setFocusedDiffRequestId(revealRequest.id)
        onRevealRequestHandled(revealRequest.id)
    }, [onRevealRequestHandled, open, revealRequest])

    useEffect(() => {
        if (!reviewIndexReady) return
        const invalidIds = new Set(workspaceTabs.flatMap((tab) => (
            tab.kind === 'turn' && !turns.some((turn) => turn.id === tab.turnId) ? [tab.id] : []
        )))
        if (invalidIds.size === 0) return
        const next = workspaceTabs.filter((tab) => !invalidIds.has(tab.id))
        setWorkspaceTabs(next)
        if (invalidIds.has(activeTabId)) setActiveTabId(next[0]?.id || '')
    }, [activeTabId, reviewIndexReady, turns, workspaceTabs])

    useEffect(() => {
        setReviewTurnId((current) => current && turns.some((turn) => turn.id === current) ? current : null)
    }, [turns])

    const reviewContextTurn = turns.find((turn) => turn.id === reviewTurnId) || null
    const reviewContextDiff = reviewContextTurn && selectedTurnId === reviewContextTurn.id
        ? selectedDiff
        : reviewContextTurn?.files[0]?.target || null
    const filesTabContext = useMemo(
        () => resolveFilesWorkspaceTabContext(explorerViewCapsule?.activePreview, filesProjectPath),
        [explorerViewCapsule?.activePreview, filesProjectPath]
    )
    const diffTabContext = useMemo(() => resolveDiffWorkspaceTabContext({
        turnCount: turns.length,
        turnNumber: reviewContextTurn?.number,
        filePath: reviewContextDiff?.filePath
    }), [reviewContextDiff?.filePath, reviewContextTurn?.number, turns.length])

    const tabs = useMemo<AssistantInspectorTab[]>(() => workspaceTabs.flatMap((tab) => {
        if (tab.kind === 'review') {
            return [{
                id: tab.id,
                label: diffTabContext.label,
                icon: reviewContextDiff?.filePath ? (
                    <FileEntryIcon pathValue={reviewContextDiff.filePath} kind="file" theme={settings.appearanceResolvedMode} className="size-3 shrink-0" />
                ) : <FileDiff size={12} />,
                count: turns.length,
                closable: true,
                loading: transitionLoadingTabId === tab.id || contentLoadingTabId === tab.id,
                preview: diffTabContext.preview
            }]
        }
        if (tab.kind === 'explorer') {
            return [{
                id: tab.id,
                label: filesTabContext.label,
                icon: explorerViewCapsule?.activePreview ? (
                    <FileEntryIcon pathValue={explorerViewCapsule.activePreview.path} kind="file" theme={settings.appearanceResolvedMode} className="size-3 shrink-0" />
                ) : <Files size={12} />,
                closable: true,
                loading: transitionLoadingTabId === tab.id,
                preview: filesTabContext.preview
            }]
        }
        if (tab.kind === 'terminal') {
            return [{
                id: tab.id,
                label: 'Terminal',
                icon: <SquareTerminal size={12} />,
                closable: true,
                loading: transitionLoadingTabId === tab.id,
                preview: projectPath ? `Terminal · ${projectPath}` : 'No project attached'
            }]
        }
        if (tab.kind === 'browser') {
            const browserTab = browserTabs.find((entry) => entry.id === tab.browserTabId)
            const dangerous = browserTab?.threatStatus === 'dangerous'
                || browserTab?.title === ASSISTANT_BROWSER_DANGEROUS_TAB_TITLE
            const controlTab = browserWorkspaceState.tabs.find((entry) => entry.tabId === tab.browserTabId)
            const pendingForTab = controlTab?.targetId
                ? controlState?.pendingGrants.filter((request) => request.targetId === controlTab.targetId).length || 0
                : 0
            return [{
                id: tab.id,
                label: browserTab?.url
                    ? browserTab.title || 'New tab'
                    : browserTab?.sessionMode === 'incognito' ? 'Incognito tab' : 'New tab',
                icon: dangerous
                    ? <TriangleAlert size={13} strokeWidth={2.4} className="text-[#ff5a63]" aria-label="Dangerous site blocked" />
                    : browserTab?.sessionMode === 'incognito'
                        ? <IncognitoIcon size={12} className="text-violet-300/85" aria-label="Incognito tab" />
                    : <AssistantBrowserPageIcon faviconUrl={browserTab?.faviconUrl || null} pageUrl={browserTab?.url || null} size={12} />,
                statusIcon: browserTab?.audible || pendingForTab > 0 ? (
                    <span className="flex items-center gap-0.5">
                        {browserTab?.audible ? <Volume2 size={10} aria-label="This Browser page is playing audio" /> : null}
                        {pendingForTab > 0 ? <ShieldAlert size={10} className="text-amber-300 motion-safe:animate-pulse" aria-label="Browser control approval needed" /> : null}
                    </span>
                ) : undefined,
                count: pendingForTab || undefined,
                attention: pendingForTab > 0,
                closable: true,
                loading: transitionLoadingTabId === tab.id || browserTab?.status === 'loading',
                preview: browserTab?.url || (projectPath ? `Browser · ${projectPath}` : 'No project attached'),
                previewDisabled: tab.id === activeTabId,
                loadPreviewImage: tab.id !== activeTabId && Boolean(browserTab?.url)
                    ? () => captureAssistantBrowserTabHoverPreview(tab.id)
                    : undefined
            }]
        }
        if (tab.kind === 'control') {
            return [{
                id: tab.id,
                label: 'Thread Details',
                icon: <PanelRight size={12} />,
                statusIcon: pendingControlCount > 0 ? <ShieldAlert size={10} className="text-amber-300 motion-safe:animate-pulse" aria-label="Thread approval needed" /> : undefined,
                count: pendingControlCount || undefined,
                attention: pendingControlCount > 0,
                closable: true,
                loading: transitionLoadingTabId === tab.id,
                preview: 'Current activity, context, usage, setup, and computer-use status'
            }]
        }
        if (tab.kind === 'resources') {
            return [{
                id: tab.id,
                label: 'Resources',
                icon: <Library size={12} />,
                closable: true,
                loading: transitionLoadingTabId === tab.id,
                preview: 'Image previews and links shared in this chat'
            }]
        }
        if (tab.kind === 'agents') {
            const agents = Object.values(effectiveFleetSnapshot?.agents ?? {})
            return [{
                id: tab.id,
                label: 'Agents',
                icon: <Bot size={12} />,
                count: agents.length || undefined,
                closable: true,
                loading: transitionLoadingTabId === tab.id || fleetSnapshotLoading,
                preview: `${Object.keys(effectiveFleetSnapshot?.agents ?? {}).length} child agents · ${Object.keys(effectiveFleetSnapshot?.workflows ?? {}).length} workflows`
            }]
        }
        const turn = turns.find((entry) => entry.id === tab.turnId)
        return turn ? [{
            id: tab.id,
            label: `Turn ${turn.number}`,
            icon: <MessageSquareText size={11} />,
            closable: true,
            loading: transitionLoadingTabId === tab.id || contentLoadingTabId === tab.id,
            preview: turn.prompt
        }] : []
    }), [activeTabId, browserTabs, browserWorkspaceState.tabs, contentLoadingTabId, controlState?.pendingActionApprovals, controlState?.pendingGrants, diffTabContext, effectiveFleetSnapshot, explorerViewCapsule?.activePreview, filesTabContext, fleetSnapshotLoading, pendingControlCount, reviewContextDiff?.filePath, settings.appearanceResolvedMode, transitionLoadingTabId, turns, workspaceTabs])

    const activeWorkspaceTab = workspaceTabs.find((tab) => tab.id === activeTabId) || workspaceTabs[0] || null
    useEffect(() => {
        if (!open || !activeWorkspaceTab || activeWorkspaceTab.kind === 'browser') return
        captureProductEventOnce(`workspace:${activeWorkspaceTab.kind}`, {
            event: 'zyra_v1_workspace_ui',
            properties: { action: 'workspace_select', workspace: analyticsWorkspaceKind(activeWorkspaceTab.kind) }
        })
    }, [activeWorkspaceTab?.kind, open])
    const activeTurnTab = activeWorkspaceTab?.kind === 'turn' ? activeWorkspaceTab : null
    const visibleTurnId = activeTurnTab?.turnId || (activeWorkspaceTab?.kind === 'review' ? reviewTurnId : null)
    const visibleTurn = turns.find((turn) => turn.id === visibleTurnId) || null
    const visibleSelectedDiff = visibleTurn && selectedTurnId === visibleTurn.id ? selectedDiff : visibleTurn?.files[0]?.target || null
    const reviewTransitionTurn = turns.find((turn) => turn.id === reviewTransitionTurnId) || null
    const reviewTransitionSelectedDiff = reviewTransitionTurn && selectedTurnId === reviewTransitionTurn.id
        ? selectedDiff
        : reviewTransitionTurn?.files[0]?.target || null
    const terminalOpen = workspaceTabs.some((tab) => tab.kind === 'terminal')
    const browserOpen = workspaceTabs.some((tab) => tab.kind === 'browser')
    const threadDetailsOpen = workspaceTabs.some((tab) => tab.kind === 'control')
    const resourcesOpen = workspaceTabs.some((tab) => tab.kind === 'resources')
    const filesOpen = workspaceTabs.some((tab) => tab.kind === 'explorer')
    const agentsOpen = workspaceTabs.some((tab) => tab.kind === 'agents')
    const reviewOpen = workspaceTabs.some((tab) => tab.kind === 'review')

    useEffect(() => {
        let stagingFrameId = 0
        let presentationFrameId = 0
        let releaseTimerId = 0
        const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
        if (reviewTurnId) {
            setReviewTransitionTurnId(reviewTurnId)
            if (reducedMotion) {
                setReviewDetailPresented(true)
            } else {
                setReviewDetailPresented(false)
                stagingFrameId = window.requestAnimationFrame(() => {
                    presentationFrameId = window.requestAnimationFrame(() => setReviewDetailPresented(true))
                })
            }
        } else {
            setReviewDetailPresented(false)
            if (reviewTransitionTurnId) {
                releaseTimerId = window.setTimeout(
                    () => setReviewTransitionTurnId((current) => current === reviewTransitionTurnId ? null : current),
                    reducedMotion ? 0 : REVIEW_NAVIGATION_MOTION_MS * 2
                )
            }
        }
        return () => {
            window.cancelAnimationFrame(stagingFrameId)
            window.cancelAnimationFrame(presentationFrameId)
            window.clearTimeout(releaseTimerId)
        }
    }, [reviewTransitionTurnId, reviewTurnId])

    useLayoutEffect(() => {
        const presentationChanged = previousReviewDetailPresentedRef.current !== reviewDetailPresented
        previousReviewDetailPresentedRef.current = reviewDetailPresented
        if (!presentationChanged) return

        for (const animation of reviewNavigationAnimationsRef.current) animation.cancel()
        reviewNavigationAnimationsRef.current = []

        const indexSurface = reviewIndexSurfaceRef.current
        const detailSurface = reviewDetailSurfaceRef.current
        if (!indexSurface || !detailSurface) return
        const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
            || document.body.classList.contains('zyra-reduce-motion')
        if (reducedMotion || typeof indexSurface.animate !== 'function') return

        const options: KeyframeAnimationOptions = {
            duration: REVIEW_NAVIGATION_MOTION_MS,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            fill: 'both'
        }
        const indexAnimation = indexSurface.animate(
            reviewDetailPresented
                ? [
                    { opacity: 1, transform: 'translate3d(0, 0, 0)' },
                    { opacity: 0, transform: 'translate3d(-12px, 0, 0)' }
                ]
                : [
                    { opacity: 0, transform: 'translate3d(-12px, 0, 0)' },
                    { opacity: 1, transform: 'translate3d(0, 0, 0)' }
                ],
            options
        )
        const detailAnimation = detailSurface.animate(
            reviewDetailPresented
                ? [
                    { opacity: 0, transform: 'translate3d(16px, 0, 0)' },
                    { opacity: 1, transform: 'translate3d(0, 0, 0)' }
                ]
                : [
                    { opacity: 1, transform: 'translate3d(0, 0, 0)' },
                    { opacity: 0, transform: 'translate3d(16px, 0, 0)' }
                ],
            options
        )
        reviewNavigationAnimationsRef.current = [indexAnimation, detailAnimation]
    }, [reviewDetailPresented])

    useEffect(() => () => {
        for (const animation of reviewNavigationAnimationsRef.current) animation.cancel()
        reviewNavigationAnimationsRef.current = []
    }, [])

    const handleReviewDetailTransitionEnd = useCallback((event: ReactTransitionEvent<HTMLDivElement>) => {
        if (
            event.target !== event.currentTarget
            || event.propertyName !== 'transform'
            || reviewDetailPresented
            || reviewTurnId
        ) return
        setReviewTransitionTurnId((current) => current === reviewTransitionTurnId ? null : current)
    }, [reviewDetailPresented, reviewTransitionTurnId, reviewTurnId])

    useEffect(() => {
        if (!activeWorkspaceTab) return
        const workspace = capsuleWorkspaceForInspectorKind(activeWorkspaceTab.kind)
        if (!workspace) return
        const capsule = readWorkspaceCapsule(activeWorkspaceTab.id, workspace)
        restoreAssistantUtilityScrollAnchor(capsuleRootRef.current, capsule?.scrollAnchor)
    }, [activeWorkspaceTab, readWorkspaceCapsule])

    const handleBrowserWorkspaceStateChange = useCallback((next: ControlWorkspaceSnapshot['browser']) => {
        setBrowserWorkspaceState((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next)
    }, [])

    const handleBrowserTabsChange = useCallback((next: AssistantBrowserWorkspaceState) => {
        for (const tab of next.tabs) pendingBrowserTabIdsRef.current.delete(tab.id)
        setBrowserTabs(next.tabs)
        setBrowserActiveTabId(next.activeTabId)
        setActiveTabId((current) => current.startsWith('browser:')
            ? next.activeTabId || current
            : current)
    }, [])

    const browserTabIdentity = browserTabs.map((tab) => tab.id).join('|')
    useEffect(() => {
        if (!browserOpen) return
        const pendingBrowserTabIds = [...pendingBrowserTabIdsRef.current]
        const validIds = new Set([
            ...browserTabs.map((tab) => tab.id),
            ...pendingBrowserTabIds
        ])
        setWorkspaceTabs((current) => reconcileAssistantInspectorBrowserTabs(
            current,
            browserTabs.map((tab) => tab.id),
            pendingBrowserTabIds
        ))
        setActiveTabId((current) => current.startsWith('browser:') && !validIds.has(current)
            ? browserActiveTabId || browserTabs[0]?.id || ''
            : current)
    }, [browserActiveTabId, browserOpen, browserTabIdentity, browserTabs])

    useEffect(() => {
        const activeWorkspace = open && activeWorkspaceTab
            ? activeWorkspaceTab.kind === 'turn' ? 'turn' : activeWorkspaceTab.kind
            : null
        const openWorkspaces = [...new Set(workspaceTabs.map((tab) => tab.kind === 'turn' ? 'turn' as const : tab.kind))]
        const browserVisible = open && activeWorkspace === 'browser' && browserOpen
        const browser = {
            ...browserWorkspaceState,
            open: browserOpen,
            visibleTabIds: browserVisible ? browserWorkspaceState.visibleTabIds : [],
            tabs: browserWorkspaceState.tabs.map((tab) => ({
                ...tab,
                position: browserVisible ? tab.position : null,
                visible: browserVisible && tab.visible
            }))
        }
        void window.devscope.agentControl.updateWorkspaceState({
            version: 1,
            threadId,
            inspector: {
                open,
                width: open ? width : null,
                activeWorkspace,
                openWorkspaces
            },
            browser,
            updatedAt: new Date().toISOString()
        })
    }, [activeWorkspaceTab, browserOpen, browserWorkspaceState, open, threadId, width, workspaceTabs])

    useEffect(() => () => {
        void window.devscope.agentControl.updateWorkspaceState(null)
    }, [])

    const selectTurn = useCallback((turnId: string) => {
        onSelectTurn(turnId)
    }, [onSelectTurn])

    const openSingletonWorkspace = useCallback((workspace: WorkspaceTab) => {
        setWorkspaceTabs((current) => current.some((tab) => tab.id === workspace.id)
            ? current
            : [...current, workspace])
        setActiveTabId(workspace.id)
        beginTabTransition(workspace.id)
    }, [beginTabTransition])

    const handleOpenReviewWorkspace = useCallback(() => {
        setFocusedDiffRequestId(null)
        setReviewTurnId(null)
        openSingletonWorkspace(REVIEW_TAB)
    }, [openSingletonWorkspace])
    const handleOpenExplorerWorkspace = useCallback(() => openSingletonWorkspace(EXPLORER_TAB), [openSingletonWorkspace])
    const handleOpenTerminalWorkspace = useCallback(() => openSingletonWorkspace(TERMINAL_TAB), [openSingletonWorkspace])
    const openBrowserSurface = useCallback((
        url = '',
        forceNew = false,
        requestedTabId?: string,
        sessionMode: BrowserSessionMode = 'normal'
    ) => {
        const reusableBlankTab = !forceNew && !requestedTabId && !browserOpen
            ? browserTabs.find((tab) => tab.sessionMode === sessionMode && !tab.url && tab.status === 'idle') || null
            : null
        const controller = browserControllerRef.current
        const browserTabId = reusableBlankTab?.id
            || controller?.createTab(url, { tabId: requestedTabId, sessionMode })
            || requestedTabId
            || `browser:desktop:${Date.now().toString(36)}:${browserUiTabSequenceRef.current++}`
        const knownBrowserTabs = browserOpen
            ? []
            : browserTabs.map<WorkspaceTab>((tab) => ({ id: tab.id, kind: 'browser', browserTabId: tab.id }))
        if (!browserTabs.some((tab) => tab.id === browserTabId)) pendingBrowserTabIdsRef.current.add(browserTabId)
        const browserSurface: WorkspaceTab = { id: browserTabId, kind: 'browser', browserTabId }
        setWorkspaceTabs((current) => {
            const next = current.slice()
            for (const tab of [...knownBrowserTabs, browserSurface]) {
                if (!next.some((entry) => entry.id === tab.id)) next.push(tab)
            }
            return next
        })
        setActiveTabId(browserTabId)
        beginTabTransition(browserTabId)
        controller?.activateTab(browserTabId)
        if (!controller) {
            setBrowserNavigationRequest({ id: browserNavigationSequenceRef.current++, tabId: browserTabId, url, sessionMode })
        }
        return browserTabId
    }, [beginTabTransition, browserOpen, browserTabs])
    const handleOpenBrowserWorkspace = useCallback(() => { openBrowserSurface() }, [openBrowserSurface])
    const handleOpenIncognitoBrowserWorkspace = useCallback(() => { openBrowserSurface('', true, undefined, 'incognito') }, [openBrowserSurface])
    const handleOpenThreadDetailsWorkspace = useCallback(() => openSingletonWorkspace(CONTROL_TAB), [openSingletonWorkspace])
    const handleOpenResourcesWorkspace = useCallback(() => openSingletonWorkspace(RESOURCES_TAB), [openSingletonWorkspace])
    const handleOpenAgentsWorkspace = useCallback(() => openSingletonWorkspace(AGENTS_TAB), [openSingletonWorkspace])
    useEffect(() => subscribeAssistantInspectorNavigation((request) => {
        openSingletonWorkspace(AGENTS_TAB)
        if ('agentRunId' in request) {
            setSelectedWorkflowRunId(null)
            setSelectedAgentRunId(request.agentRunId)
        } else {
            setSelectedAgentRunId(null)
            setSelectedWorkflowRunId(request.workflowRunId)
        }
        acknowledgeAssistantInspectorNavigation(request)
    }), [openSingletonWorkspace])

    const handleAgentAction = useCallback((action: 'stop' | 'retry' | 'resume', agentRunId: string) => {
        if (!threadId) return
        void window.devscope.assistant.agentAction({ threadId, action, payload: { agentRunId } })
    }, [threadId])

    const handleWorkflowAction = useCallback((action: 'pause' | 'resume' | 'stop' | 'restart' | 'save', workflowRunId: string) => {
        if (!threadId) return
        void window.devscope.assistant.workflowAction({ threadId, action, payload: { workflowRunId, scope: 'personal' } })
    }, [threadId])

    const handleOpenResourceUrl = useCallback((url: string) => {
        if (!isElectronRendererRuntime() || !projectPath) {
            void window.devscope.openBrowserPreviewExternal(url)
            return
        }
        openBrowserSurface(url)
    }, [openBrowserSurface, projectPath])

    const handleBrowserNavigationRequestHandled = useCallback((requestId: number) => {
        setBrowserNavigationRequest((current) => current?.id === requestId ? null : current)
    }, [])

    const handleBrowserSurfaceRequestHandled = useCallback((requestId: string) => {
        if (browserSurfaceRequest?.requestId === requestId) {
            pendingBrowserTabIdsRef.current.delete(browserSurfaceRequest.tabId)
        }
        onBrowserSurfaceRequestHandled(requestId)
    }, [browserSurfaceRequest, onBrowserSurfaceRequestHandled])

    const handleOpenResourceTurn = useCallback((turnId: string) => {
        setWorkspaceTabs((current) => current.some((tab) => tab.kind === 'review')
            ? current
            : [...current, REVIEW_TAB])
        setFocusedDiffRequestId(null)
        setActiveTabId('review')
        setReviewTurnId(turnId)
        beginTabTransition('review')
        selectTurn(turnId)
    }, [beginTabTransition, selectTurn])

    const handleOpenResourceDiff = useCallback((target: AssistantDiffTarget) => {
        const turnId = target.turnId || turns.find((turn) => turn.changes.some((change) => (
            change.target.activityId === target.activityId && change.target.filePath === target.filePath
        )))?.id
        if (!turnId) return
        setWorkspaceTabs((current) => current.some((tab) => tab.kind === 'review')
            ? current
            : [...current, REVIEW_TAB])
        setFocusedDiffRequestId(reviewFileRevealSequenceRef.current--)
        setActiveTabId('review')
        setReviewTurnId(turnId)
        selectTurn(turnId)
        onSelectDiff(target)
    }, [onSelectDiff, selectTurn, turns])

    const handleOpenReviewTurn = useCallback((turnId: string) => {
        setFocusedDiffRequestId(null)
        setActiveTabId('review')
        setReviewTurnId(turnId)
        beginTabTransition('review')
        selectTurn(turnId)
    }, [beginTabTransition, selectTurn])

    const handleOpenReviewFile = useCallback((turnId: string, target: AssistantDiffTarget) => {
        setFocusedDiffRequestId(reviewFileRevealSequenceRef.current--)
        setActiveTabId('review')
        setReviewTurnId(turnId)
        selectTurn(turnId)
        onSelectDiff(target)
    }, [onSelectDiff, selectTurn])

    const handleOpenTurnInTab = useCallback((turnId: string) => {
        const tabId = `turn:${turnId}`
        setReviewTurnId(null)
        setFocusedDiffRequestId(null)
        setWorkspaceTabs((current) => current.some((tab) => tab.id === tabId)
            ? current
            : [...current, { id: tabId, kind: 'turn', turnId }])
        setActiveTabId(tabId)
        beginTabTransition(tabId)
        selectTurn(turnId)
    }, [beginTabTransition, selectTurn])

    const handleSelectTab = useCallback((tabId: string) => {
        setActiveTabId(tabId)
        beginTabTransition(tabId)
        const tab = workspaceTabs.find((entry) => entry.id === tabId)
        if (tab?.kind === 'review' && reviewTurnId) {
            selectTurn(reviewTurnId)
            return
        }
        if (tab?.kind === 'browser') browserControllerRef.current?.activateTab(tab.browserTabId)
        if (tab?.kind === 'turn') selectTurn(tab.turnId)
    }, [beginTabTransition, reviewTurnId, selectTurn, workspaceTabs])

    const handleReorderTab = useCallback((fromTabId: string, toTabId: string) => {
        setWorkspaceTabs((current) => reorderAssistantInspectorWorkspaceTabs(current, fromTabId, toTabId))
    }, [])

    const handleCloseTab = useCallback((tabId: string, options?: { transferred?: boolean }) => {
        const currentWorkspaceTabs = workspaceTabsRef.current
        const closingIndex = currentWorkspaceTabs.findIndex((tab) => tab.id === tabId)
        const closingTab = currentWorkspaceTabs[closingIndex]
        if (!closingTab) return
        if (closingTab.kind === 'browser') {
            pendingBrowserTabIdsRef.current.delete(closingTab.browserTabId)
            const nextBrowserState = browserControllerRef.current?.closeTab(closingTab.browserTabId, options)
            if (nextBrowserState) {
                setBrowserTabs(nextBrowserState.tabs)
                setBrowserActiveTabId(nextBrowserState.activeTabId)
            }
        }
        const next = currentWorkspaceTabs.filter((tab) => tab.id !== tabId)
        workspaceTabsRef.current = next
        setWorkspaceTabs(next)
        setTransitionLoadingTabId((current) => current === tabId ? null : current)
        setContentLoadingTabId((current) => current === tabId ? null : current)
        if (closingTab.kind === 'review') {
            setReviewTurnId(null)
            setFocusedDiffRequestId(null)
        }
        if (closingTab.kind === 'explorer') setExplorerViewCapsule(null)
        if (closingTab.kind === 'browser') setBrowserNavigationRequest(null)
        if (next.length === 0) {
            persistAssistantInspectorWorkspaceState(browserWorkspaceKey, { version: 1, activeTabId: '', tabs: [] })
            setActiveTabId('')
            onClose()
            return
        }
        if (activeTabIdRef.current === tabId) {
            const fallback = next[Math.min(Math.max(closingIndex, 0), next.length - 1)] || next[next.length - 1]
            setActiveTabId(fallback.id)
            if (fallback.kind === 'browser') browserControllerRef.current?.activateTab(fallback.browserTabId)
            if (fallback.kind === 'turn') selectTurn(fallback.turnId)
            if (fallback.kind === 'review' && reviewTurnId) selectTurn(reviewTurnId)
        }
    }, [browserWorkspaceKey, onClose, reviewTurnId, selectTurn])

    const buildDetachedTab = useCallback((tabId: string): AssistantUtilityTab | null => {
        const workspaceTab = workspaceTabs.find((tab) => tab.id === tabId)
        if (!workspaceTab || !threadId || !sessionId) return null
        const workspace: AssistantUtilityWorkspaceKind = workspaceTab.kind === 'control'
            ? 'details'
            : workspaceTab.kind === 'review'
                ? 'diff'
                : workspaceTab.kind
        const browserTab = workspaceTab.kind === 'browser'
            ? browserTabs.find((tab) => tab.id === workspaceTab.browserTabId) || null
            : null
        const now = new Date().toISOString()
        const capsuleWorkspace = capsuleWorkspaceForInspectorKind(workspaceTab.kind)
        const stableUtilityTabId = capsuleWorkspace ? ensureUtilityTabId(workspaceTab.id, capsuleWorkspace) : null
        let stateCapsule = capsuleWorkspace ? readWorkspaceCapsule(workspaceTab.id, capsuleWorkspace) : undefined
        if (workspace === 'diff' || workspace === 'turn') {
            const selectedTurnForTab = workspaceTab.kind === 'turn' ? workspaceTab.turnId : reviewTurnId || undefined
            stateCapsule = {
                version: 1,
                workspace,
                selectedTurnId: selectedTurnForTab,
                selectedDiff: selectedTurnForTab && visibleSelectedDiff ? toAssistantUtilityDiffSelection(visibleSelectedDiff) : undefined,
                scrollAnchor: stateCapsule?.scrollAnchor
            }
        } else if (workspace === 'resources') {
            const resourcesState = stateCapsule?.workspace === 'resources' ? stateCapsule : { version: 1 as const, workspace: 'resources' as const }
            stateCapsule = {
                ...resourcesState,
                drillDown: resourceDrillDownTurnId ? {
                    turnId: resourceDrillDownTurnId,
                    selectedDiff: toAssistantUtilityDiffSelection(resourceDrillDownDiff)
                } : resourcesState.drillDown
            }
        } else if (workspace === 'details' && !stateCapsule) {
            stateCapsule = { version: 1, workspace: 'details' }
        }
        if (stableUtilityTabId && stateCapsule) capsuleByUtilityTabIdRef.current.set(stableUtilityTabId, stateCapsule)
        return {
            id: workspace === 'browser'
                ? browserTab?.id || workspaceTab.id
                : stableUtilityTabId || `utility:${canonicalChatId || threadId}:${workspace}:${workspaceTab.id}:${Date.now().toString(36)}`,
            canonicalChatId: canonicalChatId || threadId,
            sessionId,
            threadId,
            chatTitle,
            projectPath: projectPath || '',
            projectRoots,
            workspace,
            title: browserTab?.title || tabs.find((tab) => tab.id === tabId)?.label || 'Zyra',
            colorIndex: Math.abs([...String(canonicalChatId || threadId)].reduce((hash, character) => ((hash << 5) - hash + character.charCodeAt(0)) | 0, 0)) % 8,
            sessionMode: browserTab?.sessionMode,
            url: browserTab?.url || undefined,
            faviconUrl: browserTab?.faviconUrl || undefined,
            terminalRuntimeId: workspace === 'terminal' ? terminalRuntimeId : undefined,
            path: workspace === 'explorer'
                ? filesProjectPath || undefined
                : workspace === 'terminal' ? projectPath || undefined : undefined,
            turnId: workspaceTab.kind === 'turn' ? workspaceTab.turnId : undefined,
            stateCapsule,
            createdAt: now,
            updatedAt: now
        }
    }, [browserTabs, canonicalChatId, chatTitle, ensureUtilityTabId, filesProjectPath, projectPath, projectRoots, readWorkspaceCapsule, resourceDrillDownDiff, resourceDrillDownTurnId, reviewTurnId, sessionId, tabs, terminalRuntimeId, threadId, visibleSelectedDiff, workspaceTabs])

    const mainTabTearOff = useMemo(() => isElectronRendererRuntime() ? {
        begin: async (tabId: string, screenPoint: { x: number; y: number }, grabOffset: { x: number; y: number }): Promise<string | null> => {
            const utility = window.devscope.assistantUtility
            const tab = buildDetachedTab(tabId)
            if (!utility || !tab) return null
            if (tab.workspace === 'terminal' && !window.confirm('Moving this Terminal tab opens a new terminal view in the other window. Continue?')) return null
            const result = await utility.beginTearOff({ sourceWindowId: 'main', tab, screenPoint, grabOffset })
            return result.success ? result.sessionId || null : null
        },
        finish: async (tabId: string, sessionId: string, screenPoint: { x: number; y: number }): Promise<boolean> => {
            const result = await window.devscope.assistantUtility.finishTearOff({ sessionId, screenPoint })
            if (!result.success || !result.committed) return false
            handleCloseTab(tabId, { transferred: true })
            return true
        },
        cancel: async (sessionId: string): Promise<void> => {
            await window.devscope.assistantUtility.cancelTearOff(sessionId)
        }
    } : undefined, [buildDetachedTab, handleCloseTab])

    useEffect(() => {
        const utility = window.devscope.assistantUtility
        if (!utility || pendingMainBrowserMovesRef.current.size === 0) return
        for (const [browserTabId, requestIds] of pendingMainBrowserMovesRef.current) {
            const ready = browserWorkspaceState.tabs.some((tab) => tab.tabId === browserTabId && Boolean(tab.targetId))
            if (!ready) continue
            pendingMainBrowserMovesRef.current.delete(browserTabId)
            for (const requestId of requestIds) {
                window.clearTimeout(pendingMainBrowserMoveTimersRef.current.get(requestId))
                pendingMainBrowserMoveTimersRef.current.delete(requestId)
                void utility.completeIncomingMainTab(requestId, true)
            }
        }
    }, [browserWorkspaceState.tabs])

    const handleTerminalReady = useCallback(() => {
        const utility = window.devscope.assistantUtility
        if (!utility || pendingMainTerminalMovesRef.current.size === 0) return
        for (const requestId of pendingMainTerminalMovesRef.current) {
            void utility.completeIncomingMainTab(requestId, true)
        }
        pendingMainTerminalMovesRef.current.clear()
    }, [])

    useEffect(() => () => {
        const utility = window.devscope.assistantUtility
        if (!utility) return
        for (const requestIds of pendingMainBrowserMovesRef.current.values()) {
            for (const requestId of requestIds) {
                window.clearTimeout(pendingMainBrowserMoveTimersRef.current.get(requestId))
                void utility.completeIncomingMainTab(requestId, false, 'The main Browser tab closed before it became ready.')
            }
        }
        pendingMainBrowserMoveTimersRef.current.clear()
        pendingMainBrowserMovesRef.current.clear()
        for (const requestId of pendingMainTerminalMovesRef.current) {
            void utility.completeIncomingMainTab(requestId, false, 'The main Terminal closed before it became ready.')
        }
        pendingMainTerminalMovesRef.current.clear()
    }, [])

    const adoptIncomingCapsule = useCallback((workspaceTabId: string, incoming: AssistantUtilityTab) => {
        const capsule = sanitizeRendererCapsule(incoming.stateCapsule, incoming.workspace)
        if (!capsule) return
        utilityTabIdByWorkspaceIdRef.current.set(workspaceTabId, incoming.id)
        capsuleByUtilityTabIdRef.current.set(incoming.id, capsule)
        setHydrationCapsules((current) => ({ ...current, [workspaceTabId]: capsule }))
        if (capsule.workspace === 'diff' || capsule.workspace === 'turn') {
            const turnId = capsule.selectedTurnId || incoming.turnId || null
            if (capsule.workspace === 'diff') setReviewTurnId(turnId)
            if (turnId) selectTurn(turnId)
            const target = resolveAssistantUtilityDiffSelection(turns, capsule.selectedDiff)
            if (target) onSelectDiff(target)
        } else if (capsule.workspace === 'resources') {
            setResourceDrillDownTurnId(capsule.drillDown?.turnId || null)
            setResourceDrillDownDiff(resolveAssistantUtilityDiffSelection(turns, capsule.drillDown?.selectedDiff))
            if (capsule.drillDown?.turnId) selectTurn(capsule.drillDown.turnId)
        } else if (capsule.workspace === 'agents') {
            setSelectedAgentRunId(capsule.selectedAgentRunId || null)
            setSelectedWorkflowRunId(capsule.selectedWorkflowRunId || null)
        } else if (capsule.workspace === 'explorer') {
            setExplorerViewCapsule(capsule)
        }
        window.requestAnimationFrame(() => restoreAssistantUtilityScrollAnchor(capsuleRootRef.current, capsule.scrollAnchor))
    }, [onSelectDiff, selectTurn, turns])

    useEffect(() => {
        const utility = window.devscope.assistantUtility
        if (!utility) return
        return utility.onIncomingMainTab(({ requestId, tab: incoming }) => {
        if ((canonicalChatId || threadId) !== incoming.canonicalChatId) {
            void utility.completeIncomingMainTab(requestId, false, 'The main window is showing another chat.')
            return
        }
        if (incoming.workspace === 'browser') {
            if (browserTabs.length >= ASSISTANT_BROWSER_TAB_LIMIT) {
                void utility.completeIncomingMainTab(requestId, false, `Close a Browser tab first; the ${ASSISTANT_BROWSER_TAB_LIMIT}-tab limit is full.`)
                return
            }
            const browserTabId = openBrowserSurface(incoming.url || '', true, incoming.id, incoming.sessionMode || 'normal')
            const alreadyReady = browserWorkspaceState.tabs.some((tab) => tab.tabId === browserTabId && Boolean(tab.targetId))
            if (alreadyReady) {
                void utility.completeIncomingMainTab(requestId, true)
            } else {
                const requestIds = pendingMainBrowserMovesRef.current.get(browserTabId) || new Set<string>()
                requestIds.add(requestId)
                pendingMainBrowserMovesRef.current.set(browserTabId, requestIds)
                const timerId = window.setTimeout(() => {
                    pendingMainBrowserMoveTimersRef.current.delete(requestId)
                    const pendingRequestIds = pendingMainBrowserMovesRef.current.get(browserTabId)
                    if (!pendingRequestIds?.delete(requestId)) return
                    if (pendingRequestIds.size === 0) pendingMainBrowserMovesRef.current.delete(browserTabId)
                    void utility.completeIncomingMainTab(requestId, false, 'The main Browser tab did not become ready.')
                    handleCloseTab(browserTabId)
                }, MAIN_BROWSER_MOVE_READY_TIMEOUT_MS)
                pendingMainBrowserMoveTimersRef.current.set(requestId, timerId)
            }
            return
        }
        if (incoming.workspace === 'turn' && incoming.turnId) {
            const workspaceTabId = `turn:${incoming.turnId}`
            adoptIncomingCapsule(workspaceTabId, incoming)
            handleOpenTurnInTab(incoming.turnId)
            void utility.completeIncomingMainTab(requestId, true)
            return
        }
        if (incoming.workspace === 'terminal') {
            pendingMainTerminalMovesRef.current.add(requestId)
            setTerminalRuntimeId(incoming.terminalRuntimeId || incoming.id)
            setTerminalMountRevision((revision) => revision + 1)
            openSingletonWorkspace(TERMINAL_TAB)
            return
        }
        const target = incoming.workspace === 'details' ? CONTROL_TAB
            : incoming.workspace === 'diff' ? REVIEW_TAB
                : incoming.workspace === 'explorer' ? EXPLORER_TAB
                    : incoming.workspace === 'resources' ? RESOURCES_TAB
                            : incoming.workspace === 'agents' ? AGENTS_TAB
                                : null
        if (target) {
            adoptIncomingCapsule(target.id, incoming)
            openSingletonWorkspace(target)
            void utility.completeIncomingMainTab(requestId, true)
        } else {
            void utility.completeIncomingMainTab(requestId, false, 'This tab type is unavailable in the main window.')
        }
        })
    }, [adoptIncomingCapsule, browserTabs.length, browserWorkspaceState.tabs, canonicalChatId, handleCloseTab, handleOpenTurnInTab, openBrowserSurface, openSingletonWorkspace, threadId])

    const handleBrowserTabSelectionRequest = useCallback((tabId: string) => {
        pendingBrowserTabIdsRef.current.add(tabId)
        setWorkspaceTabs((current) => ensureAssistantInspectorBrowserTab(current, tabId))
        setActiveTabId(tabId)
    }, [])

    const handleBrowserControllerChange = useCallback((controller: AssistantBrowserWorkspaceController | null) => {
        browserControllerRef.current = controller
    }, [])

    useEffect(() => {
        if (!activeWorkspaceTab || (activeWorkspaceTab.kind !== 'review' && activeWorkspaceTab.kind !== 'turn')) return
        const workspace = activeWorkspaceTab.kind === 'turn' ? 'turn' : 'diff'
        const existing = readWorkspaceCapsule(activeWorkspaceTab.id, workspace)
        recordWorkspaceCapsule(activeWorkspaceTab.id, {
            version: 1,
            workspace,
            selectedTurnId: activeWorkspaceTab.kind === 'turn' ? activeWorkspaceTab.turnId : reviewTurnId || undefined,
            selectedDiff: toAssistantUtilityDiffSelection(visibleSelectedDiff),
            scrollAnchor: existing?.scrollAnchor
        })
    }, [activeWorkspaceTab, readWorkspaceCapsule, recordWorkspaceCapsule, reviewTurnId, visibleSelectedDiff])

    const handleCapsuleScroll = useCallback((event: UIEvent<HTMLElement>) => {
        if (!activeWorkspaceTab) return
        const workspace = capsuleWorkspaceForInspectorKind(activeWorkspaceTab.kind)
        const anchor = captureAssistantUtilityScrollAnchor(event)
        if (!workspace || !anchor) return
        const existing = readWorkspaceCapsule(activeWorkspaceTab.id, workspace)
        const fallback: AssistantUtilityStateCapsule = workspace === 'details'
            ? { version: 1, workspace: 'details' }
            : workspace === 'agents'
                ? { version: 1, workspace: 'agents' }
                : workspace === 'resources'
                    ? { version: 1, workspace: 'resources' }
                    : workspace === 'explorer'
                        ? { version: 1, workspace: 'explorer' }
                        : { version: 1, workspace, selectedTurnId: activeWorkspaceTab.kind === 'turn' ? activeWorkspaceTab.turnId : reviewTurnId || undefined }
        recordWorkspaceCapsule(activeWorkspaceTab.id, { ...(existing || fallback), scrollAnchor: anchor } as AssistantUtilityStateCapsule)
    }, [activeWorkspaceTab, readWorkspaceCapsule, recordWorkspaceCapsule, reviewTurnId])

    const handleMainExplorerCapsule = useCallback((capsule: AssistantUtilityExplorerStateCapsule) => {
        setExplorerViewCapsule((current) => JSON.stringify(current) === JSON.stringify(capsule) ? current : capsule)
        recordWorkspaceCapsule(EXPLORER_TAB.id, capsule)
    }, [recordWorkspaceCapsule])

    const handleMainResourcesCapsule = useCallback((capsule: AssistantUtilityResourcesStateCapsule) => {
        recordWorkspaceCapsule(RESOURCES_TAB.id, {
            ...capsule,
            drillDown: resourceDrillDownTurnId ? {
                turnId: resourceDrillDownTurnId,
                selectedDiff: toAssistantUtilityDiffSelection(resourceDrillDownDiff)
            } : undefined
        })
    }, [recordWorkspaceCapsule, resourceDrillDownDiff, resourceDrillDownTurnId])

    const handleMainAgentsCapsule = useCallback((capsule: AssistantUtilityAgentsStateCapsule) => {
        const current = readWorkspaceCapsule(AGENTS_TAB.id, 'agents')
        recordWorkspaceCapsule(AGENTS_TAB.id, { ...capsule, scrollAnchor: capsule.scrollAnchor || current?.scrollAnchor })
    }, [readWorkspaceCapsule, recordWorkspaceCapsule])

    const resourceDrillDownTurn = turns.find((turn) => turn.id === resourceDrillDownTurnId) || null
    const explorerHydrationCapsule = hydrationCapsules[EXPLORER_TAB.id]
    const agentsHydrationCapsule = hydrationCapsules[AGENTS_TAB.id]
    const resourcesHydrationCapsule = hydrationCapsules[RESOURCES_TAB.id]

    const addTabItems = useMemo<FileActionsMenuItem[]>(() => [
        { id: 'control', label: 'Thread Details', icon: <PanelRight size={14} />, onSelect: handleOpenThreadDetailsWorkspace },
        ...(isElectronRendererRuntime()
            ? [{
                id: 'browser',
                label: 'Browser',
                icon: <Globe2 size={14} />,
                onSelect: handleOpenBrowserWorkspace,
                choicesLabel: 'Choose Browser tab type',
                choices: [
                    { id: 'browser-normal', label: 'Normal tab', icon: <Globe2 size={13} />, onSelect: handleOpenBrowserWorkspace },
                    { id: 'browser-incognito', label: 'Incognito tab', icon: <IncognitoIcon size={13} />, onSelect: handleOpenIncognitoBrowserWorkspace }
                ]
            }]
            : []),
        { id: 'terminal', label: 'Terminal', icon: <SquareTerminal size={14} />, onSelect: handleOpenTerminalWorkspace },
        { id: 'explorer', label: 'Files', icon: <Files size={14} />, onSelect: handleOpenExplorerWorkspace },
        { id: 'review', label: 'Diff', icon: <FileDiff size={14} />, onSelect: handleOpenReviewWorkspace },
        { id: 'resources', label: 'Resources', icon: <Library size={14} />, onSelect: handleOpenResourcesWorkspace },
        { id: 'agents', label: 'Agents', icon: <Bot size={14} />, onSelect: handleOpenAgentsWorkspace }
    ], [
        handleOpenAgentsWorkspace,
        handleOpenBrowserWorkspace,
        handleOpenIncognitoBrowserWorkspace,
        handleOpenThreadDetailsWorkspace,
        handleOpenExplorerWorkspace,
        handleOpenResourcesWorkspace,
        handleOpenReviewWorkspace,
        handleOpenTerminalWorkspace
    ])

    return (
        <AssistantInspectorSidebar
            open={open}
            width={width}
            maxWidth={maxWidth}
            tabs={tabs}
            activeTabId={activeTabId}
            onWidthChange={onWidthChange}
            onSelectTab={handleSelectTab}
            onCloseTab={handleCloseTab}
            onReorderTab={handleReorderTab}
            tabTearOff={mainTabTearOff}
            dropZoneCanonicalChatId={canonicalChatId || threadId}
            addTabItems={addTabItems}
        >
            <div ref={capsuleRootRef} className="contents" onScrollCapture={handleCapsuleScroll}>
                {reviewOpen ? (
                    <div className={activeWorkspaceTab?.kind === 'review' ? 'assistant-review-navigation-stack relative grid min-h-0 min-w-0 flex-1 overflow-hidden' : 'hidden'}>
                        <div
                            ref={reviewIndexSurfaceRef}
                            className="assistant-review-navigation-surface assistant-review-navigation-index flex min-h-0 min-w-0"
                            data-state={reviewDetailPresented ? 'behind' : 'active'}
                            aria-hidden={reviewDetailPresented}
                            inert={reviewDetailPresented ? true : undefined}
                        >
                            <AssistantReviewLanding
                                threadId={threadId}
                                turns={turns}
                                activeTurnId={activeTurnId}
                                ready={reviewIndexReady}
                                loading={reviewIndexLoading}
                                error={reviewIndexError}
                                previewMode="glance"
                                onPreviewTurn={selectTurn}
                                onOpenTurn={handleOpenReviewTurn}
                                onOpenFile={handleOpenReviewFile}
                            />
                        </div>
                        {reviewTransitionTurn ? (
                            <div
                                ref={reviewDetailSurfaceRef}
                                className="assistant-review-navigation-surface assistant-review-navigation-detail flex min-h-0 min-w-0"
                                data-state={reviewDetailPresented ? 'active' : 'ahead'}
                                onTransitionEnd={handleReviewDetailTransitionEnd}
                                aria-hidden={!reviewDetailPresented}
                                inert={!reviewDetailPresented ? true : undefined}
                            >
                                {reviewTransitionTurn.detailLoaded === false ? (
                                    <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center">
                                        {turnDetailError ? (
                                            <div>
                                                <TriangleAlert size={18} className="mx-auto text-amber-300/75" />
                                                <p className="mt-3 text-[12px] font-medium text-sparkle-text-secondary">Could not load this turn</p>
                                                <p className="mt-1 text-[10px] leading-4 text-sparkle-text-muted/70">{turnDetailError}</p>
                                            </div>
                                        ) : (
                                            <div>
                                                <LoaderCircle size={18} className="mx-auto animate-spin text-[var(--accent-primary)]/75" />
                                                <p className="mt-3 text-[11px] text-sparkle-text-muted/70">Loading this turn’s messages and diffs…</p>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <AssistantTurnReview
                                        turn={reviewTransitionTurn}
                                        selectedDiff={reviewTransitionSelectedDiff}
                                        focusSelectedDiffRequestId={focusedDiffRequestId}
                                        showBack
                                        onBack={() => {
                                            setReviewTurnId(null)
                                            setFocusedDiffRequestId(null)
                                        }}
                                        onSelectDiff={onSelectDiff}
                                        onLoadingChange={handleTurnLoadingChange}
                                    />
                                )}
                            </div>
                        ) : null}
                    </div>
                ) : null}

                {terminalOpen ? (
                    <div className={activeWorkspaceTab?.kind === 'terminal' ? 'flex min-h-0 flex-1' : 'hidden'}>
                        <Suspense fallback={(
                            <div className="flex min-h-0 flex-1 items-center justify-center">
                                <LoaderCircle size={18} className="animate-spin text-[var(--accent-primary)]/75" />
                            </div>
                        )}>
                            <AssistantTerminalWorkspace
                                key={`${terminalRuntimeId}:${terminalMountRevision}`}
                                workspaceKey={terminalRuntimeId}
                                projectPath={projectPath}
                                active={open && activeWorkspaceTab?.kind === 'terminal'}
                                terminalOwner={{ kind: 'main-workspace', runtimeId: terminalRuntimeId }}
                                onReady={handleTerminalReady}
                            />
                        </Suspense>
                    </div>
                ) : null}

                {browserOpen ? (
                    <div
                        aria-hidden={activeWorkspaceTab?.kind !== 'browser'}
                        className={activeWorkspaceTab?.kind === 'browser'
                            ? 'flex min-h-0 flex-1'
                            : 'pointer-events-none invisible absolute inset-0 flex'}
                    >
                        <Suspense fallback={(
                            <div className="flex min-h-0 flex-1 items-center justify-center">
                                <LoaderCircle size={18} className="animate-spin text-[var(--accent-primary)]/75" />
                            </div>
                        )}>
                            <AssistantBrowserWorkspace
                                key={browserWorkspaceKey}
                                workspaceKey={browserWorkspaceKey}
                                threadId={threadId || 'thread:detached'}
                                projectPath={projectPath}
                                active={open && activeWorkspaceTab?.kind === 'browser'}
                                selectedTabId={activeWorkspaceTab?.kind === 'browser' ? activeWorkspaceTab.browserTabId : null}
                                controlState={controlState}
                                navigationRequest={browserNavigationRequest}
                                surfaceRequest={browserSurfaceRequest}
                                onNavigationRequestHandled={handleBrowserNavigationRequestHandled}
                                onSurfaceRequestHandled={handleBrowserSurfaceRequestHandled}
                                onWorkspaceStateChange={handleBrowserWorkspaceStateChange}
                                onTabsChange={handleBrowserTabsChange}
                                onRequestTabSelection={handleBrowserTabSelectionRequest}
                                onControllerChange={handleBrowserControllerChange}
                                onDeveloperToast={showDeveloperToast}
                                onOpenPreview={onOpenPreview}
                            />
                        </Suspense>
                    </div>
                ) : null}

                {filesOpen ? (
                    <div className={activeWorkspaceTab?.kind === 'explorer' ? 'flex min-h-0 flex-1' : 'hidden'}>
                        <Suspense fallback={<PreviewTreeSkeleton />}>
                            <AssistantFilesWorkspace
                                projectPath={filesProjectPath}
                                projectRoots={projectRoots}
                                active={open && activeWorkspaceTab?.kind === 'explorer'}
                                publishNavigatorToAppTitleBar
                                stateCapsule={explorerHydrationCapsule?.workspace === 'explorer' ? explorerHydrationCapsule : undefined}
                                onStateCapsuleChange={handleMainExplorerCapsule}
                            />
                        </Suspense>
                    </div>
                ) : null}

                {agentsOpen ? (
                    <div className={activeWorkspaceTab?.kind === 'agents' ? 'flex min-h-0 flex-1' : 'hidden'}>
                        <Suspense fallback={(<div className="flex min-h-0 flex-1 items-center justify-center"><LoaderCircle size={18} className="animate-spin text-[var(--accent-primary)]/75" /></div>)}>
                            <AssistantFleetWorkspace
                                threadId={threadId}
                                snapshot={effectiveFleetSnapshot}
                                selectedAgentRunId={selectedAgentRunId}
                                selectedWorkflowRunId={selectedWorkflowRunId}
                                onSelectAgent={setSelectedAgentRunId}
                                onSelectWorkflow={setSelectedWorkflowRunId}
                                onAgentAction={handleAgentAction}
                                onWorkflowAction={handleWorkflowAction}
                                stateCapsule={agentsHydrationCapsule?.workspace === 'agents' ? agentsHydrationCapsule : undefined}
                                onStateCapsuleChange={handleMainAgentsCapsule}
                            />
                        </Suspense>
                    </div>
                ) : null}

                {threadDetailsOpen ? (
                    <div className={activeWorkspaceTab?.kind === 'control' ? 'flex min-h-0 flex-1' : 'hidden'}>
                        <Suspense fallback={(
                            <div className="flex min-h-0 flex-1 items-center justify-center">
                                <LoaderCircle size={18} className="animate-spin text-[var(--accent-primary)]/75" />
                            </div>
                        )}>
                            <AssistantThreadDetailsWorkspace
                                active={open && activeWorkspaceTab?.kind === 'control'}
                                sessionId={sessionId}
                                threadId={threadId}
                                projectPath={projectPath}
                                fleetSnapshot={effectiveFleetSnapshot}
                                controlState={controlState}
                            />
                        </Suspense>
                    </div>
                ) : null}

                {resourcesOpen ? (
                    <div className={activeWorkspaceTab?.kind === 'resources' ? 'flex min-h-0 flex-1' : 'hidden'}>
                        <Suspense fallback={(
                            <div className="flex min-h-0 flex-1 items-center justify-center">
                                <LoaderCircle size={18} className="animate-spin text-[var(--accent-primary)]/75" />
                            </div>
                        )}>
                            {resourceDrillDownTurn ? (
                                <AssistantTurnReview
                                    turn={resourceDrillDownTurn}
                                    selectedDiff={resourceDrillDownDiff || resourceDrillDownTurn.files[0]?.target || null}
                                    focusSelectedDiffRequestId={null}
                                    showBack
                                    onBack={() => {
                                        setResourceDrillDownTurnId(null)
                                        setResourceDrillDownDiff(null)
                                        const current = readWorkspaceCapsule(RESOURCES_TAB.id, 'resources')
                                        if (current?.workspace === 'resources') recordWorkspaceCapsule(RESOURCES_TAB.id, { ...current, drillDown: undefined })
                                    }}
                                    onSelectDiff={(target) => {
                                        setResourceDrillDownDiff(target)
                                        const current = readWorkspaceCapsule(RESOURCES_TAB.id, 'resources')
                                        if (current?.workspace === 'resources') recordWorkspaceCapsule(RESOURCES_TAB.id, { ...current, drillDown: { turnId: resourceDrillDownTurn.id, selectedDiff: toAssistantUtilityDiffSelection(target) } })
                                    }}
                                />
                            ) : (
                                <AssistantResourcesWorkspace
                                    turns={turns}
                                    projectPath={projectPath}
                                    onOpenPreview={onOpenPreview}
                                    onOpenPreviewInNewTab={onOpenPreviewInNewTab}
                                    onOpenUrl={handleOpenResourceUrl}
                                    onOpenDiff={handleOpenResourceDiff}
                                    onOpenTurn={handleOpenResourceTurn}
                                    stateCapsule={resourcesHydrationCapsule?.workspace === 'resources' ? resourcesHydrationCapsule : undefined}
                                    onStateCapsuleChange={handleMainResourcesCapsule}
                                />
                            )}
                        </Suspense>
                    </div>
                ) : null}

                {activeWorkspaceTab?.kind === 'turn' && visibleTurn?.detailLoaded === false ? (
                    <div key={`turn-loading:${visibleTurn.id}`} className="assistant-review-full-turn-enter flex min-h-0 flex-1 items-center justify-center px-6 text-center">
                        {turnDetailError ? (
                            <div>
                                <TriangleAlert size={18} className="mx-auto text-amber-300/75" />
                                <p className="mt-3 text-[12px] font-medium text-sparkle-text-secondary">Could not load this turn</p>
                                <p className="mt-1 text-[10px] leading-4 text-sparkle-text-muted/70">{turnDetailError}</p>
                            </div>
                        ) : (
                            <div>
                                <LoaderCircle size={18} className="mx-auto animate-spin text-[var(--accent-primary)]/75" />
                                <p className="mt-3 text-[11px] text-sparkle-text-muted/70">Loading this turn’s messages and diffs…</p>
                            </div>
                        )}
                    </div>
                ) : activeWorkspaceTab?.kind === 'turn' && visibleTurn ? (
                    <div key={`turn-detail:${visibleTurn.id}`} className="assistant-review-full-turn-enter flex min-h-0 flex-1">
                        <AssistantTurnReview
                            turn={visibleTurn}
                            selectedDiff={visibleSelectedDiff}
                            focusSelectedDiffRequestId={null}
                            showBack={false}
                            onBack={() => undefined}
                            onSelectDiff={onSelectDiff}
                            onLoadingChange={handleTurnLoadingChange}
                        />
                    </div>
                ) : null}
                <AssistantInspectorDeveloperToast toast={developerToast} onDismiss={dismissDeveloperToast} />
            </div>
        </AssistantInspectorSidebar>
    )
})
