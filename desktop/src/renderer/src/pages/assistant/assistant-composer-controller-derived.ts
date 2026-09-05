import { useDeferredValue, useMemo } from 'react'
import { getLatestModelId, sortModelsLatestFirst } from '../../../../../../src/model-order.mjs'
import type { AssistantInteractionMode, AssistantModelInfo, AssistantRuntimeMode } from '@shared/assistant/contracts'
import type { DevScopeGitBranchSummary } from '@shared/contracts/devscope-api'
import type { Settings } from '@/lib/settings'
import { searchMentionIndex, type MentionCandidate } from './assistant-composer-mentions'
import { getProfileLabel, readLegacyComposerSessionState } from './assistant-composer-controller-constants'
import { deriveAssistantComposerCapabilities } from './assistant-composer-capabilities'
import type { AssistantComposerDisabledReason, ComposerContextFile } from './assistant-composer-types'
import { getMentionQuery, normalizeMentionLookupPath, type InlineMentionTag } from './assistant-composer-inline-mentions'
import type { AssistantComposerPreferenceEffort } from './assistant-composer-preferences'
import {
    areAssistantComposerSessionStatesEqual,
    readAssistantComposerSessionState,
    type AssistantComposerSessionState
} from './assistant-composer-session-state'

type AssistantComposerSettingsDefaults = Pick<
    Settings,
    | 'assistantDefaultEffort'
    | 'assistantDefaultFastMode'
    | 'assistantDefaultModel'
    | 'assistantDefaultPromptTemplate'
    | 'assistantDefaultRuntimeMode'
    | 'gitPullRequestDefaultTargetBranch'
>

type ComposerModelOption = AssistantModelInfo

function isRetiredModel(model: ComposerModelOption): boolean {
    const value = `${model.label || ''} ${model.id || ''}`.toLowerCase()
    return /(?:^|[/\s])gpt-5\.2(?:$|[\s-])/.test(value)
}

export function resolveRetainedAssistantComposerModel(currentModel: string, fallbackModel: string): string {
    return String(currentModel || '').trim() || String(fallbackModel || '').trim()
}

export function resolveAssistantComposerFallbackState(input: {
    useSettingsDefaults: boolean
    settingsDefaults: AssistantComposerSessionState
    activeModel?: string
    runtimeMode?: AssistantRuntimeMode
    interactionMode?: AssistantInteractionMode
    activeEffort?: AssistantComposerPreferenceEffort | null
    activeFastModeEnabled?: boolean
}): AssistantComposerSessionState {
    const activeModel = String(input.activeModel || '').trim()
    return {
        ...(input.useSettingsDefaults ? input.settingsDefaults : {}),
        ...(activeModel ? { model: activeModel } : {}),
        ...(input.runtimeMode ? { runtimeMode: input.runtimeMode } : {}),
        ...(input.interactionMode ? { interactionMode: 'default' as const } : {}),
        ...(input.activeEffort ? { effort: input.activeEffort } : {}),
        ...(typeof input.activeFastModeEnabled === 'boolean'
            ? { fastModeEnabled: input.activeFastModeEnabled }
            : {})
    }
}

export function useAssistantComposerSessionDefaults(input: {
    settings: AssistantComposerSettingsDefaults
    activeProfile?: string
    runtimeMode?: AssistantRuntimeMode
    interactionMode?: AssistantInteractionMode
    activeModel?: string
    activeEffort?: AssistantComposerPreferenceEffort | null
    activeFastModeEnabled?: boolean
    modelOptions?: ComposerModelOption[]
    sessionId?: string | null
    useSettingsDefaults: boolean
}) {
    const {
        settings,
        activeProfile,
        runtimeMode,
        interactionMode,
        activeModel,
        activeEffort,
        activeFastModeEnabled,
        modelOptions,
        sessionId,
        useSettingsDefaults
    } = input

    const legacyComposerSessionState = useMemo(() => readLegacyComposerSessionState(), [])
    const globalDefaultComposerState = useMemo<AssistantComposerSessionState>(() => ({
        draft: settings.assistantDefaultPromptTemplate || undefined,
        model: settings.assistantDefaultModel.trim() || undefined,
        runtimeMode: settings.assistantDefaultRuntimeMode,
        interactionMode: 'default',
        effort: settings.assistantDefaultEffort,
        fastModeEnabled: settings.assistantDefaultFastMode
    }), [
        settings.assistantDefaultEffort,
        settings.assistantDefaultFastMode,
        settings.assistantDefaultModel,
        settings.assistantDefaultPromptTemplate,
        settings.assistantDefaultRuntimeMode
    ])
    const fallbackComposerState = useMemo<AssistantComposerSessionState>(() => resolveAssistantComposerFallbackState({
        useSettingsDefaults,
        settingsDefaults: {
            ...globalDefaultComposerState,
            ...legacyComposerSessionState
        },
        activeModel,
        runtimeMode,
        interactionMode,
        activeEffort,
        activeFastModeEnabled
    }), [
        activeEffort,
        activeFastModeEnabled,
        activeModel,
        globalDefaultComposerState,
        interactionMode,
        legacyComposerSessionState,
        runtimeMode,
        useSettingsDefaults
    ])

    const baseRuntimeMode: AssistantRuntimeMode =
        fallbackComposerState.runtimeMode
        || (activeProfile === 'yolo-fast' ? 'full-access' : 'approval-required')
    const baseInteractionMode: AssistantInteractionMode = fallbackComposerState.interactionMode || 'default'
    const resolvedModel = String(fallbackComposerState.model || '').trim()
    const rawAvailableModelOptions = (
        modelOptions?.length
            ? modelOptions
            : (resolvedModel ? [{ id: resolvedModel, label: resolvedModel }] : [])
    ).filter((model) => !isRetiredModel(model))
    const availableModelOptions = sortModelsLatestFirst(rawAvailableModelOptions)
    const initialComposerSessionState = useMemo(
        () => readAssistantComposerSessionState(sessionId, fallbackComposerState),
        [fallbackComposerState, sessionId]
    )

    return {
        availableModelOptions,
        baseInteractionMode,
        baseRuntimeMode,
        fallbackComposerState,
        initialComposerSessionState,
        rawAvailableModelOptionsLength: rawAvailableModelOptions.length,
        resolvedModel
    }
}

export function useAssistantComposerDerivedOptions(input: {
    text: string
    composerCursor: number
    inlineMentionTags: InlineMentionTag[]
    projectNodes: MentionCandidate[]
    mentionChangedStateByPath: Record<string, 'staged' | 'unstaged' | 'both'>
    mentionRecentModifiedAtByPath: Record<string, number>
    modelQuery: string
    availableModelOptions: ComposerModelOption[]
    branchQuery: string
    branches: DevScopeGitBranchSummary[]
    activeMentionIndex: number
    activeModelIndex: number
    activeBranchIndex: number
    selectedModel: string
    selectedRuntimeMode: AssistantRuntimeMode
    baseRuntimeMode: AssistantRuntimeMode
    activeProfile?: string
    settings: Pick<AssistantComposerSettingsDefaults, 'gitPullRequestDefaultTargetBranch'>
    isSwitchingBranch: boolean
    branchesLoading: boolean
}) {
    const {
        text,
        composerCursor,
        inlineMentionTags,
        projectNodes,
        mentionChangedStateByPath,
        mentionRecentModifiedAtByPath,
        modelQuery,
        availableModelOptions,
        branchQuery,
        branches,
        activeMentionIndex,
        activeModelIndex,
        activeBranchIndex,
        selectedModel,
        selectedRuntimeMode,
        baseRuntimeMode,
        activeProfile,
        settings,
        isSwitchingBranch,
        branchesLoading
    } = input

    const latestModelId = getLatestModelId(availableModelOptions)
    const selectedModelLabel =
        availableModelOptions.find((entry) => entry.id === selectedModel)?.label
        || selectedModel
        || 'Select model'
    const currentBranch = branches.find((branch) => branch.current)?.name || null
    const defaultBranchName = useMemo(() => {
        const candidates = [
            settings.gitPullRequestDefaultTargetBranch,
            'main',
            'master'
        ].filter((name, index, collection): name is string => Boolean(name) && collection.indexOf(name) === index)

        return candidates.find((name) => branches.some((branch) => branch.name === name)) || null
    }, [branches, settings.gitPullRequestDefaultTargetBranch])
    const branchButtonLabel = isSwitchingBranch
        ? 'Switching...'
        : branchesLoading
            ? 'Loading branch...'
            : currentBranch || 'Select branch'
    const mentionState = useMemo(() => {
        const cursorInsideInlineMention = inlineMentionTags.some((tag) => composerCursor > tag.start && composerCursor <= tag.end)
        const cursorRightAfterMention = inlineMentionTags.some((tag) => composerCursor === tag.end + 1)
        if (cursorInsideInlineMention || cursorRightAfterMention) return null
        return getMentionQuery(text, composerCursor)
    }, [composerCursor, inlineMentionTags, text])
    const deferredMentionQuery = useDeferredValue(mentionState?.query || '')
    const displayedProfile =
        selectedRuntimeMode === baseRuntimeMode
            ? (activeProfile || getProfileLabel(baseRuntimeMode))
            : getProfileLabel(selectedRuntimeMode)
    const mentionCandidates = useMemo(() => {
        if (!mentionState) return []
        const query = String(deferredMentionQuery || '').trim()
        const baseCandidates = searchMentionIndex(projectNodes, query, 16)

        return baseCandidates
            .map((candidate, index) => {
                const relativeKey = normalizeMentionLookupPath(candidate.relativePath || candidate.path)
                const changeState = mentionChangedStateByPath[relativeKey]
                const modifiedAt = mentionRecentModifiedAtByPath[relativeKey]
                let score = (baseCandidates.length - index) * 10

                if (changeState === 'both') score += 1200
                else if (changeState === 'staged') score += 1100
                else if (changeState === 'unstaged') score += 1000

                if (typeof modifiedAt === 'number') {
                    const ageHours = Math.max(0, Date.now() - modifiedAt) / (1000 * 60 * 60)
                    if (ageHours <= 24) score += 260 - ageHours * 6
                    else if (ageHours <= 24 * 7) score += 140 - ageHours * 0.5
                    else if (ageHours <= 24 * 30) score += 40
                }

                if (!query && candidate.type === 'file') score += 12
                return { candidate, index, score }
            })
            .sort((left, right) => right.score - left.score || left.index - right.index)
            .slice(0, 8)
            .map((entry) => entry.candidate)
    }, [deferredMentionQuery, mentionChangedStateByPath, mentionRecentModifiedAtByPath, mentionState, projectNodes])
    const filteredModelOptions = useMemo(() => {
        const normalizedQuery = modelQuery.trim().toLowerCase()
        const options = normalizedQuery
            ? availableModelOptions.filter((model) =>
                String(model.label || model.id).toLowerCase().includes(normalizedQuery)
                || String(model.id || '').toLowerCase().includes(normalizedQuery)
                || String(model.description || '').toLowerCase().includes(normalizedQuery)
            )
            : availableModelOptions

        return sortModelsLatestFirst(options)
    }, [availableModelOptions, modelQuery])
    const filteredBranches = useMemo(() => {
        const normalizedQuery = branchQuery.trim().toLowerCase()
        if (!normalizedQuery) return branches
        return branches.filter((branch) =>
            branch.name.toLowerCase().includes(normalizedQuery)
            || String(branch.label || '').toLowerCase().includes(normalizedQuery)
        )
    }, [branchQuery, branches])
    const activeMentionCandidate = mentionCandidates[activeMentionIndex] || null
    const activeModelCandidate = filteredModelOptions[activeModelIndex] || null
    const activeBranchCandidate = filteredBranches[activeBranchIndex] || null

    return {
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
    }
}

export function useAssistantComposerDirtyState(input: {
    text: string
    selectedModel: string
    selectedRuntimeMode: AssistantRuntimeMode
    selectedInteractionMode: AssistantInteractionMode
    selectedEffort: AssistantComposerPreferenceEffort
    fastModeEnabled: boolean
    contextFiles: ComposerContextFile[]
    persistedComposerState: AssistantComposerSessionState
}) {
    const {
        text,
        selectedModel,
        selectedRuntimeMode,
        selectedInteractionMode,
        selectedEffort,
        fastModeEnabled,
        contextFiles,
        persistedComposerState
    } = input

    const currentComposerState = useMemo<AssistantComposerSessionState>(() => ({
        draft: text.trim() ? text : undefined,
        contextFiles: contextFiles.length > 0 ? contextFiles : undefined,
        model: selectedModel || undefined,
        runtimeMode: selectedRuntimeMode,
        interactionMode: selectedInteractionMode,
        effort: selectedEffort,
        fastModeEnabled
    }), [contextFiles, fastModeEnabled, selectedEffort, selectedInteractionMode, selectedModel, selectedRuntimeMode, text])

    const isDirty = useMemo(
        () => !areAssistantComposerSessionStatesEqual(persistedComposerState, currentComposerState),
        [currentComposerState, persistedComposerState]
    )

    return {
        currentComposerState,
        isDirty
    }
}

export function useAssistantComposerCapabilitiesState(input: {
    disabled: boolean
    disabledReason: AssistantComposerDisabledReason | null
    isConnected: boolean
    isConnecting: boolean
    isSending: boolean
    isThinking: boolean
    allowEmptySubmit: boolean
    text: string
    contextFilesLength: number
    voiceBusy: boolean
    hasStopHandler: boolean
}) {
    const {
        disabled,
        disabledReason,
        isConnected,
        isConnecting,
        isSending,
        isThinking,
        allowEmptySubmit,
        text,
        contextFilesLength,
        voiceBusy,
        hasStopHandler
    } = input

    return useMemo(() => deriveAssistantComposerCapabilities({
        mode: 'standard',
        disabled,
        disabledReason,
        isConnected,
        isConnecting,
        isSending,
        isThinking,
        allowEmptySubmit,
        hasContent: Boolean(text.trim() || contextFilesLength > 0),
        voiceBusy,
        hasStopHandler
    }), [
        allowEmptySubmit,
        contextFilesLength,
        disabled,
        disabledReason,
        hasStopHandler,
        isConnected,
        isConnecting,
        isSending,
        isThinking,
        text,
        voiceBusy
    ])
}
