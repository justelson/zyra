import type { VisualizationResource } from '@shared/visualization-resources'
import { IMAGE_EXTENSIONS } from '@/components/ui/file-preview/constants'
import { resolveMarkdownPackageReference, looksLikeMarkdownFileReference } from '@/components/ui/markdown/fileReferences'
import { resolveMarkdownLinkTarget } from '@/components/ui/markdown/linkNavigation'
import type { ParsedUserAttachment } from './assistant-timeline-helpers'
import type { AssistantDiffTarget, AssistantDiffTurn } from './assistant-diff-types'
import { getAssistantLinkBaseFilePath, getAssistantRelativeFilePath } from './assistant-file-navigation'
import { assistantImageDisplayName } from './assistant-resource-labels'

export type AssistantResourceKind = 'image' | 'link' | 'visualization'
export type AssistantResourceSource = 'changed' | 'generated' | 'attached' | 'mentioned'
export type AssistantResourceOriginKind = 'change' | 'prompt' | 'response' | 'attachment'

export type AssistantResourceOrigin = {
    key: string
    turnId: string
    turnNumber: number
    createdAt: string
    kind: AssistantResourceOriginKind
}

export type AssistantResource = {
    id: string
    kind: AssistantResourceKind
    title: string
    subtitle: string
    path: string | null
    url: string | null
    attachment: ParsedUserAttachment | null
    sources: AssistantResourceSource[]
    origins: AssistantResourceOrigin[]
    occurrenceCount: number
    latestAt: string
    latestTurnId: string
    latestTurnNumber: number
    latestDiffTarget: AssistantDiffTarget | null
    searchText: string
    visualization?: VisualizationResource
}

export type AssistantResourceIndex = {
    resources: AssistantResource[]
    totalOccurrences: number
    truncated: boolean
}

/** Saved resources are already normalized by the main transport; never parse response source here. */
export function visualizationToAssistantResource(resource: VisualizationResource, turns: AssistantDiffTurn[] = []): AssistantResource {
    const origins: AssistantResourceOrigin[] = []
    for (const revision of resource.versions) {
        const origin = revision.origin
        const turn = origin?.turnId ? turns.find((candidate) => candidate.id === origin.turnId) : undefined
        if (!turn || origins.some((candidate) => candidate.turnId === turn.id)) continue
        origins.push({ key: `${resource.id}:${turn.id}`, turnId: turn.id, turnNumber: turn.number, createdAt: revision.createdAt, kind: 'response' })
    }
    origins.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    return {
        id: `visualization:${resource.id}`, kind: 'visualization', title: resource.title,
        subtitle: resource.summary || `${resource.kind} · v${resource.latestVersion}`,
        path: null, url: null, attachment: null, sources: ['generated'], origins,
        occurrenceCount: 0, latestAt: resource.updatedAt,
        latestTurnId: origins[0]?.turnId || '', latestTurnNumber: origins[0]?.turnNumber || 0,
        latestDiffTarget: null, visualization: resource,
        searchText: [resource.title, resource.summary, resource.kind, 'visualization', ...origins.map((origin) => `turn ${origin.turnNumber}`)].join(' ').toLowerCase()
    }
}

export const ASSISTANT_RESOURCE_INDEX_LIMIT = 500
export const ASSISTANT_RESOURCE_TURN_LIMIT = 2_000
export const ASSISTANT_RESOURCE_TEXT_BUDGET = 2_000_000
const ASSISTANT_RESOURCE_ORIGIN_LIMIT = 24
const ASSISTANT_RESOURCE_TEXT_LIMIT = 50_000
const ASSISTANT_RESOURCE_REFERENCES_PER_TEXT_LIMIT = 80
const MARKDOWN_LINK_PATTERN = /(!?)\[([^\]]*)\]\(\s*(<[^>]+>|(?:[^\s()]|\([^()\s]*\))+)(?:\s+['"][^'"]*['"])?\s*\)/g
const MARKDOWN_AUTOLINK_PATTERN = /<((?:https?:\/\/|\/\/)[^>\s]+)>/gi
const PLAIN_URL_PATTERN = /(?:https?:\/\/|\/\/)[^\s<>{}\[\]"']+/gi
const INLINE_CODE_PATTERN = /`([^`\r\n]{1,500})`/g

type MutableAssistantResource = Omit<AssistantResource, 'sources' | 'origins' | 'searchText'> & {
    sources: Set<AssistantResourceSource>
    origins: Map<string, AssistantResourceOrigin>
}

type ExtractedTextReference =
    | { kind: 'file'; target: string }
    | { kind: 'link'; url: string; title?: string; image?: boolean }

function normalizePathKey(value: string): string {
    const normalized = value.trim().replace(/\\/g, '/').replace(/\/+$/, '')
    return /^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//')
        ? normalized.toLowerCase()
        : normalized
}

function basename(value: string): string {
    const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '')
    return normalized.split('/').pop() || normalized
}

function imageExtension(value: string): string {
    const withoutLocation = value.split('#', 1)[0]?.split('?', 1)[0]?.replace(/:\d+(?::\d+)?$/, '') || ''
    const fileName = basename(withoutLocation)
    const extensionIndex = fileName.lastIndexOf('.')
    return extensionIndex >= 0 ? fileName.slice(extensionIndex + 1).toLowerCase() : ''
}

function looksLikeImageTarget(value: string): boolean {
    return IMAGE_EXTENSIONS.has(imageExtension(value))
}

function isImageAttachment(attachment: ParsedUserAttachment): boolean {
    return String(attachment.type || '').toUpperCase() === 'IMAGE'
        || String(attachment.mime || '').toLowerCase().startsWith('image/')
        || String(attachment.content || attachment.preview || '').toLowerCase().startsWith('data:image/')
        || looksLikeImageTarget(String(attachment.path || attachment.displayName || ''))
}

function trimUrlBoundaryPunctuation(rawValue: string): string {
    let value = String(rawValue || '').trim().replace(/[.,;!?]+$/, '')
    while (value.endsWith(')')) {
        const openingCount = (value.match(/\(/g) || []).length
        const closingCount = (value.match(/\)/g) || []).length
        if (closingCount <= openingCount) break
        value = value.slice(0, -1).replace(/[.,;!?]+$/, '')
    }
    return value
}

function normalizeWebUrl(rawValue: string): string | null {
    let value = trimUrlBoundaryPunctuation(rawValue)
    if (!value) return null
    if (value.startsWith('//')) value = `https:${value}`
    try {
        const url = new URL(value)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
        return url.toString().slice(0, 2048)
    } catch {
        return null
    }
}

function resolveResourceFilePath(target: string, projectPath?: string | null): string | null {
    const normalizedTarget = String(target || '').trim()
    if (!normalizedTarget) return null
    const baseFilePath = getAssistantLinkBaseFilePath(projectPath)
    const resolved = resolveMarkdownLinkTarget(normalizedTarget, baseFilePath)
    if (resolved?.path) return resolved.path
    if (/^[A-Za-z]:[\\/]/.test(normalizedTarget) || normalizedTarget.startsWith('\\\\') || normalizedTarget.startsWith('/')) {
        return normalizedTarget.replace(/:\d+(?::\d+)?$/, '')
    }
    return null
}

function extractTextReferences(text: string, availableTextBudget = ASSISTANT_RESOURCE_TEXT_LIMIT): ExtractedTextReference[] {
    const source = String(text || '').slice(0, Math.min(ASSISTANT_RESOURCE_TEXT_LIMIT, Math.max(0, availableTextBudget)))
    if (!source) return []
    const candidates: Array<{ value: string; image: boolean; title?: string }> = []
    const addCandidate = (value: string, image = false, title?: string) => {
        const normalized = value.trim().replace(/^<|>$/g, '')
        if (!normalized) return
        const existing = candidates.find((candidate) => candidate.value === normalized)
        if (existing) {
            existing.image ||= image
            existing.title ||= title
            return
        }
        candidates.push({ value: normalized, image, title })
    }

    for (const match of source.matchAll(MARKDOWN_LINK_PATTERN)) {
        addCandidate(match[3] || '', match[1] === '!', String(match[2] || '').trim() || undefined)
    }
    for (const match of source.matchAll(MARKDOWN_AUTOLINK_PATTERN)) addCandidate(match[1] || '')
    for (const match of source.matchAll(PLAIN_URL_PATTERN)) addCandidate(match[0] || '')
    for (const match of source.matchAll(INLINE_CODE_PATTERN)) addCandidate(match[1] || '')

    const references = new Map<string, ExtractedTextReference>()
    for (const candidate of candidates.slice(0, ASSISTANT_RESOURCE_REFERENCES_PER_TEXT_LIMIT)) {
        const packageReference = resolveMarkdownPackageReference(candidate.value)
        const url = packageReference?.href || normalizeWebUrl(candidate.value)
        const reference: ExtractedTextReference | null = url
            ? {
                kind: 'link',
                url,
                title: packageReference?.specifier || candidate.title,
                image: candidate.image || looksLikeImageTarget(url)
            }
            : looksLikeMarkdownFileReference(candidate.value)
                ? { kind: 'file', target: candidate.value }
                : null
        if (!reference) continue

        const identity = reference.kind === 'link'
            ? `link:${reference.url}`
            : `file:${normalizePathKey(reference.target)}`
        const existing = references.get(identity)
        if (existing?.kind === 'link' && reference.kind === 'link') {
            references.set(identity, {
                ...existing,
                title: existing.title || reference.title,
                image: existing.image || reference.image
            })
            continue
        }
        if (!existing) references.set(identity, reference)
    }
    return [...references.values()]
}

function originForTurn(turn: AssistantDiffTurn, kind: AssistantResourceOriginKind, suffix: string): AssistantResourceOrigin {
    return {
        key: `${turn.id}:${kind}:${suffix}`,
        turnId: turn.id,
        turnNumber: turn.number,
        createdAt: turn.updatedAt || turn.createdAt,
        kind
    }
}

function sourceLabel(sources: Iterable<AssistantResourceSource>): string {
    const labels: Record<AssistantResourceSource, string> = {
        changed: 'Changed image',
        generated: 'Generated image',
        attached: 'Attachment',
        mentioned: 'Mentioned in chat'
    }
    return [...sources].map((source) => labels[source]).join(' · ')
}

function isCanonicalMediaAttachment(attachment: ParsedUserAttachment): boolean {
    const path = String(attachment.path || '').replace(/\\/g, '/').toLowerCase()
    return /canonical zyra transcript/i.test(String(attachment.origin || ''))
        || path.includes('/assistant/canonical-media/')
}

function normalizedAttachmentSize(attachment: ParsedUserAttachment): number | null {
    const digits = String(attachment.size || '').replace(/[^0-9]/g, '')
    if (!digits) return null
    const size = Number(digits)
    return Number.isSafeInteger(size) && size >= 0 ? size : null
}

function attachmentMimeMatches(left: ParsedUserAttachment, right: ParsedUserAttachment): boolean {
    const leftMime = String(left.mime || '').trim().toLowerCase()
    const rightMime = String(right.mime || '').trim().toLowerCase()
    return !leftMime || !rightMime || leftMime === rightMime
}

function reconcileMaterializedImageAttachments(attachments: ParsedUserAttachment[]): ParsedUserAttachment[] {
    const canonicalAttachments = attachments.filter((attachment) => isImageAttachment(attachment) && isCanonicalMediaAttachment(attachment))
    if (canonicalAttachments.length === 0) return attachments
    const originals = attachments.filter((attachment) => isImageAttachment(attachment) && !isCanonicalMediaAttachment(attachment))
    const matchedOriginals = new Set<ParsedUserAttachment>()
    const replacementByCanonical = new Map<ParsedUserAttachment, ParsedUserAttachment>()

    canonicalAttachments.forEach((canonical, canonicalIndex) => {
        const canonicalSize = normalizedAttachmentSize(canonical)
        const original = originals.find((candidate) => (
            !matchedOriginals.has(candidate)
            && canonicalSize != null
            && normalizedAttachmentSize(candidate) === canonicalSize
            && attachmentMimeMatches(candidate, canonical)
        )) || (originals.length === canonicalAttachments.length
            ? originals[canonicalIndex]
            : undefined)
        if (!original || matchedOriginals.has(original) || !attachmentMimeMatches(original, canonical)) return
        matchedOriginals.add(original)
        const originalPath = String(original.path || '').trim()
        const durablePath = original.isClipboard || originalPath.toLowerCase().startsWith('clipboard://')
            ? canonical.path
            : original.path || canonical.path
        replacementByCanonical.set(canonical, {
            ...canonical,
            name: original.name || canonical.name,
            displayName: original.displayName || original.name || canonical.displayName,
            path: durablePath,
            mime: original.mime || canonical.mime,
            size: original.size || canonical.size,
            preview: original.preview || canonical.preview,
            note: original.note || canonical.note,
            origin: original.origin || canonical.origin,
            content: original.content || canonical.content,
            isClipboard: false
        })
    })

    return attachments.flatMap((attachment) => {
        if (matchedOriginals.has(attachment)) return []
        return [replacementByCanonical.get(attachment) || attachment]
    })
}

function attachmentIdentity(attachment: ParsedUserAttachment): string {
    if (attachment.path?.startsWith('clipboard://')) return `ref:${attachment.path}`
    const content = String(attachment.content || attachment.preview || '').trim()
    let hash = 2166136261
    for (let index = 0; index < content.length; index += 1) {
        hash ^= content.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
    }
    return `${attachment.type}:${attachment.mime || ''}:${attachment.displayName}:${(hash >>> 0).toString(16)}`.toLowerCase()
}

export function buildAssistantResourceIndex(input: {
    turns: AssistantDiffTurn[]
    projectPath?: string | null
}): AssistantResourceIndex {
    const resources = new Map<string, MutableAssistantResource>()
    let totalOccurrences = 0
    let truncated = input.turns.length > ASSISTANT_RESOURCE_TURN_LIMIT
    let remainingTextBudget = ASSISTANT_RESOURCE_TEXT_BUDGET

    const upsert = (inputResource: {
        key: string
        kind: AssistantResourceKind
        title: string
        subtitle: string
        path?: string | null
        url?: string | null
        attachment?: ParsedUserAttachment | null
        source: AssistantResourceSource
        origin: AssistantResourceOrigin
        diffTarget?: AssistantDiffTarget | null
    }) => {
        totalOccurrences += 1
        const existing = resources.get(inputResource.key)
        if (!existing && resources.size >= ASSISTANT_RESOURCE_INDEX_LIMIT) {
            truncated = true
            return
        }
        if (existing) {
            existing.occurrenceCount += 1
            if (inputResource.kind === 'image') {
                existing.kind = 'image'
                const hasOriginLabel = existing.attachment || existing.sources.has('generated') || existing.sources.has('changed')
                if (inputResource.attachment || (!existing.attachment && (inputResource.source !== 'mentioned' || !hasOriginLabel))) {
                    existing.title = inputResource.title || existing.title
                }
            }
            existing.sources.add(inputResource.source)
            if (existing.origins.size < ASSISTANT_RESOURCE_ORIGIN_LIMIT) {
                existing.origins.set(inputResource.origin.key, inputResource.origin)
            }
            if (inputResource.origin.createdAt >= existing.latestAt) {
                existing.latestAt = inputResource.origin.createdAt
                existing.latestTurnId = inputResource.origin.turnId
                existing.latestTurnNumber = inputResource.origin.turnNumber
                existing.subtitle = inputResource.subtitle || existing.subtitle
                existing.attachment = inputResource.attachment || existing.attachment
                existing.latestDiffTarget = inputResource.diffTarget || existing.latestDiffTarget
            }
            return
        }
        resources.set(inputResource.key, {
            id: inputResource.key,
            kind: inputResource.kind,
            title: inputResource.title,
            subtitle: inputResource.subtitle,
            path: inputResource.path || null,
            url: inputResource.url || null,
            attachment: inputResource.attachment || null,
            sources: new Set([inputResource.source]),
            origins: new Map([[inputResource.origin.key, inputResource.origin]]),
            occurrenceCount: 1,
            latestAt: inputResource.origin.createdAt,
            latestTurnId: inputResource.origin.turnId,
            latestTurnNumber: inputResource.origin.turnNumber,
            latestDiffTarget: inputResource.diffTarget || null
        })
    }

    const addImage = (turn: AssistantDiffTurn, rawTarget: string, source: AssistantResourceSource, originKind: AssistantResourceOriginKind, diffTarget?: AssistantDiffTarget | null, attachment?: ParsedUserAttachment | null, position = 1) => {
        if (!looksLikeImageTarget(rawTarget) && (!attachment || !isImageAttachment(attachment))) return
        const path = resolveResourceFilePath(rawTarget, input.projectPath)
        if (!path) return
        const key = `image:${normalizePathKey(path)}`
        const displayPath = getAssistantRelativeFilePath(path, input.projectPath) || path
        upsert({
            key,
            kind: 'image',
            title: assistantImageDisplayName(attachment?.displayName || attachment?.name || basename(path), turn.number, source, position),
            subtitle: displayPath,
            path,
            attachment,
            source,
            origin: originForTurn(turn, originKind, normalizePathKey(rawTarget)),
            diffTarget
        })
    }

    const addLink = (turn: AssistantDiffTurn, rawUrl: string, originKind: AssistantResourceOriginKind, title?: string, image = false, position = 1) => {
        let url = normalizeWebUrl(rawUrl)
        if (!url) return
        if (image || looksLikeImageTarget(url)) {
            const identity = new URL(url)
            identity.hash = ''
            url = identity.toString()
        }
        let hostname = url
        let imageTitle = ''
        try {
            const parsedUrl = new URL(url)
            hostname = parsedUrl.hostname
            imageTitle = basename(parsedUrl.pathname)
        } catch {
            // normalizeWebUrl already validated the URL.
        }
        const resourceKind: AssistantResourceKind = image || looksLikeImageTarget(url) ? 'image' : 'link'
        upsert({
            key: `url:${url}`,
            kind: resourceKind,
            title: title || (resourceKind === 'image' ? assistantImageDisplayName(imageTitle, turn.number, 'mentioned', position) : hostname),
            subtitle: url,
            url,
            source: 'mentioned',
            origin: originForTurn(turn, originKind, url)
        })
    }

    for (const turn of input.turns.slice(0, ASSISTANT_RESOURCE_TURN_LIMIT)) {
        const changes = turn.changes.length > 0 ? turn.changes : turn.files
        let imagePosition = 0
        for (const change of changes) {
            if (looksLikeImageTarget(change.target.filePath)) imagePosition += 1
            addImage(
                turn,
                change.target.filePath,
                change.target.isNew || change.target.changeKind === 'add' ? 'generated' : 'changed',
                'change',
                change.target,
                null,
                imagePosition
            )
        }

        const imageAttachments = reconcileMaterializedImageAttachments(turn.promptAttachments).filter(isImageAttachment)
        for (const [attachmentIndex, attachment] of imageAttachments.entries()) {
            const path = String(attachment.path || '').trim()
            if (path && !attachment.isClipboard && !path.toLowerCase().startsWith('clipboard://')) {
                addImage(turn, path, 'attached', 'attachment', null, attachment, attachmentIndex + 1)
                continue
            }
            const key = `image-attachment:${attachmentIdentity(attachment)}`
            upsert({
                key,
                kind: 'image',
                title: assistantImageDisplayName(attachment.displayName || attachment.name || '', turn.number, 'attached', attachmentIndex + 1),
                subtitle: attachment.mime || 'Image attachment',
                attachment,
                source: 'attached',
                origin: originForTurn(turn, 'attachment', attachment.id)
            })
        }

        const mentionedImagePositions = new Map<string, number>()
        for (const [kind, text] of [['prompt', turn.prompt], ['response', turn.response]] as const) {
            if (resources.size >= ASSISTANT_RESOURCE_INDEX_LIMIT) {
                if (String(text || '').trim()) truncated = true
                break
            }
            const rawTextLength = String(text || '').length
            const textLength = Math.min(rawTextLength, ASSISTANT_RESOURCE_TEXT_LIMIT)
            if (rawTextLength > ASSISTANT_RESOURCE_TEXT_LIMIT) truncated = true
            if (remainingTextBudget <= 0) {
                if (String(text || '').trim()) truncated = true
                continue
            }
            const availableTextBudget = Math.min(remainingTextBudget, textLength)
            if (availableTextBudget < textLength) truncated = true
            remainingTextBudget -= availableTextBudget
            for (const reference of extractTextReferences(text, availableTextBudget)) {
                const target = reference.kind === 'file' ? reference.target : reference.url
                const image = looksLikeImageTarget(target) || (reference.kind !== 'file' && reference.image)
                if (image && !mentionedImagePositions.has(target)) mentionedImagePositions.set(target, mentionedImagePositions.size + 1)
                const position = mentionedImagePositions.get(target) || 1
                if (reference.kind === 'file') addImage(turn, reference.target, 'mentioned', kind, null, null, position)
                else addLink(turn, reference.url, kind, reference.title, reference.image, position)
            }
        }
    }

    const result = [...resources.values()].map((resource): AssistantResource => {
        const sources = [...resource.sources]
        const origins = [...resource.origins.values()].sort((left, right) => (
            right.createdAt.localeCompare(left.createdAt) || right.turnNumber - left.turnNumber
        ))
        return {
            ...resource,
            sources,
            origins,
            searchText: [
                resource.title,
                resource.subtitle,
                resource.path || '',
                resource.url || '',
                resource.latestDiffTarget?.previousPath || '',
                sourceLabel(sources),
                ...origins.flatMap((origin) => [`turn ${origin.turnNumber}`, `#${origin.turnNumber}`, origin.kind])
            ].join(' ').toLowerCase()
        }
    }).sort((left, right) => (
        right.latestAt.localeCompare(left.latestAt)
        || right.latestTurnNumber - left.latestTurnNumber
        || left.title.localeCompare(right.title)
    ))

    return { resources: result, totalOccurrences, truncated }
}
