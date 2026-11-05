import { useEffect, useRef } from 'react'
import { responseTimingNow } from '@shared/response-timing'

/** Observe the text renderer after its reveal policy, not the incoming buffer. */
export function useResponseTextDisplay(turnId: string | null | undefined, ready: boolean) {
    const element = useRef<HTMLDivElement>(null)
    const reported = useRef<string | null>(null)
    useEffect(() => {
        if (!turnId || !ready || reported.current === turnId || !window.zyraDiagnostics) return
        let frame = 0
        let cancelled = false
        let inView = false
        const visible = (node: HTMLElement) => {
            const rect = node.getBoundingClientRect()
            return inView && document.visibilityState === 'visible' && node.isConnected && rect.width > 0 && rect.height > 0
                && rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth
                && node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && Boolean(node.innerText.trim())
        }
        const inspect = () => {
            const node = element.current
            if (cancelled || !node || !visible(node)) return
            // The intervening animation frame gives committed text a paint
            // opportunity. Hidden/collapsed/unmounted content is never counted.
            frame = requestAnimationFrame(() => {
                if (cancelled || !visible(node)) return
                reported.current = turnId
                stop()
                void window.zyraDiagnostics?.displayed({ turnId, at: responseTimingNow() }).catch(() => undefined)
            })
        }
        const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(inspect) }
        const mutations = new MutationObserver(schedule)
        const intersection = new IntersectionObserver(entries => {
            inView = entries.some(entry => entry.isIntersecting && entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0)
            if (inView) schedule()
        // Threshold zero alone does not notify when an edge-touching,
        // zero-height clip opens into a positive visible intersection.
        }, { threshold: [0, Number.EPSILON] })
        if (element.current) { mutations.observe(element.current, { childList: true, subtree: true, characterData: true }); intersection.observe(element.current) }
        const animationFinished = (event: Event) => {
            if (event.target instanceof Element && element.current && event.target.contains(element.current)) schedule()
        }
        const stop = () => {
            cancelAnimationFrame(frame)
            mutations.disconnect()
            intersection.disconnect()
            window.removeEventListener('animationend', animationFinished, true)
            window.removeEventListener('transitionend', animationFinished, true)
            document.removeEventListener('visibilitychange', schedule)
        }
        window.addEventListener('animationend', animationFinished, true)
        window.addEventListener('transitionend', animationFinished, true)
        document.addEventListener('visibilitychange', schedule)
        schedule()
        return () => { cancelled = true; stop() }
    }, [turnId, ready])
    return element
}
