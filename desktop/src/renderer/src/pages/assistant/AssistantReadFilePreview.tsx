import { useEffect, useState } from 'react'
import { File, FileText, Film, Image as ImageIcon, Music4 } from 'lucide-react'
import FilePreviewModal from '@/components/ui/FilePreviewModal'
import ImagePreviewContent from '@/components/ui/file-preview/ImagePreviewContent'
import MediaPreviewContent from '@/components/ui/file-preview/MediaPreviewContent'
import type { AssistantActivity } from '@shared/assistant/contracts'
import { getAssistantReadEvidence } from './assistant-action-presentation'
import { resolveAssistantReadFilePath, type AssistantReadFileKind } from './assistant-read-presentation'
import { getActivityStatus } from './assistant-timeline-helpers'

export function AssistantReadFileIcon({ kind }: { kind: AssistantReadFileKind }) {
    if (kind === 'image') return <ImageIcon size={13} />
    if (kind === 'video') return <Film size={13} />
    if (kind === 'audio') return <Music4 size={13} />
    if (kind === 'text') return <FileText size={13} />
    return <File size={13} />
}

export function AssistantReadFilePreview(props: { activity: AssistantActivity; projectRootPath?: string | null; onClose: () => void }) {
    const evidence = getAssistantReadEvidence(props.activity)
    const filePath = resolveAssistantReadFilePath(evidence.path, props.projectRootPath)
    const [mediaFailed, setMediaFailed] = useState(false)
    const [retry, setRetry] = useState(0)
    useEffect(() => setMediaFailed(false), [filePath, evidence.imageSource])
    const fileName = evidence.path.replace(/\\/g, '/').split('/').pop() || 'File'
    const status = getActivityStatus(props.activity)
    const message = status === 'failed' ? evidence.output || 'The file read failed.'
        : status === 'running' ? 'Reading file…'
            : evidence.kind === 'binary' ? 'No preview available for this file type.'
                : mediaFailed ? `${evidence.kind === 'image' ? 'Image' : evidence.kind === 'video' ? 'Video' : 'Audio'} unavailable. The file may be missing or its format unsupported.` : null
    return (
        <FilePreviewModal
            file={{ name: fileName, path: filePath, type: evidence.kind === 'binary' || evidence.kind === 'text' ? 'text' : evidence.kind }}
            content=""
            projectPath={props.projectRootPath || undefined}
            readOnly active chromeContext="peek" onClose={props.onClose}
            previewBody={message ? (
                <div className="flex h-full min-h-40 flex-col items-center justify-center gap-3 p-6 text-sm text-sparkle-text-muted" data-assistant-read-unavailable="true" role={status === 'failed' || mediaFailed ? 'alert' : 'status'}>
                    <p className="max-w-xl whitespace-pre-wrap break-words">{message}</p>
                    {mediaFailed ? <button type="button" onClick={() => { setMediaFailed(false); setRetry(value => value + 1) }} className="rounded-md border border-[var(--surface-divider)] px-3 py-1.5 text-xs hover:bg-[var(--surface-hover)]">Retry</button> : null}
                </div>
            ) : evidence.kind === 'image' ? (
                <div className="h-full min-h-0" data-assistant-read-media="image" data-assistant-read-source={evidence.imageSource ? 'captured' : 'file'} onErrorCapture={() => setMediaFailed(true)}>
                    <ImagePreviewContent key={retry} filePath={evidence.imageSource || filePath} fileName={fileName} isExpanded />
                </div>
            ) : evidence.kind === 'video' || evidence.kind === 'audio' ? (
                <div className="h-full min-h-0" data-assistant-read-media={evidence.kind} onErrorCapture={() => setMediaFailed(true)}>
                    <MediaPreviewContent key={retry} file={{ name: fileName, path: filePath, type: evidence.kind }} isExpanded />
                </div>
            ) : undefined}
        />
    )
}
