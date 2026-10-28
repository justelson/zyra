export type RuntimeInstanceIdentity = {
    instanceId: string
    namespaceId: string
    channel: string
    protocolVersion: number
    runtimeRevision: string | null
    startedAt: string
}
export type RuntimeInstallation = {
    kind: 'development' | 'installed' | 'standalone'
    namespaceId?: string
    label: string
    appVersion?: string
}
export type RuntimeActivity = {
    activeTurns: number
    backgroundChats: number
    attention: number
    requests: number
    workspaceRequests: number
    externalTools: number
}
export type RuntimeActivationStatus = {
    phase: 'idle' | 'checking' | 'waiting' | 'restarting' | 'ready' | 'failed'
    revision?: string
    expectedRuntimeRevision?: string
    activity?: RuntimeActivity
    connection?: 'unknown' | 'connecting' | 'connected' | 'disconnected'
    lastConfirmedAt?: string
    errorCode?: string
    updatePending?: boolean
    instance?: RuntimeInstanceIdentity
    installation?: RuntimeInstallation
}
export const RUNTIME_ACTIVATION_GET = 'zyra:runtime:activation:get'
export const RUNTIME_ACTIVATION_CHANGED = 'zyra:runtime:activation:changed'
export const RUNTIME_ACTIVATION_REFRESH = 'zyra:runtime:activation:refresh'
export const RUNTIME_ACTIVATION_APPLY = 'zyra:runtime:activation:apply'
export const RUNTIME_CONNECTION_STALE_MS = 45_000

export function runtimeLifecyclePresentation(state: RuntimeActivationStatus, now = Date.now()) {
    const { live } = runtimeConnectionPresentation(state, now)
    const revision = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
    const expected = state.expectedRuntimeRevision
    const actual = state.instance?.runtimeRevision
    const codeState = live && revision(expected) && revision(actual)
        ? expected === actual ? 'current' : 'pending'
        : 'unknown'
    const labels = [
        ['activeTurns', 'active turn'], ['backgroundChats', 'background chat'], ['attention', 'pending question or approval'],
        ['requests', 'request'], ['workspaceRequests', 'desktop request'], ['externalTools', 'external tool']
    ] as const
    const knownActivity = state.activity && labels.every(([key]) => Number.isSafeInteger(state.activity![key]) && state.activity![key] >= 0)
    const blockers = live && knownActivity ? labels.flatMap(([key, label]) => {
        const count = state.activity![key]
        return count > 0 ? [`${count} ${label}${count === 1 ? '' : 's'}`] : []
    }) : []
    return {
        codeState, blockers, activityKnown: Boolean(knownActivity),
        canActivate: codeState === 'pending' && Boolean(knownActivity) && blockers.length === 0 && state.errorCode !== 'AGENT_SERVER_AUTH_FAILED'
    }
}

export function runtimeConnectionPresentation(state: RuntimeActivationStatus, now = Date.now()) {
    const age = state.lastConfirmedAt ? now - Date.parse(state.lastConfirmedAt) : Infinity
    const live = state.connection === 'connected' && (state.phase === 'ready' || state.phase === 'waiting') && Number.isFinite(age) && age >= -5_000 && age < RUNTIME_CONNECTION_STALE_MS
    const label = state.installation?.kind === 'development' ? state.installation.label || 'Development'
        : state.installation?.kind === 'installed' ? 'Installed' : state.installation?.label || 'Zyra'
    const detail = live ? state.updatePending ? 'Live · update pending' : 'Live'
        : state.connection === 'connecting' || state.phase === 'restarting' || state.phase === 'checking' ? 'Connecting'
        : state.connection === 'disconnected' ? 'Disconnected'
        : state.connection === 'connected' ? 'Status stale' : 'Status unavailable'
    const message = live && state.updatePending ? 'Update waiting. Your running chats are still connected.'
        : state.connection === 'disconnected' ? 'Connection lost. Displayed activity may be out of date; running work has not been stopped.'
        : state.phase === 'failed' ? 'Could not connect to this instance. Displayed activity may be out of date.'
        : state.connection === 'connected' && !live ? 'Live status is stale. Displayed activity may be out of date.' : null
    const tone = live && !state.updatePending ? 'success'
        : state.connection === 'disconnected' || state.phase === 'failed' ? 'danger' : 'warning'
    return { live, label, detail, message, tone }
}
