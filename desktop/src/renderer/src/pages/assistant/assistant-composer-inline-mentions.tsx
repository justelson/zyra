import type { ReactNode } from 'react'
export { ZyraAgentLogo } from './ZyraBrandMarks'

export function getMentionQuery(text: string, cursor: number): { start: number; query: string } | null {
    const beforeCursor = text.slice(0, cursor)
    const match = beforeCursor.match(/(^|\s)@([^\s@]*)$/)
    if (!match || match.index == null) return null
    const start = match.index + match[1].length
    return { start, query: match[2] || '' }
}

export function normalizeMentionLookupPath(pathValue: string): string {
    return String(pathValue || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '').toLowerCase()
}

export type InlineMentionTag = {
    id: string
    path: string
    relativePath: string
    label: string
    kind: 'file' | 'directory' | 'skill' | 'command'
    start: number
    end: number
}

export function sortInlineMentionTags(tags: InlineMentionTag[]): InlineMentionTag[] {
    return [...tags].sort((left, right) => left.start - right.start || left.end - right.end)
}

export function reconcileInlineMentionTags(prevText: string, nextText: string, tags: InlineMentionTag[]): InlineMentionTag[] {
    if (tags.length === 0) return []
    if (prevText === nextText) return sortInlineMentionTags(tags)

    let prefixLength = 0
    while (prefixLength < prevText.length && prefixLength < nextText.length && prevText[prefixLength] === nextText[prefixLength]) prefixLength += 1

    let suffixLength = 0
    while (
        suffixLength < prevText.length - prefixLength
        && suffixLength < nextText.length - prefixLength
        && prevText[prevText.length - 1 - suffixLength] === nextText[nextText.length - 1 - suffixLength]
    ) suffixLength += 1

    const previousChangedEnd = prevText.length - suffixLength
    const delta = nextText.length - prevText.length
    return sortInlineMentionTags(tags.flatMap((tag) => {
        if (tag.end <= prefixLength) return [tag]
        if (tag.start >= previousChangedEnd) return [{ ...tag, start: tag.start + delta, end: tag.end + delta }]
        return []
    }))
}

export function removeInlineMentionTagRange(tags: InlineMentionTag[], start: number, end: number): InlineMentionTag[] {
    return tags.filter((tag) => tag.end <= start || tag.start >= end)
}

export function replaceInlineMentionTokensWithLabels(text: string, tags: InlineMentionTag[]): string {
    if (tags.length === 0) return text
    let result = text
    const sortedTags = sortInlineMentionTags(tags)
    for (let index = sortedTags.length - 1; index >= 0; index -= 1) {
        const tag = sortedTags[index]
        if (tag.kind === 'skill' || tag.kind === 'command') continue
        result = `${result.slice(0, tag.start)}${tag.label}${result.slice(tag.end)}`
    }
    return result
}

export function renderInlineMentionOverlay(
    text: string,
    tags: InlineMentionTag[],
    renderTag: (tag: InlineMentionTag, rawToken: string) => ReactNode
): ReactNode[] {
    if (text.length === 0) return []
    const segments: ReactNode[] = []
    let cursor = 0
    for (const tag of sortInlineMentionTags(tags)) {
        if (tag.start > cursor) segments.push(text.slice(cursor, tag.start))
        const rawToken = text.slice(tag.start, tag.end)
        segments.push(renderTag(tag, rawToken))
        cursor = tag.end
    }
    if (cursor < text.length) segments.push(text.slice(cursor))
    return segments
}
