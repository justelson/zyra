import type { DevScopeAppMenuCommand } from './contracts/devscope-api'

export function isAppMenuCommand(value: unknown): value is DevScopeAppMenuCommand {
    return value === 'new-chat' || value === 'search' || value === 'settings' || value === 'reload' || value === 'about' || value === 'browser-capture'
}

/** Capture commands arriving before React mounts or while its listener remounts. */
export function createAppMenuCommandQueue() {
    const listeners = new Set<(command: DevScopeAppMenuCommand) => void>()
    const pending: DevScopeAppMenuCommand[] = []
    return {
        push(value: unknown) {
            if (!isAppMenuCommand(value)) return
            if (listeners.size) for (const listener of listeners) listener(value)
            else { pending.push(value); if (pending.length > 16) pending.shift() }
        },
        subscribe(listener: (command: DevScopeAppMenuCommand) => void) {
            listeners.add(listener)
            for (const command of pending.splice(0)) listener(command)
            return () => { listeners.delete(listener) }
        }
    }
}
