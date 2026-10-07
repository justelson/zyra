import { useLayoutEffect, useState, type RefObject } from 'react'
import { NativeOverlayPortal } from '@/components/ui/native-overlay-portal'
import { observeAssistantBrowserSlotGeometry } from './assistant-browser-slot-geometry'

export function BrowserLinkHoverStatus({ url, slot }: { url: string; slot: RefObject<HTMLDivElement | null> }) {
    const [bounds, setBounds] = useState<{ left: number; bottom: number; width: number } | null>(null)
    useLayoutEffect(() => {
        const host = slot.current
        if (!host || !url) return
        const update = () => {
            const rect = host.getBoundingClientRect()
            setBounds({ left: rect.left + 8, bottom: window.innerHeight - rect.bottom + 8, width: Math.max(0, rect.width - 16) })
        }
        update()
        return observeAssistantBrowserSlotGeometry(host, update)
    }, [url, slot])
    if (!url || !bounds || bounds.width <= 0) return null
    return <NativeOverlayPortal passive><div data-browser-link-hover="" className="pointer-events-none fixed z-[9999] truncate rounded-md border border-white/10 bg-sparkle-card/95 px-2 py-1 text-[11px] text-sparkle-text-secondary shadow-lg backdrop-blur-sm" style={{ left: bounds.left, bottom: bounds.bottom, maxWidth: Math.min(bounds.width, 640) }}>{url}</div></NativeOverlayPortal>
}
