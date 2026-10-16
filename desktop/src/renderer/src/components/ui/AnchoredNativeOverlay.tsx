import { useCallback, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { NativeOverlayPortal, registerOverlayAnchor } from './native-overlay-portal'
import type { NativeOverlayBounds } from '@shared/contracts/native-overlay'
import { getOverlayOwnerRect } from './native-overlay-events'

/** Keeps an inline overlay's original containing block when it moves to the native layer. */
export function AnchoredNativeOverlay({ children, anchorRef, inputRegionRef, enabled = true, passive = false, scoped = false, autoFocus = true, onReady }: {
    children: ReactNode
    enabled?: boolean
    passive?: boolean
    /** Restrict native input interception to the anchor instead of the whole app. */
    scoped?: boolean
    autoFocus?: boolean
    onReady?: (container: HTMLElement) => void
    anchorRef?: RefObject<HTMLElement | null>
    /** Crop native input to this popup's rendered box while leaving the app clickable. */
    inputRegionRef?: RefObject<HTMLElement | null>
}) {
    const marker = useRef<HTMLSpanElement>(null)
    const releaseAnchor = useRef<(() => void) | undefined>(undefined)
    const portalRef = useCallback((node: HTMLDivElement | null) => {
        releaseAnchor.current?.()
        releaseAnchor.current = node && marker.current ? registerOverlayAnchor(marker.current, node) : undefined
    }, [])
    const [bounds, setBounds] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
    const [inputBounds, setInputBounds] = useState<NativeOverlayBounds | null>(null)
    const updateInputBounds = useCallback((next: NativeOverlayBounds) => {
        setInputBounds(current => current?.x === next.x && current?.y === next.y && current?.width === next.width && current?.height === next.height ? current : next)
    }, [])
    useLayoutEffect(() => {
        if (!enabled) return
        let anchor = anchorRef?.current || marker.current?.parentElement || null
        const ownerWindow = anchor?.ownerDocument.defaultView
        if (!anchor || !ownerWindow) return
        if (!anchorRef) {
            while (anchor.parentElement && ownerWindow.getComputedStyle(anchor).position === 'static') anchor = anchor.parentElement
        }
        const target = anchor
        let frame = 0
        const update = () => {
            const rect = getOverlayOwnerRect(target)
            const next = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
            setBounds(current => current?.left === next.left && current?.top === next.top && current?.width === next.width && current?.height === next.height ? current : next)
        }
        const trackMotion = () => {
            update()
            let element: HTMLElement | null = target
            let moving = false
            while (element) {
                moving ||= element.getAnimations().some(animation => animation.playState === 'running' && Number.isFinite(animation.effect?.getComputedTiming().endTime))
                element = element.parentElement
            }
            frame = moving ? ownerWindow.requestAnimationFrame(trackMotion) : 0
        }
        const invalidate = () => { if (!frame) frame = ownerWindow.requestAnimationFrame(trackMotion) }
        const observer = new ResizeObserver(invalidate)
        observer.observe(target)
        target.ownerDocument.addEventListener('scroll', invalidate, true)
        target.ownerDocument.addEventListener('transitionrun', invalidate, true)
        target.ownerDocument.addEventListener('animationstart', invalidate, true)
        ownerWindow.addEventListener('resize', invalidate)
        update()
        invalidate()
        return () => {
            observer.disconnect()
            ownerWindow.cancelAnimationFrame(frame)
            target.ownerDocument.removeEventListener('scroll', invalidate, true)
            target.ownerDocument.removeEventListener('transitionrun', invalidate, true)
            target.ownerDocument.removeEventListener('animationstart', invalidate, true)
            ownerWindow.removeEventListener('resize', invalidate)
        }
    }, [anchorRef, enabled])
    if (!enabled) return <>{children}</>
    return <>
        <span ref={marker} hidden aria-hidden="true" />
        {bounds && <NativeOverlayPortal bounds={inputRegionRef ? inputBounds ?? { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height } : scoped ? { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height } : null} passive={passive} autoFocus={autoFocus} onReady={onReady}><div ref={portalRef} style={{ position: 'fixed', pointerEvents: 'none', ...bounds }}><div style={{ display: 'contents', pointerEvents: 'auto' }}>{children}</div>{inputRegionRef && <MeasuredInputRegion regionRef={inputRegionRef} anchorBounds={bounds} onBounds={updateInputBounds} />}</div></NativeOverlayPortal>}
    </>
}

function MeasuredInputRegion({ regionRef, anchorBounds, onBounds }: {
    regionRef: RefObject<HTMLElement | null>
    anchorBounds: { left: number; top: number }
    onBounds: (bounds: NativeOverlayBounds) => void
}) {
    useLayoutEffect(() => {
        const region = regionRef.current
        const anchor = region?.parentElement?.parentElement
        if (!region || !anchor) return
        const update = () => {
            const rect = region.getBoundingClientRect(), origin = anchor.getBoundingClientRect()
            // Both boxes share the native crop translation, so their difference remains
            // in owner-window coordinates as the WebContentsView moves or resizes.
            onBounds({ x: anchorBounds.left + rect.left - origin.left, y: anchorBounds.top + rect.top - origin.top, width: rect.width, height: rect.height })
        }
        const observer = new ResizeObserver(update)
        observer.observe(region)
        const position = new MutationObserver(update)
        position.observe(region, { attributes: true, attributeFilter: ['style', 'class'] })
        update()
        return () => { observer.disconnect(); position.disconnect() }
    }, [regionRef, anchorBounds.left, anchorBounds.top, onBounds])
    return null
}
