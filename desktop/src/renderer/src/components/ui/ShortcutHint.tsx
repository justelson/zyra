import { useLayoutEffect, useRef, useState } from 'react'
import type { CommandId, ShortcutPlatform } from '@shared/keybindings'
import { ShortcutKeycaps } from './ShortcutKeycaps'

/** Fixed passive content never changes the annotated control's layout or focus. */
export function ShortcutHint({ id, binding, platform, left, anchorLeft, top }: { id: CommandId; binding: string; platform: ShortcutPlatform; left: number; anchorLeft?: number; top: number }) {
    const ref = useRef<HTMLSpanElement>(null)
    const [width, setWidth] = useState(0)
    useLayoutEffect(() => { setWidth(ref.current?.getBoundingClientRect().width || 0) }, [binding, platform])
    return <span ref={ref} aria-hidden="true" data-shortcut-hint={id} className="pointer-events-none fixed z-[240] inline-flex max-w-[240px] rounded-md border border-[var(--surface-divider)] bg-[var(--surface-floating)] px-1 py-1 shadow-lg" style={{ left: Math.max(4, Math.min(left + width > window.innerWidth - 4 && anchorLeft !== undefined ? anchorLeft - width - 4 : left, window.innerWidth - width - 4)), top: Math.max(4, Math.min(top, window.innerHeight - 32)), pointerEvents: 'none' }}>
        <ShortcutKeycaps id={id} platform={platform} overrides={{ [id]: [binding] }} />
    </span>
}
