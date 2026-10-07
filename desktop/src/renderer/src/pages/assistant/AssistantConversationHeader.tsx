import { memo, useState } from 'react'
import { Check, Folder, MoreHorizontal, PanelRightClose, PanelRightOpen, Radio } from 'lucide-react'
import { FileActionsMenu } from '@/components/ui/FileActionsMenu'
import type { AssistantChatDisplayMode } from '@/lib/settings'
import { cn } from '@/lib/utils'
import { copyChatThreadId } from './assistant-chat-menu-state'
import { createChatActionMenuItems } from './assistant-chat-actions-menu'
import { AssistantProjectIcon } from './AssistantProjectIcon'
import { AssistantSessionTitleText } from './AssistantSessionTitleText'
import { AssistantAgentPresenceIndicator } from './AssistantAgentPresenceIndicator'
import { AssistantTuiPresenceIndicator } from './AssistantTuiPresenceIndicator'
import { assistantMobileDevices, assistantMobileVoiceDevice, hasAssistantTuiPresence } from './assistant-tui-presence'

export const AssistantConversationHeader = memo(function AssistantConversationHeader(props: {
    displayMode?: AssistantChatDisplayMode
    rightPanelOpen: boolean
    rightPanelMode: 'none' | 'details' | 'plan' | 'review'
    showRightSidebarToggle?: boolean
    selectedSessionTitle: string
    titleGenerating?: boolean
    settled?: boolean
    pinned?: boolean
    settlementDisabled?: boolean
    onToggleSettlement?: () => void
    onTogglePinned?: () => void
    onRegenerateTitle?: () => void | Promise<void>
    canonicalThreadId: string | null
    canonicalPresence?: {
        state: 'detached' | 'ready' | 'running' | 'background'
        clients: Array<{ clientId: string; surface: string; displayName?: string }>
        latestSequence?: number
    } | null
    mobileVoice?: { deviceName: string } | null
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
        mobileVoice,
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
    const mobileDevices = showPresenceBadge ? assistantMobileDevices(canonicalPresence) : []
    const mobileVoiceDevice = showPresenceBadge ? assistantMobileVoiceDevice(mobileVoice) : null
    const remoteSurfaces = [...new Set((canonicalPresence?.clients || [])
        .map((client) => client.surface.trim().toLowerCase())
        .filter((surface) => surface && surface !== 'desktop' && surface !== 'tui' && surface !== 'mobile'))]
    const remotePresenceLabel = showPresenceBadge && remoteSurfaces.length > 0
        ? `${canonicalPresence?.state === 'running' ? 'Running' : canonicalPresence?.state === 'background' ? 'Background work' : 'Open'} in ${remoteSurfaces.join(' + ')}`
        : null
    const diagnosticsLabel = showDiagnostics
        ? canonicalPresence
            ? `${canonicalPresence.state}${typeof canonicalPresence.latestSequence === 'number' ? ` · seq ${canonicalPresence.latestSequence}` : ''}`
            : 'presence unavailable'
        : null
    const headerMenuItems = createChatActionMenuItems({
        disabled: actionsDisabled, pinned: props.pinned, settled: props.settled,
        settlementDisabled: props.settlementDisabled, titleGenerating,
        canonicalThreadId, threadIdCopied, projectPath: selectedProjectPath, projectLocked: projectDirectoryLocked,
        onCreateThread, onRename: onRenameChat, onChooseProject,
        onCopyThreadId: async () => {
            if (await copyChatThreadId(canonicalThreadId, input => onShowToast?.(input.message, input.tone))) {
                setThreadIdCopied(true)
                window.setTimeout(() => setThreadIdCopied(false), 1600)
            }
        },
        onTogglePinned: props.onTogglePinned, onToggleSettlement: props.onToggleSettlement,
        onRegenerateTitle: props.onRegenerateTitle,
        onArchive: onArchiveChat, onDelete: onDeleteChat
    })

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
                ) : <span className="inline-flex shrink-0 items-center gap-1.5 text-[12px] font-medium leading-none text-sparkle-text-muted/65" aria-label="Chat"><Folder size={12} /><span>Chat</span></span>}
                <span className="shrink-0 px-0.5 text-[12px] text-sparkle-text-muted/35" aria-hidden="true">/</span>
                <div className="flex min-w-0 items-center gap-0.5 overflow-hidden">
                    <h2 className={cn('min-w-0 max-w-[min(360px,35vw)] text-[12px] leading-none text-sparkle-text/90', minimal ? 'font-medium' : 'font-semibold')}>
                        <AssistantSessionTitleText title={selectedSessionTitle} generating={titleGenerating} reveal={false} />
                    </h2>
                    <FileActionsMenu
                        items={headerMenuItems}
                        rootClassName={minimal ? 'assistant-header-actions' : undefined}
                        title="Chat actions"
                        triggerIcon={<MoreHorizontal size={14} className="rotate-90" />}
                        presentation="portal"
                        buttonClassName={cn(
                            'h-5 w-5 rounded-md border-transparent bg-transparent p-0 text-sparkle-text-muted hover:border-transparent hover:bg-[var(--surface-hover)] hover:text-sparkle-text',
                            minimal && 'shrink-0'
                        )}
                        openButtonClassName="rounded-md border-transparent bg-[var(--surface-hover)] p-0 text-sparkle-text"
                    />
                    <span className="inline-flex shrink-0 items-center" data-assistant-presence-group>
                        <AssistantAgentPresenceIndicator thread={activeThreadIsSubagent ? { source: 'subagent', agentNickname: activeThreadLabel, agentRole: null } : null} />
                        {tuiOpen ? <AssistantTuiPresenceIndicator /> : null}
                        {mobileDevices.length > 0 || mobileVoiceDevice ? <AssistantTuiPresenceIndicator mobileDevices={mobileDevices} mobileVoiceDevice={mobileVoiceDevice} /> : null}
                    </span>
                    {props.settled ? <span className="ml-1 inline-flex shrink-0 items-center gap-1 text-[10px] font-normal text-sparkle-text-muted" title="Send a message to unsettle this thread"><Check size={11} /><span>Settled</span></span> : null}
                </div>
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
                    title={rightPanelOpen ? 'Close inspector' : 'Open inspector'}
                    aria-label={rightPanelOpen ? 'Close inspector' : 'Open inspector'}
                    aria-pressed={rightPanelOpen && rightPanelMode === 'review'}
                >
                    <RightSidebarIcon size={14} strokeWidth={1.7} />
                </button>
            ) : null}
        </div>
    )
})
