import type { AssistantChatScopeRoot, AssistantInteractionMode, AssistantModelInfo, AssistantReasoningEffort, AssistantRuntimeMode, AssistantTurnUsage, AssistantVoiceExecutionConfiguration } from '@shared/assistant/contracts'
import type { PreviewOpenOptions } from '@/components/ui/file-preview/types'
import type { AssistantBusyMessageMode } from '@/lib/settings'
import type { AssistantProjectChoice } from './assistant-project-choices'

export type AssistantComposerProjectRoot = AssistantChatScopeRoot

export type ComposerContextFile = {
    citation?: import('@shared/assistant/assistant-citations').AssistantCitation
    selection?: import('./assistant-code-context').CodeSelectionSnapshot
    id: string
    path: string
    name?: string
    content?: string
    mimeType?: string
    kind?: 'image' | 'video' | 'doc' | 'code' | 'file'
    sizeBytes?: number
    previewText?: string
    previewDataUrl?: string
    source?: 'manual' | 'paste'
    animateIn?: boolean
}

export type AssistantElementBounds = {
    top: number
    right: number
    bottom: number
    left: number
    width: number
    height: number
}

export type AssistantComposerSendOptions = {
    /** Stable request identity prevents duplicate queued copies on answer retries. */
    answerRequestId?: string
    targetTurnId?: string
    startInNewWorktree?: boolean
    model?: string
    /** Captured at acceptance so background/queued sends cannot inherit another Chat's profile. */
    profile?: string
    runtimeMode: AssistantRuntimeMode
    interactionMode: AssistantInteractionMode
    effort: AssistantReasoningEffort
    serviceTier?: 'fast'
    dispatchMode?: 'immediate' | 'queue' | 'steer' | 'force'
}

export type AssistantQueuedComposerMessage = {
    id: string
    prompt: string
    contextFiles: ComposerContextFile[]
    dispatchMode: 'queue' | 'steer' | 'force'
    status: 'queued' | 'paused' | 'compacting' | 'held' | 'sending' | 'failed'
}

export type AssistantComposerDisabledReason = 'no-session' | 'project-required'

export type AssistantComposerProps = {
    sessionId?: string | null
    configurationThreadId?: string | null
    useSettingsDefaults?: boolean
    resetStateToken?: string | null
    placement?: 'bottom' | 'center'
    onSend: (prompt: string, contextFiles: ComposerContextFile[], options: AssistantComposerSendOptions) => Promise<boolean>
    onDraftStarted?: () => void
    onStop?: () => Promise<void> | void
    isStopping?: boolean
    queueHeld?: boolean
    onHoldQueue?: () => unknown
    onResumeQueue?: () => boolean | Promise<boolean> | void
    onReconnect?: () => Promise<void> | void
    onPrepareRealtimeVoice?: (configuration: AssistantVoiceExecutionConfiguration) => void
    onStartRealtimeVoice?: (configuration: AssistantVoiceExecutionConfiguration) => void
    realtimeVoiceDisabled?: boolean
    onOverflowWheel?: (deltaY: number) => void
    onBlockedSend?: (message: string) => void
    onCancelDirty?: () => void
    onOpenAttachmentPreview?: (
        file: { name: string; path: string },
        ext: string,
        options?: PreviewOpenOptions
    ) => Promise<void> | void
    onAttachmentShelfBoundsChange?: (bounds: AssistantElementBounds | null) => void
    disabled: boolean
    disabledReason?: AssistantComposerDisabledReason | null
    allowEmptySubmit?: boolean
    isSending: boolean
    isThinking: boolean
    thinkingLabel?: string
    modelInactivity?: import('./AssistantModelInactivityPanel').AssistantModelInactivityPanelProps
    isConnected: boolean
    isConnecting?: boolean
    activeModel?: string
    activeEffort?: AssistantReasoningEffort | null
    activeFastModeEnabled?: boolean
    modelOptions?: AssistantModelInfo[]
    modelsLoading?: boolean
    modelsError?: string | null
    onRefreshModels?: () => void
    activeProfile?: string
    zyraProfile?: 'concise' | 'friendly' | 'direct' | 'thoughtful' | 'playful'
    onZyraProfileChange?: (profile: 'concise' | 'friendly' | 'direct' | 'thoughtful' | 'playful') => void
    runtimeMode?: AssistantRuntimeMode
    interactionMode?: AssistantInteractionMode
    projectId?: string | null
    projectPath?: string | null
    projectName?: string | null
    projectIconSourcePath?: string | null
    projectRoots?: AssistantComposerProjectRoot[]
    projectChoices?: AssistantProjectChoice[]
    projectContextDisabled?: boolean
    projectContextUnavailableReason?: string | null
    onProjectContextUnavailable?: (reason: string) => void
    onSelectProject?: (projectId: string | null) => Promise<void> | void
    onCreateProject?: () => Promise<void> | void
    acceptBrowserAnnotations?: boolean
    compact?: boolean
    submitLabel?: string
    dirtySubmitLabel?: string
    cancelLabel?: string
    showCancelWhenDirty?: boolean
    queuedMessageCount?: number
    queuedMessages?: AssistantQueuedComposerMessage[]
    onForceQueuedMessage?: (messageId: string) => Promise<void> | void
    onDeleteQueuedMessage?: (messageId: string) => boolean | Promise<void> | void
    onMoveQueuedMessage?: (messageId: string, targetMessageId: string) => boolean | Promise<void> | void
    onUpdateQueuedMessage?: (messageId: string, prompt: string) => boolean | Promise<boolean> | void
    busyMessageMode?: AssistantBusyMessageMode
    reconnectPending?: boolean
    latestTurnUsage?: AssistantTurnUsage | null
}
