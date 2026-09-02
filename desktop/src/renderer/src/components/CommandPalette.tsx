import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { MessageSquare, Settings, SquarePen } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useCommandPalette } from '@/lib/commandPalette'
import { useAssistantStoreActions, useAssistantStoreSelector } from '@/lib/assistant/assistant-store-hooks'
import { cn } from '@/lib/utils'
import { CommandPaletteResults } from './CommandPaletteResults'
import { resolveCommandPaletteArrowIndex } from './command-palette-navigation'
import {
    formatAssistantSidebarRelativeTime,
    getProjectLabel,
    getSessionDisplayTitle,
    getSessionLastActivityAt,
    getSortableTimestamp,
    isAssistantDraftSession,
    resolveSessionProjectPath
} from '@/pages/assistant/assistant-sessions-rail-utils'
import type { CommandPaletteResult as Result } from './command-palette-types'
import { buildAssistantChatRoute, buildAssistantMessageSearchRoute } from '@/pages/assistant/assistant-chat-route'
import { createAssistantChatAndNavigate } from '@/pages/assistant/create-assistant-chat-and-navigate'
import { findAllSettingsSearchMatches } from '@/pages/settings/settings-search'
import { preloadSettingsRoute } from '@/pages/settings/settings-route-loaders'
import { useAssistantChatSearch } from '@/lib/assistant/use-assistant-chat-search'

const MAX_RECENT_CHATS = 8

export function CommandPalette() {
    const { isOpen, close } = useCommandPalette()
    const navigate = useNavigate()
    const assistantActions = useAssistantStoreActions()
    const assistantSessions = useAssistantStoreSelector((state) => state.snapshot.sessions)
    const inputRef = useRef<HTMLInputElement>(null)
    const resultsRef = useRef<HTMLDivElement>(null)
    const previouslyFocusedElementRef = useRef<HTMLElement | null>(null)

    const [query, setQuery] = useState('')
    const [selectedIndex, setSelectedIndex] = useState(0)
    const [isClosing, setIsClosing] = useState(false)
    const closeTimerRef = useRef<number | null>(null)
    const activationPendingRef = useRef(false)

    useEffect(() => {
        if (isOpen) {
            previouslyFocusedElementRef.current = document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null
            activationPendingRef.current = false
            setIsClosing(false)
            window.setTimeout(() => inputRef.current?.focus(), 10)
            return
        }

        const previouslyFocusedElement = previouslyFocusedElementRef.current
        previouslyFocusedElementRef.current = null
        if (previouslyFocusedElement) window.setTimeout(() => previouslyFocusedElement.focus(), 0)
        setIsClosing(false)
        setQuery('')
        setSelectedIndex(0)
        if (closeTimerRef.current) {
            window.clearTimeout(closeTimerRef.current)
            closeTimerRef.current = null
        }
    }, [isOpen])

    const handleClose = useCallback(() => {
        if (isClosing) return
        setIsClosing(true)
        if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current)
        closeTimerRef.current = window.setTimeout(() => {
            closeTimerRef.current = null
            const previouslyFocusedElement = previouslyFocusedElementRef.current
            previouslyFocusedElementRef.current = null
            close()
            window.setTimeout(() => previouslyFocusedElement?.focus(), 0)
        }, 120)
    }, [close, isClosing])

    useEffect(() => {
        return () => {
            if (closeTimerRef.current) {
                window.clearTimeout(closeTimerRef.current)
                closeTimerRef.current = null
            }
        }
    }, [])

    const chatSearch = useAssistantChatSearch(query, isOpen)
    const deferredSearchTerm = useDeferredValue(chatSearch.query.toLowerCase())
    const localSearchTerm = deferredSearchTerm.replace(/["']/g, '')

    const results = useMemo<Result[]>(() => {
        const matchesTerm = (...values: Array<string | undefined | null>) => {
            if (!localSearchTerm) return true
            return values.some((value) => String(value || '').toLowerCase().includes(localSearchTerm))
        }

        const localChats = assistantSessions
            .filter((session: any) => {
                if (isAssistantDraftSession(session)) return false
                if (chatSearch.scope === 'archived') return session.archived
                if (chatSearch.scope === 'all') return true
                return !session.archived
            })
            .map((session: any) => {
                const projectPath = resolveSessionProjectPath(session)
                const projectLabel = projectPath ? getProjectLabel(projectPath) : 'chat'
                const lastActivityAt = getSessionLastActivityAt(session)
                return { session, title: getSessionDisplayTitle(session), projectLabel, lastActivityAt }
            })
            .filter((entry) => matchesTerm(entry.title, entry.projectLabel))
            .sort((left, right) => getSortableTimestamp(right.lastActivityAt) - getSortableTimestamp(left.lastActivityAt))
            .slice(0, deferredSearchTerm ? 16 : MAX_RECENT_CHATS)
            .map(({ session, title, projectLabel, lastActivityAt }) => {
                const contentMatch = chatSearch.matches.find((match) => match.sessionId === session.id)
                return {
                    id: `chat-${session.id}`,
                    title,
                    subtitle: projectLabel,
                    badge: formatAssistantSidebarRelativeTime(contentMatch?.createdAt || lastActivityAt),
                    contentMatch: contentMatch ? {
                        source: contentMatch.role,
                        snippet: contentMatch.snippet,
                        query: chatSearch.query
                    } : undefined,
                    icon: <MessageSquare size={14} />,
                    group: deferredSearchTerm ? 'Chats' : 'Recent chats',
                    action: () => contentMatch
                        ? navigate(buildAssistantMessageSearchRoute(contentMatch.sessionId, contentMatch.threadId, contentMatch.messageId))
                        : navigate(buildAssistantChatRoute(session.id, session.activeThreadId || null))
                }
            })

        const localChatIds = new Set(localChats.map((result) => result.id.slice('chat-'.length)))
        const contentChats: Result[] = deferredSearchTerm
            ? chatSearch.matches
                .filter((match) => !localChatIds.has(match.sessionId))
                .map((match) => ({
                    id: `chat-content-${match.sessionId}-${match.messageId}`,
                    title: match.title,
                    subtitle: match.projectPath ? getProjectLabel(match.projectPath) : 'chat',
                    badge: formatAssistantSidebarRelativeTime(match.createdAt),
                    contentMatch: {
                        source: match.role,
                        snippet: match.snippet,
                        query: chatSearch.query
                    },
                    icon: <MessageSquare size={14} />,
                    group: 'Chats',
                    action: () => navigate(buildAssistantMessageSearchRoute(match.sessionId, match.threadId, match.messageId))
                }))
            : []

        const settingsResults: Result[] = deferredSearchTerm
            ? findAllSettingsSearchMatches(deferredSearchTerm).map((match) => {
                const DestinationIcon = match.destination.icon
                const targetUrl = match.target
                    ? `${match.destination.to}?setting=${encodeURIComponent(match.target.targetId)}`
                    : match.destination.to
                return {
                    id: `setting-${match.destination.id}-${match.target?.targetId || 'page'}`,
                    title: match.target?.label || match.destination.label,
                    subtitle: match.target
                        ? `${match.destination.label} · ${match.target.section}`
                        : match.destination.description,
                    badge: match.target ? 'Setting' : 'Page',
                    icon: <DestinationIcon size={14} />,
                    group: 'Settings',
                    action: () => {
                        preloadSettingsRoute(match.destination.to)
                        navigate(targetUrl)
                    }
                }
            })
            : []

        const actions: Result[] = [
            {
                id: 'action-new-chat',
                title: 'New chat',
                subtitle: 'Start a blank chat',
                badge: 'Action',
                icon: <SquarePen size={14} />,
                group: 'Actions',
                action: () => {
                    void createAssistantChatAndNavigate(assistantActions, navigate)
                }
            },
            {
                id: 'action-settings',
                title: 'Settings',
                subtitle: 'Browse app preferences',
                badge: 'Open',
                icon: <Settings size={14} />,
                group: 'Actions',
                action: () => navigate('/settings')
            }
        ].filter((action) => matchesTerm(action.title, action.subtitle, action.badge))

        return deferredSearchTerm
            ? [...localChats, ...contentChats, ...settingsResults, ...actions]
            : [...localChats, ...actions]
    }, [assistantActions, assistantSessions, chatSearch.matches, chatSearch.query, chatSearch.scope, deferredSearchTerm, localSearchTerm, navigate])

    useEffect(() => {
        setSelectedIndex(0)
    }, [deferredSearchTerm])

    useEffect(() => {
        setSelectedIndex((current) => Math.min(current, Math.max(results.length - 1, 0)))
    }, [results.length])

    useEffect(() => {
        if (!isOpen || results.length === 0) return
        const activeOption = resultsRef.current?.querySelector<HTMLElement>(
            `#command-palette-result-${selectedIndex}`
        )
        activeOption?.scrollIntoView({ block: 'nearest' })
    }, [isOpen, results.length, selectedIndex])

    const selectResult = useCallback((result?: Result) => {
        if (!result || activationPendingRef.current) return
        activationPendingRef.current = true
        try {
            result.action()
        } finally {
            handleClose()
        }
    }, [handleClose])

    useEffect(() => {
        if (!isOpen) return

        const handler = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault()
                handleClose()
                return
            }
            if (event.key === 'Tab') {
                event.preventDefault()
                inputRef.current?.focus()
                return
            }
            if (event.target !== inputRef.current) return
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                const direction = event.key === 'ArrowDown' ? 'ArrowDown' : 'ArrowUp'
                setSelectedIndex((current) => resolveCommandPaletteArrowIndex(current, direction, results.length))
                return
            }
            if (event.key === 'Enter') {
                event.preventDefault()
                selectResult(results[selectedIndex])
                return
            }
        }

        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [handleClose, isOpen, results, selectedIndex, selectResult])

    if (!isOpen) return null

    const accessibleSearchStatus = chatSearch.pending
        ? 'Searching chat history.'
        : chatSearch.failed
            ? 'Chat history search is unavailable. Recent results remain available.'
            : `${results.length} result${results.length === 1 ? '' : 's'}${chatSearch.indexingOlderChats ? '. Indexing older chats in the background.' : '.'}`

    return (
        <div
            className={cn(
                'fixed inset-0 z-[60] flex items-start justify-center bg-sparkle-bg/70 px-3 pt-[18vh] backdrop-blur-sm sm:px-6',
                isClosing ? 'animate-command-palette-backdrop-out' : 'animate-command-palette-backdrop-in'
            )}
            onClick={handleClose}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="command-palette-title"
                className={cn(
                    'relative flex w-full max-w-[600px] flex-col overflow-hidden rounded-xl border border-sparkle-border bg-sparkle-card py-2 shadow-[0_22px_70px_-34px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.04)]',
                    isClosing ? 'animate-command-palette-out' : 'animate-command-palette-in'
                )}
                onClick={(event) => event.stopPropagation()}
            >
                <h2 id="command-palette-title" className="sr-only">Search Zyra</h2>
                <input
                    ref={inputRef}
                    role="combobox"
                    aria-label="Search chats, actions, or settings"
                    aria-autocomplete="list"
                    aria-expanded="true"
                    aria-controls="command-palette-results"
                    aria-activedescendant={results[selectedIndex] ? `command-palette-result-${selectedIndex}` : undefined}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search chats, actions, or settings"
                    className="h-9 w-full bg-transparent px-5 text-[15px] font-normal text-sparkle-text outline-none placeholder:text-sparkle-text-muted/58"
                />
                <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
                    {accessibleSearchStatus}
                </div>

                <div
                    ref={resultsRef}
                    id="command-palette-results"
                    role="listbox"
                    aria-label="Search results"
                    className="custom-scrollbar relative flex max-h-[380px] flex-col overflow-y-auto px-1 pb-1"
                >
                    <CommandPaletteResults
                        query={query}
                        results={results}
                        selectedIndex={selectedIndex}
                        setSelectedIndex={setSelectedIndex}
                        selectResult={selectResult}
                        loading={chatSearch.pending}
                        searchFailed={chatSearch.failed}
                        indexingOlderChats={chatSearch.indexingOlderChats}
                    />
                </div>
            </div>
        </div>
    )
}

export default CommandPalette
