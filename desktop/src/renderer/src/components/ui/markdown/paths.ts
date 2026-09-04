import { projectLocalFileUrl } from '@/lib/browser-file-url'

function getFileUrl(path: string): string {
    if (path.startsWith('http') || path.startsWith('data:')) return path
    if (path.startsWith('zyra://') || path.startsWith('devscope://') || path.startsWith('file://')) {
        return projectLocalFileUrl(path)
    }

    const normalizedPath = path.replace(/\\/g, '/')
    const isUncPath = normalizedPath.startsWith('//')
    const trimmed = isUncPath
        ? normalizedPath.slice(2)
        : normalizedPath.startsWith('/') ? normalizedPath.slice(1) : normalizedPath
    const encodedPath = encodeURI(trimmed).replace(/#/g, '%23').replace(/\?/g, '%3F')

    return projectLocalFileUrl(isUncPath ? `zyra://${encodedPath}` : `zyra:///${encodedPath}`)
}

export function resolveImageSrc(src: string, filePath?: string): string {
    if (!src || src.startsWith('http') || src.startsWith('data:')) return src
    if (src.startsWith('file:') || src.startsWith('zyra:') || src.startsWith('devscope:')) {
        return projectLocalFileUrl(src)
    }

    // Markdown destinations are URL-encoded. Decode once before getFileUrl
    // encodes the filesystem path, otherwise a space becomes literal "%20".
    let localPath = src
    try {
        localPath = decodeURIComponent(src)
    } catch {
        // Keep malformed escapes as literal filename characters.
    }
    if (localPath.match(/^[a-zA-Z]:[\\/]/) || localPath.startsWith('/')) {
        return getFileUrl(localPath)
    }
    if (!filePath) return src

    const normalizePath = (path: string) => path.replace(/\\/g, '/')
    const normalizedFilePath = normalizePath(filePath)
    const fileDir = normalizedFilePath.substring(0, normalizedFilePath.lastIndexOf('/'))
    const parts = fileDir.split('/')
    const srcParts = normalizePath(localPath).split('/')

    for (const part of srcParts) {
        if (part === '.') continue
        if (part === '..') {
            parts.pop()
        } else {
            parts.push(part)
        }
    }

    return getFileUrl(parts.join('/'))
}

export function resolveImageSrcSet(srcSet: string, filePath?: string): string {
    const raw = String(srcSet || '').trim()
    if (!raw) return raw

    return raw
        .split(',')
        .map((candidate) => {
            const trimmed = candidate.trim()
            if (!trimmed) return trimmed

            const firstWhitespace = trimmed.search(/\s/)
            if (firstWhitespace < 0) {
                return resolveImageSrc(trimmed, filePath)
            }

            const src = trimmed.slice(0, firstWhitespace)
            const descriptor = trimmed.slice(firstWhitespace).trim()
            const resolvedSrc = resolveImageSrc(src, filePath)
            return descriptor ? `${resolvedSrc} ${descriptor}` : resolvedSrc
        })
        .join(', ')
}
