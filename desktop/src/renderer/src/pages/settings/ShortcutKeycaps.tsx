import { ShortcutKeycaps as SharedShortcutKeycaps } from '@/components/ui/ShortcutKeycaps'
import type { CommandId, ShortcutOverrides, ShortcutPlatform } from '@shared/keybindings'

export function ShortcutKeycaps(props: { id: CommandId; platform: ShortcutPlatform; overrides: ShortcutOverrides }) {
    return <SharedShortcutKeycaps {...props} keycapClassName="border-[var(--settings-border)] bg-[var(--settings-control)] text-[var(--settings-text-secondary)]" />
}
