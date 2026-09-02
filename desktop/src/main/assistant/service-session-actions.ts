import log from 'electron-log'
import type {
    AssistantClearLogsInput,
    AssistantConnectOptions,
    AssistantCreateSessionInput,
    AssistantDeleteMessageInput,
    AssistantGetSessionTurnUsageInput,
    AssistantRuntimeStatus,
    AssistantSendPromptOptions,
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
import { is } from '../utils'
import { prepareAssistantPromptImages } from './prompt-images'
import { isCanonicalPresenceActive } from './service-canonical-presence'
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
import { getAssistantCanonicalThreadId, matchesAssistantThreadId } from './thread-identity'
import {
    queueGeneratedSessionTitle,
    shouldGenerateSessionTitleForPrompt
} from './session-title-generation'
import { respondToAssistantUserInputWithRuntime } from './user-input-response'
import {
    createAssistantId,
    deriveSessionTitleFromPrompt,
    isDefaultSessionTitle,
    nowIso,
    sanitizeOptionalPath
} from './utils'

export async function connectAssistantSession(deps: AssistantServiceActionDeps, options?: AssistantConnectOptions) {
    await deps.ensureReady()
    const snapshot = deps.getSnapshot()
    const session = options?.sessionId
        ? requireSession(snapshot, options.sessionId)
        : getSelectedSession(snapshot)
    if (!session) throw new Error('Assistant session not found.')
    const thread = requireActiveThread(session)
    await deps.runtime.connect(thread, deps.getSessionRuntimeCwd(session, thread), session.chatScope)
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

export async function createAssistantSessionAction(deps: AssistantServiceActionDeps, input?: AssistantCreateSessionInput) {
    await deps.ensureReady()
    const previousThread = getActiveThread(getSelectedSession(deps.getSnapshot()))
    if (previousThread) deps.runtime.disconnect(getAssistantCanonicalThreadId(previousThread))
    const createdAt = nowIso()
    const sessionId = createAssistantId('assistant-session')
    const route = resolveAssistantSessionRoute({
        projectPath: input?.projectPath,
        mode: input?.mode,
        playgroundLabId: input?.playgroundLabId,
        playground: deps.getSnapshot().playground
    })
    const projectPath = route.projectPath
    const defaults = await deps.getNewChatExecutionDefaults()
    const thread = createAssistantThread(createdAt, null, projectPath || null, defaults)
    const session = createAssistantSessionRecord({
        sessionId,
        title: input?.title?.trim() || 'New Session',
        mode: route.mode,
        projectPath,
        playgroundLabId: route.playgroundLabId,
        createdAt,
        thread
    })
    deps.appendEvent('session.created', createdAt, { session }, sessionId, thread.id)
    deps.appendEvent('session.selected', createdAt, { sessionId }, sessionId, thread.id)
    return { success: true as const, sessionId }
}

export async function selectAssistantSessionAction(deps: AssistantServiceActionDeps, sessionId: string) {
    await deps.ensureReady()
    const snapshot = deps.getSnapshot()
    requireSession(snapshot, sessionId)
    const previousSession = getSelectedSession(snapshot)
    const previousThread = getActiveThread(previousSession)
    if (previousSession?.id !== sessionId && previousThread) {
        deps.runtime.disconnect(getAssistantCanonicalThreadId(previousThread))
    }
    const occurredAt = nowIso()
    deps.appendEvent('session.selected', occurredAt, { sessionId }, sessionId)
    const session = requireSession(deps.getSnapshot(), sessionId)
    markThreadCompletionSeen(deps, session, occurredAt)
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
        deps.runtime.disconnect(getAssistantCanonicalThreadId(previousThread))
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
    const updatedSession = requireSession(deps.getSnapshot(), sessionId)
    markThreadCompletionSeen(deps, updatedSession, occurredAt)
    return { success: true as const, sessionId, threadId: localThreadId }
}

export async function renameAssistantSessionAction(deps: AssistantServiceActionDeps, sessionId: string, title: string) {
    await deps.ensureReady()
    const session = requireSession(deps.getSnapshot(), sessionId)
    const nextTitle = title.trim() || session.title
    const occurredAt = nowIso()
    deps.appendEvent('session.updated', occurredAt, {
        sessionId,
        patch: {
            title: nextTitle,
            updatedAt: occurredAt
        }
    }, sessionId)
    await Promise.allSettled(session.threads
        .map((thread) => thread.providerThreadId)
        .filter((threadId): threadId is string => Boolean(threadId))
        .map((threadId) => deps.runtime.updateCanonicalChat(threadId, { title: nextTitle })))
    return { success: true as const }
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
        deps.runtime.disconnect(previousThread.providerThreadId || previousThread.id)
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
    options?: AssistantSendPromptOptions
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
    const occurredAt = nowIso()
    const compactionTestCommand = parseDevContextCompactionTestCommand(input, { enabled: is.dev })
    if (compactionTestCommand) {
        return triggerDevContextCompactionTestPrompt(deps, session.id, thread, compactionTestCommand, occurredAt)
    }

    const promptImages = await prepareAssistantPromptImages(options?.images)
    const runtimePolicy = normalizeAssistantRuntimePolicy(
        await deps.getRuntimePolicy?.().catch((error) => {
            log.warn('[Assistant] Failed to read the runtime policy preference', error)
            return undefined
        })
    )
    const persistedFirstUserMessage = isDefaultSessionTitle(session.title)
        ? null
        : await deps.getFirstUserMessageText(session.id)
    const shouldGenerateTitle = shouldGenerateSessionTitleForPrompt(session, persistedFirstUserMessage)
    const titleModelPromise = shouldGenerateTitle
        ? deps.getTitleGenerationModel().catch((error) => {
            log.warn('[Assistant] Failed to read the chat-title model preference', error)
            return null
        })
        : null
    const title = isDefaultSessionTitle(session.title) ? deriveSessionTitleFromPrompt(input) : session.title
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
        model: options?.model || thread.model,
        runtimeMode: options?.runtimeMode || thread.runtimeMode,
        interactionMode: 'default',
        cwd: runtimeCwd,
        state: hasLiveRuntimeSession ? 'running' : 'starting',
        lastError: null,
        activePlan: null,
        updatedAt: occurredAt
    }
    deps.appendEvent('thread.updated', occurredAt, { threadId: thread.id, patch: updatedThreadPatch }, session.id, thread.id)

    try {
        if (!options?.suppressUserMessage) {
            const userMessage = createAssistantUserMessage(input, occurredAt, createAssistantId('assistant-message'))
            deps.appendEvent('thread.message.user', occurredAt, { threadId: thread.id, message: userMessage }, session.id, thread.id)
        }
        if (!hasLiveRuntimeSession) {
            await deps.runtime.connect({ ...thread, ...updatedThreadPatch }, runtimeCwd, session.chatScope)
        }
        const result = await deps.runtime.sendPrompt(runtimeThreadId, input, {
            model: options?.model,
            runtimeMode: options?.runtimeMode,
            interactionMode: 'default',
            effort: options?.effort,
            serviceTier: options?.serviceTier,
            profile: options?.profile,
            images: promptImages.length > 0 ? promptImages : undefined,
            reasoningSummary: runtimePolicy.reasoningSummary,
            contextCompactionThresholdTokens: runtimePolicy.contextCompactionThresholdTokens
        })
        const latestTurn = createRunningLatestTurn(result.turnId, occurredAt, options)
        deps.appendEvent('thread.latest-turn.updated', occurredAt, { threadId: thread.id, latestTurn }, session.id, thread.id)
        if (shouldGenerateTitle && titleModelPromise) {
            void titleModelPromise.then((preferredModel) => queueGeneratedSessionTitle({
                sessionId: session.id,
                threadId: thread.id,
                messageText: input,
                seedTitle: title,
                cwd: runtimeCwd,
                preferredModel,
                generateText: (titlePrompt, titleOptions) => deps.runtime.generateText(titlePrompt, titleOptions),
                getSnapshot: deps.getSnapshot,
                appendEvent: deps.appendEvent,
                onApplied: (nextTitle) => deps.runtime.updateCanonicalChat(
                    result.providerThreadId || thread.providerThreadId || runtimeThreadId,
                    { title: nextTitle }
                )
            })).catch((error) => {
                log.warn('[Assistant] Session title generation task failed:', error)
            })
        }
        return { success: true as const, sessionId: session.id, threadId: thread.id, turnId: result.turnId }
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to send prompt.'
        const failureTime = nowIso()
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
        throw error
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
    const effectiveTurnId = turnId || thread.latestTurn?.id
    if (effectiveTurnId) {
        await deps.runtime.interruptTurn(getAssistantCanonicalThreadId(thread), effectiveTurnId)
    }
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
    input: { requestId: string; answers: Record<string, string | string[]> }
) {
    await deps.ensureReady()
    const target = findThreadForUserInput(deps.getSnapshot(), input.requestId)
    if (!target) throw new Error(`Unknown user-input request ${input.requestId}.`)
    await respondToAssistantUserInputWithRuntime({
        runtime: deps.runtime,
        thread: target.thread,
        cwd: deps.getSessionRuntimeCwd(target.session, target.thread),
        chatScope: target.session.chatScope,
        requestId: input.requestId,
        answers: input.answers
    })
    return { success: true as const }
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
        turnMap.set(thread.latestTurn.id, {
            id: thread.latestTurn.id,
            sessionId: session.id,
            threadId: thread.id,
            model: thread.model,
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

function markThreadCompletionSeen(deps: AssistantServiceActionDeps, session: ReturnType<typeof requireSession>, occurredAt: string) {
    const activeThread = getActiveThread(session)
    if (!activeThread || !activeThread.latestTurn || activeThread.latestTurn.state !== 'completed') return
    if (activeThread.lastSeenCompletedTurnId === activeThread.latestTurn.id) return

    deps.appendEvent('thread.updated', occurredAt, {
        threadId: activeThread.id,
        patch: {
            lastSeenCompletedTurnId: activeThread.latestTurn.id
        }
    }, session.id, activeThread.id)
}
