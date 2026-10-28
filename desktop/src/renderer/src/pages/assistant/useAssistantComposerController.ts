import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react'
import type { AssistantInteractionMode, AssistantRuntimeMode, AssistantUpdateSessionConfigurationInput } from '@shared/assistant/contracts'
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
import { createAssistantDictationJob, registerAssistantDictationOwner } from './assistant-dictation-jobs'
import { reconcileInlineMentionTags, replaceInlineMentionTokensWithLabels } from './assistant-composer-inline-mentions'
import { getContextFileMeta } from './assistant-composer-utils'
import { supportsAssistantFastMode } from './assistant-model-groups'
import { useAssistantComposerControllerEffects } from './useAssistantComposerControllerEffects'
import type { AssistantComposerPreferenceEffort } from './assistant-composer-preferences'
import { readRememberedChoices, rememberComposerChoices } from './assistant-remembered-choices'
import { registerAppComposerOwner } from './assistant-app-owner-state'
import {
    serializeAssistantBrowserAnnotation,
    subscribeAssistantBrowserAnnotationAttachments
} from './assistant-browser-annotation-composer'
import { coerceAssistantReasoningEffortForModel, getAssistantModelReasoningEfforts } from '@shared/assistant/reasoning-efforts'
import {
    type AssistantComposerSessionState,
    writeAssistantComposerSessionState
} from './assistant-composer-session-state'
import { createAssistantComposerConfigurationPublisher } from './assistant-composer-configuration-publisher'
import { reconcileAssistantComposerCanonicalConfiguration, retainAssistantComposerCanonicalConfiguration, type AssistantComposerCanonicalConfiguration } from './assistant-composer-canonical-sync'
import type { AssistantComposerProps, AssistantQueuedComposerMessage, ComposerContextFile } from './assistant-composer-types'

function isLegacyFallbackModel(model: string | null | undefined): boolean {
    const normalized = String(model || '').trim().toLowerCase()
    return /(?:^|[/\s])gpt-5\.[23](?:$|[\s-])/.test(normalized)
}

function normalizeComposerDefaultModel(model: string | null | undefined): string {
    const normalized = String(model || '').trim()
    return normalized
}

export function useAssistantComposerController(props: AssistantComposerProps) {
    const { settings, updateSettings } = useSettings()
    const {
        sessionId,
        configurationThreadId,
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
        zyraProfile = 'concise',
        onZyraProfileChange,
        runtimeMode,
        interactionMode,
        projectId,
        projectPath,
        projectName,
        projectIconSourcePath,
        projectRoots = [],
        projectChoices = [],
        projectContextDisabled = false,
        projectContextUnavailableReason,
        onProjectContextUnavailable,
        onSelectProject,
        onCreateProject,
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
    const attachmentOwnerKey = `${normalizedSessionId || ''}:${resetStateToken || ''}`
    const attachmentOwnerRef = useRef<{ key: string; pending: Set<symbol> } | null>(null)
    if (!attachmentOwnerRef.current || attachmentOwnerRef.current.key !== attachmentOwnerKey) {
        attachmentOwnerRef.current = { key: attachmentOwnerKey, pending: new Set() }
    }
    const attachmentOwner = attachmentOwnerRef.current
    useEffect(() => {
        attachmentOwnerRef.current = attachmentOwner
        return () => {
            if (attachmentOwnerRef.current === attachmentOwner) attachmentOwnerRef.current = null
        }
    }, [attachmentOwner])

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
    const [startInNewWorktree, setStartInNewWorktree] = useState(false)
    useEffect(() => setStartInNewWorktree(false), [projectPath, resetStateToken])
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
    const [selectedEffort, setSelectedEffort] = useState<AssistantComposerPreferenceEffort>(initialComposerSessionState.effort || fallbackComposerState.effort || 'medium')
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
    const canonicalConfigurationRef = useRef<{ sessionId: string | null; threadId?: string | null; configuration: AssistantComposerCanonicalConfiguration } | null>(null)
    const configurationPublisher = useMemo(() => createAssistantComposerConfigurationPublisher(
        input => window.devscope.assistant.updateSessionConfiguration(input)
    ), [])
    const publishConfiguration = useCallback((patch: Pick<AssistantUpdateSessionConfigurationInput, 'model' | 'runtimeMode' | 'effort'>) => {
        // New/unconnected chats retain their local launch choices until Send.
        if (isThinking || useSettingsDefaults || !normalizedSessionId || !configurationThreadId || !isConnected) return
        void configurationPublisher({ sessionId: normalizedSessionId, threadId: configurationThreadId, ...patch })
            .catch(error => {
                const canonical = canonicalConfigurationRef.current
                if (canonical?.sessionId === normalizedSessionId && canonical.threadId === configurationThreadId) {
                    const pending = configurationPublisher.pending(normalizedSessionId, configurationThreadId)
                    const actual = canonical.configuration
                    if (patch.model !== undefined && pending.model === undefined && actual.model !== undefined) setSelectedModel(current => current === patch.model ? actual.model! : current)
                    if (patch.runtimeMode !== undefined && pending.runtimeMode === undefined && actual.runtimeMode !== undefined) setSelectedRuntimeMode(current => current === patch.runtimeMode ? actual.runtimeMode! : current)
                    if (patch.effort !== undefined && pending.effort === undefined && actual.effort !== undefined) setSelectedEffort(current => current === patch.effort ? actual.effort! : current)
                }
                onBlockedSend?.(error instanceof Error ? error.message : 'Could not update this chat.')
            })
    }, [configurationPublisher, configurationThreadId, isConnected, isThinking, normalizedSessionId, onBlockedSend, useSettingsDefaults])
    const chooseModel = useCallback((value: SetStateAction<string>) => {
        const next = typeof value === 'function' ? value(selectedModel) : value
        setSelectedModel(next)
        try { rememberComposerChoices({ ...readRememberedChoices(), model: next }) } catch { onBlockedSend?.('Could not remember this model. Your current chat still uses it.') }
        void updateSettings({ assistantDefaultModel: next })
        if (next !== selectedModel) publishConfiguration({ model: next })
    }, [publishConfiguration, selectedModel, updateSettings, onBlockedSend])
    const chooseRuntimeMode = useCallback((value: SetStateAction<AssistantRuntimeMode>) => {
        const next = typeof value === 'function' ? value(selectedRuntimeMode) : value
        setSelectedRuntimeMode(next)
        try { rememberComposerChoices({ ...readRememberedChoices(), runtimeMode: next }) } catch { onBlockedSend?.('Could not remember this permission mode.') }
        void updateSettings({ assistantDefaultRuntimeMode: next })
        if (next !== selectedRuntimeMode) publishConfiguration({ runtimeMode: next })
    }, [publishConfiguration, selectedRuntimeMode, updateSettings, onBlockedSend])
    const chooseEffort = useCallback((value: SetStateAction<AssistantComposerPreferenceEffort>) => {
        const next = typeof value === 'function' ? value(selectedEffort) : value
        setSelectedEffort(next)
        try { rememberComposerChoices({ ...readRememberedChoices(), effort: next }) } catch { onBlockedSend?.('Could not remember this effort.') }
        void updateSettings({ assistantDefaultEffort: next })
        if (next !== selectedEffort) publishConfiguration({ effort: next })
    }, [publishConfiguration, selectedEffort, updateSettings, onBlockedSend])
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
        () => {
            const supported = getAssistantModelReasoningEfforts(selectedModelOption)
            return supported.length ? supported : ['off' as const]
        },
        [selectedModel, selectedModelSupportedEffortsSignature]
    )
    const effortOptionsSignature = effortOptions.join('\n')
    useEffect(() => {
        // New/offline composers own a local draft. Existing connected chats hydrate
        // canonical values, including when old last-used values exist in storage.
        if (useSettingsDefaults || !isConnected) {
            canonicalConfigurationRef.current = null
            return
        }
        const configuration: AssistantComposerCanonicalConfiguration = {
            model: normalizeComposerDefaultModel(activeModel) || undefined,
            runtimeMode,
            interactionMode,
            effort: activeEffort || undefined,
            fastModeEnabled: activeFastModeEnabled
        }
        const previous = canonicalConfigurationRef.current
        const baseline = previous?.sessionId === normalizedSessionId && previous.threadId === configurationThreadId ? previous.configuration : undefined
        const patch = reconcileAssistantComposerCanonicalConfiguration(
            baseline,
            configuration,
            {},
            normalizedSessionId && configurationThreadId ? configurationPublisher.pending(normalizedSessionId, configurationThreadId) : {}
        )
        canonicalConfigurationRef.current = { sessionId: normalizedSessionId, threadId: configurationThreadId, configuration: retainAssistantComposerCanonicalConfiguration(baseline, configuration) }
        if (patch.model !== undefined) setSelectedModel(patch.model)
        if (patch.runtimeMode !== undefined) setSelectedRuntimeMode(patch.runtimeMode)
        if (patch.interactionMode !== undefined) setSelectedInteractionMode(patch.interactionMode)
        if (patch.effort !== undefined) setSelectedEffort(coerceAssistantReasoningEffortForModel(patch.effort, activeModel || selectedModel))
        if (patch.fastModeEnabled !== undefined) setFastModeEnabled(patch.fastModeEnabled)
    }, [activeModel, runtimeMode, interactionMode, activeEffort, activeFastModeEnabled, normalizedSessionId, configurationThreadId, configurationPublisher, isConnected, useSettingsDefaults])
    useEffect(() => {
        // Preserve the chosen effort. Unsupported choices must be visible, not silently replaced.
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
    const latestDraftStatesRef = useRef(new Map<string, AssistantComposerSessionState>())
    const appComposerStateRef = useRef({ sessionId: normalizedSessionId, state: currentComposerState })
    appComposerStateRef.current = { sessionId: normalizedSessionId, state: currentComposerState }
    useEffect(() => {
        const target = normalizedSessionId
        if (!target || loadedSessionId !== target) return
        return registerAppComposerOwner(target, {
            read: () => appComposerStateRef.current.state,
            apply: patch => {
                if (appComposerStateRef.current.sessionId !== target) throw new Error('The composer owner changed before applying.')
                const next = writeAssistantComposerSessionState(target, { ...appComposerStateRef.current.state, ...patch }, { strict: true })
                if (persistTimeoutRef.current !== null) { window.clearTimeout(persistTimeoutRef.current); persistTimeoutRef.current = null }
                appComposerStateRef.current = { sessionId: target, state: next }
                persistedSessionStateRef.current = next
                latestDraftStatesRef.current.set(target, next)
                if (patch.model !== undefined) setSelectedModel(patch.model)
                if (patch.effort !== undefined) setSelectedEffort(patch.effort)
                if (patch.runtimeMode !== undefined) setSelectedRuntimeMode(patch.runtimeMode)
                if (patch.fastModeEnabled !== undefined) setFastModeEnabled(patch.fastModeEnabled)
                // This is a next-turn choice, not a live configuration publish or remembered default.
            }
        })
    }, [normalizedSessionId, loadedSessionId])
    const localDictationOwnerId = useRef(crypto.randomUUID()).current
    const dictationOwnerKey = normalizedSessionId || `${localDictationOwnerId}:${resetStateToken || ''}`
    useEffect(() => {
        if (loadedSessionId !== normalizedSessionId) return
        return registerAssistantDictationOwner(dictationOwnerKey, {
            read: () => appComposerStateRef.current.state,
            apply: next => {
                // A detached job must never address a newly selected React composer.
                if (appComposerStateRef.current.sessionId !== normalizedSessionId) return
                if (persistTimeoutRef.current !== null) {
                    window.clearTimeout(persistTimeoutRef.current)
                    persistTimeoutRef.current = null
                }
                appComposerStateRef.current = { sessionId: normalizedSessionId, state: next }
                latestTextRef.current = next.draft || ''
                latestContextFilesRef.current = next.contextFiles || []
                persistedSessionStateRef.current = next
                if (normalizedSessionId) {
                    latestDraftStatesRef.current.set(normalizedSessionId, next)
                    writeAssistantComposerSessionState(normalizedSessionId, next)
                }
                setText(next.draft || '')
                setContextFiles(next.contextFiles || [])
                if (!next.draft) { latestInlineMentionTagsRef.current = []; setInlineMentionTags([]) }
            }
        })
    }, [dictationOwnerKey, loadedSessionId, normalizedSessionId])
    if (loadedSessionId && loadedSessionId === normalizedSessionId) latestDraftStatesRef.current.set(loadedSessionId, currentComposerState)
    useEffect(() => () => {
        if (!normalizedSessionId) return
        const saved = latestDraftStatesRef.current.get(normalizedSessionId)
        if (saved) writeAssistantComposerSessionState(normalizedSessionId, saved)
        latestDraftStatesRef.current.delete(normalizedSessionId)
    }, [normalizedSessionId])
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
        startInNewWorktree: placement === 'center' && isGitRepo && startInNewWorktree,
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
        setSelectedModel: chooseModel,
        selectedModelInputModes: typeof selectedModelOption === 'string' ? undefined : selectedModelOption.inputModes,
        sendBlockedReason: !modelsLoading && modelOptions && selectedModel && !modelOptions.some(option => option.id === selectedModel)
            ? 'This model is unavailable. Choose another model before sending.'
            : !effortOptions.includes(selectedEffort) ? 'This effort is not supported by the selected model. Choose an effort before sending.' : null,
        selectedRuntimeMode,
        setSelectedRuntimeMode: chooseRuntimeMode,
        selectedInteractionMode,
        selectedEffort,
        fastModeEnabled,
        setComposerCursor,
        removingAttachmentIds,
        setRemovingAttachmentIds,
        textareaRef,
        isAttachmentOwnerCurrent: () => attachmentOwnerRef.current === attachmentOwner,
        pendingAttachmentOperations: attachmentOwner.pending,
        onBlockedSend,
        onOptimisticSendClear: () => {
            // The send may reject before React commits the cleared draft.
            // Keep the restoration guard aligned with that synchronous clear.
            latestTextRef.current = ''
            latestInlineMentionTagsRef.current = []
            latestContextFilesRef.current = []
            if (normalizedSessionId) latestDraftStatesRef.current.set(normalizedSessionId, buildAssistantComposerSessionState({ selectedModel, selectedRuntimeMode, selectedInteractionMode, selectedEffort, fastModeEnabled }))
            persistComposerSessionStateImmediately(buildAssistantComposerSessionState({
                selectedModel,
                selectedRuntimeMode,
                selectedInteractionMode,
                selectedEffort,
                fastModeEnabled
            }))
        },
        canClearAcceptedDraft: (submittedText, submittedFiles) => latestTextRef.current === submittedText && latestContextFilesRef.current === submittedFiles,
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
        scopeKey: `${normalizedSessionId || 'new'}:${resetStateToken || ''}`,
        createDictationJob: () => {
            // Snapshot the original chat's dispatch, configuration, attachments and mentions.
            // Normal handlers also focus/clear React state, so they cannot be used by a detached job.
            const capturedText = text
            const tags = inlineMentionTags.map(tag => ({ ...tag }))
            const files = contextFiles.map(file => ({ ...file }))
            const mentionFiles: ComposerContextFile[] = tags.filter(tag => tag.kind === 'file' || tag.kind === 'directory').map(tag => {
                const meta = getContextFileMeta({ path: tag.path, name: tag.label })
                return { id: `mention_${tag.id}`, path: tag.path, name: tag.label,
                    kind: meta.category === 'image' ? 'image' : meta.category === 'code' ? 'code' : 'file', source: 'manual' }
            })
            const submittedFiles = [...files, ...mentionFiles].filter((file, index, all) =>
                all.findIndex(candidate => `${candidate.path}::${candidate.name}`.toLowerCase() === `${file.path}::${file.name}`.toLowerCase()) === index)
            const blocked = disabled || !isConnected || isSending || attachmentOwner.pending.size > 0
                || (!modelsLoading && modelOptions && selectedModel && !modelOptions.some(option => option.id === selectedModel))
                || !effortOptions.includes(selectedEffort)
                || (typeof selectedModelOption !== 'string' && selectedModelOption.inputModes && !selectedModelOption.inputModes.includes('image') && submittedFiles.some(file => file.kind === 'image'))
            const options = {
                startInNewWorktree: placement === 'center' && isGitRepo && startInNewWorktree || undefined,
                model: selectedModel || undefined, runtimeMode: selectedRuntimeMode,
                interactionMode: selectedInteractionMode, effort: selectedEffort,
                serviceTier: fastModeEnabled && supportsAssistantFastMode(selectedModel) ? 'fast' as const : undefined,
                dispatchMode: isThinking ? settings.assistantBusyMessageMode : 'immediate' as const
            }
            return createAssistantDictationJob({ ownerKey: dictationOwnerKey, sessionId: normalizedSessionId,
                initialState: currentComposerState, sentContextFiles: files,
                send: async draft => {
                    if (blocked) return false
                    const prompt = replaceInlineMentionTokensWithLabels(draft, reconcileInlineMentionTags(capturedText, draft, tags)).trim()
                    if (!prompt && !submittedFiles.length && !allowEmptySubmit) return false
                    return onSend(prompt, submittedFiles, options)
                }
            })
        }
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
        selectionUnavailableReason: !modelsLoading && modelOptions && selectedModel && !modelOptions.some(option => option.id === selectedModel)
            ? 'Selected model unavailable. Choose a model to send.' : !effortOptions.includes(selectedEffort) ? 'Selected effort unavailable for this model.' : null,
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
        onUpdateQueuedMessage: props.onUpdateQueuedMessage,
        queueHeld: props.queueHeld ?? false,
        onHoldQueue: props.onHoldQueue,
        onResumeQueue: props.onResumeQueue,
        isStopping: props.isStopping ?? false,
        reconnectPending,
        latestTurnUsage,
        projectId,
        projectPath,
        projectName,
        projectIconSourcePath,
        projectRoots,
        projectChoices,
        projectContextDisabled,
        projectContextUnavailableReason,
        onProjectContextUnavailable,
        onSelectProject,
        onCreateProject,
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
        updateAttachment: (file: ComposerContextFile) => setContextFiles(current => current.map(existing => existing.id === file.id ? file : existing)),
        historyCursor,
        setHistoryCursor,
        showModelDropdown,
        setShowModelDropdown,
        showTraitsDropdown,
        setShowTraitsDropdown,
        showBranchDropdown,
        setShowBranchDropdown,
        showMentionMenu,
        setShowMentionMenu,
        previewAttachment,
        setPreviewAttachment,
        removingAttachmentIds,
        branches,
        isGitRepo,
        startInNewWorktree,
        setStartInNewWorktree,
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
        setSelectedEffort: chooseEffort,
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
        setSelectedModel: chooseModel,
        selectedModelLabel,
        selectedModelInputModes: typeof selectedModelOption === 'string' ? undefined : selectedModelOption.inputModes,
        selectedModelContextWindow: availableModelOptions.find((model) => model.id === selectedModel)?.contextWindow ?? null,
        selectedModelMetadata: availableModelOptions.find((model) => model.id === selectedModel) ?? null,
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
        setSelectedRuntimeMode: chooseRuntimeMode,
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
