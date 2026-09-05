import type {
    AssistantChatPluginScope,
    AssistantPluginCatalog,
    AssistantPluginInstallation,
    AssistantPluginRelease,
    AssistantPluginScopeDiff,
    AssistantPluginSet
} from '@shared/assistant/contracts'

export const GLOBAL_PLUGIN_OWNER_ID = 'global'

export function getPluginRelease(
    catalog: AssistantPluginCatalog,
    plugin: AssistantPluginInstallation
): AssistantPluginRelease | null {
    return catalog.releases.find((release) => release.id === plugin.activeReleaseId) || null
}

export function getPluginSet(catalog: AssistantPluginCatalog, projectId?: string | null): AssistantPluginSet | null {
    const ownerKind = projectId ? 'project' : 'global'
    const ownerId = projectId || GLOBAL_PLUGIN_OWNER_ID
    return catalog.pluginSets.find((set) => set.ownerKind === ownerKind && set.ownerId === ownerId) || null
}

export function pluginSetIncludes(catalog: AssistantPluginCatalog, pluginId: string, projectId?: string | null): boolean {
    return Boolean(getPluginSet(catalog, projectId)?.pluginIds.includes(pluginId))
}

export function togglePluginSetId(pluginIds: string[], pluginId: string, enabled: boolean): string[] {
    if (enabled) return pluginIds.includes(pluginId) ? pluginIds : [...pluginIds, pluginId]
    return pluginIds.filter((candidate) => candidate !== pluginId)
}

export function getChatPluginScope(catalog: AssistantPluginCatalog, sessionId?: string | null): AssistantChatPluginScope | null {
    if (!sessionId) return null
    return catalog.chatScopes.find((scope) => scope.sessionId === sessionId) || null
}

export function previewChatPluginScopeDiff(
    catalog: AssistantPluginCatalog,
    scope: AssistantChatPluginScope,
    targetProjectId?: string | null
): AssistantPluginScopeDiff {
    const projectId = targetProjectId === undefined
        ? scope.ownerKind === 'project' ? scope.ownerId : null
        : targetProjectId
    const activeSet = getPluginSet(catalog, projectId)
    const nextPlugins = (activeSet?.pluginIds || []).flatMap((pluginId) => {
        const plugin = catalog.plugins.find((candidate) => candidate.id === pluginId)
        const release = plugin?.activeReleaseId
            ? catalog.releases.find((candidate) => candidate.id === plugin.activeReleaseId)
            : null
        return plugin?.state === 'active' && release
            ? [{
                pluginId: plugin.id,
                releaseId: release.id,
                name: plugin.name,
                version: release.version,
                contentDigest: release.contentDigest,
                skillsPath: release.manifest.contributions.skills,
                capabilityCeiling: release.manifest.declaredCapabilityCeiling
            }]
            : []
    })
    const before = new Map(scope.plugins.map((plugin) => [plugin.pluginId, plugin]))
    const after = new Map(nextPlugins.map((plugin) => [plugin.pluginId, plugin]))
    return {
        added: nextPlugins.filter((plugin) => !before.has(plugin.pluginId)),
        removed: scope.plugins.filter((plugin) => !after.has(plugin.pluginId)),
        changed: nextPlugins.flatMap((plugin) => {
            const previous = before.get(plugin.pluginId)
            return previous && (previous.releaseId !== plugin.releaseId || previous.contentDigest !== plugin.contentDigest)
                ? [{ before: previous, after: plugin }]
                : []
        })
    }
}

export function isChatPluginScopeCurrent(
    catalog: AssistantPluginCatalog,
    scope: AssistantChatPluginScope | null,
    targetProjectId?: string | null
): boolean {
    if (!scope) return true
    const projectId = targetProjectId === undefined
        ? scope.ownerKind === 'project' ? scope.ownerId : null
        : targetProjectId
    const expectedOwnerKind = projectId ? 'project' : 'global'
    const expectedOwnerId = projectId || GLOBAL_PLUGIN_OWNER_ID
    if (scope.ownerKind !== expectedOwnerKind || scope.ownerId !== expectedOwnerId) return false
    const activeSet = getPluginSet(catalog, projectId)
    if (scope.pluginSetRevision !== (activeSet?.revision ?? 1)) return false
    const diff = previewChatPluginScopeDiff(catalog, scope, projectId)
    return diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0
}

export function formatDigest(contentDigest: string): string {
    return contentDigest.length > 20
        ? `${contentDigest.slice(0, 12)}…${contentDigest.slice(-8)}`
        : contentDigest
}

export function getContributionSummary(release: AssistantPluginRelease | null): string {
    if (!release) return 'No active release'
    const entries = Object.entries(release.manifest.contributions)
        .filter(([, value]) => value !== null)
        .map(([name]) => name)
    if (!entries.length) return 'No contributions'
    return entries.map((entry) => {
        if (entry === 'mcp') return 'MCP servers'
        if (entry === 'apps') return 'app views'
        if (entry === 'browserExtensions') return 'browser extensions'
        if (entry === 'scheduledTasks') return 'scheduled tasks'
        return entry
    }).join(', ')
}
