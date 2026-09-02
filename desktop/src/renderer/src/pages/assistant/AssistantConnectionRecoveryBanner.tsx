import { Loader2, RotateCw, WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AssistantRecoveryIssue } from './assistant-runtime-recovery'

export function AssistantConnectionRecoveryBanner(props: {
    issue: AssistantRecoveryIssue
    reconnectPending: boolean
    reconnectAttempt: number
    reconnectMaxAttempts: number
    reconnectExhausted: boolean
    onReconnect: () => void
}) {
    const attempt = Math.max(1, props.reconnectAttempt)
    const label = props.reconnectPending
        ? `Reconnecting ${attempt} of ${props.reconnectMaxAttempts}`
        : props.reconnectExhausted
            ? 'Paused · Network issue'
            : 'Connection issue'

    return (
        <div className="px-4 py-1.5">
            <div
                className="mx-auto flex min-h-8 w-full max-w-3xl items-center gap-2 border-l-2 border-amber-300/45 bg-amber-500/[0.045] px-2.5 text-[11px] text-amber-100/85"
                role="status"
                aria-live="polite"
                aria-label={`${props.issue.title}: ${label}`}
            >
                {props.reconnectPending ? (
                    <Loader2 size={12} className="shrink-0 animate-spin text-amber-200/75" aria-hidden="true" />
                ) : (
                    <WifiOff size={12} className="shrink-0 text-amber-200/75" aria-hidden="true" />
                )}
                <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
                {props.reconnectPending ? null : (
                    <button
                        type="button"
                        onClick={props.onReconnect}
                        className={cn(
                            'inline-flex h-6 shrink-0 items-center gap-1 border border-white/10 bg-white/[0.025] px-2 text-[10px] font-medium text-sparkle-text transition-colors',
                            'hover:border-white/15 hover:bg-white/[0.05]'
                        )}
                    >
                        <RotateCw size={11} aria-hidden="true" />
                        <span>Try again</span>
                    </button>
                )}
            </div>
        </div>
    )
}
