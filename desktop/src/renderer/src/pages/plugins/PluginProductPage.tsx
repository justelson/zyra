import { useState } from 'react'
import { ChevronRight, ExternalLink, MessageSquarePlus, Plus, Settings2 } from 'lucide-react'
import type { AssistantPluginCatalog, AssistantPluginInstallation } from '@shared/assistant/contracts'
import storeCatalog from '@shared/plugins/openai-directory.json'
import { StoreIcon } from './PluginStore'
import { DirectoryEmpty } from './PluginDirectoryLists'
import { getPluginRelease } from './plugin-directory-state'

type Entry = typeof storeCatalog.entries[number]

export function PluginProductPage({ entry, installation, catalog, busy, canInstall, onBack, onInstall, onUseInChat, onManage }: {
    entry: Entry | null
    installation: AssistantPluginInstallation | null
    catalog: AssistantPluginCatalog | null
    busy: boolean
    canInstall: boolean
    onBack: () => void
    onInstall: (name: string) => void
    onUseInChat: (id: string) => void
    onManage: (id: string) => void
}) {
    const [error, setError] = useState<string | null>(null)
    const release = installation && catalog ? getPluginRelease(catalog, installation) : null
    const manifest = release?.manifest
    const name = manifest?.interface.displayName || entry?.displayName || installation?.name
    const description = manifest ? manifest.interface.shortDescription || manifest.description : entry?.description
    const longDescription = manifest ? manifest.interface.longDescription : entry?.longDescription
    const descriptionIsZyra = !manifest && entry?.longDescriptionSource === 'zyra'
    const hasSkills = release ? release.skills.length > 0 : Boolean(entry?.hasSkills)
    const hasMcp = release ? Boolean(manifest?.contributions.mcp) : Boolean(entry?.hasMcp)
    const hasApps = release ? Boolean(manifest?.contributions.apps) : Boolean(entry?.hasApps)
    const website = manifest ? manifest.interface.websiteUrl || manifest.homepageUrl : entry?.websiteUrl
    const privacy = manifest ? manifest.interface.privacyPolicyUrl : entry?.privacyPolicyUrl
    const terms = manifest ? manifest.interface.termsOfServiceUrl : entry?.termsOfServiceUrl
    const publisher = manifest ? manifest.interface.developerName || manifest.author?.name : entry?.publisher
    const license = manifest ? manifest.license : entry?.license
    const openLink = async (url: string) => {
        setError(null)
        try { const result = await window.devscope.openBrowserPreviewExternal(url); if (!result.success) throw Error(result.error || 'Could not open this link.') }
        catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not open this link.') }
    }
    if (!name) return <DirectoryEmpty title="Plugin not found" action={<button className="plugin-button" onClick={onBack}>Back to Plugins</button>} />
    return <article className="plugin-product-page">
        <nav className="plugin-product-breadcrumb" aria-label="Breadcrumb"><button type="button" className="plugin-text-button" onClick={onBack}>Plugins</button><ChevronRight size={14} /><span>{name}</span></nav>
        <header className="plugin-product-header">
            <div className="plugin-product-identity">
                {entry ? <StoreIcon entry={entry} loading="eager" /> : null}
                <div><h1>{name}</h1><p>{description}</p></div>
            </div>
            <div className="plugin-directory-actions">
                {installation ? <>
                    <button type="button" className="plugin-icon-button" aria-label="Manage Plugin" title="Manage Plugin" onClick={() => onManage(installation.id)}><Settings2 size={17} /></button>
                    <button type="button" className="plugin-button plugin-button-primary" disabled={busy || installation.state !== 'active' || !hasSkills} onClick={() => onUseInChat(installation.id)} title="Start a new Chat with this release"><MessageSquarePlus size={15} />Use in Chat</button>
                </> : <button type="button" className="plugin-button plugin-button-primary" disabled={busy || !canInstall || !hasSkills || entry?.installation === 'BLOCKED'} onClick={() => entry && onInstall(entry.name)} title={!canInstall ? 'Open or restart Zyra Desktop to install' : !hasSkills ? 'No supported contributions yet' : 'Install in Zyra'}><Plus size={15} />Install</button>}
            </div>
        </header>
        {installation ? <p className="plugin-product-status">{installation.state === 'active' ? 'Installed' : installation.state === 'disabled' ? 'Disabled' : 'Unavailable'}{release ? ` · ${release.version}` : ''}</p> : null}
        {error ? <p className="plugin-notice" role="alert">{error}</p> : null}
        <section className="plugin-product-section" aria-label="Included in this Plugin">
            <h2>Included</h2>
            {hasSkills ? <div className="plugin-product-contribution"><strong>Skills{release ? ` · ${release.skills.length}` : ''}</strong><span>{installation ? installation.state === 'active' ? 'For a new Chat' : installation.state === 'disabled' ? 'Disabled' : 'Unavailable' : 'Supported in Zyra'}</span></div> : null}
            {release?.skills.length ? <ul className="plugin-product-skills">{release.skills.slice(0, 3).map(skill => <li key={skill.relativePath}><strong>{skill.name}</strong><p>{skill.description}</p></li>)}</ul> : null}
            {release && release.skills.length > 3 ? <details className="plugin-product-more"><summary>View all {release.skills.length} Skills</summary><ul className="plugin-product-skills">{release.skills.slice(3).map(skill => <li key={skill.relativePath}><strong>{skill.name}</strong><p>{skill.description}</p></li>)}</ul></details> : null}
            {hasMcp ? <div className="plugin-product-contribution"><strong>MCP connections</strong><span>Not supported yet</span></div> : null}
            {hasApps ? <div className="plugin-product-contribution"><strong>App views</strong><span>Not supported yet</span></div> : null}
            {!hasSkills && !hasMcp && !hasApps ? <p className="plugin-help">No supported contributions.</p> : null}
        </section>
        <section className="plugin-product-section" aria-label="Plugin information">
            <h2>Information</h2>
            <dl className="plugin-facts">
                <dt>Developer</dt><dd>{publisher || 'Not listed'}</dd>
                <dt>Category</dt><dd>{manifest?.interface.category || entry?.category || 'Other'}</dd>
                <dt>Version</dt><dd>{release?.version || entry?.version || 'Not listed'}</dd>
                <dt>License</dt><dd>{license || 'Check source'}</dd>
                {website ? <><dt>Website</dt><dd><button type="button" className="plugin-text-button" onClick={() => void openLink(website)}>Visit website <ExternalLink size={13} /></button></dd></> : null}
                {privacy ? <><dt>Privacy</dt><dd><button type="button" className="plugin-text-button" onClick={() => void openLink(privacy)}>Privacy policy <ExternalLink size={13} /></button></dd></> : null}
                {terms ? <><dt>Terms</dt><dd><button type="button" className="plugin-text-button" onClick={() => void openLink(terms)}>Terms of service <ExternalLink size={13} /></button></dd></> : null}
                {entry ? <><dt>Source</dt><dd><button type="button" className="plugin-text-button" onClick={() => void openLink(entry.sourceUrl)}>View source <ExternalLink size={13} /></button></dd></> : null}
            </dl>
        </section>
        {longDescription && longDescription !== description ? <details className="plugin-product-more">
            <summary>{descriptionIsZyra ? 'Zyra summary' : 'Publisher description'}</summary>
            {!descriptionIsZyra ? <p className="plugin-help">From {publisher || 'the package author'}. Zyra supports the Skills only. Account connections and app integrations are not available yet.</p> : null}
            <p className="plugin-description">{longDescription}</p>
        </details> : null}
    </article>
}
