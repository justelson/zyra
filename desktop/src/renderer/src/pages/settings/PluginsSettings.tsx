import { useNavigate, useSearchParams } from 'react-router-dom'
import { useState } from 'react'
import { RefreshCw, Search, Store } from 'lucide-react'
import { isElectronRendererRuntime } from '@/lib/browser-file-url'
import { useAssistantStoreSelector } from '@/lib/assistant/store'
import type { AssistantSession } from '@shared/assistant/contracts'
import { AssistantPluginDetail } from '../plugins/AssistantPluginDetail'
import { buildAssistantChatRoute } from '../assistant/assistant-chat-route'
import { InstalledPluginSettingsList } from './plugins/InstalledPluginSettingsList'
import { getPluginRelease } from '../plugins/plugin-directory-state'
import { usePluginDirectory } from '../plugins/usePluginDirectory'
import { SettingsButton, SettingsNotice, SettingsPageContainer, SettingsRow, SettingsSection, SettingsSelect, SettingsSwitch } from './settings-layout'
import '../plugins/PluginsPage.css'
import './plugins/PluginSettings.css'

export default function PluginsSettings() {
    const navigate = useNavigate()
    const [params, setParams] = useSearchParams()
    const [search, setSearch] = useState('')
    const desktopHost = isElectronRendererRuntime()
    const selectedSession = useAssistantStoreSelector((state) => state.snapshot.sessions.find((session) => session.id === state.snapshot.selectedSessionId) || null) as AssistantSession | null
    const directory = usePluginDirectory(desktopHost, selectedSession)
    const { catalog, busy, loading, error, notice } = directory
    const pluginId = params.get('plugin')
    const plugin = catalog?.plugins.find((entry) => entry.id === pluginId)
    const openPlugin = (id: string) => setParams({ plugin: id })
    const useInChat = (id: string) => void directory.useInNewChat(id, (sessionId) => navigate(buildAssistantChatRoute(sessionId, null)))
    const matches = catalog?.plugins.filter(entry => {
        const release = getPluginRelease(catalog, entry)
        return [entry.name, release?.manifest.interface.displayName, release?.manifest.description].join(' ').toLowerCase().includes(search.trim().toLowerCase())
    }) || []

    if (plugin && catalog) return <AssistantPluginDetail
        inline catalog={catalog} plugin={plugin} projects={directory.projects} selectedSession={selectedSession}
        busy={busy} error={error} notice={notice} onClose={() => setParams({})}
        onUseInChat={() => useInChat(plugin.id)}
        onToggleInstallation={(enabled) => void directory.updatePluginState(plugin.id, enabled)}
        onToggleAppViews={(enabled) => void directory.updateAppViewSettings({ pluginId: plugin.id, enabled })}
        onToggleSet={(id, enabled) => void directory.updatePluginSet(id, plugin.id, enabled)}
        onRefreshChat={() => void directory.refreshCurrentChat()}
        onRollback={(id) => void directory.rollbackPlugin(plugin.id, id)}
    />

    return <SettingsPageContainer title="Plugins">
        {error || notice ? <div role={error ? 'alert' : 'status'}><SettingsNotice tone={error ? 'error' : 'neutral'}>{error || notice}</SettingsNotice></div> : null}
        <SettingsSection title="Installed plugins" headerAction={<div className="flex items-center gap-2">
            {desktopHost ? <SettingsButton variant="ghost" aria-label="Refresh plugins" title="Refresh plugins" disabled={busy || loading} onClick={() => void directory.loadCatalog()}><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /></SettingsButton> : null}
            <SettingsButton onClick={() => navigate('/plugins')}><Store size={13} />Browse store</SettingsButton>
        </div>}>
            {!desktopHost ? <p className="px-4 py-4 text-xs leading-5 text-[var(--settings-text-secondary)]">Manage plugins in Zyra Desktop.</p>
                : loading && !catalog ? <p className="px-4 py-4 text-xs leading-5 text-[var(--settings-text-secondary)]" role="status">Loading plugins…</p>
                : pluginId && !plugin ? <p className="px-4 py-4 text-xs leading-5 text-[var(--settings-text-secondary)]" role="alert">That plugin is no longer installed.</p>
                : error && !catalog ? <div className="px-4 py-4"><SettingsButton onClick={() => void directory.loadCatalog()}>Retry</SettingsButton></div>
                : catalog?.plugins.length ? <>
                    <label className="plugin-settings-search"><Search size={14} /><input aria-label="Search installed plugins" placeholder="Search installed plugins" value={search} onChange={event => setSearch(event.target.value)} /></label>
                    {matches.length ? <InstalledPluginSettingsList plugins={matches} catalog={catalog} busy={busy} onSelect={openPlugin} onToggle={(id, enabled) => void directory.updatePluginState(id, enabled)} /> : <p className="px-4 py-4 text-xs text-[var(--settings-text-secondary)]">No matching plugins.</p>}
                </>
                : <p className="px-4 py-4 text-xs leading-5 text-[var(--settings-text-secondary)]">No plugins installed.</p>}
        </SettingsSection>
        {catalog ? <SettingsSection title="App views">
            <SettingsRow
                title="Show app views in Chat"
                description="Interactive views from enabled plugins."
                control={<SettingsSwitch checked={catalog.appViews.enabled} disabled={busy} label="Show app views in Chat" onCheckedChange={(enabled) => void directory.updateAppViewSettings({ enabled })} />}
            />
            {catalog.appViews.enabled ? <SettingsRow
                title="Open views"
                description="Choose when plugin views open."
                control={<SettingsSelect aria-label="Open app views" value={catalog.appViews.displayMode} disabled={busy} onChange={(event) => void directory.updateAppViewSettings({ displayMode: event.target.value as 'manual' | 'automatic' })}>
                    <option value="manual">On click</option><option value="automatic">Automatically</option>
                </SettingsSelect>}
            /> : null}
        </SettingsSection> : null}
    </SettingsPageContainer>
}
