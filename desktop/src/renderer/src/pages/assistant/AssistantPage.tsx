import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { AssistantActivity, AssistantChatScopeRoot, AssistantMessage, AssistantSession, AssistantTurnDetail, FleetSnapshot } from '@shared/assistant/contracts'
import { reconcileAssistantMessageReplays } from '@shared/assistant/message-reconciliation'
import type { PreviewOpenOptions } from '@/components/ui/file-preview/types'
import { useFilePreview } from '@/components/ui/file-preview/useFilePreview'
import { useAssistantStoreActions, useAssistantStoreSelector } from '@/lib/assistant/store'
import { getActiveAssistantThread, getSelectedAssistantSession } from '@/lib/assistant/selectors'
import { shouldHideAssistantRowsForSelection } from '@/lib/assistant/assistant-history-state'
import { ConnectedAssistantSessionsRail } from './AssistantConnectedSessionsRail'
import { AssistantConversationPane } from './AssistantConversationPane'
import type { AssistantDiffRevealRequest } from './AssistantDiffPanel'
import { buildAssistantDiffTurns } from './assistant-diff-turns'
import { resolveAssistantDiffTarget, type AssistantDiffTarget } from './assistant-diff-types'
import { openAssistantFileTarget } from './assistant-file-navigation'
import { resolveAssistantPaneLayout } from './assistant-pane-layout'
import { mergeAssistantReviewIndex } from './assistant-review-index'
import { AssistantTransientToast, DeleteHistoryConfirm, useAssistantTransientToast } from './AssistantPageHelpers'
import { useAssistantBrowserSurfaceRequests } from './useAssistantBrowserSurfaceRequests'
import { useAssistantPageSidebarState } from './useAssistantPageSidebarState'
import { useAssistantReviewIndex } from './useAssistantReviewIndex'
import { useAssistantChatRouting } from './useAssistantChatRouting'
import { parseAssistantChatRoute, parseAssistantMessageSearchTarget } from './assistant-chat-route'
import { parseAssistantFilesShellLaunchRequest } from '@shared/assistant/files-shell-launch-route'

type AssistantPageShellSelection = {
    bootstrapped: boolean
    commandPending: boolean
    sessions: AssistantSession[]
    selectedSessionId: string | null
    activeThreadId: string | null
    selectedSessionMode: 'work'
}

function areAssistantPageShellSelectionsEqual(left: AssistantPageShellSelection, right: AssistantPageShellSelection): boolean {
    return left.bootstrapped === right.bootstrapped
        && left.commandPending === right.commandPending
        && left.sessions === right.sessions
        && left.selectedSessionId === right.selectedSessionId
        && left.activeThreadId === right.activeThreadId
        && left.selectedSessionMode === right.selectedSessionMode
}

const EMPTY_ASSISTANT_MESSAGES: AssistantMessage[] = []
const EMPTY_ASSISTANT_ACTIVITIES: AssistantActivity[] = []
const EMPTY_ASSISTANT_PROJECT_ROOTS: AssistantChatScopeRoot[] = []
const createAssistantDiffPanelModule = async () => ({
    default: (await import('./AssistantDiffPanel')).AssistantDiffPanel
})
let assistantDiffPanelModulePromise: ReturnType<typeof createAssistantDiffPanelModule> | null = null
const loadAssistantDiffPanel = () => {
    assistantDiffPanelModulePromise ||= createAssistantDiffPanelModule()
    return assistantDiffPanelModulePromise
}
const AssistantDiffPanel = lazy(loadAssistantDiffPanel)
const FilePreviewModal = lazy(() => import('@/components/ui/FilePreviewModal'))

type AssistantDiffSourceSelection = {
    threadId: string | null
    canonicalChatId: string | null
    chatTitle: string
    messages: AssistantMessage[]
    activities: AssistantActivity[]
    projectRootPath: string | null
    projectRoots: AssistantChatScopeRoot[]
    activeTurnId: string | null
    fleetSnapshot: FleetSnapshot | null
}

function areAssistantDiffSourceSelectionsEqual(left: AssistantDiffSourceSelection, right: AssistantDiffSourceSelection): boolean {
    return left.threadId === right.threadId
        && left.canonicalChatId === right.canonicalChatId
        && left.chatTitle === right.chatTitle
        && left.messages === right.messages
        && left.activities === right.activities
        && left.projectRootPath === right.projectRootPath
        && left.projectRoots === right.projectRoots
        && left.activeTurnId === right.activeTurnId
        && left.fleetSnapshot === right.fleetSnapshot
}

export default function AssistantPage() {
    const actions = useAssistantStoreActions()
    const preview = useFilePreview()
    const location = useLocation()
    const incomingFilesShellLaunchRequest = useMemo(
        () => parseAssistantFilesShellLaunchRequest(location.search),
        [location.search]
    )
    const messageSearchTarget = useMemo(
        () => parseAssistantMessageSearchTarget(location.search),
        [location.search]
    )
    const requestedChatTarget = useMemo(
        () => parseAssistantChatRoute(location.pathname),
        [location.pathname]
    )
    const [filesShellLaunchRequest, setFilesShellLaunchRequest] = useState(incomingFilesShellLaunchRequest)
    useEffect(() => {
        if (!incomingFilesShellLaunchRequest) return
        setFilesShellLaunchRequest((current) => current?.id === incomingFilesShellLaunchRequest.id
            ? current
            : incomingFilesShellLaunchRequest)
    }, [incomingFilesShellLaunchRequest])
    const shell = useAssistantStoreSelector<AssistantPageShellSelection>((state) => {
        const selectedSession = getSelectedAssistantSession(state.snapshot)

        return {
            bootstrapped: state.hydrated,
            commandPending: state.commandPending,
            sessions: state.snapshot.sessions,
            selectedSessionId: selectedSession?.id || null,
            activeThreadId: selectedSession?.activeThreadId || null,
            selectedSessionMode: 'work'
        }
    }, areAssistantPageShellSelectionsEqual)
    useAssistantChatRouting({
        bootstrapped: shell.bootstrapped,
        commandPending: shell.commandPending,
        sessions: shell.sessions,
        selectedSessionId: shell.selectedSessionId,
        activeThreadId: shell.activeThreadId,
        selectSession: actions.selectSession,
        selectThread: actions.selectThread
    })
    const autoRoutedSelectionRef = useRef<string | null>(null)
    const diffSessionIdRef = useRef<string | null>(shell.selectedSessionId)
    const diffRevealSequenceRef = useRef(1)
    const {
        leftSidebarCollapsed,
        setLeftSidebarCollapsed,
        leftSidebarWidth,
        setLeftSidebarWidth,
        bubblePreviewPinned,
        setBubblePreviewPinned,
        rightPanelMode,
        setRightPanelMode,
        rightSidebarWidth,
        setRightSidebarWidth,
        railMode,
        setRailMode,
        railGroupMode,
        setRailGroupMode,
        railSortMode,
        setRailSortMode,
        railFilterMode,
        setRailFilterMode
    } = useAssistantPageSidebarState(shell.selectedSessionId)
    const [pendingMessageDelete, setPendingMessageDelete] = useState<AssistantMessage | null>(null)
    const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null)
    const [selectedDiffTarget, setSelectedDiffTarget] = useState<AssistantDiffTarget | null>(null)
    const [selectedDiffTurnId, setSelectedDiffTurnId] = useState<string | null>(null)
    const [diffRevealRequest, setDiffRevealRequest] = useState<AssistantDiffRevealRequest | null>(null)
    const [reviewTurnDetails, setReviewTurnDetails] = useState<Record<string, AssistantTurnDetail>>({})
    const [reviewTurnDetailErrors, setReviewTurnDetailErrors] = useState<Record<string, string>>({})
    const pendingReviewTurnIdsRef = useRef(new Set<string>())
    const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
    const autoCollapsedLeftSidebarRef = useRef(false)
    const diffSource = useAssistantStoreSelector<AssistantDiffSourceSelection>((state) => {
        const selectedSession = getSelectedAssistantSession(state.snapshot)
        const activeThread = getActiveAssistantThread(selectedSession)
        const selectionTransitioning = Boolean(
            selectedSession
            && activeThread
            && state.selectionTransitionKey === `${selectedSession.id}:${activeThread.id}`
        )
        const selectionHydrating = Boolean(
            selectedSession
            && activeThread
            && state.selectionHydrationKey === `${selectedSession.id}:${activeThread.id}`
        )
        const hideRowsForSelection = shouldHideAssistantRowsForSelection({
            selectionTransitioning,
            selectionHydrating,
            thread: activeThread
        })
        return {
            threadId: activeThread?.id || null,
            canonicalChatId: activeThread?.providerThreadId || activeThread?.id || null,
            chatTitle: selectedSession?.title || 'Untitled chat',
            messages: hideRowsForSelection ? EMPTY_ASSISTANT_MESSAGES : activeThread?.messages || EMPTY_ASSISTANT_MESSAGES,
            activities: hideRowsForSelection ? EMPTY_ASSISTANT_ACTIVITIES : activeThread?.activities || EMPTY_ASSISTANT_ACTIVITIES,
            projectRootPath: selectedSession?.workingRoot || selectedSession?.projectPath || activeThread?.cwd || null,
            projectRoots: selectedSession?.chatScope?.roots || EMPTY_ASSISTANT_PROJECT_ROOTS,
            activeTurnId: activeThread?.latestTurn?.state === 'running' ? activeThread.latestTurn.id : null,
            fleetSnapshot: activeThread ? state.snapshot.fleetByThreadId[activeThread.id] || null : null
        }
    }, areAssistantDiffSourceSelectionsEqual)
    const inspectorOpen = rightPanelMode === 'review'
    const prepareInspector = useCallback(() => {
        void loadAssistantDiffPanel().catch(() => undefined)
    }, [])
    const revealBrowserInspector = useCallback(() => {
        prepareInspector()
        setRightPanelMode('review')
    }, [prepareInspector, setRightPanelMode])
    const resizeBrowserInspector = useCallback((width: number) => {
        prepareInspector()
        setRightPanelMode('review')
        setRightSidebarWidth(width)
    }, [prepareInspector, setRightPanelMode, setRightSidebarWidth])
    const {
        request: browserSurfaceRequest,
        handleRequest: handleBrowserSurfaceRequestHandled
    } = useAssistantBrowserSurfaceRequests({
        threadId: diffSource.threadId,
        revealInspector: revealBrowserInspector,
        resizeInspector: resizeBrowserInspector
    })
    const { reviewIndex, reviewIndexLoading, reviewIndexError } = useAssistantReviewIndex({
        threadId: diffSource.threadId,
        enabled: inspectorOpen,
        prefetch: false,
        refreshKey: diffSource.activeTurnId || 'idle'
    })
    const reviewDiffSource = useMemo(() => {
        const details = Object.values(reviewTurnDetails).filter((detail) => detail.threadId === diffSource.threadId)
        const mergeById = <T extends { id: string },>(loaded: T[], persisted: T[]) => {
            const byId = new Map(persisted.map((entry) => [entry.id, entry]))
            for (const entry of loaded) byId.set(entry.id, entry)
            return [...byId.values()]
        }
        return {
            ...diffSource,
            messages: reconcileAssistantMessageReplays(
                mergeById(diffSource.messages, details.flatMap((detail) => detail.messages))
            ),
            activities: mergeById(diffSource.activities, details.flatMap((detail) => detail.activities))
        }
    }, [diffSource, reviewTurnDetails])
    const detailedDiffTurns = useMemo(
        () => inspectorOpen ? buildAssistantDiffTurns({
            ...reviewDiffSource,
            turns: reviewIndex?.turns
        }) : [],
        [inspectorOpen, reviewDiffSource, reviewIndex?.turns]
    )
    const hydratedReviewTurnIds = useMemo(
        () => new Set(Object.entries(reviewTurnDetails)
            .filter(([, detail]) => detail.threadId === diffSource.threadId)
            .map(([turnId]) => turnId)),
        [diffSource.threadId, reviewTurnDetails]
    )
    const diffTurns = useMemo(
        () => inspectorOpen ? mergeAssistantReviewIndex({
            index: reviewIndex,
            detailedTurns: detailedDiffTurns,
            hydratedTurnIds: hydratedReviewTurnIds,
            projectRootPath: diffSource.projectRootPath,
            activeTurnId: diffSource.activeTurnId
        }) : [],
        [detailedDiffTurns, diffSource.activeTurnId, diffSource.projectRootPath, hydratedReviewTurnIds, inspectorOpen, reviewIndex]
    )
    const selectedTargetActivity = selectedDiffTarget
        ? diffSource.activities.find((activity) => activity.id === selectedDiffTarget.activityId) || null
        : null
    const targetTurnId = selectedDiffTarget?.turnId
        || selectedTargetActivity?.turnId
        || (selectedTargetActivity ? `activity:${selectedTargetActivity.id}` : null)
    const effectiveDiffTurnId = selectedDiffTurnId && diffTurns.some((turn) => turn.id === selectedDiffTurnId)
        ? selectedDiffTurnId
        : targetTurnId && diffTurns.some((turn) => turn.id === targetTurnId)
            ? targetTurnId
            : diffTurns[0]?.id || null
    const selectedDiffTurn = diffTurns.find((turn) => turn.id === effectiveDiffTurnId) || null
    const targetBelongsToSelectedTurn = Boolean(
        selectedDiffTarget
        && selectedDiffTurn
        && (
            targetTurnId === selectedDiffTurn.id
            || selectedDiffTurn.files.some((file) => (
                file.target.activityId === selectedDiffTarget.activityId
                && file.target.filePath === selectedDiffTarget.filePath
            ))
        )
    )
    const refreshedSelectedTurnTarget = targetBelongsToSelectedTurn && selectedDiffTarget
        ? selectedDiffTurn?.changes.find((change) => (
            change.target.activityId === selectedDiffTarget.activityId
            && change.target.filePath === selectedDiffTarget.filePath
        ))?.target || null
        : null
    const effectiveDiffTarget = refreshedSelectedTurnTarget
        || (targetBelongsToSelectedTurn ? selectedDiffTarget : null)
        || selectedDiffTurn?.files[0]?.target
        || null
    const effectiveDiffActivity = effectiveDiffTarget
        ? reviewDiffSource.activities.find((activity) => activity.id === effectiveDiffTarget.activityId) || null
        : null
    const selectedDiff = useMemo(
        () => effectiveDiffTarget ? resolveAssistantDiffTarget(effectiveDiffTarget, effectiveDiffActivity) : null,
        [effectiveDiffActivity, effectiveDiffTarget]
    )
    const { toast, showToast } = useAssistantTransientToast()
    const messageSearchRequestRef = useRef<string | null>(null)
    useEffect(() => {
        if (!messageSearchTarget) {
            messageSearchRequestRef.current = null
            return
        }
        if (!shell.bootstrapped || shell.commandPending || !shell.selectedSessionId || !shell.activeThreadId) return
        if (
            requestedChatTarget.kind !== 'chat'
            || requestedChatTarget.sessionId !== shell.selectedSessionId
            || (requestedChatTarget.threadId && requestedChatTarget.threadId !== shell.activeThreadId)
        ) return
        const requestKey = `${shell.selectedSessionId}:${shell.activeThreadId}:${messageSearchTarget}`
        if (messageSearchRequestRef.current === requestKey) return
        messageSearchRequestRef.current = requestKey
        void actions.loadHistoryAroundMessage(shell.activeThreadId, messageSearchTarget).then((focused) => {
            if (messageSearchRequestRef.current !== requestKey) return
            if (!focused) showToast('That search result is no longer available.', 'error')
        })
    }, [actions, messageSearchTarget, requestedChatTarget, shell.activeThreadId, shell.bootstrapped, shell.commandPending, shell.selectedSessionId, showToast])

    useEffect(() => {
        const handleResize = () => setViewportWidth(window.innerWidth)
        window.addEventListener('resize', handleResize)
        return () => window.removeEventListener('resize', handleResize)
    }, [])

    const paneLayout = resolveAssistantPaneLayout({
        viewportWidth,
        leftSidebarCollapsed,
        leftSidebarWidth,
        inspectorOpen,
        inspectorWidth: rightSidebarWidth
    })

    useEffect(() => {
        const turnId = selectedDiffTurn?.detailLoaded === false ? selectedDiffTurn.id : null
        const threadId = diffSource.threadId
        if (!inspectorOpen || !threadId || !turnId || reviewTurnDetails[turnId] || pendingReviewTurnIdsRef.current.has(turnId)) return
        pendingReviewTurnIdsRef.current.add(turnId)
        setReviewTurnDetailErrors((current) => {
            if (!current[turnId]) return current
            const next = { ...current }
            delete next[turnId]
            return next
        })
        let cancelled = false
        void window.devscope.assistant.getTurnDetail({ threadId, turnId }).then((result) => {
            if (cancelled) return
            if (!result.success) {
                setReviewTurnDetailErrors((current) => ({ ...current, [turnId]: result.error || 'Failed to load turn details.' }))
                return
            }
            setReviewTurnDetails((current) => ({ ...current, [turnId]: result.detail }))
        }).catch((error) => {
            if (cancelled) return
            setReviewTurnDetailErrors((current) => ({
                ...current,
                [turnId]: error instanceof Error ? error.message : 'Failed to load turn details.'
            }))
        }).finally(() => pendingReviewTurnIdsRef.current.delete(turnId))
        return () => { cancelled = true }
    }, [diffSource.threadId, inspectorOpen, reviewTurnDetails, selectedDiffTurn])

    useEffect(() => {
        setReviewTurnDetails({})
        setReviewTurnDetailErrors({})
        pendingReviewTurnIdsRef.current.clear()
    }, [diffSource.threadId])

    useEffect(() => {
        if (inspectorOpen) return
        setReviewTurnDetails({})
        setReviewTurnDetailErrors({})
        pendingReviewTurnIdsRef.current.clear()
    }, [inspectorOpen])

    useEffect(() => {
        if (paneLayout.autoCollapseLeftSidebar && !leftSidebarCollapsed) {
            autoCollapsedLeftSidebarRef.current = true
            setLeftSidebarCollapsed(true)
            return
        }
        if (!paneLayout.autoCollapseLeftSidebar && autoCollapsedLeftSidebarRef.current) {
            autoCollapsedLeftSidebarRef.current = false
            setLeftSidebarCollapsed(false)
        }
    }, [leftSidebarCollapsed, paneLayout.autoCollapseLeftSidebar, setLeftSidebarCollapsed])

    useEffect(() => {
        const sessionId = shell.selectedSessionId
        if (!sessionId) {
            autoRoutedSelectionRef.current = null
            return
        }

        const selectionKey = `${sessionId}:${shell.selectedSessionMode}`
        if (autoRoutedSelectionRef.current === selectionKey) return
        autoRoutedSelectionRef.current = selectionKey

        if (railMode !== shell.selectedSessionMode) {
            setRailMode(shell.selectedSessionMode)
        }
    }, [railMode, setRailMode, shell.selectedSessionId, shell.selectedSessionMode])

    useEffect(() => {
        if (diffSessionIdRef.current === shell.selectedSessionId) return
        diffSessionIdRef.current = shell.selectedSessionId
        setSelectedDiffTarget(null)
        setSelectedDiffTurnId(null)
        setDiffRevealRequest(null)
        setRightPanelMode('none')
    }, [setRightPanelMode, shell.selectedSessionId])

    useEffect(() => {
        if (!filesShellLaunchRequest) return
        diffSessionIdRef.current = shell.selectedSessionId
        prepareInspector()
        setRightPanelMode('review')
    }, [filesShellLaunchRequest?.id, prepareInspector, setRightPanelMode])

    const handleFilesShellLaunchRequestHandled = useCallback((requestId: string) => {
        setFilesShellLaunchRequest((current) => current?.id === requestId ? null : current)
    }, [])

    const handleStartDetachedPlaygroundChat = useCallback(async () => {
        setRailMode('work')
        await actions.createSession({ mode: 'work' })
    }, [actions, setRailMode])

    const handlePlaygroundTerminalAccessChange = useCallback((enabled: boolean) => {
        void enabled
    }, [])

    const handlePlaygroundTerminalAccessRequestMutedChange = useCallback((muted: boolean) => {
        void muted
    }, [])

    const handleChoosePlaygroundRoot = useCallback(async () => {
        const folderResult = await window.devscope.selectFolder()
        if (!folderResult.success || folderResult.cancelled || !folderResult.folderPath) return
        setRailMode('work')
        await actions.setPlaygroundRoot(folderResult.folderPath)
    }, [actions, setRailMode])

    const openAssistantTarget = useCallback(async (target: string, startInEditMode = false, notifyFailure = true) => {
        const opened = await openAssistantFileTarget({
            target,
            projectPath: diffSource.projectRootPath,
            openPreview: preview.openPreview,
            previewOptions: startInEditMode ? { startInEditMode: true } : undefined
        })
        if (!opened && notifyFailure) showToast('Could not open that file.', 'error')
        return opened
    }, [diffSource.projectRootPath, preview.openPreview, showToast])

    const handleOpenAssistantInternalLink = useCallback(async (href: string) => {
        return openAssistantTarget(href, false, false)
    }, [openAssistantTarget])

    const handleOpenEditedFile = useCallback(async (filePath: string) => {
        await openAssistantTarget(filePath, true)
    }, [openAssistantTarget])

    const handleOpenAttachmentPreview = useCallback(async (
        file: { name: string; path: string },
        ext: string,
        options?: PreviewOpenOptions
    ) => {
        await preview.openPreview(file, ext, options)
    }, [preview.openPreview])

    const handleDeleteUserMessage = useCallback(async () => {
        if (!pendingMessageDelete) return
        try {
            setDeletingMessageId(pendingMessageDelete.id)
            const result = await actions.deleteMessageResult(pendingMessageDelete.id, shell.selectedSessionId || undefined)
            if (!result.success) {
                showToast(`Failed to delete message: ${result.error}`, 'error')
                return
            }
            setPendingMessageDelete(null)
            showToast('Deleted message')
        } finally {
            setDeletingMessageId(null)
        }
    }, [actions, pendingMessageDelete, shell.selectedSessionId, showToast])

    const handleToggleAssistantLeftSidebar = useCallback(() => {
        setLeftSidebarCollapsed((current) => !current)
    }, [setLeftSidebarCollapsed])

    useEffect(() => {
        window.addEventListener('zyra:toggle-assistant-sidebar', handleToggleAssistantLeftSidebar)
        return () => window.removeEventListener('zyra:toggle-assistant-sidebar', handleToggleAssistantLeftSidebar)
    }, [handleToggleAssistantLeftSidebar])

    useEffect(() => {
        window.dispatchEvent(new CustomEvent('zyra:assistant-sidebar-state', {
            detail: {
                collapsed: paneLayout.leftSidebarCollapsed,
                width: paneLayout.leftSidebarWidth || leftSidebarWidth
            }
        }))
    }, [leftSidebarWidth, paneLayout.leftSidebarCollapsed, paneLayout.leftSidebarWidth])

    const handleCancelPendingMessageDelete = useCallback(() => {
        if (deletingMessageId) return
        setPendingMessageDelete(null)
    }, [deletingMessageId])

    const handleViewDiff = useCallback((target: AssistantDiffTarget) => {
        prepareInspector()
        diffSessionIdRef.current = shell.selectedSessionId
        setSelectedDiffTarget(target)
        const activity = diffSource.activities.find((entry) => entry.id === target.activityId)
        const turnId = target.turnId || activity?.turnId || (activity ? `activity:${activity.id}` : null)
        setSelectedDiffTurnId(turnId)
        setDiffRevealRequest(turnId ? { id: diffRevealSequenceRef.current++, turnId } : null)
        setRightPanelMode('review')
    }, [diffSource.activities, prepareInspector, setRightPanelMode, shell.selectedSessionId])
    const handleSelectDiffTurn = useCallback((turnId: string) => {
        setDiffRevealRequest(null)
        setSelectedDiffTurnId(turnId)
        const turn = diffTurns.find((entry) => entry.id === turnId)
        setSelectedDiffTarget(turn?.files[0]?.target || null)
    }, [diffTurns])
    const handleSelectInspectorDiff = useCallback((target: AssistantDiffTarget) => {
        const activity = diffSource.activities.find((entry) => entry.id === target.activityId)
        setSelectedDiffTurnId(target.turnId || activity?.turnId || (activity ? `activity:${activity.id}` : null))
        setSelectedDiffTarget(target)
    }, [diffSource.activities])
    const handleDiffRevealRequestHandled = useCallback((requestId: number) => {
        setDiffRevealRequest((current) => current?.id === requestId ? null : current)
    }, [])
    const handleToggleInspector = useCallback(() => {
        if (rightPanelMode === 'review') {
            setRightPanelMode('none')
            return
        }
        prepareInspector()
        setSelectedDiffTarget(null)
        setSelectedDiffTurnId(null)
        setDiffRevealRequest(null)
        setRightPanelMode('review')
    }, [prepareInspector, rightPanelMode, setRightPanelMode])
    const handleCloseDiff = useCallback(() => {
        setSelectedDiffTarget(null)
        setSelectedDiffTurnId(null)
        setDiffRevealRequest(null)
        setRightPanelMode('none')
    }, [setRightPanelMode])
    const noop = useCallback(() => undefined, [])

    return (
        <div className="flex h-[calc(100vh-34px)] min-h-[calc(100vh-34px)] flex-col overflow-hidden [--accent-primary:var(--color-primary)] [--accent-secondary:var(--color-secondary)]">
            <div className="min-h-0 flex-1 overflow-hidden">
                <div className="flex h-full min-w-0 overflow-x-hidden">
                    <ConnectedAssistantSessionsRail
                        collapsed={paneLayout.leftSidebarCollapsed}
                        width={leftSidebarWidth}
                        maxWidth={paneLayout.maxLeftSidebarWidth}
                        previewPinned={bubblePreviewPinned}
                        railMode={railMode}
                        railGroupMode={railGroupMode}
                        railSortMode={railSortMode}
                        railFilterMode={railFilterMode}
                        onRailModeChange={setRailMode}
                        onRailGroupModeChange={setRailGroupMode}
                        onRailSortModeChange={setRailSortMode}
                        onRailFilterModeChange={setRailFilterMode}
                        onWidthChange={setLeftSidebarWidth}
                        onPreviewPinnedChange={setBubblePreviewPinned}
                        onShowToast={showToast}
                    />
                    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
                        <AssistantConversationPane
                            rightPanelOpen={inspectorOpen}
                            rightPanelMode={rightPanelMode}
                            showRightSidebarToggle
                            deletingMessageId={deletingMessageId}
                            focusMessageId={messageSearchTarget}
                            fallbackSessionMode={railMode}
                            playgroundRootMissing={false}
                            playgroundTerminalAccess={false}
                            playgroundTerminalAccessRequestMuted={false}
                            autoStartDetachedPlaygroundChat={false}
                            onPlaygroundTerminalAccessChange={handlePlaygroundTerminalAccessChange}
                            onPlaygroundTerminalAccessRequestMutedChange={handlePlaygroundTerminalAccessRequestMutedChange}
                            onChoosePlaygroundRoot={handleChoosePlaygroundRoot}
                            onStartDetachedPlaygroundChat={handleStartDetachedPlaygroundChat}
                            onRequestDeleteUserMessage={setPendingMessageDelete}
                            onToggleRightSidebar={handleToggleInspector}
                            onTogglePlanPanel={noop}
                            onOpenAssistantLink={handleOpenAssistantInternalLink}
                            onOpenAttachmentPreview={handleOpenAttachmentPreview}
                            onOpenEditedFile={handleOpenEditedFile}
                            onViewDiff={handleViewDiff}
                            onShowToast={showToast}
                        />
                        {inspectorOpen ? (
                            <Suspense fallback={(
                                <aside
                                    className="h-full shrink-0 border-l border-[var(--surface-panel-divider)] bg-[var(--surface-panel)]"
                                    style={{ width: paneLayout.inspectorWidth }}
                                    aria-label="Opening inspector"
                                />
                            )}>
                                <AssistantDiffPanel
                                    open
                                    sessionId={shell.selectedSessionId}
                                    threadId={diffSource.threadId}
                                    canonicalChatId={diffSource.canonicalChatId}
                                    chatTitle={diffSource.chatTitle}
                                    width={paneLayout.inspectorWidth}
                                    maxWidth={paneLayout.maxInspectorWidth}
                                    turns={diffTurns}
                                    reviewIndexReady={Boolean(reviewIndex)}
                                    reviewIndexLoading={reviewIndexLoading && !reviewIndex}
                                    reviewIndexError={reviewIndexError}
                                    turnDetailError={effectiveDiffTurnId ? reviewTurnDetailErrors[effectiveDiffTurnId] || null : null}
                                    activeTurnId={diffSource.activeTurnId}
                                    revealRequest={diffRevealRequest}
                                    selectedTurnId={effectiveDiffTurnId}
                                    selectedDiff={selectedDiff}
                                    projectPath={diffSource.projectRootPath}
                                    projectRoots={diffSource.projectRoots}
                                    filesShellLaunchRequest={filesShellLaunchRequest}
                                    onFilesShellLaunchRequestHandled={handleFilesShellLaunchRequestHandled}
                                    fleetSnapshot={diffSource.fleetSnapshot}
                                    browserSurfaceRequest={browserSurfaceRequest}
                                    onBrowserSurfaceRequestHandled={handleBrowserSurfaceRequestHandled}
                                    onOpenPreview={preview.openPreview}
                                    onOpenPreviewInNewTab={preview.openPreviewInNewTab}
                                    onWidthChange={setRightSidebarWidth}
                                    onSelectTurn={handleSelectDiffTurn}
                                    onSelectDiff={handleSelectInspectorDiff}
                                    onRevealRequestHandled={handleDiffRevealRequestHandled}
                                    onClose={handleCloseDiff}
                                />
                            </Suspense>
                        ) : null}
                    </div>
                </div>
            </div>
            <DeleteHistoryConfirm
                isOpen={Boolean(pendingMessageDelete)}
                deleting={Boolean(deletingMessageId)}
                onConfirm={() => void handleDeleteUserMessage()}
                onCancel={handleCancelPendingMessageDelete}
            />
            <AssistantTransientToast toast={toast} />
            {preview.previewFile ? (
                <Suspense fallback={null}>
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
                        projectPath={diffSource.projectRootPath || undefined}
                        chromeContext="peek"
                        mediaItems={preview.previewMediaItems}
                        onOpenLinkedPreview={preview.openPreview}
                        onOpenLinkedPreviewInNewTab={preview.openPreviewInNewTab}
                        onSelectPreviewTab={preview.setActivePreviewTab}
                        onClosePreviewTab={preview.closePreviewTab}
                        onReorderPreviewTabs={preview.reorderPreviewTabs}
                        onShowToast={showToast}
                        onClose={preview.closePreview}
                    />
                </Suspense>
            ) : null}
        </div>
    )
}
