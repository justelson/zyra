import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronRight, MoreVertical, Plus } from 'lucide-react'
import { dismissTransientMenus, TRANSIENT_MENU_DISMISS_EVENT } from '@/lib/transient-menu'
import { cn } from '@/lib/utils'
import { FileActionsMenuSecondaryAction } from './FileActionsMenuSecondaryAction'

export interface FileActionsMenuChoice {
    id: string
    label: string
    icon?: React.ReactNode
    onSelect: () => void | Promise<void>
    disabled?: boolean
    danger?: boolean
    checked?: boolean
    separatorBefore?: boolean
}

export interface FileActionsMenuItem extends FileActionsMenuChoice {
    secondaryAction?: FileActionsMenuChoice
    choices?: FileActionsMenuChoice[]
    choicesLabel?: string
}

interface FileActionsMenuProps {
    items: FileActionsMenuItem[]
    rootClassName?: string
    buttonClassName?: string
    openButtonClassName?: string
    menuClassName?: string
    title?: string
    triggerIcon?: React.ReactNode
    presentation?: 'portal' | 'inline'
    preferredDirection?: 'up' | 'down'
    density?: 'default' | 'compact'
    menuWidth?: number
    menuLabel?: string
    accentColor?: string
}

export function FileActionsMenu({
    items,
    rootClassName,
    buttonClassName,
    openButtonClassName,
    menuClassName,
    title = 'Actions',
    triggerIcon,
    presentation = 'portal',
    preferredDirection,
    density = 'default',
    menuWidth,
    menuLabel,
    accentColor
}: FileActionsMenuProps) {
    const [open, setOpen] = useState(false)
    const [expandedItemId, setExpandedItemId] = useState<string | null>(null)
    const rootRef = useRef<HTMLDivElement | null>(null)
    const buttonRef = useRef<HTMLButtonElement | null>(null)
    const menuRef = useRef<HTMLDivElement | null>(null)
    const submenuRef = useRef<HTMLDivElement | null>(null)
    const [inlineDirection, setInlineDirection] = useState<'up' | 'down'>('down')
    const [menuPosition, setMenuPosition] = useState<{
        direction: 'up' | 'down'
        top?: number
        bottom?: number
        left: number
        maxHeight: number
    } | null>(null)
    const [submenuPosition, setSubmenuPosition] = useState<{
        top: number
        left: number
        side: 'left' | 'right'
    } | null>(null)
    const compact = density === 'compact'
    const resolvedMenuWidth = menuWidth || (compact ? 176 : 180)
    const accentedMenuStyle = accentColor ? ({
        '--file-actions-menu-accent': accentColor,
        borderColor: `color-mix(in srgb, ${accentColor} 30%, var(--surface-divider))`,
        background: `color-mix(in srgb, ${accentColor} 6%, var(--surface-floating))`,
        boxShadow: `inset 0 2px 0 color-mix(in srgb, ${accentColor} 72%, transparent), 0 14px 34px rgba(0,0,0,0.32), 0 0 0 1px color-mix(in srgb, ${accentColor} 7%, transparent)`
    } as CSSProperties) : undefined

    const updatePosition = (menuWidth = resolvedMenuWidth) => {
        const button = buttonRef.current
        if (!button) return

        const viewportPadding = 12
        const gap = 6
        const separatorCount = items.filter((item) => item.separatorBefore).length
        const estimatedMenuHeight = Math.min(360, items.length * (compact ? 32 : 34) + separatorCount * 5 + 14 + (menuLabel ? 36 : 0))
        const rect = button.getBoundingClientRect()
        const spaceBelow = window.innerHeight - rect.bottom - viewportPadding
        const spaceAbove = rect.top - viewportPadding
        let direction: 'up' | 'down' = preferredDirection
            || (spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow ? 'up' : 'down')
        if (direction === 'down' && spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow) direction = 'up'
        if (direction === 'up' && spaceAbove < estimatedMenuHeight && spaceBelow > spaceAbove) direction = 'down'

        if (presentation === 'inline') {
            setInlineDirection(direction)
            setMenuPosition(null)
            return
        }

        const maxLeft = Math.max(viewportPadding, window.innerWidth - menuWidth - viewportPadding)
        const left = Math.max(viewportPadding, Math.min(rect.right - menuWidth, maxLeft))
        setMenuPosition(direction === 'up'
            ? {
                direction,
                bottom: Math.max(viewportPadding, window.innerHeight - rect.top + gap),
                left,
                maxHeight: Math.max(1, spaceAbove - gap)
            }
            : {
                direction,
                top: Math.max(viewportPadding, rect.bottom + gap),
                left,
                maxHeight: Math.max(1, spaceBelow - gap)
            })
    }

    useEffect(() => {
        if (!open) return

        updatePosition()
        const handleResize = () => {
            setExpandedItemId(null)
            setSubmenuPosition(null)
            updatePosition(menuRef.current?.offsetWidth ?? resolvedMenuWidth)
        }
        const rafId = window.requestAnimationFrame(handleResize)
        window.addEventListener('resize', handleResize)
        return () => {
            window.cancelAnimationFrame(rafId)
            window.removeEventListener('resize', handleResize)
        }
    }, [compact, items, menuLabel, open, preferredDirection, presentation, resolvedMenuWidth])

    useEffect(() => {
        if (!open) {
            setExpandedItemId(null)
            setSubmenuPosition(null)
        }
    }, [open])

    useEffect(() => {
        if (!open || presentation !== 'portal') return

        const handleScroll = () => setOpen(false)

        window.addEventListener('scroll', handleScroll, true)
        return () => window.removeEventListener('scroll', handleScroll, true)
    }, [open, presentation])

    useEffect(() => {
        if (!open) return

        const dismiss = () => setOpen(false)
        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target
            if (!(target instanceof Node)) {
                dismiss()
                return
            }
            const isInsideButton = Boolean(rootRef.current?.contains(target))
            const isInsideMenu = Boolean(menuRef.current?.contains(target))
            const isInsideSubmenu = Boolean(submenuRef.current?.contains(target))
            if (!isInsideButton && !isInsideMenu && !isInsideSubmenu) dismiss()
        }
        const handleFocusIn = (event: FocusEvent) => {
            const target = event.target
            if (!(target instanceof Node)) return
            if (rootRef.current?.contains(target) || menuRef.current?.contains(target) || submenuRef.current?.contains(target)) return
            dismiss()
        }
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return
            if (expandedItemId) {
                event.preventDefault()
                setExpandedItemId(null)
                setSubmenuPosition(null)
                return
            }
            dismiss()
        }

        document.addEventListener('pointerdown', handlePointerDown, true)
        document.addEventListener('focusin', handleFocusIn)
        document.addEventListener('keydown', handleEscape)
        window.addEventListener('blur', dismiss)
        window.addEventListener(TRANSIENT_MENU_DISMISS_EVENT, dismiss)
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown, true)
            document.removeEventListener('focusin', handleFocusIn)
            document.removeEventListener('keydown', handleEscape)
            window.removeEventListener('blur', dismiss)
            window.removeEventListener(TRANSIENT_MENU_DISMISS_EVENT, dismiss)
        }
    }, [expandedItemId, open])

    if (items.length === 0) return null

    const menuDirection = presentation === 'inline' ? inlineDirection : menuPosition?.direction
    const menuBody = (
        <div
            role="menu"
            className={cn(
                'relative overflow-y-auto overscroll-contain shadow-[0_18px_48px_rgba(0,0,0,0.34)] backdrop-blur-xl',
                compact
                    ? 'rounded-[7px] border border-[var(--surface-divider)] bg-[var(--surface-floating)] p-1'
                    : 'rounded-xl border border-white/10 bg-sparkle-card p-1.5',
                accentColor && 'border-[color-mix(in_srgb,var(--file-actions-menu-accent)_42%,var(--surface-divider))]',
                menuDirection === 'up' ? 'assistant-menu-in-up' : 'assistant-menu-in-down'
            )}
            style={{
                maxHeight: menuPosition ? `${menuPosition.maxHeight}px` : 'calc(100vh - 24px)',
                ...accentedMenuStyle
            }}
            onKeyDown={(event) => {
                if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
                const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
                if (buttons.length === 0) return
                event.preventDefault()
                const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement)
                const nextIndex = event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                        ? buttons.length - 1
                        : event.key === 'ArrowUp'
                            ? (currentIndex <= 0 ? buttons.length - 1 : currentIndex - 1)
                            : (currentIndex + 1) % buttons.length
                buttons[nextIndex]?.focus()
            }}
        >
            {menuLabel ? (
                <div
                    className="mx-1 mb-1 flex min-h-9 items-center gap-2 border-b border-[var(--surface-divider)] px-1.5 py-1.5"
                    style={accentColor ? {
                        borderColor: `color-mix(in srgb, ${accentColor} 22%, var(--surface-divider))`
                    } : undefined}
                >
                    <Plus size={13} className="shrink-0" style={accentColor ? { color: accentColor } : undefined} strokeWidth={2.2} aria-hidden="true" />
                    <span className="min-w-0 leading-none">
                        <span className="block text-[9px] font-semibold text-[color-mix(in_srgb,var(--color-text)_90%,transparent)]">Add tab</span>
                        <span className="mt-1 block truncate text-[8px] font-medium text-[color-mix(in_srgb,var(--color-text)_55%,transparent)]">{menuLabel}</span>
                    </span>
                </div>
            ) : null}
            {items.map((item) => (
                <div key={item.id}>
                    {item.separatorBefore ? <div className="mx-1 my-1 h-px bg-[var(--surface-divider)]" role="separator" /> : null}
                    <div className="flex w-full items-stretch">
                        <button
                            type="button"
                            role={typeof item.checked === 'boolean' ? 'menuitemcheckbox' : 'menuitem'}
                            aria-checked={typeof item.checked === 'boolean' ? item.checked : undefined}
                            disabled={item.disabled}
                            onClick={() => {
                                setOpen(false)
                                void item.onSelect()
                            }}
                            className={cn(
                                'flex min-w-0 flex-1 items-center gap-2 text-left transition-colors',
                                compact
                                    ? 'min-h-8 px-2 py-1.5 text-[11px] leading-none'
                                    : 'px-2.5 py-2 text-xs',
                                item.choices?.length || item.secondaryAction
                                    ? 'rounded-l-[4px] rounded-r-none'
                                    : compact ? 'rounded-[4px]' : 'rounded-md',
                                item.disabled
                                    ? compact ? 'cursor-not-allowed text-sparkle-text-muted/35' : 'cursor-not-allowed text-white/20'
                                    : item.danger
                                        ? 'text-red-200 hover:bg-red-500/15 hover:text-red-100'
                                        : compact
                                            ? accentColor
                                                ? 'text-[color-mix(in_srgb,var(--color-text)_80%,transparent)] hover:bg-[color-mix(in_srgb,var(--file-actions-menu-accent)_12%,transparent)] hover:text-[var(--color-text)]'
                                                : 'text-sparkle-text-secondary hover:bg-[var(--surface-hover)] hover:text-sparkle-text'
                                            : 'text-white/75 hover:bg-white/10 hover:text-white'
                            )}
                        >
                            <span className="inline-flex size-4 shrink-0 items-center justify-center" style={accentColor && !item.danger ? { color: `color-mix(in srgb, ${accentColor} 76%, var(--color-text))` } : undefined}>{item.icon}</span>
                            <span className="min-w-0 flex-1 truncate">{item.label}</span>
                            {item.checked ? <Check className="size-3.5 shrink-0 text-[var(--accent-primary)]" strokeWidth={2.2} /> : null}
                        </button>
                        {item.secondaryAction ? <FileActionsMenuSecondaryAction action={item.secondaryAction} onClose={() => setOpen(false)} /> : null}
                        {item.choices?.length ? (
                            <button
                                type="button"
                                role="menuitem"
                                aria-label={item.choicesLabel || `Choose ${item.label} type`}
                                aria-expanded={expandedItemId === item.id}
                                aria-haspopup="menu"
                                disabled={item.disabled}
                                onClick={(event) => {
                                    if (expandedItemId === item.id) {
                                        setExpandedItemId(null)
                                        setSubmenuPosition(null)
                                        return
                                    }
                                    const submenuWidth = 168
                                    const viewportPadding = 8
                                    const gap = 6
                                    const rect = event.currentTarget.getBoundingClientRect()
                                    const estimatedHeight = Math.min(280, (item.choices?.length || 0) * (compact ? 32 : 34) + 8)
                                    const spaceRight = window.innerWidth - rect.right - viewportPadding
                                    const side = spaceRight >= submenuWidth + gap || rect.left < submenuWidth + gap
                                        ? 'right'
                                        : 'left'
                                    const left = side === 'right'
                                        ? Math.min(window.innerWidth - submenuWidth - viewportPadding, rect.right + gap)
                                        : Math.max(viewportPadding, rect.left - submenuWidth - gap)
                                    const top = Math.max(
                                        viewportPadding,
                                        Math.min(rect.top - 4, window.innerHeight - estimatedHeight - viewportPadding)
                                    )
                                    setExpandedItemId(item.id)
                                    setSubmenuPosition({ top, left, side })
                                }}
                                className={cn(
                                    'inline-flex w-7 shrink-0 items-center justify-center rounded-r-[4px] border-l border-[color-mix(in_srgb,var(--color-text)_8%,transparent)] text-sparkle-text-muted/55 transition-colors hover:bg-[var(--surface-hover)] hover:text-sparkle-text',
                                    expandedItemId === item.id && 'bg-[var(--surface-hover)] text-sparkle-text',
                                    item.disabled && 'cursor-not-allowed opacity-35'
                                )}
                            >
                                <ChevronRight
                                    size={12}
                                    className={cn(
                                        'transition-transform',
                                        expandedItemId === item.id && submenuPosition?.side === 'left' && 'rotate-180'
                                    )}
                                />
                            </button>
                        ) : null}
                    </div>
                </div>
            ))}
        </div>
    )

    return (
        <div ref={rootRef} className={cn('relative', rootClassName)}>
            <button
                ref={buttonRef}
                type="button"
                onClick={(event) => {
                    event.stopPropagation()
                    if (!open) {
                        dismissTransientMenus()
                        setMenuPosition(null)
                    }
                    setOpen(!open)
                }}
                onKeyDown={(event) => {
                    if (event.key !== 'ArrowDown') return
                    event.preventDefault()
                    if (!open) {
                        dismissTransientMenus()
                        setMenuPosition(null)
                        setOpen(true)
                    }
                    window.requestAnimationFrame(() => {
                        window.requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus())
                    })
                }}
                className={cn(
                    'group/file-menu h-7 w-7 inline-flex items-center justify-center rounded-md border-0 text-white/45 transition-colors hover:bg-white/10 hover:text-white',
                    buttonClassName,
                    open && (openButtonClassName || 'border-0 bg-white/10 text-white opacity-100')
                )}
                title={title}
                aria-label={title}
                data-state={open ? 'open' : 'closed'}
                aria-haspopup="menu"
                aria-expanded={open}
            >
                {triggerIcon || <MoreVertical size={15} className="mx-auto" />}
            </button>

            {open && presentation === 'inline' ? (
                <div
                    ref={menuRef}
                    className={cn(
                        'absolute right-0 z-[140]',
                        compact ? 'w-44' : 'min-w-[180px]',
                        inlineDirection === 'up' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
                        menuClassName
                    )}
                    style={menuWidth ? { width: `${menuWidth}px` } : undefined}
                    onClick={(event) => event.stopPropagation()}
                >
                    {menuBody}
                </div>
            ) : null}

            {open && presentation === 'portal' && menuPosition && typeof document !== 'undefined' && createPortal(
                <div
                    ref={menuRef}
                    data-zyra-native-view-occluder="true"
                    className={cn(
                        'fixed z-[340]',
                        compact ? 'w-44' : 'min-w-[180px]',
                        menuClassName
                    )}
                    style={{
                        top: menuPosition.top == null ? undefined : `${menuPosition.top}px`,
                        bottom: menuPosition.bottom == null ? undefined : `${menuPosition.bottom}px`,
                        left: `${menuPosition.left}px`,
                        width: menuWidth ? `${menuWidth}px` : undefined
                    }}
                    onClick={(event) => event.stopPropagation()}
                >
                    {menuBody}
                </div>,
                document.body
            )}

            {open && expandedItemId && submenuPosition && typeof document !== 'undefined' && createPortal(
                <div
                    ref={submenuRef}
                    role="menu"
                    aria-label={items.find((item) => item.id === expandedItemId)?.choicesLabel || 'Choose tab type'}
                    data-zyra-native-view-occluder="true"
                    className="assistant-menu-in-right fixed z-[350] w-[168px] rounded-[7px] border border-[var(--surface-divider)] bg-[var(--surface-floating)] p-1 shadow-[0_18px_48px_rgba(0,0,0,0.38)] backdrop-blur-xl"
                    style={{ top: `${submenuPosition.top}px`, left: `${submenuPosition.left}px` }}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
                        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
                        if (buttons.length === 0) return
                        event.preventDefault()
                        const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement)
                        const nextIndex = event.key === 'Home'
                            ? 0
                            : event.key === 'End'
                                ? buttons.length - 1
                                : event.key === 'ArrowUp'
                                    ? (currentIndex <= 0 ? buttons.length - 1 : currentIndex - 1)
                                    : (currentIndex + 1) % buttons.length
                        buttons[nextIndex]?.focus()
                    }}
                >
                    {items.find((item) => item.id === expandedItemId)?.choices?.map((choice) => (
                        <button
                            key={choice.id}
                            type="button"
                            role={typeof choice.checked === 'boolean' ? 'menuitemcheckbox' : 'menuitem'}
                            aria-checked={typeof choice.checked === 'boolean' ? choice.checked : undefined}
                            disabled={choice.disabled}
                            onClick={() => {
                                setOpen(false)
                                void choice.onSelect()
                            }}
                            className={cn(
                                'flex min-h-8 w-full items-center gap-2 rounded-[4px] px-2 py-1.5 text-left text-[10px] leading-none transition-colors',
                                choice.disabled
                                    ? 'cursor-not-allowed text-sparkle-text-muted/35'
                                    : choice.danger
                                        ? 'text-red-200 hover:bg-red-500/15 hover:text-red-100'
                                        : 'text-sparkle-text-secondary hover:bg-[var(--surface-hover)] hover:text-sparkle-text'
                            )}
                        >
                            <span className="inline-flex size-4 shrink-0 items-center justify-center">{choice.icon}</span>
                            <span className="min-w-0 flex-1 truncate">{choice.label}</span>
                            {choice.checked ? <Check className="size-3.5 shrink-0 text-[var(--accent-primary)]" strokeWidth={2.2} /> : null}
                        </button>
                    ))}
                </div>,
                document.body
            )}
        </div>
    )
}
