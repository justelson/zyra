import type { AssistantPluginCatalog, AssistantPromptSkillResource } from '@shared/assistant/contracts'
import { getPluginRelease } from './plugin-directory-state'

export type PluginDirectoryTab = 'plugins' | 'skills' | 'mcps'
export function pluginDirectoryTab(value: string | null): PluginDirectoryTab {
    return value === 'skills' || value === 'mcps' ? value : 'plugins'
}

export interface DirectorySkill {
    id: string
    name: string
    description: string
    source: string
    scope: string
    pluginId?: string
    version?: string
    manualOnly: boolean
}

export function directorySkills(catalog: AssistantPluginCatalog | null, resources: AssistantPromptSkillResource[]): DirectorySkill[] {
    const standalone = resources.filter((skill) => !skill.pluginId).map((skill) => ({
        id: `source:${skill.sourceId || skill.scope}:${skill.name}`,
        name: skill.name,
        description: skill.description,
        source: skill.sourceLabel || (skill.scope === 'built-in' ? 'Built-in' : skill.scope === 'project' ? 'Project' : 'Personal'),
        scope: skill.scope === 'built-in' ? 'Built-in' : skill.scope === 'project' ? 'Project' : 'Personal',
        manualOnly: skill.disableModelInvocation
    }))
    const contributed = (catalog?.plugins || []).flatMap((plugin) => {
        const release = getPluginRelease(catalog!, plugin)
        if (!release) return []
        return release.skills.map((skill) => ({
            id: `plugin:${plugin.id}:${release.id}:${skill.name}`,
            name: skill.name,
            description: skill.description,
            source: release.manifest.interface.displayName || plugin.name,
            scope: 'Plugin',
            pluginId: plugin.id,
            version: release.version,
            manualOnly: skill.disableModelInvocation
        }))
    })
    return [...standalone, ...contributed].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

// The catalog records an MCP contribution file, not parsed servers or live connections.
export function directoryMcpContributions(catalog: AssistantPluginCatalog | null) {
    return (catalog?.plugins || []).flatMap((plugin) => {
        const release = getPluginRelease(catalog!, plugin)
        if (!release?.manifest.contributions.mcp) return []
        return [{
            pluginId: plugin.id,
            name: release.manifest.interface.displayName || plugin.name,
            description: release.manifest.interface.shortDescription || release.manifest.description,
            version: release.version
        }]
    })
}

export function matchesDirectoryQuery(query: string, ...values: Array<string | undefined>): boolean {
    const needle = query.trim().toLocaleLowerCase()
    return !needle || values.some((value) => value?.toLocaleLowerCase().includes(needle))
}
