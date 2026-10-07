import { useSyncExternalStore } from 'react'
const KEY = 'assistant:pinned-session-ids:v1'
const listeners = new Set<() => void>()
export function readPinnedSessionIds(): Set<string> {
    try {
        const value = JSON.parse(localStorage.getItem(KEY) || '[]')
        return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && !!id.trim()) : [])
    } catch { return new Set() }
}
let snapshot = readPinnedSessionIds()
export const getPinnedSessionIds = () => snapshot
const publish = () => { for (const listener of listeners) listener() }
const onStorage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) { snapshot = readPinnedSessionIds(); publish() } }
function subscribe(listener: () => void) {
    if (!listeners.size) window.addEventListener('storage', onStorage)
    listeners.add(listener)
    return () => { listeners.delete(listener); if (!listeners.size) window.removeEventListener('storage', onStorage) }
}
export function writePinnedSessionIds(ids: Set<string>) {
    snapshot = ids
    try { localStorage.setItem(KEY, JSON.stringify([...ids])) } catch { /* retain pins in memory */ }
    publish()
}
export const usePinnedSessionIds = () => useSyncExternalStore(subscribe, () => snapshot)
