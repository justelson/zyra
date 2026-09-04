import type { Components } from 'react-markdown'
import { Children, Fragment, cloneElement, isValidElement, useEffect, useState, type HTMLAttributes, type ImgHTMLAttributes, type ReactNode } from 'react'
import { AlertTriangle, ImageOff, Info, Lightbulb, Link2, ShieldAlert, Siren, VideoOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CodeBlock, InlineCode } from './CodeElements'
import { renderColorAwareChildren } from './colorTokens'
import { MarkdownExternalLinkContent, MarkdownFileTagContent } from './InlineTargets'
import { MarkdownTable } from './MarkdownTable'
import { looksLikeMarkdownFileReference, resolveMarkdownPackageReference } from './fileReferences'
import { resolveImageSrc, resolveImageSrcSet } from './paths'
import { resolveMarkdownLinkTarget } from './linkNavigation'

type DivProps = HTMLAttributes<HTMLDivElement> & { align?: string }
type SourceProps = HTMLAttributes<HTMLSourceElement> & { src?: string; srcSet?: string }
type ParagraphProps = HTMLAttributes<HTMLParagraphElement> & { align?: string }
type HeadingProps = HTMLAttributes<HTMLHeadingElement> & { align?: string }
type MarkdownMediaMode = 'none' | 'images' | 'images-and-videos'

type MarkdownAlertType = 'tip' | 'note' | 'important' | 'warning' | 'caution'

const FENCE_TITLE_ATTR_REGEX = /(?:^|\s)(?:title|file(?:name)?)=(?:"([^"]+)"|'([^']+)'|(\S+))/i
const FENCE_FILENAME_TOKEN_REGEX = /^[\w@][\w@./-]*\.[A-Za-z0-9]+$/

function extractFenceTitle(meta: unknown): string | null {
    const value = typeof meta === 'string' ? meta.trim() : ''
    if (!value) return null
    const attributeMatch = FENCE_TITLE_ATTR_REGEX.exec(value)
    const attributeTitle = attributeMatch?.[1] ?? attributeMatch?.[2] ?? attributeMatch?.[3]
    if (attributeTitle) return attributeTitle
    return value.split(/\s+/).find((candidate) => FENCE_FILENAME_TOKEN_REGEX.test(candidate)) ?? null
}

const MARKDOWN_ALERT_META: Record<MarkdownAlertType, {
    label: string
    icon: typeof Lightbulb
    className: string
}> = {
    tip: {
        label: 'Tip',
        icon: Lightbulb,
        className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
    },
    note: {
        label: 'Note',
        icon: Info,
        className: 'border-sky-500/30 bg-sky-500/10 text-sky-100'
    },
    important: {
        label: 'Important',
        icon: ShieldAlert,
        className: 'border-violet-500/30 bg-violet-500/10 text-violet-100'
    },
    warning: {
        label: 'Warning',
        icon: AlertTriangle,
        className: 'border-amber-500/30 bg-amber-500/10 text-amber-100'
    },
    caution: {
        label: 'Caution',
        icon: Siren,
        className: 'border-rose-500/30 bg-rose-500/10 text-rose-100'
    }
}

function flattenNodeText(node: ReactNode): string {
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (!node) return ''
    if (Array.isArray(node)) return node.map(flattenNodeText).join('')
    if (isValidElement<{ children?: ReactNode }>(node)) return flattenNodeText(node.props.children)
    return ''
}

function detectMarkdownAlert(children: ReactNode): {
    type: MarkdownAlertType
    children: ReactNode
} | null {
    const childArray = Children.toArray(children)
    if (childArray.length === 0) return null

    const firstMeaningfulIndex = childArray.findIndex((child) => flattenNodeText(child).trim().length > 0)
    if (firstMeaningfulIndex < 0) return null

    const firstChild = childArray[firstMeaningfulIndex]
    const firstChildText = flattenNodeText(firstChild).trim()
    const match = firstChildText.match(/^\[!(TIP|NOTE|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i)
    if (!match) return null

    const type = match[1].toLowerCase() as MarkdownAlertType
    const remainder = match[2]?.trim() || ''
    const nextChildren = [...childArray]

    if (remainder && isValidElement<{ children?: ReactNode }>(firstChild)) {
        nextChildren[firstMeaningfulIndex] = cloneElement(firstChild, undefined, remainder)
    } else if (remainder) {
        nextChildren[firstMeaningfulIndex] = remainder
    } else {
        nextChildren.splice(firstMeaningfulIndex, 1)
    }

    return {
        type,
        children: nextChildren
    }
}

function getAlignmentClass(align?: string): string | null {
    const normalized = String(align || '').trim().toLowerCase()
    if (normalized === 'center') return 'text-center items-center'
    if (normalized === 'right') return 'text-right items-end'
    if (normalized === 'left') return 'text-left items-start'
    return null
}

function HeadingPermalink({ id }: { id?: string }) {
    if (!id || id === 'footnote-label' || id.endsWith('-footnote-label')) return null
    return (
        <button
            type="button"
            data-markdown-heading-target={id}
            className="ml-2 inline-flex translate-y-[1px] items-center text-sparkle-text-muted/0 transition-colors hover:text-[var(--accent-primary)] focus:text-[var(--accent-primary)] focus:outline-none group-hover/heading:text-sparkle-text-muted/55"
            aria-label="This section is already in view"
            title="This section is already in view"
        >
            <Link2 size={14} />
        </button>
    )
}

const MARKDOWN_VIDEO_EXTENSION_PATTERN = /\.(?:mp4|webm|ogv|mov|m4v)(?:[?#].*)?$/i

function isMarkdownVideoHref(value: string): boolean {
    return MARKDOWN_VIDEO_EXTENSION_PATTERN.test(value.trim())
}

function MarkdownVideo(props: {
    href: string
    label: string
    filePath?: string
}) {
    const resolvedSource = resolveImageSrc(props.href, props.filePath)
    const [failedSource, setFailedSource] = useState<string | null>(null)

    useEffect(() => {
        setFailedSource((current) => current === resolvedSource ? current : null)
    }, [resolvedSource])

    if (failedSource === resolvedSource) {
        return (
            <span className="markdown-video-unavailable" data-markdown-copy={`[${props.label}](${props.href})`}>
                <VideoOff size={17} aria-hidden="true" />
                <span>{props.label || 'Video unavailable'}</span>
            </span>
        )
    }

    return (
        <span className="markdown-video-frame" data-markdown-copy={`[${props.label}](${props.href})`}>
            <video
                controls
                preload="metadata"
                playsInline
                src={resolvedSource}
                data-markdown-video-target={props.href}
                aria-label={props.label || 'Video'}
                onError={() => setFailedSource(resolvedSource)}
            >
                <a href={resolvedSource}>Open video</a>
            </video>
            {props.label ? <span className="markdown-video-caption">{props.label}</span> : null}
        </span>
    )
}

function MarkdownImage({
    src,
    rawSrc,
    alt,
    className,
    onError,
    ...props
}: ImgHTMLAttributes<HTMLImageElement> & { rawSrc?: string }) {
    const resolvedSource = resolveImageSrc(String(src || ''))
    const targetSource = String(rawSrc || src || '').trim()
    const [failedSource, setFailedSource] = useState<string | null>(null)
    const [loadedSource, setLoadedSource] = useState<string | null>(null)

    useEffect(() => {
        setLoadedSource((current) => current === resolvedSource ? current : null)
    }, [resolvedSource])

    if (failedSource === resolvedSource) {
        return (
            <span
                role="img"
                aria-label={alt ? `Image unavailable: ${alt}` : 'Image unavailable'}
                data-markdown-copy={`![${alt || ''}](${targetSource})`}
                className="my-4 flex min-h-24 max-w-full items-center gap-3 rounded-lg border border-dashed border-sparkle-border-secondary bg-sparkle-bg/55 px-4 py-3 text-sparkle-text-muted"
            >
                <ImageOff size={18} className="shrink-0 opacity-70" />
                <span className="min-w-0 truncate text-xs">{alt || 'Image unavailable'}</span>
            </span>
        )
    }

    return (
        <span className="markdown-image-frame" data-markdown-copy={`![${alt || ''}](${targetSource})`}>
            <span
                role="button"
                tabIndex={0}
                data-markdown-image-target={targetSource}
                className="markdown-image-open"
                aria-label={alt ? `Open image: ${alt}` : 'Open image'}
                title="Open image"
            >
                {loadedSource !== resolvedSource ? (
                    <span className="markdown-image-loading" aria-hidden="true" />
                ) : null}
                <img
                    {...props}
                    src={resolvedSource}
                    alt={alt || ''}
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                    className={cn('h-auto max-w-full rounded-lg border border-white/10', className)}
                    onLoad={() => setLoadedSource(resolvedSource)}
                    onError={(event) => {
                        onError?.(event)
                        setFailedSource(resolvedSource)
                    }}
                />
                <span className="markdown-image-open-label" aria-hidden="true">Open image</span>
            </span>
        </span>
    )
}

export function createMarkdownComponents(
    filePath?: string,
    options?: {
        codeBlockMaxLines?: number
        plainCodeBlocks?: boolean
        deferCodeHighlighting?: boolean
        visualTheme?: 'light' | 'dark'
        onInternalLinkClick?: (href: string) => Promise<boolean | void> | boolean | void
        mediaMode?: MarkdownMediaMode
    }
): Components {
    return {
        h1: ({ children, className, align, id, ...props }: HeadingProps) => (
            <h1 id={id} className={cn('group/heading scroll-mt-20 mt-8 mb-4 border-b border-white/10 pb-2 text-2xl font-bold text-sparkle-text first:mt-0', getAlignmentClass(align), className)} {...props}>
                {children}<HeadingPermalink id={id} />
            </h1>
        ),
        div: ({ className, ...props }: DivProps) => {
            const alignmentClass = getAlignmentClass(props.align)
            return <div className={cn(className, alignmentClass && 'flex flex-col', alignmentClass)} {...props} />
        },
        h2: ({ children, className, align, id, ...props }: HeadingProps) => (
            <h2 id={id} className={cn('group/heading scroll-mt-20 mt-8 mb-3 border-b border-white/10 pb-2 text-xl font-semibold text-sparkle-text first:mt-0', getAlignmentClass(align), className)} {...props}>
                {children}<HeadingPermalink id={id} />
            </h2>
        ),
        h3: ({ children, className, align, id, ...props }: HeadingProps) => (
            <h3 id={id} className={cn('group/heading scroll-mt-20 text-lg font-semibold text-sparkle-text mt-6 mb-3 first:mt-0', getAlignmentClass(align), className)} {...props}>
                {children}<HeadingPermalink id={id} />
            </h3>
        ),
        h4: ({ children, className, align, id, ...props }: HeadingProps) => (
            <h4 id={id} className={cn('group/heading scroll-mt-20 text-base font-semibold text-sparkle-text mt-4 mb-2', getAlignmentClass(align), className)} {...props}>
                {children}<HeadingPermalink id={id} />
            </h4>
        ),
        h5: ({ children, className, align, id, ...props }: HeadingProps) => (
            <h5 id={id} className={cn('group/heading scroll-mt-20 text-sm font-semibold text-sparkle-text mt-4 mb-2', getAlignmentClass(align), className)} {...props}>
                {children}<HeadingPermalink id={id} />
            </h5>
        ),
        h6: ({ children, className, align, id, ...props }: HeadingProps) => (
            <h6 id={id} className={cn('group/heading scroll-mt-20 text-sm font-semibold text-sparkle-text-dark mt-4 mb-2', getAlignmentClass(align), className)} {...props}>
                {children}<HeadingPermalink id={id} />
            </h6>
        ),
        p: ({ children, className, align, ...props }: ParagraphProps) => (
            <p className={cn('text-sparkle-text-dark leading-relaxed mb-4 last:mb-0 break-words [overflow-wrap:break-word]', getAlignmentClass(align), className)} {...props}>
                {renderColorAwareChildren(children, 'p')}
            </p>
        ),
        a: ({ href, children }) => {
            const rawHref = String(href || '').trim()
            const isAnchorLink = rawHref.startsWith('#')
            const internalTarget = rawHref ? resolveMarkdownLinkTarget(rawHref, filePath) : null
            const childText = flattenNodeText(children).trim()
            const renderedChildren = renderColorAwareChildren(children, 'a')

            if (options?.mediaMode === 'images-and-videos' && isMarkdownVideoHref(rawHref)) {
                return <MarkdownVideo href={rawHref} label={childText} filePath={filePath} />
            }

            if (isAnchorLink) {
                return (
                    <a
                        href={href}
                        draggable={false}
                        className="text-[var(--accent-primary)] hover:text-white hover:underline"
                    >
                        {renderedChildren}
                    </a>
                )
            }

            if (internalTarget) return (
                <a
                    href={href}
                    draggable={false}
                    data-markdown-file-link=""
                    data-markdown-copy={`[${flattenNodeText(children) || rawHref}](${rawHref})`}
                    className="markdown-inline-file-tag"
                >
                    <MarkdownFileTagContent
                        pathValue={internalTarget.path}
                        theme={options?.visualTheme || 'dark'}
                        focusLine={internalTarget.focusLine}
                        displayPath={looksLikeMarkdownFileReference(childText) ? childText.replace(/:\d+(?::\d+)?$/, '') : undefined}
                    >
                        {renderedChildren}
                    </MarkdownFileTagContent>
                </a>
            )

            const linkedPackage = resolveMarkdownPackageReference(flattenNodeText(children).trim())
            if (linkedPackage) {
                return (
                    <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        draggable={false}
                        data-markdown-package-link={linkedPackage.packageName}
                        data-markdown-copy={`[\`${linkedPackage.specifier}\`](${rawHref})`}
                        className="markdown-inline-package-tag"
                        title={rawHref || undefined}
                    >
                        <MarkdownExternalLinkContent href={rawHref}>
                            <code>{linkedPackage.specifier}</code>
                        </MarkdownExternalLinkContent>
                    </a>
                )
            }

            return (
                <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    draggable={false}
                    title={rawHref || undefined}
                    className="text-blue-400 hover:text-blue-300 hover:underline"
                >
                    <MarkdownExternalLinkContent href={rawHref}>{renderedChildren}</MarkdownExternalLinkContent>
                </a>
            )
        },
        strong: ({ children }) => (
            <strong className="font-semibold text-sparkle-text">
                {renderColorAwareChildren(children, 'strong')}
            </strong>
        ),
        em: ({ children }) => (
            <em className="italic text-sparkle-text-dark">{renderColorAwareChildren(children, 'em')}</em>
        ),
        code: ({ className, children, ...codeProps }) => {
            const match = /(?:^|\s)language-([^\s]+)/.exec(className || '')
            const isInline = !match && !className

            if (isInline) {
                const text = flattenNodeText(children).trim()
                const packageTarget = resolveMarkdownPackageReference(text)
                if (packageTarget) {
                    return (
                        <a
                            href={packageTarget.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            draggable={false}
                            data-markdown-package-link={packageTarget.packageName}
                            data-markdown-copy={`\`${text}\``}
                            className="markdown-inline-package-tag"
                            title={`Open ${packageTarget.packageName} on npm`}
                        >
                            <MarkdownExternalLinkContent href={packageTarget.href}>
                                <code>{children}</code>
                            </MarkdownExternalLinkContent>
                        </a>
                    )
                }
                const internalTarget = filePath && looksLikeMarkdownFileReference(text)
                    ? resolveMarkdownLinkTarget(text, filePath)
                    : null
                if (internalTarget) {
                    const isAutoDetectedPath = Boolean(
                        (codeProps as Record<string, unknown>).dataAutoPath
                        ?? (codeProps as Record<string, unknown>)['data-auto-path']
                    )
                    return (
                        <code
                            data-devscope-file-reference={text}
                            data-markdown-copy={isAutoDetectedPath ? text : `\`${text}\``}
                            draggable={false}
                            className="markdown-inline-file-tag markdown-inline-code-file-tag"
                        >
                            <MarkdownFileTagContent
                                pathValue={internalTarget.path}
                                theme={options?.visualTheme || 'dark'}
                                focusLine={internalTarget.focusLine}
                                compact
                                displayPath={text.replace(/:\d+(?::\d+)?$/, '')}
                            >
                                {children}
                            </MarkdownFileTagContent>
                        </code>
                    )
                }
                return <InlineCode>{children}</InlineCode>
            }

            if (options?.plainCodeBlocks) {
                return (
                    <pre className="my-4 overflow-x-auto rounded-lg border border-white/10 bg-sparkle-card p-4">
                        <code className="whitespace-pre text-sm font-mono leading-6 text-sparkle-text-dark">
                            {String(children).replace(/\n$/, '')}
                        </code>
                    </pre>
                )
            }

            const metadata = (codeProps as Record<string, unknown>).dataCodeMeta
                ?? (codeProps as Record<string, unknown>)['data-code-meta']
            return (
                <CodeBlock
                    language={match?.[1]}
                    title={extractFenceTitle(metadata)}
                    theme={options?.visualTheme || 'dark'}
                    maxLines={options?.codeBlockMaxLines}
                    deferHighlighting={options?.deferCodeHighlighting}
                >
                    {String(children).replace(/\n$/, '')}
                </CodeBlock>
            )
        },
        pre: ({ children, ...props }) => {
            const childArray = Children.toArray(children)
            if (childArray.length === 1 && isValidElement(childArray[0])) {
                return <Fragment>{children}</Fragment>
            }

            return (
                <pre className="overflow-x-auto whitespace-pre rounded-lg border border-white/10 bg-sparkle-card p-4 font-mono text-sm leading-none" {...props}>
                    {children}
                </pre>
            )
        },
        ul: ({ children, className, ...props }) => {
            const isTaskList = String(className || '').includes('contains-task-list')
            return (
                <ul
                    className={cn(
                        'mb-4 text-sparkle-text-dark',
                        isTaskList ? 'ml-0 list-none space-y-2' : 'ml-6 list-outside list-disc space-y-1',
                        className
                    )}
                    {...props}
                >
                    {children}
                </ul>
            )
        },
        ol: ({ children, className, ...props }) => (
            <ol className={cn('ml-6 mb-4 list-decimal list-outside space-y-1 text-sparkle-text-dark', className)} {...props}>{children}</ol>
        ),
        li: ({ children, className, ...props }) => (
            <li className={cn('leading-relaxed pl-1 break-words [overflow-wrap:break-word]', className)} {...props}>
                {renderColorAwareChildren(children, 'li')}
            </li>
        ),
        blockquote: ({ children }) => {
            const alert = detectMarkdownAlert(children)
            if (alert) {
                const meta = MARKDOWN_ALERT_META[alert.type]
                const Icon = meta.icon

                return (
                    <blockquote className={cn('my-4 rounded-xl border px-4 py-3', meta.className)}>
                        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                            <Icon size={16} />
                            <span>{meta.label}</span>
                        </div>
                        <div className="space-y-3 text-sm leading-relaxed text-white/88">
                            {renderColorAwareChildren(alert.children, 'blockquote')}
                        </div>
                    </blockquote>
                )
            }

            return (
                <blockquote className="my-4 rounded-r-lg border-l-4 border-blue-500/50 bg-blue-500/5 py-1 pl-4 text-sparkle-text-secondary italic">
                    {renderColorAwareChildren(children, 'blockquote')}
                </blockquote>
            )
        },
        hr: () => <hr className="my-6 border-white/10" />,
        img: ({ src, alt, ...props }) => options?.mediaMode === 'none' ? (
            <span data-markdown-media-suppressed="image">{alt || ''}</span>
        ) : (
            <MarkdownImage
                {...props}
                src={resolveImageSrc(src || '', filePath)}
                rawSrc={src || ''}
                alt={alt || ''}
            />
        ),
        picture: ({ children }) => options?.mediaMode === 'none' ? null : (
            <picture className="my-4 block max-w-full">
                {children}
            </picture>
        ),
        source: ({ src, srcSet, ...props }: SourceProps) => options?.mediaMode === 'none' ? null : (
            <source
                {...props}
                src={src ? resolveImageSrc(src, filePath) : undefined}
                srcSet={srcSet ? resolveImageSrcSet(srcSet, filePath) : undefined}
            />
        ),
        table: ({ children, className, ...props }) => (
            <MarkdownTable className={cn('w-full min-w-max border-collapse text-sm', className)} {...props}>
                {children}
            </MarkdownTable>
        ),
        thead: ({ children, className, ...props }) => <thead className={cn('bg-sparkle-accent', className)} {...props}>{children}</thead>,
        tbody: ({ children, className, ...props }) => <tbody className={cn('markdown-table-body', className)} {...props}>{children}</tbody>,
        tr: ({ children, className, ...props }) => (
            <tr className={cn('border-b border-white/10 transition-colors last:border-0 hover:bg-sparkle-accent/70', className)} {...props}>
                {children}
            </tr>
        ),
        th: ({ children, className, ...props }) => (
            <th className={cn('whitespace-nowrap border-r border-white/10 px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-sparkle-text last:border-r-0', className)} {...props}>
                {renderColorAwareChildren(children, 'th')}
            </th>
        ),
        td: ({ children, className, ...props }) => (
            <td className={cn('border-r border-white/10 px-4 py-2.5 text-sparkle-text-dark last:border-r-0 break-words [overflow-wrap:break-word]', className)} {...props}>
                {renderColorAwareChildren(children, 'td')}
            </td>
        ),
        details: ({ children, className, ...props }) => (
            <details data-markdown-details="" className={cn('markdown-details my-4', className)} {...props}>
                {children}
            </details>
        ),
        summary: ({ children, className, ...props }) => (
            <summary className={cn('markdown-details-summary', className)} {...props}>{children}</summary>
        ),
        input: ({ type, checked, disabled, className, ...props }) => {
            if (type !== 'checkbox') return null

            return (
                <input
                    {...props}
                    type="checkbox"
                    checked={checked}
                    disabled={disabled ?? true}
                    readOnly
                    className={cn('mr-2 size-3.5 translate-y-[1px] rounded border-white/15 bg-transparent accent-[var(--accent-primary)]', className)}
                />
            )
        },
        del: ({ children }) => <del className="text-sparkle-text-secondary line-through">{children}</del>
    }
}
