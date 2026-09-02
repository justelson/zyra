import { createHash, randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import log from 'electron-log'
import type {
    AssistantApprovePendingPlaygroundLabRequestInput,
    AssistantAttachSessionToPlaygroundLabInput,
    AssistantClearLogsInput,
    AssistantConnectOptions,
    AssistantCreatePlaygroundLabInput,
    AssistantCreateSessionInput,
    AssistantDeclinePendingPlaygroundLabRequestInput,
    AssistantDeleteMessageInput,
    AssistantDeletePlaygroundLabInput,
    AssistantDomainEvent,
    AssistantGetHistoryPageInput,
    AssistantHistoryBody,
    AssistantHistoryBodyRef,
    AssistantHydrateHistoryBodyInput,
    AssistantGetSessionTurnUsageInput,
    AssistantIngestRealtimeVoiceEventInput,
    AssistantRedeemAccountResetInput,
    AssistantEventStreamPayload,
    AssistantActivity,
    AssistantMessage,
    AssistantModelInfo,
    AssistantRealtimeVoiceEvent,
    AssistantRuntimeStatus,
    AssistantSendPromptOptions,
    AssistantSendRealtimeVoiceMessageInput,
    AssistantSession,
    AssistantSkillSourceSettings,
    AssistantStartRealtimeVoiceInput,
    AssistantThread,
    AssistantVoiceExecutionConfiguration,
    CanonicalLedgerAppendInput,
    CanonicalMessageCommitReceipt,
    FleetOperationInput,
    FleetSnapshot,
    ForegroundRouteClaim,
    RealtimeDomainEvent
} from '../../shared/assistant/contracts'
import {
    DEFAULT_INSTRUCTOR_OUTPUT_MODALITY,
    DEFAULT_INSTRUCTOR_REALTIME_VOICE,
    DEFAULT_INSTRUCTOR_VOICE_INSTRUCTIONS,
    foregroundRouteClaim,
    isAssistantRuntimeMode,
    mergeFileChangePayloadRecords,
    parseAssistantHistoryBodyRef
} from '../../shared/assistant/contracts'
import { isAssistantToolLifecycleStartEvent } from '../../shared/assistant/tool-lifecycle'
import {
    normalizeAssistantRuntimePolicy,
    type AssistantRuntimePolicy
} from '../../shared/assistant/runtime-policy'
import { isAssistantReasoningEffort } from '../../shared/assistant/reasoning-efforts'
import type { AnalyticsEventInput, AnalyticsEventName } from '../../shared/analytics/contracts'
import { inspectProjectAnalyticsCapabilities } from '../analytics/project-capabilities'
import { classifyAnalyticsErrorCode as classifyAnalyticsError } from '../../shared/analytics/error-code'
import { findAssistantMessageReplayDuplicateIds, preserveCanonicalUserReplayBoundaries } from '../../shared/assistant/message-reconciliation'
import { replaceSerializedAssistantImageAttachments } from '../../shared/assistant/message-attachments'
import { isAssistantTitleGenerationPrompt } from '../../shared/assistant/title-generation'
import { AssistantTextDeltaBuffer } from './assistant-text-delta-buffer'
import { AssistantActivityDeltaBuffer } from './assistant-activity-delta-buffer'
import { ChatGptRealtimeVoiceRuntime } from './codex-realtime-voice'
import { normalizeInstructorRealtimeMessage } from './codex-realtime-voice-contract'
import { ConversationGateway } from './foreground/conversation-gateway'
import { ForegroundControllerPersistence } from './foreground/foreground-controller-persistence'
import { ForegroundRouteController, routeExpectation } from './foreground/foreground-route-controller'
import { PiCanonicalMessageWriter } from './foreground/pi-canonical-message-writer'
import { AssistantRealtimeContinuitySource } from './voice/assistant-realtime-continuity-source'
import { CanonicalVoiceSessionController } from './voice/canonical-voice-session-controller'
import { CanonicalVoiceTranscriptCommitter } from './voice/canonical-voice-transcript-committer'
import { CanonicalTypedVoiceResponseCommitter } from './voice/canonical-typed-voice-response-committer'
import { ChatGptRealtimeForegroundAdapter } from './voice/codex-realtime-foreground-adapter'
import { probeDirectChatGptRealtimeCapabilitiesAsync } from './voice/codex-realtime-capability-probe'
import {
    boundedVoiceTaskResult,
    buildVoiceStrongInspectionPrompt,
    shouldDelegateVoiceInspection,
    voiceTaskFailureMessage
} from './voice/voice-strong-routing'
import { buildVoiceStrongTaskActivity } from './voice/voice-strong-task-activity'
import { ZyraAccountService } from './zyra-account-service'
import {
    classifyZyraToolActivity,
    readPiFileChangeData,
    ZyraPiRuntime
} from './zyra-pi-runtime'
import { deriveSessionTitleFromPrompt, isDefaultSessionTitle, nowIso } from './utils'
import { materializeCanonicalImage } from './canonical-media-cache'
import { createAssistantSessionRecord } from './service-records'
import type { AssistantServiceActionDeps } from './service-action-deps'
import { AssistantPersistence } from './persistence'
import {
    getAssistantSkillSourceOverview,
    listAssistantPromptResources,
    updateAssistantSkillSourceSettings
} from './prompt-resources'
import { toAssistantShellSnapshot } from './persistence-snapshot'
import { FleetProjection, shouldApplyAssistantFleetSnapshot } from './fleet-projection'
import { queueGeneratedSessionTitle, regenerateSessionTitle as generateReplacementSessionTitle, shouldAutoRegenerateSessionTitle, shouldGenerateSessionTitleForPrompt } from './session-title-generation'
import { applyDomainEvent, createDefaultSnapshot } from './projector'
import { approvePendingPlaygroundLabRequestAction, attachSessionToPlaygroundLabAction, createPlaygroundLabAction, declinePendingPlaygroundLabRequestAction, deletePlaygroundLabAction, setPlaygroundRootAction } from './service-playground-actions'
import {
    clearAssistantLogsAction,
    connectAssistantSession,
    createAssistantSessionAction,
    createAssistantThreadAction,
    deleteAssistantMessageAction,
    deleteAssistantSessionAction,
    disconnectAssistantSession,
    getAssistantRuntimeStatusAction,
    getAssistantSessionTurnUsageAction,
    interruptAssistantTurnAction,
    archiveAssistantSessionAction,
    renameAssistantSessionAction,
    respondAssistantApprovalAction,
    respondAssistantUserInputAction,
    selectAssistantSessionAction,
    selectAssistantThreadAction,
    sendAssistantPromptAction,
    setAssistantSessionProjectPathAction
} from './service-session-actions'
import {
    broadcastAssistantPayload,
    broadcastAssistantRealtimeVoiceEvent,
    createAssistantDomainEvent,
    trimAssistantEvents,
    updateLatestTurnAssistantMessage
} from './service-helpers'
import {
    buildInternalTextActivity,
    buildStreamingToolActivity,
    handleAssistantRuntimeEvent
} from './service-runtime-events'
import { hasCanonicalUserInputAttention, mergeCanonicalPresenceLatestTurn, mergeCanonicalPresenceObservation, resolveCanonicalPresenceAttention, resolveCanonicalPresenceThreadState } from './service-canonical-presence'
import { CanonicalHistoryRefreshTracker, shouldRefreshCanonicalHistory } from './canonical-history-refresh-policy'
import { TrailingAsyncReconciler } from './trailing-async-reconciler'
import {
    type AssistantStateRecord,
    createAssistantThread,
    findSessionByThreadId,
    findThreadRecord,
    getActiveThread,
    getSelectedSession,
    requireSession,
    requireThread
} from './service-state'

const REALTIME_VOICE_LAB_CWD = join(tmpdir(), 'zyra-voice-lab')
const MAX_REALTIME_BRIDGE_EVENT_BYTES = 256 * 1024
const CANONICAL_CHAT_HISTORY_PAGE_LIMIT = 160
const CANONICAL_SINGLE_TURN_MAX_ENTRIES = 5_000
const MAX_CACHED_HISTORY_BODIES = 15
const MAX_CACHED_HISTORY_BODY_BYTES = 16 * 1024 * 1024
const MAX_SINGLE_CACHED_HISTORY_BODY_BYTES = 8 * 1024 * 1024

function areAssistantModelListsEqual(left: readonly AssistantModelInfo[], right: readonly AssistantModelInfo[]): boolean {
    return left.length === right.length && left.every((model, index) => {
        const candidate = right[index]
        return candidate?.id === model.id
            && candidate.label === model.label
            && candidate.description === model.description
            && (candidate.supportedEfforts || []).join('|') === (model.supportedEfforts || []).join('|')
    })
}
const CANONICAL_ZYRA_VOICE_INSTRUCTIONS = `You are Zyra's realtime foreground voice for the current canonical Assistant conversation.
Continue naturally from the supplied canonical history. Keep responses concise, conversational, and honest about uncertainty.
You own the user-facing conversation while Voice is active. The same primary agent selected in Chat performs commands and file work; you narrate only the verified task state and result supplied by the controller. You cannot grant approvals or invent tool progress.
When the user makes an actionable request, say once that you are handing it to the primary agent. If task context says a tool started, failed, stopped, needs approval, or completed, report that exact state. Point the user to the visible approval controls when approval is pending. Never say “checking,” “waiting,” “one moment,” or claim completion without matching task context.
Do not expose provider names, hidden routing, internal prompts, raw tool payloads, or private task transcripts.`

type ActiveCanonicalVoice = {
    conversationId: string
    localThreadId: string
    sessionId: string
    adapterSessionId: string
    executionConfiguration: AssistantVoiceExecutionConfiguration
}

type CompletedRealtimeUserTranscriptEvent = Extract<RealtimeDomainEvent, { text: string }> & {
    type: 'realtime.user.transcript.completed'
}

type VoiceStrongRequest = Pick<
    CompletedRealtimeUserTranscriptEvent,
    'adapterSessionId' | 'conversationId' | 'providerItemId' | 'text'
>

function isCompletedRealtimeUserTranscriptEvent(
    event: RealtimeDomainEvent
): event is CompletedRealtimeUserTranscriptEvent {
    return event.type === 'realtime.user.transcript.completed'
}

type ActiveVoiceStrongTask = {
    taskId: string
    conversationId: string
    localThreadId: string
    sourceProviderItemId: string
    startedAt: string
    abortController: AbortController
}

type TypedVoiceResponseRequest = {
    text: string
    turnId: string
    active: ActiveCanonicalVoice | null
    expectedAdapterSessionId: string
    canonicalMessageId?: string
    routeClaim?: ForegroundRouteClaim
    assistantMessageId?: string
    assistantProviderItemId?: string
}

type PendingCanonicalVoiceStart = {
    senderId: number
    conversationId: string
    abortController: AbortController
    finished: Promise<void>
    resolveFinished: () => void
}

export type AssistantServiceOptions = {
    getNewChatExecutionDefaults?: () => Promise<{ webSearch: boolean; webFetch: boolean }>
    getTitleGenerationModel?: () => Promise<string | null>
    getTitleAutomation?: () => Promise<{ enabled: boolean; turnInterval: number }>
    getRuntimePolicy?: () => Promise<AssistantRuntimePolicy>
    openDesktopWorkspace?: (request: Record<string, unknown>) => Promise<Record<string, unknown>>
    cancelDesktopWorkspace?: (requestId: string) => void
    handleDesktopWorkspaceTurn?: (canonicalChatId: string, turnId: string) => void
    handleDetachedControl?: (input: { canonicalChatId: string; turnId: string | null; operation: unknown; principal?: unknown; signal: AbortSignal }) => Promise<Record<string, unknown>>
    handleDesktopWorkspaceTurnEnded?: (canonicalChatId: string, turnId: string) => void
    captureAnalytics?: <Name extends AnalyticsEventName>(input: AnalyticsEventInput<Name>) => void
}

export function reconcileCanonicalFileChangeActivity(
    existing: AssistantActivity | null | undefined,
    incoming: AssistantActivity
): AssistantActivity {
    if (!existing || (existing.kind !== 'file-change' && incoming.kind !== 'file-change')) return incoming
    const existingPayload = existing.payload || {}
    const incomingPayload = incoming.payload || {}
    const providerValue = incomingPayload['provider'] || existingPayload['provider']
    const provider = providerValue === 'codex' ? 'codex' : 'pi'
    const startedAtValue = existingPayload['startedAt'] || incomingPayload['startedAt']
    const startedAt = typeof startedAtValue === 'string' && startedAtValue.trim()
        ? startedAtValue
        : existing.createdAt || incoming.createdAt
    const merged = mergeFileChangePayloadRecords(existingPayload, incomingPayload, { provider, startedAt })
    return {
        ...incoming,
        payload: {
            ...existingPayload,
            ...incomingPayload,
            ...merged
        }
    }
}

function reconcileCanonicalFileChangeActivities(
    existing: AssistantActivity[],
    incoming: AssistantActivity[]
): AssistantActivity[] {
    const existingById = new Map(existing.map((activity) => [activity.id, activity]))
    return incoming.map((activity) => reconcileCanonicalFileChangeActivity(existingById.get(activity.id), activity))
}

export class AssistantService {
    private static readonly MAX_IN_MEMORY_EVENTS = 256
    private static readonly ASSISTANT_TEXT_DELTA_FLUSH_MS = 40
    private static readonly ASSISTANT_ACTIVITY_DELTA_FLUSH_MS = 48
    private static readonly ASSISTANT_EVENT_BROADCAST_BATCH_MS = 16

    private readonly runtime = new ZyraPiRuntime()
    private readonly accountService = new ZyraAccountService()
    private readonly realtimeVoiceRuntime = new ChatGptRealtimeVoiceRuntime()
    private readonly persistence = new AssistantPersistence()
    private foregroundPersistence: ForegroundControllerPersistence | null = null
    private foregroundRoutes: ForegroundRouteController | null = null
    private conversationGateway: ConversationGateway | null = null
    private realtimeContinuity: AssistantRealtimeContinuitySource | null = null
    private canonicalRealtimeAdapter: ChatGptRealtimeForegroundAdapter | null = null
    private canonicalVoiceSessions: CanonicalVoiceSessionController | null = null
    private canonicalVoiceCommitter: CanonicalVoiceTranscriptCommitter | null = null
    private canonicalTypedVoiceCommitter: CanonicalTypedVoiceResponseCommitter | null = null
    private canonicalVoiceSetupPromise: Promise<void> | null = null
    private canonicalVoiceUnsubscribe: (() => void) | null = null
    private activeCanonicalVoice: ActiveCanonicalVoice | null = null
    private pendingCanonicalVoiceStart: PendingCanonicalVoiceStart | null = null
    private canonicalVoiceStopPromise: Promise<void> | null = null
    private navigationSelectionGeneration = 0
    private readonly voiceTransitioningThreadIds = new Set<string>()
    private readonly activeVoiceStrongTasks = new Map<string, ActiveVoiceStrongTask>()
    private readonly queuedVoiceStrongRequests = new Map<string, VoiceStrongRequest[]>()
    private readonly delegatedVoiceProviderItems = new Set<string>()
    private readonly typedVoiceResponseQueues = new Map<string, Promise<void>>()
    private readonly fleetProjection = new FleetProjection()
    private readonly assistantTextDeltaBuffer = new AssistantTextDeltaBuffer({
        flushDelayMs: AssistantService.ASSISTANT_TEXT_DELTA_FLUSH_MS,
        onFlush: (entry) => {
            this.appendEvent('thread.message.assistant.delta', entry.occurredAt, {
                threadId: entry.threadId,
                messageId: entry.messageId,
                delta: entry.delta,
                turnId: entry.turnId
            }, entry.sessionId, entry.threadId)
        }
    })
    private readonly assistantActivityDeltaBuffer = new AssistantActivityDeltaBuffer({
        flushDelayMs: AssistantService.ASSISTANT_ACTIVITY_DELTA_FLUSH_MS,
        onFlush: (entry) => {
            const threadRecord = findThreadRecord(this.state.snapshot, entry.threadId)
            if (!threadRecord) return
            const existing = threadRecord.thread.activities.find((activity) => activity.id === entry.activityId) || null
            const activity = entry.streamKind === 'reasoning_text' || entry.streamKind === 'reasoning_summary_text'
                ? buildInternalTextActivity({
                    existing,
                    activityId: entry.activityId,
                    text: entry.delta,
                    turnId: entry.turnId,
                    itemId: entry.itemId,
                    occurredAt: entry.occurredAt,
                    status: 'streaming',
                    streamKind: entry.streamKind
                })
                : buildStreamingToolActivity({
                    existing,
                    activityId: entry.activityId,
                    kind: entry.streamKind === 'command_output' ? 'command' : 'file-change',
                    delta: entry.delta,
                    turnId: entry.turnId,
                    itemId: entry.itemId,
                    occurredAt: entry.occurredAt
                })
            this.appendEvent('thread.activity.appended', entry.occurredAt, {
                threadId: entry.threadId,
                activity
            }, entry.sessionId, entry.threadId)
        }
    })
    private readonly subscribers = new Set<number>()
    private readonly externalEventSubscribers = new Set<(payload: AssistantEventStreamPayload) => void>()
    private readonly realtimeVoiceSubscribers = new Set<number>()
    private readonly externalRealtimeVoiceSubscribers = new Set<(event: AssistantRealtimeVoiceEvent) => void>()
    private realtimeVoiceOwnerId: number | null = null
    private voicePrimaryPreparationGeneration = 0
    private voiceStartedAt = 0
    private voiceFirstResponseCaptured = false
    private voiceFailureCaptured = false
    private readonly planBuffers = new Map<string, string>()
    private readonly assistantTextBuffers = new Map<string, string>()
    private readonly suppressedAssistantTextTurns = new Set<string>()
    private readonly autoTitleMilestones = new Set<string>()
    private readonly readyPromise: Promise<void>
    private disposePromise: Promise<void> | null = null
    private disposeRequested = false
    private readonly actionDeps: AssistantServiceActionDeps

    private state: AssistantStateRecord = {
        snapshot: createDefaultSnapshot(),
        events: []
    }
    private pendingBroadcastEvents: AssistantDomainEvent[] = []
    private pendingBroadcastTimer: NodeJS.Timeout | null = null
    private readonly canonicalCatalogReconciler = new TrailingAsyncReconciler(() => this.importCanonicalChats())
    private readonly canonicalReviewHistoryState = new Map<string, { threadId: string; totalEntries: number; modifiedAt: string }>()
    private readonly canonicalReviewIndexPromises = new Map<string, Promise<void>>()
    private readonly canonicalHistoryBodyCache = new Map<string, { body: AssistantHistoryBody; bytes: number }>()
    private canonicalHistoryBodyCacheBytes = 0
    private readonly canonicalHistoryLoadPromises = new Map<string, Promise<void>>()
    private readonly canonicalHistoryRefresh = new CanonicalHistoryRefreshTracker()
    private readonly canonicalHistoryState = new Map<string, {
        before: string | null
        hasOlder: boolean
        project: string
        key: string
        sessionId: string
        threadId: string
    }>()

    constructor(private readonly options: AssistantServiceOptions = {}) {
        this.runtime.setDesktopWorkspaceHandler(options.openDesktopWorkspace || null, options.cancelDesktopWorkspace || null, options.handleDesktopWorkspaceTurn || null, options.handleDetachedControl || null, options.handleDesktopWorkspaceTurnEnded || null)
        this.readyPromise = this.initialize()
        this.actionDeps = {
            runtime: this.runtime,
            ensureReady: () => this.ensureReady(),
            getSnapshot: () => this.state.snapshot,
            hydrateSelectedSession: async (sessionId: string) => {
                this.state.snapshot = await this.persistence.hydrateSelectedSession(this.state.snapshot, sessionId)
            },
            getFirstUserMessageText: (sessionId: string) => this.persistence.readFirstUserMessageText(sessionId),
            getNewChatExecutionDefaults: () => this.options.getNewChatExecutionDefaults?.()
                || Promise.resolve({ webSearch: true, webFetch: true }),
            getTitleGenerationModel: () => this.options.getTitleGenerationModel?.() || Promise.resolve(null),
            getRuntimePolicy: async () => normalizeAssistantRuntimePolicy(
                await this.options.getRuntimePolicy?.()
            ),
            appendEvent: (type, occurredAt, payload, sessionId, threadId) => {
                this.appendEvent(type, occurredAt, payload, sessionId, threadId)
            },
            getSessionRuntimeCwd: (session, thread) => this.getSessionRuntimeCwd(session, thread),
            createSession: (input?: AssistantCreateSessionInput) => this.createSession(input),
            createPlaygroundLab: (input: AssistantCreatePlaygroundLabInput) => this.createPlaygroundLab(input),
            sendPrompt: (prompt: string, options?: AssistantSendPromptOptions) => this.sendPrompt(prompt, options),
            suppressAssistantTextForTurn: (threadId: string, turnId: string) => {
                this.suppressedAssistantTextTurns.add(`${threadId}:${turnId}`)
            }
        }
        this.runtime.on('runtime', (event) => {
            this.handleRuntimeEvent(event)
        })
        this.runtime.on('catalog.changed', (value) => {
            const change = asCanonicalRecord(value)
            const canonicalChatId = String(change?.['canonicalChatId'] || '').trim()
            const transcriptChanged = !change
                || change['canonicalMessage'] === true
                || !change['presence'] && !change['metadata'] && !change['title'] && !change['project']
            if (transcriptChanged) {
                if (canonicalChatId) {
                    this.canonicalReviewHistoryState.delete(canonicalChatId)
                    this.markCanonicalHistoryDirty(canonicalChatId)
                } else {
                    this.canonicalReviewHistoryState.clear()
                    for (const session of this.state.snapshot.sessions) {
                        for (const thread of session.threads) {
                            if (thread.providerThreadId) this.markCanonicalHistoryDirty(thread.providerThreadId)
                        }
                    }
                }
            }
            void this.queueCanonicalChatImport()
        })
        this.realtimeVoiceRuntime.on('event', (event) => {
            if (event.type === 'session.started') {
                this.captureAnalytics({
                    event: 'zyra_v1_voice',
                    properties: { action: 'connect', outcome: 'completed', duration_ms: Date.now() - this.voiceStartedAt }
                })
            } else if (event.type === 'transcript.done' && event.role === 'assistant' && !this.voiceFirstResponseCaptured) {
                this.voiceFirstResponseCaptured = true
                this.captureAnalytics({
                    event: 'zyra_v1_voice',
                    properties: { action: 'first_response', outcome: 'completed', duration_ms: Date.now() - this.voiceStartedAt }
                })
            } else if (event.type === 'session.error' && !this.voiceFailureCaptured) {
                this.voiceFailureCaptured = true
                this.captureAnalytics({
                    event: 'zyra_v1_voice',
                    properties: { action: 'fail', outcome: 'failed', error_code: classifyAnalyticsError(event.message) }
                })
            }
            if (event.type === 'client.command') {
                if (this.realtimeVoiceRuntime.isCurrentClientCommand(event)) {
                    this.broadcastRealtimeVoiceEvent(event, true)
                }
                return
            }
            if (event.type === 'composer.response.delta' || event.type === 'composer.response.done') {
                this.broadcastRealtimeVoiceEvent(event, true)
                return
            }
            if (this.activeCanonicalVoice) return
            if (event.type === 'session.error' || event.type === 'session.closed') {
                this.realtimeVoiceOwnerId = null
            }
            this.broadcastRealtimeVoiceEvent(event)
        })
        void this.readyPromise
            .then(() => this.recoverSelectedSessionTitle())
            .catch((error) => log.warn('[Assistant] Failed to recover the selected chat title', error))
    }

    subscribe(senderId: number) {
        this.subscribers.add(senderId)
        return { success: true as const }
    }

    unsubscribe(senderId: number) {
        this.subscribers.delete(senderId)
        return { success: true as const }
    }

    subscribeExternalEvents(listener: (payload: AssistantEventStreamPayload) => void): () => void {
        this.externalEventSubscribers.add(listener)
        return () => this.externalEventSubscribers.delete(listener)
    }

    getExternalEventReplay(): AssistantEventStreamPayload {
        const events = [...this.state.events]
        if (events.length === 0) return {}
        return events.length === 1 ? { event: events[0] } : { events }
    }

    subscribeRealtimeVoice(senderId: number) {
        this.realtimeVoiceSubscribers.add(senderId)
        return { success: true as const }
    }

    subscribeExternalRealtimeVoiceEvents(listener: (event: AssistantRealtimeVoiceEvent) => void): () => void {
        this.externalRealtimeVoiceSubscribers.add(listener)
        return () => this.externalRealtimeVoiceSubscribers.delete(listener)
    }

    private broadcastRealtimeVoiceEvent(event: AssistantRealtimeVoiceEvent, ownerOnly = false): void {
        if (ownerOnly && this.realtimeVoiceOwnerId === null) return
        const subscribers = ownerOnly
            ? new Set(this.realtimeVoiceSubscribers.has(this.realtimeVoiceOwnerId as number)
                ? [this.realtimeVoiceOwnerId as number]
                : [])
            : this.realtimeVoiceSubscribers
        broadcastAssistantRealtimeVoiceEvent(subscribers, event)
        for (const listener of [...this.externalRealtimeVoiceSubscribers]) {
            try {
                listener(event)
            } catch (error) {
                log.warn('[AssistantVoice] External realtime event subscriber failed', error)
            }
        }
    }

    unsubscribeRealtimeVoice(senderId: number) {
        this.realtimeVoiceSubscribers.delete(senderId)
        if (this.realtimeVoiceOwnerId === senderId) {
            void this.stopRealtimeVoice(senderId).catch((error) => {
                log.warn('[AssistantVoice] Failed to stop Voice after its renderer disconnected', error)
            })
        }
        return { success: true as const }
    }

    getHangDiagnosticContext() {
        const snapshot = this.state.snapshot
        const selectedSession = snapshot.sessions.find((session) => session.id === snapshot.selectedSessionId) || null
        const activeThread = selectedSession?.threads.find((thread) => thread.id === selectedSession.activeThreadId) || null
        return {
            selectedSessionId: selectedSession?.id || null,
            activeThreadId: activeThread?.id || null,
            threadState: activeThread?.state || null,
            latestTurnState: activeThread?.latestTurn?.state || null,
            messageCount: activeThread?.messages.length || 0,
            activityCount: activeThread?.activities.length || 0,
            clientSurfaces: [...new Set((activeThread?.canonicalPresence?.clients || []).map((client) => client.surface))].sort()
        }
    }

    async getSnapshot() {
        await this.ensureReady()
        return toAssistantShellSnapshot(this.state.snapshot)
    }

    async getBootstrap() {
        await this.ensureReady()
        const status = await this.getStatus()
        return {
            snapshot: toAssistantShellSnapshot(this.state.snapshot),
            status
        }
    }

    async getStatus(): Promise<AssistantRuntimeStatus> {
        return getAssistantRuntimeStatusAction(this.actionDeps)
    }

    async listModels(forceRefresh = false) {
        await this.ensureReady()
        const knownModels = this.state.snapshot.knownModels
        if (!forceRefresh && knownModels.length > 0) {
            return { success: true as const, models: structuredClone(knownModels) }
        }
        const { models, authoritative } = await this.runtime.listModelsWithProvenance(forceRefresh)
        if (authoritative && !areAssistantModelListsEqual(this.state.snapshot.knownModels, models)) {
            this.state.snapshot.knownModels = models
            this.persistence.updateMetadata(this.state.snapshot)
        }
        return { success: true as const, models }
    }

    /** Utility generation never attaches or creates a canonical Inbox chat. */
    async generateUtilityText(
        prompt: string,
        options: {
            cwd?: string
            model?: string
            effort?: import('../../shared/assistant/contracts').AssistantReasoningEffort
            timeoutMs?: number
        } = {}
    ) {
        return this.runtime.generateText(prompt, {
            cwd: String(options.cwd || process.cwd()),
            model: options.model,
            effort: options.effort,
            timeoutMs: options.timeoutMs
        })
    }

    async testChatGptUtilityConnection(model?: string) {
        return this.runtime.testChatGptUtilityConnection(model)
    }

    async getFleetSnapshot(threadId: string) {
        await this.ensureReady()
        const thread = requireThread(this.state.snapshot, threadId)
        const localThreadId = thread.id
        const persisted = this.fleetProjection.get(localThreadId)
            || this.state.snapshot.fleetByThreadId[localThreadId]
            || await this.persistence.readFleet(localThreadId)
        let refreshed: FleetSnapshot | null = null
        if (thread.providerThreadId) {
            const record = findThreadRecord(this.state.snapshot, localThreadId)
            try {
                await this.runtime.connect(thread, record?.session.projectPath || thread.cwd || process.cwd())
                const result = await this.runtime.requestFleetOperation(localThreadId, 'agents', 'list', {})
                refreshed = (result['snapshot'] || result['fleet']) as FleetSnapshot | null
            } catch (error) {
                log.warn('[Assistant] Failed to refresh the canonical fleet snapshot', { threadId: localThreadId, error })
            }
        }
        const live = refreshed || this.runtime.getFleetSnapshot(localThreadId)
        const snapshot = live && shouldApplyAssistantFleetSnapshot(persisted, live)
            ? live
            : persisted
        if (snapshot) {
            this.fleetProjection.apply(localThreadId, snapshot)
            this.state.snapshot.fleetByThreadId[localThreadId] = snapshot
            this.persistence.projectFleet(localThreadId, snapshot)
        }
        return { success: true as const, snapshot: snapshot || null }
    }

    async runFleetOperation(namespace: 'agents' | 'workflows', input: FleetOperationInput) {
        await this.ensureReady()
        const thread = requireThread(this.state.snapshot, input.threadId)
        const localThreadId = thread.id
        const record = findThreadRecord(this.state.snapshot, localThreadId)
        await this.runtime.connect(thread, record?.session.projectPath || thread.cwd || process.cwd())
        const result = await this.runtime.requestFleetOperation(localThreadId, namespace, input.action, input.payload || {})
        const snapshot = (result['snapshot'] || result['fleet']) as FleetSnapshot | undefined
        if (snapshot) {
            this.fleetProjection.apply(localThreadId, snapshot)
            this.persistence.projectFleet(localThreadId, snapshot)
        }
        return { success: true as const, result }
    }

    async getAccountOverview(forceRefresh = false) {
        await this.ensureReady()
        return {
            success: true as const,
            overview: await this.accountService.getOverview(forceRefresh)
        }
    }

    async redeemAccountReset(input: AssistantRedeemAccountResetInput) {
        await this.ensureReady()
        return {
            success: true as const,
            ...await this.accountService.redeemAccountReset(input)
        }
    }

    async getSessionTurnUsage(input?: AssistantGetSessionTurnUsageInput) {
        const result = await getAssistantSessionTurnUsageAction(
            this.actionDeps,
            (sessionId) => this.persistence.readSessionTurnUsage(sessionId),
            input
        )
        const session = requireSession(this.state.snapshot, result.usage.sessionId)
        const thread = getActiveThread(session)
        result.usage.totals = thread ? this.runtime.getSessionUsage(thread.id) : null
        return result
    }

    async connect(options?: AssistantConnectOptions) {
        const voicePreparation = options?.voicePreparation || null
        const preparationGeneration = voicePreparation
            ? ++this.voicePrimaryPreparationGeneration
            : null
        const result = await connectAssistantSession(this.actionDeps, options)
        if (preparationGeneration !== null
            && preparationGeneration === this.voicePrimaryPreparationGeneration
            && !this.activeCanonicalVoice
            && !this.pendingCanonicalVoiceStart
            && this.realtimeVoiceOwnerId === null) {
            const session = options?.sessionId
                ? requireSession(this.state.snapshot, options.sessionId)
                : getSelectedSession(this.state.snapshot)
            const thread = getActiveThread(session)
            if (session && thread) {
                this.prepareVoicePrimaryWorker(
                    thread.id,
                    this.getSessionRuntimeCwd(session, thread),
                    requireCanonicalVoiceExecutionConfiguration(voicePreparation)
                )
            }
        }
        return result
    }

    async disconnect(sessionId?: string) {
        await this.stopCanonicalVoiceForNavigation()
        return disconnectAssistantSession(this.actionDeps, sessionId)
    }

    async createSession(input?: AssistantCreateSessionInput) {
        await this.stopCanonicalVoiceForNavigation()
        try {
            const result = await createAssistantSessionAction(this.actionDeps, input)
            this.captureAnalytics({ event: 'zyra_v1_chat', properties: { action: 'create', outcome: 'completed' } })
            return result
        } catch (error) {
            this.captureAnalytics({ event: 'zyra_v1_chat', properties: { action: 'create', outcome: 'failed', error_code: classifyAnalyticsError(error) } })
            throw error
        }
    }

    async selectSession(sessionId: string) {
        await this.ensureReady()
        const generation = ++this.navigationSelectionGeneration
        if (this.activeCanonicalVoice?.sessionId !== sessionId) await this.stopCanonicalVoiceForNavigation()
        if (generation !== this.navigationSelectionGeneration) return { success: true as const, sessionId }
        const result = await selectAssistantSessionAction(this.actionDeps, sessionId)
        if (generation !== this.navigationSelectionGeneration) return result
        const snapshot = toAssistantShellSnapshot(this.state.snapshot)
        this.scheduleSelectedCanonicalSessionSynchronization(sessionId, generation)
        return { ...result, snapshot }
    }

    async selectThread(sessionId: string, threadId: string) {
        await this.ensureReady()
        const generation = ++this.navigationSelectionGeneration
        if (this.activeCanonicalVoice?.localThreadId !== threadId) await this.stopCanonicalVoiceForNavigation()
        if (generation !== this.navigationSelectionGeneration) return { success: true as const, sessionId, threadId }
        const result = await selectAssistantThreadAction(this.actionDeps, sessionId, threadId)
        if (generation !== this.navigationSelectionGeneration) return result
        const snapshot = toAssistantShellSnapshot(this.state.snapshot)
        this.scheduleSelectedCanonicalSessionSynchronization(sessionId, generation)
        return { ...result, snapshot }
    }

    async getThreadDetailBootstrap(threadId: string) {
        await this.ensureReady()
        const record = findThreadRecord(this.state.snapshot, threadId)
        if (!record) throw new Error(`Assistant thread not found: ${threadId}`)
        await this.ensureCanonicalHistoryLoaded(record.session, record.thread)
        const refreshedRecord = findThreadRecord(this.state.snapshot, threadId) || record
        const detail = await this.persistence.readThreadDetail(refreshedRecord.thread.id)
        return { success: true as const, detail }
    }

    async getHistoryPage(input: AssistantGetHistoryPageInput) {
        await this.ensureReady()
        const record = findThreadRecord(this.state.snapshot, input.threadId)
        if (!record) throw new Error(`Assistant thread not found: ${input.threadId}`)
        await this.ensureCanonicalHistoryLoaded(record.session, record.thread)
        if (input.before && record.thread.providerThreadId) {
            await this.loadOlderCanonicalHistory(record.thread.providerThreadId)
        }
        return {
            success: true as const,
            page: await this.persistence.readHistoryPage({ ...input, threadId: record.thread.id })
        }
    }

    async hydrateHistoryBody(input: AssistantHydrateHistoryBodyInput) {
        await this.ensureReady()
        const activityId = String(input?.activityId || '').trim()
        const ref = parseAssistantHistoryBodyRef(input?.ref)
        if (!activityId || !ref) throw new Error('Historical tool output reference is invalid.')
        const { canonicalChatId, entryId, entryIndex, entrySha256 } = ref
        const owner = findThreadRecord(this.state.snapshot, canonicalChatId)
        if (!owner) throw new Error('Historical tool output does not belong to a known Assistant thread.')
        const storedActivity = await this.persistence.readActivity(owner.thread.id, activityId)
        const storedRef = parseAssistantHistoryBodyRef(storedActivity?.payload?.['historyBodyRef'])
        if (!storedActivity || !storedRef || !historyBodyRefsMatch(ref, storedRef)) {
            throw new Error('Historical tool output does not match the stored activity.')
        }
        const cacheKey = `${canonicalChatId}:${entryIndex}:${entrySha256}`
        const cached = this.canonicalHistoryBodyCache.get(cacheKey)
        if (cached) {
            this.canonicalHistoryBodyCache.delete(cacheKey)
            this.canonicalHistoryBodyCache.set(cacheKey, cached)
            return { success: true as const, body: cached.body }
        }
        const result = await this.runtime.readCanonicalHistoryEntryBody(canonicalChatId, undefined, storedRef as unknown as Record<string, unknown>)
        const entry = asCanonicalRecord(result?.['entry'])
        const message = entry?.['type'] === 'message' ? asCanonicalRecord(entry['message']) : null
        if (!message || message['role'] !== 'toolResult' || String(entry?.['id'] || '') !== entryId) {
            throw new Error('Historical tool output no longer matches its canonical entry.')
        }
        const toolCallId = String(message['toolCallId'] || message['tool_call_id'] || '').trim()
        if (storedRef.toolCallId && toolCallId !== storedRef.toolCallId) throw new Error('Historical tool output no longer matches its tool call.')
        if (toolCallId && activityId !== `zyra-tool-${toolCallId}`) throw new Error('Historical tool output does not belong to this activity.')
        const content = canonicalContentParts(message['content'])
        const messageId = String(message['id'] || entryId)
        const toolName = String(message['toolName'] || storedActivity.payload?.['toolName'] || 'tool')
        const args = asCanonicalRecord(storedActivity.payload?.['args'])
        const projected = projectCanonicalToolResult({
            canonicalChatId,
            messageId,
            message,
            content,
            toolName,
            args,
            cwd: owner.thread.cwd || owner.session.projectPath || process.cwd(),
            stripBodyFields: true
        })
        const body: AssistantHistoryBody = {
            payload: {
                ...projected.data,
                status: projected.isError ? 'failed' : 'completed',
                output: projected.output,
                imageAttachments: projected.imageAttachments
            }
        }
        const declaredBodyBytes = Math.max(0, Number(storedRef.bodyBytes) || 0)
        const bodyBytes = declaredBodyBytes > MAX_SINGLE_CACHED_HISTORY_BODY_BYTES
            ? declaredBodyBytes
            : Buffer.byteLength(JSON.stringify(body), 'utf8')
        if (bodyBytes <= MAX_SINGLE_CACHED_HISTORY_BODY_BYTES) {
            const replaced = this.canonicalHistoryBodyCache.get(cacheKey)
            if (replaced) this.canonicalHistoryBodyCacheBytes -= replaced.bytes
            this.canonicalHistoryBodyCache.set(cacheKey, { body, bytes: bodyBytes })
            this.canonicalHistoryBodyCacheBytes += bodyBytes
            while (this.canonicalHistoryBodyCache.size > MAX_CACHED_HISTORY_BODIES || this.canonicalHistoryBodyCacheBytes > MAX_CACHED_HISTORY_BODY_BYTES) {
                const oldest = this.canonicalHistoryBodyCache.keys().next().value
                if (typeof oldest !== 'string') break
                const evicted = this.canonicalHistoryBodyCache.get(oldest)
                this.canonicalHistoryBodyCache.delete(oldest)
                this.canonicalHistoryBodyCacheBytes -= evicted?.bytes || 0
            }
        }
        return { success: true as const, body }
    }

    async getReviewIndex(threadId: string) {
        await this.ensureReady()
        const record = findThreadRecord(this.state.snapshot, threadId)
        if (!record) throw new Error(`Assistant thread not found: ${threadId}`)
        // Review is a persisted read model. Opening the panel must never turn into an
        // unbounded canonical-history import on the main/UI critical path.
        return { success: true as const, index: await this.persistence.readReviewIndex(record.thread.id) }
    }

    async searchTurns(threadId: string, query: string, limit?: number) {
        await this.ensureReady()
        const record = findThreadRecord(this.state.snapshot, threadId)
        if (!record) throw new Error(`Assistant thread not found: ${threadId}`)
        const canonicalChatId = record.thread.providerThreadId
        const persisted = await this.persistence.searchTurns(record.thread.id, query, limit)
        if (!canonicalChatId || !String(query || '').trim()) return { success: true as const, result: persisted }
        try {
            const matches = await this.runtime.searchCanonicalToolOutputs(
                canonicalChatId,
                record.session.projectPath || record.thread.cwd || undefined,
                query,
                limit
            )
            const activityIds = matches
                .map((match) => String(match['toolCallId'] || '').trim())
                .filter(Boolean)
                .map((toolCallId) => `zyra-tool-${toolCallId}`)
            return {
                success: true as const,
                result: await this.persistence.mergeSearchTurnIds(record.thread.id, persisted.turnIds, activityIds, limit)
            }
        } catch (error) {
            log.warn('[Assistant] Failed to search deferred canonical tool output', { canonicalChatId, error })
            return { success: true as const, result: persisted }
        }
    }

    async getTurnDetail(threadId: string, turnId: string) {
        await this.ensureReady()
        const record = findThreadRecord(this.state.snapshot, threadId)
        if (!record) throw new Error(`Assistant thread not found: ${threadId}`)
        const detail = await this.persistence.readTurnDetail(record.thread.id, turnId)
        const hydratedFileChanges = await this.hydrateDeferredFileChanges(detail.activities)
        if (hydratedFileChanges.length > 0) {
            await this.persistence.projectCanonicalReviewTimeline({
                threadId: record.thread.id,
                messages: [],
                activities: hydratedFileChanges
            })
            const byId = new Map(hydratedFileChanges.map((activity) => [activity.id, activity]))
            detail.activities = detail.activities.map((activity) => byId.get(activity.id) || activity)
        }
        return { success: true as const, detail }
    }

    async renameSession(sessionId: string, title: string) {
        return renameAssistantSessionAction(this.actionDeps, sessionId, title)
    }

    async regenerateSessionTitle(sessionId: string) {
        await this.ensureReady()
        const session = requireSession(this.state.snapshot, sessionId)
        const thread = session.threads.find((entry) => entry.source === 'root' && !entry.parentThreadId)
            || getActiveThread(session)
        if (!thread) throw new Error('Assistant thread not found.')
        if (['starting', 'running', 'waiting'].includes(thread.state) || thread.latestTurn?.state === 'running') {
            throw new Error('Wait for the current turn to finish before refreshing the title.')
        }
        const review = await this.persistence.readReviewIndex(thread.id)
        const completedTurns = review.turns.filter((turn) => turn.state === 'completed' && turn.prompt && turn.response)
        if (completedTurns.length === 0) throw new Error('Complete a conversation turn before refreshing the title.')
        const preferredModel = await this.options.getTitleGenerationModel?.().catch(() => null) || null
        const title = await generateReplacementSessionTitle({
            sessionId: session.id,
            threadId: thread.id,
            turns: completedTurns,
            seedTitle: session.title,
            cwd: this.getSessionRuntimeCwd(session, thread),
            preferredModel,
            generateText: (prompt, options) => this.runtime.generateText(prompt, options),
            getSnapshot: () => this.state.snapshot,
            appendEvent: (type, occurredAt, payload, eventSessionId, eventThreadId) => {
                this.appendEvent(type, occurredAt, payload, eventSessionId, eventThreadId)
            },
            onApplied: async (nextTitle) => {
                await Promise.allSettled(session.threads
                    .map((entry) => entry.providerThreadId)
                    .filter((providerThreadId): providerThreadId is string => Boolean(providerThreadId))
                    .map((providerThreadId) => this.runtime.updateCanonicalChat(providerThreadId, { title: nextTitle })))
            }
        })
        return { success: true as const, title: title || session.title }
    }

    async archiveSession(sessionId: string, archived = true) {
        if (archived && this.activeCanonicalVoice?.sessionId === sessionId) await this.stopCanonicalVoiceForNavigation()
        return archiveAssistantSessionAction(this.actionDeps, sessionId, archived)
    }

    async deleteSession(sessionId: string) {
        await this.ensureReady()
        if (this.activeCanonicalVoice?.sessionId === sessionId) await this.stopCanonicalVoiceForNavigation()
        const threadIds = this.state.snapshot.sessions.find((session) => session.id === sessionId)?.threads.map((thread) => thread.id) || []
        const result = await deleteAssistantSessionAction(this.actionDeps, sessionId)
        for (const threadId of threadIds) {
            this.fleetProjection.remove(threadId)
            delete this.state.snapshot.fleetByThreadId[threadId]
            this.persistence.deleteFleet(threadId)
        }
        return result
    }

    async clearLogs(input?: AssistantClearLogsInput) {
        return clearAssistantLogsAction(this.actionDeps, input)
    }

    async deleteMessage(input: AssistantDeleteMessageInput) {
        await this.ensureReady()
        const sessionId = input.sessionId || this.state.snapshot.selectedSessionId
        if (!sessionId) throw new Error('Assistant session not found.')
        if (this.activeCanonicalVoice?.sessionId === sessionId) await this.stopCanonicalVoiceForNavigation()
        // Deletion planning must see persisted history even when the renderer has only a page loaded.
        this.state.snapshot = await this.persistence.hydrateSelectedSession(this.state.snapshot, sessionId)
        return deleteAssistantMessageAction(this.actionDeps, input)
    }

    async setSessionProjectPath(sessionId: string, projectPath: string | null) {
        const session = this.state.snapshot.sessions.find((entry) => entry.id === sessionId) || null
        const pendingVoiceBelongsToSession = Boolean(
            this.pendingCanonicalVoiceStart
            && session?.threads.some((thread) => thread.id === this.pendingCanonicalVoiceStart?.conversationId)
        )
        if (this.activeCanonicalVoice?.sessionId === sessionId || pendingVoiceBelongsToSession) {
            await this.stopCanonicalVoiceForNavigation()
        } else {
            this.invalidateVoicePrimaryWorkerPreparation()
        }
        try {
            const result = await setAssistantSessionProjectPathAction(this.actionDeps, sessionId, projectPath)
            if (projectPath) {
                void inspectProjectAnalyticsCapabilities(projectPath).then((capabilities) => {
                    this.captureAnalytics({ event: 'zyra_v1_project', properties: { action: 'attach', outcome: 'completed', ...capabilities } })
                }).catch(() => {
                    this.captureAnalytics({ event: 'zyra_v1_project', properties: { action: 'attach', outcome: 'completed' } })
                })
            }
            return result
        } catch (error) {
            if (projectPath) this.captureAnalytics({ event: 'zyra_v1_project', properties: { action: 'attach', outcome: 'failed', error_code: classifyAnalyticsError(error) } })
            throw error
        }
    }

    async setPlaygroundRoot(input: { rootPath: string | null }) {
        return setPlaygroundRootAction(this.actionDeps, input)
    }

    async createPlaygroundLab(input: AssistantCreatePlaygroundLabInput) {
        return createPlaygroundLabAction(this.actionDeps, input)
    }

    async deletePlaygroundLab(input: AssistantDeletePlaygroundLabInput) {
        return deletePlaygroundLabAction(this.actionDeps, input)
    }

    async attachSessionToPlaygroundLab(input: AssistantAttachSessionToPlaygroundLabInput) {
        return attachSessionToPlaygroundLabAction(this.actionDeps, input)
    }

    async newThread(sessionId?: string) {
        await this.stopCanonicalVoiceForNavigation()
        return createAssistantThreadAction(this.actionDeps, sessionId)
    }

    async sendPrompt(prompt: string, options?: AssistantSendPromptOptions) {
        await this.ensureReady()
        const session = options?.sessionId
            ? requireSession(this.state.snapshot, options.sessionId)
            : getSelectedSession(this.state.snapshot)
        const thread = getActiveThread(session)
        if (thread && this.isVoiceForeground(thread) && !this.activeCanonicalVoice) {
            await this.recoverInactiveCanonicalVoice(thread)
        }
        if (thread && (this.voiceTransitioningThreadIds.has(thread.id)
            || (thread.providerThreadId && this.voiceTransitioningThreadIds.has(thread.providerThreadId))
            || this.isVoiceForeground(thread))) {
            throw new Error('Voice is responding in this conversation. Stop Voice before sending work to the strong assistant.')
        }
        this.captureAnalytics({
            event: 'zyra_v1_chat',
            properties: {
                action: 'send',
                outcome: 'started',
                model_family: classifyAnalyticsModelFamily(thread?.model),
                effort: normalizeAnalyticsEffort(thread?.thinking),
                runtime_mode: thread?.runtimeMode === 'full-access'
                    ? 'full_access'
                    : thread?.runtimeMode === 'auto-review'
                        ? 'auto_review'
                        : thread?.runtimeMode === 'edits-only'
                            ? 'edits_only'
                            : 'approval_required',
                attachment_count: Array.isArray(options?.images) ? options.images.length : 0
            }
        })
        try {
            return await sendAssistantPromptAction(this.actionDeps, prompt, options)
        } catch (error) {
            this.captureAnalytics({ event: 'zyra_v1_chat', properties: { action: 'fail', outcome: 'failed', error_code: classifyAnalyticsError(error) } })
            throw error
        }
    }

    async interruptTurn(turnId?: string, sessionId?: string) {
        try {
            const result = await interruptAssistantTurnAction(this.actionDeps, turnId, sessionId)
            this.captureAnalytics({ event: 'zyra_v1_chat', properties: { action: 'cancel', outcome: 'started' } })
            return result
        } catch (error) {
            this.captureAnalytics({ event: 'zyra_v1_chat', properties: { action: 'cancel', outcome: 'failed', error_code: classifyAnalyticsError(error) } })
            throw error
        }
    }

    async respondApproval(input: { requestId: string; decision: 'acceptOnce' | 'acceptForSession' | 'decline' }) {
        return respondAssistantApprovalAction(this.actionDeps, input)
    }

    async respondUserInput(input: { requestId: string; answers: Record<string, string | string[]> }) {
        return respondAssistantUserInputAction(this.actionDeps, input)
    }

    async startRealtimeVoice(input: AssistantStartRealtimeVoiceInput, senderId: number) {
        if (!Number.isSafeInteger(senderId)) throw new Error('Voice owner identity is invalid.')
        if (this.realtimeVoiceOwnerId !== null && this.realtimeVoiceOwnerId !== senderId) {
            this.captureAnalytics({ event: 'zyra_v1_voice', properties: { action: 'duplicate_prevented', outcome: 'prevented', error_code: 'already_active' } })
            throw new Error('Voice is already active in another Zyra window.')
        }
        const transitionKey = input.conversationId || null
        const duplicateStart = Boolean(
            this.pendingCanonicalVoiceStart
            || this.activeCanonicalVoice
            || this.realtimeVoiceRuntime.currentSessionIdentity()
            || (transitionKey && this.voiceTransitioningThreadIds.has(transitionKey))
        )
        if (duplicateStart) {
            this.captureAnalytics({ event: 'zyra_v1_voice', properties: { action: 'duplicate_prevented', outcome: 'prevented', error_code: 'already_active' } })
            throw new Error('Voice is already active or changing mode for a conversation.')
        }
        this.voiceStartedAt = Date.now()
        this.voiceFirstResponseCaptured = false
        this.voiceFailureCaptured = false
        this.captureAnalytics({
            event: 'zyra_v1_voice',
            properties: { action: 'start', outcome: 'started', mode: input.conversationId ? 'conversation' : 'voice_lab' }
        })
        if (input.conversationId && transitionKey) {
            const pending = createPendingCanonicalVoiceStart(senderId, transitionKey)
            this.pendingCanonicalVoiceStart = pending
            this.realtimeVoiceOwnerId = senderId
            this.voiceTransitioningThreadIds.add(transitionKey)
            try {
                return await this.startCanonicalRealtimeVoice(input, senderId, pending.abortController.signal)
            } catch (error) {
                if (!this.voiceFailureCaptured) {
                    this.voiceFailureCaptured = true
                    this.captureAnalytics({ event: 'zyra_v1_voice', properties: { action: 'fail', outcome: 'failed', mode: 'conversation', error_code: classifyAnalyticsError(error) } })
                }
                throw error
            } finally {
                this.voiceTransitioningThreadIds.delete(transitionKey)
                if (this.pendingCanonicalVoiceStart === pending) this.pendingCanonicalVoiceStart = null
                if (!this.activeCanonicalVoice && this.realtimeVoiceOwnerId === senderId) this.realtimeVoiceOwnerId = null
                pending.resolveFinished()
            }
        }

        // Compatibility path for the existing isolated Voice Lab route.
        this.realtimeVoiceOwnerId = senderId
        try {
            await mkdir(REALTIME_VOICE_LAB_CWD, { recursive: true })
            const result = await this.realtimeVoiceRuntime.start({
                cwd: REALTIME_VOICE_LAB_CWD,
                sdp: input.sdp,
                instructions: input.instructions,
                voice: input.voice,
                outputModality: input.outputModality
            })
            return { success: true as const, ...result }
        } catch (error) {
            if (this.realtimeVoiceOwnerId === senderId) this.realtimeVoiceOwnerId = null
            if (!this.voiceFailureCaptured) {
                this.voiceFailureCaptured = true
                this.captureAnalytics({ event: 'zyra_v1_voice', properties: { action: 'fail', outcome: 'failed', mode: 'voice_lab', error_code: classifyAnalyticsError(error) } })
            }
            throw error
        }
    }

    async sendRealtimeVoiceMessage(input: AssistantSendRealtimeVoiceMessageInput, senderId: number) {
        if (!Number.isSafeInteger(senderId)) throw new Error('Voice owner identity is invalid.')
        if (this.realtimeVoiceOwnerId !== senderId) {
            throw new Error('Only the Zyra window running Voice can send to this session.')
        }
        const message = normalizeInstructorRealtimeMessage(input)
        if (message.images.length > 0) {
            throw new Error('Typed Voice images are not supported yet. Stop Voice and send the image in Chat so Zyra can inspect it truthfully.')
        }
        const text = message.text
        if (!text) throw new Error('Type a message for the active Voice conversation.')
        const active = this.activeCanonicalVoice
        const clientMessageId = active
            ? normalizeClientVoiceMessageId(input.clientMessageId)
            : normalizeClientVoiceMessageId(input.clientMessageId || `voice-typed-${randomUUID()}`)
        const turnId = `voice_typed_response_${createHash('sha256').update(clientMessageId).digest('hex').slice(0, 32)}`

        if (!active) {
            const isolatedSession = this.realtimeVoiceRuntime.currentSessionIdentity()
            if (!isolatedSession) throw new Error('Start Voice before sending a typed message.')
            this.queueTypedVoiceResponse({
                text,
                turnId,
                active: null,
                expectedAdapterSessionId: isolatedSession.adapterSessionId
            })
            return { success: true as const, mode: 'text-turn' as const }
        }

        const routes = this.requireForegroundRoutes()
        const gateway = this.requireConversationGateway()
        const route = routes.activeRoute(active.conversationId)
        if (route.surface_mode !== 'voice') throw new Error('Voice no longer owns this conversation.')
        const occurredAt = normalizeClientVoiceMessageCreatedAt(input.clientMessageCreatedAt, route.created_at)
        const messageIdentity = createHash('sha256')
            .update(`${active.conversationId}:${clientMessageId}`)
            .digest('hex')
            .slice(0, 40)
        const messageId = `voice_user_${messageIdentity}`
        await gateway.commitMessage({
            conversationId: active.conversationId,
            messageId,
            role: 'user',
            producer: 'user',
            modality: 'text',
            text,
            attachmentIds: [],
            providerItemId: `typed:${clientMessageId}`,
            providerCompletedAt: occurredAt,
            routeClaim: foregroundRouteClaim(route),
            idempotencyKey: `voice-typed:${active.conversationId}:${clientMessageId}`
        })
        if (shouldDelegateVoiceInspection(text)) {
            void this.realtimeVoiceRuntime.appendContext([{ role: 'user', text }]).catch((error) => {
                log.warn('[AssistantVoice] Typed primary task context append failed', error)
            })
            void this.requireCanonicalRealtimeAdapter().deliverComposerResponse(
                active.adapterSessionId,
                { turnId, text: 'I\u2019m handing that to the primary agent.' }
            ).catch((error) => {
                log.warn('[AssistantVoice] Typed primary task acknowledgement failed', error)
            })
            this.routeVoiceStrongRequest({
                adapterSessionId: active.adapterSessionId,
                conversationId: active.conversationId,
                providerItemId: `typed:${clientMessageId}`,
                text
            })
            return { success: true as const, mode: 'strong-task' as const }
        }
        this.queueTypedVoiceResponse({
            text,
            turnId,
            active,
            expectedAdapterSessionId: active.adapterSessionId,
            canonicalMessageId: messageId,
            routeClaim: foregroundRouteClaim(route),
            assistantMessageId: `voice_assistant_${messageIdentity}`,
            assistantProviderItemId: `typed-response:${clientMessageId}`
        })
        return { success: true as const, mode: 'text-turn' as const }
    }

    private queueTypedVoiceResponse(input: TypedVoiceResponseRequest): void {
        const key = input.expectedAdapterSessionId
        const previous = this.typedVoiceResponseQueues.get(key) || Promise.resolve()
        const next = previous
            .catch(() => undefined)
            .then(async () => {
                const currentAdapterSessionId = this.activeCanonicalVoice?.adapterSessionId
                    || this.realtimeVoiceRuntime.currentSessionIdentity()?.adapterSessionId
                if (currentAdapterSessionId !== key) return
                try {
                    await this.realtimeVoiceRuntime.appendContext([{ role: 'user', text: input.text }])
                } catch {
                    const error = 'ChatGPT Voice could not accept the typed message context.'
                    if (input.active) {
                        await this.requireCanonicalRealtimeAdapter().deliverComposerResponse(
                            key,
                            { turnId: input.turnId, error }
                        )
                    } else {
                        this.realtimeVoiceRuntime.presentComposerResponse({ turnId: input.turnId, error })
                    }
                    return
                }
                await this.generateTypedVoiceResponse(input)
            })
        this.typedVoiceResponseQueues.set(key, next)
        void next
            .catch((error) => log.warn('[AssistantVoice] Typed Voice response failed', error))
            .finally(() => {
                if (this.typedVoiceResponseQueues.get(key) === next) this.typedVoiceResponseQueues.delete(key)
            })
    }

    private async generateTypedVoiceResponse(input: TypedVoiceResponseRequest): Promise<void> {
        const record = input.active ? findThreadRecord(this.state.snapshot, input.active.localThreadId) : null
        let contextItems: Array<{ role: 'developer' | 'user' | 'assistant'; text: string }> = []
        if (input.active) {
            try {
                const route = this.requireForegroundRoutes().activeRoute(input.active.conversationId)
                const seed = await this.requireRealtimeContinuity().materialize(
                    input.active.conversationId,
                    foregroundRouteClaim(route)
                )
                const messageIndex = input.canonicalMessageId
                    ? seed.items.findIndex((item) => item.canonicalMessageId === input.canonicalMessageId)
                    : -1
                const boundedItems = messageIndex >= 0 ? seed.items.slice(0, messageIndex + 1) : seed.items
                contextItems = boundedItems.map(({ role, text }) => ({ role, text }))
            } catch (error) {
                log.warn('[AssistantVoice] Typed Voice context refresh failed; using the current message only', error)
            }
        }
        const result = await this.runtime.generateText(buildTypedVoiceUtilityPrompt(input.text, contextItems), {
            cwd: record && input.active
                ? this.getSessionRuntimeCwd(record.session, record.thread)
                : REALTIME_VOICE_LAB_CWD,
            model: input.active?.executionConfiguration.model,
            effort: input.active?.executionConfiguration.effort || 'low',
            timeoutMs: 45_000
        })
        const currentAdapterSessionId = this.activeCanonicalVoice?.adapterSessionId
            || this.realtimeVoiceRuntime.currentSessionIdentity()?.adapterSessionId
        if (currentAdapterSessionId !== input.expectedAdapterSessionId) return

        const text = String(result.text || '').trim()
        const error = result.success && text
            ? ''
            : String(result.error || 'Zyra could not generate the typed Voice response.').trim().slice(0, 1_000)
        if (input.active) {
            const committer = this.requireCanonicalTypedVoiceCommitter()
            if (text) {
                if (!input.routeClaim || !input.assistantMessageId || !input.assistantProviderItemId) {
                    throw new Error('Typed Voice response ownership is incomplete.')
                }
                const receipt = await committer.commit({
                    adapterSessionId: input.expectedAdapterSessionId,
                    conversationId: input.active.conversationId,
                    routeClaim: input.routeClaim,
                    messageId: input.assistantMessageId,
                    providerItemId: input.assistantProviderItemId,
                    text,
                    completedAt: new Date().toISOString()
                })
                if (!receipt) return
            }
            if (!committer.isAccepting(input.expectedAdapterSessionId)) return
            await this.requireCanonicalRealtimeAdapter().deliverComposerResponse(
                input.expectedAdapterSessionId,
                {
                    turnId: input.turnId,
                    text,
                    ...(text && input.assistantMessageId ? { canonicalMessageId: input.assistantMessageId } : {}),
                    ...(error ? { error } : {})
                }
            )
            return
        }
        this.realtimeVoiceRuntime.presentComposerResponse({
            turnId: input.turnId,
            text,
            ...(error ? { error } : {})
        })
        if (text) await this.realtimeVoiceRuntime.requestSpeech(text)
    }

    async ingestRealtimeVoiceEvent(input: AssistantIngestRealtimeVoiceEventInput, senderId: number) {
        if (!Number.isSafeInteger(senderId)) throw new Error('Voice owner identity is invalid.')
        if (this.realtimeVoiceOwnerId !== senderId || !this.activeCanonicalVoice) {
            throw new Error('This Zyra window does not own the canonical Voice session.')
        }
        if (input.adapterSessionId !== this.activeCanonicalVoice.adapterSessionId) {
            throw new Error('The realtime event belongs to a stale Voice session.')
        }
        if (Buffer.byteLength(JSON.stringify(input.payload), 'utf8') > MAX_REALTIME_BRIDGE_EVENT_BYTES) {
            throw new Error('The realtime event exceeds the canonical bridge limit.')
        }
        const realtimeEventType = input.payload && typeof input.payload === 'object'
            ? String((input.payload as { type?: unknown }).type || '')
            : ''
        if (realtimeEventType === 'conversation.item.truncated' || realtimeEventType === 'response.cancelled') {
            this.captureAnalytics({ event: 'zyra_v1_voice', properties: { action: 'interrupt', outcome: 'completed' } })
        }
        this.requireCanonicalRealtimeAdapter().ingestWebRtcEvent(input.adapterSessionId, input.payload)
        return { success: true as const }
    }

    async stopRealtimeVoice(senderId: number) {
        if (!Number.isSafeInteger(senderId)) throw new Error('Voice owner identity is invalid.')
        if (this.realtimeVoiceOwnerId !== null && this.realtimeVoiceOwnerId !== senderId) {
            throw new Error('Only the Zyra window that started Voice can stop it.')
        }
        const hasVoiceState = Boolean(
            this.realtimeVoiceOwnerId !== null
            || this.pendingCanonicalVoiceStart
            || this.activeCanonicalVoice
            || this.realtimeVoiceRuntime.currentSessionIdentity()
        )
        if (!hasVoiceState) return { success: true as const }
        await this.cancelPendingCanonicalVoiceStart()
        this.captureAnalytics({ event: 'zyra_v1_voice', properties: { action: 'stop', outcome: 'started' } })
        if (this.activeCanonicalVoice) {
            await this.stopCanonicalVoiceInternal('user_exit')
            this.captureAnalytics({ event: 'zyra_v1_voice', properties: { action: 'stop', outcome: 'completed' } })
            return { success: true as const }
        }
        try {
            await this.realtimeVoiceRuntime.stop()
            this.captureAnalytics({ event: 'zyra_v1_voice', properties: { action: 'stop', outcome: 'completed' } })
            return { success: true as const }
        } finally {
            if (this.realtimeVoiceOwnerId === senderId) this.realtimeVoiceOwnerId = null
        }
    }

    async approvePendingPlaygroundLabRequest(input: AssistantApprovePendingPlaygroundLabRequestInput) {
        return approvePendingPlaygroundLabRequestAction(this.actionDeps, input)
    }

    async declinePendingPlaygroundLabRequest(input: AssistantDeclinePendingPlaygroundLabRequestInput) {
        return declinePendingPlaygroundLabRequestAction(this.actionDeps, input)
    }

    dispose(): Promise<void> {
        if (this.disposePromise) return this.disposePromise
        this.disposeRequested = true
        this.externalEventSubscribers.clear()
        this.externalRealtimeVoiceSubscribers.clear()
        this.assistantTextDeltaBuffer.dispose()
        this.assistantActivityDeltaBuffer.dispose()
        this.voicePrimaryPreparationGeneration += 1
        this.realtimeVoiceOwnerId = null
        this.pendingCanonicalVoiceStart?.abortController.abort(new Error('Assistant Voice disposed.'))
        for (const task of this.activeVoiceStrongTasks.values()) task.abortController.abort(new Error('Assistant Voice disposed.'))
        this.activeVoiceStrongTasks.clear()
        this.queuedVoiceStrongRequests.clear()
        this.delegatedVoiceProviderItems.clear()
        this.typedVoiceResponseQueues.clear()
        this.canonicalHistoryBodyCache.clear()
        this.canonicalHistoryBodyCacheBytes = 0
        this.canonicalHistoryLoadPromises.clear()
        this.canonicalHistoryRefresh.clear()
        this.activeCanonicalVoice = null
        const pending = (async () => {
            await this.readyPromise.catch(() => undefined)
            await this.canonicalVoiceSetupPromise?.catch(() => undefined)
            await this.canonicalTypedVoiceCommitter?.dispose()
            await this.canonicalVoiceCommitter?.flush().catch(() => undefined)
            this.canonicalVoiceCommitter?.dispose()
            this.canonicalVoiceUnsubscribe?.()
            this.canonicalVoiceSessions?.dispose()
            this.canonicalRealtimeAdapter?.dispose()
            this.realtimeVoiceRuntime.dispose()
            this.runtime.dispose()
            await this.persistence.close()
            this.foregroundPersistence?.close()
        })()
        const tracked = pending.catch((error) => {
            if (this.disposePromise === tracked) this.disposePromise = null
            throw error
        })
        this.disposePromise = tracked
        return tracked
    }

    private async initialize() {
        const loaded = await this.persistence.load()
        this.state = {
            snapshot: loaded.snapshot || createDefaultSnapshot(),
            events: loaded.events || []
        }
        this.state.snapshot.fleetByThreadId ||= {}
        await this.importCanonicalChats()
        void this.recoverActiveCanonicalRuntimes().catch((error) => {
            log.warn('[Assistant] Active canonical runtime recovery failed', error)
        })
        await this.initializeCanonicalVoiceController()
        void this.ensureCanonicalVoiceSetup().catch((error) => {
            log.warn('[AssistantVoice] Background capability setup failed', error)
        })
        for (const session of this.state.snapshot.sessions) {
            for (const thread of session.threads) {
                const fleet = await this.persistence.readFleet(thread.id)
                if (!fleet) continue
                this.fleetProjection.apply(thread.id, fleet)
                this.state.snapshot.fleetByThreadId[thread.id] = fleet
            }
        }
    }

    private async recoverActiveCanonicalRuntimes(): Promise<void> {
        const activeCanonicalThreads = this.state.snapshot.sessions.flatMap((session) => (
            session.threads
                .filter((thread) => (
                    Boolean(thread.providerThreadId)
                    && (thread.canonicalPresence?.state === 'running' || thread.canonicalPresence?.state === 'background')
                ))
                .map((thread) => ({ session, thread }))
        ))
        if (activeCanonicalThreads.length === 0) return

        await Promise.allSettled(activeCanonicalThreads.map(async ({ session, thread }) => {
            try {
                await this.runtime.connect(thread, this.getSessionRuntimeCwd(session, thread))
                this.captureAnalytics({ event: 'zyra_v1_chat', properties: { action: 'recover', outcome: 'recovered' } })
            } catch (error) {
                this.captureAnalytics({ event: 'zyra_v1_chat', properties: { action: 'recover', outcome: 'failed', error_code: classifyAnalyticsError(error) } })
                log.warn('[Assistant] Failed to restore an active canonical runtime during startup', {
                    threadId: thread.id,
                    providerThreadId: thread.providerThreadId,
                    error
                })
            }
        }))
    }

    private async initializeCanonicalVoiceController(): Promise<void> {
        const filePath = ForegroundControllerPersistence.defaultPath(app.getPath('userData'))
        const persistence = await ForegroundControllerPersistence.open(filePath)
        const routes = new ForegroundRouteController(persistence)
        const writer = new PiCanonicalMessageWriter(
            this.runtime,
            (operationId) => persistence.canonicalMessageOperation(operationId)?.conversation_id || null,
            (input, receipt) => this.projectCanonicalVoiceMessage(input, receipt)
        )
        const gateway = new ConversationGateway(persistence, writer)
        const typedVoiceCommitter = new CanonicalTypedVoiceResponseCommitter(gateway)
        this.foregroundPersistence = persistence
        this.foregroundRoutes = routes
        this.conversationGateway = gateway
        this.canonicalTypedVoiceCommitter = typedVoiceCommitter
        this.realtimeContinuity = new AssistantRealtimeContinuitySource(
            (conversationId) => this.readCanonicalVoiceContinuity(conversationId)
        )

        for (const session of this.state.snapshot.sessions) {
            for (const thread of session.threads) {
                const conversationId = thread.providerThreadId
                if (!conversationId) continue
                const route = routes.initializeChat({
                    conversationId,
                    contextVersion: this.voiceContextVersion(thread),
                    activationReason: 'migration',
                    attachedTaskIds: this.attachedTaskIds(thread.id)
                })
                if (persistence.pendingCanonicalMessageOperations(route.foreground_route_id).length > 0) {
                    try {
                        await gateway.reconcilePendingOperations(conversationId)
                    } catch (error) {
                        log.error('[AssistantVoice] Canonical restart reconciliation failed', error)
                        continue
                    }
                }
                if (route.surface_mode === 'voice') {
                    routes.recoverToChat({
                        conversationId,
                        expected: routeExpectation(foregroundRouteClaim(route)),
                        contextVersion: Math.max(route.context_version, this.voiceContextVersion(thread)),
                        attachedTaskIds: this.attachedTaskIds(thread.id)
                    })
                }
            }
        }
    }

    private async ensureCanonicalVoiceSetup(): Promise<void> {
        if (this.disposeRequested) throw new Error('Assistant Voice is disposing.')
        if (this.canonicalVoiceSetupPromise) return this.canonicalVoiceSetupPromise
        this.canonicalVoiceSetupPromise = (async () => {
            const probe = await probeDirectChatGptRealtimeCapabilitiesAsync({
                transcriptIdentityBridge: true,
                ownerScopedClientCommands: true
            })
            if (this.disposeRequested) throw new Error('Assistant Voice is disposing.')
            const adapter = new ChatGptRealtimeForegroundAdapter(this.realtimeVoiceRuntime, probe.evidence)
            const sessions = new CanonicalVoiceSessionController(
                this.requireForegroundRoutes(),
                this.requireRealtimeContinuity(),
                adapter
            )
            const committer = new CanonicalVoiceTranscriptCommitter(
                sessions,
                this.requireForegroundRoutes(),
                this.requireConversationGateway()
            )
            committer.onError((error, event) => {
                log.error('[AssistantVoice] Canonical transcript commit failed', error)
                this.broadcastRealtimeVoiceEvent({
                    type: 'session.error',
                    threadId: event.realtimeProviderThreadId,
                    message: `Voice stopped because its transcript could not be saved: ${error.message}`
                })
                void this.stopCanonicalVoiceInternal('canonical_commit_failed').catch(() => undefined)
            })
            this.canonicalVoiceUnsubscribe = sessions.subscribe((event) => this.handleCanonicalVoiceEvent(event))
            this.canonicalRealtimeAdapter = adapter
            this.canonicalVoiceSessions = sessions
            this.canonicalVoiceCommitter = committer
        })().catch((error) => {
            this.canonicalVoiceSetupPromise = null
            throw error
        })
        return this.canonicalVoiceSetupPromise
    }

    private async startCanonicalRealtimeVoice(
        input: AssistantStartRealtimeVoiceInput,
        senderId: number,
        signal: AbortSignal
    ) {
        throwIfVoiceStartAborted(signal)
        await this.ensureReady()
        throwIfVoiceStartAborted(signal)
        if (input.transcriptBridgeVersion !== 1) {
            throw new Error('This Zyra window does not provide the canonical Voice transcript identity bridge.')
        }
        await this.ensureCanonicalVoiceSetup()
        throwIfVoiceStartAborted(signal)
        const record = findThreadRecord(this.state.snapshot, input.conversationId || '')
        if (!record) throw new Error('Select a canonical Assistant conversation before starting Voice.')
        if (input.sessionId && input.sessionId !== record.session.id) {
            throw new Error('Voice start belongs to a stale Assistant selection.')
        }
        if (record.thread.source === 'subagent') throw new Error('Voice can start only on the root conversation.')
        if (record.thread.latestTurn?.state === 'running' || record.thread.state === 'running' || record.thread.state === 'waiting') {
            throw new Error('Wait for the current strong-assistant turn to finish before starting Voice.')
        }
        const executionConfiguration = requireCanonicalVoiceExecutionConfiguration(input.executionConfiguration)
        if (this.activeCanonicalVoice) await this.stopCanonicalVoiceInternal('replaced')
        throwIfVoiceStartAborted(signal)

        const historyPreload = record.thread.providerThreadId
            ? this.ensureCanonicalHistoryLoaded(record.session, record.thread)
            : null
        const runtimeThreadId = record.thread.providerThreadId || record.thread.id
        if (!this.runtime.hasSession(runtimeThreadId)) {
            await this.runtime.connect(record.thread, this.getSessionRuntimeCwd(record.session, record.thread))
            throwIfVoiceStartAborted(signal)
        }
        const connected = findThreadRecord(this.state.snapshot, record.thread.id)
        if (!connected?.thread.providerThreadId) {
            throw new Error('Zyra could not bind this thread to its canonical Pi conversation.')
        }
        await this.runtime.configureSession(connected.thread.providerThreadId, executionConfiguration)
        throwIfVoiceStartAborted(signal)
        if (connected.thread.latestTurn?.state === 'running'
            || connected.thread.state === 'running'
            || connected.thread.state === 'waiting') {
            throw new Error('Wait for the current strong-assistant turn to finish before starting Voice.')
        }
        if (historyPreload) await historyPreload
        await this.ensureCanonicalHistoryLoaded(connected.session, connected.thread)
        throwIfVoiceStartAborted(signal)
        const conversationId = connected.thread.providerThreadId
        const routes = this.requireForegroundRoutes()
        let current = routes.initializeChat({
            conversationId,
            contextVersion: this.voiceContextVersion(connected.thread),
            activationReason: connected.thread.messageCount > 0 ? 'migration' : 'conversation_open',
            attachedTaskIds: this.attachedTaskIds(connected.thread.id)
        })
        const contextVersion = Math.max(current.context_version, this.voiceContextVersion(connected.thread))
        if (current.surface_mode === 'voice' && !this.canonicalVoiceSessions?.currentHandle(conversationId)) {
            await this.recoverInactiveCanonicalVoice(connected.thread)
            current = routes.activeRoute(conversationId)
        }
        if (current.surface_mode !== 'chat') throw new Error('The conversation already has an active Voice owner.')

        this.realtimeVoiceOwnerId = senderId
        try {
            const projectCwd = this.getSessionRuntimeCwd(connected.session, connected.thread)
            this.prepareVoicePrimaryWorker(connected.thread.id, projectCwd, executionConfiguration)
            const activation = await this.requireCanonicalVoiceSessions().startVoice({
                conversationId,
                projectCwd,
                offerSdp: input.sdp,
                instructions: canonicalVoiceInstructions(input.instructions),
                voice: input.voice || DEFAULT_INSTRUCTOR_REALTIME_VOICE,
                output: input.outputModality || DEFAULT_INSTRUCTOR_OUTPUT_MODALITY,
                contextVersion: Math.max(current.context_version, contextVersion),
                attachedTaskIds: this.attachedTaskIds(connected.thread.id),
                signal
            })
            this.requireCanonicalTypedVoiceCommitter().activate(activation.handle.adapterSessionId)
            this.activeCanonicalVoice = {
                conversationId,
                localThreadId: connected.thread.id,
                sessionId: connected.session.id,
                adapterSessionId: activation.handle.adapterSessionId,
                executionConfiguration
            }
            return {
                success: true as const,
                threadId: activation.handle.realtimeProviderThreadId,
                conversationId,
                adapterSessionId: activation.handle.adapterSessionId,
                realtimeSessionId: activation.handle.realtimeSessionId,
                realtimeSessionGeneration: activation.handle.realtimeSessionGeneration,
                sdp: activation.handle.answerSdp,
                realtimeVersion: activation.handle.realtimeVersion
            }
        } catch (error) {
            this.activeCanonicalVoice = null
            throw error
        }
    }

    private async stopCanonicalVoiceForNavigation(): Promise<void> {
        this.invalidateVoicePrimaryWorkerPreparation()
        await this.cancelPendingCanonicalVoiceStart()
        if (this.activeCanonicalVoice) await this.stopCanonicalVoiceInternal('selection_changed')
    }

    private async cancelPendingCanonicalVoiceStart(): Promise<void> {
        const pending = this.pendingCanonicalVoiceStart
        if (!pending) return
        pending.abortController.abort(new Error('Voice startup was cancelled.'))
        await pending.finished
    }

    private async stopCanonicalVoiceInternal(reason: string): Promise<void> {
        if (this.canonicalVoiceStopPromise) return this.canonicalVoiceStopPromise
        const active = this.activeCanonicalVoice
        if (!active) return
        const stop = (async () => {
            this.queuedVoiceStrongRequests.delete(active.conversationId)
            this.activeVoiceStrongTasks.get(active.conversationId)?.abortController.abort(new Error('Voice session ended.'))
            await this.requireCanonicalTypedVoiceCommitter().beginStop(active.adapterSessionId)
            await this.canonicalVoiceCommitter?.flush()
            const routes = this.requireForegroundRoutes()
            const route = routes.activeRoute(active.conversationId)
            const handle = this.canonicalVoiceSessions?.currentHandle(active.conversationId)
            if (route.surface_mode === 'voice') {
                const record = findThreadRecord(this.state.snapshot, active.localThreadId)
                await this.requireCanonicalVoiceSessions().stopVoice({
                    conversationId: active.conversationId,
                    contextVersion: record ? Math.max(route.context_version, this.voiceContextVersion(record.thread)) : route.context_version,
                    attachedTaskIds: record ? this.attachedTaskIds(record.thread.id) : route.attached_task_ids
                })
            } else {
                await this.requireCanonicalRealtimeAdapter().close(active.adapterSessionId, reason).catch(() => undefined)
            }
            if (this.activeCanonicalVoice?.adapterSessionId === active.adapterSessionId) {
                this.activeCanonicalVoice = null
                this.realtimeVoiceOwnerId = null
            }
            this.broadcastRealtimeVoiceEvent({
                type: 'session.closed',
                threadId: handle?.realtimeProviderThreadId || active.conversationId,
                reason
            })
        })()
        this.canonicalVoiceStopPromise = stop
        try {
            await stop
        } finally {
            if (this.canonicalVoiceStopPromise === stop) this.canonicalVoiceStopPromise = null
        }
    }

    private handleCanonicalVoiceEvent(event: RealtimeDomainEvent): void {
        const legacy = canonicalVoicePresentationEvent(event)
        if (legacy) this.broadcastRealtimeVoiceEvent(legacy)
        if (isCompletedRealtimeUserTranscriptEvent(event) && shouldDelegateVoiceInspection(event.text)) {
            this.routeVoiceStrongRequest(event)
        }
        if ((event.type === 'realtime.session.error' || event.type === 'realtime.session.closed')
            && this.activeCanonicalVoice?.adapterSessionId === event.adapterSessionId) {
            void this.stopCanonicalVoiceInternal(
                event.type === 'realtime.session.error' ? 'provider_error' : 'provider_closed'
            ).catch((error) => log.error('[AssistantVoice] Failed to recover after provider termination', error))
        }
    }

    async listPromptResources(projectPath?: string | null, forceRefresh = false) {
        return {
            success: true as const,
            ...await listAssistantPromptResources(projectPath, forceRefresh)
        }
    }

    async getSkillSourceOverview(projectPath?: string | null) {
        return {
            success: true as const,
            ...await getAssistantSkillSourceOverview(projectPath)
        }
    }

    async updateSkillSourceSettings(settings: AssistantSkillSourceSettings, projectPath?: string | null) {
        return {
            success: true as const,
            ...await updateAssistantSkillSourceSettings(settings, projectPath)
        }
    }

    private routeVoiceStrongRequest(request: VoiceStrongRequest): void {
        const sourceKey = `${request.adapterSessionId}:${request.providerItemId}`
        if (this.delegatedVoiceProviderItems.has(sourceKey)) return
        this.delegatedVoiceProviderItems.add(sourceKey)
        while (this.delegatedVoiceProviderItems.size > 512) {
            const oldest = this.delegatedVoiceProviderItems.values().next().value
            if (!oldest) break
            this.delegatedVoiceProviderItems.delete(oldest)
        }
        void this.startVoiceStrongInspection(request).catch((error) => {
            log.error('[AssistantVoice] Primary task failed', error)
        })
    }

    private async startVoiceStrongInspection(
        event: VoiceStrongRequest
    ): Promise<void> {
        const active = this.activeCanonicalVoice
        if (!active
            || active.adapterSessionId !== event.adapterSessionId
            || active.conversationId !== event.conversationId) return
        if (this.activeVoiceStrongTasks.has(event.conversationId)) {
            const queued = this.queuedVoiceStrongRequests.get(event.conversationId) || []
            const accepted = queued.length < 8
            if (accepted) {
                queued.push(event)
                this.queuedVoiceStrongRequests.set(event.conversationId, queued)
            }
            await this.requireCanonicalRealtimeAdapter().appendTransientContext(
                active.adapterSessionId,
                `The primary agent is still working on the current request. The next request is ${accepted ? 'queued' : 'not queued because the queue is full'}. Do not claim progress on it yet.`
            ).catch(() => undefined)
            return
        }
        const record = findThreadRecord(this.state.snapshot, active.localThreadId)
        if (!record) return
        const taskId = `voice_strong_${randomUUID()}`
        const abortController = new AbortController()
        const task: ActiveVoiceStrongTask = {
            taskId,
            conversationId: event.conversationId,
            localThreadId: record.thread.id,
            sourceProviderItemId: event.providerItemId,
            startedAt: nowIso(),
            abortController
        }
        this.activeVoiceStrongTasks.set(event.conversationId, task)
        this.projectVoiceStrongTask(task, record.session.id, 'running', 'Primary agent working', event.text)
        const runningContext = this.requireCanonicalRealtimeAdapter().appendTransientContext(
            active.adapterSessionId,
            `Primary task ${taskId} is running for this exact request: ${event.text.slice(0, 1000)}. Say only that the primary agent is working if asked for status.`
        ).catch(() => undefined)
        try {
            const result = await this.runtime.runPrivateVoiceTask({
                taskId,
                localThreadId: record.thread.id,
                cwd: this.getSessionRuntimeCwd(record.session, record.thread),
                prompt: buildVoiceStrongInspectionPrompt(event.text),
                model: active.executionConfiguration.model,
                effort: active.executionConfiguration.effort,
                runtimeMode: active.executionConfiguration.runtimeMode,
                interactionMode: active.executionConfiguration.interactionMode,
                profile: active.executionConfiguration.profile,
                serviceTier: active.executionConfiguration.serviceTier,
                signal: abortController.signal
            })
            const current = this.activeCanonicalVoice
            if (!current || current.adapterSessionId !== active.adapterSessionId) return
            const narration = boundedVoiceTaskResult(result.text)
            this.projectVoiceStrongTask(task, record.session.id, 'completed', 'Primary agent finished', narration)
            await runningContext
            await Promise.all([
                this.requireCanonicalRealtimeAdapter().appendTransientContext(
                    current.adapterSessionId,
                    `Verified primary-agent result for ${taskId}: ${narration}`
                ).catch(() => undefined),
                this.submitVoiceTaskNarration(current, taskId, narration)
            ])
        } catch (error) {
            if (abortController.signal.aborted) {
                this.projectVoiceStrongTask(task, record.session.id, 'cancelled', 'Primary agent stopped', 'Voice ended before the request completed.')
                return
            }
            const message = voiceTaskFailureMessage(error)
            this.projectVoiceStrongTask(task, record.session.id, 'failed', 'Primary agent could not finish', message)
            const current = this.activeCanonicalVoice
            if (current?.adapterSessionId === active.adapterSessionId) {
                await runningContext
                await Promise.all([
                    this.requireCanonicalRealtimeAdapter().appendTransientContext(
                        current.adapterSessionId,
                        `Primary task ${taskId} failed. Do not claim it is still running. User-safe reason: ${message}`
                    ).catch(() => undefined),
                    this.submitVoiceTaskNarration(current, taskId, message).catch(() => undefined)
                ])
            }
        } finally {
            if (this.activeVoiceStrongTasks.get(event.conversationId)?.taskId === taskId) {
                this.activeVoiceStrongTasks.delete(event.conversationId)
            }
            const queued = this.queuedVoiceStrongRequests.get(event.conversationId)
            const next = queued?.shift() || null
            if (queued && queued.length === 0) this.queuedVoiceStrongRequests.delete(event.conversationId)
            const current = this.activeCanonicalVoice
            if (current?.conversationId === event.conversationId) {
                this.prepareVoicePrimaryWorker(
                    record.thread.id,
                    this.getSessionRuntimeCwd(record.session, record.thread),
                    current.executionConfiguration
                )
            }
            if (next && current?.conversationId === event.conversationId) {
                void this.startVoiceStrongInspection(next).catch((nextError) => {
                    log.error('[AssistantVoice] Queued primary task failed', nextError)
                })
            }
        }
    }

    private prepareVoicePrimaryWorker(
        localThreadId: string,
        cwd: string,
        executionConfiguration: AssistantVoiceExecutionConfiguration
    ): void {
        void this.runtime.preparePrivateVoiceTask({
            localThreadId,
            cwd,
            model: executionConfiguration.model,
            effort: executionConfiguration.effort,
            runtimeMode: executionConfiguration.runtimeMode,
            interactionMode: executionConfiguration.interactionMode,
            profile: executionConfiguration.profile
        }).catch((error) => {
            log.warn('[AssistantVoice] Primary agent preparation failed', error)
        })
    }

    private invalidateVoicePrimaryWorkerPreparation(): void {
        this.voicePrimaryPreparationGeneration += 1
        this.runtime.disposePreparedPrivateVoiceTask()
    }

    private projectVoiceStrongTask(
        task: ActiveVoiceStrongTask,
        sessionId: string,
        status: 'running' | 'completed' | 'failed' | 'cancelled',
        summary: string,
        detail: string
    ): void {
        const occurredAt = nowIso()
        this.appendEvent('thread.activity.appended', occurredAt, {
            threadId: task.localThreadId,
            activity: buildVoiceStrongTaskActivity({
                taskId: task.taskId,
                sourceProviderItemId: task.sourceProviderItemId,
                startedAt: task.startedAt,
                occurredAt,
                status,
                summary,
                detail
            })
        }, sessionId, task.localThreadId)
    }

    private async submitVoiceTaskNarration(
        active: ActiveCanonicalVoice,
        taskId: string,
        text: string
    ): Promise<void> {
        const route = this.requireForegroundRoutes().activeRoute(active.conversationId)
        if (route.surface_mode !== 'voice' || route.realtime_session_id === null) return
        const now = Date.now()
        const canonicalMessageId = `voice_result_${taskId}`
        const committer = this.requireCanonicalTypedVoiceCommitter()
        const receipt = await committer.commit({
            adapterSessionId: active.adapterSessionId,
            conversationId: active.conversationId,
            routeClaim: foregroundRouteClaim(route),
            messageId: canonicalMessageId,
            providerItemId: `voice-result:${taskId}`,
            text,
            completedAt: new Date(now).toISOString()
        })
        if (!receipt || !committer.isAccepting(active.adapterSessionId)) return
        await this.requireCanonicalRealtimeAdapter().requestSpeech(active.adapterSessionId, {
            narrationId: `voice_narration_${taskId}`,
            deliveryId: `voice_delivery_${taskId}`,
            canonicalMessageId,
            text,
            safeFacts: [text],
            expiresAt: new Date(now + 2 * 60 * 1000).toISOString(),
            routeClaim: foregroundRouteClaim(route)
        })
    }

    private async readCanonicalVoiceContinuity(conversationId: string) {
        const record = findThreadRecord(this.state.snapshot, conversationId)
        if (!record) throw new Error(`Canonical conversation ${conversationId} is unavailable.`)
        await this.ensureCanonicalHistoryLoaded(record.session, record.thread)
        const detail = await this.persistence.readThreadDetail(record.thread.id)
        const activeRoute = this.requireForegroundRoutes().activeRoute(conversationId)
        return {
            contextVersion: Math.max(activeRoute.context_version, this.voiceContextVersion(record.thread)),
            routeCount: activeRoute.route_epoch,
            messages: detail.history.messages
                .filter((message) => message.role === 'user' || message.role === 'assistant')
                .map((message, index) => ({
                    id: message.id,
                    role: message.role as 'user' | 'assistant',
                    text: message.text,
                    modality: message.id.startsWith('voice_') ? 'voice' as const : 'text' as const,
                    sequence: message.timelineSequence || index + 1
                })),
            pendingApprovals: detail.pendingApprovals.map((approval) => ({
                id: approval.id,
                title: approval.title,
                detail: approval.detail
            })),
            pendingInputs: detail.pendingUserInputs.map((entry) => ({
                id: entry.id,
                summary: entry.questions.map((question) => question.header || question.question).filter(Boolean).join('; ') || 'Response required'
            })),
            attachedTaskIds: this.attachedTaskIds(record.thread.id)
        }
    }

    private async projectCanonicalVoiceMessage(
        input: CanonicalLedgerAppendInput,
        receipt: CanonicalMessageCommitReceipt
    ): Promise<void> {
        const record = findThreadRecord(this.state.snapshot, input.conversationId)
        if (!record) return
        const message: AssistantMessage = {
            id: input.messageId,
            role: input.role,
            text: input.text,
            turnId: null,
            streaming: false,
            providerItemId: input.providerItemId,
            modality: input.modality,
            createdAt: input.providerCompletedAt,
            updatedAt: receipt.observedAt
        }
        if (input.role === 'user') {
            const persistedFirstUserMessage = await this.persistence.readFirstUserMessageText(record.session.id)
            const shouldGenerateTitle = shouldGenerateSessionTitleForPrompt(record.session, persistedFirstUserMessage)
            let titleSeed = record.session.title
            this.appendEvent('thread.message.user', input.providerCompletedAt, {
                threadId: record.thread.id,
                message
            }, record.session.id, record.thread.id)
            if (record.thread.messageCount === 0 && isDefaultSessionTitle(record.session.title)) {
                titleSeed = deriveSessionTitleFromPrompt(input.text)
                this.appendEvent('session.updated', input.providerCompletedAt, {
                    sessionId: record.session.id,
                    patch: { title: titleSeed, updatedAt: input.providerCompletedAt }
                }, record.session.id, record.thread.id)
                await this.runtime.updateCanonicalChat(input.conversationId, { title: titleSeed }).catch(() => undefined)
            }
            if (shouldGenerateTitle) {
                const titleModelPromise = this.options.getTitleGenerationModel
                    ? this.options.getTitleGenerationModel().catch((error) => {
                        log.warn('[AssistantVoice] Failed to read the chat-title model preference', error)
                        return null
                    })
                    : Promise.resolve(null)
                void titleModelPromise.then((preferredModel) => queueGeneratedSessionTitle({
                    sessionId: record.session.id,
                    threadId: record.thread.id,
                    messageText: input.text,
                    seedTitle: titleSeed,
                    cwd: this.getSessionRuntimeCwd(record.session, record.thread),
                    preferredModel,
                    generateText: (titlePrompt, titleOptions) => this.runtime.generateText(titlePrompt, titleOptions),
                    getSnapshot: () => this.state.snapshot,
                    appendEvent: (type, occurredAt, payload, sessionId, threadId) => {
                        this.appendEvent(type, occurredAt, payload, sessionId, threadId)
                    },
                    onApplied: (nextTitle) => this.runtime.updateCanonicalChat(input.conversationId, { title: nextTitle })
                })).catch((error) => {
                    log.warn('[AssistantVoice] Session title generation task failed:', error)
                })
            }
        } else {
            this.appendEvent('thread.message.assistant.delta', input.providerCompletedAt, {
                threadId: record.thread.id,
                messageId: input.messageId,
                delta: input.text,
                turnId: null
            }, record.session.id, record.thread.id)
            this.appendEvent('thread.message.assistant.completed', receipt.observedAt, {
                threadId: record.thread.id,
                messageId: input.messageId,
                text: input.text,
                message
            }, record.session.id, record.thread.id)
        }
    }

    private voiceContextVersion(thread: AssistantThread): number {
        return Math.max(1, thread.canonicalPresence?.latestSequence || 0, thread.messageCount + thread.activityCount)
    }

    private attachedTaskIds(threadId: string): string[] {
        const fleet = this.state.snapshot.fleetByThreadId[threadId]
        if (!fleet) return []
        return Object.values(fleet.agents)
            .filter((run) => ['queued', 'starting', 'running', 'waiting', 'paused', 'recovering'].includes(run.status))
            .map((run) => run.agentRunId)
            .sort()
    }

    private async recoverInactiveCanonicalVoice(thread: AssistantThread): Promise<void> {
        const conversationId = thread.providerThreadId
        if (!conversationId) return
        const persistence = this.foregroundPersistence
        const routes = this.requireForegroundRoutes()
        const route = routes.activeRoute(conversationId)
        if (route.surface_mode !== 'voice' || this.activeCanonicalVoice?.conversationId === conversationId) return
        if (persistence?.pendingCanonicalMessageOperations(route.foreground_route_id).length) {
            await this.requireConversationGateway().reconcilePendingOperations(conversationId)
        }
        const current = routes.activeRoute(conversationId)
        if (current.surface_mode !== 'voice') return
        routes.recoverToChat({
            conversationId,
            expected: routeExpectation(foregroundRouteClaim(current)),
            contextVersion: Math.max(current.context_version, this.voiceContextVersion(thread)),
            attachedTaskIds: this.attachedTaskIds(thread.id)
        })
    }

    private isVoiceForeground(thread: AssistantThread): boolean {
        const conversationId = thread.providerThreadId
        if (!conversationId || !this.foregroundPersistence) return false
        return this.foregroundPersistence.activeRoute(conversationId)?.surface_mode === 'voice'
    }

    private requireForegroundRoutes(): ForegroundRouteController {
        if (!this.foregroundRoutes) throw new Error('Foreground controller is not ready.')
        return this.foregroundRoutes
    }

    private requireConversationGateway(): ConversationGateway {
        if (!this.conversationGateway) throw new Error('Conversation gateway is not ready.')
        return this.conversationGateway
    }

    private requireRealtimeContinuity(): AssistantRealtimeContinuitySource {
        if (!this.realtimeContinuity) throw new Error('Realtime continuity is not ready.')
        return this.realtimeContinuity
    }

    private requireCanonicalRealtimeAdapter(): ChatGptRealtimeForegroundAdapter {
        if (!this.canonicalRealtimeAdapter) throw new Error('Canonical realtime adapter is not ready.')
        return this.canonicalRealtimeAdapter
    }

    private requireCanonicalVoiceSessions(): CanonicalVoiceSessionController {
        if (!this.canonicalVoiceSessions) throw new Error('Canonical Voice controller is not ready.')
        return this.canonicalVoiceSessions
    }

    private requireCanonicalTypedVoiceCommitter(): CanonicalTypedVoiceResponseCommitter {
        if (!this.canonicalTypedVoiceCommitter) throw new Error('Canonical typed Voice committer is not ready.')
        return this.canonicalTypedVoiceCommitter
    }

    private scheduleSelectedCanonicalSessionSynchronization(sessionId: string, generation: number): void {
        setImmediate(() => {
            if (generation !== this.navigationSelectionGeneration) return
            void this.synchronizeSelectedCanonicalSession(sessionId, generation).catch((error) => {
                log.warn('[Assistant] Failed to synchronize the selected canonical chat after navigation', error)
            })
        })
    }

    private async synchronizeSelectedCanonicalSession(sessionId: string, generation: number) {
        await this.refreshSelectedCanonicalPresence(sessionId)
        if (generation !== this.navigationSelectionGeneration) return null

        const session = this.state.snapshot.sessions.find((entry) => entry.id === sessionId) || null
        const thread = getActiveThread(session)
        if (!session || !thread) return null

        try {
            await this.runtime.connect(thread, this.getSessionRuntimeCwd(session, thread))
        } catch (error) {
            log.warn('[Assistant] Failed to attach the selected canonical chat during navigation', error)
        }
        if (generation !== this.navigationSelectionGeneration) {
            const currentThread = getActiveThread(getSelectedSession(this.state.snapshot))
            if (currentThread?.id !== thread.id) this.runtime.disconnect(thread.id)
            return null
        }

        await this.refreshSelectedCanonicalPresence(sessionId)
        if (generation !== this.navigationSelectionGeneration) {
            const currentThread = getActiveThread(getSelectedSession(this.state.snapshot))
            if (currentThread?.id !== thread.id) this.runtime.disconnect(thread.id)
            return null
        }
        return toAssistantShellSnapshot(this.state.snapshot)
    }

    private async refreshSelectedCanonicalPresence(sessionId: string): Promise<void> {
        const session = this.state.snapshot.sessions.find((entry) => entry.id === sessionId) || null
        const thread = getActiveThread(session)
        if (!session || !thread?.providerThreadId) return

        try {
            const chat = await this.runtime.getCanonicalChat(
                thread.providerThreadId,
                session.projectPath || thread.cwd || undefined
            )
            if (!chat) return
            if (shouldRefreshCanonicalHistory({
                canonicalModifiedAt: normalizeCatalogDate(chat.modifiedAt, thread.createdAt),
                persistedCanonicalModifiedAt: thread.canonicalHistoryModifiedAt,
                canonicalEntryCount: chat.entryCount,
                persistedCanonicalEntryCount: thread.canonicalHistoryEntryCount
            })) this.markCanonicalHistoryDirty(chat.canonicalChatId)
            if (!chat.presence) return
            const occurredAt = nowIso()
            const latestTurn = mergeCanonicalPresenceLatestTurn(thread.latestTurn, chat.presence)
            const attention = resolveCanonicalPresenceAttention({
                currentHasPendingApprovals: thread.hasPendingApprovals,
                currentHasPendingUserInputs: thread.hasPendingUserInputs,
                hasLocalPendingApproval: thread.pendingApprovals.some((entry) => entry.status === 'pending'),
                hasLocalPendingInput: thread.pendingUserInputs.some((entry) => entry.status === 'pending'),
                presence: chat.presence
            })
            this.appendEvent('thread.updated', occurredAt, {
                threadId: thread.id,
                patch: {
                    canonicalPresence: mergeCanonicalPresenceObservation(thread.canonicalPresence, chat.presence),
                    latestTurn,
                    state: resolveCanonicalPresenceThreadState({
                        currentState: thread.state,
                        previousPresence: thread.canonicalPresence,
                        presence: chat.presence
                    }),
                    hasPendingApprovals: attention.hasPendingApprovals,
                    hasPendingUserInputs: attention.hasPendingUserInputs
                }
            }, session.id, thread.id)
        } catch (error) {
            log.warn('[Assistant] Failed to refresh selected canonical presence', error)
        }
    }

    private async queueCanonicalChatImport(): Promise<void> {
        await this.ensureReady()
        return this.canonicalCatalogReconciler.request()
    }

    private async importCanonicalChats(): Promise<void> {
        let chats
        try {
            chats = await this.runtime.listCanonicalChats()
        } catch (error) {
            log.warn('[Assistant] Failed to read the canonical Zyra chat catalog', error)
            return
        }
        for (const chat of chats) {
            if (!chat.canonicalChatId) continue
            const existing = this.state.snapshot.sessions
                .flatMap((session) => session.threads.map((thread) => ({ session, thread })))
                .find(({ thread }) => thread.providerThreadId === chat.canonicalChatId)
            const createdAt = normalizeCatalogDate(chat.createdAt)
            const updatedAt = normalizeCatalogDate(chat.modifiedAt, createdAt)
            const messageCount = Math.max(0, Number(chat.displayMessageCount ?? chat.messageCount) || 0)
            const activityCount = Math.max(0, Number(chat.toolCallCount || 0) + Number(chat.errorCount || 0))
            if (existing) {
                if (shouldRefreshCanonicalHistory({
                    canonicalModifiedAt: updatedAt,
                    persistedCanonicalModifiedAt: existing.thread.canonicalHistoryModifiedAt,
                    canonicalEntryCount: chat.entryCount,
                    persistedCanonicalEntryCount: existing.thread.canonicalHistoryEntryCount
                })) this.markCanonicalHistoryDirty(chat.canonicalChatId)
                const sessionPatch: Record<string, unknown> = {}
                if (chat.title && chat.title !== existing.session.title) sessionPatch['title'] = chat.title
                if (chat.project && chat.project !== existing.session.projectPath) sessionPatch['projectPath'] = chat.project
                if (chat.archived !== existing.session.archived) sessionPatch['archived'] = chat.archived
                if (Object.keys(sessionPatch).length > 0) {
                    sessionPatch['updatedAt'] = updatedAt
                    this.appendEvent('session.updated', updatedAt, {
                        sessionId: existing.session.id,
                        patch: sessionPatch
                    }, existing.session.id, existing.thread.id)
                }
                const nextCwd = chat.cwd || chat.project
                const canonicalTurnActive = chat.presence?.state === 'running' || chat.presence?.state === 'background'
                const nextMessageCount = canonicalTurnActive ? Math.max(existing.thread.messageCount, messageCount) : messageCount
                const nextActivityCount = Math.max(existing.thread.activityCount, activityCount)
                const nextCanonicalPresence = chat.presence
                    ? mergeCanonicalPresenceObservation(existing.thread.canonicalPresence, chat.presence)
                    : undefined
                const presenceChanged = JSON.stringify(existing.thread.canonicalPresence || null) !== JSON.stringify(nextCanonicalPresence || null)
                const nextThreadState = resolveCanonicalPresenceThreadState({
                    currentState: existing.thread.state,
                    previousPresence: existing.thread.canonicalPresence,
                    presence: nextCanonicalPresence
                })
                const nextLatestTurn = mergeCanonicalPresenceLatestTurn(existing.thread.latestTurn, nextCanonicalPresence)
                const latestTurnChanged = JSON.stringify(existing.thread.latestTurn || null) !== JSON.stringify(nextLatestTurn || null)
                const nextAttention = resolveCanonicalPresenceAttention({
                    currentHasPendingApprovals: existing.thread.hasPendingApprovals,
                    currentHasPendingUserInputs: existing.thread.hasPendingUserInputs,
                    hasLocalPendingApproval: existing.thread.pendingApprovals.some((entry) => entry.status === 'pending'),
                    hasLocalPendingInput: existing.thread.pendingUserInputs.some((entry) => entry.status === 'pending'),
                    presence: chat.presence
                })
                const nextHasPendingApprovals = nextAttention.hasPendingApprovals
                const nextHasPendingUserInputs = nextAttention.hasPendingUserInputs
                if (
                    existing.thread.providerThreadId !== chat.canonicalChatId
                    || (nextCwd && existing.thread.cwd !== nextCwd)
                    || existing.thread.messageCount !== nextMessageCount
                    || existing.thread.activityCount !== nextActivityCount
                    || existing.thread.state !== nextThreadState
                    || existing.thread.hasPendingApprovals !== nextHasPendingApprovals
                    || existing.thread.hasPendingUserInputs !== nextHasPendingUserInputs
                    || latestTurnChanged
                    || presenceChanged
                ) {
                    this.appendEvent('thread.updated', updatedAt, {
                        threadId: existing.thread.id,
                        patch: {
                            providerThreadId: chat.canonicalChatId,
                            cwd: nextCwd,
                            messageCount: nextMessageCount,
                            activityCount: nextActivityCount,
                            canonicalPresence: nextCanonicalPresence,
                            latestTurn: nextLatestTurn,
                            hasPendingApprovals: nextHasPendingApprovals,
                            hasPendingUserInputs: nextHasPendingUserInputs,
                            state: nextThreadState,
                            updatedAt
                        }
                    }, existing.session.id, existing.thread.id)
                }
                continue
            }
            this.markCanonicalHistoryDirty(chat.canonicalChatId)
            const key = createHash('sha256').update(chat.canonicalChatId).digest('hex').slice(0, 24)
            const sessionId = `assistant-session:shared:${key}`
            const threadId = `assistant-thread:shared:${key}`
            if (this.state.snapshot.sessions.some((session) => session.id === sessionId)) continue
            const thread = createAssistantThread(createdAt, null, chat.cwd || chat.project)
            thread.id = threadId
            thread.providerThreadId = chat.canonicalChatId
            thread.messageCount = messageCount
            thread.activityCount = activityCount
            thread.canonicalPresence = chat.presence
                ? mergeCanonicalPresenceObservation(undefined, chat.presence)
                : undefined
            thread.latestTurn = mergeCanonicalPresenceLatestTurn(null, chat.presence)
            thread.hasPendingApprovals = chat.presence?.attention === 'approval'
            thread.hasPendingUserInputs = hasCanonicalUserInputAttention(chat.presence)
            if (chat.presence?.state === 'running') thread.state = 'running'
            if (chat.presence?.state === 'background') thread.state = 'waiting'
            thread.updatedAt = updatedAt
            const session = createAssistantSessionRecord({
                sessionId,
                title: chat.title || 'Shared Zyra chat',
                projectPath: chat.project || chat.cwd || null,
                createdAt,
                thread
            })
            session.archived = chat.archived === true
            session.updatedAt = updatedAt
            this.appendEvent('session.created', createdAt, { session }, sessionId, threadId)
        }
    }

    private markCanonicalHistoryDirty(canonicalChatId: string): number {
        return this.canonicalHistoryRefresh.mark(canonicalChatId)
    }

    private async ensureCanonicalHistoryLoaded(session: AssistantSession, thread: AssistantThread): Promise<void> {
        const canonicalChatId = thread.providerThreadId
        if (!canonicalChatId) return
        const refreshGeneration = this.canonicalHistoryRefresh.current(canonicalChatId)
        if (refreshGeneration === 0) return
        const existing = this.canonicalHistoryLoadPromises.get(canonicalChatId)
        if (existing) return existing
        const key = createHash('sha256').update(canonicalChatId).digest('hex').slice(0, 24)
        const pending = this.loadCanonicalHistoryPage({
            canonicalChatId,
            project: session.projectPath || thread.cwd || process.cwd(),
            key,
            sessionId: session.id,
            threadId: thread.id,
            before: null,
            fallbackCreatedAt: thread.createdAt
        }).then((loaded) => {
            if (loaded) this.canonicalHistoryRefresh.clearIfCurrent(canonicalChatId, refreshGeneration)
        }).finally(() => {
            if (this.canonicalHistoryLoadPromises.get(canonicalChatId) === pending) {
                this.canonicalHistoryLoadPromises.delete(canonicalChatId)
            }
            if (this.canonicalHistoryRefresh.current(canonicalChatId) > refreshGeneration) {
                void this.ensureCanonicalHistoryLoaded(session, thread)
            }
        })
        this.canonicalHistoryLoadPromises.set(canonicalChatId, pending)
        return pending
    }

    private async loadOlderCanonicalHistory(canonicalChatId: string): Promise<void> {
        const state = this.canonicalHistoryState.get(canonicalChatId)
        if (!state?.hasOlder || !state.before) return
        const record = findThreadRecord(this.state.snapshot, state.threadId)
        if (!record) return
        await this.loadCanonicalHistoryPage({
            canonicalChatId,
            project: state.project,
            key: state.key,
            sessionId: state.sessionId,
            threadId: state.threadId,
            before: state.before,
            fallbackCreatedAt: record.thread.createdAt
        })
    }

    private async loadCanonicalHistoryPage(input: {
        canonicalChatId: string
        project: string
        key: string
        sessionId: string
        threadId: string
        before: string | null
        fallbackCreatedAt: string
    }): Promise<boolean> {
        try {
            const history = await this.runtime.readCanonicalChatHistory(input.canonicalChatId, input.project, {
                before: input.before,
                limit: CANONICAL_CHAT_HISTORY_PAGE_LIMIT,
                toolResultBodies: 'lazy-v1'
            })
            if (!history) return false
            let canonicalEntries = history.entries || []
            let canonicalStartCursor = Math.max(0, Number(history.pageInfo?.startCursor) || 0)
            let canonicalOldestCursor = history.pageInfo?.oldestCursor || null
            let canonicalHasOlder = history.pageInfo?.hasOlder === true
            let projection = projectCanonicalTimeline(
                canonicalEntries,
                input.canonicalChatId,
                input.key,
                input.fallbackCreatedAt,
                canonicalStartCursor,
                history.chat.cwd || input.project
            )
            const seenCanonicalCursors = new Set<string>()
            while (
                !projection.messages.some((message) => message.role === 'user')
                && canonicalHasOlder
                && canonicalOldestCursor
            ) {
                if (
                    seenCanonicalCursors.has(canonicalOldestCursor)
                    || canonicalEntries.length >= CANONICAL_SINGLE_TURN_MAX_ENTRIES
                ) {
                    throw new Error('Canonical history could not find a complete user turn within the bounded import window.')
                }
                seenCanonicalCursors.add(canonicalOldestCursor)
                const older = await this.runtime.readCanonicalChatHistory(input.canonicalChatId, input.project, {
                    before: canonicalOldestCursor,
                    limit: CANONICAL_CHAT_HISTORY_PAGE_LIMIT,
                    toolResultBodies: 'lazy-v1'
                })
                if (!older) break
                canonicalEntries = [...(older.entries || []), ...canonicalEntries]
                canonicalStartCursor = Math.max(0, Number(older.pageInfo?.startCursor) || 0)
                canonicalOldestCursor = older.pageInfo?.oldestCursor || null
                canonicalHasOlder = older.pageInfo?.hasOlder === true
                projection = projectCanonicalTimeline(
                    canonicalEntries,
                    input.canonicalChatId,
                    input.key,
                    input.fallbackCreatedAt,
                    canonicalStartCursor,
                    history.chat.cwd || input.project
                )
            }
            const record = findThreadRecord(this.state.snapshot, input.threadId)
            const canonicalHistoryModifiedAt = normalizeCatalogDate(history.chat.modifiedAt, record?.thread.updatedAt || input.fallbackCreatedAt)
            const canonicalHistoryEntryCount = Math.max(0, Number(history.chat.entryCount ?? history.pageInfo?.totalEntries) || 0)
            if (record && (projection.messages.length > 0 || projection.activities.length > 0)) {
                const persistedTimeline = await this.persistence.readTimelineProjectionRows(input.threadId)
                const canonicalMessages = preserveCanonicalUserReplayBoundaries(persistedTimeline.messages, projection.messages)
                const canonicalActivities = reconcileCanonicalFileChangeActivities(persistedTimeline.activities, projection.activities)
                const removedMessageIds = [...new Set([
                    ...projection.legacyMessageIds,
                    ...findDuplicateProjectedMessageIds(persistedTimeline.messages),
                    ...findSupersededCanonicalMessageIds(
                        persistedTimeline.messages,
                        canonicalMessages,
                        projection.legacyMessageIds
                    )
                ])]
                const removedActivityIds = [...new Set([
                    ...projection.legacyActivityIds,
                    ...findDuplicateProjectedActivityIds(persistedTimeline.activities),
                    ...findSupersededCanonicalActivityIds(
                        persistedTimeline.activities,
                        canonicalActivities,
                        projection.legacyActivityIds
                    )
                ])]
                this.appendEvent('thread.updated', normalizeCatalogDate(history.chat.modifiedAt, record.thread.updatedAt), {
                    threadId: input.threadId,
                    patch: {
                        canonicalHistoryModifiedAt,
                        canonicalHistoryEntryCount,
                        messages: canonicalMessages,
                        activities: canonicalActivities,
                        messageCount: countMergedCanonicalRecords(persistedTimeline.messages, canonicalMessages, removedMessageIds),
                        activityCount: countMergedCanonicalRecords(persistedTimeline.activities, canonicalActivities, removedActivityIds)
                    },
                    removedMessageIds,
                    removedActivityIds
                }, input.sessionId, input.threadId)
            } else if (record) {
                this.appendEvent('thread.updated', canonicalHistoryModifiedAt, {
                    threadId: input.threadId,
                    patch: { canonicalHistoryModifiedAt, canonicalHistoryEntryCount }
                }, input.sessionId, input.threadId)
            }
            this.canonicalHistoryState.set(input.canonicalChatId, {
                before: canonicalOldestCursor,
                hasOlder: canonicalHasOlder,
                project: input.project,
                key: input.key,
                sessionId: input.sessionId,
                threadId: input.threadId
            })
            return true
        } catch (error) {
            log.warn('[Assistant] Failed to import canonical chat history page', { canonicalChatId: input.canonicalChatId, error })
            return false
        }
    }

    /** Reserved for explicit bounded Review backfill work; never call from a read-only panel request. */
    async ensureCanonicalReviewHistoryIndexed(session: AssistantSession, thread: AssistantThread): Promise<void> {
        const canonicalChatId = thread.providerThreadId
        if (!canonicalChatId) return
        const pending = this.canonicalReviewIndexPromises.get(canonicalChatId)
        if (pending) {
            await pending
            return
        }
        const indexing = this.indexCanonicalReviewHistory(session, thread)
            .catch((error) => {
                log.warn('[Assistant] Failed to index complete canonical Review history', { canonicalChatId, error })
            })
            .finally(() => {
                if (this.canonicalReviewIndexPromises.get(canonicalChatId) === indexing) {
                    this.canonicalReviewIndexPromises.delete(canonicalChatId)
                }
            })
        this.canonicalReviewIndexPromises.set(canonicalChatId, indexing)
        await indexing
    }

    private async indexCanonicalReviewHistory(session: AssistantSession, thread: AssistantThread): Promise<void> {
        const canonicalChatId = thread.providerThreadId
        if (!canonicalChatId) return
        const project = session.projectPath || thread.cwd || process.cwd()
        const latest = await this.runtime.readCanonicalChatHistory(canonicalChatId, project, {
            limit: 2_000,
            toolResultBodies: 'lazy-v1'
        })
        if (!latest) return

        const totalEntries = Math.max(0, Number(latest.pageInfo?.totalEntries) || latest.entries.length)
        const modifiedAt = normalizeCatalogDate(latest.chat.modifiedAt, thread.updatedAt)
        const cachedState = this.canonicalReviewHistoryState.get(canonicalChatId)
        const previous = cachedState?.threadId === thread.id ? cachedState : null
        if (previous?.totalEntries === totalEntries && previous.modifiedAt === modifiedAt) return

        let entries = latest.entries || []
        let baseEntryIndex = Math.max(0, Number(latest.pageInfo?.startCursor) || 0)
        let completeBackfill = !previous || totalEntries < previous.totalEntries
        if (!completeBackfill && previous && totalEntries > previous.totalEntries) {
            const firstNewLocalIndex = previous.totalEntries - baseEntryIndex
            const anchorIndex = findCanonicalReviewTurnAnchor(entries, firstNewLocalIndex)
            if (anchorIndex >= 0) {
                entries = entries.slice(anchorIndex)
                baseEntryIndex += anchorIndex
            } else {
                completeBackfill = true
            }
        } else if (previous && totalEntries === previous.totalEntries) {
            completeBackfill = true
        }

        if (completeBackfill) {
            const pages: unknown[][] = [entries]
            let before = latest.pageInfo?.oldestCursor || null
            let hasOlder = latest.pageInfo?.hasOlder === true
            let oldestStart = baseEntryIndex
            const seenCursors = new Set<string>()
            while (hasOlder && before && !seenCursors.has(before)) {
                seenCursors.add(before)
                const older = await this.runtime.readCanonicalChatHistory(canonicalChatId, project, {
                    before,
                    limit: 2_000,
                    toolResultBodies: 'lazy-v1'
                })
                if (!older) break
                pages.push(older.entries || [])
                oldestStart = Math.max(0, Number(older.pageInfo?.startCursor) || 0)
                before = older.pageInfo?.oldestCursor || null
                hasOlder = older.pageInfo?.hasOlder === true
            }
            if (hasOlder || oldestStart > 0) {
                throw new Error('Canonical Review history paging ended before the oldest entry.')
            }
            entries = pages.reverse().flat()
            baseEntryIndex = oldestStart
        }

        const key = createHash('sha256').update(canonicalChatId).digest('hex').slice(0, 24)
        const projection = projectCanonicalTimeline(
            entries,
            canonicalChatId,
            key,
            thread.createdAt,
            baseEntryIndex,
            latest.chat.cwd || project
        )
        const persistedTimeline = await this.persistence.readTimelineProjectionRows(thread.id)
        const canonicalMessages = preserveCanonicalUserReplayBoundaries(persistedTimeline.messages, projection.messages)
        const canonicalActivities = reconcileCanonicalFileChangeActivities(persistedTimeline.activities, projection.activities)
        const removedMessageIds = [...new Set([
            ...projection.legacyMessageIds,
            ...findDuplicateProjectedMessageIds(persistedTimeline.messages),
            ...findSupersededCanonicalMessageIds(
                persistedTimeline.messages,
                canonicalMessages,
                projection.legacyMessageIds
            )
        ])]
        const removedActivityIds = [...new Set([
            ...projection.legacyActivityIds,
            ...findDuplicateProjectedActivityIds(persistedTimeline.activities),
            ...findSupersededCanonicalActivityIds(
                persistedTimeline.activities,
                canonicalActivities,
                projection.legacyActivityIds
            )
        ])]
        await this.persistence.projectCanonicalReviewTimeline({
            threadId: thread.id,
            messages: canonicalMessages,
            activities: canonicalActivities,
            removedMessageIds,
            removedActivityIds
        })
        this.canonicalReviewHistoryState.set(canonicalChatId, { threadId: thread.id, totalEntries, modifiedAt })
    }

    private async hydrateDeferredFileChanges(activities: AssistantActivity[]): Promise<AssistantActivity[]> {
        const hydratedFileChanges: AssistantActivity[] = []
        for (const activity of activities) {
            const ref = activity.kind === 'file-change'
                ? parseAssistantHistoryBodyRef(activity.payload?.['historyBodyRef'])
                : null
            if (!ref) continue
            try {
                const hydrated = await this.hydrateHistoryBody({ activityId: activity.id, ref })
                hydratedFileChanges.push(reconcileCanonicalFileChangeActivity(activity, {
                    ...activity,
                    payload: { ...(activity.payload || {}), ...hydrated.body.payload }
                }))
            } catch (error) {
                log.warn('[Assistant] Failed to hydrate a deferred Review file change', {
                    canonicalChatId: ref.canonicalChatId,
                    activityId: activity.id,
                    error
                })
            }
        }
        return hydratedFileChanges
    }

    private async maybeAutoRegenerateSessionTitle(sessionId: string, threadId: string): Promise<void> {
        const preferences = await this.options.getTitleAutomation?.().catch(() => null)
        if (!preferences?.enabled) return
        const session = this.state.snapshot.sessions.find((entry) => entry.id === sessionId) || null
        const thread = session?.threads.find((entry) => entry.id === threadId) || null
        if (!session || !thread || thread.source !== 'root' || session.titleGenerating) return

        const review = await this.persistence.readReviewIndex(thread.id)
        const completedTurns = review.turns.filter((turn) => turn.state === 'completed' && turn.prompt && turn.response)
        if (!shouldAutoRegenerateSessionTitle(completedTurns.length, preferences)) return
        const milestone = `${session.id}:${thread.id}:${completedTurns.length}`
        if (this.autoTitleMilestones.has(milestone)) return
        this.autoTitleMilestones.add(milestone)

        const preferredModel = await this.options.getTitleGenerationModel?.().catch(() => null) || null
        await generateReplacementSessionTitle({
            sessionId: session.id,
            threadId: thread.id,
            turns: completedTurns,
            seedTitle: session.title,
            cwd: this.getSessionRuntimeCwd(session, thread),
            preferredModel,
            generateText: (prompt, options) => this.runtime.generateText(prompt, options),
            getSnapshot: () => this.state.snapshot,
            appendEvent: (type, occurredAt, payload, eventSessionId, eventThreadId) => {
                this.appendEvent(type, occurredAt, payload, eventSessionId, eventThreadId)
            },
            onApplied: async (nextTitle) => {
                await Promise.allSettled(session.threads
                    .map((entry) => entry.providerThreadId)
                    .filter((providerThreadId): providerThreadId is string => Boolean(providerThreadId))
                    .map((providerThreadId) => this.runtime.updateCanonicalChat(providerThreadId, { title: nextTitle })))
            }
        })
    }

    private async recoverSelectedSessionTitle(): Promise<void> {
        const session = getSelectedSession(this.state.snapshot)
        const thread = getActiveThread(session)
        if (!session || !thread) return

        const firstUserMessage = await this.persistence.readFirstUserMessageText(session.id)
        if (!shouldGenerateSessionTitleForPrompt(session, firstUserMessage)) return
        const latestUserMessage = await this.persistence.readLatestUserMessageText(session.id)
        if (!latestUserMessage) return

        const titleModel = await this.options.getTitleGenerationModel?.().catch(() => null) || null
        await queueGeneratedSessionTitle({
            sessionId: session.id,
            threadId: thread.id,
            messageText: latestUserMessage,
            seedTitle: session.title,
            cwd: this.getSessionRuntimeCwd(session, thread),
            preferredModel: titleModel,
            generateText: (titlePrompt, titleOptions) => this.runtime.generateText(titlePrompt, titleOptions),
            getSnapshot: () => this.state.snapshot,
            appendEvent: (type, occurredAt, payload, sessionId, threadId) => {
                this.appendEvent(type, occurredAt, payload, sessionId, threadId)
            },
            onApplied: (nextTitle) => this.runtime.updateCanonicalChat(
                thread.providerThreadId || thread.id,
                { title: nextTitle }
            )
        })
    }

    private async ensureReady() {
        await this.readyPromise
    }

    private getSessionRuntimeCwd(
        session: AssistantSession,
        thread: AssistantThread
    ): string {
        return session.projectPath || thread.cwd || process.cwd()
    }

    private appendEvent(
        type: AssistantDomainEvent['type'],
        occurredAt: string,
        payload: Record<string, unknown>,
        sessionId?: string,
        threadId?: string
    ) {
        const event = createAssistantDomainEvent(this.state.snapshot.snapshotSequence, type, occurredAt, payload, sessionId, threadId)
        this.state.events.push(event)
        this.state.events = trimAssistantEvents(this.state.events, AssistantService.MAX_IN_MEMORY_EVENTS)
        this.state.snapshot = applyDomainEvent(this.state.snapshot, event)
        this.persistence.appendEvent(event, this.state.snapshot)
        this.queueBroadcastEvent(event)
    }

    private queueBroadcastEvent(event: AssistantDomainEvent): void {
        this.pendingBroadcastEvents.push(event)
        if (isAssistantToolLifecycleStartEvent(event)) {
            if (this.pendingBroadcastTimer) {
                clearTimeout(this.pendingBroadcastTimer)
                this.pendingBroadcastTimer = null
            }
            this.flushBroadcastEvents()
            return
        }
        if (this.pendingBroadcastTimer) return

        this.pendingBroadcastTimer = setTimeout(() => {
            this.pendingBroadcastTimer = null
            this.flushBroadcastEvents()
        }, AssistantService.ASSISTANT_EVENT_BROADCAST_BATCH_MS)
        this.pendingBroadcastTimer.unref?.()
    }

    private captureAnalytics<Name extends AnalyticsEventName>(input: AnalyticsEventInput<Name>): void {
        try {
            this.options.captureAnalytics?.(input)
        } catch {}
    }

    private flushBroadcastEvents(): void {
        if (this.pendingBroadcastEvents.length === 0) return
        const events = this.pendingBroadcastEvents.splice(0, this.pendingBroadcastEvents.length)
        const payload: AssistantEventStreamPayload = events.length === 1 ? { event: events[0] } : { events }
        broadcastAssistantPayload(this.subscribers, payload)
        for (const listener of [...this.externalEventSubscribers]) {
            try {
                listener(payload)
            } catch (error) {
                log.warn('[Assistant] External event subscriber failed', error)
            }
        }
    }

    private handleRuntimeEvent(event: Parameters<typeof handleAssistantRuntimeEvent>[0]) {
        if (event.type === 'turn.completed') {
            const record = findThreadRecord(this.state.snapshot, event.threadId)
            const startedAt = record?.thread.latestTurn?.startedAt
            const durationMs = startedAt ? Date.parse(event.createdAt) - Date.parse(startedAt) : undefined
            const outcome = event.payload.outcome === 'completed'
                ? 'completed'
                : event.payload.outcome === 'interrupted' || event.payload.outcome === 'cancelled'
                    ? 'cancelled'
                    : 'failed'
            this.captureAnalytics({
                event: 'zyra_v1_chat',
                properties: {
                    action: outcome === 'completed' ? 'complete' : outcome === 'cancelled' ? 'cancel' : 'fail',
                    outcome,
                    model_family: classifyAnalyticsModelFamily(record?.thread.model),
                    effort: normalizeAnalyticsEffort(event.payload.effort || record?.thread.thinking),
                    ...(durationMs === undefined || !Number.isFinite(durationMs) ? {} : { duration_ms: durationMs }),
                    ...(outcome === 'failed' ? { error_code: classifyAnalyticsError(event.payload.errorMessage) } : {})
                }
            })
        } else if (event.type === 'activity' && event.payload.kind === 'context.compaction') {
            const status = String(event.payload.data?.['status'] || '')
            if (status && status !== 'running') {
                this.captureAnalytics({
                    event: 'zyra_v1_chat',
                    properties: {
                        action: 'context_compaction',
                        outcome: status === 'completed' ? 'completed' : status === 'cancelled' ? 'cancelled' : 'failed',
                        ...(status === 'failed' ? { error_code: 'unknown' } : {})
                    }
                })
            }
        }
        const privateVoiceTarget = this.runtime.resolvePrivateVoiceTargetThread(event.threadId)
        if (privateVoiceTarget) {
            if (event.type !== 'activity' && event.type !== 'approval.requested' && event.type !== 'approval.resolved') return
            const activeTask = [...this.activeVoiceStrongTasks.values()].find((task) => task.localThreadId === privateVoiceTarget)
            const activeVoice = activeTask ? this.activeCanonicalVoice : null
            if (activeVoice && activeTask && event.type === 'approval.requested') {
                const approvalMessage = 'I need your approval for the command shown above before I can continue.'
                void this.requireCanonicalRealtimeAdapter().appendTransientContext(
                    activeVoice.adapterSessionId,
                    `Strong task ${activeTask.taskId} is waiting for the user's approval. Do not say it is still checking.`
                ).then(() => this.submitVoiceTaskNarration(
                    activeVoice,
                    `${activeTask.taskId}_approval_${event.requestId || 'request'}`,
                    approvalMessage
                )).catch(() => undefined)
            } else if (activeVoice && activeTask && event.type === 'approval.resolved') {
                void this.submitVoiceTaskNarration(
                    activeVoice,
                    `${activeTask.taskId}_approval_resolved_${event.requestId || 'request'}`,
                    'Approval received. The primary agent is continuing.'
                ).catch(() => undefined)
            }
            const targetRecord = findThreadRecord(this.state.snapshot, privateVoiceTarget)
            this.handleRuntimeEvent({
                ...event,
                threadId: targetRecord?.thread.id || privateVoiceTarget,
                providerThreadId: targetRecord?.thread.providerThreadId || undefined
            })
            return
        }
        if (event.type === 'turn.started') {
            this.persistence.setStreamingActive(event.threadId, true)
        }
        handleAssistantRuntimeEvent(event, {
            planBuffers: this.planBuffers,
            assistantTextBuffers: this.assistantTextBuffers,
            isAssistantTextSuppressed: (threadId, turnId) => Boolean(turnId && this.suppressedAssistantTextTurns.has(`${threadId}:${turnId}`)),
            findSessionByThreadId: (threadId) => findSessionByThreadId(this.state.snapshot, threadId),
            requireThread: (threadId) => requireThread(this.state.snapshot, threadId),
            findThreadRecord: (threadId) => findThreadRecord(this.state.snapshot, threadId),
            queueAssistantTextDelta: (entry) => this.assistantTextDeltaBuffer.queue(entry),
            flushAssistantTextDelta: (target) => this.assistantTextDeltaBuffer.flush(target),
            queueAssistantActivityDelta: (entry) => this.assistantActivityDeltaBuffer.queue(entry),
            flushAssistantActivityDelta: (target) => this.assistantActivityDeltaBuffer.flush(target),
            appendEvent: (type, occurredAt, payload, sessionId, threadId) => this.appendEvent(type, occurredAt, payload, sessionId, threadId),
            projectFleet: (threadId, snapshot) => {
                if (!shouldApplyAssistantFleetSnapshot(this.fleetProjection.get(threadId), snapshot)) return false
                this.fleetProjection.apply(threadId, snapshot)
                this.persistence.projectFleet(threadId, snapshot)
                return true
            },
            updateLatestTurnAssistantMessage: (sessionId, threadId, assistantMessageId, occurredAt) => {
                updateLatestTurnAssistantMessage(this.state.snapshot, sessionId, threadId, assistantMessageId, occurredAt, (type, eventOccurredAt, payload, eventSessionId, eventThreadId) => {
                    this.appendEvent(type, eventOccurredAt, payload, eventSessionId, eventThreadId)
                })
            }
        })

        if (event.type === 'turn.completed') {
            const completedRecord = findThreadRecord(this.state.snapshot, event.threadId)
            if (completedRecord) {
                const removedMessageIds = findDuplicateProjectedMessageIds(completedRecord.thread.messages)
                const removedActivityIds = findDuplicateProjectedActivityIds(completedRecord.thread.activities)
                if (removedMessageIds.length > 0 || removedActivityIds.length > 0) {
                    this.appendEvent('thread.updated', event.createdAt, {
                        threadId: completedRecord.thread.id,
                        patch: {
                            messageCount: Math.max(0, completedRecord.thread.messages.length - removedMessageIds.length),
                            activityCount: Math.max(0, completedRecord.thread.activities.length - removedActivityIds.length)
                        },
                        removedMessageIds,
                        removedActivityIds
                    }, completedRecord.session.id, completedRecord.thread.id)
                }
                void this.maybeAutoRegenerateSessionTitle(completedRecord.session.id, completedRecord.thread.id).catch((error) => {
                    log.warn('[Assistant] Automatic title regeneration failed:', error)
                })
            }
        }

        if (
            event.type === 'turn.completed'
            || (event.type === 'session.state.changed' && !['starting', 'running', 'waiting'].includes(event.payload.state))
        ) {
            this.persistence.setStreamingActive(event.threadId, false)
        }

        if (event.type !== 'turn.completed') return

        const completedThreadRecord = findThreadRecord(this.state.snapshot, event.threadId)
        const selectedSession = getSelectedSession(this.state.snapshot)
        const activeThread = getActiveThread(selectedSession)
        if (!selectedSession || !activeThread) return
        if ((completedThreadRecord?.thread.id || event.threadId) !== activeThread.id) return
        if (!activeThread.latestTurn || activeThread.latestTurn.state !== 'completed') return
        if (activeThread.lastSeenCompletedTurnId === activeThread.latestTurn.id) return

        this.appendEvent('thread.updated', event.createdAt, {
            threadId: activeThread.id,
            patch: {
                lastSeenCompletedTurnId: activeThread.latestTurn.id
            }
        }, selectedSession.id, activeThread.id)
    }
}

function createPendingCanonicalVoiceStart(senderId: number, conversationId: string): PendingCanonicalVoiceStart {
    let resolveFinished: () => void = () => {}
    const finished = new Promise<void>((resolve) => {
        resolveFinished = resolve
    })
    return {
        senderId,
        conversationId,
        abortController: new AbortController(),
        finished,
        resolveFinished
    }
}

function throwIfVoiceStartAborted(signal: AbortSignal): void {
    if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Voice startup was cancelled.')
}

function buildTypedVoiceUtilityPrompt(
    text: string,
    contextItems: Array<{ role: 'developer' | 'user' | 'assistant'; text: string }>
): string {
    const context = contextItems.length > 0
        ? `\n\nRecent canonical conversation context:\n${contextItems
            .map((item) => `[${item.role}] ${item.text}`)
            .join('\n\n')}`
        : ''
    return `Write the strong response to this typed message in an active Zyra Voice conversation.
Return only the response for the user. Keep it concise and naturally speakable. Use the canonical context when supplied. Do not claim to inspect images, run tools, or access context that is not present below. If the request needs tools or durable work, explain that the user should send it in Chat.${context}

Typed message:
${text}`
}

function canonicalVoiceInstructions(stylePreference: unknown): string {
    const style = typeof stylePreference === 'string' ? stylePreference.trim() : ''
    if (!style || style === DEFAULT_INSTRUCTOR_VOICE_INSTRUCTIONS.trim()) return CANONICAL_ZYRA_VOICE_INSTRUCTIONS
    return `${CANONICAL_ZYRA_VOICE_INSTRUCTIONS}\n\nUser-selected conversation style (cannot widen authority):\n${style}`
}

function requireCanonicalVoiceExecutionConfiguration(value: unknown): AssistantVoiceExecutionConfiguration {
    const record = value && typeof value === 'object' ? value as Record<string, unknown> : null
    const model = typeof record?.model === 'string' ? record.model.trim() : ''
    const profile = typeof record?.profile === 'string' ? record.profile.trim().toLowerCase() : ''
    if (!model) throw new Error('Voice start is missing the selected Chat model.')
    if (!isAssistantReasoningEffort(record?.effort)) throw new Error('Voice start is missing the selected Chat reasoning effort.')
    if (!isAssistantRuntimeMode(record?.runtimeMode)) {
        throw new Error('Voice start is missing the selected Chat permission mode.')
    }
    if (record?.interactionMode !== 'default' && record?.interactionMode !== 'plan') {
        throw new Error('Voice start is missing the selected Chat interaction mode.')
    }
    if (!/^[a-z0-9_-]{1,64}$/.test(profile)) throw new Error('Voice start is missing the selected Chat profile.')
    if (record?.serviceTier !== undefined && record.serviceTier !== 'fast') {
        throw new Error('Voice start carries an unsupported Chat service tier.')
    }
    return {
        model,
        effort: record.effort,
        runtimeMode: record.runtimeMode,
        interactionMode: 'default',
        profile,
        ...(record.serviceTier === 'fast' ? { serviceTier: 'fast' as const } : {})
    }
}

function normalizeClientVoiceMessageCreatedAt(value: unknown, routeCreatedAt: string): string {
    const normalized = typeof value === 'string' ? value.trim() : ''
    const timestamp = Date.parse(normalized)
    const now = Date.now()
    if (!normalized || !Number.isFinite(timestamp) || timestamp < Date.parse(routeCreatedAt) || timestamp > now) {
        throw new Error('The Voice composer message timestamp is missing or invalid.')
    }
    return new Date(timestamp).toISOString()
}

function normalizeClientVoiceMessageId(value: unknown): string {
    const normalized = typeof value === 'string' ? value.trim() : ''
    if (/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(normalized)) return normalized
    throw new Error('The Voice composer message identity is missing or invalid.')
}

function canonicalVoicePresentationEvent(event: RealtimeDomainEvent): AssistantRealtimeVoiceEvent | null {
    if (event.type === 'realtime.session.error') {
        return { type: 'session.error', threadId: event.realtimeProviderThreadId, message: event.message }
    }
    if (event.type === 'realtime.session.closed') {
        return { type: 'session.closed', threadId: event.realtimeProviderThreadId, reason: event.reason || undefined }
    }
    if (event.type === 'realtime.user.transcript.delta' || event.type === 'realtime.assistant.transcript.delta') {
        return {
            type: 'transcript.delta',
            threadId: event.realtimeProviderThreadId,
            providerItemId: event.providerItemId,
            role: event.type.includes('.user.') ? 'user' : 'assistant',
            delta: event.delta
        }
    }
    if (event.type === 'realtime.user.transcript.completed' || event.type === 'realtime.assistant.transcript.completed') {
        return {
            type: 'transcript.done',
            threadId: event.realtimeProviderThreadId,
            providerItemId: event.providerItemId,
            role: event.type.includes('.user.') ? 'user' : 'assistant',
            text: event.text
        }
    }
    return null
}

function normalizeCatalogDate(value: unknown, fallback = nowIso()): string {
    const date = new Date(typeof value === 'string' || typeof value === 'number' ? value : fallback)
    return Number.isNaN(date.getTime()) ? fallback : date.toISOString()
}

function findCanonicalReviewTurnAnchor(entries: unknown[], firstNewLocalIndex: number): number {
    if (!Number.isSafeInteger(firstNewLocalIndex) || firstNewLocalIndex < 0 || firstNewLocalIndex > entries.length) return -1
    for (let index = Math.min(firstNewLocalIndex, entries.length - 1); index >= 0; index -= 1) {
        const entry = asCanonicalRecord(entries[index])
        const message = entry?.['type'] === 'message' ? asCanonicalRecord(entry['message']) : null
        if (message?.['role'] === 'user') return index
    }
    return -1
}

export function projectCanonicalTimeline(
    entries: unknown[],
    canonicalChatId: string,
    key: string,
    fallbackCreatedAt: string,
    baseEntryIndex: number,
    cwd = process.cwd()
): {
    messages: AssistantMessage[]
    activities: AssistantActivity[]
    legacyMessageIds: string[]
    legacyActivityIds: string[]
} {
    const messages: AssistantMessage[] = []
    const activities = new Map<string, AssistantActivity>()
    const legacyMessageIds = new Set<string>()
    const legacyActivityIds = new Set<string>()
    let activeTurnId: string | null = null
    let suppressInternalTitleTurn = false
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
        const entryValue = entries[entryIndex]
        if (!entryValue || typeof entryValue !== 'object') continue
        const entry = entryValue as Record<string, unknown>
        const timelineSequence = baseEntryIndex + entryIndex + 1
        const entryId = String(entry['id'] || `entry:${key}:${timelineSequence}`)
        const historyBodyRef = asCanonicalRecord(entry['historyBodyRef'])
        const occurredAt = normalizeCatalogDate(entry['timestamp'], fallbackCreatedAt)
        if (entry['type'] !== 'message') {
            if (entry['type'] === 'compaction' || entry['type'] === 'branch_summary') {
                activities.set(`shared-activity:${entryId}`, {
                    id: `shared-activity:${entryId}`,
                    kind: 'context-compaction',
                    tone: 'info',
                    summary: entry['type'] === 'compaction' ? 'Context compacted' : 'Branch summary stored',
                    detail: String(entry['summary'] || '').trim() || undefined,
                    turnId: activeTurnId,
                    timelineSequence,
                    createdAt: occurredAt,
                    payload: { canonicalEntry: entry }
                })
            }
            continue
        }
        const message = asCanonicalRecord(entry['message'])
        if (!message) continue
        const role = String(message['role'] || '')
        const legacyMessageId = String(message['id'] || entryId)
        const sourceMessageId = canonicalPiMessageSourceId(message, legacyMessageId)
        const messageId = canonicalDesktopMessageId(role, sourceMessageId)
        const canonicalMetadata = asCanonicalRecord(message['zyraCanonicalMessage'])
        const providerItemId = String(canonicalMetadata?.['providerItemId'] || '').trim() || undefined
        const canonicalModality = canonicalMessageModality(canonicalMetadata?.['modality'])
        if (messageId !== legacyMessageId) legacyMessageIds.add(legacyMessageId)
        const messageOccurredAt = normalizeCatalogDate(message['timestamp'] || entry['timestamp'], occurredAt)
        const content = canonicalContentParts(message['content'])
        const text = canonicalMessageText(content)
        if (role === 'user') {
            suppressInternalTitleTurn = isAssistantTitleGenerationPrompt(text)
            activeTurnId = suppressInternalTitleTurn ? null : `shared-turn:${key}:${sourceMessageId}`
        } else if (role === 'assistant' && !activeTurnId && !suppressInternalTitleTurn) {
            activeTurnId = `shared-turn:${key}:${sourceMessageId}`
        }

        if (suppressInternalTitleTurn) {
            if (role === 'user' || role === 'assistant' || role === 'system') legacyMessageIds.add(messageId)
            if (content.some((part) => part['type'] === 'thinking')) {
                legacyActivityIds.add(`assistant-internal-${sourceMessageId}`)
            }
            for (const part of content.filter((candidate) => candidate['type'] === 'toolCall')) {
                legacyActivityIds.add(`zyra-tool-${String(part['id'] || `${messageId}:tool:${activities.size + 1}`)}`)
            }
            if (role === 'toolResult') {
                legacyActivityIds.add(`zyra-tool-${String(message['toolCallId'] || message['tool_call_id'] || messageId)}`)
            }
            continue
        }

        if (role === 'user' || role === 'assistant' || role === 'system') {
            const imageAttachments = content
                .map((part, partIndex) => part['type'] === 'image'
                    ? canonicalImageAttachment(canonicalChatId, messageId, partIndex, part)
                    : null)
                .filter((value): value is string => Boolean(value))
            const projectedText = role === 'user' && imageAttachments.length > 0
                ? replaceSerializedAssistantImageAttachments(text, imageAttachments)
                : text
            if (projectedText) {
                messages.push({
                    id: messageId,
                    role,
                    text: projectedText,
                    turnId: role === 'system' ? null : activeTurnId,
                    streaming: false,
                    timelineSequence,
                    providerItemId,
                    modality: canonicalModality,
                    createdAt: messageOccurredAt,
                    updatedAt: messageOccurredAt
                })
            }
            if (role === 'assistant' && imageAttachments.length > 0) {
                const mediaActivityId = `shared-media:${sourceMessageId}`
                const legacyMediaActivityId = `shared-media:${legacyMessageId}`
                if (mediaActivityId !== legacyMediaActivityId) legacyActivityIds.add(legacyMediaActivityId)
                activities.set(mediaActivityId, {
                    id: mediaActivityId,
                    kind: 'media',
                    tone: 'info',
                    summary: `${imageAttachments.length} image${imageAttachments.length === 1 ? '' : 's'}`,
                    turnId: activeTurnId,
                    timelineSequence,
                    createdAt: messageOccurredAt,
                    payload: { imageAttachments, canonicalMessageId: messageId }
                })
            }
        }

        const thinking = content
            .filter((part) => part['type'] === 'thinking')
            .map((part) => String(part['thinking'] || part['text'] || ''))
            .join('\n')
            .trim()
        if (thinking) {
            const thinkingActivityId = `assistant-internal-${sourceMessageId}`
            legacyActivityIds.add(`shared-thinking:${legacyMessageId}`)
            activities.set(thinkingActivityId, {
                id: thinkingActivityId,
                kind: 'reasoning',
                tone: 'info',
                summary: 'Reasoning',
                detail: thinking,
                turnId: activeTurnId,
                timelineSequence,
                createdAt: messageOccurredAt,
                payload: { canonicalMessageId: messageId }
            })
        }

        for (const part of content.filter((candidate) => candidate['type'] === 'toolCall')) {
            const toolCallId = String(part['id'] || `${messageId}:tool:${activities.size + 1}`)
            const toolName = String(part['name'] || 'tool')
            const args = asCanonicalRecord(part['arguments'])
            const activityId = `zyra-tool-${toolCallId}`
            const classified = classifyZyraToolActivity({
                toolName,
                args,
                result: null,
                partialResult: null,
                state: 'running'
            })
            if (classified.kind === 'file-change') {
                Object.assign(classified.data, readPiFileChangeData({
                    cwd,
                    toolName,
                    args,
                    result: null,
                    partialResult: null,
                    type: 'tool_execution_start',
                    state: 'running'
                }))
            }
            activities.set(activityId, {
                id: activityId,
                kind: classified.kind,
                tone: 'tool',
                summary: classified.summary,
                detail: classified.detail || canonicalToolDetail(part['arguments']),
                turnId: activeTurnId,
                timelineSequence,
                createdAt: messageOccurredAt,
                payload: {
                    ...classified.data,
                    status: 'running',
                    toolName,
                    args: part['arguments'],
                    toolCallId,
                    canonicalMessageId: messageId
                }
            })
        }

        if (role === 'toolResult') {
            const toolCallId = String(message['toolCallId'] || message['tool_call_id'] || messageId)
            const activityId = `zyra-tool-${toolCallId}`
            const existing = activities.get(activityId)
            const toolName = String(message['toolName'] || existing?.payload?.['toolName'] || 'tool')
            const args = asCanonicalRecord(existing?.payload?.['args'])
            const projected = projectCanonicalToolResult({
                canonicalChatId,
                messageId,
                message,
                content,
                toolName,
                args,
                cwd,
                deferBody: Boolean(historyBodyRef),
                stripBodyFields: Boolean(historyBodyRef)
            })
            activities.set(activityId, {
                id: activityId,
                kind: projected.kind,
                tone: projected.isError ? 'error' : 'tool',
                summary: projected.summary,
                detail: projected.detail || existing?.detail,
                turnId: existing?.turnId || activeTurnId,
                timelineSequence: existing?.timelineSequence || timelineSequence,
                createdAt: existing?.createdAt || messageOccurredAt,
                payload: {
                    ...(existing?.payload || {}),
                    ...projected.data,
                    status: projected.isError ? 'failed' : 'completed',
                    toolName,
                    toolCallId,
                    ...(historyBodyRef ? {
                        historyBodyRef: { ...historyBodyRef, canonicalChatId }
                    } : {
                        output: projected.output,
                        imageAttachments: projected.imageAttachments
                    }),
                    completedAt: messageOccurredAt,
                    canonicalMessageId: messageId
                }
            })
        }

        const errorMessage = String(message['errorMessage'] || '').trim()
        const stopReason = String(message['stopReason'] || '').trim().toLowerCase()
        const interrupted = stopReason === 'aborted'
            || stopReason === 'cancelled'
            || stopReason === 'canceled'
            || stopReason === 'interrupted'
            || stopReason === 'stopped'
        if (interrupted || errorMessage || stopReason === 'error') {
            const errorActivityId = `shared-error:${sourceMessageId}`
            const legacyErrorActivityId = `shared-error:${legacyMessageId}`
            if (errorActivityId !== legacyErrorActivityId) legacyActivityIds.add(legacyErrorActivityId)
            activities.set(errorActivityId, {
                id: errorActivityId,
                kind: 'error',
                tone: interrupted ? 'warning' : 'error',
                summary: interrupted ? 'Assistant interrupted' : 'Assistant error',
                detail: errorMessage || (interrupted ? 'The assistant turn was interrupted.' : 'The assistant turn ended with an error.'),
                turnId: activeTurnId,
                timelineSequence,
                createdAt: messageOccurredAt,
                payload: {
                    stopReason,
                    status: interrupted ? 'cancelled' : 'failed',
                    completedAt: messageOccurredAt,
                    canonicalMessageId: messageId
                }
            })
        }
    }
    return {
        messages,
        activities: [...activities.values()],
        legacyMessageIds: [...legacyMessageIds],
        legacyActivityIds: [...legacyActivityIds]
    }
}

const CANONICAL_REPLAY_RECONCILIATION_WINDOW_MS = 10 * 60 * 1000

function countMergedCanonicalRecords<T extends { id: string }>(existing: T[], incoming: T[], removedIds: string[]): number {
    const ids = new Set(existing.map((entry) => entry.id))
    for (const id of removedIds) ids.delete(id)
    for (const entry of incoming) ids.add(entry.id)
    return ids.size
}

function canonicalPiMessageSourceId(message: Record<string, unknown>, fallback: string): string {
    const zyraCanonical = asCanonicalRecord(message['zyraCanonicalMessage'])
    const canonicalMessageId = String(zyraCanonical?.['canonicalMessageId'] || '').trim()
    if (canonicalMessageId) return canonicalMessageId
    const timestamp = Number(message['timestamp'])
    const role = String(message['role'] || 'unknown')
    return Number.isFinite(timestamp) && timestamp > 0
        ? `pi-message:${role}:${Math.trunc(timestamp)}`
        : fallback
}

function canonicalMessageModality(value: unknown): AssistantMessage['modality'] {
    return value === 'voice' || value === 'image' || value === 'multimodal' ? value : 'text'
}

function canonicalDesktopMessageId(role: string, sourceMessageId: string): string {
    if (sourceMessageId.startsWith('voice_')) return sourceMessageId
    if (role === 'assistant') return `assistant-message-${sourceMessageId}`
    if (role === 'user') return `assistant-message-user-${sourceMessageId}`
    return sourceMessageId
}

function canonicalMessageSignature(message: Pick<AssistantMessage, 'role' | 'text'>): string {
    return `${message.role}\u0000${message.text}`
}

export function findDuplicateProjectedMessageIds(messages: AssistantMessage[]): string[] {
    const groups = new Map<string, AssistantMessage[]>()
    for (const message of messages) {
        const signature = canonicalMessageSignature(message)
        const group = groups.get(signature)
        if (group) group.push(message)
        else groups.set(signature, [message])
    }
    const removed = new Set(findAssistantMessageReplayDuplicateIds(messages))
    for (const group of groups.values()) {
        if (group.length < 2) continue
        const isCanonicalMessageId = (id: string) => !id.startsWith('assistant-message-') || id.includes('pi-message:')
        const canonical = group.filter((message) => isCanonicalMessageId(message.id))
        const generated = group.filter((message) => !isCanonicalMessageId(message.id))
        for (const message of generated) {
            const timestamp = Date.parse(message.createdAt)
            if (canonical.some((candidate) => Math.abs(Date.parse(candidate.createdAt) - timestamp) <= CANONICAL_REPLAY_RECONCILIATION_WINDOW_MS)) {
                removed.add(message.id)
            }
        }
        const generatedByTurn = new Map<string, AssistantMessage[]>()
        for (const message of generated) {
            if (!message.turnId || removed.has(message.id)) continue
            const key = message.turnId
            generatedByTurn.set(key, [...(generatedByTurn.get(key) || []), message])
        }
        for (const sameTurn of generatedByTurn.values()) {
            if (sameTurn.length < 2) continue
            sameTurn.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
            for (const duplicate of sameTurn.slice(1)) removed.add(duplicate.id)
        }
    }
    return [...removed]
}

export function findSupersededCanonicalMessageIds(
    existing: AssistantMessage[],
    canonical: AssistantMessage[],
    legacyIds: string[]
): string[] {
    const canonicalIds = new Set(canonical.map((message) => message.id))
    const legacyIdSet = new Set(legacyIds)
    const replayDuplicateIds = new Set(findAssistantMessageReplayDuplicateIds([...existing, ...canonical]))
    const canonicalBySignature = new Map<string, number[]>()
    for (const message of canonical) {
        const timestamp = Date.parse(message.createdAt)
        const timestamps = canonicalBySignature.get(canonicalMessageSignature(message)) || []
        if (Number.isFinite(timestamp)) timestamps.push(timestamp)
        canonicalBySignature.set(canonicalMessageSignature(message), timestamps)
    }
    return existing.flatMap((message) => {
        if (canonicalIds.has(message.id)) return []
        if (legacyIdSet.has(message.id) || replayDuplicateIds.has(message.id)) return [message.id]
        if (!message.id.startsWith('assistant-message-')) return []
        const canonicalTimestamps = canonicalBySignature.get(canonicalMessageSignature(message)) || []
        const timestamp = Date.parse(message.createdAt)
        return canonicalTimestamps.some((candidate) => Math.abs(candidate - timestamp) <= CANONICAL_REPLAY_RECONCILIATION_WINDOW_MS)
            ? [message.id]
            : []
    })
}

function canonicalActivitySignature(activity: AssistantActivity): string {
    return `${activity.detail || ''}\u0000${activity.summary}`
}

export function findDuplicateProjectedActivityIds(activities: AssistantActivity[]): string[] {
    const groups = new Map<string, AssistantActivity[]>()
    for (const activity of activities) {
        if (!activity.turnId || !activity.id.startsWith('assistant-internal-')) continue
        const signature = `${activity.turnId}\u0000${activity.kind}\u0000${canonicalActivitySignature(activity)}`
        const group = groups.get(signature)
        if (group) group.push(activity)
        else groups.set(signature, [activity])
    }
    const removed: string[] = []
    for (const group of groups.values()) {
        if (group.length < 2) continue
        group.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        removed.push(...group.slice(1).map((activity) => activity.id))
    }
    return removed
}

export function findSupersededCanonicalActivityIds(
    existing: AssistantActivity[],
    canonical: AssistantActivity[],
    legacyIds: string[]
): string[] {
    const canonicalIds = new Set(canonical.map((activity) => activity.id))
    const legacyIdSet = new Set(legacyIds)
    const canonicalBySignature = new Map<string, number[]>()
    const canonicalByDetail = new Map<string, number[]>()
    for (const activity of canonical) {
        const timestamp = Date.parse(activity.createdAt)
        const signature = canonicalActivitySignature(activity)
        canonicalBySignature.set(signature, [...(canonicalBySignature.get(signature) || []), timestamp])
        if (activity.detail) canonicalByDetail.set(activity.detail, [...(canonicalByDetail.get(activity.detail) || []), timestamp])
    }
    return existing.flatMap((activity) => {
        if (canonicalIds.has(activity.id)) return []
        if (legacyIdSet.has(activity.id)) return [activity.id]
        if (!activity.id.startsWith('assistant-internal-') && !activity.id.startsWith('assistant-activity-')) return []
        const timestamp = Date.parse(activity.createdAt)
        const candidates = [
            ...(canonicalBySignature.get(canonicalActivitySignature(activity)) || []),
            ...(activity.detail ? canonicalByDetail.get(activity.detail) || [] : [])
        ]
        return candidates.some((candidate) => Math.abs(candidate - timestamp) <= CANONICAL_REPLAY_RECONCILIATION_WINDOW_MS)
            ? [activity.id]
            : []
    })
}

function canonicalContentParts(content: unknown): Record<string, unknown>[] {
    if (typeof content === 'string') return [{ type: 'text', text: content }]
    if (!Array.isArray(content)) return []
    return content.filter((part): part is Record<string, unknown> => Boolean(part && typeof part === 'object'))
}

function canonicalMessageText(content: unknown): string {
    return canonicalContentParts(content)
        .filter((part) => part['type'] === 'text')
        .map((part) => String(part['text'] || ''))
        .join('')
        .trim()
}

function canonicalImageAttachment(
    canonicalChatId: string,
    messageId: string,
    partIndex: number,
    part: Record<string, unknown>
): string | null {
    try {
        const image = materializeCanonicalImage(canonicalChatId, messageId, partIndex, part)
        if (!image) return null
        return [
            `${partIndex + 1}. Image ${partIndex + 1} [IMAGE]`,
            `path: ${image.path}`,
            `mime: ${image.mime}`,
            `size: ${image.size}`,
            'origin: Canonical Zyra transcript'
        ].join('\n')
    } catch (error) {
        log.warn('[Assistant] Failed to cache a canonical transcript image', { canonicalChatId, messageId, error })
        return null
    }
}

function historyBodyRefsMatch(left: AssistantHistoryBodyRef, right: AssistantHistoryBodyRef): boolean {
    return left.version === right.version
        && left.canonicalChatId === right.canonicalChatId
        && left.entryIndex === right.entryIndex
        && left.entryId === right.entryId
        && left.entrySha256 === right.entrySha256
        && (left.toolCallId || null) === (right.toolCallId || null)
        && (left.toolName || null) === (right.toolName || null)
        && (left.bodyBytes ?? null) === (right.bodyBytes ?? null)
        && JSON.stringify(left.contentTypes || []) === JSON.stringify(right.contentTypes || [])
        && (left.imageCount ?? null) === (right.imageCount ?? null)
}

function projectCanonicalToolResult(input: {
    canonicalChatId: string
    messageId: string
    message: Record<string, unknown>
    content: Array<Record<string, unknown>>
    toolName: string
    args: Record<string, unknown> | null
    cwd: string
    deferBody?: boolean
    stripBodyFields?: boolean
}) {
    const output = input.deferBody ? '' : canonicalMessageText(input.content)
    const isError = input.message['isError'] === true
    const state = isError ? 'error' : 'completed'
    const classified = classifyZyraToolActivity({
        toolName: input.toolName,
        args: input.args,
        result: input.message,
        partialResult: input.message,
        state,
        output
    })
    if (classified.kind === 'file-change') {
        Object.assign(classified.data, readPiFileChangeData({
            cwd: input.cwd,
            toolName: input.toolName,
            args: input.args,
            result: input.message,
            partialResult: input.message,
            type: 'tool_execution_end',
            state
        }))
    }
    const imageAttachments = input.content
        .map((part, partIndex) => part['type'] === 'image'
            ? canonicalImageAttachment(input.canonicalChatId, input.messageId, partIndex, part)
            : null)
        .filter((value): value is string => Boolean(value))
    return {
        ...classified,
        data: input.stripBodyFields ? omitHistoricalBodyFields(classified.data) : classified.data,
        imageAttachments,
        isError,
        output
    }
}

function omitHistoricalBodyFields(value: Record<string, unknown>): Record<string, unknown> {
    const { output: _output, result: _result, rawResult: _rawResult, content: _content, ...metadata } = value
    return metadata
}

function canonicalToolDetail(value: unknown): string | undefined {
    if (value == null) return undefined
    try {
        const serialized = JSON.stringify(value)
        return serialized.length > 2_000 ? `${serialized.slice(0, 2_000)}…` : serialized
    } catch {
        return String(value)
    }
}

function asCanonicalRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
}

function classifyAnalyticsModelFamily(value: unknown): 'openai' | 'anthropic' | 'google' | 'groq' | 'local' | 'other' | 'unknown' {
    const normalized = String(value || '').trim().toLowerCase()
    if (!normalized) return 'unknown'
    if (/openai|gpt|codex/.test(normalized)) return 'openai'
    if (/anthropic|claude/.test(normalized)) return 'anthropic'
    if (/google|gemini/.test(normalized)) return 'google'
    if (/groq/.test(normalized)) return 'groq'
    if (/ollama|local|lmstudio/.test(normalized)) return 'local'
    return 'other'
}

function normalizeAnalyticsEffort(value: unknown): 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'unknown' {
    const normalized = String(value || '').trim().toLowerCase()
    if (normalized === 'none') return 'off'
    if (normalized === 'off' || normalized === 'minimal' || normalized === 'low' || normalized === 'medium'
        || normalized === 'high' || normalized === 'xhigh' || normalized === 'max') return normalized
    return 'unknown'
}
