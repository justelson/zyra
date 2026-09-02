import type {
    AssistantApprovalResponseInput,
    AssistantApprovePendingPlaygroundLabRequestInput,
    AssistantAttachSessionToPlaygroundLabInput,
    AssistantClearLogsInput,
    AssistantConnectOptions,
    AssistantCreatePlaygroundLabInput,
    AssistantCreateSessionInput,
    AssistantDeclinePendingPlaygroundLabRequestInput,
    AssistantDeleteMessageInput,
    AssistantDomainEvent,
    AssistantModelInfo,
    AssistantPlaygroundState,
    AssistantSendPromptOptions,
    AssistantSelectThreadInput,
    AssistantSetSessionProjectInput,
    AssistantSession,
    AssistantSnapshot,
    AssistantThread,
    AssistantUserInputResponseInput
} from '@shared/assistant/contracts'
import type { DevScopeResult } from '@shared/contracts/devscope-api'
import { applyAssistantDomainEvents, createDefaultAssistantSnapshot } from '@shared/assistant/projector'
import { isAssistantToolLifecycleStartEvent } from '@shared/assistant/tool-lifecycle'
import { collapseAssistantDeltaEvents, isAssistantStreamingPresentationEvent } from './event-batching'
import { assistantStreamPresentation } from './assistant-stream-presentation'
import { rendererVisibility } from '../renderer-visibility'
import {
    cacheHydratedThreads,
    hasCachedSessionSelection,
    type CachedHydratedThreadState
} from './session-hydration-cache'
import { deriveAssistantRuntimeStatus, INITIAL_ASSISTANT_RUNTIME_STATUS, type AssistantStoreState } from './assistant-store-runtime'
import { shouldAutoReconnectAssistantOnStartup } from './assistant-runtime-preferences'
import { getAssistantThreadHydrationRevision } from './assistant-thread-hydration-revision'
import { runAssistantStoreAction } from './assistant-store-action-runner'
import { selectAssistantStoreSession } from './assistant-store-session-selection'
import { prepareAssistantWarmSelection } from './assistant-warm-selection'
import { preserveAssistantClientRoute } from './assistant-client-route'
import {
    isPristineAssistantSession,
    shouldEagerlyConnectAssistantThread
} from './assistant-new-chat-policy'
import {
    applyAssistantHistoryAnchorPage,
    applyAssistantHistoryPage,
    applyAssistantRetainedHistory,
    applyAssistantThreadDetail,
    dematerializeAssistantHistories,
    formatAssistantHistoryLoadError,
    hasRenderableAssistantRetainedHistory,
    isAssistantRetainedHistoryFresh,
    materializeAssistantShellSnapshot,
    mergeAssistantShellSnapshot,
    pruneAssistantHistoryCache,
    replaceAssistantVisibleHistory,
    shouldRehydrateAssistantHistoryAfterCanonicalEvent,
    synchronizeAssistantVisibleHistory
} from './assistant-history-state'
// Snapshot projection is the authoritative/recovery lane. A message-specific
// presentation store handles the higher-frequency visual stream between these
// bounded checkpoints without rebuilding the whole timeline.
const ASSISTANT_STREAM_CHECKPOINT_DELAY_MS = 120
const SNAPSHOT_REFRESH_RECOVERY_ERRORS = new Set([
    'Assistant session not found.',
    'Assistant session has no active thread.'
])

type AssistantCreateSessionResult = DevScopeResult<{ sessionId: string; snapshot?: AssistantSnapshot }>

function isReusableEmptySession(session: AssistantSession, input?: AssistantCreateSessionInput) {
    if (!isPristineAssistantSession(session)) return false
    if (input?.mode && session.mode !== input.mode) return false
    if (input?.projectPath !== undefined && (session.projectPath || null) !== (input.projectPath || null)) return false
    if (input?.projectId !== undefined && (session.projectId || null) !== (input.projectId || null)) return false
    if (input?.workingRoot !== undefined && (session.workingRoot || session.projectPath || null) !== (input.workingRoot || null)) return false
    if (input?.playgroundLabId !== undefined && (session.playgroundLabId || null) !== (input.playgroundLabId || null)) return false
    if (input?.mode === undefined && session.mode !== 'work') return false
    if (input?.projectPath === undefined && input?.projectId === undefined && session.projectPath) return false
    if (input?.projectId === undefined && input?.projectPath === undefined && session.projectId) return false
    if (input?.playgroundLabId === undefined && session.playgroundLabId) return false
    return true
}

export class AssistantStore {
    private state: AssistantStoreState = {
        snapshot: createDefaultAssistantSnapshot(),
        historyByThreadId: {},
        status: INITIAL_ASSISTANT_RUNTIME_STATUS,
        hydrating: false,
        hydrated: false,
        modelsLoading: false,
        commandPending: false,
        pendingCreateSessionInput: null,
        selectionHydrationKey: null,
        selectionTransitionKey: null,
        selectionRequestId: 0,
        selectionRequestSessionId: null,
        error: null
    }
    private readonly listeners = new Set<() => void>()
    private readonly hydratedThreadCache = new Map<string, CachedHydratedThreadState>()
    private eventUnsubscribe: (() => void) | null = null
    private visibilityUnsubscribe: (() => void) | null = null
    private retainCount = 0
    private hydratePromise: Promise<void> | null = null
    private modelRefreshPromise: Promise<DevScopeResult<{ models: AssistantModelInfo[] }>> | null = null
    private createSessionPromise: Promise<AssistantCreateSessionResult> | null = null
    private browserConnectionClaimPromise: Promise<void> | null = null
    private readonly backgroundConnectionPromises = new Map<string, Promise<void>>()
    private pendingAssistantEvents: AssistantDomainEvent[] = []
    private pendingAssistantEventFlushFrame: number | null = null
    private pendingAssistantEventFlushTimeout: number | null = null
    private readonly pendingSelectionHydrations = new Map<string, Promise<void>>()
    private readonly pendingCanonicalHistoryRehydrations = new Map<string, Promise<void>>()
    private readonly pendingHistoryLoads = new Map<string, Promise<boolean>>()
    private readonly pendingHistoryAnchors = new Map<string, Promise<boolean>>()

    subscribe = (listener: () => void) => {
        this.listeners.add(listener)
        return () => {
            this.listeners.delete(listener)
        }
    }

    getState = () => this.state

    retain() {
        this.retainCount += 1
        if (this.retainCount === 1) {
            void this.hydrate()
            this.ensureEventStream()
            this.ensureVisibilityReconciliation()
        }
    }

    release() {
        this.retainCount = Math.max(0, this.retainCount - 1)
        if (this.retainCount === 0 && this.eventUnsubscribe) {
            this.eventUnsubscribe()
            this.eventUnsubscribe = null
        }
        if (this.retainCount === 0 && this.visibilityUnsubscribe) {
            this.visibilityUnsubscribe()
            this.visibilityUnsubscribe = null
        }
        if (this.retainCount === 0) {
            this.clearPendingAssistantEvents()
        }
    }

    clearError() {
        this.setState({ error: null })
    }

    async hydrate() {
        if (this.hydratePromise) return this.hydratePromise
        this.clearPendingAssistantEvents()
        this.setState({ hydrating: true, error: null })
        this.hydratePromise = (async () => {
            try {
                const bootstrap = await window.devscope.assistant.bootstrap()
                const bootstrapSnapshot = materializeAssistantShellSnapshot(bootstrap.snapshot)
                let clientSnapshot = bootstrapSnapshot
                let clientStatus = bootstrap.status

                this.setState((current) => {
                    clientSnapshot = preserveAssistantClientRoute(
                        current.snapshot,
                        bootstrapSnapshot,
                        current.selectionRequestSessionId
                    )
                    clientStatus = deriveAssistantRuntimeStatus(clientSnapshot, bootstrap.status)
                    return {
                        snapshot: clientSnapshot,
                        status: clientStatus,
                        modelsLoading: false,
                        error: null
                    }
                })

                const selectedSessionId = clientSnapshot.selectedSessionId
                const selectedSession = clientSnapshot.sessions.find((session) => session.id === selectedSessionId) || null
                const activeThreadId = selectedSession?.activeThreadId || null
                const selectedThread = selectedSession?.threads.find((thread) => thread.id === activeThreadId) || null
                const shouldRestoreConnection = Boolean(
                    selectedSessionId
                    && activeThreadId
                    && shouldEagerlyConnectAssistantThread(selectedThread)
                    && clientStatus.available
                    && !clientStatus.connected
                    && shouldAutoReconnectAssistantOnStartup()
                )

                this.setState({
                    status: clientStatus,
                    hydrating: false,
                    hydrated: true,
                    modelsLoading: false,
                    error: null
                })

                if (selectedSessionId && activeThreadId) {
                    void this.requestSessionHydration(selectedSessionId, activeThreadId)
                    if (shouldRestoreConnection) {
                        this.warmSessionConnection(selectedSessionId, activeThreadId, true)
                    }
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to load assistant.'
                this.setState({
                    hydrating: false,
                    hydrated: true,
                    modelsLoading: false,
                    error: message
                })
            } finally {
                this.hydratePromise = null
            }
        })()
        return this.hydratePromise
    }

    async refreshModels(forceRefresh = true) {
        if (this.modelRefreshPromise) return this.modelRefreshPromise
        this.setState({ modelsLoading: true, error: null })
        this.modelRefreshPromise = (async () => {
            try {
                const result = await window.devscope.assistant.listModels(forceRefresh)
                if (!result.success) {
                    this.setState({ modelsLoading: false, error: result.error })
                    return result
                }
                this.setState((current) => ({
                    modelsLoading: false,
                    snapshot: {
                        ...current.snapshot,
                        knownModels: result.models
                    }
                }))
                return result
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to refresh models.'
                this.setState({ modelsLoading: false, error: message })
                return { success: false as const, error: message }
            } finally {
                this.modelRefreshPromise = null
            }
        })()
        return this.modelRefreshPromise
    }

    async refresh() {
        await this.hydrate()
    }

    async refreshStatus() {
        try {
            const status = await window.devscope.assistant.getStatus()
            this.setState({ status, error: null })
            return { success: true as const, status }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to refresh assistant status.'
            this.setState({ error: message })
            return { success: false as const, error: message }
        }
    }

    private warmSessionConnection(
        sessionId: string,
        threadId: string,
        restoreThreadSelection = false,
        reportError = true,
        voicePreparation?: AssistantConnectOptions['voicePreparation']
    ): void {
        const connectionSession = this.state.snapshot.sessions.find((session) => session.id === sessionId) || null
        const connectionThread = connectionSession?.threads.find((thread) => thread.id === threadId) || null
        const connectionContextKey = JSON.stringify([
            connectionSession?.projectPath || null,
            connectionThread?.cwd || null
        ])
        const voicePreparationKey = voicePreparation
            ? JSON.stringify([
                voicePreparation.model,
                voicePreparation.effort,
                voicePreparation.runtimeMode,
                voicePreparation.interactionMode,
                voicePreparation.profile
            ])
            : 'canonical-only'
        const key = `${sessionId}:${threadId}:${connectionContextKey}:${voicePreparationKey}`
        if (this.backgroundConnectionPromises.has(key)) return
        const pending = (async () => {
            try {
                if (restoreThreadSelection) {
                    const selection = await window.devscope.assistant.selectThread({ sessionId, threadId })
                    if (!selection.success) throw new Error(selection.error)
                }
                const result = await window.devscope.assistant.connect({
                    sessionId,
                    ...(voicePreparation ? { voicePreparation } : {})
                })
                if (!result.success) throw new Error(result.error)
                this.flushPendingAssistantEvents()
                const status = await window.devscope.assistant.getStatus()
                const selected = this.state.snapshot.sessions.find(
                    (session) => session.id === this.state.snapshot.selectedSessionId
                ) || null
                if (selected?.id === sessionId && selected.activeThreadId === threadId) {
                    this.setState({ status, error: null })
                }
            } catch (error) {
                const selected = this.state.snapshot.sessions.find(
                    (session) => session.id === this.state.snapshot.selectedSessionId
                ) || null
                if (reportError && selected?.id === sessionId && selected.activeThreadId === threadId) {
                    this.setState({
                        error: error instanceof Error ? error.message : 'Failed to connect the assistant session.'
                    })
                }
            }
        })().finally(() => {
            this.backgroundConnectionPromises.delete(key)
        })
        this.backgroundConnectionPromises.set(key, pending)
    }

    warmSelectedSessionConnection(voicePreparation?: AssistantConnectOptions['voicePreparation']): void {
        if (!this.state.status.available) return
        const selected = this.state.snapshot.sessions.find(
            (session) => session.id === this.state.snapshot.selectedSessionId
        ) || null
        if (!selected?.activeThreadId) return
        this.warmSessionConnection(selected.id, selected.activeThreadId, false, false, voicePreparation)
    }

    async createSession(input?: AssistantCreateSessionInput): Promise<AssistantCreateSessionResult> {
        if (this.createSessionPromise) return this.createSessionPromise

        const createSessionPromise = this.createSessionImpl(input)
        this.createSessionPromise = createSessionPromise
        try {
            return await createSessionPromise
        } finally {
            this.createSessionPromise = null
        }
    }

    private async createSessionImpl(input?: AssistantCreateSessionInput): Promise<AssistantCreateSessionResult> {
        const selectedSession = this.state.snapshot.sessions.find(
            (session) => session.id === this.state.snapshot.selectedSessionId
        ) || null
        const reusableEmptySession = selectedSession && isReusableEmptySession(selectedSession, input)
            ? selectedSession
            : null
        if (reusableEmptySession) {
            this.setState((current) => ({
                error: null,
                commandPending: true,
                pendingCreateSessionInput: input ? { ...input } : {},
                snapshot: current.snapshot,
                status: deriveAssistantRuntimeStatus(current.snapshot, current.status)
            }))
            try {
                const selectionResult = await this.selectSession(reusableEmptySession.id)
                if (!selectionResult.success) return selectionResult
                return { success: true as const, sessionId: reusableEmptySession.id, snapshot: this.state.snapshot }
            } finally {
                this.setState({ commandPending: false, pendingCreateSessionInput: null })
            }
        }

        const previousSnapshot = this.state.snapshot
        this.setState((current) => {
            return {
                error: null,
                commandPending: true,
                pendingCreateSessionInput: input ? { ...input } : {},
                snapshot: current.snapshot,
                status: deriveAssistantRuntimeStatus(current.snapshot, current.status)
            }
        })
        try {
            const result = await window.devscope.assistant.createSession(input)
            if (!result.success) {
                this.setState((current) => ({
                    error: result.error,
                    snapshot: previousSnapshot,
                    status: deriveAssistantRuntimeStatus(previousSnapshot, current.status)
                }))
                return result
            }
            const sessionExists = this.state.snapshot.sessions.some((session) => session.id === result.sessionId)
            if (!sessionExists) {
                const hydrateResult = await this.refreshSessionShellSnapshot(result.sessionId, false)
                if (!hydrateResult.success) {
                    this.setState((current) => ({
                        error: hydrateResult.error,
                        snapshot: previousSnapshot,
                        status: deriveAssistantRuntimeStatus(previousSnapshot, current.status)
                    }))
                    return hydrateResult
                }
                return result
            }
            const selectionResult = await this.selectSession(result.sessionId, { force: true })
            if (!selectionResult.success) {
                this.setState((current) => ({
                    error: selectionResult.error,
                    snapshot: previousSnapshot,
                    status: deriveAssistantRuntimeStatus(previousSnapshot, current.status)
                }))
                return selectionResult
            }
            return result
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Assistant command failed.'
            this.setState((current) => ({
                error: message,
                snapshot: previousSnapshot,
                status: deriveAssistantRuntimeStatus(previousSnapshot, current.status)
            }))
            return { success: false as const, error: message }
        } finally {
            this.setState({ commandPending: false, pendingCreateSessionInput: null })
        }
    }

    async selectSession(sessionId: string, options?: { force?: boolean }) {
        return selectAssistantStoreSession({
            state: this.state,
            hydratedThreadCache: this.hydratedThreadCache,
            setState: this.setState,
            getState: this.getState,
            requestSessionHydration: (targetSessionId, targetThreadId, hydrationOptions) => this.requestSessionHydration(
                targetSessionId,
                targetThreadId,
                0,
                hydrationOptions?.force === true,
                hydrationOptions?.resetLoadedRange === true
            )
        }, sessionId, options)
    }

    async renameSession(sessionId: string, title: string) {
        return this.runAction(() => window.devscope.assistant.renameSession(sessionId, title), false)
    }

    async regenerateSessionTitle(sessionId: string) {
        return this.runAction(() => window.devscope.assistant.regenerateSessionTitle(sessionId), false)
    }

    async archiveSession(sessionId: string, archived = true) {
        return this.runAction(() => window.devscope.assistant.archiveSession(sessionId, archived), false)
    }

    async deleteSession(sessionId: string) {
        return this.runAction(() => window.devscope.assistant.deleteSession(sessionId), true)
    }

    async deleteMessage(input: AssistantDeleteMessageInput) {
        return this.runAction(() => window.devscope.assistant.deleteMessage(input), true)
    }

    async loadOlderHistory(threadId?: string, turnLimit = 1): Promise<boolean> {
        return this.loadHistoryPage('older', threadId, turnLimit)
    }

    async loadNewerHistory(threadId?: string, turnLimit = 1): Promise<boolean> {
        return this.loadHistoryPage('newer', threadId, turnLimit)
    }

    async loadHistoryAroundMessage(threadId: string, messageId: string): Promise<boolean> {
        const normalizedThreadId = String(threadId || '').trim()
        const normalizedMessageId = String(messageId || '').trim()
        if (!normalizedThreadId || !normalizedMessageId) return false
        const requestKey = `${normalizedThreadId}:${normalizedMessageId}`
        const existing = this.pendingHistoryAnchors.get(requestKey)
        if (existing) return existing
        const promise = (async () => {
            const targetSessionId = this.state.snapshot.sessions
                .find((session) => session.threads.some((thread) => thread.id === normalizedThreadId))?.id || null
            if (!targetSessionId) return false
            try {
                const applyAnchor = async () => {
                    // Route selection may still have a cached or in-flight detail hydration. Force
                    // that authoritative bootstrap to settle before applying the centered page.
                    await this.requestSessionHydration(targetSessionId, normalizedThreadId, 0, true)
                    const currentHistory = this.state.historyByThreadId[normalizedThreadId]
                    if (!currentHistory) return false
                    const result = await window.devscope.assistant.getHistoryAroundMessage({
                        threadId: normalizedThreadId,
                        messageId: normalizedMessageId,
                        turnLimit: 4
                    })
                    if (!result.success) throw new Error(result.error)
                    let applied = false
                    this.setState((current) => {
                        const latest = current.historyByThreadId[normalizedThreadId]
                        if (!latest) return {}
                        const next = applyAssistantHistoryAnchorPage(current.snapshot, latest, result.page)
                        applied = next.history.messages.some((message) => message.id === normalizedMessageId)
                        return {
                            snapshot: next.snapshot,
                            historyByThreadId: {
                                ...current.historyByThreadId,
                                [normalizedThreadId]: next.history
                            }
                        }
                    })
                    return applied
                }
                if (!await applyAnchor()) return false
                // A route-triggered connection can begin one final detail hydration immediately
                // after selection. Verify that it did not replace the anchor, and repair once if it did.
                await new Promise((resolve) => window.setTimeout(resolve, 180))
                const stillAnchored = this.state.historyByThreadId[normalizedThreadId]
                    ?.messages.some((message) => message.id === normalizedMessageId) || false
                return stillAnchored || await applyAnchor()
            } catch (error) {
                const message = formatAssistantHistoryLoadError(error)
                this.setState((current) => {
                    const latest = current.historyByThreadId[normalizedThreadId]
                    if (!latest) return {}
                    return {
                        historyByThreadId: {
                            ...current.historyByThreadId,
                            [normalizedThreadId]: {
                                ...latest,
                                loadOlderError: message,
                                lastUsedAt: Date.now()
                            }
                        }
                    }
                })
                return false
            }
        })().finally(() => {
            this.pendingHistoryAnchors.delete(requestKey)
        })
        this.pendingHistoryAnchors.set(requestKey, promise)
        return promise
    }

    private async loadHistoryPage(direction: 'older' | 'newer', threadId?: string, turnLimit = 1): Promise<boolean> {
        const selectedThreadId = this.state.snapshot.sessions
            .find((session) => session.id === this.state.snapshot.selectedSessionId)?.activeThreadId || null
        const targetThreadId = threadId || selectedThreadId
        if (!targetThreadId) return false
        const targetSessionId = this.state.snapshot.sessions
            .find((session) => session.threads.some((thread) => thread.id === targetThreadId))?.id || null
        const targetHydrationKey = targetSessionId ? this.buildSelectionHydrationKey(targetSessionId, targetThreadId) : null
        if (
            targetHydrationKey
            && (
                this.state.selectionTransitionKey === targetHydrationKey
                || this.state.selectionHydrationKey === targetHydrationKey
            )
        ) return false
        const existingPromise = this.pendingHistoryLoads.get(targetThreadId)
        if (existingPromise) return existingPromise
        const currentHistory = this.state.historyByThreadId[targetThreadId]
        if (!currentHistory) {
            if (targetSessionId) await this.requestSessionHydration(targetSessionId, targetThreadId)
            return false
        }
        const requestedCursor = direction === 'older'
            ? currentHistory.pageInfo.oldestCursor
            : currentHistory.pageInfo.newestCursor
        const canLoad = direction === 'older'
            ? currentHistory.pageInfo.hasOlder
            : currentHistory.pageInfo.hasNewer
        if (!canLoad || !requestedCursor) return false

        const requestedRevision = currentHistory.shellRevision
        const requestedTurnLimit = Math.max(1, Math.min(3, Math.floor(turnLimit || 1)))
        this.setState((current) => ({
            historyByThreadId: {
                ...current.historyByThreadId,
                [targetThreadId]: {
                    ...currentHistory,
                    ...(direction === 'older'
                        ? { loadingOlder: true, loadOlderError: null }
                        : { loadingNewer: true, loadNewerError: null }),
                    lastUsedAt: Date.now()
                }
            }
        }))
        const promise = (async () => {
            let revisionChanged = false
            try {
                const result = await window.devscope.assistant.getHistoryPage({
                    threadId: targetThreadId,
                    ...(direction === 'older' ? { before: requestedCursor } : { after: requestedCursor }),
                    turnLimit: requestedTurnLimit
                })
                if (!result.success) throw new Error(result.error)
                this.setState((current) => {
                    const latest = current.historyByThreadId[targetThreadId]
                    const latestCursor = direction === 'older'
                        ? latest?.pageInfo.oldestCursor
                        : latest?.pageInfo.newestCursor
                    if (!latest || latestCursor !== requestedCursor) return {}
                    const latestThread = current.snapshot.sessions
                        .flatMap((session) => session.threads)
                        .find((thread) => thread.id === targetThreadId) || null
                    if (
                        latest.shellRevision !== requestedRevision
                        || (latestThread && getAssistantThreadHydrationRevision(latestThread) !== requestedRevision)
                    ) {
                        revisionChanged = true
                        return {
                            historyByThreadId: {
                                ...current.historyByThreadId,
                                [targetThreadId]: {
                                    ...latest,
                                    ...(direction === 'older'
                                        ? { loadingOlder: false, loadOlderError: null }
                                        : { loadingNewer: false, loadNewerError: null }),
                                    lastUsedAt: Date.now()
                                }
                            }
                        }
                    }
                    const applied = applyAssistantHistoryPage(current.snapshot, latest, result.page, direction)
                    return {
                        snapshot: applied.snapshot,
                        historyByThreadId: { ...current.historyByThreadId, [targetThreadId]: applied.history }
                    }
                })
            } catch (error) {
                const message = formatAssistantHistoryLoadError(error)
                this.setState((current) => {
                    const latest = current.historyByThreadId[targetThreadId]
                    if (!latest) return {}
                    return {
                        historyByThreadId: {
                            ...current.historyByThreadId,
                            [targetThreadId]: {
                                ...latest,
                                ...(direction === 'older'
                                    ? { loadingOlder: false, loadOlderError: message }
                                    : { loadingNewer: false, loadNewerError: message }),
                                lastUsedAt: Date.now()
                            }
                        }
                    }
                })
            } finally {
                this.pendingHistoryLoads.delete(targetThreadId)
            }
            if (revisionChanged) {
                const latestSelectedThreadId = this.state.snapshot.sessions
                    .find((session) => session.id === this.state.snapshot.selectedSessionId)?.activeThreadId || null
                if (
                    targetSessionId
                    && latestSelectedThreadId === targetThreadId
                    && this.state.selectionTransitionKey !== targetHydrationKey
                    && this.state.selectionHydrationKey !== targetHydrationKey
                ) await this.requestSessionHydration(targetSessionId, targetThreadId)
            }
            return true
        })()
        this.pendingHistoryLoads.set(targetThreadId, promise)
        return promise
    }

    async clearLogs(input?: AssistantClearLogsInput) {
        return this.runAction(() => window.devscope.assistant.clearLogs(input), false)
    }

    async setSessionProject(sessionId: string, input: AssistantSetSessionProjectInput) {
        const result = await this.runAction(
            () => window.devscope.assistant.setSessionProject(sessionId, input),
            false
        )
        if (result.success) this.flushPendingAssistantEvents()
        return result
    }

    async setSessionProjectPath(sessionId: string, projectPath: string | null) {
        const result = await this.runAction(
            () => window.devscope.assistant.setSessionProjectPath(sessionId, projectPath),
            false
        )
        if (result.success) this.flushPendingAssistantEvents()
        return result
    }

    async setPlaygroundRoot(rootPath: string | null) {
        return this.runPlaygroundAction(() => window.devscope.assistant.setPlaygroundRoot({ rootPath }), true)
    }

    async createPlaygroundLab(input: AssistantCreatePlaygroundLabInput) {
        return this.runPlaygroundAction(() => window.devscope.assistant.createPlaygroundLab(input), true)
    }

    async selectThread(input: AssistantSelectThreadInput, options?: { force?: boolean }) {
        const force = options?.force === true
        const selectedSession = this.state.snapshot.sessions.find((session) => session.id === input.sessionId) || null
        const targetThread = selectedSession?.threads.find((thread) => thread.id === input.threadId) || null
        if (!selectedSession || !targetThread) {
            return { success: false as const, error: 'Assistant thread not found.' }
        }
        if (!force && this.state.snapshot.selectedSessionId === input.sessionId && selectedSession.activeThreadId === input.threadId) {
            return { success: true as const, snapshot: this.state.snapshot }
        }
        const previousSessionId = this.state.snapshot.selectedSessionId
        const previousSession = this.state.snapshot.sessions.find((session) => session.id === previousSessionId) || null
        const previousThreadId = previousSession?.activeThreadId || null
        const transitionKey = `${input.sessionId}:${input.threadId}`
        let selectionRequestId = 0
        this.setState((current) => {
            selectionRequestId = current.selectionRequestId + 1
            const warmSelection = prepareAssistantWarmSelection({
                snapshot: current.snapshot,
                sessionId: input.sessionId,
                threadId: input.threadId,
                hydratedThreadCache: this.hydratedThreadCache,
                historyByThreadId: current.historyByThreadId
            })
            const snapshot = warmSelection.snapshot
            return {
                error: null,
                commandPending: true,
                selectionRequestId,
                selectionRequestSessionId: input.sessionId,
                selectionTransitionKey: transitionKey,
                snapshot,
                historyByThreadId: warmSelection.historyByThreadId,
                status: deriveAssistantRuntimeStatus(snapshot, current.status)
            }
        })

        await Promise.resolve()
        if (this.state.selectionRequestId !== selectionRequestId) {
            return { success: true as const, snapshot: this.state.snapshot }
        }

        const authoritativeSelection = window.devscope.assistant.selectThread(input)

        const restorePreviousSelection = (message: string) => {
            this.setState((current) => {
                if (current.selectionRequestId !== selectionRequestId) return {}
                const warmSelection = previousSessionId
                    ? prepareAssistantWarmSelection({
                        snapshot: current.snapshot,
                        sessionId: previousSessionId,
                        threadId: previousThreadId,
                        hydratedThreadCache: this.hydratedThreadCache,
                        historyByThreadId: current.historyByThreadId
                    })
                    : { snapshot: current.snapshot, historyByThreadId: current.historyByThreadId }
                const snapshot = warmSelection.snapshot
                return {
                    error: message,
                    commandPending: false,
                    selectionTransitionKey: null,
                    selectionRequestSessionId: null,
                    snapshot,
                    historyByThreadId: warmSelection.historyByThreadId,
                    status: deriveAssistantRuntimeStatus(snapshot, current.status)
                }
            })
            if (previousSessionId && previousThreadId) {
                void this.requestSessionHydration(previousSessionId, previousThreadId)
            }
        }

        try {
            const result = await authoritativeSelection
            if (this.state.selectionRequestId !== selectionRequestId) return result
            if (!result.success) {
                restorePreviousSelection(result.error)
                return result
            }
            const shellSnapshot = result.snapshot
            if (shellSnapshot) {
                this.setState((current) => {
                    if (current.selectionRequestId !== selectionRequestId) return {}
                    const warmSelection = prepareAssistantWarmSelection({
                        snapshot: mergeAssistantShellSnapshot(current.snapshot, shellSnapshot),
                        sessionId: input.sessionId,
                        threadId: input.threadId,
                        hydratedThreadCache: this.hydratedThreadCache,
                        historyByThreadId: current.historyByThreadId
                    })
                    const snapshot = warmSelection.snapshot
                    return {
                        snapshot,
                        historyByThreadId: warmSelection.historyByThreadId,
                        status: result.status || deriveAssistantRuntimeStatus(snapshot, current.status)
                    }
                })
            }
            if (this.state.selectionRequestId === selectionRequestId) {
                const cacheMatchesLatestShell = hasCachedSessionSelection(
                    this.state.snapshot,
                    input.sessionId,
                    input.threadId,
                    this.hydratedThreadCache
                )
                await this.requestSessionHydration(
                    input.sessionId,
                    input.threadId,
                    0,
                    !cacheMatchesLatestShell,
                    !cacheMatchesLatestShell
                )
            }
            return result
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Assistant command failed.'
            restorePreviousSelection(message)
            return { success: false as const, error: message }
        } finally {
            this.setState((current) => current.selectionRequestId === selectionRequestId ? {
                commandPending: false,
                selectionTransitionKey: null,
                selectionRequestSessionId: null
            } : {})
        }
    }

    async deletePlaygroundLab(input: { labId: string }) {
        return this.runPlaygroundAction(() => window.devscope.assistant.deletePlaygroundLab(input), true)
    }

    async attachSessionToPlaygroundLab(input: AssistantAttachSessionToPlaygroundLabInput) {
        return this.runPlaygroundAction(() => window.devscope.assistant.attachSessionToPlaygroundLab(input), true)
    }

    async approvePendingPlaygroundLabRequest(input: AssistantApprovePendingPlaygroundLabRequestInput) {
        return this.runPlaygroundAction(() => window.devscope.assistant.approvePendingPlaygroundLabRequest(input), true)
    }

    async declinePendingPlaygroundLabRequest(input: AssistantDeclinePendingPlaygroundLabRequestInput) {
        return this.runAction(() => window.devscope.assistant.declinePendingPlaygroundLabRequest(input), true)
    }

    async newThread(sessionId?: string) {
        const targetSessionId = sessionId || this.state.snapshot.selectedSessionId
        const previousSnapshot = this.state.snapshot
        this.setState((current) => {
            if (!targetSessionId) {
                return {
                    error: null,
                    commandPending: true
                }
            }

            const snapshot = {
                ...current.snapshot,
                selectedSessionId: targetSessionId
            }

            return {
                error: null,
                commandPending: true,
                snapshot,
                status: deriveAssistantRuntimeStatus(snapshot, current.status)
            }
        })
        try {
            const result = await window.devscope.assistant.newThread(sessionId)
            if (!result.success) {
                this.setState((current) => ({
                    error: result.error,
                    snapshot: previousSnapshot,
                    status: deriveAssistantRuntimeStatus(previousSnapshot, current.status)
                }))
                return result
            }
            const activeSessionId = targetSessionId
            const threadExists = activeSessionId
                ? Boolean(this.state.snapshot.sessions.find((session) => session.id === activeSessionId)?.threads.some((thread) => thread.id === result.threadId))
                : false
            if (activeSessionId && !threadExists) {
                const hydrateResult = await this.refreshSessionShellSnapshot(activeSessionId)
                if (!hydrateResult.success) {
                    this.setState((current) => ({
                        error: hydrateResult.error,
                        snapshot: previousSnapshot,
                        status: deriveAssistantRuntimeStatus(previousSnapshot, current.status)
                    }))
                    return hydrateResult
                }
            }
            return result
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Assistant command failed.'
            this.setState((current) => ({
                error: message,
                snapshot: previousSnapshot,
                status: deriveAssistantRuntimeStatus(previousSnapshot, current.status)
            }))
            return { success: false as const, error: message }
        } finally {
            this.setState({ commandPending: false })
        }
    }

    async connect(options?: AssistantConnectOptions) {
        const result = await this.runAction(() => window.devscope.assistant.connect(options), true)
        if (!result.success && SNAPSHOT_REFRESH_RECOVERY_ERRORS.has(result.error)) {
            await this.hydrate()
        }
        return result
    }

    async disconnect(sessionId?: string) {
        return this.runAction(() => window.devscope.assistant.disconnect(sessionId), true)
    }

    async sendPrompt(prompt: string, options?: AssistantSendPromptOptions) {
        const selectedSession = this.state.snapshot.sessions
            .find((session) => session.id === this.state.snapshot.selectedSessionId) || null
        const threadId = selectedSession?.activeThreadId || null
        if (selectedSession && threadId && this.state.historyByThreadId[threadId]?.pageInfo.hasNewer) {
            await this.requestSessionHydration(selectedSession.id, threadId, 0, true, true)
        }
        return this.runAction(() => window.devscope.assistant.sendPrompt(prompt, options), true)
    }

    async interruptTurn(turnId?: string, sessionId?: string) {
        return this.runAction(() => window.devscope.assistant.interruptTurn(turnId, sessionId), true)
    }

    async respondApproval(input: AssistantApprovalResponseInput) {
        return this.runAction(() => window.devscope.assistant.respondApproval(input), true)
    }

    async respondUserInput(input: AssistantUserInputResponseInput) {
        return this.runAction(() => window.devscope.assistant.respondUserInput(input), true)
    }

    async chooseProjectPath(sessionId: string) {
        const folderResult = await window.devscope.selectFolder()
        if (folderResult.success && folderResult.folderPath && !folderResult.cancelled) {
            return this.runAction(
                () => window.devscope.assistant.setSessionProjectPath(sessionId, folderResult.folderPath || null),
                false
            )
        }
        return folderResult
    }

    async createProjectSession() {
        const folderResult = await window.devscope.selectFolder()
        if (!folderResult.success || folderResult.cancelled || !folderResult.folderPath) {
            return folderResult
        }
        const sessionResult = await this.createSession({ mode: 'work' })
        if (!sessionResult.success) {
            return sessionResult
        }
        return this.runAction(
            () => window.devscope.assistant.setSessionProjectPath(sessionResult.sessionId, folderResult.folderPath || null),
            false
        )
    }

    private ensureVisibilityReconciliation() {
        if (this.visibilityUnsubscribe) return
        this.visibilityUnsubscribe = rendererVisibility.subscribe(() => {
            if (!rendererVisibility.getSnapshot().visible) return
            this.flushPendingAssistantEvents()
        })
    }

    private ensureEventStream() {
        if (this.eventUnsubscribe) return
        this.eventUnsubscribe = window.devscope.assistant.onEvent((payload) => {
            const events = Array.isArray(payload.events)
                ? payload.events
                : payload.event
                    ? [payload.event]
                    : []
            if (events.length === 0) {
                void this.claimBrowserRoutedConnection()
                return
            }

            for (const event of events) {
                const currentSequence = this.getExpectedSnapshotSequence()
                if (event.sequence <= currentSequence) continue
                if (event.sequence !== currentSequence + 1) {
                    this.clearPendingAssistantEvents()
                    void this.hydrate()
                    return
                }
                assistantStreamPresentation.ingestEvent(event, this.getProjectedAssistantMessageText(event))
                this.queueAssistantEvent(event)
            }
        })
    }

    private async claimBrowserRoutedConnection(): Promise<void> {
        if (this.browserConnectionClaimPromise) return this.browserConnectionClaimPromise
        const sessionId = this.state.snapshot.selectedSessionId
        const session = this.state.snapshot.sessions.find((entry) => entry.id === sessionId) || null
        const threadId = session?.activeThreadId || null
        const thread = session?.threads.find((candidate) => candidate.id === threadId) || null
        if (!sessionId || !threadId || !shouldEagerlyConnectAssistantThread(thread)) return

        const claim = (async () => {
            try {
                let status = await window.devscope.assistant.getStatus()
                if (
                    status.selectedSessionId !== sessionId
                    || status.activeThreadId !== threadId
                ) {
                    const selection = await window.devscope.assistant.selectThread({ sessionId, threadId })
                    if (!selection.success) return
                    status = await window.devscope.assistant.getStatus()
                }
                if (!status.connected) {
                    const connection = await window.devscope.assistant.connect({ sessionId })
                    if (!connection.success) return
                    status = await window.devscope.assistant.getStatus()
                }
                const currentSession = this.state.snapshot.sessions.find((entry) => entry.id === this.state.snapshot.selectedSessionId) || null
                if (
                    this.state.snapshot.selectedSessionId === sessionId
                    && currentSession?.activeThreadId === threadId
                ) {
                    this.setState({ status, error: null })
                }
            } catch {
                // Normal connection recovery remains available in the composer.
            }
        })()
        this.browserConnectionClaimPromise = claim
        try {
            await claim
        } finally {
            if (this.browserConnectionClaimPromise === claim) this.browserConnectionClaimPromise = null
        }
    }

    private getExpectedSnapshotSequence() {
        const pendingSequence = this.pendingAssistantEvents.length > 0
            ? this.pendingAssistantEvents[this.pendingAssistantEvents.length - 1].sequence
            : 0
        return Math.max(this.state.snapshot.snapshotSequence, pendingSequence)
    }

    private getProjectedAssistantMessageText(event: AssistantDomainEvent): string {
        if (event.type !== 'thread.message.assistant.delta') return ''
        const threadId = String(event.threadId || event.payload['threadId'] || '')
        const messageId = String(event.payload['messageId'] || '')
        if (!threadId || !messageId) return ''
        const thread = this.state.snapshot.sessions
            .flatMap((session) => session.threads)
            .find((candidate) => candidate.id === threadId)
        return thread?.messages.find((message) => message.id === messageId)?.text || ''
    }

    private isStreamRecordProjected(event: AssistantDomainEvent): boolean {
        const threadId = String(event.threadId || event.payload['threadId'] || '')
        const thread = this.state.snapshot.sessions
            .flatMap((session) => session.threads)
            .find((candidate) => candidate.id === threadId)
        if (!thread) return false
        if (event.type === 'thread.message.assistant.delta') {
            const messageId = String(event.payload['messageId'] || '')
            return Boolean(messageId && thread.messages.some((message) => message.id === messageId))
        }
        if (event.type === 'thread.activity.appended') {
            const activity = event.payload['activity']
            const activityId = activity && typeof activity === 'object'
                ? String((activity as Record<string, unknown>)['id'] || '')
                : ''
            return Boolean(activityId && thread.activities.some((entry) => entry.id === activityId))
        }
        return true
    }

    private queueAssistantEvent(event: AssistantDomainEvent) {
        const streamRecordProjected = this.isStreamRecordProjected(event)
        this.pendingAssistantEvents.push(event)
        if (isAssistantToolLifecycleStartEvent(event)) {
            this.flushPendingAssistantEvents()
            return
        }
        if (isAssistantStreamingPresentationEvent(event)) {
            if (!streamRecordProjected) {
                if (this.pendingAssistantEventFlushTimeout !== null) {
                    window.clearTimeout(this.pendingAssistantEventFlushTimeout)
                    this.pendingAssistantEventFlushTimeout = null
                }
                if (this.pendingAssistantEventFlushFrame !== null) return
                this.pendingAssistantEventFlushFrame = window.requestAnimationFrame(() => {
                    this.pendingAssistantEventFlushFrame = null
                    this.flushPendingAssistantEvents()
                })
                return
            }
            if (this.pendingAssistantEventFlushFrame !== null || this.pendingAssistantEventFlushTimeout !== null) return
            this.pendingAssistantEventFlushTimeout = window.setTimeout(() => {
                this.pendingAssistantEventFlushTimeout = null
                this.flushPendingAssistantEvents()
            }, ASSISTANT_STREAM_CHECKPOINT_DELAY_MS)
            return
        }

        if (this.pendingAssistantEventFlushTimeout !== null) {
            window.clearTimeout(this.pendingAssistantEventFlushTimeout)
            this.pendingAssistantEventFlushTimeout = null
        }
        if (this.pendingAssistantEventFlushFrame !== null) return

        this.pendingAssistantEventFlushFrame = window.requestAnimationFrame(() => {
            this.pendingAssistantEventFlushFrame = null
            this.flushPendingAssistantEvents()
        })
    }

    private flushPendingAssistantEvents() {
        if (this.pendingAssistantEventFlushFrame !== null) {
            window.cancelAnimationFrame(this.pendingAssistantEventFlushFrame)
            this.pendingAssistantEventFlushFrame = null
        }
        if (this.pendingAssistantEventFlushTimeout !== null) {
            window.clearTimeout(this.pendingAssistantEventFlushTimeout)
            this.pendingAssistantEventFlushTimeout = null
        }
        if (this.pendingAssistantEvents.length === 0) return

        const queuedEvents = collapseAssistantDeltaEvents(this.pendingAssistantEvents)
        this.pendingAssistantEvents = []
        const previousSelectedSessionId = this.state.snapshot.selectedSessionId
        let nextSelectedSessionId = previousSelectedSessionId
        this.setState((current) => {
            const projectedSnapshot = applyAssistantDomainEvents(current.snapshot, queuedEvents)
            let snapshot = preserveAssistantClientRoute(
                current.snapshot,
                projectedSnapshot,
                current.selectionRequestSessionId
            )
            let historyByThreadId = current.historyByThreadId
            for (const [threadId, history] of Object.entries(current.historyByThreadId)) {
                const canonicalBackfillChanged = queuedEvents.some((event) => (
                    shouldRehydrateAssistantHistoryAfterCanonicalEvent(event, threadId)
                ))
                if (canonicalBackfillChanged) {
                    snapshot = replaceAssistantVisibleHistory(snapshot, threadId, history)
                    continue
                }
                const synchronizedHistory = synchronizeAssistantVisibleHistory(
                    snapshot,
                    threadId,
                    history,
                    history.pageInfo.hasNewer
                )
                if (synchronizedHistory !== history) {
                    historyByThreadId = { ...historyByThreadId, [threadId]: synchronizedHistory }
                    snapshot = replaceAssistantVisibleHistory(snapshot, threadId, synchronizedHistory)
                }
            }
            nextSelectedSessionId = snapshot.selectedSessionId
            return {
                snapshot,
                historyByThreadId,
                status: deriveAssistantRuntimeStatus(snapshot, current.status)
            }
        })
        if (nextSelectedSessionId !== previousSelectedSessionId) {
            void this.hydrateSelectedSessionIfNeeded()
            return
        }
        const selectedSession = this.state.snapshot.sessions.find((session) => session.id === nextSelectedSessionId) || null
        const selectedThreadId = selectedSession?.activeThreadId || null
        if (
            selectedSession
            && selectedThreadId
            && queuedEvents.some((event) => shouldRehydrateAssistantHistoryAfterCanonicalEvent(event, selectedThreadId))
        ) {
            this.scheduleCanonicalHistoryRehydration(selectedSession.id, selectedThreadId)
        }
    }

    private clearPendingAssistantEvents() {
        if (this.pendingAssistantEventFlushFrame !== null) {
            window.cancelAnimationFrame(this.pendingAssistantEventFlushFrame)
            this.pendingAssistantEventFlushFrame = null
        }
        if (this.pendingAssistantEventFlushTimeout !== null) {
            window.clearTimeout(this.pendingAssistantEventFlushTimeout)
            this.pendingAssistantEventFlushTimeout = null
        }
        this.pendingAssistantEvents = []
        assistantStreamPresentation.clear()
    }

    private scheduleCanonicalHistoryRehydration(sessionId: string, threadId: string): void {
        const hydrationKey = this.buildSelectionHydrationKey(sessionId, threadId)
        if (this.pendingCanonicalHistoryRehydrations.has(hydrationKey)) return
        const currentHydration = this.pendingSelectionHydrations.get(hydrationKey)
        const scheduled = (currentHydration ? currentHydration.catch(() => undefined) : Promise.resolve())
            .then(async () => {
                const selectedSession = this.state.snapshot.sessions.find(
                    (session) => session.id === this.state.snapshot.selectedSessionId
                ) || null
                if (selectedSession?.id !== sessionId || selectedSession.activeThreadId !== threadId) return
                await this.requestSessionHydration(sessionId, threadId)
            })
            .finally(() => {
                if (this.pendingCanonicalHistoryRehydrations.get(hydrationKey) === scheduled) {
                    this.pendingCanonicalHistoryRehydrations.delete(hydrationKey)
                }
            })
        this.pendingCanonicalHistoryRehydrations.set(hydrationKey, scheduled)
    }

    private async hydrateSelectedSessionIfNeeded(): Promise<void> {
        const sessionId = this.state.snapshot.selectedSessionId
        const selectedSession = this.state.snapshot.sessions.find((session) => session.id === sessionId) || null
        const activeThreadId = selectedSession?.activeThreadId || null
        if (!sessionId || !selectedSession || !activeThreadId) return
        await this.requestSessionHydration(sessionId, activeThreadId)
    }

    private buildSelectionHydrationKey(sessionId: string, threadId: string | null) {
        return `${sessionId}:${threadId || ''}`
    }

    private async requestSessionHydration(
        sessionId: string,
        threadId: string | null,
        retryAttempt = 0,
        force = false,
        resetLoadedRange = false
    ): Promise<void> {
        if (!sessionId || !threadId) return
        const retainedHistory = this.state.historyByThreadId[threadId]
        const currentThread = this.state.snapshot.sessions
            .flatMap((session) => session.threads)
            .find((thread) => thread.id === threadId) || null
        if (!force && isAssistantRetainedHistoryFresh(retainedHistory, currentThread)) {
            const retainedHasRows = hasRenderableAssistantRetainedHistory(retainedHistory)
            const renderedHasRows = Boolean(
                currentThread?.messages.length
                || currentThread?.activities.length
                || currentThread?.proposedPlans.length
            )
            if (!retainedHasRows || renderedHasRows) return
            this.setState((current) => ({
                snapshot: applyAssistantRetainedHistory(current.snapshot, threadId, retainedHistory!)
            }))
            return
        }

        const hydrationKey = this.buildSelectionHydrationKey(sessionId, threadId)
        const existing = this.pendingSelectionHydrations.get(hydrationKey)
        if (existing) {
            if (!force) return existing
            await existing.catch(() => undefined)
            return this.requestSessionHydration(sessionId, threadId, retryAttempt, true, resetLoadedRange)
        }

        const requestedRevision = currentThread ? getAssistantThreadHydrationRevision(currentThread) : null
        let request!: Promise<void>
        request = (async () => {
            let revisionChanged = false
            this.setState({ selectionHydrationKey: hydrationKey })
            try {
                const result = await window.devscope.assistant.getThreadDetailBootstrap(threadId)
                if (!result.success) {
                    const latestThread = this.state.snapshot.sessions
                        .flatMap((session) => session.threads)
                        .find((thread) => thread.id === threadId) || null
                    if (
                        requestedRevision
                        && latestThread
                        && getAssistantThreadHydrationRevision(latestThread) !== requestedRevision
                    ) {
                        revisionChanged = true
                        return
                    }
                    const selectedThreadId = this.state.snapshot.sessions
                        .find((session) => session.id === this.state.snapshot.selectedSessionId)?.activeThreadId || null
                    if (selectedThreadId === threadId) this.setState({ error: result.error })
                    return
                }

                this.setState((current) => {
                    const latestThread = current.snapshot.sessions
                        .flatMap((session) => session.threads)
                        .find((thread) => thread.id === threadId) || null
                    if (
                        requestedRevision
                        && latestThread
                        && getAssistantThreadHydrationRevision(latestThread) !== requestedRevision
                    ) {
                        revisionChanged = true
                        return {}
                    }
                    const applied = applyAssistantThreadDetail(
                        current.snapshot,
                        result.detail,
                        resetLoadedRange ? undefined : current.historyByThreadId[threadId]
                    )
                    const selectedThreadId = current.snapshot.sessions
                        .find((session) => session.id === current.snapshot.selectedSessionId)?.activeThreadId || null
                    const runningThreadIds = new Set(current.snapshot.sessions.flatMap((session) => (
                        session.threads.filter((thread) => (
                            ['starting', 'running', 'waiting', 'background'].includes(thread.state)
                            || thread.hasPendingApprovals
                            || thread.hasPendingUserInputs
                            || thread.hasActivePlan
                            || thread.pendingApprovals.length > 0
                            || thread.pendingUserInputs.length > 0
                            || Boolean(thread.activePlan)
                        )).map((thread) => thread.id)
                    )))
                    if (selectedThreadId) runningThreadIds.add(selectedThreadId)
                    const historyByThreadId = pruneAssistantHistoryCache({
                        ...current.historyByThreadId,
                        [threadId]: applied.history
                    }, runningThreadIds)
                    const snapshot = dematerializeAssistantHistories(applied.snapshot, runningThreadIds)
                    return {
                        snapshot,
                        historyByThreadId,
                        status: deriveAssistantRuntimeStatus(snapshot, current.status),
                        ...(selectedThreadId === threadId ? { error: null } : {})
                    }
                })
            } catch (error) {
                const latestThread = this.state.snapshot.sessions
                    .flatMap((session) => session.threads)
                    .find((thread) => thread.id === threadId) || null
                if (
                    requestedRevision
                    && latestThread
                    && getAssistantThreadHydrationRevision(latestThread) !== requestedRevision
                ) {
                    revisionChanged = true
                } else {
                    const selectedThreadId = this.state.snapshot.sessions
                        .find((session) => session.id === this.state.snapshot.selectedSessionId)?.activeThreadId || null
                    if (selectedThreadId === threadId) {
                        this.setState({ error: error instanceof Error ? error.message : 'Failed to load assistant history.' })
                    }
                }
            } finally {
                if (this.pendingSelectionHydrations.get(hydrationKey) === request) {
                    this.pendingSelectionHydrations.delete(hydrationKey)
                }
                this.setState((current) => (
                    current.selectionHydrationKey === hydrationKey
                        ? { selectionHydrationKey: null }
                        : {}
                ))
            }
            if (revisionChanged && retryAttempt < 2) {
                await this.requestSessionHydration(sessionId, threadId, retryAttempt + 1, force, resetLoadedRange)
            }
        })()
        this.pendingSelectionHydrations.set(hydrationKey, request)
        return request
    }

    private applyPlaygroundState(playground: AssistantPlaygroundState) {
        this.setState((current) => ({
            snapshot: {
                ...current.snapshot,
                playground
            }
        }))
    }

    private async refreshSessionShellSnapshot(sessionId: string, preserveClientRoute = true) {
        try {
            const shellSnapshot = await window.devscope.assistant.getSnapshot()
            const materializedSnapshot = materializeAssistantShellSnapshot(shellSnapshot)
            let snapshot = materializedSnapshot
            this.setState((current) => {
                snapshot = preserveClientRoute
                    ? preserveAssistantClientRoute(current.snapshot, materializedSnapshot, current.selectionRequestSessionId)
                    : materializedSnapshot
                return {
                    snapshot,
                    status: deriveAssistantRuntimeStatus(snapshot, current.status)
                }
            })
            const session = snapshot.sessions.find((entry) => entry.id === sessionId) || null
            if (session?.activeThreadId) void this.requestSessionHydration(sessionId, session.activeThreadId)
            return { success: true as const, sessionId, snapshot }
        } catch (error) {
            return { success: false as const, error: error instanceof Error ? error.message : 'Failed to refresh assistant sessions.' }
        }
    }

    private async runPlaygroundAction<T extends { playground: AssistantPlaygroundState }>(
        work: () => Promise<DevScopeResult<T>>,
        refreshStatusAfter: boolean
    ): Promise<DevScopeResult<T>> {
        const result = await this.runAction(work, refreshStatusAfter)
        if (result.success) {
            this.applyPlaygroundState(result.playground)
        }
        return result
    }

    private async runAction<T = Record<string, unknown>>(
        work: () => Promise<DevScopeResult<T>>,
        refreshStatusAfter: boolean
    ): Promise<DevScopeResult<T>> {
        const result = await runAssistantStoreAction(this.setState, work)
        if (refreshStatusAfter) {
            try {
                const status = await window.devscope.assistant.getStatus()
                this.setState({ status })
            } catch {}
        }
        return result
    }

    private setState = (
        nextState:
            | Partial<AssistantStoreState>
            | ((current: AssistantStoreState) => Partial<AssistantStoreState>)
    ) => {
        const partial = typeof nextState === 'function' ? nextState(this.state) : nextState
        const partialKeys = Object.keys(partial) as Array<keyof AssistantStoreState>
        if (partialKeys.length === 0) return
        let changed = false
        const previousState = this.state
        const mergedState: AssistantStoreState = { ...previousState }
        for (const key of partialKeys) {
            const nextValue = partial[key]
            if (Object.is(previousState[key], nextValue)) continue
            changed = true
            ;(mergedState as Record<keyof AssistantStoreState, AssistantStoreState[keyof AssistantStoreState]>)[key] = nextValue as AssistantStoreState[keyof AssistantStoreState]
        }
        if (!changed) return
        this.state = mergedState
        if (
            !Object.is(previousState.snapshot, mergedState.snapshot)
            && previousState.snapshot.sessions !== mergedState.snapshot.sessions
        ) {
            cacheHydratedThreads(this.hydratedThreadCache, mergedState.snapshot)
        }
        for (const listener of this.listeners) {
            listener()
        }
    }
}
export type { AssistantStoreState } from './assistant-store-runtime'
export const assistantStore = new AssistantStore()
