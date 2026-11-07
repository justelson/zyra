import type { ComposerContextFile } from './assistant-composer-types'
import { buildClipboardAttachmentReference, getContextFileMeta } from './assistant-composer-utils'

export type SentAttachmentPreview = { path: string | null; previewDataUrl?: string }
const previews = new Map<string, { at: number; bytes: number; files: Map<string, SentAttachmentPreview> }>()
const MAX_BYTES = 8 * 1024 * 1024
const MAX_MESSAGES = 32
const MAX_AGE_MS = 30 * 60_000
let bytes = 0

function prune(now: number) {
    for (const [id, entry] of previews) {
        if (now - entry.at > MAX_AGE_MS || bytes > MAX_BYTES || previews.size > MAX_MESSAGES) {
            bytes -= entry.bytes
            previews.delete(id)
        }
    }
}

/** Renderer-only handoff. Never written into a prompt, snapshot, queue or analytics. */
export function rememberSentAttachmentPreviews(messageId: string, files: ComposerContextFile[]): void {
    const entries = new Map<string, SentAttachmentPreview>()
    let size = 0
    for (const file of files) {
        if (getContextFileMeta(file).category !== 'image') continue
        const previewDataUrl = file.previewDataUrl?.startsWith('data:image/') && file.previewDataUrl.length * 2 <= MAX_BYTES ? file.previewDataUrl : undefined
        const path = file.path && !file.path.startsWith('clipboard://') ? file.path : null
        const entry = { path, previewDataUrl }
        entries.set(buildClipboardAttachmentReference(file), entry)
        if (file.path) entries.set(file.path, entry)
        size += (previewDataUrl?.length || 0) * 2
    }
    const previous = previews.get(messageId)
    if (previous) { bytes -= previous.bytes; previews.delete(messageId) }
    if (entries.size) { previews.set(messageId, { at: Date.now(), bytes: size, files: entries }); bytes += size }
    prune(Date.now())
}

export function readSentAttachmentPreview(messageId: string, reference: string | null | undefined): SentAttachmentPreview | undefined {
    prune(Date.now())
    return reference ? previews.get(messageId)?.files.get(reference) : undefined
}
