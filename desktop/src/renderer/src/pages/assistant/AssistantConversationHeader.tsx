import { memo, useState } from 'react'
import { Archive, Bot, Check, Copy, Folder, MoreHorizontal, PanelRightClose, PanelRightOpen, Pencil, Radio, SquarePen, Trash2 } from 'lucide-react'
import { FileActionsMenu, type FileActionsMenuItem } from '@/components/ui/FileActionsMenu'
import type { AssistantChatDisplayMode } from '@/lib/settings'
import { cn } from '@/lib/utils'
import { copyTextToClipboard } from './AssistantPageHelpers'
import { AssistantProjectIcon } from './AssistantProjectIcon'
import { AssistantSessionTitleText } from './AssistantSessionTitleText'
import { AssistantTuiPresenceIndicator } from './AssistantTuiPresenceIndicator'
import { hasAssistantTuiPresence } from './assistant-tui-presence'

export const AssistantConversationHeader = memo(function AssistantConversationHeader(props: {
    displayMode?: AssistantChatDisplayMode
    rightPanelOpen: boolean
    rightPanelMode: 'none' | 'details' | 'plan' | 'review'
    showRightSidebarToggle?: boolean
    selectedSessionTitle: string
    titleGenerating?: boolean
    canonicalThreadId: string | null
    canonicalPresence?: {
        state: 'detached' | 'ready' | 'running' | 'background'
        clients: Array<{ clientId: string; surface: string }>
        latestSequence?: number
    } | null
    showPresenceBadge?: boolean
    showDiagnostics?: boolean
    activeThreadIsSubagent: boolean
    activeThreadLabel: string | null
    selectedProjectTooltip: string
    selectedProjectPath: string | null
    latestProjectLabel: string
    projectDirectoryLocked: boolean
    actionsDisabled?: boolean
    onCreateThread: () => void
    onRenameChat: () => void
    onCreateProjectChat: () => void
    onChooseProject: () => void
    onArchiveChat: () => void
    onDeleteChat: () => void
    onToggleRightSidebar: () => void
    onShowToast?: (message: string, tone?: 'success' | 'error' | 'info') => void
}) {
    const {
        displayMode = 'detailed',
        selectedSessionTitle,
        titleGenerating = false,
        canonicalThreadId,
        canonicalPresence,
        showPresenceBadge = true,
        showDiagnostics = false,
        latestProjectLabel,
        selectedProjectPath,
        selectedProjectTooltip,
        projectDirectoryLocked,
        activeThreadIsSubagent,
        activeThreadLabel,
        rightPanelOpen,
        rightPanelMode,
        showRightSidebarToggle = false,
        actionsDisabled = false,
        onCreateThread,
        onRenameChat,
        onCreateProjectChat,
        onChooseProject,
        onArchiveChat,
        onDeleteChat,
        onToggleRightSidebar,
        onShowToast
    } = props
    const [threadIdCopied, setThreadIdCopied] = useState(false)
    const minimal = displayMode === 'minimal'
    const RightSidebarIcon = rightPanelOpen && rightPanelMode === 'review' ? PanelRightClose : PanelRightOpen
    const tuiOpen = showPresenceBadge && hasAssistantTuiPresence(canonicalPresence)
    const remoteSurfaces = [...new Set((canonicalPresence?.clients || [])
        .map((client) => client.surface.trim().toLowerCase())
        .filter((surface) => surface && surface !== 'desktop' && surface !== 'tui'))]
    const remotePresenceLabel = showPresenceBadge && remoteSurfaces.length > 0
        ? `${canonicalPresence?.state === 'running' ? 'Running' : canonicalPresence?.state === 'background' ? 'Background work' : 'Open'} in ${remoteSurfaces.join(' + ')}`
        : null
    const diagnosticsLabel = showDiagnostics
        ? canonicalPresence
            ? `${canonicalPresence.state}${typeof canonicalPresence.latestSequence === 'number' ? ` · seq ${canonicalPresence.latestSequence}` : ''}`
            : 'presence unavailable'
        : null
    const headerMenuItems: FileActionsMenuItem[] = [
        {
            id: 'new-thread',
            label: 'New thread',
            icon: <SquarePen size={13} />,
            disabled: actionsDisabled,
            onSelect: onCreateThread
        },
        {
            id: 'rename',
            label: 'Rename chat',
            icon: <Pencil size={13} />,
            disabled: actionsDisabled,
            onSelect: onRenameChat
        },
        {
            id: 'copy-thread-id',
            label: threadIdCopied ? 'Thread ID copied' : 'Copy thread ID',
            icon: threadIdCopied ? <Check size={13} /> : <Copy size={13} />,
            disabled: !canonicalThreadId,
            onSelect: async () => {
                if (!canonicalThreadId) return
                try {
                    await copyTextToClipboard(canonicalThreadId)
                    setThreadIdCopied(true)
                    onShowToast?.('Thread ID copied', 'success')
                    window.setTimeout(() => setThreadIdCopied(false), 1600)
                } catch (error) {
                    const message = error instanceof Error && error.message
                        ? `Could not copy thread ID: ${error.message}`
                        : 'Could not copy thread ID'
                    onShowToast?.(message, 'error')
                }
            }
        },
        {
            id: 'project',
            label: projectDirectoryLocked ? 'Project locked' : selectedProjectPath ? 'Change project' : 'Attach project',
            icon: <Folder size={13} />,
            disabled: actionsDisabled || projectDirectoryLocked,
            onSelect: onChooseProject
        },
        {
            id: 'archive',
            label: 'Archive chat',
            icon: <Archive size={13} />,
            disabled: actionsDisabled,
            onSelect: onArchiveChat
        },
        {
            id: 'delete',
            label: 'Delete chat',
            icon: <Trash2 size={13} />,
            disabled: actionsDisabled,
            danger: true,
            onSelect: onDeleteChat
        }
    ]

    return (
        <div
            className={cn('drag-region flex h-full min-w-0 items-center', minimal ? 'group/chat-header px-4' : 'px-3')}
            data-assistant-conversation-header={displayMode}
        >
            <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                {selectedProjectPath ? (
                    <button
                        type="button"
                        onClick={onCreateProjectChat}
                        disabled={actionsDisabled}
                        className="inline-flex min-w-0 max-w-[184px] shrink items-center gap-1.5 text-[12px] font-medium leading-none text-sparkle-text-muted/65 transition-colors hover:text-sparkle-text-secondary focus:outline-none focus-visible:text-sparkle-text active:text-sparkle-text disabled:cursor-not-allowed disabled:opacity-50"
                        title={`Start a new chat in ${latestProjectLabel}\n${selectedProjectTooltip}`}
                        aria-label={`Start a new chat in ${latestProjectLabel}`}
                    >
                        <AssistantProjectIcon projectPath={selectedProjectPath} size={12} />
                        <span className="truncate">{latestProjectLabel}</span>
                    </button>
                ) : null}
                {selectedProjectPath ? <span className="shrink-0 px-0.5 text-[12px] text-sparkle-text-muted/35" aria-hidden="true">/</span> : null}
                <div className="flex min-w-0 items-center gap-0.5 overflow-hidden">
                    <h2 className={cn('min-w-0 max-w-[min(360px,35vw)] text-[12px] leading-none text-sparkle-text/90', minimal ? 'font-medium' : 'font-semibold')}>
                        <AssistantSessionTitleText title={selectedSessionTitle} generating={titleGenerating} reveal={false} />
                    </h2>
                    <FileActionsMenu
                        items={headerMenuItems}
                        title="Chat actions"
                        triggerIcon={<MoreHorizontal size={14} className="rotate-90" />}
                        presentation="portal"
                        buttonClassName={cn(
                            'size-5 rounded-md border-transparent bg-transparent p-0 text-sparkle-text-muted hover:border-transparent hover:bg-[var(--surface-hover)] hover:text-sparkle-text',
                            minimal && 'opacity-0 transition-opacity group-hover/chat-header:opacity-100 focus-visible:opacity-100'
                        )}
                        openButtonClassName="rounded-md border-transparent bg-[var(--surface-hover)] p-0 text-sparkle-text"
                    />
                    {tuiOpen ? <AssistantTuiPresenceIndicator /> : null}
                </div>
                {activeThreadIsSubagent && activeThreadLabel ? (
                    <span
                        className={cn(
                            'inline-flex max-w-[180px] shrink-0 items-center gap-1 font-medium leading-none text-violet-100',
                            minimal ? 'px-1 text-[10px] text-violet-200/65' : 'rounded-full border border-violet-400/20 bg-violet-500/[0.08] px-2 py-0.5 text-[9px]'
                        )}
                        title={`Viewing subagent thread: ${activeThreadLabel}`}
                    >
                        <Bot size={9} />
                        <span className="truncate">{activeThreadLabel}</span>
                    </span>
                ) : null}
                {remotePresenceLabel ? (
                    <span
                        className={cn(
                            'inline-flex max-w-[160px] shrink-0 items-center gap-1 font-medium leading-none text-emerald-100',
                            minimal ? 'px-1 text-[10px] text-emerald-200/60' : 'rounded-full border border-emerald-400/20 bg-emerald-500/[0.07] px-2 py-0.5 text-[9px]'
                        )}
                        title={`${remotePresenceLabel}. This surface shares the same canonical worker and transcript.`}
                    >
                        <Radio size={9} />
                        <span className="truncate">{remotePresenceLabel}</span>
                    </span>
                ) : null}
                {diagnosticsLabel ? (
                    <span
                        className="inline-flex max-w-[150px] shrink-0 items-center gap-1 rounded-full border border-[var(--surface-divider)] bg-[var(--surface-hover)] px-2 py-0.5 font-mono text-[8px] leading-none text-sparkle-text-muted"
                        title="Canonical worker presence and replay sequence"
                    >
                        <Radio size={8} />
                        <span className="truncate">{diagnosticsLabel}</span>
                    </span>
                ) : null}
            </div>
            {showRightSidebarToggle ? (
                <button
                    type="button"
                    onClick={onToggleRightSidebar}
                    className="ml-2 inline-flex size-6 shrink-0 items-center justify-center rounded-md text-sparkle-text-muted transition-colors hover:bg-[var(--surface-hover)] hover:text-sparkle-text"
                    title={rightPanelOpen ? 'Close review workspace' : 'Open review workspace'}
                    aria-label={rightPanelOpen ? 'Close review workspace' : 'Open review workspace'}
                    aria-pressed={rightPanelOpen && rightPanelMode === 'review'}
                >
                    <RightSidebarIcon size={14} strokeWidth={1.7} />
                </button>
            ) : null}
        </div>
    )
})
