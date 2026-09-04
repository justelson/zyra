import { lazy, memo, Suspense, useMemo } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { normalizePatchText } from '@/lib/diffRendering'

const LazyAssistantInlineDiffSyntax = lazy(() => import('./AssistantInlineDiffSyntax').then((module) => ({
    default: module.AssistantInlineDiffSyntax
})))

const MAX_INLINE_DIFF_ROWS = 100

type InlineDiffLineKind = 'context' | 'addition' | 'deletion' | 'hunk' | 'notice'

export interface InlineDiffLine {
    kind: InlineDiffLineKind
    oldLine: number | null
    newLine: number | null
    text: string
}

interface AssistantInlineDiffPreviewProps {
    patch: string
    displayPath: string
    additions: number
    deletions: number
    hideHeader?: boolean
    onOpenFullDiff?: () => void
}

function parseHunkStart(line: string): { oldLine: number; newLine: number } | null {
    const match = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(line)
    if (!match) return null
    return {
        oldLine: Number.parseInt(match[1], 10),
        newLine: Number.parseInt(match[2], 10)
    }
}

function buildInlineDiffLines(patch: string): { lines: InlineDiffLine[]; truncated: boolean } {
    const sourceLines = normalizePatchText(patch).split('\n')
    const rendered: InlineDiffLine[] = []
    let oldLine = 0
    let newLine = 0
    let inHunk = false
    let truncated = false

    const appendLine = (line: InlineDiffLine): boolean => {
        if (rendered.length >= MAX_INLINE_DIFF_ROWS) {
            truncated = true
            return false
        }
        rendered.push(line)
        return true
    }

    for (const sourceLine of sourceLines) {
        const hunkStart = parseHunkStart(sourceLine)
        if (hunkStart) {
            oldLine = hunkStart.oldLine
            newLine = hunkStart.newLine
            inHunk = true
            if (!appendLine({ kind: 'hunk', oldLine: null, newLine: null, text: sourceLine })) break
            continue
        }

        if (!inHunk) continue

        if (sourceLine.startsWith('diff --git ')) break
        if (sourceLine.startsWith('\\ No newline at end of file')) {
            if (!appendLine({ kind: 'notice', oldLine: null, newLine: null, text: sourceLine })) break
            continue
        }
        if (sourceLine.startsWith('+')) {
            if (!appendLine({ kind: 'addition', oldLine: null, newLine, text: sourceLine })) break
            newLine += 1
            continue
        }
        if (sourceLine.startsWith('-')) {
            if (!appendLine({ kind: 'deletion', oldLine, newLine: null, text: sourceLine })) break
            oldLine += 1
            continue
        }

        if (!appendLine({ kind: 'context', oldLine, newLine, text: sourceLine })) break
        oldLine += 1
        newLine += 1
    }

    return { lines: rendered, truncated }
}

export const AssistantInlineDiffPreview = memo(function AssistantInlineDiffPreview({
    patch,
    displayPath,
    additions,
    deletions,
    hideHeader = false,
    onOpenFullDiff
}: AssistantInlineDiffPreviewProps) {
    const preview = useMemo(() => buildInlineDiffLines(patch), [patch])

    return (
        <div className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-sparkle-border bg-sparkle-card">
            {!hideHeader ? <div className="flex h-8 shrink-0 items-center gap-2 border-b border-sparkle-border bg-[color-mix(in_srgb,var(--color-card)_86%,var(--color-bg))] px-2.5 text-[11px] leading-none">
                <span className="min-w-0 flex-1 truncate font-medium text-sparkle-text">{displayPath}</span>
                <span className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[10px] tabular-nums">
                    <span className="text-[var(--status-success)]">+{additions}</span>
                    <span className="text-[var(--status-danger)]">-{deletions}</span>
                </span>
                {onOpenFullDiff ? (
                    <button
                        type="button"
                        onClick={(event) => {
                            event.stopPropagation()
                            onOpenFullDiff()
                        }}
                        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--accent-primary)] hover:bg-[var(--surface-hover)] hover:text-sparkle-text"
                        title={`Open full diff for ${displayPath} in side panel`}
                    >
                        <ArrowUpRight size={12} />
                    </button>
                ) : null}
            </div> : onOpenFullDiff ? (
                <button
                    type="button"
                    onClick={(event) => {
                        event.stopPropagation()
                        onOpenFullDiff()
                    }}
                    className="absolute right-2 top-2 z-10 inline-flex size-6 items-center justify-center rounded-md border border-[var(--surface-divider)] bg-[color-mix(in_srgb,var(--color-card)_88%,transparent)] text-[var(--accent-primary)] backdrop-blur hover:bg-[var(--surface-hover)] hover:text-sparkle-text"
                    title={`Open full diff for ${displayPath} in side panel`}
                    aria-label={`Open full diff for ${displayPath} in side panel`}
                >
                    <ArrowUpRight size={12} />
                </button>
            ) : null}

            <div
                className="min-h-0 flex-1 overflow-auto overscroll-contain font-mono text-[12px] leading-5 [font-variant-ligatures:none] [text-rendering:auto] [-webkit-font-smoothing:auto]"
                tabIndex={0}
            >
                <div className="w-max min-w-full">
                    <Suspense fallback={(
                        <div className="flex h-10 min-w-[20rem] items-center px-3 text-[10px] text-sparkle-text-muted">
                            Applying syntax colors...
                        </div>
                    )}>
                        <LazyAssistantInlineDiffSyntax lines={preview.lines} displayPath={displayPath} />
                    </Suspense>
                    {preview.truncated ? onOpenFullDiff ? (
                        <button
                            type="button"
                            onClick={(event) => {
                                event.stopPropagation()
                                onOpenFullDiff()
                            }}
                            className="flex h-8 w-full items-center gap-1.5 border-t border-sparkle-border bg-[color-mix(in_srgb,var(--color-card)_86%,var(--color-bg))] px-2.5 text-left text-[10px] text-[var(--accent-primary)] hover:bg-[var(--surface-hover)] hover:text-sparkle-text"
                            title={`Open full diff for ${displayPath} in side panel`}
                        >
                            <ArrowUpRight size={11} />
                            More lines — open full diff
                        </button>
                    ) : (
                        <div className="h-8 border-t border-sparkle-border bg-[color-mix(in_srgb,var(--color-card)_86%,var(--color-bg))] px-2.5 text-[10px] leading-8 text-sparkle-text-muted">
                            More lines are available in the full diff
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    )
})
