import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, Search } from 'lucide-react'
import type { AssistantActivity } from '@shared/assistant/contracts'
import { AssistantBrowserPageIcon } from './AssistantBrowserPageIcon'
import { AssistantTimelineActionShell } from './AssistantTimelineActionShell'
import {
    getAssistantActionTarget,
    getAssistantActionTitle,
    getAssistantWebEvidence,
    type AssistantWebEvidenceItem
} from './assistant-action-presentation'
import { getActivityElapsed, getActivityStatus } from './assistant-timeline-helpers'
import { useAssistantHydratedActivity } from './useAssistantHydratedActivity'

export function AssistantWebResultPreviewCard(props: { item: AssistantWebEvidenceItem }) {
    return (
        <div
            role="tooltip"
            className="pointer-events-none w-[min(380px,calc(100vw-24px))] translate-y-0 rounded-xl border border-white/10 bg-[color-mix(in_srgb,var(--color-card)_96%,black)] p-3 opacity-100 shadow-[0_18px_50px_rgba(0,0,0,0.42)] backdrop-blur-xl transition-[opacity,transform] duration-150"
            data-assistant-web-preview="structured"
        >
            <div className="flex items-center gap-2">
                <AssistantBrowserPageIcon faviconUrl={props.item.faviconUrl} pageUrl={props.item.url} size={14} />
                <span className="truncate text-[10px] font-medium text-sparkle-text-muted">{props.item.site}</span>
            </div>
            <p className="mt-2 text-[12px] font-semibold leading-5 text-sparkle-text">{props.item.title}</p>
            {props.item.snippet ? <p className="mt-1.5 line-clamp-6 text-[11px] leading-5 text-sparkle-text-secondary">{props.item.snippet}</p> : null}
            <p className="mt-2 truncate font-mono text-[9px] text-sparkle-text-muted/70">{props.item.url}</p>
        </div>
    )
}

function WebResultPill(props: {
    item: AssistantWebEvidenceItem
    index: number
    onOpenUrl?: (url: string) => Promise<boolean | void> | boolean | void
}) {
    const ref = useRef<HTMLButtonElement | null>(null)
    const [preview, setPreview] = useState<{ left: number; top: number } | null>(null)
    const showPreview = () => {
        const rect = ref.current?.getBoundingClientRect()
        if (!rect) return
        const width = Math.min(380, Math.max(280, window.innerWidth - 24))
        setPreview({
            left: Math.max(12, Math.min(window.innerWidth - width - 12, rect.left)),
            top: Math.max(12, Math.min(window.innerHeight - 190, rect.bottom + 8))
        })
    }
    const open = () => {
        if (props.onOpenUrl) void props.onOpenUrl(props.item.url)
        else window.open(props.item.url, '_blank', 'noopener,noreferrer')
    }
    const hoverCard = preview && typeof document !== 'undefined' ? createPortal(
        <div className="fixed z-[120]" style={{ left: preview.left, top: preview.top }}>
            <AssistantWebResultPreviewCard item={props.item} />
        </div>,
        document.body
    ) : null

    return (
        <>
            <button
                ref={ref}
                type="button"
                onClick={open}
                onMouseEnter={showPreview}
                onMouseLeave={() => setPreview(null)}
                onFocus={showPreview}
                onBlur={() => setPreview(null)}
                className="inline-flex max-w-full items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.025] py-1 pl-1.5 pr-2.5 text-left transition-[border-color,background-color,transform] duration-150 hover:-translate-y-px hover:border-white/[0.16] hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)] motion-safe:animate-[fadeIn_180ms_ease-out_both]"
                style={{ animationDelay: `${Math.min(props.index * 32, 180)}ms` }}
                aria-label={`Open ${props.item.title}`}
            >
                <span className="inline-flex size-5 items-center justify-center rounded-full bg-white/[0.045]">
                    <AssistantBrowserPageIcon faviconUrl={props.item.faviconUrl} pageUrl={props.item.url} size={12} />
                </span>
                <span className="max-w-[260px] truncate text-[11px] font-medium text-sparkle-text-secondary">{props.item.title}</span>
                <ExternalLink size={10} className="shrink-0 text-sparkle-text-muted" />
            </button>
            {hoverCard}
        </>
    )
}

export function AssistantTimelineWebAction(props: {
    activity: AssistantActivity
    projectRootPath?: string | null
    purposeTitle?: string | null
    onOpenUrl?: (url: string) => Promise<boolean | void> | boolean | void
}) {
    const hydrated = useAssistantHydratedActivity(props.activity)
    const [expanded, setExpanded] = useState(false)
    const evidence = getAssistantWebEvidence(hydrated.activity)
    const status = getActivityStatus(hydrated.activity)
    const title = getAssistantActionTitle(hydrated.activity, props.projectRootPath, props.purposeTitle)
    const target = getAssistantActionTarget(hydrated.activity, props.projectRootPath)
    const first = evidence[0]
    const toggle = async () => {
        if (!expanded) await hydrated.hydrate()
        setExpanded((current) => !current)
    }
    return (
        <AssistantTimelineActionShell
            activityId={props.activity.id}
            icon={first ? <AssistantBrowserPageIcon faviconUrl={first.faviconUrl} pageUrl={first.url} size={13} /> : <Search size={13} />}
            title={title}
            target={target}
            createdAt={props.activity.createdAt}
            elapsed={getActivityElapsed(hydrated.activity)}
            status={status}
            expandable={evidence.length > 0 || Boolean(hydrated.historyBodyRef) || Boolean(hydrated.error)}
            expanded={expanded}
            onToggle={() => { void toggle() }}
        >
            {hydrated.loading ? <p className="text-[10px] text-sparkle-text-muted">Loading captured web evidence…</p> : null}
            {hydrated.error ? <p className="text-[10px] text-red-300/75">{hydrated.error}</p> : null}
            <div className="flex flex-wrap gap-1.5" data-assistant-web-results="structured">
                {evidence.map((item, index) => (
                    <WebResultPill key={`${item.url}:${index}`} item={item} index={index} onOpenUrl={props.onOpenUrl} />
                ))}
            </div>
        </AssistantTimelineActionShell>
    )
}
