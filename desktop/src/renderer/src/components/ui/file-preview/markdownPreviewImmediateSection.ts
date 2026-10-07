import type { Root } from 'hast'
import { applyDocumentMarkdownHeadingIds, parseMarkdownToHast, stripMarkdownTreePositions } from '../markdown/markdownPipeline'
import { cacheMarkdownPreviewSection, readCachedMarkdownPreviewSection } from './markdownPreviewWorkerClient'

// First-screen sections are bounded by the sectioner. Larger/overscan work
// stays cancellable in the worker; opening ordinary prose needs no worker boot.
export const MAX_IMMEDIATE_MARKDOWN_SECTION_CHARS = 16_000

export function prepareImmediateMarkdownSection(content: string, headingIds: readonly string[] | undefined, urgent: boolean): Root | null {
    const cached = readCachedMarkdownPreviewSection(content, headingIds)
    if (cached) return cached
    if (!urgent || content.length > MAX_IMMEDIATE_MARKDOWN_SECTION_CHARS) return null
    try {
        const tree = parseMarkdownToHast(content, true)
        applyDocumentMarkdownHeadingIds(tree, headingIds)
        stripMarkdownTreePositions(tree)
        cacheMarkdownPreviewSection(content, tree, headingIds)
        return tree
    } catch {
        return null
    }
}
