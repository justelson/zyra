/**
 * Zyra - contextual desktop title bar
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronDown, Copy, Minus, PanelLeftClose, PanelLeftOpen, ShieldAlert, Square, X } from 'lucide-react'
import { useAssistantStoreActions, useAssistantStoreSelector } from '@/lib/assistant/store'
import { useAssistantTitleBarContent, useAssistantTitleBarEndRegion } from '@/lib/assistant/assistant-title-bar'
import { useLoadingScreenActive } from '@/components/ui/LoadingState'
import { useCommandPalette } from '@/lib/commandPalette'
import { useSettings } from '@/lib/settings'
import { TRANSIENT_MENU_DISMISS_EVENT } from '@/lib/transient-menu'
import { findSettingsNavigationItem } from '@/pages/settings/settings-navigation'
import {
    ASSISTANT_LEFT_SIDEBAR_WIDTH_STORAGE_KEY,
    resolveStoredAssistantLeftSidebarWidth
} from '@/pages/assistant/assistant-pane-layout'
import { buildAssistantChatRoute } from '@/pages/assistant/assistant-chat-route'
import { createAssistantChatAndNavigate } from '@/pages/assistant/create-assistant-chat-and-navigate'
import { cn } from '@/lib/utils'
import { useWindowChrome } from '@/lib/useWindowChrome'
import {
    FILE_PREVIEW_FOCUS_STATE_EVENT,
    FILE_PREVIEW_TOGGLE_NAVIGATOR_EVENT,
    type FilePreviewFocusState
} from '@/components/ui/file-preview/filePreviewFocusMode'

type AppNavEntry = { path: string; search: string; sessionId: string | null }
type AppMenuItem = {
    id: string
    label: string
    shortcut?: string
    danger?: boolean
    action: () => void
}

function getAppNavEntryKey(entry: AppNavEntry) {
    return `${entry.path}${entry.search}::${entry.sessionId || ''}`
}

function getContextualTitleParts(pathname: string) {
    if (pathname.startsWith('/settings')) {
        const section = findSettingsNavigationItem(pathname)
        return section.id === 'home' ? ['Settings'] : ['Settings', section.label]
    }
    if (pathname === '/assistant/instructor') return ['Instructor Voice Lab']
    return []
}

export default function TitleBar() {
    const navigate = useNavigate()
    const location = useLocation()
    const commandPalette = useCommandPalette()
    const { settings } = useSettings()
    const { runtime, policy: windowChromePolicy, isMaximized } = useWindowChrome()
    const loadingScreenActive = useLoadingScreenActive()
    const assistantTitleBarContent = useAssistantTitleBarContent()
    const assistantTitleBarEndRegion = useAssistantTitleBarEndRegion()
    const assistantActions = useAssistantStoreActions()
    const selectedAssistantSession = useAssistantStoreSelector((state) => (
        state.snapshot.sessions.find((session) => session.id === state.snapshot.selectedSessionId) || null
    ))
    const selectedSessionId = selectedAssistantSession?.id || null
    const appMenuRootRef = useRef<HTMLDivElement | null>(null)
    const titleBarRootRef = useRef<HTMLDivElement | null>(null)
    const titleBarControlsRef = useRef<HTMLDivElement | null>(null)
    const assistantAppZoneRef = useRef<HTMLDivElement | null>(null)
    const sidebarCollapsedRef = useRef(settings.sidebarCollapsed)
    const sidebarWidthRef = useRef(resolveStoredAssistantLeftSidebarWidth(
        localStorage.getItem(ASSISTANT_LEFT_SIDEBAR_WIDTH_STORAGE_KEY)
    ))
    const pendingNavigationKeyRef = useRef<string | null>(null)
    const [sidebarCollapsed, setSidebarCollapsed] = useState(settings.sidebarCollapsed)
    const [appMenuOpen, setAppMenuOpen] = useState(false)
    const [controlActive, setControlActive] = useState(false)
    const [filePreviewFocusState, setFilePreviewFocusState] = useState<FilePreviewFocusState>({ active: false, leftPanelOpen: false })
    const [appHistory, setAppHistory] = useState<{ entries: AppNavEntry[]; index: number }>({ entries: [], index: -1 })
    const assistantWorkspaceActive = location.pathname.startsWith('/assistant') && location.pathname !== '/assistant/instructor'
    const settingsPageActive = location.pathname.startsWith('/settings')
    const sidebarWorkspaceActive = assistantWorkspaceActive || settingsPageActive
    const contextualTitleParts = getContextualTitleParts(location.pathname)
    const nativeDesktop = runtime.platform !== 'browser'
    const isMac = runtime.platform === 'darwin'
    const desktopWindowControlsAvailable = windowChromePolicy.customWindowControls

    useEffect(() => {
        void window.devscope.agentControl.getState().then((result) => {
            if (result.success) setControlActive(result.state.active || result.state.pairing.state !== 'stopped')
        }).catch(() => undefined)
        return window.devscope.agentControl.onStateChange((state) => setControlActive(state.active || state.pairing.state !== 'stopped'))
    }, [])

    useLayoutEffect(() => {
        const root = titleBarRootRef.current
        const controls = titleBarControlsRef.current
        if (!root || !controls) return
        const syncControlsWidth = () => {
            root.style.setProperty('--zyra-titlebar-controls-width', `${Math.ceil(controls.getBoundingClientRect().width)}px`)
        }
        syncControlsWidth()
        if (typeof ResizeObserver === 'undefined') return
        const observer = new ResizeObserver(syncControlsWidth)
        observer.observe(controls)
        return () => observer.disconnect()
    }, [controlActive, desktopWindowControlsAvailable])

    useEffect(() => {
        sidebarCollapsedRef.current = settings.sidebarCollapsed
        setSidebarCollapsed(settings.sidebarCollapsed)
    }, [settings.sidebarCollapsed])

    useEffect(() => {
        const handleSidebarState = (event: Event) => {
            const detail = (event as CustomEvent<{ collapsed?: boolean; width?: number }>).detail
            if (typeof detail?.collapsed === 'boolean') {
                sidebarCollapsedRef.current = detail.collapsed
                setSidebarCollapsed(detail.collapsed)
            }
            if (typeof detail?.width === 'number' && detail.width > 0) {
                const nextWidth = Math.round(detail.width)
                sidebarWidthRef.current = nextWidth
                if (!sidebarCollapsedRef.current && !filePreviewFocusState.active) {
                    assistantAppZoneRef.current?.style.setProperty('width', `${isMac ? Math.max(184, nextWidth) : nextWidth}px`)
                }
            }
        }

        window.addEventListener('zyra:assistant-sidebar-state', handleSidebarState)
        return () => window.removeEventListener('zyra:assistant-sidebar-state', handleSidebarState)
    }, [filePreviewFocusState.active, isMac])

    useEffect(() => {
        const handleFilePreviewFocusState = (event: Event) => {
            const detail = (event as CustomEvent<FilePreviewFocusState>).detail
            if (!detail || typeof detail.active !== 'boolean' || typeof detail.leftPanelOpen !== 'boolean') return
            setFilePreviewFocusState(detail)
        }
        window.addEventListener(FILE_PREVIEW_FOCUS_STATE_EVENT, handleFilePreviewFocusState)
        return () => window.removeEventListener(FILE_PREVIEW_FOCUS_STATE_EVENT, handleFilePreviewFocusState)
    }, [])

    useEffect(() => {
        const entry: AppNavEntry = {
            path: location.pathname,
            search: location.search,
            sessionId: assistantWorkspaceActive ? selectedSessionId : null
        }
        const key = getAppNavEntryKey(entry)

        if (pendingNavigationKeyRef.current) {
            if (pendingNavigationKeyRef.current === key) pendingNavigationKeyRef.current = null
            return
        }

        setAppHistory((current) => {
            const currentEntry = current.entries[current.index]
            if (currentEntry && getAppNavEntryKey(currentEntry) === key) return current
            const entries = [...current.entries.slice(0, current.index + 1), entry]
            return { entries: entries.slice(-40), index: Math.min(entries.length - 1, 39) }
        })
    }, [assistantWorkspaceActive, location.pathname, location.search, selectedSessionId])

    useEffect(() => {
        if (!appMenuOpen) return

        const dismissAppMenu = () => setAppMenuOpen(false)
        const handlePointerDown = (event: PointerEvent) => {
            if (!appMenuRootRef.current?.contains(event.target as Node)) dismissAppMenu()
        }
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') dismissAppMenu()
        }

        document.addEventListener('pointerdown', handlePointerDown, true)
        window.addEventListener('keydown', handleEscape)
        window.addEventListener('blur', dismissAppMenu)
        window.addEventListener(TRANSIENT_MENU_DISMISS_EVENT, dismissAppMenu)
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown, true)
            window.removeEventListener('keydown', handleEscape)
            window.removeEventListener('blur', dismissAppMenu)
            window.removeEventListener(TRANSIENT_MENU_DISMISS_EVENT, dismissAppMenu)
        }
    }, [appMenuOpen])

    const handleToggleSidebar = () => {
        if (filePreviewFocusState.active) {
            window.dispatchEvent(new Event(FILE_PREVIEW_TOGGLE_NAVIGATOR_EVENT))
            return
        }
        window.dispatchEvent(new CustomEvent('zyra:toggle-assistant-sidebar'))
    }

    const effectiveSidebarOpen = filePreviewFocusState.active ? filePreviewFocusState.leftPanelOpen : !sidebarCollapsed
    const sidebarActionLabel = filePreviewFocusState.active
        ? effectiveSidebarOpen ? 'Hide file navigator' : 'Show file navigator'
        : sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'
    const SidebarIcon = effectiveSidebarOpen ? PanelLeftClose : PanelLeftOpen

    const handleMinimize = () => window.devscope.window.minimize()

    const handleMaximize = () => {
        window.devscope.window.maximize()
    }

    const handleClose = () => window.devscope.window.close()

    const applyNavEntry = (entry: AppNavEntry) => {
        const targetKey = getAppNavEntryKey(entry)
        const currentKey = getAppNavEntryKey({
            path: location.pathname,
            search: location.search,
            sessionId: assistantWorkspaceActive ? selectedSessionId : null
        })
        pendingNavigationKeyRef.current = currentKey === targetKey ? null : targetKey
        if (location.pathname !== entry.path || location.search !== entry.search) {
            navigate(`${entry.path}${entry.search}`)
        }
        if (entry.path.startsWith('/assistant') && entry.sessionId && entry.sessionId !== selectedSessionId) {
            void assistantActions.selectSession(entry.sessionId)
        }
    }

    const navigateHistory = (direction: -1 | 1) => {
        const nextIndex = appHistory.index + direction
        const target = appHistory.entries[nextIndex]
        if (!target) return
        setAppHistory((current) => ({ ...current, index: nextIndex }))
        applyNavEntry(target)
    }

    const canGoBack = appHistory.index > 0
    const canGoForward = appHistory.index >= 0 && appHistory.index < appHistory.entries.length - 1

    useEffect(() => {
        const handleHistoryShortcut = (event: KeyboardEvent) => {
            if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
            if (event.key === 'ArrowLeft' && canGoBack) {
                event.preventDefault()
                navigateHistory(-1)
            } else if (event.key === 'ArrowRight' && canGoForward) {
                event.preventDefault()
                navigateHistory(1)
            }
        }
        window.addEventListener('keydown', handleHistoryShortcut)
        return () => window.removeEventListener('keydown', handleHistoryShortcut)
    })

    const handleNewChat = useCallback(() => {
        if (selectedAssistantSession && selectedAssistantSession.threads.every((thread) => (
            (thread.messageCount || 0) === 0 && !thread.latestTurn
        ))) {
            navigate(buildAssistantChatRoute(selectedAssistantSession.id, selectedAssistantSession.activeThreadId))
            return
        }
        void createAssistantChatAndNavigate(assistantActions, navigate)
    }, [assistantActions, navigate, selectedAssistantSession])

    useEffect(() => window.devscope.window.onAppMenuCommand((command) => {
        if (command === 'new-chat') handleNewChat()
        else if (command === 'search') commandPalette.open()
        else if (command === 'settings') navigate('/settings')
        else if (command === 'about') navigate('/settings/about')
        else if (command === 'reload') window.location.reload()
    }), [commandPalette, handleNewChat, navigate])

    const runAppMenuAction = (action: () => void) => {
        setAppMenuOpen(false)
        action()
    }

    const primaryShortcut = isMac ? '⌘' : 'Ctrl '
    const closeShortcut = isMac ? '⌘W' : 'Alt F4'
    const appMenuGroups: AppMenuItem[][] = [
        [
            { id: 'new-chat', label: 'New chat', shortcut: `${primaryShortcut}N`, action: handleNewChat },
            { id: 'search', label: 'Search', shortcut: `${primaryShortcut}K`, action: commandPalette.open }
        ],
        [
            ...(sidebarWorkspaceActive ? [{ id: 'sidebar', label: sidebarActionLabel, action: handleToggleSidebar }] : []),
            { id: 'settings', label: 'Settings', shortcut: isMac ? '⌘,' : undefined, action: () => navigate('/settings') },
            { id: 'reload', label: 'Reload UI', shortcut: `${primaryShortcut}R`, action: () => window.location.reload() }
        ],
        [
            { id: 'voice-lab', label: 'Instructor Voice Lab', action: () => navigate('/assistant/instructor') },
            { id: 'about', label: 'About Zyra', action: () => navigate('/settings/about') }
        ],
        ...(nativeDesktop ? [[
            { id: 'close', label: 'Close window', shortcut: closeShortcut, danger: true, action: handleClose }
        ]] : [])
    ]

    const expandedSidebar = sidebarWorkspaceActive && !filePreviewFocusState.active && !sidebarCollapsed
    const baseAppZoneWidth = loadingScreenActive && assistantWorkspaceActive
        ? 112
        : expandedSidebar
            ? sidebarWidthRef.current
            : 112
    const appZoneStyle = {
        ...(sidebarWorkspaceActive ? { width: `${isMac ? Math.max(184, baseAppZoneWidth) : baseAppZoneWidth}px` } : {}),
        paddingLeft: isMac ? '76px' : '10px',
        paddingRight: '10px'
    }
    const rightChromeVisible = desktopWindowControlsAvailable || controlActive

    return (
        <div
            ref={titleBarRootRef}
            className={cn(
                'zyra-topbar-surface fixed left-0 right-0 top-0 flex h-[34px] items-center text-sparkle-text',
                appMenuOpen ? 'z-[220]' : 'z-50',
                settingsPageActive && 'zyra-settings-topbar'
            )}
            style={{ WebkitAppRegion: 'drag' } as any}
        >
            <div
                ref={assistantAppZoneRef}
                className={cn(
                    'flex h-full shrink-0 items-center gap-1.5',
                    sidebarWorkspaceActive && !(assistantWorkspaceActive && loadingScreenActive) && 'border-r border-[var(--surface-panel-divider)]'
                )}
                style={appZoneStyle}
            >
                {sidebarWorkspaceActive ? (
                    <button
                        type="button"
                        onClick={handleToggleSidebar}
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center text-sparkle-text-secondary transition-colors hover:text-sparkle-text focus:outline-none focus-visible:text-sparkle-text"
                        style={{ WebkitAppRegion: 'no-drag' } as any}
                        title={sidebarActionLabel}
                        aria-label={sidebarActionLabel}
                        aria-pressed={effectiveSidebarOpen}
                    >
                        <SidebarIcon size={15} strokeWidth={1.7} />
                    </button>
                ) : null}
                <div ref={appMenuRootRef} className="relative h-full" style={{ WebkitAppRegion: 'no-drag' } as any}>
                    <button
                        type="button"
                        onClick={() => setAppMenuOpen((current) => !current)}
                        className={cn(
                            'group inline-flex h-full items-center gap-1 px-2 text-[12px] font-semibold leading-none transition-colors focus:outline-none focus-visible:text-sparkle-text',
                            appMenuOpen ? 'text-sparkle-text' : 'text-sparkle-text-secondary hover:text-sparkle-text'
                        )}
                        aria-haspopup="menu"
                        aria-expanded={appMenuOpen}
                    >
                        <span>Zyra</span>
                        <ChevronDown size={11} className={cn('text-sparkle-text-muted transition-[color,transform] group-hover:text-sparkle-text-secondary', appMenuOpen && 'rotate-180 text-sparkle-text-secondary')} />
                    </button>
                    {appMenuOpen ? (
                        <div className="absolute left-0 top-full z-[190] mt-1 w-[208px] overflow-hidden rounded-xl border border-[var(--surface-divider)] bg-[var(--surface-floating)] p-1 text-[13px] shadow-[0_18px_48px_rgba(0,0,0,0.28)] backdrop-blur-xl" role="menu">
                            {appMenuGroups.map((group, groupIndex) => (
                                <div key={group[0]?.id || groupIndex} className={cn(groupIndex > 0 && 'mt-1 border-t border-[var(--surface-divider)] pt-1')}>
                                    {group.map((item) => (
                                        <button
                                            key={item.id}
                                            type="button"
                                            onClick={() => runAppMenuAction(item.action)}
                                            className={cn(
                                                'flex h-8 w-full items-center gap-3 rounded-lg px-2.5 text-left transition-colors hover:bg-[var(--surface-hover)]',
                                                item.danger ? 'text-red-300 hover:text-red-200' : 'text-sparkle-text-secondary hover:text-sparkle-text'
                                            )}
                                            role="menuitem"
                                        >
                                            <span className="min-w-0 flex-1 truncate">{item.label}</span>
                                            {item.shortcut ? <span className="shrink-0 text-[11px] text-sparkle-text-muted/75">{item.shortcut}</span> : null}
                                        </button>
                                    ))}
                                </div>
                            ))}
                        </div>
                    ) : null}
                </div>
            </div>

            <div
                className="drag-region min-w-0 flex-1 self-stretch"
                style={{
                    paddingRight: rightChromeVisible && assistantWorkspaceActive && !loadingScreenActive && !assistantTitleBarEndRegion?.open
                        ? 'var(--zyra-titlebar-controls-width, 120px)'
                        : undefined
                }}
            >
                {assistantWorkspaceActive && !loadingScreenActive ? assistantTitleBarContent : null}
                {!assistantWorkspaceActive && contextualTitleParts.length > 0 ? (
                    <div className="flex h-full min-w-0 items-center gap-1.5 px-3 text-[12px] leading-none">
                        {contextualTitleParts.map((part, index) => (
                            <span key={part} className={cn('truncate', index === contextualTitleParts.length - 1 ? 'font-semibold text-sparkle-text/90' : 'font-medium text-sparkle-text-muted/70')}>
                                {index > 0 ? <span className="mr-1.5 text-sparkle-text-muted/35">/</span> : null}
                                {part}
                            </span>
                        ))}
                    </div>
                ) : null}
            </div>

            {assistantWorkspaceActive && !loadingScreenActive ? assistantTitleBarEndRegion?.content : null}

            {rightChromeVisible ? (
                <div
                    ref={titleBarControlsRef}
                    className={cn(
                        'flex h-full shrink-0 items-center',
                        assistantWorkspaceActive && 'absolute right-0 top-0 z-[5]'
                    )}
                    style={{ WebkitAppRegion: 'no-drag' } as any}
                >
                    {controlActive ? (
                        <button type="button" onClick={() => void window.devscope.agentControl.emergencyStop()} className="mr-1 inline-flex h-6 items-center gap-1 rounded border border-red-300/20 bg-red-400/[0.08] px-2 text-[9px] text-red-100 hover:bg-red-400/[0.14]" title="Emergency stop all Browser and computer control">
                            <ShieldAlert size={10} /> Stop control
                        </button>
                    ) : null}
                    {desktopWindowControlsAvailable ? (
                        <>
                            <button onClick={handleMinimize} className={cn(windowControlClass, 'hover:bg-[var(--surface-hover)]')} aria-label="Minimize">
                                <Minus size={14} />
                            </button>
                            <button onClick={handleMaximize} className={cn(windowControlClass, 'hover:bg-[var(--surface-hover)]')} aria-label={isMaximized ? 'Restore window' : 'Maximize window'}>
                                {isMaximized ? <Copy size={12} /> : <Square size={12} />}
                            </button>
                            <button onClick={handleClose} className={cn(windowControlClass, 'hover:bg-red-600 hover:text-white')} aria-label="Close">
                                <X size={14} />
                            </button>
                        </>
                    ) : null}
                </div>
            ) : null}
        </div>
    )
}

const windowControlClass = 'inline-flex h-[34px] w-10 items-center justify-center text-sparkle-text-secondary/75 transition-colors hover:text-sparkle-text'
