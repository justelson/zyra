import { defaultThemeTokens } from '@shared/preferences/default-theme-tokens'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { RefreshCw, MessageSquare } from 'lucide-react'
import { diffCodeSelection } from './diff-code-selection'
import { requestCodeContext, type CodeSelectionSnapshot } from '@/pages/assistant/assistant-code-context'
import { FileDiff, PatchDiff } from '@pierre/diffs/react'
import type { FileDiffMetadata } from '@pierre/diffs/react'
import { resolveDiffThemeName, resolveDiffThemeType } from '@/lib/diffRendering'
import { useSettings } from '@/lib/settings'
import { DiffWorkerPoolProvider } from './DiffWorkerPoolProvider'
import { ensureDiffContainerStyles } from './ensureDiffContainerStyles'

type DiffRenderMode = 'stacked' | 'split'
const EMPTY_FILE_DIFFS: FileDiffMetadata[] = []

interface PatchDiffViewerProps {
    fileDiff?: FileDiffMetadata | null
    fileDiffs?: FileDiffMetadata[]
    patch?: string
    mode: DiffRenderMode
    flush?: boolean
    hideChangeIcon?: boolean
    hideHeaderStats?: boolean
    headerPrefix?: ReactNode
    headerMetadata?: ReactNode
    renderFileHeaderPrefix?: (fileDiff: FileDiffMetadata, index: number) => ReactNode
    renderFileHeaderMetadata?: (fileDiff: FileDiffMetadata, index: number) => ReactNode
    activeFileDiffIndex?: number | null
    activeFileDiffScrollKey?: string | number | null
    onRenderingChange?: (rendering: boolean) => void
    workspaceRoot?: string
}

function buildDiffViewerUnsafeCss(
    themeType: 'light' | 'dark',
    flush: boolean,
    hideChangeIcon: boolean,
    hideHeaderStats: boolean
): string {
    const isDark = themeType === 'dark'
    const fallback = defaultThemeTokens(themeType)
    const surface = isDark
        ? `color-mix(in lab, var(--color-card, ${fallback.card}) 84%, var(--color-bg, ${fallback.bg}))`
        : `color-mix(in lab, var(--color-card, ${fallback.card}) 94%, var(--color-bg, ${fallback.bg}))`
    const surfaceRaised = isDark
        ? `color-mix(in lab, var(--color-card, ${fallback.card}) 92%, var(--color-bg, ${fallback.bg}))`
        : `color-mix(in lab, var(--color-card, ${fallback.card}) 97%, var(--color-bg, ${fallback.bg}))`
    const headerSurface = surfaceRaised
    const surfaceMuted = isDark
        ? `color-mix(in lab, var(--color-card, ${fallback.card}) 74%, var(--color-bg, ${fallback.bg}))`
        : `color-mix(in lab, var(--color-card, ${fallback.card}) 88%, var(--color-bg, ${fallback.bg}))`
    const surfaceContext = isDark
        ? `color-mix(in lab, var(--color-card, ${fallback.card}) 78%, var(--color-bg, ${fallback.bg}))`
        : `color-mix(in lab, var(--color-card, ${fallback.card}) 90%, var(--color-bg, ${fallback.bg}))`
    const surfaceSeparator = isDark
        ? `color-mix(in lab, var(--color-card, ${fallback.card}) 68%, var(--color-bg, ${fallback.bg}))`
        : `color-mix(in lab, var(--color-card, ${fallback.card}) 84%, var(--color-bg, ${fallback.bg}))`
    const numberSurface = isDark
        ? `color-mix(in lab, var(--color-card, ${fallback.card}) 72%, var(--color-bg, ${fallback.bg}))`
        : `color-mix(in lab, var(--color-card, ${fallback.card}) 86%, var(--color-bg, ${fallback.bg}))`
    const hoverSurface = isDark
        ? `color-mix(in lab, var(--color-card, ${fallback.card}) 76%, var(--accent-primary, ${fallback.primary}))`
        : `color-mix(in lab, var(--color-card, ${fallback.card}) 88%, var(--accent-primary, ${fallback.primary}))`
    const text = `var(--color-text, ${fallback.text})`
    const mutedText = `var(--color-text-secondary, ${fallback.textSecondary})`
    const borderDefault = `color-mix(in srgb, ${text} 10%, transparent)`
    const borderSubtle = `color-mix(in srgb, ${text} 6%, transparent)`

    return `
:host {
  -webkit-font-smoothing: auto;
  text-rendering: optimizeLegibility;
  --diffs-font-family: var(--font-code, 'JetBrains Mono', Consolas, Monaco, 'Courier New', monospace);
  --diffs-header-font-family: var(--font-ui, 'Bricolage Grotesque', 'Hanken Grotesk Variable', 'Hanken Grotesk', -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', 'Helvetica Neue', 'Segoe UI', system-ui, sans-serif);
  --diffs-font-size: 12px;
  --diffs-line-height: 20px;
  --diffs-gap-inline: 12px;
  --diffs-gap-block: 10px;
  --diffs-light-bg: ${surface};
  --diffs-dark-bg: ${surface};
  --diffs-light: ${text};
  --diffs-dark: ${text};
  --diffs-bg-buffer-override: ${surfaceMuted};
  --diffs-bg-hover-override: ${hoverSurface};
  --diffs-bg-context-override: ${surfaceContext};
  --diffs-bg-context-number-override: ${numberSurface};
  --diffs-bg-separator-override: ${surfaceSeparator};
  --diffs-fg-number-override: ${mutedText};
  --diffs-addition-color-override: var(--status-success, #73c991);
  --diffs-deletion-color-override: var(--status-danger, #ff6b6b);
  --diffs-modified-color-override: var(--accent-primary, #60a5fa);
  --diffs-selection-color-override: var(--accent-primary, #60a5fa);
  --diffs-bg-selection-override: color-mix(in lab, ${surface} 82%, var(--accent-primary, #60a5fa));
  --diffs-bg-selection-number-override: color-mix(in lab, ${surface} 72%, var(--accent-primary, #60a5fa));
}

[data-diffs-header],
[data-diff],
[data-file],
[data-error-wrapper],
[data-virtualizer-buffer] {
  background: ${surface};
  border-inline: 1px solid ${borderDefault};
}

[data-file-info] {
  padding: 12px 14px;
  color: ${text};
  background: ${surfaceRaised};
  border-block: 1px solid ${borderDefault};
}

[data-diffs-header] {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  gap: 8px;
  overflow: hidden;
  background: ${headerSurface};
  box-shadow: inset 0 -1px 0 ${borderSubtle};
}

[data-diffs-header] [data-header-content] {
  flex: 1 1 0;
  min-width: 0;
  gap: 6px;
  overflow: hidden;
}

[data-diffs-header] [data-metadata] {
  flex: 0 0 auto;
  min-width: max-content;
  gap: 6px;
}

[data-diff],
[data-file] {
  border-radius: ${flush ? '0' : '16px'};
  overflow: hidden;
  box-shadow: inset 0 0 0 1px ${borderSubtle};
}

${hideChangeIcon ? `
[data-diffs-header] [data-change-icon] {
  display: none;
}
` : ''}

${hideHeaderStats ? `
[data-diffs-header] [data-additions-count],
[data-diffs-header] [data-deletions-count] {
  display: none;
}
` : ''}

[data-line],
[data-gutter-buffer],
[data-line-annotation],
[data-no-newline] {
  background-color: var(--diffs-line-bg, ${surface});
}

[data-gutter-buffer='annotation'],
[data-line-annotation] {
  background-color: ${surfaceContext};
}

[data-column-number] {
  user-select: none;
  background-color: ${numberSurface};
  border-right: 1px solid ${borderSubtle};
}

[data-virtualizer-buffer],
[data-separator],
[data-separator-wrapper],
[data-separator='line-info'],
[data-separator='line-info-basic'],
[data-separator='custom'] {
  background: ${surfaceSeparator};
}

[data-separator] {
  box-shadow: inset 0 1px 0 ${borderSubtle}, inset 0 -1px 0 ${borderSubtle};
}

[data-unmodified-lines] {
  color: ${mutedText};
}
`
}

function hasRenderedDiffContent(container: HTMLDivElement | null): boolean {
    if (!container) return false

    const diffElements = [...container.querySelectorAll<HTMLElement>('diffs-container')]
    if (diffElements.length === 0) return false

    return diffElements.every((diffElement) => Boolean(
        diffElement.shadowRoot?.querySelector('[data-code], [data-error-wrapper], [data-file-info]')
    ))
}

export default function PatchDiffViewer({
    fileDiff,
    fileDiffs = EMPTY_FILE_DIFFS,
    patch,
    mode,
    flush = false,
    hideChangeIcon = flush,
    hideHeaderStats = false,
    headerPrefix,
    headerMetadata,
    renderFileHeaderPrefix,
    renderFileHeaderMetadata,
    activeFileDiffIndex = null,
    activeFileDiffScrollKey = null,
    onRenderingChange,
    workspaceRoot
}: PatchDiffViewerProps) {
    const { settings } = useSettings()
    const containerRef = useRef<HTMLDivElement | null>(null)
    const [selection, setSelection] = useState<CodeSelectionSnapshot | null>(null)
    const [selectionError, setSelectionError] = useState('')
    const hasDiffInput = Boolean(fileDiff || fileDiffs.length > 0 || patch)
    const diffThemeName = resolveDiffThemeName(settings.theme)
    const diffThemeType = resolveDiffThemeType(settings.theme)
    const diffStyle: 'split' | 'unified' = mode === 'split' ? 'split' : 'unified'
    const fileDiffKeys = useMemo(
        () => fileDiffs.map((entry, index) => `${entry.cacheKey || entry.name}:${index}`),
        [fileDiffs]
    )
    const fileDiffsToken = fileDiffKeys.join('|')
    useEffect(() => { setSelection(null); setSelectionError('') }, [fileDiff, fileDiffsToken, patch, workspaceRoot])
    const presentationToken = `${mode}:${settings.theme}:${settings.accentColor.primary}:${flush}:${hideChangeIcon}:${hideHeaderStats}`
    const renderToken = `${fileDiff?.cacheKey || fileDiff?.name || fileDiffsToken || patch || 'empty'}:${presentationToken}`
    const settledFileDiffStateRef = useRef<{ keys: string[]; presentationToken: string } | null>(null)
    const [settledRenderToken, setSettledRenderToken] = useState<string | null>(null)
    const isRendering = hasDiffInput && settledRenderToken !== renderToken
    const settledFileDiffState = settledFileDiffStateRef.current
    const isIncrementalFileDiffAppend = Boolean(
        isRendering
        && !fileDiff
        && !patch
        && fileDiffKeys.length > 0
        && settledFileDiffState
        && settledFileDiffState.presentationToken === presentationToken
        && settledFileDiffState.keys.length < fileDiffKeys.length
        && settledFileDiffState.keys.every((key, index) => fileDiffKeys[index] === key)
    )
    const unsafeCSS = useMemo(
        () => buildDiffViewerUnsafeCss(diffThemeType, flush, hideChangeIcon, hideHeaderStats),
        [diffThemeType, flush, hideChangeIcon, hideHeaderStats]
    )
    const options = useMemo(() => ({
        diffStyle,
        lineDiffType: 'none' as const,
        theme: diffThemeName,
        themeType: diffThemeType,
        tokenizeMaxLineLength: 1000,
        unsafeCSS
    }), [diffStyle, diffThemeName, diffThemeType, unsafeCSS])
    const selectionOptions = useMemo(() => {
        const entries = new Map([...fileDiffs, ...(fileDiff ? [fileDiff] : [])].map(entry => [entry, {
            ...options, enableLineSelection: true,
            onLineSelected: (range: Parameters<typeof diffCodeSelection>[1] | null) => setSelection(range ? diffCodeSelection(entry, range, workspaceRoot) : null)
        }]))
        return (entry: FileDiffMetadata) => workspaceRoot ? entries.get(entry) || options : options
    }, [options, fileDiff, fileDiffs, workspaceRoot])

    useLayoutEffect(() => {
        ensureDiffContainerStyles(containerRef.current)
    }, [renderToken, fileDiffs.length])

    useEffect(() => {
        onRenderingChange?.(isRendering && !isIncrementalFileDiffAppend)
    }, [isIncrementalFileDiffAppend, isRendering, onRenderingChange])

    useEffect(() => {
        if (activeFileDiffIndex === null || activeFileDiffIndex < 0 || fileDiffs.length === 0) return
        if (settledRenderToken !== renderToken) return
        let firstFrame = 0
        let secondFrame = 0
        firstFrame = window.requestAnimationFrame(() => {
            secondFrame = window.requestAnimationFrame(() => {
                const container = containerRef.current
                const entry = container?.querySelector<HTMLElement>(`[data-file-diff-entry="${activeFileDiffIndex}"]`)
                if (!container || !entry) return
                container.scrollTo({ top: entry.offsetTop, behavior: 'smooth' })
            })
        })
        return () => {
            window.cancelAnimationFrame(firstFrame)
            window.cancelAnimationFrame(secondFrame)
        }
    }, [activeFileDiffIndex, activeFileDiffScrollKey, fileDiffs.length, renderToken, settledRenderToken])

    useEffect(() => {
        if (!hasDiffInput) {
            settledFileDiffStateRef.current = null
            setSettledRenderToken(renderToken)
            return
        }

        let animationFrame = 0
        let timeoutId = 0

        const settleIfReady = () => {
            ensureDiffContainerStyles(containerRef.current)
            if (hasRenderedDiffContent(containerRef.current)) {
                settledFileDiffStateRef.current = !fileDiff && !patch && fileDiffKeys.length > 0
                    ? { keys: fileDiffKeys, presentationToken }
                    : null
                setSettledRenderToken(renderToken)
                return true
            }

            return false
        }

        const tick = () => {
            if (settleIfReady()) return
            animationFrame = window.requestAnimationFrame(tick)
        }

        animationFrame = window.requestAnimationFrame(tick)
        timeoutId = window.setTimeout(() => {
            settledFileDiffStateRef.current = !fileDiff && !patch && fileDiffKeys.length > 0
                ? { keys: fileDiffKeys, presentationToken }
                : null
            setSettledRenderToken(renderToken)
        }, 4000)

        return () => {
            window.cancelAnimationFrame(animationFrame)
            window.clearTimeout(timeoutId)
        }
    }, [fileDiff, fileDiffKeys, hasDiffInput, patch, presentationToken, renderToken])

    return (
        <div
            ref={containerRef}
            className="relative h-full overflow-auto overscroll-contain bg-transparent custom-scrollbar [scrollbar-gutter:stable]"
        >
            <DiffWorkerPoolProvider>
                {selection && <div className="sticky top-0 z-10 flex items-center justify-end gap-2 border-b border-sparkle-border bg-sparkle-card px-3 py-1.5 text-xs">
                    {selectionError && <span role="alert">{selectionError}</span>}
                    <span className="text-sparkle-text-muted">{selection.side} · lines {selection.startLine}–{selection.endLine}</span>
                    <button className="inline-flex items-center gap-1.5 rounded px-2 py-1 hover:bg-[var(--surface-hover)]" onClick={() => void requestCodeContext(selection).then(() => setSelection(null)).catch(reason => setSelectionError(String(reason.message || reason)))}><MessageSquare size={12} />Ask Zyra</button>
                </div>}
                {fileDiff ? (
                    <FileDiff
                        key={renderToken}
                        fileDiff={fileDiff}
                        options={selectionOptions(fileDiff)}
                        renderHeaderPrefix={headerPrefix ? () => headerPrefix : undefined}
                        renderHeaderMetadata={headerMetadata ? () => headerMetadata : undefined}
                    />
                ) : fileDiffs.length > 0 ? (
                    <div className={flush ? 'space-y-0' : 'space-y-3'}>
                        {fileDiffs.map((entry, index) => (
                            <div
                                key={`${entry.cacheKey || entry.name}:${index}`}
                                data-file-diff-entry={index}
                                className={activeFileDiffIndex === index
                                    ? 'relative z-[1] ring-1 ring-inset ring-[var(--accent-primary)]/55'
                                    : 'relative'}
                            >
                                <FileDiff
                                    fileDiff={entry}
                                    options={selectionOptions(entry)}
                                    renderHeaderPrefix={renderFileHeaderPrefix ? () => renderFileHeaderPrefix(entry, index) : undefined}
                                    renderHeaderMetadata={renderFileHeaderMetadata ? () => renderFileHeaderMetadata(entry, index) : undefined}
                                />
                            </div>
                        ))}
                    </div>
                ) : patch ? (
                    <PatchDiff
                        key={renderToken}
                        patch={patch}
                        options={options}
                        renderHeaderPrefix={headerPrefix ? () => headerPrefix : undefined}
                        renderHeaderMetadata={headerMetadata ? () => headerMetadata : undefined}
                    />
                ) : (
                    <div className="flex min-h-full items-center justify-center px-6 py-10 text-sm text-white/40">
                        No diff content available.
                    </div>
                )}
            </DiffWorkerPoolProvider>

            {isRendering && isIncrementalFileDiffAppend ? (
                <div className="pointer-events-none sticky bottom-3 ml-auto mr-3 mt-3 flex w-fit items-center gap-1.5 rounded-lg border border-white/10 bg-[color-mix(in_srgb,var(--color-card)_90%,black)] px-2.5 py-1.5 text-[10px] text-sparkle-text-muted shadow-lg">
                    <RefreshCw size={11} className="animate-spin text-[var(--accent-primary)]" />
                    Rendering added changes…
                </div>
            ) : null}

            {isRendering && hasDiffInput && !isIncrementalFileDiffAppend && (
                <div
                    className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 py-4"
                    style={{
                        background: 'color-mix(in srgb, var(--color-bg) 95%, black)'
                    }}
                >
                    <div
                        className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs text-white/70 shadow-lg backdrop-blur-md"
                        style={{
                            background: 'color-mix(in lab, var(--color-card) 88%, transparent)',
                            color: 'var(--color-text-secondary)'
                        }}
                    >
                        <RefreshCw size={14} className="animate-spin text-[var(--accent-primary)]" />
                        Rendering diff...
                    </div>
                </div>
            )}
        </div>
    )
}
