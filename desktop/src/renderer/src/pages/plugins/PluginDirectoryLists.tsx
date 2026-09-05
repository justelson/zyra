import { BookOpen, ChevronRight, Plug, Server } from 'lucide-react'
import type { AssistantPluginCatalog, AssistantPluginInstallation } from '@shared/assistant/contracts'
import { SettingsSwitch } from '../settings/settings-layout'
import { getPluginRelease } from './plugin-directory-state'
import type { DirectorySkill, directoryMcpContributions } from './plugin-contribution-directory'

export function PluginList({ plugins, catalog, busy, onSelect, onToggle }: {
    plugins: AssistantPluginInstallation[]
    catalog: AssistantPluginCatalog
    busy: boolean
    onSelect: (id: string) => void
    onToggle: (id: string, enabled: boolean) => void
}) {
    return <ul className="plugin-list" aria-label="Installed Plugins">{plugins.map((plugin) => {
        const release = getPluginRelease(catalog, plugin)
        const name = release?.manifest.interface.displayName || plugin.name
        return <li key={plugin.id} className="plugin-list-row">
            <button type="button" className="plugin-row-content" onClick={() => onSelect(plugin.id)} aria-label={`Open ${name}`}>
                <Plug size={22} className="plugin-row-icon" strokeWidth={1.5} />
                <span className="plugin-row-copy"><strong>{name}</strong><span>{release?.manifest.interface.shortDescription || release?.manifest.description || 'No description provided.'}</span></span>
            </button>
            {plugin.state === 'active' || plugin.state === 'disabled' ? <SettingsSwitch
                checked={plugin.state === 'active'} disabled={busy}
                label={`Keep ${name} active`} onCheckedChange={(enabled) => onToggle(plugin.id, enabled)}
            /> : <span className="plugin-meta">{plugin.state === 'quarantined' ? 'Quarantined' : 'Failed'}</span>}
        </li>
    })}</ul>
}

export function SkillList({ skills, onSelect }: { skills: DirectorySkill[]; onSelect: (skill: DirectorySkill) => void }) {
    return <ul className="plugin-list" aria-label="Skills">{skills.map((skill) => <li key={skill.id} className="plugin-list-row">
        <button type="button" className="plugin-row-content" onClick={() => onSelect(skill)} aria-label={`Open Skill ${skill.name}`}>
            <BookOpen size={21} className="plugin-row-icon" strokeWidth={1.5} />
            <span className="plugin-row-copy"><strong>{skill.name}</strong><span>{skill.description || 'No description provided.'}</span></span>
            <span className="plugin-meta plugin-skill-source" title={skill.source}>{skill.pluginId ? skill.source : skill.scope}</span>
            <ChevronRight size={15} className="plugin-row-chevron" />
        </button>
    </li>)}</ul>
}

export function McpList({ contributions, onSelect }: {
    contributions: ReturnType<typeof directoryMcpContributions>
    onSelect: (pluginId: string) => void
}) {
    return <section className="plugin-mcp-section">
        <h2>From Plugins</h2>
        <p className="plugin-help">Configurations included with installed Plugins. MCP connections are not available yet.</p>
        <ul className="plugin-list plugin-group" aria-label="MCP contributions">{contributions.map((entry) => <li key={entry.pluginId} className="plugin-list-row">
            <button type="button" className="plugin-row-content" onClick={() => onSelect(entry.pluginId)} aria-label={`Open ${entry.name} MCP contribution`}>
                <Server size={20} className="plugin-row-icon" strokeWidth={1.5} />
                <span className="plugin-row-copy"><strong>{entry.name}</strong><span>{entry.description || `Version ${entry.version}`}</span></span>
                <span className="plugin-meta">Unavailable</span>
            </button>
        </li>)}</ul>
    </section>
}

export function DirectoryEmpty({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
    return <div className="plugin-empty" role="status"><h2>{title}</h2>{description ? <p>{description}</p> : null}{action}</div>
}
