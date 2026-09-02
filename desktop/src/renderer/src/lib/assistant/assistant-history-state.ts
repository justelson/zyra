import type {
    AssistantActivity,
    AssistantHistoryPage,
    AssistantProposedPlan,
    AssistantShellSnapshot,
    AssistantSnapshot,
    AssistantThread,
    AssistantThreadDetail,
    AssistantThreadHistoryState
} from '@shared/assistant/contracts'
import { encodeAssistantHistoryCursor } from '@shared/assistant/history-cursor'
import { getAssistantThreadHydrationRevision } from './assistant-thread-hydration-revision'
import { estimateAssistantTimelineCollectionsCharacters } from './session-hydration-cache'
import { compareAssistantTimelineOrderKeys, getAssistantTimelineOrderKey, type AssistantTimelineOrderKey, type AssistantTimelineRecordKind } from '@shared/assistant/timeline-order'

const DETAIL_IDLE_TTL_MS = 5 * 60_000
const DETAIL_CACHE_LIMIT = 12
export const DETAIL_CACHE_MAX_TIMELINE_CHARACTERS = 6_000_000
export const ACTIVE_ASSISTANT_HISTORY_MAX_RECORDS = 2_400
export const ACTIVE_ASSISTANT_HISTORY_MAX_CHARACTERS = 6_000_000

export type AssistantRetainedHistory = AssistantThreadHistoryState & { lastUsedAt: number; shellRevision: string }
export type AssistantHistoryByThreadId = Record<string, AssistantRetainedHistory>

export function isAssistantRetainedHistoryFresh(
    history: AssistantRetainedHistory | undefined,
    thread?: AssistantThread | null,
    now = Date.now()
): boolean {
    return Boolean(
        history
        && now - history.lastUsedAt <= DETAIL_IDLE_TTL_MS
        && (!thread || history.shellRevision === getAssistantThreadHydrationRevision(thread))
    )
}

export function hasRenderableAssistantRetainedHistory(history: AssistantRetainedHistory | undefined): boolean {
    return Boolean(history && (
        history.messages.length
        || history.activities.length
        || history.proposedPlans.length
    ))
}

export function shouldHideAssistantRowsForSelection(input: {
    selectionTransitioning: boolean
    selectionHydrating: boolean
    thread: AssistantThread | null | undefined
}): boolean {
    if (!input.selectionTransitioning && !input.selectionHydrating) return false
    const thread = input.thread
    if (!thread) return true
    return !thread.messages.length
        && !thread.activities.length
        && !thread.proposedPlans.length
        && !thread.activePlan
        && !thread.pendingApprovals.length
        && !thread.pendingUserInputs.length
}

export function hasAssistantPersistedThreadContent(thread: AssistantThread | null | undefined): boolean {
    if (!thread) return false
    return (thread.messageCount || 0) > 0
        || (thread.activityCount || 0) > 0
        || (thread.proposedPlanCount || 0) > 0
        || thread.hasActivePlan
        || thread.hasPendingApprovals
        || thread.hasPendingUserInputs
}

export function formatAssistantHistoryLoadError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error || 'Failed to load earlier messages.')
    if (/aborted\(oom\)|out of memory/i.test(message)) {
        return 'Earlier messages exceeded the active history reader memory limit. Restart Zyra to load the bounded reader, then retry.'
    }
    return message
}

export function shouldRehydrateAssistantHistoryAfterCanonicalEvent(
    event: { type: string; threadId?: string | null; payload?: Record<string, unknown> },
    selectedThreadId: string | null
): boolean {
    if (!selectedThreadId || event.type !== 'thread.updated') return false
    const payload = event.payload && typeof event.payload === 'object' ? event.payload : {}
    const eventThreadId = String(event.threadId || payload['threadId'] || '')
    if (eventThreadId !== selectedThreadId) return false
    const patchValue = payload['patch']
    if (!patchValue || typeof patchValue !== 'object' || Array.isArray(patchValue)) return false
    const patch = patchValue as Record<string, unknown>
    return Object.prototype.hasOwnProperty.call(patch, 'canonicalHistoryModifiedAt')
        || Object.prototype.hasOwnProperty.call(patch, 'canonicalHistoryEntryCount')
}

export function shouldShowAssistantThreadHistoryLoader(input: {
    selectionHydrating: boolean
    snapshotLoading: boolean
    historyLoaded: boolean
    historyLoadFailed: boolean
    hasPersistedContent: boolean
}): boolean {
    if (input.selectionHydrating) return true
    return !input.snapshotLoading
        && !input.historyLoaded
        && !input.historyLoadFailed
        && input.hasPersistedContent
}

export function materializeAssistantShellSnapshot(snapshot: AssistantShellSnapshot): AssistantSnapshot {
    return {
        ...snapshot,
        sessions: snapshot.sessions.map((session) => ({
            ...session,
            threads: session.threads.map((thread): AssistantThread => ({
                ...thread,
                activePlan: null,
                messages: [],
                proposedPlans: [],
                activities: [],
                pendingApprovals: [],
                pendingUserInputs: []
            }))
        }))
    }
}

export function mergeAssistantShellSnapshot(
    current: AssistantSnapshot,
    incoming: AssistantShellSnapshot
): AssistantSnapshot {
    const currentThreads = new Map(current.sessions.flatMap((session) => session.threads.map((thread) => [thread.id, thread] as const)))
    return {
        ...incoming,
        sessions: incoming.sessions.map((session) => ({
            ...session,
            threads: session.threads.map((thread): AssistantThread => {
                const retained = currentThreads.get(thread.id)
                return {
                    ...thread,
                    activePlan: thread.hasActivePlan ? retained?.activePlan || null : null,
                    messages: retained?.messages || [],
                    proposedPlans: retained?.proposedPlans || [],
                    activities: retained?.activities || [],
                    pendingApprovals: thread.hasPendingApprovals ? retained?.pendingApprovals || [] : [],
                    pendingUserInputs: thread.hasPendingUserInputs ? retained?.pendingUserInputs || [] : []
                }
            })
        }))
    }
}

function mergeById<T extends { id: string }>(
    kind: AssistantTimelineRecordKind,
    existing: T[],
    incoming: T[]
): T[] {
    if (incoming.length === 0) return existing
    if (existing.length === 0) return incoming
    const compare = (left: T, right: T) => compareAssistantTimelineOrderKeys(
        getAssistantTimelineOrderKey(kind, left as never),
        getAssistantTimelineOrderKey(kind, right as never)
    )
    const isOrdered = (records: T[]) => {
        for (let index = 1; index < records.length; index += 1) {
            if (compare(records[index - 1]!, records[index]!) > 0) return false
        }
        return true
    }
    if (!isOrdered(existing) || !isOrdered(incoming)) {
        const byId = new Map(incoming.map((entry) => [entry.id, entry]))
        for (const entry of existing) byId.set(entry.id, entry)
        return [...byId.values()].sort(compare)
    }

    const merged: T[] = []
    let existingIndex = 0
    let incomingIndex = 0
    while (existingIndex < existing.length && incomingIndex < incoming.length) {
        const existingEntry = existing[existingIndex]!
        const incomingEntry = incoming[incomingIndex]!
        const order = compare(existingEntry, incomingEntry)
        if (existingEntry.id === incomingEntry.id) {
            merged.push(existingEntry)
            existingIndex += 1
            incomingIndex += 1
        } else if (order <= 0) {
            merged.push(existingEntry)
            existingIndex += 1
        } else {
            merged.push(incomingEntry)
            incomingIndex += 1
        }
    }
    while (existingIndex < existing.length) merged.push(existing[existingIndex++]!)
    while (incomingIndex < incoming.length) merged.push(incoming[incomingIndex++]!)
    return merged
}

function retainRecordsBefore<T extends { id: string }>(
    kind: AssistantTimelineRecordKind,
    records: T[],
    boundary: AssistantTimelineOrderKey | null
): T[] {
    if (!boundary) return []
    return records.filter((record) => compareAssistantTimelineOrderKeys(
        getAssistantTimelineOrderKey(kind, record as never),
        boundary
    ) < 0)
}

function patchThread(snapshot: AssistantSnapshot, threadId: string, patch: (thread: AssistantThread) => AssistantThread): AssistantSnapshot {
    let changed = false
    const sessions = snapshot.sessions.map((session) => {
        const threadIndex = session.threads.findIndex((thread) => thread.id === threadId)
        if (threadIndex < 0) return session
        const threads = [...session.threads]
        threads[threadIndex] = patch(threads[threadIndex]!)
        changed = true
        return { ...session, threads }
    })
    return changed ? { ...snapshot, sessions } : snapshot
}

function getOldestAssistantHistoryKey(history: Pick<AssistantThreadHistoryState, 'messages' | 'activities' | 'proposedPlans'>) {
    const candidates = [
        ...history.messages.map((record) => getAssistantTimelineOrderKey('message', record)),
        ...history.activities.map((record) => getAssistantTimelineOrderKey('activity', record)),
        ...history.proposedPlans.map((record) => getAssistantTimelineOrderKey('plan', record))
    ]
    return candidates.reduce<(typeof candidates)[number] | null>((oldest, candidate) => (
        !oldest || compareAssistantTimelineOrderKeys(candidate, oldest) < 0 ? candidate : oldest
    ), null)
}

export function shouldPreserveAssistantLoadedHistoryRange(
    existing: AssistantRetainedHistory | undefined,
    incoming: AssistantThreadHistoryState
): boolean {
    if (!existing || existing.pageInfo.hasNewer) return false
    const existingOldest = getOldestAssistantHistoryKey(existing)
    const incomingOldest = getOldestAssistantHistoryKey(incoming)
    if (!existingOldest) return false
    if (!incomingOldest) return true
    return compareAssistantTimelineOrderKeys(existingOldest, incomingOldest) < 0
}

export function applyAssistantThreadDetail(
    snapshot: AssistantSnapshot,
    detail: AssistantThreadDetail,
    existingHistory?: AssistantRetainedHistory
): { snapshot: AssistantSnapshot; history: AssistantRetainedHistory } {
    const now = Date.now()
    const preserveLoadedRange = shouldPreserveAssistantLoadedHistoryRange(existingHistory, detail.history)
    const pageInfo = preserveLoadedRange ? existingHistory!.pageInfo : detail.history.pageInfo
    const fullyLoaded = preserveLoadedRange ? existingHistory!.fullyLoaded : detail.history.fullyLoaded
    let mergedHistory: AssistantRetainedHistory = {
        ...detail.history,
        pageInfo,
        fullyLoaded,
        lastUsedAt: now,
        shellRevision: ''
    }
    const nextSnapshot = patchThread(snapshot, detail.threadId, (thread) => {
        const incomingOldest = getOldestAssistantHistoryKey(detail.history)
        const retainedMessages = preserveLoadedRange
            ? retainRecordsBefore('message', existingHistory!.messages, incomingOldest)
            : []
        const retainedActivities = preserveLoadedRange
            ? retainRecordsBefore('activity', existingHistory!.activities, incomingOldest)
            : []
        const retainedPlans = preserveLoadedRange
            ? retainRecordsBefore('plan', existingHistory!.proposedPlans, incomingOldest)
            : []
        const messages = mergeById('message', retainedMessages, detail.history.messages)
        const activities = mergeById('activity', retainedActivities, detail.history.activities)
        const proposedPlans = mergeById('plan', retainedPlans, detail.history.proposedPlans)
        const pendingApprovals = detail.pendingApprovals
        const pendingUserInputs = detail.pendingUserInputs
        const nextThread = {
            ...thread,
            activePlan: detail.activePlan,
            hasActivePlan: Boolean(detail.activePlan),
            messages,
            activities,
            proposedPlans,
            pendingApprovals,
            pendingUserInputs,
            hasPendingApprovals: pendingApprovals.some((entry) => entry.status === 'pending'),
            hasPendingUserInputs: pendingUserInputs.some((entry) => entry.status === 'pending')
        }
        mergedHistory = boundAssistantActiveHistoryWindow({
            ...detail.history,
            messages,
            activities,
            proposedPlans,
            pageInfo,
            fullyLoaded,
            lastUsedAt: now,
            shellRevision: getAssistantThreadHydrationRevision(nextThread)
        }, 'newer')
        return {
            ...nextThread,
            messages: mergedHistory.messages,
            activities: mergedHistory.activities,
            proposedPlans: mergedHistory.proposedPlans
        }
    })
    return { snapshot: nextSnapshot, history: mergedHistory }
}

export function applyAssistantRetainedHistory(
    snapshot: AssistantSnapshot,
    threadId: string,
    history: AssistantRetainedHistory
): AssistantSnapshot {
    return patchThread(snapshot, threadId, (thread) => ({
        ...thread,
        messages: mergeById('message', thread.messages, history.messages),
        activities: mergeById('activity', thread.activities, history.activities),
        proposedPlans: mergeById('plan', thread.proposedPlans, history.proposedPlans)
    }))
}

export function dematerializeAssistantHistories(
    snapshot: AssistantSnapshot,
    retainedThreadIds: ReadonlySet<string>
): AssistantSnapshot {
    let snapshotChanged = false
    const sessions = snapshot.sessions.map((session) => {
        let sessionChanged = false
        const threads = session.threads.map((thread) => {
            if (
                retainedThreadIds.has(thread.id)
                || (
                    !thread.activePlan
                    && thread.messages.length === 0
                    && thread.activities.length === 0
                    && thread.proposedPlans.length === 0
                )
            ) return thread
            sessionChanged = true
            return {
                ...thread,
                activePlan: null,
                messages: [],
                activities: [],
                proposedPlans: []
            }
        })
        if (!sessionChanged) return session
        snapshotChanged = true
        return { ...session, threads }
    })
    return snapshotChanged ? { ...snapshot, sessions } : snapshot
}

function filterRecordsAtOrAfter<T extends { id: string }>(
    kind: AssistantTimelineRecordKind,
    records: T[],
    boundary: AssistantTimelineOrderKey
): T[] {
    return records.filter((record) => compareAssistantTimelineOrderKeys(
        getAssistantTimelineOrderKey(kind, record as never),
        boundary
    ) >= 0)
}

function filterRecordsBefore<T extends { id: string }>(
    kind: AssistantTimelineRecordKind,
    records: T[],
    boundary: AssistantTimelineOrderKey
): T[] {
    return records.filter((record) => compareAssistantTimelineOrderKeys(
        getAssistantTimelineOrderKey(kind, record as never),
        boundary
    ) < 0)
}

export function boundAssistantActiveHistoryWindow(
    history: AssistantRetainedHistory,
    loadedDirection: 'older' | 'newer'
): AssistantRetainedHistory {
    let bounded = history
    while (
        bounded.messages.length + bounded.activities.length + bounded.proposedPlans.length > ACTIVE_ASSISTANT_HISTORY_MAX_RECORDS
        || estimateAssistantTimelineCollectionsCharacters(bounded, ACTIVE_ASSISTANT_HISTORY_MAX_CHARACTERS + 1) > ACTIVE_ASSISTANT_HISTORY_MAX_CHARACTERS
    ) {
        const userMessages = bounded.messages.filter((message) => message.role === 'user')
        if (userMessages.length <= 1) break
        const boundaryMessage = loadedDirection === 'older'
            ? userMessages[userMessages.length - 1]!
            : userMessages[1]!
        const boundary = getAssistantTimelineOrderKey('message', boundaryMessage)
        const messages = loadedDirection === 'older'
            ? filterRecordsBefore('message', bounded.messages, boundary)
            : filterRecordsAtOrAfter('message', bounded.messages, boundary)
        const activities = loadedDirection === 'older'
            ? filterRecordsBefore('activity', bounded.activities, boundary)
            : filterRecordsAtOrAfter('activity', bounded.activities, boundary)
        const proposedPlans = loadedDirection === 'older'
            ? filterRecordsBefore('plan', bounded.proposedPlans, boundary)
            : filterRecordsAtOrAfter('plan', bounded.proposedPlans, boundary)
        const cursor = encodeAssistantHistoryCursor(history.threadId, boundary)
        bounded = {
            ...bounded,
            messages,
            activities,
            proposedPlans,
            pageInfo: loadedDirection === 'older'
                ? { ...bounded.pageInfo, newestCursor: cursor, hasNewer: true }
                : { ...bounded.pageInfo, oldestCursor: cursor, hasOlder: true }
        }
    }
    return bounded
}

export function replaceAssistantVisibleHistory(
    snapshot: AssistantSnapshot,
    threadId: string,
    history: AssistantRetainedHistory
): AssistantSnapshot {
    return patchThread(snapshot, threadId, (thread) => ({
        ...thread,
        messages: history.messages,
        activities: history.activities,
        proposedPlans: history.proposedPlans
    }))
}

export function synchronizeAssistantVisibleHistory(
    snapshot: AssistantSnapshot,
    threadId: string,
    history: AssistantRetainedHistory,
    detachedFromLatest: boolean
): AssistantRetainedHistory {
    const thread = snapshot.sessions
        .flatMap((session) => session.threads)
        .find((candidate) => candidate.id === threadId)
    if (!thread) return history
    const residentMessageIds = detachedFromLatest ? new Set(history.messages.map((message) => message.id)) : null
    const residentActivityIds = detachedFromLatest ? new Set(history.activities.map((activity) => activity.id)) : null
    const residentPlanIds = detachedFromLatest ? new Set(history.proposedPlans.map((plan) => plan.id)) : null
    const messages = residentMessageIds
        ? thread.messages.filter((message) => residentMessageIds.has(message.id))
        : thread.messages
    const activities = residentActivityIds
        ? thread.activities.filter((activity) => residentActivityIds.has(activity.id))
        : thread.activities
    const proposedPlans = residentPlanIds
        ? thread.proposedPlans.filter((plan) => residentPlanIds.has(plan.id))
        : thread.proposedPlans
    return boundAssistantActiveHistoryWindow({
        ...history,
        messages,
        activities,
        proposedPlans,
        shellRevision: getAssistantThreadHydrationRevision(thread),
        lastUsedAt: Date.now()
    }, detachedFromLatest ? 'older' : 'newer')
}

export function applyAssistantHistoryAnchorPage(
    snapshot: AssistantSnapshot,
    current: AssistantRetainedHistory,
    page: AssistantHistoryPage
): { snapshot: AssistantSnapshot; history: AssistantRetainedHistory } {
    let history = current
    const nextSnapshot = patchThread(snapshot, page.threadId, (thread) => {
        history = boundAssistantActiveHistoryWindow({
            ...current,
            messages: page.messages,
            activities: page.activities,
            proposedPlans: page.proposedPlans,
            pageInfo: page.pageInfo,
            loadingOlder: false,
            loadingNewer: false,
            loadOlderError: null,
            loadNewerError: null,
            fullyLoaded: !page.pageInfo.hasOlder && !page.pageInfo.hasNewer,
            shellRevision: getAssistantThreadHydrationRevision(thread),
            lastUsedAt: Date.now()
        }, page.pageInfo.hasNewer ? 'older' : 'newer')
        return {
            ...thread,
            messages: history.messages,
            activities: history.activities,
            proposedPlans: history.proposedPlans
        }
    })
    return { snapshot: nextSnapshot, history }
}

export function applyAssistantHistoryPage(
    snapshot: AssistantSnapshot,
    current: AssistantRetainedHistory,
    page: AssistantHistoryPage,
    direction: 'older' | 'newer' = 'older'
): { snapshot: AssistantSnapshot; history: AssistantRetainedHistory } {
    let history = current
    const nextSnapshot = patchThread(snapshot, page.threadId, (thread) => {
        const messages = mergeById('message', thread.messages, page.messages)
        const activities = mergeById('activity', thread.activities, page.activities)
        const proposedPlans = mergeById('plan', thread.proposedPlans, page.proposedPlans)
        const pageInfo = direction === 'older'
            ? {
                oldestCursor: page.pageInfo.oldestCursor,
                newestCursor: current.pageInfo.newestCursor,
                hasOlder: page.pageInfo.hasOlder,
                hasNewer: current.pageInfo.hasNewer,
                turnCount: current.pageInfo.turnCount + page.pageInfo.turnCount
            }
            : {
                oldestCursor: current.pageInfo.oldestCursor,
                newestCursor: page.pageInfo.newestCursor,
                hasOlder: current.pageInfo.hasOlder,
                hasNewer: page.pageInfo.hasNewer,
                turnCount: current.pageInfo.turnCount + page.pageInfo.turnCount
            }
        const boundedHistory = boundAssistantActiveHistoryWindow({
            ...current,
            messages,
            activities,
            proposedPlans,
            pageInfo,
            loadingOlder: false,
            loadingNewer: false,
            loadOlderError: null,
            loadNewerError: null,
            fullyLoaded: !pageInfo.hasOlder && !pageInfo.hasNewer,
            lastUsedAt: Date.now()
        }, direction)
        history = {
            ...boundedHistory,
            pageInfo: {
                ...boundedHistory.pageInfo,
                turnCount: boundedHistory.messages.filter((message) => message.role === 'user').length
            }
        }
        return {
            ...thread,
            messages: history.messages,
            activities: history.activities,
            proposedPlans: history.proposedPlans
        }
    })
    return { snapshot: nextSnapshot, history }
}

export function pruneAssistantHistoryCache(
    histories: AssistantHistoryByThreadId,
    protectedThreadIds: ReadonlySet<string>,
    now = Date.now()
): AssistantHistoryByThreadId {
    const entries = Object.entries(histories)
        .filter(([threadId, history]) => protectedThreadIds.has(threadId) || now - history.lastUsedAt <= DETAIL_IDLE_TTL_MS)
        .sort((left, right) => right[1].lastUsedAt - left[1].lastUsedAt)
    const retained: typeof entries = []
    let retainedUnprotected = 0
    let retainedCharacters = 0
    for (const entry of entries) {
        const [threadId, history] = entry
        if (protectedThreadIds.has(threadId)) {
            retained.push(entry)
            continue
        }
        if (retainedUnprotected >= DETAIL_CACHE_LIMIT) continue
        const characters = estimateAssistantTimelineCollectionsCharacters(
            history,
            DETAIL_CACHE_MAX_TIMELINE_CHARACTERS + 1
        )
        if (retainedCharacters + characters > DETAIL_CACHE_MAX_TIMELINE_CHARACTERS) continue
        retained.push(entry)
        retainedUnprotected += 1
        retainedCharacters += characters
    }
    return Object.fromEntries(retained)
}
