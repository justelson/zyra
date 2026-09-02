import { createContext, useContext, useEffect } from 'react'
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, Undo2, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { createSettingsRowTargetId, createSettingsSectionTargetId } from './settings-search'

const SettingsSearchSectionContext = createContext<string | null>(null)

export function SettingsPageContainer({ children, className, title, backTo, backLabel }: {
    children: ReactNode
    className?: string
    title?: string
    backTo?: string
    backLabel?: string
}) {
    return (
        <div className="zyra-settings-page-container flex w-full min-w-0 justify-center px-5 pb-16 pt-8 sm:px-10 sm:pt-10">
            <div className={cn('zyra-settings-page-column flex w-full max-w-[680px] flex-col', title ? 'gap-8' : 'gap-10', className)}>
                {title ? (
                    <header className="px-0.5">
                        {backTo ? (
                            <Link to={backTo} className="mb-2 inline-flex h-6 items-center gap-0.5 text-[11px] font-medium text-[var(--settings-text-muted)] transition-colors hover:text-[var(--settings-text)]">
                                <ChevronLeft size={13} strokeWidth={1.8} />
                                {backLabel || 'Settings'}
                            </Link>
                        ) : null}
                        <h1 className="text-[24px] font-medium tracking-[-0.025em] text-[var(--settings-text)]">{title}</h1>
                    </header>
                ) : null}
                {children}
            </div>
        </div>
    )
}

export function SettingsSection({ title, headerAction, children, className }: {
    title: string
    headerAction?: ReactNode
    children: ReactNode
    className?: string
}) {
    const searchTargetId = createSettingsSectionTargetId(title)
    return (
        <section
            className={cn('space-y-2.5 [content-visibility:auto] [contain-intrinsic-size:auto_220px]', className)}
            data-settings-search-target={searchTargetId}
            tabIndex={-1}
        >
            <div className="flex min-h-7 items-center justify-between gap-4 px-1">
                <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-[var(--settings-text)]">{title}</h2>
                <div className="flex min-h-7 items-center justify-end">{headerAction}</div>
            </div>
            <SettingsSearchSectionContext.Provider value={title}>
                <div className="zyra-settings-section-body relative overflow-visible rounded-xl border border-[var(--settings-border)] bg-[var(--settings-section)] text-[var(--settings-text)] shadow-[inset_0_1px_0_var(--settings-section-highlight)]">{children}</div>
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

export function SettingsRow({ title, description, status, statusTone = 'muted', statusTitle, resetAction, control, children, className, searchTargetId: explicitSearchTargetId, ...props }: Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
    title: ReactNode
    description: ReactNode
    status?: ReactNode
    statusTone?: SettingsStatusTone
    statusTitle?: string
    resetAction?: ReactNode
    control?: ReactNode
    children?: ReactNode
    searchTargetId?: string
}) {
    const sectionTitle = useContext(SettingsSearchSectionContext)
    const searchTargetId = explicitSearchTargetId || (typeof title === 'string' ? createSettingsRowTargetId(sectionTitle, title) : null)
    return (
        <div
            {...props}
            data-settings-search-target={searchTargetId || undefined}
            tabIndex={searchTargetId ? -1 : props.tabIndex}
            className={cn('zyra-settings-row px-4 transition-colors duration-100 hover:bg-[var(--settings-row-hover)] [content-visibility:auto] [contain-intrinsic-size:auto_68px]', children ? 'pb-2.5 pt-3.5' : 'py-3.5', className)}
        >
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
                <div className="min-w-0 space-y-1">
                    <div className="flex min-h-5 min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                        <h3 className="min-w-0 text-[13px] font-medium tracking-[-0.003em] text-[var(--settings-text)]">{title}</h3>
                        {status ? <SettingsStatusPill label={status} tone={statusTone} title={statusTitle ?? (typeof status === 'string' ? status : undefined)} /> : null}
                        {resetAction ? <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">{resetAction}</span> : null}
                    </div>
                    <p className="max-w-[34rem] text-[12px] leading-[1.5] text-[var(--settings-text-secondary)]">{description}</p>
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

export function SettingsDialog({ open, title, description, children, footer, className, contentClassName, onClose }: {
    open: boolean
    title: string
    description?: string
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
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
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
                aria-describedby={description ? 'settings-dialog-description' : undefined}
                className={cn('flex max-h-[calc(100vh-2.5rem)] w-full max-w-[480px] flex-col overflow-hidden rounded-xl border border-[var(--settings-border-strong)] bg-[var(--settings-popover)] text-[var(--settings-text)] shadow-[0_24px_80px_color-mix(in_srgb,var(--color-bg)_70%,transparent)]', className)}
            >
                <header className="flex shrink-0 items-start gap-4 border-b border-[var(--settings-divider)] px-4 py-3">
                    <div className="min-w-0 flex-1">
                        <h2 id="settings-dialog-title" className="text-[14px] font-semibold tracking-[-0.01em]">{title}</h2>
                        {description ? <p id="settings-dialog-description" className="mt-1 text-[12px] leading-5 text-[var(--settings-text-secondary)]">{description}</p> : null}
                    </div>
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

export function SettingsSegmented<T extends string>({ value, options, onChange, label, disabled = false }: {
    value: T
    options: ReadonlyArray<{ value: T; label: string }>
    onChange: (value: T) => void
    label: string
    disabled?: boolean
}) {
    return (
        <div className={cn('inline-flex rounded-md border border-[var(--settings-border)] bg-[var(--settings-control)] p-0.5', disabled && 'opacity-55')} role="group" aria-label={label} aria-disabled={disabled || undefined}>
            {options.map((option) => (
                <button
                    key={option.value}
                    type="button"
                    disabled={disabled}
                    onClick={() => onChange(option.value)}
                    className={cn('h-6 rounded px-2 text-[11px] font-medium transition-colors disabled:cursor-not-allowed', value === option.value ? 'bg-[var(--settings-active)] text-[var(--settings-text)]' : 'text-[var(--settings-text-muted)] hover:bg-[var(--settings-nav-hover)] hover:text-[var(--settings-text)]')}
                >
                    {option.label}
                </button>
            ))}
        </div>
    )
}

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
