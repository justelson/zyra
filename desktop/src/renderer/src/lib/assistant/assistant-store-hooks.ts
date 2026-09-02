import { useEffect, useRef, useSyncExternalStore } from 'react'
import type {
    AssistantApprovalResponseInput,
    AssistantApprovePendingPlaygroundLabRequestInput,
    AssistantAttachSessionToPlaygroundLabInput,
    AssistantCreatePlaygroundLabInput,
    AssistantCreateSessionInput,
    AssistantDeclinePendingPlaygroundLabRequestInput,
    AssistantSendPromptOptions,
    AssistantVoiceExecutionConfiguration
} from '@shared/assistant/contracts'
import {
    getActiveAssistantThread,
    getAssistantActivePlan,
    getAssistantActivityFeed,
    getAssistantLatestProposedPlan,
    getAssistantPendingApprovals,
    getAssistantPendingUserInputs,
    getSelectedAssistantSession,
    getAssistantThreadPhase,
    getAssistantThreadPhaseLabel,
    getAssistantTimelineMessages
} from './selectors'
import { assistantStore, type AssistantStoreState } from './assistant-store-core'

import type {
    AssistantConversationSelection,
    AssistantPageSelection,
    AssistantSessionsRailSelection,
    AssistantWorkspaceSelection
} from './assistant-store-selection-types'
import {
    areAssistantConversationSelectionsEqual,
    areAssistantPageSelectionsEqual,
    areAssistantSessionsRailSelectionsEqual,
    areAssistantWorkspaceSelectionsEqual
} from './assistant-store-selection-helpers'
import { shouldHideAssistantRowsForSelection } from './assistant-history-state'
export function useAssistantStoreSelector<T>(
    selector: (state: AssistantStoreState) => T,
    isEqual: (left: T, right: T) => boolean = Object.is
): T {
    const selectedRef = useRef<T | null>(null)

    return useSyncExternalStore(
        assistantStore.subscribe,
        () => {
            const next = selector(assistantStore.getState())
            const previous = selectedRef.current
            if (previous !== null && isEqual(previous, next)) {
                return previous
            }
            selectedRef.current = next
            return next
        },
        () => {
            const next = selector(assistantStore.getState())
            const previous = selectedRef.current
            if (previous !== null && isEqual(previous, next)) {
                return previous
            }
            selectedRef.current = next
            return next
        }
    )
}

export function useAssistantStoreLifecycle() {
    useEffect(() => {
        assistantStore.retain()
        return () => {
            assistantStore.release()
        }
    }, [])
}

const assistantStoreActions = {
    refresh: () => assistantStore.refresh(),
    refreshStatus: () => assistantStore.refreshStatus().then(() => undefined),
    refreshModels: () => assistantStore.refreshModels(true),
    createSession: (input?: AssistantCreateSessionInput) => assistantStore.createSession(input).then(() => undefined),
    createSessionResult: (input?: AssistantCreateSessionInput) => assistantStore.createSession(input),
    selectSession: (sessionId: string, options?: { force?: boolean }) => assistantStore.selectSession(sessionId, options).then(() => undefined),
    selectThread: (input: { sessionId: string; threadId: string }, options?: { force?: boolean }) => assistantStore.selectThread(input, options).then(() => undefined),
    renameSession: (sessionId: string, title: string) => assistantStore.renameSession(sessionId, title).then(() => undefined),
    renameSessionResult: (sessionId: string, title: string) => assistantStore.renameSession(sessionId, title),
    regenerateSessionTitleResult: (sessionId: string) => assistantStore.regenerateSessionTitle(sessionId),
    archiveSession: (sessionId: string, archived = true) => assistantStore.archiveSession(sessionId, archived).then(() => undefined),
    archiveSessionResult: (sessionId: string, archived = true) => assistantStore.archiveSession(sessionId, archived),
    deleteSession: (sessionId: string) => assistantStore.deleteSession(sessionId).then(() => undefined),
    deleteSessionResult: (sessionId: string) => assistantStore.deleteSession(sessionId),
    deleteMessage: (messageId: string, sessionId?: string) => assistantStore.deleteMessage({ messageId, sessionId }).then(() => undefined),
    deleteMessageResult: (messageId: string, sessionId?: string) => assistantStore.deleteMessage({ messageId, sessionId }),
    loadOlderHistory: (threadId?: string, turnLimit?: number) => assistantStore.loadOlderHistory(threadId, turnLimit),
    loadNewerHistory: (threadId?: string, turnLimit?: number) => assistantStore.loadNewerHistory(threadId, turnLimit),
    loadHistoryAroundMessage: (threadId: string, messageId: string) => assistantStore.loadHistoryAroundMessage(threadId, messageId),
    clearLogs: (sessionId?: string) => assistantStore.clearLogs(sessionId ? { sessionId } : undefined).then(() => undefined),
    clearLogsResult: (sessionId?: string) => assistantStore.clearLogs(sessionId ? { sessionId } : undefined),
    clearCommandError: () => assistantStore.clearError(),
    setSessionProjectPath: (sessionId: string, projectPath: string | null) => assistantStore.setSessionProjectPath(sessionId, projectPath).then(() => undefined),
    setSessionProjectPathResult: (sessionId: string, projectPath: string | null) => assistantStore.setSessionProjectPath(sessionId, projectPath),
    setPlaygroundRoot: (rootPath: string | null) => assistantStore.setPlaygroundRoot(rootPath).then(() => undefined),
    createPlaygroundLab: (input: AssistantCreatePlaygroundLabInput) => assistantStore.createPlaygroundLab(input).then(() => undefined),
    createPlaygroundLabResult: (input: AssistantCreatePlaygroundLabInput) => assistantStore.createPlaygroundLab(input),
    deletePlaygroundLab: (labId: string) => assistantStore.deletePlaygroundLab({ labId }).then(() => undefined),
    deletePlaygroundLabResult: (labId: string) => assistantStore.deletePlaygroundLab({ labId }),
    attachSessionToPlaygroundLab: (input: AssistantAttachSessionToPlaygroundLabInput) => assistantStore.attachSessionToPlaygroundLab(input).then(() => undefined),
    approvePendingPlaygroundLabRequest: (input: AssistantApprovePendingPlaygroundLabRequestInput) => assistantStore.approvePendingPlaygroundLabRequest(input).then(() => undefined),
    declinePendingPlaygroundLabRequest: (input: AssistantDeclinePendingPlaygroundLabRequestInput) => assistantStore.declinePendingPlaygroundLabRequest(input).then(() => undefined),
    newThread: (sessionId?: string) => assistantStore.newThread(sessionId).then(() => undefined),
    sendPrompt: (prompt: string, options?: AssistantSendPromptOptions) => assistantStore.sendPrompt(prompt, options).then(() => undefined),
    sendPromptResult: (prompt: string, options?: AssistantSendPromptOptions) => assistantStore.sendPrompt(prompt, options),
    warmSelectedSessionConnection: (voicePreparation?: AssistantVoiceExecutionConfiguration) =>
        assistantStore.warmSelectedSessionConnection(voicePreparation),
    interruptTurn: (turnId?: string, sessionId?: string) => assistantStore.interruptTurn(turnId, sessionId).then(() => undefined),
    connect: (sessionId?: string) => assistantStore.connect(sessionId ? { sessionId } : undefined).then(() => undefined),
    connectResult: (sessionId?: string) => assistantStore.connect(sessionId ? { sessionId } : undefined),
    disconnect: (sessionId?: string) => assistantStore.disconnect(sessionId).then(() => undefined),
    respondApproval: (requestId: string, decision: AssistantApprovalResponseInput['decision']) =>
        assistantStore.respondApproval({ requestId, decision }).then(() => undefined),
    respondUserInput: (requestId: string, answers: Record<string, string | string[]>) =>
        assistantStore.respondUserInput({ requestId, answers }).then(() => undefined),
    chooseProjectPath: (sessionId: string) => assistantStore.chooseProjectPath(sessionId).then(() => undefined),
    chooseProjectPathResult: (sessionId: string) => assistantStore.chooseProjectPath(sessionId),
    createProjectSession: () => assistantStore.createProjectSession().then(() => undefined),
    createProjectSessionResult: () => assistantStore.createProjectSession()
}

export function useAssistantStoreActions() {
    useAssistantStoreLifecycle()
    return assistantStoreActions
}

export function useAssistantSessionsRailStore() {
    useAssistantStoreLifecycle()
    const rail = useAssistantStoreSelector<AssistantSessionsRailSelection>((state) => ({
        snapshot: state.snapshot,
        sessions: state.snapshot.sessions,
        playground: state.snapshot.playground,
        activeSessionId: state.snapshot.selectedSessionId,
        activeThreadId: state.status.activeThreadId,
        connected: state.status.connected,
        commandPending: state.commandPending
    }), areAssistantSessionsRailSelectionsEqual)

    return {
        ...rail,
        ...assistantStoreActions
    }
}

export function useAssistantStore() {
    useAssistantStoreLifecycle()
    const workspace = useAssistantStoreSelector<AssistantWorkspaceSelection>((state) => {
        const selectedSession = getSelectedAssistantSession(state.snapshot)
        const activeThread = getActiveAssistantThread(selectedSession)
        const phase = getAssistantThreadPhase(activeThread)

        return {
            knownModels: state.snapshot.knownModels,
            available: state.status.available,
            connected: state.status.connected,
            loading: state.hydrating,
            bootstrapped: state.hydrated,
            modelsLoading: state.modelsLoading,
            commandPending: state.commandPending,
            commandError: state.error,
            selectedSession,
            activeThread,
            timelineMessages: getAssistantTimelineMessages(activeThread),
            activityFeed: getAssistantActivityFeed(activeThread),
            pendingApprovals: getAssistantPendingApprovals(activeThread),
            pendingUserInputs: getAssistantPendingUserInputs(activeThread),
            activePlan: getAssistantActivePlan(activeThread),
            latestProposedPlan: getAssistantLatestProposedPlan(activeThread),
            phase,
            phaseLabel: getAssistantThreadPhaseLabel(activeThread)
        }
    }, areAssistantWorkspaceSelectionsEqual)

    return {
        ...workspace,
        status: {
            available: workspace.available,
            connected: workspace.connected
        },
        ...assistantStoreActions,
        chooseProjectPath: () => {
            if (!workspace.selectedSession) return Promise.resolve()
            return assistantStoreActions.chooseProjectPath(workspace.selectedSession.id)
        }
    }
}

export function useAssistantPageStore() {
    useAssistantStoreLifecycle()
    return useAssistantStoreSelector<AssistantPageSelection>((state) => {
        const selectedSession = getSelectedAssistantSession(state.snapshot)
        const activeThread = getActiveAssistantThread(selectedSession)
        const phase = getAssistantThreadPhase(activeThread)

        return {
            available: state.status.available,
            connected: state.status.connected,
            loading: state.hydrating,
            bootstrapped: state.hydrated,
            commandPending: state.commandPending,
            commandError: state.error,
            selectedSession,
            activeThread,
            activityFeed: getAssistantActivityFeed(activeThread),
            pendingApprovals: getAssistantPendingApprovals(activeThread),
            pendingUserInputs: getAssistantPendingUserInputs(activeThread),
            activePlan: getAssistantActivePlan(activeThread),
            latestProposedPlan: getAssistantLatestProposedPlan(activeThread),
            phase,
            phaseLabel: getAssistantThreadPhaseLabel(activeThread)
        }
    }, areAssistantPageSelectionsEqual)
}

export function useAssistantConversationStore() {
    useAssistantStoreLifecycle()
    return useAssistantStoreSelector<AssistantConversationSelection>((state) => {
        const selectedSession = getSelectedAssistantSession(state.snapshot)
        const activeThread = getActiveAssistantThread(selectedSession)
        const phase = getAssistantThreadPhase(activeThread)
        const activeSelectionHydrationKey = selectedSession && activeThread
            ? `${selectedSession.id}:${activeThread.id}`
            : null
        const selectionTransitioning = Boolean(
            activeSelectionHydrationKey
            && state.selectionTransitionKey === activeSelectionHydrationKey
        )
        const selectionHydrating = Boolean(
            activeSelectionHydrationKey
            && state.selectionHydrationKey === activeSelectionHydrationKey
        )
        const hideRowsForInitialHydration = shouldHideAssistantRowsForSelection({
            selectionTransitioning,
            selectionHydrating,
            thread: activeThread
        })

        return {
            knownModels: state.snapshot.knownModels,
            sessions: state.snapshot.sessions,
            available: state.status.available,
            connected: state.status.connected,
            loading: state.hydrating,
            modelsLoading: state.modelsLoading,
            commandPending: state.commandPending,
            pendingCreateSessionInput: state.pendingCreateSessionInput,
            commandError: state.error,
            selectionHydrating: selectionTransitioning || selectionHydrating,
            history: activeThread ? state.historyByThreadId[activeThread.id] || null : null,
            selectedSession,
            activeThread,
            timelineMessages: hideRowsForInitialHydration ? [] : getAssistantTimelineMessages(activeThread),
            activityFeed: hideRowsForInitialHydration ? [] : getAssistantActivityFeed(activeThread),
            pendingUserInputs: hideRowsForInitialHydration ? [] : getAssistantPendingUserInputs(activeThread),
            activePlan: hideRowsForInitialHydration ? null : getAssistantActivePlan(activeThread),
            latestProposedPlan: hideRowsForInitialHydration ? null : getAssistantLatestProposedPlan(activeThread),
            phase,
            phaseLabel: getAssistantThreadPhaseLabel(activeThread)
        }
    }, areAssistantConversationSelectionsEqual)
}
