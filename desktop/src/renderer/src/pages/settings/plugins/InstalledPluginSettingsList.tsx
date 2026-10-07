import { ChevronRight, Plug } from 'lucide-react'
import type { AssistantPluginCatalog, AssistantPluginInstallation } from '@shared/assistant/contracts'
import { SettingsSwitch } from '../settings-layout'
import { bundledPluginLogo } from '../../plugins/bundled-plugin-logos'
import { getPluginRelease } from '../../plugins/plugin-directory-state'

export function InstalledPluginSettingsList({ plugins, catalog, busy, onSelect, onToggle }: {
    plugins: AssistantPluginInstallation[]
    catalog: AssistantPluginCatalog
    busy: boolean
    onSelect: (id: string) => void
    onToggle: (id: string, enabled: boolean) => void
}) {
    return <ul aria-label="Installed Plugins" className="plugin-settings-list">{plugins.map(plugin => {
        const release = getPluginRelease(catalog, plugin)
        const name = release?.manifest.interface.displayName || plugin.name
        const logo = plugin.sourceId.startsWith('openai-catalog:') ? bundledPluginLogo(plugin.name) : null
        return <li key={plugin.id} className="plugin-settings-item">
            <button type="button" className="plugin-settings-open" aria-label={`Open ${name}`} onClick={() => onSelect(plugin.id)}>
                {logo ? <img src={logo} alt="" className="plugin-settings-logo" /> : <Plug size={22} className="plugin-settings-logo text-[var(--settings-text-muted)]" strokeWidth={1.5} />}
                <span className="plugin-settings-copy"><strong title={name}>{name}</strong><span>{release ? <><span className="plugin-settings-version">v{release.version}</span><span aria-hidden="true"> · </span></> : null}{release?.manifest.interface.shortDescription || release?.manifest.description || 'Release unavailable'}</span></span>
                <ChevronRight size={14} className="shrink-0 text-[var(--settings-text-muted)]" />
            </button>
            <div className="plugin-settings-control">{plugin.state === 'active' || plugin.state === 'disabled'
                ? <SettingsSwitch checked={plugin.state === 'active'} disabled={busy} label={`Keep ${name} active`} onCheckedChange={enabled => onToggle(plugin.id, enabled)} />
                : <span className="text-xs text-amber-400">{plugin.state === 'quarantined' ? 'Quarantined' : 'Failed'}</span>}</div>
        </li>
    })}</ul>
}
