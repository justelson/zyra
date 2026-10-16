import { addOverlayEventListener } from '@/components/ui/native-overlay-portal'
import { useEffect, useState } from 'react'
import { createOverlayPortal as createPortal } from '@/components/ui/native-overlay-portal'
import { Check, Copy, X } from 'lucide-react'
import ImagePreviewContent from '@/components/ui/file-preview/ImagePreviewContent'
import SyntaxPreview from '@/components/ui/file-preview/SyntaxPreview'
import { FileEntryIcon } from '@/components/ui/FileEntryIcon'
import { detectCodeLanguage } from '@/components/ui/file-preview/utils'
import { useSettings } from '@/lib/settings'
import type { ComposerContextFile } from './assistant-composer-types'

type AttachmentMeta = {
    name: string
    ext: string
    category: 'image' | 'code' | 'doc'
}

interface AssistantAttachmentPreviewModalProps {
    file: ComposerContextFile | null
    meta: AttachmentMeta | null
    contentType: string
    sizeLabel: string
    showFormattingWarning: boolean
    readOnly?: boolean
    onUpdatePastedText?: (fileId: string, nextText: string) => void
    onClose: () => void
}

function inferLanguageFromContent(content: string): string {
    const sample = String(content || '').trim().slice(0, 4000)
    if (!sample) return 'text'

    if ((sample.startsWith('{') && sample.endsWith('}')) || (sample.startsWith('[') && sample.endsWith(']'))) {
        try {
            JSON.parse(sample)
            return 'json'
        } catch {
            // fall through
        }
    }

    if (/^\s*#!/m.test(sample) || /\b(echo|fi|done|esac|export)\b/.test(sample)) return 'bash'
    if (/\b(import\s+[\w*{},\s]+\s+from\s+['"]|export\s+(default|const|function|class)\b|interface\s+\w+\s*[{<])/m.test(sample)) return 'typescript'
    if (/\b(function\s+\w+\s*\(|const\s+\w+\s*=|let\s+\w+\s*=|=>)\b/m.test(sample)) return 'javascript'
    if (/\b(def\s+\w+\s*\(|import\s+\w+|from\s+\w+\s+import\s+|if __name__ == ['"]__main__['"])/m.test(sample)) return 'python'
    if (/<[a-z][\s\S]*>/i.test(sample) && /<\/[a-z]+>/i.test(sample)) return 'html'
    if (/[.#][\w-]+\s*\{[\s\S]*\}/m.test(sample)) return 'css'
    if (/^\s*---\s*$[\s\S]*?:\s*.+$/m.test(sample) || /^\s*\w+:\s*.+$/m.test(sample)) return 'yaml'
    if (/^\s*#+\s+.+$/m.test(sample) || /\[[^\]]+\]\([^)]+\)/.test(sample)) return 'markdown'
    if (/\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(sample)) return 'sql'

    return 'text'
}

function resolvePreviewLanguage(file: ComposerContextFile, meta: AttachmentMeta): string {
    const ext = String(meta.ext || '').toLowerCase()
    const mime = String(file.mimeType || '').toLowerCase()

    if (mime.includes('json') || ext === 'json') return 'json'
    if (mime.includes('markdown') || ext === 'md' || ext === 'mdx') return 'markdown'
    if (mime.includes('xml') || ext === 'xml') return 'xml'
    if (mime.includes('yaml') || ext === 'yml' || ext === 'yaml') return 'yaml'
    if (mime.includes('csv') || ext === 'csv') return 'csv'

    if (meta.category === 'code') {
        const detected = detectCodeLanguage(ext, meta.name)
        return detected || ext || inferLanguageFromContent(file.content || '')
    }

    const detectedFromExt = detectCodeLanguage(ext, meta.name)
    if (detectedFromExt) return detectedFromExt
    return inferLanguageFromContent(file.content || '')
}

export default function AssistantAttachmentPreviewModal({
    file,
    meta,
    contentType,
    sizeLabel,
    showFormattingWarning,
    readOnly = false,
    onUpdatePastedText,
    onClose
}: AssistantAttachmentPreviewModalProps) {
    const { settings } = useSettings()
    const iconTheme = settings.appearanceResolvedMode
    const [copied, setCopied] = useState(false)

    useEffect(() => {
        if (!file) return

        const onEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose()
        }

        const originalOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        const removeOverlayListener1 = addOverlayEventListener('keydown', onEscape)

        return () => {
            removeOverlayListener1()
            document.body.style.overflow = originalOverflow
        }
    }, [file, onClose])

    if (!file || !meta) return null

    const previewText = String(file.content || file.previewText || '')
    const previewLanguage = resolvePreviewLanguage(file, meta)
    const isPastedTextPreview = file.source === 'paste' && Boolean(file.content)
    const isImagePreview = meta.category === 'image'
    const shouldShowFormattingWarning = showFormattingWarning && !isPastedTextPreview
    const copyValue = isPastedTextPreview ? previewText : (file.path || previewText || meta.name)
    const copyTitle = isPastedTextPreview ? 'Copy pasted text' : `Copy path: ${file.path || meta.name}`
    const attachmentDetails = [contentType, meta.ext || 'file', sizeLabel].filter(Boolean).join(' • ')

    const handleCopyPreviewValue = () => {
        if (!copyValue) return
        void navigator.clipboard.writeText(copyValue).then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1500)
        })
    }

    const modal = (
        <div
            className="pointer-events-auto fixed inset-0 z-[2147482000] flex items-center justify-center bg-black/70 backdrop-blur-md"
            onClick={onClose}
            onWheel={(event) => event.stopPropagation()}
            style={{ animation: 'fadeIn 0.15s ease-out' }}
        >
            <div
                className={
                    isImagePreview
                        ? 'pointer-events-auto m-4 flex h-[min(82vh,840px)] w-[min(88vw,1180px)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-sparkle-card shadow-2xl'
                        : 'pointer-events-auto m-4 flex h-[min(920px,90vh)] w-[min(1400px,95vw)] max-h-[90vh] max-w-[1400px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-sparkle-card shadow-2xl'
                }
                onClick={(event) => event.stopPropagation()}
                onWheel={(event) => event.stopPropagation()}
                style={{ animation: 'scaleIn 0.15s ease-out' }}
            >
                <div className="flex shrink-0 items-stretch justify-between gap-2 border-b border-white/5 bg-white/[0.02] py-1 pl-3.5 pr-0">
                    <div className="flex min-w-0 items-center gap-2">
                        <FileEntryIcon
                            pathValue={file.path || meta.name}
                            kind="file"
                            theme={iconTheme}
                            className="size-4 shrink-0"
                        />
                        <div className="flex min-w-0 items-center gap-1.5">
                            <h3
                                className="truncate text-[13px] font-semibold text-white"
                                title={attachmentDetails ? `${meta.name} (${attachmentDetails})` : meta.name}
                            >
                                {meta.name}
                            </h3>
                            <button
                                type="button"
                                onClick={handleCopyPreviewValue}
                                className={
                                    copied
                                        ? 'shrink-0 rounded p-1 text-emerald-400 bg-emerald-400/10 transition-colors'
                                        : 'shrink-0 rounded p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white'
                                }
                                title={copied ? 'Copied!' : copyTitle}
                                disabled={!copyValue}
                            >
                                {copied ? <Check size={14} /> : <Copy size={14} />}
                            </button>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="inline-flex -my-1 shrink-0 items-center justify-center self-stretch border-l border-white/5 px-3.5 text-white/42 transition-colors hover:border-red-400/25 hover:bg-red-500/[0.22] hover:text-red-100"
                        title="Close preview"
                    >
                        <X size={16} />
                    </button>
                </div>

                <div
                    className={isImagePreview ? 'min-h-0 flex-1 overflow-hidden bg-black/35 p-0' : 'min-h-0 flex-1 overflow-hidden bg-sparkle-bg p-4'}
                    style={{ overscrollBehavior: 'contain' }}
                >
                    {isImagePreview ? (
                        <ImagePreviewContent
                            filePath={(!file.path || file.path.startsWith('clipboard://')) && file.previewDataUrl?.startsWith('data:image/') ? file.previewDataUrl : file.path}
                            fileName={meta.name}
                            isExpanded
                        />
                    ) : isPastedTextPreview ? (
                        <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-white/5 bg-sparkle-card">
                            <textarea
                                value={previewText}
                                onChange={(event) => {
                                    if (readOnly || !file?.id || !onUpdatePastedText) return
                                    onUpdatePastedText(file.id, event.target.value)
                                }}
                                readOnly={readOnly}
                                spellCheck={false}
                                className="custom-scrollbar min-h-0 w-full flex-1 resize-none overflow-auto bg-transparent px-4 py-4 text-[13px] leading-6 text-sparkle-text outline-none selection:bg-sky-400/25"
                            />
                        </div>
                    ) : previewText ? (
                        <div className="h-full w-full overflow-hidden rounded-xl border border-white/5 bg-sparkle-card">
                            <SyntaxPreview
                                content={previewText}
                                language={previewLanguage}
                                filePath={file.path || meta.name}
                            />
                        </div>
                    ) : (
                        <div className="rounded-lg border border-white/10 bg-sparkle-card p-3 text-xs text-sparkle-text-muted">
                            No inline preview for this attachment.
                        </div>
                    )}

                    {shouldShowFormattingWarning && (
                        <div className="mt-3 rounded-md border border-amber-400/30 bg-amber-500/10 p-2 text-[11px] text-amber-300/90">
                            Text might have not been properly formatted.
                        </div>
                    )}
                </div>
            </div>
        </div>
    )

    return createPortal(modal, document.body)
}
