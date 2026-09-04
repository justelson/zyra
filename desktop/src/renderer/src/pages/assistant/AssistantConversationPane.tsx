import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AssistantApprovalDecision, AssistantChatScopeRoot, AssistantMessage, AssistantProposedPlan, AssistantSession, AssistantVoiceExecutionConfiguration } from '@shared/assistant/contracts'
import { reconcileAssistantMessageReplays } from '@shared/assistant/message-reconciliation'
import { isAssistantSessionProjectLocked } from '@shared/assistant/session-project'
import { useSettings, type AssistantProductProfile } from '@/lib/settings'
import {
    rendererVisibility,
    shouldSnapRendererPresentation,
    useRendererVisibilitySnapshot
} from '@/lib/renderer-visibility'
import { useAssistantConversationStore, useAssistantStoreActions, useAssistantStoreSelector } from '@/lib/assistant/store'
import { usePublishAssistantTitleBarContent } from '@/lib/assistant/assistant-title-bar'
import { hasAssistantPersistedThreadContent, shouldShowAssistantThreadHistoryLoader } from '@/lib/assistant/assistant-history-state'
import { isAssistantThreadActivelyWorking } from '@/lib/assistant/selectors'
import { cn } from '@/lib/utils'
import { resolveAssistantComposerContextUsage } from './assistant-composer-context-usage'
import { buildAssistantTurnUsageIndex } from './assistant-turn-usage-index'
import { buildPromptImageInputs, buildPromptWithContextFiles } from './assistant-composer-utils'
import { clearAssistantComposerSessionState } from './assistant-composer-session-state'
import { projectVoiceLiveTimelineMessages } from './assistant-voice-live-timeline'
import { resolveAssistantComposerLaunchConfiguration } from './assistant-new-chat-composer-config'
import { AssistantCanonicalVoiceDock } from './AssistantCanonicalVoiceDock'
import { AssistantCanonicalVoiceStage } from './AssistantCanonicalVoiceStage'
import { AssistantChatOnboardingOverlay } from './AssistantChatOnboardingOverlay'
import { AssistantConnectionRecoveryBanner } from './AssistantConnectionRecoveryBanner'
import { AssistantConversationHeader } from './AssistantConversationHeader'
import { AssistantConversationComposerPane } from './AssistantConversationComposerPane'
import { AssistantConversationTimelinePane } from './AssistantConversationTimelinePane'
import type { AssistantConversationPaneProps } from './AssistantConversationPane.types'
import { RenameSessionModal, SessionDeleteModal } from './AssistantSessionsRailDialogs'
import type { AssistantComposerSendOptions, AssistantElementBounds, ComposerContextFile } from './assistant-composer-types'
import { getAssistantLinkBaseFilePath } from './assistant-file-navigation'
import {
    ASSISTANT_COMPOSER_OVERLAY_TOP_PADDING_PX,
    resolveAssistantComposerInsetEnd,
    resolveAssistantStableComposerInsetEnd
} from './assistant-pane-layout'
import { getAssistantThreadDisplayTitle, getProjectLabel, getSessionDisplayTitle, isAssistantDraftSession, resolveSessionProjectPath } from './assistant-sessions-rail-utils'
import {
    deriveAssistantConversationSurfaceMode,
    resolveAssistantComposerConnectionPresentation
} from './assistant-conversation-surface-mode'
import { readInstructorVoicePreferences } from './instructor-voice-preferences'
import { useAssistantConnectionRecovery } from './useAssistantConnectionRecovery'
import { useAssistantQueuedComposer, type AssistantQueuedComposerSessionState } from './useAssistantQueuedComposer'
import { useAssistantSessionTurnUsage } from './useAssistantSessionTurnUsage'
import { useInstructorVoiceSession } from './useInstructorVoiceSession'
import { useAssistantPageTimelineScroll } from './useAssistantPageTimelineScroll'
import { useAssistantProjectCatalog } from './useAssistantProjectCatalog'
import { useAgentControlState } from './useAgentControlState'
import { isControlPrincipalForThread } from './assistant-thread-details'

const TIMELINE_SHOW_SCROLL_BUTTON_THRESHOLD_PX = 420
const TIMELINE_HIDE_SCROLL_BUTTON_THRESHOLD_PX = 180
const IMPLEMENT_MODE_TOAST_MS = 2600
const NEW_CHAT_HANDOFF_VISUAL_MS = 360
const NEW_CHAT_HANDOFF_SESSION_ID = 'assistant-session-new-chat-handoff'
const VOICE_TIMELINE_RESERVE_PX = 500
const VOICE_SCROLL_BUTTON_BOTTOM_PX = 78
function areQueuedComposerSessionStatesEqual(
    left: AssistantQueuedComposerSessionState[],
    right: AssistantQueuedComposerSessionState[]
): boolean {
    if (left === right) return true
    if (left.length !== right.length) return false
    for (let index = 0; index < left.length; index += 1) {
        const leftState = left[index]
        const rightState = right[index]
        if (
            leftState.sessionId !== rightState.sessionId
            || leftState.threadState !== rightState.threadState
            || leftState.latestTurnState !== rightState.latestTurnState
            || leftState.pendingApprovalCount !== rightState.pendingApprovalCount
            || leftState.pendingUserInputCount !== rightState.pendingUserInputCount
        ) {
            return false
        }
    }
    return true
}

export function AssistantConversationPane(props: AssistantConversationPaneProps) {
    const controller = useAssistantConversationStore()
    const actions = useAssistantStoreActions()
    const { settings, updateSettings } = useSettings()
    const projectCatalogState = useAssistantProjectCatalog()
    const controlState = useAgentControlState()
    const visibilitySnapshot = useRendererVisibilitySnapshot()
    const composerPaneRef = useRef<HTMLDivElement | null>(null)
    const [zyraProfileOverride, setZyraProfileOverride] = useState<AssistantProductProfile | null>(null)
    const [optimisticPromptStartedAt, setOptimisticPromptStartedAt] = useState<string | null>(null)
    const [optimisticPromptSending, setOptimisticPromptSending] = useState(false)
    const [optimisticPromptBoundary, setOptimisticPromptBoundary] = useState<{
        sessionId: string
        threadId: string | null
        previousUserMessageId: string | null
        startedAt: string
    } | null>(null)
    const [voicePreferences] = useState(readInstructorVoicePreferences)
    const synchronizedZyraProfile = controller.activeThread?.profile === 'builder'
        ? 'builder'
        : controller.activeThread?.profile === 'default'
            ? 'default'
            : null
    const activeZyraProfile = zyraProfileOverride || synchronizedZyraProfile || settings.assistantProductProfile
    const activeRuntimeZyraProfile = zyraProfileOverride || controller.activeThread?.profile || activeZyraProfile
    const setActiveZyraProfile = useCallback((assistantProductProfile: AssistantProductProfile) => {
        setZyraProfileOverride(assistantProductProfile)
        updateSettings({ assistantProductProfile })
    }, [updateSettings])
    useEffect(() => {
        setZyraProfileOverride(null)
    }, [controller.selectedSession?.id])
    useEffect(() => {
        if (zyraProfileOverride && controller.activeThread?.profile === zyraProfileOverride) {
            setZyraProfileOverride(null)
        }
    }, [controller.activeThread?.profile, zyraProfileOverride])
    useEffect(() => {
        if (!synchronizedZyraProfile || synchronizedZyraProfile === settings.assistantProductProfile) return
        updateSettings({ assistantProductProfile: synchronizedZyraProfile })
    }, [settings.assistantProductProfile, synchronizedZyraProfile, updateSettings])
    const [showScrollToBottom, setShowScrollToBottom] = useState(false)
    const [interactionModeOverride, setInteractionModeOverride] = useState<'default' | null>(null)
    const [implementationToastVisible, setImplementationToastVisible] = useState(false)
    const [newChatHandoffRevision, setNewChatHandoffRevision] = useState(0)
    const [composerInsetEnd, setComposerInsetEnd] = useState(0)
    const [attachmentShelfTop, setAttachmentShelfTop] = useState<number | null>(null)
    const [renameTarget, setRenameTarget] = useState<AssistantSession | null>(null)
    const [renameDraft, setRenameDraft] = useState('')
    const [sessionToDelete, setSessionToDelete] = useState<AssistantSession | null>(null)
    const [headerActionPending, setHeaderActionPending] = useState<'rename' | 'project' | 'project-chat' | 'archive' | 'delete' | null>(null)
    const composerInsetEndRef = useRef(0)
    const composerInsetTargetRef = useRef(0)
    const composerInsetFrameRef = useRef<number | null>(null)
    const composerInsetLastFrameAtRef = useRef(0)
    const handledComposerResumeRevisionRef = useRef(visibilitySnapshot.resumeRevision)
    const showScrollToBottomRef = useRef(false)
    const scrollButtonRafRef = useRef<number | null>(null)
    const newChatHandoffUntilRef = useRef(0)
    const voiceExecutionConfigurationRef = useRef<AssistantVoiceExecutionConfiguration | null>(null)

    const isThreadWorking = isAssistantThreadActivelyWorking(controller.activeThread)
    const selectedSessionId = controller.selectedSession?.id || null
    const activeThreadId = controller.activeThread?.id || null
    const handleLoadOlderHistory = useCallback((turnLimit = 1) => actions.loadOlderHistory(activeThreadId || undefined, turnLimit), [actions, activeThreadId])
    const handleLoadNewerHistory = useCallback((turnLimit = 1) => actions.loadNewerHistory(activeThreadId || undefined, turnLimit), [actions, activeThreadId])
    const canonicalVoiceBinding = useMemo(() => (
        selectedSessionId && controller.activeThread?.id
            ? { conversationId: controller.activeThread.id, sessionId: selectedSessionId }
            : undefined
    ), [controller.activeThread?.id, selectedSessionId])
    const voice = useInstructorVoiceSession(canonicalVoiceBinding)
    const voiceVisible = voice.status !== 'idle'
    const voiceThreadRef = useRef(controller.activeThread?.id || null)
    const voiceTimelineAnchorsRef = useRef<{ key: string; anchors: Map<string, number> }>({
        key: '',
        anchors: new Map()
    })
    useEffect(() => {
        const nextThreadId = controller.activeThread?.id || null
        const previousThreadId = voiceThreadRef.current
        voiceThreadRef.current = nextThreadId
        if (previousThreadId && previousThreadId !== nextThreadId && voice.status !== 'idle') {
            void voice.stop()
        }
    }, [controller.activeThread?.id, voice.status, voice.stop])
    const selectedSessionIsDraft = Boolean(controller.selectedSession && isAssistantDraftSession(controller.selectedSession))
    const selectedSessionUsesNewChatSurface = Boolean(selectedSessionIsDraft && !controller.selectedSession?.pendingLabRequest)
    const pendingCreateSessionInput = controller.pendingCreateSessionInput
    const isCreatingFreshChat = Boolean(pendingCreateSessionInput)
    if (isCreatingFreshChat) {
        newChatHandoffUntilRef.current = Math.max(
            newChatHandoffUntilRef.current,
            Date.now() + NEW_CHAT_HANDOFF_VISUAL_MS
        )
    }
    const newChatHandoffActive = isCreatingFreshChat || newChatHandoffUntilRef.current > Date.now()
    const activeComposerSessionId = newChatHandoffActive ? null : selectedSessionId
    useEffect(() => {
        setOptimisticPromptSending(false)
        setOptimisticPromptStartedAt(null)
        setOptimisticPromptBoundary(null)
    }, [activeComposerSessionId])
    const queueSessionStates = useAssistantStoreSelector((state) => (
        state.snapshot.sessions.map((session) => {
            const activeThread = session.threads.find((thread) => thread.id === session.activeThreadId) || null
            return {
                sessionId: session.id,
                threadState: activeThread?.state || 'idle',
                latestTurnState: activeThread?.latestTurn?.state || null,
                pendingApprovalCount: activeThread?.pendingApprovals.filter((approval) => approval.status === 'pending').length || 0,
                pendingUserInputCount: activeThread?.pendingUserInputs.filter((input) => input.status === 'pending').length || 0
            }
        })
    ), areQueuedComposerSessionStatesEqual)
    const selectedProjectPath = controller.selectedSession ? resolveSessionProjectPath(controller.selectedSession) : ''
    const selectedProjectId = controller.selectedSession?.projectId || null
    const pendingCreateProjectPath = pendingCreateSessionInput?.workingRoot?.trim()
        || pendingCreateSessionInput?.projectPath?.trim()
        || ''
    const pendingCreateProjectId = pendingCreateSessionInput?.projectId?.trim() || null
    const lastResolvedProjectPathBySessionRef = useRef<Record<string, string>>({})
    const selectedSessionMode = 'work' as const
    const displayProjectPath = isCreatingFreshChat ? pendingCreateProjectPath : selectedProjectPath || (
        (controller.commandPending || controller.loading) && selectedSessionId
            ? lastResolvedProjectPathBySessionRef.current[selectedSessionId] || ''
            : ''
    )
    const displayProjectId = isCreatingFreshChat ? pendingCreateProjectId : selectedProjectId
    const selectedProjectRecord = projectCatalogState.catalog.projects.find((project) => project.id === displayProjectId) || null
    const displayProjectName = selectedProjectRecord?.name || null
    const selectedSessionTitle = controller.selectedSession ? getSessionDisplayTitle(controller.selectedSession) : 'Assistant'
    const activeThreadIsSubagent = controller.activeThread?.source === 'subagent'
    const activeThreadLabel = controller.activeThread ? getAssistantThreadDisplayTitle(controller.activeThread) : null
    const selectedProjectTooltip = displayProjectPath || (
        'Select a project when this chat needs files.'
    )
    const latestProjectLabel = displayProjectPath
        ? (displayProjectPath.split(/[\\/]/).filter(Boolean).pop() || displayProjectPath)
        : 'select project'
    const newChatProjectChoices = useMemo(() => projectCatalogState.catalog.projects
        .filter((project) => !project.archived)
        .flatMap((project) => [
            {
                projectId: project.id,
                path: project.homePath,
                label: project.name,
                rootLabel: 'Project home'
            },
            ...project.folders.filter((folder) => folder.available).map((folder) => ({
                projectId: project.id,
                path: folder.path,
                label: project.name,
                rootLabel: `${folder.label}${folder.access === 'read-only' ? ' · Read only' : ''}`
            }))
        ]), [projectCatalogState.catalog.projects])
    const composerProjectRoots = useMemo<AssistantChatScopeRoot[]>(() => {
        if (!isCreatingFreshChat) {
            const revisionedRoots = controller.selectedSession?.chatScope?.roots || []
            if (revisionedRoots.length > 0) return revisionedRoots
            return displayProjectPath ? [{
                id: `working-root:${displayProjectPath}`,
                kind: 'project-home',
                path: displayProjectPath,
                label: displayProjectName || latestProjectLabel,
                access: 'read-write'
            }] : []
        }
        if (!selectedProjectRecord) return displayProjectPath ? [{
            id: `working-root:${displayProjectPath}`,
            kind: 'project-home',
            path: displayProjectPath,
            label: displayProjectName || latestProjectLabel,
            access: 'read-write'
        }] : []
        return [
            {
                id: `project-home:${selectedProjectRecord.id}`,
                kind: 'project-home',
                path: selectedProjectRecord.homePath,
                label: selectedProjectRecord.name,
                access: 'read-write'
            },
            ...selectedProjectRecord.folders.filter((folder) => folder.available).map((folder) => ({
                id: folder.folderId,
                kind: 'associated-folder' as const,
                path: folder.path,
                label: folder.label,
                access: folder.access
            }))
        ]
    }, [controller.selectedSession?.chatScope?.roots, displayProjectName, displayProjectPath, isCreatingFreshChat, latestProjectLabel, selectedProjectRecord])
    const detectedProjectChoices = useMemo(() => projectCatalogState.catalog.candidates
        .filter((candidate) => candidate.status === 'pending')
        .map((candidate) => ({ id: candidate.id, path: candidate.path, label: candidate.suggestedName })),
    [projectCatalogState.catalog.candidates])
    const assistantMessageFilePath = useMemo(
        () => getAssistantLinkBaseFilePath(displayProjectPath),
        [displayProjectPath]
    )
    const availableModels = useMemo(() => {
        if (controller.knownModels.length > 0) return controller.knownModels
        const activeModel = String(controller.activeThread?.model || '').trim()
        return activeModel ? [{ id: activeModel, label: activeModel }] : []
    }, [controller.activeThread?.model, controller.knownModels])
    const { sessionTurnUsage } = useAssistantSessionTurnUsage({
        sessionId: activeComposerSessionId,
        enabled: Boolean(activeComposerSessionId),
        refreshKey: `${controller.activeThread?.latestTurn?.id || ''}:${controller.activeThread?.latestTurn?.completedAt || ''}:${controller.activeThread?.latestTurn?.state || ''}`
    })
    const turnUsageById = useMemo(
        () => buildAssistantTurnUsageIndex(
            controller.timelineMessages,
            sessionTurnUsage?.turns || [],
            selectedSessionId && controller.activeThread?.latestTurn
                ? {
                    sessionId: selectedSessionId,
                    threadId: controller.activeThread.id,
                    model: controller.activeThread.model,
                    latestTurn: controller.activeThread.latestTurn
                }
                : null
        ),
        [
            controller.activeThread?.id,
            controller.activeThread?.latestTurn,
            controller.activeThread?.model,
            controller.timelineMessages,
            selectedSessionId,
            sessionTurnUsage?.turns
        ]
    )
    const composerContextUsage = useMemo(() => controller.selectionHydrating
        ? null
        : resolveAssistantComposerContextUsage({
            liveUsage: controller.activeThread?.latestTurn?.usage,
            sessionTurns: sessionTurnUsage?.turns,
            threadId: controller.activeThread?.id
        }), [controller.activeThread?.id, controller.activeThread?.latestTurn?.usage, controller.selectionHydrating, sessionTurnUsage?.turns])

    const timelineIsWorking = (isThreadWorking || optimisticPromptSending)
        && !voiceVisible
        && !controller.history?.pageInfo.hasNewer
    const latestCanonicalUserMessageId = [...controller.timelineMessages].reverse().find((message) => message.role === 'user')?.id || null
    const optimisticBoundaryBelongsToThread = Boolean(
        optimisticPromptBoundary
        && optimisticPromptBoundary.sessionId === selectedSessionId
        && optimisticPromptBoundary.threadId === activeThreadId
    )
    const optimisticPromptAwaitingUserMessage = Boolean(
        optimisticBoundaryBelongsToThread
        && latestCanonicalUserMessageId === optimisticPromptBoundary?.previousUserMessageId
    )
    const timelinePresentationIsWorking = timelineIsWorking && !optimisticPromptAwaitingUserMessage
    const shouldShowWorkingIndicator = timelinePresentationIsWorking
        && !controller.timelineMessages.some((message) => message.role === 'assistant' && message.streaming)
    const canonicalLatestTurnStartedAt = controller.activeThread?.latestTurn?.startedAt || null
    const effectiveLatestTurnStartedAt = optimisticBoundaryBelongsToThread
        && optimisticPromptBoundary
        && (!canonicalLatestTurnStartedAt || canonicalLatestTurnStartedAt < optimisticPromptBoundary.startedAt)
        ? optimisticPromptBoundary.startedAt
        : canonicalLatestTurnStartedAt || optimisticPromptStartedAt
    const displayedTimelineMessages = useMemo((): AssistantMessage[] => {
        const canonicalMessages = reconcileAssistantMessageReplays(controller.timelineMessages)
        if (!voiceVisible || voice.transcript.length === 0) return canonicalMessages
        const anchorKey = `${controller.activeThread?.id || 'no-thread'}:${voice.startedAt || 'not-started'}`
        if (voiceTimelineAnchorsRef.current.key !== anchorKey) {
            voiceTimelineAnchorsRef.current = { key: anchorKey, anchors: new Map() }
        }
        const projection = projectVoiceLiveTimelineMessages({
            transcript: voice.transcript,
            canonicalMessages,
            activities: controller.activityFeed,
            proposedPlans: controller.activeThread?.proposedPlans || [],
            voiceStartedAt: voice.startedAt,
            previousAnchors: voiceTimelineAnchorsRef.current.anchors
        })
        voiceTimelineAnchorsRef.current.anchors = projection.anchors
        return projection.messages.length > 0
            ? [...canonicalMessages, ...projection.messages]
            : canonicalMessages
    }, [
        controller.activeThread?.id,
        controller.activeThread?.proposedPlans,
        controller.activityFeed,
        controller.timelineMessages,
        voice.startedAt,
        voice.transcript,
        voiceVisible
    ])
    const lastTimelineMessage = displayedTimelineMessages[displayedTimelineMessages.length - 1] || null
    const latestTimelineActivity = controller.activityFeed[0] || null
    const selectedThreadHasHistoricalContent = hasAssistantPersistedThreadContent(controller.activeThread)
    const projectDirectoryLocked = isAssistantSessionProjectLocked(controller.selectedSession)
    const connectionRecovery = useAssistantConnectionRecovery({
        selectedSessionId: activeComposerSessionId,
        activeThreadId: newChatHandoffActive ? null : controller.activeThread?.id || null,
        threadState: newChatHandoffActive ? null : controller.activeThread?.state || null,
        loading: controller.loading,
        connected: controller.connected,
        commandPending: newChatHandoffActive ? false : controller.commandPending,
        deferUntilFirstPrompt: selectedSessionUsesNewChatSurface,
        threadLastError: controller.activeThread?.lastError || null,
        commandError: controller.commandError,
        activities: newChatHandoffActive ? [] : controller.activityFeed,
        connectResult: (sessionId) => actions.connectResult(sessionId),
        disconnect: (sessionId) => actions.disconnect(sessionId)
    })
    const isReconnectPending = !newChatHandoffActive && (
        connectionRecovery.reconnectPending || (controller.commandPending && !controller.connected && !isThreadWorking)
    )
    const isThreadConnecting = controller.phase.key === 'starting' || isReconnectPending
    const activeStatusLabel = isThreadConnecting ? 'Connecting...' : 'Working...'
    const composerConnectionPresentation = resolveAssistantComposerConnectionPresentation({
        connected: controller.connected,
        hasComposerSession: Boolean(activeComposerSessionId),
        newChatHandoffActive,
        selectedSessionUsesNewChatSurface,
        connecting: isThreadConnecting,
        reconnectPending: connectionRecovery.reconnectPending
    })
    const { timelineContentRef, timelineScrollRef, onScrollTimeline, onScrollToBottom } = useAssistantPageTimelineScroll({
        sessionId: activeComposerSessionId,
        threadId: newChatHandoffActive ? null : controller.activeThread?.id || null,
        loading: controller.loading,
        timelineMessageCount: displayedTimelineMessages.length,
        lastTimelineMessageId: lastTimelineMessage?.id || null,
        lastTimelineMessageUpdatedAt: lastTimelineMessage?.updatedAt || null,
        activityFeedCount: controller.activityFeed.length,
        latestTimelineActivityId: latestTimelineActivity?.id || null,
        latestTimelineActivityCreatedAt: latestTimelineActivity?.createdAt || null,
        shouldShowWorkingIndicator,
        latestTurnStartedAt: effectiveLatestTurnStartedAt,
        latestTurnState: controller.activeThread?.latestTurn?.state || null,
        threadState: controller.activeThread?.state || null
    })
    const isLoadingSelectedChat = Boolean(
        !newChatHandoffActive
        && !selectedSessionUsesNewChatSurface
        && !isThreadConnecting
        && controller.selectedSession
        && controller.timelineMessages.length === 0
        && controller.activityFeed.length === 0
        && shouldShowAssistantThreadHistoryLoader({
            selectionHydrating: controller.selectionHydrating,
            snapshotLoading: controller.loading,
            historyLoaded: Boolean(controller.history),
            historyLoadFailed: Boolean(controller.commandError),
            hasPersistedContent: selectedThreadHasHistoricalContent
        })
    )
    const showPlaygroundRootOnboarding = false
    const showWorkProjectOnboarding = false
    const showPlaygroundDetachedOnboarding = false
    const showChatOnboardingOverlay = showPlaygroundRootOnboarding || showWorkProjectOnboarding || showPlaygroundDetachedOnboarding
    const connectionBelongsToSelectedChat = Boolean(activeComposerSessionId) && isThreadConnecting && !selectedSessionUsesNewChatSurface
    const effectivePendingApprovals = newChatHandoffActive
        ? []
        : controller.activeThread?.pendingApprovals.filter((approval) => approval.status === 'pending') || []
    const permissionThreadId = newChatHandoffActive ? null : controller.activeThread?.id || null
    const pendingControlGrants = controlState?.pendingGrants.filter((request) => isControlPrincipalForThread(request.principal, permissionThreadId)) || []
    const pendingControlActions = (controlState?.pendingActionApprovals || []).filter((request) => isControlPrincipalForThread(request.principal, permissionThreadId))
    const hasPendingControlApproval = pendingControlGrants.length > 0 || pendingControlActions.length > 0
    const effectivePendingUserInputs = newChatHandoffActive ? [] : controller.pendingUserInputs
    const conversationSurfaceMode = deriveAssistantConversationSurfaceMode({
        newChatHandoffActive,
        selectedSessionUsesNewChatSurface,
        showChatOnboardingOverlay,
        selectedThreadHasHistoricalContent,
        timelineMessageCount: controller.timelineMessages.length,
        activityCount: controller.activityFeed.length,
        proposedPlanCount: controller.activeThread?.proposedPlans.length || 0,
        isThreadWorking,
        connectionBelongsToSelectedChat,
        isLoadingSelectedChat,
        pendingApprovalCount: effectivePendingApprovals.length + pendingControlGrants.length + pendingControlActions.length,
        pendingInputCount: effectivePendingUserInputs.length,
        hasPendingLabRequest: Boolean(controller.selectedSession?.pendingLabRequest)
    })
    const composerIsCentered = conversationSurfaceMode === 'centered-composer' && !voiceVisible
    const bottomComposerOverlayActive = !composerIsCentered
    const effectiveComposerInsetEnd = resolveAssistantStableComposerInsetEnd(
        composerInsetEnd,
        bottomComposerOverlayActive
    )
    const visibleComposerSessionId = newChatHandoffActive
        ? NEW_CHAT_HANDOFF_SESSION_ID
        : selectedSessionId
    const activeComposerConfiguration = resolveAssistantComposerLaunchConfiguration({
        useSettingsDefaults: selectedSessionIsDraft || newChatHandoffActive,
        settings,
        thread: controller.activeThread,
        fallbackModel: availableModels[0]?.id,
        interactionModeOverride
    })
    const resetComposerStateToken = isCreatingFreshChat
        ? `${selectedSessionId || 'pending'}:${pendingCreateProjectPath || 'chat'}`
        : null
    const emptyComposerProjectLabel = displayProjectPath
        ? (displayProjectPath.split(/[\\/]/).filter(Boolean).pop() || displayProjectPath)
        : ''
    const emptyComposerPrompt = useMemo(() => {
        const hour = new Date().getHours()
        const timeGreeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
        const projectPrompts = emptyComposerProjectLabel ? [
            `${timeGreeting}. What are we shaping in ${emptyComposerProjectLabel}?`,
            `Ready to open up ${emptyComposerProjectLabel}?`,
            `What needs attention in ${emptyComposerProjectLabel}?`,
            `Where should we start in ${emptyComposerProjectLabel}?`,
            `What are we making better in ${emptyComposerProjectLabel}?`
        ] : [
            `${timeGreeting}. What are we working on?`,
            'What are we opening up first?',
            'Bring me the bug, the idea, or the messy bit.',
            'What are we figuring out today?',
            'Tell me what changed, broke, or needs building.'
        ]
        return projectPrompts[Math.floor(Math.random() * projectPrompts.length)]
    }, [emptyComposerProjectLabel])

    const getDistanceFromBottom = useCallback((element: HTMLDivElement) => {
        return Math.max(0, element.scrollHeight - element.scrollTop - element.clientHeight)
    }, [])

    const syncScrollButtonVisibility = useCallback((element: HTMLDivElement) => {
        const distanceFromBottom = getDistanceFromBottom(element)
        const shouldShowButton = showScrollToBottomRef.current
            ? distanceFromBottom > TIMELINE_HIDE_SCROLL_BUTTON_THRESHOLD_PX
            : distanceFromBottom > TIMELINE_SHOW_SCROLL_BUTTON_THRESHOLD_PX

        if (showScrollToBottomRef.current !== shouldShowButton) {
            showScrollToBottomRef.current = shouldShowButton
            setShowScrollToBottom(shouldShowButton)
        }
    }, [getDistanceFromBottom])

    const handleTimelineScrollEvent = useCallback((element: HTMLDivElement) => {
        onScrollTimeline(element)
        if (scrollButtonRafRef.current !== null) {
            window.cancelAnimationFrame(scrollButtonRafRef.current)
        }
        scrollButtonRafRef.current = window.requestAnimationFrame(() => {
            scrollButtonRafRef.current = null
            syncScrollButtonVisibility(element)
        })
    }, [onScrollTimeline, syncScrollButtonVisibility])

    const updateComposerInsetEnd = useCallback((nextInsetEnd: number, immediate = false) => {
        const target = Math.max(0, nextInsetEnd)
        const current = composerInsetEndRef.current
        const visibility = rendererVisibility.getSnapshot()
        const startsFromEmpty = current === 0 && composerInsetTargetRef.current === 0
        composerInsetTargetRef.current = target

        const commit = (value: number) => {
            composerInsetEndRef.current = value
            setComposerInsetEnd(value)
        }
        const shouldReduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
        if (
            immediate
            || startsFromEmpty
            || shouldSnapRendererPresentation(visibility, visibility.resumeRevision)
            || shouldReduceMotion
            || Math.abs(target - current) < 0.35
        ) {
            if (composerInsetFrameRef.current !== null) window.cancelAnimationFrame(composerInsetFrameRef.current)
            composerInsetFrameRef.current = null
            commit(target)
            return
        }
        if (composerInsetFrameRef.current !== null) return

        composerInsetLastFrameAtRef.current = window.performance.now()
        const animate = (now: number) => {
            composerInsetFrameRef.current = null
            const elapsed = Math.max(1, Math.min(40, now - composerInsetLastFrameAtRef.current))
            composerInsetLastFrameAtRef.current = now
            const frameTarget = composerInsetTargetRef.current
            const frameCurrent = composerInsetEndRef.current
            const blend = 1 - Math.exp(-elapsed / 68)
            const next = frameCurrent + (frameTarget - frameCurrent) * blend

            if (Math.abs(frameTarget - next) < 0.35) {
                commit(frameTarget)
                return
            }

            commit(Math.round(next * 10) / 10)
            composerInsetFrameRef.current = window.requestAnimationFrame(animate)
        }
        composerInsetFrameRef.current = window.requestAnimationFrame(animate)
    }, [])

    const handleAttachmentShelfBoundsChange = useCallback((bounds: AssistantElementBounds | null) => {
        const nextTop = bounds ? Math.floor(bounds.top) : null
        setAttachmentShelfTop((current) => current === nextTop ? current : nextTop)
    }, [])

    const measureComposerInsetEnd = useCallback((immediate = false) => {
        if (!bottomComposerOverlayActive) {
            updateComposerInsetEnd(0, true)
            return
        }
        const element = composerPaneRef.current
        if (!element) return
        const paneRect = element.getBoundingClientRect()
        const insetEnd = resolveAssistantComposerInsetEnd({
            paneTop: paneRect.top,
            paneBottom: paneRect.bottom,
            attachmentShelfTop,
            contentTopInset: ASSISTANT_COMPOSER_OVERLAY_TOP_PADDING_PX
        })
        updateComposerInsetEnd(insetEnd, immediate)
    }, [attachmentShelfTop, bottomComposerOverlayActive, updateComposerInsetEnd])

    useLayoutEffect(() => {
        const shouldSnap = shouldSnapRendererPresentation(
            visibilitySnapshot,
            handledComposerResumeRevisionRef.current
        )
        handledComposerResumeRevisionRef.current = visibilitySnapshot.resumeRevision
        if (!shouldSnap) return
        measureComposerInsetEnd(true)
    }, [
        measureComposerInsetEnd,
        visibilitySnapshot.resumeRevision,
        visibilitySnapshot.visible
    ])

    useLayoutEffect(() => {
        const element = composerPaneRef.current
        measureComposerInsetEnd()
        if (!bottomComposerOverlayActive || !element) return
        const observer = typeof ResizeObserver !== 'undefined'
            ? new ResizeObserver(() => measureComposerInsetEnd())
            : null
        observer?.observe(element)
        return () => observer?.disconnect()
    }, [bottomComposerOverlayActive, effectivePendingUserInputs.length, measureComposerInsetEnd])

    useEffect(() => {
        if (!selectedSessionId || !selectedProjectPath) return
        lastResolvedProjectPathBySessionRef.current[selectedSessionId] = selectedProjectPath
    }, [selectedProjectPath, selectedSessionId])

    useEffect(() => {
        if (!isCreatingFreshChat) return
        clearAssistantComposerSessionState(NEW_CHAT_HANDOFF_SESSION_ID)
        if (selectedSessionId && selectedSessionIsDraft) clearAssistantComposerSessionState(selectedSessionId)
    }, [isCreatingFreshChat, selectedSessionId, selectedSessionIsDraft])

    useEffect(() => {
        if (isCreatingFreshChat) return
        const remainingMs = newChatHandoffUntilRef.current - Date.now()
        if (remainingMs <= 0) return
        const timeoutId = window.setTimeout(() => {
            newChatHandoffUntilRef.current = 0
            setNewChatHandoffRevision((current) => current + 1)
        }, Math.max(0, remainingMs))
        return () => window.clearTimeout(timeoutId)
    }, [isCreatingFreshChat, newChatHandoffRevision, selectedSessionId])

    useLayoutEffect(() => {
        const element = timelineScrollRef.current
        if (!element) return
        showScrollToBottomRef.current = false
        setShowScrollToBottom(false)
        syncScrollButtonVisibility(element)
    }, [controller.activeThread?.id, controller.loading, controller.selectedSession?.id, syncScrollButtonVisibility, timelineScrollRef])

    useLayoutEffect(() => {
        const element = timelineScrollRef.current
        if (!element) return
        syncScrollButtonVisibility(element)
    }, [
        controller.activityFeed.length,
        controller.timelineMessages.length,
        isLoadingSelectedChat,
        syncScrollButtonVisibility,
        timelineScrollRef
    ])

    useEffect(() => {
        return () => {
            if (scrollButtonRafRef.current !== null) {
                window.cancelAnimationFrame(scrollButtonRafRef.current)
            }
            if (composerInsetFrameRef.current !== null) {
                window.cancelAnimationFrame(composerInsetFrameRef.current)
            }
        }
    }, [])

    useEffect(() => {
        if (controller.activeThread?.interactionMode === 'default') {
            setInteractionModeOverride(null)
        }
    }, [controller.activeThread?.interactionMode, controller.activeThread?.id])

    useEffect(() => {
        setInteractionModeOverride(null)
        setImplementationToastVisible(false)
        setRenameTarget(null)
        setRenameDraft('')
        setSessionToDelete(null)
    }, [controller.activeThread?.id, selectedSessionId])

    useEffect(() => {
        if (!implementationToastVisible) return
        const timeoutId = window.setTimeout(() => setImplementationToastVisible(false), IMPLEMENT_MODE_TOAST_MS)
        return () => window.clearTimeout(timeoutId)
    }, [implementationToastVisible])

    const handleScrollToBottomClick = useCallback(() => {
        showScrollToBottomRef.current = false
        setShowScrollToBottom(false)
        onScrollToBottom()
    }, [onScrollToBottom])

    const handleComposerOverflowWheel = useCallback((deltaY: number) => {
        if (deltaY === 0) return
        const element = timelineScrollRef.current
        if (!element) return
        element.scrollTop += deltaY
        handleTimelineScrollEvent(element)
    }, [handleTimelineScrollEvent, timelineScrollRef])

    const handleRefreshModels = useCallback(() => {
        actions.refreshModels()
    }, [actions])

    const handleRespondApproval = useCallback(async (requestId: string, decision: AssistantApprovalDecision) => {
        await actions.respondApproval(requestId, decision)
    }, [actions])

    const handleRespondUserInput = useCallback(async (requestId: string, answers: Record<string, string | string[]>) => {
        await actions.respondUserInput(requestId, answers)
    }, [actions])

    const handleApprovePendingPlaygroundLabRequest = useCallback(async (input: { title?: string; source: 'empty' | 'git-clone'; repoUrl?: string }) => {
        const sessionId = controller.selectedSession?.id
        if (!sessionId) return
        await actions.approvePendingPlaygroundLabRequest({
            sessionId,
            source: input.source,
            title: input.title,
            repoUrl: input.repoUrl
        })
    }, [actions, controller.selectedSession?.id])

    const handleDeclinePendingPlaygroundLabRequest = useCallback(async () => {
        const sessionId = controller.selectedSession?.id
        if (!sessionId) return
        await actions.declinePendingPlaygroundLabRequest({ sessionId })
    }, [actions, controller.selectedSession?.id])

    const handleStopTurn = useCallback(async () => {
        await actions.interruptTurn(
            controller.activeThread?.latestTurn?.id,
            controller.selectedSession?.id || undefined
        )
    }, [actions, controller.activeThread?.latestTurn?.id, controller.selectedSession?.id])

    const handleReconnectAssistant = useCallback(() => {
        connectionRecovery.reconnect()
    }, [connectionRecovery])

    const handleComposerSendingChange = useCallback((sending: boolean) => {
        setOptimisticPromptSending(sending)
        setOptimisticPromptStartedAt((current) => sending ? current || new Date().toISOString() : null)
    }, [])

    const handleDispatchPrompt = useCallback(async (
        sessionId: string,
        prompt: string,
        contextFiles: ComposerContextFile[],
        options: AssistantComposerSendOptions
    ) => {
        if (!sessionId) return false
        const startedAt = new Date().toISOString()
        const previousUserMessageId = [...controller.timelineMessages].reverse().find((message) => message.role === 'user')?.id || null
        setOptimisticPromptBoundary({
            sessionId,
            threadId: controller.activeThread?.id || null,
            previousUserMessageId,
            startedAt
        })
        setOptimisticPromptStartedAt((current) => current || startedAt)
        const images = buildPromptImageInputs(contextFiles)
        const result = await actions.sendPromptResult(buildPromptWithContextFiles(prompt, contextFiles), {
            sessionId,
            model: options.model,
            runtimeMode: options.runtimeMode,
            interactionMode: options.interactionMode,
            effort: options.effort,
            serviceTier: options.serviceTier,
            profile: activeRuntimeZyraProfile,
            images: images.length > 0 ? images : undefined
        })
        if (!result.success) {
            setOptimisticPromptBoundary((current) => current?.sessionId === sessionId ? null : current)
            if (images.length > 0) props.onShowToast?.(`Could not send image: ${result.error}`, 'error')
        }
        return result.success
    }, [actions, activeRuntimeZyraProfile, controller.activeThread?.id, controller.timelineMessages, props.onShowToast])
    const isAssistantBusy = !newChatHandoffActive && (controller.commandPending || isThreadWorking)
    const {
        sendingComposerPrompt,
        queuedComposerMessageCount,
        queuedComposerMessageItems,
        handleSendPrompt,
        handleForceQueuedMessage,
        handleDeleteQueuedMessage,
        handleMoveQueuedMessage
    } = useAssistantQueuedComposer({
        selectedSessionId: activeComposerSessionId,
        sessionStates: queueSessionStates,
        isAssistantBusy,
        commandPending: !newChatHandoffActive && controller.commandPending,
        isThreadWorking: !newChatHandoffActive && isThreadWorking,
        activeTurnId: newChatHandoffActive ? null : controller.activeThread?.latestTurn?.id || null,
        busyMessageMode: settings.assistantBusyMessageMode,
        onSendingChange: handleComposerSendingChange,
        dispatchPrompt: handleDispatchPrompt,
        interruptTurn: (turnId, sessionId) => actions.interruptTurn(turnId, sessionId)
    })
    const handleImplementProposedPlan = useCallback(async (plan: AssistantProposedPlan) => {
        const planMarkdown = String(plan.planMarkdown || '').trim()
        if (!planMarkdown) return

        setInteractionModeOverride('default')
        setImplementationToastVisible(true)
        await actions.sendPromptResult(
            `Implement the approved plan below. Do not re-plan unless you hit a real blocking contradiction. Start executing now.\n\n<approved_plan>\n${planMarkdown}\n</approved_plan>`,
            {
                sessionId: selectedSessionId || undefined,
                model: controller.activeThread?.model || undefined,
                runtimeMode: controller.activeThread?.runtimeMode || 'approval-required',
                interactionMode: 'default',
                effort: controller.activeThread?.latestTurn?.effort || undefined,
                serviceTier: controller.activeThread?.latestTurn?.serviceTier === 'fast' ? 'fast' : undefined,
                profile: activeRuntimeZyraProfile
            }
        )
    }, [
        actions,
        controller.activeThread?.latestTurn?.effort,
        controller.activeThread?.latestTurn?.serviceTier,
        controller.activeThread?.model,
        controller.activeThread?.runtimeMode,
        activeRuntimeZyraProfile,
        selectedSessionId
    ])

    const handleCreateThread = useCallback(() => {
        void actions.newThread(controller.selectedSession?.id || undefined)
    }, [actions, controller.selectedSession?.id])

    const handleOpenRenameChat = useCallback(() => {
        const session = controller.selectedSession
        if (!session || headerActionPending) return
        setRenameTarget(session)
        setRenameDraft(getSessionDisplayTitle(session))
    }, [controller.selectedSession, headerActionPending])

    const handleCloseRenameChat = useCallback(() => {
        if (headerActionPending === 'rename') return
        setRenameTarget(null)
        setRenameDraft('')
    }, [headerActionPending])

    const handleSubmitRenameChat = useCallback(async () => {
        if (!renameTarget || headerActionPending) return
        const title = renameDraft.replace(/\s+/g, ' ').trim().slice(0, 60)
        if (!title) return
        if (title === getSessionDisplayTitle(renameTarget)) {
            handleCloseRenameChat()
            return
        }

        setHeaderActionPending('rename')
        try {
            const result = await actions.renameSessionResult(renameTarget.id, title)
            if (!result.success) {
                props.onShowToast?.(`Could not rename chat: ${result.error}`, 'error')
                return
            }
            setRenameTarget(null)
            setRenameDraft('')
            props.onShowToast?.('Chat renamed', 'success')
        } finally {
            setHeaderActionPending(null)
        }
    }, [actions, handleCloseRenameChat, headerActionPending, props.onShowToast, renameDraft, renameTarget])

    const handleChooseHeaderProject = useCallback(async () => {
        const session = controller.selectedSession
        if (!session || projectDirectoryLocked || headerActionPending) return
        setHeaderActionPending('project')
        try {
            const result = await actions.chooseProjectPathResult(session.id)
            if (!result.success) {
                props.onShowToast?.(`Could not update project: ${result.error}`, 'error')
                return
            }
            if ('cancelled' in result && result.cancelled) return
            await projectCatalogState.refresh()
            props.onShowToast?.(session.projectPath ? 'Project changed' : 'Project attached', 'success')
        } finally {
            setHeaderActionPending(null)
        }
    }, [actions, controller.selectedSession, headerActionPending, projectCatalogState, projectDirectoryLocked, props.onShowToast])

    const handleCreateHeaderProjectChat = useCallback(async () => {
        const projectPath = selectedProjectPath.trim()
        if (!projectPath || headerActionPending || controller.commandPending) return
        setHeaderActionPending('project-chat')
        try {
            const result = await actions.createSessionResult({
                mode: 'work',
                projectPath,
                projectId: selectedProjectId || undefined,
                workingRoot: projectPath
            })
            if (!result.success) {
                props.onShowToast?.(`Could not create project chat: ${result.error}`, 'error')
            }
        } finally {
            setHeaderActionPending(null)
        }
    }, [actions, controller.commandPending, headerActionPending, props.onShowToast, selectedProjectId, selectedProjectPath])

    const handleArchiveChat = useCallback(async () => {
        const session = controller.selectedSession
        if (!session || headerActionPending) return
        setHeaderActionPending('archive')
        try {
            const result = await actions.archiveSessionResult(session.id, true)
            if (!result.success) {
                props.onShowToast?.(`Could not archive chat: ${result.error}`, 'error')
                return
            }
            props.onShowToast?.('Chat archived', 'success')
        } finally {
            setHeaderActionPending(null)
        }
    }, [actions, controller.selectedSession, headerActionPending, props.onShowToast])

    const handleOpenDeleteChat = useCallback(() => {
        const session = controller.selectedSession
        if (!session || headerActionPending) return
        setSessionToDelete(session)
    }, [controller.selectedSession, headerActionPending])

    const handleCancelDeleteChat = useCallback(() => {
        if (headerActionPending === 'delete') return
        setSessionToDelete(null)
    }, [headerActionPending])

    const handleConfirmDeleteChat = useCallback(async () => {
        if (!sessionToDelete || headerActionPending) return
        setHeaderActionPending('delete')
        try {
            const result = await actions.deleteSessionResult(sessionToDelete.id)
            if (!result.success) {
                props.onShowToast?.(`Could not delete chat: ${result.error}`, 'error')
                return
            }
            setSessionToDelete(null)
            props.onShowToast?.('Chat deleted', 'success')
        } finally {
            setHeaderActionPending(null)
        }
    }, [actions, headerActionPending, props.onShowToast, sessionToDelete])

    const handleChooseProjectForWorkChat = useCallback(async () => {
        if (controller.commandPending) return
        if (controller.selectedSession?.id) {
            await actions.chooseProjectPath(controller.selectedSession.id)
            await projectCatalogState.refresh()
            return
        }
        await actions.createProjectSession()
        await projectCatalogState.refresh()
    }, [actions, controller.commandPending, controller.selectedSession?.id, projectCatalogState])

    const handleSelectNewChatProject = useCallback(async (
        projectId: string | null,
        workingRoot?: string | null
    ) => {
        const session = controller.selectedSession
        if (!session || !selectedSessionIsDraft || projectDirectoryLocked || controller.commandPending) return
        const result = await actions.setSessionProjectResult(session.id, { projectId, workingRoot })
        if (!result.success) {
            props.onShowToast?.(`Could not update Project: ${result.error}`, 'error')
        }
    }, [actions, controller.commandPending, controller.selectedSession, projectDirectoryLocked, props.onShowToast, selectedSessionIsDraft])

    const handleImportDetectedProject = useCallback(async (candidateId: string) => {
        const session = controller.selectedSession
        const candidate = projectCatalogState.catalog.candidates.find((entry) => entry.id === candidateId)
        if (!session || !candidate || !selectedSessionIsDraft || projectDirectoryLocked || controller.commandPending) return
        const project = await projectCatalogState.importCandidate(candidate)
        if (!project) {
            props.onShowToast?.(projectCatalogState.error || 'Could not create Project.', 'error')
            return
        }
        const workingRoot = project.folders[0]?.path || project.homePath
        const result = await actions.setSessionProjectResult(session.id, { projectId: project.id, workingRoot })
        if (!result.success) props.onShowToast?.(`Could not update Project: ${result.error}`, 'error')
    }, [actions, controller.commandPending, controller.selectedSession, projectCatalogState, projectDirectoryLocked, props.onShowToast, selectedSessionIsDraft])

    const handleChooseNewChatProjectFolder = useCallback(async () => {
        const session = controller.selectedSession
        if (!session || !selectedSessionIsDraft || projectDirectoryLocked || controller.commandPending) return
        const result = await actions.chooseProjectPathResult(session.id)
        if (!result.success && !('cancelled' in result && result.cancelled)) {
            props.onShowToast?.(`Could not update Project: ${result.error}`, 'error')
            return
        }
        if (result.success) await projectCatalogState.refresh()
    }, [actions, controller.commandPending, controller.selectedSession, projectCatalogState, projectDirectoryLocked, props.onShowToast, selectedSessionIsDraft])

    const handleToggleDetailsPanel = useCallback(() => {
        props.onToggleRightSidebar()
    }, [props.onToggleRightSidebar])

    const canonicalVoiceDisabled = !canonicalVoiceBinding
        || activeThreadIsSubagent
        || isThreadWorking
        || controller.commandPending
    const handlePrepareCanonicalVoice = useCallback((executionConfiguration: AssistantVoiceExecutionConfiguration) => {
        if (canonicalVoiceDisabled || (voice.status !== 'idle' && voice.status !== 'error')) return
        voiceExecutionConfigurationRef.current = executionConfiguration
        actions.warmSelectedSessionConnection(executionConfiguration)
    }, [actions, canonicalVoiceDisabled, voice.status])
    const handleStartCanonicalVoice = useCallback((executionConfiguration?: AssistantVoiceExecutionConfiguration) => {
        if (canonicalVoiceDisabled || (voice.status !== 'idle' && voice.status !== 'error')) return
        const selectedConfiguration = executionConfiguration || voiceExecutionConfigurationRef.current
        if (!selectedConfiguration) return
        voiceExecutionConfigurationRef.current = selectedConfiguration
        void voice.start({ ...voicePreferences, executionConfiguration: selectedConfiguration })
    }, [canonicalVoiceDisabled, voice.start, voice.status, voicePreferences])

    const titleBarContent = useMemo(() => !composerIsCentered ? (
        <AssistantConversationHeader
            displayMode={settings.assistantChatDisplayMode}
            rightPanelOpen={props.rightPanelOpen}
            rightPanelMode={props.rightPanelMode}
            showRightSidebarToggle={props.showRightSidebarToggle}
            latestProjectLabel={latestProjectLabel}
            selectedSessionTitle={selectedSessionTitle}
            titleGenerating={controller.selectedSession?.titleGenerating === true}
            canonicalThreadId={controller.activeThread?.providerThreadId || controller.activeThread?.id || null}
            canonicalPresence={settings.assistantShowStatusDetails || settings.assistantShowDiagnostics ? controller.activeThread?.canonicalPresence : null}
            showPresenceBadge={settings.assistantShowStatusDetails}
            showDiagnostics={settings.assistantShowDiagnostics}
            activeThreadIsSubagent={activeThreadIsSubagent}
            activeThreadLabel={activeThreadLabel}
            selectedProjectTooltip={selectedProjectTooltip}
            selectedProjectPath={displayProjectPath || null}
            projectDirectoryLocked={projectDirectoryLocked}
            actionsDisabled={Boolean(headerActionPending) || controller.commandPending}
            onCreateThread={handleCreateThread}
            onRenameChat={handleOpenRenameChat}
            onCreateProjectChat={handleCreateHeaderProjectChat}
            onChooseProject={handleChooseHeaderProject}
            onArchiveChat={handleArchiveChat}
            onDeleteChat={handleOpenDeleteChat}
            onToggleRightSidebar={handleToggleDetailsPanel}
            onShowToast={props.onShowToast}
        />
    ) : null, [
        activeThreadIsSubagent,
        activeThreadLabel,
        composerIsCentered,
        controller.activeThread?.canonicalPresence,
        controller.activeThread?.id,
        controller.activeThread?.providerThreadId,
        controller.commandPending,
        controller.selectedSession?.titleGenerating,
        displayProjectPath,
        handleArchiveChat,
        handleChooseHeaderProject,
        handleCreateHeaderProjectChat,
        handleCreateThread,
        handleOpenDeleteChat,
        handleOpenRenameChat,
        handleToggleDetailsPanel,
        headerActionPending,
        latestProjectLabel,
        projectDirectoryLocked,
        props.onShowToast,
        props.rightPanelMode,
        props.rightPanelOpen,
        props.showRightSidebarToggle,
        selectedProjectTooltip,
        selectedSessionTitle,
        settings.assistantChatDisplayMode,
        settings.assistantShowDiagnostics,
        settings.assistantShowStatusDetails
    ])
    usePublishAssistantTitleBarContent(titleBarContent)

    const effectiveInteractionMode = activeComposerConfiguration.interactionMode

    return (
        <section
            className="assistant-conversation-pane relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
            data-assistant-chat-display={settings.assistantChatDisplayMode}
        >
            <div className={cn(
                'flex min-h-0 flex-1 flex-col transition-[filter,opacity] duration-200',
                showChatOnboardingOverlay && 'pointer-events-none select-none blur-[2px] opacity-55'
            )}>
                <div className={cn(
                    'relative flex min-h-0 flex-1 flex-col transition-[justify-content] duration-300',
                    composerIsCentered && 'justify-center'
                )}>
                    {connectionRecovery.showBanner && connectionRecovery.issue ? (
                        <AssistantConnectionRecoveryBanner
                            issue={connectionRecovery.issue}
                            reconnectPending={connectionRecovery.reconnectPending}
                            reconnectAttempt={connectionRecovery.reconnectAttempt}
                            reconnectMaxAttempts={connectionRecovery.reconnectMaxAttempts}
                            reconnectExhausted={connectionRecovery.reconnectExhausted}
                            onReconnect={handleReconnectAssistant}
                        />
                    ) : null}
                    {!composerIsCentered ? (
                        <AssistantConversationTimelinePane
                            loading={controller.loading}
                            timelineContentRef={timelineContentRef}
                            timelineScrollRef={timelineScrollRef}
                            messages={displayedTimelineMessages}
                            activities={controller.activityFeed}
                            proposedPlans={controller.activeThread?.proposedPlans || []}
                            userInputs={controller.activeThread?.pendingUserInputs || []}
                            userInputResponding={controller.commandPending}
                            onRespondUserInput={handleRespondUserInput}
                            sessionMode={selectedSessionMode}
                            latestProjectLabel={latestProjectLabel}
                            projectTitle={displayProjectPath || null}
                            assistantMessageFilePath={assistantMessageFilePath}
                            windowKey={`${controller.selectedSession?.id || 'no-session'}:${controller.activeThread?.id || 'no-thread'}`}
                            isWorking={timelinePresentationIsWorking}
                            activeStatusLabel={activeStatusLabel}
                            isConnecting={isThreadConnecting && !voiceVisible}
                            activeWorkStartedAt={effectiveLatestTurnStartedAt}
                            latestAssistantMessageId={controller.activeThread?.latestTurn?.assistantMessageId || null}
                            latestTurnStartedAt={effectiveLatestTurnStartedAt}
                            turnUsageById={turnUsageById}
                            deletingMessageId={props.deletingMessageId}
                            focusMessageId={props.focusMessageId}
                            loadingChats={isLoadingSelectedChat}
                            selectionHydrating={controller.selectionHydrating}
                            assistantTextStreamingMode={settings.assistantTextStreamingMode}
                            assistantToolOutputDefaultMode={settings.assistantToolOutputDefaultMode}
                            assistantChatDisplayMode={settings.assistantChatDisplayMode}
                            bottomComposerOverlayActive={bottomComposerOverlayActive}
                            contentInsetEndAdjustment={Math.max(
                                effectiveComposerInsetEnd,
                                voiceVisible ? VOICE_TIMELINE_RESERVE_PX : 0
                            )}
                            scrollButtonBottomOverride={voiceVisible ? VOICE_SCROLL_BUTTON_BOTTOM_PX : undefined}
                            hasOlder={controller.history?.pageInfo.hasOlder || false}
                            hasNewer={controller.history?.pageInfo.hasNewer || false}
                            loadingOlder={controller.history?.loadingOlder || false}
                            loadingNewer={controller.history?.loadingNewer || false}
                            loadOlderError={controller.history?.loadOlderError || null}
                            loadNewerError={controller.history?.loadNewerError || null}
                            onLoadOlder={handleLoadOlderHistory}
                            onLoadNewer={handleLoadNewerHistory}
                            showScrollToBottom={showScrollToBottom}
                            elevateScrollToBottom={bottomComposerOverlayActive}
                            onScrollTimeline={handleTimelineScrollEvent}
                            onScrollToBottom={handleScrollToBottomClick}
                            onRequestDeleteUserMessage={props.onRequestDeleteUserMessage}
                            onImplementProposedPlan={handleImplementProposedPlan}
                            onShowPlanPanel={undefined}
                            onOpenAttachmentPreview={props.onOpenAttachmentPreview}
                            onOpenAssistantLink={props.onOpenAssistantLink}
                            onLinkNotice={props.onShowToast}
                            onOpenEditedFile={props.onOpenEditedFile}
                            onViewDiff={props.onViewDiff}
                        />
                    ) : null}
                    {voiceVisible && !hasPendingControlApproval && effectivePendingApprovals.length === 0 ? (
                        <AssistantCanonicalVoiceStage voice={voice} preferences={voicePreferences} />
                    ) : null}
                    {voiceVisible && !hasPendingControlApproval ? (
                        <AssistantCanonicalVoiceDock
                            voice={voice}
                            preferences={voicePreferences}
                            pendingApprovals={effectivePendingApprovals}
                            approvalResponding={controller.commandPending}
                            onRespondApproval={handleRespondApproval}
                            onRetry={handleStartCanonicalVoice}
                            onStop={() => { void voice.stop() }}
                        />
                    ) : (
                    <AssistantConversationComposerPane
                        paneRef={composerPaneRef}
                        placement={composerIsCentered ? 'center' : 'bottom'}
                        newChatPrompt={emptyComposerPrompt}
                        pendingPlaygroundLabRequest={null}
                        pendingApprovals={effectivePendingApprovals}
                        pendingControlActions={pendingControlActions}
                        pendingControlGrants={pendingControlGrants}
                        controlTargets={controlState?.targets || []}
                        pendingUserInputs={effectivePendingUserInputs}
                        commandPending={!newChatHandoffActive && controller.commandPending}
                        composerDisabled={newChatHandoffActive}
                        sending={sendingComposerPrompt}
                        thinking={!newChatHandoffActive && (controller.commandPending || isThreadWorking)}
                        queuedMessageCount={queuedComposerMessageCount}
                        queuedMessages={queuedComposerMessageItems}
                        onForceQueuedMessage={handleForceQueuedMessage}
                        onDeleteQueuedMessage={handleDeleteQueuedMessage}
                        onMoveQueuedMessage={handleMoveQueuedMessage}
                        selectedSessionId={visibleComposerSessionId}
                        useSettingsDefaults={selectedSessionIsDraft || newChatHandoffActive}
                        resetComposerStateToken={resetComposerStateToken}
                        selectedSessionMode={selectedSessionMode}
                        assistantAvailable={controller.available}
                        assistantConnected={composerConnectionPresentation.connected}
                        selectedProjectId={displayProjectId}
                        selectedProjectPath={displayProjectPath || null}
                        selectedProjectName={displayProjectName}
                        projectRoots={composerProjectRoots}
                        projectChoices={composerIsCentered ? newChatProjectChoices : undefined}
                        detectedProjectChoices={composerIsCentered ? detectedProjectChoices : undefined}
                        projectContextDisabled={newChatHandoffActive || projectDirectoryLocked || controller.commandPending || projectCatalogState.loading}
                        onSelectProject={composerIsCentered ? handleSelectNewChatProject : undefined}
                        onImportDetectedProject={composerIsCentered ? handleImportDetectedProject : undefined}
                        onChooseProjectFolder={composerIsCentered ? handleChooseNewChatProjectFolder : undefined}
                        availableModels={availableModels}
                        activeModel={activeComposerConfiguration.activeModel}
                        activeEffort={activeComposerConfiguration.activeEffort}
                        activeFastModeEnabled={activeComposerConfiguration.activeFastModeEnabled}
                        modelsLoading={controller.modelsLoading}
                        latestTurnUsage={composerContextUsage}
                        runtimeMode={activeComposerConfiguration.runtimeMode}
                        interactionMode={effectiveInteractionMode}
                        activeProfile={activeComposerConfiguration.activeProfile}
                        zyraProfile={activeZyraProfile}
                        onZyraProfileChange={setActiveZyraProfile}
                        activeStatusLabel={activeStatusLabel}
                        isConnecting={composerConnectionPresentation.connecting}
                        reconnectPending={composerConnectionPresentation.reconnectPending}
                        onOverflowWheel={handleComposerOverflowWheel}
                        onStop={handleStopTurn}
                        onReconnect={handleReconnectAssistant}
                        onPrepareRealtimeVoice={handlePrepareCanonicalVoice}
                        onStartRealtimeVoice={handleStartCanonicalVoice}
                        realtimeVoiceDisabled={canonicalVoiceDisabled}
                        onBlockedSend={(message) => props.onShowToast?.(message, 'info')}
                        onOpenAttachmentPreview={props.onOpenAttachmentPreview}
                        onAttachmentShelfBoundsChange={handleAttachmentShelfBoundsChange}
                        onDraftStarted={actions.warmSelectedSessionConnection}
                        sendPrompt={newChatHandoffActive ? async () => false : handleSendPrompt}
                        refreshModels={handleRefreshModels}
                        respondApproval={handleRespondApproval}
                        respondUserInput={handleRespondUserInput}
                        setPlaygroundTerminalAccess={props.onPlaygroundTerminalAccessChange}
                        setPlaygroundTerminalAccessRequestMuted={props.onPlaygroundTerminalAccessRequestMutedChange}
                        approvePendingPlaygroundLabRequest={handleApprovePendingPlaygroundLabRequest}
                        declinePendingPlaygroundLabRequest={handleDeclinePendingPlaygroundLabRequest}
                    />
                    )}
                </div>
            </div>
            {showPlaygroundRootOnboarding ? (
                <AssistantChatOnboardingOverlay
                    mode="playground-root"
                    busy={controller.commandPending}
                    onChoosePlaygroundRoot={props.onChoosePlaygroundRoot}
                />
            ) : null}
            {showWorkProjectOnboarding ? (
                <AssistantChatOnboardingOverlay
                    mode="work-project"
                    busy={controller.commandPending}
                    hasSession={Boolean(controller.selectedSession)}
                    onChooseProject={handleChooseProjectForWorkChat}
                    playgroundRootConfigured={!props.playgroundRootMissing}
                    onChoosePlaygroundRoot={props.onChoosePlaygroundRoot}
                    onStartDetachedPlaygroundChat={props.onStartDetachedPlaygroundChat}
                />
            ) : null}
            {showPlaygroundDetachedOnboarding ? (
                <AssistantChatOnboardingOverlay
                    mode="playground-chat"
                    busy={controller.commandPending}
                    onStartDetachedPlaygroundChat={props.onStartDetachedPlaygroundChat}
                />
            ) : null}
            <RenameSessionModal
                renameTarget={renameTarget}
                renameDraft={renameDraft}
                saving={headerActionPending === 'rename'}
                onChangeDraft={setRenameDraft}
                onClose={handleCloseRenameChat}
                onSubmit={() => void handleSubmitRenameChat()}
            />
            <SessionDeleteModal
                sessionToDelete={sessionToDelete}
                deleting={headerActionPending === 'delete'}
                onConfirm={() => void handleConfirmDeleteChat()}
                onCancel={handleCancelDeleteChat}
            />
            <div className="pointer-events-none absolute inset-x-0 bottom-24 z-30 flex justify-center px-4">
                <div
                    className={cn(
                        'inline-flex items-center gap-2 rounded-full border border-white/10 bg-sparkle-card/95 px-3 py-2 text-[12px] font-medium text-sparkle-text-secondary shadow-[0_16px_40px_rgba(0,0,0,0.28)] backdrop-blur-xl transition-all duration-200',
                        implementationToastVisible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
                    )}
                >
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-300/80" />
                    <span>Moving to implementation. Switching from Plan to Chat.</span>
                </div>
            </div>
        </section>
    )
}
