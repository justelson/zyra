import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export function AssistantActionBatchScroll({ expanded, grouped = true, children }: { expanded: boolean; grouped?: boolean; children: ReactNode }) {
    const viewportRef = useRef<HTMLDivElement>(null)
    const contentRef = useRef<HTMLDivElement>(null)
    const [edges, setEdges] = useState({ top: false, bottom: false })
    const syncEdges = useCallback(() => {
        if (!grouped) return
        const viewport = viewportRef.current
        if (!viewport) return
        const overflow = viewport.scrollHeight - viewport.clientHeight > 1
        const top = overflow && viewport.scrollTop > 1
        const bottom = overflow && viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop > 1
        setEdges(previous => previous.top === top && previous.bottom === bottom ? previous : { top, bottom })
    }, [grouped])

    useLayoutEffect(() => {
        if (expanded) syncEdges()
    }, [children, expanded, syncEdges])

    useEffect(() => {
        if (!expanded || !grouped) return
        syncEdges()
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(syncEdges)
        if (viewportRef.current) observer?.observe(viewportRef.current)
        if (contentRef.current) observer?.observe(contentRef.current)
        window.addEventListener('resize', syncEdges)
        return () => {
            observer?.disconnect()
            window.removeEventListener('resize', syncEdges)
        }
    }, [expanded, grouped, syncEdges])

    const mask = edges.top || edges.bottom
        ? `linear-gradient(to bottom, ${edges.top ? 'transparent' : '#000'} 0, #000 12px, #000 calc(100% - 12px), ${edges.bottom ? 'transparent' : '#000'} 100%)`
        : undefined
    return (
        <div
            ref={viewportRef}
            role={grouped ? 'region' : undefined}
            aria-label={grouped ? 'Actions' : undefined}
            tabIndex={grouped ? 0 : undefined}
            data-assistant-action-batch-scroll={grouped ? 'true' : undefined}
            data-scroll-fade-top={edges.top}
            data-scroll-fade-bottom={edges.bottom}
            className={grouped ? 'project-surface-scrollbar overflow-y-auto overscroll-y-contain [scrollbar-gutter:stable] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--surface-divider)]' : undefined}
            style={grouped ? { maxHeight: 'min(16rem, 35vh)', maskImage: mask, WebkitMaskImage: mask } : undefined}
            onScroll={syncEdges}
        >
            <div ref={contentRef} className={grouped ? 'ml-3 border-l border-[var(--surface-divider)] pl-2 pt-0.5' : undefined} data-assistant-action-batch-items={grouped ? 'all' : undefined}>
                {children}
            </div>
        </div>
    )
}
