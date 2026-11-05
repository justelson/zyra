import type { AssistantDomainEvent, AssistantHistoryPage, AssistantSnapshot, AssistantThreadDetail } from '@shared/assistant/contracts'
import { applyAssistantDomainEvents } from '@shared/assistant/projector'
import { collapseAssistantDeltaEvents } from './event-batching'

const MAX_READ_EVENTS = 4096
export type AssistantHistoryRead = { threadId: string; events: AssistantDomainEvent[]; overflow: boolean }

/** A journal exists only while a history IPC read is in flight. */
export class AssistantHistoryReadJournal {
    private readonly reads = new Set<AssistantHistoryRead>()

    begin(threadId: string): AssistantHistoryRead {
        const read: AssistantHistoryRead = { threadId, events: [], overflow: false }
        this.reads.add(read)
        return read
    }

    record(event: AssistantDomainEvent): void {
        const threadId = String(event.payload['threadId'] || event.threadId || '')
        for (const read of this.reads) {
            if (read.threadId !== threadId || !event.type.startsWith('thread.')) continue
            if (read.events.length >= MAX_READ_EVENTS) { read.overflow = true; continue }
            read.events.push(event)
        }
    }

    finish(read: AssistantHistoryRead): void { this.reads.delete(read) }

    invalidate(): void { for (const read of this.reads) read.overflow = true }
}

export function canReplayAssistantHistoryRead(read: AssistantHistoryRead, page: AssistantHistoryPage): boolean {
    return !read.overflow && Number.isSafeInteger(page.snapshotSequence) && page.snapshotSequence! >= 0
}

/** Replay onto the read's rows, never onto the already-updated live arrays.
 * The database watermark prevents duplicating a delta already persisted by the read.
 * Only timeline/request fields escape this projection; current shell state stays live.
 */
export function replayAssistantHistoryRead<T extends AssistantHistoryPage>(
    snapshot: AssistantSnapshot,
    page: T,
    read: AssistantHistoryRead,
    detail?: AssistantThreadDetail
): T {
    if (!canReplayAssistantHistoryRead(read, page)) return page
    const events = collapseAssistantDeltaEvents(read.events.filter(event => event.sequence > page.snapshotSequence!))
    if (!events.length) return page
    const session = snapshot.sessions.find(session => session.threads.some(thread => thread.id === page.threadId))
    const thread = session?.threads.find(thread => thread.id === page.threadId)
    if (!session || !thread) return page
    const replaySnapshot: AssistantSnapshot = {
        ...snapshot,
        snapshotSequence: page.snapshotSequence!,
        sessions: [{ ...session, threads: [{
            ...thread, messages: page.messages, activities: page.activities, proposedPlans: page.proposedPlans,
            ...(detail ? { activePlan: detail.activePlan, pendingApprovals: detail.pendingApprovals, pendingUserInputs: detail.pendingUserInputs } : {})
        }] }]
    }
    const replayed = applyAssistantDomainEvents(replaySnapshot, events).sessions[0]?.threads[0]
    if (!replayed) return page
    if (detail) {
        detail.activePlan = replayed.activePlan
        detail.pendingApprovals = replayed.pendingApprovals
        detail.pendingUserInputs = replayed.pendingUserInputs
        return { ...page, messages: replayed.messages, activities: replayed.activities, proposedPlans: replayed.proposedPlans }
    }
    // A cursor page owns only its original records. New live rows already live
    // in the store; creating them here from a suffix delta would truncate text.
    const messageIds = new Set(page.messages.map(message => message.id))
    const activityIds = new Set(page.activities.map(activity => activity.id))
    const planIds = new Set(page.proposedPlans.map(plan => plan.id))
    return { ...page,
        messages: replayed.messages.filter(message => messageIds.has(message.id)),
        activities: replayed.activities.filter(activity => activityIds.has(activity.id)),
        proposedPlans: replayed.proposedPlans.filter(plan => planIds.has(plan.id))
    }
}
