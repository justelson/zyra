import { useEffect, useMemo } from 'react'
import { addOverlayEventListener } from '@/components/ui/native-overlay-events'
import { useAssistantReadPreviewSelection } from './AssistantReadPreviewScope'
import { Loader2 } from 'lucide-react'
import { AssistantReadFileIcon, AssistantReadFilePreview } from './AssistantReadFilePreview'
import type { AssistantActivity } from '@shared/assistant/contracts'
import FilePreviewModal from '@/components/ui/FilePreviewModal'
import SyntaxPreview from '@/components/ui/file-preview/SyntaxPreview'
import { detectCodeLanguage } from '@/components/ui/file-preview/utils'
import { AssistantTimelineActionShell, formatAssistantActionTime } from './AssistantTimelineActionShell'
import {
    getAssistantActionTitle,
    getAssistantCapturedRead,
    getAssistantReadEvidence
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
    if (!captured) return <AssistantReadFilePreview {...props} />
    const language = readLanguage(captured.path)
    const normalizedPath = captured.path.replace(/\\/g, '/')
    const fileName = normalizedPath.split('/').pop() || normalizedPath
    const startLine = captured.startLine || 1
    const lineCount = captured.content ? captured.content.replace(/\n$/, '').split('\n').length : 0
    const range = captured.endLine
        ? `Lines ${startLine}–${captured.endLine}${captured.totalLines ? ` of ${captured.totalLines}` : ''}`
        : `${lineCount} captured ${lineCount === 1 ? 'line' : 'lines'}`
    return (
        <FilePreviewModal
            file={{ name: fileName, path: captured.path, type: language === 'text' ? 'text' : 'code', language }}
            content={captured.content}
            projectPath={props.projectRootPath || undefined}
            readOnly
            active
            chromeContext="peek"
            previewBytes={new TextEncoder().encode(captured.content).byteLength}
            onClose={props.onClose}
            previewBody={(
                <div className="flex h-full min-h-0 flex-col" data-assistant-read-snapshot="exact">
                    <div className="flex h-8 shrink-0 items-center justify-between border-b border-[var(--surface-divider)] px-3 text-[10px] text-sparkle-text-muted">
                        <span>{range}</span>
                        <span>Captured {formatAssistantActionTime(props.activity.createdAt)}</span>
                    </div>
                    <div className="min-h-0 flex-1">
                        <SyntaxPreview
                            content={captured.content}
                            language={language}
                            filePath={captured.path}
                            modelPath={`inmemory://zyra/captured-read/${encodeURIComponent(props.activity.id)}/${encodeURIComponent(fileName)}`}
                            projectPath={props.projectRootPath || undefined}
                            readOnly
                            wordWrap="off"
                            minimapEnabled={false}
                            lineNumberStart={startLine}
                        />
                    </div>
                </div>
            )}
        />
    )
}

export function AssistantTimelineReadAction(props: {
    activity: AssistantActivity
    projectRootPath?: string | null
}) {
    const hydrated = useAssistantHydratedActivity(props.activity)
    const { activityId: previewFor, select: setPreviewFor } = useAssistantReadPreviewSelection()
    const evidence = useMemo(() => getAssistantReadEvidence(hydrated.activity), [hydrated.activity])
    const captured = useMemo(() => getAssistantCapturedRead(hydrated.activity, evidence), [hydrated.activity, evidence])
    const open = () => { setPreviewFor(props.activity.id); void hydrated.hydrate() }
    useEffect(() => {
        if (previewFor !== props.activity.id || hydrated.loaded) return
        return addOverlayEventListener('keydown', (event) => { if (event.key === 'Escape') setPreviewFor(null) })
    }, [previewFor, props.activity.id, hydrated.loaded, setPreviewFor])
    const target = evidence.path
        ? `${getAssistantRelativeFilePath(evidence.path, props.projectRootPath)}${captured?.startLine && captured.endLine ? ` · L${captured.startLine}–${captured.endLine}` : ''}`
        : null
    return (
        <>
            <AssistantTimelineActionShell
                activityId={props.activity.id}
                icon={hydrated.loading ? <Loader2 size={13} className="animate-spin" /> : <AssistantReadFileIcon kind={evidence.kind} />}
                title={getAssistantActionTitle(hydrated.activity, props.projectRootPath)}
                target={target}
                createdAt={props.activity.createdAt}
                elapsed={getActivityElapsed(hydrated.activity)}
                status={getActivityStatus(hydrated.activity)}
                onToggle={evidence.path ? open : undefined}
            />
            {hydrated.error ? <p role="alert" data-assistant-read-load-error={props.activity.id} className="pl-6 text-[10px] text-[color-mix(in_srgb,var(--status-danger)_68%,var(--color-text))]">{hydrated.error}</p> : null}
            {previewFor === props.activity.id && hydrated.loaded ? <AssistantCapturedReadPreview key={props.activity.id} activity={hydrated.activity} projectRootPath={props.projectRootPath} onClose={() => setPreviewFor(null)} /> : null}
        </>
    )
}
