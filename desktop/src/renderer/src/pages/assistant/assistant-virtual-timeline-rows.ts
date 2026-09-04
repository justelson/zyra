import type { TimelineDisplayRow } from './assistant-timeline-helpers'

export type StableTimelineRowsState = {
    byId: Map<string, TimelineDisplayRow>
    rows: TimelineDisplayRow[]
}

function sameArrayReferences(left: readonly unknown[], right: readonly unknown[]): boolean {
    return left.length === right.length && left.every((entry, index) => entry === right[index])
}

function sameRowsEquivalent(left: readonly TimelineDisplayRow[], right: readonly TimelineDisplayRow[]): boolean {
    return left.length === right.length && left.every((entry, index) => areRowsEquivalent(entry, right[index]!))
}

function areRowsEquivalent(left: TimelineDisplayRow, right: TimelineDisplayRow): boolean {
    if (left === right) return true
    if (left.id !== right.id || left.kind !== right.kind || left.createdAt !== right.createdAt) return false
    if (left.kind === 'message' && right.kind === 'message') return left.message === right.message
    if (left.kind === 'activity' && right.kind === 'activity') return left.activity === right.activity
    if (left.kind === 'plan' && right.kind === 'plan') return left.plan === right.plan && left.canImplement === right.canImplement
    if (left.kind === 'user-input' && right.kind === 'user-input') return left.input === right.input
    if (left.kind === 'working' && right.kind === 'working') return true
    if (left.kind === 'turn-work-summary' && right.kind === 'turn-work-summary') {
        return left.turnId === right.turnId
            && left.startedAt === right.startedAt
            && left.completedAt === right.completedAt
            && left.running === right.running
            && left.terminalResponseVisible === right.terminalResponseVisible
            && left.outcome === right.outcome
            && ((!left.liveNarrationRow && !right.liveNarrationRow) || Boolean(left.liveNarrationRow && right.liveNarrationRow && areRowsEquivalent(left.liveNarrationRow, right.liveNarrationRow)))
            && sameRowsEquivalent(left.rows, right.rows)
    }
    if ('activities' in left && 'activities' in right) return sameArrayReferences(left.activities, right.activities)
    return false
}

export function computeStableAssistantTimelineRows(
    previous: StableTimelineRowsState | null,
    incoming: TimelineDisplayRow[]
): StableTimelineRowsState {
    const previousById = previous?.byId || new Map<string, TimelineDisplayRow>()
    const byId = new Map<string, TimelineDisplayRow>()
    const rows = incoming.map((row) => {
        const prior = previousById.get(row.id)
        const stable = prior && areRowsEquivalent(prior, row) ? prior : row
        byId.set(stable.id, stable)
        return stable
    })
    if (previous && sameArrayReferences(previous.rows, rows)) return previous
    return { byId, rows }
}
