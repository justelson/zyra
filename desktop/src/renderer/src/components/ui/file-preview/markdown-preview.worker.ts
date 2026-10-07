/// <reference lib="webworker" />

import { applyDocumentMarkdownHeadingIds, parseMarkdownToHast, stripMarkdownTreePositions } from '../markdown/markdownPipeline'

type MarkdownWorkerRequest =
    | { type: 'warm' }
    | { type: 'parse'; id: number; content: string; allowRawHtml: boolean; headingIds?: string[] }

type MarkdownWorkerResponse =
    | { type: 'ready' }
    | { type: 'parsed'; id: number; tree: ReturnType<typeof parseMarkdownToHast> }
    | { type: 'error'; id: number; error: string }

self.onmessage = (event: MessageEvent<MarkdownWorkerRequest>) => {
    const request = event.data
    if (request.type === 'warm') {
        // Compile the unified/GFM/sanitize path while Explorer is idle instead
        // of charging the first visible Markdown section for parser startup.
        stripMarkdownTreePositions(parseMarkdownToHast('# Preview\n\n- warm parser\n\n```ts\nconst ready = true\n```\n', true))
        self.postMessage({ type: 'ready' } satisfies MarkdownWorkerResponse)
        return
    }
    try {
        const tree = parseMarkdownToHast(request.content, request.allowRawHtml)
        applyDocumentMarkdownHeadingIds(tree, request.headingIds)
        stripMarkdownTreePositions(tree)
        self.postMessage({ type: 'parsed', id: request.id, tree } satisfies MarkdownWorkerResponse)
    } catch (error) {
        self.postMessage({
            type: 'error',
            id: request.id,
            error: error instanceof Error ? error.message : String(error)
        } satisfies MarkdownWorkerResponse)
    }
}
