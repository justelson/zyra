import type { AssistantPluginCatalog, AssistantPluginInstallation, AssistantProject, AssistantSession } from '@shared/assistant/contracts'
import { SettingsSwitch } from '../settings/settings-layout'
import { UseInChatIcon } from './plugin-presentation'
import { PluginDialog } from './PluginDialog'
import { PluginMcpConnections } from './PluginMcpConnections'
import { SettingsInfoTooltip } from '../settings/SettingsInfoTooltip'
import { formatDigest, getChatPluginScope, getContributionSummary, getPluginRelease } from './plugin-directory-state'
import { PluginSettingsDetail } from '../settings/plugins/PluginSettingsDetail'

export type AssistantPluginDetailProps = {
    catalog: AssistantPluginCatalog
    plugin: AssistantPluginInstallation
    projects: AssistantProject[]
    selectedSession: AssistantSession | null
    busy: boolean
    error?: string | null
    notice?: string | null
    onClose: () => void
    onUseInChat: () => void
    onToggleInstallation: (enabled: boolean) => void
    onToggleAppViews: (enabled: boolean) => void
    onToggleSet: (projectId: string | null, enabled: boolean) => void
    onRefreshChat: () => void
    onRollback: (releaseId: string) => void
    inline?: boolean
}

export function AssistantPluginDetail(props: AssistantPluginDetailProps) {
    const { catalog, plugin, projects, selectedSession, busy, error, notice, onClose, onUseInChat, onToggleInstallation, onToggleAppViews, onToggleSet, onRefreshChat, onRollback, inline = false } = props
    if (inline) return <PluginSettingsDetail {...props} />
    const release = getPluginRelease(catalog, plugin)
    const source = catalog.sources.find((entry) => entry.id === plugin.sourceId)
    const releases = catalog.releases.filter((entry) => entry.pluginId === plugin.id).sort((a, b) => b.installedAt.localeCompare(a.installedAt))
    const scope = getChatPluginScope(catalog, selectedSession?.id)
    const pinned = scope?.plugins.find((entry) => entry.pluginId === plugin.id)
    const active = plugin.state === 'active'
    const hasSupportedSkills = Boolean(release?.skills.length && release.manifest.contributions.skills)
    const hasSupportedContributions = hasSupportedSkills || Boolean(release?.manifest.contributions.mcp)
    const name = release?.manifest.interface.displayName || plugin.name

    const content = <>
        {error || notice ? <p className="plugin-notice" role={error ? 'alert' : 'status'}>{error || notice}</p> : null}
        <p className="plugin-description">{release?.manifest.description || 'No description provided.'}</p>
        <div className="plugin-detail-row">
            <div><strong>Plugin active</strong><p>Disabling revokes this Plugin across Zyra.</p></div>
            {plugin.state === 'active' || plugin.state === 'disabled' ? <SettingsSwitch checked={active} disabled={busy} label={`Keep ${name} active`} onCheckedChange={onToggleInstallation} /> : <span className="plugin-meta">{plugin.state === 'quarantined' ? 'Quarantined' : 'Failed'}</span>}
        </div>
        {release?.manifest.contributions.mcp ? <div className="plugin-detail-row">
            <div><strong>App views</strong><p>{catalog.appViews.enabled ? 'Show views if this Plugin’s MCP server provides them.' : 'Turn on app views in Settings → Plugins first.'}</p></div>
            <SettingsSwitch checked={catalog.appViews.pluginIds.includes(plugin.id)} disabled={busy || !active || !catalog.appViews.enabled} label={`Allow app views from ${name}`} onCheckedChange={onToggleAppViews} />
        </div> : null}
        <details className="plugin-detail-section">
            <summary>Availability</summary>
            <p className="plugin-help">{hasSupportedContributions
                ? 'Available automatically in existing and new regular Chats while active. No command or mention is needed. Playground Chats stay isolated.'
                : 'This release has no usable Skills or MCP servers. You can inspect it, but it cannot be enabled for Chats.'}</p>
        </details>
        {scope && selectedSession ? <details className="plugin-detail-section">
            <summary>Current Chat</summary>
            <p className="plugin-help">{!active ? 'This Plugin is disabled.' : selectedSession.mode === 'playground' ? 'Plugins are unavailable in Playground Chats.' : pinned ? `Using its recorded version ${pinned.version}.` : 'Available automatically when the next turn starts.'}</p>
        </details> : null}
        {release?.manifest.contributions.mcp ? <PluginMcpConnections pluginId={plugin.id} active={active} /> : null}
        {release?.manifest.contributions.apps && !release.manifest.contributions.mcp ? <div className="plugin-detail-row"><strong>Connection</strong><span className="plugin-product-capability-state">Connection needed<SettingsInfoTooltip label="About this connection">Zyra cannot connect to this service yet. Support for this connection needs to be added to Zyra before you can sign in and use its chat tools.</SettingsInfoTooltip></span></div> : null}
        <details className="plugin-detail-section">
            <summary>Release details</summary>
            <dl className="plugin-facts">
                <dt>Contributions</dt><dd>{getContributionSummary(release)}</dd>
                <dt>Digest</dt><dd><code>{release?.contentDigest || 'Unavailable'}</code></dd>
                <dt>Package</dt><dd>{release ? `${release.fileCount} files · ${Math.max(1, Math.round(release.totalBytes / 1024))} KB` : 'Unavailable'}</dd>
                <dt>Publisher</dt><dd>{release?.manifest.interface.developerName || release?.manifest.author?.name || 'Unknown publisher'}</dd>
                <dt>License</dt><dd>{release?.manifest.license || 'Not provided'}</dd>
                <dt>Source</dt><dd>{source?.label || 'Unknown source'}</dd>
                {source?.locator ? <><dt>Source location</dt><dd><code>{source.locator}</code></dd></> : null}
                <dt>Code included</dt><dd>{release?.containsExecutableFiles ? 'Yes. Never run during installation.' : 'No executable files detected.'}</dd>
            </dl>
        </details>
        {releases.length > 1 ? <details className="plugin-detail-section">
            <summary>Release history <span className="plugin-meta">{releases.length}</span></summary>
            {releases.map((candidate) => <div key={candidate.id} className="plugin-detail-row">
                <div><strong>Version {candidate.version}</strong><p title={candidate.contentDigest}>{formatDigest(candidate.contentDigest)}</p></div>
                {candidate.id === plugin.activeReleaseId ? <span className="plugin-meta">Current</span> : <button type="button" className="plugin-button" disabled={busy} onClick={() => onRollback(candidate.id)}>Use release</button>}
            </div>)}
        </details> : null}
    </>
    return <PluginDialog title={name} subtitle={[release ? `Version ${release.version}` : 'Release unavailable', release?.manifest.interface.developerName].filter(Boolean).join(' · ')} busy={busy} onClose={onClose} footer={<button type="button" className="plugin-button plugin-button-primary" disabled={busy || !active || !hasSupportedContributions} onClick={onUseInChat} title="Start a new Chat with this release"><UseInChatIcon size={15} />Use in Chat</button>}>{content}</PluginDialog>
}
