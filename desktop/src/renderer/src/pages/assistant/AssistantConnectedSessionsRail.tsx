import { memo, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAssistantSessionsRailStore } from '@/lib/assistant/store'
import { useSettings } from '@/lib/settings'
import type { AssistantToastInput } from './AssistantPageHelpers'
import { AssistantChatSessionsRail } from './AssistantChatSessionsRail'
import type {
    AssistantRailFilterMode,
    AssistantRailGroupMode,
    AssistantRailMode,
    AssistantRailSortMode
} from './useAssistantPageSidebarState'
import { isAssistantDraftSession } from './assistant-sessions-rail-utils'
import { buildAssistantChatRoute } from './assistant-chat-route'
import { createAssistantChatAndNavigate } from './create-assistant-chat-and-navigate'
import { useAgentControlState } from './useAgentControlState'
import { useAssistantProjectCatalog } from './useAssistantProjectCatalog'

export const ConnectedAssistantSessionsRail = memo(function ConnectedAssistantSessionsRail(props: {
    collapsed: boolean
    width: number
    maxWidth: number
    previewPinned: boolean
    railMode: AssistantRailMode
    railGroupMode: AssistantRailGroupMode
    railSortMode: AssistantRailSortMode
    railFilterMode: AssistantRailFilterMode
    onRailModeChange: (next: AssistantRailMode) => void
    onRailGroupModeChange: (next: AssistantRailGroupMode) => void
    onRailSortModeChange: (next: AssistantRailSortMode) => void
    onRailFilterModeChange: (next: AssistantRailFilterMode) => void
    onWidthChange: (next: number) => void
    onPreviewPinnedChange: (pinned: boolean) => void
    onShowToast: (input: AssistantToastInput) => void
}) {
    const { collapsed, width, maxWidth, previewPinned, onWidthChange, onPreviewPinnedChange, onShowToast } = props
    const railController = useAssistantSessionsRailStore()
    const navigate = useNavigate()
    const { settings } = useSettings()
    const controlState = useAgentControlState()
    const projectCatalogState = useAssistantProjectCatalog()
    const pendingControlThreadIds = useMemo(() => new Set([
        ...(controlState?.pendingGrants || []),
        ...(controlState?.pendingActionApprovals || [])
    ].map((pending) => pending.principal.type === 'root'
        ? pending.principal.threadId
        : pending.principal.parentThreadId)), [controlState?.pendingActionApprovals, controlState?.pendingGrants])
    const creatingChatRef = useRef(false)
    const creatingProjectChatRef = useRef(false)
    const handleCreateChat = useCallback(async () => {
        if (creatingChatRef.current) return

        const activeSession = railController.snapshot.sessions.find((session) => session.id === railController.activeSessionId) || null
        if (activeSession && isAssistantDraftSession(activeSession)) {
            navigate(buildAssistantChatRoute(activeSession.id, activeSession.activeThreadId || null))
            return
        }

        try {
            creatingChatRef.current = true
            const result = await createAssistantChatAndNavigate(railController, navigate)
            if (!result.success) {
                onShowToast({ message: result.error || 'Could not create chat.', tone: 'error' })
            }
        } finally {
            creatingChatRef.current = false
        }
    }, [navigate, onShowToast, railController])

    const handleSelectSession = useCallback((sessionId: string) => {
        const session = railController.snapshot.sessions.find((entry) => entry.id === sessionId) || null
        void railController.selectSession(sessionId)
        navigate(buildAssistantChatRoute(sessionId, session?.activeThreadId || null))
    }, [navigate, railController.selectSession, railController.snapshot.sessions])

    const handleSelectThread = useCallback((input: { sessionId: string; threadId: string }) => {
        void railController.selectThread(input)
        navigate(buildAssistantChatRoute(input.sessionId, input.threadId))
    }, [navigate, railController.selectThread])

    const handleCreateProjectChat = useCallback(async (projectPath?: string, projectId?: string) => {
        if (creatingProjectChatRef.current) return
        try {
            creatingProjectChatRef.current = true
            const trimmedProjectPath = String(projectPath || '').trim()
            if (trimmedProjectPath) {
                const result = await createAssistantChatAndNavigate(
                    railController,
                    navigate,
                    {
                        mode: 'work',
                        projectPath: trimmedProjectPath,
                        projectId,
                        workingRoot: trimmedProjectPath
                    }
                )
                if (!result.success) {
                    onShowToast({ message: result.error || 'Could not create chat in project.', tone: 'error' })
                }
                return
            }

            const result = await railController.createProjectSessionResult()
            if (!result?.success && !(result as any)?.cancelled) {
                onShowToast({ message: (result as any)?.error || 'Could not create project chat.', tone: 'error' })
            }
        } finally {
            creatingProjectChatRef.current = false
        }
    }, [onShowToast, railController])

    return (
        <AssistantChatSessionsRail
            collapsed={collapsed}
            width={width}
            maxWidth={maxWidth}
            previewPinned={previewPinned}
            hoverPreviewEnabled={settings.sidebarHoverPreviewEnabled}
            agentInboxEnabled={settings.assistantAgentInboxSidebarEnabled}
            projectIconOverrides={settings.projectIconOverrides}
            projects={projectCatalogState.catalog.projects}
            sessions={railController.snapshot.sessions}
            activeSessionId={railController.activeSessionId}
            activeThreadId={railController.activeThreadId}
            commandPending={railController.commandPending}
            pendingControlThreadIds={pendingControlThreadIds}
            onCreateChat={handleCreateChat}
            onCreateProjectChat={handleCreateProjectChat}
            onSelectSession={handleSelectSession}
            onSelectThread={handleSelectThread}
            onRenameSession={railController.renameSession}
            onArchiveSession={railController.archiveSession}
            onDeleteSession={railController.deleteSessionResult}
            onWidthChange={onWidthChange}
            onPreviewPinnedChange={onPreviewPinnedChange}
            onShowToast={onShowToast}
        />
    )
})
