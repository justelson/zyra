import { ArrowLeft, ChevronRight, Plug } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { AssistantPluginDetailProps } from '../../plugins/AssistantPluginDetail'
import { PluginMcpConnections } from '../../plugins/PluginMcpConnections'
import { UseInChatIcon } from '../../plugins/plugin-presentation'
import { bundledPluginLogo } from '../../plugins/bundled-plugin-logos'
import { formatDigest, getChatPluginScope, getContributionSummary, getPluginRelease } from '../../plugins/plugin-directory-state'
import { SettingsButton, SettingsNotice, SettingsPageContainer, SettingsRow, SettingsSection, SettingsSwitch } from '../settings-layout'
import './PluginSettings.css'

export function PluginSettingsDetail({ catalog, plugin, selectedSession, busy, error, notice, onUseInChat, onToggleInstallation, onToggleAppViews, onRollback }: AssistantPluginDetailProps) {
    const release = getPluginRelease(catalog, plugin)
    const source = catalog.sources.find(entry => entry.id === plugin.sourceId)
    const releases = catalog.releases.filter(entry => entry.pluginId === plugin.id).sort((a, b) => b.installedAt.localeCompare(a.installedAt))
    const active = plugin.state === 'active'
    const supported = Boolean(release?.manifest.contributions.mcp || release?.skills.length && release.manifest.contributions.skills)
    const name = release?.manifest.interface.displayName || plugin.name
    const logo = plugin.sourceId.startsWith('openai-catalog:') ? bundledPluginLogo(plugin.name) : null
    const scope = getChatPluginScope(catalog, selectedSession?.id)
    const pinned = scope?.plugins.find(entry => entry.pluginId === plugin.id)
    return <SettingsPageContainer className="plugin-settings-inline plugin-settings-detail" navigation={<div>
        <Link to="/settings/assistant/plugins" className="flex items-center gap-2 text-xs text-[var(--settings-text-secondary)] hover:text-[var(--settings-text)]"><ArrowLeft size={14} />Installed plugins</Link>
    </div>}>
        <header className="plugin-settings-heading">
            <div className="plugin-settings-identity">
                {logo ? <img src={logo} alt="" className="plugin-settings-heading-logo" /> : <Plug aria-hidden="true" className="plugin-settings-heading-logo text-[var(--settings-text-muted)]" strokeWidth={1.5} />}
                <div className="min-w-0"><h1>{name}</h1><p className="plugin-settings-heading-meta">{[release && `Version ${release.version}`, release?.manifest.interface.developerName || release?.manifest.author?.name].filter(Boolean).join(' · ')}</p></div>
            </div>
            <SettingsButton disabled={busy || !active || !supported} onClick={onUseInChat}><UseInChatIcon size={14} />Use in Chat</SettingsButton>
            <p className="plugin-description">{release?.manifest.description || 'No description provided.'}</p>
        </header>
        {error || notice ? <SettingsNotice tone={error ? 'error' : 'neutral'}>{error || notice}</SettingsNotice> : null}
        <SettingsSection title="Plugin">
            <SettingsRow title="Enabled" description={supported ? 'Available in regular chats while enabled.' : 'This release has no usable Skills or MCP servers.'}
                info="Disabling revokes this plugin across Zyra. Playground chats stay isolated."
                control={plugin.state === 'active' || plugin.state === 'disabled' ? <SettingsSwitch checked={active} disabled={busy} label={`Keep ${name} active`} onCheckedChange={onToggleInstallation} /> : <span className="text-xs text-amber-400">{plugin.state === 'quarantined' ? 'Quarantined' : 'Failed'}</span>} />
            {release?.manifest.contributions.mcp ? <SettingsRow title="App views" description={catalog.appViews.enabled ? 'Allow interactive views from this plugin.' : 'Turn on app views in Plugins first.'} control={<SettingsSwitch checked={catalog.appViews.pluginIds.includes(plugin.id)} disabled={busy || !active || !catalog.appViews.enabled} label={`Allow app views from ${name}`} onCheckedChange={onToggleAppViews} />} /> : null}
            {scope && selectedSession ? <SettingsRow title="Current chat" description={!active ? 'Plugin disabled.' : selectedSession.mode === 'playground' ? 'Unavailable in Playground chats.' : pinned ? `Using recorded version ${pinned.version}.` : 'Available when the next turn starts.'} /> : null}
        </SettingsSection>
        {release?.manifest.contributions.mcp ? <SettingsSection title="Connections"><PluginMcpConnections pluginId={plugin.id} active={active} compact /></SettingsSection> : null}
        {release?.manifest.contributions.apps && !release.manifest.contributions.mcp ? <SettingsSection title="Connections"><SettingsRow title="Connection needed" description="This service is not supported yet." info="Zyra needs support for this connection before you can sign in and use its chat tools." /></SettingsSection> : null}
        <SettingsSection title="Release" hideHeader>
            <details className="plugin-settings-disclosure"><summary><ChevronRight size={14} />Release details</summary>
                <dl className="plugin-facts"><dt>Contributions</dt><dd>{getContributionSummary(release)}</dd><dt>Version</dt><dd>{release?.version || 'Unavailable'}</dd>
                    <dt>Publisher</dt><dd>{release?.manifest.interface.developerName || release?.manifest.author?.name || 'Unknown publisher'}</dd>
                    <dt>License</dt><dd>{release?.manifest.license || 'Not provided'}</dd><dt>Source</dt><dd>{source?.label || 'Unknown source'}</dd>
                    {source?.locator ? <><dt>Source location</dt><dd><code>{source.locator}</code></dd></> : null}
                    <dt>Package</dt><dd>{release ? `${release.fileCount} files · ${Math.max(1, Math.round(release.totalBytes / 1024))} KB` : 'Unavailable'}</dd>
                    <dt>Digest</dt><dd><code>{release?.contentDigest || 'Unavailable'}</code></dd><dt>Code included</dt><dd>{release?.containsExecutableFiles ? 'Yes. Never run during installation.' : 'No executable files detected.'}</dd>
                </dl>
            </details>
            {releases.length > 1 ? <details className="plugin-settings-disclosure border-t border-[var(--settings-border)]"><summary><ChevronRight size={14} />Release history<span className="ml-auto text-xs text-[var(--settings-text-muted)]">{releases.length}</span></summary>
                {releases.map(candidate => <SettingsRow key={candidate.id} title={`Version ${candidate.version}`} description={<span title={candidate.contentDigest}>{formatDigest(candidate.contentDigest)}</span>} control={candidate.id === plugin.activeReleaseId ? <span className="text-xs text-[var(--settings-text-muted)]">Current</span> : <SettingsButton disabled={busy} onClick={() => onRollback(candidate.id)}>Use release</SettingsButton>} />)}
            </details> : null}
        </SettingsSection>
    </SettingsPageContainer>
}
