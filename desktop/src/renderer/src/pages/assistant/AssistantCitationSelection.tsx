import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Quote } from 'lucide-react'
import { createPortal } from 'react-dom'
import { assistantStore } from '@/lib/assistant/assistant-store-core'
import { citationContextFile, findAssistantCitationSource, type AssistantCitation } from './assistant-citations'
import { requestAssistantContextFile } from './assistant-code-context'
import { assistantCitationFingerprint } from '@shared/assistant/assistant-citations'

const EXCLUDED = 'button,a,input,textarea,select,[contenteditable="true"],[role="button"],[data-assistant-message-metadata],[data-assistant-message-timestamp],[aria-hidden="true"],[data-citation-controls]'
type Pick = { citation: AssistantCitation; targetChat: string; left: number; top: number }

export function AssistantCitationSelection({ messageId, children }: { messageId: string; children: ReactNode }) {
    const rootRef = useRef<HTMLDivElement>(null)
    const [pick, setPick] = useState<Pick | null>(null)
    const [error, setError] = useState('')
    useEffect(() => {
        const capture = () => {
            const root = rootRef.current
            const selection = window.getSelection()
            if (!root || !selection || selection.isCollapsed || selection.rangeCount !== 1) { setPick(null); return }
            const range = selection.getRangeAt(0)
            if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) { setPick(null); return }
            for (const element of root.querySelectorAll(EXCLUDED)) {
                if (range.intersectsNode(element)) { setPick(null); return }
            }
            const text = range.toString()
            if (!text.trim() || text.length > 8_000) { setPick(null); return }
            const snapshot = assistantStore.getState().snapshot
            const source = findAssistantCitationSource(snapshot, messageId)
            if (!source) { setPick(null); return }
            const before = range.cloneRange()
            before.selectNodeContents(root)
            before.setEnd(range.startContainer, range.startOffset)
            const start = before.toString().length
            const fullText = root.textContent || ''
            const rect = range.getBoundingClientRect()
            setError('')
            setPick({ citation: { version: 1, ...source, messageId, sourceFingerprint: assistantCitationFingerprint(fullText), text, start, end: start + text.length, prefix: fullText.slice(Math.max(0, start - 120), start), suffix: fullText.slice(start + text.length, start + text.length + 120), comment: '' }, targetChat: snapshot.selectedSessionId || source.sessionId, left: Math.max(8, Math.min(rect.left, window.innerWidth - 100)), top: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 44)) })
        }
        const onPointerUp = (event: PointerEvent) => {
            if ((event.target as Element | null)?.closest?.('[data-citation-controls]')) return
            capture()
        }
        const onKeyUp = (event: KeyboardEvent) => {
            if (event.key === 'Escape') { setPick(null); return }
            if (event.shiftKey || event.key.startsWith('Arrow') || event.key === 'Shift') capture()
        }
        // selectionchange clears stale picks without showing a toolbar during dragging.
        const onSelectionChange = () => { if (window.getSelection()?.isCollapsed) setPick(null) }
        document.addEventListener('pointerup', onPointerUp)
        document.addEventListener('keyup', onKeyUp)
        document.addEventListener('selectionchange', onSelectionChange)
        const dismiss = () => setPick(null)
        window.addEventListener('scroll', dismiss, true)
        window.addEventListener('resize', dismiss)
        return () => { document.removeEventListener('pointerup', onPointerUp); document.removeEventListener('keyup', onKeyUp); document.removeEventListener('selectionchange', onSelectionChange); window.removeEventListener('scroll', dismiss, true); window.removeEventListener('resize', dismiss) }
    }, [messageId])
    useEffect(() => { setPick(null) }, [messageId])
    return <>
        <div ref={rootRef} data-assistant-citation-message={messageId}>{children}</div>
        {pick ? createPortal(<div data-citation-controls className="fixed z-[100] rounded-lg border border-white/15 bg-sparkle-card p-1 shadow-xl" style={{ left: pick.left, top: pick.top }}>
            <button type="button" className="flex items-center gap-1 rounded px-2 py-1 text-xs text-sparkle-text hover:bg-white/10" onPointerDown={event => event.preventDefault()} onMouseDown={event => event.preventDefault()} onClick={async () => {
                try { await requestAssistantContextFile(citationContextFile(pick.citation), pick.targetChat); setPick(null); window.getSelection()?.removeAllRanges() }
                catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not attach citation.') }
            }}><Quote size={12} />Cite</button>
            {error ? <span role="alert" className="block max-w-64 p-1 text-xs text-red-300">{error}</span> : null}
        </div>, document.body) : null}
    </>
}
