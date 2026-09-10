import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'
const OPEN_MS = 580
const CLOSE_MS = 520
type InterruptedMotion = { shell: { transform: string; opacity: string }; tiles: Map<string, { rect: DOMRect; opacity: string }> }

/** Measure once, then move the shell and shared swatches using compositor transforms. */
export function useThemeBrowserMotion(dialogRef: RefObject<HTMLDialogElement | null>, anchor: HTMLDivElement, onClose: () => void) {
    const finishClose = useRef(onClose)
    finishClose.current = onClose
    const closing = useRef(false)
    const animations = useRef<Animation[]>([])
    const cleanupTiles = useRef<(() => void) | null>(null)
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const reduced = () => !!anchor.closest('[data-reduced-motion="true"]') || document.body.classList.contains('zyra-reduce-motion') || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const clearMotion = useCallback(() => {
        if (timer.current) clearTimeout(timer.current)
        animations.current.forEach(animation => animation.cancel())
        animations.current = []
        cleanupTiles.current?.()
        cleanupTiles.current = null
    }, [])

    const move = useCallback((out: boolean, interrupted?: InterruptedMotion) => {
        const dialog = dialogRef.current!
        const surface = dialog.querySelector<HTMLElement>('.onboarding-theme-browser-surface')!
        const layer = dialog.querySelector<HTMLElement>('.onboarding-theme-browser-shared')!
        const grid = dialog.querySelector<HTMLElement>('.onboarding-theme-browser-grid')!
        const frame = dialog.getBoundingClientRect()
        const compact = anchor.getBoundingClientRect()
        const gridRect = grid.getBoundingClientRect()
        // Read all source/target bounds before inserting or animating anything.
        const tiles = Array.from(anchor.querySelectorAll<HTMLElement>('.onboarding-theme-suggestions [data-theme-id]')).map(tile => {
            const match = grid.querySelector<HTMLElement>(`[data-theme-id="${tile.dataset.themeId}"]`)
            return { tile, match, compact: tile.getBoundingClientRect(), expanded: match?.getBoundingClientRect(), compactSwatchHeight: getComputedStyle(tile.querySelector('.onboarding-theme-swatch')!).height, expandedSwatchHeight: match ? getComputedStyle(match.querySelector('.onboarding-theme-swatch')!).height : undefined }
        })
        const shellTransform = `translate(${compact.left - frame.left}px, ${compact.top - frame.top}px) scale(${compact.width / frame.width}, ${compact.height / frame.height})`
        const duration = out ? CLOSE_MS : OPEN_MS
        const collapsed = { transform: shellTransform, opacity: 0 }
        const expanded = { transform: 'none', opacity: 1 }
        animations.current.push(surface.animate(out ? [interrupted?.shell || expanded, collapsed] : [collapsed, expanded], { duration, easing: EASE, fill: 'both' }))
        for (const entry of tiles) {
            const full = entry.expanded
            const visible = full && full.bottom > gridRect.top && full.top < gridRect.bottom
            const previous = interrupted?.tiles.get(entry.tile.dataset.themeId!)
            const start = previous?.rect || (out && visible ? full : entry.compact)
            const end = !out && visible ? full : entry.compact
            const base = !out && visible ? full : entry.compact
            const clone = entry.tile.cloneNode(true) as HTMLElement
            clone.dataset.selected = String(!!clone.querySelector<HTMLInputElement>('input')?.checked)
            clone.querySelector('input')?.remove()
            Object.assign(clone.style, { position: 'absolute', margin: '0', left: '0', top: '0', width: `${base.width}px`, transformOrigin: '0 0', pointerEvents: 'none' })
            const swatch = clone.querySelector<HTMLElement>('.onboarding-theme-swatch')
            if (swatch) swatch.style.height = (!out && visible ? entry.expandedSwatchHeight : entry.compactSwatchHeight)!
            layer.append(clone)
            if (entry.match) entry.match.style.visibility = 'hidden'
            const transform = (rect: DOMRect) => `translate(${rect.left - frame.left}px, ${rect.top - frame.top}px) scale(${rect.width / base.width}, ${rect.height / base.height})`
            animations.current.push(clone.animate([
                { transform: transform(start), opacity: previous ? Number(previous.opacity) : out && !visible ? 0 : 1 },
                { transform: transform(end), opacity: !out && !visible ? 0 : 1 }
            ], { duration, easing: EASE, fill: 'both' }))
        }
        cleanupTiles.current = () => {
            layer.replaceChildren()
            tiles.forEach(({ match }) => match?.style.removeProperty('visibility'))
        }
    }, [anchor, dialogRef])

    useLayoutEffect(() => {
        const dialog = dialogRef.current!
        closing.current = false
        anchor.removeAttribute('data-returning')
        dialog.dataset.closing = 'false'
        dialog.dataset.settled = 'false'
        dialog.inert = false
        const position = () => {
            const width = Math.min(640, window.innerWidth - 32)
            const height = Math.min(486, window.innerHeight - 80)
            Object.assign(dialog.style, { left: `${(window.innerWidth - width) / 2}px`, top: `${(window.innerHeight - height) / 2}px`, width: `${width}px`, height: `${height}px` })
        }
        position()
        dialog.showModal()
        const grid = dialog.querySelector<HTMLElement>('.onboarding-theme-browser-grid')!
        const firstId = anchor.querySelector<HTMLElement>('.onboarding-theme-suggestions [data-theme-id]')?.dataset.themeId
        const first = grid.querySelector<HTMLElement>(`[data-theme-id="${firstId}"]`)
        if (first) grid.scrollTop += first.getBoundingClientRect().top - grid.getBoundingClientRect().top - 5
        dialog.querySelector<HTMLInputElement>('input[type="search"]')?.focus({ preventScroll: true })
        const settle = () => {
            if (closing.current || dialog.dataset.settled === 'true') return
            clearMotion()
            dialog.dataset.settled = 'true'
        }
        if (!reduced()) { move(false); timer.current = setTimeout(settle, OPEN_MS) }
        else settle()
        // Scroll input owns the live grid immediately, including during entry.
        let lastScrollTop = grid.scrollTop
        const onScroll = () => { if (grid.scrollTop !== lastScrollTop) { lastScrollTop = grid.scrollTop; settle() } }
        grid.addEventListener('wheel', settle, { passive: true })
        grid.addEventListener('touchmove', settle, { passive: true })
        grid.addEventListener('scroll', onScroll, { passive: true })
        dialog.addEventListener('input', settle)
        const resize = () => { if (!closing.current) { clearMotion(); position() } }
        window.addEventListener('resize', resize)
        return () => {
            clearMotion()
            grid.removeEventListener('wheel', settle)
            grid.removeEventListener('touchmove', settle)
            grid.removeEventListener('scroll', onScroll)
            dialog.removeEventListener('input', settle)
            window.removeEventListener('resize', resize)
            anchor.removeAttribute('data-returning')
            dialog.close()
        }
    }, [anchor, clearMotion, dialogRef, move])

    return useCallback(() => {
        const dialog = dialogRef.current
        if (!dialog || closing.current) return
        closing.current = true
        const backdropOpacity = getComputedStyle(dialog, '::backdrop').opacity
        const surfaceStyle = getComputedStyle(dialog.querySelector('.onboarding-theme-browser-surface')!)
        const interrupted: InterruptedMotion = {
            shell: { transform: surfaceStyle.transform, opacity: surfaceStyle.opacity },
            tiles: new Map(Array.from(dialog.querySelectorAll<HTMLElement>('.onboarding-theme-browser-shared [data-theme-id]')).map(tile => [tile.dataset.themeId!, { rect: tile.getBoundingClientRect(), opacity: getComputedStyle(tile).opacity }]))
        }
        clearMotion()
        anchor.dataset.returning = 'true'
        dialog.style.setProperty('--backdrop-from', backdropOpacity)
        dialog.dataset.closing = 'true'
        dialog.inert = true
        if (reduced()) { dialog.close(); finishClose.current(); return }
        move(true, interrupted)
        // Dismissal stays bounded even when a background window suspends animations.
        timer.current = setTimeout(() => { dialog.close(); finishClose.current() }, CLOSE_MS)
    }, [anchor, clearMotion, dialogRef, move])
}
