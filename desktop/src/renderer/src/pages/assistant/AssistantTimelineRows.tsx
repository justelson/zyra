import { memo, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Copy, Gauge, Loader2, RotateCcw, Trash2 } from 'lucide-react'
import type { AssistantActivity, AssistantMessage, AssistantProposedPlan, AssistantSessionTurnUsageEntry } from '@shared/assistant/contracts'
import type { ComposerContextFile } from './assistant-composer-types'
import type { PreviewOpenOptions } from '@/components/ui/file-preview/types'
import type { AssistantChatDisplayMode, AssistantTextStreamingMode } from '@/lib/settings'
import MarkdownRenderer from '@/components/ui/MarkdownRenderer'
import { AnimatedHeight } from '@/components/ui/AnimatedHeight'
import { getFileUrl } from '@/components/ui/file-preview/utils'
import { ZyraLogoASCII } from '@/components/ui/ZyraLogo'
import { cn } from '@/lib/utils'
import { formatAssistantDateTime } from '@/lib/assistant/selectors'
import AssistantAttachmentPreviewModal from './AssistantAttachmentPreviewModal'
import { AssistantFileAttachmentCard, AssistantPastedTextCard } from './AssistantAttachmentCards'
import { AssistantAttachmentImageCard } from './AssistantAttachmentImageCard'
import {
    CollapsibleUserMessageBody,
    CompletedAssistantMarkdown,
    StreamingAssistantMarkdown,
    StreamingAssistantText
} from './AssistantTimelineText'
import { getContentTypeTag, getContextFileMeta, toKbLabel } from './assistant-composer-utils'
import {
    areMessagesEqual,
    canRenderAttachmentImage,
    copyTextToClipboard,
    formatWorkingTimer,
    getActivityOutput,
    getActivityStatus,
    getCommandCheckpointAction,
    getContextCompactionStatus,
    isClipboardAttachmentReference,
    isCommandCheckpointActivity,
    isInternalAssistantActivity,
    parseUserMessageAttachments
} from './assistant-timeline-helpers'
import { stripProposedPlanBlocks } from './assistant-proposed-plan'
import { useAssistantVisibleText } from './useAssistantVisibleText'
import { TimelineProposedPlan } from './AssistantTimelineProposedPlan'
import { TimelineToolCallList } from './AssistantTimelineToolCalls'

export { TimelineToolCallList }
export { TimelineIssueList } from './AssistantTimelineIssueList'
export { TimelineProposedPlan } from './AssistantTimelineProposedPlan'

const ASSISTANT_MARKDOWN_CLASS_NAME = 'text-[13px] leading-6 text-sparkle-text [&_h1]:mb-2.5 [&_h1]:mt-5 [&_h1]:border-0 [&_h1]:pb-0 [&_h1]:text-[15px] [&_h1]:font-semibold [&_h2]:mb-2.5 [&_h2]:mt-5 [&_h2]:border-0 [&_h2]:pb-0 [&_h2]:text-[14px] [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-[13px] [&_h3]:font-semibold [&_h4]:mb-2 [&_h4]:mt-4 [&_h4]:text-[13px] [&_h4]:font-semibold [&_h5]:mb-2 [&_h5]:mt-4 [&_h5]:text-[13px] [&_h6]:mb-2 [&_h6]:mt-4 [&_h6]:text-[12px] [&_p]:mb-3 [&_p]:leading-6 [&_li]:leading-6 [&_ul]:text-[13px] [&_ol]:text-[13px] [&_table]:text-[13px] [&_pre]:text-[12px] [&_code]:text-[12px]'

export function sanitizeThoughtContent(content: string): string {
    return String(content || '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .trim()
}

function getThoughtLabel(content: string): string {
    const firstLine = content.split(/\r?\n/).find((line) => line.trim())?.trim() || ''
    return firstLine
        .replace(/^#{1,6}\s+/, '')
        .replace(/^\*{1,2}(.+?)\*{1,2}$/, '$1')
        .replace(/^_{1,2}(.+?)_{1,2}$/, '$1')
        .trim()
        .slice(0, 88)
}

function getThoughtBody(content: string): string {
    const lines = content.split(/\r?\n/)
    const firstContentIndex = lines.findIndex((line) => line.trim())
    if (firstContentIndex < 0) return ''
    const remainder = lines.slice(firstContentIndex + 1)
    while (remainder.length > 0 && !remainder[0]?.trim()) remainder.shift()
    return remainder.some((line) => line.trim()) ? remainder.join('\n').trim() : ''
}

function getThoughtDisplay(activity: AssistantActivity) {
    const content = sanitizeThoughtContent(getActivityOutput(activity) || activity.detail || '')
    return {
        activity,
        content,
        label: getThoughtLabel(content) || 'Thought',
        body: getThoughtBody(content)
    }
}

export const TimelineThought = memo(({ activity }: { activity: AssistantActivity }) => {
    const [expanded, setExpanded] = useState(false)
    const panelId = useId()
    const authoritativeContent = sanitizeThoughtContent(getActivityOutput(activity) || activity.detail || '')
    const status = getActivityStatus(activity)
    const thoughtPresentation = useAssistantVisibleText({
        streamId: activity.id,
        channel: 'activity',
        text: authoritativeContent,
        streaming: status === 'running',
        mode: 'chunks'
    })
    const content = sanitizeThoughtContent(thoughtPresentation.text)
    const label = getThoughtLabel(content) || 'Thought'
    const body = getThoughtBody(content)
    const presentationActive = status === 'running' || thoughtPresentation.presenting

    if (!content) return null
    if (!body) {
        return (
            <div className="flex min-h-7 items-center gap-2 py-0.5" role="note" aria-label={label}>
                <span className="min-w-0 max-w-[28rem] truncate text-[10px] font-medium text-white/30">{label}</span>
                <span className="h-px min-w-5 flex-1 bg-white/[0.07]" aria-hidden="true" />
            </div>
        )
    }

    return (
        <div className="py-0.5">
            <button
                type="button"
                onClick={() => setExpanded((current) => !current)}
                aria-expanded={expanded}
                aria-controls={panelId}
                className="group/thought flex min-h-7 w-full items-center gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/35"
            >
                <span className="min-w-0 max-w-[28rem] truncate text-[10px] font-medium text-white/30 transition-colors group-hover/thought:text-white/48">
                    {label}
                </span>
                <span className="h-px min-w-5 flex-1 bg-white/[0.07]" aria-hidden="true" />
                <span className="flex shrink-0 items-center gap-1 text-white/16 transition-colors group-hover/thought:text-white/30">
                    <span className="text-[10px] font-medium tracking-[0.01em]">Thoughts</span>
                    <ChevronDown
                        size={11}
                        aria-hidden="true"
                        className={cn('transition-transform duration-200', expanded && 'rotate-180')}
                    />
                </span>
            </button>
            <AnimatedHeight isOpen={expanded} unmountOnExit>
                    <div id={panelId} className="mt-1.5 w-full text-white/35">
                        {presentationActive ? (
                            <StreamingAssistantText
                                content={body}
                                className="whitespace-pre-wrap break-words text-[11px] leading-[1.72] text-white/35 [overflow-wrap:anywhere]"
                            />
                        ) : (
                            <MarkdownRenderer
                                content={body}
                                className="text-[11px] leading-[1.72] text-white/35 [&_h1]:border-0 [&_h1]:pb-0 [&_h1]:text-[11px] [&_h2]:border-0 [&_h2]:pb-0 [&_h2]:text-[11px] [&_h3]:text-[11px] [&_h4]:text-[11px] [&_h5]:text-[11px] [&_h6]:text-[11px] [&_p]:mb-2.5 [&_p]:leading-[1.72] [&_p]:text-white/35 [&_li]:leading-[1.72] [&_li]:text-white/35 [&_strong]:text-white/45 [&_pre]:text-[10px] [&_code]:text-[10px]"
                            />
                        )}
                    </div>
            </AnimatedHeight>
        </div>
    )
})

export const TimelineThoughtGroup = memo(({ activities }: { activities: AssistantActivity[] }) => {
    const [expanded, setExpanded] = useState(false)
    const panelId = useId()
    const thoughts = useMemo(
        () => activities.map(getThoughtDisplay).filter((thought) => thought.content),
        [activities]
    )

    if (thoughts.length === 0) return null
    if (thoughts.length === 1) return <TimelineThought activity={thoughts[0].activity} />

    const label = thoughts[0].label
    return (
        <div className="py-0.5" role="group" aria-label={`${thoughts.length} thoughts`}>
            <button
                type="button"
                onClick={() => setExpanded((current) => !current)}
                aria-expanded={expanded}
                aria-controls={panelId}
                className="group/thought flex min-h-7 w-full items-center gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/35"
            >
                <span className="min-w-0 max-w-[28rem] truncate text-[10px] font-medium text-white/30 transition-colors group-hover/thought:text-white/48">
                    {label}
                </span>
                <span className="h-px min-w-5 flex-1 bg-white/[0.07]" aria-hidden="true" />
                <span className="flex shrink-0 items-center gap-1 text-white/16 transition-colors group-hover/thought:text-white/30">
                    <span className="text-[10px] font-medium tracking-[0.01em]">Thoughts ({thoughts.length})</span>
                    <ChevronDown
                        size={11}
                        aria-hidden="true"
                        className={cn('transition-transform duration-200', expanded && 'rotate-180')}
                    />
                </span>
            </button>
            <AnimatedHeight isOpen={expanded} unmountOnExit>
                <div id={panelId} className="space-y-3 pt-1.5">
                    {thoughts.map((thought, index) => (
                        <div key={thought.activity.id} className={cn(index > 0 && 'border-t border-white/[0.05] pt-3')}>
                            <div className="text-[10px] font-medium text-white/28">{thought.label}</div>
                            {thought.body ? (
                                <MarkdownRenderer
                                    content={thought.body}
                                    className="mt-1.5 text-[11px] leading-[1.72] text-white/35 [&_h1]:border-0 [&_h1]:pb-0 [&_h1]:text-[11px] [&_h2]:border-0 [&_h2]:pb-0 [&_h2]:text-[11px] [&_h3]:text-[11px] [&_h4]:text-[11px] [&_h5]:text-[11px] [&_h6]:text-[11px] [&_p]:mb-2.5 [&_p]:leading-[1.72] [&_p]:text-white/35 [&_li]:leading-[1.72] [&_li]:text-white/35 [&_strong]:text-white/45 [&_pre]:text-[10px] [&_code]:text-[10px]"
                                />
                            ) : null}
                        </div>
                    ))}
                </div>
            </AnimatedHeight>
        </div>
    )
})

export const TimelineCommandCheckpoint = memo(({
    activity,
    targetActivityId,
    onRevealCommand
}: {
    activity: AssistantActivity
    targetActivityId: string | null
    onRevealCommand?: () => void
}) => {
    const action = getCommandCheckpointAction(activity) || 'status'
    const running = getActivityStatus(activity) === 'running'
    const label = action === 'stop'
        ? (running ? 'Stopping' : 'Stopped')
        : (running ? 'Checking on' : 'Checked on')
    const isStop = action === 'stop'

    return (
        <div className="flex items-center gap-2.5 py-0.5" role="note" aria-label={`${label} command`}>
            <span className={cn(
                'inline-flex shrink-0 items-center gap-1 text-[10px] font-medium tracking-[0.01em]',
                isStop ? 'text-red-300/[0.46]' : 'text-amber-300/[0.40]'
            )}>
                {label}
                {targetActivityId ? (
                    <button
                        type="button"
                        onClick={onRevealCommand}
                        className={cn(
                            'rounded-sm border-b transition-colors focus-visible:outline-none focus-visible:ring-2',
                            isStop
                                ? 'border-red-300/18 text-red-200/[0.56] hover:border-red-300/45 hover:text-red-200/80 focus-visible:ring-red-300/20'
                                : 'border-amber-200/18 text-amber-100/[0.52] hover:border-amber-200/45 hover:text-amber-100/80 focus-visible:ring-amber-200/20'
                        )}
                    >
                        command
                    </button>
                ) : (
                    <span>command</span>
                )}
            </span>
            <span className={cn('h-px min-w-5 flex-1', isStop ? 'bg-red-300/[0.08]' : 'bg-amber-300/[0.07]')} aria-hidden="true" />
        </div>
    )
})

export const TimelineCommandCheckpointGroup = memo(({
    activities,
    targetActivityIdByCheckpointId,
    onRevealCommand
}: {
    activities: AssistantActivity[]
    targetActivityIdByCheckpointId: ReadonlyMap<string, string | null>
    onRevealCommand: (activityId: string) => void
}) => {
    const [expanded, setExpanded] = useState(false)
    const action = getCommandCheckpointAction(activities[0]) || 'status'
    const isStop = action === 'stop'
    const runningCount = activities.filter((activity) => getActivityStatus(activity) === 'running').length
    const completedCount = activities.length - runningCount
    const completedLabel = completedCount > 0
        ? `${isStop ? 'Stopped' : 'Checked'} ${completedCount} ${completedCount === 1 ? 'command' : 'commands'}`
        : ''
    const runningLabel = runningCount > 0
        ? `${isStop ? 'Stopping' : 'Checking on'} ${runningCount}${completedCount > 0 ? ' more' : ` ${runningCount === 1 ? 'command' : 'commands'}`}`
        : ''
    const label = [completedLabel, runningLabel].filter(Boolean).join(' · ')

    return (
        <div className="py-0.5" role="group" aria-label={label}>
            <button
                type="button"
                onClick={() => setExpanded((current) => !current)}
                aria-expanded={expanded}
                className="group/checkpoints flex min-h-7 w-full items-center gap-2.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/25"
            >
                <span className={cn(
                    'shrink-0 text-[10px] font-medium tracking-[0.01em] transition-colors',
                    isStop
                        ? 'text-red-300/[0.48] group-hover/checkpoints:text-red-200/70'
                        : 'text-amber-300/[0.42] group-hover/checkpoints:text-amber-200/65'
                )}>
                    {label}
                </span>
                <span className={cn('h-px min-w-5 flex-1', isStop ? 'bg-red-300/[0.08]' : 'bg-amber-300/[0.07]')} aria-hidden="true" />
                <ChevronDown
                    size={11}
                    aria-hidden="true"
                    className={cn(
                        'shrink-0 transition-transform duration-200',
                        isStop ? 'text-red-200/25' : 'text-amber-100/22',
                        expanded && 'rotate-180'
                    )}
                />
            </button>
            <AnimatedHeight isOpen={expanded} unmountOnExit>
                <div className="ml-3 border-l border-white/[0.05] pl-3 pt-1">
                    {activities.map((activity) => {
                        const targetActivityId = targetActivityIdByCheckpointId.get(activity.id) || null
                        return (
                            <TimelineCommandCheckpoint
                                key={activity.id}
                                activity={activity}
                                targetActivityId={targetActivityId}
                                onRevealCommand={targetActivityId ? () => onRevealCommand(targetActivityId) : undefined}
                            />
                        )
                    })}
                </div>
            </AnimatedHeight>
        </div>
    )
})

export const TimelineWorkTraceGroup = memo(({
    activities,
    targetActivityIdByCheckpointId,
    onRevealCommand
}: {
    activities: AssistantActivity[]
    targetActivityIdByCheckpointId: ReadonlyMap<string, string | null>
    onRevealCommand: (activityId: string) => void
}) => {
    const [expanded, setExpanded] = useState(false)
    const panelId = useId()
    const thoughts = useMemo(
        () => activities.filter(isInternalAssistantActivity).map(getThoughtDisplay).filter((thought) => thought.content),
        [activities]
    )
    const checkpoints = useMemo(
        () => activities.filter(isCommandCheckpointActivity),
        [activities]
    )

    if (thoughts.length === 0) {
        if (checkpoints.length === 1) {
            const checkpoint = checkpoints[0]
            const targetActivityId = targetActivityIdByCheckpointId.get(checkpoint.id) || null
            return (
                <TimelineCommandCheckpoint
                    activity={checkpoint}
                    targetActivityId={targetActivityId}
                    onRevealCommand={targetActivityId ? () => onRevealCommand(targetActivityId) : undefined}
                />
            )
        }
        return (
            <TimelineCommandCheckpointGroup
                activities={checkpoints}
                targetActivityIdByCheckpointId={targetActivityIdByCheckpointId}
                onRevealCommand={onRevealCommand}
            />
        )
    }
    if (checkpoints.length === 0) return <TimelineThoughtGroup activities={activities} />

    const thoughtLabel = `${thoughts.length} ${thoughts.length === 1 ? 'thought' : 'thoughts'}`
    const checkpointLabel = `${checkpoints.length} ${checkpoints.length === 1 ? 'check' : 'checks'}`

    return (
        <div className="py-0.5" role="group" aria-label={`${thoughtLabel}, ${checkpointLabel}`}>
            <button
                type="button"
                onClick={() => setExpanded((current) => !current)}
                aria-expanded={expanded}
                aria-controls={panelId}
                className="group/trace flex min-h-7 w-full items-center gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
            >
                <span className="min-w-0 max-w-[28rem] truncate text-[10px] font-medium text-white/30 transition-colors group-hover/trace:text-white/48">
                    {thoughts[0].label}
                </span>
                <span className="h-px min-w-5 flex-1 bg-white/[0.07]" aria-hidden="true" />
                <span className="flex shrink-0 items-center gap-1 text-white/18 transition-colors group-hover/trace:text-white/32">
                    <span className="text-[10px] font-medium tracking-[0.01em]">{thoughtLabel} · {checkpointLabel}</span>
                    <ChevronDown
                        size={11}
                        aria-hidden="true"
                        className={cn('transition-transform duration-200', expanded && 'rotate-180')}
                    />
                </span>
            </button>
            <AnimatedHeight isOpen={expanded} unmountOnExit>
                <div id={panelId} className="space-y-2.5 pt-1.5">
                    {activities.map((activity, index) => {
                        if (isInternalAssistantActivity(activity)) {
                            const thought = getThoughtDisplay(activity)
                            if (!thought.content) return null
                            return (
                                <div key={activity.id} className={cn(index > 0 && 'border-t border-white/[0.05] pt-2.5')}>
                                    <div className="text-[10px] font-medium text-white/28">{thought.label}</div>
                                    {thought.body ? (
                                        <MarkdownRenderer
                                            content={thought.body}
                                            className="mt-1.5 text-[11px] leading-[1.72] text-white/35 [&_h1]:border-0 [&_h1]:pb-0 [&_h1]:text-[11px] [&_h2]:border-0 [&_h2]:pb-0 [&_h2]:text-[11px] [&_h3]:text-[11px] [&_h4]:text-[11px] [&_h5]:text-[11px] [&_h6]:text-[11px] [&_p]:mb-2.5 [&_p]:leading-[1.72] [&_p]:text-white/35 [&_li]:leading-[1.72] [&_li]:text-white/35 [&_strong]:text-white/45 [&_pre]:text-[10px] [&_code]:text-[10px]"
                                        />
                                    ) : null}
                                </div>
                            )
                        }
                        if (isCommandCheckpointActivity(activity)) {
                            const targetActivityId = targetActivityIdByCheckpointId.get(activity.id) || null
                            return (
                                <div key={activity.id} className={cn(index > 0 && 'border-t border-white/[0.05] pt-2.5')}>
                                    <TimelineCommandCheckpoint
                                        activity={activity}
                                        targetActivityId={targetActivityId}
                                        onRevealCommand={targetActivityId ? () => onRevealCommand(targetActivityId) : undefined}
                                    />
                                </div>
                            )
                        }
                        return null
                    })}
                </div>
            </AnimatedHeight>
        </div>
    )
})

export const TimelineModelNotice = memo(({ activity }: { activity: AssistantActivity }) => {
    const [detailsOpen, setDetailsOpen] = useState(false)
    const rawMessage = String(activity.payload?.rawMessage || '').trim()
    const model = String(activity.payload?.model || '').trim()
    const message = String(activity.detail || '').trim()
    const hasRawDetails = Boolean(rawMessage && rawMessage !== message)

    return (
        <div className="max-w-4xl py-1" role="status">
            <div className="border-l border-amber-300/20 bg-amber-400/[0.025] py-2 pl-3 pr-2">
                <div className="flex items-start gap-2.5">
                    <Gauge size={14} className="mt-0.5 shrink-0 text-amber-200/55" />
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <p className="text-[12px] font-medium text-sparkle-text/90">{activity.summary}</p>
                            {model ? <span className="text-[10px] text-sparkle-text-muted/45">{model}</span> : null}
                        </div>
                        {message ? <p className="mt-1 text-[11px] leading-5 text-sparkle-text-secondary/70">{message}</p> : null}
                    </div>
                    {hasRawDetails ? (
                        <button
                            type="button"
                            onClick={() => setDetailsOpen((current) => !current)}
                            aria-expanded={detailsOpen}
                            className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-sparkle-text-muted/50 transition-colors hover:bg-white/[0.035] hover:text-sparkle-text-secondary"
                        >
                            <span>Details</span>
                            <ChevronDown size={11} className={cn('transition-transform duration-200', detailsOpen && 'rotate-180')} />
                        </button>
                    ) : null}
                </div>
                <AnimatedHeight isOpen={detailsOpen && hasRawDetails}>
                    <pre className="ml-6 mt-2 overflow-x-auto whitespace-pre-wrap break-words border-t border-white/[0.05] pt-2 font-mono text-[10px] leading-5 text-white/30">{rawMessage}</pre>
                </AnimatedHeight>
            </div>
        </div>
    )
})

function getCompactionLabelStyle(isRunning: boolean): React.CSSProperties | undefined {
    if (!isRunning) return undefined

    return {
        backgroundImage: 'linear-gradient(90deg, rgba(186,230,253,0.58), rgba(125,211,252,1), rgba(186,230,253,0.58))',
        backgroundSize: '240% 100%',
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        color: 'transparent',
        animation: 'shimmer 1.45s linear infinite'
    }
}

function getAttachmentPreviewTarget(attachmentName: string, attachmentPath: string): { name: string; ext: string } {
    const sourceName = String(attachmentName || '').trim() || String(attachmentPath || '').split(/[\\/]/).pop() || 'attachment'
    const pathName = String(attachmentPath || '').split(/[\\/]/).pop() || ''
    const sourceDotIndex = sourceName.lastIndexOf('.')
    if (sourceDotIndex > 0 && sourceDotIndex < sourceName.length - 1) {
        return {
            name: sourceName,
            ext: sourceName.slice(sourceDotIndex + 1).toLowerCase()
        }
    }

    const pathDotIndex = pathName.lastIndexOf('.')
    if (pathDotIndex > 0 && pathDotIndex < pathName.length - 1) {
        return {
            name: sourceName,
            ext: pathName.slice(pathDotIndex + 1).toLowerCase()
        }
    }

    return { name: sourceName, ext: '' }
}

type CompactLiveNarrationSnapshot = {
    key: string
    text: string
}

const COMPACT_LIVE_NARRATION_MAX_CHARACTERS = 1_600

function compactLiveNarrationText(value: string): string {
    const text = value.trim()
    return text.length <= COMPACT_LIVE_NARRATION_MAX_CHARACTERS
        ? text
        : `${text.slice(0, COMPACT_LIVE_NARRATION_MAX_CHARACTERS).trimEnd()}…`
}

function getSettledLiveNarration(message: AssistantMessage): CompactLiveNarrationSnapshot | null {
    if (message.role !== 'assistant' || message.streaming) return null
    const text = compactLiveNarrationText(stripProposedPlanBlocks(message.text || ''))
    if (!text) return null
    return {
        key: `${message.id}:${message.updatedAt}:${text.length}`,
        text
    }
}

export const TimelineMessage = memo(({
    message,
    isLatestAssistant = false,
    isLastAssistantInTurn = false,
    latestTurnStartedAt = null,
    turnUsage = null,
    deleting = false,
    assistantTextStreamingMode = 'stream',
    displayMode = 'detailed',
    compactLiveNarration = false,
    onRequestDelete,
    onOpenFilePath = undefined,
    onOpenAttachmentPreview = undefined,
    filePath = null,
    onInternalLinkClick,
    onLinkNotice
}: {
    message: AssistantMessage
    isLatestAssistant?: boolean
    isLastAssistantInTurn?: boolean
    latestTurnStartedAt?: string | null
    turnUsage?: AssistantSessionTurnUsageEntry | null
    deleting?: boolean
    assistantTextStreamingMode?: AssistantTextStreamingMode
    displayMode?: AssistantChatDisplayMode
    compactLiveNarration?: boolean
    onRequestDelete?: (message: AssistantMessage) => void
    onOpenFilePath?: (filePath: string) => Promise<void> | void
    onOpenAttachmentPreview?: (
        file: { name: string; path: string },
        ext: string,
        options?: PreviewOpenOptions
    ) => Promise<void> | void
    filePath?: string | null
    onInternalLinkClick?: (href: string) => Promise<boolean | void> | boolean | void
    onLinkNotice?: (message: string, tone: 'info' | 'error') => void
}) => {
    const isAssistant = message.role === 'assistant'
    const minimal = displayMode === 'minimal'
    const copyValue = message.text || ''
    const parsedUserMessage = useMemo(
        () => message.role === 'user' ? parseUserMessageAttachments(message.text || '') : { body: message.text || '', attachments: [] },
        [message.role, message.text]
    )
    const [resolvedClipboardAttachmentPaths, setResolvedClipboardAttachmentPaths] = useState<Record<string, string>>({})
    const [clipboardAttachmentRecovery, setClipboardAttachmentRecovery] = useState<Record<string, 'loading' | 'error'>>({})
    const [copied, setCopied] = useState(false)
    const [nowIso, setNowIso] = useState(() => new Date().toISOString())
    const [previewAttachment, setPreviewAttachment] = useState<ComposerContextFile | null>(null)
    const usesProviderNativeStreaming = message.modality === 'voice'
    const assistantTextPresentation = useAssistantVisibleText({
        streamId: message.id,
        channel: 'message',
        text: usesProviderNativeStreaming ? '' : message.text || '',
        streaming: Boolean(message.streaming) && !usesProviderNativeStreaming,
        mode: assistantTextStreamingMode
    })
    const streamedMessageRef = useRef(Boolean(message.streaming))
    if (message.streaming) streamedMessageRef.current = true
    const initialCompactNarration = useMemo(() => getSettledLiveNarration(message), [])
    const [compactNarration, setCompactNarration] = useState<CompactLiveNarrationSnapshot | null>(initialCompactNarration)
    const [outgoingCompactNarration, setOutgoingCompactNarration] = useState<CompactLiveNarrationSnapshot | null>(null)
    const compactNarrationRef = useRef<CompactLiveNarrationSnapshot | null>(initialCompactNarration)

    useEffect(() => {
        const nextNarration = getSettledLiveNarration(message)
        if (!nextNarration || nextNarration.key === compactNarrationRef.current?.key) return
        const previousNarration = compactNarrationRef.current
        compactNarrationRef.current = nextNarration
        setOutgoingCompactNarration(previousNarration)
        setCompactNarration(nextNarration)
        if (!previousNarration) return
        const timeoutId = window.setTimeout(() => setOutgoingCompactNarration(null), 460)
        return () => window.clearTimeout(timeoutId)
    }, [message])

    useEffect(() => {
        if (!message.streaming) return
        const intervalId = window.setInterval(() => setNowIso(new Date().toISOString()), 1000)
        return () => window.clearInterval(intervalId)
    }, [message.streaming])

    useEffect(() => {
        let cancelled = false
        const clipboardAttachments = parsedUserMessage.attachments.filter((attachment) => isClipboardAttachmentReference(attachment.path))

        if (clipboardAttachments.length === 0) {
            setResolvedClipboardAttachmentPaths({})
            setClipboardAttachmentRecovery({})
            return () => {
                cancelled = true
            }
        }

        void (async () => {
            const resolvedEntries = await Promise.all(
                clipboardAttachments.map(async (attachment) => {
                    const result = await window.devscope.assistant.resolveClipboardAttachment({
                        reference: attachment.path || ''
                    })
                    if (!result.success || !result.path) return { id: attachment.id, path: null }
                    return { id: attachment.id, path: result.path }
                })
            )

            if (cancelled) return

            setResolvedClipboardAttachmentPaths(
                Object.fromEntries(resolvedEntries.filter((entry) => Boolean(entry.path)).map((entry) => [entry.id, entry.path as string]))
            )
            setClipboardAttachmentRecovery(
                Object.fromEntries(resolvedEntries.filter((entry) => !entry.path).map((entry) => [entry.id, 'error' as const]))
            )
        })()

        return () => {
            cancelled = true
        }
    }, [parsedUserMessage.attachments])

    const assistantElapsed = useMemo(() => {
        if (!isAssistant || !isLastAssistantInTurn) return null

        if (isLatestAssistant && latestTurnStartedAt) {
            return formatWorkingTimer(latestTurnStartedAt, message.streaming ? nowIso : message.updatedAt)
        }

        const turnStartedAt = turnUsage?.startedAt || turnUsage?.requestedAt || null
        const turnCompletedAt = turnUsage?.completedAt || message.updatedAt
        if (!turnStartedAt) return null

        return formatWorkingTimer(turnStartedAt, message.streaming ? nowIso : turnCompletedAt)
    }, [
        isAssistant,
        isLastAssistantInTurn,
        isLatestAssistant,
        latestTurnStartedAt,
        message.streaming,
        message.updatedAt,
        nowIso,
        turnUsage?.completedAt,
        turnUsage?.requestedAt,
        turnUsage?.startedAt
    ])

    if (isAssistant) {
        const presentationActive = !usesProviderNativeStreaming && (
            Boolean(message.streaming) || assistantTextPresentation.presenting
        )
        const assistantText = presentationActive ? (assistantTextPresentation.text || ' ') : (message.text || ' ')
        const renderedAssistantText = stripProposedPlanBlocks(assistantText) || (presentationActive ? ' ' : '')
        const assistantCopyValue = renderedAssistantText.trim() ? renderedAssistantText : copyValue
        if (!renderedAssistantText.trim() && !presentationActive) return null

        return (
            <div
                className={cn('group group/assistant-message max-w-4xl', compactLiveNarration ? 'py-0.5' : minimal ? 'py-0.5' : 'py-1')}
                data-assistant-message-surface={displayMode}
            >
                {compactLiveNarration ? (
                    presentationActive ? (
                        <div className="block w-full rounded-sm text-left">
                            <div className="line-clamp-3 [overflow-wrap:anywhere]">
                                <StreamingAssistantMarkdown
                                    content={compactLiveNarrationText(renderedAssistantText) || ' '}
                                    cacheKey={`${message.id}:compact-stream`}
                                    className="assistant-live-narration-muted text-[11px] leading-5 [&_p]:mb-0 [&_li]:leading-5"
                                />
                            </div>
                        </div>
                    ) : compactNarration ? (
                        <div className="block w-full rounded-sm text-left">
                            <div className="grid">
                                {outgoingCompactNarration ? (
                                    <div
                                        key={outgoingCompactNarration.key}
                                        aria-hidden="true"
                                        className="assistant-live-narration-out col-start-1 row-start-1 line-clamp-3 [overflow-wrap:anywhere]"
                                    >
                                        <StreamingAssistantMarkdown
                                            content={outgoingCompactNarration.text}
                                            cacheKey={`${outgoingCompactNarration.key}:compact-settled`}
                                            className="assistant-live-narration-muted text-[11px] leading-5 [&_p]:mb-0 [&_li]:leading-5"
                                        />
                                    </div>
                                ) : null}
                                <div
                                    key={compactNarration.key}
                                    className="assistant-live-narration-in col-start-1 row-start-1 line-clamp-3 [overflow-wrap:anywhere]"
                                >
                                    <StreamingAssistantMarkdown
                                        content={compactNarration.text}
                                        cacheKey={`${compactNarration.key}:compact-settled`}
                                        className="assistant-live-narration-muted text-[11px] leading-5 [&_p]:mb-0 [&_li]:leading-5"
                                    />
                                </div>
                            </div>
                        </div>
                    ) : null
                ) : presentationActive ? (
                    <StreamingAssistantMarkdown
                        content={renderedAssistantText || ' '}
                        cacheKey={`${message.id}:stream`}
                        filePath={filePath || undefined}
                        onInternalLinkClick={onInternalLinkClick}
                        onLinkNotice={onLinkNotice}
                        className={ASSISTANT_MARKDOWN_CLASS_NAME}
                    />
                ) : (
                    <CompletedAssistantMarkdown
                        content={renderedAssistantText}
                        cacheKey={`${message.id}:${message.updatedAt}:${renderedAssistantText.length}`}
                        filePath={filePath || undefined}
                        deferInitialRender={streamedMessageRef.current}
                        onInternalLinkClick={onInternalLinkClick}
                        onLinkNotice={onLinkNotice}
                        className={ASSISTANT_MARKDOWN_CLASS_NAME}
                    />
                )}
                {!compactLiveNarration ? <div className={cn(
                    'mt-2 flex flex-wrap items-center gap-2 text-[11px] text-sparkle-text-muted transition-opacity',
                    minimal && 'opacity-0 focus-within:opacity-100 group-hover/assistant-message:opacity-100'
                )}>
                    <span>{formatAssistantDateTime(message.updatedAt)}</span>
                    {assistantElapsed ? <span className="text-sparkle-text">| {assistantElapsed}</span> : null}
                    {isLastAssistantInTurn && assistantCopyValue.trim() ? (
                        <button
                            type="button"
                            onClick={async () => {
                                try {
                                    await copyTextToClipboard(assistantCopyValue)
                                    setCopied(true)
                                    window.setTimeout(() => setCopied(false), 1600)
                                } catch {}
                            }}
                            className={cn(
                                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 opacity-0 transition-all duration-150 group-hover:opacity-100',
                                copied
                                    ? 'border-emerald-400/20 bg-emerald-500/[0.08] text-emerald-200'
                                    : 'border-transparent bg-white/[0.03] text-sparkle-text-secondary hover:bg-white/[0.05] hover:text-sparkle-text'
                            )}
                            title={copied ? 'Copied' : 'Copy message'}
                        >
                            {copied ? <Check size={11} /> : <Copy size={11} />}
                            <span>{copied ? 'Copied' : 'Copy'}</span>
                        </button>
                    ) : null}
                </div> : null}
            </div>
        )
    }

    return (
        <div className={cn('group/user-message ml-auto flex flex-col items-end', minimal ? 'max-w-[80%] py-0.5' : 'py-1')} data-assistant-message-surface={displayMode}>
            <div className={cn('group relative', minimal ? 'max-w-full' : 'max-w-[36rem]')}>
                <div className={cn(
                    minimal
                        ? 'rounded-2xl bg-[var(--surface-hover)] px-3.5 py-2.5'
                        : 'rounded-[1.15rem] border border-white/10 bg-white/[0.03] px-4 py-2.5'
                )}>
                    {parsedUserMessage.attachments.length > 0 ? (
                        <div
                            className={cn(
                                'mb-1.5 max-w-full overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
                                parsedUserMessage.attachments.length > 3 ? 'w-full max-w-[372px]' : 'max-w-[372px]'
                            )}
                        >
                            <div className="flex w-max min-w-full gap-2">
                            {parsedUserMessage.attachments.map((attachment) => {
                                const isImage = attachment.type === 'IMAGE'
                                const resolvedAttachmentPath = attachment.path && isClipboardAttachmentReference(attachment.path)
                                    ? (resolvedClipboardAttachmentPaths[attachment.id] || null)
                                    : attachment.path
                                const renderImage = isImage && canRenderAttachmentImage(resolvedAttachmentPath)
                                const unresolvedClipboardImage = isImage
                                    && isClipboardAttachmentReference(attachment.path)
                                    && !resolvedAttachmentPath
                                const attachmentRecoveryState = clipboardAttachmentRecovery[attachment.id]
                                const previewTarget = resolvedAttachmentPath ? getAttachmentPreviewTarget(attachment.name, resolvedAttachmentPath) : null
                                const canPreviewInlineText = Boolean(
                                    attachment.content
                                    && attachment.type !== 'IMAGE'
                                )
                                const previewAttachmentFile: ComposerContextFile | null = canPreviewInlineText
                                    ? {
                                        id: attachment.id,
                                        path: attachment.path || attachment.displayName,
                                        name: attachment.displayName,
                                        mimeType: attachment.mime || 'text/plain',
                                        kind: attachment.type === 'CODE' ? 'code' : 'doc',
                                        content: attachment.content || '',
                                        previewText: attachment.preview || undefined,
                                        sizeBytes: attachment.size ? Number.parseInt(attachment.size, 10) : undefined,
                                        source: 'paste' as const
                                    }
                                    : null
                                return (
                                    renderImage ? (
                                        <AssistantAttachmentImageCard
                                            key={attachment.id}
                                            name={attachment.displayName}
                                            src={getFileUrl(String(resolvedAttachmentPath))}
                                            widthClassName="w-[116px]"
                                            heightClassName="h-[84px]"
                                            onClick={(onOpenAttachmentPreview || onOpenFilePath) && resolvedAttachmentPath ? () => {
                                                if (onOpenAttachmentPreview && previewTarget) {
                                                    void onOpenAttachmentPreview({ name: previewTarget.name, path: resolvedAttachmentPath }, previewTarget.ext)
                                                    return
                                                }
                                                void onOpenFilePath?.(resolvedAttachmentPath)
                                            } : undefined}
                                        />
                                    ) : unresolvedClipboardImage ? (
                                        <div key={attachment.id} className="flex w-[116px] flex-col gap-1.5">
                                            <AssistantFileAttachmentCard
                                                widthClassName="w-[116px]"
                                                name={attachment.displayName}
                                                contentType={attachment.type}
                                                category="image"
                                                pathLabel="Cached image unavailable"
                                            />
                                            <button
                                                type="button"
                                                disabled={attachmentRecoveryState === 'loading'}
                                                onClick={async () => {
                                                    setClipboardAttachmentRecovery((current) => ({ ...current, [attachment.id]: 'loading' }))
                                                    const result = await window.devscope.assistant.resolveClipboardAttachment({ reference: attachment.path || '' })
                                                    if (result.success && result.path) {
                                                        setResolvedClipboardAttachmentPaths((current) => ({ ...current, [attachment.id]: result.path as string }))
                                                        setClipboardAttachmentRecovery((current) => {
                                                            const next = { ...current }
                                                            delete next[attachment.id]
                                                            return next
                                                        })
                                                        return
                                                    }
                                                    setClipboardAttachmentRecovery((current) => ({ ...current, [attachment.id]: 'error' }))
                                                    onLinkNotice?.(result.success ? 'The cached attachment is still unavailable.' : result.error, 'error')
                                                }}
                                                className="inline-flex items-center justify-center gap-1 rounded-md border border-amber-400/20 bg-amber-500/[0.08] px-2 py-1 text-[10px] font-medium text-amber-100 transition-colors hover:bg-amber-500/[0.14] disabled:cursor-wait disabled:opacity-60"
                                            >
                                                {attachmentRecoveryState === 'loading' ? <Loader2 size={10} className="animate-spin" /> : <RotateCcw size={10} />}
                                                {attachmentRecoveryState === 'loading' ? 'Recovering' : 'Retry attachment'}
                                            </button>
                                        </div>
                                    ) : attachment.isClipboard && attachment.type !== 'IMAGE' ? (
                                        <AssistantPastedTextCard
                                            key={attachment.id}
                                            widthClassName="w-[108px]"
                                            onClick={previewAttachmentFile ? () => setPreviewAttachment(previewAttachmentFile) : undefined}
                                            previewText={attachment.content || attachment.preview}
                                        />
                                    ) : (
                                        <AssistantFileAttachmentCard
                                            key={attachment.id}
                                            widthClassName="w-[116px]"
                                            name={attachment.displayName}
                                            contentType={attachment.type}
                                            category={attachment.type === 'CODE' ? 'code' : 'doc'}
                                            pathLabel={attachment.isClipboard ? null : attachment.path}
                                            previewText={attachment.preview}
                                            onClick={
                                                resolvedAttachmentPath && (onOpenAttachmentPreview || onOpenFilePath)
                                                    ? () => {
                                                        if (onOpenAttachmentPreview && previewTarget) {
                                                            void onOpenAttachmentPreview({ name: previewTarget.name, path: resolvedAttachmentPath }, previewTarget.ext)
                                                            return
                                                        }
                                                        void onOpenFilePath?.(resolvedAttachmentPath)
                                                    }
                                                    : previewAttachmentFile
                                                        ? () => setPreviewAttachment(previewAttachmentFile)
                                                        : undefined
                                            }
                                        />
                                    )
                                )
                            })}
                            </div>
                        </div>
                    ) : null}
                    {parsedUserMessage.body ? (
                        <CollapsibleUserMessageBody content={parsedUserMessage.body} />
                    ) : null}
                </div>
                <div className={cn(
                    'mt-2 flex items-center justify-between gap-3 px-1 transition-opacity',
                    minimal ? 'opacity-0 focus-within:opacity-100 group-hover/user-message:opacity-100' : 'opacity-100'
                )}>
                    <p className="text-[10px] text-sparkle-text-muted">{formatAssistantDateTime(message.updatedAt)}</p>
                    <div className="flex items-center gap-1">
                        <button type="button" onClick={async () => { try { await copyTextToClipboard(copyValue); setCopied(true); window.setTimeout(() => setCopied(false), 1600) } catch {} }} className={cn('rounded-md border p-1 transition-all', copied ? 'border-emerald-400/20 bg-emerald-500/[0.08] text-emerald-300' : 'border-white/10 bg-white/[0.03] text-sparkle-text-muted hover:border-white/20 hover:text-sparkle-text')} title={copied ? 'Copied' : 'Copy message'}>{copied ? <Check size={12} /> : <Copy size={12} />}</button>
                        {onRequestDelete ? <button type="button" onClick={() => onRequestDelete(message)} disabled={deleting} className={cn('rounded-md border p-1 transition-all', deleting ? 'cursor-not-allowed border-red-400/20 bg-red-500/[0.08] text-red-200/70' : 'border-white/10 bg-white/[0.03] text-sparkle-text-muted hover:border-red-400/20 hover:bg-red-500/[0.08] hover:text-red-200')} title="Delete message from history"><Trash2 size={12} /></button> : null}
                    </div>
                </div>
            </div>
            <AssistantAttachmentPreviewModal
                file={previewAttachment}
                meta={previewAttachment ? getContextFileMeta(previewAttachment) : null}
                contentType={previewAttachment ? getContentTypeTag(previewAttachment) : ''}
                sizeLabel={previewAttachment ? toKbLabel(previewAttachment.sizeBytes) : ''}
                showFormattingWarning={false}
                readOnly
                onClose={() => setPreviewAttachment(null)}
            />
        </div>
    )
}, (prev, next) => {
    return prev.isLatestAssistant === next.isLatestAssistant
        && prev.isLastAssistantInTurn === next.isLastAssistantInTurn
        && prev.latestTurnStartedAt === next.latestTurnStartedAt
        && prev.turnUsage?.id === next.turnUsage?.id
        && prev.turnUsage?.requestedAt === next.turnUsage?.requestedAt
        && prev.turnUsage?.startedAt === next.turnUsage?.startedAt
        && prev.turnUsage?.completedAt === next.turnUsage?.completedAt
        && prev.deleting === next.deleting
        && prev.assistantTextStreamingMode === next.assistantTextStreamingMode
        && prev.displayMode === next.displayMode
        && prev.onRequestDelete === next.onRequestDelete
        && prev.onOpenFilePath === next.onOpenFilePath
        && prev.onOpenAttachmentPreview === next.onOpenAttachmentPreview
        && prev.filePath === next.filePath
        && prev.onInternalLinkClick === next.onInternalLinkClick
        && prev.onLinkNotice === next.onLinkNotice
        && areMessagesEqual(prev.message, next.message)
})

export function TimelineContextCompactionMarker({ activity }: { activity: AssistantActivity }) {
    const status = getContextCompactionStatus(activity)
    const isRunning = status === 'running'
    const label = status === 'running'
        ? 'AUTO-COMPACTING'
        : status === 'cancelled'
            ? 'AUTO-COMPACTION CANCELLED'
            : status === 'failed'
                ? 'AUTO-COMPACTION FAILED'
                : 'AUTO-COMPACTED'
    const labelStyle = getCompactionLabelStyle(isRunning)

    return (
        <div className="max-w-4xl py-2" aria-live={isRunning ? 'polite' : undefined}>
            <div className="flex items-center gap-3">
                <span className={cn(
                    'h-px flex-1 bg-gradient-to-r from-transparent via-white/8 to-white/10',
                    isRunning && 'via-sky-300/25 to-sky-300/15'
                )} />
                <span className={cn(
                    'relative isolate overflow-hidden rounded-full border border-transparent bg-white/[0.03] px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.24em] text-sparkle-text-secondary shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]',
                    isRunning && 'bg-sky-500/[0.08] text-sky-100',
                    status === 'cancelled' && 'bg-amber-500/[0.08] text-amber-200',
                    status === 'failed' && 'bg-red-500/[0.08] text-red-200'
                )}>
                    <span className="relative z-10" style={labelStyle}>{label}</span>
                </span>
                <span className={cn(
                    'h-px flex-1 bg-gradient-to-r from-white/10 via-white/8 to-transparent',
                    isRunning && 'from-sky-300/15 via-sky-300/25'
                )} />
            </div>
        </div>
    )
}

function formatWorkingIndicatorStatus(startedAt: string | null | undefined, label: string): string {
    if (label === 'Connecting...') return label
    const elapsed = startedAt ? formatWorkingTimer(startedAt, new Date().toISOString()) : null
    return elapsed ? `Working for ${elapsed}` : label
}

export function TimelineWorkingIndicator({ startedAt, label = 'Working...' }: { startedAt?: string | null; label?: string }) {
    const statusTextRef = useRef<HTMLSpanElement | null>(null)
    const statusText = formatWorkingIndicatorStatus(startedAt, label)
    useEffect(() => {
        const updateStatusText = () => {
            if (statusTextRef.current) {
                statusTextRef.current.textContent = formatWorkingIndicatorStatus(startedAt, label)
            }
        }
        updateStatusText()
        if (!startedAt || label === 'Connecting...') return
        const intervalId = window.setInterval(updateStatusText, 1000)
        return () => window.clearInterval(intervalId)
    }, [label, startedAt])
    return (
        <div className="max-w-4xl py-0.5" data-assistant-work-summary-shell="true">
            <div className="inline-flex min-h-7 items-center gap-1 text-[11px] text-white/32">
                <span data-assistant-working-dots="true" className="mr-0.5 inline-flex shrink-0 items-center gap-[3px]" aria-hidden="true">
                    <span className="h-1 w-1 rounded-full bg-white/25 motion-safe:animate-pulse" />
                    <span className="h-1 w-1 rounded-full bg-white/25 motion-safe:animate-pulse [animation-delay:200ms]" />
                    <span className="h-1 w-1 rounded-full bg-white/25 motion-safe:animate-pulse [animation-delay:400ms]" />
                </span>
                <span ref={statusTextRef} className="shrink-0 font-medium">{statusText}</span>
                <ChevronRight size={12} aria-hidden="true" className="shrink-0 text-white/20" />
            </div>
            <div className="h-px w-full bg-white/[0.07]" aria-hidden="true" />
        </div>
    )
}

export function TimelineEmptyState({
    projectLabel = null,
    projectTitle = null,
    showStatusIndicator = false,
    statusIndicatorLabel = 'Connecting...'
}: {
    projectLabel?: string | null
    projectTitle?: string | null
    sessionMode?: 'work' | 'playground'
    showStatusIndicator?: boolean
    statusIndicatorLabel?: string
}) {
    if (!projectLabel && !showStatusIndicator) {
        return <div className="min-h-[220px]" />
    }

    const statusPill = showStatusIndicator ? (
        <div className="relative inline-flex items-center overflow-hidden rounded-full border border-sky-400/20 bg-sky-500/[0.10] px-3 py-1 text-[10px] font-medium leading-none text-sky-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <span className="absolute inset-0 animate-shimmer opacity-60" aria-hidden="true" />
            <span className="relative z-10 inline-flex items-center gap-2">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-300/90" />
                <span>{statusIndicatorLabel}</span>
            </span>
        </div>
    ) : null

    const projectPill = projectLabel ? (
        <span
            className="inline-flex max-w-[220px] shrink-0 items-center overflow-hidden rounded-full border border-sparkle-border bg-sparkle-card px-2 py-0.5 text-[10px] font-medium leading-none text-sparkle-text-secondary"
            title={projectTitle || projectLabel}
        >
            <span className="truncate">{projectLabel}</span>
        </span>
    ) : null

    if (showStatusIndicator) {
        return (
            <div className="flex min-h-[220px] items-center justify-center px-6 py-10">
                <div className="flex flex-col items-center justify-center gap-3">
                    <ZyraLogoASCII shimmer size="md" tone="neutral" variant="loading" className="opacity-100" />
                    <div className="flex flex-wrap items-center justify-center gap-2">
                        {projectPill}
                        {statusPill}
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="flex min-h-[220px] items-center justify-center px-6 py-10">
            <div className="flex flex-wrap items-center justify-center gap-2">
                {projectPill}
            </div>
        </div>
    )
}

export function TimelineChatLoadingState() {
    return (
        <div className="flex h-full min-h-0 items-center justify-center px-6" aria-busy="true" role="status">
            <div className="flex flex-col items-center justify-center gap-3">
                <ZyraLogoASCII shimmer size="md" tone="neutral" variant="loading" className="opacity-100" />
                <p className="text-[11px] font-medium tracking-[0.01em] text-sparkle-text-muted/60">Loading chat...</p>
            </div>
        </div>
    )
}
