import { useCallback, useSyncExternalStore } from 'react'
import type { ControlCursorState } from '@shared/agent-control/contracts'
const cursors = new Map<string, ControlCursorState>()
const listeners = new Map<string, Set<() => void>>()
let unsubscribe: (() => void) | undefined
function subscribe(targetId: string, listener: () => void) {
    const target = listeners.get(targetId) || new Set<() => void>()
    target.add(listener); listeners.set(targetId, target)
    if (!unsubscribe) unsubscribe = window.devscope.agentControl.onCursorChange(cursor => {
        if (!listeners.has(cursor.targetId)) return
        cursors.set(cursor.targetId, cursor)
        for (const notify of listeners.get(cursor.targetId) || []) notify()
    })
    return () => {
        target.delete(listener)
        if (!target.size) { listeners.delete(targetId); cursors.delete(targetId) }
        if (!listeners.size) { unsubscribe?.(); unsubscribe = undefined }
    }
}
/** Cursor frames update their two leaf surfaces, never the inspector or tab catalog. */
export function useBrowserTargetCursor(targetId: string | undefined, active: boolean, fallback: ControlCursorState | null) {
    const listen = useCallback((listener: () => void) => targetId ? subscribe(targetId, listener) : () => {}, [targetId])
    const snapshot = useCallback(() => targetId && active ? cursors.get(targetId) || null : null, [targetId, active])
    const live = useSyncExternalStore(listen, snapshot, () => null)
    return live && (!fallback || live.updatedAt >= fallback.updatedAt) ? live : fallback
}
