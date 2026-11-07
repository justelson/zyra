import type { AssistantMessage } from '@shared/assistant/contracts'
import type { TimelineRenderRow } from './assistant-timeline-helpers'
import { getAssistantUserTurnBoundaryIds } from './assistant-user-turn-boundaries'

const turnCopies = new WeakMap<object, Map<string, object>>()
function withTurn<T extends { turnId: string | null }>(value: T, turnId: string): T {
    if (value.turnId === turnId) return value
    let copies = turnCopies.get(value)
    if (!copies) turnCopies.set(value, copies = new Map())
    let copy = copies.get(turnId)
    if (!copy) copies.set(turnId, copy = { ...value, turnId })
    return copy as T
}

export function addPartialAssistantWorkBoundary(source: TimelineRenderRow[]): TimelineRenderRow[] {
    const first = source[0]
    if (!first || (first.kind === 'message' && (first.message.role === 'user' || first.message.modality === 'voice'))) return source
    const createdAt = first.createdAt || new Date(0).toISOString()
    const id = `partial-work:${first.id}`
    return [{ kind: 'message', id, createdAt, workBoundaryOnly: true,
        message: { id, role: 'user', text: '', turnId: null, streaming: false, createdAt, updatedAt: createdAt } }, ...source]
}

/** Recover presentation boundaries in SDK child histories without turn ids.
 * Copies stay in the renderer; canonical turns and private agent context stay intact. */
export function prepareAssistantWorkRowBoundaries(source: TimelineRenderRow[], messages: AssistantMessage[]) {
    const rows = source.slice()
    const boundaries = getAssistantUserTurnBoundaryIds(source)
    const usedTurnIds = new Set<string>()
    for (let start = 0; start < rows.length; start++) {
        const boundary = rows[start]
        if (boundary.kind !== 'message' || !boundaries.has(boundary.id)) continue
        let end = start + 1
        while (end < rows.length && !boundaries.has(rows[end].id)) end++
        const segment = rows.slice(start, end)
        const originalTurnId = boundary.message.turnId || segment.flatMap(row => row.kind === 'message' ? [row.message.turnId]
            : row.kind === 'activity' ? [row.activity.turnId] : 'activities' in row ? row.activities.map(activity => activity.turnId) : []).find(Boolean)
            || `timeline-turn:${boundary.id}`
        const isolate = Boolean(boundary.threadMessage) || usedTurnIds.has(originalTurnId)
        const turnId = isolate ? `timeline-turn:${boundary.id}` : originalTurnId
        usedTurnIds.add(originalTurnId)
        for (let index = start; index < end; index++) {
            const row = rows[index]
            if (row.kind === 'message' && (isolate || !row.message.turnId)) rows[index] = { ...row, message: withTurn(row.message, turnId) }
            else if (row.kind === 'activity' && (isolate || !row.activity.turnId)) rows[index] = { ...row, activity: withTurn(row.activity, turnId) }
            else if ('activities' in row && (isolate || row.activities.some(activity => !activity.turnId))) rows[index] = { ...row, activities: row.activities.map(activity => isolate || !activity.turnId ? withTurn(activity, turnId) : activity) }
        }
        start = end - 1
    }
    const byId = new Map(rows.flatMap(row => row.kind === 'message' ? [[row.message.id, row.message] as const] : []))
    const preparedMessages = messages.map(message => byId.get(message.id) || message)
    for (const row of rows) if (row.kind === 'message' && row.threadMessage) preparedMessages.push(row.message)
    return { rows, messages: preparedMessages }
}
