export interface AssistantModelRequestProgress {
    requestId: string
    turnId: string
    startedAt: number
    lastActivityAt: number
    phase: 'waiting' | 'streaming' | 'recovering'
    canPing: boolean
}

export function readModelRequestProgress(value: unknown, turnId: string): AssistantModelRequestProgress | null {
    if (!value || typeof value !== 'object' || !turnId) return null
    const row = value as Record<string, unknown>
    if (typeof row.requestId !== 'string' || !row.requestId || row.requestId.length > 200
        || typeof row.startedAt !== 'number' || !Number.isFinite(row.startedAt)
        || typeof row.lastActivityAt !== 'number' || !Number.isFinite(row.lastActivityAt)
        || row.startedAt <= 0 || row.lastActivityAt < row.startedAt
        || !['waiting', 'streaming', 'recovering'].includes(String(row.phase))) return null
    return { requestId: row.requestId, turnId, startedAt: row.startedAt, lastActivityAt: row.lastActivityAt,
        phase: row.phase as AssistantModelRequestProgress['phase'], canPing: row.canPing === true && row.phase !== 'recovering' }
}
