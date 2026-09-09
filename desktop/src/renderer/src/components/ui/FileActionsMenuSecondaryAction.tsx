import type { FileActionsMenuChoice } from './FileActionsMenu'

export function FileActionsMenuSecondaryAction({ action, onClose }: {
    action: FileActionsMenuChoice
    onClose: () => void
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
            className="flex w-7 shrink-0 items-center justify-center rounded-r-[4px] border-l border-[var(--surface-divider)] text-sparkle-text-muted transition-colors hover:bg-[var(--surface-hover)] hover:text-sparkle-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--color-text-muted)] disabled:cursor-not-allowed disabled:opacity-35"
        >
            {action.icon}
        </button>
    )
}
