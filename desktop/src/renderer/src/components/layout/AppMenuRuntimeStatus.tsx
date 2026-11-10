import { Activity, ChevronRight, RotateCw } from 'lucide-react'
import type { useRuntimeConnection } from '@/lib/runtime-connection'

export function AppMenuRuntimeStatus({ connection, onSelect }: {
    connection: ReturnType<typeof useRuntimeConnection>
    onSelect: () => void
}) {
    const summary = connection.detail.split(' · ')[0].replace(/^Status /, '')
    const status = summary.charAt(0).toUpperCase() + summary.slice(1)
    return <div className="mb-1 border-b border-[var(--surface-divider)] pb-1">
        <button type="button" role="menuitem" aria-label="Agent status and updates"
            aria-description={`${connection.label} · ${connection.detail}`}
            title={[`${connection.label} · ${connection.detail}`, connection.message].filter(Boolean).join('\n')}
            onClick={onSelect}
            className="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] text-sparkle-text-secondary transition-colors hover:bg-[var(--surface-hover)] hover:text-sparkle-text focus-visible:bg-[var(--surface-hover)] focus-visible:outline-none">
            <span className="flex min-w-0 flex-1 items-center gap-3"><span className="inline-flex size-4 shrink-0 items-center justify-center"><Activity size={14} aria-hidden="true" /></span><span>Agent</span></span>
            <span className="flex min-w-0 items-center gap-1.5 text-[11px]" style={{ color: `var(--status-${connection.tone})` }}>
                <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
                <span className="truncate">{status}</span>
            </span>
            {connection.state.updatePending ? <RotateCw size={11} className="shrink-0 text-[var(--status-warning)]" role="img" aria-label="Agent update pending" /> : null}
            <ChevronRight size={12} className="-ml-1.5 shrink-0 text-sparkle-text-muted" aria-hidden="true" />
        </button>
    </div>
}
