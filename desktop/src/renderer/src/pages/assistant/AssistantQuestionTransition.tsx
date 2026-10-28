import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/** Animate intrinsic section changes without scaling text or delaying input state. */
export function AssistantQuestionTransition({ children, sectionKey, animateContent = true }: {
    children: ReactNode
    sectionKey: string
    animateContent?: boolean
}) {
    const contentRef = useRef<HTMLDivElement>(null)
    const previousKey = useRef<string | null>(null)
    const [height, setHeight] = useState<number>()

    useLayoutEffect(() => {
        const content = contentRef.current
        if (!content) return
        const measure = () => {
            const next = content.getBoundingClientRect().height
            setHeight(current => current === next ? current : next)
        }
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(content)
        return () => observer.disconnect()
    }, [sectionKey])

    useLayoutEffect(() => {
        const changed = previousKey.current !== null && previousKey.current !== sectionKey
        previousKey.current = sectionKey
        if (!changed || !animateContent || !contentRef.current || matchMedia('(prefers-reduced-motion: reduce)').matches || document.body.classList.contains('zyra-reduce-motion')) return
        const animation = contentRef.current.animate([
            { opacity: .65, transform: 'translateY(4px)' },
            { opacity: 1, transform: 'translateY(0)' },
        ], { duration: 160, easing: 'cubic-bezier(.2,.8,.2,1)' })
        return () => animation.cancel()
    }, [sectionKey, animateContent])

    return <div data-question-transition className="overflow-hidden transition-[height] duration-[220ms] ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none" style={{ height }}>
        <div ref={contentRef} className="flow-root">{children}</div>
    </div>
}
