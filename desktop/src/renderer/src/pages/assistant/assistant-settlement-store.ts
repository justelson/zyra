import { useSyncExternalStore } from 'react'
import type { SettlementOverrides } from './assistant-sidebar-settlement'

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
        })) as SettlementOverrides
    } catch { return {} }
}
let snapshot = read()
const getSnapshot = () => snapshot
const publish = () => { for (const listener of listeners) listener() }
const onStorage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) { snapshot = read(); publish() } }
function subscribe(listener: () => void) {
    if (!listeners.size) {
        // Storage may change while no chat surface is mounted. A failed write
        // leaves persistedRaw unchanged, retaining the in-memory choice.
        try { if (localStorage.getItem(KEY) !== persistedRaw) snapshot = read() } catch { /* retain memory */ }
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
