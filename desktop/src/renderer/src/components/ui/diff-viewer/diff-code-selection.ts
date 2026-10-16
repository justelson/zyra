import type { FileDiffMetadata } from '@pierre/diffs'
import { codeRevision, type CodeSelectionSnapshot } from '@/pages/assistant/assistant-code-context'

type Range = { start: number; end: number; side?: 'additions' | 'deletions'; endSide?: 'additions' | 'deletions' }
export function diffCodeSelection(diff: FileDiffMetadata, range: Range, workspaceRoot?: string): CodeSelectionSnapshot | null {
    const side = range.side || 'additions'
    if (range.endSide && range.endSide !== side) return null
    const start = Math.min(range.start, range.end), end = Math.max(range.start, range.end)
    if (start < 1 || end - start > 2000) return null
    const lines = side === 'additions' ? diff.additionLines : diff.deletionLines
    const selected: string[] = []
    for (let line = start; line <= end; line++) {
        const hunk = diff.isPartial ? diff.hunks.find(h => {
            const first = side === 'additions' ? h.additionStart : h.deletionStart
            return line >= first && line < first + (side === 'additions' ? h.additionCount : h.deletionCount)
        }) : null
        if (diff.isPartial && !hunk) return null // Never invent missing context between hunks.
        const index = hunk ? (side === 'additions' ? hunk.additionLineIndex + line - hunk.additionStart : hunk.deletionLineIndex + line - hunk.deletionStart) : line - 1
        const value = lines[index]
        if (value === undefined) return null
        selected.push(value.replace(/\r?\n$/, ''))
    }
    const text = selected.join('\n')
    if (!text.trim() || text.length > 64_000) return null
    const name = side === 'deletions' ? diff.prevName || diff.name : diff.name
    const absolute = /^(?:[a-z]:[\\/]|\/)/i.test(name)
    return { filePath: absolute || !workspaceRoot ? name : `${workspaceRoot.replace(/[\\/]$/, '')}/${name}`, workspaceRoot, startLine: start, endLine: end, side: side === 'additions' ? 'after' : 'before', text, sourceRevision: side === 'additions' ? diff.newObjectId || codeRevision(lines.join('')) : diff.prevObjectId || codeRevision(lines.join('')) }
}
