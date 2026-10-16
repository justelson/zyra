type Event = Record<string, unknown>
export type ReplayEntry = { sequence?: number; occurredAt?: string; recovery?: boolean; event?: unknown; requestContext?: { turnId?: string; localThreadId?: string } | null }
/** Recover current attention when a bounded journal no longer contains its opening event. */
export function recoverAttachmentReplay(attachment: Record<string, unknown>, after: number): { entries: ReplayEntry[]; resetWatermark: boolean } {
    const replay = recoverCompactions(attachment)
    const latest = Number(attachment.latestSequence) || 0
    const first = replay.length ? Math.min(...replay.map(entry => Number(entry.sequence) || 0)) : latest + 1
    const resetWatermark = latest < after
    const gap = resetWatermark || (latest > after && first > after + 1) || replay.some(entry => (entry.event as Event)?.type === 'zyra_server_event_omitted')
    if (!gap) return { entries: replay, resetWatermark }
    const context = attachment.activeRequestContext as ReplayEntry['requestContext']
    const recovery: ReplayEntry[] = []
    for (const event of [
        ...(Array.isArray(attachment.pendingTools) ? attachment.pendingTools as Event[] : []),
        ...(Array.isArray(attachment.pendingAttention) ? attachment.pendingAttention as Event[] : [])
    ]) {
        const present = replay.some(entry => {
            const candidate = entry.event as Event
            return candidate?.type === event.type && (event.requestId ? candidate.requestId === event.requestId : candidate.toolCallId === event.toolCallId)
        })
        if (!present) recovery.push({ event, requestContext: context })
    }
    const live = attachment.liveMessage as Event | undefined
    if (live && !replay.some(entry => {
        const message = (entry.event as Event)?.message as Event | undefined
        return message && message.role === live.role && (live.id ? message.id === live.id : live.timestamp ? message.timestamp === live.timestamp : JSON.stringify(message) === JSON.stringify(live))
    })) {
        recovery.push({ event: { type: 'message_update', message: attachment.liveMessage }, requestContext: context })
    }
    return { entries: [...replay, ...recovery], resetWatermark }
}

/** The pending snapshot is authoritative even when its start fell out of replay.
 * Historical starts whose worker no longer owns them settle as interrupted. */
function recoverCompactions(attachment: Record<string, unknown>): ReplayEntry[] {
    const replay = Array.isArray(attachment.replay) ? attachment.replay as ReplayEntry[] : []
    if (!Array.isArray(attachment.pendingOperations)) return replay
    const pending = (attachment.pendingOperations as ReplayEntry[]).filter(entry => (entry.event as Event)?.type === 'compaction_start')
    const unmatched = new Set<ReplayEntry>()
    let current: ReplayEntry | null = null
    for (const entry of replay) {
        const type = (entry.event as Event)?.type
        if (type === 'compaction_start') { unmatched.add(entry); current = entry }
        if (type === 'compaction_end' && current) { unmatched.delete(current); current = null }
    }
    const entries = replay.map(entry => unmatched.has(entry) && !pending.some(active => active.sequence === entry.sequence) ? {
        ...entry, event: { type: 'compaction_end', reason: (entry.event as Event).reason, aborted: true, recoveredAfterRestart: true,
            errorMessage: 'Previous context compaction is no longer active.' }
    } : entry)
    for (const entry of pending) {
        if (!entries.some(candidate => candidate.sequence === entry.sequence && (candidate.event as Event)?.type === 'compaction_start')) {
            entries.push({ ...entry, recovery: true })
        }
    }
    return entries.sort((left, right) => (Number(left.sequence) || Number.MAX_SAFE_INTEGER) - (Number(right.sequence) || Number.MAX_SAFE_INTEGER))
}
