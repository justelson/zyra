import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'

type FooterProps = {
    visible: boolean
    index: number
    total: number
    stepLabel: string
    continueLabel: string
    finalStep: boolean
    backDisabled: boolean
    continueDisabled: boolean
    reducedMotion: boolean
    direction: 'forward' | 'backward'
    error: string | null
    onBack: () => void
    onContinue: () => void
}

export function OnboardingFooter(props: FooterProps) {
    const [displayed, setDisplayed] = useState(props)
    const latest = useRef(props)
    latest.current = props
    const changing = displayed.index !== props.index || displayed.visible !== props.visible
    const content = changing ? displayed : props
    useEffect(() => {
        if (!changing) return
        if (props.reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setDisplayed(latest.current); return }
        const timer = setTimeout(() => setDisplayed(latest.current), 140)
        return () => clearTimeout(timer)
    }, [changing, props.index, props.visible, props.reducedMotion])
    if (!content.visible) return null
    return <footer className="onboarding-action-dock" data-leaving={changing && !props.visible} data-changing={changing} data-direction={props.direction} data-reduced-motion={props.reducedMotion} inert={changing}>
        {props.error ? <p role="alert" className="onboarding-action-error">{props.error}</p> : null}
        <div className="onboarding-action-row">
            <button type="button" disabled={props.backDisabled} onClick={props.onBack} className="inline-flex h-11 items-center justify-center gap-1.5 rounded-full text-[12px] font-medium text-sparkle-text-secondary transition-colors hover:bg-[var(--surface-hover)] hover:text-sparkle-text disabled:opacity-45">
                <ArrowLeft size={13} />Back
            </button>
            <div className="onboarding-dock-progress" aria-label={`Setup step ${content.index + 1} of ${content.total}: ${content.stepLabel}`}>
                <div className="onboarding-progress-label mb-2 text-center text-[10px] font-medium text-sparkle-text-secondary">
                    <span key={content.index} className="onboarding-dock-copy">{content.index + 1} of {content.total}</span>
                </div>
                <div className="h-px overflow-hidden bg-[color-mix(in_srgb,var(--color-text)_14%,transparent)]">
                    <div className="onboarding-progress-fill h-full bg-[var(--accent-primary)]" style={{ transform: `scaleX(${(content.index + 1) / content.total})` }} />
                </div>
            </div>
            <button type="button" disabled={props.continueDisabled} onClick={props.onContinue} className="inline-flex h-11 items-center justify-center rounded-full bg-[var(--accent-primary)] px-4 text-[12px] font-semibold text-[var(--accent-on-primary)] shadow-[0_8px_24px_color-mix(in_srgb,var(--accent-primary)_18%,transparent)] transition-[opacity,transform] hover:-translate-y-px hover:opacity-92 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0">
                <span key={content.index} className="onboarding-dock-copy inline-flex items-center justify-center gap-1.5">{content.continueLabel}{!content.finalStep ? <ArrowRight size={13} /> : null}</span>
            </button>
        </div>
    </footer>
}
