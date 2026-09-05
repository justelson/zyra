import { useMemo, useState } from 'react'
import { ChevronRight, ExternalLink, Info, MessageSquarePlus, Plug, Search } from 'lucide-react'
import type { AssistantPluginCatalog } from '@shared/assistant/contracts'
import catalog from '@shared/plugins/openai-directory.json'
import { PluginDialog } from './PluginDialog'
import { DirectoryEmpty } from './PluginDirectoryLists'
import { getPluginRelease } from './plugin-directory-state'
import { matchesDirectoryQuery } from './plugin-contribution-directory'
import { bundledPluginLogo } from './bundled-plugin-logos'

type StoreEntry = typeof catalog.entries[number]
const categoryOrder = ['Developer Tools', 'Productivity', 'Creativity', 'Communication', 'Data & Analytics', 'Education & Research', 'Scientific Research', 'Finance', 'Business & Operations', 'Security']

export function StoreIcon({ entry, loading = 'lazy' }: { entry: StoreEntry; loading?: 'lazy' | 'eager' }) {
    const src = bundledPluginLogo(entry.name)
    const [failedSrc, setFailedSrc] = useState<string | null>(null)
    return <span className="plugin-store-icon">
        {src && failedSrc !== src
            ? <img src={src} alt="" loading={loading} decoding="async" onError={() => setFailedSrc(src)} />
            : <Plug size={22} strokeWidth={1.5} />}
    </span>
}

export function PluginStore({ canInstall, busy, installedCatalog, loading, onManage, onSelectInstalled, onUseInChat, onOpenEntry, onImportFolder }: {
    canInstall: boolean
    busy: boolean
    installedCatalog: AssistantPluginCatalog | null
    loading: boolean
    onManage: () => void
    onSelectInstalled: (id: string) => void
    onUseInChat: (id: string) => void
    onOpenEntry: (name: string) => void
    onImportFolder: () => void
}) {
    const [query, setQuery] = useState('')
    const [category, setCategory] = useState('All categories')
    const [catalogInfoOpen, setCatalogInfoOpen] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const categories = useMemo(() => [...new Set(catalog.entries.map((entry) => entry.category))].sort((a, b) => {
        const aIndex = categoryOrder.indexOf(a), bIndex = categoryOrder.indexOf(b)
        return (aIndex < 0 ? 100 : aIndex) - (bIndex < 0 ? 100 : bIndex) || a.localeCompare(b)
    }), [])
    const entries = catalog.entries.filter((entry) => (category === 'All categories' || entry.category === category) && matchesDirectoryQuery(query, entry.displayName, entry.description, entry.publisher, entry.category))
    const groups = categories.map((name) => ({ name, entries: entries.filter((entry) => entry.category === name) })).filter((group) => group.entries.length)
    const installed = installedCatalog?.plugins || []
    const installedEntry = (entry: StoreEntry) => installed.find(plugin => plugin.sourceId === `openai-catalog:${entry.name}` && plugin.name === entry.name)
    const openSource = async (url: string) => {
        setError(null)
        try {
            const result = await window.devscope.openBrowserPreviewExternal(url)
            if (!result.success) throw new Error(result.error || 'Could not open the source.')
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not open the source.') }
    }
    return <>
        <header className="plugin-directory-header">
            <div><h1>Plugin store</h1></div>
            <div className="plugin-directory-actions">
                <button type="button" className="plugin-icon-button" aria-label="About this catalog" title="About this catalog" onClick={() => { setError(null); setCatalogInfoOpen(true) }}><Info size={17} /></button>
            </div>
        </header>
        <div className="plugin-store-toolbar">
            <label className="plugin-search"><Search size={15} /><input aria-label="Search Plugin store" placeholder="Search Plugins" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
            <select className="plugin-store-filter" aria-label="Plugin category" value={category} onChange={(event) => setCategory(event.target.value)}><option>All categories</option>{categories.map((name) => <option key={name}>{name}</option>)}</select>
        </div>
        {!query.trim() && category === 'All categories' ? <section className="plugin-store-installed" aria-label="Installed preview">
            <div className="plugin-store-source"><div className="plugin-store-installed-heading"><h2>Installed</h2>{!installed.length ? <span role="status">{loading ? 'Loading…' : installedCatalog ? 'None yet' : 'Unavailable'}</span> : null}</div><button type="button" className="plugin-text-button" aria-label="View all Plugins, Skills, and MCPs" onClick={onManage}>View all <ChevronRight size={14} /></button></div>
            {installed.length && installedCatalog ? <ul className="plugin-store-installed-grid">{installed.slice(0, 6).map((plugin) => {
                const release = getPluginRelease(installedCatalog, plugin)
                const name = release?.manifest.interface.displayName || plugin.name
                return <li key={plugin.id}><button type="button" className="plugin-row-content" onClick={() => onSelectInstalled(plugin.id)} aria-label={`Manage ${name}`}>
                    <Plug size={20} className="plugin-row-icon" strokeWidth={1.5} /><span className="plugin-row-copy"><strong>{name}</strong><span>{plugin.state === 'active' ? `Version ${release?.version || 'unavailable'}` : plugin.state}</span></span>
                </button>{plugin.state === 'active' && release?.skills.length ? <button type="button" className="plugin-icon-button" disabled={busy} aria-label={`Use ${name} in a new Chat`} title="Use in Chat" onClick={() => onUseInChat(plugin.id)}><MessageSquarePlus size={16} /></button> : null}</li>
            })}</ul> : null}
        </section> : null}
        {error && !catalogInfoOpen ? <p role="alert" className="plugin-notice">{error}</p> : null}
        {groups.length ? groups.map((group) => <section className="plugin-store-category" key={group.name} aria-label={group.name}>
            <div className="plugin-store-source"><h2>{group.name}</h2><span>{group.entries.length}</span></div>
            <ul className="plugin-store-grid">{group.entries.map((entry) => <li key={entry.name}>
                <button type="button" className="plugin-row-content" onClick={() => onOpenEntry(entry.name)} aria-label={`View ${entry.displayName}`}>
                    <StoreIcon entry={entry} /><span className="plugin-row-copy"><strong>{entry.displayName}</strong><span>{entry.description || entry.category}</span></span>{installedEntry(entry) ? <span className="plugin-meta">Installed</span> : <ChevronRight size={15} className="plugin-row-chevron" />}
                </button>
            </li>)}</ul>
        </section>) : <DirectoryEmpty title="No matching Plugins" description="Try another name or category." />}
        {catalogInfoOpen ? <PluginDialog title="About this catalog" onClose={() => setCatalogInfoOpen(false)} footer={<>
            {canInstall ? <button type="button" className="plugin-text-button" disabled={busy} onClick={() => { setCatalogInfoOpen(false); onImportFolder() }}>Import local Plugin</button> : null}
            <button type="button" className="plugin-button" onClick={() => void openSource(catalog.source)}>View source <ExternalLink size={14} /></button>
        </>}>
            {error ? <p role="alert" className="plugin-notice">{error}</p> : null}
            <dl className="plugin-facts"><dt>Source</dt><dd>OpenAI Plugin repository</dd><dt>Checked</dt><dd>{catalog.checkedAt.slice(0, 10)}</dd><dt>Plugins</dt><dd>{catalog.entries.length}</dd><dt>Excluded</dt><dd>{catalog.externalEntryCount} externally hosted entries</dd><dt>MCP / app views</dt><dd>Unavailable in Zyra</dd></dl>
            <p className="plugin-help mt-5">Zyra downloads Plugins to its own storage. Each release requires review; installation runs no code.</p>
        </PluginDialog> : null}
    </>
}
