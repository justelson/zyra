import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DevScopeBrowserHistoryEntry } from '@shared/contracts/devscope-api'
import { buildAssistantBrowserOmniboxSuggestions, filterAssistantBrowserHistory } from './assistant-browser-history'

// Keep the last complete menu through debounce and both reads. Partial history
// and Google replies must not independently replace the rows under the pointer.
export function useAssistantBrowserOmniboxSuggestions(query: string, history: DevScopeBrowserHistoryEntry[], googleEnabled: boolean) {
    const [snapshot, setSnapshot] = useState<{ entries: DevScopeBrowserHistoryEntry[]; google: string[] } | null>(null)
    const [loading, setLoading] = useState(false)
    const generation = useRef(0)
    const clear = useCallback(() => {
        generation.current++
        setSnapshot({ entries: [], google: [] })
        setLoading(false)
    }, [])
    useEffect(() => {
        const requestGeneration = ++generation.current
        if (!query) {
            setSnapshot(null)
            setLoading(false)
            return
        }
        let cancelled = false
        setSnapshot(current => current ?? { entries: filterAssistantBrowserHistory(history, query, 24), google: [] })
        setLoading(true)
        const timer = window.setTimeout(() => {
            if (requestGeneration !== generation.current) return
            let entries = filterAssistantBrowserHistory(history, query, 24)
            let google: string[] = []
            const requests: Promise<void>[] = []
            if (typeof window.devscope.getBrowserHistory === 'function') {
                requests.push(window.devscope.getBrowserHistory({ query, limit: 24 }).then(result => {
                    if (result.success) entries = result.entries
                }).catch(() => { /* Local history remains available if the deeper read fails. */ }))
            }
            if (googleEnabled && typeof window.devscope.getBrowserSearchSuggestions === 'function') {
                requests.push(window.devscope.getBrowserSearchSuggestions({ query }).then(result => {
                    if (result.success) google = result.suggestions
                }).catch(() => { /* A failed suggestion read settles as no remote matches. */ }))
            }
            void Promise.allSettled(requests).then(() => {
                if (cancelled || requestGeneration !== generation.current) return
                setSnapshot({ entries, google })
                setLoading(false)
            })
        }, 120)
        return () => {
            generation.current++
            cancelled = true
            window.clearTimeout(timer)
        }
    }, [query, history, googleEnabled])
    const suggestions = useMemo(() => query ? buildAssistantBrowserOmniboxSuggestions(
        googleEnabled ? snapshot?.google || [] : [],
        snapshot?.entries || filterAssistantBrowserHistory(history, query, 24),
        8
    ) : [], [query, history, googleEnabled, snapshot])
    return { suggestions, loading, clear }
}
