import { ChevronLeft, ChevronRight } from 'lucide-react'
import { SettingsButton } from './settings-layout'

export function SettingsListPagination({ page, pageCount, start, end, total, onPageChange }: {
    page: number; pageCount: number; start: number; end: number; total: number
    onPageChange: (page: number) => void
}) {
    if (pageCount <= 1) return null
    return <div className="flex items-center justify-between gap-3 border-t border-[var(--settings-row-divider)] px-4 py-2 text-[11px] text-[var(--settings-text-muted)]">
        <span>{start}–{end} of {total}</span>
        <div className="flex items-center gap-1">
            <SettingsButton variant="ghost" disabled={page === 0} aria-label="Previous page" onClick={() => onPageChange(page - 1)}><ChevronLeft size={13} /></SettingsButton>
            <SettingsButton variant="ghost" disabled={page + 1 >= pageCount} aria-label="Next page" onClick={() => onPageChange(page + 1)}><ChevronRight size={13} /></SettingsButton>
        </div>
    </div>
}
