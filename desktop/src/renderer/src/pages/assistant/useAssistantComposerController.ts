import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AssistantInteractionMode, AssistantRuntimeMode } from '@shared/assistant/contracts'
import type { DevScopeGitBranchSummary } from '@shared/contracts/devscope-api'
import { useSettings } from '@/lib/settings'
import type { MentionCandidate } from './assistant-composer-mentions'
import { createAssistantComposerHandlers } from './assistant-composer-handlers'
import {
    buildAssistantComposerSessionState,
    persistAssistantComposerSessionStateImmediately,
    switchAssistantComposerBranch,
    updateAssistantComposerContextFileText
} from './assistant-composer-controller-actions'
import {
    syncScrollAffordance
} from './assistant-composer-controller-constants'
import { buildAssistantComposerControllerResult } from './assistant-composer-controller-result'
import {
    useAssistantComposerCapabilitiesState,
    useAssistantComposerDerivedOptions,
    useAssistantComposerDirtyState,
    useAssistantComposerSessionDefaults,
    resolveRetainedAssistantComposerModel
} from './assistant-composer-controller-derived'
import { resetAssistantComposerDirtyState } from './assistant-composer-controller-reset'
import {
    type InlineMentionTag
} from './assistant-composer-inline-mentions'
import { useAssistantComposerProjectData } from './useAssistantComposerProjectData'
import { useAssistantSpeechInput } from './useAssistantSpeechInput'
import { useAssistantComposerControllerEffects } from './useAssistantComposerControllerEffects'
import type { AssistantComposerPreferenceEffort } from './assistant-composer-preferences'
import {
    serializeAssistantBrowserAnnotation,
    subscribeAssistantBrowserAnnotationAttachments
} from './assistant-browser-annotation-composer'
import { coerceAssistantReasoningEffortForModel, getAssistantModelReasoningEfforts } from '@shared/assistant/reasoning-efforts'
import {
    readAssistantComposerSessionOverrides,
    type AssistantComposerSessionState
} from './assistant-composer-session-state'
import type { AssistantComposerProps, AssistantQueuedComposerMessage, ComposerContextFile } from './assistant-composer-types'

function isLegacyFallbackModel(model: string | null | undefined): boolean {
    const normalized = String(model || '').trim().toLowerCase()
    return /(?:^|[/\s])gpt-5\.[23](?:$|[\s-])/.test(normalized)
}

function normalizeComposerDefaultModel(model: string | null | undefined): string {
    const normalized = String(model || '').trim()
    return normalized && !isLegacyFallbackModel(normalized) ? normalized : ''
}

export function useAssistantComposerController(props: AssistantComposerProps) {
    const { settings } = useSettings()
    const {
        sessionId,
        useSettingsDefaults = false,
        resetStateToken = null,
        placement = 'bottom',
        onSend,
        onDraftStarted,
        onStop,
        onReconnect,
        onOverflowWheel,
        onBlockedSend,
        onCancelDirty,
        onOpenAttachmentPreview,
        onAttachmentShelfBoundsChange,
        disabled,
        disabledReason = null,
        allowEmptySubmit = false,
        isSending,
        isThinking,
        thinkingLabel = 'Working...',
        isConnected,
        isConnecting = false,
        activeModel,
        activeEffort,
        activeFastModeEnabled,
        modelOptions,
        modelsLoading = false,
        modelsError = null,
        onRefreshModels,
        activeProfile,
        zyraProfile = 'default',
        onZyraProfileChange,
        runtimeMode,
        interactionMode,
        projectPath,
        projectChoices = [],
        projectContextDisabled = false,
        onSelectProject,
        onChooseProjectFolder,
        acceptBrowserAnnotations = true,
        compact = false,
        submitLabel = 'Send',
        dirtySubmitLabel,
        cancelLabel = 'Cancel',
        showCancelWhenDirty = false,
        queuedMessageCount = 0,
        queuedMessages = [],
        onForceQueuedMessage,
        onDeleteQueuedMessage,
        onMoveQueuedMessage,
        reconnectPending = false,
        latestTurnUsage = null
    } = props
    const normalizedSessionId = sessionId ?? null

    const {
        availableModelOptions,
        baseInteractionMode,
        baseRuntimeMode,
        fallbackComposerState,
        initialComposerSessionState,
        rawAvailableModelOptionsLength,
        resolvedModel
    } = useAssistantComposerSessionDefaults({
        settings,
        activeProfile,
        runtimeMode,
        interactionMode,
        activeModel,
        activeEffort,
        activeFastModeEnabled,
        modelOptions,
        sessionId: normalizedSessionId,
        useSettingsDefaults
    })
    const [text, setText] = useState(initialComposerSessionState.draft || '')
    const [inlineMentionTags, setInlineMentionTags] = useState<InlineMentionTag[]>([])
    const [contextFiles, setContextFiles] = useState<ComposerContextFile[]>([])
    const [sentPromptHistory, setSentPromptHistory] = useState<string[]>([])
    const [historyCursor, setHistoryCursor] = useState<number | null>(null)
    const [draftBeforeHistory, setDraftBeforeHistory] = useState('')
    const [showModelDropdown, setShowModelDropdown] = useState(false)
    const [showTraitsDropdown, setShowTraitsDropdown] = useState(false)
    const [showBranchDropdown, setShowBranchDropdown] = useState(false)
    const [showMentionMenu, setShowMentionMenu] = useState(false)
    const [composerCursor, setComposerCursor] = useState(0)
    const [modelQuery, setModelQuery] = useState('')
    const [branchQuery, setBranchQuery] = useState('')
    const [previewAttachment, setPreviewAttachment] = useState<ComposerContextFile | null>(null)
    const [removingAttachmentIds, setRemovingAttachmentIds] = useState<string[]>([])
    const [branches, setBranches] = useState<DevScopeGitBranchSummary[]>([])
    const [isGitRepo, setIsGitRepo] = useState(false)
    const [branchesLoading, setBranchesLoading] = useState(false)
    const [projectNodes, setProjectNodes] = useState<MentionCandidate[]>([])
    const [mentionLoading, setMentionLoading] = useState(false)
    const [activeMentionIndex, setActiveMentionIndex] = useState(0)
    const [activeModelIndex, setActiveModelIndex] = useState(0)
    const [activeBranchIndex, setActiveBranchIndex] = useState(0)
    const [mentionCanScrollUp, setMentionCanScrollUp] = useState(false)
    const [mentionCanScrollDown, setMentionCanScrollDown] = useState(false)
    const [mentionChangedStateByPath, setMentionChangedStateByPath] = useState<Record<string, 'staged' | 'unstaged' | 'both'>>({})
    const [mentionRecentModifiedAtByPath, setMentionRecentModifiedAtByPath] = useState<Record<string, number>>({})
    const [branchRefreshToken, setBranchRefreshToken] = useState(0)
    const [isSwitchingBranch, setIsSwitchingBranch] = useState(false)
    const [branchActionError, setBranchActionError] = useState<string | null>(null)
    const [selectedEffort, setSelectedEffort] = useState<AssistantComposerPreferenceEffort>(() => coerceAssistantReasoningEffortForModel(
        initialComposerSessionState.effort || fallbackComposerState.effort || 'medium',
        resolvedModel
    ))
    const [fastModeEnabled, setFastModeEnabled] = useState(initialComposerSessionState.fastModeEnabled ?? fallbackComposerState.fastModeEnabled ?? false)
    const [isCompactFooter, setIsCompactFooter] = useState(compact)
    const [loadedSessionId, setLoadedSessionId] = useState<string | null>(normalizedSessionId)
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const filePickerRef = useRef<HTMLInputElement>(null)
    const composerRootRef = useRef<HTMLDivElement>(null)
    const modelDropdownRef = useRef<HTMLDivElement>(null)
    const modelListRef = useRef<HTMLDivElement>(null)
    const branchDropdownRef = useRef<HTMLDivElement>(null)
    const mentionMenuRef = useRef<HTMLDivElement>(null)
    const mentionListRef = useRef<HTMLDivElement>(null)
    const traitsDropdownRef = useRef<HTMLDivElement>(null)
    const persistedSessionStateRef = useRef<AssistantComposerSessionState>(initialComposerSessionState)
    const initializedSessionIdRef = useRef<string | null | undefined>(undefined)
    const persistTimeoutRef = useRef<number | null>(null)
    const latestTextRef = useRef(text)
    const latestInlineMentionTagsRef = useRef(inlineMentionTags)
    const latestContextFilesRef = useRef(contextFiles)
    const warmedDraftKeyRef = useRef<string | null>(null)

    const [selectedModel, setSelectedModel] = useState(normalizeComposerDefaultModel(initialComposerSessionState.model || resolvedModel))
    const [selectedRuntimeMode, setSelectedRuntimeMode] = useState<AssistantRuntimeMode>(initialComposerSessionState.runtimeMode || baseRuntimeMode)
    const [selectedInteractionMode, setSelectedInteractionMode] = useState<AssistantInteractionMode>(initialComposerSessionState.interactionMode || baseInteractionMode)
    const {
        activeBranchCandidate,
        activeMentionCandidate,
        activeModelCandidate,
        branchButtonLabel,
        currentBranch,
        defaultBranchName,
        displayedProfile,
        filteredBranches,
        filteredModelOptions,
        latestModelId,
        mentionCandidates,
        mentionState,
        selectedModelLabel
    } = useAssistantComposerDerivedOptions({
        text, composerCursor, inlineMentionTags, projectNodes, mentionChangedStateByPath, mentionRecentModifiedAtByPath,
        modelQuery, availableModelOptions, branchQuery, branches, activeMentionIndex, activeModelIndex, activeBranchIndex,
        selectedModel, selectedRuntimeMode, baseRuntimeMode, activeProfile, settings, isSwitchingBranch, branchesLoading
    })
    const selectedModelOption = useMemo(
        () => availableModelOptions.find((model) => model.id === selectedModel) || selectedModel,
        [availableModelOptions, selectedModel]
    )
    const selectedModelSupportedEffortsSignature = typeof selectedModelOption === 'string'
        ? ''
        : (selectedModelOption.supportedEfforts || []).join('\n')
    const effortOptions = useMemo(
        () => getAssistantModelReasoningEfforts(selectedModelOption),
        [selectedModel, selectedModelSupportedEffortsSignature]
    )
    const effortOptionsSignature = effortOptions.join('\n')
    useEffect(() => {
        const canonicalModel = normalizeComposerDefaultModel(activeModel)
        if (!canonicalModel || readAssistantComposerSessionOverrides(normalizedSessionId).model) return
        setSelectedModel(canonicalModel)
    }, [activeModel, normalizedSessionId])
    useEffect(() => {
        if (!runtimeMode || readAssistantComposerSessionOverrides(normalizedSessionId).runtimeMode) return
        setSelectedRuntimeMode(runtimeMode)
    }, [normalizedSessionId, runtimeMode])
    useEffect(() => {
        if (!interactionMode || readAssistantComposerSessionOverrides(normalizedSessionId).interactionMode) return
        setSelectedInteractionMode(interactionMode)
    }, [interactionMode, normalizedSessionId])
    useEffect(() => {
        if (!activeEffort || readAssistantComposerSessionOverrides(normalizedSessionId).effort) return
        setSelectedEffort(coerceAssistantReasoningEffortForModel(activeEffort, activeModel || selectedModel))
    }, [activeEffort, activeModel, normalizedSessionId])
    useEffect(() => {
        if (typeof activeFastModeEnabled !== 'boolean' || readAssistantComposerSessionOverrides(normalizedSessionId).fastModeEnabled !== undefined) return
        setFastModeEnabled(activeFastModeEnabled)
    }, [activeFastModeEnabled, normalizedSessionId])
    useEffect(() => {
        setSelectedEffort((current) => coerceAssistantReasoningEffortForModel(current, selectedModelOption))
    }, [effortOptionsSignature, selectedModel])
    const availableModelIdSignature = useMemo(() => availableModelOptions.map((model) => model.id).join('\n'), [availableModelOptions])
    const preferredAvailableModelId = latestModelId || availableModelOptions[0]?.id || ''
    useEffect(() => {
        if (!preferredAvailableModelId || availableModelOptions.length === 0) return
        setSelectedModel((current) => resolveRetainedAssistantComposerModel(
            normalizeComposerDefaultModel(current),
            preferredAvailableModelId
        ))
    }, [availableModelIdSignature, availableModelOptions, preferredAvailableModelId])
    const { currentComposerState, isDirty } = useAssistantComposerDirtyState({
        text, selectedModel, selectedRuntimeMode, selectedInteractionMode, selectedEffort, fastModeEnabled,
        contextFiles, persistedComposerState: persistedSessionStateRef.current
    })
    latestTextRef.current = text
    latestInlineMentionTagsRef.current = inlineMentionTags
    latestContextFilesRef.current = contextFiles
    const draftWarmKey = normalizedSessionId ? `${normalizedSessionId}:${resetStateToken || ''}` : null

    useEffect(() => {
        if (!text.trim()) {
            warmedDraftKeyRef.current = null
            return
        }
        if (!draftWarmKey || warmedDraftKeyRef.current === draftWarmKey) return
        warmedDraftKeyRef.current = draftWarmKey
        onDraftStarted?.()
    }, [draftWarmKey, onDraftStarted, text])

    useEffect(() => {
        if (!acceptBrowserAnnotations || !normalizedSessionId) return
        return subscribeAssistantBrowserAnnotationAttachments(normalizedSessionId, ({ annotation, artifact, reference }) => {
            setContextFiles((current) => {
                if (current.some((file) => file.id === annotation.id)) return current
                return [...current, {
                    id: annotation.id,
                    path: reference,
                    name: `preview-annotation-${annotation.id.replace(/[^a-z0-9_-]/gi, '-').slice(0, 80)}.png`,
                    content: serializeAssistantBrowserAnnotation(annotation),
                    mimeType: artifact.mimeType,
                    kind: 'image',
                    sizeBytes: artifact.sizeBytes,
                    previewText: annotation.comment || 'Browser annotation',
                    previewDataUrl: artifact.thumbnailDataUrl,
                    source: 'paste',
                    animateIn: true
                }]
            })
            window.requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }))
        })
    }, [acceptBrowserAnnotations, normalizedSessionId])

    const persistComposerSessionStateImmediately = (nextState: AssistantComposerSessionState) =>
        persistAssistantComposerSessionStateImmediately({ sessionId: normalizedSessionId, nextState, persistedSessionStateRef, persistTimeoutRef })

    const syncComposerCursor = (element: HTMLTextAreaElement | null) => setComposerCursor(element?.selectionStart ?? 0)
    useAssistantComposerControllerEffects({
        compact,
        resetStateToken,
        sessionId: normalizedSessionId,
        loadedSessionId,
        currentComposerState,
        fallbackComposerState,
        resolvedModel,
        baseRuntimeMode,
        baseInteractionMode,
        mentionQueryKey: mentionState ? `${mentionState.query}:${mentionState.start}` : null,
        showMentionMenu,
        mentionLoading,
        mentionCandidatesLength: mentionCandidates.length,
        activeMentionIndex,
        showModelDropdown,
        modelsLoading,
        filteredModelOptionsLength: filteredModelOptions.length,
        activeModelIndex,
        showTraitsDropdown,
        showBranchDropdown,
        contextFiles,
        previewAttachment,
        availableModelOptionsLength: rawAvailableModelOptionsLength,
        firstAvailableModelId: preferredAvailableModelId || null,
        initializedSessionIdRef,
        persistedSessionStateRef,
        persistTimeoutRef,
        composerRootRef,
        modelDropdownRef,
        modelListRef,
        branchDropdownRef,
        mentionMenuRef,
        mentionListRef,
        traitsDropdownRef,
        setLoadedSessionId,
        setText,
        setInlineMentionTags,
        setContextFiles,
        setSentPromptHistory,
        setHistoryCursor,
        setDraftBeforeHistory,
        setShowMentionMenu,
        setPreviewAttachment,
        setRemovingAttachmentIds,
        setSelectedModel,
        setSelectedRuntimeMode,
        setSelectedInteractionMode,
        setSelectedEffort,
        setFastModeEnabled,
        setComposerCursor,
        setActiveMentionIndex,
        setModelQuery,
        setActiveModelIndex,
        setBranchQuery,
        setActiveBranchIndex,
        setShowModelDropdown,
        setShowTraitsDropdown,
        setShowBranchDropdown,
        setMentionCanScrollUp,
        setMentionCanScrollDown,
        setIsCompactFooter
    })

    const updateContextFileText = useCallback(
        (fileId: string, nextText: string) => updateAssistantComposerContextFileText({ fileId, nextText, setContextFiles, setPreviewAttachment }),
        []
    )
    useAssistantComposerProjectData({
        projectPath,
        refreshToken: branchRefreshToken,
        mentionActive: Boolean(mentionState),
        projectNodes,
        mentionChangedStateByPath,
        setIsGitRepo,
        setBranches,
        setBranchesLoading,
        setProjectNodes,
        setMentionLoading,
        setMentionChangedStateByPath,
        setMentionRecentModifiedAtByPath
    })
    const handleBranchSwitch = async (branchName: string) => switchAssistantComposerBranch({
        projectPath, branchName, currentBranch, isSwitchingBranch, setIsSwitchingBranch, setBranchActionError,
        setBranches, setShowBranchDropdown, setBranchQuery, setActiveBranchIndex, setBranchRefreshToken
    })
    const handlers = createAssistantComposerHandlers({
        disabled,
        disabledReason,
        allowEmptySubmit,
        isConnected,
        isSending,
        isThinking,
        busyMessageMode: settings.assistantBusyMessageMode,
        onSend,
        onStop,
        text,
        setText,
        inlineMentionTags,
        setInlineMentionTags,
        contextFiles,
        setContextFiles,
        sentPromptHistory,
        setSentPromptHistory,
        historyCursor,
        setHistoryCursor,
        draftBeforeHistory,
        setDraftBeforeHistory,
        showMentionMenu,
        setShowMentionMenu,
        mentionCandidates,
        mentionState,
        activeMentionCandidate,
        setActiveMentionIndex,
        showModelDropdown,
        setShowModelDropdown,
        filteredModelOptions,
        activeModelCandidate,
        setActiveModelIndex,
        showBranchDropdown,
        setShowBranchDropdown,
        filteredBranches,
        activeBranchCandidate,
        setActiveBranchIndex,
        onSwitchBranch: handleBranchSwitch,
        selectedModel,
        setSelectedModel,
        selectedRuntimeMode,
        setSelectedRuntimeMode,
        selectedInteractionMode,
        selectedEffort,
        fastModeEnabled,
        setComposerCursor,
        removingAttachmentIds,
        setRemovingAttachmentIds,
        textareaRef,
        onBlockedSend,
        onOptimisticSendClear: () => {
            persistComposerSessionStateImmediately(buildAssistantComposerSessionState({
                selectedModel,
                selectedRuntimeMode,
                selectedInteractionMode,
                selectedEffort,
                fastModeEnabled
            }))
        },
        shouldRestoreAfterFailedSend: () => {
            const latestDraft = latestTextRef.current
            const latestTags = latestInlineMentionTagsRef.current
            const latestFiles = latestContextFilesRef.current
            return latestDraft.trim().length === 0 && latestTags.length === 0 && latestFiles.length === 0
        },
        onRestoreFailedSendDraft: (draft) => {
            persistComposerSessionStateImmediately(buildAssistantComposerSessionState({
                draft,
                selectedModel,
                selectedRuntimeMode,
                selectedInteractionMode,
                selectedEffort,
                fastModeEnabled
            }))
        }
    })
    const voiceInput = useAssistantSpeechInput({
        text,
        setText,
        setComposerCursor,
        textareaRef,
        disabled,
        isConnected,
        engine: settings.assistantTranscriptionEngine,
        scopeKey: `${normalizedSessionId || 'new'}:${resetStateToken || ''}`
    })
    const capabilities = useAssistantComposerCapabilitiesState({
        disabled, disabledReason, isConnected, isConnecting, isSending, isThinking, allowEmptySubmit, text,
        contextFilesLength: contextFiles.length, voiceBusy: voiceInput.isStarting || voiceInput.isRecording || voiceInput.isTranscribing, hasStopHandler: Boolean(onStop)
    })
    const handleCancelDirty = () => {
        resetAssistantComposerDirtyState({
            onCancelDirty,
            nextState: persistedSessionStateRef.current,
            resolvedModel,
            baseRuntimeMode,
            baseInteractionMode,
            defaultEffort: fallbackComposerState.effort || 'medium',
            defaultFastModeEnabled: fallbackComposerState.fastModeEnabled ?? false,
            textareaRef,
            setText,
            setInlineMentionTags,
            setContextFiles,
            setSentPromptHistory,
            setHistoryCursor,
            setDraftBeforeHistory,
            setShowMentionMenu,
            setPreviewAttachment,
            setRemovingAttachmentIds,
            setSelectedModel,
            setSelectedRuntimeMode,
            setSelectedInteractionMode,
            setSelectedEffort,
            setFastModeEnabled,
            setComposerCursor
        })
    }

    const restoreQueuedMessageToDraft = useCallback((queuedMessage: AssistantQueuedComposerMessage) => {
        const nextPrompt = queuedMessage.prompt
        const nextContextFiles = queuedMessage.contextFiles.map((file) => ({ ...file }))
        const cursorPosition = nextPrompt.length

        setText(nextPrompt)
        setInlineMentionTags([])
        setContextFiles(nextContextFiles)
        setPreviewAttachment(null)
        setRemovingAttachmentIds([])
        setShowMentionMenu(false)
        setHistoryCursor(null)
        setDraftBeforeHistory('')
        setComposerCursor(cursorPosition)

        if (typeof window !== 'undefined') {
            window.requestAnimationFrame(() => {
                const element = textareaRef.current
                if (!element) return
                element.focus()
                element.setSelectionRange(cursorPosition, cursorPosition)
            })
        }
    }, [textareaRef])

    return buildAssistantComposerControllerResult({
        loadedSessionId,
        disabled,
        allowEmptySubmit,
        placement,
        isConnected,
        isConnecting,
        isThinking,
        thinkingLabel,
        modelsLoading,
        modelsError,
        compact,
        submitLabel,
        dirtySubmitLabel,
        cancelLabel,
        showCancelWhenDirty,
        queuedMessageCount,
        queuedMessages,
        onForceQueuedMessage,
        onDeleteQueuedMessage,
        onMoveQueuedMessage,
        reconnectPending,
        latestTurnUsage,
        projectPath,
        projectChoices,
        projectContextDisabled,
        onSelectProject,
        onChooseProjectFolder,
        settingsAssistantBusyMessageMode: settings.assistantBusyMessageMode,
        isDirty,
        onStop,
        onReconnect,
        onOverflowWheel,
        onOpenAttachmentPreview,
        onAttachmentShelfBoundsChange,
        handleCancelDirty,
        restoreQueuedMessageToDraft,
        text,
        setText,
        inlineMentionTags,
        setInlineMentionTags,
        contextFiles,
        historyCursor,
        setHistoryCursor,
        showModelDropdown,
        setShowModelDropdown,
        showTraitsDropdown,
        setShowTraitsDropdown,
        showBranchDropdown,
        setShowBranchDropdown,
        showMentionMenu,
        previewAttachment,
        setPreviewAttachment,
        removingAttachmentIds,
        branches,
        isGitRepo,
        branchesLoading,
        isSwitchingBranch,
        branchActionError,
        mentionLoading,
        activeMentionIndex,
        activeModelIndex,
        activeBranchIndex,
        mentionCanScrollUp,
        mentionCanScrollDown,
        setMentionCanScrollUp,
        setMentionCanScrollDown,
        selectedEffort,
        setSelectedEffort,
        effortOptions,
        fastModeEnabled,
        setFastModeEnabled,
        isCompactFooter,
        textareaRef,
        filePickerRef,
        composerRootRef,
        modelDropdownRef,
        modelListRef,
        branchDropdownRef,
        mentionMenuRef,
        mentionListRef,
        traitsDropdownRef,
        mentionCandidates,
        selectedModel,
        setSelectedModel,
        selectedModelLabel,
        selectedModelContextWindow: availableModelOptions.find((model) => model.id === selectedModel)?.contextWindow ?? null,
        latestModelId,
        filteredModelOptions,
        setActiveModelIndex,
        branchQuery,
        setBranchQuery,
        currentBranch,
        defaultBranchName,
        branchButtonLabel,
        filteredBranches,
        activeBranchCandidate,
        setActiveBranchIndex,
        handleBranchSwitch,
        selectedInteractionMode,
        setSelectedInteractionMode,
        selectedRuntimeMode,
        setSelectedRuntimeMode,
        displayedProfile,
        zyraProfile,
        onZyraProfileChange,
        voiceInput,
        capabilities,
        activeMentionCandidate,
        syncScrollAffordance,
        syncComposerCursor,
        composerCursor,
        setComposerCursor,
        modelQuery,
        setModelQuery,
        onRefreshModels,
        updateContextFileText,
        ...handlers
    })
}

export type AssistantComposerController = ReturnType<typeof useAssistantComposerController>
