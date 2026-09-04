import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileText, Loader2, X } from 'lucide-react'
import type { AssistantActivity } from '@shared/assistant/contracts'
import { detectCodeLanguage } from '@/components/ui/file-preview/utils'
import { AssistantTimelineActionShell } from './AssistantTimelineActionShell'
import {
    getAssistantActionTitle,
    getAssistantCapturedRead
} from './assistant-action-presentation'
import { getActivityElapsed, getActivityStatus } from './assistant-timeline-helpers'
import { getAssistantRelativeFilePath } from './assistant-file-navigation'
import { useAssistantHydratedActivity } from './useAssistantHydratedActivity'

function readLanguage(path: string): string {
    const normalized = path.replace(/\\/g, '/')
    const name = normalized.split('/').pop() || normalized
    const extension = name.includes('.') ? name.split('.').pop() || '' : ''
    return detectCodeLanguage(extension, name) || extension || 'text'
}

export function AssistantCapturedReadPreview(props: {
    activity: AssistantActivity
    projectRootPath?: string | null
    onClose: () => void
}) {
    const captured = getAssistantCapturedRead(props.activity)
    if (!captured) return null
    const language = readLanguage(captured.path)
    const lines = captured.content.replace(/\n$/, '').split('\n')
    const startLine = captured.startLine || 1
    const range = captured.endLine
        ? `Lines ${startLine}–${captured.endLine}${captured.totalLines ? ` of ${captured.totalLines}` : ''}`
        : `${lines.length} captured ${lines.length === 1 ? 'line' : 'lines'}`
    return (
        <section className="flex h-[min(82vh,820px)] w-[min(980px,95vw)] min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-[color-mix(in_srgb,var(--color-card)_97%,black)] shadow-[0_28px_90px_rgba(0,0,0,0.52)]">
            <header className="flex min-h-12 items-center gap-3 border-b border-white/[0.07] px-4">
                <FileText size={15} className="text-sky-300/80" />
                <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-[11px] font-medium text-sparkle-text">{getAssistantRelativeFilePath(captured.path, props.projectRootPath)}</p>
                    <p className="mt-0.5 text-[9px] text-sparkle-text-muted">Captured {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(props.activity.createdAt))}</p>
                </div>
                <span className="rounded-full bg-white/[0.04] px-2 py-1 font-mono text-[9px] text-sparkle-text-muted">{language}</span>
                <span className="rounded-full bg-white/[0.04] px-2 py-1 font-mono text-[9px] text-sparkle-text-muted">{range}</span>
                <button type="button" onClick={props.onClose} className="inline-flex size-7 items-center justify-center rounded-lg text-sparkle-text-muted hover:bg-white/[0.06] hover:text-sparkle-text" aria-label="Close captured read"><X size={14} /></button>
            </header>
            <div className="custom-scrollbar min-h-0 flex-1 overflow-auto bg-black/15 py-3 font-mono text-[11px] leading-5 [tab-size:4]" data-assistant-read-snapshot="exact">
                {lines.map((line, index) => (
                    <div key={index} className="grid min-w-max grid-cols-[4.5rem_minmax(0,1fr)] px-3 hover:bg-white/[0.025]">
                        <span className="select-none pr-4 text-right text-sparkle-text-muted/40">{startLine + index}</span>
                        <span className="whitespace-pre pr-6 text-[color-mix(in_srgb,var(--color-text)_84%,var(--color-bg))]">{line || ' '}</span>
                    </div>
                ))}
            </div>
        </section>
    )
}

function CapturedReadModal(props: {
    activity: AssistantActivity
    projectRootPath?: string | null
    onClose: () => void
}) {
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') props.onClose()
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [props])
    if (!getAssistantCapturedRead(props.activity) || typeof document === 'undefined') return null
    return createPortal(
        <div className="fixed inset-0 z-[115] flex items-center justify-center bg-black/55 p-5 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Captured file read" onMouseDown={(event) => {
            if (event.target === event.currentTarget) props.onClose()
        }}>
            <AssistantCapturedReadPreview {...props} />
        </div>,
        document.body
    )
}

export function AssistantTimelineReadAction(props: {
    activity: AssistantActivity
    projectRootPath?: string | null
}) {
    const hydrated = useAssistantHydratedActivity(props.activity)
    const [previewActivity, setPreviewActivity] = useState<AssistantActivity | null>(null)
    const captured = getAssistantCapturedRead(hydrated.activity)
    const open = async () => setPreviewActivity(await hydrated.hydrate())
    const target = captured
        ? `${getAssistantRelativeFilePath(captured.path, props.projectRootPath)}${captured.startLine && captured.endLine ? ` · L${captured.startLine}–${captured.endLine}` : ''}`
        : null
    return (
        <>
            <AssistantTimelineActionShell
                activityId={props.activity.id}
                icon={hydrated.loading ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
                title={getAssistantActionTitle(hydrated.activity, props.projectRootPath)}
                target={target || readLanguage(captured?.path || '')}
                createdAt={props.activity.createdAt}
                elapsed={getActivityElapsed(hydrated.activity)}
                status={getActivityStatus(hydrated.activity)}
                onToggle={() => { void open() }}
            />
            {hydrated.error ? <p className="pl-6 text-[10px] text-red-300/75">{hydrated.error}</p> : null}
            {previewActivity ? <CapturedReadModal activity={previewActivity} projectRootPath={props.projectRootPath} onClose={() => setPreviewActivity(null)} /> : null}
        </>
    )
}
