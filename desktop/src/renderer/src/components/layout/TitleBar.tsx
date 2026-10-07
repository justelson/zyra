import { resolveShortcut } from '@shared/keybindings'
import { isShortcutRecording, isProtectedShortcutTarget, keyboardInput, shortcutPlatform, useShortcutLabel } from '@/lib/keybindings'
import { AnchoredNativeOverlay } from '@/components/ui/AnchoredNativeOverlay'
import { isOverlayEventInside } from '@/components/ui/native-overlay-portal'
import { addOverlayEventListener, addOverlayWindowBlurListener } from '@/components/ui/native-overlay-portal'
/**
 * Zyra - contextual desktop title bar
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AudioLines, ChevronDown, Copy, Info, Minus, PanelLeftClose, PanelLeftOpen, PanelsTopLeft, Puzzle, RotateCw, Search, Settings2, Square, SquarePen, X } from 'lucide-react'
import { useAssistantStoreActions, useAssistantStoreSelector } from '@/lib/assistant/store'
import { useAssistantTitleBarContent, useAssistantTitleBarEndRegion } from '@/lib/assistant/assistant-title-bar'
import { useLoadingScreenActive } from '@/components/ui/LoadingState'
import { useCommandPalette } from '@/lib/commandPalette'
import { useSettings } from '@/lib/settings'
import { TRANSIENT_MENU_DISMISS_EVENT } from '@/lib/transient-menu'
import { getSettingsLocationTrail } from '@/pages/settings/settings-navigation-context'
import { AccessoriesMenu } from './AccessoriesMenu'
import { AppSubmenu } from './AppSubmenu'
import { openAccessory } from '@/lib/accessories'
import {
    ASSISTANT_LEFT_SIDEBAR_WIDTH_STORAGE_KEY,
    resolveStoredAssistantLeftSidebarWidth
} from '@/pages/assistant/assistant-pane-layout'
import { buildAssistantChatRoute } from '@/pages/assistant/assistant-chat-route'
import { createAssistantChatAndNavigate } from '@/pages/assistant/create-assistant-chat-and-navigate'
import { cn } from '@/lib/utils'
import { AssistantControlStatus } from '@/pages/assistant/AssistantControlStatus'
import type { ControlStateSnapshot } from '@shared/agent-control/contracts'
import { useWindowChrome } from '@/lib/useWindowChrome'
import { useRuntimeConnection } from '@/lib/runtime-connection'
import { isPreviewDistribution } from '@shared/distribution-identity'
import {
    FILE_PREVIEW_FOCUS_STATE_EVENT,
    FILE_PREVIEW_TOGGLE_NAVIGATOR_EVENT,
    type FilePreviewFocusState
} from '@/components/ui/file-preview/filePreviewFocusMode'

type AppNavEntry = { path: string; search: string; sessionId: string | null }
type AppMenuItem = {
    id: string
    label: string
    icon: ReactNode
    shortcut?: string
    danger?: boolean
    action: () => void
}

function getAppNavEntryKey(entry: AppNavEntry) {
    return `${entry.path}${entry.search}::${entry.sessionId || ''}`
}

function getContextualTitleParts(pathname: string) {
    if (pathname.startsWith('/settings')) {
        return getSettingsLocationTrail(pathname)
    }
    if (pathname === '/assistant/instructor') return ['Instructor Voice Lab']
    if (pathname.startsWith('/plugins')) return ['Plugins']
    return []
}

export default function TitleBar() {
    const navigate = useNavigate()
    const location = useLocation()
    const commandPalette = useCommandPalette()
    const shortcut = useShortcutLabel()
    const { settings } = useSettings()
    const { runtime, policy: windowChromePolicy, isMaximized } = useWindowChrome()
    const loadingScreenActive = useLoadingScreenActive()
    const runtimeConnection = useRuntimeConnection()
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
    const [runtimeDetailsOpen, setRuntimeDetailsOpen] = useState(false)
    const [accessoryError, setAccessoryError] = useState<string | null>(null)
    const [controlState, setControlState] = useState<ControlStateSnapshot | null>(null)
    const controlActive = Boolean(controlState?.active || (controlState && controlState.pairing.state !== 'stopped') || controlState?.pendingGrants.length)
    const [filePreviewFocusState, setFilePreviewFocusState] = useState<FilePreviewFocusState>({ active: false, leftPanelOpen: false })
    const [appHistory, setAppHistory] = useState<{ entries: AppNavEntry[]; index: number }>({ entries: [], index: -1 })
    const assistantWorkspaceActive = location.pathname.startsWith('/assistant') && location.pathname !== '/assistant/instructor'
    const settingsPageActive = location.pathname.startsWith('/settings')
    const sidebarWorkspaceActive = assistantWorkspaceActive || settingsPageActive || location.pathname.startsWith('/plugins')
    const contextualTitleParts = getContextualTitleParts(location.pathname)
    const nativeDesktop = runtime.platform !== 'browser'
    const isMac = runtime.platform === 'darwin'
    const desktopWindowControlsAvailable = windowChromePolicy.customWindowControls

    useEffect(() => {
        void window.devscope.agentControl.getState().then((result) => {
            if (result.success) setControlState(result.state)
        }).catch(() => undefined)
        return window.devscope.agentControl.onStateChange(setControlState)
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
            if (!isOverlayEventInside(event, appMenuRootRef.current)) dismissAppMenu()
        }
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !event.defaultPrevented) dismissAppMenu()
        }

        const removeOverlayListener1 = addOverlayEventListener('pointerdown', handlePointerDown, true)
        const removeOverlayListener2 = addOverlayEventListener('keydown', handleEscape)
        const removeOverlayBlurListener4 = addOverlayWindowBlurListener(dismissAppMenu)
        window.addEventListener(TRANSIENT_MENU_DISMISS_EVENT, dismissAppMenu)
        return () => {
            removeOverlayListener1()
            removeOverlayListener2()
            removeOverlayBlurListener4()
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
            if (event.defaultPrevented || isShortcutRecording() || isProtectedShortcutTarget(event)) return
            const command = resolveShortcut(keyboardInput(event), shortcutPlatform(), 'navigation')
            if (command === 'navigation.back' && canGoBack) {
                event.preventDefault()
                navigateHistory(-1)
            } else if (command === 'navigation.forward' && canGoForward) {
                event.preventDefault()
                navigateHistory(1)
            }
        }
        const removeOverlayListener3 = addOverlayEventListener('keydown', handleHistoryShortcut)
        return () => removeOverlayListener3()
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

    const runAppMenuAction = (action: () => void) => {
        setAppMenuOpen(false)
        action()
    }

    const appMenuGroups: AppMenuItem[][] = [
        [
            { id: 'new-chat', label: 'New chat', icon: <SquarePen size={14} />, shortcut: shortcut('app.newChat'), action: handleNewChat },
            { id: 'search', label: 'Search', icon: <Search size={14} />, shortcut: shortcut('app.search').split(' / ')[0], action: commandPalette.open }
        ],
        [
            { id: 'plugins', label: 'Plugins', icon: <Puzzle size={14} />, action: () => navigate('/plugins') },
            { id: 'settings', label: 'Settings', icon: <Settings2 size={14} />, shortcut: shortcut('app.settings'), action: () => navigate('/settings') },
            ...(!nativeDesktop ? [{ id: 'voice-lab', label: 'Voice Lab', icon: <AudioLines size={14} />, action: () => navigate('/assistant/instructor') }] : [])
        ]
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
                        title={`${sidebarActionLabel}${!filePreviewFocusState.active && shortcut('app.sidebar') ? ` (${shortcut('app.sidebar')})` : ''}`}
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
                        <span
                            title={`${runtimeConnection.label} · ${runtimeConnection.detail}`}
                            aria-label={`Zyra · ${runtimeConnection.label} · ${runtimeConnection.detail}`}
                            style={{ color: `var(--status-${runtimeConnection.tone})` }}
                        >{runtimeConnection.state.installation?.kind === 'development' || isPreviewDistribution() ? 'Dev' : 'Zyra'}</span>
                        <ChevronDown size={11} className={cn('text-sparkle-text-muted transition-[color,transform] group-hover:text-sparkle-text-secondary', appMenuOpen && 'rotate-180 text-sparkle-text-secondary')} />
                    </button>
                    {appMenuOpen ? (
                        <AnchoredNativeOverlay><div className="absolute left-0 top-full z-[190] mt-1 w-[208px] overflow-visible rounded-xl border border-[var(--surface-divider)] bg-[var(--surface-floating)] p-1 text-[13px] shadow-[0_18px_48px_rgba(0,0,0,0.28)] backdrop-blur-xl" role="menu">
                            <div
                                className="relative border-b border-[var(--surface-divider)] px-2.5 py-2 text-[11px] text-sparkle-text-muted"
                                role="presentation"
                                onMouseEnter={() => setRuntimeDetailsOpen(true)}
                                onMouseLeave={() => setRuntimeDetailsOpen(false)}
                            >
                                <div className="flex items-center gap-1.5">
                                    <span>{runtimeConnection.state.installation?.kind === 'development' ? 'Dev' : runtimeConnection.label} · {runtimeConnection.detail}</span>
                                    <Info size={11} className={cn('shrink-0 transition-opacity', runtimeDetailsOpen ? 'opacity-85' : 'opacity-45')} aria-label="Show runtime details" />
                                </div>
                                <div className={cn('pointer-events-none absolute left-full top-0 z-[300] ml-2 w-56 rounded-lg border border-[var(--surface-divider)] bg-[var(--surface-floating)] px-2.5 py-2 text-[10px] leading-4 text-sparkle-text-secondary shadow-[0_12px_30px_rgba(0,0,0,0.28)] transition-[opacity,visibility]', runtimeDetailsOpen ? 'visible opacity-100' : 'invisible opacity-0')}>
                                    <div className="font-medium text-sparkle-text">Runtime details</div>
                                    <div>Commit: <span className="font-mono">{runtimeConnection.state.revision || 'Unavailable'}</span></div>
                                    {runtimeConnection.state.instance ? <div>Instance: <span className="font-mono">{runtimeConnection.state.instance.namespaceId.slice(0, 8)} / {runtimeConnection.state.instance.instanceId.slice(0, 8)}</span></div> : null}
                                </div>
                            </div>
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
                                            <span className="inline-flex size-4 shrink-0 items-center justify-center">{item.icon}</span>
                                            <span className="min-w-0 flex-1 truncate">{item.label}</span>
                                            {item.shortcut ? <span className="shrink-0 text-[11px] text-sparkle-text-muted/75">{item.shortcut}</span> : null}
                                        </button>
                                    ))}
                                    {groupIndex === 0 && nativeDesktop ? <AccessoriesMenu onVoiceLab={() => runAppMenuAction(() => navigate('/assistant/instructor'))} onOpen={input => {
                                        setAppMenuOpen(false); setAccessoryError(null)
                                        void openAccessory(input).then(result => { if (!result.success) setAccessoryError(result.error || 'Could not open Accessories.') })
                                    }} /> : null}
                                    {groupIndex === 1 ? <AppSubmenu label="View" icon={<PanelsTopLeft size={14} />} items={[
                                        ...(sidebarWorkspaceActive ? [{ id: 'sidebar', label: sidebarActionLabel, icon: <SidebarIcon size={14} />, onSelect: () => runAppMenuAction(handleToggleSidebar) }] : []),
                                        { id: 'reload', label: `Reload UI${shortcut('app.reload') ? ` (${shortcut('app.reload')})` : ''}`, icon: <RotateCw size={14} />, onSelect: () => runAppMenuAction(() => window.location.reload()) }
                                    ]} /> : null}
                                </div>
                            ))}
                        </div></AnchoredNativeOverlay>
                    ) : null}
                    {accessoryError ? <div role="alert" className="fixed left-3 top-12 z-[220] flex max-w-sm items-center gap-3 rounded-lg border border-[var(--surface-divider)] bg-[var(--surface-floating)] px-3 py-2 text-[12px] text-sparkle-text"><span>{accessoryError}</span><button type="button" aria-label="Dismiss accessory error" onClick={() => setAccessoryError(null)}><X size={13} /></button></div> : null}
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
                    {controlActive ? <AssistantControlStatus state={controlState} /> : null}
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
