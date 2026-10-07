import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { addOverlayEventListener, addOverlayWindowBlurListener, createOverlayPortal as createPortal, isOverlayEventInside } from './native-overlay-portal'
import { supportsNativeOverlay } from './native-overlay-host'
import { Check, ChevronRight, MoreVertical, Plus } from 'lucide-react'
import { dismissTransientMenus, TRANSIENT_MENU_DISMISS_EVENT } from '@/lib/transient-menu'
import { cn } from '@/lib/utils'
import { FileActionsMenuSecondaryAction } from './FileActionsMenuSecondaryAction'
import { resolveFileActionsMenuWidth, resolveFileActionsSubmenuPosition } from './file-actions-menu-layout'

export interface FileActionsMenuChoice {
    id: string
    label: string
    hint?: string
    icon?: React.ReactNode
    onSelect: () => void | Promise<void>
    disabled?: boolean
    danger?: boolean
    checked?: boolean
    separatorBefore?: boolean
}

export interface FileActionsMenuItem extends FileActionsMenuChoice {
    ariaLabel?: string
    secondaryAction?: FileActionsMenuChoice
    choices?: FileActionsMenuChoice[]
    choicesLabel?: string
    submenuOnly?: boolean
}

interface FileActionsMenuProps {
    items: FileActionsMenuItem[]
    rootClassName?: string
    buttonClassName?: string
    openButtonClassName?: string
    menuClassName?: string
    title?: string
    disabled?: boolean
    triggerIcon?: React.ReactNode
    presentation?: 'portal' | 'inline'
    preferredDirection?: 'up' | 'down'
    density?: 'default' | 'compact'
    menuWidth?: number
    matchTriggerWidth?: boolean
    anchorRef?: RefObject<HTMLElement | null>
    menuLabel?: string
    selectionMode?: 'radio'
    containEscape?: boolean
    accentColor?: string
    contextAnchor?: { x: number; y: number }
    onDismiss?: () => void
    revealSecondaryOnHover?: boolean
}

function initialMenuButton(element: HTMLDivElement | null, radioSelection: boolean): HTMLButtonElement | null | undefined {
    return (radioSelection ? element?.querySelector<HTMLButtonElement>('button[aria-checked="true"]:not(:disabled)') : null)
        || element?.querySelector<HTMLButtonElement>('button:not(:disabled)')
}

export function FileActionsMenu({
    items,
    rootClassName,
    buttonClassName,
    openButtonClassName,
    menuClassName,
    title = 'Actions',
    disabled = false,
    triggerIcon,
    presentation = 'portal',
    preferredDirection,
    density = 'default',
    menuWidth,
    matchTriggerWidth = false,
    anchorRef,
    menuLabel,
    selectionMode,
    containEscape = false,
    accentColor,
    contextAnchor,
    onDismiss,
    revealSecondaryOnHover = false
}: FileActionsMenuProps) {
    const [open, setOpen] = useState(Boolean(contextAnchor))
    const wasOpen = useRef(open)
    const submenuCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const focusAfterOpen = useRef(false)
    const effectivePresentation = supportsNativeOverlay() ? 'portal' : presentation
    const [expandedItemId, setExpandedItemId] = useState<string | null>(null)
    const rootRef = useRef<HTMLDivElement | null>(null)
    const buttonRef = useRef<HTMLButtonElement | null>(null)
    const menuRef = useRef<HTMLDivElement | null>(null)
    const submenuRef = useRef<HTMLDivElement | null>(null)
    const focusAfterSubmenuMount = useRef(false)
    const [inlineDirection, setInlineDirection] = useState<'up' | 'down'>('down')
    const [menuPosition, setMenuPosition] = useState<{
        direction: 'up' | 'down'
        top?: number
        bottom?: number
        left: number
        width: number
        maxHeight: number
    } | null>(null)
    const [submenuPosition, setSubmenuPosition] = useState<{
        top: number
        left: number
        side: 'left' | 'right'
    } | null>(null)
    const compact = density === 'compact'
    const radioSelection = selectionMode === 'radio'
    const handleEscapeLocally = radioSelection || containEscape
    const resolvedMenuWidth = menuWidth || (compact ? 176 : 180)
    const closeMenu = useCallback(() => {
        focusAfterOpen.current = false
        setOpen(false)
    }, [])
    const requestOpen = useCallback((focus = false) => {
        if (disabled || open) return
        dismissTransientMenus()
        setMenuPosition(null)
        focusAfterOpen.current = focus
        setOpen(true)
    }, [disabled, open])
    useLayoutEffect(() => {
        if (!contextAnchor || disabled) closeMenu()
    }, [closeMenu, disabled, contextAnchor])
    useEffect(() => {
        if (wasOpen.current && !open) onDismiss?.()
        wasOpen.current = open
    }, [open, onDismiss])
    useEffect(() => () => { if (submenuCloseTimer.current) clearTimeout(submenuCloseTimer.current) }, [])
    const setMenuElement = useCallback((element: HTMLDivElement | null) => {
        menuRef.current = element
        if (element && focusAfterOpen.current) {
            focusAfterOpen.current = false
            const first = initialMenuButton(element, radioSelection)
            first?.setAttribute('data-native-overlay-autofocus', '')
            first?.focus()
        }
    }, [radioSelection])
    const setSubmenuElement = useCallback((element: HTMLDivElement | null) => {
        submenuRef.current = element
        if (element && focusAfterSubmenuMount.current) {
            focusAfterSubmenuMount.current = false
            const first = element.querySelector<HTMLButtonElement>('button:not(:disabled)')
            first?.setAttribute('data-native-overlay-autofocus', '')
            first?.focus()
        }
    }, [])
    const accentedMenuStyle = accentColor ? ({
        '--file-actions-menu-accent': accentColor,
        borderColor: `color-mix(in srgb, ${accentColor} 30%, var(--surface-divider))`,
        background: `color-mix(in srgb, ${accentColor} 6%, var(--surface-floating))`,
        boxShadow: `inset 0 2px 0 color-mix(in srgb, ${accentColor} 72%, transparent), 0 14px 34px rgba(0,0,0,0.32), 0 0 0 1px color-mix(in srgb, ${accentColor} 7%, transparent)`
    } as CSSProperties) : undefined

    const updatePosition = (preferredWidth = resolvedMenuWidth) => {
        const button = anchorRef?.current || buttonRef.current
        if (!button) return

        const viewportPadding = 12
        const gap = 6
        const separatorCount = items.filter((item) => item.separatorBefore).length
        const estimatedMenuHeight = Math.min(360, items.length * (compact ? 32 : 34) + separatorCount * 5 + 14 + (menuLabel ? 36 : 0))
        const rect = contextAnchor
            ? { top: contextAnchor.y, bottom: contextAnchor.y, left: contextAnchor.x, right: contextAnchor.x + preferredWidth, width: 0 }
            : button.getBoundingClientRect()
        const measuredWidth = resolveFileActionsMenuWidth(preferredWidth, rect.width, window.innerWidth, matchTriggerWidth)
        const spaceBelow = window.innerHeight - rect.bottom - viewportPadding
        const spaceAbove = rect.top - viewportPadding
        let direction: 'up' | 'down' = preferredDirection
            || (spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow ? 'up' : 'down')
        if (direction === 'down' && spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow) direction = 'up'
        if (direction === 'up' && spaceAbove < estimatedMenuHeight && spaceBelow > spaceAbove) direction = 'down'

        if (effectivePresentation === 'inline') {
            setInlineDirection(direction)
            setMenuPosition(null)
            return
        }

        const maxLeft = Math.max(viewportPadding, window.innerWidth - measuredWidth - viewportPadding)
        const left = Math.max(viewportPadding, Math.min(rect.right - measuredWidth, maxLeft))
        setMenuPosition(direction === 'up'
            ? {
                direction,
                bottom: Math.max(viewportPadding, window.innerHeight - rect.top + gap),
                left,
                width: measuredWidth,
                maxHeight: Math.max(1, spaceAbove - gap)
            }
            : {
                direction,
                top: Math.max(viewportPadding, rect.bottom + gap),
                left,
                width: measuredWidth,
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
        const observer = matchTriggerWidth && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(handleResize) : null
        const anchor = anchorRef?.current || buttonRef.current
        if (anchor) observer?.observe(anchor)
        return () => {
            window.cancelAnimationFrame(rafId)
            window.removeEventListener('resize', handleResize)
            observer?.disconnect()
        }
    }, [compact, items, menuLabel, open, preferredDirection, effectivePresentation, resolvedMenuWidth, matchTriggerWidth, anchorRef, contextAnchor])

    useEffect(() => {
        if (!open) {
            setExpandedItemId(null)
            setSubmenuPosition(null)
        }
    }, [open])

    useEffect(() => {
        if (!open || effectivePresentation !== 'portal') return

        const handleScroll = () => setOpen(false)

        window.addEventListener('scroll', handleScroll, true)
        return () => window.removeEventListener('scroll', handleScroll, true)
    }, [open, effectivePresentation])

    useEffect(() => {
        if (!open) return

        const dismiss = closeMenu
        const handlePointerDown = (event: PointerEvent) => {
            if (!isOverlayEventInside(event, rootRef.current, menuRef.current, submenuRef.current)) dismiss()
        }
        const handleFocusIn = (event: FocusEvent) => {
            if (isOverlayEventInside(event, rootRef.current, menuRef.current, submenuRef.current)) return
            dismiss()
        }
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return
            if (handleEscapeLocally) {
                event.preventDefault()
                event.stopPropagation()
            }
            if (expandedItemId) {
                event.preventDefault()
                setExpandedItemId(null)
                setSubmenuPosition(null)
                Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button[data-submenu-id]') || []).find(button => button.dataset.submenuId === expandedItemId)?.focus()
                return
            }
            dismiss()
            if (handleEscapeLocally) buttonRef.current?.focus()
        }

        const removePointer = addOverlayEventListener('pointerdown', handlePointerDown, true)
        const removeFocus = addOverlayEventListener('focusin', handleFocusIn)
        const removeEscape = addOverlayEventListener('keydown', handleEscape, handleEscapeLocally)
        const removeBlur = addOverlayWindowBlurListener(dismiss)
        window.addEventListener(TRANSIENT_MENU_DISMISS_EVENT, dismiss)
        return () => {
            removePointer()
            removeFocus()
            removeEscape()
            removeBlur()
            window.removeEventListener(TRANSIENT_MENU_DISMISS_EVENT, dismiss)
        }
    }, [closeMenu, expandedItemId, open, handleEscapeLocally])

    if (items.length === 0) return null

    const cancelSubmenuClose = () => {
        if (submenuCloseTimer.current) clearTimeout(submenuCloseTimer.current)
        submenuCloseTimer.current = null
    }
    const scheduleSubmenuClose = () => {
        cancelSubmenuClose()
        submenuCloseTimer.current = setTimeout(() => { setExpandedItemId(null); setSubmenuPosition(null) }, 160)
    }
    const openSubmenu = (item: FileActionsMenuItem, element: HTMLElement, focus = false) => {
        if (item.disabled || !item.choices?.length) return
        cancelSubmenuClose()
        focusAfterSubmenuMount.current = focus
        setExpandedItemId(item.id)
        setSubmenuPosition(resolveFileActionsSubmenuPosition(element.getBoundingClientRect(), 196, item.choices.length, 32, window.innerWidth, window.innerHeight))
        if (focus && expandedItemId === item.id && submenuRef.current) {
            focusAfterSubmenuMount.current = false
            submenuRef.current.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
        }
    }
    const focusSubmenuParent = () => {
        const parent = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button[data-submenu-id]') || []).find(button => button.dataset.submenuId === expandedItemId)
        setExpandedItemId(null)
        setSubmenuPosition(null)
        parent?.focus()
    }

    const menuDirection = effectivePresentation === 'inline' ? inlineDirection : menuPosition?.direction
    const hoverSubmenus = items.some(item => item.submenuOnly)
    const expandedHoverSubmenu = items.some(item => item.id === expandedItemId && item.submenuOnly)
    const menuBody = (
        <div
            role="menu"
            aria-label={title}
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
                const currentIndex = buttons.indexOf(event.currentTarget.ownerDocument.activeElement as HTMLButtonElement)
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
                    <div
                        className={cn('group/menu-row flex w-full items-stretch', !item.disabled && !item.danger && 'file-actions-menu-row')}
                        data-expanded={expandedItemId === item.id ? 'true' : undefined}
                        onMouseEnter={hoverSubmenus ? event => {
                            cancelSubmenuClose()
                            if (item.submenuOnly) openSubmenu(item, event.currentTarget)
                            else if (expandedItemId !== item.id) { setExpandedItemId(null); setSubmenuPosition(null) }
                        } : undefined}
                        onMouseLeave={item.submenuOnly ? scheduleSubmenuClose : undefined}
                    >
                        <button
                            type="button"
                            role={typeof item.checked === 'boolean' ? (radioSelection ? 'menuitemradio' : 'menuitemcheckbox') : 'menuitem'}
                            aria-checked={typeof item.checked === 'boolean' ? item.checked : undefined}
                            aria-label={item.ariaLabel}
                            title={item.ariaLabel}
                            data-submenu-id={item.submenuOnly ? item.id : undefined}
                            aria-haspopup={item.submenuOnly ? 'menu' : undefined}
                            aria-expanded={item.submenuOnly ? expandedItemId === item.id : undefined}
                            disabled={item.disabled}
                            onClick={(event) => {
                                if (item.submenuOnly) { openSubmenu(item, event.currentTarget.parentElement!, event.detail === 0); return }
                                setOpen(false)
                                if (radioSelection) buttonRef.current?.focus()
                                void item.onSelect()
                            }}
                            onKeyDown={event => {
                                if (item.submenuOnly && event.key === 'ArrowRight') {
                                    event.preventDefault(); openSubmenu(item, event.currentTarget.parentElement!, true)
                                }
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
                                        : 'text-sparkle-text-secondary hover:text-sparkle-text'
                            )}
                        >
                            {!radioSelection || item.icon ? <span className="inline-flex size-4 shrink-0 items-center justify-center" style={accentColor && !item.danger ? { color: `color-mix(in srgb, ${accentColor} 76%, var(--color-text))` } : undefined}>{item.icon}</span> : null}
                            <span className="min-w-0 flex-1 truncate">{item.label}</span>
                            {item.hint ? <span aria-hidden="true" className="shrink-0 rounded-full bg-[var(--settings-control-hover)] px-1.5 py-0.5 text-[9px] font-medium tabular-nums text-[var(--settings-text-muted)] opacity-70">{item.hint}</span> : null}
                            {item.checked ? <Check className="size-3.5 shrink-0 text-[var(--accent-primary)]" strokeWidth={2.2} /> : null}
                            {item.submenuOnly ? <ChevronRight size={12} className="shrink-0 text-sparkle-text-muted" /> : null}
                        </button>
                        {item.secondaryAction ? <FileActionsMenuSecondaryAction action={item.secondaryAction} onClose={() => setOpen(false)} revealOnHover={revealSecondaryOnHover} /> : null}
                        {item.choices?.length && !item.submenuOnly ? (
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
                                    setExpandedItemId(item.id)
                                    setSubmenuPosition(resolveFileActionsSubmenuPosition(event.currentTarget.getBoundingClientRect(), 168, item.choices?.length || 0, compact ? 32 : 34, window.innerWidth, window.innerHeight))
                                }}
                                className={cn(
                                    'inline-flex w-7 shrink-0 items-center justify-center rounded-r-[4px] text-sparkle-text-muted transition-colors hover:text-sparkle-text',
                                    expandedItemId === item.id && 'text-sparkle-text',
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
                disabled={disabled}
                onClick={(event) => {
                    event.stopPropagation()
                    if (open) closeMenu()
                    else requestOpen(radioSelection && event.detail === 0)
                }}
                onKeyDown={(event) => {
                    if (event.key !== 'ArrowDown' && !(radioSelection && event.key === 'ArrowUp')) return
                    event.preventDefault()
                    if (!open) requestOpen(true)
                    else initialMenuButton(menuRef.current, radioSelection)?.focus()
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
                hidden={Boolean(contextAnchor)}
                style={contextAnchor ? { display: 'none' } : undefined}
            >
                {triggerIcon || <MoreVertical size={15} className="mx-auto" />}
            </button>

            {open && effectivePresentation === 'inline' ? (
                <div
                    ref={setMenuElement}
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

            {open && effectivePresentation === 'portal' && menuPosition && typeof document !== 'undefined' && createPortal(
                <div
                    ref={setMenuElement}
                    className={cn(
                        'fixed z-[340]',
                        matchTriggerWidth ? 'min-w-0' : compact ? 'w-44' : 'min-w-[180px]',
                        menuClassName
                    )}
                    style={{
                        top: menuPosition.top == null ? undefined : `${menuPosition.top}px`,
                        bottom: menuPosition.bottom == null ? undefined : `${menuPosition.bottom}px`,
                        left: `${menuPosition.left}px`,
                        width: matchTriggerWidth ? `${menuPosition.width}px` : menuWidth ? `${menuWidth}px` : undefined
                    }}
                    onClick={(event) => event.stopPropagation()}
                >
                    {menuBody}
                </div>,
                document.body
            )}

            {open && expandedItemId && submenuPosition && typeof document !== 'undefined' && createPortal(
                <div
                    ref={setSubmenuElement}
                    role="menu"
                    aria-label={items.find((item) => item.id === expandedItemId)?.choicesLabel || 'Choose tab type'}
                    className="file-actions-menu-flyout fixed z-[350] rounded-[7px] border border-[var(--surface-divider)] bg-[var(--surface-floating)] p-1 shadow-[0_18px_48px_rgba(0,0,0,0.38)] backdrop-blur-xl"
                    style={{ width: items.find(item => item.id === expandedItemId)?.submenuOnly ? '196px' : '168px', top: `${submenuPosition.top}px`, left: `${submenuPosition.left}px`, ...accentedMenuStyle }}
                    onClick={(event) => event.stopPropagation()}
                    onMouseEnter={expandedHoverSubmenu ? cancelSubmenuClose : undefined}
                    onMouseLeave={expandedHoverSubmenu ? scheduleSubmenuClose : undefined}
                    onKeyDown={(event) => {
                        if (event.key === 'ArrowLeft' || event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); focusSubmenuParent(); return }
                        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
                        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
                        if (buttons.length === 0) return
                        event.preventDefault()
                        const currentIndex = buttons.indexOf(event.currentTarget.ownerDocument.activeElement as HTMLButtonElement)
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
                                        : 'file-actions-menu-row text-sparkle-text-secondary hover:text-sparkle-text'
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
