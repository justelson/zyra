import type { AssistantPluginCatalog, AssistantPluginManifest, AssistantPromptSkillResource, AssistantSkillSourceOverviewPayload } from '../../src/shared/assistant/contracts'

export function makePluginDirectoryFixture(): AssistantPluginCatalog {
    const names = [
        ['Review Helper', 'Review a bounded change before applying it.'],
        ['Docs Toolkit', 'Find answers and keep project documentation current.'],
        ['Workspace Search', 'Search files and understand a codebase.'],
        ['Build Notes', 'Turn build results into useful release notes.'],
        ['Design Review', 'Check layouts, interactions, and accessibility.'],
        ['Task Planner', 'Break project work into small, testable steps.']
    ]
    const now = '2026-01-01T00:00:00.000Z'
    const plugins = names.map(([name], i) => ({ id: `fixture-plugin-${i}`, sourceId: 'fixture-source', name: name.toLowerCase().replaceAll(' ', '-'), state: i === 3 ? 'disabled' as const : 'active' as const, activeReleaseId: `fixture-release-${i}`, releaseIds: [`fixture-release-${i}`], createdAt: now, updatedAt: now }))
    return {
        version: 1, revision: 1,
        sources: [{ id: 'fixture-source', kind: 'local', label: 'Test packages', locator: 'C:/fixture/packages', createdAt: now, updatedAt: now }],
        plugins,
        releases: plugins.map((plugin, i) => {
            const manifest: AssistantPluginManifest = {
                schemaVersion: 1, format: 'openai-codex-plugin-v1', name: plugin.name, version: '1.0.0', description: names[i][1],
                author: { name: 'Fixture Publisher' }, homepageUrl: null, repositoryUrl: null, license: 'MIT', keywords: [], declaredCapabilityCeiling: [],
                contributions: { skills: './skills', mcp: i < 2 ? './.mcp.json' : null, commands: null, apps: null, agents: null, hooks: null, browserExtensions: null, scheduledTasks: null },
                interface: { displayName: names[i][0], shortDescription: names[i][1], longDescription: '', developerName: 'Fixture Publisher', category: '', capabilities: [], websiteUrl: null, privacyPolicyUrl: null, termsOfServiceUrl: null, defaultPrompt: [], composerIcon: null, logo: null, logoDark: null, screenshots: [], brandColor: null }
            }
            return { id: plugin.activeReleaseId!, pluginId: plugin.id, version: '1.0.0', contentDigest: `${i}`.repeat(64), packagePath: `C:/fixture/releases/${plugin.id}`, manifest, fileCount: 3, totalBytes: 2400, containsExecutableFiles: false, skills: [{ name: plugin.name, description: names[i][1], relativePath: `skills/${plugin.name}/SKILL.md`, disableModelInvocation: false }], installedAt: now }
        }),
        pluginSets: [{ ownerKind: 'global', ownerId: 'global', revision: 1, pluginIds: [], createdAt: now, updatedAt: now }],
        chatScopes: []
    }
}

export const fixtureStandaloneSkills: AssistantPromptSkillResource[] = [
    { name: 'test-code-review', description: 'Review recent changes and identify integration risks.', scope: 'personal', sourceId: 'fixture-personal', sourceLabel: 'Personal folders', disableModelInvocation: false },
    { name: 'test-project-guide', description: 'Explain the project structure and its conventions.', scope: 'project', sourceId: 'fixture-project', sourceLabel: 'Project folder', disableModelInvocation: false },
    { name: 'test-manual-check', description: 'A Skill that requires an explicit request.', scope: 'built-in', disableModelInvocation: true }
]

export const fixtureSkillOverview: AssistantSkillSourceOverviewPayload = {
    settings: { version: 1, enabledSourceIds: ['fixture-personal', 'fixture-project'], priority: ['fixture-project', 'fixture-personal'], preferredSourceBySkill: {}, customSources: [] },
    sources: [
        { id: 'fixture-project', label: 'Project folder', description: 'Skills for this Project.', enabled: true, priority: 0, detected: true, skillCount: 1, paths: [{ path: 'C:/fixture/project/skills', scope: 'project', detected: true }], custom: false },
        { id: 'fixture-personal', label: 'Personal folders', description: 'Skills available across your Projects.', enabled: true, priority: 1, detected: true, skillCount: 1, paths: [{ path: 'C:/fixture/personal/skills', scope: 'personal', detected: true }], custom: false }
    ], conflicts: [], diagnostics: []
}
