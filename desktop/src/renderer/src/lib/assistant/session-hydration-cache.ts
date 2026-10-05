import type { AssistantActivity, AssistantMessage, AssistantProposedPlan, AssistantSnapshot, AssistantThread } from '@shared/assistant/contracts'
import { compareAssistantTimelineOrderKeys, getAssistantTimelineOrderKey, type AssistantTimelineRecordKind } from '@shared/assistant/timeline-order'
import { getAssistantThreadHydrationRevision } from './assistant-thread-hydration-revision'
import { hasUsableAssistantTimelineHistory } from './assistant-history-readiness'

const HYDRATED_THREAD_CACHE_LIMIT = 12
// This is the synchronous chat-switch preview, not the history retention limit.
// Keep only a few recent turns here; older rows remain reachable through the
// retained history cursor and normal upward pagination.
export const HYDRATED_THREAD_CACHE_MAX_TIMELINE_RECORDS = 72
export const HYDRATED_THREAD_CACHE_MAX_TIMELINE_CHARACTERS = 320_000

export type CachedHydratedThreadState = Pick<
    AssistantThread,
    'activePlan' | 'messages' | 'proposedPlans' | 'activities' | 'pendingApprovals' | 'pendingUserInputs'
> & {
    sessionId: string
    threadId: string
    revision: string
}

type CachedTimelineRecord =
    | { kind: 'message'; record: AssistantMessage }
    | { kind: 'activity'; record: AssistantActivity }
    | { kind: 'plan'; record: AssistantProposedPlan }

function estimateUnknownCharacters(value: unknown, remaining: number, seen: Set<object>): number {
    if (remaining <= 0 || value === null || value === undefined) return 0
    if (typeof value === 'string') return Math.min(remaining, value.length)
    if (typeof value !== 'object') return Math.min(remaining, String(value).length)
    if (seen.has(value)) return 0
    seen.add(value)
    let total = 0
    const entries = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>)
    for (const entry of entries) {
        total += estimateUnknownCharacters(entry, remaining - total, seen)
        if (total >= remaining) break
    }
    return total
}

function estimateTimelineRecordCharacters(entry: CachedTimelineRecord, remaining: number): number {
    if (entry.kind === 'message') return Math.min(remaining, entry.record.text.length)
    if (entry.kind === 'plan') return Math.min(remaining, entry.record.planMarkdown.length)
    const activity = entry.record
    const base = activity.summary.length + (activity.detail?.length || 0)
    return Math.min(remaining, base + estimateUnknownCharacters(activity.payload, remaining - base, new Set()))
}

export function estimateAssistantTimelineCollectionsCharacters(input: {
    messages: readonly AssistantMessage[]
    activities: readonly AssistantActivity[]
    proposedPlans: readonly AssistantProposedPlan[]
}, limit = Number.POSITIVE_INFINITY): number {
    let total = 0
    for (const record of input.messages) {
        total += Math.min(limit - total, record.text.length)
        if (total >= limit) return total
    }
    for (const record of input.activities) {
        const base = record.summary.length + (record.detail?.length || 0)
        total += Math.min(limit - total, base + estimateUnknownCharacters(record.payload, limit - total - base, new Set()))
        if (total >= limit) return total
    }
    for (const record of input.proposedPlans) {
        total += Math.min(limit - total, record.planMarkdown.length)
        if (total >= limit) return total
    }
    return total
}

export function boundCachedHydratedThreadState(state: CachedHydratedThreadState): CachedHydratedThreadState {
    const records: CachedTimelineRecord[] = [
        ...state.messages.map((record) => ({ kind: 'message' as const, record })),
        ...state.activities.map((record) => ({ kind: 'activity' as const, record })),
        ...state.proposedPlans.map((record) => ({ kind: 'plan' as const, record }))
    ].sort((left, right) => compareAssistantTimelineOrderKeys(
        getAssistantTimelineOrderKey(left.kind as AssistantTimelineRecordKind, left.record as never),
        getAssistantTimelineOrderKey(right.kind as AssistantTimelineRecordKind, right.record as never)
    ))
    if (records.length <= HYDRATED_THREAD_CACHE_MAX_TIMELINE_RECORDS && estimateAssistantTimelineCollectionsCharacters(state, HYDRATED_THREAD_CACHE_MAX_TIMELINE_CHARACTERS + 1) <= HYDRATED_THREAD_CACHE_MAX_TIMELINE_CHARACTERS) {
        return state
    }

    const selected = new Set<string>()
    let characters = 0
    for (let index = records.length - 1; index >= 0; index -= 1) {
        const entry = records[index]!
        const nextCharacters = estimateTimelineRecordCharacters(entry, HYDRATED_THREAD_CACHE_MAX_TIMELINE_CHARACTERS + 1)
        if (
            selected.size > 0
            && (
                selected.size >= HYDRATED_THREAD_CACHE_MAX_TIMELINE_RECORDS
                || characters + nextCharacters > HYDRATED_THREAD_CACHE_MAX_TIMELINE_CHARACTERS
            )
        ) break
        selected.add(`${entry.kind}:${entry.record.id}`)
        characters += nextCharacters
    }
    const latestMessage = state.messages.at(-1)
    if (latestMessage) selected.add(`message:${latestMessage.id}`)
    const latestUserMessage = [...state.messages].reverse().find((message) => message.role === 'user')
    if (latestUserMessage) selected.add(`message:${latestUserMessage.id}`)

    return {
        ...state,
        messages: state.messages.filter((record) => selected.has(`message:${record.id}`)),
        activities: state.activities.filter((record) => selected.has(`activity:${record.id}`)),
        proposedPlans: state.proposedPlans.filter((record) => selected.has(`plan:${record.id}`))
    }
}

function hasHydratedThreadState(thread: AssistantThread): boolean {
    return Boolean(thread.activePlan)
        || thread.messages.length > 0
        || thread.proposedPlans.length > 0
        || thread.activities.length > 0
        || thread.pendingApprovals.length > 0
        || thread.pendingUserInputs.length > 0
}

function areCachedThreadStatesReferentiallyEqual(
    left: CachedHydratedThreadState | undefined,
    right: CachedHydratedThreadState
): boolean {
    return left?.sessionId === right.sessionId
        && left?.threadId === right.threadId
        && left.revision === right.revision
        && left.activePlan === right.activePlan
        && left.messages === right.messages
        && left.proposedPlans === right.proposedPlans
        && left.activities === right.activities
        && left.pendingApprovals === right.pendingApprovals
        && left.pendingUserInputs === right.pendingUserInputs
}

export function cacheHydratedThreads(
    cache: Map<string, CachedHydratedThreadState>,
    snapshot: AssistantSnapshot
): void {
    const presentThreadIds = new Set<string>()

    for (const session of snapshot.sessions) {
        for (const thread of session.threads) {
            presentThreadIds.add(thread.id)
            const remainsMaterialized = (
                (session.id === snapshot.selectedSessionId && thread.id === session.activeThreadId)
                || ['starting', 'running', 'waiting', 'background'].includes(thread.state)
                || thread.hasActivePlan
                || thread.hasPendingApprovals
                || thread.hasPendingUserInputs
            )
            if (remainsMaterialized) continue
            if (!hasHydratedThreadState(thread)) {
                const cached = cache.get(thread.id)
                if (
                    cached
                    && (
                        cached.sessionId !== session.id
                        || cached.revision !== getAssistantThreadHydrationRevision(thread)
                    )
                ) {
                    cache.delete(thread.id)
                } else if ((thread.messageCount || 0) === 0 && !thread.latestTurn) {
                    cache.delete(thread.id)
                }
                continue
            }

            const nextCachedState = boundCachedHydratedThreadState({
                sessionId: session.id,
                threadId: thread.id,
                revision: getAssistantThreadHydrationRevision(thread),
                activePlan: thread.activePlan,
                messages: thread.messages,
                proposedPlans: thread.proposedPlans,
                activities: thread.activities,
                pendingApprovals: thread.pendingApprovals,
                pendingUserInputs: thread.pendingUserInputs
            })

            const previousCachedState = cache.get(thread.id)
            if (areCachedThreadStatesReferentiallyEqual(previousCachedState, nextCachedState)) continue

            cache.delete(thread.id)
            cache.set(thread.id, nextCachedState)
        }
    }

    for (const threadId of [...cache.keys()]) {
        if (!presentThreadIds.has(threadId)) cache.delete(threadId)
    }

    if (cache.size <= HYDRATED_THREAD_CACHE_LIMIT) return
    const protectedThreadIds = new Set(snapshot.sessions.flatMap((session) => session.threads
        .filter((thread) => (
            (session.id === snapshot.selectedSessionId && thread.id === session.activeThreadId)
            || ['starting', 'running', 'waiting', 'background'].includes(thread.state)
            || thread.hasActivePlan
            || thread.hasPendingApprovals
            || thread.hasPendingUserInputs
            || thread.pendingApprovals.length > 0
            || thread.pendingUserInputs.length > 0
        ))
        .map((thread) => thread.id)))
    for (const threadId of [...cache.keys()]) {
        if (cache.size <= HYDRATED_THREAD_CACHE_LIMIT) break
        if (!protectedThreadIds.has(threadId)) cache.delete(threadId)
    }
}

export function applyCachedSessionSelection(
    snapshot: AssistantSnapshot,
    sessionId: string,
    threadId: string | null,
    cache: Map<string, CachedHydratedThreadState>
): AssistantSnapshot {
    const sessionIndex = snapshot.sessions.findIndex((entry) => entry.id === sessionId)
    const session = sessionIndex >= 0 ? snapshot.sessions[sessionIndex] : null
    const targetThreadId = threadId || session?.activeThreadId || null
    const targetThread = targetThreadId ? session?.threads.find((thread) => thread.id === targetThreadId) || null : null
    const candidate = targetThreadId ? cache.get(targetThreadId) : null
    const resolvedCandidate = candidate ? boundCachedHydratedThreadState(candidate) : null
    if (targetThreadId && candidate && resolvedCandidate && resolvedCandidate !== candidate) cache.set(targetThreadId, resolvedCandidate)
    const cached = resolvedCandidate
        && targetThread
        && resolvedCandidate.sessionId === sessionId
        && resolvedCandidate.revision === getAssistantThreadHydrationRevision(targetThread)
        ? resolvedCandidate
        : null
    if (targetThreadId && candidate && !cached) cache.delete(targetThreadId)
    if (targetThreadId && cached) {
        cache.delete(targetThreadId)
        cache.set(targetThreadId, cached)
    }
    let nextSession = session

    if (session && targetThreadId && session.activeThreadId !== targetThreadId) {
        nextSession = { ...session, activeThreadId: targetThreadId }
    }

    if (nextSession && cached && cached.sessionId === sessionId && targetThreadId === cached.threadId) {
        const threadIndex = nextSession.threads.findIndex((thread) => thread.id === cached.threadId)
        const thread = threadIndex >= 0 ? nextSession.threads[threadIndex] : null
        if (thread && (
            thread.activePlan !== cached.activePlan
            || thread.messages !== cached.messages
            || thread.proposedPlans !== cached.proposedPlans
            || thread.activities !== cached.activities
            || thread.pendingApprovals !== cached.pendingApprovals
            || thread.pendingUserInputs !== cached.pendingUserInputs
        )) {
            const threads = nextSession.threads.slice()
            threads[threadIndex] = {
                ...thread,
                activePlan: cached.activePlan,
                messages: cached.messages,
                proposedPlans: cached.proposedPlans,
                activities: cached.activities,
                pendingApprovals: cached.pendingApprovals,
                pendingUserInputs: cached.pendingUserInputs
            }
            nextSession = { ...nextSession, threads }
        }
    }

    const sessionChanged = Boolean(session && nextSession && nextSession !== session)
    if (snapshot.selectedSessionId === sessionId && !sessionChanged) return snapshot
    if (!sessionChanged) return { ...snapshot, selectedSessionId: sessionId }

    const sessions = snapshot.sessions.slice()
    sessions[sessionIndex] = nextSession!
    return {
        ...snapshot,
        selectedSessionId: sessionId,
        sessions
    }
}

export function hasCachedSessionSelection(
    snapshot: AssistantSnapshot,
    sessionId: string,
    threadId: string | null,
    cache: Map<string, CachedHydratedThreadState>
): boolean {
    const session = snapshot.sessions.find((entry) => entry.id === sessionId)
    const targetThreadId = threadId || session?.activeThreadId || null
    if (!session || !targetThreadId || !session.threads.some((thread) => thread.id === targetThreadId)) {
        return false
    }

    const thread = session.threads.find((entry) => entry.id === targetThreadId) || null
    const cached = cache.get(targetThreadId)
    return Boolean(
        thread
        && cached
        && cached.sessionId === sessionId
        && cached.threadId === targetThreadId
        && cached.revision === getAssistantThreadHydrationRevision(thread)
        && hasUsableAssistantTimelineHistory(cached, thread)
    )
}
