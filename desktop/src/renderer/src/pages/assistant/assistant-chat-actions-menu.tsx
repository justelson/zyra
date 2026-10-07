import { Archive, Check, Copy, Folder, Pin, PinOff, Pencil, RotateCw, SquarePen, Trash2, Undo2 } from 'lucide-react'
import type { FileActionsMenuItem } from '@/components/ui/FileActionsMenu'

type Action = () => void | Promise<void>
export interface ChatActionMenuOptions {
    disabled?: boolean
    pinned?: boolean
    settled?: boolean
    settlementDisabled?: boolean
    titleGenerating?: boolean
    canonicalThreadId: string | null
    threadIdCopied?: boolean
    projectPath: string | null
    projectLocked: boolean
    onCreateThread?: Action
    onCopyThreadId: Action
    onRename: Action
    onRegenerateTitle?: Action
    onChooseProject?: Action
    onTogglePinned?: Action
    onToggleSettlement?: Action
    onArchive: Action
    onDelete: Action
}

export function createChatSettlementMenuItem(options: Pick<ChatActionMenuOptions, 'pinned' | 'settled' | 'settlementDisabled' | 'disabled' | 'onToggleSettlement'>): FileActionsMenuItem {
    return {
        id: options.settled ? 'unsettle' : 'settle',
        label: options.pinned ? 'Unpin chat to settle' : options.settled ? 'Un-settle chat' : 'Settle chat',
        icon: options.settled ? <Undo2 size={13} /> : <Check size={13} />,
        disabled: options.disabled || options.settlementDisabled || !options.onToggleSettlement,
        onSelect: () => options.onToggleSettlement?.()
    }
}

/** Both surfaces share the same actions; only the sidebar groups secondary actions. */
export function createChatActionMenuItems(options: ChatActionMenuOptions, compact = false): FileActionsMenuItem[] {
    const { disabled, pinned, projectLocked, projectPath } = options
    const thread: FileActionsMenuItem[] = [
        { id: 'new-thread', label: 'New thread', icon: <SquarePen size={13} />, disabled: disabled || !options.onCreateThread, onSelect: () => options.onCreateThread?.() },
        { id: 'copy-thread-id', label: options.threadIdCopied ? 'Thread ID copied' : 'Copy thread ID', icon: options.threadIdCopied ? <Check size={13} /> : <Copy size={13} />, disabled: !options.canonicalThreadId, onSelect: options.onCopyThreadId }
    ]
    const project: FileActionsMenuItem = {
        id: 'project', label: projectLocked ? 'Project locked' : projectPath ? 'Change project' : 'Attach project', icon: <Folder size={13} />,
        disabled: disabled || projectLocked || !options.onChooseProject, onSelect: () => options.onChooseProject?.()
    }
    return [
        createChatSettlementMenuItem(options),
        { id: pinned ? 'unpin' : 'pin', label: pinned ? 'Unpin chat' : 'Pin chat', icon: pinned ? <PinOff size={13} /> : <Pin size={13} />, disabled: disabled || !options.onTogglePinned, onSelect: () => options.onTogglePinned?.() },
        {
            id: 'rename', label: 'Rename chat', icon: <Pencil size={13} />, disabled, onSelect: options.onRename,
            secondaryAction: { id: 'regenerate-title', label: options.titleGenerating ? 'Regenerating chat title' : 'Regenerate chat title', icon: <RotateCw size={12} />, disabled: disabled || options.titleGenerating || !options.onRegenerateTitle, onSelect: () => options.onRegenerateTitle?.() }
        },
        ...(compact ? [
            { id: 'thread-actions', label: 'Thread', icon: <SquarePen size={13} />, onSelect: () => {}, submenuOnly: true, choices: thread, choicesLabel: 'Thread actions' },
            { id: 'project-actions', label: 'Project', icon: <Folder size={13} />, onSelect: () => {}, submenuOnly: true, choices: [project], choicesLabel: 'Project actions' }
        ] : [thread[0], thread[1], project]),
        { id: 'archive', label: 'Archive chat', icon: <Archive size={13} />, disabled, separatorBefore: true, onSelect: options.onArchive },
        { id: 'delete', label: 'Delete chat', icon: <Trash2 size={13} />, disabled, danger: true, onSelect: options.onDelete }
    ]
}
