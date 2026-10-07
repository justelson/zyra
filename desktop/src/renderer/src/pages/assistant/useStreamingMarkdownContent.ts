import { useLayoutEffect, useRef, useState } from 'react'

// Keep one full document for paragraph/reference context, but don't recompile it
// for every reveal frame. A trailing timer uses the last commit's deadline;
// new input cannot keep postponing publication. Completion uses a separate
// renderer and therefore never waits for this live-only timer.
export const STREAMING_MARKDOWN_INTERVAL_MS = 80

export function useStreamingMarkdownContent(content: string, cacheKey: string): string {
    const [published, setPublished] = useState({ content, cacheKey })
    const lastCommitAt = useRef(0)
    const pending = useRef({ content, cacheKey })

    useLayoutEffect(() => {
        lastCommitAt.current = performance.now()
    }, [published])

    useLayoutEffect(() => {
        pending.current = { content, cacheKey }
        if (published.content === content && published.cacheKey === cacheKey) return
        const publish = () => setPublished(pending.current)
        // Replacements and navigation must never retain another document's text.
        if (published.cacheKey !== cacheKey || !content.startsWith(published.content)) {
            publish()
            return
        }
        const delay = Math.max(0, STREAMING_MARKDOWN_INTERVAL_MS - (performance.now() - lastCommitAt.current))
        if (delay === 0) {
            publish()
            return
        }
        const timer = window.setTimeout(publish, delay)
        return () => window.clearTimeout(timer)
    }, [content, cacheKey, published])

    return published.cacheKey === cacheKey ? published.content : content
}
