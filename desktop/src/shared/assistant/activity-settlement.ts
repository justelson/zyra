import type { AssistantActivity } from './contracts'

/** A finished foreground turn cannot keep a lost tool call animated indefinitely. */
export function settleActivityAtTurnEnd(activity: AssistantActivity, completedAt: string, outcome: string): AssistantActivity {
    const payload = activity.payload || {}
    const surface = payload.surface && typeof payload.surface === 'object' ? payload.surface as Record<string, unknown> : null
    const raw = String(payload.status || payload.state || payload.phase || surface?.lifecycle || '').toLowerCase().replace(/[-_\s]/g, '')
    if (payload.background === true || payload.detached === true || payload.jobId || activity.kind.startsWith('subagent.')) return activity
    const recovery = activity.kind === 'connection.recovery' || activity.kind === 'provider.recovery' || payload.category === 'connection-recovery'
    if (recovery && raw === 'retrying') return {
        ...activity,
        summary: outcome === 'completed' ? 'Reconnected' : 'Connection interrupted',
        payload: { ...payload, status: outcome === 'completed' ? 'recovered' : 'paused', completedAt }
    }
    if (!['running', 'inprogress', 'pending', 'started', 'loading', 'working'].includes(raw)) return activity
    return {
        ...activity,
        payload: { ...payload, status: 'interrupted', completedAt, completionSource: 'turn-boundary', settlementReason: 'The turn ended before this action returned a completion result.' }
    }
}
