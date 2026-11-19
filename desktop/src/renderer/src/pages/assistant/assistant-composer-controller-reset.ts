import type { AssistantSpeedPreference } from './assistant-model-groups'
import type { RefObject } from 'react'
import type { AssistantInteractionMode, AssistantRuntimeMode } from '@shared/assistant/contracts'
import type { AssistantComposerPreferenceEffort } from './assistant-composer-preferences'
import type { AssistantComposerSessionState } from './assistant-composer-session-state'
import type { ComposerContextFile } from './assistant-composer-types'

export function resetAssistantComposerDirtyState(input: {
    onCancelDirty?: () => void
    nextState: AssistantComposerSessionState
    resolvedModel: string
    baseRuntimeMode: AssistantRuntimeMode
    baseInteractionMode: AssistantInteractionMode
    defaultEffort: AssistantComposerPreferenceEffort
    defaultFastModeEnabled: AssistantSpeedPreference
    textareaRef: RefObject<HTMLTextAreaElement | null>
    setText: (value: string) => void
    setInlineMentionTags: (value: []) => void
    setContextFiles: (value: ComposerContextFile[]) => void
    setSentPromptHistory: (value: []) => void
    setShowMentionMenu: (value: boolean) => void
    setPreviewAttachment: (value: null) => void
    setRemovingAttachmentIds: (value: []) => void
    setSelectedModel: (value: string) => void
    setSelectedRuntimeMode: (value: AssistantRuntimeMode) => void
    setSelectedInteractionMode: (value: AssistantInteractionMode) => void
    setSelectedEffort: (value: AssistantComposerPreferenceEffort) => void
    setFastModeEnabled: (value: AssistantSpeedPreference) => void
    setComposerCursor: (value: number) => void
}) {
    const {
        onCancelDirty,
        nextState,
        resolvedModel,
        baseRuntimeMode,
        baseInteractionMode,
        defaultEffort,
        defaultFastModeEnabled,
        textareaRef,
        setText,
        setInlineMentionTags,
        setContextFiles,
        setSentPromptHistory,
        setShowMentionMenu,
        setPreviewAttachment,
        setRemovingAttachmentIds,
        setSelectedModel,
        setSelectedRuntimeMode,
        setSelectedInteractionMode,
        setSelectedEffort,
        setFastModeEnabled,
        setComposerCursor
    } = input

    onCancelDirty?.()
    setText(nextState.draft || '')
    setInlineMentionTags([])
    setContextFiles(nextState.contextFiles || [])
    setSentPromptHistory([])
    setShowMentionMenu(false)
    setPreviewAttachment(null)
    setRemovingAttachmentIds([])
    setSelectedModel(nextState.model || resolvedModel)
    setSelectedRuntimeMode(nextState.runtimeMode || baseRuntimeMode)
    setSelectedInteractionMode(nextState.interactionMode || baseInteractionMode)
    setSelectedEffort(nextState.effort || defaultEffort)
    setFastModeEnabled(nextState.fastModeEnabled ?? defaultFastModeEnabled)
    setComposerCursor(0)
    window.requestAnimationFrame(() => {
        const textarea = textareaRef.current
        if (!textarea) return
        textarea.focus()
        textarea.setSelectionRange(0, 0)
    })
}
