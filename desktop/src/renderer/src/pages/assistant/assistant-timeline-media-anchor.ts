const ROW_SELECTOR = '[data-assistant-timeline-row-id]'

/** A character, rather than a paragraph origin, also survives text reflow. */
export type AssistantTimelineMediaAnchor = {
    windowKey: string
    scroller: HTMLElement
    row: HTMLElement
    rowId: string
    text: Text
    textValue: string
    textOffset: number
    range: Range
    offsetWithinRow: number
}

type CaretDocument = Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
}

function anchorAtRange(scroller: HTMLElement, windowKey: string, range: Range): AssistantTimelineMediaAnchor | null {
    const text = range.startContainer
    if (text.nodeType !== Node.TEXT_NODE || !text.textContent?.trim()) return null
    const parent = text.parentElement
    // Interactive controls, hidden copy text and sandbox documents are not reading anchors.
    if (!parent || parent.closest('button, summary, [aria-hidden="true"], .sr-only')) return null
    const row = parent.closest<HTMLElement>(ROW_SELECTOR)
    if (!row || !scroller.contains(row)) return null
    const character = range.cloneRange()
    const start = Math.min(range.startOffset, Math.max(0, text.textContent.length - 1))
    character.setStart(text, start)
    character.setEnd(text, start + 1)
    const rect = character.getBoundingClientRect()
    const viewport = scroller.getBoundingClientRect()
    if (!rect.height || rect.bottom <= viewport.top || rect.top >= viewport.bottom) return null
    return {
        windowKey, scroller, row, rowId: row.dataset.assistantTimelineRowId!,
        text: text as Text, textValue: text.textContent, textOffset: start, range: character,
        offsetWithinRow: rect.top - row.getBoundingClientRect().top
    }
}

/** Bounded hit testing avoids walking every text node in a long assistant reply on scroll. */
export function captureAssistantTimelineMediaAnchor(scroller: HTMLElement, windowKey: string): AssistantTimelineMediaAnchor | null {
    if (!scroller.isConnected || scroller.clientHeight <= 0) return null
    const doc = scroller.ownerDocument as CaretDocument
    const viewport = scroller.getBoundingClientRect()
    if (doc.caretRangeFromPoint) {
        for (const yOffset of [8, 28, 56, 96, 160, 240, 360]) {
            if (yOffset >= viewport.height) break
            for (const fraction of [0.25, 0.5, 0.75]) {
                const range = doc.caretRangeFromPoint(viewport.left + viewport.width * fraction, viewport.top + yOffset)
                if (!range) continue
                const anchor = anchorAtRange(scroller, windowKey, range)
                // caretRangeFromPoint can return distant prose when the pointer is over media.
                if (anchor && Math.abs(anchor.range.getBoundingClientRect().top - viewport.top - yOffset) < 32) return anchor
            }
        }
    }
    // Also works without Chromium's caret API. Only inspect mounted semantic blocks.
    const blocks = doc.createTreeWalker(scroller, NodeFilter.SHOW_ELEMENT, {
        acceptNode: node => (node as Element).matches('p, li, pre, h1, h2, h3, h4, h5, h6, td, th, blockquote')
            ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
    })
    for (let i = 0; i < 256; i++) {
        const block = blocks.nextNode() as Element | null
        if (!block) break
        const rect = block.getBoundingClientRect()
        if (rect.top < viewport.top || rect.top >= viewport.bottom || !rect.height) continue
        const walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT)
        const text = walker.nextNode()
        if (!text) continue
        const range = doc.createRange()
        range.setStart(text, 0)
        const anchor = anchorAtRange(scroller, windowKey, range)
        if (anchor) return anchor
    }
    return null
}

/**
 * LegendList MVCP already restores the row's origin. Return ONLY the change
 * inside that row, never the character's viewport displacement (which would
 * count previous-row growth twice).
 */
export function measureAssistantTimelineMediaAnchorDelta(anchor: AssistantTimelineMediaAnchor, scroller: HTMLElement, windowKey: string): number | null {
    if (anchor.windowKey !== windowKey || anchor.scroller !== scroller || !scroller.isConnected
        || !anchor.row.isConnected || !anchor.text.isConnected || !scroller.contains(anchor.row)
        || !anchor.row.contains(anchor.text) || anchor.row.dataset.assistantTimelineRowId !== anchor.rowId
        || anchor.text.data !== anchor.textValue
        || anchor.textOffset < 0 || anchor.textOffset >= anchor.text.data.length) return null
    // A live Range can collapse onto an ancestor when LegendList reorders its
    // containers, even though this exact text node remains connected. Rebuild
    // from the saved character identity, never the live Range's mutated endpoints.
    const range = anchor.text.ownerDocument.createRange()
    range.setStart(anchor.text, anchor.textOffset)
    range.setEnd(anchor.text, anchor.textOffset + 1)
    anchor.range = range
    const rect = range.getBoundingClientRect()
    if (!rect.height) return null
    const offset = rect.top - anchor.row.getBoundingClientRect().top
    const delta = offset - anchor.offsetWithinRow
    if (!Number.isFinite(delta)) return null
    anchor.offsetWithinRow = offset
    return delta
}
