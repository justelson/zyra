import { app } from 'electron'
import { access, copyFile, mkdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

type PersistedAttachmentSource = 'paste' | 'manual'

function sanitizeFileName(value: string, source: PersistedAttachmentSource): string {
    const trimmed = String(value || '').trim()
    const fallback = `${source === 'paste' ? 'clipboard' : 'attached'}-image-${Date.now()}.png`
    if (!trimmed) return fallback
    const normalized = trimmed.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    return normalized || fallback
}

const MAX_CLIPBOARD_ATTACHMENT_BYTES = 64 * 1024 * 1024

function decodeDataUrl(dataUrl: string): Buffer {
    const value = String(dataUrl || '')
    // Bound the encoded payload before regex matching or allocating decoded data.
    if (value.length > Math.ceil(MAX_CLIPBOARD_ATTACHMENT_BYTES / 3) * 4 + 256) {
        throw new Error('Clipboard attachment exceeds the 64 MB limit.')
    }
    const match = value.match(/^data:([^;,]+)?;base64,([a-z0-9+/]+={0,2})$/i)
    if (!match || match[2].length % 4 !== 0) {
        throw new Error('Invalid clipboard attachment payload.')
    }
    const bytes = Buffer.from(match[2], 'base64')
    if (!bytes.length || bytes.length > MAX_CLIPBOARD_ATTACHMENT_BYTES) {
        throw new Error('Clipboard attachment must be between 1 byte and 64 MB.')
    }
    return bytes
}

export async function persistAssistantClipboardImage(input: {
    dataUrl: string
    fileName?: string
    source?: PersistedAttachmentSource
}): Promise<string> {
    const source = input.source === 'manual' ? 'manual' : 'paste'
    const bytes = decodeDataUrl(input.dataUrl)
    const assistantDir = getAssistantAttachmentsDir(source)
    await mkdir(assistantDir, { recursive: true })

    const fileName = sanitizeFileName(input.fileName || '', source)
    const storagePath = join(assistantDir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${fileName}`)
    await writeFile(storagePath, bytes)
    return storagePath
}

export async function stageAssistantClipboardImageFile(input: {
    sourcePath: string
    fileName?: string
}): Promise<string> {
    const assistantDir = getAssistantClipboardAttachmentsDir()
    await mkdir(assistantDir, { recursive: true })
    const fileName = sanitizeFileName(input.fileName || '', 'paste')
    const storagePath = join(assistantDir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${fileName}`)
    await copyFile(input.sourcePath, storagePath)
    return `clipboard://${basename(storagePath)}`
}

function getAssistantClipboardAttachmentsDir(): string {
    return getAssistantAttachmentsDir('paste')
}

function getAssistantAttachmentsDir(source: PersistedAttachmentSource): string {
    return join(app.getPath('userData'), 'assistant', 'attachments', source === 'paste' ? 'clipboard' : 'files')
}

function parseClipboardAttachmentReference(reference: string): string | null {
    const normalized = String(reference || '').trim()
    if (!normalized.toLowerCase().startsWith('clipboard://')) return null
    const tail = normalized.slice('clipboard://'.length).trim().replace(/^[/\\]+/, '')
    if (!tail || tail === '.' || tail === '..' || /[/\\\x00-\x1f]/.test(tail)) return null
    return tail
}

export async function resolveAssistantClipboardAttachment(reference: string): Promise<string | null> {
    const fileName = parseClipboardAttachmentReference(reference)
    if (!fileName) return null

    const resolvedPath = join(getAssistantClipboardAttachmentsDir(), fileName)
    try {
        await access(resolvedPath)
        return resolvedPath
    } catch {
        return null
    }
}
