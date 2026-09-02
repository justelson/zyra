import { useEffect, useMemo, useRef, useState } from 'react'
import type { AssistantChatSearchMatch } from '@shared/assistant/contracts'
import {
    canSearchAssistantChatContent,
    parseAssistantChatSearchQuery,
    type ParsedAssistantChatSearchQuery
} from '@shared/assistant/chat-search'

const ASSISTANT_CHAT_SEARCH_DEBOUNCE_MS = 180

type AssistantChatSearchState = ParsedAssistantChatSearchQuery & {
    matches: AssistantChatSearchMatch[]
    pending: boolean
    indexingOlderChats: boolean
    failed: boolean
}

export function useAssistantChatSearch(rawQuery: string, active: boolean): AssistantChatSearchState {
    const parsed = useMemo(() => parseAssistantChatSearchQuery(rawQuery), [rawQuery])
    const [matches, setMatches] = useState<AssistantChatSearchMatch[]>([])
    const [pending, setPending] = useState(false)
    const [indexingOlderChats, setIndexingOlderChats] = useState(false)
    const [failed, setFailed] = useState(false)
    const generationRef = useRef(0)

    useEffect(() => {
        const generation = ++generationRef.current
        if (!active || !canSearchAssistantChatContent(parsed.query)) {
            setMatches([])
            setPending(false)
            setIndexingOlderChats(false)
            setFailed(false)
            return
        }

        setMatches([])
        setIndexingOlderChats(false)
        setFailed(false)
        setPending(true)
        const timer = window.setTimeout(() => {
            void window.devscope.assistant.searchChats({
                query: parsed.query,
                scope: parsed.scope
            }).then((result) => {
                if (generationRef.current !== generation) return
                if (!result.success) throw new Error(result.error)
                setMatches(result.result.matches)
                setIndexingOlderChats(result.result.indexingOlderChats)
            }).catch(() => {
                if (generationRef.current !== generation) return
                setMatches([])
                setIndexingOlderChats(false)
                setFailed(true)
            }).finally(() => {
                if (generationRef.current === generation) setPending(false)
            })
        }, ASSISTANT_CHAT_SEARCH_DEBOUNCE_MS)

        return () => window.clearTimeout(timer)
    }, [active, parsed.query, parsed.scope])

    return {
        query: parsed.query,
        scope: parsed.scope,
        matches,
        pending,
        indexingOlderChats,
        failed
    }
}
