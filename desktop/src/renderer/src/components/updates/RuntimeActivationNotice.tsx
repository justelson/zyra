import { useEffect, useState } from 'react'
import type { RuntimeActivationStatus } from '@shared/runtime-activation'
const messages = {
    checking: 'Checking the updated runtime…',
    waiting: 'Runtime update waiting. Finish active chats, then try again.',
    restarting: 'Loading the updated runtime…',
    failed: 'Runtime update could not finish. Restart Zyra to try again.'
}
export function RuntimeActivationNotice() {
    const [state, setState] = useState<RuntimeActivationStatus>({ phase: 'idle' })
    useEffect(() => {
        let live = true, received = false
        const api = window.devscope.runtimeActivation
        if (!api) return
        const unsubscribe = api.onStateChange(value => { received = true; if (live) setState(value) })
        void api.getState().then(value => { if (live && !received) setState(value) }).catch(() => {})
        return () => { live = false; unsubscribe() }
    }, [])
    const message = messages[state.phase as keyof typeof messages]
    if (!message) return null
    return <div role="status" className="fixed bottom-5 left-1/2 z-[200] max-w-[90vw] -translate-x-1/2 rounded-xl border border-[var(--surface-border)] bg-[var(--color-card)] px-4 py-3 text-[12px] text-sparkle-text shadow-lg">{message}</div>
}
