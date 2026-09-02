import type {
    AssistantActivePlan,
    AssistantActivity,
    AssistantMessage,
    AssistantPendingApproval,
    AssistantPendingUserInput,
    AssistantSession,
    AssistantSnapshot,
    AssistantThread
} from '@shared/assistant/contracts'

export function getSelectedAssistantSession(snapshot: AssistantSnapshot): AssistantSession | null {
    return snapshot.sessions.find((session) => session.id === snapshot.selectedSessionId) || null
}

export function getActiveAssistantThread(session: AssistantSession | null): AssistantThread | null {
    if (!session?.activeThreadId) return null
    return session.threads.find((thread) => thread.id === session.activeThreadId) || null
}

export function getVisibleAssistantSessions(snapshot: AssistantSnapshot, includeArchived = false): AssistantSession[] {
    return snapshot.sessions.filter((session) => includeArchived || !session.archived)
}

export function getAssistantSessionsByMode(
    snapshot: AssistantSnapshot,
    mode: AssistantSession['mode'],
    includeArchived = false
): AssistantSession[] {
    return snapshot.sessions.filter((session) => session.mode === mode && (includeArchived || !session.archived))
}

export function getAssistantPendingApprovals(thread: AssistantThread | null): AssistantPendingApproval[] {
    if (!thread) return []
    return thread.pendingApprovals.filter((approval) => approval.status === 'pending')
}

export function getAssistantPendingUserInputs(thread: AssistantThread | null): AssistantPendingUserInput[] {
    if (!thread) return []
    return thread.pendingUserInputs.filter((item) => item.status === 'pending')
}

export function getAssistantActivePlan(thread: AssistantThread | null): AssistantActivePlan | null {
    return thread?.activePlan || null
}

export function getAssistantLatestProposedPlan(thread: AssistantThread | null) {
    if (!thread || thread.proposedPlans.length === 0) return null

    let latest = thread.proposedPlans[0] || null
    for (let index = 1; index < thread.proposedPlans.length; index += 1) {
        const candidate = thread.proposedPlans[index]
        if (!candidate || !latest) continue
        if (
            candidate.updatedAt.localeCompare(latest.updatedAt) > 0
            || (candidate.updatedAt === latest.updatedAt && candidate.id.localeCompare(latest.id) > 0)
        ) {
            latest = candidate
        }
    }

    return latest
}

export function getAssistantTimelineMessages(thread: AssistantThread | null): AssistantMessage[] {
    return thread?.messages || []
}

const activityFeedCache = new WeakMap<AssistantActivity[], AssistantActivity[]>()

export function getAssistantActivityFeed(thread: AssistantThread | null) {
    if (!thread) return []
    const source = thread.activities
    if (source.length < 2) return source

    const cached = activityFeedCache.get(source)
    if (cached) return cached

    const reversed = [...source].reverse()
    activityFeedCache.set(source, reversed)
    return reversed
}

export type AssistantThreadPhaseKey =
    | 'idle'
    | 'starting'
    | 'ready'
    | 'running'
    | 'waiting'
    | 'background'
    | 'detached'
    | 'stale'
    | 'waiting-approval'
    | 'waiting-input'
    | 'error'
    | 'stopped'

export function getAssistantThreadPhase(thread: AssistantThread | null): {
    key: AssistantThreadPhaseKey
    label: string
} {
    if (!thread) return { key: 'idle', label: 'No active thread' }
    if (thread.hasPendingApprovals || getAssistantPendingApprovals(thread).length > 0) {
        return { key: 'waiting-approval', label: 'Waiting for approval' }
    }
    if (thread.hasPendingUserInputs || getAssistantPendingUserInputs(thread).length > 0) {
        return { key: 'waiting-input', label: 'Waiting for input' }
    }

    const canonicalPresence = thread.canonicalPresence
    if (canonicalPresence?.state === 'running') {
        return { key: 'running', label: 'Running' }
    }
    if (canonicalPresence?.state === 'background') {
        return { key: 'background', label: 'Background work' }
    }
    if (
        canonicalPresence?.state === 'ready'
        && (
            thread.state === 'starting'
            || (thread.state === 'running' && thread.latestTurn?.state !== 'running')
            || thread.state === 'waiting'
        )
    ) {
        return { key: 'ready', label: 'Idle' }
    }
    if (canonicalPresence?.state === 'detached') {
        if (thread.state === 'starting' || thread.state === 'running' || thread.state === 'waiting' || thread.latestTurn?.state === 'running') {
            return { key: 'stale', label: 'Stale runtime state' }
        }
        return { key: 'detached', label: 'Detached' }
    }

    switch (thread.state) {
        case 'idle':
            return { key: 'idle', label: 'Idle' }
        case 'starting':
            return { key: 'starting', label: 'Connecting' }
        case 'ready':
            return { key: 'ready', label: 'Idle' }
        case 'running':
            return { key: 'running', label: 'Running' }
        case 'waiting':
            return { key: 'waiting', label: 'Working' }
        case 'interrupted':
            return { key: 'stopped', label: 'Interrupted' }
        case 'stopped':
            return { key: 'stopped', label: 'Stopped' }
        case 'error':
            return { key: 'error', label: 'Error' }
        default:
            return { key: 'idle', label: 'Unknown' }
    }
}

export function getAssistantThreadPhaseLabel(thread: AssistantThread | null): string {
    return getAssistantThreadPhase(thread).label
}

export function isAssistantThreadActivelyWorking(thread: AssistantThread | null): boolean {
    // Connection, tool, and approval states can change while the same turn keeps
    // running. Only the turn ledger's terminal state can stop that active turn.
    if (thread?.latestTurn?.state === 'running') return true

    const phase = getAssistantThreadPhase(thread)
    if (phase.key === 'background') return true
    if (phase.key !== 'running' && phase.key !== 'waiting') return false
    return thread?.canonicalPresence?.state === 'running'
        || thread?.canonicalPresence?.state === 'background'
}

export function getAssistantSessionSubtitle(session: AssistantSession): string {
    const trimmedPath = String(session.projectPath || '').trim()
    if (!trimmedPath) return 'No project attached'
    const parts = trimmedPath.split(/[\\/]/).filter(Boolean)
    return parts[parts.length - 1] || trimmedPath
}

export function formatAssistantRelativeTime(value: string): string {
    const timestamp = Date.parse(value)
    if (!Number.isFinite(timestamp)) return value
    const deltaMs = Math.max(0, Date.now() - timestamp)
    if (deltaMs < 60_000) return 'now'
    const minutes = Math.floor(deltaMs / 60_000)
    if (minutes < 60) return `${minutes}m`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h`
    const days = Math.floor(hours / 24)
    if (days < 7) return `${days}d`
    return new Date(timestamp).toLocaleDateString()
}

export function isAssistantSessionBackgroundActive(session: AssistantSession, activeSessionId: string | null): boolean {
    const activeThread = getActiveAssistantThread(session)
    const phase = getAssistantThreadPhase(activeThread)

    if (isAssistantThreadActivelyWorking(activeThread)) return true
    if (phase.key === 'starting' || phase.key === 'running' || phase.key === 'waiting' || phase.key === 'background' || phase.key === 'waiting-approval' || phase.key === 'waiting-input') {
        return true
    }

    if (
        session.id !== activeSessionId
        && activeThread?.latestTurn?.state === 'completed'
        && activeThread.lastSeenCompletedTurnId !== activeThread.latestTurn.id
    ) {
        return true
    }

    return false
}

export function getAssistantBackgroundActivitySessions(
    snapshot: AssistantSnapshot,
    mode: AssistantSession['mode'],
    activeSessionId: string | null
): AssistantSession[] {
    return snapshot.sessions
        .filter((session) => session.mode === mode && !session.archived)
        .filter((session) => isAssistantSessionBackgroundActive(session, activeSessionId))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id))
}

const assistantDateTimeFormatter = new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
})

export function formatAssistantDateTime(value: string): string {
    const timestamp = Date.parse(value)
    return Number.isFinite(timestamp) ? assistantDateTimeFormatter.format(timestamp) : value
}
