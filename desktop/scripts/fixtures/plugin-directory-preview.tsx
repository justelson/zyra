import React from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import storeCatalog from '../../src/shared/plugins/openai-directory.json'
import PluginsPage from '../../src/renderer/src/pages/plugins/PluginsPage'
import { assistantStore } from '../../src/renderer/src/lib/assistant/store'
import { makePluginDirectoryFixture, fixtureStandaloneSkills, fixtureSkillOverview } from './plugin-directory-data'
import '../../src/renderer/src/index.css'

const catalog = makePluginDirectoryFixture()
const overview = structuredClone(fixtureSkillOverview)
const clone = <T,>(value: T): T => structuredClone(value)
const calls: Array<{ method: string; input?: unknown }> = []
const switches = { failNext: false, empty: false, delay: 0 }
const result = async (method: string, input?: unknown) => {
    calls.push({ method, input })
    if (switches.delay) await new Promise((resolve) => setTimeout(resolve, switches.delay))
    if (switches.failNext) { switches.failNext = false; return { success: false, error: 'Fixture request failed. Try again.' } }
    return null
}
Object.defineProperty(navigator, 'userAgent', { configurable: true, value: navigator.userAgent + ' Electron/fixture' })
Object.assign(document.documentElement.style, { fontFamily: 'Arial, sans-serif' })
for (const [key, value] of Object.entries({ '--color-bg': '#111111', '--color-card': '#222222', '--color-text': '#eeeeee', '--color-text-secondary': '#a5a5a5', '--color-text-muted': '#858585', '--accent-primary': '#0ea5e9', '--accent-secondary': '#38bdf8' })) document.documentElement.style.setProperty(key, value)
const session = { id: 'fixture-chat', title: 'Fixture Chat', mode: 'work', projectId: null, projectPath: null, chatScope: { projectId: null }, activeThreadId: null, threadIds: [], threads: [], archived: false, createdAt: '2026-01-01', updatedAt: '2026-01-01' }
Object.assign(assistantStore.getState().snapshot, { selectedSessionId: session.id, sessions: [session] })
catalog.chatScopes.push({ sessionId: session.id, ownerKind: 'global', ownerId: 'global', pluginSetRevision: 1, scopeRevision: 1, plugins: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' })
const retained = clone(catalog.releases[0]); retained.id = 'fixture-old-release'; retained.version = '0.9.0'; retained.manifest.version = '0.9.0'; retained.contentDigest = 'a'.repeat(64); catalog.releases.push(retained)
catalog.plugins[0].releaseIds.push(retained.id)
let download: { id: string; name: string; reviewId: string } | null = null
let nextDownload = 0
let chatSnapshot = assistantStore.getState().snapshot
const review = () => {
    const entry = storeCatalog.entries.find(entry => entry.name === download?.name)!
    const release = clone(catalog.releases[0])
    Object.assign(release, { id: `fixture-release-${entry.name}`, pluginId: `fixture-${entry.name}`, name: entry.name, version: entry.version, contentDigest: 'f'.repeat(64) })
    Object.assign(release.manifest, { name: entry.name, version: entry.version, description: entry.longDescription })
    Object.assign(release.manifest.interface, { displayName: entry.displayName, shortDescription: entry.description, developerName: entry.publisher, category: entry.category })
    return { reviewId: download!.reviewId, expiresAt: '2099-01-01', manifest: release.manifest, release: { ...release, contributions: [{ kind: 'skills', support: 'supported' }], diagnostics: [] } }
}
const api = {
    startPluginDownload: async ({ name }: { name: string }) => {
        const failed = await result('startPluginDownload', { name }); if (failed) return failed
        download = { name, id: `fixture-download-${++nextDownload}`, reviewId: `fixture-review-${nextDownload}` }
        return { success: true, download: { id: download.id, status: 'downloading' } }
    },
    getPluginDownload: async ({ id }: { id: string }) => {
        const failed = await result('getPluginDownload', { id }); if (failed) return failed
        return download?.id === id ? { success: true, download: { id, status: 'ready', inspection: review() } } : { success: false, error: 'Download cancelled.' }
    },
    cancelPluginDownload: async ({ id }: { id: string }) => { await result('cancelPluginDownload', { id }); if (download?.id === id) download = null; return { success: true } },
    createPluginChat: async (selection: { pluginId: string; releaseId: string; contentDigest: string }) => {
        const failed = await result('createPluginChat', selection); if (failed) return failed
        const release = catalog.releases.find(r => r.id === selection.releaseId && r.pluginId === selection.pluginId && r.contentDigest === selection.contentDigest)
        if (!release) return { success: false, error: 'Release changed.' }
        const id = 'fixture-new-plugin-chat'
        chatSnapshot = { ...assistantStore.getState().snapshot, selectedSessionId: id, sessions: [...assistantStore.getState().snapshot.sessions, { ...session, id, title: 'New Plugin Chat' } as any] }
        return { success: true, sessionId: id }
    },
    getSnapshot: async () => clone(chatSnapshot),
    getStatus: async () => ({ available: false, connected: false, connecting: false, selectedSessionId: chatSnapshot.selectedSessionId, activeThreadId: null, providerThreadId: null, message: null }),
    getPluginCatalog: async () => await result('getPluginCatalog') || { success: true, catalog: switches.empty ? { ...clone(catalog), plugins: [], releases: [], sources: [] } : clone(catalog) },
    listProjects: async () => ({ success: true, catalog: { projects: [{ id: 'fixture-project', name: 'Sample Project', archived: false }] } }),
    listPromptResources: async () => await result('listPromptResources') || { success: true, skills: fixtureStandaloneSkills.filter((skill) => !skill.sourceId || overview.settings.enabledSourceIds.includes(skill.sourceId)), commands: [], diagnostics: [] },
    getSkillSourceOverview: async () => await result('getSkillSourceOverview') || { success: true, ...clone(overview) },
    updateSkillSourceSettings: async (settings: typeof overview.settings) => {
        const failed = await result('updateSkillSourceSettings', settings); if (failed) return failed
        overview.settings = clone(settings)
        overview.sources.forEach((source) => { source.enabled = settings.enabledSourceIds.includes(source.id) })
        return { success: true, ...clone(overview) }
    },
    setPluginState: async (input: { pluginId: string; state: 'active' | 'disabled' }) => {
        const failed = await result('setPluginState', input); if (failed) return failed
        catalog.plugins.find((plugin) => plugin.id === input.pluginId)!.state = input.state
        if (input.state === 'disabled') catalog.pluginSets.forEach((set) => { set.pluginIds = set.pluginIds.filter((id) => id !== input.pluginId); set.revision += 1 })
        return { success: true, catalog: clone(catalog) }
    },
    setPluginSet: async (input: { projectId?: string; pluginIds: string[]; expectedRevision: number }) => {
        const failed = await result('setPluginSet', input); if (failed) return failed
        const ownerId = input.projectId || 'global'
        let set = catalog.pluginSets.find((entry) => entry.ownerId === ownerId)
        if ((set?.revision ?? 1) !== input.expectedRevision) return { success: false, error: 'Plugin availability changed after it was inspected. Refresh and try again.' }
        if (!set) { set = { ownerId, ownerKind: 'project', revision: 1, pluginIds: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' }; catalog.pluginSets.push(set) }
        set.pluginIds = input.pluginIds; set.revision += 1
        return { success: true, catalog: clone(catalog) }
    },
    refreshChatPluginScope: async (input: unknown) => {
        await result('refreshChatPluginScope', input)
        const scope = catalog.chatScopes[0], set = catalog.pluginSets[0]
        scope.pluginSetRevision = set.revision
        scope.plugins = set.pluginIds.map((id) => { const p = catalog.plugins.find((entry) => entry.id === id)!; const r = catalog.releases.find((entry) => entry.id === p.activeReleaseId)!; return { pluginId: p.id, releaseId: r.id, name: p.name, version: r.version, contentDigest: r.contentDigest, skillsPath: r.manifest.contributions.skills, capabilityCeiling: [] } })
        return { success: true, diff: { added: clone(scope.plugins), removed: [], changed: [] } }
    },
    rollbackPlugin: async (input: { pluginId: string; releaseId: string }) => { await result('rollbackPlugin', input); catalog.plugins.find((entry) => entry.id === input.pluginId)!.activeReleaseId = input.releaseId; return { success: true, catalog: clone(catalog) } },
    inspectLocalPlugin: async (input: unknown) => { await result('inspectLocalPlugin', input); const release = catalog.releases[0]; return { success: true, inspection: { reviewId: 'fixture-review', expiresAt: '2099-01-01', manifest: release.manifest, release: { ...release, contributions: [{ kind: 'skills', support: 'supported' }, { kind: 'mcp', support: 'planned' }], diagnostics: [] } } } },
    installInspectedPlugin: async (input: unknown) => {
        const failed = await result('installInspectedPlugin', input); if (failed) return failed
        if (download) {
            const inspection = review(), entry = storeCatalog.entries.find(e => e.name === download!.name)!
            const pluginId = `fixture-${entry.name}`
            if (!catalog.plugins.some(p => p.id === pluginId)) {
                catalog.sources.push({ id: `openai-catalog:${entry.name}`, kind: 'official', label: 'OpenAI catalog', locator: entry.sourceUrl, createdAt: '2026-01-01', updatedAt: '2026-01-01' })
                catalog.plugins.push({ id: pluginId, name: entry.name, sourceId: `openai-catalog:${entry.name}`, state: 'active', activeReleaseId: inspection.release.id, releaseIds: [inspection.release.id], createdAt: '2026-01-01', updatedAt: '2026-01-01' })
                catalog.releases.push(inspection.release)
            }
            download = null
        }
        return { success: true, catalog: clone(catalog) }
    }
}
Object.defineProperty(window, 'devscope', { configurable: true, value: { assistant: api, selectFolder: async () => { await result('selectFolder'); return { success: true, folderPath: 'C:/fixture/package' } }, openBrowserPreviewExternal: async (url: string) => { await result('openExternal', { url }); return { success: true } } } })
Object.assign(window, { __pluginFixture: { calls, switches, catalog, state: () => assistantStore.getState().snapshot } })
createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={['/plugins']}><Routes><Route path="/plugins" element={<PluginsPage />} /><Route path="/assistant/*" element={<h1>New Plugin Chat</h1>} /></Routes></MemoryRouter>)
