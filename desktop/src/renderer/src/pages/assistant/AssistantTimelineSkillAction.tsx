import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Puzzle, X } from 'lucide-react'
import type { AssistantActivity } from '@shared/assistant/contracts'
import MarkdownRenderer from '@/components/ui/MarkdownRenderer'
import { AssistantTimelineActionShell } from './AssistantTimelineActionShell'
import {
    getAssistantActionTitle,
    getAssistantCapturedRead,
    getAssistantSkillName
} from './assistant-action-presentation'
import { parseAssistantSkillSnapshot } from './assistant-skill-snapshot'
import { getActivityElapsed, getActivityStatus } from './assistant-timeline-helpers'
import { getAssistantRelativeFilePath } from './assistant-file-navigation'
import { useAssistantHydratedActivity } from './useAssistantHydratedActivity'

function yamlValueClass(kind: ReturnType<typeof parseAssistantSkillSnapshot>['frontmatter'][number]['valueKind']): string {
    if (kind === 'boolean') return 'text-fuchsia-300/85'
    if (kind === 'number') return 'text-amber-300/85'
    if (kind === 'null') return 'text-red-300/75'
    if (kind === 'collection') return 'text-violet-300/85'
    return 'text-emerald-200/80'
}

export function AssistantSkillSnapshotPreview(props: {
    activity: AssistantActivity
    projectRootPath?: string | null
    onClose: () => void
}) {
    const captured = getAssistantCapturedRead(props.activity)
    const name = getAssistantSkillName(props.activity) || 'Skill'
    const snapshot = parseAssistantSkillSnapshot(captured?.content || '')
    return (
        <section className="flex h-[min(82vh,820px)] w-[min(880px,94vw)] min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-[color-mix(in_srgb,var(--color-card)_97%,black)] shadow-[0_28px_90px_rgba(0,0,0,0.52)]">
            <header className="flex min-h-12 items-center gap-3 border-b border-white/[0.07] px-4">
                <Puzzle size={15} className="text-[var(--accent-primary)]" />
                <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-semibold text-sparkle-text">{name}</p>
                    <p className="truncate font-mono text-[9px] text-sparkle-text-muted">
                        {captured ? getAssistantRelativeFilePath(captured.path, props.projectRootPath) : 'Captured skill instructions'}
                        {captured?.startLine && captured.endLine ? ` · lines ${captured.startLine}–${captured.endLine}` : ''}
                    </p>
                </div>
                <span className="rounded-full bg-white/[0.04] px-2 py-1 text-[9px] font-medium uppercase tracking-[0.12em] text-sparkle-text-muted">Captured</span>
                <button type="button" onClick={props.onClose} className="inline-flex size-7 items-center justify-center rounded-lg text-sparkle-text-muted hover:bg-white/[0.06] hover:text-sparkle-text" aria-label="Close skill snapshot"><X size={14} /></button>
            </header>
            <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
                {snapshot.frontmatter.length > 0 ? (
                    <div className="border-b border-white/[0.07] bg-black/15 px-5 py-4 font-mono text-[11px] leading-5" data-assistant-skill-frontmatter="true">
                        <div className="text-sparkle-text-muted/55">---</div>
                        {snapshot.frontmatter.map((entry, index) => (
                            <div key={`${entry.key}:${index}`} className="whitespace-pre-wrap break-words">
                                {entry.key ? <><span className="text-sky-300/85">{entry.key}</span><span className="text-sparkle-text-muted">: </span></> : null}
                                <span className={yamlValueClass(entry.valueKind)}>{entry.value}</span>
                            </div>
                        ))}
                        <div className="text-sparkle-text-muted/55">---</div>
                    </div>
                ) : null}
                <div className="px-6 py-5">
                    {snapshot.body ? (
                        <MarkdownRenderer
                            content={snapshot.body}
                            cacheKey={`skill-snapshot:${props.activity.id}:${snapshot.body.length}`}
                            className="text-[12px] leading-6 text-sparkle-text-secondary [&_h1]:text-xl [&_h2]:mt-7 [&_h2]:text-base [&_h3]:text-sm [&_pre]:text-[10px]"
                        />
                    ) : <p className="text-[12px] text-sparkle-text-muted">No captured skill text is available.</p>}
                </div>
            </div>
        </section>
    )
}

function SkillSnapshotModal(props: {
    activity: AssistantActivity
    projectRootPath?: string | null
    onClose: () => void
}) {
    const name = getAssistantSkillName(props.activity) || 'Skill'
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') props.onClose()
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [props])
    if (typeof document === 'undefined') return null
    return createPortal(
        <div className="fixed inset-0 z-[115] flex items-center justify-center bg-black/55 p-5 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`${name} skill snapshot`} onMouseDown={(event) => {
            if (event.target === event.currentTarget) props.onClose()
        }}>
            <AssistantSkillSnapshotPreview {...props} />
        </div>,
        document.body
    )
}

export function AssistantTimelineSkillAction(props: {
    activity: AssistantActivity
    projectRootPath?: string | null
    purposeTitle?: string | null
}) {
    const hydrated = useAssistantHydratedActivity(props.activity)
    const [previewActivity, setPreviewActivity] = useState<AssistantActivity | null>(null)
    const name = getAssistantSkillName(hydrated.activity) || 'skill'
    const status = getActivityStatus(hydrated.activity)
    const open = async () => setPreviewActivity(await hydrated.hydrate())
    return (
        <>
            <AssistantTimelineActionShell
                activityId={props.activity.id}
                icon={hydrated.loading ? <Loader2 size={13} className="animate-spin" /> : <Puzzle size={13} />}
                title={getAssistantActionTitle(hydrated.activity, props.projectRootPath, props.purposeTitle)}
                target={props.purposeTitle ? name : getAssistantCapturedRead(hydrated.activity)?.path || name}
                createdAt={props.activity.createdAt}
                elapsed={getActivityElapsed(hydrated.activity)}
                status={status}
                onToggle={() => { void open() }}
            />
            {hydrated.error ? <p className="pl-6 text-[10px] text-red-300/75">{hydrated.error}</p> : null}
            {previewActivity ? <SkillSnapshotModal activity={previewActivity} projectRootPath={props.projectRootPath} onClose={() => setPreviewActivity(null)} /> : null}
        </>
    )
}
