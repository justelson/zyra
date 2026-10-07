import type { FileActionsMenuChoice } from './FileActionsMenu'

export function FileActionsMenuSecondaryAction({ action, onClose, revealOnHover = false }: {
    action: FileActionsMenuChoice
    onClose: () => void
    revealOnHover?: boolean
}) {
    return (
        <button
            type="button"
            role="menuitem"
            aria-label={action.label}
            title={action.label}
            disabled={action.disabled}
            onClick={(event) => {
                event.stopPropagation()
                onClose()
                void action.onSelect()
            }}
            className={`flex w-7 shrink-0 items-center justify-center rounded-r-[4px] text-sparkle-text-muted transition-[color,opacity] hover:text-sparkle-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--color-text-muted)] disabled:cursor-not-allowed disabled:opacity-35 ${revealOnHover ? 'opacity-0 group-hover/menu-row:opacity-100 group-focus-within/menu-row:opacity-100' : ''}`}
        >
            {action.icon}
        </button>
    )
}
