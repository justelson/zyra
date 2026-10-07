import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import MarkdownRenderer, { prepareMarkdownRender, type MarkdownMediaMode } from '@/components/ui/MarkdownRenderer'
import { useObservedElementWidth } from '@/lib/text-layout/useObservedElementWidth'
import { VisualizationMessage } from '@/components/ui/visualization/VisualizationMessage'
import { useStreamingMarkdownContent } from './useStreamingMarkdownContent'
import {
    getUserMessageBodyWidth,
    measureTimelinePlainTextHeight,
    TIMELINE_TEXT_LINE_HEIGHT,
    USER_MESSAGE_COLLAPSED_LINE_COUNT
} from './assistant-timeline-text-metrics'

type StreamingAssistantTextProps = {
    content: string
    className?: string
}

type AssistantMarkdownInteractionProps = {
    timestamp?: ReactNode
    renderFooter?: (showTimestamp: boolean) => ReactNode
    onInternalLinkClick?: (href: string) => Promise<boolean | void> | boolean | void
    onLinkNotice?: (message: string, tone: 'info' | 'error') => void
    mediaMode?: MarkdownMediaMode
}

type StreamingAssistantMarkdownProps = AssistantMarkdownInteractionProps & {
    content: string
    filePath?: string
    className?: string
    cacheKey: string
    fadeStreamingText?: boolean
}

type CompletedAssistantMarkdownProps = AssistantMarkdownInteractionProps & {
    content: string
    filePath?: string
    className?: string
    cacheKey: string
    deferInitialRender?: boolean
}

type CollapsibleUserMessageBodyProps = {
    content: string
}

export const StreamingAssistantText = memo(function StreamingAssistantText({
    content,
    className
}: StreamingAssistantTextProps) {
    return (
        <div className={className || 'whitespace-pre-wrap break-words text-[13px] leading-6 text-sparkle-text [overflow-wrap:anywhere]'}>
            {content || ' '}
        </div>
    )
})

export const StreamingAssistantMarkdown = memo(function StreamingAssistantMarkdown(props: StreamingAssistantMarkdownProps) {
    return <VisualizationMessage content={props.content} streaming timestamp={props.timestamp} renderFooter={props.renderFooter} renderMarkdown={(content, key) => <StreamingAssistantMarkdownText {...props} content={content} cacheKey={key ? `${props.cacheKey}:${key}` : props.cacheKey} />} />
})

const StreamingAssistantMarkdownText = memo(function StreamingAssistantMarkdownText({
    content,
    filePath,
    className,
    cacheKey,
    onInternalLinkClick,
    onLinkNotice,
    mediaMode,
    fadeStreamingText = false
}: StreamingAssistantMarkdownProps) {
    const renderedContent = useStreamingMarkdownContent(content, cacheKey)
    if (!renderedContent.trim()) return <StreamingAssistantText content=" " className={className} />

    return (
        <div data-assistant-streaming-markdown="true">
            <MarkdownRenderer
                content={renderedContent}
                filePath={filePath}
                className={className}
                cacheKey={cacheKey}
                transient
                deferCodeHighlighting
                fadeStreamingText={fadeStreamingText}
                onInternalLinkClick={onInternalLinkClick}
                onLinkNotice={onLinkNotice}
                mediaMode={mediaMode}
            />
        </div>
    )
})

export const CompletedAssistantMarkdown = memo(function CompletedAssistantMarkdown(props: CompletedAssistantMarkdownProps) {
    return <VisualizationMessage content={props.content} streaming={false} timestamp={props.timestamp} renderFooter={props.renderFooter} renderMarkdown={(content, key) => <CompletedAssistantMarkdownText {...props} content={content} cacheKey={key ? `${props.cacheKey}:${key}` : props.cacheKey} />} />
})

const CompletedAssistantMarkdownText = memo(function CompletedAssistantMarkdownText({
    content,
    filePath,
    className,
    cacheKey,
    deferInitialRender = false,
    onInternalLinkClick,
    onLinkNotice,
    mediaMode
}: CompletedAssistantMarkdownProps) {
    const [renderReady, setRenderReady] = useState(!deferInitialRender)

    useEffect(() => {
        if (!deferInitialRender) {
            setRenderReady(true)
            return
        }

        let cancelled = false
        setRenderReady(false)
        const prepare = () => {
            prepareMarkdownRender({ content, filePath, cacheKey, mediaMode })
            if (!cancelled) setRenderReady(true)
        }
        if (typeof window.requestIdleCallback === 'function') {
            const idleId = window.requestIdleCallback(prepare, { timeout: 180 })
            return () => {
                cancelled = true
                window.cancelIdleCallback(idleId)
            }
        }
        const timeoutId = window.setTimeout(prepare, 0)
        return () => {
            cancelled = true
            window.clearTimeout(timeoutId)
        }
    }, [cacheKey, content, deferInitialRender, filePath, mediaMode])

    if (!renderReady) {
        return (
            <StreamingAssistantMarkdown
                content={content}
                filePath={filePath}
                className={className}
                cacheKey={`${cacheKey}:handoff`}
                onInternalLinkClick={onInternalLinkClick}
                onLinkNotice={onLinkNotice}
                mediaMode={mediaMode}
            />
        )
    }

    return (
        <MarkdownRenderer
            content={content}
            filePath={filePath}
            cacheKey={cacheKey}
            onInternalLinkClick={onInternalLinkClick}
            onLinkNotice={onLinkNotice}
            className={className}
            mediaMode={mediaMode}
        />
    )
})

export const CollapsibleUserMessageBody = memo(function CollapsibleUserMessageBody({
    content
}: CollapsibleUserMessageBodyProps) {
    const { elementRef, width } = useObservedElementWidth<HTMLDivElement>()
    const renderedBodyRef = useRef<HTMLDivElement | null>(null)
    const [renderedBodyHeight, setRenderedBodyHeight] = useState(0)
    const [showFullUserBody, setShowFullUserBody] = useState(false)

    useEffect(() => {
        setShowFullUserBody(false)
    }, [content])

    useLayoutEffect(() => {
        const node = renderedBodyRef.current
        if (!node) return

        const measure = () => setRenderedBodyHeight(Math.ceil(node.getBoundingClientRect().height))
        measure()
        if (typeof ResizeObserver === 'undefined') return
        const observer = new ResizeObserver(measure)
        observer.observe(node)
        return () => observer.disconnect()
    }, [content])

    const bodyMetrics = useMemo(
        () => measureTimelinePlainTextHeight(
            content,
            width > 0 ? width : getUserMessageBodyWidth(),
            'pre-wrap'
        ),
        [content, width]
    )

    const collapsedUserBodyMaxHeight = USER_MESSAGE_COLLAPSED_LINE_COUNT * TIMELINE_TEXT_LINE_HEIGHT
    const expandedBodyHeight = Math.max(renderedBodyHeight, bodyMetrics.height)
    const shouldCollapseUserBody = bodyMetrics.lineCount > USER_MESSAGE_COLLAPSED_LINE_COUNT
        || renderedBodyHeight > collapsedUserBodyMaxHeight + 1

    return (
        <div ref={elementRef}>
            <div
                className="motion-reduce:transition-none"
                style={shouldCollapseUserBody
                    ? {
                        maxHeight: `${showFullUserBody ? expandedBodyHeight : collapsedUserBodyMaxHeight}px`,
                        overflow: 'hidden',
                        transition: 'max-height 240ms cubic-bezier(0.16, 1, 0.3, 1)'
                    }
                    : undefined}
            >
                <div ref={renderedBodyRef}>
                    <MarkdownRenderer
                        content={content}
                        className="text-[13px] leading-6 text-sparkle-text [overflow-wrap:anywhere] [&_h1]:text-sparkle-text [&_h2]:text-sparkle-text [&_h3]:text-sparkle-text [&_li]:whitespace-pre-wrap [&_li]:leading-6 [&_li]:text-sparkle-text [&_p]:whitespace-pre-wrap [&_p]:leading-6 [&_p]:text-sparkle-text"
                    />
                </div>
            </div>
            {shouldCollapseUserBody ? (
                <button
                    type="button"
                    onClick={() => setShowFullUserBody((current) => !current)}
                    className="mt-2 text-[12px] text-sparkle-text-muted transition-colors hover:text-sparkle-text"
                >
                    {showFullUserBody ? 'Show less' : 'Show more'}
                </button>
            ) : null}
        </div>
    )
})
