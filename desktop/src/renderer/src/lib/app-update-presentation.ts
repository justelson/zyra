import type { DevScopeUpdateState } from '@shared/contracts/devscope-api'

export type UpdatePendingAction = 'check' | 'download' | 'install' | null

type SidebarUpdatePresentation = {
    status: DevScopeUpdateState['status'] | 'loading' | 'installing'
    label: string
    action: 'check' | 'download' | 'install' | 'details'
    busy: boolean
    disabled: boolean
    percent: number | null
}

export function installableUpdateVersion(state: DevScopeUpdateState | null): string | null {
    return state?.enabled && state.status === 'downloaded' ? state.downloadedVersion || null : null
}

export function sidebarUpdatePresentation(state: DevScopeUpdateState | null, pending: UpdatePendingAction, error: string | null = null): SidebarUpdatePresentation {
    const status: SidebarUpdatePresentation['status'] = pending === 'install' ? 'installing'
        : pending === 'download' ? 'downloading'
        : pending === 'check' ? 'checking'
        : error ? 'error'
        : !state ? 'loading'
        : !state.enabled ? 'disabled' : state.status
    const percent = status === 'downloading' && state?.downloadPercent != null && Number.isFinite(state.downloadPercent)
        ? Math.round(Math.max(0, Math.min(100, state.downloadPercent))) : null
    const base = { status, percent, busy: ['checking', 'downloading', 'installing'].includes(status), disabled: status === 'loading' || status === 'installing' }
    switch (status) {
        case 'available': return { ...base, label: 'Download', action: 'download' }
        case 'downloaded': return { ...base, label: 'Install', action: installableUpdateVersion(state) ? 'install' : 'details' }
        case 'downloading': return { ...base, label: percent === null ? 'Downloading' : `${percent}%`, action: 'details' }
        case 'installing': return { ...base, label: 'Restarting', action: 'details' }
        case 'checking': return { ...base, label: 'Checking', action: 'details' }
        case 'error': return { ...base, label: state ? 'View error' : 'Try again', action: state ? 'details' : 'check' }
        case 'disabled': case 'loading': return { ...base, label: 'Updates', action: 'details' }
        default: return { ...base, label: 'Check', action: 'check' }
    }
}
