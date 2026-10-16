import { useEffect, useRef, useState } from 'react'

export type DeveloperActionRunner = (execute: () => Promise<void>, key?: string) => Promise<void>
export const NO_DEVELOPER_ACTIONS: ReadonlySet<string> = new Set()

/** Independent script/read actions; repository writes share a queue, never a dropped click. */
export function useDeveloperActions(root: string, refresh: () => Promise<void>, onError: (error: string) => void) {
    const [pendingActions, setPendingActions] = useState<ReadonlySet<string>>(NO_DEVELOPER_ACTIONS)
    const active = useRef(new Map<string, symbol>())
    const writes = useRef(Promise.resolve())
    const currentRoot = useRef(root)
    currentRoot.current = root
    useEffect(() => {
        active.current.clear(); writes.current = Promise.resolve(); setPendingActions(NO_DEVELOPER_ACTIONS)
        return () => { active.current.clear() }
    }, [root])
    const run: DeveloperActionRunner = async (execute, key = 'workspace') => {
        if (active.current.has(key)) return
        const token = Symbol(key)
        active.current.set(key, token); setPendingActions(new Set(active.current.keys())); onError('')
        const operation = async () => {
            if (root !== currentRoot.current || active.current.get(key) !== token) return
            await execute()
            if (root === currentRoot.current && active.current.get(key) === token) await refresh()
        }
        try {
            if (key === 'workspace' || key.startsWith('git:write:')) {
                const queued = writes.current.then(operation)
                writes.current = queued.catch(() => undefined)
                await queued
            } else await operation()
        } catch (reason) {
            if (root === currentRoot.current && active.current.get(key) === token) onError(reason instanceof Error ? reason.message : 'Action failed.')
        } finally {
            if (active.current.get(key) === token) {
                active.current.delete(key); setPendingActions(new Set(active.current.keys()))
            }
        }
    }
    return { run, pendingActions, busy: pendingActions.size > 0 }
}
