import { useCallback, useEffect, useLayoutEffect, useRef, useState, type TransitionEvent as ReactTransitionEvent } from 'react'
const REVIEW_NAVIGATION_MOTION_MS = 230
export function useAssistantReviewNavigation() {
    const [reviewTurnId, setReviewTurnId] = useState<string | null>(null)
    const [reviewTransitionTurnId, setReviewTransitionTurnId] = useState<string | null>(null)
    const [reviewDetailPresented, setReviewDetailPresented] = useState(false)
    const reviewIndexSurfaceRef = useRef<HTMLDivElement | null>(null)
    const reviewDetailSurfaceRef = useRef<HTMLDivElement | null>(null)
    const reviewNavigationAnimationsRef = useRef<Animation[]>([])
    const previousReviewDetailPresentedRef = useRef(false)
    useEffect(() => {
        let stagingFrameId = 0
        let presentationFrameId = 0
        let releaseTimerId = 0
        const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
        if (reviewTurnId) {
            setReviewTransitionTurnId(reviewTurnId)
            if (reducedMotion) {
                setReviewDetailPresented(true)
            } else {
                setReviewDetailPresented(false)
                stagingFrameId = window.requestAnimationFrame(() => {
                    presentationFrameId = window.requestAnimationFrame(() => setReviewDetailPresented(true))
                })
            }
        } else {
            setReviewDetailPresented(false)
            if (reviewTransitionTurnId) {
                releaseTimerId = window.setTimeout(
                    () => setReviewTransitionTurnId((current) => current === reviewTransitionTurnId ? null : current),
                    reducedMotion ? 0 : REVIEW_NAVIGATION_MOTION_MS * 2
                )
            }
        }
        return () => {
            window.cancelAnimationFrame(stagingFrameId)
            window.cancelAnimationFrame(presentationFrameId)
            window.clearTimeout(releaseTimerId)
        }
    }, [reviewTransitionTurnId, reviewTurnId])

    useLayoutEffect(() => {
        const presentationChanged = previousReviewDetailPresentedRef.current !== reviewDetailPresented
        previousReviewDetailPresentedRef.current = reviewDetailPresented
        if (!presentationChanged) return

        for (const animation of reviewNavigationAnimationsRef.current) animation.cancel()
        reviewNavigationAnimationsRef.current = []

        const indexSurface = reviewIndexSurfaceRef.current
        const detailSurface = reviewDetailSurfaceRef.current
        if (!indexSurface || !detailSurface) return
        const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
            || document.body.classList.contains('zyra-reduce-motion')
        if (reducedMotion || typeof indexSurface.animate !== 'function') return

        const options: KeyframeAnimationOptions = {
            duration: REVIEW_NAVIGATION_MOTION_MS,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            fill: 'both'
        }
        const indexAnimation = indexSurface.animate(
            reviewDetailPresented
                ? [
                    { opacity: 1, transform: 'translate3d(0, 0, 0)' },
                    { opacity: 0, transform: 'translate3d(-12px, 0, 0)' }
                ]
                : [
                    { opacity: 0, transform: 'translate3d(-12px, 0, 0)' },
                    { opacity: 1, transform: 'translate3d(0, 0, 0)' }
                ],
            options
        )
        const detailAnimation = detailSurface.animate(
            reviewDetailPresented
                ? [
                    { opacity: 0, transform: 'translate3d(16px, 0, 0)' },
                    { opacity: 1, transform: 'translate3d(0, 0, 0)' }
                ]
                : [
                    { opacity: 1, transform: 'translate3d(0, 0, 0)' },
                    { opacity: 0, transform: 'translate3d(16px, 0, 0)' }
                ],
            options
        )
        reviewNavigationAnimationsRef.current = [indexAnimation, detailAnimation]
    }, [reviewDetailPresented])

    useEffect(() => () => {
        for (const animation of reviewNavigationAnimationsRef.current) animation.cancel()
        reviewNavigationAnimationsRef.current = []
    }, [])

    const handleReviewDetailTransitionEnd = useCallback((event: ReactTransitionEvent<HTMLDivElement>) => {
        if (
            event.target !== event.currentTarget
            || event.propertyName !== 'transform'
            || reviewDetailPresented
            || reviewTurnId
        ) return
        setReviewTransitionTurnId((current) => current === reviewTransitionTurnId ? null : current)
    }, [reviewDetailPresented, reviewTransitionTurnId, reviewTurnId])

    return { reviewTurnId, setReviewTurnId, reviewTransitionTurnId, setReviewTransitionTurnId,
        reviewDetailPresented, setReviewDetailPresented, reviewIndexSurfaceRef, reviewDetailSurfaceRef, handleReviewDetailTransitionEnd }
}
