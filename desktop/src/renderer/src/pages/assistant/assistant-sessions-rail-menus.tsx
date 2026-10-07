import { ArchiveRestore, ChevronDown, ChevronRight, SquarePen, Trash2 } from 'lucide-react'
import { createChatActionMenuItems } from './assistant-chat-actions-menu'
import { isAssistantSessionProjectLocked } from '@shared/assistant/session-project'
import { getPrimarySessionThread, resolveSessionProjectPath } from './assistant-sessions-rail-utils'
import type { AssistantSession } from '@shared/assistant/contracts'
import type { FileActionsMenuItem } from '@/components/ui/FileActionsMenu'
import type { SessionProjectGroup } from './assistant-sessions-rail-utils'
import type { AssistantRailMode } from './useAssistantPageSidebarState'

export function createSessionActionMenuItems(args: {
    session: AssistantSession
    archived?: boolean
    pinned?: boolean
    settled?: boolean
    settlementDisabled?: boolean
    disabled?: boolean
    threadId?: string | null
    onToggleSettlement?: () => void
    onCreateThread?: (sessionId: string) => void | Promise<void>
    onCopyThreadId?: (threadId: string | null) => void | Promise<void>
    onChooseProject?: (session: AssistantSession) => void | Promise<void>
    onOpenRename: (session: AssistantSession) => void
    onRegenerateTitle?: (session: AssistantSession) => void | Promise<void>
    onTogglePinned?: (sessionId: string, pinned: boolean) => void
    onArchiveSession: (sessionId: string, archived?: boolean) => void
    onDeleteRequest: (session: AssistantSession) => void
}): FileActionsMenuItem[] {
    const { session, archived = false, pinned = false, onOpenRename, onTogglePinned, onArchiveSession, onDeleteRequest } = args

    if (archived) {
        return [
            {
                id: 'restore',
                label: 'Restore chat',
                icon: <ArchiveRestore size={13} />,
                onSelect: () => onArchiveSession(session.id, false)
            },
            {
                id: 'delete',
                label: 'Delete chat',
                icon: <Trash2 size={13} />,
                danger: true,
                onSelect: () => onDeleteRequest(session)
            }
        ]
    }

    const thread = session.threads.find(entry => entry.id === (args.threadId || session.activeThreadId)) || getPrimarySessionThread(session)
    const canonicalThreadId = thread?.providerThreadId || null
    return createChatActionMenuItems({
        disabled: args.disabled, pinned, settled: args.settled, settlementDisabled: args.settlementDisabled,
        titleGenerating: session.titleGenerating, canonicalThreadId,
        projectPath: resolveSessionProjectPath(session) || null, projectLocked: isAssistantSessionProjectLocked(session),
        onCreateThread: args.onCreateThread ? () => args.onCreateThread!(session.id) : undefined,
        onCopyThreadId: () => args.onCopyThreadId?.(canonicalThreadId),
        onChooseProject: args.onChooseProject ? () => args.onChooseProject!(session) : undefined,
        onToggleSettlement: args.onToggleSettlement,
        onTogglePinned: onTogglePinned ? () => onTogglePinned(session.id, !pinned) : undefined,
        onRename: () => onOpenRename(session),
        onRegenerateTitle: args.onRegenerateTitle ? () => args.onRegenerateTitle!(session) : undefined,
        onArchive: () => onArchiveSession(session.id, true), onDelete: () => onDeleteRequest(session)
    }, true)
}

export function createProjectActionMenuItems(args: {
    railMode: AssistantRailMode
    group: SessionProjectGroup
    playgroundLabId?: string | null
    isExpanded: boolean
    onToggleGroup: (groupKey: string) => void
    onCreateSession: (projectPath?: string) => void
    onCreatePlaygroundSession: (labId?: string | null) => void
    onDeletePlaygroundLab?: (labId: string, label: string) => void
    onDeleteProjectChats?: (group: SessionProjectGroup) => void
}): FileActionsMenuItem[] {
    const {
        group,
        playgroundLabId = null,
        isExpanded,
        onToggleGroup,
        onCreateSession,
        onCreatePlaygroundSession,
        onDeletePlaygroundLab,
        onDeleteProjectChats
    } = args
    const labId = playgroundLabId || group.sessions[0]?.playgroundLabId || null

    const items: FileActionsMenuItem[] = [
        {
            id: 'new-chat',
            label: group.path ? 'New chat in project' : 'New chat',
            icon: <SquarePen size={13} />,
            onSelect: () => {
                if (labId || !group.path) {
                    onCreatePlaygroundSession(labId)
                    return
                }
                onCreateSession(group.path || undefined)
            }
        },
        {
            id: 'toggle-group',
            label: isExpanded ? 'Collapse group' : 'Expand group',
            icon: isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />,
            onSelect: () => onToggleGroup(group.key)
        }
    ]

    if (labId && onDeletePlaygroundLab) {
        items.push({
            id: 'remove-project',
            label: 'Remove project',
            icon: <Trash2 size={13} />,
            danger: true,
            onSelect: () => onDeletePlaygroundLab(labId, group.label)
        })
    } else if (group.sessions.length > 0 && onDeleteProjectChats) {
        items.push({
            id: 'delete-project-chats',
            label: 'Delete project chats',
            icon: <Trash2 size={13} />,
            danger: true,
            onSelect: () => onDeleteProjectChats(group)
        })
    }

    return items
}
