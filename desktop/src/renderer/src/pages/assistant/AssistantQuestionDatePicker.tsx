import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { AnchoredMenuPopover } from '@/components/ui/AnchoredMenuPopover'
import { cn } from '@/lib/utils'
import { formatQuestionDate, parseQuestionDate, questionCalendarDate, questionCalendarDays, shiftQuestionMonth } from './assistant-question-date'

const fullDate = new Intl.DateTimeFormat(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
const shortDate = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
const monthName = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long' })

export function AssistantQuestionDatePicker({ value, label, disabled, onChange }: {
    value: string
    label: string
    disabled: boolean
    onChange: (value: string) => void
}) {
    const triggerRef = useRef<HTMLButtonElement>(null)
    const contentRef = useRef<HTMLDivElement>(null)
    const focusRequest = useRef<string | null>(null)
    const [open, setOpen] = useState(false)
    const [month, setMonth] = useState(() => parseQuestionDate(value) || new Date())
    const [focusedDay, setFocusedDay] = useState(() => formatQuestionDate(parseQuestionDate(value) || new Date()))
    const selected = parseQuestionDate(value)
    const today = formatQuestionDate(new Date())
    const days = useMemo(() => questionCalendarDays(month), [month])
    const close = useCallback(() => setOpen(false), [])
    useEffect(() => { if (disabled) close() }, [disabled, close])
    useLayoutEffect(() => {
        if (!focusRequest.current) return
        contentRef.current?.querySelector<HTMLButtonElement>(`[data-calendar-date="${focusRequest.current}"]`)?.focus()
        focusRequest.current = null
    }, [focusedDay, month])

    const choose = (next: string) => {
        onChange(next)
        close()
        triggerRef.current?.focus({ preventScroll: true })
    }
    const moveMonth = (offset: number) => {
        const next = shiftQuestionMonth(month, offset)
        if (next.getFullYear() < 1 || next.getFullYear() > 9999) return
        setMonth(next)
        setFocusedDay(formatQuestionDate(next))
    }
    const navigateDay = (event: KeyboardEvent<HTMLButtonElement>, date: Date) => {
        let next: Date
        if (event.key === 'ArrowLeft') next = questionCalendarDate(date.getFullYear(), date.getMonth(), date.getDate() - 1)
        else if (event.key === 'ArrowRight') next = questionCalendarDate(date.getFullYear(), date.getMonth(), date.getDate() + 1)
        else if (event.key === 'ArrowUp') next = questionCalendarDate(date.getFullYear(), date.getMonth(), date.getDate() - 7)
        else if (event.key === 'ArrowDown') next = questionCalendarDate(date.getFullYear(), date.getMonth(), date.getDate() + 7)
        else if (event.key === 'Home') next = questionCalendarDate(date.getFullYear(), date.getMonth(), date.getDate() - date.getDay())
        else if (event.key === 'End') next = questionCalendarDate(date.getFullYear(), date.getMonth(), date.getDate() + 6 - date.getDay())
        else if (event.key === 'PageUp') next = shiftQuestionMonth(date, event.shiftKey ? -12 : -1)
        else if (event.key === 'PageDown') next = shiftQuestionMonth(date, event.shiftKey ? 12 : 1)
        else return
        event.preventDefault()
        if (next.getFullYear() < 1 || next.getFullYear() > 9999) return
        const iso = formatQuestionDate(next)
        focusRequest.current = iso
        setFocusedDay(iso)
        setMonth(next)
    }

    return <>
        <button ref={triggerRef} type="button" data-question-date-picker data-date-value={value} aria-label={label} aria-haspopup="dialog" aria-expanded={open && !disabled} aria-invalid={Boolean(value && !selected)} disabled={disabled} onClick={() => {
            if (open) { close(); return }
            const next = selected || new Date()
            setMonth(next)
            setFocusedDay(formatQuestionDate(next))
            setOpen(true)
        }} className="inline-flex h-9 w-full items-center gap-2 rounded-md border border-[var(--surface-divider)] bg-white/[0.025] px-3 text-left text-[12px] text-sparkle-text-secondary outline-none transition-colors hover:bg-[var(--surface-hover)] focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)] disabled:opacity-40">
            <CalendarDays size={14} aria-hidden="true" className="shrink-0 text-sparkle-text-muted" />
            <span className="min-w-0 flex-1 truncate">{selected ? shortDate.format(selected) : value || 'Choose a date'}</span>
        </button>
        {open && !disabled ? <AnchoredMenuPopover anchorRef={triggerRef} contentRef={contentRef} role="dialog" label={`Choose date: ${label}`} width={280} preferredHeight={320} browserZIndex={180} autoFocus onClose={close}>
            <div data-question-calendar onKeyDown={event => event.stopPropagation()} className="p-1">
                <div className="mb-1 flex h-8 items-center gap-1">
                    <button type="button" aria-label="Previous month" disabled={month.getFullYear() === 1 && month.getMonth() === 0} onClick={() => moveMonth(-1)} className="inline-flex size-7 items-center justify-center rounded-md text-sparkle-text-muted hover:bg-[var(--surface-hover)] disabled:opacity-30"><ChevronLeft size={14} /></button>
                    <span aria-live="polite" className="min-w-0 flex-1 text-center text-[12px] font-medium text-sparkle-text">{monthName.format(month)}</span>
                    <button type="button" aria-label="Next month" disabled={month.getFullYear() === 9999 && month.getMonth() === 11} onClick={() => moveMonth(1)} className="inline-flex size-7 items-center justify-center rounded-md text-sparkle-text-muted hover:bg-[var(--surface-hover)] disabled:opacity-30"><ChevronRight size={14} /></button>
                </div>
                <div className="grid grid-cols-7 text-center text-[10px] text-sparkle-text-muted" aria-hidden="true">{['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => <span key={day} className="py-1">{day}</span>)}</div>
                <div role="group" aria-label="Calendar days" className="grid grid-cols-7 gap-0.5">
                    {days.map(date => {
                        const iso = formatQuestionDate(date)
                        return <button key={iso} type="button" data-calendar-date={iso} aria-label={fullDate.format(date)} aria-pressed={iso === value} aria-current={iso === today ? 'date' : undefined} tabIndex={iso === focusedDay ? 0 : -1} disabled={!parseQuestionDate(iso)} onClick={() => choose(iso)} onKeyDown={event => navigateDay(event, date)} className={cn('h-8 rounded-md text-[12px] tabular-nums outline-none transition-colors hover:bg-[var(--surface-hover)] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--accent-primary)] disabled:opacity-20', iso === value ? 'bg-[var(--accent-primary)] text-[var(--accent-contrast)] hover:bg-[var(--accent-primary)]' : date.getMonth() === month.getMonth() ? 'text-sparkle-text-secondary' : 'text-sparkle-text-muted opacity-40', iso === today && iso !== value && 'ring-1 ring-inset ring-[var(--surface-divider)]')}>{date.getDate()}</button>
                    })}
                </div>
                <div className="mt-2 flex items-center justify-between border-t border-[var(--surface-divider)] pt-1">
                    <button type="button" onClick={() => choose(formatQuestionDate(new Date()))} className="h-7 rounded-md px-2 text-[11px] text-sparkle-text-secondary hover:bg-[var(--surface-hover)]">Today</button>
                    <button type="button" disabled={!value} onClick={() => choose('')} className="h-7 rounded-md px-2 text-[11px] text-sparkle-text-muted hover:bg-[var(--surface-hover)] disabled:opacity-30">Clear date</button>
                </div>
            </div>
        </AnchoredMenuPopover> : null}
    </>
}
