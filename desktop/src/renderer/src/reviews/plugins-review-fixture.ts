import { makePluginDirectoryFixture } from '../../../../scripts/fixtures/plugin-directory-data'
import { installProvidersReviewFixture } from './providers-review-fixture'
import { assistantStore } from '@/lib/assistant/store'

export function installPluginsReviewFixture() {
    installProvidersReviewFixture()
    const scenario = new URLSearchParams(location.search).get('scenario') || 'installed'
    const catalog = makePluginDirectoryFixture()
    const samples = [
        ['github', 'GitHub', 'Repositories, issues and pull requests.'],
        ['figma', 'Figma', 'Design files, components and prototypes.'],
        ['linear', 'Linear', 'Issues, projects and team planning.'],
        ['review-helper', 'Review Helper', 'Review changes before applying them.']
    ]
    catalog.plugins = catalog.plugins.slice(0, samples.length)
    catalog.releases = catalog.releases.slice(0, samples.length)
    catalog.plugins.forEach((plugin, index) => {
        plugin.name = samples[index][0]
        if (index < 3) plugin.sourceId = `openai-catalog:${plugin.name}`
        const release = catalog.releases[index]
        release.version = index ? '1.2.0' : '2.1.0'
        release.manifest.name = plugin.name
        release.manifest.version = release.version
        release.manifest.description = samples[index][2]
        Object.assign(release.manifest.interface, { displayName: samples[index][1], shortDescription: samples[index][2], developerName: index < 3 ? samples[index][1] : 'Community' })
    })
    const previous = structuredClone(catalog.releases[0])
    previous.id = 'review-previous-release'; previous.version = '2.0.0'; previous.manifest.version = previous.version
    catalog.releases.push(previous); catalog.plugins[0].releaseIds.push(previous.id)
    catalog.appViews.enabled = true
    catalog.appViews.pluginIds = [catalog.plugins[0].id]
    if (scenario === 'empty') { catalog.plugins = []; catalog.releases = [] }
    if (scenario === 'attention') catalog.plugins[2].state = 'quarantined'
    let failNext = scenario === 'error'
    const connected = new Set([catalog.plugins[0]?.id])
    const calls: Array<{ method: string; input?: unknown }> = []
    const clone = () => structuredClone(catalog)
    const api = window.devscope.assistant
    const chatSnapshot = () => {
        const current = assistantStore.getState().snapshot
        const id = 'review-new-plugin-chat'
        return { ...current, selectedSessionId: id, sessions: [{ id, title: 'New plugin chat', mode: 'work', projectPath: null, playgroundLabId: null, pendingLabRequest: null, archived: false, activeThreadId: null, threadIds: [], threads: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] }
    }
    Object.assign(api, {
        getPluginCatalog: async () => {
            if (scenario === 'loading') await new Promise(resolve => setTimeout(resolve, 1500))
            if (failNext) { failNext = false; return { success: false, error: 'Could not load plugins. Refresh to retry.' } }
            return { success: true, catalog: clone() }
        },
        listProjects: async () => ({ success: true, catalog: { projects: [] } }),
        setPluginState: async (input: { pluginId: string; state: 'active' | 'disabled' }) => {
            calls.push({ method: 'setPluginState', input })
            const plugin = catalog.plugins.find(entry => entry.id === input.pluginId)!
            plugin.state = input.state; catalog.revision++
            return { success: true, catalog: clone() }
        },
        setPluginAppViewSettings: async (input: { pluginId?: string; enabled?: boolean; displayMode?: 'manual' | 'automatic'; expectedCatalogRevision: number }) => {
            calls.push({ method: 'setPluginAppViewSettings', input })
            if (input.expectedCatalogRevision !== catalog.revision) return { success: false, error: 'Settings changed. Refresh and retry.' }
            if (input.pluginId) catalog.appViews.pluginIds = input.enabled ? [...new Set([...catalog.appViews.pluginIds, input.pluginId])] : catalog.appViews.pluginIds.filter(id => id !== input.pluginId)
            else if (input.enabled !== undefined) catalog.appViews.enabled = input.enabled
            if (input.displayMode) catalog.appViews.displayMode = input.displayMode
            catalog.revision++; return { success: true, catalog: clone() }
        },
        getPluginMcpConnections: async (pluginId: string) => ({ success: true, connections: [{ pluginId, server: catalog.plugins.find(entry => entry.id === pluginId)?.name || 'service', kind: 'http', destination: 'example.test', state: connected.has(pluginId) ? 'connected' : 'not-connected' }] }),
        connectPluginMcp: async (pluginId: string, server: string) => { calls.push({ method: 'connectPluginMcp', input: { pluginId, server } }); connected.add(pluginId); return { success: true, authenticated: true, toolCount: 3 } },
        disconnectPluginMcp: async (pluginId: string, server: string) => { calls.push({ method: 'disconnectPluginMcp', input: { pluginId, server } }); connected.delete(pluginId); return { success: true } },
        rollbackPlugin: async (input: { pluginId: string; releaseId: string }) => {
            calls.push({ method: 'rollbackPlugin', input }); catalog.plugins.find(entry => entry.id === input.pluginId)!.activeReleaseId = input.releaseId
            catalog.revision++; return { success: true, catalog: clone() }
        },
        createPluginChat: async (input: unknown) => { calls.push({ method: 'createPluginChat', input }); return { success: true, sessionId: 'review-new-plugin-chat' } },
        getSnapshot: async () => structuredClone(chatSnapshot()),
        selectSession: async (sessionId: string) => ({ success: true, sessionId, snapshot: structuredClone(chatSnapshot()), status: { available: true, connected: false, state: 'disconnected', selectedSessionId: sessionId, activeThreadId: null, reason: null } }),
        getStatus: async () => ({ available: true, connected: false, state: 'ready', selectedSessionId: null, activeThreadId: null, reason: null })
    })
    ;(window as any).__pluginsReview = { readCatalog: clone, calls, scenario }
}
