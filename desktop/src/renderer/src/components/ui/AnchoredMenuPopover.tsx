import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { AnchoredNativeOverlay } from './AnchoredNativeOverlay'
import { addOverlayEventListener, isOverlayEventInside } from './native-overlay-events'
import { useAnchoredMenuBounds } from './useAnchoredMenuBounds'

/** A floating chooser with scoped native input, including when its trigger is in another popup. */
export function AnchoredMenuPopover({ anchorRef, contentRef, children, label, onClose, autoFocus = false }: {
    anchorRef: RefObject<HTMLElement | null>
    contentRef?: RefObject<HTMLDivElement | null>
    children: ReactNode
    label: string
    onClose: () => void
    autoFocus?: boolean
}) {
    const localRef = useRef<HTMLDivElement>(null)
    const menu = contentRef ?? localRef
    const bounds = useAnchoredMenuBounds(anchorRef, true, 320)
    useEffect(() => {
        const pointer = addOverlayEventListener('pointerdown', event => {
            if (!isOverlayEventInside(event, anchorRef.current, menu.current)) onClose()
        })
        const keyboard = addOverlayEventListener('keydown', event => {
            if (event.key !== 'Escape') return
            event.preventDefault(); event.stopImmediatePropagation()
            onClose(); anchorRef.current?.querySelector<HTMLElement>('button')?.focus()
            if (anchorRef.current?.tagName === 'BUTTON') anchorRef.current.focus()
        }, true)
        return () => { pointer(); keyboard() }
    }, [anchorRef, menu, onClose])
    return <AnchoredNativeOverlay anchorRef={anchorRef} inputRegionRef={menu} autoFocus={false} onReady={root => {
        if (autoFocus) root.querySelector<HTMLElement>('input,button')?.focus({ preventScroll: true })
    }}><div ref={menu} data-anchored-menu-popover role="menu" aria-label={label} style={bounds} className="absolute z-[170] overflow-auto rounded-lg border border-[var(--surface-divider)] bg-[var(--surface-floating)] p-1 text-sparkle-text shadow-xl">{children}</div></AnchoredNativeOverlay>
}
