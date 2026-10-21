import { stripSidebarBrowserContext } from './browser-context'
import { parseAssistantCitation, type AssistantCitation } from './assistant-citations'
export type SerializedAssistantAttachment = {
    citation?: AssistantCitation
    name: string
    type: string
    path: string | null
    mime: string | null
    size: string | null
    preview: string | null
    note: string | null
    origin: string | null
    content: string | null
}

export type SerializedAssistantMessage = {
    body: string
    attachments: SerializedAssistantAttachment[]
}

const ATTACHMENT_BLOCK_MARKER = /(?:^|\n\n)Attached files \((\d+)\):\n/
const ATTACHMENT_HEADER_PATTERN = /^\d+\.\s+(.+?)\s+\[([A-Z]+)\]$/
const ATTACHMENT_DETAIL_KEYS = new Set(['path', 'ref', 'mime', 'size', 'preview', 'note', 'origin', 'citation-json'])

function parseSerializedAttachmentSection(section: string, index: number): SerializedAssistantAttachment {
    const lines = section.split(/\r?\n/)
    const headerLine = lines[0]?.trim() || `${index + 1}. Attachment [FILE]`
    const headerMatch = headerLine.match(ATTACHMENT_HEADER_PATTERN)
    const details = new Map<string, string>()
    const contentLines: string[] = []
    let readingContent = false

    for (const rawLine of lines.slice(1)) {
        const trimmed = rawLine.trim()
        if (!readingContent && !trimmed) continue

        if (readingContent) {
            contentLines.push(rawLine)
            continue
        }

        if (/^content:\s*$/i.test(trimmed)) {
            readingContent = true
            continue
        }

        const separatorIndex = trimmed.indexOf(':')
        if (separatorIndex <= 0) continue
        const key = trimmed.slice(0, separatorIndex).trim().toLowerCase()
        const value = trimmed.slice(separatorIndex + 1).trim()
        if (!key || !value) continue
        if (!ATTACHMENT_DETAIL_KEYS.has(key)) continue
        details.set(key, value)
    }

    let citation: AssistantCitation | null = null
    try { citation = parseAssistantCitation(JSON.parse(details.get('citation-json') || 'null')) } catch { /* keep the readable quote if metadata is unavailable */ }
    return {
        ...(citation ? { citation } : {}),
        name: headerMatch?.[1]?.trim() || `Attachment ${index + 1}`,
        type: headerMatch?.[2]?.trim() || 'FILE',
        path: details.get('path') || details.get('ref') || null,
        mime: details.get('mime') || null,
        size: details.get('size') || null,
        preview: details.get('preview') || null,
        note: details.get('note') || null,
        origin: details.get('origin') || null,
        content: contentLines.length > 0 ? contentLines.join('\n').trimEnd() : null
    }
}

export function parseSerializedAssistantMessage(text: string): SerializedAssistantMessage {
    const source = String(text || '')
    const markerMatch = source.match(ATTACHMENT_BLOCK_MARKER)
    if (!markerMatch || markerMatch.index == null) {
        return { body: source, attachments: [] }
    }

    const body = source.slice(0, markerMatch.index).trimEnd()
    const attachmentBlock = source.slice(markerMatch.index + markerMatch[0].length).trim()
    if (!attachmentBlock) {
        return { body, attachments: [] }
    }

    const sections: string[] = []
    let currentSection: string[] = []

    for (const rawLine of attachmentBlock.split(/\r?\n/)) {
        const trimmed = rawLine.trim()
        if (ATTACHMENT_HEADER_PATTERN.test(trimmed)) {
            if (currentSection.length > 0) {
                sections.push(currentSection.join('\n'))
            }
            currentSection = [trimmed]
            continue
        }
        if (currentSection.length === 0) continue
        currentSection.push(rawLine)
    }

    if (currentSection.length > 0) {
        sections.push(currentSection.join('\n'))
    }

    return {
        body,
        attachments: sections.map((section, index) => parseSerializedAttachmentSection(section, index))
    }
}

export function stripSerializedAssistantAttachments(text: string): string {
    return stripSidebarBrowserContext(parseSerializedAssistantMessage(text).body)
}

function isSerializedImageAttachment(attachment: SerializedAssistantAttachment): boolean {
    return String(attachment.type || '').trim().toUpperCase() === 'IMAGE'
        || String(attachment.mime || '').trim().toLowerCase().startsWith('image/')
        || String(attachment.content || attachment.preview || '').trim().toLowerCase().startsWith('data:image/')
}

function isSerializedCanonicalMediaAttachment(attachment: SerializedAssistantAttachment): boolean {
    const path = String(attachment.path || '').replace(/\\/g, '/').toLowerCase()
    return /canonical zyra transcript/i.test(String(attachment.origin || ''))
        || path.includes('/assistant/canonical-media/')
}

function serializeAssistantAttachment(attachment: SerializedAssistantAttachment, index: number): string {
    const referenceKey = isSerializedClipboardAttachment(attachment.path) ? 'ref' : 'path'
    const details = [
        attachment.path ? `${referenceKey}: ${attachment.path}` : null,
        attachment.mime ? `mime: ${attachment.mime}` : null,
        attachment.size ? `size: ${attachment.size}` : null,
        attachment.preview ? `preview: ${attachment.preview}` : null,
        attachment.note ? `note: ${attachment.note}` : null,
        attachment.origin ? `origin: ${attachment.origin}` : null,
        attachment.citation ? `citation-json: ${JSON.stringify(attachment.citation)}` : null,
        attachment.content ? `content:\n${attachment.content}` : null
    ].filter((value): value is string => Boolean(value))
    return [`${index + 1}. ${attachment.name || `Attachment ${index + 1}`} [${attachment.type || 'FILE'}]`, ...details].join('\n')
}

function renameSerializedAttachmentSection(section: string, name: string | undefined): string {
    if (!name) return section
    const lines = String(section || '').trim().split(/\r?\n/)
    const header = lines[0]?.trim().match(ATTACHMENT_HEADER_PATTERN)
    if (!header || !lines[0]) return section
    lines[0] = lines[0].replace(header[1] || '', name)
    return lines.join('\n')
}

function renumberSerializedAttachmentSection(section: string, index: number): string {
    const lines = String(section || '').trim().split(/\r?\n/)
    if (lines.length === 0 || !lines[0]) return ''
    lines[0] = ATTACHMENT_HEADER_PATTERN.test(lines[0].trim())
        ? lines[0].replace(/^\s*\d+\./, `${index + 1}.`)
        : `${index + 1}. Attachment ${index + 1} [FILE]`
    return lines.join('\n')
}

export function replaceSerializedAssistantImageAttachments(text: string, replacementSections: string[]): string {
    const parsed = parseSerializedAssistantMessage(text)
    const replacements = replacementSections.map((section) => String(section || '').trim()).filter(Boolean)
    const sections: string[] = []
    let replacementIndex = 0
    parsed.attachments.forEach((attachment, attachmentIndex) => {
        if (!isSerializedImageAttachment(attachment)) {
            sections.push(serializeAssistantAttachment(attachment, attachmentIndex))
            return
        }
        if (isSerializedCanonicalMediaAttachment(attachment)) return
        const replacement = replacements[replacementIndex]
        replacementIndex += 1
        sections.push(replacement
            ? renameSerializedAttachmentSection(replacement, attachment.name)
            : serializeAssistantAttachment(attachment, attachmentIndex))
    })
    sections.push(...replacements.slice(replacementIndex))
    const normalizedSections = sections
        .map(renumberSerializedAttachmentSection)
        .filter(Boolean)
    if (normalizedSections.length === 0) return parsed.body
    return `${parsed.body.trimEnd()}\n\nAttached files (${normalizedSections.length}):\n${normalizedSections.join('\n\n')}`.trimStart()
}

export function isSerializedClipboardAttachment(value: SerializedAssistantAttachment | string | null | undefined): boolean {
    if (typeof value === 'string') {
        return value.trim().toLowerCase().startsWith('clipboard://')
    }
    if (!value) return false
    if (isSerializedClipboardAttachment(value.path)) return true
    return /pasted from clipboard/i.test(String(value.origin || ''))
}

export function getSerializedAttachmentDisplayName(attachment: SerializedAssistantAttachment): string {
    if (!isSerializedClipboardAttachment(attachment)) {
        return attachment.name || 'Attachment'
    }

    const normalizedType = String(attachment.type || '').trim().toUpperCase()
    const normalizedMime = String(attachment.mime || '').trim().toLowerCase()
    if (normalizedType === 'IMAGE' || normalizedMime.startsWith('image/')) return 'Pasted image'
    if (
        normalizedType === 'TEXT'
        || normalizedType === 'CODE'
        || normalizedMime.startsWith('text/')
        || normalizedMime.includes('json')
        || normalizedMime.includes('xml')
        || normalizedMime.includes('yaml')
    ) {
        return 'Pasted text'
    }
    return 'Pasted file'
}

export function deriveAttachmentOnlySessionTitle(attachments: SerializedAssistantAttachment[]): string {
    if (attachments.length === 0) return 'New Session'
    if (attachments.length === 1) return getSerializedAttachmentDisplayName(attachments[0]).slice(0, 60)

    const clipboardOnly = attachments.every((attachment) => isSerializedClipboardAttachment(attachment))
    if (clipboardOnly) return `Pasted attachments (${attachments.length})`.slice(0, 60)
    return `Attached files (${attachments.length})`.slice(0, 60)
}
