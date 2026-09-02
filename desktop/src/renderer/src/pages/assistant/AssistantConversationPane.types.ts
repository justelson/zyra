import type { AssistantMessage } from '@shared/assistant/contracts'
import type { PreviewOpenOptions } from '@/components/ui/file-preview/types'
import type { AssistantDiffTarget } from './assistant-diff-types'

export type AssistantConversationPaneProps = {
    rightPanelOpen: boolean
    rightPanelMode: 'none' | 'details' | 'plan' | 'review'
    showRightSidebarToggle?: boolean
    deletingMessageId: string | null
    focusMessageId?: string | null
    fallbackSessionMode: 'work' | 'playground'
    playgroundRootMissing: boolean
    playgroundTerminalAccess: boolean
    playgroundTerminalAccessRequestMuted: boolean
    autoStartDetachedPlaygroundChat: boolean
    onChoosePlaygroundRoot: () => Promise<void> | void
    onPlaygroundTerminalAccessChange: (enabled: boolean) => void
    onPlaygroundTerminalAccessRequestMutedChange: (muted: boolean) => void
    onRequestDeleteUserMessage: (message: AssistantMessage) => void
    onToggleRightSidebar: () => void
    onTogglePlanPanel: () => void
    onStartDetachedPlaygroundChat: () => Promise<void> | void
    onOpenAttachmentPreview?: (
        file: { name: string; path: string },
        ext: string,
        options?: PreviewOpenOptions
    ) => Promise<void> | void
    onOpenAssistantLink?: (href: string) => Promise<boolean | void> | boolean | void
    onOpenEditedFile?: (filePath: string) => Promise<void> | void
    onViewDiff?: (target: AssistantDiffTarget) => void
    onShowToast?: (message: string, tone?: 'success' | 'error' | 'info') => void
}
