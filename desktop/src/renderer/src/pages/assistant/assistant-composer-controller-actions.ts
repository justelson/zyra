import type { AssistantSpeedPreference } from './assistant-model-groups'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { AssistantInteractionMode, AssistantRuntimeMode } from '@shared/assistant/contracts'
import type { DevScopeGitBranchSummary } from '@shared/contracts/devscope-api'
import type { AssistantComposerPreferenceEffort } from './assistant-composer-preferences'
import {
    writeAssistantComposerSessionState,
    type AssistantComposerSessionState
} from './assistant-composer-session-state'
import type { ComposerContextFile } from './assistant-composer-types'
import { MAX_ATTACHMENT_CONTENT_CHARS, summarizeTextPreview } from './assistant-composer-utils'

type SetComposerContextFiles = Dispatch<SetStateAction<ComposerContextFile[]>>
type SetPreviewAttachment = Dispatch<SetStateAction<ComposerContextFile | null>>

export function buildAssistantComposerSessionState(input: {
    draft?: string
    selectedModel: string
    selectedRuntimeMode: AssistantRuntimeMode
    selectedInteractionMode: AssistantInteractionMode
    selectedEffort: AssistantComposerPreferenceEffort
    fastModeEnabled: AssistantSpeedPreference
}): AssistantComposerSessionState {
    const {
        draft,
        selectedModel,
        selectedRuntimeMode,
        selectedInteractionMode,
        selectedEffort,
        fastModeEnabled
    } = input

    return {
        draft: draft && draft.trim() ? draft : undefined,
        model: selectedModel || undefined,
        runtimeMode: selectedRuntimeMode,
        interactionMode: selectedInteractionMode,
        effort: selectedEffort,
        fastModeEnabled
    }
}

export function persistAssistantComposerSessionStateImmediately(input: {
    sessionId?: string | null
    nextState: AssistantComposerSessionState
    persistedSessionStateRef: MutableRefObject<AssistantComposerSessionState>
    persistTimeoutRef: MutableRefObject<number | null>
}) {
    const {
        sessionId,
        nextState,
        persistedSessionStateRef,
        persistTimeoutRef
    } = input

    if (persistTimeoutRef.current != null) {
        window.clearTimeout(persistTimeoutRef.current)
        persistTimeoutRef.current = null
    }
    if (!sessionId) {
        persistedSessionStateRef.current = nextState
        return nextState
    }

    const persisted = writeAssistantComposerSessionState(sessionId, nextState)
    persistedSessionStateRef.current = persisted
    return persisted
}

export function updateAssistantComposerContextFileText(input: {
    fileId: string
    nextText: string
    setContextFiles: SetComposerContextFiles
    setPreviewAttachment: SetPreviewAttachment
}) {
    const { fileId, nextText, setContextFiles, setPreviewAttachment } = input
    const normalizedText = String(nextText || '')
    const safeText = normalizedText.length > MAX_ATTACHMENT_CONTENT_CHARS
        ? normalizedText.slice(0, MAX_ATTACHMENT_CONTENT_CHARS)
        : normalizedText

    setContextFiles((prev) => prev.map((entry) => {
        if (entry.id !== fileId) return entry
        return {
            ...entry,
            content: safeText,
            previewText: summarizeTextPreview(safeText),
            sizeBytes: safeText.length
        }
    }))

    setPreviewAttachment((current) => {
        if (!current || current.id !== fileId) return current
        return {
            ...current,
            content: safeText,
            previewText: summarizeTextPreview(safeText),
            sizeBytes: safeText.length
        }
    })
}

export async function switchAssistantComposerBranch(input: {
    projectPath?: string | null
    branchName: string
    currentBranch: string | null
    isSwitchingBranch: boolean
    setIsSwitchingBranch: Dispatch<SetStateAction<boolean>>
    setBranchActionError: Dispatch<SetStateAction<string | null>>
    setBranches: Dispatch<SetStateAction<DevScopeGitBranchSummary[]>>
    setShowBranchDropdown: Dispatch<SetStateAction<boolean>>
    setBranchQuery: Dispatch<SetStateAction<string>>
    setActiveBranchIndex: Dispatch<SetStateAction<number>>
    setBranchRefreshToken: Dispatch<SetStateAction<number>>
}) {
    const {
        projectPath,
        branchName,
        currentBranch,
        isSwitchingBranch,
        setIsSwitchingBranch,
        setBranchActionError,
        setBranches,
        setShowBranchDropdown,
        setBranchQuery,
        setActiveBranchIndex,
        setBranchRefreshToken
    } = input

    const trimmedProjectPath = String(projectPath || '').trim()
    const trimmedBranchName = String(branchName || '').trim()
    if (!trimmedProjectPath || !trimmedBranchName || trimmedBranchName === currentBranch || isSwitchingBranch) return

    setIsSwitchingBranch(true)
    setBranchActionError(null)
    try {
        const result = await window.devscope.checkoutBranch(trimmedProjectPath, trimmedBranchName, {
            autoStash: true,
            autoCleanupLock: true
        })
        if (!result?.success) {
            throw new Error(result?.error || 'Failed to switch branch')
        }
        setBranches((previous) => previous.map((branch) => ({ ...branch, current: branch.name === trimmedBranchName })))
        setShowBranchDropdown(false)
        setBranchQuery('')
        setActiveBranchIndex(0)
        setBranchRefreshToken((current) => current + 1)
    } catch (error) {
        setBranchActionError(error instanceof Error ? error.message : 'Failed to switch branch')
    } finally {
        setIsSwitchingBranch(false)
    }
}
