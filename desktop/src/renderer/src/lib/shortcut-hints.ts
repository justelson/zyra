import { COMMANDS, bindingConflicts, effectiveBindings, type CommandId, type ShortcutOverrides, type ShortcutPlatform } from '@shared/keybindings'

export type HeldModifiers = { ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }
export const isHintModifier = (key: string) => ['Control', 'Meta', 'Alt', 'Shift'].includes(key)

/** Compare structural bindings, never their platform-dependent display strings. */
export function hintBinding(id: CommandId, platform: ShortcutPlatform, overrides: ShortcutOverrides, held: HeldModifiers): string | undefined {
    const active = [held.ctrlKey && 'Ctrl', held.metaKey && 'Meta', held.altKey && 'Alt', held.shiftKey && 'Shift'].filter(Boolean) as string[]
    if (!active.length || (!held.ctrlKey && !held.metaKey && !held.altKey)) return undefined
    return effectiveBindings(id, platform, overrides).find(binding => {
        const modifiers = binding.split('+').slice(0, -1)
        return modifiers.length === active.length && active.every(modifier => modifiers.includes(modifier))
            && bindingConflicts(id, binding, platform, overrides).length === 0
    })
}

export function shortcutCommand(value: string | undefined): CommandId | undefined {
    return COMMANDS.find(command => command.id === value)?.id
}

/** Hidden, disabled, clipped and offscreen controls cannot advertise an action. */
export function isHintTargetVisible(target: HTMLElement): boolean {
    if (!target.isConnected || target.closest('[hidden], [inert], [aria-hidden="true"], [aria-disabled="true"], :disabled')) return false
    const view = target.ownerDocument.defaultView
    if (!view) return false
    const rect = target.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.bottom <= 0 || rect.left >= view.innerWidth || rect.top >= view.innerHeight) return false
    for (let node: HTMLElement | null = target; node; node = node.parentElement) {
        const style = view.getComputedStyle(node)
        if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0 || (node === target && style.pointerEvents === 'none')) return false
        // Native portal containers are pointer-events:none with interactive
        // descendants opting back in, so only the target's computed value counts.
        if (node !== target) {
            const clipX = /^(hidden|clip|auto|scroll)$/.test(style.overflowX)
            const clipY = /^(hidden|clip|auto|scroll)$/.test(style.overflowY)
            if (clipX || clipY) {
                const clip = node.getBoundingClientRect()
                if ((clipX && (rect.right <= clip.left || rect.left >= clip.right)) || (clipY && (rect.bottom <= clip.top || rect.top >= clip.bottom))) return false
            }
        }
    }
    return true
}

export function hintsBlocked(documents: Document[]): boolean {
    return documents.some(owner => [...owner.querySelectorAll<HTMLElement>('[aria-modal="true"], dialog[open], [data-keybinding-recording]')].some(isHintTargetVisible))
}
