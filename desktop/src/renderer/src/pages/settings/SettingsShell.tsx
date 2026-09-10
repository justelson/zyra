import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ArrowLeft, PanelLeftOpen, Pin, Search, X } from 'lucide-react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useSettings } from '@/lib/settings'
import { cn } from '@/lib/utils'
import { captureProductEventOnce } from '@/lib/product-analytics'
import type { AnalyticsEventPropertiesMap } from '@shared/analytics/contracts'
import {
    ASSISTANT_BUBBLE_SIDEBAR_WIDTH,
    ASSISTANT_SIDEBAR_COLLAPSE_MORPH_MS,
    ASSISTANT_SIDEBAR_PREVIEW_CLOSE_MS,
    readAssistantBubblePreviewPinned,
    writeAssistantBubblePreviewPinned
} from '../assistant/assistant-sidebar-preview-state'
import {
    findSettingsDestination,
    findSettingsNavigationItem,
    SETTINGS_DESTINATIONS,
    type SettingsDestination
} from './settings-navigation'
import { SettingsSidebarNavigation } from './SettingsSidebarNavigation'
import { getSettingsSearchKeyAction } from './settings-search-keyboard'
import { preloadSettingsRoute } from './settings-route-loaders'
import {
    findAllSettingsSearchMatches,
    getSettingsSearchTarget,
    isSettingsSearchTargetId,
    resolveSettingsSearchLocation,
    type SettingsSearchTarget
} from './settings-search'

const SETTINGS_SIDEBAR_MIN_WIDTH = 260
const SETTINGS_SIDEBAR_MAX_WIDTH = 420
const SETTINGS_SIDEBAR_WIDTH_KEY = 'assistant-left-sidebar-width'

function clampSidebarWidth(width: number) {
    return Math.max(SETTINGS_SIDEBAR_MIN_WIDTH, Math.min(SETTINGS_SIDEBAR_MAX_WIDTH, Math.round(width || 322)))
}

type SettingsSearchResultGroup = {
    destination: SettingsDestination
    pageMatched: boolean
    targets: SettingsSearchTarget[]
}

function groupSettingsSearchMatches(query: string): SettingsSearchResultGroup[] {
    const groups = new Map<string, SettingsSearchResultGroup>()
    for (const match of findAllSettingsSearchMatches(query)) {
        const group = groups.get(match.destination.id) || {
            destination: match.destination,
            pageMatched: false,
            targets: []
        }
        if (match.target) {
            if (!group.targets.some((target) => target.targetId === match.target?.targetId)) group.targets.push(match.target)
        } else {
            group.pageMatched = true
        }
        groups.set(match.destination.id, group)
    }
    return [...groups.values()]
}

type AnalyticsSettingsSection = NonNullable<AnalyticsEventPropertiesMap['zyra_v1_workspace_ui']['section']>
const analyticsSettingsSections = new Set(SETTINGS_DESTINATIONS.map((destination) => destination.id.replaceAll('-', '_')))

function analyticsSettingsSection(value: string): AnalyticsSettingsSection {
    const normalized = value.replaceAll('-', '_')
    return analyticsSettingsSections.has(normalized) ? normalized as AnalyticsSettingsSection : 'unknown'
}

function SettingsRouteFallback() {
    return (
        <div className="mx-auto w-full max-w-[760px] px-5 pb-16 pt-8 sm:px-10 sm:pt-10" aria-busy="true" aria-label="Opening settings page">
            <div className="space-y-10">
                {[0, 1].map((section) => (
                    <div key={section} className="space-y-2.5">
                        <div className="h-4 w-28 animate-pulse rounded bg-[var(--settings-text-faint)]/12 motion-reduce:animate-none" />
                        <div className="h-28 animate-pulse rounded-xl border border-[var(--settings-border)] bg-[var(--settings-section)] motion-reduce:animate-none" />
                    </div>
                ))}
            </div>
        </div>
    )
}

export default function SettingsShell() {
    const location = useLocation()
    const navigate = useNavigate()
    const { settings, updateSettings } = useSettings()
    const [query, setQuery] = useState('')
    const searchInputRef = useRef<HTMLInputElement | null>(null)
    const searchResultsRef = useRef<HTMLDivElement | null>(null)
    const [sidebarWidth, setSidebarWidth] = useState(() => clampSidebarWidth(Number(localStorage.getItem(SETTINGS_SIDEBAR_WIDTH_KEY))))
    const [resizingSidebar, setResizingSidebar] = useState(false)
    const resizeStateRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)
    const contentScrollRef = useRef<HTMLElement | null>(null)
    const previewCloseTimerRef = useRef<number | null>(null)
    const wasCollapsedRef = useRef(settings.sidebarCollapsed)
    const [previewPinned, setPreviewPinned] = useState(readAssistantBubblePreviewPinned)
    const [previewOpen, setPreviewOpen] = useState(previewPinned)
    const normalizedQuery = query.trim().toLowerCase()
    const activeItem = findSettingsNavigationItem(location.pathname)
    const activeDestination = findSettingsDestination(location.pathname)
    const handleSearchKeyDown = (event: ReactKeyboardEvent, fromInput: boolean) => {
        if (!normalizedQuery || event.metaKey || event.ctrlKey || event.altKey) return
        const links = [...(searchResultsRef.current?.querySelectorAll<HTMLAnchorElement>('[data-settings-search-result]') || [])]
        const action = getSettingsSearchKeyAction(event.key, links.length, links.indexOf(document.activeElement as HTMLAnchorElement), fromInput)
        if (!action) return
        event.preventDefault()
        event.stopPropagation()
        if (action.type === 'clear') { setQuery(''); searchInputRef.current?.focus() }
        else if (action.type === 'activate') links[action.index]?.click()
        else links[action.index]?.focus()
    }
    const activeAnalyticsId = activeDestination?.id || null
    useEffect(() => {
        if (!activeAnalyticsId) return
        captureProductEventOnce(`settings:${activeAnalyticsId}`, {
            event: 'zyra_v1_workspace_ui',
            properties: { action: 'settings_section', section: analyticsSettingsSection(activeAnalyticsId) }
        })
    }, [activeAnalyticsId])

    const requestedSearchTarget = useMemo(() => {
        const value = new URLSearchParams(location.search).get('setting') || ''
        return isSettingsSearchTargetId(value) ? value : null
    }, [location.search])
    const searchResultGroups = useMemo(
        () => normalizedQuery ? groupSettingsSearchMatches(normalizedQuery) : [],
        [normalizedQuery]
    )

    useEffect(() => {
        if (!requestedSearchTarget) return
        const resolved = resolveSettingsSearchLocation(activeDestination?.id || null, requestedSearchTarget)
        if (!resolved || resolved.pathname === location.pathname && resolved.targetId === requestedSearchTarget) return
        const search = new URLSearchParams(location.search)
        search.set('setting', resolved.targetId)
        navigate({ pathname: resolved.pathname, search: `?${search}`, hash: location.hash }, { replace: true, state: location.state })
    }, [activeDestination?.id, location.pathname, location.search, location.hash, location.state, requestedSearchTarget, navigate])

    useLayoutEffect(() => {
        if (requestedSearchTarget) return
        const scrollContainer = contentScrollRef.current
        if (!scrollContainer) return
        scrollContainer.scrollTop = 0
        scrollContainer.scrollLeft = 0
    }, [location.pathname, requestedSearchTarget])

    useEffect(() => {
        if (!requestedSearchTarget) return
        const scrollContainer = contentScrollRef.current
        if (!scrollContainer) return
        const searchTarget = activeDestination
            ? getSettingsSearchTarget(activeDestination.id, requestedSearchTarget)
            : null
        const fallbackTargetId = searchTarget?.sectionTargetId || null
        let frameId = 0
        let clearTimer = 0
        let observer: MutationObserver | null = null
        let highlighted: HTMLElement | null = null
        let previousScrollMarginTop: string | null = null

        const findTarget = (targetId: string | null) => targetId
            ? scrollContainer.querySelector<HTMLElement>(`[data-settings-search-target="${targetId}"]`)
            : null
        const focusTarget = (): boolean => {
            const exactTarget = findTarget(requestedSearchTarget)
            const fallbackTarget = exactTarget ? null : findTarget(fallbackTargetId)
            const target = exactTarget || fallbackTarget
            if (!target) return false
            highlighted = target
            observer?.disconnect()
            target.classList.add('zyra-settings-search-target')
            const sectionTarget = target.tagName === 'SECTION'
            if (sectionTarget) {
                previousScrollMarginTop = target.style.scrollMarginTop
                const navigation = scrollContainer.querySelector<HTMLElement>('nav[aria-label="On this page"]')
                target.style.scrollMarginTop = `${(navigation?.getBoundingClientRect().height || 0) + 12}px`
            }
            target.focus({ preventScroll: true })
            target.scrollIntoView({
                block: sectionTarget ? 'start' : 'center',
                behavior: settings.accessibilityReduceMotion ? 'auto' : 'smooth'
            })
            clearTimer = window.setTimeout(() => target.classList.remove('zyra-settings-search-target'), 2_200)
            return true
        }

        frameId = window.requestAnimationFrame(() => {
            if (focusTarget()) return
            observer = new MutationObserver(() => focusTarget())
            observer.observe(scrollContainer, { childList: true, subtree: true })
        })
        return () => {
            window.cancelAnimationFrame(frameId)
            window.clearTimeout(clearTimer)
            observer?.disconnect()
            highlighted?.classList.remove('zyra-settings-search-target')
            if (highlighted && previousScrollMarginTop !== null) highlighted.style.scrollMarginTop = previousScrollMarginTop
        }
    }, [activeDestination, location.key, requestedSearchTarget, settings.accessibilityReduceMotion])

    useEffect(() => {
        const toggleSidebar = () => updateSettings({ sidebarCollapsed: !settings.sidebarCollapsed })
        window.addEventListener('zyra:toggle-assistant-sidebar', toggleSidebar)
        return () => window.removeEventListener('zyra:toggle-assistant-sidebar', toggleSidebar)
    }, [settings.sidebarCollapsed, updateSettings])

    useEffect(() => {
        window.dispatchEvent(new CustomEvent('zyra:assistant-sidebar-state', {
            detail: { collapsed: settings.sidebarCollapsed, width: sidebarWidth }
        }))
    }, [settings.sidebarCollapsed, sidebarWidth])

    useEffect(() => {
        writeAssistantBubblePreviewPinned(previewPinned)
    }, [previewPinned])

    const openPreview = useCallback(() => {
        if (previewCloseTimerRef.current !== null) {
            window.clearTimeout(previewCloseTimerRef.current)
            previewCloseTimerRef.current = null
        }
        setPreviewOpen(true)
    }, [])

    const schedulePreviewClose = useCallback((delayMs = ASSISTANT_SIDEBAR_PREVIEW_CLOSE_MS) => {
        if (previewPinned) return
        if (previewCloseTimerRef.current !== null) window.clearTimeout(previewCloseTimerRef.current)
        previewCloseTimerRef.current = window.setTimeout(() => {
            previewCloseTimerRef.current = null
            setPreviewOpen(false)
        }, delayMs)
    }, [previewPinned])

    const forceSchedulePreviewClose = useCallback((delayMs = ASSISTANT_SIDEBAR_PREVIEW_CLOSE_MS) => {
        if (previewCloseTimerRef.current !== null) window.clearTimeout(previewCloseTimerRef.current)
        previewCloseTimerRef.current = window.setTimeout(() => {
            previewCloseTimerRef.current = null
            setPreviewOpen(false)
        }, delayMs)
    }, [])

    useEffect(() => {
        if (settings.sidebarHoverPreviewEnabled || previewPinned) return
        if (previewCloseTimerRef.current !== null) {
            window.clearTimeout(previewCloseTimerRef.current)
            previewCloseTimerRef.current = null
        }
        setPreviewOpen(false)
    }, [previewPinned, settings.sidebarHoverPreviewEnabled])

    useEffect(() => {
        const wasCollapsed = wasCollapsedRef.current
        wasCollapsedRef.current = settings.sidebarCollapsed

        if (!settings.sidebarCollapsed) {
            if (previewCloseTimerRef.current !== null) {
                window.clearTimeout(previewCloseTimerRef.current)
                previewCloseTimerRef.current = null
            }
            setPreviewOpen(false)
            setPreviewPinned(false)
            return
        }

        if (!wasCollapsed && settings.sidebarHoverPreviewEnabled) {
            setPreviewOpen(true)
            schedulePreviewClose(ASSISTANT_SIDEBAR_COLLAPSE_MORPH_MS)
        }
    }, [schedulePreviewClose, settings.sidebarCollapsed, settings.sidebarHoverPreviewEnabled])

    const expandCollapsedSidebar = useCallback(() => {
        setPreviewPinned(false)
        window.dispatchEvent(new CustomEvent('zyra:toggle-assistant-sidebar'))
    }, [])

    const togglePreviewPinned = useCallback(() => {
        if (previewPinned) {
            setPreviewPinned(false)
            forceSchedulePreviewClose()
            return
        }
        setPreviewPinned(true)
        openPreview()
    }, [forceSchedulePreviewClose, openPreview, previewPinned])

    const handleResizePointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
        if (settings.sidebarCollapsed || event.button !== 0) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        resizeStateRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: sidebarWidth }
        setResizingSidebar(true)
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
    }, [settings.sidebarCollapsed, sidebarWidth])

    const handleResizePointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
        const resizeState = resizeStateRef.current
        if (!resizeState || resizeState.pointerId !== event.pointerId) return
        event.preventDefault()
        setSidebarWidth(clampSidebarWidth(resizeState.startWidth + event.clientX - resizeState.startX))
    }, [])

    const handleResizePointerEnd = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
        const resizeState = resizeStateRef.current
        if (!resizeState || resizeState.pointerId !== event.pointerId) return
        event.preventDefault()
        resizeStateRef.current = null
        setResizingSidebar(false)
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        const nextWidth = clampSidebarWidth(resizeState.startWidth + event.clientX - resizeState.startX)
        setSidebarWidth(nextWidth)
        localStorage.setItem(SETTINGS_SIDEBAR_WIDTH_KEY, String(nextWidth))
        document.body.style.removeProperty('cursor')
        document.body.style.removeProperty('user-select')
    }, [])

    useEffect(() => () => {
        if (previewCloseTimerRef.current !== null) window.clearTimeout(previewCloseTimerRef.current)
        document.body.style.removeProperty('cursor')
        document.body.style.removeProperty('user-select')
    }, [])

    const sidebarLayoutStyle = {
        width: settings.sidebarCollapsed ? '0px' : `${sidebarWidth}px`
    } as const
    const sidebarSurfaceStyle = settings.sidebarCollapsed
        ? {
            width: `${ASSISTANT_BUBBLE_SIDEBAR_WIDTH}px`,
            opacity: previewOpen ? 1 : 0,
            pointerEvents: previewOpen ? 'auto' : 'none',
            transform: previewOpen ? 'translate3d(0, 0, 0)' : 'translate3d(-18px, 0, 0)',
            transformOrigin: 'left center'
        } as const
        : {
            width: `${sidebarWidth}px`,
            opacity: 1,
            pointerEvents: 'auto',
            transform: 'translate3d(0, 0, 0)',
            transformOrigin: 'left center'
        } as const

    return (
        <div className="zyra-settings-shell flex h-full min-h-0 overflow-hidden bg-[var(--settings-bg)] text-[var(--settings-text)]">
            {settings.sidebarCollapsed && settings.sidebarHoverPreviewEnabled ? (
                <div
                    className="pointer-events-auto fixed bottom-0 left-0 top-[34px] z-[59] w-6"
                    onMouseEnter={openPreview}
                    onMouseLeave={() => schedulePreviewClose()}
                    aria-hidden="true"
                    data-settings-sidebar-peek="true"
                >
                    <div
                        className={cn(
                            'absolute left-1 top-1/2 h-16 w-1.5 -translate-y-1/2 rounded-full border border-[var(--surface-divider)] bg-[var(--surface-scrollbar)] transition-[opacity,transform,background-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
                            previewOpen ? '-translate-x-1 opacity-0' : 'translate-x-0 opacity-100 hover:bg-[var(--surface-scrollbar-hover)]'
                        )}
                    />
                </div>
            ) : null}
            <div
                className={cn(
                    'relative h-full shrink-0 overflow-visible transition-[width] duration-[520ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
                    !settings.sidebarCollapsed && '[contain:layout]',
                    resizingSidebar && 'transition-none'
                )}
                style={sidebarLayoutStyle}
                aria-hidden={settings.sidebarCollapsed && !previewOpen}
            >
                <aside
                    onMouseEnter={() => {
                        if (settings.sidebarCollapsed && settings.sidebarHoverPreviewEnabled) openPreview()
                    }}
                    onMouseLeave={() => {
                        if (settings.sidebarCollapsed && settings.sidebarHoverPreviewEnabled) schedulePreviewClose()
                    }}
                    aria-hidden={settings.sidebarCollapsed && !previewOpen}
                    className={cn(
                        settings.sidebarCollapsed
                            ? 'zyra-sidebar-floating-surface absolute bottom-3 left-2 top-2 z-[60] flex h-auto flex-col overflow-hidden rounded-[22px] transition-[opacity,transform,border-radius,box-shadow,top,bottom,left] duration-[520ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none'
                            : 'zyra-sidebar-surface absolute bottom-0 left-0 top-0 flex h-full flex-col overflow-hidden rounded-none shadow-none [contain:layout_paint] transition-[opacity,transform,border-radius,box-shadow,top,bottom,left] duration-[520ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
                        resizingSidebar && 'transition-none'
                    )}
                    style={sidebarSurfaceStyle}
                    data-settings-sidebar-bubble={settings.sidebarCollapsed ? 'true' : 'false'}
                >
                    <div className="flex h-full flex-col">
                <div className="shrink-0 px-2.5 pb-2 pt-2.5">
                    <div className="flex items-center gap-1">
                    <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-[var(--settings-border)] bg-[var(--settings-control)] px-2 text-[var(--settings-text-muted)] transition-colors hover:border-[var(--settings-border-strong)] focus-within:border-[var(--accent-primary)] focus-within:text-[var(--settings-text-secondary)]">
                        <Search size={13} strokeWidth={1.8} className="shrink-0" />
                        <input
                            ref={searchInputRef}
                            onKeyDown={event => handleSearchKeyDown(event, true)}
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Find settings"
                            aria-label="Find settings"
                            className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--settings-text)] outline-none placeholder:text-[var(--settings-text-faint)]"
                        />
                        {query ? (
                            <button
                                type="button"
                                onClick={() => setQuery('')}
                                className="inline-flex size-5 shrink-0 items-center justify-center rounded text-[var(--settings-text-muted)] hover:bg-[var(--settings-nav-hover)] hover:text-[var(--settings-text)]"
                                aria-label="Clear settings search"
                            >
                                <X size={11} strokeWidth={2} />
                            </button>
                        ) : null}
                    </label>
                    {settings.sidebarCollapsed ? (
                        <div className="flex shrink-0 items-center gap-0.5">
                            <button
                                type="button"
                                onClick={togglePreviewPinned}
                                className={cn(
                                    'inline-flex size-8 items-center justify-center rounded-md text-[var(--settings-text-muted)] transition-colors hover:bg-[var(--settings-nav-hover)] hover:text-[var(--settings-text)]',
                                    previewPinned && 'text-[var(--settings-text-secondary)]'
                                )}
                                title={previewPinned ? 'Unpin bubble sidebar' : 'Pin bubble sidebar'}
                                aria-label={previewPinned ? 'Unpin bubble sidebar' : 'Pin bubble sidebar'}
                                aria-pressed={previewPinned}
                            >
                                <Pin size={14} strokeWidth={1.8} className={cn(previewPinned && 'rotate-45 fill-current')} />
                            </button>
                            <button
                                type="button"
                                onClick={expandCollapsedSidebar}
                                className="inline-flex size-8 items-center justify-center rounded-md text-[var(--settings-text-muted)] transition-colors hover:bg-[var(--settings-nav-hover)] hover:text-[var(--settings-text)]"
                                title="Expand sidebar"
                                aria-label="Expand sidebar"
                            >
                                <PanelLeftOpen size={14} strokeWidth={1.8} />
                            </button>
                        </div>
                    ) : null}
                    </div>
                </div>

                <nav className="settings-sidebar-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3" aria-label="Settings sections">
                    {normalizedQuery ? (
                        searchResultGroups.length ? (
                            <div ref={searchResultsRef} onKeyDown={event => handleSearchKeyDown(event, false)} className="space-y-3 pb-2 pt-1">
                                {searchResultGroups.map((resultGroup) => {
                                    const { destination } = resultGroup
                                    const Icon = destination.icon
                                    const destinationActive = activeDestination?.id === destination.id
                                    return (
                                        <div key={destination.id}>
                                            <Link
                                                to={destination.to}
                                                data-settings-search-result={resultGroup.targets.length === 0 ? 'page' : undefined}
                                                onClick={() => setQuery('')}
                                                onPointerEnter={() => preloadSettingsRoute(destination.to)}
                                                onPointerDown={() => preloadSettingsRoute(destination.to)}
                                                onFocus={() => preloadSettingsRoute(destination.to)}
                                                className="group flex min-h-7 items-center gap-2 rounded-md px-2 text-[11px] font-medium text-[var(--settings-text-muted)] transition-colors hover:bg-[var(--settings-nav-hover)] hover:text-[var(--settings-text)]"
                                            >
                                                <Icon size={14} strokeWidth={1.7} className="shrink-0 text-[var(--settings-text-faint)] group-hover:text-[var(--settings-text-secondary)]" />
                                                <span className="min-w-0 flex-1 truncate">{destination.label}</span>
                                            </Link>
                                            <div className="ml-6 mt-0.5 space-y-px" role="group" aria-label={`${destination.label} results`}>
                                                {resultGroup.targets.map((target) => {
                                                    const targetActive = destinationActive && requestedSearchTarget === target.targetId
                                                    return (
                                                        <Link
                                                            key={`${target.section}:${target.targetId}`}
                                                            to={`${destination.to}?setting=${encodeURIComponent(target.targetId)}`}
                                                            state={{ settingsSearchRequest: target.targetId }}
                                                            data-settings-search-result="target"
                                                            onClick={() => setQuery('')}
                                                            onPointerEnter={() => preloadSettingsRoute(destination.to)}
                                                            onPointerDown={() => preloadSettingsRoute(destination.to)}
                                                            onFocus={() => preloadSettingsRoute(destination.to)}
                                                            aria-current={targetActive ? 'location' : undefined}
                                                            className={cn(
                                                                'block min-h-7 rounded-md px-2 py-1 text-[11px] leading-5 transition-colors',
                                                                targetActive
                                                                    ? 'bg-[var(--settings-nav-active)] font-medium text-[var(--settings-text)]'
                                                                    : 'text-[var(--settings-text)] hover:bg-[var(--settings-nav-hover)]'
                                                            )}
                                                        >
                                                            <span className="block min-w-0 truncate">{target.label}</span>
                                                        </Link>
                                                    )
                                                })}
                                                {resultGroup.targets.length === 0 && resultGroup.pageMatched ? (
                                                    <Link
                                                        to={destination.to}
                                                        onClick={() => setQuery('')}
                                                        className="block min-h-7 truncate rounded-md px-2 py-1 text-[11px] leading-5 text-[var(--settings-text-secondary)] transition-colors hover:bg-[var(--settings-nav-hover)] hover:text-[var(--settings-text)]"
                                                    >
                                                        {destination.description}
                                                    </Link>
                                                ) : null}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        ) : (
                            <div className="px-2 py-6 text-center text-[12px] text-[var(--settings-text-muted)]">No matching settings</div>
                        )
                    ) : null}
                    <SettingsSidebarNavigation hidden={Boolean(normalizedQuery)} preloadRoute={preloadSettingsRoute} />
                </nav>

                <div className="mx-2 mt-auto shrink-0 border-t border-[var(--surface-divider)] pb-2.5 pt-2">
                    <button
                        type="button"
                        onClick={() => navigate('/assistant')}
                        className="group flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-[13px] font-medium text-[var(--settings-text-secondary)] transition-colors hover:bg-[var(--settings-nav-hover)] hover:text-[var(--settings-text)]"
                    >
                        <ArrowLeft size={14} strokeWidth={1.8} className="text-[var(--settings-text-faint)] transition-[color,transform] group-hover:-translate-x-0.5 group-hover:text-[var(--settings-text-secondary)]" />
                        <span className="min-w-0 flex-1 truncate">Back to chats</span>
                    </button>
                </div>
                {!settings.sidebarCollapsed ? (
                    <button
                        type="button"
                        aria-label="Resize settings sidebar"
                        title="Drag to resize sidebar"
                        onPointerDown={handleResizePointerDown}
                        onPointerMove={handleResizePointerMove}
                        onPointerUp={handleResizePointerEnd}
                        onPointerCancel={handleResizePointerEnd}
                        className="absolute inset-y-0 right-0 z-20 w-3 translate-x-1/2 cursor-col-resize touch-none bg-transparent"
                    />
                ) : null}
                    </div>
                </aside>
            </div>

            <section ref={contentScrollRef} className="settings-content-scrollbar min-w-0 flex-1 overflow-y-auto overscroll-contain bg-[var(--settings-bg)]" aria-labelledby="settings-active-page-title">
                <h2 id="settings-active-page-title" className="sr-only">{activeDestination?.label || activeItem.label}</h2>
                <Suspense fallback={<SettingsRouteFallback />}>
                    <Outlet />
                </Suspense>
            </section>
        </div>
    )
}
