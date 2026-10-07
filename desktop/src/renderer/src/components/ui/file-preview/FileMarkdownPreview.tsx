import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { DeferredMarkdownSection } from './DeferredMarkdownSection'
import { MarkdownInteractionLayer } from '../markdown/MarkdownInteractionLayer'
import { MARKDOWN_PREVIEW_ACTIVE_HEADING_EVENT, MARKDOWN_PREVIEW_NAVIGATE_EVENT } from '../markdown/markdownHeadingIds'
import { isMarkdownScrollBusy, markMarkdownScrollActivity } from '../markdown/markdownScrollActivity'
import {
    markdownDomHeight,
    markdownLogicalViewportStart,
    markdownPhysicalViewportStart,
    markdownScrollScale,
    markdownShouldAdjustScrollPosition,
    markdownWheelScrollTop,
    MarkdownPreviewHeightIndex
} from './markdownPreviewHeightIndex'
import { resolveMarkdownLineAnchor, type MarkdownLineAnchor } from './markdownPreviewModeLocation'
import {
    readCachedMarkdownPreviewIndex,
    requestMarkdownPreviewIndex,
    warmMarkdownPreviewIndexWorker
} from './markdownPreviewIndexWorkerClient'
import { warmMarkdownPreviewWorker } from './markdownPreviewWorkerClient'
import {
    buildMarkdownPreviewSections,
    MARKDOWN_VIRTUAL_OVERSCAN_PX,
    type MarkdownVirtualRange
} from './markdownPreviewVirtualModel'

export {
    buildMarkdownPreviewSections,
    computeMarkdownVirtualRange,
    markdownPreviewSectionRenderContent,
    markdownPreviewSectionSource,
    splitMarkdownPreviewSections
} from './markdownPreviewVirtualModel'

function findScrollParent(node: HTMLElement): HTMLElement | null {
    let parent = node.parentElement
    while (parent) {
        const style = window.getComputedStyle(parent)
        if (/(auto|scroll)/.test(style.overflowY)) return parent
        parent = parent.parentElement
    }
    return null
}

const ASYNC_MARKDOWN_INDEX_THRESHOLD = 120_000
const EMPTY_MARKDOWN_SECTIONS: ReturnType<typeof buildMarkdownPreviewSections> = []

export function warmFileMarkdownPreview(): void {
    if (typeof window === 'undefined') return
    warmMarkdownPreviewWorker()
    warmMarkdownPreviewIndexWorker()
}

function equalMarkdownRange(left: MarkdownVirtualRange, right: MarkdownVirtualRange): boolean {
    return left.start === right.start && left.end === right.end
}

export default function FileMarkdownPreview({
    content,
    filePath,
    linkSearchRoot,
    onInternalLinkClick,
    onLinkNotice,
    scrollContainerRef,
    initialSourceLine
}: {
    content: string
    filePath: string
    linkSearchRoot?: string
    onInternalLinkClick?: (href: string) => Promise<boolean | void> | boolean | void
    onLinkNotice?: (message: string, tone: 'info' | 'error') => void
    scrollContainerRef?: RefObject<HTMLElement | null>
    initialSourceLine?: number | null
}) {
    const immediateSections = useMemo(() => (
        content.length < ASYNC_MARKDOWN_INDEX_THRESHOLD
            ? buildMarkdownPreviewSections(content)
            : readCachedMarkdownPreviewIndex(content)
    ), [content])
    const [indexedDocument, setIndexedDocument] = useState<{ content: string; sections: ReturnType<typeof buildMarkdownPreviewSections> } | null>(() => (
        immediateSections ? { content, sections: immediateSections } : null
    ))
    useEffect(() => {
        if (immediateSections) {
            setIndexedDocument({ content, sections: immediateSections })
            return
        }
        let cancelled = false
        const request = requestMarkdownPreviewIndex(content)
        void request.promise.then((sections) => {
            if (cancelled) return
            const nextSections = sections || buildMarkdownPreviewSections(content)
            startTransition(() => setIndexedDocument({ content, sections: nextSections }))
        })
        return () => {
            cancelled = true
            request.cancel()
        }
    }, [content, immediateSections])
    const openingSections = useMemo(() => immediateSections ? EMPTY_MARKDOWN_SECTIONS
        : buildMarkdownPreviewSections(content.slice(0, 16_000)), [content, immediateSections])
    const sections = immediateSections
        || (indexedDocument?.content === content ? indexedDocument.sections : openingSections)
    const renderedDocumentContent = content
    const heightIndex = useMemo(
        () => new MarkdownPreviewHeightIndex(sections.map((section) => section.estimatedHeight)),
        [sections]
    )
    const rootRef = useRef<HTMLDivElement | null>(null)
    const scrollParentRef = useRef<HTMLElement | null>(null)
    const pendingHeightsRef = useRef(new Map<number, number>())
    const heightFrameRef = useRef<number | null>(null)
    const resetScrollFilePathRef = useRef<string | null>(null)
    const pendingAnchorRef = useRef<MarkdownLineAnchor | null>(null)
    const anchorFrameRef = useRef<number | null>(null)
    const activeHeadingRef = useRef<string | null>(null)
    const [heightVersion, setHeightVersion] = useState(0)
    const totalHeight = heightIndex.totalHeight()
    const domHeight = markdownDomHeight(totalHeight)
    const fullyResident = sections.length <= 8 && totalHeight <= 40_000
    const initialRange = useMemo(
        () => fullyResident
            ? { start: 0, end: sections.length }
            : heightIndex.rangeForViewport(0, 900, MARKDOWN_VIRTUAL_OVERSCAN_PX),
        [fullyResident, heightIndex, sections.length]
    )
    const [range, setRange] = useState<MarkdownVirtualRange>(initialRange)
    const [urgentRange, setUrgentRange] = useState<MarkdownVirtualRange>(() => (
        fullyResident ? { start: 0, end: sections.length } : heightIndex.rangeForViewport(0, 900, 0)
    ))
    const headingSectionIndex = useMemo(() => {
        const indexByHeading = new Map<string, number>()
        for (let index = 0; index < sections.length; index += 1) {
            for (const headingId of sections[index].headingIds || []) indexByHeading.set(headingId, index)
        }
        return indexByHeading
    }, [sections])

    const publishActiveHeading = useCallback((sectionIndex = 0) => {
        const root = rootRef.current
        const scrollParent = scrollParentRef.current
        let activeHeadingId: string | null = null
        if (root) {
            const viewportTop = (scrollParent?.getBoundingClientRect().top || 0) + 18
            const renderedHeadings = root.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]')
            for (const heading of renderedHeadings) {
                if (heading.getBoundingClientRect().top > viewportTop) break
                activeHeadingId = heading.id.replace(/^(?:user-content-)+/, '')
            }
        }
        if (!activeHeadingId) {
            for (let index = Math.min(sectionIndex, sections.length - 1); index >= 0; index -= 1) {
                const ids = sections[index]?.headingIds || []
                if (ids.length === 0) continue
                activeHeadingId = ids.at(-1) || null
                break
            }
        }
        if (!activeHeadingId || activeHeadingRef.current === activeHeadingId) return
        activeHeadingRef.current = activeHeadingId
        window.dispatchEvent(new CustomEvent(MARKDOWN_PREVIEW_ACTIVE_HEADING_EVENT, {
            detail: { filePath, headingId: activeHeadingId }
        }))
    }, [filePath, sections])

    useLayoutEffect(() => {
        pendingHeightsRef.current.clear()
        pendingAnchorRef.current = null
        if (heightFrameRef.current !== null) {
            window.cancelAnimationFrame(heightFrameRef.current)
            heightFrameRef.current = null
        }
        if (anchorFrameRef.current !== null) {
            window.cancelAnimationFrame(anchorFrameRef.current)
            anchorFrameRef.current = null
        }
        setHeightVersion((version) => version + 1)
        setRange(initialRange)
        setUrgentRange(fullyResident ? { start: 0, end: sections.length } : heightIndex.rangeForViewport(0, 900, 0))
    }, [filePath, fullyResident, heightIndex, initialRange, sections.length])

    useEffect(() => () => {
        if (heightFrameRef.current !== null) window.cancelAnimationFrame(heightFrameRef.current)
        if (anchorFrameRef.current !== null) window.cancelAnimationFrame(anchorFrameRef.current)
        heightFrameRef.current = null
        anchorFrameRef.current = null
        pendingAnchorRef.current = null
        pendingHeightsRef.current.clear()
    }, [])

    const updateRange = useCallback(() => {
        const root = rootRef.current
        if (!root) return
        if (fullyResident) {
            if (root.style.getPropertyValue('--markdown-scroll-compensation') !== '0px') {
                root.style.setProperty('--markdown-scroll-compensation', '0px')
            }
            const completeRange = { start: 0, end: sections.length }
            setRange((current) => equalMarkdownRange(current, completeRange) ? current : completeRange)
            setUrgentRange((current) => equalMarkdownRange(current, completeRange) ? current : completeRange)
            publishActiveHeading(0)
            return
        }
        const scrollParent = scrollParentRef.current
        const rootRect = root.getBoundingClientRect()
        const viewportRect = scrollParent?.getBoundingClientRect() || { top: 0, bottom: window.innerHeight }
        const physicalViewportStart = Math.max(0, viewportRect.top - rootRect.top)
        const viewportHeight = Math.max(0, viewportRect.bottom - viewportRect.top)
        const logicalViewportStart = markdownLogicalViewportStart(physicalViewportStart, totalHeight, domHeight, viewportHeight)
        const logicalViewportEnd = Math.min(totalHeight, logicalViewportStart + viewportHeight)
        const scrollCompensation = `${physicalViewportStart - logicalViewportStart}px`
        if (root.style.getPropertyValue('--markdown-scroll-compensation') !== scrollCompensation) {
            root.style.setProperty('--markdown-scroll-compensation', scrollCompensation)
        }
        const next = heightIndex.rangeForViewport(logicalViewportStart, logicalViewportEnd, MARKDOWN_VIRTUAL_OVERSCAN_PX)
        const nextUrgent = heightIndex.rangeForViewport(logicalViewportStart, logicalViewportEnd, 0)
        setRange((current) => equalMarkdownRange(current, next) ? current : next)
        setUrgentRange((current) => equalMarkdownRange(current, nextUrgent) ? current : nextUrgent)
        publishActiveHeading(nextUrgent.start)
    }, [domHeight, fullyResident, heightIndex, publishActiveHeading, sections.length, totalHeight])

    useLayoutEffect(() => {
        const root = rootRef.current
        if (!root) return
        const scrollParent = scrollContainerRef?.current || findScrollParent(root)
        scrollParentRef.current = scrollParent
        if (scrollParent && resetScrollFilePathRef.current !== filePath) {
            resetScrollFilePathRef.current = filePath
            scrollParent.scrollTop = 0
        }
        let frameId: number | null = null
        const scheduleUpdate = () => {
            if (frameId !== null) return
            frameId = window.requestAnimationFrame(() => {
                frameId = null
                updateRange()
            })
        }
        const scheduleActiveHeadingUpdate = () => {
            if (frameId !== null) return
            frameId = window.requestAnimationFrame(() => {
                frameId = null
                publishActiveHeading(0)
            })
        }
        const scheduleScrollUpdate = () => {
            markMarkdownScrollActivity()
            if (!fullyResident) scheduleUpdate()
            else scheduleActiveHeadingUpdate()
        }
        const scheduleLayoutUpdate = () => scheduleUpdate()
        const target: HTMLElement | Window = scrollParent || window
        const previousOverscrollBehaviorY = scrollParent?.style.overscrollBehaviorY || ''
        const previousScrollBehavior = scrollParent?.style.scrollBehavior || ''
        if (scrollParent) {
            scrollParent.style.overscrollBehaviorY = 'none'
            scrollParent.style.scrollBehavior = 'auto'
        }
        const handleCompressedMarkdownWheel = (event: WheelEvent) => {
            if (!scrollParent || event.ctrlKey || Math.abs(event.deltaY) < Math.abs(event.deltaX)) return
            event.preventDefault()
            markMarkdownScrollActivity()
            const deltaUnit = event.deltaMode === WheelEvent.DOM_DELTA_LINE
                ? 16
                : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
                    ? scrollParent.clientHeight
                    : 1
            const scale = markdownScrollScale(totalHeight, domHeight, scrollParent.clientHeight)
            scrollParent.scrollTop = markdownWheelScrollTop(
                scrollParent.scrollTop,
                scrollParent.scrollHeight,
                scrollParent.clientHeight,
                event.deltaY * deltaUnit * scale
            )
        }
        target.addEventListener('scroll', scheduleScrollUpdate, { passive: true })
        if (scrollParent && totalHeight > domHeight) {
            scrollParent.addEventListener('wheel', handleCompressedMarkdownWheel, { passive: false })
        }
        window.addEventListener('resize', scheduleLayoutUpdate, { passive: true })
        const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleLayoutUpdate)
        if (scrollParent) resizeObserver?.observe(scrollParent)
        updateRange()
        return () => {
            target.removeEventListener('scroll', scheduleScrollUpdate)
            if (scrollParent) {
                scrollParent.removeEventListener('wheel', handleCompressedMarkdownWheel)
                scrollParent.style.overscrollBehaviorY = previousOverscrollBehaviorY
                scrollParent.style.scrollBehavior = previousScrollBehavior
            }
            window.removeEventListener('resize', scheduleLayoutUpdate)
            resizeObserver?.disconnect()
            if (frameId !== null) window.cancelAnimationFrame(frameId)
            if (scrollParentRef.current === scrollParent) scrollParentRef.current = null
        }
    }, [domHeight, fullyResident, publishActiveHeading, scrollContainerRef, totalHeight, updateRange])

    const flushMeasuredHeights = useCallback(() => {
        heightFrameRef.current = null
        const pending = pendingHeightsRef.current
        if (pending.size === 0) return
        let changed = false
        let logicalAnchorAdjustment = 0
        const scrollParent = scrollParentRef.current
        const root = rootRef.current
        const viewportHeight = scrollParent?.clientHeight || 0
        const scrollBounds = scrollParent?.getBoundingClientRect()
        const rootBounds = root?.getBoundingClientRect()
        const physicalViewportStart = scrollBounds && rootBounds
            ? Math.max(0, scrollBounds.top - rootBounds.top)
            : 0
        const logicalViewportStart = markdownLogicalViewportStart(
            physicalViewportStart,
            totalHeight,
            domHeight,
            viewportHeight
        )
        const shouldAdjustScrollPosition = scrollParent
            ? markdownShouldAdjustScrollPosition(
                scrollParent.scrollTop,
                scrollParent.scrollHeight,
                scrollParent.clientHeight,
                isMarkdownScrollBusy()
            )
            : false
        for (const [index, height] of pending) {
            const delta = heightIndex.update(index, height)
            if (delta === 0) continue
            changed = true
            if (index < urgentRange.start) logicalAnchorAdjustment += delta
        }
        pending.clear()
        if (scrollParent && changed && shouldAdjustScrollPosition) {
            const nextTotalHeight = heightIndex.totalHeight()
            const nextDomHeight = markdownDomHeight(nextTotalHeight)
            const nextPhysicalViewportStart = markdownPhysicalViewportStart(
                logicalViewportStart + logicalAnchorAdjustment,
                nextTotalHeight,
                nextDomHeight,
                viewportHeight
            )
            scrollParent.scrollTop += nextPhysicalViewportStart - physicalViewportStart
        }
        if (changed) setHeightVersion((version) => version + 1)
    }, [domHeight, heightIndex, totalHeight, urgentRange.start])

    const handleSectionReady = useCallback(() => setHeightVersion((version) => version + 1), [])

    const handleSectionHeight = useCallback((index: number, height: number) => {
        if (index < 0 || index >= heightIndex.size) return
        if (Math.abs(heightIndex.heightAt(index) - height) < 2) return
        pendingHeightsRef.current.set(index, height)
        if (heightFrameRef.current !== null) return
        heightFrameRef.current = window.requestAnimationFrame(flushMeasuredHeights)
    }, [flushMeasuredHeights, heightIndex])

    useEffect(() => updateRange(), [totalHeight, updateRange])

    const schedulePendingAnchorScroll = useCallback(() => {
        if (anchorFrameRef.current !== null) window.cancelAnimationFrame(anchorFrameRef.current)
        const attempt = (remainingFrames: number) => {
            anchorFrameRef.current = window.requestAnimationFrame(() => {
                anchorFrameRef.current = null
                const pendingAnchor = pendingAnchorRef.current
                const root = rootRef.current
                const scrollParent = scrollParentRef.current
                if (!pendingAnchor || !root || !scrollParent) return
                const headings = Array.from(root.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]'))
                const findHeading = (headingId: string | null) => headingId
                    ? headings.find((element) => (
                        element.id === headingId || element.id.replace(/^(?:user-content-)+/, '') === headingId
                    )) || null
                    : null
                const startHeading = findHeading(pendingAnchor.startHeadingId)
                const endHeading = pendingAnchor.endHeadingId === pendingAnchor.startHeadingId
                    ? startHeading
                    : findHeading(pendingAnchor.endHeadingId)
                if ((pendingAnchor.startHeadingId && !startHeading) || (pendingAnchor.endHeadingId && !endHeading)) {
                    if (remainingFrames > 1) attempt(remainingFrames - 1)
                    return
                }
                pendingAnchorRef.current = null
                const rootBounds = root.getBoundingClientRect()
                const startTop = startHeading?.getBoundingClientRect().top ?? rootBounds.top
                const endTop = endHeading?.getBoundingClientRect().top ?? rootBounds.bottom
                const targetTop = startTop + (endTop - startTop) * pendingAnchor.progress
                const targetOffset = targetTop - scrollParent.getBoundingClientRect().top
                scrollParent.scrollTop += targetOffset
            })
        }
        attempt(8)
    }, [])

    const handleVirtualAnchorLink = useCallback((href: string): boolean => {
        const rawId = href.startsWith('#') ? href.slice(1) : href
        let decodedId = rawId
        try {
            decodedId = decodeURIComponent(rawId)
        } catch {
            decodedId = rawId
        }
        const normalizedId = decodedId.replace(/^(?:user-content-)+/, '')
        const targetIndex = headingSectionIndex.get(decodedId) ?? headingSectionIndex.get(normalizedId)
        const scrollParent = scrollParentRef.current
        const root = rootRef.current
        if (targetIndex === undefined || !scrollParent || !root) return false
        const viewportHeight = scrollParent.clientHeight
        const logicalTarget = heightIndex.offsetAt(targetIndex)
        const physicalTarget = markdownPhysicalViewportStart(logicalTarget, totalHeight, domHeight, viewportHeight)
        const scrollBounds = scrollParent.getBoundingClientRect()
        const rootBounds = root.getBoundingClientRect()
        const rootOffset = rootBounds.top - scrollBounds.top + scrollParent.scrollTop
        pendingAnchorRef.current = {
            sourceLine: 1,
            startHeadingId: normalizedId,
            endHeadingId: normalizedId,
            progress: 0
        }
        scrollParent.scrollTop = rootOffset + physicalTarget
        schedulePendingAnchorScroll()
        return true
    }, [domHeight, headingSectionIndex, heightIndex, schedulePendingAnchorScroll, totalHeight])

    const handleVirtualSourceLine = useCallback((sourceLine: number): boolean => {
        const scrollParent = scrollParentRef.current
        const root = rootRef.current
        if (!scrollParent || !root) return false
        const anchor = resolveMarkdownLineAnchor(content, sourceLine)
        const targetHeadingId = anchor.startHeadingId || anchor.endHeadingId
        const targetIndex = targetHeadingId ? headingSectionIndex.get(targetHeadingId) : undefined
        const viewportHeight = scrollParent.clientHeight
        const logicalTarget = targetIndex === undefined
            ? totalHeight * anchor.progress
            : heightIndex.offsetAt(targetIndex)
        const physicalTarget = markdownPhysicalViewportStart(logicalTarget, totalHeight, domHeight, viewportHeight)
        const scrollBounds = scrollParent.getBoundingClientRect()
        const rootBounds = root.getBoundingClientRect()
        const rootOffset = rootBounds.top - scrollBounds.top + scrollParent.scrollTop
        pendingAnchorRef.current = anchor
        scrollParent.scrollTop = rootOffset + physicalTarget
        schedulePendingAnchorScroll()
        return true
    }, [content, domHeight, headingSectionIndex, heightIndex, schedulePendingAnchorScroll, totalHeight])

    useEffect(() => {
        const handleOutlineNavigation = (event: Event) => {
            const detail = (event as CustomEvent<{ filePath?: string; headingId?: string }>).detail
            if (detail?.filePath !== filePath || !detail.headingId) return
            handleVirtualAnchorLink(`#${detail.headingId}`)
        }
        window.addEventListener(MARKDOWN_PREVIEW_NAVIGATE_EVENT, handleOutlineNavigation)
        return () => window.removeEventListener(MARKDOWN_PREVIEW_NAVIGATE_EVENT, handleOutlineNavigation)
    }, [filePath, handleVirtualAnchorLink])

    useLayoutEffect(() => {
        if (pendingAnchorRef.current) schedulePendingAnchorScroll()
    }, [heightVersion, range, schedulePendingAnchorScroll])

    useLayoutEffect(() => {
        if (typeof initialSourceLine !== 'number') return
        handleVirtualSourceLine(initialSourceLine)
    }, [handleVirtualSourceLine, initialSourceLine])

    if (sections.length === 0) {
        if (!content) return null
        return (
            <div
                className="min-h-64 w-full space-y-4 py-2"
                role="status"
                aria-label="Indexing Markdown document"
                data-zyra-diagnostic-surface="markdown-preview-indexing"
                data-zyra-diagnostic-source-characters={content.length}
                data-zyra-diagnostic-item-count={sections.length}
            >
                <div className="h-5 w-2/5 animate-pulse rounded-full bg-sparkle-text-muted/[0.08] motion-reduce:animate-none" />
                <div className="space-y-2.5">
                    <div className="h-3 w-full animate-pulse rounded-full bg-sparkle-text-muted/[0.05] motion-reduce:animate-none" />
                    <div className="h-3 w-11/12 animate-pulse rounded-full bg-sparkle-text-muted/[0.05] motion-reduce:animate-none" />
                    <div className="h-3 w-4/5 animate-pulse rounded-full bg-sparkle-text-muted/[0.05] motion-reduce:animate-none" />
                </div>
            </div>
        )
    }
    const visibleSections = sections.slice(range.start, range.end)

    return (
        <div
            ref={rootRef}
            className="relative w-full"
            style={{ height: fullyResident ? undefined : `${domHeight}px`, overflowAnchor: 'none' }}
            data-zyra-diagnostic-surface="markdown-preview"
            data-zyra-diagnostic-source-characters={content.length}
            data-zyra-diagnostic-item-count={sections.length}
            data-zyra-diagnostic-animation="idle"
        >
            <MarkdownInteractionLayer
                rootRef={rootRef}
                filePath={filePath}
                searchRootPath={linkSearchRoot}
                contentKey={renderedDocumentContent}
                onInternalLinkClick={onInternalLinkClick}
                onLinkNotice={onLinkNotice}
                onAnchorLinkClick={handleVirtualAnchorLink}
            />
            {visibleSections.map((section, relativeIndex) => {
                const index = range.start + relativeIndex
                const sectionHeight = heightIndex.heightAt(index)
                return (
                    <div
                        key={section.id || `${filePath}:${section.start}:${section.end}`}
                        className={fullyResident ? 'relative w-full' : 'absolute inset-x-0 top-0 w-full'}
                        style={fullyResident
                            ? undefined
                            : {
                                transform: `translateY(calc(${heightIndex.offsetAt(index)}px + var(--markdown-scroll-compensation, 0px)))`,
                                minHeight: `${sectionHeight}px`
                            }}
                    >
                        <DeferredMarkdownSection
                            section={section}
                            documentContent={renderedDocumentContent}
                            index={index}
                            filePath={filePath}
                            linkSearchRoot={linkSearchRoot}
                            onInternalLinkClick={onInternalLinkClick}
                            onLinkNotice={onLinkNotice}
                            reservedHeight={sectionHeight}
                            urgent={index >= urgentRange.start && index < urgentRange.end}
                            eagerLayout={fullyResident}
                            onHeight={handleSectionHeight}
                            onReady={handleSectionReady}
                        />
                    </div>
                )
            })}
        </div>
    )
}
