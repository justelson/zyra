import { resolvePreviewType } from '@/components/ui/file-preview/utils'
import { resolveMarkdownLinkTarget } from '@/components/ui/markdown/linkNavigation'
import { getAssistantLinkBaseFilePath } from './assistant-file-navigation'

export type AssistantReadFileKind = 'text' | 'image' | 'video' | 'audio' | 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'binary'

const BINARY_EXTENSIONS = new Set(['zip', '7z', 'rar', 'gz', 'tar', 'bz2', 'xz', 'exe', 'dll', 'msi', 'bin', 'dat', 'wasm', 'woff', 'woff2', 'ttf', 'otf', 'sqlite', 'sqlite3', 'db', 'iso', 'dmg', 'pyc', 'class', 'jar'])
const EXTRA_IMAGE_EXTENSIONS = new Set(['apng', 'jfif', 'tif', 'tiff', 'heic', 'heif', 'jxl'])
const EXTRA_VIDEO_EXTENSIONS = new Set(['mpg', 'mpeg', 'ogv', '3gp', '3g2', 'mts', 'm2ts', 'wmv'])
const IMAGE_MIME = /^image\/(?:png|jpe?g|gif|webp|bmp|avif|x-icon|vnd\.microsoft\.icon|tiff|svg\+xml)$/i
const MAX_CAPTURED_IMAGE_CHARACTERS = 20 * 1024 * 1024

export function resolveAssistantReadFilePath(path: string, projectRootPath?: string | null): string {
    if (!projectRootPath || /^(?:[a-z]:[\\/]|[/\\]|[a-z][a-z0-9+.-]*:|~[\\/])/i.test(path)) return path
    const href = encodeURI(path.replace(/\\/g, '/')).replace(/#/g, '%23').replace(/\?/g, '%3F')
    return resolveMarkdownLinkTarget(href, getAssistantLinkBaseFilePath(projectRootPath))?.path || path
}

function record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/** Only recorded image bytes are usable as inline sources. Tool-returned URLs never initiate remote loads. */
export function getAssistantCapturedImageSource(result: unknown): string | null {
    const content = record(result)?.content
    if (!Array.isArray(content)) return null
    for (const item of content) {
        const image = record(item)
        if (image?.type !== 'image') continue
        const mime = typeof image.mimeType === 'string' ? image.mimeType : image.mime_type
        const data = image.data
        if (typeof mime !== 'string' || !IMAGE_MIME.test(mime) || typeof data !== 'string' || !data || data.length > MAX_CAPTURED_IMAGE_CHARACTERS) continue
        const base64 = data.replace(/\s/g, '')
        if (base64.length % 4 === 1 || !/^[a-zA-Z0-9+/]+={0,2}$/.test(base64)) continue
        return `data:${mime.toLowerCase()};base64,${base64}`
    }
    return null
}

export function getAssistantCapturedImagePath(attachments: unknown): string | null {
    if (!Array.isArray(attachments)) return null
    for (const attachment of attachments) {
        const path = typeof attachment === 'string' ? attachment.match(/^path:\s*(.+)$/im)?.[1]?.trim() : record(attachment)?.path
        if (typeof path === 'string' && /^(?:[a-z]:[\\/]|[/\\]|(?:zyra|devscope|file):\/\/)/i.test(path)) return path
    }
    return null
}

export function getAssistantReadFilePresentation(input: {
    path: string
    output?: string
    result?: unknown
    partialResult?: unknown
    readIsImage?: unknown
    imageAttachments?: unknown
    historyImageCount?: unknown
}): { kind: AssistantReadFileKind; imageSource: string | null } {
    const imageSource = getAssistantCapturedImageSource(input.result) || getAssistantCapturedImageSource(input.partialResult) || getAssistantCapturedImagePath(input.imageAttachments)
    const resultContent = record(input.result)?.content
    const hasImage = Array.isArray(resultContent) && resultContent.some(item => record(item)?.type === 'image')
    if (imageSource || input.readIsImage === true || typeof input.historyImageCount === 'number' && input.historyImageCount > 0 || hasImage || /^Read image file \[image\//i.test(String(input.output || '').trim())) {
        return { kind: 'image', imageSource }
    }
    const name = input.path.replace(/\\/g, '/').split('/').pop() || input.path
    const extension = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
    if (EXTRA_IMAGE_EXTENSIONS.has(extension)) return { kind: 'image', imageSource: null }
    if (EXTRA_VIDEO_EXTENSIONS.has(extension)) return { kind: 'video', imageSource: null }
    const type = resolvePreviewType(name, extension)?.type
    if (type && ['image', 'video', 'audio', 'pdf', 'docx', 'xlsx', 'pptx'].includes(type)) {
        return { kind: type as AssistantReadFileKind, imageSource: null }
    }
    // Unknown but printable source remains readable. Never put binary bytes in Monaco.
    const binary = BINARY_EXTENSIONS.has(extension) || (input.output || '').includes('\u0000') || (!type && /[\u0001-\u0008\u000e-\u001f]/.test(input.output || ''))
    return { kind: binary ? 'binary' : 'text', imageSource: null }
}
