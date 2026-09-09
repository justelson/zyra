import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
    type DragCancelEvent,
    type DragEndEvent,
    type DragStartEvent
} from '@dnd-kit/core'
import type { AssistantSession } from '@shared/assistant/contracts'
import type { DevScopeFolderItem } from '@shared/contracts/devscope-api'
import { cn } from '@/lib/utils'
import { AssistantSessionsRailBody } from './AssistantSessionsRailBody'
import {
    LabDeleteModal,
    PlaygroundLabModal,
    ProjectChatsDeleteModal
} from './AssistantSessionsRailDialogs'
import { AssistantSessionsRailFooter } from './AssistantSessionsRailFooter'
import { AssistantSessionsRailHeaderControls } from './AssistantSessionsRailHeaderControls'
import type { ExpandedSessionsRailContentProps } from './AssistantSessionsRailParts.types'
import type { SessionProjectGroup } from './assistant-sessions-rail-utils'
import {
    buildAssistantThreadRecencyTierMap,
    getSessionDisplayTitle
} from './assistant-sessions-rail-utils'
import { createProjectActionMenuItems, createSessionActionMenuItems } from './assistant-sessions-rail-menus'
import { useAssistantRailContextMenu } from './useAssistantRailContextMenu'
import { useAssistantRailTitleRegeneration } from './useAssistantRailTitleRegeneration'
import {
    hasSessionChats,
    useAssistantRailCollisionDetection,
    useAssistantRailSensors
} from './AssistantSessionsRailRows'

const CHAT_PAGE_SIZE = 5
const PINNED_SESSION_IDS_KEY = 'assistant:pinned-session-ids:v1'

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
        // Ignore storage failures; the in-memory pinned section still updates.
    }
}

function getTrailingPathSegment(value: string): string {
    const normalized = String(value || '').trim().replace(/[\\/]+$/g, '')
    if (!normalized) return ''
    const segment = normalized.split(/[\\/]/).pop()?.trim() || ''
    return segment.replace(/\.git$/i, '').trim()
}

function resolveRequestedProjectTitle(input: {
    title: string
    source: 'empty' | 'git-clone' | 'existing-folder'
    repoUrl: string
    existingFolderPath: string
}): string {
    const explicitTitle = input.title.trim()
    if (explicitTitle) return explicitTitle
    if (input.source === 'git-clone') return getTrailingPathSegment(input.repoUrl) || 'New Project'
    if (input.source === 'existing-folder') return getTrailingPathSegment(input.existingFolderPath) || 'New Project'
    return 'New Project'
}

export { RenameSessionModal, SessionDeleteModal } from './AssistantSessionsRailDialogs'

export function ExpandedSessionsRailContent(props: ExpandedSessionsRailContentProps) {
    const {
        compact,
        railMode,
        railGroupMode,
        railSortMode,
        railFilterMode,
        playground,
        backgroundActivitySessions,
        assistantConnected,
        commandPending,
        groupedSessions,
        activeSessionId,
        activeThreadId,
        expandedGroupKeys,
        onRailModeChange,
        onRailGroupModeChange,
        onRailSortModeChange,
        onRailFilterModeChange,
        onToggleGroup,
        onChooseProjectPath,
        onCreateSession,
        onCreatePlaygroundSession,
        onSelectSession,
        onSelectThread,
        onOpenRename,
        onArchiveSession,
        onDeleteRequest,
        onDeleteSession,
        onSetPlaygroundRoot,
        onCreatePlaygroundLab,
        onDeletePlaygroundLab,
        onProjectDragStart,
        onProjectDragEnd,
        onProjectDragCancel,
        onSessionDragStart,
        onSessionDragEnd,
        onSessionDragCancel,
        onShowToast
    } = props

    const projectSensors = useAssistantRailSensors()
    const collisionDetection = useAssistantRailCollisionDetection()
    const projectDragInProgressRef = useRef(false)
    const suppressProjectClickAfterDragRef = useRef(false)
    const { openContextMenu, contextMenuPortal } = useAssistantRailContextMenu()
    const regenerateTitle = useAssistantRailTitleRegeneration(onShowToast)
    const [visibleSessionCountByGroup, setVisibleSessionCountByGroup] = useState<Record<string, number>>({})
    const [creatingLab, setCreatingLab] = useState(false)
    const [labDialogOpen, setLabDialogOpen] = useState(false)
    const [labTitle, setLabTitle] = useState('')
    const [labRepoUrl, setLabRepoUrl] = useState('')
    const [labSource, setLabSource] = useState<'empty' | 'git-clone' | 'existing-folder'>('empty')
    const [existingRootFolders, setExistingRootFolders] = useState<DevScopeFolderItem[]>([])
    const [existingRootFoldersLoading, setExistingRootFoldersLoading] = useState(false)
    const [selectedExistingFolderPath, setSelectedExistingFolderPath] = useState('')
    const [labToDelete, setLabToDelete] = useState<{ labId: string; label: string } | null>(null)
    const [projectChatsToDelete, setProjectChatsToDelete] = useState<{ label: string; sessionIds: string[] } | null>(null)
    const [deletingProjectChats, setDeletingProjectChats] = useState(false)
    const [deletingLabId, setDeletingLabId] = useState<string | null>(null)
    const [expandedThreadKeys, setExpandedThreadKeys] = useState<Set<string>>(new Set())
    const [pinnedSessionIds, setPinnedSessionIds] = useState<Set<string>>(() => readPinnedSessionIds())

    const labByRootPath = useMemo(
        () => new Map(playground.labs.map((lab) => [lab.rootPath, lab])),
        [playground.labs]
    )
    const allVisibleSessions = useMemo(
        () => groupedSessions.flatMap((group) => group.sessions),
        [groupedSessions]
    )
    const recencyTierByThreadId = useMemo(() => {
        const sessionsById = new Map<string, AssistantSession>()
        for (const session of allVisibleSessions) sessionsById.set(session.id, session)
        for (const session of backgroundActivitySessions) sessionsById.set(session.id, session)
        return buildAssistantThreadRecencyTierMap(Array.from(sessionsById.values()))
    }, [allVisibleSessions, backgroundActivitySessions])
    const pinnedSessions = useMemo(
        () => allVisibleSessions.filter((session) => pinnedSessionIds.has(session.id) && hasSessionChats(session)),
        [allVisibleSessions, pinnedSessionIds]
    )
    const pinnedGroup = useMemo<SessionProjectGroup | null>(() => {
        if (pinnedSessions.length === 0) return null
        const newest = pinnedSessions[0]
        return {
            key: '__assistant_pinned__',
            label: 'Pinned',
            path: '',
            createdAt: newest?.createdAt || new Date(0).toISOString(),
            updatedAt: newest?.updatedAt || new Date(0).toISOString(),
            projectIconPath: null,
            projectType: null,
            framework: null,
            sessions: pinnedSessions
        }
    }, [pinnedSessions])

    const handleTogglePinnedSession = useCallback((sessionId: string, pinned: boolean) => {
        setPinnedSessionIds((current) => {
            const next = new Set(current)
            if (pinned) next.add(sessionId)
            else next.delete(sessionId)
            writePinnedSessionIds(next)
            return next
        })
    }, [])

    const handleDeleteLabRequest = useCallback((labId: string, label: string) => {
        setLabToDelete({ labId, label })
    }, [])

    const handleDeleteProjectChatsRequest = useCallback((group: SessionProjectGroup) => {
        const sessionIds = group.sessions.map((session) => session.id)
        if (sessionIds.length === 0) return
        setProjectChatsToDelete({ label: group.label, sessionIds })
    }, [])

    const getSessionMenuItems = useCallback((session: AssistantSession, archived = false) => (
        createSessionActionMenuItems({
            session,
            archived,
            pinned: pinnedSessionIds.has(session.id),
            onOpenRename,
            onRegenerateTitle: regenerateTitle,
            onTogglePinned: archived ? undefined : handleTogglePinnedSession,
            onArchiveSession,
            onDeleteRequest
        })
    ), [handleTogglePinnedSession, onArchiveSession, onDeleteRequest, onOpenRename, pinnedSessionIds, regenerateTitle])

    const openSessionContextMenu = useCallback((
        event: ReactMouseEvent<HTMLElement>,
        session: AssistantSession,
        archived = false
    ) => {
        openContextMenu(event, `${getSessionDisplayTitle(session)} actions`, getSessionMenuItems(session, archived))
    }, [getSessionMenuItems, openContextMenu])

    const getGroupPlaygroundLabId = useCallback((group: SessionProjectGroup) => {
        const directLabId = group.sessions[0]?.playgroundLabId || null
        if (directLabId) return directLabId
        if (!group.path) return null
        return labByRootPath.get(group.path)?.id || null
    }, [labByRootPath])

    const getProjectMenuItems = useCallback((group: SessionProjectGroup, isExpanded: boolean) => (
        createProjectActionMenuItems({
            railMode,
            group,
            playgroundLabId: getGroupPlaygroundLabId(group),
            isExpanded,
            onToggleGroup,
            onCreateSession,
            onCreatePlaygroundSession,
            onDeletePlaygroundLab: handleDeleteLabRequest,
            onDeleteProjectChats: handleDeleteProjectChatsRequest
        })
    ), [getGroupPlaygroundLabId, handleDeleteLabRequest, handleDeleteProjectChatsRequest, onCreatePlaygroundSession, onCreateSession, onToggleGroup, railMode])

    const openProjectContextMenu = useCallback((
        event: ReactMouseEvent<HTMLElement>,
        group: SessionProjectGroup,
        isExpanded: boolean
    ) => {
        openContextMenu(event, `${group.label} actions`, getProjectMenuItems(group, isExpanded))
    }, [getProjectMenuItems, openContextMenu])

    const openProjectDialog = useCallback((source: 'empty' | 'git-clone' | 'existing-folder' = 'empty') => {
        setLabSource(source)
        setLabDialogOpen(true)
    }, [])

    const handleCreateProjectChat = useCallback((group: SessionProjectGroup) => {
        const labId = getGroupPlaygroundLabId(group)
        if (labId || !group.path) {
            onCreatePlaygroundSession(labId)
            return
        }
        onCreateSession(group.path || undefined)
    }, [getGroupPlaygroundLabId, onCreatePlaygroundSession, onCreateSession])

    const handleDeleteProjectGroup = useCallback((group: SessionProjectGroup) => {
        const labId = getGroupPlaygroundLabId(group)
        if (labId) {
            handleDeleteLabRequest(labId, group.label)
            return
        }
        handleDeleteProjectChatsRequest(group)
    }, [getGroupPlaygroundLabId, handleDeleteLabRequest, handleDeleteProjectChatsRequest])

    const handleConfirmDeleteProjectChats = useCallback(async () => {
        if (!projectChatsToDelete || deletingProjectChats) return
        const { label, sessionIds } = projectChatsToDelete
        let deletedCount = 0
        let firstError: string | null = null

        try {
            setDeletingProjectChats(true)
            for (const sessionId of sessionIds) {
                const result = await onDeleteSession(sessionId)
                if (result.success) {
                    deletedCount += 1
                    continue
                }
                if (!firstError) firstError = result.error
            }

            if (deletedCount === sessionIds.length) {
                setProjectChatsToDelete(null)
                onShowToast({ message: `Deleted ${deletedCount} chat${deletedCount === 1 ? '' : 's'} from "${label}"` })
                return
            }

            if (deletedCount > 0) {
                setProjectChatsToDelete(null)
                onShowToast({
                    message: `Deleted ${deletedCount} of ${sessionIds.length} chats from "${label}". ${firstError || 'Some chats could not be deleted.'}`,
                    tone: 'error'
                })
                return
            }

            onShowToast({
                message: `Failed to delete chats from "${label}": ${firstError || 'Unknown error.'}`,
                tone: 'error'
            })
        } finally {
            setDeletingProjectChats(false)
        }
    }, [deletingProjectChats, onDeleteSession, onShowToast, projectChatsToDelete])

    const handleConfirmDeleteLab = useCallback(async () => {
        if (!labToDelete || deletingLabId) return

        try {
            setDeletingLabId(labToDelete.labId)
            const result = await onDeletePlaygroundLab(labToDelete.labId)
            if (!result.success) {
                onShowToast({
                    message: `Failed to remove project "${labToDelete.label}": ${result.error}`,
                    tone: 'error'
                })
                return
            }
            setLabToDelete(null)
            onShowToast({ message: `Removed project "${labToDelete.label}"` })
        } finally {
            setDeletingLabId(null)
        }
    }, [deletingLabId, labToDelete, onDeletePlaygroundLab, onShowToast])

    useEffect(() => {
        setExpandedThreadKeys((current) => {
            const next = new Set(
                Array.from(current).filter((threadId) =>
                    allVisibleSessions.some((session) => session.threads.some((thread) => thread.id === threadId && thread.source === 'subagent'))
                )
            )

            if (!activeThreadId) return next

            const activeSession = allVisibleSessions.find((session) => session.id === activeSessionId) || null
            const activeThread = activeSession?.threads.find((thread) => thread.id === activeThreadId) || null
            if (!activeSession || !activeThread || activeThread.source !== 'subagent') return next

            const threadById = new Map(activeSession.threads.map((thread) => [thread.id, thread]))
            let parentThreadId = activeThread.parentThreadId

            while (parentThreadId) {
                const parentThread = threadById.get(parentThreadId)
                if (!parentThread || parentThread.source !== 'subagent') break
                next.add(parentThread.id)
                parentThreadId = parentThread.parentThreadId
            }

            if (activeSession.threads.some((thread) => thread.parentThreadId === activeThread.id && thread.source === 'subagent')) {
                next.add(activeThread.id)
            }

            return next
        })
    }, [activeSessionId, activeThreadId, allVisibleSessions])

    useEffect(() => {
        setVisibleSessionCountByGroup((current) => {
            const nextEntries = groupedSessions.map((group) => [group.key, Math.max(CHAT_PAGE_SIZE, current[group.key] ?? CHAT_PAGE_SIZE)] as const)
            const next = Object.fromEntries(nextEntries)
            const currentKeys = Object.keys(current)
            if (
                currentKeys.length === nextEntries.length
                && currentKeys.every((key) => current[key] === next[key])
            ) {
                return current
            }
            return next
        })
    }, [groupedSessions])

    useEffect(() => {
        if (!labDialogOpen || labSource !== 'existing-folder' || !playground.rootPath) return

        const rootPath = playground.rootPath
        let cancelled = false
        setExistingRootFoldersLoading(true)

        void (async () => {
            try {
                const result = await window.devscope.scanProjects(rootPath, { forceRefresh: true })
                if (cancelled || !result.success) return
                const folders = [...(result.folders || [])].sort((left, right) => left.name.localeCompare(right.name))
                setExistingRootFolders(folders)
                setSelectedExistingFolderPath((current) => {
                    if (current && folders.some((folder) => folder.path === current)) return current
                    return folders[0]?.path || ''
                })
            } finally {
                if (!cancelled) setExistingRootFoldersLoading(false)
            }
        })()

        return () => {
            cancelled = true
        }
    }, [labDialogOpen, labSource, playground.rootPath])

    const handleToggleThread = useCallback((threadId: string) => {
        setExpandedThreadKeys((current) => {
            const next = new Set(current)
            if (next.has(threadId)) next.delete(threadId)
            else next.add(threadId)
            return next
        })
    }, [])

    const handleProjectTitlePointerDownCapture = useCallback(() => {
        suppressProjectClickAfterDragRef.current = false
    }, [])

    const handleProjectTitleClick = useCallback((event: ReactMouseEvent<HTMLButtonElement>, projectKey: string) => {
        if (projectDragInProgressRef.current) {
            event.preventDefault()
            event.stopPropagation()
            return
        }
        if (suppressProjectClickAfterDragRef.current) {
            suppressProjectClickAfterDragRef.current = false
            event.preventDefault()
            event.stopPropagation()
            return
        }
        onToggleGroup(projectKey)
    }, [onToggleGroup])

    const handleProjectSortStart = useCallback((event: DragStartEvent) => {
        projectDragInProgressRef.current = true
        suppressProjectClickAfterDragRef.current = true
        onProjectDragStart(String(event.active.id))
    }, [onProjectDragStart])

    const handleProjectSortEnd = useCallback((event: DragEndEvent) => {
        projectDragInProgressRef.current = false
        onProjectDragEnd(String(event.active.id), event.over ? String(event.over.id) : null)
    }, [onProjectDragEnd])

    const handleProjectSortCancel = useCallback((_event: DragCancelEvent) => {
        projectDragInProgressRef.current = false
        onProjectDragCancel()
    }, [onProjectDragCancel])

    const handleShowMoreSessions = useCallback((groupKey: string, nextVisibleCount: number) => {
        setVisibleSessionCountByGroup((current) => ({
            ...current,
            [groupKey]: Math.max(CHAT_PAGE_SIZE, nextVisibleCount)
        }))
    }, [])

    const handleShowLessSessions = useCallback((groupKey: string, minimumVisibleCount: number) => {
        setVisibleSessionCountByGroup((current) => ({
            ...current,
            [groupKey]: Math.max(CHAT_PAGE_SIZE, minimumVisibleCount)
        }))
    }, [])

    const handleChoosePlaygroundRoot = useCallback(async () => {
        const folderResult = await window.devscope.selectFolder()
        if (!folderResult.success || folderResult.cancelled || !folderResult.folderPath) return
        await onSetPlaygroundRoot(folderResult.folderPath)
    }, [onSetPlaygroundRoot])

    const handleCreateLab = useCallback(async () => {
        if (creatingLab) return
        setCreatingLab(true)
        try {
        const requestedProjectTitle = resolveRequestedProjectTitle({
            title: labTitle,
            source: labSource,
            repoUrl: labRepoUrl,
            existingFolderPath: selectedExistingFolderPath
            })

            if (labSource === 'existing-folder') {
                const existingFolderPath = selectedExistingFolderPath.trim()
                if (!existingFolderPath) return
                const existingLab = labByRootPath.get(existingFolderPath) || null
                if (existingLab) {
                    await Promise.resolve(onCreatePlaygroundSession(existingLab.id))
                    setLabDialogOpen(false)
                    onShowToast({ message: `Opened a new chat in "${existingLab.title}".` })
                } else {
                    const result = await onCreatePlaygroundLab({
                        title: labTitle || undefined,
                        source: 'existing-folder',
                        existingFolderPath,
                        openSession: true
                    })
                    if (!result.success) {
                        onShowToast({
                            message: `Failed to add project "${requestedProjectTitle}": ${result.error}`,
                            tone: 'error'
                        })
                        return
                    }
                    const createdProjectTitle = result.playground.labs.find((lab) => lab.id === result.labId)?.title || requestedProjectTitle
                    if (result.sessionId) {
                        await Promise.resolve(onSelectSession(result.sessionId))
                    }
                    setLabDialogOpen(false)
                    onShowToast({ message: `"${createdProjectTitle}" is ready with a new chat open.` })
                }
                return
            }

            const result = await onCreatePlaygroundLab({
                title: labTitle || undefined,
                source: labSource,
                repoUrl: labSource === 'git-clone' ? labRepoUrl : undefined,
                openSession: true
            })

            if (!result.success) {
                onShowToast({
                    message: labSource === 'git-clone'
                        ? `Failed to clone "${requestedProjectTitle}": ${result.error}`
                        : `Failed to add project "${requestedProjectTitle}": ${result.error}`,
                    tone: 'error'
                })
                return
            }

            const createdProjectTitle = result.playground.labs.find((lab) => lab.id === result.labId)?.title || requestedProjectTitle
            if (result.sessionId) {
                await Promise.resolve(onSelectSession(result.sessionId))
            }
            setLabDialogOpen(false)
            onShowToast({
                message: labSource === 'git-clone'
                    ? `Repo cloned. "${createdProjectTitle}" is ready with a new chat open.`
                    : `"${createdProjectTitle}" is ready with a new chat open.`
            })
        } finally {
            setCreatingLab(false)
        }
    }, [creatingLab, labByRootPath, labRepoUrl, labSource, labTitle, onCreatePlaygroundLab, onCreatePlaygroundSession, onSelectSession, onShowToast, selectedExistingFolderPath])

    const sectionLabel = railGroupMode === 'flat' ? 'Chats' : 'Projects'
    const playgroundRootMissing = !playground.rootPath
    const unassignedGroup = railGroupMode === 'project'
        ? groupedSessions.find((group) => !group.path) || null
        : null
    const labGroups = railGroupMode === 'flat'
        ? groupedSessions
        : groupedSessions.filter((group) => Boolean(group.path))
    const activeConnectionPending = commandPending && !assistantConnected && Boolean(activeSessionId)

    return (
        <div className={cn('relative z-10 flex h-full flex-col font-sans', compact ? 'px-2 py-2.5' : 'px-2 py-2.5')}>
            <AssistantSessionsRailHeaderControls
                railMode={railMode}
                commandPending={commandPending}
                playgroundRootMissing={playgroundRootMissing}
                onRailModeChange={onRailModeChange}
                onChooseProjectPath={onChooseProjectPath}
                onOpenLabDialog={openProjectDialog}
                onChoosePlaygroundRoot={() => void handleChoosePlaygroundRoot()}
                onCreatePlaygroundSession={onCreatePlaygroundSession}
            />

            <div className="mx-1 mb-2.5 mt-1.5 h-px shrink-0 bg-white/[0.06]" />

            <AssistantSessionsRailBody
                compact={compact}
                railMode={railMode}
                railGroupMode={railGroupMode}
                railSortMode={railSortMode}
                playgroundRootMissing={playgroundRootMissing}
                sectionLabel={sectionLabel}
                pinnedGroup={pinnedGroup}
                unassignedGroup={unassignedGroup}
                labGroups={labGroups}
                activeSessionId={activeSessionId}
                activeThreadId={activeThreadId}
                activeConnectionPending={activeConnectionPending}
                expandedGroupKeys={expandedGroupKeys}
                expandedThreadKeys={expandedThreadKeys}
                visibleSessionCountByGroup={visibleSessionCountByGroup}
                recencyTierByThreadId={recencyTierByThreadId}
                projectSensors={projectSensors}
                collisionDetection={collisionDetection}
                getSessionMenuItems={getSessionMenuItems}
                onSessionContextMenu={openSessionContextMenu}
                onSessionDragStart={onSessionDragStart}
                onSessionDragEnd={onSessionDragEnd}
                onSessionDragCancel={onSessionDragCancel}
                onToggleThread={handleToggleThread}
                onSelectThread={onSelectThread}
                onToggleGroup={onToggleGroup}
                onProjectContextMenu={openProjectContextMenu}
                onProjectTitlePointerDownCapture={handleProjectTitlePointerDownCapture}
                onProjectTitleClick={handleProjectTitleClick}
                onProjectDragStart={handleProjectSortStart}
                onProjectDragEnd={handleProjectSortEnd}
                onProjectDragCancel={handleProjectSortCancel}
                onCreateProjectChat={handleCreateProjectChat}
                onCreateChat={() => onCreatePlaygroundSession(null)}
                onCreateProject={() => openProjectDialog('empty')}
                onCloneProject={() => openProjectDialog('git-clone')}
                onDeleteProjectGroup={handleDeleteProjectGroup}
                onChoosePlaygroundRoot={handleChoosePlaygroundRoot}
                onRailGroupModeChange={onRailGroupModeChange}
                onRailSortModeChange={onRailSortModeChange}
                onShowMoreSessions={handleShowMoreSessions}
                onShowLessSessions={handleShowLessSessions}
                getGroupPlaygroundLabId={getGroupPlaygroundLabId}
            />

            <AssistantSessionsRailFooter
                compact={compact}
            />

            <PlaygroundLabModal
                open={labDialogOpen}
                playground={playground}
                title={labTitle}
                repoUrl={labRepoUrl}
                source={labSource}
                creating={creatingLab}
                existingRootFolders={existingRootFolders}
                existingRootFoldersLoading={existingRootFoldersLoading}
                selectedExistingFolderPath={selectedExistingFolderPath}
                onClose={() => {
                    if (creatingLab) return
                    setLabDialogOpen(false)
                }}
                onChangeTitle={setLabTitle}
                onChangeRepoUrl={setLabRepoUrl}
                onChangeSource={setLabSource}
                onChangeSelectedExistingFolderPath={setSelectedExistingFolderPath}
                onSubmit={() => void handleCreateLab()}
            />
            <LabDeleteModal
                labToDelete={labToDelete}
                deletingLabId={deletingLabId}
                onConfirm={() => void handleConfirmDeleteLab()}
                onCancel={() => {
                    if (deletingLabId) return
                    setLabToDelete(null)
                }}
            />
            <ProjectChatsDeleteModal
                projectChatsToDelete={projectChatsToDelete}
                deletingProjectChats={deletingProjectChats}
                onConfirm={() => void handleConfirmDeleteProjectChats()}
                onCancel={() => {
                    if (deletingProjectChats) return
                    setProjectChatsToDelete(null)
                }}
            />
            {contextMenuPortal}
        </div>
    )
}
