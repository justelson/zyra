import { useEffect } from 'react'
import { locateAssistantCitation, parseAssistantCitation } from '@shared/assistant/assistant-citations'

/** The existing message-focus owner hydrates/reveals the virtual row first. */
export function useAssistantCitationNavigation(location: { key: string; state: unknown }, sessionId: string | null, threadId: string | null, onUnavailable: (message: string, type: 'error') => void) {
    useEffect(() => {
        const state = location.state && typeof location.state === 'object' ? location.state as Record<string, unknown> : {}
        const citation = parseAssistantCitation(state.assistantCitation)
        if (!citation || citation.sessionId !== sessionId || citation.threadId && citation.threadId !== threadId) return
        let disposed = false, frame = 0, centerFrame = 0, centered = false, userMoved = false, matched = false
        let centerTarget: Node | null = null
        const cancelCentering = () => { userMoved = true }
        let rootOwner: HTMLElement | null = null
        const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights
        const style = document.createElement('style')
        style.textContent = '::highlight(zyra-citation) { background: #e9b64b80; color: inherit; }'
        document.head.append(style)
        const apply = () => {
            frame = 0
            if (disposed) return
            const root = [...document.querySelectorAll<HTMLElement>('[data-assistant-citation-message]')].find(element => element.dataset.assistantCitationMessage === citation.messageId)
            if (!root) return
            if (rootOwner !== root) { observer.disconnect(); observer.observe(root, { subtree: true, childList: true, characterData: true }); rootOwner = root }
            const found = locateAssistantCitation(root.textContent || '', citation)
            if (!found) { highlights?.delete('zyra-citation'); matched = false; return }
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
            let offset = 0, node: Node | null, startNode: Node | null = null, endNode: Node | null = null, startOffset = 0, endOffset = 0
            while ((node = walker.nextNode())) {
                const length = node.textContent?.length || 0
                if (!startNode && found.start < offset + length) { startNode = node; startOffset = found.start - offset }
                if (found.end <= offset + length) { endNode = node; endOffset = found.end - offset; break }
                offset += length
            }
            if (!startNode || !endNode) return
            const range = document.createRange()
            range.setStart(startNode, startOffset); range.setEnd(endNode, endOffset)
            const Highlight = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
            if (highlights && Highlight) highlights.set('zyra-citation', new Highlight(range))
            else if (!matched) { const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range) }
            matched = true
            centerTarget = startNode
            if (!centered) {
                centered = true
                // Let the virtual-list focus owner finish its first reveal. Never
                // recenter on later rendering updates or after user navigation.
                centerFrame = requestAnimationFrame(() => { centerFrame = requestAnimationFrame(() => { centerFrame = 0; if (!disposed && !userMoved) centerTarget?.parentElement?.scrollIntoView({ block: 'center' }) }) })
            }
        }
        const schedule = () => { if (!frame && !disposed) frame = requestAnimationFrame(apply) }
        const observer = new MutationObserver(schedule)
        observer.observe(document.body, { subtree: true, childList: true, characterData: true })
        const trackVirtualRoot = () => {
            if (rootOwner && !rootOwner.isConnected) { rootOwner = null; observer.disconnect(); observer.observe(document.body, { subtree: true, childList: true, characterData: true }); highlights?.delete('zyra-citation'); schedule() }
        }
        window.addEventListener('scroll', trackVirtualRoot, true)
        window.addEventListener('wheel', cancelCentering, true)
        window.addEventListener('touchstart', cancelCentering, true)
        window.addEventListener('pointerdown', cancelCentering, true)
        schedule()
        const timeout = window.setTimeout(() => { if (!matched && !disposed) onUnavailable('The saved quote is intact, but its source passage is unavailable or has changed.', 'error') }, 10_000)
        return () => {
            disposed = true; observer.disconnect(); cancelAnimationFrame(frame); cancelAnimationFrame(centerFrame); clearTimeout(timeout)
            window.removeEventListener('scroll', trackVirtualRoot, true)
            window.removeEventListener('wheel', cancelCentering, true); window.removeEventListener('touchstart', cancelCentering, true); window.removeEventListener('pointerdown', cancelCentering, true)
            highlights?.delete('zyra-citation'); style.remove()
        }
    }, [location.key, location.state, sessionId, threadId, onUnavailable])
}
