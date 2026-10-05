export type DesktopBuildMetadata = {
    distribution: 'stable' | 'preview'
    sourceSha: string | null
    sourceRepository: string | null
    runId: string | null
}

export function createDesktopBuildMetadata(env: Record<string, string | undefined>): DesktopBuildMetadata {
    const distribution = env.ZYRA_BUILD_DISTRIBUTION || 'stable'
    if (distribution !== 'stable' && distribution !== 'preview') throw new Error('Unknown Desktop distribution')
    const sourceSha = env.ZYRA_BUILD_SOURCE_SHA || null
    const sourceRepository = env.ZYRA_BUILD_SOURCE_REPOSITORY || null
    const runId = env.GITHUB_RUN_ID || null
    if (sourceSha && !/^[a-f0-9]{40}$/.test(sourceSha)) throw new Error('Desktop source SHA must be a full commit SHA')
    if (sourceRepository && !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9_.-]+$/.test(sourceRepository)) throw new Error('Invalid Desktop source repository')
    if (runId && !/^\d+$/.test(runId)) throw new Error('Invalid Desktop build run ID')
    if (distribution === 'preview' && (!sourceSha || !sourceRepository || !runId)) {
        throw new Error('Preview builds require source SHA, repository and workflow run identity')
    }
    return { distribution, sourceSha, sourceRepository, runId }
}

declare const __ZYRA_BUILD_METADATA__: DesktopBuildMetadata

export const buildMetadata: Readonly<DesktopBuildMetadata> = Object.freeze(
    typeof __ZYRA_BUILD_METADATA__ === 'undefined'
        ? createDesktopBuildMetadata({})
        : __ZYRA_BUILD_METADATA__
)

export function isPreviewDistribution(metadata: Pick<DesktopBuildMetadata, 'distribution'> = buildMetadata): boolean {
    return metadata.distribution === 'preview'
}

export function resolveDistributionIdentity(isDev: boolean, metadata = buildMetadata, instanceSuffix = '') {
    const suffix = instanceSuffix.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 32)
    const appName = isDev ? `Zyra-dev${suffix ? `-${suffix}` : ''}` : isPreviewDistribution(metadata) ? 'Zyra Preview' : 'Zyra'
    return {
        appName,
        appUserModelId: isDev ? `app.zyra.desktop.dev${suffix ? `.${suffix}` : ''}` : isPreviewDistribution(metadata) ? 'app.zyra.desktop.preview' : 'app.zyra.desktop',
        userDataDirectoryName: appName,
        isDevRuntime: isDev,
        isolated: isDev || isPreviewDistribution(metadata)
    }
}

export function canManageGlobalTerminalCommand(isPackaged: boolean, metadata = buildMetadata): boolean {
    return isPackaged && !isPreviewDistribution(metadata)
}

export function previewAutoUpdateDisabledReason(metadata = buildMetadata): string | null {
    return isPreviewDistribution(metadata)
        ? 'Preview builds do not use the stable update feed. Install the next explicitly requested preview to update.'
        : null
}
