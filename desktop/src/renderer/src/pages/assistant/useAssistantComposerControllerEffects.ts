import type { AssistantSpeedPreference } from './assistant-model-groups'
import { isOverlayEventInside } from '@/components/ui/native-overlay-portal'
import { addOverlayEventListener, addOverlayWindowBlurListener } from '@/components/ui/native-overlay-portal'
import { useEffect, useLayoutEffect, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from 'react'
import type { AssistantInteractionMode, AssistantRuntimeMode } from '@shared/assistant/contracts'
import { TRANSIENT_MENU_DISMISS_EVENT } from '@/lib/transient-menu'
import {
    ensureListItemVisible,
    syncScrollAffordance,
    COMPOSER_SESSION_PERSIST_DEBOUNCE_MS
} from './assistant-composer-controller-constants'
import {
    areAssistantComposerConfigurationsEqual,
    areAssistantComposerSessionStatesEqual,
    readAssistantComposerSessionState,
    writeAssistantComposerSessionState,
    type AssistantComposerSessionState
} from './assistant-composer-session-state'
import type { AssistantComposerPreferenceEffort } from './assistant-composer-preferences'
import type { ComposerContextFile } from './assistant-composer-types'
import { subscribeCodeContext } from './assistant-code-context'
import type { InlineMentionTag } from './assistant-composer-inline-mentions'

function isLegacyFallbackModel(model: string | null | undefined): boolean {
    const normalized = String(model || '').trim().toLowerCase()
    return /(?:^|[/\s])gpt-5\.[23](?:$|[\s-])/.test(normalized)
}

function normalizeComposerDefaultModel(model: string | null | undefined): string {
    const normalized = String(model || '').trim()
    return normalized && !isLegacyFallbackModel(normalized) ? normalized : ''
}

export function useAssistantComposerControllerEffects(input: {
    compact: boolean
    resetStateToken?: string | null
    sessionId: string | null
    loadedSessionId: string | null
    currentComposerState: AssistantComposerSessionState
    fallbackComposerState: AssistantComposerSessionState
    resolvedModel: string
    baseRuntimeMode: AssistantRuntimeMode
    baseInteractionMode: AssistantInteractionMode
    mentionQueryKey: string | null
    showMentionMenu: boolean
    mentionLoading: boolean
    mentionCandidatesLength: number
    activeMentionIndex: number
    showModelDropdown: boolean
    modelsLoading: boolean
    filteredModelOptionsLength: number
    activeModelIndex: number
    showTraitsDropdown: boolean
    showBranchDropdown: boolean
    contextFiles: ComposerContextFile[]
    previewAttachment: ComposerContextFile | null
    availableModelOptionsLength: number
    firstAvailableModelId: string | null
    initializedSessionIdRef: MutableRefObject<string | null | undefined>
    persistedSessionStateRef: MutableRefObject<AssistantComposerSessionState>
    persistTimeoutRef: MutableRefObject<number | null>
    composerRootRef: RefObject<HTMLDivElement | null>
    modelDropdownRef: RefObject<HTMLDivElement | null>
    modelListRef: RefObject<HTMLDivElement | null>
    branchDropdownRef: RefObject<HTMLDivElement | null>
    mentionMenuRef: RefObject<HTMLDivElement | null>
    mentionListRef: RefObject<HTMLDivElement | null>
    traitsDropdownRef: RefObject<HTMLDivElement | null>
    setLoadedSessionId: Dispatch<SetStateAction<string | null>>
    setText: Dispatch<SetStateAction<string>>
    setInlineMentionTags: Dispatch<SetStateAction<InlineMentionTag[]>>
    setContextFiles: Dispatch<SetStateAction<ComposerContextFile[]>>
    setSentPromptHistory: Dispatch<SetStateAction<string[]>>
    setHistoryCursor: Dispatch<SetStateAction<number | null>>
    setDraftBeforeHistory: Dispatch<SetStateAction<string>>
    setShowMentionMenu: Dispatch<SetStateAction<boolean>>
    setPreviewAttachment: Dispatch<SetStateAction<ComposerContextFile | null>>
    setRemovingAttachmentIds: Dispatch<SetStateAction<string[]>>
    setSelectedModel: Dispatch<SetStateAction<string>>
    setSelectedRuntimeMode: Dispatch<SetStateAction<AssistantRuntimeMode>>
    setSelectedInteractionMode: Dispatch<SetStateAction<AssistantInteractionMode>>
    setSelectedEffort: Dispatch<SetStateAction<AssistantComposerPreferenceEffort>>
    setFastModeEnabled: Dispatch<SetStateAction<AssistantSpeedPreference>>
    setComposerCursor: Dispatch<SetStateAction<number>>
    setActiveMentionIndex: Dispatch<SetStateAction<number>>
    setModelQuery: Dispatch<SetStateAction<string>>
    setActiveModelIndex: Dispatch<SetStateAction<number>>
    setBranchQuery: Dispatch<SetStateAction<string>>
    setActiveBranchIndex: Dispatch<SetStateAction<number>>
    setShowModelDropdown: Dispatch<SetStateAction<boolean>>
    setShowTraitsDropdown: Dispatch<SetStateAction<boolean>>
    setShowBranchDropdown: Dispatch<SetStateAction<boolean>>
    setMentionCanScrollUp: Dispatch<SetStateAction<boolean>>
    setMentionCanScrollDown: Dispatch<SetStateAction<boolean>>
    setIsCompactFooter: Dispatch<SetStateAction<boolean>>
}) {
    const {
        compact,
        resetStateToken,
        sessionId,
        loadedSessionId,
        currentComposerState,
        fallbackComposerState,
        resolvedModel,
        baseRuntimeMode,
        baseInteractionMode,
        mentionQueryKey,
        showMentionMenu,
        mentionLoading,
        mentionCandidatesLength,
        activeMentionIndex,
        showModelDropdown,
        modelsLoading,
        filteredModelOptionsLength,
        activeModelIndex,
        showTraitsDropdown,
        showBranchDropdown,
        contextFiles,
        previewAttachment,
        availableModelOptionsLength,
        firstAvailableModelId,
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
    } = input

    useEffect(() => {
        if (!sessionId || loadedSessionId !== sessionId) return
        return subscribeCodeContext(sessionId, file => setContextFiles(current => current.some(item => item.id === file.id) ? current : [...current, file]))
    }, [sessionId, loadedSessionId, setContextFiles])

    useLayoutEffect(() => {
        const initializationKey = `${sessionId || 'no-session'}:${resetStateToken || 'stable'}`
        if (initializedSessionIdRef.current === initializationKey) return
        initializedSessionIdRef.current = initializationKey
        const nextState = readAssistantComposerSessionState(sessionId, fallbackComposerState)
        persistedSessionStateRef.current = nextState
        setLoadedSessionId(null)
        setText(nextState.draft || '')
        setInlineMentionTags([])
        setContextFiles(nextState.contextFiles || [])
        setSentPromptHistory([])
        setHistoryCursor(null)
        setDraftBeforeHistory('')
        setShowMentionMenu(false)
        setPreviewAttachment(null)
        setRemovingAttachmentIds([])
        setSelectedModel(normalizeComposerDefaultModel(nextState.model || resolvedModel))
        setSelectedRuntimeMode(nextState.runtimeMode || baseRuntimeMode)
        setSelectedInteractionMode(nextState.interactionMode || baseInteractionMode)
        setSelectedEffort(nextState.effort || fallbackComposerState.effort || 'medium')
        setFastModeEnabled(nextState.fastModeEnabled ?? fallbackComposerState.fastModeEnabled ?? false)
        setComposerCursor(0)
        setLoadedSessionId(sessionId || null)
    }, [
        baseInteractionMode,
        baseRuntimeMode,
        fallbackComposerState,
        initializedSessionIdRef,
        persistedSessionStateRef,
        resetStateToken,
        resolvedModel,
        sessionId,
        setComposerCursor,
        setContextFiles,
        setDraftBeforeHistory,
        setFastModeEnabled,
        setHistoryCursor,
        setInlineMentionTags,
        setLoadedSessionId,
        setPreviewAttachment,
        setRemovingAttachmentIds,
        setSelectedEffort,
        setSelectedInteractionMode,
        setSelectedModel,
        setSelectedRuntimeMode,
        setSentPromptHistory,
        setShowMentionMenu,
        setText
    ])

    useEffect(() => { setSelectedRuntimeMode((current) => current || baseRuntimeMode) }, [baseRuntimeMode, setSelectedRuntimeMode])
    useEffect(() => { setSelectedInteractionMode((current) => current || baseInteractionMode) }, [baseInteractionMode, setSelectedInteractionMode])
    useEffect(() => { setSelectedModel((current) => current || normalizeComposerDefaultModel(resolvedModel)) }, [resolvedModel, setSelectedModel])
    useEffect(() => {
        if (!firstAvailableModelId || availableModelOptionsLength <= 0) return
        setSelectedModel((current) => current || firstAvailableModelId)
    }, [availableModelOptionsLength, firstAvailableModelId, setSelectedModel])

    useEffect(() => {
        if (!sessionId || loadedSessionId !== sessionId) return
        if (areAssistantComposerConfigurationsEqual(persistedSessionStateRef.current, currentComposerState)) return
        persistedSessionStateRef.current = writeAssistantComposerSessionState(sessionId, currentComposerState)
    }, [currentComposerState, loadedSessionId, persistedSessionStateRef, sessionId])

    useEffect(() => {
        if (!sessionId || loadedSessionId !== sessionId) return
        if (areAssistantComposerSessionStatesEqual(persistedSessionStateRef.current, currentComposerState)) return

        persistTimeoutRef.current = window.setTimeout(() => {
            persistedSessionStateRef.current = writeAssistantComposerSessionState(sessionId, currentComposerState)
            persistTimeoutRef.current = null
        }, COMPOSER_SESSION_PERSIST_DEBOUNCE_MS)

        return () => {
            if (persistTimeoutRef.current != null) {
                window.clearTimeout(persistTimeoutRef.current)
                persistTimeoutRef.current = null
            }
        }
    }, [currentComposerState, loadedSessionId, persistTimeoutRef, persistedSessionStateRef, sessionId])

    useEffect(() => {
        setShowMentionMenu(Boolean(mentionQueryKey))
        setActiveMentionIndex(0)
    }, [mentionQueryKey, setActiveMentionIndex, setShowMentionMenu])

    useEffect(() => {
        if (!showModelDropdown) {
            setModelQuery('')
            setActiveModelIndex(0)
        }
    }, [setActiveModelIndex, setModelQuery, showModelDropdown])

    useEffect(() => {
        if (!showBranchDropdown) {
            setBranchQuery('')
            setActiveBranchIndex(0)
        }
    }, [setActiveBranchIndex, setBranchQuery, showBranchDropdown])

    useEffect(() => {
        if (!showMentionMenu) {
            setMentionCanScrollUp(false)
            setMentionCanScrollDown(false)
            return
        }
        const frame = window.requestAnimationFrame(() => syncScrollAffordance(mentionListRef.current, setMentionCanScrollUp, setMentionCanScrollDown))
        return () => window.cancelAnimationFrame(frame)
    }, [mentionCandidatesLength, mentionListRef, mentionLoading, setMentionCanScrollDown, setMentionCanScrollUp, showMentionMenu])

    useEffect(() => {
        if (!showMentionMenu || !mentionListRef.current) return
        const activeButton = mentionListRef.current.querySelector(`[data-mention-index="${activeMentionIndex}"]`) as HTMLButtonElement | null
        if (!activeButton) return
        ensureListItemVisible(mentionListRef.current, activeButton, { topInset: 24, bottomInset: 24 })
        syncScrollAffordance(mentionListRef.current, setMentionCanScrollUp, setMentionCanScrollDown)
    }, [activeMentionIndex, mentionCandidatesLength, mentionListRef, setMentionCanScrollDown, setMentionCanScrollUp, showMentionMenu])

    useEffect(() => {
        if (!showModelDropdown || !modelListRef.current) return
        const activeButton = modelListRef.current.querySelector(`[data-model-index="${activeModelIndex}"]`) as HTMLButtonElement | null
        if (!activeButton) return
        ensureListItemVisible(modelListRef.current, activeButton, { topInset: 0, bottomInset: 0 })
    }, [activeModelIndex, filteredModelOptionsLength, modelListRef, showModelDropdown])

    useEffect(() => {
        if (!showModelDropdown && !showTraitsDropdown && !showBranchDropdown && !showMentionMenu) return
        const dismissMenus = () => {
            setShowModelDropdown(false)
            setShowTraitsDropdown(false)
            setShowBranchDropdown(false)
            setShowMentionMenu(false)
        }
        const handleClickOutside = (event: PointerEvent) => {
            if (modelDropdownRef.current && !isOverlayEventInside(event, modelDropdownRef.current)) setShowModelDropdown(false)
            if (traitsDropdownRef.current && !isOverlayEventInside(event, traitsDropdownRef.current)) setShowTraitsDropdown(false)
            if (branchDropdownRef.current && !isOverlayEventInside(event, branchDropdownRef.current)) setShowBranchDropdown(false)
            if (mentionMenuRef.current && !isOverlayEventInside(event, mentionMenuRef.current)) setShowMentionMenu(false)
        }
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') dismissMenus()
        }
        const removeOverlayListener1 = addOverlayEventListener('pointerdown', handleClickOutside, true)
        const removeOverlayListener2 = addOverlayEventListener('keydown', handleEscape)
        const removeOverlayBlurListener3 = addOverlayWindowBlurListener(dismissMenus)
        window.addEventListener(TRANSIENT_MENU_DISMISS_EVENT, dismissMenus)
        return () => {
            removeOverlayListener1()
            removeOverlayListener2()
            removeOverlayBlurListener3()
            window.removeEventListener(TRANSIENT_MENU_DISMISS_EVENT, dismissMenus)
        }
    }, [
        branchDropdownRef,
        mentionMenuRef,
        modelDropdownRef,
        setShowBranchDropdown,
        setShowMentionMenu,
        setShowModelDropdown,
        setShowTraitsDropdown,
        showBranchDropdown,
        showMentionMenu,
        showModelDropdown,
        showTraitsDropdown,
        traitsDropdownRef
    ])

    useEffect(() => {
        if (!contextFiles.some((file) => file.animateIn)) return
        const rafId = window.requestAnimationFrame(() => setContextFiles((prev) => prev.map((file) => file.animateIn ? { ...file, animateIn: false } : file)))
        return () => window.cancelAnimationFrame(rafId)
    }, [contextFiles, setContextFiles])

    useEffect(() => {
        if (previewAttachment && !contextFiles.some((entry) => entry.id === previewAttachment.id)) setPreviewAttachment(null)
    }, [contextFiles, previewAttachment, setPreviewAttachment])

    useEffect(() => {
        const element = composerRootRef.current
        if (!element || typeof ResizeObserver === 'undefined') return
        const observer = new ResizeObserver((entries) => {
            const width = entries[0]?.contentRect.width || element.clientWidth
            setIsCompactFooter(compact || width < 760)
        })
        observer.observe(element)
        return () => observer.disconnect()
    }, [compact, composerRootRef, setIsCompactFooter])
}
