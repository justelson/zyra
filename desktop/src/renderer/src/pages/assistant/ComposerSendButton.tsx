import { memo } from 'react'
import { Check, Loader2, RotateCw, SendHorizontal, Square } from 'lucide-react'
import { cn } from '@/lib/utils'

export const ComposerSendButton = memo(({
    disabled,
    isConnected,
    isThinking,
    isStopping = false,
    canSend,
    canContinue = false,
    onContinue,
    label = 'Send',
    reconnectPending = false,
    onStop,
    onReconnect,
    onSend
}: {
    disabled: boolean
    isConnected: boolean
    isThinking: boolean
    isStopping?: boolean
    canSend: boolean
    canContinue?: boolean
    onContinue?: () => void
    label?: string
    reconnectPending?: boolean
    onStop?: () => Promise<void> | void
    onReconnect?: () => Promise<void> | void
    onSend: () => void
}) => {
    const canStop = (isStopping || (isThinking && !canSend)) && Boolean(onStop) && isConnected
    const canReconnect = !isConnected && Boolean(onReconnect)
    const canResume = canContinue && Boolean(onContinue) && !isThinking && !canSend && isConnected
    const isEmptyState = !canStop && !canResume && !disabled && isConnected && !canSend
    const isDisabled = canStop || canReconnect ? false : disabled || !isConnected || (!canSend && !canResume)

    return (
        <button
            type="button"
            data-shortcut-command={canStop ? 'app.stopTurn' : undefined}
            disabled={isStopping || isDisabled}
            aria-label={isStopping ? 'Stopping current turn' : canStop ? 'Stop current turn' : canReconnect ? 'Reconnect assistant' : canResume ? 'Continue response' : label}
            aria-busy={isStopping}
            onClick={() => {
                if (canStop) {
                    void onStop?.()
                    return
                }
                if (canReconnect) {
                    void onReconnect?.()
                    return
                }
                if (canResume) { onContinue?.(); return }
                onSend()
            }}
            title={isStopping ? 'Stopping… Your draft and queue stay saved.' : canStop ? 'Stop current turn and hold queued messages' : canReconnect ? 'Reconnect assistant' : canResume ? 'Continue response; queued messages stay held' : label}
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
            <span className="relative z-10 inline-flex items-center justify-center gap-1.5">
                {isStopping ? (
                    <Loader2 size={15} className="animate-spin motion-reduce:animate-none" />
                ) : canStop ? (
                    <Square size={15} fill="currentColor" />
                ) : canReconnect ? (
                    reconnectPending ? <Loader2 size={17} className="animate-spin" /> : <RotateCw size={17} />
                ) : canResume ? (
                    <RotateCw size={17} />
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
