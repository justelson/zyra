import type { ReactNode } from 'react'
import type { CommandId } from '@shared/keybindings'
import { cn } from '@/lib/utils'
import { useSettings } from '@/lib/settings'
import { shortcutPlatform } from '@/lib/keybindings'
import { ShortcutKeycaps } from '@/components/ui/ShortcutKeycaps'

export function RailButton(props: {
    icon: ReactNode
    label: string
    shortcut?: string
    shortcutCommand?: CommandId
    disabled?: boolean
    onClick: () => void
}) {
    const { icon, label, shortcut, shortcutCommand, disabled = false, onClick } = props
    const { settings } = useSettings()

    return (
        <button
            type="button"
            data-shortcut-command={shortcutCommand}
            onClick={onClick}
            disabled={disabled}
            className={cn(
                'group flex h-7 w-full cursor-pointer items-center gap-2 rounded-[9px] px-2.5 text-left text-[13px] leading-none transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]/35',
                'text-sparkle-text-secondary enabled:hover:bg-[var(--surface-hover)] enabled:hover:text-sparkle-text',
                disabled && 'cursor-wait'
            )}
        >
            <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-sparkle-text-secondary/70 transition-colors group-hover:text-sparkle-text">
                {icon}
            </span>
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {shortcutCommand || shortcut ? (
                <span className="pointer-events-none hidden shrink-0 items-center gap-0.5 text-[10px] leading-none text-sparkle-text-secondary/80 group-hover:inline-flex">
                    {shortcutCommand ? <ShortcutKeycaps id={shortcutCommand} platform={shortcutPlatform()} overrides={settings.keyboardShortcuts} /> : shortcut?.split(/[+\s]+/).map((key, index) => <kbd key={index} className="rounded border border-[var(--surface-divider)] bg-[var(--surface-hover)] px-1 py-0.5">{key}</kbd>)}
                </span>
            ) : null}
        </button>
    )
}
