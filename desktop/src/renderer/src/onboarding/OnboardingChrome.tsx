import { Copy, Minus, Square, X } from 'lucide-react'
import type { CSSProperties } from 'react'
import { useWindowChrome } from '@/lib/useWindowChrome'
import { cn } from '@/lib/utils'
import { DevChannelLabel } from '@/components/layout/DevChannelLabel'

export function OnboardingChrome({ reviewActive = false, onExitReview }: {
    reviewActive?: boolean
    onExitReview?: () => void
}) {
    const { runtime, policy, isMaximized } = useWindowChrome()
    const draggable = runtime.platform !== 'browser'
    return (
        <header
            className={cn(
                'fixed inset-x-0 top-0 z-50 flex h-[34px] items-center px-3 text-[12px] text-sparkle-text-secondary',
                policy.reserveMacTrafficLights && 'pl-[78px]'
            )}
            style={{ WebkitAppRegion: draggable ? 'drag' : undefined } as CSSProperties}
        >
            <DevChannelLabel />
            <div className="flex-1" />
            {reviewActive && onExitReview ? (
                <button
                    type="button"
                    onClick={onExitReview}
                    className="mr-2 h-7 rounded-md px-2.5 text-[11px] font-medium text-sparkle-text-secondary transition-colors hover:bg-[var(--surface-hover)] hover:text-sparkle-text"
                    style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
                >
                    Exit review
                </button>
            ) : null}
            {policy.customWindowControls ? (
                <div className="-mr-3 flex h-full" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
                    <button type="button" onClick={() => window.devscope.window.minimize()} aria-label="Minimize Zyra" className="inline-flex h-full w-11 items-center justify-center text-sparkle-text-muted hover:bg-[var(--surface-hover)] hover:text-sparkle-text"><Minus size={14} /></button>
                    <button type="button" onClick={() => window.devscope.window.maximize()} aria-label={isMaximized ? 'Restore Zyra' : 'Maximize Zyra'} className="inline-flex h-full w-11 items-center justify-center text-sparkle-text-muted hover:bg-[var(--surface-hover)] hover:text-sparkle-text">{isMaximized ? <Copy size={12} /> : <Square size={12} />}</button>
                    <button type="button" onClick={() => window.devscope.window.close()} aria-label="Close Zyra" className="inline-flex h-full w-11 items-center justify-center text-sparkle-text-muted hover:bg-red-500/80 hover:text-white"><X size={14} /></button>
                </div>
            ) : null}
        </header>
    )
}
