import { useSyncExternalStore } from 'react'
import type { SettlementOverrides } from './assistant-sidebar-settlement'
import { getSidebarSettlementActivityKey, isSidebarSettlementCurrent } from './assistant-sidebar-settlement'
import type { AssistantSession } from '@shared/assistant/contracts'

const KEY = 'assistant:agent-inbox-settled-overrides:v1'
const listeners = new Set<() => void>()
let persistedRaw: string | null | undefined
function read(): SettlementOverrides {
    try {
        persistedRaw = localStorage.getItem(KEY)
        const value = JSON.parse(persistedRaw || '{}')
        if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
        return Object.fromEntries(Object.entries(value).filter(([, entry]) => {
            const item = entry as Record<string, unknown> | null
            return item && (item.state === 'active' || item.state === 'settled') && typeof item.activityAt === 'string'
                && (item.activityKey === undefined || typeof item.activityKey === 'string')
        }).map(([id, entry]) => {
            const choice = entry as SettlementOverrides[string]
            // Pending UI intent is memory-only, never trusted from disk.
            return [id, { state: choice.state, activityAt: choice.activityAt, activityKey: choice.activityKey }]
        })) as SettlementOverrides
    } catch { return {} }
}
let snapshot = read()
type PendingSettlement = { choice: SettlementOverrides[string]; confirmed: boolean; failed: boolean; previous?: PendingSettlement }
const pending = new Map<string, PendingSettlement>()
let view = snapshot
const updateView = () => { view = pending.size ? { ...snapshot, ...Object.fromEntries([...pending].map(([id, operation]) => [id, operation.choice])) } : snapshot }
const getSnapshot = () => view
const publish = () => { updateView(); for (const listener of listeners) listener() }

function reconcilePending(sessions: AssistantSession[]) {
    let changed = false
    for (const [id, operation] of pending) {
        const session = sessions.find(value => value.id === id)
        if (session && (!isSidebarSettlementCurrent(session, operation.choice)
            || operation.confirmed && session.settled === (operation.choice.state === 'settled'))) {
            pending.delete(id); changed = true
        }
    }
    if (changed) publish()
}

/** Share immediate intent across sidebar/header menus, without persisting it. */
export function beginAssistantSettlement(session: AssistantSession, settled: boolean) {
    const operation: PendingSettlement = { choice: { state: settled ? 'settled' : 'active', activityAt: session.updatedAt,
        activityKey: getSidebarSettlementActivityKey(session), optimistic: true }, confirmed: false, failed: false, previous: pending.get(session.id) }
    pending.set(session.id, operation)
    publish()
    return {
        confirm() {
            operation.confirmed = true
            if (pending.get(session.id) === operation) reconcilePending(latestSessions)
        },
        rollback() {
            operation.failed = true
            if (pending.get(session.id) !== operation) return
            let previous = operation.previous
            while (previous?.failed) previous = previous.previous
            if (previous) pending.set(session.id, previous)
            else pending.delete(session.id)
            reconcilePending(latestSessions)
            publish()
        }
    }
}
const onStorage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) { snapshot = read(); publish() } }
function subscribe(listener: () => void) {
    if (!listeners.size) {
        // Storage may change while no chat surface is mounted. A failed write
        // leaves persistedRaw unchanged, retaining the in-memory choice.
        try { if (localStorage.getItem(KEY) !== persistedRaw) { snapshot = read(); updateView() } } catch { /* retain memory */ }
        window.addEventListener('storage', onStorage)
    }
    listeners.add(listener)
    return () => { listeners.delete(listener); if (!listeners.size) window.removeEventListener('storage', onStorage) }
}
export function setAssistantSettlementOverrides(update: SettlementOverrides | ((current: SettlementOverrides) => SettlementOverrides)) {
    const next = typeof update === 'function' ? update(snapshot) : update
    if (next === snapshot) return
    snapshot = next
    try { const raw = JSON.stringify(next); localStorage.setItem(KEY, raw); persistedRaw = raw } catch { /* retain the current choice in memory */ }
    publish()
}
export function useAssistantSettlementOverrides() {
    return [useSyncExternalStore(subscribe, getSnapshot, getSnapshot), setAssistantSettlementOverrides] as const
}

let migration: Promise<void> | null = null
let latestSessions: AssistantSession[] = []
const retryAfter = new Map<string, number>()
export function migrateCanonicalSettlementOverrides(sessions: AssistantSession[]) {
    latestSessions = sessions
    reconcilePending(sessions)
    if (migration) return migration
    migration = migrateChoices().finally(() => { migration = null })
    return migration
}

async function migrateChoices() {
    // One catalog mutation at a time, including calls from repeated snapshots.
    for (const candidate of latestSessions) {
        const session = latestSessions.find(entry => entry.id === candidate.id)
        const choice = snapshot[candidate.id]
        if (!session || !choice || pending.has(session.id) || typeof session.settled !== 'boolean') continue
        if (!session.settlementManual && (!isSidebarSettlementCurrent(session, choice) || (retryAfter.get(session.id) || 0) > Date.now())) continue
        try {
            if (!session.settlementManual) {
                const result = await window.devscope.assistant.settleSession(session.id, choice.state === 'settled', true)
                if (!result.success) throw new Error(result.error)
            }
            retryAfter.delete(session.id)
            setAssistantSettlementOverrides(current => { const next = { ...current }; delete next[session.id]; return next })
        } catch {
            retryAfter.set(session.id, Date.now() + 60_000)
        }
    }
    // Mutations publish canonical session.updated events. Local override cleanup
    // must not bootstrap the assistant or invalidate the visible history.
}
