import { Folder, FolderSync, Pi } from 'lucide-react'
import { OpenAiLogo } from '@/components/ui/OpenAiLogo'
import zyraMark from '@/assets/branding/zyra-mark.png'
import claudeMark from '@/assets/provider-logos/claude.svg'
import geminiMark from '@/assets/provider-logos/gemini.svg'

export function SettingsProviderIcon({ provider, size = 16 }: { provider: string; size?: number }) {
    if (provider === 'codex' || provider === 'chatgpt' || provider === 'openai') return <OpenAiLogo width={size} height={size} className="shrink-0" aria-hidden="true" />
    const mark = provider === 'zyra' ? zyraMark : provider === 'claude' ? claudeMark : provider === 'gemini' ? geminiMark : null
    if (mark) return <img src={mark} width={size} height={size} className="shrink-0 object-contain" alt="" aria-hidden="true" />
    const Icon = provider === 'pi' ? Pi : provider === 'agents' ? FolderSync : Folder
    return <Icon size={size} strokeWidth={1.7} aria-hidden="true" className="text-[var(--settings-text-muted)]" />
}
