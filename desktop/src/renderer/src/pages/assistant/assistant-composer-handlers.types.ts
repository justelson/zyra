import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { AssistantInteractionMode, AssistantRuntimeMode } from '@shared/assistant/contracts'
import type { AssistantBusyMessageMode } from '@/lib/settings'
import type { MentionCandidate } from './assistant-composer-mentions'
import type { InlineMentionTag } from './assistant-composer-inline-mentions'
import type { AssistantComposerPreferenceEffort } from './assistant-composer-preferences'
import type { AssistantComposerDisabledReason, ComposerContextFile } from './assistant-composer-types'

type SetStringState = Dispatch<SetStateAction<string>>
type SetBooleanState = Dispatch<SetStateAction<boolean>>
type SetNumberState = Dispatch<SetStateAction<number>>
type SetStringArrayState = Dispatch<SetStateAction<string[]>>
type SetContextFilesState = Dispatch<SetStateAction<ComposerContextFile[]>>
type SetInlineMentionTagsState = Dispatch<SetStateAction<InlineMentionTag[]>>

export type AssistantComposerHandlersArgs = {
    disabled: boolean
    disabledReason?: AssistantComposerDisabledReason | null
    allowEmptySubmit: boolean
    isConnected: boolean
    isSending: boolean
    isThinking: boolean
    busyMessageMode: AssistantBusyMessageMode
    startInNewWorktree?: boolean
    onStop?: () => Promise<void> | void
    onSend: (prompt: string, contextFiles: ComposerContextFile[], options: {
        startInNewWorktree?: boolean
        model?: string
        runtimeMode: AssistantRuntimeMode
        interactionMode: AssistantInteractionMode
        effort: AssistantComposerPreferenceEffort
        serviceTier?: 'fast'
        dispatchMode?: 'immediate' | 'queue' | 'steer' | 'force'
    }) => Promise<boolean>
    text: string
    setText: SetStringState
    inlineMentionTags: InlineMentionTag[]
    setInlineMentionTags: SetInlineMentionTagsState
    contextFiles: ComposerContextFile[]
    setContextFiles: SetContextFilesState
    sentPromptHistory: string[]
    setSentPromptHistory: SetStringArrayState
    historyCursor: number | null
    setHistoryCursor: Dispatch<SetStateAction<number | null>>
    draftBeforeHistory: string
    setDraftBeforeHistory: SetStringState
    showMentionMenu: boolean
    setShowMentionMenu: SetBooleanState
    mentionCandidates: MentionCandidate[]
    mentionState: { start: number; query: string } | null
    activeMentionCandidate: MentionCandidate | null
    setActiveMentionIndex: SetNumberState
    showModelDropdown: boolean
    setShowModelDropdown: SetBooleanState
    filteredModelOptions: Array<{ id: string; label: string; description?: string }>
    activeModelCandidate: { id: string; label: string; description?: string } | null
    setActiveModelIndex: SetNumberState
    showBranchDropdown: boolean
    setShowBranchDropdown: SetBooleanState
    filteredBranches: Array<{ name: string; label?: string; commit?: string; current?: boolean }>
    activeBranchCandidate: { name: string; label?: string; commit?: string; current?: boolean } | null
    setActiveBranchIndex: SetNumberState
    onSwitchBranch: (branchName: string) => Promise<void>
    selectedModel: string
    selectedModelInputModes?: string[]
    setSelectedModel: SetStringState
    selectedRuntimeMode: AssistantRuntimeMode
    setSelectedRuntimeMode: Dispatch<SetStateAction<AssistantRuntimeMode>>
    selectedInteractionMode: AssistantInteractionMode
    selectedEffort: AssistantComposerPreferenceEffort
    fastModeEnabled: boolean
    setComposerCursor: SetNumberState
    removingAttachmentIds: string[]
    setRemovingAttachmentIds: SetStringArrayState
    textareaRef: RefObject<HTMLTextAreaElement | null>
    /** Async file reads may finish after navigation or question replacement. */
    isAttachmentOwnerCurrent?: () => boolean
    pendingAttachmentOperations?: Set<symbol>
    onBlockedSend?: (message: string) => void
    sendBlockedReason?: string | null
    onOptimisticSendClear?: () => void
    canClearAcceptedDraft?: (submittedText: string, submittedFiles: ComposerContextFile[]) => boolean
    shouldRestoreAfterFailedSend?: () => boolean
    onRestoreFailedSendDraft?: (draft: string) => void
}
