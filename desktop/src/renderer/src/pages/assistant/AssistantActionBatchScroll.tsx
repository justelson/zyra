import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export function AssistantActionBatchScroll({ expanded, children }: { expanded: boolean; children: ReactNode }) {
    const viewportRef = useRef<HTMLDivElement>(null)
    const contentRef = useRef<HTMLDivElement>(null)
    const [edges, setEdges] = useState({ top: false, bottom: false })
    const syncEdges = useCallback(() => {
        const viewport = viewportRef.current
        if (!viewport) return
        const overflow = viewport.scrollHeight - viewport.clientHeight > 1
        const top = overflow && viewport.scrollTop > 1
        const bottom = overflow && viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop > 1
        setEdges(previous => previous.top === top && previous.bottom === bottom ? previous : { top, bottom })
    }, [])

    useLayoutEffect(() => {
        if (expanded) syncEdges()
    }, [children, expanded, syncEdges])

    useEffect(() => {
        if (!expanded) return
        syncEdges()
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(syncEdges)
        if (viewportRef.current) observer?.observe(viewportRef.current)
        if (contentRef.current) observer?.observe(contentRef.current)
        window.addEventListener('resize', syncEdges)
        return () => {
            observer?.disconnect()
            window.removeEventListener('resize', syncEdges)
        }
    }, [expanded, syncEdges])

    const mask = edges.top || edges.bottom
        ? `linear-gradient(to bottom, ${edges.top ? 'transparent' : '#000'} 0, #000 12px, #000 calc(100% - 12px), ${edges.bottom ? 'transparent' : '#000'} 100%)`
        : undefined
    return (
        <div
            ref={viewportRef}
            role="region"
            aria-label="Actions"
            tabIndex={0}
            data-assistant-action-batch-scroll="true"
            data-scroll-fade-top={edges.top}
            data-scroll-fade-bottom={edges.bottom}
            className="project-surface-scrollbar overflow-y-auto overscroll-y-contain [scrollbar-gutter:stable] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--surface-divider)]"
            style={{ maxHeight: 'min(16rem, 35vh)', maskImage: mask, WebkitMaskImage: mask }}
            onScroll={syncEdges}
        >
            <div ref={contentRef} className="ml-3 border-l border-[var(--surface-divider)] pl-2 pt-0.5" data-assistant-action-batch-items="all">
                {children}
            </div>
        </div>
    )
}
