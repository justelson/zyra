import { Check, Loader2, MessageCircle, Wifi, WifiOff } from 'lucide-react'
import type { AssistantActivity } from '@shared/assistant/contracts'
import { cn } from '@/lib/utils'
import { isAssistantConnectionRecoveryActivity } from './assistant-timeline-helpers'
import { ASSISTANT_ACTION_ICON_CLASS, ASSISTANT_ACTION_ROW_CLASS } from './assistant-action-row-layout'

export function AssistantTimelineNetworkRecovery({ activity }: { activity: AssistantActivity }) {
    if (!isAssistantConnectionRecoveryActivity(activity)) return null

    const status = String(activity.payload?.['status'] || '').toLowerCase()
    const retrying = status === 'retrying'
    const paused = status === 'paused'
    const network = activity.kind === 'connection.recovery' || activity.payload?.recoveryKind === 'network'
    const Icon = retrying ? Loader2 : activity.kind === 'model.ping' ? MessageCircle : network ? (paused ? WifiOff : Wifi) : Check

    return (
        <div
            className={cn(
                ASSISTANT_ACTION_ROW_CLASS, 'text-[12px] font-medium leading-5',
                'motion-safe:transition-colors motion-safe:duration-150',
                paused ? 'text-amber-200/70' : retrying ? 'text-sparkle-text-secondary' : 'text-sparkle-text-muted'
            )}
            role="status"
            aria-live="polite"
            data-assistant-network-recovery={status || 'unknown'}
        >
            <span className={ASSISTANT_ACTION_ICON_CLASS} data-assistant-action-icon="true"><Icon size={13} className={cn(retrying && 'motion-safe:animate-spin')} aria-hidden="true" /></span>
            <span className="truncate" data-assistant-action-title="true">{activity.summary}</span>
            <span className="h-px min-w-6 flex-1 bg-white/[0.055]" aria-hidden="true" />
        </div>
    )
}
