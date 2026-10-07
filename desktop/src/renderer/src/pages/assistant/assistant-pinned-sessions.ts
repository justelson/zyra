import { useSyncExternalStore } from 'react'
const KEY = 'assistant:pinned-session-ids:v1'
const listeners = new Set<() => void>()
let persistedRaw: string | null | undefined
export function readPinnedSessionIds(): Set<string> {
    try {
        persistedRaw = localStorage.getItem(KEY)
        const value = JSON.parse(persistedRaw || '[]')
        return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && !!id.trim()) : [])
    } catch { return new Set() }
}
let snapshot = readPinnedSessionIds()
export const getPinnedSessionIds = () => snapshot
const publish = () => { for (const listener of listeners) listener() }
const onStorage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) { snapshot = readPinnedSessionIds(); publish() } }
function subscribe(listener: () => void) {
    if (!listeners.size) {
        try { if (localStorage.getItem(KEY) !== persistedRaw) snapshot = readPinnedSessionIds() } catch { /* retain memory */ }
        window.addEventListener('storage', onStorage)
    }
    listeners.add(listener)
    return () => { listeners.delete(listener); if (!listeners.size) window.removeEventListener('storage', onStorage) }
}
export function writePinnedSessionIds(ids: Set<string>) {
    snapshot = ids
    try { const raw = JSON.stringify([...ids]); localStorage.setItem(KEY, raw); persistedRaw = raw } catch { /* retain pins in memory */ }
    publish()
}
export const usePinnedSessionIds = () => useSyncExternalStore(subscribe, () => snapshot)
