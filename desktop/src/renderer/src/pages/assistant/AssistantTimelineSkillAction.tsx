import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, Puzzle } from 'lucide-react'
import type { AssistantActivity } from '@shared/assistant/contracts'
import FilePreviewModal from '@/components/ui/FilePreviewModal'
import MarkdownRenderer from '@/components/ui/MarkdownRenderer'
import SyntaxPreview from '@/components/ui/file-preview/SyntaxPreview'
import { cn } from '@/lib/utils'
import { AssistantTimelineActionShell } from './AssistantTimelineActionShell'
import {
    getAssistantActionTarget,
    getAssistantActionTitle,
    getAssistantCapturedRead,
    getAssistantSkillName
} from './assistant-action-presentation'
import { parseAssistantSkillSnapshot } from './assistant-skill-snapshot'
import { getActivityElapsed, getActivityStatus } from './assistant-timeline-helpers'
import { useAssistantHydratedActivity } from './useAssistantHydratedActivity'

function withoutDuplicateSkillHeading(body: string, name: string): string {
    const match = body.match(/^#\s+(.+?)\s*(?:\n+|$)/)
    if (!match || match[1]?.trim().toLowerCase() !== name.trim().toLowerCase()) return body
    return body.slice(match[0].length).replace(/^\n+/, '')
}

export function AssistantSkillSnapshotPreview(props: {
    activity: AssistantActivity
    projectRootPath?: string | null
    onClose: () => void
}) {
    const captured = getAssistantCapturedRead(props.activity)
    const snapshot = parseAssistantSkillSnapshot(captured?.content || '')
    const name = snapshot.name || getAssistantSkillName(props.activity) || 'Skill'
    const body = useMemo(() => withoutDuplicateSkillHeading(snapshot.body, name), [name, snapshot.body])
    const [showSource, setShowSource] = useState(false)
    const capturedPath = captured?.path || `${name}/SKILL.md`
    const fileName = capturedPath.replace(/\\/g, '/').split('/').pop() || 'SKILL.md'
    return (
        <FilePreviewModal
            file={{ name: fileName, path: capturedPath, type: 'md', language: 'markdown' }}
            content={captured?.content || ''}
            projectPath={props.projectRootPath || undefined}
            readOnly
            active
            chromeContext="peek"
            previewBytes={new TextEncoder().encode(captured?.content || '').byteLength}
            onClose={props.onClose}
            previewBody={(
                <div className="custom-scrollbar h-full min-h-0 overflow-y-auto" data-assistant-skill-frontmatter="structured">
                    <article className="mx-auto w-full max-w-3xl px-6 py-7">
                        <div className="border-b border-[var(--surface-divider)] pb-5">
                            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--accent-primary)]">
                                <Puzzle size={13} />
                                Skill
                            </div>
                            <h1 className="mt-2 text-xl font-semibold tracking-[-0.02em] text-sparkle-text">{name}</h1>
                            {snapshot.description ? (
                                <p className="mt-2 max-w-2xl text-[13px] leading-6 text-sparkle-text-secondary">{snapshot.description}</p>
                            ) : null}
                        </div>

                        {snapshot.metadata.length > 0 ? (
                            <dl className="grid grid-cols-[minmax(7rem,auto)_minmax(0,1fr)] border-b border-[var(--surface-divider)] py-3 text-[11px]">
                                {snapshot.metadata.map((entry, index) => (
                                    <div key={`${entry.key}:${index}`} className="contents">
                                        <dt className={cn('py-2 pr-4 font-medium text-sparkle-text-muted', index > 0 && 'border-t border-[var(--surface-divider)]')}>{entry.key || 'metadata'}</dt>
                                        <dd className={cn('whitespace-pre-wrap break-words py-2 text-sparkle-text-secondary', index > 0 && 'border-t border-[var(--surface-divider)]')}>{entry.value || '—'}</dd>
                                    </div>
                                ))}
                            </dl>
                        ) : null}

                        <div className="py-6">
                            {body ? (
                                <MarkdownRenderer
                                    content={body}
                                    cacheKey={`skill-snapshot:${props.activity.id}:${body.length}`}
                                    filePath={capturedPath}
                                    className="text-[13px] leading-6 text-sparkle-text-secondary [&_h1]:text-xl [&_h2]:mt-7 [&_h2]:text-base [&_h3]:text-sm [&_pre]:text-[11px]"
                                />
                            ) : <p className="text-[12px] text-sparkle-text-muted">No captured skill instructions are available.</p>}
                        </div>

                        <div className="border-t border-[var(--surface-divider)] pt-3">
                            <button
                                type="button"
                                onClick={() => setShowSource((current) => !current)}
                                className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-sparkle-text-muted transition-colors hover:bg-[var(--surface-hover)] hover:text-sparkle-text"
                                aria-expanded={showSource}
                            >
                                {showSource ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                {showSource ? 'Hide source' : 'View source'}
                            </button>
                            {showSource ? (
                                <div className="mt-2 h-[26rem] overflow-hidden rounded-lg border border-[var(--surface-divider)]">
                                    <SyntaxPreview
                                        content={captured?.content || ''}
                                        language="markdown"
                                        filePath={capturedPath}
                                        modelPath={`inmemory://zyra/captured-skill/${encodeURIComponent(props.activity.id)}/SKILL.md`}
                                        projectPath={props.projectRootPath || undefined}
                                        readOnly
                                        wordWrap="on"
                                        minimapEnabled={false}
                                    />
                                </div>
                            ) : null}
                        </div>
                    </article>
                </div>
            )}
        />
    )
}

export function AssistantTimelineSkillAction(props: {
    activity: AssistantActivity
    projectRootPath?: string | null
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
                title={getAssistantActionTitle(hydrated.activity, props.projectRootPath)}
                target={getAssistantActionTarget(hydrated.activity, props.projectRootPath) || name}
                createdAt={props.activity.createdAt}
                elapsed={getActivityElapsed(hydrated.activity)}
                status={status}
                onToggle={() => { void open() }}
            />
            {hydrated.error ? <p className="pl-6 text-[10px] text-[color-mix(in_srgb,var(--status-danger)_68%,var(--color-text))]">{hydrated.error}</p> : null}
            {previewActivity ? <AssistantSkillSnapshotPreview activity={previewActivity} projectRootPath={props.projectRootPath} onClose={() => setPreviewActivity(null)} /> : null}
        </>
    )
}
