import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react'
import { getOverlayOwnerRect } from './native-overlay-events'

export function useAnchoredMenuBounds(trigger: RefObject<HTMLElement | null>, open: boolean, preferredWidth: number, preferredHeight?: number) {
    const [bounds, setBounds] = useState<CSSProperties>({ width: preferredWidth, height: preferredHeight })
    useLayoutEffect(() => {
        const target = trigger.current
        if (!open || !target) return
        const update = () => {
            const anchor = getOverlayOwnerRect(target)
            const width = Math.min(preferredWidth, Math.max(0, window.innerWidth - 16))
            const left = Math.max(8 - anchor.left, Math.min(0, window.innerWidth - 8 - anchor.left - width))
            const below = window.innerHeight - anchor.bottom - 14, above = anchor.top - 14
            const up = below < (preferredHeight ?? 180) && above > below
            const maxHeight = Math.max(0, Math.min(window.innerHeight * .75, up ? above : below))
            const next = { width, left, top: up ? undefined : anchor.height + 6, bottom: up ? anchor.height + 6 : undefined, maxHeight, height: preferredHeight === undefined ? undefined : Math.min(preferredHeight, maxHeight) }
            setBounds(current => JSON.stringify(current) === JSON.stringify(next) ? current : next)
        }
        update()
        window.addEventListener('resize', update)
        const owner = target.ownerDocument
        owner.addEventListener('scroll', update, true)
        const observer = new ResizeObserver(update)
        observer.observe(target)
        return () => { observer.disconnect(); window.removeEventListener('resize', update); owner.removeEventListener('scroll', update, true) }
    }, [open, preferredWidth, preferredHeight, trigger])
    return bounds
}
