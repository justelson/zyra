import type { PreviewOpenOptions } from '../file-preview/types'

type MarkdownPathTarget = {
    path: string
    anchor?: string
    focusLine?: number
}

type MarkdownLinkNavigationOptions = {
    href: string
    filePath?: string
    navigate?: (to: string) => void
    openPreview?: (
        file: { name: string; path: string },
        ext: string,
        options?: PreviewOpenOptions
    ) => Promise<void>
}

function normalizePath(pathValue: string): string {
    return pathValue.replace(/\\/g, '/')
}

function safeDecode(value: string): string {
    try {
        return decodeURIComponent(value)
    } catch {
        return value
    }
}

function denormalizePath(pathValue: string, sourcePath?: string): string {
    if (sourcePath?.includes('\\')) {
        return pathValue.replace(/\//g, '\\')
    }
    return pathValue
}

const SCHEMELESS_WEB_HOST_PATTERN = /^(?:www\.)?(?:[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\.)+(?:com|org|net|edu|gov|io|dev|app|ai|co|me|info|biz|xyz|tech|cloud|site|online)(?::\d{1,5})?(?:[/?#]|$)/i
const LOOPBACK_WEB_HOST_PATTERN = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d{1,5})?(?:[/?#]|$)/i

export function normalizeMarkdownHref(href: string | undefined): string {
    const rawHref = String(href || '').trim()
    if (SCHEMELESS_WEB_HOST_PATTERN.test(rawHref)) return `https://${rawHref}`
    if (LOOPBACK_WEB_HOST_PATTERN.test(rawHref)) return `http://${rawHref}`
    return rawHref
}

function isExternalHref(href: string): boolean {
    return normalizeMarkdownHref(href) !== href || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)
}

export function isWindowsPathHref(pathValue: string | undefined): boolean {
    const rawValue = String(pathValue || '').trim()
    if (!rawValue) return false
    const decodedValue = safeDecode(rawValue)
    return /^[a-zA-Z]:[\\/]/.test(decodedValue) || decodedValue.startsWith('\\\\')
}

function splitHrefAnchor(href: string): { pathname: string; anchor?: string } {
    const hashIndex = href.indexOf('#')
    if (hashIndex < 0) return { pathname: href }
    return {
        pathname: href.slice(0, hashIndex),
        anchor: href.slice(hashIndex + 1) || undefined
    }
}

function toPositiveInteger(value: string | undefined): number | undefined {
    if (!value) return undefined
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function extractPathLineReference(pathname: string): { pathname: string; focusLine?: number } {
    const match = pathname.match(/^(.*?)(?::(\d+))(?:\:(\d+))?$/)
    if (!match) return { pathname }
    const basePath = match[1]
    if (!basePath || /^[a-zA-Z]$/.test(basePath)) return { pathname }
    return {
        pathname: basePath,
        focusLine: toPositiveInteger(match[2])
    }
}

function extractAnchorLineReference(anchor?: string): { anchor?: string; focusLine?: number } {
    const normalizedAnchor = String(anchor || '').trim()
    if (!normalizedAnchor) return { anchor: undefined }

    const gitHubStyleMatch = normalizedAnchor.match(/^L(\d+)(?:C(\d+))?$/i)
    if (gitHubStyleMatch) {
        return {
            anchor: normalizedAnchor,
            focusLine: toPositiveInteger(gitHubStyleMatch[1])
        }
    }

    const plainMatch = normalizedAnchor.match(/^(\d+)(?:\:(\d+))?$/)
    if (plainMatch) {
        return {
            anchor: normalizedAnchor,
            focusLine: toPositiveInteger(plainMatch[1])
        }
    }

    return { anchor: normalizedAnchor }
}

function toFileUrlPath(pathname: string): string | null {
    try {
        const url = new URL(pathname)
        if (url.protocol !== 'file:') return null
        const decodedPath = decodeURIComponent(url.pathname || '')
        if (/^\/[a-zA-Z]:\//.test(decodedPath)) {
            return decodedPath.slice(1)
        }
        return decodedPath
    } catch {
        return null
    }
}

export function rewriteMarkdownFileUriHref(href: string | undefined): string | null {
    const rawHref = String(href || '').trim()
    if (!rawHref.toLowerCase().startsWith('file:')) return null

    try {
        const url = new URL(rawHref)
        if (url.protocol.toLowerCase() !== 'file:') return null
        const pathname = /^\/[a-zA-Z]:[\\/]/.test(url.pathname) ? url.pathname.slice(1) : url.pathname
        if (!pathname) return null
        return `${pathname}${url.hash || ''}`
    } catch {
        return null
    }
}

export function resolveMarkdownLinkTarget(href: string, filePath?: string): MarkdownPathTarget | null {
    const rawHref = String(href || '').trim()
    if (
        !rawHref
        || rawHref.startsWith('#')
        || (isExternalHref(rawHref) && !rawHref.toLowerCase().startsWith('file://') && !isWindowsPathHref(rawHref))
    ) {
        return null
    }

    const { pathname, anchor } = splitHrefAnchor(rawHref)
    const anchorReference = extractAnchorLineReference(anchor)
    let decodedPathname = pathname
    decodedPathname = pathname ? safeDecode(pathname) : ''
    const pathReference = extractPathLineReference(decodedPathname)
    decodedPathname = pathReference.pathname

    if (rawHref.toLowerCase().startsWith('file://')) {
        const resolvedFilePath = toFileUrlPath(decodedPathname)
        if (!resolvedFilePath) return null
        return {
            path: denormalizePath(normalizePath(resolvedFilePath), filePath),
            anchor: anchorReference.anchor,
            focusLine: pathReference.focusLine ?? anchorReference.focusLine
        }
    }

    const normalizedSourcePath = filePath ? normalizePath(filePath) : ''
    const lastSlashIndex = normalizedSourcePath.lastIndexOf('/')
    const sourceDirectory = lastSlashIndex >= 0 ? normalizedSourcePath.slice(0, lastSlashIndex) : normalizedSourcePath

    let normalizedTargetPath = ''
    if (isWindowsPathHref(decodedPathname)) {
        normalizedTargetPath = normalizePath(decodedPathname)
    } else if (!filePath && !decodedPathname.startsWith('/')) {
        return null
    } else if (decodedPathname.startsWith('/')) {
        const driveMatch = /^[a-zA-Z]:\//.exec(normalizedSourcePath)
        normalizedTargetPath = driveMatch ? `${driveMatch[0]}${decodedPathname.slice(1)}` : decodedPathname
    } else {
        const sourceParts = sourceDirectory.split('/')
        const minSegments = sourceParts[0]?.endsWith(':') ? 1 : 0
        for (const segment of normalizePath(decodedPathname).split('/')) {
            if (!segment || segment === '.') continue
            if (segment === '..') {
                if (sourceParts.length > minSegments) sourceParts.pop()
                continue
            }
            sourceParts.push(segment)
        }
        normalizedTargetPath = sourceParts.join('/')
    }

    if (!normalizedTargetPath) return null

    return {
        path: denormalizePath(normalizedTargetPath, filePath),
        anchor: anchorReference.anchor,
        focusLine: pathReference.focusLine ?? anchorReference.focusLine
    }
}

function splitFileNameAndExtension(targetPath: string): { name: string; extension: string } {
    const normalizedPath = normalizePath(targetPath)
    const name = normalizedPath.split('/').pop() || targetPath
    const dotIndex = name.lastIndexOf('.')
    if (dotIndex <= 0 || dotIndex === name.length - 1) {
        return { name, extension: '' }
    }
    return {
        name,
        extension: name.slice(dotIndex + 1).toLowerCase()
    }
}

export async function navigateMarkdownLink({
    href,
    filePath,
    navigate,
    openPreview
}: MarkdownLinkNavigationOptions): Promise<boolean> {
    const target = resolveMarkdownLinkTarget(href, filePath)
    if (!target) return false

    const pathInfo = await window.devscope.getPathInfo(target.path)
    if (!pathInfo.success || !pathInfo.exists) {
        return false
    }

    if (pathInfo.type === 'directory') {
        if (openPreview) {
            const { name } = splitFileNameAndExtension(pathInfo.path)
            await openPreview({ name, path: pathInfo.path }, '', {
                targetKind: 'directory',
                openNavigator: true,
                revealNavigatorTarget: true
            })
            return true
        }
        if (navigate) {
            navigate(`/folder-browse/${encodeURIComponent(pathInfo.path)}`)
            return true
        }
        const explorerResult = await window.devscope.openInExplorer(pathInfo.path)
        return Boolean(explorerResult?.success)
    }

    const { extension, name } = splitFileNameAndExtension(pathInfo.path)
    if (openPreview) {
        await openPreview({ name, path: pathInfo.path }, extension, {
            targetKind: 'file',
            openNavigator: true,
            revealNavigatorTarget: true,
            focusLine: target.focusLine
        })
        return true
    }

    const openResult = await window.devscope.openFile(pathInfo.path)
    return Boolean(openResult?.success)
}
