import { addOverlayEventListener } from '@/components/ui/native-overlay-portal'
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { createOverlayPortal as createPortal } from '@/components/ui/native-overlay-portal'
import { Undo2, X } from 'lucide-react'
import { useInRouterContext } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { createSettingsRowTargetId, createSettingsSectionTargetId } from './settings-search'
import { SettingsInfoTooltip } from './SettingsInfoTooltip'
import { SettingsSectionNavigation } from './SettingsSectionNavigation'
import { SettingsBackLink } from './SettingsBackLink'
import { SettingsPageFrame } from './SettingsPageFrame'

const SettingsSearchSectionContext = createContext<string | null>(null)

export function SettingsPageContainer({ children, className, title, navigation, backTo, backLabel, showSettingsBack = false, fillViewport = false }: {
    children: ReactNode
    className?: string
    title?: string
    description?: string
    navigation?: ReactNode
    backTo?: string
    backLabel?: string
    showSettingsBack?: boolean
    fillViewport?: boolean
}) {
    const containerRef = useRef<HTMLDivElement | null>(null)
    const inRouter = useInRouterContext()
    const showBackLink = backTo && (showSettingsBack || !backTo.startsWith('/settings'))
    return (
        <SettingsPageFrame containerRef={containerRef} className={className} fillViewport={fillViewport}>
                {title ? (
                    <header className="px-0.5">
                        {inRouter ? <SettingsBackLink fallback={showBackLink ? backTo : undefined} fallbackLabel={backLabel} /> : null}
                        <h1 className="text-[22px] font-medium tracking-[-0.025em] text-[var(--settings-text)]">{title}</h1>
                    </header>
                ) : null}
                {inRouter ? navigation || <SettingsSectionNavigation containerRef={containerRef} /> : null}
                <div className={cn('flex min-w-0 flex-col gap-8', fillViewport && 'min-h-0 flex-1')} data-settings-page-content="true">{children}</div>
        </SettingsPageFrame>
    )
}

export function SettingsSection({ title, displayTitle, searchSection, icon, titleAction, headerAction, children, className, bodyClassName, hideHeader = false }: {
    title: string
    displayTitle?: ReactNode
    searchSection?: string
    icon?: ReactNode
    titleAction?: ReactNode
    headerAction?: ReactNode
    children: ReactNode
    className?: string
    bodyClassName?: string
    hideHeader?: boolean
}) {
    const searchTargetId = createSettingsSectionTargetId(title)
    return (
        <section
            className={cn('space-y-2.5 [content-visibility:auto] [contain-intrinsic-size:auto_220px]', className)}
            data-settings-search-target={searchTargetId}
            tabIndex={-1}
        >
            {!hideHeader ? (
                <div className="flex min-h-7 items-center justify-between gap-4 px-1">
                    <h2 className="flex min-w-0 items-center gap-2 text-[14px] font-medium tracking-[-0.01em] text-[var(--settings-text-secondary)]">{icon}{displayTitle || title}{titleAction}</h2>
                    <div className="flex min-h-7 items-center justify-end">{headerAction}</div>
                </div>
            ) : null}
            <SettingsSearchSectionContext.Provider value={searchSection || title}>
                <div className={cn('zyra-settings-section-body relative overflow-visible rounded-xl border border-[var(--settings-border)] bg-[var(--settings-section)] text-[var(--settings-text)] shadow-[inset_0_1px_0_var(--settings-section-highlight)]', bodyClassName)}>{children}</div>
            </SettingsSearchSectionContext.Provider>
        </section>
    )
}

export type SettingsStatusTone = 'ready' | 'warning' | 'danger' | 'info' | 'muted'

export function SettingsStatusPill({ label, tone = 'muted', title }: {
    label: ReactNode
    tone?: SettingsStatusTone
    title?: string
}) {
    return (
        <span
            title={title}
            className={cn(
                'inline-flex h-4 min-w-0 max-w-[18rem] items-center overflow-hidden rounded-full px-1.5 text-[9px] font-semibold leading-none tracking-[0.01em]',
                tone === 'ready' && 'bg-[color-mix(in_srgb,var(--status-success)_12%,transparent)] text-[var(--status-success)]',
                tone === 'warning' && 'bg-[color-mix(in_srgb,var(--status-warning)_12%,transparent)] text-[var(--status-warning)]',
                tone === 'danger' && 'bg-[color-mix(in_srgb,var(--status-danger)_12%,transparent)] text-[var(--status-danger)]',
                tone === 'info' && 'bg-[color-mix(in_srgb,var(--status-info)_12%,transparent)] text-[var(--status-info)]',
                tone === 'muted' && 'bg-[color-mix(in_srgb,var(--settings-text-muted)_10%,transparent)] text-[var(--settings-text-muted)]'
            )}
        >
            <span className="min-w-0 truncate">{label}</span>
        </span>
    )
}

export function SettingsRow({ title, description, icon, info, status, statusTone = 'muted', statusTitle, resetAction, control, children, className, layout = 'default', searchTargetId: explicitSearchTargetId, ...props }: Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
    title: ReactNode
    description: ReactNode
    icon?: ReactNode
    info?: ReactNode
    status?: ReactNode
    statusTone?: SettingsStatusTone
    statusTitle?: string
    resetAction?: ReactNode
    control?: ReactNode
    children?: ReactNode
    searchTargetId?: string
    layout?: 'default' | 'connection'
}) {
    const connection = layout === 'connection'
    const sectionTitle = useContext(SettingsSearchSectionContext)
    const searchTargetId = explicitSearchTargetId || (typeof title === 'string' ? createSettingsRowTargetId(sectionTitle, title) : null)
    return (
        <div
            {...props}
            data-settings-search-target={searchTargetId || undefined}
            tabIndex={searchTargetId ? -1 : props.tabIndex}
            className={cn('zyra-settings-row px-4 transition-colors duration-100 hover:bg-[var(--settings-row-hover)] [content-visibility:auto] [contain-intrinsic-size:auto_68px]', connection ? 'py-2.5 min-h-16 flex flex-col justify-center' : children ? 'pb-2.5 pt-3.5' : 'py-3.5', className)}
        >
            <div className={cn('grid', connection ? 'grid-cols-[minmax(0,1fr)_auto] items-center gap-4' : 'gap-3', !connection && Boolean(control) && 'sm:grid-cols-[minmax(0,1fr)_minmax(9rem,auto)] sm:items-center sm:gap-8')}>
                <div className="min-w-0 space-y-1">
                    <div className={cn('flex min-h-5 min-w-0 items-center gap-x-1.5 gap-y-1', connection ? 'flex-nowrap' : 'flex-wrap')}>
                        {icon ? <span className="inline-flex size-4 shrink-0 items-center justify-center">{icon}</span> : null}
                        <h3 className={cn('min-w-0 text-[13px] font-medium tracking-[-0.003em] text-[var(--settings-text)]', connection && 'truncate')}>{title}</h3>
                        {info ? <SettingsInfoTooltip label={typeof title === 'string' ? `About ${title}` : 'Setting details'}>{info}</SettingsInfoTooltip> : null}
                        {status ? <SettingsStatusPill label={status} tone={statusTone} title={statusTitle ?? (typeof status === 'string' ? status : undefined)} /> : null}
                        {resetAction ? <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">{resetAction}</span> : null}
                    </div>
                    <p className={cn('max-w-[34rem] text-[12px] leading-[1.5] text-[var(--settings-text-secondary)]', connection && 'truncate')}>{description}</p>
                </div>
                {control ? <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:justify-end">{control}</div> : null}
            </div>
            {children}
        </div>
    )
}

export function SettingsSwitch({ checked, onCheckedChange, disabled = false, label }: {
    checked: boolean
    onCheckedChange: (checked: boolean) => void
    disabled?: boolean
    label: string
}) {
    return (
        <button
            type="button"
            role="switch"
            data-state={checked ? 'checked' : 'unchecked'}
            aria-label={label}
            aria-checked={checked}
            disabled={disabled}
            onClick={() => onCheckedChange(!checked)}
            className="zyra-settings-switch"
        >
            <span className="zyra-settings-switch-thumb" />
        </button>
    )
}

export function SettingsSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
    return (
        <select
            {...props}
            className={cn('h-8 w-full min-w-40 rounded-md border border-[var(--settings-border)] bg-[var(--settings-control)] px-2.5 text-xs text-[var(--settings-text)] outline-none transition-colors hover:border-[var(--settings-border-strong)] hover:bg-[var(--settings-control-hover)] focus:border-[var(--accent-primary)] sm:w-44', props.className)}
        />
    )
}

export function SettingsInput(props: InputHTMLAttributes<HTMLInputElement>) {
    return (
        <input
            {...props}
            className={cn('h-8 w-full rounded-md border border-[var(--settings-border)] bg-[var(--settings-control)] px-2.5 text-xs text-[var(--settings-text)] outline-none transition-colors placeholder:text-[var(--settings-text-faint)] hover:border-[var(--settings-border-strong)] hover:bg-[var(--settings-control-hover)] focus:border-[var(--accent-primary)] sm:w-64', props.className)}
        />
    )
}

export function SettingsSlider({ value, min, max, step = 1, unit, label, onChange }: {
    value: number
    min: number
    max: number
    step?: number
    unit?: string
    label: string
    onChange: (value: number) => void
}) {
    const fill = max === min ? 100 : ((value - min) / (max - min)) * 100
    const [draft, setDraft] = useState(String(value))
    const [editing, setEditing] = useState(false)
    const inputRef = useRef<HTMLInputElement | null>(null)

    useEffect(() => setDraft(String(value)), [value])
    useEffect(() => {
        if (!editing) return
        inputRef.current?.focus()
        inputRef.current?.select()
    }, [editing])

    const commit = (candidate: number) => {
        if (!Number.isFinite(candidate)) {
            setDraft(String(value))
            setEditing(false)
            return
        }
        const next = Math.max(min, Math.min(max, Math.round(candidate / step) * step))
        setDraft(String(next))
        setEditing(false)
        if (next !== value) onChange(next)
    }

    return (
        <div className="flex w-full shrink-0 items-center gap-2.5 sm:w-44">
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(event) => {
                    const next = Math.max(min, Math.min(max, Number(event.target.value)))
                    if (Number.isFinite(next) && next !== value) onChange(next)
                }}
                aria-label={label}
                aria-valuetext={unit ? `${value}${unit}` : String(value)}
                className="zyra-settings-slider min-w-0 flex-1"
                style={{ ['--slider-fill' as string]: `${fill}%` }}
            />
            <div className="relative w-14 shrink-0 text-right text-xs tabular-nums text-[var(--settings-text-secondary)]">
                {!editing ? (
                    <button type="button" onClick={() => setEditing(true)} aria-label={`Edit ${label}`} title={`Edit ${label}`} className="h-7 w-full rounded px-0 text-right outline-none hover:bg-[var(--settings-control-hover)] focus-visible:bg-[var(--settings-control)] focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]">{value}{unit}</button>
                ) : null}
                {editing ? (
                    <div className="flex h-7 items-center justify-end gap-1">
                        <input
                            ref={inputRef}
                            type="text"
                            inputMode="numeric"
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                            onBlur={() => commit(Number(draft.trim()))}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') event.currentTarget.blur()
                                if (event.key === 'Escape') {
                                    setDraft(String(value))
                                    setEditing(false)
                                    event.currentTarget.blur()
                                }
                            }}
                            aria-label={`${label} value`}
                            className="h-7 w-10 rounded border border-[var(--accent-primary)] bg-[var(--settings-control)] py-0 pr-1 text-right text-xs tabular-nums text-[var(--settings-text)] outline-none"
                        />
                        {unit ? <span aria-hidden="true" className="text-[10px] text-[var(--settings-text-faint)]">{unit}</span> : null}
                    </div>
                ) : null}
            </div>
        </div>
    )
}

export function SettingsTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
    return (
        <textarea
            {...props}
            className={cn('w-full resize-y rounded-md border border-[var(--settings-border)] bg-[var(--settings-control)] px-3 py-2 text-xs leading-5 text-[var(--settings-text)] outline-none transition-colors placeholder:text-[var(--settings-text-faint)] hover:border-[var(--settings-border-strong)] hover:bg-[var(--settings-control-hover)] focus:border-[var(--accent-primary)]', props.className)}
        />
    )
}

export function SettingsButton({ variant = 'outline', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'outline' | 'ghost' | 'danger' | 'accent' }) {
    return (
        <button
            type="button"
            {...props}
            className={cn(
                'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45',
                variant === 'outline' && 'border border-[var(--settings-border)] bg-[var(--settings-control)] text-[var(--settings-text-secondary)] hover:border-[var(--settings-border-strong)] hover:bg-[var(--settings-control-hover)] hover:text-[var(--settings-text)]',
                variant === 'ghost' && 'text-[var(--settings-text-muted)] hover:bg-[var(--settings-control-hover)] hover:text-[var(--settings-text)]',
                variant === 'danger' && 'border border-red-400/20 bg-red-500/[0.07] text-red-200 hover:bg-red-500/[0.13]',
                variant === 'accent' && 'border border-[color-mix(in_srgb,var(--accent-primary)_30%,transparent)] bg-[color-mix(in_srgb,var(--accent-primary)_12%,transparent)] text-[var(--accent-primary)] hover:bg-[color-mix(in_srgb,var(--accent-primary)_18%,transparent)]',
                props.className
            )}
        />
    )
}

export function SettingsDialog({ open, title, titleIcon, description, descriptionMode = 'text', headerAction, children, footer, className, contentClassName, onClose }: {
    open: boolean
    title: string
    titleIcon?: ReactNode
    description?: string
    descriptionMode?: 'text' | 'info'
    headerAction?: ReactNode
    children: ReactNode
    footer?: ReactNode
    className?: string
    contentClassName?: string
    onClose: () => void
}) {
    useEffect(() => {
        if (!open) return
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose()
        }
        const removeOverlayListener1 = addOverlayEventListener('keydown', handleKeyDown)
        return () => removeOverlayListener1()
    }, [onClose, open])

    if (!open) return null

    return createPortal(
        <div
            className="fixed inset-0 z-[240] flex items-center justify-center bg-[color-mix(in_srgb,var(--color-bg)_62%,transparent)] p-5 backdrop-blur-[3px]"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose()
            }}
        >
            <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="settings-dialog-title"
                aria-describedby={description && descriptionMode === 'text' ? 'settings-dialog-description' : undefined}
                className={cn('zyra-settings-dialog flex max-h-[calc(100vh-2.5rem)] w-full max-w-[480px] flex-col overflow-hidden rounded-xl border border-[var(--settings-border-strong)] bg-[var(--settings-popover)] text-[var(--settings-text)] shadow-[0_24px_80px_color-mix(in_srgb,var(--color-bg)_70%,transparent)]', className)}
            >
                <header className={cn('flex shrink-0 gap-4 border-b border-[var(--settings-divider)] px-4 py-3', descriptionMode === 'info' ? 'items-center' : 'items-start')}>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">{titleIcon ? <span className="inline-flex size-5 shrink-0 items-center justify-center">{titleIcon}</span> : null}<h2 id="settings-dialog-title" className="text-[14px] font-semibold tracking-[-0.01em]">{title}</h2>{description && descriptionMode === 'info' ? <SettingsInfoTooltip label={`About ${title}`}>{description}</SettingsInfoTooltip> : null}</div>
                        {description && descriptionMode === 'text' ? <p id="settings-dialog-description" className="mt-1 text-[12px] leading-5 text-[var(--settings-text-secondary)]">{description}</p> : null}
                    </div>
                    {headerAction ? <div className="ml-auto shrink-0">{headerAction}</div> : null}
                    <button type="button" onClick={onClose} aria-label="Close dialog" className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-[var(--settings-text-muted)] transition-colors hover:bg-[var(--settings-control-hover)] hover:text-[var(--settings-text)]">
                        <X size={14} />
                    </button>
                </header>
                <div className={cn('min-h-0 overflow-y-auto space-y-3 px-4 py-3', contentClassName)}>{children}</div>
                {footer ? <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--settings-divider)] px-4 py-2.5">{footer}</footer> : null}
            </section>
        </div>,
        document.body
    )
}

// Compatibility name for existing setting-choice callers.
export { SettingsChoiceDropdown as SettingsSegmented } from './SettingsChoiceDropdown'

export function SettingResetButton({ label, onClick }: { label: string; onClick: () => void }) {
    return (
        <button type="button" aria-label={`Reset ${label}`} title="Reset to default" onClick={onClick} className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-[var(--settings-text-muted)] hover:bg-[var(--settings-control-hover)] hover:text-[var(--settings-text)]">
            <Undo2 size={12} />
        </button>
    )
}

export function SettingsNotice({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'error' | 'warning' | 'success'; className?: string }) {
    return (
        <div className={cn(
            'rounded-lg px-3 py-2 text-xs leading-5',
            tone === 'neutral' && 'border border-[var(--settings-border)] bg-[var(--settings-control)] text-[var(--settings-text-secondary)]',
            tone === 'error' && 'bg-red-500/[0.08] text-red-200',
            tone === 'warning' && 'bg-amber-500/[0.08] text-amber-100',
            tone === 'success' && 'bg-emerald-500/[0.08] text-emerald-200',
            className
        )}>{children}</div>
    )
}
