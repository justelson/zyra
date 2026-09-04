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
    const active = cursor.phase !== 'idle'
    return (
        <div className="pointer-events-none absolute inset-0 z-[26] overflow-hidden" aria-label={`${cursorLabel(cursor)} Browser cursor`}>
            <div
                className="absolute left-0 top-0 transition-transform ease-out will-change-transform motion-reduce:transition-none"
                style={{
                    transform: `translate3d(${cursor.x * scale}px, ${cursor.y * scale}px, 0)`,
                    transitionDuration: `${Math.max(0, Math.min(600, cursor.durationMs || 0))}ms`
                }}
            >
                <span className={cn(
                    'absolute -left-2.5 -top-2.5 size-5 rounded-full border border-[color-mix(in_srgb,var(--accent-secondary)_48%,transparent)] bg-[color-mix(in_srgb,var(--accent-primary)_8%,transparent)] shadow-[0_0_16px_color-mix(in_srgb,var(--accent-primary)_20%,transparent)] transition-[transform,background-color] duration-100 motion-reduce:transition-none',
                    active ? 'scale-100' : 'scale-75 opacity-70',
                    cursor.phase === 'pressing' && 'scale-125 bg-[color-mix(in_srgb,var(--accent-primary)_26%,transparent)]',
                    cursor.phase === 'dragging' && 'scale-110 bg-[color-mix(in_srgb,var(--accent-primary)_20%,transparent)]'
                )} />
                <MousePointer2 size={19} strokeWidth={2.2} className="relative -translate-x-[2px] -translate-y-[2px] fill-[var(--accent-secondary)] text-[#07111f] drop-shadow-[0_1px_3px_rgba(0,0,0,0.78)]" />
                <span className="absolute left-3 top-3 inline-flex h-5 items-center whitespace-nowrap rounded-md border border-[var(--surface-divider)] bg-[color-mix(in_srgb,var(--surface-floating)_94%,transparent)] px-1.5 text-[9px] font-semibold tracking-[-0.005em] text-sparkle-text shadow-[0_8px_24px_color-mix(in_srgb,var(--color-bg)_45%,transparent),inset_2px_0_0_var(--accent-primary)] backdrop-blur-md">
                    {cursorLabel(cursor)}{active ? ` · ${cursor.phase}` : ''}
                </span>
            </div>
        </div>
    )
})
