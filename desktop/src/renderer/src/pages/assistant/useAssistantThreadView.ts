import { useEffect } from 'react'
import type { AssistantThread } from '@shared/assistant/contracts'

/** Only mounted, focused chat content renews this lease, never sidebar selection. */
export function useAssistantThreadView(thread: AssistantThread | null | undefined): void {
    const threadId = thread?.id
    const turnId = thread?.latestTurn?.id
    const turnState = thread?.latestTurn?.state
    const canonicalId = thread?.providerThreadId
    useEffect(() => {
        const report = window.devscope?.assistant?.setThreadView
        if (!threadId || !report) return
        const update = () => { void report({ threadId, viewing: document.visibilityState === 'visible' && document.hasFocus() }).catch(() => undefined) }
        const hide = () => { void report({ threadId, viewing: false }).catch(() => undefined) }
        update()
        window.addEventListener('focus', update)
        window.addEventListener('blur', update)
        window.addEventListener('pagehide', hide)
        document.addEventListener('visibilitychange', update)
        const timer = window.setInterval(update, 10_000)
        return () => {
            window.clearInterval(timer)
            window.removeEventListener('focus', update)
            window.removeEventListener('blur', update)
            window.removeEventListener('pagehide', hide)
            document.removeEventListener('visibilitychange', update)
            hide()
        }
    }, [threadId, canonicalId, turnId, turnState])
}
