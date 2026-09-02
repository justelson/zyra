import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Bot, ChevronDown, Copy, Folder, MoreHorizontal, PanelLeftOpen, Pin, Plus, Search, Settings, SquarePen, Trash2, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { AssistantMessage, AssistantSession, AssistantThread } from '@shared/assistant/contracts'
import { useCommandPalette } from '@/lib/commandPalette'
import { AnimatedHeight } from '@/components/ui/AnimatedHeight'
import { FileActionsMenu, type FileActionsMenuItem } from '@/components/ui/FileActionsMenu'
import { useLoadingScreenActive } from '@/components/ui/LoadingState'
import { cn } from '@/lib/utils'
import { preloadSettingsRoute } from '../settings/settings-route-loaders'
import type { AssistantToastInput } from './AssistantPageHelpers'
import { AssistantAgentInboxSidebar } from './AssistantAgentInboxSidebar'
import { AssistantProjectIcon } from './AssistantProjectIcon'
import { AssistantSessionTitleText } from './AssistantSessionTitleText'
import { AssistantTuiPresenceIndicator } from './AssistantTuiPresenceIndicator'
import { hasAssistantTuiPresence, isAssistantSessionOpenInTui } from './assistant-tui-presence'
import { RenameSessionModal } from './AssistantSessionsRailDialogs'
import { ASSISTANT_MAX_LEFT_SIDEBAR_WIDTH, ASSISTANT_MIN_LEFT_SIDEBAR_WIDTH, resolveAssistantLeftSidebarWidth } from './assistant-pane-layout'
import {
    ASSISTANT_BUBBLE_SIDEBAR_WIDTH,
    ASSISTANT_SIDEBAR_COLLAPSE_MORPH_MS,
    ASSISTANT_SIDEBAR_PREVIEW_CLOSE_MS
} from './assistant-sidebar-preview-state'
import { createSessionActionMenuItems } from './assistant-sessions-rail-menus'
import { isAssistantDraftSession, resolveAssistantProjectPresentation, resolveAssistantThreadStatusPill, resolveSessionProjectPath } from './assistant-sessions-rail-utils'
import { useAssistantRailContextMenu } from './useAssistantRailContextMenu'

const PINNED_SESSION_IDS_KEY = 'assistant:pinned-session-ids:v1'
const EXPANDED_PROJECT_PATH_KEYS_KEY = 'assistant:expanded-project-path-keys:v1'

function readPinnedSessionIds(): Set<string> {
    try {
        const parsed = JSON.parse(localStorage.getItem(PINNED_SESSION_IDS_KEY) || '[]') as unknown
        if (!Array.isArray(parsed)) return new Set()
        return new Set(parsed.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))
    } catch {
        return new Set()
    }
}

function writePinnedSessionIds(ids: Set<string>): void {
    try {
        localStorage.setItem(PINNED_SESSION_IDS_KEY, JSON.stringify(Array.from(ids)))
    } catch {
        // Keep pinning useful in-memory even when storage fails.
    }
}

function getProjectExpansionKey(path: string): string {
    return String(path || '').trim().replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase()
}

function hasStoredExpandedProjectPathKeys(): boolean {
    try {
        return localStorage.getItem(EXPANDED_PROJECT_PATH_KEYS_KEY) !== null
    } catch {
        return false
    }
}

function readExpandedProjectPathKeys(): Set<string> {
    try {
        const parsed = JSON.parse(localStorage.getItem(EXPANDED_PROJECT_PATH_KEYS_KEY) || '[]') as unknown
        if (!Array.isArray(parsed)) return new Set()
        return new Set(parsed.map((value) => getProjectExpansionKey(String(value || ''))).filter(Boolean))
    } catch {
        return new Set()
    }
}

function writeExpandedProjectPathKeys(keys: Set<string>): void {
    try {
        localStorage.setItem(EXPANDED_PROJECT_PATH_KEYS_KEY, JSON.stringify(Array.from(keys)))
    } catch {
        // Keep project expansion usable in-memory even when storage fails.
    }
}

function getSortableTimestamp(value?: string | null): number {
    const timestamp = Date.parse(String(value || ''))
    return Number.isFinite(timestamp) ? timestamp : 0
}

function formatRelativeTime(value?: string | null): string {
    const timestamp = getSortableTimestamp(value)
    if (!timestamp) return ''

    const deltaMs = Math.max(0, Date.now() - timestamp)
    if (deltaMs < 60_000) return 'now'

    const minutes = Math.floor(deltaMs / 60_000)
    if (minutes < 60) return `${minutes}m`

    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h`

    const days = Math.floor(hours / 24)
    if (days < 7) return `${days}d`

    const weeks = Math.floor(days / 7)
    if (weeks < 5) return `${weeks}w`

    const months = Math.floor(days / 30)
    if (months < 12) return `${months}mo`

    return `${Math.floor(days / 365)}y`
}

function getThreadLastActivityAt(thread: AssistantThread | null): string {
    if (!thread) return ''

    const latestMessageAt = (thread.messages || []).reduce<string | null>((latest, message: AssistantMessage) => {
        if (message.role === 'system') return latest
        const messageAt = message.createdAt || message.updatedAt
        if (!messageAt) return latest
        if (!latest) return messageAt
        return getSortableTimestamp(messageAt) > getSortableTimestamp(latest) ? messageAt : latest
    }, null)

    return latestMessageAt
        || thread.latestTurn?.completedAt
        || thread.latestTurn?.startedAt
        || thread.latestTurn?.requestedAt
        || thread.updatedAt
        || thread.createdAt
}

function getSessionLastActivityAt(session: AssistantSession): string {
    const threadMessageAt = session.threads.reduce<string | null>((latest, thread) => {
        const messageAt = getThreadLastActivityAt(thread)
        if (!latest) return messageAt
        return getSortableTimestamp(messageAt) > getSortableTimestamp(latest) ? messageAt : latest
    }, null)
    return threadMessageAt || session.updatedAt || session.createdAt
}

function isDefaultSessionTitle(title?: string | null): boolean {
    const normalized = String(title || '').trim().toLowerCase()
    return !normalized || normalized === 'new session' || normalized === 'new playground chat'
}

function deriveTitleFromMessage(text?: string | null): string {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim()
    return normalized ? normalized.slice(0, 60) : 'New chat'
}

function getSessionDisplayTitle(session: AssistantSession): string {
    if (!isDefaultSessionTitle(session.title)) return String(session.title).trim()

    const firstUserMessage = session.threads
        .flatMap((thread) => thread.messages || [])
        .find((message) => message.role === 'user' && String(message.text || '').trim().length > 0)

    return firstUserMessage ? deriveTitleFromMessage(firstUserMessage.text) : 'New chat'
}

function getThreadDisplayTitle(thread: AssistantThread, index: number): string {
    if (thread.source === 'subagent') return thread.agentNickname || thread.agentRole || `Subagent ${index + 1}`
    return index === 0 ? 'Main thread' : `Thread ${index + 1}`
}

function getPrimaryThread(session: AssistantSession): AssistantThread | null {
    return session.threads.find((thread) => thread.source !== 'subagent') || session.threads[0] || null
}

function getSessionStatusThread(session: AssistantSession): AssistantThread | null {
    return session.threads.find((thread) => thread.id === session.activeThreadId) || getPrimaryThread(session)
}

function compareSessionsByCreatedAtDescending(left: AssistantSession, right: AssistantSession): number {
    const createdDelta = getSortableTimestamp(right.createdAt) - getSortableTimestamp(left.createdAt)
    return createdDelta || left.id.localeCompare(right.id)
}

function getSessionProjectPath(session: AssistantSession): string {
    return resolveSessionProjectPath(session)
}

function getProjectLabel(path: string): string {
    const normalized = path.replace(/[\\/]+$/g, '')
    const label = normalized.split(/[\\/]/).filter(Boolean).pop()
    return label || normalized || 'Project'
}

type ProjectGroup = {
    path: string
    label: string
    projectIconPath: string | null
    projectType: string | null
    framework: string | null
    sessions: AssistantSession[]
    newestCreatedAt: string
}

export const AssistantChatSessionsRail = memo(function AssistantChatSessionsRail(props: {
    collapsed: boolean
    width: number
    maxWidth?: number
    previewPinned: boolean
    hoverPreviewEnabled?: boolean
    agentInboxEnabled: boolean
    projectIconOverrides: Record<string, string>
    sessions: AssistantSession[]
    activeSessionId: string | null
    activeThreadId: string | null
    commandPending: boolean
    pendingControlThreadIds: ReadonlySet<string>
    onCreateChat: () => Promise<void> | void
    onCreateProjectChat: (projectPath?: string) => Promise<void> | void
    onSelectSession: (sessionId: string) => Promise<void> | void
    onSelectThread: (input: { sessionId: string; threadId: string }) => Promise<void> | void
    onRenameSession: (sessionId: string, title: string) => Promise<void> | void
    onArchiveSession: (sessionId: string, archived?: boolean) => Promise<void> | void
    onDeleteSession: (sessionId: string) => Promise<{ success: true } | { success: false; error: string }>
    onWidthChange?: (width: number) => void
    onPreviewPinnedChange: (pinned: boolean) => void
    onShowToast: (input: AssistantToastInput) => void
}) {
    const {
        collapsed,
        width,
        maxWidth = ASSISTANT_MAX_LEFT_SIDEBAR_WIDTH,
        previewPinned,
        hoverPreviewEnabled = true,
        agentInboxEnabled,
        projectIconOverrides,
        sessions,
        activeSessionId,
        activeThreadId,
        commandPending,
        pendingControlThreadIds,
        onCreateChat,
        onCreateProjectChat,
        onSelectSession,
        onSelectThread,
        onRenameSession,
        onArchiveSession,
        onDeleteSession,
        onWidthChange,
        onPreviewPinnedChange,
        onShowToast
    } = props
    const navigate = useNavigate()
    const { open } = useCommandPalette()
    const { openContextMenu, contextMenuPortal } = useAssistantRailContextMenu()
    const resizeStateRef = useRef<{ pointerId: number; startX: number; startWidth: number; width: number } | null>(null)
    const resizeFrameRef = useRef(0)
    const layoutShellRef = useRef<HTMLDivElement | null>(null)
    const sidebarSurfaceRef = useRef<HTMLElement | null>(null)
    const previewCloseTimerRef = useRef<number | null>(null)
    const wasCollapsedRef = useRef(collapsed)
    const shouldBootstrapProjectExpansionRef = useRef<boolean | null>(null)
    const didMountProjectExpansionPersistenceRef = useRef(false)
    if (shouldBootstrapProjectExpansionRef.current === null) {
        shouldBootstrapProjectExpansionRef.current = !hasStoredExpandedProjectPathKeys()
    }
    const [isResizing, setIsResizing] = useState(false)
    const loadingScreenActive = useLoadingScreenActive()
    const [previewOpen, setPreviewOpen] = useState(previewPinned)
    const [pendingDeleteSession, setPendingDeleteSession] = useState<AssistantSession | null>(null)
    const [renameTarget, setRenameTarget] = useState<AssistantSession | null>(null)
    const [renameDraft, setRenameDraft] = useState('')
    const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null)
    const [pinnedSessionIds, setPinnedSessionIds] = useState<Set<string>>(() => readPinnedSessionIds())
    const [expandedProjectPathKeys, setExpandedProjectPathKeys] = useState<Set<string>>(() => readExpandedProjectPathKeys())

    const activeSessions = useMemo(() => (
        sessions
            .filter((session) => !session.archived && !isAssistantDraftSession(session))
            .sort(compareSessionsByCreatedAtDescending)
    ), [sessions])

    const pinnedSessions = useMemo(() => (
        activeSessions.filter((session) => pinnedSessionIds.has(session.id))
    ), [activeSessions, pinnedSessionIds])

    const chatSessions = useMemo(() => (
        activeSessions.filter((session) => !pinnedSessionIds.has(session.id) && !getSessionProjectPath(session))
    ), [activeSessions, pinnedSessionIds])

    const projectGroups = useMemo<ProjectGroup[]>(() => {
        const groupsByPath = new Map<string, ProjectGroup>()
        for (const session of activeSessions) {
            if (pinnedSessionIds.has(session.id)) continue
            const projectPath = getSessionProjectPath(session)
            if (!projectPath) continue
            const existing = groupsByPath.get(projectPath)
            if (existing) {
                existing.sessions.push(session)
                if (getSortableTimestamp(session.createdAt) > getSortableTimestamp(existing.newestCreatedAt)) {
                    existing.newestCreatedAt = session.createdAt
                }
                continue
            }
            const projectPresentation = resolveAssistantProjectPresentation(projectPath, projectIconOverrides)
            groupsByPath.set(projectPath, {
                path: projectPath,
                label: getProjectLabel(projectPath),
                projectIconPath: projectPresentation.projectIconPath,
                projectType: projectPresentation.projectType,
                framework: projectPresentation.framework,
                sessions: [session],
                newestCreatedAt: session.createdAt
            })
        }
        return Array.from(groupsByPath.values())
            .sort((left, right) => (
                getSortableTimestamp(right.newestCreatedAt) - getSortableTimestamp(left.newestCreatedAt)
                || left.path.localeCompare(right.path)
            ))
    }, [activeSessions, pinnedSessionIds, projectIconOverrides])

    const resolvedMaxWidth = Math.max(
        ASSISTANT_MIN_LEFT_SIDEBAR_WIDTH,
        Math.min(ASSISTANT_MAX_LEFT_SIDEBAR_WIDTH, Math.round(maxWidth))
    )
    const resolvedWidth = resolveAssistantLeftSidebarWidth(width, resolvedMaxWidth)
    const renderedWidth = resizeStateRef.current?.width ?? resolvedWidth
    const layoutShellStyle = {
        width: loadingScreenActive || collapsed ? '0px' : `${renderedWidth}px`,
        willChange: 'width'
    } as const
    const sidebarStyle = loadingScreenActive
        ? {
            width: `${renderedWidth}px`,
            opacity: 0,
            pointerEvents: 'none',
            transform: 'translate3d(-18px, 0, 0)',
            transformOrigin: 'left center',
            willChange: 'opacity, transform'
        } as const
        : collapsed
        ? {
            width: `${ASSISTANT_BUBBLE_SIDEBAR_WIDTH}px`,
            opacity: previewOpen ? 1 : 0,
            pointerEvents: previewOpen ? 'auto' : 'none',
            transform: previewOpen ? 'translate3d(0, 0, 0)' : 'translate3d(-18px, 0, 0)',
            transformOrigin: 'left center',
            willChange: 'opacity, transform'
        } as const
        : {
            width: `${renderedWidth}px`,
            opacity: 1,
            pointerEvents: 'auto',
            transform: 'translate3d(0, 0, 0)',
            transformOrigin: 'left center',
            willChange: 'width, opacity'
        } as const

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const isModifier = event.ctrlKey || event.metaKey
            if (!isModifier || event.key.toLowerCase() !== 'n') return
            event.preventDefault()
            if (commandPending) return
            if (event.shiftKey) {
                void onCreateProjectChat()
                return
            }
            void onCreateChat()
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [commandPending, onCreateChat, onCreateProjectChat])

    const publishLiveSidebarWidth = useCallback((nextWidth: number) => {
        window.dispatchEvent(new CustomEvent('zyra:assistant-sidebar-state', {
            detail: { width: nextWidth }
        }))
    }, [])

    const applyLiveSidebarWidth = useCallback((nextWidth: number) => {
        layoutShellRef.current?.style.setProperty('width', `${nextWidth}px`)
        sidebarSurfaceRef.current?.style.setProperty('width', `${nextWidth}px`)
        publishLiveSidebarWidth(nextWidth)
    }, [publishLiveSidebarWidth])

    const stopResize = useCallback((pointerId: number, handle?: HTMLButtonElement | null) => {
        const resizeState = resizeStateRef.current
        if (!resizeState) return
        resizeStateRef.current = null
        if (resizeFrameRef.current) window.cancelAnimationFrame(resizeFrameRef.current)
        resizeFrameRef.current = 0
        applyLiveSidebarWidth(resizeState.width)
        layoutShellRef.current?.style.removeProperty('transition')
        sidebarSurfaceRef.current?.style.removeProperty('transition')
        setIsResizing(false)
        onWidthChange?.(resizeState.width)
        if (handle?.hasPointerCapture(pointerId)) {
            handle.releasePointerCapture(pointerId)
        }
        document.body.style.removeProperty('cursor')
        document.body.style.removeProperty('user-select')
    }, [applyLiveSidebarWidth, onWidthChange])

    const handleResizePointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
        if (collapsed || !onWidthChange || event.button !== 0) return
        event.preventDefault()
        event.stopPropagation()
        layoutShellRef.current?.style.setProperty('transition', 'none')
        sidebarSurfaceRef.current?.style.setProperty('transition', 'none')
        resizeStateRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startWidth: resolvedWidth,
            width: resolvedWidth
        }
        setIsResizing(true)
        event.currentTarget.setPointerCapture(event.pointerId)
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
    }, [collapsed, onWidthChange, resolvedWidth])

    const handleResizePointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
        const resizeState = resizeStateRef.current
        if (!resizeState || resizeState.pointerId !== event.pointerId || !onWidthChange) return
        event.preventDefault()
        resizeState.width = Math.max(
            ASSISTANT_MIN_LEFT_SIDEBAR_WIDTH,
            Math.min(resolvedMaxWidth, Math.round(resizeState.startWidth + (event.clientX - resizeState.startX)))
        )
        if (resizeFrameRef.current) return
        resizeFrameRef.current = window.requestAnimationFrame(() => {
            resizeFrameRef.current = 0
            const latest = resizeStateRef.current
            if (latest) applyLiveSidebarWidth(latest.width)
        })
    }, [applyLiveSidebarWidth, onWidthChange, resolvedMaxWidth])

    const handleResizePointerEnd = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
        const resizeState = resizeStateRef.current
        if (!resizeState || resizeState.pointerId !== event.pointerId) return
        event.preventDefault()
        stopResize(event.pointerId, event.currentTarget)
    }, [stopResize])

    useEffect(() => {
        return () => {
            resizeStateRef.current = null
            if (resizeFrameRef.current) window.cancelAnimationFrame(resizeFrameRef.current)
            resizeFrameRef.current = 0
            layoutShellRef.current?.style.removeProperty('transition')
            sidebarSurfaceRef.current?.style.removeProperty('transition')
            if (previewCloseTimerRef.current !== null) window.clearTimeout(previewCloseTimerRef.current)
            document.body.style.removeProperty('cursor')
            document.body.style.removeProperty('user-select')
        }
    }, [])

    const togglePinnedSession = (session: AssistantSession) => {
        setPinnedSessionIds((current) => {
            const next = new Set(current)
            const pinned = next.has(session.id)
            if (pinned) next.delete(session.id)
            else next.add(session.id)
            writePinnedSessionIds(next)
            onShowToast({ message: pinned ? 'Unpinned chat' : 'Pinned chat' })
            return next
        })
    }

    const renameSession = async (session: AssistantSession) => {
        setRenameTarget(session)
        setRenameDraft(getSessionDisplayTitle(session))
    }

    const closeRename = () => {
        setRenameTarget(null)
        setRenameDraft('')
    }

    const submitRename = async () => {
        if (!renameTarget) return
        const nextTitle = renameDraft.replace(/\s+/g, ' ').trim().slice(0, 60)
        if (!nextTitle) return
        if (nextTitle !== getSessionDisplayTitle(renameTarget)) {
            await onRenameSession(renameTarget.id, nextTitle)
        }
        closeRename()
    }

    const archiveSession = async (session: AssistantSession) => {
        await onArchiveSession(session.id, true)
        onShowToast({ message: `Archived "${getSessionDisplayTitle(session)}"` })
    }

    const deleteSession = async (session: AssistantSession) => {
        setPendingDeleteSession(session)
    }

    const getSessionMenuItems = (session: AssistantSession): FileActionsMenuItem[] => (
        createSessionActionMenuItems({
            session,
            pinned: pinnedSessionIds.has(session.id),
            onOpenRename: (target) => { void renameSession(target) },
            onTogglePinned: () => togglePinnedSession(session),
            onArchiveSession: () => { void archiveSession(session) },
            onDeleteRequest: (target) => { void deleteSession(target) }
        })
    )

    const getProjectMenuItems = (group: ProjectGroup, expanded: boolean): FileActionsMenuItem[] => [
        {
            id: 'new-chat',
            label: 'New chat in project',
            icon: <SquarePen size={13} />,
            onSelect: () => onCreateProjectChat(group.path)
        },
        {
            id: 'copy-path',
            label: 'Copy project path',
            icon: <Copy size={13} />,
            onSelect: () => {
                void navigator.clipboard?.writeText(group.path)
                onShowToast({ message: 'Project path copied' })
            }
        },
        {
            id: 'toggle-project',
            label: expanded ? 'Collapse project' : 'Expand project',
            icon: <ChevronDown size={13} className={cn(!expanded && '-rotate-90')} />,
            onSelect: () => toggleProject(group.path, expanded)
        }
    ]

    const openSessionContextMenu = (
        event: ReactMouseEvent<HTMLElement>,
        session: AssistantSession,
        items = getSessionMenuItems(session)
    ) => {
        openContextMenu(event, `${getSessionDisplayTitle(session)} actions`, items)
    }

    const openProjectContextMenu = (event: ReactMouseEvent<HTMLElement>, group: ProjectGroup, expanded: boolean) => {
        openContextMenu(event, `${group.label} actions`, getProjectMenuItems(group, expanded))
    }

    const confirmDeleteSession = async () => {
        if (!pendingDeleteSession || deletingSessionId) return
        const session = pendingDeleteSession
        const title = getSessionDisplayTitle(session)
        try {
            setDeletingSessionId(session.id)
            const result = await onDeleteSession(session.id)
            if (!result.success) {
                onShowToast({ message: `Failed to delete "${title}": ${result.error}`, tone: 'error' })
                return
            }
            setPendingDeleteSession(null)
            onShowToast({ message: `Deleted "${title}"` })
        } finally {
            setDeletingSessionId(null)
        }
    }

    const cancelDeleteSession = () => {
        if (deletingSessionId) return
        setPendingDeleteSession(null)
    }

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

    useEffect(() => {
        if (hoverPreviewEnabled || previewPinned) return
        if (previewCloseTimerRef.current !== null) {
            window.clearTimeout(previewCloseTimerRef.current)
            previewCloseTimerRef.current = null
        }
        setPreviewOpen(false)
    }, [hoverPreviewEnabled, previewPinned])

    useEffect(() => {
        const wasCollapsed = wasCollapsedRef.current
        wasCollapsedRef.current = collapsed

        if (!collapsed) {
            if (previewCloseTimerRef.current !== null) {
                window.clearTimeout(previewCloseTimerRef.current)
                previewCloseTimerRef.current = null
            }
            setPreviewOpen(false)
            onPreviewPinnedChange(false)
            return
        }

        if (!wasCollapsed && collapsed && !loadingScreenActive && hoverPreviewEnabled) {
            setPreviewOpen(true)
            schedulePreviewClose(ASSISTANT_SIDEBAR_COLLAPSE_MORPH_MS)
        }
    }, [collapsed, hoverPreviewEnabled, loadingScreenActive, onPreviewPinnedChange, schedulePreviewClose])

    const expandCollapsedSidebar = () => {
        onPreviewPinnedChange(false)
        window.dispatchEvent(new CustomEvent('zyra:toggle-assistant-sidebar'))
    }

    const forceSchedulePreviewClose = (delayMs = ASSISTANT_SIDEBAR_PREVIEW_CLOSE_MS) => {
        if (previewCloseTimerRef.current !== null) window.clearTimeout(previewCloseTimerRef.current)
        previewCloseTimerRef.current = window.setTimeout(() => {
            previewCloseTimerRef.current = null
            setPreviewOpen(false)
        }, delayMs)
    }

    const togglePreviewPinned = () => {
        if (previewPinned) {
            onPreviewPinnedChange(false)
            forceSchedulePreviewClose()
            return
        }
        onPreviewPinnedChange(true)
        openPreview()
    }

    const toggleProject = (path: string, currentlyExpanded: boolean) => {
        const projectKey = getProjectExpansionKey(path)
        if (!projectKey) return
        shouldBootstrapProjectExpansionRef.current = false

        if (currentlyExpanded) {
            setExpandedProjectPathKeys((current) => {
                if (!current.has(projectKey)) return current
                const next = new Set(current)
                next.delete(projectKey)
                return next
            })
            return
        }

        setExpandedProjectPathKeys((current) => {
            if (current.has(projectKey)) return current
            const next = new Set(current)
            next.add(projectKey)
            return next
        })
    }

    useEffect(() => {
        if (!didMountProjectExpansionPersistenceRef.current) {
            didMountProjectExpansionPersistenceRef.current = true
            return
        }
        writeExpandedProjectPathKeys(expandedProjectPathKeys)
    }, [expandedProjectPathKeys])

    useEffect(() => {
        if (!shouldBootstrapProjectExpansionRef.current) return
        const activeProjectPath = projectGroups.find((group) => (
            group.sessions.some((session) => session.id === activeSessionId)
        ))?.path
        if (!activeProjectPath) return

        shouldBootstrapProjectExpansionRef.current = false
        const projectKey = getProjectExpansionKey(activeProjectPath)
        if (!projectKey) return

        setExpandedProjectPathKeys((current) => {
            if (current.has(projectKey)) return current
            const next = new Set(current)
            next.add(projectKey)
            return next
        })
    }, [activeSessionId, projectGroups])

    const collapsedPreviewControls = collapsed ? (
        <div className="flex shrink-0 items-center gap-0.5">
            <button
                type="button"
                onClick={togglePreviewPinned}
                className={cn(
                    'inline-flex size-8 items-center justify-center rounded-md text-sparkle-text-muted transition-colors hover:bg-[var(--surface-hover)] hover:text-sparkle-text',
                    previewPinned && 'text-sparkle-text-secondary'
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
                className="inline-flex size-8 items-center justify-center rounded-md text-sparkle-text-muted transition-colors hover:bg-[var(--surface-hover)] hover:text-sparkle-text"
                title="Expand sidebar"
                aria-label="Expand sidebar"
            >
                <PanelLeftOpen size={14} strokeWidth={1.8} />
            </button>
        </div>
    ) : null

    const baseSidebarActions = (
        <div className="shrink-0 space-y-0.5 px-0.5 pb-3">
            <div className="flex items-center gap-1">
                <div className="min-w-0 flex-1">
                    <RailButton
                        icon={<SquarePen size={15} strokeWidth={1.7} />}
                        label="New chat"
                        shortcut="Ctrl N"
                        disabled={commandPending}
                        onClick={() => void onCreateChat()}
                    />
                </div>
                {collapsedPreviewControls}
            </div>
            <RailButton
                icon={<NewProjectIcon />}
                label="New project"
                shortcut="Ctrl Shift N"
                disabled={commandPending}
                onClick={() => void onCreateProjectChat()}
            />
            <RailButton
                icon={<Search size={15} strokeWidth={1.7} />}
                label="Search"
                shortcut="Ctrl K"
                onClick={open}
            />
        </div>
    )

    return (
        <>
            {collapsed && hoverPreviewEnabled && !loadingScreenActive ? (
                <div
                    className="group/sidebar-peek pointer-events-auto fixed bottom-0 left-0 top-[34px] z-[59] w-4"
                    onMouseEnter={openPreview}
                    onMouseLeave={() => schedulePreviewClose()}
                    aria-hidden="true"
                >
                    <div
                        className={cn(
                            'absolute inset-y-0 left-0 w-px bg-transparent transition-colors duration-150 group-hover/sidebar-peek:bg-[var(--surface-panel-divider)]',
                            previewOpen && 'opacity-0'
                        )}
                    />
                </div>
            ) : null}
            <div
                ref={layoutShellRef}
                className={cn(
                    'relative h-full shrink-0 overflow-visible transition-[width] duration-[520ms] ease-[cubic-bezier(0.22,1,0.36,1)]',
                    !collapsed && !loadingScreenActive && '[contain:layout]',
                    (isResizing || loadingScreenActive) && 'transition-none'
                )}
                style={layoutShellStyle}
                aria-hidden={loadingScreenActive || (collapsed && !previewOpen)}
            >
                <aside
                    ref={sidebarSurfaceRef}
                    onMouseEnter={() => {
                        if (collapsed && hoverPreviewEnabled) openPreview()
                    }}
                    onMouseLeave={() => {
                        if (collapsed && hoverPreviewEnabled) schedulePreviewClose()
                    }}
                    className={cn(
                        collapsed
                            ? 'zyra-sidebar-floating-surface absolute bottom-3 left-2 top-2 z-[60] h-auto overflow-hidden rounded-[22px] transition-[opacity,transform,border-radius,box-shadow,top,bottom,left] duration-[520ms] ease-[cubic-bezier(0.22,1,0.36,1)]'
                            : 'zyra-sidebar-surface absolute bottom-0 left-0 top-0 h-full overflow-hidden rounded-none shadow-none [contain:layout_paint] transition-[opacity,transform,border-radius,box-shadow,top,bottom,left] duration-[520ms] ease-[cubic-bezier(0.22,1,0.36,1)]',
                        (isResizing || loadingScreenActive) && 'transition-none'
                    )}
                    style={sidebarStyle}
                    aria-hidden={loadingScreenActive || (collapsed && !previewOpen)}
                >
            <div className="flex h-full flex-col px-2 py-2.5">
                {agentInboxEnabled ? (
                    <AssistantAgentInboxSidebar
                        sessions={sessions}
                        activeSessionId={activeSessionId}
                        activeThreadId={activeThreadId}
                        commandPending={commandPending}
                        pendingControlThreadIds={pendingControlThreadIds}
                        projectIconOverrides={projectIconOverrides}
                        headerActions={baseSidebarActions}
                        onCreateProjectChat={onCreateProjectChat}
                        onSelectSession={onSelectSession}
                        onRename={renameSession}
                        getSessionMenuItems={getSessionMenuItems}
                        onOpenContextMenu={openSessionContextMenu}
                    />
                ) : (
                    <>
                {baseSidebarActions}

                <div className="assistant-chat-scrollbar assistant-sidebar-scrollbar min-h-0 flex-1 overflow-y-scroll overflow-x-hidden pr-0.5">
                    {pinnedSessions.length > 0 ? (
                        <SidebarSection label="Pinned" className="mt-1">
                            {pinnedSessions.map((session) => (
                                <ChatRow
                                    key={session.id}
                                    session={session}
                                    activeSessionId={activeSessionId}
                                    activeThreadId={activeThreadId}
                                    commandPending={commandPending}
                                    pendingControlThreadIds={pendingControlThreadIds}
                                    onSelectSession={onSelectSession}
                                    onSelectThread={onSelectThread}
                                    onRename={renameSession}
                                    onOpenContextMenu={openSessionContextMenu}
                                    menuItems={getSessionMenuItems(session)}
                                />
                            ))}
                        </SidebarSection>
                    ) : null}

                    <SidebarSection label="Chats" className={pinnedSessions.length > 0 ? 'mt-4' : 'mt-1'}>
                        {chatSessions.length > 0 ? (
                            chatSessions.map((session) => (
                                <ChatRow
                                    key={session.id}
                                    session={session}
                                    activeSessionId={activeSessionId}
                                    activeThreadId={activeThreadId}
                                    commandPending={commandPending}
                                    pendingControlThreadIds={pendingControlThreadIds}
                                    onSelectSession={onSelectSession}
                                    onSelectThread={onSelectThread}
                                    onRename={renameSession}
                                    onOpenContextMenu={openSessionContextMenu}
                                    menuItems={getSessionMenuItems(session)}
                                />
                            ))
                        ) : (
                            <div className="flex h-[30px] min-w-0 items-center rounded-[10px] px-2.5 text-[13px] leading-none text-sparkle-text-secondary/50">
                                <span className="min-w-0 truncate">No chats yet</span>
                            </div>
                        )}
                    </SidebarSection>

                    {projectGroups.length > 0 ? (
                        <SidebarSection
                            label="Projects"
                            className={chatSessions.length > 0 || pinnedSessions.length > 0 ? 'mt-4' : 'mt-1'}
                            childrenClassName="space-y-0.5 pl-1 pr-0.5"
                        >
                            {projectGroups.map((group) => {
                                const expanded = expandedProjectPathKeys.has(getProjectExpansionKey(group.path))
                                return (
                                    <div key={group.path} className="space-y-0.5">
                                        <div
                                            role="button"
                                            tabIndex={0}
                                            aria-expanded={expanded}
                                            onClick={() => toggleProject(group.path, expanded)}
                                            onContextMenu={(event) => openProjectContextMenu(event, group, expanded)}
                                            onKeyDown={(event) => {
                                                if (event.key !== 'Enter' && event.key !== ' ') return
                                                event.preventDefault()
                                                toggleProject(group.path, expanded)
                                            }}
                                            className={cn(
                                                'group/project-header flex h-7 min-w-0 cursor-pointer items-center gap-1 rounded-[10px] pl-1.5 pr-1 transition-colors hover:bg-[var(--surface-hover)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]/35'
                                            )}
                                            title={group.path}
                                        >
                                            <div
                                                className="flex min-w-0 flex-1 items-center gap-2 text-left text-[13px] leading-none text-sparkle-text-secondary transition-colors group-hover/project-header:text-sparkle-text focus:outline-none"
                                            >
                                                <AssistantProjectIcon
                                                    projectPath={group.path}
                                                    projectIconPath={group.projectIconPath}
                                                    projectType={group.projectType}
                                                    framework={group.framework}
                                                    size={14}
                                                    expanded={expanded}
                                                />
                                                <span className="flex min-w-0 items-center gap-1.5">
                                                    <span className="block min-w-0 truncate font-medium" title={group.label}>{group.label}</span>
                                                    <ChevronDown size={12} className={cn('shrink-0 text-sparkle-text-muted/55 transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/project-header:text-sparkle-text-muted/85', !expanded && '-rotate-90')} />
                                                </span>
                                            </div>
                                            <div className="ml-1 flex shrink-0 items-center gap-0.5 text-sparkle-text-muted/65 opacity-70 transition-opacity group-hover/project-header:opacity-100 focus-within:opacity-100">
                                                <FileActionsMenu
                                                    items={getProjectMenuItems(group, expanded)}
                                                    title={`${group.label} actions`}
                                                    triggerIcon={<MoreHorizontal size={14} />}
                                                    presentation="portal"
                                                    buttonClassName="h-6 w-6 rounded-[7px] border-transparent bg-transparent p-0 text-sparkle-text-muted/65 hover:border-transparent hover:bg-[var(--surface-hover)] hover:text-sparkle-text"
                                                    openButtonClassName="rounded-[7px] border-transparent bg-[var(--surface-hover)] p-0 text-sparkle-text"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={(event) => {
                                                        event.stopPropagation()
                                                        void onCreateProjectChat(group.path)
                                                    }}
                                                    className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-[7px] border border-transparent bg-transparent p-0 text-sparkle-text-muted/58 transition-colors hover:bg-[var(--surface-hover)] hover:text-sparkle-text focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]/35"
                                                    title="New chat in project"
                                                >
                                                    <SquarePen size={13} />
                                                </button>
                                            </div>
                                        </div>
                                        <AnimatedHeight isOpen={expanded}>
                                            <div className="ml-5 space-y-0.5 py-1">
                                                {group.sessions.map((session) => (
                                                    <ChatRow
                                                        key={session.id}
                                                        session={session}
                                                        activeSessionId={activeSessionId}
                                                        activeThreadId={activeThreadId}
                                                        commandPending={commandPending}
                                                        pendingControlThreadIds={pendingControlThreadIds}
                                                        compact
                                                        projectNested
                                                        onSelectSession={onSelectSession}
                                                        onSelectThread={onSelectThread}
                                                        onRename={renameSession}
                                                        onOpenContextMenu={openSessionContextMenu}
                                                        menuItems={getSessionMenuItems(session)}
                                                    />
                                                ))}
                                            </div>
                                        </AnimatedHeight>
                                    </div>
                                )
                            })}
                        </SidebarSection>
                    ) : null}
                </div>
                    </>
                )}

                <div className="mt-auto shrink-0 border-t border-[var(--surface-divider)] pt-2">
                    <button
                        type="button"
                        onPointerEnter={() => preloadSettingsRoute('/settings/general')}
                        onFocus={() => preloadSettingsRoute('/settings/general')}
                        onClick={() => navigate('/settings')}
                        className={cn(
                            'group flex h-8 w-full cursor-pointer items-center text-sparkle-text-secondary transition-colors hover:bg-[var(--surface-hover)] hover:text-sparkle-text focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]/35',
                            agentInboxEnabled ? 'gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-sparkle-text-muted/80' : 'gap-2.5 rounded-lg px-2.5 text-[13px] leading-none'
                        )}
                    >
                        <Settings size={agentInboxEnabled ? 18 : 15} strokeWidth={1.75} className="text-sparkle-text-secondary/70 transition-colors group-hover:text-sparkle-text" />
                        <span className="truncate">Settings</span>
                    </button>
                </div>
            </div>
            <ChatDeleteConfirmModal
                session={pendingDeleteSession}
                deleting={Boolean(deletingSessionId)}
                onConfirm={() => void confirmDeleteSession()}
                onCancel={cancelDeleteSession}
            />
            <RenameSessionModal
                renameTarget={renameTarget}
                renameDraft={renameDraft}
                onChangeDraft={setRenameDraft}
                onClose={closeRename}
                onSubmit={() => void submitRename()}
            />
            {contextMenuPortal}
                </aside>
                {!collapsed && onWidthChange && !loadingScreenActive ? (
                    <button
                        type="button"
                        aria-label="Resize sidebar"
                        title="Drag to resize sidebar"
                        onPointerDown={handleResizePointerDown}
                        onPointerMove={handleResizePointerMove}
                        onPointerUp={handleResizePointerEnd}
                        onPointerCancel={handleResizePointerEnd}
                        className="absolute inset-y-0 right-0 z-20 w-3 translate-x-1/2 cursor-col-resize touch-none bg-transparent"
                    />
                ) : null}
            </div>
        </>
    )
})

function ChatDeleteConfirmModal(props: {
    session: AssistantSession | null
    deleting: boolean
    onConfirm: () => void
    onCancel: () => void
}) {
    const { session, deleting, onConfirm, onCancel } = props
    if (!session || typeof document === 'undefined') return null

    const title = getSessionDisplayTitle(session)

    return createPortal(
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/55 px-4 backdrop-blur-md animate-fadeIn" onClick={onCancel}>
            <div
                className="w-full max-w-[380px] rounded-2xl border border-[var(--surface-divider)] bg-[var(--surface-floating)] p-4 shadow-[0_22px_70px_rgba(0,0,0,0.32)]"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl border border-red-300/15 bg-red-500/[0.09] text-red-200">
                        <Trash2 size={17} strokeWidth={1.8} />
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-2">
                            <div className="min-w-0 flex-1">
                                <h2 className="text-[15px] font-semibold leading-5 text-sparkle-text">Delete this chat?</h2>
                                <p className="mt-1 truncate text-[13px] text-sparkle-text-muted/75" title={title}>{title}</p>
                            </div>
                            <button
                                type="button"
                                onClick={onCancel}
                                disabled={deleting}
                                className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-sparkle-text-muted transition-colors hover:bg-[var(--surface-hover)] hover:text-sparkle-text disabled:pointer-events-none disabled:opacity-50"
                                aria-label="Cancel delete"
                            >
                                <X size={15} />
                            </button>
                        </div>
                        <p className="mt-3 text-[13px] leading-5 text-sparkle-text-secondary">
                            This removes the chat and its thread history from Zyra. This cannot be undone.
                        </p>
                    </div>
                </div>
                <div className="mt-5 flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={onCancel}
                        disabled={deleting}
                        className="rounded-lg border border-[var(--surface-divider)] px-3 py-1.5 text-[13px] font-medium text-sparkle-text-secondary transition-colors hover:bg-[var(--surface-hover)] hover:text-sparkle-text disabled:pointer-events-none disabled:opacity-50"
                    >
                        Keep chat
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        disabled={deleting}
                        className="rounded-lg border border-red-300/15 bg-red-500/[0.13] px-3 py-1.5 text-[13px] font-semibold text-red-100 transition-colors hover:bg-red-500/[0.22] disabled:pointer-events-none disabled:opacity-70"
                    >
                        {deleting ? 'Deleting...' : 'Delete chat'}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    )
}

function SidebarSection(props: { label: string; className?: string; childrenClassName?: string; children: ReactNode }) {
    return (
        <section className={props.className}>
            <div className="px-2.5 pb-1.5 pt-1 text-[12px] font-medium leading-none text-sparkle-text-secondary/55">
                {props.label}
            </div>
            <div className={props.childrenClassName || 'space-y-0.5 pl-2 pr-1'}>{props.children}</div>
        </section>
    )
}

function ChatRow(props: {
    session: AssistantSession
    activeSessionId: string | null
    activeThreadId: string | null
    commandPending: boolean
    pendingControlThreadIds: ReadonlySet<string>
    compact?: boolean
    projectNested?: boolean
    onSelectSession: (sessionId: string) => Promise<void> | void
    onSelectThread: (input: { sessionId: string; threadId: string }) => Promise<void> | void
    onRename: (session: AssistantSession) => Promise<void> | void
    onOpenContextMenu: (event: ReactMouseEvent<HTMLElement>, session: AssistantSession) => void
    menuItems: FileActionsMenuItem[]
}) {
    const {
        session,
        activeSessionId,
        activeThreadId,
        pendingControlThreadIds,
        compact = false,
        projectNested = false,
        onSelectSession,
        onSelectThread,
        onRename,
        onOpenContextMenu,
        menuItems
    } = props
    const statusThread = getSessionStatusThread(session)
    const isActiveSession = session.id === activeSessionId
    const sessionThreads = session.threads.filter((thread) => thread.source === 'subagent')
    const showThreads = isActiveSession && sessionThreads.length > 0
    const hasPendingControlApproval = session.threads.some((thread) => pendingControlThreadIds.has(thread.id))
    const statusPill = resolveAssistantThreadStatusPill(
        statusThread,
        isActiveSession && statusThread?.id === activeThreadId
    )
    const showStatusPill = Boolean(!hasPendingControlApproval && statusPill && statusPill.showLabel !== false)
    const timeLabel = formatRelativeTime(getSessionLastActivityAt(session))
    const tuiOpen = isAssistantSessionOpenInTui(session)

    return (
        <div>
            <div
                role="button"
                tabIndex={0}
                onClick={() => void onSelectSession(session.id)}
                onDoubleClick={() => void onRename(session)}
                onContextMenu={(event) => onOpenContextMenu(event, session)}
                onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    void onSelectSession(session.id)
                }}
                className={cn(
                    'group relative flex h-[30px] min-w-0 cursor-pointer items-center gap-2 rounded-[10px] px-2.5 text-left transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]/35',
                    isActiveSession
                        ? 'bg-[var(--surface-active)] text-sparkle-text'
                        : 'text-sparkle-text-secondary hover:bg-[var(--surface-hover)] hover:text-sparkle-text',
                    compact && 'h-7 rounded-[9px]',
                    projectNested && 'h-7 rounded-[10px] px-2'
                )}
                title={getSessionDisplayTitle(session)}
            >
                <AssistantSessionTitleText
                    title={getSessionDisplayTitle(session)}
                    generating={session.titleGenerating === true}
                    className="min-w-0 flex-1 text-[13px] leading-none"
                />
                <span className="inline-flex shrink-0 items-center gap-1.5">
                    {hasPendingControlApproval ? (
                        <span className="inline-flex h-4 shrink-0 items-center gap-1 rounded-full bg-amber-400/10 px-1.5 text-[9px] font-medium leading-none text-amber-200 ring-1 ring-inset ring-amber-300/15" title="Review permission in chat">
                            <span className="h-1 w-1 animate-pulse rounded-full bg-amber-300" aria-hidden="true" />
                            <span>Review</span>
                        </span>
                    ) : null}
                    {showStatusPill && statusPill ? (
                        <span
                            className={cn(
                                'inline-flex h-4 shrink-0 items-center gap-1 rounded-full px-1.5 text-[9px] font-medium leading-none ring-1 ring-inset ring-white/[0.04]',
                                statusPill.badgeClass || statusPill.colorClass
                            )}
                            title={statusPill.label}
                        >
                            <span className={cn('h-1 w-1 rounded-full', statusPill.dotClass, statusPill.pulse && 'animate-pulse')} aria-hidden="true" />
                            <span>{statusPill.label}</span>
                        </span>
                    ) : null}
                    {tuiOpen ? <AssistantTuiPresenceIndicator focusable={false} compact /> : null}
                    <span className="shrink-0 transition-opacity duration-150 ease-out group-hover:opacity-0 motion-reduce:transition-none">
                        <span className="mr-0.5 block whitespace-nowrap text-right text-[11px] leading-none tabular-nums text-sparkle-text-secondary/60">
                            {timeLabel}
                        </span>
                    </span>
                </span>
                <div className="pointer-events-none absolute right-2.5 top-1/2 z-[1] -translate-y-1/2 opacity-0 transition-opacity duration-150 ease-out group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100 motion-reduce:transition-none">
                    <span
                        className={cn(
                            'pointer-events-none absolute -inset-y-1 -left-4 -right-1 bg-gradient-to-r from-transparent',
                            isActiveSession ? 'to-[var(--surface-active)]' : 'to-[var(--surface-hover)]'
                        )}
                        aria-hidden="true"
                    />
                    <div className="relative">
                        <FileActionsMenu
                            items={menuItems}
                            title="Chat actions"
                            triggerIcon={<MoreHorizontal size={13} />}
                            presentation="portal"
                            buttonClassName="h-5 w-5 rounded-md border-transparent bg-transparent p-0 text-sparkle-text-muted/55 hover:border-transparent hover:bg-[var(--surface-hover)] hover:text-sparkle-text"
                            openButtonClassName="rounded-md border-transparent bg-[var(--surface-hover)] p-0 text-sparkle-text"
                        />
                    </div>
                </div>
            </div>
            <AnimatedHeight isOpen={showThreads}>
                <div className="ml-5 mt-0.5 space-y-0.5">
                    {sessionThreads.map((thread, index) => {
                        const isActiveThread = thread.id === activeThreadId
                        const tuiOpen = hasAssistantTuiPresence(thread.canonicalPresence)
                        return (
                            <button
                                key={thread.id}
                                type="button"
                                onClick={() => void onSelectThread({ sessionId: session.id, threadId: thread.id })}
                                className={cn(
                                    'flex h-7 w-full min-w-0 cursor-pointer items-center gap-2 rounded-[9px] px-2 text-left text-[12px] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/10',
                                    isActiveThread
                                        ? 'bg-violet-500/[0.14] text-violet-100'
                                        : 'text-sparkle-text-muted/70 hover:bg-[var(--surface-hover)] hover:text-sparkle-text-secondary'
                                )}
                            >
                                <Bot size={12} className="shrink-0" />
                                <span className="min-w-0 flex-1 truncate">{getThreadDisplayTitle(thread, index)}</span>
                                {tuiOpen ? <AssistantTuiPresenceIndicator focusable={false} compact /> : null}
                            </button>
                        )
                    })}
                </div>
            </AnimatedHeight>
        </div>
    )
}

function NewProjectIcon() {
    return (
        <span className="relative inline-flex h-4 w-4 items-center justify-center">
            <Folder size={15} strokeWidth={1.7} />
            <Plus
                size={8}
                strokeWidth={2}
                className="absolute -bottom-0.5 -right-0.5 rounded-[3px] bg-[var(--surface-sidebar)]"
            />
        </span>
    )
}

function RailButton(props: {
    icon: ReactNode
    label: string
    shortcut?: string
    disabled?: boolean
    onClick: () => void
}) {
    const { icon, label, shortcut, disabled = false, onClick } = props

    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={cn(
                'group flex h-7 w-full cursor-pointer items-center gap-2 rounded-[9px] px-2.5 text-left text-[13px] leading-none transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]/35',
                disabled
                    ? 'cursor-not-allowed text-sparkle-text-muted/45'
                    : 'text-sparkle-text-secondary hover:bg-[var(--surface-hover)] hover:text-sparkle-text'
            )}
        >
            <span className={cn('inline-flex h-4 w-4 shrink-0 items-center justify-center text-sparkle-text-secondary/70 transition-colors group-hover:text-sparkle-text', disabled && 'text-sparkle-text-muted/40')}>
                {icon}
            </span>
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {shortcut ? (
                <span className="pointer-events-none hidden shrink-0 rounded-md bg-[var(--surface-hover)] px-1.5 py-0.5 text-[10px] leading-none text-sparkle-text-secondary/80 group-hover:inline-flex">
                    {shortcut}
                </span>
            ) : null}
        </button>
    )
}
