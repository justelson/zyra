export const QUICK_PREVIEW_ROUTE = '/quick-open'

export function buildQuickPreviewRoute(filePath: string): string {
    return `${QUICK_PREVIEW_ROUTE}?file=${encodeURIComponent(filePath)}`
}

export function isQuickPreviewRoute(hash: string): boolean {
    return /^#?\/quick-open(?:\?|$)/.test(hash)
}

export function parseQuickPreviewFilePath(search: string): string | null {
    // URLSearchParams already decodes once. Decoding again changes literal %xx names.
    const path = new URLSearchParams(search).get('file')
    return path && path.trim() && !path.includes('\0') ? path : null
}
