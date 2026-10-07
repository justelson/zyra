import { memo, startTransition, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Root } from 'hast'
import MarkdownRenderer from '../MarkdownRenderer'
import { markdownPreviewSectionRenderContent, type MarkdownPreviewSection } from './markdownPreviewVirtualModel'
import { enqueueMarkdownSectionRender } from './markdownPreviewRenderQueue'
import {
    requestMarkdownPreviewSection,
    type MarkdownPreviewParseRequest
} from './markdownPreviewWorkerClient'
import { prepareImmediateMarkdownSection } from './markdownPreviewImmediateSection'

type PreparedSection = {
    content: string
    tree: Root | null
}

export const DeferredMarkdownSection = memo(function DeferredMarkdownSection({
    section,
    documentContent,
    index,
    filePath,
    linkSearchRoot,
    onInternalLinkClick,
    onLinkNotice,
    reservedHeight,
    urgent,
    eagerLayout = false,
    onHeight,
    onReady
}: {
    section: MarkdownPreviewSection
    documentContent: string
    index: number
    filePath: string
    linkSearchRoot?: string
    onInternalLinkClick?: (href: string) => Promise<boolean | void> | boolean | void
    onLinkNotice?: (message: string, tone: 'info' | 'error') => void
    reservedHeight: number
    urgent: boolean
    eagerLayout?: boolean
    onHeight: (index: number, height: number) => void
    onReady?: (index: number) => void
}) {
    const sectionRef = useRef<HTMLDivElement | null>(null)
    const previewInstanceId = useId()
    const renderContent = useMemo(
        () => markdownPreviewSectionRenderContent(documentContent, section),
        [documentContent, section]
    )
    const cachedTree = useMemo(
        () => prepareImmediateMarkdownSection(renderContent, section.headingIds, urgent),
        [renderContent, section.headingIds, urgent]
    )
    const [prepared, setPrepared] = useState<PreparedSection | null>(() => (
        cachedTree ? { content: renderContent, tree: cachedTree } : null
    ))
    const activePreparation = prepared?.content === renderContent
        ? prepared
        : cachedTree
            ? { content: renderContent, tree: cachedTree }
            : null
    const ready = section.renderAsSource === true || activePreparation !== null

    useEffect(() => {
        if (ready) return
        let cancelled = false
        let parseRequest: MarkdownPreviewParseRequest | null = null
        const cancelQueuedRender = enqueueMarkdownSectionRender(`${previewInstanceId}:${filePath}:${section.id}`, () => {
            parseRequest = requestMarkdownPreviewSection(renderContent, urgent, section.headingIds)
            void parseRequest.promise.then((tree) => {
                if (cancelled) return
                startTransition(() => {
                    setPrepared({ content: renderContent, tree })
                    onReady?.(index)
                })
            })
        }, urgent)
        return () => {
            cancelled = true
            cancelQueuedRender()
            parseRequest?.cancel()
        }
    }, [filePath, index, onReady, previewInstanceId, ready, renderContent, section.headingIds, section.id, urgent])

    useLayoutEffect(() => {
        if (!ready || !sectionRef.current) return
        const node = sectionRef.current
        const measure = () => onHeight(index, Math.max(1, Math.ceil(node.getBoundingClientRect().height)))
        measure()
        if (typeof ResizeObserver === 'undefined') return
        const observer = new ResizeObserver(measure)
        observer.observe(node)
        return () => observer.disconnect()
    }, [index, onHeight, ready])

    return (
        <div
            ref={sectionRef}
            className="w-full"
            style={ready
                ? eagerLayout
                    ? undefined
                    : { contentVisibility: 'auto', containIntrinsicBlockSize: `auto ${reservedHeight}px` }
                : { height: `${reservedHeight}px` }}
        >
            {section.renderAsSource || (ready && activePreparation?.tree === null) ? (
                <pre className="m-0 overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-amber-500/20 bg-amber-500/[0.06] p-4 text-sm leading-6 text-sparkle-text-dark" role="status" aria-label={section.renderAsSource ? 'Oversized footnote document shown as source for stability' : 'Markdown worker unavailable; shown as source'}>
                    {renderContent}
                </pre>
            ) : ready ? (
                <MarkdownRenderer
                    content={renderContent}
                    filePath={filePath}
                    cacheKey={`file-preview:${filePath}:${section.id}:${renderContent.length}`}
                    preparedTree={activePreparation?.tree || undefined}
                    interactionLayerEnabled={false}
                    deferCodeHighlighting
                    linkSearchRoot={linkSearchRoot}
                    onInternalLinkClick={onInternalLinkClick}
                    onLinkNotice={onLinkNotice}
                    prewarmCodeBlocks={false}
                />
            ) : (
                <div className="h-full w-full animate-pulse space-y-2 py-3 motion-reduce:animate-none" role="status" aria-label="Preparing Markdown section">
                    <div className="h-3 w-2/5 rounded-full bg-sparkle-text-muted/[0.07]" />
                    <div className="h-2.5 w-full rounded-full bg-sparkle-text-muted/[0.045]" />
                    <div className="h-2.5 w-4/5 rounded-full bg-sparkle-text-muted/[0.045]" />
                </div>
            )}
        </div>
    )
})
