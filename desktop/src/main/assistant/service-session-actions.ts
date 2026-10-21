import log from 'electron-log'
import type { AssistantUserInputResponseInput } from '../../shared/assistant/contracts'
import type {
    AssistantClearLogsInput,
    AssistantConnectOptions,
    AssistantCreateSessionInput,
    AssistantDeleteMessageInput,
    AssistantGetSessionTurnUsageInput,
    AssistantRuntimeStatus,
    AssistantSendPromptOptions,
    AssistantSession,
    AssistantSessionTurnUsagePayload,
    AssistantThread
} from '../../shared/assistant/contracts'
import {
    parseDevContextCompactionTestCommand,
    type AssistantDevContextCompactionTestCommand
} from '../../shared/assistant/dev-context-compaction-test'
import {
    isAssistantSessionProjectLocked,
    isAssistantThreadProjectWarmupOnly
} from '../../shared/assistant/session-project'
import { normalizeAssistantRuntimePolicy } from '../../shared/assistant/runtime-policy'
import { isAssistantReasoningEffort } from '../../shared/assistant/reasoning-efforts'
import { is } from '../utils'
import { prepareAssistantPromptImages, type PreparedAssistantPromptImage } from './prompt-images'
import { isCanonicalPresenceActive } from './service-canonical-presence'
import { leaveAssistantThreadForNavigation } from './service-navigation-runtime'
import { buildDeleteMessagePlan } from './service-history'
import { createAssistantSessionRecord, createAssistantUserMessage, createRunningLatestTurn } from './service-records'
import type { AssistantServiceActionDeps } from './service-action-deps'
import {
    buildDeletedSessionReplacementInput,
    ensureAssistantSessionSelectionAfterDeletion
} from './service-session-delete-fallback'
import { resolveAssistantSessionRoute } from './service-session-route'
import {
    createAssistantThread,
    findThreadForApproval,
    findThreadForUserInput,
    getActiveThread,
    getSelectedSession,
    isClearableIssueActivity,
    requireActiveThread,
    requireSession
} from './service-state'
import { buildSessionHistoryMutationResult } from './session-mutation-utils'
import { awaitCanonicalSessionTitleSaves, commitAssistantSessionTitle } from './session-title-updates'
import { getAssistantCanonicalThreadId, matchesAssistantThreadId } from './thread-identity'
import { respondToAssistantUserInputWithRuntime } from './user-input-response'
import {
    createAssistantId,
    deriveSessionTitleFromPrompt,
    isDefaultSessionTitle,
    nowIso,
    sanitizeOptionalPath
} from './utils'

const activeUserInputResponses = new WeakMap<AssistantServiceActionDeps, Set<string>>()
const pendingPromptSubmissions = new WeakMap<AssistantServiceActionDeps, Map<string, { turnId: string; cancelled: boolean }>>()

async function connectAssistantSessionRuntime(
    deps: AssistantServiceActionDeps,
    session: AssistantSession,
    thread: AssistantThread
): Promise<void> {
    if (deps.connectSessionRuntime) {
        await deps.connectSessionRuntime(session, thread)
        return
    }
    const pluginSkillSources = deps.getSessionPluginSkillSources
        ? await deps.getSessionPluginSkillSources(session)
        : []
    await deps.runtime.connect(
        thread,
        deps.getSessionRuntimeCwd(session, thread),
        session.chatScope,
        pluginSkillSources
    )
}

export async function connectAssistantSession(deps: AssistantServiceActionDeps, options?: AssistantConnectOptions) {
    await deps.ensureReady()
    const snapshot = deps.getSnapshot()
    const session = options?.sessionId
        ? requireSession(snapshot, options.sessionId)
        : getSelectedSession(snapshot)
    if (!session) throw new Error('Assistant session not found.')
    const thread = requireActiveThread(session)
    const preparationModel = thread.model || await deps.getNewChatPreparationModel?.()
    await connectAssistantSessionRuntime(deps, session, preparationModel ? { ...thread, model: preparationModel } : thread)
    return { success: true as const, threadId: thread.id }
}

export async function disconnectAssistantSession(deps: AssistantServiceActionDeps, sessionId?: string) {
    await deps.ensureReady()
    const session = sessionId
        ? requireSession(deps.getSnapshot(), sessionId)
        : getSelectedSession(deps.getSnapshot())
    if (!session) return { success: true as const }
    const thread = requireActiveThread(session)
    deps.runtime.disconnect(getAssistantCanonicalThreadId(thread))
    return { success: true as const }
}

export async function createAssistantSessionAction(
    deps: AssistantServiceActionDeps,
    input?: AssistantCreateSessionInput,
    options: { sessionId?: string } = {}
) {
    await deps.ensureReady()
    const previousThread = getActiveThread(getSelectedSession(deps.getSnapshot()))
    if (previousThread && input?.select !== false) leaveAssistantThreadForNavigation(deps, previousThread)
    const createdAt = nowIso()
    const sessionId = options.sessionId || createAssistantId('assistant-session')
    const route = resolveAssistantSessionRoute({
        projectPath: input?.projectPath,
        mode: input?.mode,
        playgroundLabId: input?.playgroundLabId,
        playground: deps.getSnapshot().playground
    })
    const projectPath = route.projectPath
    const defaults = await deps.getNewChatExecutionDefaults()
    const thread = createAssistantThread(createdAt, null, projectPath || null, defaults)
    if (input?.composer) {
        if (typeof input.composer.model !== 'string' || !isAssistantReasoningEffort(input.composer.effort)
            || !['approval-required', 'auto-review', 'edits-only', 'full-access'].includes(input.composer.runtimeMode)) throw new Error('Invalid new-chat composer choices.')
        thread.model = input.composer.model.trim()
        thread.thinking = input.composer.effort
        thread.runtimeMode = input.composer.runtimeMode
    }
    const session = createAssistantSessionRecord({
        sessionId,
        title: input?.title?.trim() || 'New Session',
        mode: route.mode,
        projectPath,
        playgroundLabId: route.playgroundLabId,
        createdAt,
        thread
    })
    thread.cwd = deps.getSessionRuntimeCwd(session, thread)
    deps.appendEvent('session.created', createdAt, { session }, sessionId, thread.id)
    if (input?.select !== false) deps.appendEvent('session.selected', createdAt, { sessionId }, sessionId, thread.id)
    // Draft creation happens while composing. Prepare the selected local
    // transport without attaching a chat or delaying the creation response.
    if (deps.runtime.prepareChatRuntime) {
        void Promise.resolve(deps.getNewChatPreparationModel?.())
            .then(model => deps.runtime.prepareChatRuntime!(thread.model || model || null))
            .catch((error) => { log.warn('[Assistant] Chat runtime preparation failed:', error) })
    }
    return { success: true as const, sessionId }
}

export async function selectAssistantSessionAction(deps: AssistantServiceActionDeps, sessionId: string) {
    await deps.ensureReady()
    const snapshot = deps.getSnapshot()
    requireSession(snapshot, sessionId)
    const previousSession = getSelectedSession(snapshot)
    const previousThread = getActiveThread(previousSession)
    if (previousSession?.id !== sessionId && previousThread) {
        leaveAssistantThreadForNavigation(deps, previousThread)
    }
    const occurredAt = nowIso()
    deps.appendEvent('session.selected', occurredAt, { sessionId }, sessionId)
    const session = requireSession(deps.getSnapshot(), sessionId)
    if (session.activeThreadId) deps.runtime.setNavigationBackgrounded?.(session.activeThreadId, false)
    return { success: true as const, sessionId }
}

export async function selectAssistantThreadAction(deps: AssistantServiceActionDeps, sessionId: string, threadId: string) {
    await deps.ensureReady()
    const snapshot = deps.getSnapshot()
    const previousThread = getActiveThread(getSelectedSession(snapshot))
    const session = requireSession(snapshot, sessionId)
    const selectedThread = session.threads.find((thread) => matchesAssistantThreadId(thread, threadId)) || null
    if (!selectedThread) {
        throw new Error(`Assistant thread ${threadId} does not belong to session ${sessionId}.`)
    }

    const localThreadId = selectedThread.id
    if (previousThread && previousThread.id !== localThreadId) {
        leaveAssistantThreadForNavigation(deps, previousThread)
    }
    const occurredAt = nowIso()
    deps.appendEvent('session.updated', occurredAt, {
        sessionId,
        patch: {
            activeThreadId: localThreadId
        }
    }, session.id, localThreadId)
    if (deps.getSnapshot().selectedSessionId !== sessionId) {
        deps.appendEvent('session.selected', occurredAt, { sessionId }, session.id, localThreadId)
    }
    deps.runtime.setNavigationBackgrounded?.(localThreadId, false)
    return { success: true as const, sessionId, threadId: localThreadId }
}

export async function renameAssistantSessionAction(deps: AssistantServiceActionDeps, sessionId: string, title: string, expectedTitle?: string) {
    await deps.ensureReady()
    return commitAssistantSessionTitle(sessionId, async () => {
        const session = requireSession(deps.getSnapshot(), sessionId)
        if (expectedTitle !== undefined && session.title !== expectedTitle) throw new Error('The Chat title changed before this rename. Read it again.')
        const nextTitle = title.trim() || session.title
        await awaitCanonicalSessionTitleSaves(session.threads
            .map((thread) => thread.providerThreadId)
            .filter((threadId): threadId is string => Boolean(threadId))
            .map((threadId) => deps.runtime.updateCanonicalChat(threadId, { title: nextTitle, ...(expectedTitle !== undefined ? { expectedTitle } : {}) })))
        const occurredAt = nowIso()
        deps.appendEvent('session.updated', occurredAt, {
            sessionId,
            patch: {
                title: nextTitle,
                titleManuallySet: true,
                updatedAt: occurredAt
            }
        }, sessionId)
        return { success: true as const }
    })
}

export async function archiveAssistantSessionAction(deps: AssistantServiceActionDeps, sessionId: string, archived = true) {
    await deps.ensureReady()
    const session = requireSession(deps.getSnapshot(), sessionId)
    const canonicalThreadIds = [...new Set(session.threads
        .map((thread) => thread.providerThreadId)
        .filter((threadId): threadId is string => Boolean(threadId)))]
    await Promise.all(canonicalThreadIds.map((threadId) => deps.runtime.updateCanonicalChat(threadId, { archived })))
    const occurredAt = nowIso()
    deps.appendEvent('session.updated', occurredAt, {
        sessionId,
        patch: {
            archived,
            updatedAt: occurredAt
        }
    }, sessionId)
    return { success: true as const }
}

export async function deleteAssistantSessionAction(deps: AssistantServiceActionDeps, sessionId: string) {
    await deps.ensureReady()
    const session = requireSession(deps.getSnapshot(), sessionId)
    const canonicalThreadIds = [...new Set(session.threads
        .map((thread) => thread.providerThreadId)
        .filter((threadId): threadId is string => Boolean(threadId)))]
    await Promise.all(canonicalThreadIds.map((threadId) => deps.runtime.updateCanonicalChat(threadId, { deleted: true })))
    for (const thread of session.threads) {
        deps.runtime.disconnect(getAssistantCanonicalThreadId(thread))
    }
    const occurredAt = nowIso()
    deps.appendEvent('session.deleted', occurredAt, { sessionId }, sessionId)
    await ensureAssistantSessionSelectionAfterDeletion(deps, session, {
        replacementInput: buildDeletedSessionReplacementInput(session)
    })
    return { success: true as const }
}

export async function clearAssistantLogsAction(deps: AssistantServiceActionDeps, input?: AssistantClearLogsInput) {
    await deps.ensureReady()
    const session = input?.sessionId
        ? requireSession(deps.getSnapshot(), input.sessionId)
        : requireSession(deps.getSnapshot(), deps.getSnapshot().selectedSessionId || '')
    const thread = requireActiveThread(session)
    const occurredAt = nowIso()

    const keptActivities = thread.activities.filter((activity) => !isClearableIssueActivity(activity))
    const keptActivityIds = new Set(keptActivities.map((activity) => activity.id))
    deps.appendEvent('thread.updated', occurredAt, {
        threadId: thread.id,
        patch: {
            activities: keptActivities,
            updatedAt: occurredAt
        },
        removedActivityIds: thread.activities.filter((activity) => !keptActivityIds.has(activity.id)).map((activity) => activity.id)
    }, session.id, thread.id)

    return { success: true as const }
}

export async function deleteAssistantMessageAction(deps: AssistantServiceActionDeps, input: AssistantDeleteMessageInput) {
    await deps.ensureReady()
    const session = input?.sessionId
        ? requireSession(deps.getSnapshot(), input.sessionId)
        : requireSession(deps.getSnapshot(), deps.getSnapshot().selectedSessionId || '')
    const thread = requireActiveThread(session)
    const occurredAt = nowIso()
    const deletePlan = buildDeleteMessagePlan(thread, input.messageId, occurredAt)

    if (deletePlan.rollbackTurnCount) {
        try {
            await deps.runtime.rollbackThread(getAssistantCanonicalThreadId(thread), deletePlan.rollbackTurnCount)
        } catch (error) {
            log.warn('[Assistant] rollbackThread failed during deleteMessage; applying local message delete only', error)
        }
    }

    const pendingLabRequest = session.pendingLabRequest
    const { startCreatedAt, endCreatedAt } = deletePlan.deletedWindow
    const shouldClearPendingLabRequest = Boolean(
        pendingLabRequest
        && pendingLabRequest.createdAt >= startCreatedAt
        && (!endCreatedAt || pendingLabRequest.createdAt < endCreatedAt)
    )
    const nextThread: AssistantThread = {
        ...thread,
        ...deletePlan.patch,
        messageCount: deletePlan.patch.messages.length,
        activityCount: deletePlan.patch.activities.length,
        proposedPlanCount: deletePlan.patch.proposedPlans.length
    }
    const sessionHistoryMutation = buildSessionHistoryMutationResult({
        session,
        mutatedThread: nextThread
    })

    if (sessionHistoryMutation.deleteSession) {
        deps.runtime.disconnect(getAssistantCanonicalThreadId(thread))
        deps.appendEvent('session.deleted', occurredAt, { sessionId: session.id }, session.id)
        await ensureAssistantSessionSelectionAfterDeletion(deps, session, {
            replacementInput: buildDeletedSessionReplacementInput(session)
        })
        return { success: true as const }
    }

    deps.appendEvent('thread.updated', occurredAt, {
        threadId: thread.id,
        patch: {
            activePlan: deletePlan.patch.activePlan,
            lastSeenCompletedTurnId: deletePlan.patch.lastSeenCompletedTurnId,
            latestTurn: deletePlan.patch.latestTurn,
            state: deletePlan.patch.state,
            lastError: deletePlan.patch.lastError,
            updatedAt: deletePlan.patch.updatedAt,
            messageCount: nextThread.messageCount,
            activityCount: nextThread.activityCount,
            proposedPlanCount: nextThread.proposedPlanCount
        },
        removedTurnIds: deletePlan.removedTurnIds,
        removedMessageIds: deletePlan.removedMessageIds,
        removedActivityIds: deletePlan.removedActivityIds,
        removedProposedPlanIds: deletePlan.removedProposedPlanIds,
        removedPendingApprovalIds: deletePlan.removedPendingApprovalIds,
        removedPendingUserInputIds: deletePlan.removedPendingUserInputIds
    }, session.id, thread.id)

    const sessionPatch: Record<string, unknown> = {
        ...(sessionHistoryMutation.patch || {})
    }
    if (shouldClearPendingLabRequest) {
        sessionPatch.pendingLabRequest = null
    }
    if (Object.keys(sessionPatch).length > 0) {
        deps.appendEvent('session.updated', occurredAt, {
            sessionId: session.id,
            patch: {
                ...sessionPatch,
                updatedAt: occurredAt
            }
        }, session.id, thread.id)
    }

    return { success: true as const }
}

export async function setAssistantSessionProjectPathAction(
    deps: AssistantServiceActionDeps,
    sessionId: string,
    projectPath: string | null
) {
    await deps.ensureReady()
    const snapshot = deps.getSnapshot()
    const session = requireSession(snapshot, sessionId)
    const route = resolveAssistantSessionRoute({
        projectPath,
        playground: snapshot.playground
    })
    if (route.projectPath === session.projectPath) {
        return { success: true as const }
    }
    if (isAssistantSessionProjectLocked(session)) {
        throw new Error('Finish or stop the active chat work before changing its project.')
    }
    const occurredAt = nowIso()
    for (const thread of session.threads) {
        const connectionOnlyWarmup = isAssistantThreadProjectWarmupOnly(thread)
        deps.runtime.disconnect(getAssistantCanonicalThreadId(thread))
        deps.appendEvent('thread.updated', occurredAt, {
            threadId: thread.id,
            patch: {
                cwd: route.projectPath,
                ...(connectionOnlyWarmup ? { state: 'ready' as const, lastError: null } : {}),
                updatedAt: occurredAt
            }
        }, sessionId, thread.id)
    }
    deps.appendEvent('session.updated', occurredAt, {
        sessionId,
        patch: {
            mode: route.mode,
            projectPath: route.projectPath,
            playgroundLabId: route.playgroundLabId,
            pendingLabRequest: null,
            updatedAt: occurredAt
        }
    }, sessionId)
    if (route.projectPath) {
        await Promise.allSettled(session.threads
            .map((thread) => thread.providerThreadId)
            .filter((threadId): threadId is string => Boolean(threadId))
            .map((threadId) => deps.runtime.updateCanonicalChat(threadId, {
                project: route.projectPath!,
                cwd: route.projectPath!
            })))
    }
    return { success: true as const }
}

export async function createAssistantThreadAction(deps: AssistantServiceActionDeps, sessionId?: string) {
    await deps.ensureReady()
    const snapshot = deps.getSnapshot()
    const session = sessionId
        ? requireSession(snapshot, sessionId)
        : getSelectedSession(snapshot)
    if (!session) throw new Error('Assistant session not found.')
    const previousThread = getActiveThread(session)
    if (previousThread) {
        leaveAssistantThreadForNavigation(deps, previousThread)
    }

    const createdAt = nowIso()
    const defaults = await deps.getNewChatExecutionDefaults()
    const thread = createAssistantThread(
        createdAt,
        previousThread,
        session.projectPath ?? previousThread?.cwd ?? null,
        defaults
    )
    deps.appendEvent('thread.created', createdAt, { sessionId: session.id, thread }, session.id, thread.id)
    deps.appendEvent('session.updated', createdAt, {
        sessionId: session.id,
        patch: {
            activeThreadId: thread.id,
            updatedAt: createdAt
        }
    }, session.id, thread.id)
    return { success: true as const, threadId: thread.id }
}

function buildDevContextCompactionTestActivity(input: {
    command: AssistantDevContextCompactionTestCommand
    markerId: string
    status: 'running' | 'completed'
    turnId: string
    createdAt: string
    completedAt?: string
}): AssistantThread['activities'][number] {
    const summary = input.status === 'running' ? 'AUTO-COMPACTING' : 'AUTO-COMPACTED'
    return {
        id: `context-compaction-dev-${input.markerId}`,
        kind: 'context.compaction',
        tone: 'tool',
        summary,
        detail: 'Dev-only context compaction marker test.',
        turnId: input.turnId,
        createdAt: input.createdAt,
        payload: {
            category: 'context-compaction',
            itemType: 'context compaction',
            status: input.status,
            sourceMethod: 'dev-prompt-flag',
            protocol: 'dev-context-compaction-test',
            devOnly: true,
            markerId: input.markerId,
            holdMs: input.command.holdMs,
            completedAt: input.completedAt
        }
    }
}

function triggerDevContextCompactionTestPrompt(
    deps: AssistantServiceActionDeps,
    sessionId: string,
    thread: AssistantThread,
    command: AssistantDevContextCompactionTestCommand,
    occurredAt: string
) {
    const turnId = createAssistantId('assistant-turn')
    const markerId = command.markerId || createAssistantId('context-compaction-test')
    const activityCreatedAt = occurredAt

    const appendActivity = (status: 'running' | 'completed', eventTime: string) => {
        deps.appendEvent('thread.activity.appended', eventTime, {
            threadId: thread.id,
            activity: buildDevContextCompactionTestActivity({
                command,
                markerId,
                status,
                turnId,
                createdAt: activityCreatedAt,
                completedAt: status === 'completed' ? eventTime : undefined
            })
        }, sessionId, thread.id)
    }

    deps.appendEvent('thread.updated', occurredAt, {
        threadId: thread.id,
        patch: { updatedAt: occurredAt }
    }, sessionId, thread.id)

    if (command.mode === 'completed') {
        appendActivity('completed', occurredAt)
    } else {
        appendActivity('running', occurredAt)
    }

    if (command.mode === 'cycle') {
        setTimeout(() => appendActivity('completed', nowIso()), command.holdMs)
    }

    return { success: true as const, sessionId, threadId: thread.id, turnId }
}

export async function sendAssistantPromptAction(
    deps: AssistantServiceActionDeps,
    prompt: string,
    options?: AssistantSendPromptOptions,
    preparedImages?: PreparedAssistantPromptImage[]
) {
    await deps.ensureReady()
    const input = String(prompt || '').trim()
    if (!input) throw new Error('Prompt is required.')

    const snapshot = deps.getSnapshot()
    const session = options?.sessionId
        ? requireSession(snapshot, options.sessionId)
        : getSelectedSession(snapshot)
    if (!session) throw new Error('Assistant session not found.')
    const thread = requireActiveThread(session)
    if (options?.dispatchMode === 'steer') {
        const targetTurnId = options.targetTurnId || thread.latestTurn?.id
        if (!targetTurnId || thread.latestTurn?.state !== 'running') throw new Error('The turn has ended. Send this message as a new turn instead.')
        if (!deps.runtime.steerPrompt) throw new Error('This runtime does not support steering. Use Send next instead.')
        const images = preparedImages ?? await prepareAssistantPromptImages(options.images)
        const result = await deps.runtime.steerPrompt(getAssistantCanonicalThreadId(thread), input, { targetTurnId, images: images.length ? images : undefined })
        const occurredAt = nowIso()
        const message = createAssistantUserMessage(input, occurredAt, options.userMessageId || createAssistantId('assistant-message'))
        message.turnId = result.turnId
        deps.appendEvent('thread.message.user', occurredAt, { threadId: thread.id, message }, session.id, thread.id)
        return { success: true as const, sessionId: session.id, threadId: thread.id, turnId: result.turnId }
    }
    // Check the canonical turn before persisting an optimistic user message.
    // A stale local busy flag is reconciled here; a genuinely running turn
    // rejects the prompt without adding an unsent duplicate to history.
    await deps.runtime.ensurePromptAvailable?.(getAssistantCanonicalThreadId(thread))
    const occurredAt = nowIso()
    const compactionTestCommand = parseDevContextCompactionTestCommand(input, { enabled: is.dev })
    if (compactionTestCommand) {
        return triggerDevContextCompactionTestPrompt(deps, session.id, thread, compactionTestCommand, occurredAt)
    }

    if (options?.startInNewWorktree !== undefined && typeof options.startInNewWorktree !== 'boolean') throw new Error('Invalid worktree choice.')
    if (options?.startInNewWorktree && await deps.getFirstUserMessageText(session.id)) throw new Error('Choose a new worktree before the first message in a chat.')
    const promptImages = preparedImages ?? await prepareAssistantPromptImages(options?.images)
    const runtimePolicy = normalizeAssistantRuntimePolicy(
        await deps.getRuntimePolicy?.().catch((error) => {
            log.warn('[Assistant] Failed to read the runtime policy preference', error)
            return undefined
        })
    )
    const hadNamedDraft = thread.messageCount === 0 && !isDefaultSessionTitle(session.title)
    const title = isDefaultSessionTitle(session.title) ? deriveSessionTitleFromPrompt(input) : session.title
    // Reconcile both directions. A selected user turn must not inherit a stale
    // background flag from a prior navigation or repaired catalog alias.
    deps.runtime.setNavigationBackgrounded?.(thread.id,
        getActiveThread(getSelectedSession(deps.getSnapshot()))?.id !== thread.id)
    if (title !== session.title) {
        deps.appendEvent('session.updated', occurredAt, {
            sessionId: session.id,
            patch: {
                title,
                updatedAt: occurredAt
            }
        }, session.id, thread.id)
    }

    const runtimeCwd = deps.getSessionRuntimeCwd(session, thread)
    const runtimeThreadId = getAssistantCanonicalThreadId(thread)
    // First Send can precede draft warmup. Resolve the saved default before
    // attachment so an empty new thread cannot select the engine fallback.
    const model = options?.model || thread.model || await deps.getNewChatPreparationModel?.() || ''
    let hasLiveRuntimeSession = deps.runtime.hasSession(runtimeThreadId)
    const previousRuntimeCwd = sanitizeOptionalPath(thread.cwd)
    if (
        hasLiveRuntimeSession
        && previousRuntimeCwd
        && previousRuntimeCwd !== runtimeCwd
    ) {
        deps.runtime.disconnect(runtimeThreadId)
        hasLiveRuntimeSession = false
    }
    const updatedThreadPatch: Partial<AssistantThread> & Pick<AssistantThread, 'model' | 'runtimeMode' | 'interactionMode' | 'cwd' | 'state' | 'lastError' | 'activePlan' | 'updatedAt'> = {
        model,
        runtimeMode: options?.runtimeMode || thread.runtimeMode,
        interactionMode: 'default',
        cwd: runtimeCwd,
        state: hasLiveRuntimeSession ? 'running' : 'starting',
        lastError: null,
        activePlan: null,
        updatedAt: occurredAt
    }
    deps.appendEvent('thread.updated', occurredAt, { threadId: thread.id, patch: updatedThreadPatch }, session.id, thread.id)

    // Submission owns the turn identity and model before attachment can wait.
    // The same ID follows the request through the runtime and canonical server.
    const submittedTurnId = createAssistantId('assistant-turn')
    const submittedTurn = createRunningLatestTurn(submittedTurnId, occurredAt, options)
    const pendingSubmissions = pendingPromptSubmissions.get(deps) || new Map()
    const submission = { turnId: submittedTurnId, cancelled: false }
    pendingSubmissions.set(thread.id, submission)
    pendingPromptSubmissions.set(deps, pendingSubmissions)
    try {
        if (!options?.suppressUserMessage) {
            const userMessage = createAssistantUserMessage(input, occurredAt, options?.userMessageId || createAssistantId('assistant-message'))
            userMessage.turnId = submittedTurnId
            deps.appendEvent('thread.message.user', occurredAt, { threadId: thread.id, message: userMessage }, session.id, thread.id)
        }
        deps.appendEvent('thread.latest-turn.updated', occurredAt, { threadId: thread.id, latestTurn: submittedTurn }, session.id, thread.id)
        if (!hasLiveRuntimeSession) {
            await connectAssistantSessionRuntime(deps, session, { ...thread, ...updatedThreadPatch })
        }
        if (submission.cancelled) {
            return { success: true as const, sessionId: session.id, threadId: thread.id, turnId: submittedTurnId }
        }
        // Navigation or a concurrent canonical attach may replace the context
        // while the asynchronous connection settles. Recheck at the dispatch
        // boundary so the submitted prompt always has a live owner.
        if (!deps.runtime.hasSession(runtimeThreadId)) {
            await connectAssistantSessionRuntime(deps, session, { ...thread, ...updatedThreadPatch })
        }
        if (submission.cancelled) {
            return { success: true as const, sessionId: session.id, threadId: thread.id, turnId: submittedTurnId }
        }
        // A rename may arrive while cold attachment is waiting. Read its
        // durable local flag and latest name at the dispatch boundary.
        const currentSession = requireSession(deps.getSnapshot(), session.id)
        const initialManualTitle = currentSession.titleManuallySet || hadNamedDraft ? currentSession.title : undefined
        const result = await deps.runtime.sendPrompt(runtimeThreadId, input, {
            turnId: submittedTurnId,
            initialManualTitle,
            startInNewWorktree: options?.startInNewWorktree,
            model: model || undefined,
            runtimeMode: options?.runtimeMode,
            interactionMode: 'default',
            effort: options?.effort,
            serviceTier: options?.serviceTier,
            profile: options?.profile,
            images: promptImages.length > 0 ? promptImages : undefined,
            reasoningSummary: runtimePolicy.reasoningSummary,
            contextCompactionThresholdTokens: runtimePolicy.contextCompactionThresholdTokens
        })
        if (submission.cancelled) await deps.runtime.interruptTurn(runtimeThreadId, result.turnId)
        // Runtime events may already have completed the turn; do not rewind it.
        const currentTurn = requireSession(deps.getSnapshot(), session.id).threads.find(entry => entry.id === thread.id)?.latestTurn
        if (currentTurn?.id !== result.turnId) {
            const latestTurn = createRunningLatestTurn(result.turnId, occurredAt, options)
            deps.appendEvent('thread.latest-turn.updated', occurredAt, { threadId: thread.id, latestTurn }, session.id, thread.id)
        }
        return { success: true as const, sessionId: session.id, threadId: thread.id, turnId: result.turnId }
    } catch (error) {
        if (submission.cancelled) {
            return { success: true as const, sessionId: session.id, threadId: thread.id, turnId: submittedTurnId }
        }
        const message = error instanceof Error ? error.message : 'Failed to send prompt.'
        const failureTime = nowIso()
        const failedTurn = requireSession(deps.getSnapshot(), session.id).threads.find(entry => entry.id === thread.id)?.latestTurn
        if (failedTurn?.id === submittedTurnId && failedTurn.state === 'running') {
            deps.appendEvent('thread.latest-turn.updated', failureTime, {
                threadId: thread.id,
                latestTurn: { ...failedTurn, state: 'error', completedAt: failureTime }
            }, session.id, thread.id)
        }
        deps.appendEvent('thread.updated', failureTime, {
            threadId: thread.id,
            patch: {
                state: 'error',
                lastError: message,
                updatedAt: failureTime
            }
        }, session.id, thread.id)
        deps.appendEvent('thread.activity.appended', failureTime, {
            threadId: thread.id,
            activity: {
                id: createAssistantId('assistant-activity'),
                kind: 'runtime.error',
                tone: 'error',
                summary: 'Failed to start turn',
                detail: message,
                turnId: null,
                createdAt: failureTime
            }
        }, session.id, thread.id)
        if (getActiveThread(getSelectedSession(deps.getSnapshot()))?.id !== thread.id) {
            deps.runtime.releaseNavigationBackgroundedThread?.(thread.id)
        }
        throw error
    } finally {
        if (pendingSubmissions.get(thread.id) === submission) pendingSubmissions.delete(thread.id)
    }
}

export async function interruptAssistantTurnAction(
    deps: AssistantServiceActionDeps,
    turnId?: string,
    sessionId?: string
) {
    await deps.ensureReady()
    const session = requireSession(deps.getSnapshot(), sessionId)
    const thread = requireActiveThread(session)
    let effectiveTurnId = turnId || thread.latestTurn?.id
    const pendingSubmission = pendingPromptSubmissions.get(deps)?.get(thread.id)
    if (pendingSubmission && pendingSubmission.turnId === effectiveTurnId) {
        pendingSubmission.cancelled = true
        await deps.runtime.cancelPendingPrompt?.(getAssistantCanonicalThreadId(thread), effectiveTurnId)
        const occurredAt = nowIso()
        if (thread.latestTurn?.id === effectiveTurnId) {
            deps.appendEvent('thread.latest-turn.updated', occurredAt, {
                threadId: thread.id, latestTurn: { ...thread.latestTurn, state: 'interrupted', completedAt: occurredAt }
            }, session.id, thread.id)
        }
        deps.appendEvent('thread.updated', occurredAt, { threadId: thread.id, patch: { state: 'ready', updatedAt: occurredAt } }, session.id, thread.id)
        return { success: true as const }
    }
    const runtimeThreadId = getAssistantCanonicalThreadId(thread)
    if (await deps.runtime.cancelPendingPrompt?.(runtimeThreadId, turnId)) return { success: true as const }
    if (!deps.runtime.hasSession(runtimeThreadId)) {
        await connectAssistantSessionRuntime(deps, session, thread)
    }
    if (deps.runtime.getCanonicalChat) {
        const chat = await deps.runtime.getCanonicalChat(runtimeThreadId, deps.getSessionRuntimeCwd(session, thread))
        if (!chat?.presence) throw new Error('The active turn could not be confirmed. Reconnect before stopping work.')
        const observedTurnId = chat.presence.activeTurnId
        // Pin this observation. An old Stop never rolls forward to a newer turn,
        // and a confirmed idle chat never falls back to cached running history.
        if (!observedTurnId || turnId && turnId !== observedTurnId) return { success: true as const }
        effectiveTurnId = turnId || observedTurnId
    }
    await deps.runtime.interruptTurn(runtimeThreadId, effectiveTurnId)
    return { success: true as const }
}

export async function respondAssistantApprovalAction(
    deps: AssistantServiceActionDeps,
    input: { requestId: string; decision: 'acceptOnce' | 'acceptForSession' | 'decline' }
) {
    await deps.ensureReady()
    const target = findThreadForApproval(deps.getSnapshot(), input.requestId)
    if (!target) throw new Error(`Unknown approval request ${input.requestId}.`)
    await deps.runtime.respondApproval(getAssistantCanonicalThreadId(target.thread), input.requestId, input.decision)
    return { success: true as const }
}

export async function respondAssistantUserInputAction(
    deps: AssistantServiceActionDeps,
    input: AssistantUserInputResponseInput
) {
    const activeRequests = activeUserInputResponses.get(deps) || new Set<string>()
    activeUserInputResponses.set(deps, activeRequests)
    if (activeRequests.has(input.requestId)) throw new Error(`User-input request ${input.requestId} is already being submitted.`)
    activeRequests.add(input.requestId)
    try {
        await deps.ensureReady()
        let target = findThreadForUserInput(deps.getSnapshot(), input.requestId)
        if (!target) {
            await deps.recoverPendingUserInput?.(input.requestId)
            target = findThreadForUserInput(deps.getSnapshot(), input.requestId)
        }
        if (!target) throw new Error(`Unknown user-input request ${input.requestId}.`)
        const pendingInput = target.thread.pendingUserInputs.find((entry) => entry.requestId === input.requestId)
        if (!pendingInput) throw new Error(`Unknown user-input request ${input.requestId}.`)
        if ((input.cancelled || input.deferContinuation) && pendingInput.mode !== 'async') throw new Error('Only answer-later questions can be dismissed or delivered separately.')
        if (input.cancelled) {
            const runtimeId = getAssistantCanonicalThreadId(target.thread)
            if (!deps.runtime.hasSession(runtimeId)) await connectAssistantSessionRuntime(deps, target.session, target.thread)
            await deps.runtime.respondUserInput(runtimeId, input.requestId, {}, pendingInput.questions, { mode: 'async', cancelled: true })
            deps.appendEvent('thread.user-input.updated', nowIso(), { threadId: target.thread.id, userInput: { ...pendingInput, status: 'resolved', answers: {}, resolvedAt: nowIso() } }, target.session.id, target.thread.id)
            return { success: true as const }
        }
        const contextText = input.contextText ?? ''
        if (typeof contextText !== 'string' || contextText.length > 256_000) throw new Error('Question attachments are too large.')
        const questionImages = await prepareAssistantPromptImages(input.images)
        const continuationPrompt = await respondToAssistantUserInputWithRuntime({
            runtime: deps.runtime,
            thread: target.thread,
            cwd: deps.getSessionRuntimeCwd(target.session, target.thread),
            chatScope: target.session.chatScope,
            requestId: input.requestId,
            questions: pendingInput.questions,
            mode: pendingInput.mode,
            answers: input.answers
        })
        const respondedAt = nowIso()
        const responseMessageId = createAssistantId('assistant-message')
        deps.appendEvent('thread.user-input.updated', respondedAt, {
            threadId: target.thread.id,
            userInput: {
                ...pendingInput,
                status: 'resolved',
                answers: input.answers,
                responseMessageId,
                resolvedAt: respondedAt
            }
        }, target.session.id, target.thread.id)
        if (input.deferContinuation) return { success: true as const }
        return sendAssistantPromptAction(deps, contextText.trim() ? `${continuationPrompt}\n\n${contextText.trim()}` : continuationPrompt, {
            sessionId: target.session.id,
            dispatchMode: pendingInput.mode === 'async' && target.thread.latestTurn?.state === 'running' ? 'steer' : 'immediate',
            targetTurnId: pendingInput.mode === 'async' ? target.thread.latestTurn?.id : undefined,
            images: input.images,
            userMessageId: responseMessageId
        }, questionImages)
    } finally {
        activeRequests.delete(input.requestId)
        if (activeRequests.size === 0) activeUserInputResponses.delete(deps)
    }
}

export async function getAssistantRuntimeStatusAction(deps: AssistantServiceActionDeps): Promise<AssistantRuntimeStatus> {
    await deps.ensureReady()
    const availability = await deps.runtime.checkAvailability()
    const session = getSelectedSession(deps.getSnapshot())
    const thread = getActiveThread(session)
    const activeRuntimeThreadId = thread ? getAssistantCanonicalThreadId(thread) : null
    const liveConnected = activeRuntimeThreadId ? deps.runtime.hasSession(activeRuntimeThreadId) : false
    const canonicalConnected = isCanonicalPresenceActive(thread?.canonicalPresence)
    const connected = liveConnected || canonicalConnected
    return {
        available: availability.available,
        connected,
        selectedSessionId: session?.id || null,
        activeThreadId: thread?.id || null,
        state: connected ? (thread?.state || 'disconnected') : 'disconnected',
        reason: availability.reason
    }
}

export async function getAssistantSessionTurnUsageAction(
    deps: AssistantServiceActionDeps,
    readTurnUsage: (sessionId: string) => Promise<AssistantSessionTurnUsagePayload['turns']>,
    input?: AssistantGetSessionTurnUsageInput
) {
    await deps.ensureReady()
    const session = input?.sessionId
        ? requireSession(deps.getSnapshot(), input.sessionId)
        : requireSession(deps.getSnapshot(), deps.getSnapshot().selectedSessionId || '')
    const persistedTurns = await readTurnUsage(session.id)
    const turnMap = new Map(persistedTurns.map((turn) => [turn.id, turn]))
    for (const thread of session.threads) {
        if (!thread.latestTurn) continue
        const persisted = turnMap.get(thread.latestTurn.id)
        turnMap.set(thread.latestTurn.id, {
            id: thread.latestTurn.id,
            sessionId: session.id,
            threadId: thread.id,
            model: persisted?.model || (thread.latestTurn.state === 'running' ? thread.model : ''),
            state: thread.latestTurn.state,
            requestedAt: thread.latestTurn.requestedAt,
            startedAt: thread.latestTurn.startedAt,
            completedAt: thread.latestTurn.completedAt,
            assistantMessageId: thread.latestTurn.assistantMessageId,
            effort: thread.latestTurn.effort,
            serviceTier: thread.latestTurn.serviceTier,
            usage: thread.latestTurn.usage || null,
            updatedAt: thread.latestTurn.completedAt || thread.latestTurn.startedAt || thread.latestTurn.requestedAt
        })
    }
    const usage: AssistantSessionTurnUsagePayload = {
        sessionId: session.id,
        turns: [...turnMap.values()].sort((left, right) => left.requestedAt.localeCompare(right.requestedAt) || left.id.localeCompare(right.id)),
        fetchedAt: nowIso()
    }
    return { success: true as const, usage }
}
