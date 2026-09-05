import type { AssistantPluginCatalog, AssistantPluginInstallation, AssistantProject, AssistantSession } from '@shared/assistant/contracts'
import { SettingsSwitch } from '../settings/settings-layout'
import { PluginDialog } from './PluginDialog'
import { formatDigest, getChatPluginScope, getContributionSummary, getPluginRelease, isChatPluginScopeCurrent, pluginSetIncludes, previewChatPluginScopeDiff } from './plugin-directory-state'

export function AssistantPluginDetail({ catalog, plugin, projects, selectedSession, busy, error, notice, onClose, onUseInChat, onToggleInstallation, onToggleSet, onRefreshChat, onRollback }: {
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
    onToggleSet: (projectId: string | null, enabled: boolean) => void
    onRefreshChat: () => void
    onRollback: (releaseId: string) => void
}) {
    const release = getPluginRelease(catalog, plugin)
    const source = catalog.sources.find((entry) => entry.id === plugin.sourceId)
    const releases = catalog.releases.filter((entry) => entry.pluginId === plugin.id).sort((a, b) => b.installedAt.localeCompare(a.installedAt))
    const scope = getChatPluginScope(catalog, selectedSession?.id)
    const pinned = scope?.plugins.find((entry) => entry.pluginId === plugin.id)
    const projectId = selectedSession?.projectId || selectedSession?.chatScope?.projectId || null
    const current = isChatPluginScopeCurrent(catalog, scope, projectId)
    const diff = scope ? previewChatPluginScopeDiff(catalog, scope, projectId) : null
    const changeCount = diff ? diff.added.length + diff.changed.length + diff.removed.length : 0
    const active = plugin.state === 'active'
    const hasSupportedSkills = Boolean(release?.skills.length && release.manifest.contributions.skills)
    const name = release?.manifest.interface.displayName || plugin.name
    const availableProjects = projects.filter((project) => !project.archived)

    return <PluginDialog title={name} subtitle={[release ? `Version ${release.version}` : 'Release unavailable', release?.manifest.interface.developerName].filter(Boolean).join(' · ')} busy={busy} onClose={onClose} footer={<button type="button" className="plugin-button plugin-button-primary" disabled={busy || !active || !release?.skills.length} onClick={onUseInChat} title="Start a new Chat with this release">Use in Chat</button>}>
        {error || notice ? <p className="plugin-notice" role={error ? 'alert' : 'status'}>{error || notice}</p> : null}
        <p className="plugin-description">{release?.manifest.description || 'No description provided.'}</p>
        <div className="plugin-detail-row">
            <div><strong>Plugin active</strong><p>Disabling revokes this Plugin across Zyra.</p></div>
            {plugin.state === 'active' || plugin.state === 'disabled' ? <SettingsSwitch checked={active} disabled={busy} label={`Keep ${name} active`} onCheckedChange={onToggleInstallation} /> : <span className="plugin-meta">{plugin.state === 'quarantined' ? 'Quarantined' : 'Failed'}</span>}
        </div>
        <details className="plugin-detail-section">
            <summary>Availability</summary>
            <p className="plugin-help">{hasSupportedSkills
                ? 'Choose where this Plugin is used. Existing Chats keep their recorded release.'
                : 'This release has no usable Skills. You can inspect it, but it cannot be enabled for Chats.'}</p>
            <div className="plugin-detail-row">
                <div><strong>Global Chats</strong><p>Chats without a Project</p></div>
                <SettingsSwitch checked={pluginSetIncludes(catalog, plugin.id, null)} disabled={busy || !active || !hasSupportedSkills} label="Enable Global Chats" onCheckedChange={(enabled) => onToggleSet(null, enabled)} />
            </div>
            {availableProjects.length ? <details className="plugin-detail-section">
                <summary>Projects <span className="plugin-meta">{availableProjects.filter((project) => pluginSetIncludes(catalog, plugin.id, project.id)).length} selected</span></summary>
                {availableProjects.map((project) => <div key={project.id} className="plugin-detail-row">
                    <div><strong>{project.name}</strong></div>
                    <SettingsSwitch checked={pluginSetIncludes(catalog, plugin.id, project.id)} disabled={busy || !active || !hasSupportedSkills} label={`Enable ${project.name}`} onCheckedChange={(enabled) => onToggleSet(project.id, enabled)} />
                </div>)}
            </details> : null}
        </details>
        {scope && selectedSession ? <details className="plugin-detail-section">
            <summary>Current Chat</summary>
            <p className="plugin-help">{pinned ? `Using its recorded version ${pinned.version}.${!active ? ' This Plugin is currently disabled.' : ''}` : 'This Plugin is not included.'}</p>
            {!current ? <>
                <p className="plugin-help">Refreshing applies all of this Chat's Plugin changes:</p>
                {diff ? <ul className="mb-3 list-inside list-disc text-xs leading-6">
                    {diff.added.map((entry) => <li key={`add:${entry.pluginId}`}>Add {entry.name} {entry.version}</li>)}
                    {diff.changed.map((entry) => <li key={`change:${entry.after.pluginId}`}>Update {entry.after.name} to {entry.after.version}</li>)}
                    {diff.removed.map((entry) => <li key={`remove:${entry.pluginId}`}>Remove {entry.name}</li>)}
                </ul> : null}
                <button type="button" className="plugin-button" disabled={busy} onClick={onRefreshChat}>{changeCount ? `Apply ${changeCount} ${changeCount === 1 ? 'change' : 'changes'}` : 'Refresh scope'}</button>
            </> : null}
        </details> : null}
        {release?.manifest.contributions.mcp ? <section className="plugin-detail-section">
            <h3>MCP contribution</h3><p className="plugin-help">This release includes an MCP configuration. Connections and execution are not available yet.</p>
        </section> : null}
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
    </PluginDialog>
}
