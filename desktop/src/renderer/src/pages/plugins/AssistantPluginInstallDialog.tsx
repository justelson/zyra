import type { AssistantPluginInspection } from '@shared/assistant/contracts'
import { PluginDialog } from './PluginDialog'

const labels: Record<string, string> = { skills: 'Skills', mcp: 'MCP connections', apps: 'App views', hooks: 'Hooks', agents: 'Agents', commands: 'Commands', browserExtensions: 'Browser extensions', scheduledTasks: 'Scheduled tasks' }

export function AssistantPluginInstallDialog({ inspection, packageLabel, installing, error, onCancel, onInstall, onInstallAndUse, inline = false }: {
    inspection: AssistantPluginInspection
    packageLabel: string
    installing: boolean
    error: string | null
    onCancel: () => void
    onInstall: () => void
    onInstallAndUse?: () => void
    inline?: boolean
}) {
    const { manifest, release } = inspection
    const title = manifest.interface.displayName || manifest.name
    const subtitle = `${packageLabel} · version ${manifest.version}`
    const capabilities = manifest.interface.capabilities.length ? manifest.interface.capabilities : manifest.declaredCapabilityCeiling
    const unavailable = release.contributions.filter(entry => entry.support !== 'supported').map(entry => labels[entry.kind] || entry.kind)
    const hasSkills = release.skills.length > 0 && release.contributions.some(entry => entry.kind === 'skills' && entry.support === 'supported')
    const footer = <>
        <button type="button" className="plugin-text-button" disabled={installing} onClick={onCancel}>Cancel</button>
        <button type="button" className={`plugin-button${onInstallAndUse && hasSkills ? '' : ' plugin-button-primary'}`} disabled={installing} onClick={onInstall}>{installing ? 'Installing…' : 'Install'}</button>
        {onInstallAndUse && hasSkills ? <button type="button" className="plugin-button plugin-button-primary" disabled={installing} onClick={onInstallAndUse}>Install &amp; new Chat</button> : null}
    </>
    const body = <>
        <p className="plugin-description">{manifest.interface.shortDescription || manifest.description || 'No description provided.'}</p>
        <p className="plugin-review-meta">{manifest.interface.developerName || manifest.author?.name || 'Unknown publisher'} · {manifest.license || 'License not provided'}</p>
        <p className="plugin-description">{hasSkills ? `${release.skills.length} ${release.skills.length === 1 ? 'Skill available' : 'Skills available'} in Zyra` : 'No supported Skills in this release.'}</p>
        {unavailable.length ? <p className="plugin-help">Unavailable in Zyra: {unavailable.join(', ')}. These will not run or connect accounts.</p> : null}
        <p className="plugin-help">Installation does not change Project availability or add Plugins to existing Chats.</p>
        {release.containsExecutableFiles ? <p className="plugin-help">Includes code. Installation does not run it; later actions require Chat permissions.</p> : null}
        <details className="plugin-review-details">
            <summary>Release details</summary>
            <dl className="plugin-facts">
                <dt>Package</dt><dd>{release.fileCount} files · {Math.max(1, Math.round(release.totalBytes / 1024))} KB</dd>
                <dt>SHA-256</dt><dd><code>{release.contentDigest}</code></dd>
            </dl>
            {capabilities.length ? <><p className="plugin-description">Publisher declarations: {capabilities.join(', ')}</p><p className="plugin-help">These declarations do not grant file, Browser, computer, credential, or external-action access.</p></> : null}
            {release.diagnostics.map(diagnostic => <p className="plugin-notice" key={`${diagnostic.type}:${diagnostic.message}`}>{diagnostic.message}</p>)}
        </details>
        {error ? <p role="alert" className="plugin-notice">{error}</p> : null}
    </>
    if (inline) return <section className="plugin-install-job plugin-install-review" aria-label={`Review ${title}`}>
        <div className="plugin-install-job-heading"><h2>{title}</h2><span className="plugin-meta" role="status">{installing ? 'Installing…' : 'Ready to install'}</span></div>
        <p className="plugin-meta">{subtitle}</p>
        <div className="plugin-review-body">{body}</div>
        <div className="plugin-install-actions">{footer}</div>
    </section>
    return <PluginDialog title={`Install ${title}`} subtitle={subtitle} busy={installing} onClose={onCancel} footer={footer}>{body}</PluginDialog>
}
