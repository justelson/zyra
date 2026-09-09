import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, Check, ChevronDown, Copy, EyeOff, Loader2, Trash2, X } from 'lucide-react'
import type { AssistantActivity } from '@shared/assistant/contracts'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { AnimatedHeight } from '@/components/ui/AnimatedHeight'
import { FileActionsMenu, type FileActionsMenuItem } from '@/components/ui/FileActionsMenu'
import { cn } from '@/lib/utils'
import { formatAssistantDateTime, formatAssistantRelativeTime } from '@/lib/assistant/selectors'

export type UsageMetricTone = 'low' | 'normal' | 'high' | 'neutral'
export type LogDetailsTab = 'rendered' | 'raw'
export type AssistantToastTone = 'success' | 'error' | 'info'
export type AssistantToastState = {
    message: string
    visible: boolean
    tone?: AssistantToastTone
}
export type AssistantToastInput = {
    message: string
    tone?: AssistantToastTone
}
export type IssueActivityGroup = {
    activity: AssistantActivity
    activities: AssistantActivity[]
    count: number
}

export type IssueDismissScope = 'type' | 'tone'

type PersistedIssueDismissState = {
    keys: string[]
    tones: Array<AssistantActivity['tone']>
}

const ISSUE_DISMISS_STORAGE_KEY = 'devscope.assistant.dismissed-issues.v1'

export function useAssistantTransientToast() {
    const [toast, setToast] = useState<AssistantToastState | null>(null)

    const showToast = useCallback((input: string | AssistantToastInput, tone: AssistantToastTone = 'success') => {
        const nextToast = typeof input === 'string'
            ? { message: input, tone }
            : { message: input.message, tone: input.tone ?? 'success' }

        setToast({ ...nextToast, visible: false })
        window.setTimeout(() => {
            setToast((current) => current ? { ...current, visible: true } : current)
        }, 10)
    }, [])

    useEffect(() => {
        if (!toast?.visible) return

        const hideTimer = window.setTimeout(() => {
            setToast((current) => current ? { ...current, visible: false } : current)
        }, 2600)
        const removeTimer = window.setTimeout(() => {
            setToast(null)
        }, 3000)

        return () => {
            window.clearTimeout(hideTimer)
            window.clearTimeout(removeTimer)
        }
    }, [toast?.visible])

    return { toast, showToast }
}

export function AssistantTransientToast({ toast }: { toast: AssistantToastState | null }) {
    if (!toast) return null

    return (
        <div
            className={cn(
                'fixed bottom-4 right-4 z-[110] w-[min(24rem,calc(100vw-2rem))] rounded-xl px-4 py-3 text-sm shadow-lg backdrop-blur-md transition-all duration-300',
                toast.tone === 'error'
                    ? 'border border-red-500/30 bg-red-500/10 text-red-200'
                    : toast.tone === 'success'
                        ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                        : 'border border-amber-500/30 bg-amber-500/10 text-amber-300',
                toast.visible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0'
            )}
        >
            <div className="flex min-w-0 items-start gap-2">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <span className="min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{toast.message}</span>
            </div>
        </div>
    )
}

export function formatCompactMetric(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) return 'n/a'
    const absolute = Math.abs(value)
    if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(absolute >= 10_000_000 ? 0 : 1)}M`
    if (absolute >= 1_000) return `${(value / 1_000).toFixed(absolute >= 100_000 ? 0 : 1)}k`
    return `${Math.round(value)}`
}

export function formatContextMetric(used: number | null | undefined, max: number | null | undefined): string {
    if (used == null && max == null) return 'n/a'
    if (used == null || max == null || max <= 0) return `${formatCompactMetric(used)} / ${formatCompactMetric(max)}`
    return `${((used / max) * 100).toFixed(1)}% / ${formatCompactMetric(max)}`
}

export function getUsageMetricToneClass(tone: UsageMetricTone): string {
    if (tone === 'high') return 'text-red-300'
    if (tone === 'normal') return 'text-amber-300'
    if (tone === 'low') return 'text-emerald-300'
    return 'text-sparkle-text'
}

export function getUsageMetricDotClass(tone: UsageMetricTone): string {
    if (tone === 'high') return 'bg-red-400'
    if (tone === 'normal') return 'bg-amber-400'
    if (tone === 'low') return 'bg-emerald-400'
    return 'bg-white/20'
}

export function resolveUsageMetricTone(value: number | null | undefined, maxValue: number | null | undefined, fallbackThresholds: { normal: number; high: number }): UsageMetricTone {
    if (value == null || !Number.isFinite(value) || value <= 0) return 'neutral'
    if (maxValue != null && Number.isFinite(maxValue) && maxValue > 0) {
        const ratio = value / maxValue
        if (ratio >= 0.85) return 'high'
        if (ratio >= 0.45) return 'normal'
        return 'low'
    }
    if (value >= fallbackThresholds.high) return 'high'
    if (value >= fallbackThresholds.normal) return 'normal'
    return 'low'
}

export function getIssueActivities(activities: AssistantActivity[]): AssistantActivity[] {
    return activities.filter((activity) => activity.tone === 'warning' || activity.tone === 'error' || activity.kind === 'process.stderr' || activity.kind === 'runtime.error')
}

export function groupIssueActivities(activities: AssistantActivity[]): IssueActivityGroup[] {
    const groups: IssueActivityGroup[] = []
    for (const activity of activities) {
        const lastGroup = groups[groups.length - 1]
        if (lastGroup && lastGroup.activity.summary === activity.summary && lastGroup.activity.tone === activity.tone) {
            lastGroup.count += 1
            lastGroup.activities.push(activity)
            continue
        }
        groups.push({ activity, activities: [activity], count: 1 })
    }
    return groups
}

export function getIssueActivityDismissKey(activity: AssistantActivity): string {
    return [
        activity.tone || 'neutral',
        activity.kind || 'unknown',
        String(activity.summary || '').trim().toLowerCase()
    ].join('::')
}

export function readPersistedIssueDismissState(): PersistedIssueDismissState {
    if (typeof window === 'undefined' || !window.localStorage) {
        return { keys: [], tones: [] }
    }

    try {
        const raw = window.localStorage.getItem(ISSUE_DISMISS_STORAGE_KEY)
        if (!raw) return { keys: [], tones: [] }
        const parsed = JSON.parse(raw) as Partial<PersistedIssueDismissState> | null
        const keys = Array.isArray(parsed?.keys)
            ? parsed.keys.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
            : []
        const tones = Array.isArray(parsed?.tones)
            ? parsed.tones.filter((value): value is AssistantActivity['tone'] => value === 'warning' || value === 'error')
            : []
        return { keys, tones }
    } catch {
        return { keys: [], tones: [] }
    }
}

export function writePersistedIssueDismissState(state: PersistedIssueDismissState): PersistedIssueDismissState {
    const nextState: PersistedIssueDismissState = {
        keys: [...new Set(state.keys.filter((value) => typeof value === 'string' && value.trim().length > 0))],
        tones: [...new Set(state.tones.filter((value) => value === 'warning' || value === 'error'))]
    }

    if (typeof window === 'undefined' || !window.localStorage) {
        return nextState
    }

    try {
        if (nextState.keys.length === 0 && nextState.tones.length === 0) {
            window.localStorage.removeItem(ISSUE_DISMISS_STORAGE_KEY)
        } else {
            window.localStorage.setItem(ISSUE_DISMISS_STORAGE_KEY, JSON.stringify(nextState))
        }
    } catch {
        // ignore persistence failures
    }

    return nextState
}

function stripAnsi(value: string): string {
    return value.replace(/\u001b\[[0-9;]*m/g, '')
}

function normalizeIssueDetailLines(activity: AssistantActivity): string[] {
    return stripAnsi(String(activity.detail || ''))
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
}

function scoreIssueDetailLine(line: string): number {
    if (!line) return Number.NEGATIVE_INFINITY
    let score = 0

    if (/is denied|permission denied|unauthorized|refused|timed out|timeout|not found|failed|exception|cannot |could not |access to the path|econnrefused|enoent/i.test(line)) {
        score += 8
    }
    if (/^\w[^:]{0,80}\s:\s.+/.test(line)) {
        score += 5
    }
    if (/error=/i.test(line)) {
        score += 2
    }
    if (/^at line:/i.test(line) || /^\+\s/.test(line) || /^categoryinfo:/i.test(line) || /^fullyqualifiederrorid:/i.test(line) || /^wall time:/i.test(line) || /^output:$/i.test(line)) {
        score -= 10
    }
    if (/^import\s.+|^test\(|^assert\./i.test(line)) {
        score -= 8
    }
    if (/codex_core::tools::router|^202\d-\d\d-\d\d.*\berror\b/i.test(line)) {
        score -= 4
    }

    return score
}

export function getIssueActivityBrief(activity: AssistantActivity, maxLength = 180): string {
    const lines = normalizeIssueDetailLines(activity)
    if (lines.length === 0) return activity.summary

    const bestLine = [...lines]
        .sort((left, right) => scoreIssueDetailLine(right) - scoreIssueDetailLine(left) || left.length - right.length)[0]
        || lines[0]

    const normalized = bestLine.replace(/^.*error=/i, '').replace(/\s+/g, ' ').trim()
    if (normalized.length <= maxLength) return normalized
    return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

export function getIssueDisplayTitle(activity: AssistantActivity): string {
    const combined = `${activity.summary || ''} ${activity.detail || ''}`
    if (/connectionrefused|actively refused|tcp connect error/i.test(combined)) return 'Local service unavailable'
    if (/timed out|timeout/i.test(combined)) return 'Operation timed out'
    if (/permission denied|access denied|unauthorized/i.test(combined)) return 'Permission required'
    if (/failed to start turn/i.test(combined)) return 'Couldn\'t start the response'
    if (/codex error|provider.*error|runtime error/i.test(combined)) return 'Couldn\'t complete the response'
    return String(activity.summary || 'Something went wrong')
        .replace(/^(?:codex|zyra|runtime|provider)\s+error\s*:\s*/i, '')
        .trim() || 'Something went wrong'
}

function getIssueToneLabel(tone: AssistantActivity['tone']): 'Error' | 'Warning' {
    return tone === 'error' ? 'Error' : 'Warning'
}

function getIssueToneSurface(tone: AssistantActivity['tone']) {
    if (tone === 'error') {
        return {
            card: 'bg-red-500/[0.055]',
            hover: 'hover:bg-red-500/[0.085]',
            subtleRow: 'hover:bg-red-500/[0.05]',
            focus: 'focus-visible:ring-red-300/35',
            subtleFocus: 'focus-visible:ring-red-300/30',
            button: 'bg-red-500/[0.12] text-red-100/90 hover:bg-red-500/[0.18] hover:text-red-50',
            countButton: 'bg-red-500/[0.12] text-red-100/80 hover:bg-red-500/[0.18] hover:text-red-50',
            badge: 'border-transparent bg-red-500/[0.14] text-red-100',
            detail: 'text-red-100/75',
            menuButton: 'text-red-100/45 hover:bg-red-500/[0.08] hover:text-red-50',
            menuOpenButton: 'bg-red-500/[0.12] text-red-50',
            dismissed: 'text-red-100/62 hover:bg-red-500/[0.05] hover:text-red-100/82',
            dismissedCount: 'text-red-100/42'
        }
    }

    return {
        card: 'bg-amber-500/[0.035]',
        hover: 'hover:bg-amber-500/[0.06]',
        subtleRow: 'hover:bg-amber-500/[0.045]',
        focus: 'focus-visible:ring-amber-300/30',
        subtleFocus: 'focus-visible:ring-amber-300/25',
        button: 'bg-amber-500/[0.09] text-amber-100/82 hover:bg-amber-500/[0.14] hover:text-amber-50',
        countButton: 'bg-amber-500/[0.11] text-amber-100/78 hover:bg-amber-500/[0.16] hover:text-amber-50',
        badge: 'border-transparent bg-amber-500/[0.11] text-amber-100',
        detail: 'text-amber-100/68',
        menuButton: 'text-amber-100/45 hover:bg-amber-500/[0.08] hover:text-amber-50',
        menuOpenButton: 'bg-amber-500/[0.12] text-amber-50',
        dismissed: 'text-amber-100/60 hover:bg-amber-500/[0.045] hover:text-amber-100/82',
        dismissedCount: 'text-amber-100/42'
    }
}

export function buildIssueLogEntry(activity: AssistantActivity): Record<string, unknown> {
    const detail = stripAnsi(String(activity.detail || '').trim())
    const localhostTargetMatch = detail.match(/http:\/\/127\.0\.0\.1:(\d+)(\/\S*)?/i)
    const tcpTargetMatch = detail.match(/127\.0\.0\.1:(\d+)/)
    const codeMatch = detail.match(/code:\s*(\d+)/i)
    const connectionRefused = /connectionrefused|actively refused|tcp connect error/i.test(detail)
    return {
        timestamp: activity.createdAt,
        level: activity.tone,
        kind: activity.kind,
        summary: activity.summary,
        issue: connectionRefused ? 'local_mcp_connection_refused' : undefined,
        target: localhostTargetMatch?.[0] || (tcpTargetMatch ? `127.0.0.1:${tcpTargetMatch[1]}` : undefined),
        host: tcpTargetMatch ? '127.0.0.1' : undefined,
        port: tcpTargetMatch ? Number(tcpTargetMatch[1]) : undefined,
        path: localhostTargetMatch?.[2] || undefined,
        osCode: codeMatch ? Number(codeMatch[1]) : undefined,
        explanation: connectionRefused ? 'The assistant tried to reach a local MCP server, but nothing was listening on that port.' : undefined,
        detail
    }
}

export async function copyTextToClipboard(value: string): Promise<void> {
    const normalized = String(value || '')
    if (!normalized.trim()) return
    const result = await window.devscope.copyToClipboard?.(normalized)
    if (result && result.success === false) throw new Error(result.error || 'Failed to copy to clipboard')
    if (result) return
    if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(normalized)
        return
    }
    const textarea = document.createElement('textarea')
    textarea.value = normalized
    textarea.setAttribute('readonly', 'true')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    textarea.style.pointerEvents = 'none'
    document.body.appendChild(textarea)
    textarea.select()
    const success = document.execCommand('copy')
    document.body.removeChild(textarea)
    if (!success) throw new Error('Failed to copy to clipboard')
}

export function IssueLogRow({
    activity,
    activities,
    count,
    onDismiss,
    onShowMore,
    compact = false
}: {
    activity: AssistantActivity
    activities?: AssistantActivity[]
    count?: number
    onDismiss?: (activity: AssistantActivity, scope: IssueDismissScope) => void
    onShowMore: (activity: AssistantActivity, activities?: AssistantActivity[]) => void
    compact?: boolean
}) {
    const [expanded, setExpanded] = useState(false)
    const brief = getIssueActivityBrief(activity)
    const hasMultiple = count && count > 1 && activities && activities.length > 1
    const toneSurface = getIssueToneSurface(activity.tone)
    const displayTitle = getIssueDisplayTitle(activity)
    const openDetails = () => onShowMore(activity, activities)
    const toneLabel = getIssueToneLabel(activity.tone)
    const dismissItems = useMemo<FileActionsMenuItem[]>(() => {
        if (!onDismiss) return []
        return [
            {
                id: 'dismiss-type',
                label: `Dismiss this ${toneLabel.toLowerCase()} type`,
                icon: <EyeOff size={13} />,
                onSelect: () => onDismiss(activity, 'type')
            },
            {
                id: 'dismiss-tone',
                label: `Dismiss all ${toneLabel.toLowerCase()}s`,
                icon: <EyeOff size={13} />,
                onSelect: () => onDismiss(activity, 'tone')
            }
        ]
    }, [activity, onDismiss, toneLabel])

    return (
        <div className={cn('w-full overflow-hidden', !compact && 'border-b border-white/[0.045] last:border-b-0')} data-assistant-inline-issue={compact ? activity.tone : undefined}>
            <div
                role="button"
                tabIndex={0}
                onClick={openDetails}
                aria-label={`${displayTitle}. Show details`}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        openDetails()
                    }
                }}
                className={cn(
                    'group flex justify-between transition-colors hover:bg-white/[0.025] focus:outline-none focus-visible:ring-1',
                    compact ? 'min-h-7 items-center gap-2 rounded-md py-0.5' : 'items-start gap-3 px-2.5 py-2.5',
                    toneSurface.focus
                )}
            >
                <AlertCircle
                    size={compact ? 12 : 14}
                    className={cn('shrink-0', !compact && 'mt-0.5', activity.tone === 'error' ? 'text-red-300/60' : 'text-amber-200/55')}
                />
                {compact ? (
                    <div className="flex min-w-0 flex-1 items-center gap-2 text-[11px] leading-5">
                        <span className={cn('min-w-0 truncate font-medium', activity.tone === 'error' ? 'text-red-200/65' : 'text-amber-100/60')}>{displayTitle}</span>
                        <span className="h-px min-w-4 flex-1 bg-[var(--surface-divider)]" aria-hidden="true" />
                    </div>
                ) : (
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-medium text-sparkle-text/90">{displayTitle}</p>
                        {brief ? <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-sparkle-text-secondary/62">{brief}</p> : null}
                    </div>
                )}
                <div className={cn(
                    'flex shrink-0 items-center text-sparkle-text-muted/45 transition-opacity group-hover:opacity-100 focus-within:opacity-100',
                    compact ? 'gap-0.5 opacity-70' : 'gap-1 opacity-55'
                )}>
                    {hasMultiple ? (
                        <button
                            type="button"
                            onClick={(event) => { event.stopPropagation(); setExpanded(!expanded) }}
                            className={cn('inline-flex items-center gap-1 rounded-md text-[10px] transition-colors hover:bg-white/[0.04] hover:text-sparkle-text-secondary', compact ? 'h-6 px-1' : 'px-1.5 py-1')}
                            title={expanded ? 'Collapse repeated logs' : `Show ${count} repeated logs`}
                        >
                            <ChevronDown size={12} className={cn('transition-transform duration-150', expanded && 'rotate-180')} />
                            <span>x{count}</span>
                        </button>
                    ) : null}
                    {dismissItems.length > 0 ? (
                        <FileActionsMenu
                            items={dismissItems}
                            presentation="portal"
                            preferredDirection="up"
                            title={`Dismiss ${toneLabel.toLowerCase()} options`}
                            buttonClassName={cn(compact ? 'h-6 w-6' : 'h-7 w-7', 'rounded-md border-transparent bg-transparent hover:border-transparent', toneSurface.menuButton)}
                            openButtonClassName={cn('border-transparent', toneSurface.menuOpenButton)}
                            menuClassName="min-w-[188px]"
                        />
                    ) : null}
                    <button
                        type="button"
                        onClick={(event) => { event.stopPropagation(); openDetails() }}
                        className="rounded-md px-1.5 py-1 text-[10px] transition-colors hover:bg-white/[0.04] hover:text-sparkle-text-secondary"
                    >
                        Details
                    </button>
                </div>
            </div>
            <AnimatedHeight isOpen={Boolean(hasMultiple && expanded)} duration={180} crispContent>
                <div className={cn(compact ? 'px-2 pb-1.5 pt-0.5' : 'px-3 pb-2 pt-1')}>
                    <div className="space-y-1">
                        {(activities || []).map((act, index) => (
                            <div key={act.id} role="button" tabIndex={0} onClick={() => onShowMore(act)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onShowMore(act) } }} className={cn('flex items-center gap-2 rounded px-2 py-1 text-[10px] text-sparkle-text-muted focus:outline-none focus-visible:ring-1', toneSurface.subtleFocus, toneSurface.subtleRow)}>
                                <span className="shrink-0 text-white/35">#{index + 1}</span>
                                <span className="flex-1 truncate">{getIssueDisplayTitle(act)}</span>
                                <span className="shrink-0 text-white/25">{formatAssistantDateTime(act.createdAt)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </AnimatedHeight>
        </div>
    )
}

export function DismissedIssueRow({
    activity,
    activities,
    count,
    onOpen
}: {
    activity: AssistantActivity
    activities?: AssistantActivity[]
    count?: number
    onOpen: (activity: AssistantActivity, activities?: AssistantActivity[]) => void
}) {
    const toneLabel = getIssueToneLabel(activity.tone)
    const lineLabel = `${toneLabel} occurred`
    const hasMultiple = Boolean(count && count > 1)
    const toneSurface = getIssueToneSurface(activity.tone)

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={() => onOpen(activity, activities)}
            onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onOpen(activity, activities)
                }
            }}
            className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors focus:outline-none focus-visible:ring-1',
                toneSurface.subtleFocus,
                toneSurface.dismissed
            )}
            title={activity.summary}
        >
            <span className="truncate font-medium">{lineLabel}</span>
            {hasMultiple ? <span className={cn('shrink-0 text-[10px]', toneSurface.dismissedCount)}>x{count}</span> : null}
        </div>
    )
}

export function IssueLogDetailsModal({
    activity,
    activities = null,
    tab,
    onChangeTab,
    onClose
}: {
    activity: AssistantActivity | null
    activities?: AssistantActivity[] | null
    tab: LogDetailsTab
    onChangeTab: (tab: LogDetailsTab) => void
    onClose: () => void
}) {
    const [copied, setCopied] = useState(false)
    const [copyError, setCopyError] = useState<string | null>(null)
    const dialogRef = useRef<HTMLDivElement | null>(null)
    const detailActivities = activities && activities.length > 0
        ? activities
        : activity
            ? [activity]
            : []
    const primaryActivity = detailActivities[0] || null

    useEffect(() => {
        if (!primaryActivity) return
        const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        window.addEventListener('keydown', onEscape)
        window.requestAnimationFrame(() => dialogRef.current?.focus())
        return () => {
            document.body.style.overflow = previousOverflow
            window.removeEventListener('keydown', onEscape)
        }
    }, [onClose, primaryActivity])

    if (!primaryActivity || typeof document === 'undefined') return null
    const logEntries = detailActivities.map((entry) => buildIssueLogEntry(entry))
    const title = detailActivities.length > 1
        ? `${primaryActivity.tone === 'error' ? 'Problems' : 'Warnings'} (${detailActivities.length})`
        : getIssueDisplayTitle(primaryActivity)

    const handleCopy = async () => {
        try {
            await copyTextToClipboard(JSON.stringify(detailActivities.length > 1 ? logEntries : logEntries[0], null, 2))
            setCopied(true)
            setCopyError(null)
            window.setTimeout(() => setCopied(false), 1600)
        } catch (error) {
            setCopyError(error instanceof Error ? error.message : 'Failed to copy to clipboard')
        }
    }

    return createPortal(
        <div
            className="fixed inset-0 z-[2147482000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md animate-fadeIn"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose()
            }}
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-label={title}
                tabIndex={-1}
                className="flex max-h-[min(78vh,42rem)] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-white/[0.1] bg-sparkle-card shadow-2xl shadow-black/45 outline-none"
                onMouseDown={(event) => event.stopPropagation()}
            >
                <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-3 py-2.5">
                    <div className="min-w-0"><h3 className="truncate text-sm font-semibold text-sparkle-text">{title}</h3><p className="mt-1 text-xs text-sparkle-text-secondary">{detailActivities.length > 1 ? `${formatAssistantDateTime(detailActivities[detailActivities.length - 1].createdAt)} → ${formatAssistantDateTime(primaryActivity.createdAt)}` : formatAssistantRelativeTime(primaryActivity.createdAt)}</p></div>
                    <div className="flex shrink-0 items-center gap-1">
                        <button type="button" onClick={() => onChangeTab('rendered')} className={cn('rounded-md px-2 py-1 text-[11px] transition-colors', tab === 'rendered' ? 'bg-white/[0.07] text-sparkle-text' : 'text-sparkle-text-muted hover:bg-white/[0.035] hover:text-sparkle-text-secondary')}>Summary</button>
                        <button type="button" onClick={() => onChangeTab('raw')} className={cn('rounded-md px-2 py-1 text-[11px] transition-colors', tab === 'raw' ? 'bg-white/[0.07] text-sparkle-text' : 'text-sparkle-text-muted hover:bg-white/[0.035] hover:text-sparkle-text-secondary')}>Raw details</button>
                        <button type="button" onClick={() => void handleCopy()} className={cn('inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors', copied ? 'border-emerald-400/20 bg-emerald-500/[0.08] text-emerald-100' : copyError ? 'border-red-400/20 bg-red-500/[0.08] text-red-100' : 'border-white/10 bg-white/[0.03] text-sparkle-text-secondary hover:border-white/20 hover:bg-white/[0.05] hover:text-sparkle-text')}>{copied ? <Check size={11} /> : <Copy size={11} />}{copied ? 'Copied' : 'Copy'}</button>
                        <button type="button" onClick={onClose} className="rounded-md border border-white/10 p-1.5 text-sparkle-text-secondary transition-colors hover:border-white/20 hover:bg-white/[0.05] hover:text-sparkle-text" title="Close details"><X size={12} /></button>
                    </div>
                </div>
                <div className="custom-scrollbar flex-1 overflow-auto bg-sparkle-bg p-3">
                    {tab === 'rendered'
                        ? <div className="space-y-2">{detailActivities.map((entry) => (
                            <div key={entry.id} className="border-l border-red-300/18 bg-white/[0.018] py-2.5 pl-3 pr-2">
                                <div className="flex items-center justify-between gap-3">
                                    <p className="text-[12px] font-medium text-sparkle-text/90">{getIssueDisplayTitle(entry)}</p>
                                    <span className="shrink-0 text-[10px] text-sparkle-text-muted/45">{formatAssistantDateTime(entry.createdAt)}</span>
                                </div>
                                <p className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-5 text-sparkle-text-secondary/70">{getIssueActivityBrief(entry, 420)}</p>
                            </div>
                        ))}</div>
                        : <pre className="custom-scrollbar overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-white/[0.07] bg-black/25 p-3 text-[11px] leading-5 text-sparkle-text-secondary/65">{JSON.stringify(detailActivities.length > 1 ? logEntries : logEntries[0], null, 2)}</pre>}
                </div>
            </div>
        </div>,
        document.body
    )
}

export function DeleteHistoryConfirm({
    isOpen,
    deleting,
    onConfirm,
    onCancel
}: {
    isOpen: boolean
    deleting: boolean
    onConfirm: () => void
    onCancel: () => void
}) {
    return (
        <ConfirmModal
            isOpen={isOpen}
            title="Delete message from history?"
            message="This will remove only the selected user message and its associated assistant turn from this thread history. Later messages stay intact. This cannot be undone."
            confirmLabel={deleting ? 'Deleting...' : 'Delete message'}
            cancelLabel="Cancel"
            variant="danger"
            onConfirm={onConfirm}
            onCancel={onCancel}
        />
    )
}
