import { type RuntimeActivationStatus } from '../../shared/runtime-activation'
let state: RuntimeActivationStatus = { phase: 'idle' }
const listeners = new Set<(state: RuntimeActivationStatus) => void>()
export function subscribeRuntimeActivation(listener: (state: RuntimeActivationStatus) => void) {
    listeners.add(listener); return () => { listeners.delete(listener) }
}
export function readRuntimeActivation(): RuntimeActivationStatus { return { ...state } }
export function publishRuntimeActivation(value: RuntimeActivationStatus): void {
    if (!['idle', 'checking', 'waiting', 'restarting', 'ready', 'failed'].includes(value.phase)) return
    state = { phase: value.phase, ...(typeof value.revision === 'string' && /^[a-f0-9]{64}$/.test(value.revision) ? { revision: value.revision } : {}) }
    for (const listener of listeners) listener(readRuntimeActivation())
}
