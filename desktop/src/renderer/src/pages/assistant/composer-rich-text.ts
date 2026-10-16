/** Tokens retain their original prompt text while displaying an atomic chip. */
export function composerTokenDeletionRange(
    tags: ReadonlyArray<{ start: number; end: number }>,
    start: number,
    end: number,
    key: 'Backspace' | 'Delete'
): [number, number] | null {
    const overlapping = tags.filter(tag => {
        if (start !== end) return tag.start < end && tag.end > start
        return key === 'Backspace'
            ? start > tag.start && start <= tag.end
            : start >= tag.start && start < tag.end
    })
    return overlapping.length > 0
        ? [Math.min(start, ...overlapping.map(tag => tag.start)), Math.max(end, ...overlapping.map(tag => tag.end))]
        : null
}

export function composerNodeText(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || ''
    if (node instanceof HTMLElement && node.dataset.composerToken !== undefined) return node.dataset.composerToken
    if (node instanceof HTMLBRElement) return '\n'
    return Array.from(node.childNodes).map(composerNodeText).join('')
}

export function composerSelection(root: HTMLElement): [number, number] {
    const selection = root.ownerDocument.getSelection()
    if (!selection?.rangeCount || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return [composerNodeText(root).length, composerNodeText(root).length]
    const range = selection.getRangeAt(0)
    const prefix = root.ownerDocument.createRange()
    prefix.selectNodeContents(root); prefix.setEnd(range.startContainer, range.startOffset)
    const start = composerNodeText(prefix.cloneContents()).length
    prefix.setEnd(range.endContainer, range.endOffset)
    return [start, composerNodeText(prefix.cloneContents()).length]
}

export function setComposerSelection(root: HTMLElement, start: number, end = start) {
    const point = (offset: number): [Node, number] => {
        let remaining = Math.max(0, offset)
        for (let index = 0; index < root.childNodes.length; index++) {
            const node = root.childNodes[index], length = composerNodeText(node).length
            if (remaining <= length) {
                if (node.nodeType === Node.TEXT_NODE) return [node, remaining]
                return [root, index + (remaining > 0 ? 1 : 0)]
            }
            remaining -= length
        }
        return [root, root.childNodes.length]
    }
    const range = root.ownerDocument.createRange()
    range.setStart(...point(start)); range.setEnd(...point(end))
    const selection = root.ownerDocument.getSelection()
    selection?.removeAllRanges(); selection?.addRange(range)
}
