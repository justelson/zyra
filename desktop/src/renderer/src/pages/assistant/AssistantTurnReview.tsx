import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { ArrowLeft, Check, ChevronDown, ChevronUp, Columns3, Copy, Files, Rows3 } from 'lucide-react'
import { RawPatchFallback } from '@/components/ui/diff-viewer/RawPatchFallback'
import PatchDiffViewer from '@/components/ui/diff-viewer/PatchDiffViewer'
import MarkdownRenderer from '@/components/ui/MarkdownRenderer'
import { FileEntryIcon } from '@/components/ui/FileEntryIcon'
import { formatAssistantDateTime } from '@/lib/assistant/selectors'
import {
    buildSyntheticSingleFilePatch,
    extractFilePatch,
    parsePatchForRendering,
    resolveFileDiffPath
} from '@/lib/diffRendering'
import { useSettings } from '@/lib/settings'
import { cn } from '@/lib/utils'
import { DiffStats } from '@/pages/project-details/DiffStats'
import { AssistantFileChangeStatusPill, resolveAssistantFileChangeStatus } from './AssistantFileChangeStatusPill'
import { AssistantReviewPromptAttachments } from './AssistantReviewPromptAttachments'
import { AssistantReviewTurnStatusBadge } from './AssistantReviewTurnStatusBadge'
import type { AssistantDiffTarget, AssistantDiffTurn } from './assistant-diff-types'
import { useAssistantStoreSelector } from '@/lib/assistant/assistant-store-hooks'
import { getSelectedAssistantSession } from '@/lib/assistant/selectors'
import { RecordedChangeUndo } from './RecordedChangeUndo'

const INITIAL_VISIBLE_FILES = 12
const INITIAL_RENDERED_CHANGES = 4
const RENDERED_CHANGE_BATCH_SIZE = 4
const TURN_REVIEW_RAIL_MIN_WIDTH = 220
const TURN_REVIEW_RAIL_DEFAULT_WIDTH = 320
const TURN_REVIEW_RAIL_MAX_WIDTH = 420
const TURN_REVIEW_RAIL_MAX_RATIO = 0.42
const TURN_REVIEW_WIDE_MIN_WIDTH = 760
const TURN_REVIEW_SPLIT_MIN_WIDTH = 680
const TURN_REVIEW_RAIL_STORAGE_KEY = 'assistant-turn-review-rail-width:v2'

type NarrowReviewSurface = 'diff' | 'review'

function readStoredRailWidth(): number {
    if (typeof window === 'undefined') return TURN_REVIEW_RAIL_DEFAULT_WIDTH
    const value = Number(window.localStorage.getItem(TURN_REVIEW_RAIL_STORAGE_KEY))
    return Number.isFinite(value) ? Math.max(TURN_REVIEW_RAIL_MIN_WIDTH, value) : TURN_REVIEW_RAIL_DEFAULT_WIDTH
}

function formatCompactTurnDateTime(value: string): string {
    const timestamp = Date.parse(value)
    if (!Number.isFinite(timestamp)) return value
    return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    }).format(new Date(timestamp))
}

function clampRailWidth(width: number, containerWidth: number): number {
    const maxWidth = Math.max(
        TURN_REVIEW_RAIL_MIN_WIDTH,
        Math.min(TURN_REVIEW_RAIL_MAX_WIDTH, containerWidth * TURN_REVIEW_RAIL_MAX_RATIO)
    )
    return Math.max(TURN_REVIEW_RAIL_MIN_WIDTH, Math.min(maxWidth, width))
}

function normalizeReviewFilePath(value: string | undefined): string {
    return String(value || '').trim().replace(/\\/g, '/').replace(/^\.\//, '')
}

function targetsReferToSameFile(left: AssistantDiffTarget, right: AssistantDiffTarget): boolean {
    const leftPaths = new Set([left.filePath, left.previousPath].map(normalizeReviewFilePath).filter(Boolean))
    return [right.filePath, right.previousPath]
        .map(normalizeReviewFilePath)
        .filter(Boolean)
        .some((path) => leftPaths.has(path))
}

function buildTargetFilePatch(target: AssistantDiffTarget): string {
    return extractFilePatch(target.patch, target.filePath, target.previousPath)
        || buildSyntheticSingleFilePatch(
            target.patch,
            target.displayPath || target.filePath,
            target.previousPath,
            { isNew: target.isNew }
        )
}

function resolveParsedTargetFile(
    parsed: ReturnType<typeof parsePatchForRendering>,
    target: AssistantDiffTarget
) {
    const currentTargetPath = normalizeReviewFilePath(target.filePath)
    const previousTargetPath = normalizeReviewFilePath(target.previousPath)
    return parsed.files.find((entry) => {
        const currentPath = normalizeReviewFilePath(resolveFileDiffPath(entry))
        const previousPath = normalizeReviewFilePath(entry.prevName)
        return currentPath === currentTargetPath
            || previousPath === currentTargetPath
            || (previousTargetPath ? previousPath === previousTargetPath : false)
    }) || (parsed.files.length === 1 ? parsed.files[0] : null)
}

function ReviewExcerpt({
    label,
    text,
    primary = false,
    renderMarkdown = false,
    collapsible = false,
    attachments = []
}: {
    label: string
    text: string
    primary?: boolean
    renderMarkdown?: boolean
    collapsible?: boolean
    attachments?: AssistantDiffTurn['promptAttachments']
}) {
    const [expanded, setExpanded] = useState(false)
    const canExpand = collapsible && (text.length > 240 || text.split(/\r?\n/).length > 4)
    return (
        <div className={cn(
            'w-full min-w-0 max-w-full overflow-hidden border-l-2 py-0.5 pl-2.5 pr-1',
            primary ? 'border-[var(--accent-primary)]/55' : 'border-white/[0.09]'
        )}>
            <div className={cn(
                'mb-1 text-[8px] font-bold uppercase tracking-[0.09em]',
                primary ? 'text-[var(--accent-primary)]/85' : 'text-sparkle-text-muted/55'
            )}>
                {label}
            </div>
            <div className={cn('min-w-0 max-w-full', !expanded && canExpand && 'max-h-[6.25rem] overflow-hidden')}>
                {renderMarkdown ? (
                    <MarkdownRenderer
                        content={text}
                        lightweight
                        className={cn(
                            'assistant-turn-review__markdown w-full min-w-0 max-w-full overflow-x-hidden text-[11px] leading-[1.55] [&_h1]:border-0 [&_h1]:pb-0 [&_h1]:text-xs [&_h2]:border-0 [&_h2]:pb-0 [&_h2]:text-xs [&_h3]:text-[11px] [&_li]:whitespace-pre-wrap [&_li]:leading-[1.55] [&_p]:mb-2 [&_p]:whitespace-pre-wrap [&_p]:leading-[1.55] [&_pre]:text-[9px] [&_code]:text-[9px]',
                            primary ? '[&_h1]:text-sparkle-text [&_h2]:text-sparkle-text [&_h3]:text-sparkle-text [&_li]:text-sparkle-text [&_p]:text-sparkle-text' : 'text-sparkle-text-secondary/72'
                        )}
                    />
                ) : (
                    <p className={cn(
                        'whitespace-pre-wrap text-[11px] leading-[1.55]',
                        primary ? 'font-medium text-sparkle-text/92' : 'text-sparkle-text-secondary/72',
                        !expanded && 'line-clamp-4'
                    )}>
                        {text}
                    </p>
                )}
            </div>
            {attachments.length > 0 ? <AssistantReviewPromptAttachments attachments={attachments} /> : null}
            {canExpand ? (
                <button
                    type="button"
                    onClick={() => setExpanded((current) => !current)}
                    className="mt-1 text-[9px] font-medium text-[var(--accent-primary)]/80 hover:text-[var(--accent-primary)]"
                >
                    {expanded ? 'Show less' : 'Show more'}
                </button>
            ) : null}
        </div>
    )
}

export const AssistantTurnReview = memo(function AssistantTurnReview({
    turn,
    selectedDiff,
    focusSelectedDiffRequestId,
    showBack,
    onBack,
    onSelectDiff,
    onLoadingChange
}: {
    turn: AssistantDiffTurn
    selectedDiff: AssistantDiffTarget | null
    focusSelectedDiffRequestId: number | null
    showBack: boolean
    onBack: () => void
    onSelectDiff: (target: AssistantDiffTarget) => void
    onLoadingChange?: (loading: boolean) => void
}) {
    const { settings } = useSettings()
    const workspaceRoot = useAssistantStoreSelector(state => {
        const session = getSelectedAssistantSession(state.snapshot)
        return session?.workingRoot || session?.chatScope?.workingRoot || session?.projectPath || undefined
    })
    const iconTheme = settings.appearanceResolvedMode
    const rootRef = useRef<HTMLElement | null>(null)
    const diffSurfaceRef = useRef<HTMLElement | null>(null)
    const resizeFrameRef = useRef<number | null>(null)
    const resizeStartRef = useRef<{ pointerX: number; width: number } | null>(null)
    const pendingRailWidthRef = useRef<number | null>(null)
    const [railWidth, setRailWidth] = useState(readStoredRailWidth)
    const [copiedPath, setCopiedPath] = useState<string | null>(null)
    const [renderMode, setRenderMode] = useState<'stacked' | 'split'>('stacked')
    const [visibleFileCount, setVisibleFileCount] = useState(INITIAL_VISIBLE_FILES)
    const [visibleRecordedChangeCount, setVisibleRecordedChangeCount] = useState(INITIAL_RENDERED_CHANGES)
    const [showAllChanges, setShowAllChanges] = useState(() => focusSelectedDiffRequestId === null && turn.changes.length > 0)
    const [narrowSurface, setNarrowSurface] = useState<NarrowReviewSurface>(() => focusSelectedDiffRequestId === null ? 'review' : 'diff')
    const [isNarrowLayout, setIsNarrowLayout] = useState(false)
    const [diffSupportsSplit, setDiffSupportsSplit] = useState(false)
    const [responseExpanded, setResponseExpanded] = useState(false)
    const [activeSelectedDiff, setActiveSelectedDiff] = useState<AssistantDiffTarget | null>(null)
    const activeSelectionMatches = Boolean(
        activeSelectedDiff
        && selectedDiff
        && activeSelectedDiff.activityId === selectedDiff.activityId
        && activeSelectedDiff.filePath === selectedDiff.filePath
        && activeSelectedDiff.patch === selectedDiff.patch
    )
    const activeSelectionMatchesFile = Boolean(
        activeSelectedDiff
        && selectedDiff
        && activeSelectedDiff.turnId === selectedDiff.turnId
        && targetsReferToSameFile(activeSelectedDiff, selectedDiff)
    )
    const preparedSelectedDiff = activeSelectionMatches
        ? activeSelectedDiff
        : activeSelectionMatchesFile
            ? selectedDiff
            : null
    const displayedSelectedDiff = selectedDiff
    const selectedFileStatus = displayedSelectedDiff
        ? resolveAssistantFileChangeStatus({
            kind: displayedSelectedDiff.changeKind,
            isNew: displayedSelectedDiff.isNew,
            previousPath: displayedSelectedDiff.previousPath
        })
        : null
    const parsedDiff = useMemo(
        () => parsePatchForRendering(
            preparedSelectedDiff?.patch || '',
            `assistant-review:${preparedSelectedDiff?.activityId || 'empty'}:${preparedSelectedDiff?.filePath || 'none'}`
        ),
        [preparedSelectedDiff]
    )
    const resolvedFileDiff = useMemo(() => {
        if (!preparedSelectedDiff) return null
        const normalizedFilePath = preparedSelectedDiff.filePath.replace(/\\/g, '/')
        const normalizedPreviousPath = preparedSelectedDiff.previousPath?.replace(/\\/g, '/')
        return parsedDiff.files.find((entry) => {
            const currentPath = resolveFileDiffPath(entry)
            const previousPath = entry.prevName?.replace(/\\/g, '/')
            return currentPath === normalizedFilePath
                || (normalizedPreviousPath ? previousPath === normalizedPreviousPath : false)
                || previousPath === normalizedFilePath
        }) || null
    }, [parsedDiff.files, preparedSelectedDiff])
    const filePatch = useMemo(() => {
        if (!preparedSelectedDiff) return ''
        const extractedPatch = extractFilePatch(preparedSelectedDiff.patch, preparedSelectedDiff.filePath, preparedSelectedDiff.previousPath)
        if (extractedPatch) return extractedPatch
        const syntheticPatch = buildSyntheticSingleFilePatch(
            preparedSelectedDiff.patch,
            preparedSelectedDiff.displayPath || preparedSelectedDiff.filePath,
            preparedSelectedDiff.previousPath,
            { isNew: preparedSelectedDiff.isNew }
        )
        if (syntheticPatch) return syntheticPatch
        if (!resolvedFileDiff && parsedDiff.files.length === 1) return parsedDiff.patch
        return ''
    }, [parsedDiff.files.length, parsedDiff.patch, preparedSelectedDiff, resolvedFileDiff])
    const allChangeVersions = useMemo(() => {
        const totals = new Map<string, number>()
        for (const change of turn.changes) {
            const path = normalizeReviewFilePath(change.target.filePath)
            totals.set(path, (totals.get(path) || 0) + 1)
        }
        const seen = new Map<string, number>()
        return turn.changes.map((change) => {
            const path = normalizeReviewFilePath(change.target.filePath)
            const number = (seen.get(path) || 0) + 1
            seen.set(path, number)
            return { number, total: totals.get(path) || 1 }
        })
    }, [turn.changes])
    const fileEditCounts = useMemo(() => {
        const counts = new Map<string, number>()
        for (const change of turn.changes) {
            const path = normalizeReviewFilePath(change.target.filePath)
            counts.set(path, (counts.get(path) || 0) + 1)
        }
        return counts
    }, [turn.changes])
    const exactSelectedChange = useMemo(() => {
        if (!selectedDiff) return null
        return turn.changes.find((change) => (
            change.target.activityId === selectedDiff.activityId
            && targetsReferToSameFile(change.target, selectedDiff)
        )) || null
    }, [selectedDiff, turn.changes])
    const reviewFiles = useMemo(() => {
        if (!exactSelectedChange) return turn.files
        let replaced = false
        const files = turn.files.map((file) => {
            if (!targetsReferToSameFile(file.target, exactSelectedChange.target)) return file
            replaced = true
            return { ...file, target: exactSelectedChange.target }
        })
        return replaced ? files : [exactSelectedChange, ...files]
    }, [exactSelectedChange, turn.files])
    const selectedFileIndex = exactSelectedChange
        ? reviewFiles.findIndex((file) => (
            file.target.activityId === exactSelectedChange.target.activityId
            && targetsReferToSameFile(file.target, exactSelectedChange.target)
        ))
        : -1
    const selectedFileChanges = useMemo(() => {
        if (!preparedSelectedDiff) return []
        return turn.changes.filter((change) => targetsReferToSameFile(change.target, preparedSelectedDiff))
    }, [preparedSelectedDiff, turn.changes])
    const activeSelectedFileChangeIndex = preparedSelectedDiff
        ? selectedFileChanges.findIndex((change) => (
            change.target.activityId === preparedSelectedDiff.activityId
            && targetsReferToSameFile(change.target, preparedSelectedDiff)
        ))
        : -1
    const boundedRecordedChangeCount = Math.min(
        turn.changes.length,
        Math.max(INITIAL_RENDERED_CHANGES, visibleRecordedChangeCount)
    )
    const hiddenRecordedChangeCount = showAllChanges
        ? Math.max(0, turn.changes.length - boundedRecordedChangeCount)
        : 0
    const nextRecordedChangeBatchSize = Math.min(RENDERED_CHANGE_BATCH_SIZE, hiddenRecordedChangeCount)
    const renderedRecordedChanges = useMemo(
        () => showAllChanges
            ? turn.changes.slice(0, boundedRecordedChangeCount)
            : selectedFileChanges,
        [boundedRecordedChangeCount, selectedFileChanges, showAllChanges, turn.changes]
    )
    const renderedChangesPatch = useMemo(
        () => renderedRecordedChanges.map(({ target }) => buildTargetFilePatch(target)).filter(Boolean).join('\n'),
        [renderedRecordedChanges]
    )
    const parsedRecordedChangeEntries = useMemo(() => renderedRecordedChanges.flatMap((change) => {
        const targetPatch = buildTargetFilePatch(change.target)
        if (!targetPatch) return []
        const parsed = parsePatchForRendering(
            targetPatch,
            `assistant-review:${turn.id}:${change.target.activityId}:${normalizeReviewFilePath(change.target.filePath)}`
        )
        const fileDiff = resolveParsedTargetFile(parsed, change.target)
        return fileDiff ? [{ change, fileDiff }] : []
    }), [renderedRecordedChanges, turn.id])
    const boundedVisibleFileCount = Math.min(
        reviewFiles.length,
        Math.max(INITIAL_VISIBLE_FILES, visibleFileCount)
    )
    const hiddenFileCount = Math.max(0, reviewFiles.length - boundedVisibleFileCount)
    const nextVisibleFileBatchSize = Math.min(INITIAL_VISIBLE_FILES, hiddenFileCount)
    const visibleFiles = hiddenFileCount === 0
        ? reviewFiles
        : selectedFileIndex >= boundedVisibleFileCount
            ? [...reviewFiles.slice(0, boundedVisibleFileCount - 1), reviewFiles[selectedFileIndex]]
            : reviewFiles.slice(0, boundedVisibleFileCount)
    const exactTurnDateTime = formatAssistantDateTime(turn.updatedAt)
    const compactTurnDateTime = formatCompactTurnDateTime(turn.updatedAt)
    const effectiveRenderMode = isNarrowLayout || !diffSupportsSplit ? 'stacked' : renderMode

    useEffect(() => {
        setCopiedPath(null)
        if (!selectedDiff) {
            setActiveSelectedDiff(null)
            onLoadingChange?.(false)
            return
        }
        if (
            activeSelectedDiff
            && activeSelectedDiff.turnId === selectedDiff.turnId
            && targetsReferToSameFile(activeSelectedDiff, selectedDiff)
        ) {
            setActiveSelectedDiff(selectedDiff)
            onLoadingChange?.(false)
            return
        }
        setActiveSelectedDiff(null)
        onLoadingChange?.(true)
        let firstFrame = 0
        let secondFrame = 0
        firstFrame = window.requestAnimationFrame(() => {
            secondFrame = window.requestAnimationFrame(() => setActiveSelectedDiff(selectedDiff))
        })
        return () => {
            window.cancelAnimationFrame(firstFrame)
            window.cancelAnimationFrame(secondFrame)
            onLoadingChange?.(false)
        }
    }, [onLoadingChange, selectedDiff])

    useEffect(() => {
        if (preparedSelectedDiff && !resolvedFileDiff && !filePatch) onLoadingChange?.(false)
    }, [filePatch, onLoadingChange, preparedSelectedDiff, resolvedFileDiff])

    useEffect(() => {
        const focusSelectedDiff = focusSelectedDiffRequestId !== null
        setVisibleFileCount(INITIAL_VISIBLE_FILES)
        setVisibleRecordedChangeCount(INITIAL_RENDERED_CHANGES)
        setResponseExpanded(false)
        setShowAllChanges(!focusSelectedDiff && turn.changes.length > 0)
        setNarrowSurface(focusSelectedDiff ? 'diff' : 'review')
    }, [focusSelectedDiffRequestId, turn.id])

    useEffect(() => {
        const root = rootRef.current
        if (!root || typeof ResizeObserver === 'undefined') return
        const applyLayoutWidth = () => {
            const narrow = root.clientWidth < TURN_REVIEW_WIDE_MIN_WIDTH
            setIsNarrowLayout(narrow)
            if (!narrow) setRailWidth((current) => clampRailWidth(current, root.clientWidth))
        }
        const observer = new ResizeObserver(applyLayoutWidth)
        applyLayoutWidth()
        observer.observe(root)
        return () => observer.disconnect()
    }, [])

    useEffect(() => {
        const surface = diffSurfaceRef.current
        if (!surface || typeof ResizeObserver === 'undefined') return
        const applyDiffWidth = () => {
            const supportsSplit = surface.clientWidth >= TURN_REVIEW_SPLIT_MIN_WIDTH
            setDiffSupportsSplit((current) => current === supportsSplit ? current : supportsSplit)
        }
        const observer = new ResizeObserver(applyDiffWidth)
        applyDiffWidth()
        observer.observe(surface)
        return () => observer.disconnect()
    }, [])

    useEffect(() => () => {
        if (resizeFrameRef.current !== null) window.cancelAnimationFrame(resizeFrameRef.current)
    }, [])

    const handleCopyPath = async (filePath?: string) => {
        const path = filePath || displayedSelectedDiff?.filePath
        if (!path) return
        await navigator.clipboard.writeText(path)
        setCopiedPath(path)
        window.setTimeout(() => {
            setCopiedPath((current) => current === path ? null : current)
        }, 1200)
    }

    const handleSelectFile = (target: AssistantDiffTarget) => {
        setShowAllChanges(false)
        setNarrowSurface('diff')
        onSelectDiff(target)
    }

    const handleShowAllChanges = () => {
        setShowAllChanges(true)
        setNarrowSurface('diff')
    }

    const renderRecordedChangeStatus = (change: AssistantDiffTurn['changes'][number] | undefined) => {
        if (!change) return null
        const status = resolveAssistantFileChangeStatus({
            kind: change.target.changeKind,
            isNew: change.target.isNew,
            previousPath: change.target.previousPath
        })
        return <AssistantFileChangeStatusPill status={status} />
    }

    const renderRecordedChangeMetadata = (
        change: AssistantDiffTurn['changes'][number] | undefined,
        number: number,
        total: number
    ) => {
        if (!change) return null
        return (
            <div className="assistant-turn-review__recorded-edit-meta flex min-w-0 items-center justify-end gap-1.5 text-[8px]">
                {renderCopyPathAction(change.target)}
                <span className="shrink-0 rounded px-1.5 py-1 font-mono font-semibold uppercase tracking-[0.05em] text-sparkle-text-secondary/75">
                    Edit {number} of {total}
                </span>
            </div>
        )
    }

    const applyPendingRailWidth = () => {
        resizeFrameRef.current = null
        const nextWidth = pendingRailWidthRef.current
        if (nextWidth !== null) setRailWidth(nextWidth)
    }

    const handleRailResizePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
        const root = rootRef.current
        if (!root) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        resizeStartRef.current = { pointerX: event.clientX, width: railWidth }
        pendingRailWidthRef.current = railWidth
    }

    const handleRailResizePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
        const resizeStart = resizeStartRef.current
        const root = rootRef.current
        if (!resizeStart || !root) return
        pendingRailWidthRef.current = clampRailWidth(
            resizeStart.width + event.clientX - resizeStart.pointerX,
            root.clientWidth
        )
        if (resizeFrameRef.current === null) {
            resizeFrameRef.current = window.requestAnimationFrame(applyPendingRailWidth)
        }
    }

    const finishRailResize = (event: PointerEvent<HTMLButtonElement>) => {
        if (!resizeStartRef.current) return
        if (resizeFrameRef.current !== null) {
            window.cancelAnimationFrame(resizeFrameRef.current)
            resizeFrameRef.current = null
        }
        const nextWidth = pendingRailWidthRef.current ?? railWidth
        setRailWidth(nextWidth)
        window.localStorage.setItem(TURN_REVIEW_RAIL_STORAGE_KEY, String(Math.round(nextWidth)))
        resizeStartRef.current = null
        pendingRailWidthRef.current = null
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
        }
    }

    const renderConversation = () => (
        <div className="w-full min-w-0 max-w-full space-y-3 overflow-hidden p-3">
            <ReviewExcerpt label="You" text={turn.prompt} primary renderMarkdown collapsible attachments={turn.promptAttachments} />
            {turn.responseAvailable ? (
                <ReviewExcerpt label="Agent" text={turn.response} renderMarkdown />
            ) : (
                <div className="rounded-md border border-amber-400/15 bg-amber-500/[0.07] px-2.5 py-2 text-[10px] leading-4 text-amber-100/70">
                    Agent did not respond
                </div>
            )}
        </div>
    )

    const renderCopyPathAction = (target: AssistantDiffTarget) => {
        const copied = copiedPath === target.filePath
        return (
            <button
                type="button"
                onClick={() => void handleCopyPath(target.filePath)}
                className={cn('inline-flex size-5 shrink-0 items-center justify-center rounded text-sparkle-text-muted hover:bg-white/[0.07] hover:text-sparkle-text', copied && 'text-emerald-300')}
                aria-label={copied ? 'Path copied' : `Copy path for ${target.displayPath}`}
                title={copied ? 'Path copied' : 'Copy file path'}
            >
                {copied ? <Check size={10} /> : <Copy size={10} />}
            </button>
        )
    }

    const renderDiffModeToggle = () => (
        <div className="assistant-turn-review__diff-mode-toggle flex rounded-md border border-white/[0.08] bg-black/15 p-0.5">
            <button
                type="button"
                onClick={() => setRenderMode('stacked')}
                className={cn('inline-flex size-6 items-center justify-center rounded', effectiveRenderMode === 'stacked' ? 'bg-white/[0.09] text-white' : 'text-white/45 hover:text-white')}
                aria-label="Unified diff view"
            >
                <Rows3 size={11} />
            </button>
            <button
                type="button"
                onClick={() => setRenderMode('split')}
                disabled={!diffSupportsSplit || isNarrowLayout}
                className={cn(
                    'inline-flex size-6 items-center justify-center rounded disabled:cursor-not-allowed disabled:opacity-25',
                    effectiveRenderMode === 'split' ? 'bg-white/[0.09] text-white' : 'text-white/45 hover:text-white'
                )}
                aria-label="Split diff view"
                title={!diffSupportsSplit || isNarrowLayout ? 'Split view needs a wider diff pane' : 'Split diff view'}
            >
                <Columns3 size={11} />
            </button>
        </div>
    )

    const renderDiffHeaderActions = () => displayedSelectedDiff ? (
        <div className="assistant-turn-review__diff-header-actions flex items-center gap-1.5">
            <RecordedChangeUndo key={`${displayedSelectedDiff.activityId}:${displayedSelectedDiff.filePath}`} target={{ ...displayedSelectedDiff, patch: buildTargetFilePatch(displayedSelectedDiff) }} root={workspaceRoot} disabled={turn.state === 'running'} />
            {renderCopyPathAction(displayedSelectedDiff)}
        </div>
    ) : null

    const renderDiffSummaryBar = () => turn.changes.length > 0 ? (
        <div className="assistant-turn-review__diff-summary flex h-9 shrink-0 items-center gap-2 border-b border-white/[0.07] bg-[color-mix(in_srgb,var(--color-card)_84%,black)] px-2.5">
            <button
                type="button"
                onClick={handleShowAllChanges}
                className={cn(
                    'inline-flex h-6 min-w-0 items-center gap-1.5 rounded px-1.5 text-[9px] font-semibold transition-colors',
                    showAllChanges
                        ? 'bg-[color-mix(in_srgb,var(--accent-primary)_10%,transparent)] text-sparkle-text'
                        : 'text-sparkle-text-muted hover:bg-white/[0.04] hover:text-sparkle-text-secondary'
                )}
                aria-pressed={showAllChanges}
            >
                <Files size={11} className="shrink-0" />
                <span className="truncate">All changes</span>
            </button>
            {showAllChanges ? (
                <span className="shrink-0 font-mono text-[8px] text-sparkle-text-muted/55">
                    {renderedRecordedChanges.length}/{turn.changes.length} edits
                </span>
            ) : null}
            <span className="min-w-0 flex-1" />
            <DiffStats additions={turn.additions} deletions={turn.deletions} compact className="assistant-turn-review__diff-summary-stats shrink-0 gap-1 [&>div]:w-9" />
            {turn.reviewStatus ? <span className="text-sparkle-text-muted/25">·</span> : null}
            <AssistantReviewTurnStatusBadge status={turn.reviewStatus} compact />
            {renderDiffModeToggle()}
        </div>
    ) : null

    const renderFlushDiffHeader = () => displayedSelectedDiff ? (
        <div className="flex min-h-11 items-center justify-between gap-2 border-b border-white/[0.08] bg-[color-mix(in_srgb,var(--color-card)_92%,black)] px-3">
            <div className="flex min-w-0 items-center gap-1.5">
                {selectedFileStatus ? <AssistantFileChangeStatusPill status={selectedFileStatus} /> : null}
                <span className="truncate font-mono text-[10px] text-sparkle-text-secondary">{displayedSelectedDiff.displayPath}</span>
            </div>
            {renderDiffHeaderActions()}
        </div>
    ) : null

    const renderFiles = () => (
        <div className="py-1">
            {visibleFiles.map((file) => {
                const target = file.target
                const active = !showAllChanges
                    && Boolean(selectedDiff)
                    && selectedDiff?.activityId === target.activityId
                    && targetsReferToSameFile(selectedDiff, target)
                const status = resolveAssistantFileChangeStatus({
                    kind: target.changeKind,
                    isNew: target.isNew,
                    previousPath: target.previousPath
                })
                const editCount = fileEditCounts.get(normalizeReviewFilePath(target.filePath)) || 1
                return (
                    <button
                        key={`${target.activityId}:${target.filePath}`}
                        type="button"
                        onClick={() => handleSelectFile(target)}
                        className={cn(
                            'assistant-turn-review__file-row group/file relative flex h-8 w-full items-center gap-2 px-3 text-left transition-colors duration-75',
                            active
                                ? 'bg-[color-mix(in_srgb,var(--accent-primary)_9%,transparent)] text-sparkle-text'
                                : 'text-sparkle-text-secondary hover:bg-white/[0.035]'
                        )}
                    >
                        {active ? <span className="absolute inset-y-1 left-0 w-0.5 rounded-r bg-[var(--accent-primary)]/70" aria-hidden="true" /> : null}
                        <FileEntryIcon pathValue={target.filePath} kind="file" theme={iconTheme} className="assistant-turn-review__file-icon size-3.5 shrink-0" />
                        <span className="min-w-0 flex-1 truncate font-mono text-[10px]">{target.displayPath}</span>
                        {editCount > 1 ? (
                            <span className="assistant-turn-review__file-edit-count shrink-0 whitespace-nowrap rounded bg-white/[0.045] px-1.5 py-0.5 font-mono text-[8px] text-sparkle-text-muted/70">
                                {editCount} edits
                            </span>
                        ) : null}
                        <AssistantFileChangeStatusPill status={status} className="assistant-turn-review__file-status" />
                        <span className="assistant-turn-review__file-stats inline-flex w-[4.5rem] shrink-0 justify-end gap-1.5 whitespace-nowrap font-mono text-[9px] tabular-nums">
                            <span className="text-emerald-400">+{file.additions}</span>
                            <span className="text-rose-400">-{file.deletions}</span>
                        </span>
                    </button>
                )
            })}
            {hiddenFileCount > 0 ? (
                <button
                    type="button"
                    onClick={() => setVisibleFileCount((current) => Math.min(reviewFiles.length, current + INITIAL_VISIBLE_FILES))}
                    className="h-8 w-full text-[9px] font-medium text-sparkle-text-muted hover:bg-white/[0.025] hover:text-sparkle-text-secondary"
                >
                    Load {nextVisibleFileBatchSize} more files · {hiddenFileCount} remaining
                </button>
            ) : null}
            {reviewFiles.length === 0 ? (
                <div className="inline-flex items-center gap-1 px-3 py-4 text-[10px] leading-4">
                    <span className="italic text-sparkle-text-muted/45">No diff</span>
                    {turn.reviewStatus ? <span className="text-sparkle-text-muted/25">·</span> : null}
                    <AssistantReviewTurnStatusBadge status={turn.reviewStatus} compact />
                </div>
            ) : null}
        </div>
    )

    const renderDiffSurface = () => showAllChanges ? (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1">
                {parsedRecordedChangeEntries.length === renderedRecordedChanges.length && parsedRecordedChangeEntries.length > 0 ? (
                    <PatchDiffViewer
                        key={`all:${turn.id}`}
                        fileDiffs={parsedRecordedChangeEntries.map((entry) => entry.fileDiff)}
                        workspaceRoot={workspaceRoot}
                        mode={effectiveRenderMode}
                        flush
                        hideChangeIcon
                        hideHeaderStats
                        renderFileHeaderPrefix={(_fileDiff, index) => renderRecordedChangeStatus(parsedRecordedChangeEntries[index]?.change)}
                        renderFileHeaderMetadata={(_fileDiff, index) => {
                            const version = allChangeVersions[index]
                            return renderRecordedChangeMetadata(
                                parsedRecordedChangeEntries[index]?.change,
                                version?.number || index + 1,
                                version?.total || 1
                            )
                        }}
                        onRenderingChange={onLoadingChange}
                    />
                ) : renderedChangesPatch ? (
                    <RawPatchFallback
                        patch={renderedChangesPatch}
                        flush
                        notice="Unable to parse this Review batch. Showing its raw patch instead."
                    />
                ) : (
                    <div className="flex min-h-full items-center justify-center px-6 text-center text-[11px] text-sparkle-text-muted">
                        No combined diff is available for this turn.
                    </div>
                )}
            </div>
            {hiddenRecordedChangeCount > 0 ? (
                <button
                    type="button"
                    onClick={() => setVisibleRecordedChangeCount((current) => Math.min(turn.changes.length, current + RENDERED_CHANGE_BATCH_SIZE))}
                    className="h-8 shrink-0 border-t border-white/[0.07] bg-[color-mix(in_srgb,var(--color-card)_76%,black)] text-[9px] font-medium text-sparkle-text-muted transition-colors hover:bg-[color-mix(in_srgb,var(--color-card)_88%,black)] hover:text-sparkle-text-secondary"
                >
                    Render {nextRecordedChangeBatchSize} more changes · {hiddenRecordedChangeCount} remaining
                </button>
            ) : null}
        </div>
    ) : preparedSelectedDiff ? (
        <div className="min-h-0 flex-1">
            {parsedRecordedChangeEntries.length === selectedFileChanges.length && parsedRecordedChangeEntries.length > 0 ? (
                <PatchDiffViewer
                    key={`${turn.id}:${normalizeReviewFilePath(preparedSelectedDiff.filePath)}:history:${selectedFileChanges.length}`}
                    fileDiffs={parsedRecordedChangeEntries.map((entry) => entry.fileDiff)}
                    workspaceRoot={workspaceRoot}
                    mode={effectiveRenderMode}
                    flush
                    hideChangeIcon
                    hideHeaderStats
                    renderFileHeaderPrefix={(_fileDiff, index) => renderRecordedChangeStatus(parsedRecordedChangeEntries[index]?.change)}
                    activeFileDiffIndex={activeSelectedFileChangeIndex >= 0 ? activeSelectedFileChangeIndex : null}
                    activeFileDiffScrollKey={`${focusSelectedDiffRequestId ?? 'review'}:${preparedSelectedDiff.activityId}:${preparedSelectedDiff.filePath}`}
                    renderFileHeaderMetadata={(_fileDiff, index) => renderRecordedChangeMetadata(
                        parsedRecordedChangeEntries[index]?.change,
                        index + 1,
                        selectedFileChanges.length
                    )}
                    onRenderingChange={onLoadingChange}
                />
            ) : resolvedFileDiff ? (
                <PatchDiffViewer
                    key={`${preparedSelectedDiff.activityId}:${preparedSelectedDiff.filePath}:parsed`}
                    fileDiff={resolvedFileDiff}
                    workspaceRoot={workspaceRoot}
                    mode={effectiveRenderMode}
                    flush
                    headerPrefix={selectedFileStatus ? <AssistantFileChangeStatusPill status={selectedFileStatus} /> : null}
                    headerMetadata={renderDiffHeaderActions()}
                    onRenderingChange={onLoadingChange}
                />
            ) : filePatch ? (
                <PatchDiffViewer
                    key={`${preparedSelectedDiff.activityId}:${preparedSelectedDiff.filePath}:patch`}
                    patch={filePatch}
                    mode={effectiveRenderMode}
                    flush
                    headerPrefix={selectedFileStatus ? <AssistantFileChangeStatusPill status={selectedFileStatus} /> : null}
                    headerMetadata={renderDiffHeaderActions()}
                    onRenderingChange={onLoadingChange}
                />
            ) : preparedSelectedDiff.patch.trim() ? (
                <RawPatchFallback
                    patch={preparedSelectedDiff.patch}
                    flush
                    header={renderFlushDiffHeader()}
                    notice={parsedDiff.error
                        ? 'Falling back to raw diff view because patch parsing failed.'
                        : 'Unable to isolate this file. Showing the recorded patch instead.'}
                />
            ) : (
                <div className="flex min-h-full flex-col">
                    {renderFlushDiffHeader()}
                    <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-10 text-center">
                        <div className="max-w-[280px]">
                            <p className="text-[11px] font-medium text-sparkle-text-secondary">Diff unavailable for this recorded edit.</p>
                            <p className="mt-1 text-[9px] leading-4 text-sparkle-text-muted">The file activity was saved without patch content.</p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    ) : selectedDiff ? (
        <div className="flex min-h-0 flex-1 flex-col" aria-label="Loading selected diff">
            {renderFlushDiffHeader()}
            <div className="px-3 py-3">
                <div className="h-3 w-full animate-pulse rounded bg-white/[0.025]" />
                <div className="mt-2 h-3 w-5/6 animate-pulse rounded bg-white/[0.025]" />
                <div className="mt-2 h-3 w-11/12 animate-pulse rounded bg-white/[0.025]" />
            </div>
        </div>
    ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-[11px] text-sparkle-text-muted">
            {turn.files.length > 0 ? 'Select a changed file to review.' : 'No diff was produced for this turn.'}
        </div>
    )

    return (
        <section
            ref={rootRef}
            className="assistant-turn-review relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[color-mix(in_srgb,var(--color-bg)_95%,black)]"
            style={{ '--assistant-turn-review-rail-width': `${railWidth}px` } as CSSProperties}
            aria-label={`Review turn ${turn.number}`}
        >
            <div className="assistant-turn-review__narrow-header hidden h-10 shrink-0 items-center gap-2 border-b border-white/[0.06] px-2">
                {showBack ? (
                    <button type="button" onClick={onBack} className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-sparkle-text-muted hover:bg-white/[0.05]" aria-label="Back to chat review">
                        <ArrowLeft size={13} />
                    </button>
                ) : null}
                <span className="shrink-0 font-mono text-[9px] font-bold text-[var(--accent-primary)]">TURN {turn.number}</span>
                <time className="assistant-turn-review__turn-time ml-auto shrink-0 whitespace-nowrap text-right text-[8px] text-sparkle-text-muted/60" dateTime={turn.updatedAt}>{exactTurnDateTime}</time>
            </div>

            <nav className="assistant-turn-review__narrow-nav hidden h-10 shrink-0 items-end gap-1 border-b border-white/[0.06] px-2" aria-label="Turn review sections">
                <button
                    type="button"
                    onClick={() => setNarrowSurface('review')}
                    className={cn(
                        'flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 border-b-2 px-2 text-[9px] font-semibold transition-colors',
                        narrowSurface === 'review'
                            ? 'border-[var(--accent-primary)] text-sparkle-text'
                            : 'border-transparent text-sparkle-text-muted hover:text-sparkle-text-secondary'
                    )}
                    aria-pressed={narrowSurface === 'review'}
                >
                    <span className="truncate">Context &amp; files</span>
                    <span className="shrink-0 font-mono text-[8px] text-sparkle-text-muted/60">{reviewFiles.length}</span>
                </button>
                <button
                    type="button"
                    onClick={() => setNarrowSurface('diff')}
                    className={cn(
                        'flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 border-b-2 px-2 text-[9px] font-semibold transition-colors',
                        narrowSurface === 'diff'
                            ? 'border-[var(--accent-primary)] text-sparkle-text'
                            : 'border-transparent text-sparkle-text-muted hover:text-sparkle-text-secondary'
                    )}
                    aria-pressed={narrowSurface === 'diff'}
                >
                    <span className="shrink-0">Diff</span>
                    {turn.files.length > 0 ? <DiffStats additions={turn.additions} deletions={turn.deletions} compact className="assistant-turn-review__narrow-diff-stats min-w-0 gap-1 [&>div]:w-8" /> : null}
                </button>
            </nav>

            <div className="assistant-turn-review__body relative min-h-0 flex-1">
                <aside className={cn(
                    'assistant-turn-review__rail min-h-0 overflow-hidden border-r border-white/[0.06] bg-[color-mix(in_srgb,var(--color-card)_34%,var(--color-bg))]',
                    responseExpanded && 'assistant-turn-review__rail--response-expanded'
                )}>
                    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-white/[0.06] bg-[color-mix(in_srgb,var(--color-bg)_95%,black)] px-2.5">
                        {showBack ? (
                            <button type="button" onClick={onBack} className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-sparkle-text-muted hover:bg-white/[0.05] hover:text-sparkle-text" aria-label="Back to chat review">
                                <ArrowLeft size={14} />
                            </button>
                        ) : null}
                        <span className="shrink-0 font-mono text-[9px] font-bold text-[var(--accent-primary)]">TURN {turn.number}</span>
                        <time className="assistant-turn-review__turn-time ml-auto shrink-0 whitespace-nowrap text-right text-[8px] text-sparkle-text-muted/55" dateTime={turn.updatedAt}>{exactTurnDateTime}</time>
                        <time className="assistant-turn-review__turn-time-compact ml-auto hidden shrink-0 whitespace-nowrap text-right text-[8px] text-sparkle-text-muted/55" dateTime={turn.updatedAt}>{compactTurnDateTime}</time>
                    </div>
                    <div data-assistant-capsule-scroll="turn-conversation" className="assistant-turn-review__conversation-pane custom-scrollbar min-h-0 min-w-0 overflow-x-hidden overflow-y-auto border-b border-white/[0.055] [scrollbar-gutter:stable]">
                        {renderConversation()}
                    </div>
                    <div className="flex h-7 shrink-0 items-center justify-center border-b border-white/[0.045] bg-[color-mix(in_srgb,var(--color-bg)_90%,black)]">
                        <button
                            type="button"
                            onClick={() => setResponseExpanded((current) => !current)}
                            className="inline-flex h-6 items-center gap-1 px-2 text-[9px] font-medium text-[var(--accent-primary)]/75 hover:bg-white/[0.03] hover:text-[var(--accent-primary)]"
                            aria-expanded={responseExpanded}
                        >
                            {responseExpanded ? 'Collapse response' : 'Full agent response'}
                            {responseExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                        </button>
                    </div>
                    <div className="assistant-turn-review__files-pane flex min-h-0 flex-col">
                        <div className="flex h-9 shrink-0 items-center justify-between border-b border-white/[0.045] px-3">
                            <span className="inline-flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.08em] text-sparkle-text-muted/55">
                                <Files size={11} />
                                Changed files
                            </span>
                            <span className="font-mono text-[9px] text-sparkle-text-muted/50">{reviewFiles.length}</span>
                        </div>
                        <div data-assistant-capsule-scroll="turn-files" className="custom-scrollbar min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">{renderFiles()}</div>
                    </div>
                </aside>

                <button
                    type="button"
                    className="assistant-turn-review__rail-resizer absolute inset-y-0 z-20 w-2 -translate-x-1/2 cursor-col-resize touch-none"
                    style={{ left: `${railWidth}px` }}
                    onPointerDown={handleRailResizePointerDown}
                    onPointerMove={handleRailResizePointerMove}
                    onPointerUp={finishRailResize}
                    onPointerCancel={finishRailResize}
                    aria-label="Resize turn context sidebar"
                >
                    <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors hover:bg-[var(--accent-primary)]/35" />
                </button>

                <main ref={diffSurfaceRef} data-assistant-capsule-scroll="turn-diff" className={cn(
                    'assistant-turn-review__diff-surface flex min-h-0 min-w-0 flex-1 flex-col bg-[color-mix(in_srgb,var(--color-bg)_82%,black)]',
                    narrowSurface !== 'diff' && 'assistant-turn-review__narrow-hidden'
                )}>
                    {renderDiffSummaryBar()}
                    {renderDiffSurface()}
                </main>

                {narrowSurface === 'review' ? (
                    <section className="assistant-turn-review__narrow-panel min-h-0 min-w-0 max-w-full flex-1 overflow-hidden bg-[color-mix(in_srgb,var(--color-card)_26%,var(--color-bg))]">
                        <div data-assistant-capsule-scroll="turn-review" className="custom-scrollbar min-h-0 min-w-0 overflow-x-hidden overflow-y-auto border-b border-white/[0.055] [scrollbar-gutter:stable]">
                            {renderConversation()}
                        </div>
                        <div className="flex min-h-0 min-w-0 max-w-full flex-col overflow-hidden">
                            <div className="flex h-9 shrink-0 items-center justify-between border-b border-white/[0.055] px-3">
                                <span className="inline-flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.08em] text-sparkle-text-muted/55">
                                    <Files size={11} />
                                    Changed files
                                </span>
                                <span className="font-mono text-[9px] text-sparkle-text-muted/50">{reviewFiles.length}</span>
                            </div>
                            <div data-assistant-capsule-scroll="turn-files" className="custom-scrollbar min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">{renderFiles()}</div>
                        </div>
                    </section>
                ) : null}
            </div>
        </section>
    )
})
