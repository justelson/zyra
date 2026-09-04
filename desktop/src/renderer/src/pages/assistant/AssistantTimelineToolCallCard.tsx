import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, FilePenLine, FileText, MessageSquareQuote, Search, SquareTerminal, Wrench } from 'lucide-react'
import { parseAssistantHistoryBodyRef, type AssistantActivity, type AssistantHistoryBody, type AssistantUserInputQuestion, type FileChangeKind } from '@shared/assistant/contracts'
import {
    analyzeAssistantReadResult,
    buildAssistantReadPreview,
    type AssistantReadMetadata
} from '@shared/assistant/read-activity'
import { AnimatedHeight } from '@/components/ui/AnimatedHeight'
import { getFileUrl } from '@/components/ui/file-preview/utils'
import type { AssistantChatDisplayMode, AssistantToolOutputDefaultMode } from '@/lib/settings'
import { cn } from '@/lib/utils'
import { extractFilePatch, scanPatchFileSummaries } from '@/lib/diffRendering'
import { AssistantAttachmentImageCard } from './AssistantAttachmentImageCard'
import { AssistantInlineDiffPreview } from './AssistantInlineDiffPreview'
import type { AssistantDiffTarget } from './assistant-diff-types'
import {
    AssistantFileChangeStatusPill,
    resolveAssistantFileChangeStatus
} from './AssistantFileChangeStatusPill'
import { getAssistantRelativeFilePath } from './assistant-file-navigation'
import { stripAssistantCommandEnvelope } from './assistant-action-presentation'
import { formatAssistantActionTime } from './AssistantTimelineActionShell'
import { getTerminalOutputHeightClass } from './assistant-timeline-layout'
import { useAssistantVisibleText } from './useAssistantVisibleText'
import {
    areActivitiesEquivalent,
    getActivityCommand,
    getActivityDetails,
    getActivityDiffStats,
    getActivityElapsed,
    getActivityOutput,
    getActivityPatch,
    getActivityPaths,
    getActivityStatus,
    getActivityStartedAt,
    getActivityTitle,
    getCreatedFilePaths,
    getTimelineActivityDomId,
    isCommandActivity,
    isCommandCheckpointActivity
} from './assistant-timeline-helpers'
import {
    isAbsoluteFilesystemPathLine,
    normalizeComparablePath,
    TimelineCopyButton,
    TimelineFilePathRow,
    TimelinePathAwareTextBlock
} from './assistant-timeline-path-ui'

function getCanonicalActivityImagePaths(activity: AssistantActivity): string[] {
    const values = Array.isArray(activity.payload?.imageAttachments)
        ? activity.payload.imageAttachments
        : []
    return [...new Set(values.flatMap((value) => {
        if (typeof value === 'string') {
            const match = value.match(/^path:\s*(.+)$/im)
            return match?.[1]?.trim() ? [match[1].trim()] : []
        }
        if (value && typeof value === 'object' && typeof (value as { path?: unknown }).path === 'string') {
            return [String((value as { path: string }).path).trim()].filter(Boolean)
        }
        return []
    }))]
}

function getMinimalStatusIconClassName(status: 'success' | 'running' | 'failed'): string {
    if (status === 'running') return 'text-[color-mix(in_srgb,var(--status-warning)_68%,var(--color-text-muted))]'
    if (status === 'failed') return 'text-[color-mix(in_srgb,var(--status-danger)_72%,var(--color-text-muted))]'
    return 'text-sparkle-text-muted/55'
}

function isReadActivity(activity: AssistantActivity): boolean {
    return activity.kind === 'file-read'
}

function isRawToolActivity(activity: AssistantActivity): boolean {
    return !isCommandActivity(activity)
        && !isReadActivity(activity)
        && activity.kind !== 'file-change'
        && activity.kind !== 'user-input.resolved'
}

function shouldAutoExpandTerminalTool(activity: AssistantActivity, mode: AssistantToolOutputDefaultMode): boolean {
    if (mode !== 'expanded') return false
    return (isCommandActivity(activity) || isRawToolActivity(activity)) && getActivityStatus(activity) === 'running'
}

function isKnownFilePathReference(line: string, knownPaths: Set<string>): boolean {
    const trimmed = line.trim()
    if (!trimmed) return false

    const withoutStatus = trimmed.replace(/^(?:[MADRCU?!]{1,2}|modified:|created:|updated:|deleted:|renamed:)\s+/i, '').trim()
    const candidates = [trimmed, withoutStatus]

    for (const candidate of candidates) {
        const normalized = normalizeComparablePath(candidate)
        if (knownPaths.has(normalized)) return true

        for (const knownPath of knownPaths) {
            if (normalized.endsWith(`/${knownPath}`) || knownPath.endsWith(`/${normalized}`)) return true
        }
    }

    return false
}

function getActivityFileChangeKind(
    activity: AssistantActivity,
    filePath: string,
    previousPath?: string
): FileChangeKind | undefined {
    const targetPaths = new Set([filePath, previousPath]
        .filter((value): value is string => Boolean(value))
        .map(normalizeComparablePath))
    const changes = Array.isArray(activity.payload?.changes) ? activity.payload.changes : []

    for (const value of changes) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue
        const change = value as Record<string, unknown>
        const changePaths = [change.path, change.filePath, change.file_path, change.previousPath, change.previous_path]
            .filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()))
            .map(normalizeComparablePath)
        if (!changePaths.some((entry) => targetPaths.has(entry))) continue
        const kind = change.kind
        if (kind === 'add' || kind === 'delete' || kind === 'update' || kind === 'move') return kind
    }

    return undefined
}

function getVisibleFileChangeOutput(output: string, knownPaths: Set<string>): string {
    const lines = output.split(/\r?\n/)
    const visibleLines = lines.filter((line) => {
        const trimmed = line.trim()
        if (!trimmed) return false
        if (/^success\.?$/i.test(trimmed)) return false
        if (/^(success\.\s*)?updated the following files:?$/i.test(trimmed)) return false
        return !isKnownFilePathReference(trimmed, knownPaths)
    })

    return visibleLines.join('\n').trim()
}

function readOptionalActivityNumber(value: unknown): number | undefined {
    const number = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(number) && number >= 0 ? number : undefined
}

function getReadActivityMetadata(
    activity: AssistantActivity,
    output: string,
    status: 'success' | 'running' | 'failed'
): AssistantReadMetadata {
    const analyzed = analyzeAssistantReadResult({
        args: activity.payload?.args,
        result: activity.payload?.result,
        output,
        status: status === 'success' ? 'completed' : status
    })
    const payload = activity.payload || {}
    return {
        readStartLine: readOptionalActivityNumber(payload.readStartLine) || analyzed.readStartLine,
        readEndLine: readOptionalActivityNumber(payload.readEndLine) ?? analyzed.readEndLine,
        readLineCount: readOptionalActivityNumber(payload.readLineCount) ?? analyzed.readLineCount,
        readTotalLines: readOptionalActivityNumber(payload.readTotalLines) ?? analyzed.readTotalLines,
        readRequestedLimit: readOptionalActivityNumber(payload.readRequestedLimit) ?? analyzed.readRequestedLimit,
        readComplete: typeof payload.readComplete === 'boolean' ? payload.readComplete : analyzed.readComplete,
        readTruncated: typeof payload.readTruncated === 'boolean' ? payload.readTruncated : analyzed.readTruncated,
        readIsImage: typeof payload.readIsImage === 'boolean' ? payload.readIsImage : analyzed.readIsImage
    }
}

function getReadLineRangeLabel(metadata: AssistantReadMetadata): string | null {
    if (metadata.readIsImage || metadata.readComplete || metadata.readLineCount === undefined || metadata.readLineCount < 1) return null
    const endLine = metadata.readEndLine ?? metadata.readStartLine + metadata.readLineCount - 1
    return `(line ${metadata.readStartLine} to ${endLine})`
}

function getActivityIcon(activity: AssistantActivity) {
    if (isCommandActivity(activity)) return <SquareTerminal size={13} />
    if (activity.kind === 'user-input.resolved') return <MessageSquareQuote size={13} />
    if (activity.kind === 'search') return <Search size={13} />
    if (activity.kind === 'file-read') return <FileText size={13} />
    if (activity.kind === 'file-change') return <FilePenLine size={13} />
    return <Wrench size={13} />
}

function getResolvedUserInputEntries(activity: AssistantActivity): Array<{
    id: string
    header: string
    question: string
    answer: string
}> {
    const payload = activity.payload || {}
    const questions = Array.isArray(payload.questions) ? payload.questions as AssistantUserInputQuestion[] : []
    const answers = payload.answers && typeof payload.answers === 'object' ? payload.answers as Record<string, string | string[]> : {}
    return questions.map((question, index) => {
        const rawAnswer = answers[question.id]
        const answer = Array.isArray(rawAnswer) ? rawAnswer.join(', ') : String(rawAnswer || '').trim()
        return {
            id: question.id || `question-${index}`,
            header: question.header || `Question ${index + 1}`,
            question: question.question || '',
            answer: answer || 'No answer provided'
        }
    })
}

function InlineDiffStats({ additions, deletions, className }: { additions: number; deletions: number; className?: string }) {
    return (
        <span className={cn('inline-flex items-center gap-1.5 font-mono text-[10px] leading-none', className)}>
            <span className="text-[color-mix(in_srgb,var(--status-success)_72%,var(--color-text))]">+{additions}</span>
            <span className="text-[color-mix(in_srgb,var(--status-danger)_72%,var(--color-text))]">-{deletions}</span>
        </span>
    )
}

export const TimelineToolCallCard = memo(({
    activity: sourceActivity,
    displayMode = 'detailed',
    runningCommandCount = 0,
    projectRootPath,
    toolOutputDefaultMode = 'expanded',
    actionTitle,
    onOpenFilePath,
    onViewDiff,
    onRevealActivity
}: {
    activity: AssistantActivity
    displayMode?: AssistantChatDisplayMode
    runningCommandCount?: number
    projectRootPath?: string | null
    toolOutputDefaultMode?: AssistantToolOutputDefaultMode
    actionTitle?: string | null
    onOpenFilePath?: (filePath: string) => Promise<void> | void
    onOpenUrl?: (url: string) => Promise<boolean | void> | boolean | void
    onViewDiff?: (target: AssistantDiffTarget) => void
    onRevealActivity?: (activityId: string) => void
}) => {
    const historyBodyRef = useMemo(() => parseAssistantHistoryBodyRef(sourceActivity.payload?.historyBodyRef), [sourceActivity])
    const [hydratedBody, setHydratedBody] = useState<AssistantHistoryBody | null>(null)
    const [historyBodyLoading, setHistoryBodyLoading] = useState(false)
    const [historyBodyError, setHistoryBodyError] = useState<string | null>(null)
    const activity = useMemo<AssistantActivity>(() => hydratedBody ? {
        ...sourceActivity,
        payload: {
            ...(sourceActivity.payload || {}),
            ...hydratedBody.payload
        }
    } : sourceActivity, [hydratedBody, sourceActivity])
    const [expanded, setExpanded] = useState(() => !historyBodyRef && (getCanonicalActivityImagePaths(activity).length > 0 || shouldAutoExpandTerminalTool(activity, toolOutputDefaultMode)))
    const [nowIso, setNowIso] = useState(() => new Date().toISOString())
    const userChangedExpansionRef = useRef(false)
    const autoCollapseTimerRef = useRef<number | null>(null)
    const commandOutputViewportRef = useRef<HTMLDivElement | null>(null)
    const previousStatusRef = useRef<'success' | 'running' | 'failed'>(getActivityStatus(activity))
    const filePaths = useMemo(() => getActivityPaths(activity), [activity])
    const createdFilePaths = useMemo(() => getCreatedFilePaths(activity), [activity])
    const canonicalImagePaths = useMemo(() => getCanonicalActivityImagePaths(activity), [activity])
    const createdFilePathSet = useMemo(() => new Set(createdFilePaths), [createdFilePaths])
    const displayFilePaths = useMemo(
        () => filePaths.map((pathValue) => getAssistantRelativeFilePath(pathValue, projectRootPath)),
        [filePaths, projectRootPath]
    )
    const primaryValue = useMemo(() => getActivityCommand(activity), [activity])
    const title = useMemo(() => getActivityTitle(activity), [activity])
    const status = useMemo(() => getActivityStatus(activity), [activity])
    const minimal = displayMode === 'minimal'
    const isCommandFollowUp = isCommandCheckpointActivity(activity)
    const relatedCommandActivityId = typeof activity.payload?.relatedCommandActivityId === 'string'
        ? activity.payload.relatedCommandActivityId.trim()
        : ''
    const opensRelatedCommand = Boolean(isCommandFollowUp && relatedCommandActivityId && onRevealActivity)
    const followUpStatusLabel = status === 'running' ? 'Running' : status === 'failed' ? 'Failed' : 'Done'
    const elapsed = useMemo(
        () => getActivityElapsed(activity, status === 'running' ? nowIso : null),
        [activity, nowIso, status]
    )
    const diffStats = useMemo(() => getActivityDiffStats(activity), [activity])
    const uniqueFileCount = useMemo(() => new Set(filePaths).size, [filePaths])
    const patch = useMemo(() => expanded ? getActivityPatch(activity) : null, [activity, expanded])
    const authoritativeRawOutput = useMemo(() => getActivityOutput(activity), [activity])
    const readMetadata = useMemo(
        () => isReadActivity(activity) ? getReadActivityMetadata(activity, authoritativeRawOutput, status) : null,
        [activity, authoritativeRawOutput, status]
    )
    const readLineRangeLabel = useMemo(() => readMetadata ? getReadLineRangeLabel(readMetadata) : null, [readMetadata])
    const readPreview = useMemo(
        () => isReadActivity(activity) ? buildAssistantReadPreview(authoritativeRawOutput) : null,
        [activity, authoritativeRawOutput]
    )
    const outputPresentation = useAssistantVisibleText({
        streamId: activity.id,
        channel: 'activity',
        text: authoritativeRawOutput,
        streaming: status === 'running',
        mode: 'stream'
    })
    const rawOutput = status === 'running' || outputPresentation.presenting
        ? outputPresentation.text
        : authoritativeRawOutput
    const output = expanded ? rawOutput : ''
    const resolvedUserInputEntries = useMemo(
        () => activity.kind === 'user-input.resolved' ? getResolvedUserInputEntries(activity) : [],
        [activity]
    )
    const isResolvedUserInput = activity.kind === 'user-input.resolved'
    const rawDetailLines = useMemo(
        () => getActivityDetails(activity).filter((line) => line !== primaryValue && line !== rawOutput && !filePaths.includes(line)),
        [activity, filePaths, primaryValue, rawOutput]
    )
    const detailLines = useMemo(() => expanded ? rawDetailLines : [], [expanded, rawDetailLines])
    const patchFileSummaries = useMemo(() => expanded && patch ? scanPatchFileSummaries(patch) : [], [expanded, patch])
    const fileSectionEntries = useMemo(() => {
        if (!expanded) return []

        if (patchFileSummaries.length > 0) {
            return patchFileSummaries.map((summary) => {
                const isNew = createdFilePathSet.has(summary.path)
                const changeKind = getActivityFileChangeKind(activity, summary.path, summary.previousPath)
                return {
                    fullPath: summary.path,
                    displayPath: getAssistantRelativeFilePath(summary.path, projectRootPath) || summary.path,
                    previousPath: summary.previousPath,
                    isNew,
                    changeKind,
                    additions: summary.additions,
                    deletions: summary.deletions
                }
            })
        }

        if (activity.kind === 'file-change') {
            const fallbackChangedFileCount = Math.max(1, diffStats?.fileCount || 1)
            const uniquePaths: string[] = []
            for (const fullPath of filePaths) {
                if (uniquePaths.includes(fullPath)) continue
                uniquePaths.push(fullPath)
                if (uniquePaths.length >= fallbackChangedFileCount) break
            }

            return uniquePaths.map((fullPath) => {
                const originalIndex = filePaths.indexOf(fullPath)
                const isNew = createdFilePathSet.has(fullPath)
                const changeKind = getActivityFileChangeKind(activity, fullPath)
                return {
                    fullPath,
                    displayPath: displayFilePaths[originalIndex] || fullPath,
                    previousPath: undefined,
                    isNew,
                    changeKind,
                    additions: null,
                    deletions: null
                }
            })
        }

        const seen = new Set<string>()
        return filePaths.flatMap((fullPath, index) => {
            if (seen.has(fullPath)) return []
            seen.add(fullPath)
            const isNew = createdFilePathSet.has(fullPath)
            const changeKind = getActivityFileChangeKind(activity, fullPath)
            return [{
                fullPath,
                displayPath: displayFilePaths[index] || fullPath,
                previousPath: undefined,
                isNew,
                changeKind,
                additions: null,
                deletions: null
            }]
        })
    }, [activity, createdFilePathSet, diffStats?.fileCount, displayFilePaths, expanded, filePaths, patchFileSummaries, projectRootPath])
    const displayedComparablePathSet = useMemo(() => {
        const comparablePaths = new Set<string>()
        for (const entry of fileSectionEntries) {
            comparablePaths.add(normalizeComparablePath(entry.fullPath))
            comparablePaths.add(normalizeComparablePath(entry.displayPath))
        }
        return comparablePaths
    }, [fileSectionEntries])
    const secondaryPathEntries = useMemo(
        () => expanded ? filePaths.slice(1).map((fullPath, index) => ({
            fullPath,
            displayPath: displayFilePaths[index + 1] || fullPath,
            isNew: createdFilePathSet.has(fullPath)
        })) : [],
        [createdFilePathSet, displayFilePaths, expanded, filePaths]
    )
    const effectiveFileCount = diffStats?.fileCount ?? uniqueFileCount
    const isMultiFileChange = activity.kind === 'file-change' && effectiveFileCount > 1
    const isCommand = isCommandActivity(activity)
    const isRead = isReadActivity(activity)
    const isRawTool = isRawToolActivity(activity)
    const isTerminalLikeTool = isCommand || isRawTool
    const primaryLabel = actionTitle || (isResolvedUserInput
        ? (primaryValue || `${resolvedUserInputEntries.length} answers captured`)
        : activity.kind === 'file-change'
            ? (displayFilePaths[0]
                ? `${displayFilePaths[0]}${isMultiFileChange ? ` +${Math.max(0, effectiveFileCount - 1)}` : ''}`
                : primaryValue || title)
            : primaryValue || title)
    const filteredOutput = useMemo(() => {
        if (!expanded || activity.kind !== 'file-change' || !output) return output

        const filteredLines = output
            .split(/\r?\n/)
            .filter((line) => !displayedComparablePathSet.has(normalizeComparablePath(line)))

        return filteredLines.join('\n').trim()
    }, [activity.kind, displayedComparablePathSet, expanded, output])
    const filteredDetailLines = useMemo(() => {
        if (!expanded || activity.kind !== 'file-change') return detailLines
        return detailLines.filter((line) => !displayedComparablePathSet.has(normalizeComparablePath(line)))
    }, [activity.kind, detailLines, displayedComparablePathSet, expanded])
    const visibleResultOutput = useMemo(() => {
        if (activity.kind !== 'file-change') return filteredOutput
        return getVisibleFileChangeOutput(filteredOutput, displayedComparablePathSet)
    }, [activity.kind, displayedComparablePathSet, filteredOutput])
    const failedFileChangeOutput = activity.kind === 'file-change' && status === 'failed'
        ? visibleResultOutput || 'The write failed before any file changes were applied.'
        : ''
    const visibleDetailLines = useMemo(() => {
        if (activity.kind !== 'file-change') return filteredDetailLines
        return filteredDetailLines.filter((line) => {
            const trimmed = line.trim()
            if (!trimmed) return false
            if (/^success\.?$/i.test(trimmed)) return false
            if (/^(success\.\s*)?updated the following files:?$/i.test(trimmed)) return false
            return !isKnownFilePathReference(trimmed, displayedComparablePathSet)
        })
    }, [activity.kind, displayedComparablePathSet, filteredDetailLines])
    const commandOutputText = isCommand
        ? (stripAssistantCommandEnvelope(filteredOutput, primaryValue) || (status === 'running' ? 'waiting for output...' : ''))
        : ''
    const commandHasStoredOutput = isCommand && rawOutput.trim().length > 0
    const rawToolBodyText = useMemo(() => {
        if (!expanded || !isRawTool) return ''

        const seen = new Set<string>()
        return [filteredOutput, ...filteredDetailLines]
            .map((line) => line.trim())
            .filter(Boolean)
            .filter((line) => {
                if (seen.has(line)) return false
                seen.add(line)
                return true
            })
            .join('\n')
    }, [expanded, filteredDetailLines, filteredOutput, isRawTool])
    const rawToolHasStoredOutput = isRawTool && (rawOutput.trim().length > 0 || rawDetailLines.length > 0)
    const rawToolOutputText = isRawTool
        ? (rawToolBodyText || (status === 'running' ? 'waiting for output...' : ''))
        : ''
    const commandCompletedWithoutOutput = isCommand && status !== 'running' && !commandHasStoredOutput && !historyBodyRef
    const rawToolCompletedWithoutOutput = isRawTool && status !== 'running' && !rawToolHasStoredOutput && !historyBodyRef
    const completedWithoutOutput = !isCommandFollowUp && (commandCompletedWithoutOutput || rawToolCompletedWithoutOutput)
    const terminalOutputText = isCommand ? commandOutputText : rawToolOutputText
    const terminalOutputHeightClass = getTerminalOutputHeightClass(status, runningCommandCount)
    const terminalHasRealOutput = isCommand ? Boolean(filteredOutput) : Boolean(rawToolBodyText)
    const hasTerminalOutput = isTerminalLikeTool && Boolean(terminalOutputText)
    const hasExpandableBody = Boolean(historyBodyRef) || (isCommand
        ? status === 'running' || commandHasStoredOutput
        : isRawTool
            ? status === 'running' || rawToolHasStoredOutput
            : true)
    const canExpandBody = hasExpandableBody && !opensRelatedCommand
    const copyValue = useMemo(() => {
        if (activity.kind === 'user-input.resolved') {
            return resolvedUserInputEntries
                .map((entry, index) => `${index + 1}. ${entry.header}\n${entry.question}\nAnswer: ${entry.answer}`)
                .join('\n\n')
        }
        if (isRead) return authoritativeRawOutput
        if (isCommand) {
            return [
                primaryValue ? `Input\n${primaryValue}` : '',
                filteredOutput ? `Output\n${filteredOutput}` : ''
            ].filter((value) => String(value || '').trim()).join('\n\n')
        }
        return [primaryValue, filteredOutput, ...filteredDetailLines].filter((value) => String(value || '').trim()).join('\n\n')
    }, [activity.kind, authoritativeRawOutput, expanded, filteredDetailLines, filteredOutput, isCommand, isRead, primaryValue, resolvedUserInputEntries])
    const canViewDiff = Boolean(expanded && onViewDiff && activity.kind === 'file-change' && status !== 'failed' && patch)
    const inlineDiffTarget = fileSectionEntries[0]
    const inlinePreviewPatch = useMemo(() => {
        if (!patch || !inlineDiffTarget) return ''
        return extractFilePatch(patch, inlineDiffTarget.fullPath, inlineDiffTarget.previousPath) || patch
    }, [inlineDiffTarget, patch])
    const primaryPathIsNew = Boolean(filePaths[0] && createdFilePathSet.has(filePaths[0]))
    const primaryPathChangeKind = filePaths[0] ? getActivityFileChangeKind(activity, filePaths[0]) : undefined
    const primaryPathChangeStatus = resolveAssistantFileChangeStatus({
        kind: primaryPathChangeKind,
        isNew: primaryPathIsNew
    })
    const activityStartedAt = useMemo(() => getActivityStartedAt(activity), [activity])
    const viewDiffForPath = useCallback((
        filePath: string,
        displayPath: string,
        previousPath?: string,
        isNew = false,
        changeKind?: FileChangeKind
    ) => {
        if (!onViewDiff || !patch) return
        onViewDiff({
            activityId: activity.id,
            turnId: activity.turnId,
            filePath,
            displayPath,
            patch,
            previousPath,
            createdAt: activity.createdAt,
            isNew,
            changeKind,
            provisional: status === 'running' || activity.payload?.authoritative !== true,
            truncated: activity.payload?.truncated === true,
            unavailableReason: typeof activity.payload?.diffUnavailableReason === 'string'
                ? activity.payload.diffUnavailableReason
                : undefined
        })
    }, [activity.createdAt, activity.id, activity.payload, onViewDiff, patch, status])
    const handleOpenInlineDiff = useCallback(() => {
        if (!canViewDiff || !inlineDiffTarget) return
        viewDiffForPath(
            inlineDiffTarget.fullPath,
            inlineDiffTarget.displayPath,
            inlineDiffTarget.previousPath,
            inlineDiffTarget.isNew,
            inlineDiffTarget.changeKind
        )
    }, [canViewDiff, inlineDiffTarget, viewDiffForPath])
    const hydrateHistoryBody = useCallback(async () => {
        if (!historyBodyRef || hydratedBody || historyBodyLoading) return
        setHistoryBodyLoading(true)
        setHistoryBodyError(null)
        try {
            const result = await window.devscope.assistant.hydrateHistoryBody({ activityId: sourceActivity.id, ref: historyBodyRef })
            if (!result.success) throw new Error(result.error)
            setHydratedBody(result.body)
        } catch (error) {
            setHistoryBodyError(error instanceof Error ? error.message : 'Failed to load historical tool output.')
        } finally {
            setHistoryBodyLoading(false)
        }
    }, [historyBodyLoading, historyBodyRef, hydratedBody, sourceActivity.id])
    const handleToggleExpanded = useCallback(() => {
        if (!canExpandBody) return
        userChangedExpansionRef.current = true
        const nextExpanded = !expanded
        setExpanded(nextExpanded)
        if (nextExpanded) void hydrateHistoryBody()
    }, [canExpandBody, expanded, hydrateHistoryBody])
    const handlePrimaryAction = useCallback(() => {
        if (opensRelatedCommand) {
            onRevealActivity?.(relatedCommandActivityId)
            return
        }
        handleToggleExpanded()
    }, [handleToggleExpanded, onRevealActivity, opensRelatedCommand, relatedCommandActivityId])

    useEffect(() => {
        if (status !== 'running' || isRead) return
        setNowIso(new Date().toISOString())
        const intervalId = window.setInterval(() => setNowIso(new Date().toISOString()), 1000)
        return () => window.clearInterval(intervalId)
    }, [isRead, status])

    useLayoutEffect(() => {
        if (!isTerminalLikeTool || !canExpandBody || !expanded || !terminalOutputText) return
        const element = commandOutputViewportRef.current
        if (!element) return
        element.scrollTop = element.scrollHeight
    }, [canExpandBody, expanded, isTerminalLikeTool, terminalOutputHeightClass, terminalOutputText])

    useEffect(() => {
        if (!isTerminalLikeTool || !canExpandBody || status !== 'running' || userChangedExpansionRef.current) return
        setExpanded(toolOutputDefaultMode === 'expanded')
    }, [canExpandBody, isTerminalLikeTool, status, toolOutputDefaultMode])

    useEffect(() => {
        if (!isTerminalLikeTool) {
            previousStatusRef.current = status
            return
        }

        if (autoCollapseTimerRef.current !== null) {
            window.clearTimeout(autoCollapseTimerRef.current)
            autoCollapseTimerRef.current = null
        }

        if (status === 'running') {
            previousStatusRef.current = status
            return
        }

        if (previousStatusRef.current === 'running') {
            autoCollapseTimerRef.current = window.setTimeout(() => {
                setExpanded(false)
                autoCollapseTimerRef.current = null
            }, 500)
        }

        previousStatusRef.current = status

        return () => {
            if (autoCollapseTimerRef.current !== null) {
                window.clearTimeout(autoCollapseTimerRef.current)
                autoCollapseTimerRef.current = null
            }
        }
    }, [isTerminalLikeTool, status])

    return (
        <div
            id={getTimelineActivityDomId(activity.id)}
            className="assistant-tool-call-card px-0.5 py-0"
            data-assistant-tool-call={displayMode}
        >
            <button
                type="button"
                onClick={handlePrimaryAction}
                title={opensRelatedCommand ? 'Go to original command' : undefined}
                className={cn(
                    'group relative flex w-full min-w-0 items-center overflow-hidden text-left transition-colors',
                    minimal
                        ? 'min-h-7 gap-1.5 rounded-md px-0.5'
                        : isTerminalLikeTool
                            ? 'min-h-6 gap-1.5 rounded-md px-1 py-0.5'
                            : 'min-h-7 gap-2 rounded-md px-1.5 py-1',
                    canExpandBody || opensRelatedCommand ? 'hover:bg-[var(--surface-hover)]' : 'cursor-default'
                )}
            >
                <span className={cn(
                    'relative inline-flex shrink-0 items-center justify-center',
                    minimal ? `h-6 w-6 ${getMinimalStatusIconClassName(status)}` : `h-4 w-4 ${getMinimalStatusIconClassName(status)}`
                )}>
                    {getActivityIcon(activity)}
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                        <p className={cn(
                            'min-w-0 flex-1 truncate',
                            minimal
                                ? 'text-[12px] leading-6'
                                : actionTitle
                                    ? cn('text-[12px] font-medium', isTerminalLikeTool ? 'leading-4' : 'leading-5')
                                    : 'font-mono text-[11px] leading-5',
                            isTerminalLikeTool
                                ? actionTitle ? 'whitespace-nowrap text-sparkle-text-secondary' : minimal ? 'whitespace-nowrap font-mono text-sparkle-text-secondary' : 'whitespace-nowrap font-mono text-[color-mix(in_srgb,var(--status-success)_44%,var(--color-text))]'
                                : 'text-sparkle-text-secondary'
                        )}>
                            <span className="inline-flex min-w-0 items-center gap-1.5">
                                <span
                                    className={cn(
                                        'truncate',
                                        status === 'running' && actionTitle && 'assistant-title-shimmer'
                                    )}
                                >{primaryLabel}</span>
                                {actionTitle && primaryValue && primaryValue !== actionTitle ? (
                                    <span className={cn(
                                        'hidden max-w-[280px] shrink truncate rounded bg-[var(--surface-hover)] font-mono text-[9px] font-normal text-sparkle-text-muted sm:inline',
                                        isTerminalLikeTool ? 'px-1 py-0' : 'px-1.5 py-0.5'
                                    )}>
                                        {activity.kind === 'file-change' && displayFilePaths[0] ? displayFilePaths[0] : primaryValue}
                                    </span>
                                ) : null}
                                {readLineRangeLabel ? (
                                    <span className="shrink-0 text-[9px] text-sparkle-text-muted">
                                        {readLineRangeLabel}
                                    </span>
                                ) : null}
                                {activity.kind === 'file-change' ? (
                                    <AssistantFileChangeStatusPill
                                        status={primaryPathChangeStatus}
                                        className={minimal ? 'h-4 min-w-4 rounded-sm !border-transparent !bg-transparent px-0 text-[9px]' : undefined}
                                    />
                                ) : null}
                                {isCommandFollowUp ? minimal ? (
                                    <span className="shrink-0 font-sans text-[10px] font-medium text-sparkle-text-muted">
                                        · Follow-up {followUpStatusLabel.toLowerCase()}
                                    </span>
                                ) : (
                                    <>
                                        <span className="shrink-0 rounded-full border border-[var(--surface-divider)] bg-[var(--surface-hover)] px-1.5 py-0.5 font-sans text-[8px] font-semibold uppercase tracking-[0.12em] text-sparkle-text-muted">
                                            Follow-up
                                        </span>
                                        <span className={cn(
                                            'shrink-0 rounded-full border px-1.5 py-0.5 font-sans text-[8px] font-semibold uppercase tracking-[0.12em]',
                                            status === 'running'
                                                ? 'border-[color-mix(in_srgb,var(--status-warning)_22%,transparent)] bg-[color-mix(in_srgb,var(--status-warning)_8%,transparent)] text-[color-mix(in_srgb,var(--status-warning)_62%,var(--color-text))]'
                                                : status === 'failed'
                                                    ? 'border-[color-mix(in_srgb,var(--status-danger)_22%,transparent)] bg-[color-mix(in_srgb,var(--status-danger)_8%,transparent)] text-[color-mix(in_srgb,var(--status-danger)_62%,var(--color-text))]'
                                                    : 'border-[color-mix(in_srgb,var(--status-success)_22%,transparent)] bg-[color-mix(in_srgb,var(--status-success)_8%,transparent)] text-[color-mix(in_srgb,var(--status-success)_62%,var(--color-text))]'
                                        )}>
                                            {followUpStatusLabel}
                                        </span>
                                    </>
                                ) : null}
                            </span>
                        </p>
                        {diffStats && status !== 'failed' ? <InlineDiffStats additions={diffStats.additions} deletions={diffStats.deletions} className="shrink-0 gap-1.5" /> : null}
                        {completedWithoutOutput ? (
                            <span className={cn(
                                'shrink-0 text-[9px] font-medium text-sparkle-text-muted',
                                minimal ? 'hidden sm:inline' : 'hidden rounded-full bg-[var(--surface-hover)] px-1.5 py-0.5 uppercase tracking-[0.12em] sm:inline'
                            )}>
                                no output
                            </span>
                        ) : null}
                        {isRead ? (
                            <span className={cn(
                                'hidden shrink-0 text-[9px] font-medium uppercase tracking-[0.14em]',
                                !minimal && 'sm:inline',
                                status === 'running'
                                    ? 'text-[color-mix(in_srgb,var(--status-warning)_60%,var(--color-text-secondary))]'
                                    : status === 'failed'
                                        ? 'text-[color-mix(in_srgb,var(--status-danger)_60%,var(--color-text-secondary))]'
                                        : 'text-sparkle-text-muted'
                            )}>
                                {status === 'running' ? 'Reading' : status === 'failed' ? 'Read failed' : 'Read'}
                            </span>
                        ) : isTerminalLikeTool ? (
                            <span className={cn(
                                'shrink-0 text-right font-mono text-[9px] tabular-nums transition-colors',
                                status === 'running'
                                    ? 'text-[color-mix(in_srgb,var(--status-warning)_48%,var(--color-text-muted))]'
                                    : 'text-sparkle-text-muted group-hover:text-sparkle-text-secondary'
                            )}>
                                {formatAssistantActionTime(activityStartedAt)}{elapsed ? ` · ${elapsed}` : ''}
                            </span>
                        ) : activity.kind === 'file-change' ? (
                            <span className="shrink-0 font-mono text-[9px] tabular-nums text-sparkle-text-muted transition-colors group-hover:text-sparkle-text-secondary">
                                {elapsed || ''}
                            </span>
                        ) : (
                            <span className={cn('hidden shrink-0 text-[9px] font-medium uppercase tracking-[0.14em] text-sparkle-text-muted', !minimal && 'sm:inline')}>
                                {title}{elapsed ? <span className="ml-1.5 normal-case tracking-normal text-sparkle-text-muted"> - {elapsed}</span> : null}
                            </span>
                        )}
                    </div>
                </div>
                <span className="inline-flex w-4 shrink-0 items-center justify-center" aria-hidden="true">
                    {opensRelatedCommand ? (
                        <ChevronRight size={11} className="relative text-sparkle-text-muted transition-transform group-hover:translate-x-0.5" />
                    ) : canExpandBody ? (
                        <ChevronDown size={11} className={cn('relative text-sparkle-text-muted transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform', expanded && 'rotate-180')} />
                    ) : null}
                </span>
            </button>
            <AnimatedHeight
                isOpen={expanded && canExpandBody && (!isTerminalLikeTool || hasTerminalOutput || canonicalImagePaths.length > 0 || historyBodyLoading || Boolean(historyBodyError))}
                duration={activity.kind === 'file-change' ? 220 : 240}
                crispContent={activity.kind === 'file-change'}
            >
                <div className={cn(
                    activity.kind === 'file-change'
                        ? 'relative mt-1 h-60 min-h-0 overflow-hidden'
                        : 'mt-2 rounded-lg border border-[var(--surface-divider)]',
                    isTerminalLikeTool
                        ? 'bg-[color-mix(in_srgb,var(--color-bg)_88%,var(--color-card))] p-0'
                        : activity.kind !== 'file-change' && 'bg-[color-mix(in_srgb,var(--color-bg)_72%,var(--color-card))] p-2.5'
                )}>
                    {historyBodyLoading ? (
                        <div className="px-3 py-2.5 font-mono text-[10px] text-sparkle-text-muted">Loading historical output…</div>
                    ) : historyBodyError ? (
                        <div className="px-3 py-2.5 text-[10px] text-[color-mix(in_srgb,var(--status-danger)_64%,var(--color-text))]">{historyBodyError}</div>
                    ) : null}
                    {isTerminalLikeTool && terminalOutputText ? (
                        <div className="relative">
                            {copyValue ? <div className="absolute right-2 top-1.5 z-10"><TimelineCopyButton value={copyValue} compact /></div> : null}
                            <div
                                ref={commandOutputViewportRef}
                                className={cn(
                                    'custom-scrollbar overflow-y-auto overscroll-x-contain px-2.5 py-1.5 font-mono text-[11px] leading-5 text-[color-mix(in_srgb,var(--color-text)_88%,var(--color-bg))] [tab-size:4] subpixel-antialiased',
                                    status === 'running' ? 'overflow-x-hidden' : 'overflow-x-auto',
                                    terminalOutputHeightClass,
                                    !terminalHasRealOutput && status === 'running' && 'text-[color-mix(in_srgb,var(--status-warning)_58%,var(--color-text-secondary))]'
                                )}
                            >
                                <pre className="flex min-h-full min-w-full w-max flex-col justify-end whitespace-pre">
                                    <span
                                        key={status === 'running' ? `${rawOutput.length}-${rawToolBodyText.length}` : 'complete'}
                                    >
                                        {terminalOutputText}
                                        {status === 'running' ? (
                                            <span className="ml-1 inline-block h-3 w-1 rounded-sm bg-[color-mix(in_srgb,var(--status-warning)_72%,var(--color-text))] align-[-2px] animate-terminal-caret" />
                                        ) : null}
                                    </span>
                                </pre>
                            </div>
                            {status === 'running' && terminalHasRealOutput && runningCommandCount <= 1 ? (
                                <span
                                    key={`pulse-${rawOutput.length}-${rawToolBodyText.length}`}
                                    className="pointer-events-none absolute inset-x-2 bottom-1 h-7 rounded-b-md bg-gradient-to-t from-[color-mix(in_srgb,var(--status-success)_13%,transparent)] to-transparent animate-terminal-output-pulse"
                                    aria-hidden="true"
                                />
                            ) : null}
                        </div>
                    ) : isResolvedUserInput && resolvedUserInputEntries.length > 0 ? (
                        <div className="mt-1.5 space-y-1">
                            {resolvedUserInputEntries.map((entry, index) => (
                                <div key={`${activity.id}-${entry.id}`} className="rounded-md border border-[var(--surface-divider)] bg-[var(--surface-hover)] px-2 py-1.5">
                                    <div className="flex items-start gap-2">
                                        <span className="inline-flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full bg-[var(--surface-active)] px-1 text-[9px] font-semibold tabular-nums text-sparkle-text-secondary">
                                            {index + 1}
                                        </span>
                                        <div className="min-w-0 flex-1">
                                            <p className="line-clamp-2 text-[11px] leading-4 text-sparkle-text">
                                                {entry.question}
                                            </p>
                                            <div className="mt-1 flex items-start gap-2">
                                                <span className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--status-info)_11%,transparent)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-[color-mix(in_srgb,var(--status-info)_66%,var(--color-text))]">
                                                    {entry.header}
                                                </span>
                                                <p className="min-w-0 flex-1 text-[11px] leading-4 text-sparkle-text-secondary">
                                                    {entry.answer}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : activity.kind === 'file-change' && status === 'failed' ? (
                        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-[color-mix(in_srgb,var(--status-danger)_25%,transparent)] bg-[color-mix(in_srgb,var(--status-danger)_5%,var(--color-card))]">
                            <div className="shrink-0 border-b border-[color-mix(in_srgb,var(--status-danger)_18%,transparent)] px-3 py-2">
                                <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[color-mix(in_srgb,var(--status-danger)_72%,var(--color-text))]">Write failed</div>
                                <p className="custom-scrollbar mt-1 max-h-20 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-4 text-[color-mix(in_srgb,var(--status-danger)_46%,var(--color-text))]">{failedFileChangeOutput}</p>
                            </div>
                            {inlinePreviewPatch && inlineDiffTarget ? (
                                <div className="min-h-0 flex-1 border-t border-[var(--surface-divider)]">
                                    <AssistantInlineDiffPreview
                                        patch={inlinePreviewPatch}
                                        displayPath={inlineDiffTarget.displayPath}
                                        additions={inlineDiffTarget.additions ?? diffStats?.additions ?? 0}
                                        deletions={inlineDiffTarget.deletions ?? diffStats?.deletions ?? 0}
                                        hideHeader
                                    />
                                </div>
                            ) : null}
                        </div>
                    ) : activity.kind === 'file-change' && inlinePreviewPatch && inlineDiffTarget ? (
                        <AssistantInlineDiffPreview
                            patch={inlinePreviewPatch}
                            displayPath={inlineDiffTarget.displayPath}
                            additions={inlineDiffTarget.additions ?? diffStats?.additions ?? 0}
                            deletions={inlineDiffTarget.deletions ?? diffStats?.deletions ?? 0}
                            hideHeader
                            onOpenFullDiff={canViewDiff ? handleOpenInlineDiff : undefined}
                        />
                    ) : isRead && readPreview ? (
                        <div className="mt-2 overflow-hidden rounded-md border border-[var(--surface-divider)] bg-[color-mix(in_srgb,var(--color-bg)_80%,var(--color-card))]">
                            <div className="custom-scrollbar max-h-[32rem] overflow-auto px-3 py-2.5">
                                <pre className="min-w-full w-max whitespace-pre font-mono text-[11px] leading-5 text-[color-mix(in_srgb,var(--color-text)_78%,var(--color-bg))]">
                                    {readPreview.text || (status === 'running' ? 'Waiting for file contents…' : 'This read returned no text content.')}
                                </pre>
                            </div>
                            {readPreview.presentationTruncated || (readMetadata && !readMetadata.readComplete) ? (
                                <div className="border-t border-[var(--surface-divider)] px-3 py-1.5 font-mono text-[9px] text-sparkle-text-muted">
                                    {readPreview.presentationTruncated
                                        ? `Showing first ${readPreview.displayedLines} of ${readPreview.totalReadLines} lines returned by Read.`
                                        : readMetadata?.readEndLine !== undefined && readMetadata.readTotalLines !== undefined
                                            ? `Read lines ${readMetadata.readStartLine}-${readMetadata.readEndLine} of ${readMetadata.readTotalLines}.`
                                            : readPreview.continuationNotice?.replace(/^\[|\]$/g, '') || 'This Read covered part of the file.'}
                                </div>
                            ) : null}
                        </div>
                    ) : (
                        <p className="mt-1.5 whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-sparkle-text-muted">{primaryLabel}</p>
                    )}
                    {!isTerminalLikeTool && activity.kind !== 'file-change' ? secondaryPathEntries.map(({ fullPath, displayPath, isNew }) => (
                        <TimelineFilePathRow
                            key={`${activity.id}-${fullPath}`}
                            displayPath={displayPath}
                            fullPath={fullPath}
                            isNew={isNew}
                            onOpen={onOpenFilePath}
                            onViewDiff={canViewDiff ? () => viewDiffForPath(fullPath, displayPath, undefined, isNew) : undefined}
                        />
                    )) : null}
                    {canonicalImagePaths.length > 0 ? (
                        <div className="mt-2 flex max-w-full gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                            {canonicalImagePaths.map((imagePath, index) => (
                                <AssistantAttachmentImageCard
                                    key={`${activity.id}-image-${index}`}
                                    name={`Image ${index + 1}`}
                                    src={getFileUrl(imagePath)}
                                    widthClassName="w-[180px]"
                                    heightClassName="h-[132px]"
                                    onClick={onOpenFilePath ? () => { void onOpenFilePath(imagePath) } : undefined}
                                />
                            ))}
                        </div>
                    ) : null}
                    {!isRead && !isTerminalLikeTool && activity.kind !== 'file-change' && visibleResultOutput ? (
                        <div className="mt-2 rounded-md border border-[var(--surface-divider)] bg-[color-mix(in_srgb,var(--color-bg)_72%,var(--color-card))] p-2">
                            <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-sparkle-text-muted">Result</p>
                            <TimelinePathAwareTextBlock
                                text={visibleResultOutput}
                                projectRootPath={projectRootPath}
                                onOpenFilePath={onOpenFilePath}
                                hiddenPaths={displayedComparablePathSet}
                            />
                        </div>
                    ) : null}
                    {!isRead && !isTerminalLikeTool && activity.kind !== 'file-change' ? visibleDetailLines.map((line, index) => (
                        isAbsoluteFilesystemPathLine(line.trim()) && onOpenFilePath ? (
                            <TimelineFilePathRow
                                key={`${activity.id}-path-${index}`}
                                displayPath={getAssistantRelativeFilePath(line.trim(), projectRootPath) || line.trim()}
                                fullPath={line.trim()}
                                onOpen={onOpenFilePath}
                            />
                        ) : (
                            <p key={`${activity.id}-${index}`} className="mt-1.5 whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-sparkle-text-muted">{line}</p>
                        )
                    )) : null}
                </div>
            </AnimatedHeight>
        </div>
    )
}, (prev, next) => {
    return prev.projectRootPath === next.projectRootPath
        && prev.displayMode === next.displayMode
        && prev.runningCommandCount === next.runningCommandCount
        && prev.toolOutputDefaultMode === next.toolOutputDefaultMode
        && prev.actionTitle === next.actionTitle
        && prev.onOpenFilePath === next.onOpenFilePath
        && prev.onOpenUrl === next.onOpenUrl
        && prev.onViewDiff === next.onViewDiff
        && prev.onRevealActivity === next.onRevealActivity
        && areActivitiesEquivalent(prev.activity, next.activity)
})
