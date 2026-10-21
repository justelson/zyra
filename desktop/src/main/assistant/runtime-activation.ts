import { type RuntimeActivationStatus, type RuntimeActivity, type RuntimeInstallation, type RuntimeInstanceIdentity } from '../../shared/runtime-activation'

let state: RuntimeActivationStatus = { phase: 'idle', connection: 'unknown' }
const listeners = new Set<(state: RuntimeActivationStatus) => void>()
const text = (value: unknown, limit = 128) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, limit) : ''
const timestamp = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined
const revision = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : undefined

function identity(value: RuntimeInstanceIdentity | undefined): RuntimeInstanceIdentity | undefined {
    if (!value || !text(value.instanceId) || !text(value.namespaceId) || !timestamp(value.startedAt)) return undefined
    return {
        instanceId: text(value.instanceId), namespaceId: text(value.namespaceId), channel: text(value.channel, 64),
        protocolVersion: Number.isSafeInteger(value.protocolVersion) ? value.protocolVersion : 0,
        startedAt: timestamp(value.startedAt)!, runtimeRevision: revision(value.runtimeRevision) || null
    }
}
function activity(value: RuntimeActivity | undefined): RuntimeActivity | undefined {
    const keys = ['activeTurns', 'backgroundChats', 'attention', 'requests', 'workspaceRequests', 'externalTools'] as const
    if (!value || keys.some(key => !Number.isSafeInteger(value[key]) || value[key] < 0)) return undefined
    return Object.fromEntries(keys.map(key => [key, value[key]])) as RuntimeActivity
}
export function subscribeRuntimeActivation(listener: (state: RuntimeActivationStatus) => void) {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
}
export function readRuntimeActivation(): RuntimeActivationStatus { return structuredClone(state) }
export function configureRuntimeInstallation(value: RuntimeInstallation): void {
    state = { ...state, installation: { kind: value.kind, namespaceId: typeof value.namespaceId === 'string' && /^[a-f0-9]{20}$/.test(value.namespaceId) ? value.namespaceId : undefined, label: text(value.label, 96), appVersion: text(value.appVersion, 64) || undefined } }
    for (const listener of listeners) listener(readRuntimeActivation())
}
export function publishRuntimeActivation(value: RuntimeActivationStatus): void {
    if (!['idle', 'checking', 'waiting', 'restarting', 'ready', 'failed'].includes(value.phase)) return
    const connection = ['unknown', 'connecting', 'connected', 'disconnected'].includes(value.connection || '') ? value.connection : 'unknown'
    state = {
        phase: value.phase, connection,
        ...(state.installation ? { installation: state.installation } : {}),
        ...(identity(value.instance) || state.instance ? { instance: identity(value.instance) || state.instance } : {}),
        ...(revision(value.revision) ? { revision: revision(value.revision) } : {}),
        ...(revision(value.expectedRuntimeRevision) ? { expectedRuntimeRevision: revision(value.expectedRuntimeRevision) } : {}),
        ...(activity(value.activity) ? { activity: activity(value.activity) } : {}),
        ...(timestamp(value.lastConfirmedAt) || state.lastConfirmedAt ? { lastConfirmedAt: timestamp(value.lastConfirmedAt) || state.lastConfirmedAt } : {}),
        ...(typeof value.errorCode === 'string' && /^[A-Z0-9_]{1,96}$/.test(value.errorCode) ? { errorCode: value.errorCode } : {}),
        updatePending: value.updatePending === true
    }
    for (const listener of listeners) listener(readRuntimeActivation())
}
