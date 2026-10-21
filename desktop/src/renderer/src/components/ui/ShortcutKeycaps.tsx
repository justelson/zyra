import { effectiveBindings, type CommandId, type ShortcutOverrides, type ShortcutPlatform } from '@shared/keybindings'

export function shortcutKeyLabels(binding: string, platform: ShortcutPlatform): string[] {
    return binding.split('+').map(part => {
        if (part === 'Meta') return platform === 'darwin' ? '⌘' : 'Super'
        if (part === 'Ctrl') return platform === 'darwin' ? '⌃' : 'Ctrl'
        if (part === 'Alt') return platform === 'darwin' ? '⌥' : 'Alt'
        if (part === 'Shift') return platform === 'darwin' ? '⇧' : 'Shift'
        return ({ arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓', pageup: 'PageUp', pagedown: 'PageDown' } as Record<string, string>)[part] || part.toUpperCase()
    })
}

export type ShortcutKeycapsProps = {
    id: CommandId
    platform: ShortcutPlatform
    overrides: ShortcutOverrides
    className?: string
    keycapClassName?: string
}

export function ShortcutKeycaps({ id, platform, overrides, className = '', keycapClassName = 'border-[var(--surface-divider)] bg-[var(--surface-floating)] text-sparkle-text-secondary' }: ShortcutKeycapsProps) {
    const bindings = effectiveBindings(id, platform, overrides)
    if (!bindings.length) return <span className="text-xs text-[var(--settings-text-faint)]">Unassigned</span>
    return <span className={`inline-flex flex-wrap items-center justify-end gap-1 ${className}`}>{bindings.map((binding, index) => <span key={binding} className="inline-flex items-center gap-0.5">
        {index > 0 ? <span aria-hidden="true" className="mx-1 text-[10px] opacity-50">/</span> : null}
        {shortcutKeyLabels(binding, platform).map((key, keyIndex) => <kbd key={`${keyIndex}:${key}`} className={`inline-flex min-w-4 items-center justify-center rounded border px-1 py-0.5 font-mono text-[10px] leading-none ${keycapClassName}`}>{key}</kbd>)}
    </span>)}</span>
}
