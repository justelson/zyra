import type { AssistantPluginInspection } from '@shared/assistant/contracts'
import { PluginDialog } from './PluginDialog'

const labels: Record<string, string> = { skills: 'Skills', mcp: 'MCP servers', apps: 'App views', hooks: 'Hooks', agents: 'Agents', commands: 'Commands', browserExtensions: 'Browser extensions', scheduledTasks: 'Scheduled tasks' }

export function AssistantPluginInstallDialog({ inspection, packageLabel, installing, error, onCancel, onInstall }: {
    inspection: AssistantPluginInspection
    packageLabel: string
    installing: boolean
    error: string | null
    onCancel: () => void
    onInstall: () => void
}) {
    const { manifest, release } = inspection
    const capabilities = manifest.interface.capabilities.length ? manifest.interface.capabilities : manifest.declaredCapabilityCeiling
    return <PluginDialog title={`Install ${manifest.interface.displayName || manifest.name}`} subtitle={`${packageLabel} · version ${manifest.version}`} busy={installing} onClose={onCancel} footer={<>
        <button type="button" className="plugin-button" disabled={installing} onClick={onCancel}>Cancel</button>
        <button type="button" className="plugin-button plugin-button-primary" disabled={installing} onClick={onInstall}>{installing ? 'Installing…' : 'Install exact release'}</button>
    </>}>
        <p className="plugin-description">{manifest.description || 'No description provided.'}</p>
        <dl className="plugin-facts">
            <dt>Publisher</dt><dd>{manifest.interface.developerName || manifest.author?.name || 'Unknown publisher'}</dd>
            <dt>License</dt><dd>{manifest.license || 'Not provided'}</dd>
            <dt>Package</dt><dd>{release.fileCount} files · {Math.max(1, Math.round(release.totalBytes / 1024))} KB</dd>
        </dl>
        <section className="plugin-detail-section">
            <h3>Contributions</h3>
            {release.contributions.map((entry) => <div key={entry.kind} className="plugin-detail-row"><strong>{labels[entry.kind] || entry.kind}</strong><span className="plugin-meta ml-auto">{entry.support === 'supported' ? 'Available' : 'Unavailable in Zyra'}</span></div>)}
            {!release.contributions.length ? <p className="plugin-help">No contributions declared.</p> : null}
        </section>
        <p className="plugin-notice mt-5">Zyra copies the exact inspected release without running it. Installation does not change Project availability or add Plugins to existing Chats.</p>
        {release.containsExecutableFiles ? <p className="plugin-help">This package contains code. Later actions still require Chat permissions.</p> : null}
        {capabilities.length ? <section className="plugin-detail-section"><h3>Publisher declarations</h3><p className="plugin-description">{capabilities.join(', ')}</p><p className="plugin-help">These declarations do not grant file, Browser, computer, credential, or external-action access.</p></section> : null}
        {release.diagnostics.map((diagnostic) => <p className="plugin-notice" role="status" key={`${diagnostic.type}:${diagnostic.message}`}>{diagnostic.message}</p>)}
        <details className="plugin-detail-section"><summary>Release digest</summary><dl className="plugin-facts"><dt>SHA-256</dt><dd><code>{release.contentDigest}</code></dd></dl></details>
        {error ? <p role="alert" className="plugin-notice">{error}</p> : null}
    </PluginDialog>
}
