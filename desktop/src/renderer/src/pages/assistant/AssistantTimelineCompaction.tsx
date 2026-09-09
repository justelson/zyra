import { AlignVerticalSpaceAround, AlertCircle, Check, Minus } from 'lucide-react'
import type { AssistantActivity } from '@shared/assistant/contracts'
import { cn } from '@/lib/utils'
import { getContextCompactionStatus } from './assistant-timeline-helpers'

export function TimelineContextCompactionMarker({ activity }: { activity: AssistantActivity }) {
    const status = getContextCompactionStatus(activity)
    const running = status === 'running'
    const label = running ? 'Compacting context'
        : status === 'cancelled' ? 'Context compaction cancelled'
            : status === 'failed' ? 'Context compaction failed' : 'Context compacted'
    const Icon = running ? AlignVerticalSpaceAround : status === 'failed' ? AlertCircle : status === 'cancelled' ? Minus : Check

    return (
        <div className="max-w-4xl py-0.5" data-assistant-compaction={status} role="status" aria-live="polite">
            <div className={cn(
                'flex min-h-7 items-center gap-2 text-[11px] text-sparkle-text-muted',
                status === 'failed' && 'text-[var(--status-danger)]',
                status === 'cancelled' && 'text-[var(--status-warning)]'
            )}>
                <Icon size={12} className="shrink-0 opacity-60" aria-hidden="true" />
                <span className={cn('min-w-0 font-medium', running && 'assistant-title-shimmer assistant-compaction-shimmer')}>{label}</span>
                <span className="h-px min-w-4 flex-1 bg-[var(--surface-divider)]" aria-hidden="true" />
            </div>
        </div>
    )
}
