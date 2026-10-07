import type { AssistantSession } from '@shared/assistant/contracts'

export type SettlementOverride = { state: 'active' | 'settled'; activityAt: string; activityKey?: string }
export type SettlementOverrides = Record<string, SettlementOverride>

export const AUTO_SETTLE_AFTER_MS = 3 * 24 * 60 * 60 * 1000

export function isAssistantChatSettled(session: AssistantSession, overrides: SettlementOverrides, { priority, ready, activityAt, now = Date.now() }: { priority: boolean; ready: boolean; activityAt: string; now?: number }): boolean {
    if (priority) return false
    const override = overrides[session.id]
    if (override && isSidebarSettlementCurrent(session, override)) return override.state === 'settled'
    const activity = Date.parse(activityAt)
    return ready && Number.isFinite(activity) && activity > 0 && now - activity >= AUTO_SETTLE_AFTER_MS
}

/** Use catalog metadata, never the currently loaded history page or navigation timestamps. */
export function getSidebarSettlementActivityKey(session: AssistantSession): string {
    return JSON.stringify(session.threads.map(thread => [
        thread.id,
        thread.messageCount || 0,
        thread.latestTurn?.id || '',
        thread.latestTurn?.state || '',
        thread.latestTurn?.requestedAt || '',
        thread.latestTurn?.completedAt || ''
    ]).sort((left, right) => String(left[0]).localeCompare(String(right[0]))))
}

export function isSidebarSettlementCurrent(session: AssistantSession, override: SettlementOverride): boolean {
    if (override.activityKey !== undefined) return override.activityKey === getSidebarSettlementActivityKey(session)
    // Older saved choices only contain a timestamp. Loading existing messages
    // cannot invalidate them; a newer turn boundary can. Capture the metadata
    // key when the catalog first arrives so later messages also invalidate them.
    const savedAt = Date.parse(override.activityAt)
    if (!Number.isFinite(savedAt)) return false
    return session.threads.every(thread => [thread.createdAt, thread.latestTurn?.requestedAt,
        thread.latestTurn?.startedAt, thread.latestTurn?.completedAt]
        .every(value => !value || !Number.isFinite(Date.parse(value)) || Date.parse(value) <= savedAt))
}

export function upgradeSidebarSettlementOverrides(overrides: SettlementOverrides, sessions: AssistantSession[]): SettlementOverrides {
    let next = overrides
    for (const session of sessions) {
        const override = overrides[session.id]
        if (!override || override.activityKey !== undefined || !isSidebarSettlementCurrent(session, override)) continue
        if (next === overrides) next = { ...overrides }
        next[session.id] = { ...override, activityKey: getSidebarSettlementActivityKey(session) }
    }
    return next
}
