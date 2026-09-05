import { memo } from 'react'
import { MousePointer2 } from 'lucide-react'
import type { ControlCursorState } from '@shared/agent-control/contracts'
import { cn } from '@/lib/utils'

function cursorLabel(cursor: ControlCursorState): string {
    if (cursor.principal?.type === 'agent') return 'Agent'
    return 'Zyra'
}

export const AssistantBrowserAgentCursor = memo(function AssistantBrowserAgentCursor({ cursor, scale = 1 }: {
    cursor: ControlCursorState | null
    scale?: number
}) {
    if (!cursor?.visible) return null
    const movementDurationMs = Math.max(90, Math.min(320, cursor.durationMs || 110))
    return (
        <div className="pointer-events-none absolute inset-0 z-[26] overflow-hidden" aria-label={`${cursorLabel(cursor)} Browser cursor`}>
            <div
                className="absolute left-0 top-0 transition-transform will-change-transform motion-reduce:transition-none"
                style={{
                    transform: `translate3d(${cursor.x * scale}px, ${cursor.y * scale}px, 0)`,
                    transitionDuration: `${movementDurationMs}ms`,
                    transitionTimingFunction: 'cubic-bezier(0.2, 0.7, 0.2, 1)'
                }}
            >
                <span
                    aria-hidden="true"
                    className={cn(
                        'relative block -translate-x-1 -translate-y-1 origin-[4px_4px] text-[var(--accent-secondary)] transition-transform duration-100 motion-reduce:transition-none',
                        cursor.phase === 'pressing' && 'scale-[0.92]',
                        cursor.phase === 'dragging' && 'scale-[1.03]'
                    )}
                    style={{
                        filter: 'drop-shadow(0 1px 2px rgb(0 0 0 / 0.72)) drop-shadow(0 0 5px color-mix(in srgb, var(--accent-primary) 38%, transparent))'
                    }}
                >
                    <MousePointer2 size={24} strokeWidth={2} fill="none" className="block" />
                </span>
            </div>
        </div>
    )
})
