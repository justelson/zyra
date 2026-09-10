import { ChevronDown } from 'lucide-react'
import { FileActionsMenu, type FileActionsMenuItem } from '@/components/ui/FileActionsMenu'

// Reuse the app's portal menu, keyboard handling and transient-menu dismissal.
export function SettingsActionsMenu({ items, label = 'Manage', ariaLabel, disabled = false }: {
    items: FileActionsMenuItem[]
    label?: string
    ariaLabel?: string
    disabled?: boolean
}) {
    return <FileActionsMenu
        items={items}
        disabled={disabled}
        title={ariaLabel || label}
        density="compact"
        menuWidth={224}
        rootClassName="inline-flex shrink-0"
        buttonClassName="!h-8 !w-auto gap-2 !border !border-[var(--settings-border)] !bg-[var(--settings-control)] !px-2.5 !text-xs !text-[var(--settings-text-secondary)] hover:!bg-[var(--settings-control-hover)] hover:!text-[var(--settings-text)] disabled:opacity-45 disabled:cursor-not-allowed"
        openButtonClassName="!bg-[var(--settings-control-hover)] !text-[var(--settings-text)]"
        triggerIcon={<><span>{label}</span><ChevronDown size={12} /></>}
    />
}
