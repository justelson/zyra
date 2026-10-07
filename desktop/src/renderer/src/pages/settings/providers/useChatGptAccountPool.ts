import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatGptAccountsUpdate, ChatGptPoolSnapshot } from '@shared/onboarding/contracts'

export function useChatGptAccountPool() {
    const [snapshot, setSnapshot] = useState<ChatGptPoolSnapshot | null>(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const generation = useRef(0)
    const mutation = useRef(false)
    const refresh = useCallback(async (refreshUsage = false) => {
        if (mutation.current || !window.devscope?.onboarding?.getChatGptAccounts) return
        const request = ++generation.current
        try {
            const result = await window.devscope.onboarding.getChatGptAccounts({ refreshUsage })
            if (request !== generation.current) return
            if (!result.success) throw new Error(result.error)
            setSnapshot(result.pool)
            setError(null)
        } catch (failure) { if (request === generation.current) setError(failure instanceof Error ? failure.message : 'Could not check accounts.') }
    }, [])
    const update = useCallback(async (input: ChatGptAccountsUpdate) => {
        if (mutation.current) return
        mutation.current = true
        ++generation.current
        setBusy(true)
        try {
            const result = await window.devscope.onboarding.updateChatGptAccounts(input)
            if (!result.success) throw new Error(result.error)
            setSnapshot(result.pool)
            setError(null)
        } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not save account preferences.') }
        finally { mutation.current = false; setBusy(false) }
    }, [])
    useEffect(() => {
        void refresh().then(() => refresh(true))
        const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(true) }, 60_000)
        return () => { ++generation.current; window.clearInterval(timer) }
    }, [refresh])
    return { snapshot, busy, error, refresh, update }
}
