import { useCallback, useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'

export type ThemeRevealOrigin = { x: number; y: number }
export function themeRevealOrigin(element: HTMLElement): ThemeRevealOrigin {
    const bounds = (element.closest('label') || element).getBoundingClientRect()
    return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
}

/** Reveal the newly rendered theme from the selected control, with an instant fallback. */
export function useThemeReveal(reducedMotion: boolean) {
    const current = useRef<ViewTransition | null>(null)
    const deadline = useRef<ReturnType<typeof setTimeout> | null>(null)
    useEffect(() => () => {
        current.current?.skipTransition()
        if (deadline.current) clearTimeout(deadline.current)
        document.documentElement.classList.remove('onboarding-theme-reveal')
    }, [])
    return useCallback((update: () => void, origin?: ThemeRevealOrigin) => {
        current.current?.skipTransition()
        if (deadline.current) clearTimeout(deadline.current)
        if (!document.startViewTransition || reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            update()
            return
        }
        const root = document.documentElement
        root.classList.add('onboarding-theme-reveal')
        const point = origin || { x: window.innerWidth / 2, y: window.innerHeight / 2 }
        const radius = Math.hypot(Math.max(point.x, window.innerWidth - point.x), Math.max(point.y, window.innerHeight - point.y))
        let transition: ViewTransition
        try {
            transition = document.startViewTransition(() => flushSync(update))
        } catch {
            current.current = null
            root.classList.remove('onboarding-theme-reveal')
            update()
            return
        }
        current.current = transition
        // Release the live page if Chromium suspends a snapshot during rapid changes.
        deadline.current = setTimeout(() => transition.skipTransition(), 2400)
        void transition.ready.then(() => {
            if (current.current !== transition) return
            root.animate([
                { clipPath: `circle(0px at ${point.x}px ${point.y}px)` },
                { clipPath: `circle(${radius}px at ${point.x}px ${point.y}px)` }
            ], { duration: 780, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', pseudoElement: '::view-transition-new(root)' })
        }).catch(() => {})
        void transition.finished.finally(() => {
            if (current.current === transition) {
                if (deadline.current) clearTimeout(deadline.current)
                current.current = null
                root.classList.remove('onboarding-theme-reveal')
            }
        }).catch(() => {})
    }, [reducedMotion])
}
