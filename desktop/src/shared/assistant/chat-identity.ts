import type { AssistantSession, AssistantSnapshot, AssistantThread } from './contracts'
import { remapAssistantFleetRoot, shouldApplyAssistantFleetSnapshot } from './fleet-projection'
import { mergeAssistantRequests } from './request-identity'

export type CanonicalChatIdentity = { canonicalChatId: string; aliases?: string[] }
export type AssistantChatRecord = { session: AssistantSession; thread: AssistantThread }
export type AssistantChatRequestEvidence = Pick<AssistantThread, 'pendingApprovals' | 'pendingUserInputs'>

/** Catalog aliases are registered before Desktop receives thread.started. */
export function findCanonicalChatRecords(sessions: AssistantSession[], chat: CanonicalChatIdentity): AssistantChatRecord[] {
    const aliases = new Set(chat.aliases || [])
    return sessions.flatMap(session => session.threads
        .filter(thread => thread.providerThreadId === chat.canonicalChatId
            || (!thread.providerThreadId && aliases.has(thread.id)))
        .map(thread => ({ session, thread })))
        .sort((left, right) => Number(isImportedChat(left)) - Number(isImportedChat(right))
            || left.session.createdAt.localeCompare(right.session.createdAt)
            || left.thread.id.localeCompare(right.thread.id))
}

export function isImportedChat(record: AssistantChatRecord): boolean {
    return record.session.id.startsWith('assistant-session:shared:')
        && record.thread.id.startsWith('assistant-thread:shared:')
        && record.session.threads.length === 1
}

function mergeRows<T extends { id: string; updatedAt?: string; streaming?: boolean }>(preferred: T[], fallback: T[]): T[] {
    const rows = new Map(fallback.map(row => [row.id, row]))
    for (const row of preferred) {
        const existing = rows.get(row.id)
        const completed = existing?.streaming === false && row.streaming === true
        if (!existing || !completed && (row.streaming === false && existing.streaming === true
            || (row.updatedAt || '') >= (existing.updatedAt || ''))) rows.set(row.id, row)
    }
    return [...rows.values()]
}

function pickLatestThread(original: AssistantThread, imported: AssistantThread): AssistantThread {
    if (original.latestTurn && imported.latestTurn?.id === original.latestTurn.id) {
        if (original.latestTurn.state === 'completed') return original
        if (imported.latestTurn.state === 'completed') return imported
        return (imported.latestTurn.completedAt || '') > (original.latestTurn.completedAt || '') ? imported : original
    }
    return (imported.latestTurn?.requestedAt || '') > (original.latestTurn?.requestedAt || '') ? imported : original
}

/** Keep the original scope/configuration; only combine conversation evidence. */
export function mergeAssistantChatRecords(snapshot: AssistantSnapshot, sessionId: string, threadId: string, duplicateSessionId: string, duplicateThreadId: string, requests?: AssistantChatRequestEvidence): AssistantSnapshot {
    const original = snapshot.sessions.find(session => session.id === sessionId)
    const duplicate = snapshot.sessions.find(session => session.id === duplicateSessionId)
    const thread = original?.threads.find(thread => thread.id === threadId)
    const other = duplicate?.threads.find(thread => thread.id === duplicateThreadId)
    if (!original || !duplicate || original.id === duplicate.id || !thread || !other
        || !thread.providerThreadId || thread.providerThreadId !== other.providerThreadId
        || !isImportedChat({ session: duplicate, thread: other })) return snapshot
    const latest = pickLatestThread(thread, other)
    const pendingApprovals = mergeAssistantRequests([...thread.pendingApprovals, ...other.pendingApprovals], requests?.pendingApprovals || [])
    const pendingUserInputs = mergeAssistantRequests([...thread.pendingUserInputs, ...other.pendingUserInputs], requests?.pendingUserInputs || [])
    const hasPendingApprovals = pendingApprovals.some(request => request.status === 'pending')
    const hasPendingUserInputs = pendingUserInputs.some(request => request.status === 'pending')
    const merged: AssistantThread = {
        ...thread,
        messages: mergeRows(thread.messages, other.messages),
        activities: mergeRows(thread.activities, other.activities),
        proposedPlans: mergeRows(thread.proposedPlans, other.proposedPlans),
        pendingApprovals,
        pendingUserInputs,
        latestTurn: latest.latestTurn,
        canonicalPresence: (other.canonicalPresence?.latestSequence || 0) > (thread.canonicalPresence?.latestSequence || 0)
            ? other.canonicalPresence : thread.canonicalPresence,
        state: latest.state === 'waiting' && !hasPendingApprovals && !hasPendingUserInputs
            ? latest.latestTurn?.state === 'running' ? 'running' : 'ready'
            : latest.state,
        lastError: latest.lastError,
        updatedAt: thread.updatedAt > other.updatedAt ? thread.updatedAt : other.updatedAt,
        messageCount: Math.max(thread.messageCount, other.messageCount),
        activityCount: Math.max(thread.activityCount, other.activityCount),
        proposedPlanCount: Math.max(thread.proposedPlanCount, other.proposedPlanCount),
        hasPendingApprovals,
        hasPendingUserInputs,
        lastMessageAt: (thread.lastMessageAt || '') > (other.lastMessageAt || '') ? thread.lastMessageAt : other.lastMessageAt
    }
    const fleetByThreadId = { ...snapshot.fleetByThreadId }
    const importedFleet = fleetByThreadId[duplicateThreadId]
    if (importedFleet) {
        const incoming = remapAssistantFleetRoot(importedFleet,
            { rootSessionId: duplicateSessionId, rootThreadId: duplicateThreadId }, { rootSessionId: sessionId, rootThreadId: threadId })
        if (shouldApplyAssistantFleetSnapshot(fleetByThreadId[threadId], incoming)) fleetByThreadId[threadId] = incoming
    }
    delete fleetByThreadId[duplicateThreadId]
    return {
        ...snapshot,
        selectedSessionId: snapshot.selectedSessionId === duplicateSessionId ? sessionId : snapshot.selectedSessionId,
        fleetByThreadId,
        sessions: snapshot.sessions.filter(session => session.id !== duplicateSessionId).map(session => {
            if (session.id !== sessionId && !session.threads.some(value => value.parentThreadId === duplicateThreadId)) return session
            return { ...session, threads: session.threads.map(value => value.id === threadId ? merged
                : value.parentThreadId === duplicateThreadId ? { ...value, parentThreadId: threadId } : value) }
        })
    }
}
