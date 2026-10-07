import { useSyncExternalStore } from 'react'
import type { SettlementOverrides } from './assistant-sidebar-settlement'

const KEY = 'assistant:agent-inbox-settled-overrides:v1'
const listeners = new Set<() => void>()
function read(): SettlementOverrides {
    try {
        const value = JSON.parse(localStorage.getItem(KEY) || '{}')
        if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
        return Object.fromEntries(Object.entries(value).filter(([, entry]) => {
            const item = entry as Record<string, unknown> | null
            return item && (item.state === 'active' || item.state === 'settled') && typeof item.activityAt === 'string'
                && (item.activityKey === undefined || typeof item.activityKey === 'string')
        })) as SettlementOverrides
    } catch { return {} }
}
let snapshot = read()
const publish = () => { for (const listener of listeners) listener() }
const onStorage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) { snapshot = read(); publish() } }
function subscribe(listener: () => void) {
    if (!listeners.size) window.addEventListener('storage', onStorage)
    listeners.add(listener)
    return () => { listeners.delete(listener); if (!listeners.size) window.removeEventListener('storage', onStorage) }
}
export function setAssistantSettlementOverrides(update: SettlementOverrides | ((current: SettlementOverrides) => SettlementOverrides)) {
    const next = typeof update === 'function' ? update(snapshot) : update
    if (next === snapshot) return
    snapshot = next
    try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* retain the current choice in memory */ }
    publish()
}
export function useAssistantSettlementOverrides() {
    return [useSyncExternalStore(subscribe, () => snapshot), setAssistantSettlementOverrides] as const
}
