import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, RefreshCw, Search, Settings2, Store } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { buildAssistantChatRoute } from '../assistant/assistant-chat-route'
import type { AssistantSession } from '@shared/assistant/contracts'
import { isElectronRendererRuntime } from '@/lib/browser-file-url'
import { useAssistantStoreSelector } from '@/lib/assistant/store'
import SkillsSettings from '../settings/SkillsSettings'
import { AssistantPluginDetail } from './AssistantPluginDetail'
import { AssistantPluginInstallDialog } from './AssistantPluginInstallDialog'
import { PluginDialog } from './PluginDialog'
import { PluginStore } from './PluginStore'
import { PluginProductPage } from './PluginProductPage'
import storeCatalog from '@shared/plugins/openai-directory.json'
import { DirectoryEmpty, McpList, PluginList, SkillList } from './PluginDirectoryLists'
import { getPluginRelease } from './plugin-directory-state'
import { directoryMcpContributions, directorySkills, matchesDirectoryQuery, pluginDirectoryTab, type DirectorySkill, type PluginDirectoryTab } from './plugin-contribution-directory'
import { useDirectorySkills } from './useDirectorySkills'
import { usePluginDirectory } from './usePluginDirectory'
import './PluginsPage.css'

const tabs = [{ id: 'plugins', label: 'Plugins' }, { id: 'mcps', label: 'MCPs' }, { id: 'skills', label: 'Skills' }] as const

export default function PluginsPage() {
    const desktopHost = isElectronRendererRuntime()
    const navigate = useNavigate()
    const selectedSession = useAssistantStoreSelector((state) => state.snapshot.sessions.find((session) => session.id === state.snapshot.selectedSessionId) || null) as AssistantSession | null
    const directory = usePluginDirectory(desktopHost, selectedSession)
    const resources = useDirectorySkills(desktopHost, selectedSession?.projectPath || null)
    const [params, setParams] = useSearchParams()
    const tab = pluginDirectoryTab(params.get('tab'))
    const storeOpen = params.get('view') !== 'manage'
    const setStoreOpen = (open: boolean) => setParams((previous) => { const next = new URLSearchParams(previous); if (open) next.delete('view'); else next.set('view', 'manage'); return next })
    const [query, setQuery] = useState('')
    const [sourcesOpen, setSourcesOpen] = useState(false)
    const [selectedSkill, setSelectedSkill] = useState<DirectorySkill | null>(null)
    const { catalog, selectedPlugin, busy, loading, error, notice } = directory
    const selectedProjectName = directory.projects.find((project) => project.id === (selectedSession?.projectId || selectedSession?.chatScope?.projectId))?.name
    const skills = useMemo(() => directorySkills(catalog, resources.skills), [catalog, resources.skills])
    const mcps = useMemo(() => directoryMcpContributions(catalog), [catalog])
    const visiblePlugins = (catalog?.plugins || []).filter((plugin) => {
        const release = getPluginRelease(catalog!, plugin)
        return matchesDirectoryQuery(query, plugin.name, release?.manifest.interface.displayName, release?.manifest.interface.developerName, release?.manifest.description)
    })
    const visibleSkills = skills.filter((skill) => matchesDirectoryQuery(query, skill.name, skill.description, skill.source))
    const visibleMcps = mcps.filter((entry) => matchesDirectoryQuery(query, entry.name, entry.description))
    const counts = { plugins: catalog?.plugins.length, skills: catalog && !resources.loading && !resources.error ? skills.length : undefined, mcps: catalog ? mcps.length : undefined }
    const changeTab = (next: PluginDirectoryTab) => {
        setParams((previous) => { const nextParams = new URLSearchParams(previous); nextParams.set('tab', next); return nextParams }, { replace: true })
        setQuery('')
        setSourcesOpen(false)
    }
    const refresh = () => { void directory.loadCatalog(); void resources.refresh() }
    const openSources = () => { setSelectedSkill(null); setSourcesOpen(true) }
    const activeError = error || (tab === 'skills' ? resources.error : null)
    const useInChat = (pluginId: string) => void directory.useInNewChat(pluginId, id => navigate(buildAssistantChatRoute(id, null)))
    const productOpen = params.has('plugin') || params.has('installed')
    const productInstallation = catalog?.plugins.find(plugin => params.has('installed') ? plugin.id === params.get('installed') : plugin.sourceId === `openai-catalog:${params.get('plugin')}` && plugin.name === params.get('plugin')) || null
    const productEntry = storeCatalog.entries.find(entry => entry.name === params.get('plugin') || productInstallation?.sourceId === `openai-catalog:${entry.name}` && productInstallation.name === entry.name) || null
    const scrollContainer = useRef<HTMLElement>(null)
    const browseScroll = useRef(0)
    const openProduct = (key: 'plugin' | 'installed', id: string) => {
        browseScroll.current = storeOpen ? scrollContainer.current?.scrollTop || 0 : 0
        setParams(previous => {
            const next = new URLSearchParams(previous)
            next.delete('plugin'); next.delete('installed'); next.set(key, id)
            return next
        })
    }
    const openInstalled = (id: string) => openProduct('installed', id)
    useLayoutEffect(() => {
        scrollContainer.current?.scrollTo({ top: productOpen ? 0 : browseScroll.current })
    }, [productOpen])

    return <section ref={scrollContainer} className="plugin-directory custom-scrollbar" data-testid="plugins-page">
        <div className="plugin-directory-column">
            {!productOpen ? <Link to="/assistant" className="plugin-text-button plugin-back-link"><ArrowLeft size={15} />Back to Chat</Link> : null}
            {productOpen ? <>
                {error ? <p className="plugin-notice" role="alert">{error}</p> : null}
                {loading && !productEntry && !productInstallation ? <DirectoryEmpty title="Loading Plugin…" /> : <PluginProductPage key={params.get('plugin') || params.get('installed')} entry={productEntry} installation={productInstallation} catalog={catalog} busy={busy} canInstall={desktopHost && directory.catalogInstallAvailable} onBack={() => setParams({})} onInstall={name => void directory.beginCatalogInstall(name)} onUseInChat={useInChat} onManage={directory.selectPlugin} />}
            </> : null}
            <div style={{ display: productOpen ? 'none' : undefined }}>
            {storeOpen ? <>
            {error || notice ? <p className="plugin-notice" role={error ? 'alert' : 'status'}>{error || notice}</p> : null}
            <PluginStore canInstall={desktopHost && directory.serviceAvailable && directory.catalogInstallAvailable} busy={busy} installedCatalog={catalog} loading={loading} onManage={() => setStoreOpen(false)} onSelectInstalled={openInstalled} onUseInChat={useInChat} onOpenEntry={name => openProduct('plugin', name)} onImportFolder={() => void directory.beginInstall()} />
            </> : <>
            <header className="plugin-directory-header">
                <div><h1>Plugins</h1></div>
                <div className="plugin-directory-actions">
                    <button type="button" className="plugin-icon-button" onClick={() => setStoreOpen(true)} aria-label="Browse store" title="Browse store"><Store size={17} /></button>
                    {desktopHost ? <>
                    <button type="button" className="plugin-icon-button" onClick={refresh} disabled={busy || loading || resources.loading} aria-label="Refresh directory" title="Refresh directory"><RefreshCw size={16} /></button>
                    </> : null}
                </div>
            </header>
            <div className="plugin-directory-toolbar">
                <div className="plugin-tabs" role="tablist" aria-label="Plugin directory">
                    {tabs.map((entry, index) => <button
                        key={entry.id} type="button" role="tab" id={`directory-tab-${entry.id}`} aria-controls={`directory-panel-${entry.id}`} aria-selected={tab === entry.id} tabIndex={tab === entry.id ? 0 : -1}
                        onClick={() => changeTab(entry.id)} onKeyDown={(event) => {
                            const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1
                            if (next < 0) return
                            event.preventDefault()
                            changeTab(tabs[next].id)
                            document.getElementById(`directory-tab-${tabs[next].id}`)?.focus()
                        }}
                    >{entry.label}{desktopHost && counts[entry.id] !== undefined ? <span aria-label={`${counts[entry.id]} ${entry.id === 'mcps' ? 'Plugin contributions' : entry.label}`}>{counts[entry.id]}</span> : null}</button>)}
                </div>
                {desktopHost && !sourcesOpen ? <label className="plugin-search"><Search size={15} /><input aria-label={`Search ${tab === 'mcps' ? 'MCP contributions' : tab === 'skills' ? 'Skills' : 'Plugins'}`} placeholder={`Search ${tab === 'mcps' ? 'MCPs' : tab === 'skills' ? 'Skills' : 'Plugins'}`} value={query} onChange={(event) => setQuery(event.target.value)} /></label> : null}
            </div>
            {activeError || notice ? <p className="plugin-notice" role={activeError ? 'alert' : 'status'}>{activeError || notice}</p> : null}
            <div role="tabpanel" id={`directory-panel-${tab}`} aria-labelledby={`directory-tab-${tab}`} tabIndex={0}>
                {!desktopHost ? <DirectoryEmpty title="Available in Zyra Desktop" description="Open Zyra Desktop to inspect and manage local Plugins and Skill folders." /> : sourcesOpen && tab === 'skills' ? <>
                    <button type="button" className="plugin-text-button" onClick={() => { setSourcesOpen(false); void resources.refresh() }}><ArrowLeft size={15} />Back to Skills</button>
                    <SkillsSettings key={selectedSession?.projectPath || 'global'} embedded onSaved={resources.refresh} />
                </> : <>
                    {tab === 'skills' ? <div className="plugin-context-line"><p title={selectedProjectName}>{selectedProjectName ? `Sources for ${selectedProjectName}` : 'Personal and built-in sources'}</p><button type="button" className="plugin-text-button" onClick={openSources}><Settings2 size={14} />Manage sources</button></div> : null}
                    {activeError && !catalog ? <button type="button" className="plugin-button" onClick={refresh}>Try again</button> : loading && !catalog || tab === 'skills' && resources.loading ? <DirectoryEmpty title={`Loading ${tab === 'skills' ? 'Skills' : 'Plugins'}…`} /> : tab === 'plugins' ? (
                        visiblePlugins.length && catalog ? <PluginList plugins={visiblePlugins} catalog={catalog} busy={busy} onSelect={openInstalled} onToggle={(id, enabled) => void directory.updatePluginState(id, enabled)} /> : <DirectoryEmpty title={query ? 'No matching Plugins' : 'No Plugins installed'} description={query ? 'Try another name or description.' : 'Find a Plugin in the store.'} action={!query && directory.serviceAvailable ? <button type="button" className="plugin-button" disabled={busy} onClick={() => setStoreOpen(true)}>Browse store</button> : undefined} />
                    ) : tab === 'skills' ? (
                        visibleSkills.length ? <SkillList skills={visibleSkills} onSelect={(skill) => { if (skill.pluginId) openInstalled(skill.pluginId); else setSelectedSkill(skill) }} /> : !resources.error ? <DirectoryEmpty title={query ? 'No matching Skills' : 'No Skills found'} description={query ? 'Try another name or source.' : 'Choose a Skill source or install a Plugin with Skills.'} /> : null
                    ) : visibleMcps.length ? <McpList contributions={visibleMcps} onSelect={openInstalled} /> : <DirectoryEmpty title={query ? 'No matching MCP contributions' : 'No MCP contributions installed'} description={query ? 'Try another Plugin name.' : 'Plugins with MCP configurations appear here. Connections are not available yet.'} />}
                </>}
            </div>
            </>}
            </div>
        </div>
        {catalog && selectedPlugin ? <AssistantPluginDetail catalog={catalog} plugin={selectedPlugin} projects={directory.projects} selectedSession={selectedSession} busy={busy} error={error} notice={notice} onClose={() => directory.selectPlugin(null)} onUseInChat={() => useInChat(selectedPlugin.id)} onToggleInstallation={(enabled) => void directory.updatePluginState(selectedPlugin.id, enabled)} onToggleSet={(id, enabled) => void directory.updatePluginSet(id, selectedPlugin.id, enabled)} onRefreshChat={() => void directory.refreshCurrentChat()} onRollback={(id) => void directory.rollbackPlugin(selectedPlugin.id, id)} /> : null}
        {selectedSkill ? <PluginDialog title={selectedSkill.name} subtitle={`${selectedSkill.scope} · ${selectedSkill.source}`} onClose={() => setSelectedSkill(null)} footer={selectedSkill.scope !== 'Built-in' ? <button type="button" className="plugin-button" onClick={openSources}>Manage source folders</button> : undefined}>
            <p className="plugin-description">{selectedSkill.description || 'No description provided.'}</p>
            <p className="plugin-help mt-5">{selectedSkill.manualOnly ? 'Available by explicit invocation only.' : 'Available from the selected source for new Chats.'} Source changes apply to existing Chats after a reload.</p>
        </PluginDialog> : null}
        {directory.downloadName ? <PluginDialog title={`Preparing ${directory.downloadName}`} onClose={() => void directory.cancelDownload()} footer={<button type="button" className="plugin-button" onClick={() => void directory.cancelDownload()}>Cancel</button>}>
            <p className="plugin-description" role="status">Downloading and checking this release.</p>
        </PluginDialog> : null}
        {directory.inspection ? <AssistantPluginInstallDialog inspection={directory.inspection} packageLabel={directory.packageLabel} installing={busy} error={null} onCancel={directory.cancelInspection} onInstall={() => void directory.installReviewedPlugin()} /> : null}
    </section>
}
