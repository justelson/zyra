import { Archive, ArchiveRestore, ChevronDown, ChevronRight, Edit2, Pin, PinOff, RotateCw, SquarePen, Trash2 } from 'lucide-react'
import type { AssistantSession } from '@shared/assistant/contracts'
import type { FileActionsMenuItem } from '@/components/ui/FileActionsMenu'
import type { SessionProjectGroup } from './assistant-sessions-rail-utils'
import type { AssistantRailMode } from './useAssistantPageSidebarState'

export function createSessionActionMenuItems(args: {
    session: AssistantSession
    archived?: boolean
    pinned?: boolean
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

    return [
        ...(onTogglePinned ? [{
            id: pinned ? 'unpin' : 'pin',
            label: pinned ? 'Unpin chat' : 'Pin chat',
            icon: pinned ? <PinOff size={13} /> : <Pin size={13} />,
            onSelect: () => onTogglePinned(session.id, !pinned)
        }] : []),
        {
            id: 'rename',
            label: 'Rename chat',
            icon: <Edit2 size={13} />,
            onSelect: () => onOpenRename(session),
            secondaryAction: args.onRegenerateTitle ? {
                id: 'regenerate-title',
                label: session.titleGenerating ? 'Regenerating chat title' : 'Regenerate chat title',
                icon: <RotateCw size={12} strokeWidth={1.5} />,
                disabled: session.titleGenerating,
                onSelect: () => args.onRegenerateTitle?.(session)
            } : undefined
        },
        {
            id: 'archive',
            label: 'Archive chat',
            icon: <Archive size={13} />,
            onSelect: () => onArchiveSession(session.id, true)
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
