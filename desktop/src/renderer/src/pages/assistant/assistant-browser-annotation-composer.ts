import type {
    DevScopeBrowserAnnotationPayload,
    DevScopeBrowserCaptureArtifact
} from '@shared/contracts/devscope-api'

const CONTENT_PREFIX = 'Zyra Browser annotation:\n'
const listeners = new Map<string, Set<(attachment: AssistantBrowserAnnotationAttachment) => void>>()
const pending = new Map<string, AssistantBrowserAnnotationAttachment[]>()

export type AssistantBrowserAnnotationAttachment = {
    sessionId: string
    reference: string
    annotation?: DevScopeBrowserAnnotationPayload
    text?: string
    artifact: DevScopeBrowserCaptureArtifact
}

export function publishAssistantBrowserAnnotationAttachment(attachment: AssistantBrowserAnnotationAttachment): void {
    const sessionListeners = listeners.get(attachment.sessionId)
    if (sessionListeners?.size) {
        for (const listener of sessionListeners) listener(attachment)
        return
    }
    const queued = pending.get(attachment.sessionId) || []
    if (queued.length >= 16) throw new Error('Open this chat before attaching more captures.')
    pending.set(attachment.sessionId, [...queued, attachment])
}

export function subscribeAssistantBrowserAnnotationAttachments(
    sessionId: string,
    listener: (attachment: AssistantBrowserAnnotationAttachment) => void
): () => void {
    const sessionListeners = listeners.get(sessionId) || new Set()
    sessionListeners.add(listener)
    listeners.set(sessionId, sessionListeners)
    const queued = pending.get(sessionId) || []
    pending.delete(sessionId)
    for (const attachment of queued) listener(attachment)
    return () => {
        sessionListeners.delete(listener)
        if (sessionListeners.size === 0) listeners.delete(sessionId)
    }
}

export function serializeAssistantBrowserAnnotation(annotation: DevScopeBrowserAnnotationPayload): string {
    const compact: DevScopeBrowserAnnotationPayload = {
        ...annotation,
        comment: annotation.comment.slice(0, 1_000),
        elements: annotation.elements.slice(0, 40).map((element) => ({
            ...element,
            selector: element.selector.slice(0, 240),
            attributes: {}
        })),
        regions: annotation.regions.slice(0, 64),
        strokes: annotation.strokes.slice(0, 64).map((stroke) => ({
            ...stroke,
            points: stroke.points.length <= 32
                ? stroke.points
                : Array.from({ length: 32 }, (_, index) => stroke.points[Math.round(index * (stroke.points.length - 1) / 31)])
        })),
        styleChanges: annotation.styleChanges.slice(0, 32)
    }
    return `${CONTENT_PREFIX}${JSON.stringify(compact)}`
}

export function parseAssistantBrowserAnnotation(content: string | null | undefined): DevScopeBrowserAnnotationPayload | null {
    const normalized = String(content || '')
    if (!normalized.startsWith(CONTENT_PREFIX)) return null
    try {
        const value = JSON.parse(normalized.slice(CONTENT_PREFIX.length)) as DevScopeBrowserAnnotationPayload
        if (!value || typeof value !== 'object' || typeof value.id !== 'string') return null
        if (!Array.isArray(value.elements) || !Array.isArray(value.regions) || !Array.isArray(value.strokes)) return null
        return value
    } catch {
        return null
    }
}

export function buildAssistantBrowserAnnotationPrompt(annotation: DevScopeBrowserAnnotationPayload): string {
    const lines = ['<preview_annotation>', 'Preview annotation:', `Id: ${annotation.id}`]
    lines.push(`Page: ${annotation.title?.trim() || annotation.url?.trim() || 'Preview'}`)
    if (annotation.comment.trim()) lines.push(`Comment: ${annotation.comment.trim()}`)
    const targets: string[] = []
    if (annotation.elements.length > 0) targets.push(`${annotation.elements.length} selected element${annotation.elements.length === 1 ? '' : 's'}`)
    if (annotation.regions.length > 0) targets.push(`${annotation.regions.length} marked region${annotation.regions.length === 1 ? '' : 's'}`)
    if (annotation.strokes.length > 0) targets.push(`${annotation.strokes.length} drawing${annotation.strokes.length === 1 ? '' : 's'}`)
    if (targets.length > 0) lines.push(`Targets: ${targets.join(', ')}.`)
    for (const element of annotation.elements) {
        lines.push(`Element: ${element.selector}${element.tagName ? ` (${element.tagName})` : ''}`)
    }
    lines.push('The attached image is the annotated Browser crop.', '</preview_annotation>')
    return lines.join('\n')
}
