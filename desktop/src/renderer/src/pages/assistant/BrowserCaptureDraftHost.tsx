import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAssistantStoreActions } from '@/lib/assistant/assistant-store-hooks'
import { buildAssistantChatRoute } from './assistant-chat-route'
import { createAssistantChatAndNavigate } from './create-assistant-chat-and-navigate'
import { requestAssistantComposerFocus } from './assistant-composer-focus'
import { publishAssistantBrowserAnnotationAttachment } from './assistant-browser-annotation-composer'

/** Receives explicit capture actions across browser windows, even while Settings is open. */
export function BrowserCaptureDraftHost() {
    const actions = useAssistantStoreActions()
    const navigate = useNavigate()
    const chain = useRef(Promise.resolve())
    const delivered = useRef(new Set<string>())
    const destinations = useRef(new Map<string, string>())
    const retry = useRef<() => void>(() => {})
    const [error, setError] = useState<string | null>(null)
    useEffect(() => {
        const drain = async () => {
            while (true) {
                const result = await window.devscope.readBrowserCaptureDraft()
                if (!result.success) throw new Error(result.error || 'Could not receive capture.')
                const draft = result.draft
                if (!draft) break
                if (!delivered.current.has(draft.id)) {
                    let sessionId = destinations.current.get(draft.id) || draft.sessionId
                    if (!sessionId) {
                        const created = await createAssistantChatAndNavigate(actions, navigate)
                        if (!created.success) throw new Error(created.error)
                        sessionId = created.sessionId
                        destinations.current.set(draft.id, sessionId)
                    } else navigate(buildAssistantChatRoute(sessionId, null))
                    publishAssistantBrowserAnnotationAttachment({ ...draft, sessionId, text: draft.sessionId ? undefined : draft.annotation?.comment })
                    requestAssistantComposerFocus(sessionId)
                    delivered.current.add(draft.id)
                }
                const acknowledged = await window.devscope.acknowledgeBrowserCaptureDraft(draft.id)
                if (!acknowledged.success) throw new Error(acknowledged.error || 'Could not finish attaching capture.')
                delivered.current.delete(draft.id)
                destinations.current.delete(draft.id)
            }
            setError(null)
        }
        const run = () => { chain.current = chain.current.then(drain).catch(reason => setError(reason instanceof Error ? reason.message : 'Could not receive capture.')) }
        retry.current = run
        window.addEventListener('zyra:browser-capture-draft', run)
        return () => window.removeEventListener('zyra:browser-capture-draft', run)
    }, [actions, navigate])
    return error ? <div role="alert" className="fixed bottom-4 left-1/2 z-[1000] flex -translate-x-1/2 items-center gap-3 rounded-lg border border-[var(--surface-divider)] bg-[var(--color-card)] p-3 text-xs text-sparkle-text shadow-lg">
        {error}<button type="button" onClick={() => retry.current()} className="text-[var(--accent-primary)]">Retry attachment</button>
    </div> : null
}
