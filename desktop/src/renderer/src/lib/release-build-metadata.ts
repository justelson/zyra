import type { DevScopeUpdateState } from '@shared/contracts/devscope-api'

export function resolveDesktopBuildChannel(version: string, devBuild = false): 'Dev' | 'Alpha' | 'Beta' | 'Stable' {
    if (devBuild || /^dev(?:[.-]|$)/i.test(version.split('-')[1] || '')) return 'Dev'
    const labels = { alpha: 'Alpha', beta: 'Beta', stable: 'Stable' } as const
    return labels[resolveDesktopReleaseChannel(version)]
}

export function resolveDesktopReleaseChannel(version: string): DevScopeUpdateState['channel'] {
    const prerelease = version.split('-')[1]?.toLowerCase() || ''
    if (prerelease.startsWith('alpha')) return 'alpha'
    if (prerelease.startsWith('beta')) return 'beta'
    return 'stable'
}

export function formatDesktopVersion(version: string): string {
    const match = version.match(/^(\d+\.\d+\.\d+)(?:-(alpha|beta)(?:[.-]?\d+)?)?$/i)
    if (!match) return `v${version}`
    return match[2] ? `v${match[1]} ${match[2].toLowerCase()}` : `v${match[1]}`
}

export function reportHostDesktopVersion(
    state: DevScopeUpdateState,
    version = __ZYRA_DESKTOP_VERSION__
): DevScopeUpdateState {
    if (!version || state.currentVersion === version) return state
    return {
        ...state,
        currentVersion: version,
        currentDisplayVersion: formatDesktopVersion(version),
        channel: resolveDesktopReleaseChannel(version)
    }
}
