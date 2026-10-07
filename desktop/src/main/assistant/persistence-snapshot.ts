import type { AssistantShellSnapshot, AssistantSnapshot, AssistantThread, AssistantThreadShell } from '../../shared/assistant/contracts'
import { preserveAssistantMessagePhases } from '../../shared/assistant/message-phase'

export type AssistantHydratedThreadData = Pick<
    AssistantThread,
    'messages' | 'proposedPlans' | 'activities' | 'pendingApprovals' | 'pendingUserInputs' | 'activePlan'
>

function shouldKeepHydrated(thread: AssistantThread): boolean {
    return thread.state === 'starting' || thread.state === 'running' || thread.state === 'waiting'
}

export function shouldKeepHydratedThread(thread: AssistantThread): boolean {
    return shouldKeepHydrated(thread)
}

export function toAssistantThreadShell(thread: AssistantThread): AssistantThreadShell {
    return {
        id: thread.id,
        providerThreadId: thread.providerThreadId,
        source: thread.source,
        parentThreadId: thread.parentThreadId,
        providerParentThreadId: thread.providerParentThreadId,
        subagentDepth: thread.subagentDepth,
        agentNickname: thread.agentNickname,
        agentRole: thread.agentRole,
        model: thread.model,
        cwd: thread.cwd,
        messageCount: thread.messageCount,
        activityCount: thread.activityCount,
        proposedPlanCount: thread.proposedPlanCount,
        lastSeenCompletedTurnId: thread.lastSeenCompletedTurnId,
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
        webSearch: thread.webSearch ?? null,
        webFetch: thread.webFetch ?? null,
        state: thread.state,
        canonicalHistoryModifiedAt: thread.canonicalHistoryModifiedAt ?? null,
        canonicalHistoryEntryCount: thread.canonicalHistoryEntryCount ?? null,
        mobileVoice: thread.mobileVoice ? { ...thread.mobileVoice } : null,
        canonicalPresence: thread.canonicalPresence ? {
            ...thread.canonicalPresence,
            clients: thread.canonicalPresence.clients.map((client) => ({ ...client }))
        } : undefined,
        lastError: thread.lastError,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        latestTurn: thread.latestTurn,
        hasPendingApprovals: thread.hasPendingApprovals || thread.pendingApprovals.some((entry) => entry.status === 'pending'),
        hasPendingUserInputs: thread.hasPendingUserInputs || thread.pendingUserInputs.some((entry) => entry.status === 'pending'),
        hasActivePlan: thread.hasActivePlan || Boolean(thread.activePlan)
    }
}

export function toAssistantShellSnapshot(snapshot: AssistantSnapshot): AssistantShellSnapshot {
    return {
        snapshotSequence: snapshot.snapshotSequence,
        updatedAt: snapshot.updatedAt,
        selectedSessionId: snapshot.selectedSessionId,
        playground: structuredClone(snapshot.playground),
        knownModels: structuredClone(snapshot.knownModels),
        fleetByThreadId: structuredClone(snapshot.fleetByThreadId || {}),
        sessions: snapshot.sessions.map((session) => ({
            ...session,
            threadIds: [...session.threadIds],
            threads: session.threads.map(toAssistantThreadShell)
        }))
    }
}

export function summarizeThread(thread: AssistantThread): AssistantThread {
    return {
        ...thread,
        activePlan: null,
        messages: [],
        proposedPlans: [],
        activities: [],
        pendingApprovals: [],
        pendingUserInputs: []
    }
}

export function trimSnapshotToFocusedSession(snapshot: AssistantSnapshot, focusedSessionId: string | null): AssistantSnapshot {
    const next = structuredClone(snapshot)
    for (const session of next.sessions) {
        for (let index = 0; index < session.threads.length; index += 1) {
            const thread = session.threads[index]
            const shouldHydrate = (session.id === focusedSessionId && thread.id === session.activeThreadId) || shouldKeepHydrated(thread)
            if (!shouldHydrate) {
                session.threads[index] = summarizeThread(thread)
            }
        }
    }
    return next
}

export function hydrateFocusedSessionSnapshot(
    snapshot: AssistantSnapshot,
    sessionId: string,
    details: AssistantHydratedThreadData | null
): AssistantSnapshot {
    const detailsByThreadId = new Map<string, AssistantHydratedThreadData>()
    const session = snapshot.sessions.find((entry) => entry.id === sessionId)
    if (details && session?.activeThreadId) {
        detailsByThreadId.set(session.activeThreadId, details)
    }
    return hydrateSnapshotThreads(snapshot, sessionId, detailsByThreadId)
}

export function hydrateSnapshotThreads(
    snapshot: AssistantSnapshot,
    focusedSessionId: string | null,
    detailsByThreadId: Map<string, AssistantHydratedThreadData>
): AssistantSnapshot {
    const next = trimSnapshotToFocusedSession(snapshot, focusedSessionId)
    if (detailsByThreadId.size === 0) return next

    for (const session of next.sessions) {
        for (const thread of session.threads) {
            const details = detailsByThreadId.get(thread.id)
            if (!details) continue
            thread.activePlan = details.activePlan
            thread.messages = preserveAssistantMessagePhases(thread.messages, details.messages)
            // Catalog counts include canonical records represented as work rather
            // than message rows. Loading those rows must not change metadata.
            thread.proposedPlans = details.proposedPlans
            thread.activities = details.activities
            thread.pendingApprovals = details.pendingApprovals
            thread.pendingUserInputs = details.pendingUserInputs
        }
    }
    return next
}
