import { useState } from 'react'
import { FileText, Loader2 } from 'lucide-react'
import type { AssistantActivity } from '@shared/assistant/contracts'
import FilePreviewModal from '@/components/ui/FilePreviewModal'
import SyntaxPreview from '@/components/ui/file-preview/SyntaxPreview'
import { detectCodeLanguage } from '@/components/ui/file-preview/utils'
import { AssistantTimelineActionShell, formatAssistantActionTime } from './AssistantTimelineActionShell'
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
    const normalizedPath = captured.path.replace(/\\/g, '/')
    const fileName = normalizedPath.split('/').pop() || normalizedPath
    const startLine = captured.startLine || 1
    const lineCount = captured.content.replace(/\n$/, '').split('\n').length
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
            {hydrated.error ? <p className="pl-6 text-[10px] text-[color-mix(in_srgb,var(--status-danger)_68%,var(--color-text))]">{hydrated.error}</p> : null}
            {previewActivity ? <AssistantCapturedReadPreview activity={previewActivity} projectRootPath={props.projectRootPath} onClose={() => setPreviewActivity(null)} /> : null}
        </>
    )
}
