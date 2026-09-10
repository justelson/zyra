import { memo } from 'react'
import { Check, Loader2, RotateCw, SendHorizontal, Square } from 'lucide-react'
import { cn } from '@/lib/utils'

export const ComposerSendButton = memo(({
    disabled,
    isConnected,
    isThinking,
    canSend,
    label = 'Send',
    reconnectPending = false,
    onStop,
    onReconnect,
    onSend
}: {
    disabled: boolean
    isConnected: boolean
    isThinking: boolean
    canSend: boolean
    label?: string
    reconnectPending?: boolean
    onStop?: () => Promise<void> | void
    onReconnect?: () => Promise<void> | void
    onSend: () => void
}) => {
    const canStop = isThinking && Boolean(onStop) && isConnected && !disabled
    const canReconnect = !isConnected && Boolean(onReconnect)
    const isEmptyState = !canStop && !disabled && isConnected && !canSend
    const isDisabled = canStop || canReconnect ? false : disabled || !isConnected || !canSend

    return (
        <button
            type="button"
            disabled={isDisabled}
            onClick={() => {
                if (canStop) {
                    void onStop?.()
                    return
                }
                if (canReconnect) {
                    void onReconnect?.()
                    return
                }
                onSend()
            }}
            title={canReconnect ? 'Reconnect assistant' : undefined}
            className={cn(
                'relative inline-flex h-[36px] items-center justify-center overflow-hidden rounded-full border transition-all duration-150',
                label === 'Send' || canReconnect ? 'w-[36px]' : 'gap-1.5 px-3.5',
                canStop
                    ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--accent-contrast)] hover:scale-[1.03] hover:bg-[color-mix(in_srgb,var(--accent-primary)_88%,var(--color-text))]'
                    : canReconnect
                        ? 'border-white/10 bg-white/[0.045] text-sparkle-text-secondary hover:scale-[1.03] hover:border-white/20 hover:bg-white/[0.075] hover:text-sparkle-text'
                    : isEmptyState
                        ? 'border-transparent bg-white/[0.02] text-sparkle-text-muted/80 hover:border-transparent hover:bg-white/[0.03]'
                        : isDisabled
                        ? 'border-transparent bg-white/[0.015] text-sparkle-text-muted/45 opacity-70'
                        : 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--accent-contrast)] hover:scale-[1.03] hover:bg-[color-mix(in_srgb,var(--accent-primary)_88%,var(--color-text))]'
            )}
        >
            {canStop ? <span className="absolute inset-0 animate-shimmer opacity-60" aria-hidden="true" /> : null}
            <span className="relative z-10 inline-flex items-center justify-center gap-1.5">
                {canStop ? (
                    <Square size={15} fill="currentColor" />
                ) : canReconnect ? (
                    reconnectPending ? <Loader2 size={17} className="animate-spin" /> : <RotateCw size={17} />
                ) : label === 'Send' ? (
                    <SendHorizontal size={18} className={isEmptyState ? 'opacity-35' : undefined} />
                ) : (
                    <>
                        <Check size={16} />
                        <span className="text-[12px] font-semibold">{label}</span>
                    </>
                )}
            </span>
        </button>
    )
})
