import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { resolveAssistantTimelineLatestAction } from './assistant-timeline-latest-policy'

export function useAssistantTimelineLatestNavigation(input: {
    threadId: string | null
    hasNewer: boolean
    scrollRef: RefObject<HTMLDivElement | null>
    loadLatestHistory: (threadId: string) => Promise<boolean>
    onFollowEnd: (animated: boolean) => void
    loadError?: string | null
}) {
    const owner = useRef({ threadId: input.threadId })
    if (owner.current.threadId !== input.threadId) owner.current = { threadId: input.threadId }
    const mounted = useRef(true)
    useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
    const [pendingOwner, setPendingOwner] = useState<typeof owner.current | null>(null)
    const [farFromBottom, setFarFromBottom] = useState(false)
    const measure = useCallback((element: HTMLDivElement) => {
        const next = !resolveAssistantTimelineLatestAction({ hasNewer: false, distanceFromBottom: Math.max(0, element.scrollHeight - element.scrollTop - element.clientHeight), viewportHeight: element.clientHeight }).animated
        setFarFromBottom(current => current === next ? current : next)
    }, [])
    const pending = pendingOwner === owner.current
    const label = pending ? 'Loading latest…' : input.hasNewer && input.loadError ? 'Retry jump to latest' : input.hasNewer || farFromBottom ? 'Jump to latest' : 'Scroll to bottom'
    const onNavigate = useCallback(async () => {
        const element = input.scrollRef.current
        const requestOwner = owner.current
        if (!element || !requestOwner.threadId || pendingOwner === requestOwner) return
        const action = resolveAssistantTimelineLatestAction({ hasNewer: input.hasNewer, distanceFromBottom: Math.max(0, element.scrollHeight - element.scrollTop - element.clientHeight), viewportHeight: element.clientHeight })
        if (input.hasNewer) {
            setPendingOwner(requestOwner)
            try {
                if (!await input.loadLatestHistory(requestOwner.threadId)) return
            } finally { setPendingOwner(current => current === requestOwner ? null : current) }
        }
        if (!mounted.current || owner.current !== requestOwner) return
        window.requestAnimationFrame(() => { if (mounted.current && owner.current === requestOwner) input.onFollowEnd(action.animated) })
    }, [input.hasNewer, input.loadLatestHistory, input.onFollowEnd, input.scrollRef, pendingOwner])
    return { label, pending, measure, onNavigate }
}
