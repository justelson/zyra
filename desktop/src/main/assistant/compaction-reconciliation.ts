import type { AssistantActivity } from '../../shared/assistant/contracts'

type Payload = Record<string, unknown>
function isCompaction(activity: AssistantActivity): boolean {
    return activity.kind === 'context.compaction' || activity.kind === 'context-compaction'
        || activity.payload?.category === 'context-compaction'
}
function resultKey(payload: Payload | null | undefined): string | null {
    const canonical = payload?.canonicalEntry as Payload | undefined
    const result = canonical?.type === 'compaction' ? canonical : payload
    const kept = result?.firstKeptEntryId
    const tokens = result?.tokensBefore
    return typeof kept === 'string' && kept && typeof tokens === 'number' && Number.isFinite(tokens)
        ? JSON.stringify([kept, tokens]) : null
}

/** Modern results carry their original completion time. Equal metrics alone
 * remain a legacy fallback, not evidence that two known occurrences are one. */
function matchesStoredCompactionResult(activity: AssistantActivity, payload: Payload): boolean {
    if (resultKey(activity.payload) !== resultKey(payload)) return false
    if (typeof activity.payload?.sourceSequence === 'number' && typeof payload.sourceSequence === 'number') {
        return activity.payload.sourceSequence === payload.sourceSequence
            || (typeof payload.startedSequence === 'number' && activity.payload.startedSequence === payload.startedSequence)
    }
    const completedAt = typeof payload.completedAt === 'string' ? Date.parse(payload.completedAt) : NaN
    const storedCompletion = typeof activity.payload?.completedAt === 'string' ? Date.parse(activity.payload.completedAt) : NaN
    if (Number.isFinite(completedAt) && Number.isFinite(storedCompletion)) return completedAt === storedCompletion
    const canonical = activity.payload?.canonicalEntry as Payload | undefined
    if (canonical?.type !== 'compaction') return true // Older runtime copies may have no original completion time.
    const committedAt = Date.parse(String(canonical.timestamp || activity.createdAt))
    // The canonical commit precedes delivery of the runtime terminal event.
    return !Number.isFinite(completedAt) || !Number.isFinite(committedAt) || Math.abs(completedAt - committedAt) <= 5000
}

/** Only replay may match a settled lifecycle. Identical live results can be
 * independent operations and must keep their own rows. */
export function findReplayedCompaction(activities: AssistantActivity[], payload: Payload): AssistantActivity | null {
    if (payload.replay !== true) return null
    const sequence = payload.sourceSequence
    const hasSequence = typeof sequence === 'number' && Number.isFinite(sequence)
    const sequences = [sequence, payload.startedSequence].filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    const matches = activities.filter(activity => isCompaction(activity) && sequences.some(value =>
        activity.payload?.sourceSequence === value || activity.payload?.startedSequence === value))
    const settled = matches.find(activity => activity.payload?.status !== 'running')
    if (settled?.payload?.status === 'completed' || settled?.payload?.canonicalEntry) return settled
    if (payload.status === 'completed') {
        const key = resultKey(payload)
        const canonical = key && activities.find(activity => isCompaction(activity)
            && (activity.payload?.canonicalEntry as Payload | undefined)?.type === 'compaction'
            && (!hasSequence || typeof activity.payload?.sourceSequence !== 'number') && matchesStoredCompactionResult(activity, payload))
        if (canonical) return canonical
    }
    if (settled) return settled
    if (matches[0]) return matches[0]
    if (payload.status !== 'completed') return null
    const key = resultKey(payload)
    if (!key) return null
    return activities.find(activity => isCompaction(activity) && activity.payload?.status === 'completed'
        && (!hasSequence || typeof activity.payload?.sourceSequence !== 'number') && matchesStoredCompactionResult(activity, payload)) || null
}

/** Canonical entries are durable, distinct operations. Drop their live/replay
 * projections, never canonical entries or failed/cancelled attempts. */
export function findSupersededRuntimeCompactionIds(existing: AssistantActivity[], canonical: AssistantActivity[]): string[] {
    const committed = canonical.filter(activity => isCompaction(activity)
        && (activity.payload?.canonicalEntry as Payload | undefined)?.type === 'compaction' && resultKey(activity.payload))
    return existing.filter(activity => activity.kind === 'context.compaction'
        && activity.payload?.status === 'completed'
        && !activity.payload?.canonicalEntry
        && committed.some(entry => matchesStoredCompactionResult(entry, activity.payload!))).map(activity => activity.id)
}

/** Reconcile one operation only. A stale start from another operation is history,
 * not a candidate for the next start/end, even when it is still marked running. */
export function reconcileRuntimeCompaction(activities: AssistantActivity[], payload: Payload, activityId?: string, turnId?: string | null): { target: AssistantActivity | null; duplicateIds: string[] } {
    const sequences = [payload.sourceSequence, payload.startedSequence].filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    let matching = activities.filter(activity => isCompaction(activity) && (
        activity.id === activityId || sequences.some(value => activity.payload?.sourceSequence === value || activity.payload?.startedSequence === value)
    ))
    if (!matching.length && payload.replay === true && payload.status !== 'running' && payload.startedSequence == null && turnId
        && typeof payload.sourceSequence === 'number') {
        // Old journals lack start identity on terminal events. Only one saved,
        // unfinished attempt in the same durable turn is a safe legacy match.
        const legacy = activities.filter(activity => isCompaction(activity) && activity.turnId === turnId
            && !activity.payload?.canonicalEntry && (activity.payload?.status === 'running' || activity.payload?.status === 'cancelled' && activity.payload.recoveredAfterRestart === true)
            && typeof activity.payload?.startedSequence === 'number' && activity.payload.startedSequence < (payload.sourceSequence as number))
        if (legacy.length === 1) matching = legacy
    }
    const target = findReplayedCompaction(activities, payload) || matching.find(activity => activity.payload?.status !== 'running') || matching[0] || null
    return { target, duplicateIds: matching.filter(activity => activity.id !== target?.id && !activity.payload?.canonicalEntry).map(activity => activity.id) }
}

export function findInactiveRuntimeCompactions(activities: AssistantActivity[], active: Array<{ sequence?: number; occurredAt?: string }>): AssistantActivity[] {
    return activities.filter(activity => isCompaction(activity) && activity.payload?.status === 'running'
        && !activity.payload?.canonicalEntry && !active.some(entry =>
            (entry.sequence != null && (activity.payload?.sourceSequence === entry.sequence || activity.payload?.startedSequence === entry.sequence))
            || (entry.occurredAt && entry.occurredAt === (activity.payload?.startedAt || activity.createdAt))))
}
