import type { AssistantResource, AssistantResourceSource } from './assistant-resource-index'

export function assistantImageDisplayName(name: string, turnNumber: number, source: AssistantResourceSource, position = 1): string {
    const visibleName = String(name || '').trim()
    const internal = !visibleName
        || /^(?:[a-f\d]{16,}(?:-\d+)?|codex-clipboard-[\w-]+)\.[\w]+$/i.test(visibleName)
        || /^(?:image(?:\s*#?\d+)?|pasted image|clipboard image)(?:\.[\w]+)?$/i.test(visibleName)
    if (!internal) return visibleName
    const kind = source === 'attached' ? 'Attachment' : source === 'generated' ? 'Generated image' : 'Image'
    return `Turn ${turnNumber} · ${kind} ${position}`
}

function normalizedPath(value: string): string {
    const normalized = String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/, '')
    if (/^https?:\/\//i.test(normalized)) {
        try { const url = new URL(normalized); url.hash = ''; return url.toString() } catch { return normalized }
    }
    return /^[a-z]:\//i.test(normalized) || normalized.startsWith('//') ? normalized.toLowerCase() : normalized
}

export function assistantResourceForPath(resources: readonly AssistantResource[], filePath: string): AssistantResource | undefined {
    const target = normalizedPath(filePath)
    if (!target) return undefined
    return resources.find(resource => [resource.path, resource.attachment?.path, resource.kind === 'image' ? resource.url : null].some(path => path && normalizedPath(path) === target))
}

export function assistantResourceCaption(resource: AssistantResource): string {
    if (resource.kind !== 'image') return resource.url || resource.subtitle
    const format = (resource.attachment?.mime?.split('/')[1] || (resource.path || resource.url || '').split(/[?#]/)[0].match(/\.([a-z\d]+)$/i)?.[1] || 'image').toUpperCase()
    const source = resource.sources.includes('attached') ? 'Attached' : resource.sources.includes('generated') ? 'Generated' : resource.sources.includes('changed') ? 'Updated' : 'Shared'
    return `${format} · ${source}`
}
