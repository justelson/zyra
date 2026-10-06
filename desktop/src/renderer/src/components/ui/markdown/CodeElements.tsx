import { Component, lazy, memo, startTransition, Suspense, useEffect, useId, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import { Check, ChevronUp, Copy, WrapText } from 'lucide-react'
import SyntaxHighlighter from 'react-syntax-highlighter/dist/esm/prism'
import oneDark from 'react-syntax-highlighter/dist/esm/styles/prism/one-dark'
import oneLight from 'react-syntax-highlighter/dist/esm/styles/prism/one-light'
import { FileEntryIcon } from '@/components/ui/FileEntryIcon'
import { hasColorToken, renderColorAwareText } from './colorTokens'
import { isMarkdownScrollBusy } from './markdownScrollActivity'
import { copyTextToClipboard as copyCodeBlockText } from '@/lib/copy-text'

const MermaidDiagram = lazy(async () => ({
    default: (await import('./MermaidDiagram')).MermaidDiagram
}))

const MAX_HIGHLIGHT_CACHE_ENTRIES = 160
const MAX_HIGHLIGHT_CACHE_CHARACTERS = 2_000_000
const highlightedCodeCache = new Map<string, { source: string; node: ReactNode }>()
let highlightedCodeCharacters = 0
let codeHighlightCompilationCount = 0
const deferredHighlightQueue = new Map<string, () => void>()
let deferredHighlightIdle: number | null = null
let deferredHighlightTimer: number | null = null

function scheduleDeferredHighlight(): void {
    if (deferredHighlightIdle !== null || deferredHighlightTimer !== null || typeof window === 'undefined') return
    const runNext = (hasBudget = true) => {
        deferredHighlightIdle = null
        deferredHighlightTimer = null
        if (!hasBudget) {
            deferredHighlightTimer = window.setTimeout(() => {
                deferredHighlightTimer = null
                scheduleDeferredHighlight()
            }, 140)
            return
        }
        const next = deferredHighlightQueue.entries().next().value as [string, () => void] | undefined
        if (!next) return
        deferredHighlightQueue.delete(next[0])
        next[1]()
        if (deferredHighlightQueue.size > 0) scheduleDeferredHighlight()
    }
    if (typeof window.requestIdleCallback === 'function') {
        deferredHighlightIdle = window.requestIdleCallback((deadline) => runNext(deadline.timeRemaining() >= 6 && !isMarkdownScrollBusy()))
        return
    }
    deferredHighlightTimer = window.setTimeout(() => runNext(true), 32)
}

function enqueueDeferredHighlight(key: string, run: () => void): () => void {
    deferredHighlightQueue.set(key, run)
    scheduleDeferredHighlight()
    return () => deferredHighlightQueue.delete(key)
}

function createFlatCodeTheme(theme: 'light' | 'dark') {
    return Object.fromEntries(
        Object.entries(theme === 'light' ? oneLight : oneDark).map(([selector, style]) => [
            selector,
            {
                ...(style as Record<string, unknown>),
                background: 'transparent',
                backgroundColor: 'transparent',
                textShadow: 'none'
            }
        ])
    )
}

const FLAT_CODE_THEMES = {
    light: createFlatCodeTheme('light'),
    dark: createFlatCodeTheme('dark')
} as const

class CodeHighlightErrorBoundary extends Component<{
    fallback: ReactNode
    children: ReactNode
}, { failed: boolean }> {
    state = { failed: false }

    static getDerivedStateFromError() {
        return { failed: true }
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.warn('Markdown code highlighting failed; using plain text.', error, info.componentStack)
    }

    render() {
        return this.state.failed ? this.props.fallback : this.props.children
    }
}

const TREE_HINTS = ['\u251c\u2500\u2500', '\u2514\u2500\u2500', '\u2502']
const TREE_GLYPH_REGEX = /[\u251c\u2514\u2502\u2500\u252c\u2534\u253c]/
const TREE_LINE_REGEX = /^([\s\u251c\u2514\u2502\u2500\u252c\u2534\u253c]*(?:\u251c\u2500\u2500|\u2514\u2500\u2500|\u2502\s+)?)(.*?)$/
const CODE_HIGHLIGHT_CHAR_LIMIT = 12_000
const CODE_HIGHLIGHT_LINE_LIMIT = 350
const SYNTAX_CUSTOM_STYLE = {
    margin: 0,
    padding: '1rem',
    background: 'var(--color-card)',
    fontSize: '0.875rem',
    lineHeight: '1.6'
}
const SYNTAX_LINE_NUMBER_STYLE = { color: 'var(--color-text-muted)', paddingRight: '1rem' }
const SYNTAX_LINE_PROPS = { style: { background: 'transparent', display: 'block', width: '100%' } }

function codeFingerprint(source: string): string {
    let hash = 2166136261
    for (let index = 0; index < source.length; index += 1) {
        hash ^= source.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
    }
    return `${source.length}:${(hash >>> 0).toString(36)}`
}

function retainHighlightedCode(key: string, source: string, node: ReactNode): ReactNode {
    const previous = highlightedCodeCache.get(key)
    if (previous) highlightedCodeCharacters -= previous.source.length
    highlightedCodeCache.set(key, { source, node })
    highlightedCodeCharacters += source.length
    while (highlightedCodeCache.size > MAX_HIGHLIGHT_CACHE_ENTRIES || highlightedCodeCharacters > MAX_HIGHLIGHT_CACHE_CHARACTERS) {
        const oldest = highlightedCodeCache.entries().next().value as [string, { source: string; node: ReactNode }] | undefined
        if (!oldest) break
        highlightedCodeCache.delete(oldest[0])
        highlightedCodeCharacters -= oldest[1].source.length
    }
    return node
}

export function getCodeHighlightCacheStats(): { entries: number; compilations: number } {
    return { entries: highlightedCodeCache.size, compilations: codeHighlightCompilationCount }
}

function codeHighlightKey(language: string | undefined, source: string, showLineNumbers: boolean, theme: 'light' | 'dark'): string {
    return `${theme}:${language || 'text'}:${showLineNumbers ? 'lines' : 'plain'}:${codeFingerprint(source)}`
}

function readPreparedCodeHighlight(language: string | undefined, source: string, showLineNumbers: boolean, theme: 'light' | 'dark'): ReactNode | null {
    const key = codeHighlightKey(language, source, showLineNumbers, theme)
    const cached = highlightedCodeCache.get(key)
    if (!cached || cached.source !== source) return null
    highlightedCodeCache.delete(key)
    highlightedCodeCache.set(key, cached)
    return cached.node
}

export function prepareCodeHighlight(
    language: string | undefined,
    source: string,
    showLineNumbers: boolean,
    theme: 'light' | 'dark' = 'dark'
): ReactNode {
    const key = codeHighlightKey(language, source, showLineNumbers, theme)
    const cached = highlightedCodeCache.get(key)
    if (cached?.source === source) {
        highlightedCodeCache.delete(key)
        highlightedCodeCache.set(key, cached)
        return cached.node
    }

    codeHighlightCompilationCount += 1
    const renderHighlighter = SyntaxHighlighter as unknown as (props: Record<string, unknown>) => ReactNode
    return retainHighlightedCode(key, source, renderHighlighter({
        language: language || 'text',
        style: FLAT_CODE_THEMES[theme],
        customStyle: SYNTAX_CUSTOM_STYLE,
        showLineNumbers,
        lineNumberStyle: SYNTAX_LINE_NUMBER_STYLE,
        wrapLines: true,
        lineProps: SYNTAX_LINE_PROPS,
        children: source
    }))
}

function DeferredCodeHighlight({
    language,
    source,
    showLineNumbers,
    theme,
    defer
}: {
    language?: string
    source: string
    showLineNumbers: boolean
    theme: 'light' | 'dark'
    defer: boolean
}) {
    const instanceId = useId()
    const key = codeHighlightKey(language, source, showLineNumbers, theme)
    const cachedNode = readPreparedCodeHighlight(language, source, showLineNumbers, theme)
    const [prepared, setPrepared] = useState<{ key: string; node: ReactNode } | null>(null)
    const activeNode = prepared?.key === key ? prepared.node : cachedNode

    useEffect(() => {
        if (!defer || activeNode) return
        return enqueueDeferredHighlight(`${instanceId}:${key}`, () => {
            const node = prepareCodeHighlight(language, source, showLineNumbers, theme)
            startTransition(() => setPrepared({ key, node }))
        })
    }, [activeNode, defer, instanceId, key, language, showLineNumbers, source, theme])

    if (!defer) return prepareCodeHighlight(language, source, showLineNumbers, theme)
    if (activeNode) return activeNode
    return (
        <pre className="m-0 overflow-x-auto bg-sparkle-card p-4">
            <code className="whitespace-pre text-sm font-mono leading-6 text-sparkle-text-dark">{source}</code>
        </pre>
    )
}

function looksLikeFolderStructure(text: string): boolean {
    if (TREE_HINTS.some((hint) => text.includes(hint))) return true
    return TREE_GLYPH_REGEX.test(text)
}

export { copyTextToClipboard as copyCodeBlockText } from '@/lib/copy-text'

export function prewarmCodeBlockHighlight(language: string | undefined, source: string, maxLines?: number): void {
    if (language === 'mermaid' || looksLikeFolderStructure(source) || hasColorToken(source)) return
    const lines = source.split('\n')
    const lineLimit = Number.isFinite(maxLines) && Number(maxLines) > 0 ? Math.floor(Number(maxLines)) : 0
    const visibleLines = lineLimit > 0 && lines.length > lineLimit ? lines.slice(0, lineLimit) : lines
    const visibleText = visibleLines.join('\n')
    if (visibleText.length > CODE_HIGHLIGHT_CHAR_LIMIT || visibleLines.length > CODE_HIGHLIGHT_LINE_LIMIT) return
    prepareCodeHighlight(language, visibleText, lines.length > 3 && visibleLines.length <= 200)
}

export const CodeBlock = memo(function CodeBlock({
    language,
    title,
    theme = 'dark',
    children,
    maxLines,
    deferHighlighting = false
}: {
    language?: string
    title?: string | null
    theme?: 'light' | 'dark'
    children: string
    maxLines?: number
    deferHighlighting?: boolean
}) {
    const [copied, setCopied] = useState(false)
    const [expanded, setExpanded] = useState(false)
    const [wrapped, setWrapped] = useState(false)
    const codeBlockRef = useRef<HTMLDivElement | null>(null)
    const copiedTimerRef = useRef<number | null>(null)

    useEffect(() => () => {
        if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current)
    }, [])

    const handleCopy = async () => {
        try {
            await copyCodeBlockText(children)
            setCopied(true)
            if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current)
            copiedTimerRef.current = window.setTimeout(() => setCopied(false), 2000)
        } catch {
            setCopied(false)
        }
    }

    if (language === 'mermaid') {
        return (
            <div className="my-4">
                <Suspense fallback={(
                    <div className="flex min-h-40 items-center justify-center rounded-lg border border-white/10 bg-sparkle-card text-xs text-sparkle-text-muted">
                        <span className="animate-pulse">Preparing diagram…</span>
                    </div>
                )}>
                    <MermaidDiagram chart={children} />
                </Suspense>
            </div>
        )
    }

    const isFolderStructure = looksLikeFolderStructure(children)
    const displayLanguage = language || (isFolderStructure ? 'structure' : 'code')
    const hasColorPreviewTokens = hasColorToken(children)
    const normalizedLines = children.split('\n')
    const lineLimit = Number.isFinite(maxLines) && Number(maxLines) > 0 ? Math.floor(Number(maxLines)) : 0
    const shouldCollapse = lineLimit > 0 && normalizedLines.length > lineLimit
    const visibleLines = shouldCollapse && !expanded ? normalizedLines.slice(0, lineLimit) : normalizedLines
    const visibleText = visibleLines.join('\n')
    const shouldUsePlainCodeView = visibleText.length > CODE_HIGHLIGHT_CHAR_LIMIT || visibleLines.length > CODE_HIGHLIGHT_LINE_LIMIT
    const showLineNumbers = normalizedLines.length > 3 && visibleLines.length <= 200
    const hiddenLineCount = Math.max(0, normalizedLines.length - lineLimit)
    const estimatedLineHeight = 26
    const collapsedMaxHeight = lineLimit > 0 ? (lineLimit * estimatedLineHeight) + 36 : undefined
    const expandedMaxHeight = shouldCollapse ? Math.max((normalizedLines.length * estimatedLineHeight) + 48, 320) : undefined

    const handleExpand = () => {
        setExpanded(true)
    }

    const handleCollapse = () => {
        setExpanded(false)
        requestAnimationFrame(() => {
            codeBlockRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        })
    }

    return (
        <div
            ref={codeBlockRef}
            className="markdown-code-block relative my-4 overflow-hidden rounded-lg border border-white/10 bg-sparkle-card"
            data-language={language || 'code'}
            data-wrap={wrapped ? 'true' : 'false'}
        >
            <div className="flex min-h-9 items-center justify-between gap-3 border-b border-white/10 bg-white/[0.03] px-3 py-1.5" data-markdown-chrome="">
                <span className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-sparkle-text-secondary">
                    {title ? <FileEntryIcon pathValue={title} kind="file" theme={theme} loading="lazy" className="size-3.5" /> : null}
                    <span className="truncate">{title || displayLanguage}</span>
                </span>
                <span className="flex shrink-0 items-center gap-0.5">
                    <button
                        type="button"
                        onClick={() => setWrapped((value) => !value)}
                        className="markdown-chrome-action"
                        aria-pressed={wrapped}
                        aria-label={wrapped ? 'Disable line wrap' : 'Wrap lines'}
                        title={wrapped ? 'Disable line wrap' : 'Wrap lines'}
                    >
                        <WrapText size={13} />
                    </button>
                    <button
                        type="button"
                        onClick={handleCopy}
                        className="markdown-chrome-action"
                        aria-label={copied ? 'Copied' : 'Copy code'}
                        title={copied ? 'Copied' : 'Copy code'}
                    >
                        {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
                    </button>
                </span>
            </div>

            <div
                className="relative overflow-hidden transition-[max-height] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
                style={
                    shouldCollapse
                        ? { maxHeight: expanded ? expandedMaxHeight : collapsedMaxHeight }
                        : undefined
                }
            >
                {shouldCollapse ? (
                    <div
                        className={`pointer-events-none absolute right-3 top-3 z-10 transition-all duration-250 ${
                            expanded ? 'translate-y-0 opacity-100' : '-translate-y-1 opacity-0'
                        }`}
                    >
                        <button
                            type="button"
                            onClick={handleCollapse}
                            className="pointer-events-auto inline-flex items-center gap-1 rounded-md border border-[var(--accent-primary)]/50 bg-sparkle-bg/90 px-2 py-1 text-[11px] font-semibold text-[var(--accent-primary)] backdrop-blur-sm transition-colors hover:bg-[var(--accent-primary)]/15"
                        >
                            <ChevronUp size={12} />
                            Show less
                        </button>
                    </div>
                ) : null}

                {isFolderStructure ? (
                    <pre className="m-0 overflow-x-auto bg-sparkle-card p-4">
                        <code className="whitespace-pre text-sm font-mono leading-6">
                            {visibleLines.map((line, index) => {
                                const match = line.match(TREE_LINE_REGEX)
                                if (!match) {
                                    return (
                                        <div key={index} className="text-sparkle-text-dark">
                                            {line}
                                        </div>
                                    )
                                }

                                const [, prefix, name] = match
                                const trimmedName = name.trim()
                                const isFolder = trimmedName.endsWith('/') || (!trimmedName.includes('.') && trimmedName.length > 0)

                                return (
                                    <div key={index} className="hover:bg-white/[0.03]">
                                        <span className="text-sparkle-text-muted">{prefix}</span>
                                        <span className={isFolder ? 'text-blue-400' : 'text-emerald-400'}>{name}</span>
                                    </div>
                                )
                            })}
                        </code>
                    </pre>
                ) : hasColorPreviewTokens ? (
                    <pre className="m-0 overflow-x-auto bg-sparkle-card p-4">
                        <code className="whitespace-pre text-sm font-mono leading-6 text-sparkle-text-dark">
                            {visibleLines.map((line, index) => (
                                <div key={index} className="-mx-4 px-4 hover:bg-white/[0.03]">
                                    {line.length > 0 ? renderColorAwareText(line, `code-color-${index}`) : '\u00A0'}
                                </div>
                            ))}
                        </code>
                    </pre>
                ) : shouldUsePlainCodeView ? (
                    <pre className="m-0 overflow-x-auto bg-sparkle-card p-4">
                        <code className="whitespace-pre text-sm font-mono leading-6 text-sparkle-text-dark">
                            {visibleText}
                        </code>
                    </pre>
                ) : (
                    <CodeHighlightErrorBoundary
                        key={`${theme}:${language || 'text'}:${codeFingerprint(visibleText)}`}
                        fallback={(
                            <pre className="m-0 overflow-x-auto bg-sparkle-card p-4">
                                <code className="whitespace-pre text-sm font-mono leading-6 text-sparkle-text-dark">{visibleText}</code>
                            </pre>
                        )}
                    >
                        <DeferredCodeHighlight
                            language={language}
                            source={visibleText}
                            showLineNumbers={showLineNumbers}
                            theme={theme}
                            defer={deferHighlighting}
                        />
                    </CodeHighlightErrorBoundary>
                )}
            </div>

            {shouldCollapse && !expanded ? (
                <div className="border-t border-white/10 bg-white/[0.03] px-4 py-2">
                    <button
                        type="button"
                        onClick={handleExpand}
                        className="text-xs font-medium text-[var(--accent-primary)] transition-colors hover:text-sparkle-text"
                    >
                        {`Read more (${hiddenLineCount} more lines)`}
                    </button>
                </div>
            ) : null}
        </div>
    )
}, (previous, next) => (
    previous.language === next.language
    && previous.title === next.title
    && previous.theme === next.theme
    && previous.children === next.children
    && previous.maxLines === next.maxLines
    && previous.deferHighlighting === next.deferHighlighting
))

export const InlineCode = memo(function InlineCode({ children }: { children: ReactNode }) {
    const text = String(children)
    const isFolderStructure =
        text.includes('\u251c\u2500\u2500')
        || text.includes('\u2514\u2500\u2500')
        || text.includes('\u2502')
        || (text.includes('/') && text.split('\n').length > 2)

    if (isFolderStructure) {
        return (
            <pre className="my-4 overflow-x-auto rounded-lg border border-white/10 bg-sparkle-card p-4">
                <code className="whitespace-pre text-sm font-mono leading-relaxed text-sparkle-text-dark">
                    {text.split('\n').map((line, index) => {
                        const match = line.match(/^([\s\u251c\u2514\u2502\u2500]+)?(.+)$/)
                        if (!match) return <div key={index}>{line}</div>

                        const [, prefix = '', name] = match
                        const isFolder = name.endsWith('/')

                        return (
                            <div key={index} className="-mx-4 px-4 hover:bg-white/[0.03]">
                                <span className="text-sparkle-text-muted">{prefix}</span>
                                <span className={isFolder ? 'text-blue-400' : 'text-green-400'}>{name}</span>
                            </div>
                        )
                    })}
                </code>
            </pre>
        )
    }

    return (
        <code className="mx-0.5 rounded border border-white/10 bg-sparkle-accent px-1.5 py-0.5 text-sm font-mono text-pink-300">
            {renderColorAwareText(text, 'inline-code', true)}
        </code>
    )
}, (previous, next) => String(previous.children) === String(next.children))
