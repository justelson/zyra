import { Settings } from 'lucide-react'
import { SettingsProviderIcon } from '../settings/SettingsProviderIcon'
import { bundledPluginLogo } from '../plugins/bundled-plugin-logos'
import type { AssistantComposerCommandItem } from './assistant-composer-command-menu'
import { formatAssistantPromptResourceScope } from './assistant-composer-command-menu'

const tones: Record<string, string> = {
    // Official sources: openai.com/brand, claude.com (clay), pi.dev/logo-auto.svg.
    codex: 'border-[#000000]/20 bg-[#000000]/[0.06] text-[#000000] dark:border-[#FFFFFF]/20 dark:bg-[#FFFFFF]/[0.07] dark:text-[#FFFFFF]',
    claude: 'border-[#D97757]/30 bg-[#D97757]/[0.10] text-[#A64D32] dark:text-[#D97757]',
    zyra: 'border-[var(--accent-primary)]/25 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]',
    pi: 'border-[#4D9ABF]/30 bg-[#4D9ABF]/[0.10] text-[#276888] dark:text-[#80B8D2]'
}

const neutralTone = 'border-[var(--surface-divider)] bg-[var(--surface-active)] text-sparkle-text-secondary'

export function ComposerSourceBadge({ item }: { item: AssistantComposerCommandItem }) {
    const source = item.sourceId || item.scope
    const label = item.sourceLabel || formatAssistantPromptResourceScope(item.scope)
    const logo = item.pluginName ? bundledPluginLogo(item.pluginName) : null
    const tone = tones[source] || neutralTone
    return <span data-composer-source={source} title={`${label} · ${formatAssistantPromptResourceScope(item.scope)}`} className={`inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-2 text-[10px] font-medium leading-none ${tone}`}>
        {logo ? <img src={logo} alt="" className="size-3 shrink-0 object-contain" /> : source === 'built-in' ? <Settings size={11} /> : <SettingsProviderIcon provider={source} size={12} />}
        <span className="max-w-[20ch] truncate">{label}</span>
    </span>
}
