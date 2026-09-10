import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ZyraLogoASCII } from '@/components/ui/ZyraLogo'

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'

/** Keeps the brand mark alive while the step body leaves, changes, and arrives. */
export function OnboardingStage({ step, direction, reducedMotion, children, decoration }: {
    step: string
    direction: 'forward' | 'backward'
    reducedMotion: boolean
    children: ReactNode
    decoration?: ReactNode
}) {
    const [displayedStep, setDisplayedStep] = useState(step)
    const [systemReducedMotion, setSystemReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    const previousContent = useRef(children)
    const bodyRef = useRef<HTMLDivElement>(null)
    const scrollRef = useRef<HTMLDivElement>(null)
    const sectionRef = useRef<HTMLElement>(null)
    const slotRef = useRef<HTMLDivElement>(null)
    const logoRef = useRef<HTMLDivElement>(null)
    const layerRef = useRef<HTMLDivElement>(null)
    const changing = displayedStep !== step
    const motionOff = reducedMotion || systemReducedMotion
    if (!changing) previousContent.current = children

    useEffect(() => {
        const media = window.matchMedia('(prefers-reduced-motion: reduce)')
        const update = () => setSystemReducedMotion(media.matches)
        media.addEventListener('change', update)
        return () => media.removeEventListener('change', update)
    }, [])

    useLayoutEffect(() => {
        // Clear opacity left by older interrupted transitions or a live refresh.
        bodyRef.current?.style.removeProperty('opacity')
        bodyRef.current?.style.removeProperty('transform')
    }, [displayedStep])

    // Animation cancellation must never persist an invisible inline style. A
    // bounded exit swaps the keyed page even if the browser suspends animations.
    useEffect(() => {
        if (!changing) return
        if (motionOff) { setDisplayedStep(step); return }
        const timer = window.setTimeout(() => setDisplayedStep(step), 140)
        return () => window.clearTimeout(timer)
    }, [changing, motionOff, step])

    useLayoutEffect(() => {
        const logo = logoRef.current
        const slot = slotRef.current
        const section = sectionRef.current
        const layer = layerRef.current
        const scroll = scrollRef.current
        if (!logo || !slot || !section || !layer || !scroll) return
        scroll.scrollTop = 0
        let animation: Animation | null = null
        let lastTarget = ''
        const place = (animate: boolean) => {
            const target = slot.getBoundingClientRect()
            const origin = layer.getBoundingClientRect()
            const transform = `translate3d(${target.left - origin.left}px, ${target.top - origin.top}px, 0) scale(${target.width / logo.offsetWidth}, ${target.height / logo.offsetHeight})`
            if (transform === lastTarget) return
            lastTarget = transform
            const from = getComputedStyle(logo).transform
            const wasPlaced = logo.dataset.placed === 'true'
            animation?.cancel()
            logo.style.transform = transform
            logo.style.visibility = 'visible'
            logo.dataset.placed = 'true'
            if (animate && !motionOff) {
                const initial = !wasPlaced && displayedStep === 'welcome'
                    ? `translate3d(${target.left - origin.left}px, -160px, 0) scale(${target.width / logo.offsetWidth}, ${target.height / logo.offsetHeight})`
                    : from
                if (wasPlaced || displayedStep === 'welcome') animation = logo.animate([{ transform: initial }, { transform }], { duration: wasPlaced ? 680 : 1000, easing: EASE })
            }
        }
        place(true)
        const observer = new ResizeObserver(() => place(true))
        observer.observe(section)
        observer.observe(scroll)
        const onScroll = () => place(false)
        scroll.addEventListener('scroll', onScroll, { passive: true })
        return () => {
            observer.disconnect()
            scroll.removeEventListener('scroll', onScroll)
            const current = getComputedStyle(logo).transform
            animation?.cancel()
            logo.style.transform = current
        }
    }, [displayedStep, motionOff])

    return <>
        <div className="onboarding-stage-decoration" data-active={displayedStep === 'appearance' && !changing} data-reduced-motion={motionOff} aria-hidden="true">{decoration}</div>
        <div ref={scrollRef} data-step={displayedStep} className="onboarding-step-scroll px-6 sm:px-10">
            <section ref={sectionRef} className="onboarding-step-content mx-auto w-full max-w-[640px]" aria-labelledby={displayedStep === 'welcome' ? 'onboarding-welcome-title' : 'onboarding-step-title'}>
                <div className="mb-6 flex justify-center" aria-hidden="true"><div ref={slotRef} className={displayedStep === 'welcome' ? 'onboarding-logo-slot onboarding-logo-slot-welcome' : 'onboarding-logo-slot'} /></div>
                <div key={displayedStep} ref={bodyRef} className="onboarding-page-body" data-leaving={changing} data-direction={direction} data-reduced-motion={motionOff} inert={changing} data-onboarding-step-body={displayedStep}>{previousContent.current}</div>
            </section>
        </div>
        <div ref={layerRef} className="onboarding-stage-logo-layer" aria-hidden="true">
            <div ref={logoRef} data-onboarding-shared-logo className="onboarding-shared-logo" style={motionOff ? { animation: 'none' } : undefined}><ZyraLogoASCII size="md" variant="loading" tone="theme" /></div>
        </div>
    </>
}
