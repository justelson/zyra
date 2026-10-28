// Clipboard payloads can expose the same files through both items and files.
// Resolve real Files before taking over paste, so null file items preserve text.
export function getAssistantClipboardFiles(clipboard: Pick<DataTransfer, 'items' | 'files'>): File[] {
    const fromItems = Array.from(clipboard.items || []).flatMap(item => {
        if (item.kind !== 'file') return []
        const file = item.getAsFile()
        return file ? [file] : []
    })
    // FileList is authoritative when present, including Windows pastes whose
    // item list is incomplete. Item-only clipboard images still work as fallback.
    const fromFiles = Array.from(clipboard.files || [])
    const files = fromFiles.length ? fromFiles : fromItems
    return [...new Set(files)]
}

const VIDEO_MIME_BY_EXTENSION: Record<string, string> = {
    mp4: 'video/mp4', m4v: 'video/x-m4v', mov: 'video/quicktime', webm: 'video/webm',
    mkv: 'video/x-matroska', avi: 'video/x-msvideo', mpg: 'video/mpeg', mpeg: 'video/mpeg',
    ogv: 'video/ogg', '3gp': 'video/3gpp', '3g2': 'video/3gpp2', ts: 'video/mp2t', mts: 'video/mp2t',
    m2ts: 'video/mp2t', wmv: 'video/x-ms-wmv'
}
export const MAX_CLIPBOARD_VIDEO_BYTES = 64 * 1024 * 1024

export function getAssistantVideoMimeType(name: string, declaredMimeType?: string): string | null {
    const mime = String(declaredMimeType || '').split(';')[0].trim().toLowerCase()
    if (mime.startsWith('video/')) return mime
    // A known conflicting MIME must retain its existing classification. In
    // particular .ts source files with text MIME are not transport-stream video.
    if (mime && mime !== 'application/octet-stream') return null
    const ext = name.split('.').pop()?.toLowerCase() || ''
    // .ts is ambiguous without a declared video MIME; preserve source files.
    return ext === 'ts' ? null : VIDEO_MIME_BY_EXTENSION[ext] || null
}
