import { Check, ChevronDown, Moon, Search, Sun } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
    DARK_THEMES,
    LIGHT_THEMES,
    type DarkTheme,
    type LightTheme,
    type Theme
} from '@/lib/settings'
import type { ThemeDefinition, ThemeTokens } from '@/lib/settings-theme-catalog'
import { cn } from '@/lib/utils'
import { createSettingsRowTargetId } from '../settings-search'

const PALETTE_ROLES: ReadonlyArray<keyof ThemeTokens> = [
    'bg',
    'card',
    'accent',
    'border',
    'borderSecondary',
    'textMuted',
    'textSecondary',
    'textDarker',
    'textDark',
    'text',
    'secondary',
    'primary'
]

const POPOVER_GAP = 8
const POPOVER_CHROME_HEIGHT = 56
const MAX_LIST_HEIGHT = 168
const MIN_LIST_HEIGHT = 104

type PopoverLayout = {
    left: number
    top: number
    width: number
    listHeight: number
}

function ThemePaletteStrip({ theme, className }: { theme: ThemeDefinition; className?: string }) {
    return (
        <span
            className={cn('flex h-5 w-[132px] shrink-0 overflow-hidden rounded-md border border-black/10 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]', className)}
            data-theme-palette={theme.id}
            aria-label={`${theme.name} palette: ${PALETTE_ROLES.map((role) => `${role} ${theme.tokens[role]}`).join(', ')}`}
        >
            {PALETTE_ROLES.map((role) => (
                <span
                    key={role}
                    className="min-w-0 flex-1"
                    style={{ backgroundColor: theme.tokens[role] }}
                    title={`${role}: ${theme.tokens[role]}`}
                />
            ))}
        </span>
    )
}

function AppearanceThemeSelect({
    appearance,
    value,
    themes,
    onChange
}: {
    appearance: 'light' | 'dark'
    value: Theme
    themes: readonly ThemeDefinition[]
    onChange: (theme: Theme) => void
}) {
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState('')
    const [popoverLayout, setPopoverLayout] = useState<PopoverLayout | null>(null)
    const rootRef = useRef<HTMLDivElement | null>(null)
    const popoverRef = useRef<HTMLDivElement | null>(null)
    const searchRef = useRef<HTMLInputElement | null>(null)
    const listRef = useRef<HTMLDivElement | null>(null)
    const activeOptionRef = useRef<HTMLButtonElement | null>(null)
    const listboxId = useId()
    const selected = themes.find((theme) => theme.id === value) || themes[0]
    const filteredThemes = useMemo(() => {
        const normalized = query.trim().toLocaleLowerCase()
        if (!normalized) return themes
        return themes.filter((theme) => `${theme.name} ${theme.description}`.toLocaleLowerCase().includes(normalized))
    }, [query, themes])

    const positionPopover = useCallback(() => {
        const trigger = rootRef.current
        if (!trigger) return
        const rect = trigger.getBoundingClientRect()
        const viewportPadding = 8
        const availableBelow = window.innerHeight - rect.bottom - POPOVER_GAP - viewportPadding
        const availableAbove = rect.top - POPOVER_GAP - viewportPadding
        const openAbove = availableBelow < POPOVER_CHROME_HEIGHT + MIN_LIST_HEIGHT && availableAbove > availableBelow
        const available = openAbove ? availableAbove : availableBelow
        const listHeight = Math.max(
            MIN_LIST_HEIGHT,
            Math.min(MAX_LIST_HEIGHT, available - POPOVER_CHROME_HEIGHT)
        )
        const popoverHeight = POPOVER_CHROME_HEIGHT + listHeight
        const width = Math.min(rect.width, window.innerWidth - viewportPadding * 2)
        const left = Math.max(viewportPadding, Math.min(rect.left, window.innerWidth - width - viewportPadding))
        const top = openAbove
            ? Math.max(viewportPadding, rect.top - POPOVER_GAP - popoverHeight)
            : Math.min(window.innerHeight - popoverHeight - viewportPadding, rect.bottom + POPOVER_GAP)
        setPopoverLayout({ left, top, width, listHeight })
    }, [])

    useEffect(() => {
        if (!open) return
        positionPopover()
        const closeOnOutsidePointer = (event: PointerEvent) => {
            const target = event.target as Node
            if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false)
        }
        const closeOnEscape = (event: globalThis.KeyboardEvent) => {
            if (event.key === 'Escape') {
                setOpen(false)
                rootRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
            }
        }
        const updatePosition = () => positionPopover()
        document.addEventListener('pointerdown', closeOnOutsidePointer)
        document.addEventListener('keydown', closeOnEscape)
        window.addEventListener('resize', updatePosition)
        window.addEventListener('scroll', updatePosition, true)
        const focusTimer = window.setTimeout(() => searchRef.current?.focus(), 0)
        return () => {
            window.clearTimeout(focusTimer)
            document.removeEventListener('pointerdown', closeOnOutsidePointer)
            document.removeEventListener('keydown', closeOnEscape)
            window.removeEventListener('resize', updatePosition)
            window.removeEventListener('scroll', updatePosition, true)
        }
    }, [open, positionPopover])

    useEffect(() => {
        if (!open || query) return
        const frame = window.requestAnimationFrame(() => {
            const list = listRef.current
            const option = activeOptionRef.current
            if (!list || !option) return
            list.scrollTop = Math.max(0, option.offsetTop - ((list.clientHeight - option.clientHeight) / 2))
        })
        return () => window.cancelAnimationFrame(frame)
    }, [open, query, selected?.id])

    if (!selected) return null

    const label = appearance === 'light' ? 'Light theme' : 'Dark theme'
    const Icon = appearance === 'light' ? Sun : Moon
    const popover = open && popoverLayout ? (
        <div
            ref={popoverRef}
            onKeyDown={event => {
                const options = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') || [])]
                if (event.target === searchRef.current && event.key === 'Enter') { event.preventDefault(); options[0]?.click(); return }
                if (!['ArrowDown', 'ArrowUp'].includes(event.key) || !options.length) return
                event.preventDefault()
                const index = options.indexOf(document.activeElement as HTMLButtonElement)
                options[event.key === 'ArrowDown' ? (index + 1) % options.length : index <= 0 ? options.length - 1 : index - 1]?.focus()
            }}
            className="fixed z-[120] overflow-hidden rounded-lg border border-[var(--settings-border-strong)] bg-[var(--settings-popover)] shadow-[0_18px_60px_color-mix(in_srgb,var(--color-bg)_45%,transparent)] backdrop-blur-xl"
            style={{
                left: popoverLayout.left,
                top: popoverLayout.top,
                width: popoverLayout.width
            }}
        >
            <label className="m-2 flex h-8 items-center gap-2 rounded-md border border-[var(--settings-border)] bg-[var(--settings-control)] px-2.5 text-[var(--settings-text-muted)] focus-within:border-[var(--accent-primary)]">
                <Search size={13} />
                <input
                    ref={searchRef}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={`Search ${appearance} themes`}
                    className="min-w-0 flex-1 bg-transparent text-[11px] text-[var(--settings-text)] outline-none placeholder:text-[var(--settings-text-faint)]"
                />
            </label>
            <div
                ref={listRef}
                id={listboxId}
                role="listbox"
                aria-label={label}
                className="overflow-y-auto border-t border-[var(--settings-border)] p-1 [scrollbar-gutter:stable]"
                style={{ maxHeight: popoverLayout.listHeight }}
            >
                {filteredThemes.map((theme) => {
                    const active = theme.id === selected.id
                    return (
                        <button
                            ref={active ? activeOptionRef : undefined}
                            key={theme.id}
                            type="button"
                            role="option"
                            aria-selected={active}
                            data-theme-option={theme.id}
                            onClick={() => {
                                onChange(theme.id as Theme)
                                setOpen(false)
                            }}
                            className={cn(
                                'grid w-full grid-cols-[minmax(0,1fr)_auto_18px] items-center gap-3 rounded-md px-2.5 py-1.5 text-left outline-none transition-colors hover:bg-[var(--settings-nav-hover)] focus-visible:bg-[var(--settings-nav-hover)]',
                                active && 'bg-[var(--settings-active)]'
                            )}
                        >
                            <span className="min-w-0">
                                <span className="block truncate text-[12px] font-medium text-[var(--settings-text)]">{theme.name}</span>
                                <span className="mt-0.5 block truncate text-[10px] text-[var(--settings-text-muted)]">{theme.description}</span>
                            </span>
                            <ThemePaletteStrip theme={theme} />
                            {active ? <Check size={13} className="text-[var(--accent-primary)]" /> : <span />}
                        </button>
                    )
                })}
                {filteredThemes.length === 0 ? (
                    <p className="px-3 py-6 text-center text-[11px] text-[var(--settings-text-muted)]">No matching themes</p>
                ) : null}
            </div>
        </div>
    ) : null

    return (
        <div ref={rootRef} className="relative min-w-0">
            <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={open ? listboxId : undefined}
                data-theme-select={appearance}
                onClick={() => {
                    setQuery('')
                    setOpen((current) => !current)
                }}
                onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') {
                        event.preventDefault()
                        setQuery('')
                        setOpen(true)
                    }
                }}
                className="grid h-[58px] w-full grid-cols-[28px_minmax(0,1fr)_auto_16px] items-center gap-2.5 rounded-lg border border-[var(--settings-border)] bg-[color-mix(in_srgb,var(--color-bg)_72%,var(--color-card))] px-3 text-left outline-none transition-colors hover:border-[var(--settings-border-strong)] hover:bg-[color-mix(in_srgb,var(--color-bg)_58%,var(--color-card))] focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
            >
                <span className="inline-flex size-7 items-center justify-center rounded-md bg-[var(--surface-hover)] text-[var(--settings-text-secondary)]">
                    <Icon size={14} />
                </span>
                <span className="min-w-0">
                    <span className="block text-[10px] font-medium text-[var(--settings-text-muted)]">{label}</span>
                    <span className="mt-0.5 block truncate text-[12px] font-semibold text-[var(--settings-text)]">{selected.name}</span>
                </span>
                <ThemePaletteStrip theme={selected} className="hidden sm:flex" />
                <ChevronDown size={14} className={cn('text-[var(--settings-text-muted)] transition-transform', open && 'rotate-180')} />
            </button>
            {popover ? createPortal(popover, document.body) : null}
        </div>
    )
}

export function AppearanceThemeSelector({
    appearance,
    lightTheme,
    darkTheme,
    onLightThemeChange,
    onDarkThemeChange,
    className
}: {
    appearance: 'light' | 'dark'
    lightTheme: LightTheme
    darkTheme: DarkTheme
    onLightThemeChange: (theme: LightTheme) => void
    onDarkThemeChange: (theme: DarkTheme) => void
    className?: string
}) {
    const isLight = appearance === 'light'
    return (
        <div
            className={cn('mx-auto w-full max-w-[520px]', className)}
            data-settings-search-target={createSettingsRowTargetId('Theme', isLight ? 'Light theme' : 'Dark theme')}
            tabIndex={-1}
        >
            <AppearanceThemeSelect
                appearance={appearance}
                value={isLight ? lightTheme : darkTheme}
                themes={isLight ? LIGHT_THEMES : DARK_THEMES}
                onChange={(theme) => {
                    if (isLight) onLightThemeChange(theme as LightTheme)
                    else onDarkThemeChange(theme as DarkTheme)
                }}
            />
        </div>
    )
}
