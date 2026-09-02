import { LoaderCircle, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AssistantActivity, AssistantMessage, AssistantTurnDetail, FleetSnapshot } from '@shared/assistant/contracts'
import type { ControlStateSnapshot, ControlWorkspaceSnapshot } from '@shared/agent-control/contracts'
import type { BrowserSurfaceOpenRequest } from '@shared/agent-control/protocol'
import type {
    AssistantUtilityAgentsStateCapsule,
    AssistantUtilityResourcesStateCapsule,
    AssistantUtilityReviewStateCapsule,
    AssistantUtilityStateCapsule,
    AssistantUtilityTab
} from '@shared/assistant/utility-window'
import FilePreviewModal from '@/components/ui/FilePreviewModal'
import { useFilePreview } from '@/components/ui/file-preview/useFilePreview'
import { useAssistantStoreSelector } from '@/lib/assistant/store'
import { AssistantBrowserWorkspace, type AssistantBrowserWorkspaceController } from '../AssistantBrowserWorkspace'
import { AssistantFilesWorkspace } from '../AssistantFilesWorkspace'
import { AssistantFleetWorkspace } from '../AssistantFleetWorkspace'
import { AssistantPreviewResourceNavigator } from '../AssistantPreviewResourceNavigator'
import { AssistantResourcesWorkspace } from '../AssistantResourcesWorkspace'
import { AssistantReviewLanding } from '../AssistantReviewLanding'
import { AssistantTerminalWorkspace } from '../AssistantTerminalWorkspace'
import { AssistantThreadDetailsWorkspace } from '../AssistantControlWorkspace'
import { AssistantTurnReview } from '../AssistantTurnReview'
import { buildAssistantDiffTurns } from '../assistant-diff-turns'
import type { AssistantDiffTarget, AssistantDiffTurn } from '../assistant-diff-types'
import { mergeAssistantReviewIndex } from '../assistant-review-index'
import { useAssistantFleetSnapshot } from '../useAssistantFleetSnapshot'
import { useAssistantReviewIndex } from '../useAssistantReviewIndex'
import {
    captureAssistantUtilityScrollAnchor,
    resolveAssistantUtilityDiffSelection,
    restoreAssistantUtilityScrollAnchor,
    toAssistantUtilityDiffSelection
} from '../assistant-utility-state-capsules'

type UtilityThreadData = {
    messages: AssistantMessage[]
    activities: AssistantActivity[]
    activeTurnId: string | null
    fleetSnapshot: FleetSnapshot | null
}

const EMPTY_MESSAGES: AssistantMessage[] = []
const EMPTY_ACTIVITIES: AssistantActivity[] = []
const REVIEW_NAVIGATION_MOTION_MS = 230

export function AssistantUtilityWorkspaceHost({ tab, active, windowId, onStateCapsuleChange }: {
    tab: AssistantUtilityTab
    active: boolean
    windowId: string
    onStateCapsuleChange?: (tabId: string, capsule: AssistantUtilityStateCapsule) => void
}) {
    const preview = useFilePreview()
    const capsuleRootRef = useRef<HTMLDivElement | null>(null)
    const capsuleRef = useRef<AssistantUtilityStateCapsule | undefined>(tab.stateCapsule)
    const reviewWorkspace = tab.workspace === 'diff' || tab.workspace === 'resources' || tab.workspace === 'turn'
    const needsReviewData = active && reviewWorkspace
    const needsFleetData = active && (tab.workspace === 'details' || tab.workspace === 'agents')
    const [turnDetails, setTurnDetails] = useState<Record<string, AssistantTurnDetail>>({})
    const resourcesCapsule = tab.stateCapsule?.workspace === 'resources' ? tab.stateCapsule : undefined
    const reviewCapsule = tab.stateCapsule?.workspace === 'diff' || tab.stateCapsule?.workspace === 'turn' ? tab.stateCapsule : undefined
    const agentsCapsule = tab.stateCapsule?.workspace === 'agents' ? tab.stateCapsule : undefined
    const [resourceTurnId, setResourceTurnId] = useState<string | null>(resourcesCapsule?.drillDown?.turnId || null)
    const [resourceDiff, setResourceDiff] = useState<AssistantDiffTarget | null>(null)
    const publishCapsule = useCallback((capsule: AssistantUtilityStateCapsule) => {
        capsuleRef.current = capsule
        onStateCapsuleChange?.(tab.id, capsule)
    }, [onStateCapsuleChange, tab.id])
    useEffect(() => {
        if (reviewWorkspace) return
        setTurnDetails((current) => Object.keys(current).length === 0 ? current : {})
        setResourceTurnId(null)
        setResourceDiff(null)
    }, [reviewWorkspace])
    const threadData = useAssistantStoreSelector<UtilityThreadData>((state) => {
        const session = state.snapshot.sessions.find((entry) => entry.id === tab.sessionId)
        const thread = session?.threads.find((entry) => entry.id === tab.threadId)
        return {
            messages: needsReviewData ? thread?.messages || EMPTY_MESSAGES : EMPTY_MESSAGES,
            activities: needsReviewData ? thread?.activities || EMPTY_ACTIVITIES : EMPTY_ACTIVITIES,
            activeTurnId: needsReviewData && thread?.latestTurn?.state === 'running' ? thread.latestTurn.id : null,
            fleetSnapshot: needsFleetData ? state.snapshot.fleetByThreadId[tab.threadId] || null : null
        }
    }, (left, right) => left.messages === right.messages && left.activities === right.activities && left.activeTurnId === right.activeTurnId && left.fleetSnapshot === right.fleetSnapshot)
    const { reviewIndex, reviewIndexLoading, reviewIndexError } = useAssistantReviewIndex({
        threadId: tab.threadId,
        enabled: needsReviewData,
        prefetch: false,
        refreshKey: threadData.activeTurnId || 'idle'
    })
    const turns = useMemo(() => {
        const detailValues = Object.values(turnDetails)
        const detailed = buildAssistantDiffTurns({
            messages: [...threadData.messages, ...detailValues.flatMap((detail) => detail.messages)],
            activities: [...threadData.activities, ...detailValues.flatMap((detail) => detail.activities)],
            projectRootPath: tab.projectPath,
            turns: reviewIndex?.turns
        })
        return mergeAssistantReviewIndex({
            index: reviewIndex,
            detailedTurns: detailed,
            hydratedTurnIds: new Set(Object.keys(turnDetails)),
            projectRootPath: tab.projectPath,
            activeTurnId: threadData.activeTurnId
        })
    }, [reviewIndex, tab.projectPath, tab.threadId, threadData, turnDetails])
    useEffect(() => {
        const requestedDiff = resourcesCapsule?.drillDown?.selectedDiff
        if (!requestedDiff || resourceDiff) return
        const resolved = resolveAssistantUtilityDiffSelection(turns, requestedDiff)
        if (resolved) setResourceDiff(resolved)
    }, [resourceDiff, resourcesCapsule?.drillDown?.selectedDiff, turns])

    useEffect(() => {
        restoreAssistantUtilityScrollAnchor(capsuleRootRef.current, tab.stateCapsule?.scrollAnchor)
    }, [tab.stateCapsule])

    const hydrateTurn = useCallback(async (turnId: string) => {
        if (turnDetails[turnId]) return
        const result = await window.devscope.assistant.getTurnDetail({ threadId: tab.threadId, turnId })
        if (result.success) setTurnDetails((current) => ({ ...current, [turnId]: result.detail }))
    }, [tab.threadId, turnDetails])

    useEffect(() => {
        if (tab.workspace === 'browser' || tab.workspace === 'terminal') return
        void window.devscope.assistantUtility.tabReady(windowId, tab.id)
    }, [tab.id, tab.workspace, windowId])

    const previewResourceNavigator = tab.workspace === 'resources' && preview.previewFile ? (
        <AssistantPreviewResourceNavigator
            turns={turns}
            projectPath={tab.projectPath || null}
            activeFilePath={preview.previewFile.path}
            onOpenPreview={preview.openPreview}
            onOpenUrl={(url) => { void window.devscope.openBrowserPreviewExternal(url) }}
        />
    ) : undefined
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
            projectPath={tab.projectPath || undefined}
            active={active}
            chromeContext="peek"
            mediaItems={preview.previewMediaItems}
            navigationSidebar={previewResourceNavigator}
            onOpenLinkedPreview={preview.openPreview}
            onOpenLinkedPreviewInNewTab={preview.openPreviewInNewTab}
            onSelectPreviewTab={preview.setActivePreviewTab}
            onClosePreviewTab={preview.closePreviewTab}
            onReorderPreviewTabs={preview.reorderPreviewTabs}
            onClose={preview.closePreview}
        />
    ) : null

    const wrapCapsuleSurface = (content: ReactNode) => (
        <div
            ref={capsuleRootRef}
            className="flex min-h-0 min-w-0 flex-1"
            onScrollCapture={(event) => {
                const anchor = captureAssistantUtilityScrollAnchor(event)
                const current = capsuleRef.current
                if (anchor && current) publishCapsule({ ...current, scrollAnchor: anchor })
            }}
        >
            {content}
        </div>
    )
    const handleResourcesCapsule = (capsule: AssistantUtilityResourcesStateCapsule) => publishCapsule({
        ...capsule,
        scrollAnchor: capsule.scrollAnchor || capsuleRef.current?.scrollAnchor,
        drillDown: resourceTurnId ? {
            turnId: resourceTurnId,
            selectedDiff: toAssistantUtilityDiffSelection(resourceDiff) || resourcesCapsule?.drillDown?.selectedDiff
        } : undefined
    })

    if (tab.workspace === 'browser') return <><UtilityBrowser tab={tab} active={active} windowId={windowId} onOpenPreview={preview.openPreview} />{previewModal}</>
    if (tab.workspace === 'explorer') {
        return <AssistantFilesWorkspace projectPath={tab.path || tab.projectPath || null} projectRoots={tab.projectRoots || []} active={active} stateCapsule={tab.stateCapsule?.workspace === 'explorer' ? tab.stateCapsule : undefined} onStateCapsuleChange={publishCapsule} />
    }
    if (tab.workspace === 'terminal') {
        const terminalRuntimeId = tab.terminalRuntimeId || tab.id
        return <AssistantTerminalWorkspace workspaceKey={terminalRuntimeId} projectPath={tab.path || tab.projectPath || null} active={active} terminalOwner={{ kind: 'utility-tab', tabId: tab.id }} onReady={() => void window.devscope.assistantUtility.tabReady(windowId, tab.id)} />
    }
    if (tab.workspace === 'details') {
        const detailsCapsule = tab.stateCapsule?.workspace === 'details' ? tab.stateCapsule : { version: 1 as const, workspace: 'details' as const }
        capsuleRef.current ||= detailsCapsule
        return wrapCapsuleSurface(<UtilityDetails tab={tab} active={active} projectedFleet={threadData.fleetSnapshot} />)
    }
    if (tab.workspace === 'agents') {
        return wrapCapsuleSurface(<UtilityAgents tab={tab} active={active} projectedFleet={threadData.fleetSnapshot} stateCapsule={agentsCapsule} onStateCapsuleChange={(capsule) => publishCapsule({ ...capsule, scrollAnchor: capsule.scrollAnchor || capsuleRef.current?.scrollAnchor })} />)
    }
    if (tab.workspace === 'resources') {
        const resourceTurn = turns.find((turn) => turn.id === resourceTurnId) || null
        capsuleRef.current ||= resourcesCapsule || { version: 1, workspace: 'resources' }
        if (resourceTurn) {
            return wrapCapsuleSurface(<AssistantTurnReview turn={resourceTurn} selectedDiff={resourceDiff || resourceTurn.files[0]?.target || null} focusSelectedDiffRequestId={null} showBack onBack={() => { setResourceTurnId(null); setResourceDiff(null); publishCapsule({ ...(capsuleRef.current as AssistantUtilityResourcesStateCapsule), drillDown: undefined }) }} onSelectDiff={(target) => { setResourceDiff(target); publishCapsule({ ...(capsuleRef.current as AssistantUtilityResourcesStateCapsule), drillDown: { turnId: resourceTurn.id, selectedDiff: toAssistantUtilityDiffSelection(target) } }) }} />)
        }
        return wrapCapsuleSurface(
            <><AssistantResourcesWorkspace
                turns={turns}
                projectPath={tab.projectPath || null}
                onOpenPreview={preview.openPreview}
                onOpenPreviewInNewTab={preview.openPreviewInNewTab}
                onOpenUrl={(url) => void window.devscope.openBrowserPreviewExternal(url)}
                onOpenDiff={(target) => { if (target.turnId) void hydrateTurn(target.turnId); setResourceTurnId(target.turnId || null); setResourceDiff(target); if (target.turnId) publishCapsule({ ...(capsuleRef.current as AssistantUtilityResourcesStateCapsule), drillDown: { turnId: target.turnId, selectedDiff: toAssistantUtilityDiffSelection(target) } }) }}
                onOpenTurn={(turnId) => { void hydrateTurn(turnId); setResourceTurnId(turnId); setResourceDiff(null); publishCapsule({ ...(capsuleRef.current as AssistantUtilityResourcesStateCapsule), drillDown: { turnId } }) }}
                stateCapsule={resourcesCapsule}
                onStateCapsuleChange={handleResourcesCapsule}
            />{previewModal}</>
        )
    }
    if (tab.workspace === 'diff' || tab.workspace === 'turn') {
        capsuleRef.current ||= reviewCapsule || { version: 1, workspace: tab.workspace }
        return wrapCapsuleSurface(<UtilityReview tab={tab} turns={turns} activeTurnId={threadData.activeTurnId} loading={reviewIndexLoading} error={reviewIndexError} ready={Boolean(reviewIndex)} onNeedTurnDetail={hydrateTurn} stateCapsule={reviewCapsule} onStateCapsuleChange={(capsule) => publishCapsule({ ...capsule, scrollAnchor: capsule.scrollAnchor || capsuleRef.current?.scrollAnchor })} />)
    }
    return <UtilityError message="This tab type is unavailable." />
}

function UtilityBrowser({ tab, active, windowId, onOpenPreview }: {
    tab: AssistantUtilityTab
    active: boolean
    windowId: string
    onOpenPreview: ReturnType<typeof useFilePreview>['openPreview']
}) {
    const [controlState, setControlState] = useState<ControlStateSnapshot | null>(null)
    const [navigationRequest, setNavigationRequest] = useState<{
        id: number
        tabId: string
        url: string
        sessionMode: 'normal' | 'incognito'
    } | null>(null)
    const [surfaceRequest, setSurfaceRequest] = useState<BrowserSurfaceOpenRequest | null>(() => ({
        version: 1,
        requestId: `utility-open:${tab.id}`,
        threadId: tab.threadId,
        tabId: tab.id,
        sessionMode: tab.sessionMode || 'normal',
        reveal: false,
        mode: 'open',
        requestedBy: { type: 'root', threadId: tab.threadId, turnId: 'utility-user-command' }
    }))
    const controllerRef = useRef<AssistantBrowserWorkspaceController | null>(null)
    const initialUrlRef = useRef(tab.url || '')
    const initialNavigationCompleteRef = useRef(!tab.url)
    const publishedMetadataRef = useRef('')
    useEffect(() => {
        let cancelled = false
        void window.devscope.agentControl.getState().then((result) => { if (!cancelled && result.success) setControlState(result.state) })
        const unsubscribe = window.devscope.agentControl.onStateChange((state) => { if (!cancelled) setControlState(state) })
        return () => { cancelled = true; unsubscribe() }
    }, [])
    return (
        <AssistantBrowserWorkspace
            workspaceKey={`utility:${tab.canonicalChatId}:${tab.id}`}
            threadId={tab.threadId}
            projectPath={tab.projectPath || null}
            active={active}
            selectedTabId={null}
            controlState={controlState}
            navigationRequest={navigationRequest}
            surfaceRequest={surfaceRequest}
            onNavigationRequestHandled={(id) => {
                initialNavigationCompleteRef.current = true
                setNavigationRequest((current) => current?.id === id ? null : current)
            }}
            onSurfaceRequestHandled={(requestId) => {
                setSurfaceRequest((current) => current?.requestId === requestId ? null : current)
                if (initialUrlRef.current) setNavigationRequest({
                    id: Date.now(),
                    tabId: tab.id,
                    url: initialUrlRef.current,
                    sessionMode: tab.sessionMode || 'normal'
                })
            }}
            onLocalControlTargetChange={(tabId) => {
                if (tabId === tab.id) void window.devscope.assistantUtility.tabReady(windowId, tab.id)
            }}
            onWorkspaceStateChange={(state: ControlWorkspaceSnapshot['browser']) => {
                if (active) {
                    void window.devscope.agentControl.updateWorkspaceState({
                        version: 1,
                        threadId: tab.threadId,
                        inspector: { open: true, width: window.innerWidth, activeWorkspace: 'browser', openWorkspaces: ['browser'] },
                        browser: state,
                        updatedAt: new Date().toISOString()
                    })
                }
            }}
            onTabsChange={(state) => {
                const browserTab = state.tabs.find((entry) => entry.id === tab.id)
                if (!browserTab) return
                if (!initialNavigationCompleteRef.current && initialUrlRef.current && !browserTab.url) return
                const hasLivePage = Boolean(browserTab.url)
                const key = `${browserTab.title}\u0000${browserTab.url}\u0000${hasLivePage}\u0000${browserTab.faviconUrl || ''}`
                if (publishedMetadataRef.current === key) return
                publishedMetadataRef.current = key
                void window.devscope.assistantUtility.updateTab(windowId, tab.id, { title: browserTab.title, url: browserTab.url, hasLivePage, faviconUrl: browserTab.faviconUrl })
            }}
            onRequestTabSelection={(tabId) => controllerRef.current?.activateTab(tabId)}
            onControllerChange={(controller) => { controllerRef.current = controller }}
            onDeveloperToast={() => undefined}
            onOpenPreview={onOpenPreview}
        />
    )
}

function UtilityDetails({ tab, active, projectedFleet }: { tab: AssistantUtilityTab; active: boolean; projectedFleet: FleetSnapshot | null }) {
    const { snapshot } = useAssistantFleetSnapshot({ threadId: tab.threadId, projected: projectedFleet, enabled: active })
    const [controlState, setControlState] = useState<ControlStateSnapshot | null>(null)
    useEffect(() => {
        let cancelled = false
        void window.devscope.agentControl.getState().then((result) => { if (!cancelled && result.success) setControlState(result.state) })
        const unsubscribe = window.devscope.agentControl.onStateChange((state) => { if (!cancelled) setControlState(state) })
        return () => { cancelled = true; unsubscribe() }
    }, [])
    return <AssistantThreadDetailsWorkspace active={active} sessionId={tab.sessionId} threadId={tab.threadId} projectPath={tab.projectPath || null} fleetSnapshot={snapshot} controlState={controlState} />
}

function UtilityAgents({ tab, active, projectedFleet, stateCapsule, onStateCapsuleChange }: {
    tab: AssistantUtilityTab
    active: boolean
    projectedFleet: FleetSnapshot | null
    stateCapsule?: AssistantUtilityAgentsStateCapsule
    onStateCapsuleChange: (capsule: AssistantUtilityAgentsStateCapsule) => void
}) {
    const { snapshot } = useAssistantFleetSnapshot({ threadId: tab.threadId, projected: projectedFleet, enabled: active })
    const [selectedAgentRunId, setSelectedAgentRunId] = useState<string | null>(stateCapsule?.selectedAgentRunId || null)
    const [selectedWorkflowRunId, setSelectedWorkflowRunId] = useState<string | null>(stateCapsule?.selectedWorkflowRunId || null)
    return (
        <AssistantFleetWorkspace
            threadId={tab.threadId}
            snapshot={snapshot}
            selectedAgentRunId={selectedAgentRunId}
            selectedWorkflowRunId={selectedWorkflowRunId}
            onSelectAgent={setSelectedAgentRunId}
            onSelectWorkflow={setSelectedWorkflowRunId}
            onAgentAction={(action, agentRunId) => void window.devscope.assistant.agentAction({ threadId: tab.threadId, action, payload: { agentRunId } })}
            onWorkflowAction={(action, workflowRunId) => void window.devscope.assistant.workflowAction({ threadId: tab.threadId, action, payload: { workflowRunId, scope: 'personal' } })}
            stateCapsule={stateCapsule}
            onStateCapsuleChange={onStateCapsuleChange}
        />
    )
}

function UtilityReview({ tab, turns, activeTurnId, ready, loading, error, onNeedTurnDetail, stateCapsule, onStateCapsuleChange }: {
    tab: AssistantUtilityTab
    turns: AssistantDiffTurn[]
    activeTurnId: string | null
    ready: boolean
    loading: boolean
    error: string | null
    onNeedTurnDetail: (turnId: string) => Promise<void>
    stateCapsule?: AssistantUtilityReviewStateCapsule
    onStateCapsuleChange: (capsule: AssistantUtilityReviewStateCapsule) => void
}) {
    const [selectedTurnId, setSelectedTurnId] = useState<string | null>(() => stateCapsule?.selectedTurnId || tab.turnId || null)
    const [transitionTurnId, setTransitionTurnId] = useState<string | null>(() => stateCapsule?.selectedTurnId || tab.turnId || null)
    const selectedTurn = turns.find((turn) => turn.id === selectedTurnId) || null
    const transitionTurn = turns.find((turn) => turn.id === transitionTurnId) || null
    const detailPresented = Boolean(selectedTurnId && transitionTurn?.id === selectedTurnId)
    const [selectedDiff, setSelectedDiff] = useState<AssistantDiffTarget | null>(null)
    const indexSurfaceRef = useRef<HTMLDivElement | null>(null)
    const detailSurfaceRef = useRef<HTMLDivElement | null>(null)
    const navigationAnimationsRef = useRef<Animation[]>([])
    const previousDetailPresentedRef = useRef(detailPresented)
    useEffect(() => {
        if (selectedDiff || !stateCapsule?.selectedDiff) return
        const resolved = resolveAssistantUtilityDiffSelection(turns, stateCapsule.selectedDiff)
        if (resolved) setSelectedDiff(resolved)
    }, [selectedDiff, stateCapsule?.selectedDiff, turns])
    useEffect(() => {
        onStateCapsuleChange({
            version: 1,
            workspace: tab.workspace === 'turn' ? 'turn' : 'diff',
            selectedTurnId: selectedTurnId || undefined,
            selectedDiff: toAssistantUtilityDiffSelection(selectedDiff),
            scrollAnchor: stateCapsule?.scrollAnchor
        })
    }, [onStateCapsuleChange, selectedDiff, selectedTurnId, stateCapsule?.scrollAnchor, tab.workspace])
    useEffect(() => {
        if (selectedTurn?.detailLoaded === false) void onNeedTurnDetail(selectedTurn.id)
    }, [onNeedTurnDetail, selectedTurn?.detailLoaded, selectedTurn?.id])
    useLayoutEffect(() => {
        const presentationChanged = previousDetailPresentedRef.current !== detailPresented
        previousDetailPresentedRef.current = detailPresented
        if (!presentationChanged) return

        for (const animation of navigationAnimationsRef.current) animation.cancel()
        navigationAnimationsRef.current = []

        const indexSurface = indexSurfaceRef.current
        const detailSurface = detailSurfaceRef.current
        if (!indexSurface || !detailSurface) return
        const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
            || document.body.classList.contains('zyra-reduce-motion')
        if (reducedMotion || typeof indexSurface.animate !== 'function') {
            if (!detailPresented) setTransitionTurnId(null)
            return
        }

        const options: KeyframeAnimationOptions = {
            duration: REVIEW_NAVIGATION_MOTION_MS,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            fill: 'both'
        }
        const indexAnimation = indexSurface.animate(
            detailPresented
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
            detailPresented
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
        navigationAnimationsRef.current = [indexAnimation, detailAnimation]
        if (!detailPresented) {
            const exitingTurnId = transitionTurnId
            void detailAnimation.finished.then(() => {
                setTransitionTurnId((current) => current === exitingTurnId ? null : current)
            }).catch(() => undefined)
        }
    }, [detailPresented, transitionTurnId])

    useEffect(() => () => {
        for (const animation of navigationAnimationsRef.current) animation.cancel()
        navigationAnimationsRef.current = []
    }, [])

    const openTurn = useCallback((turnId: string) => {
        const turn = turns.find((entry) => entry.id === turnId)
        setTransitionTurnId(turnId)
        setSelectedTurnId(turnId)
        setSelectedDiff(turn?.files[0]?.target || null)
    }, [turns])
    const openFile = useCallback((turnId: string, target: AssistantDiffTarget) => {
        setTransitionTurnId(turnId)
        setSelectedTurnId(turnId)
        setSelectedDiff(target)
    }, [])
    const closeTurn = useCallback(() => {
        setSelectedTurnId(null)
        setSelectedDiff(null)
    }, [])

    return (
        <div className="assistant-review-navigation-stack relative grid min-h-0 min-w-0 flex-1 overflow-hidden">
            <div
                ref={indexSurfaceRef}
                className="assistant-review-navigation-surface assistant-review-navigation-index flex min-h-0 min-w-0"
                data-state={detailPresented ? 'behind' : 'active'}
                aria-hidden={detailPresented}
                inert={detailPresented ? true : undefined}
            >
                <AssistantReviewLanding
                    threadId={tab.threadId}
                    turns={turns}
                    activeTurnId={activeTurnId}
                    ready={ready}
                    loading={loading}
                    error={error}
                    previewMode="glance"
                    onPreviewTurn={onNeedTurnDetail}
                    onOpenTurn={openTurn}
                    onOpenFile={openFile}
                />
            </div>
            {transitionTurn ? (
                <div
                    ref={detailSurfaceRef}
                    className="assistant-review-navigation-surface assistant-review-navigation-detail flex min-h-0 min-w-0"
                    data-state={detailPresented ? 'active' : 'ahead'}
                    aria-hidden={!detailPresented}
                    inert={!detailPresented ? true : undefined}
                >
                    <AssistantTurnReview
                        turn={transitionTurn}
                        selectedDiff={selectedDiff || transitionTurn.files[0]?.target || null}
                        focusSelectedDiffRequestId={null}
                        showBack
                        onBack={closeTurn}
                        onSelectDiff={setSelectedDiff}
                    />
                </div>
            ) : null}
        </div>
    )
}

function UtilityError({ message }: { message: string }) {
    return <div className="flex flex-1 items-center justify-center"><div className="text-center text-sm text-sparkle-text-muted"><TriangleAlert className="mx-auto mb-2" size={18} />{message}</div></div>
}

export function UtilityWorkspaceLoading() {
    return <div className="flex flex-1 items-center justify-center"><LoaderCircle className="animate-spin text-sparkle-text-muted" size={18} /></div>
}
