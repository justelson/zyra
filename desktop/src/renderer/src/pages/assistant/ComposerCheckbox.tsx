import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Compact themed checkbox. The native input retains keyboard and screen-reader behavior. */
export function ComposerCheckbox({ checked, onChange, label, ariaLabel, hint, disabled = false, className }: {
    checked: boolean
    onChange: (checked: boolean) => void
    label: string
    ariaLabel?: string
    hint?: string
    disabled?: boolean
    className?: string
}) {
    return <label title={hint} className={cn('inline-flex min-h-6 min-w-0 cursor-pointer items-center gap-1.5 text-[11px] leading-4 text-sparkle-text-secondary has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-45', className)}>
        <span className="relative inline-flex size-3.5 shrink-0 items-center justify-center">
            <input type="checkbox" aria-label={ariaLabel || label} checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} className="peer absolute inset-0 z-10 m-0 size-full cursor-inherit opacity-0" />
            <span data-composer-checkbox-mark aria-hidden="true" className="pointer-events-none inline-flex size-full items-center justify-center rounded-[4px] border border-[var(--surface-divider)] bg-[var(--surface-chrome)] text-[var(--accent-contrast)] transition-colors duration-100 peer-checked:border-[var(--accent-primary)] peer-checked:bg-[var(--accent-primary)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--accent-primary)] peer-enabled:peer-hover:border-[var(--accent-primary)] motion-reduce:transition-none">
                <Check size={10} strokeWidth={2.5} className={checked ? 'opacity-100' : 'opacity-0'} />
            </span>
        </span>
        <span className="min-w-0">{label}</span>
    </label>
}
