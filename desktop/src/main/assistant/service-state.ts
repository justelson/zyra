import type {
    AssistantDomainEvent,
    AssistantSession,
    AssistantSnapshot,
    AssistantThread
} from '../../shared/assistant/contracts'
import { matchesAssistantThreadId } from './thread-identity'
import { createAssistantId } from './utils'

export interface AssistantStateRecord {
    snapshot: AssistantSnapshot
    events: AssistantDomainEvent[]
}

export function isClearableIssueActivity(activity: { kind?: string; tone?: string }): boolean {
    return activity.tone === 'warning'
        || activity.tone === 'error'
        || activity.kind === 'process.stderr'
        || activity.kind === 'runtime.error'
        || activity.kind === 'ui.command-error'
}

export type AssistantNewChatExecutionDefaults = {
    webSearch: boolean
    webFetch: boolean
    model?: string
    effort?: import('../../shared/assistant/contracts').AssistantReasoningEffort
    runtimeMode?: import('../../shared/assistant/contracts').AssistantRuntimeMode
}

export function createAssistantThread(
    createdAt: string,
    previousThread?: AssistantThread | null,
    cwd?: string | null,
    defaults?: AssistantNewChatExecutionDefaults
): AssistantThread {
    return {
        id: createAssistantId('assistant-thread'),
        providerThreadId: null,
        source: previousThread?.source || 'root',
        parentThreadId: null,
        providerParentThreadId: null,
        subagentDepth: null,
        agentNickname: null,
        agentRole: null,
        model: previousThread?.model || defaults?.model || '',
        thinking: previousThread?.thinking || defaults?.effort || undefined,
        cwd: cwd !== undefined ? cwd : (previousThread?.cwd || null),
        messageCount: 0,
        activityCount: 0,
        proposedPlanCount: 0,
        lastSeenCompletedTurnId: null,
        runtimeMode: previousThread?.runtimeMode || defaults?.runtimeMode || 'approval-required',
        interactionMode: 'default',
        webSearch: defaults?.webSearch ?? previousThread?.webSearch ?? null,
        webFetch: defaults?.webFetch ?? previousThread?.webFetch ?? null,
        state: 'idle',
        lastError: null,
        createdAt,
        updatedAt: createdAt,
        latestTurn: null,
        hasPendingApprovals: false,
        hasPendingUserInputs: false,
        hasActivePlan: false,
        activePlan: null,
        messages: [],
        proposedPlans: [],
        activities: [],
        pendingApprovals: [],
        pendingUserInputs: []
    }
}

export function getSelectedSession(snapshot: AssistantSnapshot) {
    return snapshot.sessions.find((session) => session.id === snapshot.selectedSessionId) || null
}

export function requireSession(snapshot: AssistantSnapshot, sessionId?: string) {
    const targetId = sessionId || snapshot.selectedSessionId
    const session = snapshot.sessions.find((entry) => entry.id === targetId) || null
    if (!session) throw new Error('Assistant session not found.')
    return session
}

export function getActiveThread(session: AssistantSession | null) {
    if (!session?.activeThreadId) return null
    return session.threads.find((thread) => thread.id === session.activeThreadId) || null
}

export function requireActiveThread(session: AssistantSession) {
    const thread = getActiveThread(session)
    if (!thread) throw new Error('Assistant session has no active thread.')
    return thread
}

export function findSessionByThreadId(snapshot: AssistantSnapshot, threadId: string) {
    return findThreadRecord(snapshot, threadId)?.session || null
}

export function requireThread(snapshot: AssistantSnapshot, threadId: string) {
    const thread = findThreadRecord(snapshot, threadId)?.thread || null
    if (!thread) throw new Error(`Assistant thread ${threadId} was not found.`)
    return thread
}

export function findThreadRecord(snapshot: AssistantSnapshot, threadId: string) {
    for (const session of snapshot.sessions) {
        const thread = session.threads.find((entry) => matchesAssistantThreadId(entry, threadId)) || null
        if (thread) {
            return { session, thread }
        }
    }
    return null
}

export function findThreadForApproval(snapshot: AssistantSnapshot, requestId: string) {
    for (const session of snapshot.sessions) {
        const thread = session.threads.find((entry) => entry.pendingApprovals.some((approval) => approval.requestId === requestId && approval.status === 'pending'))
        if (thread) return { session, thread }
    }
    return null
}

export function findThreadForUserInput(snapshot: AssistantSnapshot, requestId: string) {
    for (const session of snapshot.sessions) {
        const thread = session.threads.find((entry) => entry.pendingUserInputs.some((item) => item.requestId === requestId && item.status === 'pending'))
        if (thread) return { session, thread }
    }
    return null
}
