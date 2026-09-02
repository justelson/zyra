import { Loader2, Wifi, WifiOff } from 'lucide-react'
import type { AssistantActivity } from '@shared/assistant/contracts'
import { cn } from '@/lib/utils'
import { isAssistantConnectionRecoveryActivity } from './assistant-timeline-helpers'

export function AssistantTimelineNetworkRecovery({ activity }: { activity: AssistantActivity }) {
    if (!isAssistantConnectionRecoveryActivity(activity)) return null

    const status = String(activity.payload?.['status'] || '').toLowerCase()
    const retrying = status === 'retrying'
    const paused = status === 'paused'
    const Icon = retrying ? Loader2 : paused ? WifiOff : Wifi

    return (
        <div
            className={cn(
                'flex min-h-7 items-center gap-2 py-0.5 text-[11px] font-medium',
                paused ? 'text-amber-200/70' : retrying ? 'text-amber-100/65' : 'text-emerald-200/55'
            )}
            role="status"
            aria-live="polite"
            data-assistant-network-recovery={status || 'unknown'}
        >
            <Icon size={12} className={cn('shrink-0', retrying && 'animate-spin')} aria-hidden="true" />
            <span className="truncate">{activity.summary}</span>
            <span className="h-px min-w-6 flex-1 bg-white/[0.055]" aria-hidden="true" />
        </div>
    )
}
