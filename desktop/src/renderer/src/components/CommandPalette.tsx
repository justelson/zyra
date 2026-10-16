import { APP_NAVIGATION_COMMANDS, COMMANDS } from '@shared/keybindings'
import type { AssistantAccountOverview, AssistantSession } from '@shared/assistant/contracts'
import type { UsageSummary } from '@shared/assistant/usage-summary'
import type { ChatGptPoolSnapshot } from '@shared/onboarding/contracts'
import { buildAccountUsageResults } from './command-palette-account-usage'
import { subscribeChatGptAccounts } from '@/lib/chatgpt-account-events'
import { dispatchAppNavigation } from '@/lib/app-navigation'
import { useShortcutLabel } from '@/lib/keybindings'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, MessageSquare, Palette, Settings, SquarePen } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useCommandPalette } from '@/lib/commandPalette'
import { getThemePresetAccent, useSettings } from '@/lib/settings'
import { getThemeAppearance, THEMES } from '@/lib/settings-theme-catalog'
import { buildRateLimitCards } from '@/pages/settings/assistant-account-rate-limits'
import { createActiveThemePresetPatch } from '@/pages/settings/appearance/appearance-settings-model'
import { fetchUsageSummary } from '@/pages/settings/usage/useUsageSummary'
import { useAssistantStoreActions, useAssistantStoreSelector } from '@/lib/assistant/assistant-store-hooks'
import { cn } from '@/lib/utils'
import { CommandPaletteResults } from './CommandPaletteResults'
import { findVisibleActions } from './command-palette-visible-actions'
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
import { addOverlayEventListener, getOverlayActiveElement, NativeOverlayPortal } from '@/components/ui/native-overlay-portal'
import { supportsNativeOverlay } from '@/components/ui/native-overlay-host'

const MAX_RECENT_CHATS = 8
const EMPTY_PALETTE_SESSIONS: AssistantSession[] = []
const themeScopePattern = /^theme\s/i
const actionScopePattern = /^action\s/i
const usageScopePattern = /^usage(?:\s|$)/i

export function CommandPalette() {
    const { isOpen, open, close } = useCommandPalette()
    const { settings, updateSettings } = useSettings()
    const shortcut = useShortcutLabel()
    const newChatShortcut = shortcut('app.newChat')
    const settingsShortcut = shortcut('app.settings')
    const navigate = useNavigate()
    const location = useLocation()
    const assistantActions = useAssistantStoreActions()
    const assistantSessions = useAssistantStoreSelector((state) => isOpen ? state.snapshot.sessions : EMPTY_PALETTE_SESSIONS)
    const inputRef = useRef<HTMLInputElement>(null)
    const resultsRef = useRef<HTMLDivElement>(null)
    const previouslyFocusedElementRef = useRef<HTMLElement | null>(null)

    const [query, setQuery] = useState('')
    useEffect(() => {
        const handler = (event: Event) => {
            setQuery((event as CustomEvent<string>).detail || '')
            open()
            window.setTimeout(() => inputRef.current?.focus(), 0)
        }
        window.addEventListener('zyra:palette-query', handler)
        return () => window.removeEventListener('zyra:palette-query', handler)
    }, [open])
    const [accountUsage, setAccountUsage] = useState<AssistantAccountOverview | null>(null)
    const [accountPool, setAccountPool] = useState<ChatGptPoolSnapshot | null>(null)
    const [localUsage, setLocalUsage] = useState<UsageSummary | null>(null)
    const [usageLoading, setUsageLoading] = useState(false)
    const [usageError, setUsageError] = useState<string | null>(null)
    const [selectedIndex, setSelectedIndex] = useState(0)
    const [isClosing, setIsClosing] = useState(false)
    const closeTimerRef = useRef<number | null>(null)
    const activationPendingRef = useRef(false)

    useEffect(() => {
        if (isOpen) {
            previouslyFocusedElementRef.current = getOverlayActiveElement()
            activationPendingRef.current = false
            setIsClosing(false)
            return
        }

        const previouslyFocusedElement = previouslyFocusedElementRef.current
        previouslyFocusedElementRef.current = null
        if (previouslyFocusedElement && !supportsNativeOverlay()) window.setTimeout(() => previouslyFocusedElement.focus(), 0)
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
            if (!supportsNativeOverlay()) window.setTimeout(() => previouslyFocusedElement?.focus(), 0)
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

    const themeScoped = themeScopePattern.test(query)
    const actionScoped = actionScopePattern.test(query)
    const usageScoped = usageScopePattern.test(query)
    const themeTerm = themeScoped ? query.replace(themeScopePattern, '').trim().toLowerCase() : ''
    const actionTerm = actionScoped ? query.replace(actionScopePattern, '').trim().toLowerCase() : ''
    const chatSearch = useAssistantChatSearch(themeScoped || actionScoped || usageScoped ? '' : query, isOpen && !themeScoped && !actionScoped && !usageScoped)
    const deferredSearchTerm = useDeferredValue(chatSearch.query.toLowerCase())
    const localSearchTerm = deferredSearchTerm.replace(/["']/g, '')

    useEffect(() => {
        if (!isOpen || !usageScoped) return
        let disposed = false
        let accountRevision = 0
        const unsubscribeAccounts = subscribeChatGptAccounts(pool => { ++accountRevision; setAccountPool(pool) })
        setUsageLoading(true)
        setUsageError(null)
        setAccountPool(null)
        setAccountUsage(null)
        setLocalUsage(null)
        const localInput = { days: 7 as const, harness: 'zyra' as const, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }
        const loadAccounts = async () => {
            let hasPool = false
            try {
                for (const refreshUsage of [false, true]) {
                    const revision = accountRevision
                    const result = await window.devscope.onboarding.getChatGptAccounts({ refreshUsage })
                    if (disposed) return
                    if (!result.success) throw new Error(result.error)
                    hasPool = true
                    if (revision === accountRevision) setAccountPool(result.pool)
                }
            } catch {
                if (disposed) return
                setUsageError('Could not check all ChatGPT accounts. Open Limits to retry.')
                if (hasPool) return
                // Older bridges expose only the primary subscription overview.
                try {
                    const result = await window.devscope.assistant.getAccountOverview(false)
                    if (!disposed && result.success) setAccountUsage(result.overview)
                } catch { /* The unavailable row remains actionable. */ }
            }
        }
        const loadLocal = async () => {
            try { const summary = await fetchUsageSummary(localInput); if (!disposed) setLocalUsage(summary) }
            catch { if (!disposed) setLocalUsage(null) }
        }
        void Promise.allSettled([loadAccounts(), loadLocal()]).then(() => {
            if (!disposed) setUsageLoading(false)
        })
        return () => { disposed = true; unsubscribeAccounts() }
    }, [isOpen, usageScoped])

    const results = useMemo<Result[]>(() => {
        if (!isOpen) return []
        if (themeScoped) {
            return THEMES.filter(theme => `${theme.name} ${theme.description}`.toLowerCase().includes(themeTerm)).map(theme => ({
                id: `theme-${theme.id}`,
                title: theme.name,
                subtitle: getThemeAppearance(theme.id) === 'dark' ? 'Dark theme' : 'Light theme',
                badge: settings.theme === theme.id && !settings.appearanceCustomThemeActive ? 'Current' : 'Apply',
                icon: <span className="size-3.5 rounded-full border border-white/20" style={{ background: theme.tokens.accent }} />,
                group: 'Themes',
                action: () => { void updateSettings(createActiveThemePresetPatch(settings, getThemeAppearance(theme.id), theme.id, {
                    resolveTheme: () => theme.id,
                    getThemeAppearance,
                    getPresetAccent: getThemePresetAccent
                })) }
            }))
        }
        if (actionScoped) {
            return findVisibleActions()
                .filter(action => `${action.label} ${action.context}`.toLowerCase().includes(actionTerm))
                .slice(0, 40)
                .map((action, index) => ({
                    id: `visible-action-${index}`,
                    title: action.label,
                    subtitle: action.context || 'Current page',
                    icon: <Settings size={14} />,
                    group: 'Current page',
                    action: () => window.setTimeout(() => {
                        if (action.element.isConnected) action.element.click()
                    }, 140)
                }))
        }
        if (usageScoped) {
            const cards = buildRateLimitCards(accountUsage, 'remaining')
            const accountResults: Result[] = accountPool ? buildAccountUsageResults(accountPool, () => navigate('/settings/providers/limits')) : cards.slice(0, 4).map(card => ({
                id: `usage-${card.id}`, title: `${card.bucketLabel} · ${card.durationLabel}`,
                subtitle: card.resetSummary, badge: card.percentLabel,
                detail: <span className="block h-1 w-full max-w-48 overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full bg-[var(--accent-primary)]" style={{ width: `${card.percent}%` }} /></span>,
                icon: <Activity size={14} />, group: 'Subscription limits',
                action: () => navigate('/settings/providers/limits')
            }))
            const localResult: Result = {
                id: 'usage-local', title: 'Zyra activity · last 7 days',
                subtitle: localUsage ? `${localUsage.totals.turns.toLocaleString()} turns` : usageLoading ? 'Loading…' : 'Unavailable',
                badge: localUsage?.totals.meteredTurns ? `${new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(localUsage.totals.tokens)} tokens` : undefined,
                detail: localUsage ? <span className="flex h-4 items-end gap-0.5" aria-label="Token activity over the past seven days">{localUsage.daily.map(day => {
                    const max = Math.max(1, ...localUsage.daily.map(value => value.tokens))
                    return <span key={day.date} className="w-2 rounded-sm bg-[var(--accent-primary)]" style={{ height: `${Math.max(2, Math.round(day.tokens / max * 14))}px` }} title={`${day.date}: ${day.tokens.toLocaleString()} tokens`} />
                })}</span> : undefined,
                icon: <Activity size={14} />, group: 'Local activity',
                action: () => navigate('/settings/providers/usage')
            }
            return [...(accountResults.length ? accountResults : [{ id: 'usage-account-unavailable', title: usageLoading ? 'Checking subscription limits…' : accountPool?.accounts.length === 0 || accountUsage?.requiresOpenaiAuth ? 'Connect ChatGPT to view limits' : 'Subscription limits unavailable', icon: <Activity size={14} />, group: 'ChatGPT accounts', action: () => navigate('/settings/providers/limits') }]), localResult,
                { id: 'usage-details', title: 'Open usage details', subtitle: usageError || 'Full activity and limits', icon: <Settings size={14} />, group: 'Actions', action: () => navigate('/settings/providers/usage') }]
        }
        if (/^theme$/i.test(query.trim())) return [{ id: 'theme-scope', title: 'Choose theme', subtitle: 'Type a space, then a theme name', icon: <Palette size={14} />, group: 'Actions', keepOpen: true, action: () => setQuery('theme ') }]
        if (/^action$/i.test(query.trim())) return [{ id: 'action-scope', title: 'Find an action on this page', subtitle: 'Type a space, then an action name', icon: <Settings size={14} />, group: 'Actions', keepOpen: true, action: () => setQuery('action ') }]
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
            ...APP_NAVIGATION_COMMANDS.map(id => {
                const command = COMMANDS.find(command => command.id === id)!
                return { id: `action-${id}`, title: command.label, subtitle: 'Navigate', badge: shortcut(id) || 'Action', icon: <Settings size={14} />, group: 'Actions', action: () => { previouslyFocusedElementRef.current = null; window.setTimeout(() => dispatchAppNavigation(id, navigate, location.pathname), 140) } }
            }),
            ...COMMANDS.filter(command => {
                const workspace = document.querySelector<HTMLElement>('[data-inspector-workspace]:not([aria-hidden="true"])')?.dataset.inspectorWorkspace
                return command.scope === workspace && (workspace === 'browser' || workspace === 'terminal')
            }).map(command => ({
                id: `action-${command.id}`, title: command.label, subtitle: 'Current workspace',
                badge: shortcut(command.id), icon: <Settings size={14} />, group: 'Actions',
                action: () => window.dispatchEvent(new CustomEvent('zyra:run-scoped-command', { detail: command.id }))
            })),
            {
                id: 'action-new-chat',
                title: 'New chat',
                subtitle: 'Start a blank chat',
                badge: newChatShortcut || 'Action',
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
                badge: settingsShortcut || 'Open',
                icon: <Settings size={14} />,
                group: 'Actions',
                action: () => navigate('/settings')
            }
        ].filter((action) => matchesTerm(action.title, action.subtitle, action.badge))

        return deferredSearchTerm
            ? [...localChats, ...contentChats, ...settingsResults, ...actions]
            : [...localChats, ...actions]
    }, [isOpen, accountUsage, accountPool, actionScoped, actionTerm, assistantActions, assistantSessions, chatSearch.matches, chatSearch.query, chatSearch.scope, deferredSearchTerm, localSearchTerm, localUsage, navigate, newChatShortcut, query, settings, settingsShortcut, shortcut, themeScoped, themeTerm, updateSettings, usageError, usageLoading, usageScoped, location.pathname])

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
            if (result.keepOpen) activationPendingRef.current = false
            else handleClose()
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
            if ((themeScoped || actionScoped) && event.target === inputRef.current && event.key === 'Backspace' && !query.slice(actionScoped ? 7 : 6)) {
                event.preventDefault()
                setQuery(actionScoped ? 'action' : 'theme')
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

        return addOverlayEventListener('keydown', handler)
    }, [actionScoped, handleClose, isOpen, query, results, selectedIndex, selectResult, themeScoped])

    if (!isOpen) return null

    const accessibleSearchStatus = chatSearch.pending
        ? 'Searching chat history.'
        : chatSearch.failed
            ? 'Chat history search is unavailable. Recent results remain available.'
            : `${results.length} result${results.length === 1 ? '' : 's'}${chatSearch.indexingOlderChats ? '. Indexing older chats in the background.' : '.'}`

    return <NativeOverlayPortal focusOnPresent onReady={() => inputRef.current?.focus({ preventScroll: true })}>
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
                <div className="flex min-h-9 items-center px-5">
                {themeScoped || actionScoped ? <span className="mr-2 shrink-0 rounded-md bg-[var(--accent-primary)]/15 px-2 py-0.5 text-[11px] font-medium text-[var(--accent-primary)]">{themeScoped ? 'Theme' : 'Action'}</span> : null}
                <input
                    ref={inputRef}
                    data-native-overlay-autofocus
                    role="combobox"
                    aria-label={themeScoped ? 'Search themes' : actionScoped ? 'Search actions on this page' : 'Search chats, actions, or settings'}
                    aria-autocomplete="list"
                    aria-expanded="true"
                    aria-controls="command-palette-results"
                    aria-activedescendant={results[selectedIndex] ? `command-palette-result-${selectedIndex}` : undefined}
                    value={themeScoped ? query.slice(6) : actionScoped ? query.slice(7) : query}
                    onChange={(event) => setQuery(themeScoped ? `theme ${event.target.value}` : actionScoped ? `action ${event.target.value}` : event.target.value)}
                    placeholder={themeScoped ? 'Search theme names' : actionScoped ? 'Search visible actions' : 'Search chats, actions, or settings'}
                    className="h-9 min-w-0 w-full bg-transparent text-[15px] font-normal text-sparkle-text outline-none placeholder:text-sparkle-text-muted/58"
                />
                </div>
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
    </NativeOverlayPortal>
}

export default CommandPalette
