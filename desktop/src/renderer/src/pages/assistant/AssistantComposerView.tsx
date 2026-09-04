import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type WheelEvent as ReactWheelEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSettings } from '@/lib/settings'
import { readAssistantSkillSourceRevision } from '@/lib/assistant/assistant-skill-source-revision'
import { cn } from '@/lib/utils'
import { AnimatedHeight } from '@/components/ui/AnimatedHeight'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { FileEntryIcon } from '@/components/ui/FileEntryIcon'
import {
    ChevronDown,
    ChevronUp,
    Zap,
    FileCode2,
    FileImage,
    FileText,
    GripVertical,
    Pencil,
    Plus,
    SendHorizontal,
    Trash2,
    X
} from 'lucide-react'
import AssistantAttachmentPreviewModal from './AssistantAttachmentPreviewModal'
import { AssistantVoiceRecorderBar } from './AssistantVoiceRecorderBar'
import { AssistantNewChatProjectChip } from './AssistantNewChatProjectChip'
import { AssistantComposerContextIndicator } from './AssistantComposerContextIndicator'
import { AssistantBusySendSplitButton } from './AssistantBusySendSplitButton'
import { AssistantComposerCommandMenu } from './AssistantComposerCommandMenu'
import { AssistantComposerFileMenu } from './AssistantComposerFileMenu'
import { ComposerAttachmentsShelf, ComposerFooterControls, ComposerMentionMenu, ComposerRealtimeVoiceButton, ComposerSendButton, ComposerVoiceButton } from './AssistantComposerSections'
import { formatAssistantModelLabel } from './assistant-model-labels'
import {
    renderInlineMentionOverlay,
    reconcileInlineMentionTags,
} from './assistant-composer-inline-mentions'
import type { AssistantPromptResourcesPayload, AssistantVoiceExecutionConfiguration } from '@shared/assistant/contracts'
import type { AssistantComposerController } from './useAssistantComposerController'
import { deriveAssistantComposerViewState, shouldShowComposerRealtimeVoicePrimaryAction } from './assistant-composer-view-state'
import { buildAssistantVoiceExecutionConfiguration } from './assistant-voice-execution-configuration'
import {
    createAttachmentId,
    getContentTypeTag,
    getContextFileMeta,
    isPastedTextAttachment,
    toKbLabel
} from './assistant-composer-utils'
import {
    applyAssistantComposerCommandItem,
    buildAssistantComposerCommandItems,
    findAssistantComposerSlashToken,
    getAssistantComposerCommandOptionId,
    isAssistantComposerSlashTokenAtDraftStart,
    resolveAssistantComposerCommandMenuIndex,
    type AssistantComposerCommandItem
} from './assistant-composer-command-menu'
import {
    findAssistantComposerIncludeToken,
    getAssistantComposerFileOptionId,
    removeAssistantComposerIncludeToken,
    type AssistantComposerFileSearchItem
} from './assistant-composer-file-search'
import { useAssistantComposerFileSearch } from './useAssistantComposerFileSearch'

const PROMPT_RESOURCE_CACHE_TTL_MS = 30_000
const PROMPT_RESOURCE_CACHE_MAX_PROJECTS = 24
const promptResourceCache = new Map<string, { expiresAt: number; revision: string; value: AssistantPromptResourcesPayload }>()
const promptResourceRequests = new Map<string, { revision: string; promise: Promise<AssistantPromptResourcesPayload> }>()

function readCachedPromptResources(projectPath?: string | null): AssistantPromptResourcesPayload | null {
    const key = projectPath?.trim() || '<global>'
    const cached = promptResourceCache.get(key)
    if (!cached || cached.expiresAt <= Date.now() || cached.revision !== readAssistantSkillSourceRevision()) {
        promptResourceCache.delete(key)
        return null
    }
    return cached.value
}

async function loadPromptResources(projectPath?: string | null): Promise<AssistantPromptResourcesPayload> {
    const key = projectPath?.trim() || '<global>'
    const revision = readAssistantSkillSourceRevision()
    const cached = readCachedPromptResources(projectPath)
    if (cached) return cached

    let requestEntry = promptResourceRequests.get(key)
    if (!requestEntry || requestEntry.revision !== revision) {
        const promise = window.devscope.assistant.listPromptResources(projectPath).then((result) => {
            if (!result.success) throw new Error(result.error || 'Could not load commands and skills.')
            const value = {
                commands: result.commands,
                skills: result.skills,
                diagnostics: result.diagnostics
            }
            promptResourceCache.delete(key)
            promptResourceCache.set(key, {
                expiresAt: Date.now() + PROMPT_RESOURCE_CACHE_TTL_MS,
                revision,
                value
            })
            while (promptResourceCache.size > PROMPT_RESOURCE_CACHE_MAX_PROJECTS) {
                const oldest = promptResourceCache.keys().next().value
                if (!oldest) break
                promptResourceCache.delete(oldest)
            }
            return value
        }).finally(() => {
            if (promptResourceRequests.get(key)?.promise === promise) promptResourceRequests.delete(key)
        })
        requestEntry = { revision, promise }
        promptResourceRequests.set(key, requestEntry)
    }
    return requestEntry.promise
}

export function AssistantComposerView({
    controller,
    realtimeVoiceDisabled = true,
    onStartRealtimeVoice
}: {
    controller: AssistantComposerController
    realtimeVoiceDisabled?: boolean
    onStartRealtimeVoice?: (configuration: AssistantVoiceExecutionConfiguration) => void
}) {
    const navigate = useNavigate()
    const { settings, updateSettings } = useSettings()
    const commandMenuId = useId()
    const transcriptionEnabled = settings.assistantTranscriptionEnabled
    const capabilities = controller.capabilities
    const canSend = capabilities.canSend
    const showBusySendActions = capabilities.showBusySendActions
    const [showBrowserSpeechFallbackModal, setShowBrowserSpeechFallbackModal] = useState(false)
    const [textareaScrollTop, setTextareaScrollTop] = useState(0)
    const [draggedQueuedMessageId, setDraggedQueuedMessageId] = useState<string | null>(null)
    const [promptResources, setPromptResources] = useState<AssistantPromptResourcesPayload | null>(() =>
        readCachedPromptResources(controller.projectPath)
    )
    const [promptResourcesLoading, setPromptResourcesLoading] = useState(!promptResources)
    const [promptResourcesError, setPromptResourcesError] = useState<string | null>(null)
    const [activeCommandIndex, setActiveCommandIndex] = useState(0)
    const [menuScrollBehavior, setMenuScrollBehavior] = useState<ScrollBehavior>('smooth')
    const [slashMenuDismissed, setSlashMenuDismissed] = useState(false)
    const [slashMenuPresent, setSlashMenuPresent] = useState(false)
    const [slashMenuAnimatedOpen, setSlashMenuAnimatedOpen] = useState(false)
    const attachmentShelfRef = useRef<HTMLDivElement | null>(null)
    const commandActivationPendingRef = useRef(false)
    const hasFloatingShelf = controller.queuedMessages.length > 0 || controller.contextFiles.length > 0
    const hasInlineMentionOverlay = controller.text.length > 0 && controller.inlineMentionTags.length > 0
    const {
        iconTheme,
        voiceBusy
    } = deriveAssistantComposerViewState({
        capabilities,
        controller,
        settings
    })
    const composerPlaceholder = capabilities.placeholder
    const sendActionDisabled = capabilities.sendDisabled || (voiceBusy && !capabilities.canStop)
    const currentSubmitLabel = controller.isDirty && controller.dirtySubmitLabel
        ? controller.dirtySubmitLabel
        : controller.submitLabel
    const showRealtimeVoicePrimaryAction = shouldShowComposerRealtimeVoicePrimaryAction({
        currentSubmitLabel,
        text: controller.text,
        contextFilesLength: controller.contextFiles.length,
        realtimeVoiceAvailable: Boolean(onStartRealtimeVoice) && !realtimeVoiceDisabled,
        composerAvailable: !capabilities.inputDisabled && !capabilities.controlsLocked,
        isConnected: controller.isConnected,
        canStop: capabilities.canStop,
        showBusySendActions,
        dictationBusy: voiceBusy
    })
    const showCodexRecorder = transcriptionEnabled
        && settings.assistantTranscriptionEngine === 'codex'
        && (controller.voiceInput.isRecording || controller.voiceInput.isTranscribing)
    const speechError = controller.voiceInput.speechError?.trim() || ''
    const speechErrorNeedsReconnect = settings.assistantTranscriptionEngine === 'codex'
        && /ChatGPT.*(?:login|account)|Reconnect ChatGPT/i.test(speechError)
    const composerMotionDuration = showCodexRecorder ? 320 : 240
    const slashToken = useMemo(
        () => findAssistantComposerSlashToken(controller.text, controller.composerCursor),
        [controller.composerCursor, controller.text]
    )
    const includeToken = useMemo(
        () => findAssistantComposerIncludeToken(controller.text, controller.composerCursor),
        [controller.composerCursor, controller.text]
    )
    const commandItems = useMemo(
        () => buildAssistantComposerCommandItems(promptResources, slashToken?.query || '', {
            allowStartOnlyCommands: slashToken
                ? isAssistantComposerSlashTokenAtDraftStart(controller.text, slashToken)
                : true
        }),
        [controller.text, promptResources, slashToken]
    )
    const fileSearchRoots = useMemo(() => controller.projectRoots.length > 0
        ? controller.projectRoots
        : controller.projectPath ? [{
            id: `working-root:${controller.projectPath}`,
            kind: 'project-home' as const,
            path: controller.projectPath,
            label: controller.projectName || controller.projectPath.split(/[\\/]/).filter(Boolean).at(-1) || 'Project',
            access: 'read-write' as const
        }] : [], [controller.projectName, controller.projectPath, controller.projectRoots])
    const fileSearch = useAssistantComposerFileSearch({
        active: Boolean(includeToken),
        query: includeToken?.query || '',
        roots: fileSearchRoots
    })
    const fileMenuActive = Boolean(includeToken)
    const activeMenuItemCount = fileMenuActive ? fileSearch.items.length : commandItems.length
    const showSlashMenu = Boolean(
        (includeToken || slashToken)
        && !slashMenuDismissed
        && !showCodexRecorder
        && !capabilities.inputDisabled
    )
    const showTopShelf = slashMenuPresent || hasFloatingShelf

    useEffect(() => {
        let cancelled = false
        const cached = readCachedPromptResources(controller.projectPath)
        setPromptResources(cached)
        setPromptResourcesLoading(!cached)
        setPromptResourcesError(null)
        void loadPromptResources(controller.projectPath).then((resources) => {
            if (cancelled) return
            setPromptResources(resources)
            setPromptResourcesLoading(false)
        }).catch((error) => {
            if (cancelled) return
            setPromptResourcesLoading(false)
            setPromptResourcesError(error instanceof Error ? error.message : 'Could not load commands and skills.')
        })
        return () => {
            cancelled = true
        }
    }, [controller.projectPath])

    useEffect(() => {
        setSlashMenuDismissed(false)
    }, [controller.text])

    useEffect(() => {
        commandActivationPendingRef.current = false
        setActiveCommandIndex(0)
    }, [fileMenuActive, includeToken?.query, slashToken?.query])

    useEffect(() => {
        if (activeMenuItemCount === 0) {
            setActiveCommandIndex(0)
            return
        }
        setActiveCommandIndex((current) => Math.min(current, activeMenuItemCount - 1))
    }, [activeMenuItemCount])

    useEffect(() => {
        if (showSlashMenu) {
            setSlashMenuPresent(true)
            const frameId = window.requestAnimationFrame(() => setSlashMenuAnimatedOpen(true))
            return () => window.cancelAnimationFrame(frameId)
        }
        setSlashMenuAnimatedOpen(false)
        const timerId = window.setTimeout(() => setSlashMenuPresent(false), 300)
        return () => window.clearTimeout(timerId)
    }, [showSlashMenu])

    useEffect(() => {
        if (settings.assistantTranscriptionEngine !== 'browser') {
            setShowBrowserSpeechFallbackModal(false)
            return
        }
        if (controller.voiceInput.speechErrorKind === 'network') {
            setShowBrowserSpeechFallbackModal(true)
        }
    }, [controller.voiceInput.speechErrorKind, settings.assistantTranscriptionEngine])

    useLayoutEffect(() => {
        const host = attachmentShelfRef.current
        if (!host) {
            controller.onAttachmentShelfBoundsChange?.(null)
            return
        }

        const measure = () => {
            const itemRects = Array.from(host.querySelectorAll<HTMLElement>('[data-composer-attachment-item="true"]'))
                .map((element) => element.getBoundingClientRect())
                .filter((rect) => rect.width > 0 && rect.height > 0)

            if (itemRects.length === 0) {
                controller.onAttachmentShelfBoundsChange?.(null)
                return
            }

            const bounds = itemRects.reduce((acc, rect) => ({
                top: Math.min(acc.top, rect.top),
                right: Math.max(acc.right, rect.right),
                bottom: Math.max(acc.bottom, rect.bottom),
                left: Math.min(acc.left, rect.left),
                width: 0,
                height: 0
            }), {
                top: itemRects[0].top,
                right: itemRects[0].right,
                bottom: itemRects[0].bottom,
                left: itemRects[0].left,
                width: 0,
                height: 0
            })

            controller.onAttachmentShelfBoundsChange?.({
                ...bounds,
                width: Math.max(0, bounds.right - bounds.left),
                height: Math.max(0, bounds.bottom - bounds.top)
            })
        }

        const frameId = window.requestAnimationFrame(measure)
        const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => measure()) : null
        observer?.observe(host)
        window.addEventListener('resize', measure)

        return () => {
            window.cancelAnimationFrame(frameId)
            observer?.disconnect()
            window.removeEventListener('resize', measure)
        }
    }, [
        controller.contextFiles.length,
        controller.onAttachmentShelfBoundsChange,
        controller.placement,
        controller.queuedMessages.length
    ])

    const syncTextareaScroll = useCallback((element: HTMLTextAreaElement | null) => {
        setTextareaScrollTop(element?.scrollTop ?? 0)
    }, [])

    const getNormalizedWheelDelta = useCallback((element: HTMLElement, deltaY: number, deltaMode: number) => {
        const lineHeight = Number.parseFloat(window.getComputedStyle(element).lineHeight || '0') || 20
        const pageHeight = element.clientHeight || lineHeight * 3
        const deltaFactor = deltaMode === 1 ? lineHeight : deltaMode === 2 ? pageHeight : 1
        return deltaY * deltaFactor
    }, [])

    const handleShelfWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
        if (!controller.onOverflowWheel || event.deltaY === 0) return
        event.preventDefault()
        controller.onOverflowWheel(getNormalizedWheelDelta(event.currentTarget, event.deltaY, event.deltaMode))
    }, [controller.onOverflowWheel, getNormalizedWheelDelta])

    const handleTextareaWheel = useCallback((event: ReactWheelEvent<HTMLTextAreaElement>) => {
        if (!controller.onOverflowWheel || event.deltaY === 0) return

        const element = event.currentTarget
        const normalizedDeltaY = getNormalizedWheelDelta(element, event.deltaY, event.deltaMode)
        const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight)
        event.preventDefault()
        event.stopPropagation()

        if (maxScrollTop <= 0) {
            syncTextareaScroll(element)
            controller.onOverflowWheel(normalizedDeltaY)
            return
        }

        if (normalizedDeltaY < 0) {
            if (element.scrollTop > 1) {
                element.scrollTop = Math.max(0, element.scrollTop + normalizedDeltaY)
                syncTextareaScroll(element)
                return
            }
            element.scrollTop = 0
            syncTextareaScroll(element)
            controller.onOverflowWheel(normalizedDeltaY)
            return
        }

        if (normalizedDeltaY > 0) {
            if (maxScrollTop - element.scrollTop > 1) {
                element.scrollTop = Math.min(maxScrollTop, element.scrollTop + normalizedDeltaY)
                syncTextareaScroll(element)
                return
            }
            element.scrollTop = maxScrollTop
            syncTextareaScroll(element)
            controller.onOverflowWheel(normalizedDeltaY)
        }
    }, [controller.onOverflowWheel, getNormalizedWheelDelta, syncTextareaScroll])

    const selectCommandItem = useCallback((item: AssistantComposerCommandItem) => {
        if (!slashToken || commandActivationPendingRef.current) return
        commandActivationPendingRef.current = true
        try {
            const next = applyAssistantComposerCommandItem(controller.text, slashToken, item)
            controller.setInlineMentionTags((current) => reconcileInlineMentionTags(controller.text, next.text, current))
            controller.setText(next.text)
            controller.setComposerCursor(next.cursor)
            if (controller.historyCursor != null) controller.setHistoryCursor(null)
            window.requestAnimationFrame(() => {
                const textarea = controller.textareaRef.current
                textarea?.focus()
                textarea?.setSelectionRange(next.cursor, next.cursor)
            })
        } catch (error) {
            commandActivationPendingRef.current = false
            throw error
        }
    }, [controller, slashToken])

    const selectFileItem = useCallback((item: AssistantComposerFileSearchItem) => {
        if (!includeToken || commandActivationPendingRef.current) return
        commandActivationPendingRef.current = true
        const meta = getContextFileMeta({ path: item.path, name: item.name })
        controller.upsertAttachment({
            id: createAttachmentId(),
            path: item.path,
            name: item.name,
            kind: meta.category === 'image' ? 'image' : meta.category === 'code' ? 'code' : 'file',
            source: 'manual',
            animateIn: true
        })
        const next = removeAssistantComposerIncludeToken(controller.text, includeToken)
        controller.setInlineMentionTags((current) => reconcileInlineMentionTags(controller.text, next.text, current))
        controller.setText(next.text)
        controller.setComposerCursor(next.cursor)
        if (controller.historyCursor != null) controller.setHistoryCursor(null)
        window.requestAnimationFrame(() => {
            const textarea = controller.textareaRef.current
            textarea?.focus()
            textarea?.setSelectionRange(next.cursor, next.cursor)
        })
    }, [controller, includeToken])

    const handleMenuPointerActiveIndex = useCallback((index: number) => {
        setMenuScrollBehavior('smooth')
        setActiveCommandIndex(index)
    }, [])

    const handleComposerKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
        if (!showSlashMenu) {
            controller.handleKeyDown(event)
            return
        }

        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setMenuScrollBehavior(event.repeat ? 'auto' : 'smooth')
            if (activeMenuItemCount > 0) {
                const direction = event.key === 'ArrowDown' ? 'ArrowDown' : 'ArrowUp'
                setActiveCommandIndex((current) => resolveAssistantComposerCommandMenuIndex(
                    current,
                    direction,
                    activeMenuItemCount
                ))
            }
            return
        }

        if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault()
            if (fileMenuActive) {
                const selectedFile = fileSearch.items[activeCommandIndex]
                if (selectedFile) selectFileItem(selectedFile)
            } else {
                const selectedCommand = commandItems[activeCommandIndex]
                if (selectedCommand) selectCommandItem(selectedCommand)
            }
            return
        }

        if (event.key === 'Escape') {
            event.preventDefault()
            setSlashMenuDismissed(true)
            return
        }

        controller.handleKeyDown(event)
    }, [activeCommandIndex, activeMenuItemCount, commandItems, controller, fileMenuActive, fileSearch.items, selectCommandItem, selectFileItem, showSlashMenu])

    return (
        <>
            <div className="relative flex pointer-events-none flex-col gap-0">
                {showTopShelf ? (
                    <div
                        ref={attachmentShelfRef}
                        className={cn(
                            'pointer-events-none absolute inset-x-0 bottom-full',
                            slashMenuPresent ? 'z-30 mb-[-13px]' : 'z-50 mb-[-2px]'
                        )}
                    >
                        <div className="flex flex-col gap-1" onWheel={slashMenuPresent ? undefined : handleShelfWheel}>
                            {slashMenuPresent ? (
                                <AnimatedHeight
                                    isOpen={slashMenuAnimatedOpen}
                                    duration={300}
                                    unmountOnExit
                                    contentClassName={cn(
                                        'origin-bottom transition-[transform,opacity,filter] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
                                        slashMenuAnimatedOpen
                                            ? 'translate-y-0 opacity-100 blur-0'
                                            : 'translate-y-4 opacity-0 blur-[1px]'
                                    )}
                                >
                                    {fileMenuActive ? (
                                        <AssistantComposerFileMenu
                                            menuId={commandMenuId}
                                            items={fileSearch.items}
                                            activeIndex={activeCommandIndex}
                                            query={includeToken?.query || ''}
                                            loading={fileSearch.loading}
                                            error={fileSearch.error}
                                            iconTheme={iconTheme}
                                            scrollBehavior={menuScrollBehavior}
                                            onActiveIndexChange={handleMenuPointerActiveIndex}
                                            onSelect={selectFileItem}
                                        />
                                    ) : (
                                        <AssistantComposerCommandMenu
                                            menuId={commandMenuId}
                                            items={commandItems}
                                            activeIndex={activeCommandIndex}
                                            loading={promptResourcesLoading}
                                            error={promptResourcesError}
                                            scrollBehavior={menuScrollBehavior}
                                            onActiveIndexChange={handleMenuPointerActiveIndex}
                                            onSelect={selectCommandItem}
                                        />
                                    )}
                                </AnimatedHeight>
                            ) : (
                                <>
                            <AnimatedHeight isOpen={controller.queuedMessages.length > 0} duration={220}>
                                <div
                                    data-composer-attachment-item="true"
                                    className="pointer-events-auto mx-auto w-[calc(100%-1rem)] overflow-hidden rounded-[20px] rounded-b-[4px] border border-white/[0.06] bg-sparkle-card/95 shadow-[0_8px_18px_rgba(0,0,0,0.10)] backdrop-blur-xl sm:w-[calc(100%-2.25rem)]"
                                >
                                    <div className="flex items-center justify-between border-b border-white/[0.06] px-3.5 py-1.5">
                                        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/42">
                                            Queued {controller.queuedMessages.length}
                                        </span>
                                    </div>
                                    <div className={cn(
                                        'custom-scrollbar overflow-y-auto',
                                        controller.queuedMessages.length >= 3 && 'max-h-[9.75rem]'
                                    )}>
                                        {controller.queuedMessages.map((queuedMessage, index) => {
                                            const isForce = queuedMessage.dispatchMode === 'force'
                                            const isPaused = queuedMessage.status === 'paused'
                                            const queuePromptLabel = queuedMessage.prompt.trim() || 'Attachment-only message'
                                            const queuedFileCount = queuedMessage.contextFiles.length
                                            const canForceQueuedMessage = Boolean(controller.onForceQueuedMessage) && (!isForce || isPaused)
                                            const canEditQueuedMessage = Boolean(controller.onDeleteQueuedMessage)
                                            const editQueuedMessage = () => {
                                                if (!canEditQueuedMessage) return
                                                controller.restoreQueuedMessageToDraft(queuedMessage)
                                                void controller.onDeleteQueuedMessage?.(queuedMessage.id)
                                            }
                                            return (
                                                <div
                                                    key={queuedMessage.id}
                                                    onDragOver={(event) => {
                                                        if (!controller.onMoveQueuedMessage || !draggedQueuedMessageId || draggedQueuedMessageId === queuedMessage.id) return
                                                        event.preventDefault()
                                                        event.dataTransfer.dropEffect = 'move'
                                                    }}
                                                    onDrop={(event) => {
                                                        if (!controller.onMoveQueuedMessage || !draggedQueuedMessageId || draggedQueuedMessageId === queuedMessage.id) return
                                                        event.preventDefault()
                                                        void controller.onMoveQueuedMessage(draggedQueuedMessageId, queuedMessage.id)
                                                        setDraggedQueuedMessageId(null)
                                                    }}
                                                    className={cn(
                                                        'relative flex items-start gap-2.5 px-3.5 py-2',
                                                        index > 0 && 'border-t border-white/[0.06]',
                                                        isForce && 'bg-amber-500/10',
                                                        isPaused && 'bg-rose-500/10',
                                                        draggedQueuedMessageId === queuedMessage.id && 'opacity-45'
                                                    )}
                                                >
                                                    <div className={cn(
                                                        'mt-1 shrink-0',
                                                        controller.onMoveQueuedMessage ? 'cursor-grab active:cursor-grabbing' : 'cursor-default',
                                                        isForce
                                                            ? 'text-amber-100/45'
                                                            : isPaused
                                                                ? 'text-rose-100/45'
                                                                : 'text-white/20'
                                                    )}
                                                        draggable={Boolean(controller.onMoveQueuedMessage)}
                                                        onDragStart={(event) => {
                                                            if (!controller.onMoveQueuedMessage) return
                                                            setDraggedQueuedMessageId(queuedMessage.id)
                                                            event.dataTransfer.effectAllowed = 'move'
                                                            event.dataTransfer.setData('text/plain', queuedMessage.id)
                                                        }}
                                                        onDragEnd={() => setDraggedQueuedMessageId(null)}
                                                        title="Drag to reorder queued messages"
                                                    >
                                                        <GripVertical size={14} />
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        {isPaused || queuedFileCount > 0 ? (
                                                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                                                {isPaused ? (
                                                                    <span className="rounded-full bg-rose-500/12 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-rose-100/85">
                                                                        Retry needed
                                                                    </span>
                                                                ) : null}
                                                                {queuedFileCount > 0 ? (
                                                                    <span className="text-[10px] uppercase tracking-[0.14em] text-white/28">
                                                                        {queuedFileCount} file{queuedFileCount === 1 ? '' : 's'}
                                                                    </span>
                                                                ) : null}
                                                            </div>
                                                        ) : null}
                                                        <button
                                                            type="button"
                                                            onClick={editQueuedMessage}
                                                            disabled={!canEditQueuedMessage}
                                                            className="mt-0.5 block w-full cursor-text whitespace-pre-wrap break-words text-left text-[12.5px] leading-5 text-sparkle-text transition-colors hover:text-white disabled:cursor-default disabled:text-sparkle-text"
                                                            title={queuePromptLabel}
                                                            style={{
                                                                display: '-webkit-box',
                                                                WebkitBoxOrient: 'vertical',
                                                                WebkitLineClamp: 2,
                                                                overflow: 'hidden'
                                                            }}
                                                        >
                                                            {queuePromptLabel}
                                                        </button>
                                                    </div>
                                                    <div className="ml-2 flex shrink-0 items-center justify-end gap-1 self-center">
                                                        <button
                                                            type="button"
                                                            onClick={() => void controller.onDeleteQueuedMessage?.(queuedMessage.id)}
                                                            disabled={!controller.onDeleteQueuedMessage}
                                                            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-transparent bg-white/[0.02] text-white/38 transition-colors hover:bg-rose-500/12 hover:text-rose-100 disabled:cursor-not-allowed disabled:opacity-35"
                                                            title="Delete queued message"
                                                        >
                                                            <Trash2 size={13} />
                                                        </button>
                                                        <button
                                                        type="button"
                                                        onClick={editQueuedMessage}
                                                            disabled={!canEditQueuedMessage}
                                                            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-transparent bg-white/[0.02] text-white/38 transition-colors hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                                                            title="Edit queued message"
                                                        >
                                                            <Pencil size={13} />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => void controller.onForceQueuedMessage?.(queuedMessage.id)}
                                                            disabled={!canForceQueuedMessage}
                                                            className={cn(
                                                                'inline-flex h-8 items-center justify-center gap-1.5 rounded-full px-3 text-[11px] font-semibold transition-colors',
                                                                canForceQueuedMessage
                                                                    ? 'bg-amber-500/12 text-amber-100 hover:bg-amber-500/18'
                                                                    : 'bg-white/[0.05] text-white/35'
                                                            )}
                                                            title={canForceQueuedMessage
                                                                ? 'Interrupt the current turn and send this queued message next'
                                                                : isForce
                                                                    ? 'This queued message is already forced'
                                                                    : 'Force send is unavailable right now'}
                                                        >
                                                            <Zap size={11} />
                                                            <span>{canForceQueuedMessage ? 'Force' : 'Forced'}</span>
                                                        </button>
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                            </AnimatedHeight>
                            <ComposerAttachmentsShelf
                                contextFiles={controller.contextFiles}
                                compact={controller.compact}
                                removingAttachmentIds={controller.removingAttachmentIds}
                                onOpenAttachmentPreview={controller.onOpenAttachmentPreview}
                                onPreview={controller.setPreviewAttachment}
                                onRemove={controller.removeAttachment}
                            />
                                </>
                            )}
                        </div>
                    </div>
                ) : null}
                <div ref={controller.composerRootRef} className="pointer-events-auto relative z-40">
                    {controller.placement === 'center' && controller.onSelectProject && controller.onChooseProjectFolder ? (
                        <AssistantNewChatProjectChip
                            projectId={controller.projectId || null}
                            projectPath={controller.projectPath || null}
                            projectName={controller.projectName || null}
                            projectChoices={controller.projectChoices}
                            detectedProjectChoices={controller.detectedProjectChoices}
                            disabled={controller.projectContextDisabled}
                            onSelectProject={controller.onSelectProject}
                            onImportDetectedProject={controller.onImportDetectedProject}
                            onChooseFolder={controller.onChooseProjectFolder}
                        />
                    ) : null}
                    <div
                        className={cn(
                            'group relative overflow-visible border transition-[background-color,border-radius,box-shadow,min-height] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
                            showCodexRecorder ? 'rounded-full' : 'rounded-[18px]',
                            controller.placement === 'bottom'
                                ? 'border-white/[0.09] bg-[color-mix(in_srgb,var(--color-card)_97%,transparent)] shadow-[0_18px_54px_rgba(0,0,0,0.30),0_1px_0_rgba(255,255,255,0.045),inset_0_1px_0_rgba(255,255,255,0.045),inset_0_-1px_0_rgba(0,0,0,0.18)] backdrop-blur-md'
                                : 'border-[var(--surface-divider)] bg-[color-mix(in_srgb,var(--surface-floating)_94%,transparent)] shadow-[0_22px_68px_color-mix(in_srgb,var(--color-bg)_54%,transparent),0_1px_0_rgba(255,255,255,0.045),inset_0_1px_0_color-mix(in_srgb,var(--color-text)_4%,transparent)] backdrop-blur-[18px]'
                        )}
                        data-assistant-composer-frame="true"
                    >
                        {controller.placement === 'bottom' ? (
                            <>
                                <div
                                    className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[linear-gradient(116deg,rgba(255,255,255,0.04),rgba(255,255,255,0.014)_26%,transparent_58%)] opacity-55"
                                    data-assistant-composer-decoration="true"
                                    aria-hidden="true"
                                />
                                <div
                                    className="pointer-events-none absolute inset-x-4 top-0 h-px rounded-full bg-white/[0.08]"
                                    data-assistant-composer-decoration="true"
                                    aria-hidden="true"
                                />
                            </>
                        ) : null}
                        <input
                            ref={controller.filePickerRef}
                            type="file"
                            className="hidden"
                            multiple
                            accept="image/*,text/*,.md,.markdown,.txt,.json,.yaml,.yml,.xml,.csv,.ts,.tsx,.js,.jsx,.mjs,.cjs,.py,.go,.rs,.java,.kt,.cs,.cpp,.c,.h,.css,.scss,.sass,.html,.sql,.toml,.sh,.ps1"
                            onChange={(event) => {
                                const files = event.target.files
                                if (files?.length) {
                                    for (const file of Array.from(files)) void controller.attachFile(file, 'manual')
                                }
                                event.currentTarget.value = ''
                            }}
                        />
                        <AnimatedHeight
                            isOpen={!showCodexRecorder}
                            duration={composerMotionDuration}
                            contentClassName={cn(
                                'transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
                                showCodexRecorder ? 'translate-y-1 opacity-0' : 'translate-y-0 opacity-100'
                            )}
                        >
                            <div ref={controller.mentionMenuRef} className="relative px-3 pb-1.5 pt-2.5 sm:px-3.5 sm:pt-3">
                            <ComposerMentionMenu
                                isOpen={controller.showMentionMenu}
                                mentionCanScrollUp={controller.mentionCanScrollUp}
                                mentionCanScrollDown={controller.mentionCanScrollDown}
                                mentionLoading={controller.mentionLoading}
                                mentionCandidates={controller.mentionCandidates}
                                activeMentionIndex={controller.activeMentionIndex}
                                mentionListRef={controller.mentionListRef}
                                iconTheme={iconTheme}
                                onScroll={(element) => controller.syncScrollAffordance(element, controller.setMentionCanScrollUp, controller.setMentionCanScrollDown)}
                                onApplyMention={controller.applyMentionCandidate}
                            />

                            <div className="flex min-h-[50px] items-start gap-2">
                                <button
                                    type="button"
                                    onClick={() => controller.filePickerRef.current?.click()}
                                    disabled={capabilities.attachDisabled}
                                    className="mt-0.5 rounded-md p-1 text-sparkle-text-muted transition-colors hover:bg-sparkle-card-hover hover:text-sparkle-text disabled:opacity-50"
                                    title={capabilities.attachDisabled
                                        ? capabilities.detailLabel || 'Attachments are unavailable right now'
                                        : 'Attach files'}
                                >
                                    <Plus size={15} />
                                </button>
                                <div className="relative min-w-0 flex-1">
                                    {hasInlineMentionOverlay ? (
                                        <div
                                            aria-hidden="true"
                                            className="pointer-events-none absolute inset-0 overflow-hidden"
                                        >
                                            <div
                                                className={cn(
                                                    'whitespace-pre-wrap break-words pl-[3px] pr-2 text-sparkle-text',
                                                    controller.compact ? 'min-h-[44px] text-[13.5px] leading-[1.35rem]' : 'min-h-[50px] text-[14.5px] leading-[1.4rem]'
                                                )}
                                                style={{ transform: `translateY(-${textareaScrollTop}px)` }}
                                            >
                                                {renderInlineMentionOverlay(controller.text, controller.inlineMentionTags, (tag, rawToken) => (
                                                    <span
                                                        key={tag.id}
                                                        className="rounded-md bg-[var(--accent-primary)]/12 px-1 py-0.5 text-[var(--accent-primary)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent-primary)_18%,transparent)] [box-decoration-break:clone]"
                                                    >
                                                        {rawToken}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    ) : null}
                                    <textarea
                                        ref={controller.textareaRef}
                                        rows={3}
                                        value={controller.text}
                                        onChange={(event) => {
                                            const nextText = event.target.value
                                            controller.setInlineMentionTags((current) => reconcileInlineMentionTags(controller.text, nextText, current))
                                            controller.setText(nextText)
                                            controller.setComposerCursor(event.target.selectionStart ?? nextText.length)
                                            if (controller.historyCursor != null) controller.setHistoryCursor(null)
                                        }}
                                        onClick={(event) => controller.syncComposerCursor(event.currentTarget)}
                                        onScroll={(event) => syncTextareaScroll(event.currentTarget)}
                                        onKeyUp={(event) => {
                                            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') setMenuScrollBehavior('smooth')
                                            controller.syncComposerCursor(event.currentTarget)
                                        }}
                                        onSelect={(event) => controller.syncComposerCursor(event.currentTarget)}
                                        onKeyDown={handleComposerKeyDown}
                                        onPaste={controller.handlePaste}
                                        onWheel={handleTextareaWheel}
                                        role="combobox"
                                        aria-autocomplete="list"
                                        aria-haspopup="listbox"
                                        aria-expanded={showSlashMenu}
                                        aria-controls={showSlashMenu ? commandMenuId : undefined}
                                        aria-activedescendant={showSlashMenu
                                            ? fileMenuActive && fileSearch.items[activeCommandIndex]
                                                ? getAssistantComposerFileOptionId(commandMenuId, fileSearch.items[activeCommandIndex].id)
                                                : commandItems[activeCommandIndex]
                                                    ? getAssistantComposerCommandOptionId(commandMenuId, commandItems[activeCommandIndex].id)
                                                    : undefined
                                            : undefined}
                                        spellCheck={!hasInlineMentionOverlay}
                                        className={cn(
                                            'relative max-h-[120px] w-full resize-none overflow-y-auto bg-transparent pl-[3px] pr-2 font-normal tracking-normal [letter-spacing:0] caret-sparkle-text outline-none placeholder:font-normal placeholder:tracking-normal placeholder:[letter-spacing:0] placeholder:text-sparkle-text-muted/70 selection:bg-sparkle-card-hover',
                                            controller.compact ? 'min-h-[44px] text-[13.5px] leading-[1.35rem]' : 'min-h-[50px] text-[14.5px] leading-[1.4rem]',
                                            hasInlineMentionOverlay ? 'text-transparent' : 'text-sparkle-text'
                                        )}
                                        placeholder={composerPlaceholder}
                                        disabled={capabilities.inputDisabled || voiceBusy}
                                    />
                                </div>
                            </div>
                            </div>
                        </AnimatedHeight>
                        <div className={cn(
                            'flex items-center justify-between [container-type:inline-size]',
                            showCodexRecorder
                                ? 'gap-2 px-1.5 py-1.5'
                                : controller.isCompactFooter
                                    ? 'gap-2 px-1.5 pb-1.5 sm:px-2 sm:pb-2'
                                    : 'flex-wrap gap-2.5 px-1.5 pb-1.5 sm:flex-nowrap sm:gap-3 sm:px-2 sm:pb-2'
                        )}>
                            {showCodexRecorder ? (
                                <>
                                    <AssistantVoiceRecorderBar
                                        disabled={capabilities.voiceDisabled}
                                        durationLabel={controller.voiceInput.durationLabel}
                                        isTranscribing={controller.voiceInput.isTranscribing}
                                        waveformLevels={controller.voiceInput.waveformLevels}
                                        onCancel={controller.voiceInput.cancelRecording}
                                        onSubmit={controller.voiceInput.submitRecording}
                                    />
                                    {capabilities.canStop ? (
                                        <ComposerSendButton
                                            disabled={false}
                                            isConnected={controller.isConnected}
                                            isThinking={true}
                                            canSend={false}
                                            reconnectPending={controller.reconnectPending}
                                            onStop={controller.onStop}
                                            onReconnect={controller.onReconnect}
                                            onSend={() => void controller.handleSend()}
                                        />
                                    ) : null}
                                </>
                            ) : (
                                <>
                        <ComposerFooterControls
                            isCompactFooter={controller.isCompactFooter}
                            placement={controller.placement}
                            controlsLocked={capabilities.controlsLocked}
                            modelDropdownRef={controller.modelDropdownRef}
                            showModelDropdown={controller.showModelDropdown}
                                setShowModelDropdown={controller.setShowModelDropdown}
                                modelsLoading={controller.modelsLoading}
                                modelsError={controller.modelsError}
                                modelQuery={controller.modelQuery}
                                setModelQuery={controller.setModelQuery}
                                setActiveModelIndex={controller.setActiveModelIndex}
                                modelListRef={controller.modelListRef}
                                filteredModelOptions={controller.filteredModelOptions}
                                activeModelIndex={controller.activeModelIndex}
                                selectedModel={controller.selectedModel}
                                selectedModelLabel={controller.selectedModelLabel}
                                latestModelId={controller.latestModelId}
                                setSelectedModel={controller.setSelectedModel}
                                onRefreshModels={controller.onRefreshModels}
                                traitsDropdownRef={controller.traitsDropdownRef}
                                showTraitsDropdown={controller.showTraitsDropdown}
                                setShowTraitsDropdown={controller.setShowTraitsDropdown}
                                EFFORT_OPTIONS={controller.EFFORT_OPTIONS}
                                selectedEffort={controller.selectedEffort}
                                setSelectedEffort={controller.setSelectedEffort}
                                EFFORT_LABELS={controller.EFFORT_LABELS}
                                fastModeEnabled={controller.fastModeEnabled}
                                setFastModeEnabled={controller.setFastModeEnabled}
                                selectedInteractionMode={controller.selectedInteractionMode}
                                setSelectedInteractionMode={controller.setSelectedInteractionMode}
                                selectedRuntimeMode={controller.selectedRuntimeMode}
                                setSelectedRuntimeMode={controller.setSelectedRuntimeMode}
                                displayedProfile={controller.displayedProfile}
                                zyraProfile={controller.zyraProfile}
                                onZyraProfileChange={controller.onZyraProfileChange}
                                isConnected={controller.isConnected}
                                isConnecting={controller.isConnecting}
                                reconnectPending={controller.reconnectPending}
                                onReconnect={controller.onReconnect}
                            />

                            <div className={cn('assistant-composer-footer-actions flex shrink-0 items-center', showBusySendActions ? 'gap-1.5 [--assistant-footer-action-gap:0.375rem]' : 'gap-2 [--assistant-footer-action-gap:0.5rem]')}>
                                <AssistantComposerContextIndicator
                                    usage={controller.latestTurnUsage}
                                    modelContextWindow={controller.selectedModelContextWindow}
                                />
                                {controller.showCancelWhenDirty && controller.isDirty ? (
                                    <button
                                        type="button"
                                        onClick={controller.handleCancelDirty}
                                        className="inline-flex h-[36px] items-center justify-center rounded-full border border-transparent bg-white/[0.03] px-3.5 text-[12px] font-semibold text-sparkle-text-secondary transition-colors hover:bg-white/[0.05] hover:text-sparkle-text"
                                    >
                                        {controller.cancelLabel}
                                    </button>
                                ) : null}
                                <ComposerVoiceButton
                                    supported={transcriptionEnabled && controller.voiceInput.isSupported}
                                    isStarting={controller.voiceInput.isStarting}
                                    isRecording={controller.voiceInput.isRecording}
                                    disabled={capabilities.voiceDisabled || controller.voiceInput.isStarting || controller.voiceInput.isTranscribing}
                                    onToggle={controller.voiceInput.toggleRecording}
                                />
                                {showBusySendActions ? (
                                    <>
                                        <AssistantBusySendSplitButton
                                            defaultMode={controller.busyMessageMode}
                                            disabled={sendActionDisabled}
                                            queuedCount={controller.queuedMessageCount}
                                            onModeUsed={(assistantBusyMessageMode) => updateSettings({ assistantBusyMessageMode })}
                                            onQueue={controller.handleQueueSend}
                                            onForce={controller.handleForceSend}
                                        />
                                        <ComposerSendButton
                                            disabled={sendActionDisabled}
                                            isConnected={controller.isConnected}
                                            isThinking={true}
                                            canSend={false}
                                            label={currentSubmitLabel}
                                            reconnectPending={controller.reconnectPending}
                                            onStop={controller.onStop}
                                            onReconnect={controller.onReconnect}
                                            onSend={() => void controller.handleSend()}
                                        />
                                    </>
                                ) : showRealtimeVoicePrimaryAction ? (
                                    <ComposerRealtimeVoiceButton onStart={() => onStartRealtimeVoice?.(
                                        buildAssistantVoiceExecutionConfiguration({
                                            model: controller.selectedModel,
                                            runtimeMode: controller.selectedRuntimeMode,
                                            effort: controller.selectedEffort,
                                            interactionMode: controller.selectedInteractionMode,
                                            profile: controller.zyraProfile,
                                            fastModeEnabled: controller.fastModeEnabled
                                        })
                                    )} />
                                ) : (
                                    <ComposerSendButton
                                        disabled={sendActionDisabled}
                                        isConnected={controller.isConnected}
                                        isThinking={controller.isThinking}
                                        canSend={canSend}
                                        label={currentSubmitLabel}
                                        reconnectPending={controller.reconnectPending}
                                        onStop={controller.onStop}
                                        onReconnect={controller.onReconnect}
                                        onSend={() => void controller.handleSend()}
                                    />
                                )}
                            </div>
                                </>
                            )}
                        </div>
                    </div>
                    {speechError ? (
                        <div role="alert" className="mt-1.5 flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1 px-2 text-[10px] leading-4 text-amber-200/80">
                            <span className="min-w-0 flex-1">{speechError}</span>
                            {settings.assistantTranscriptionEngine === 'codex' ? (
                                <div className="flex shrink-0 items-center gap-2">
                                    {speechErrorNeedsReconnect ? (
                                        <button type="button" onClick={() => navigate('/settings/account')} className="font-medium text-amber-100 underline decoration-amber-200/35 underline-offset-2 hover:decoration-amber-100">
                                            Reconnect ChatGPT
                                        </button>
                                    ) : null}
                                    <button type="button" onClick={() => updateSettings({ assistantTranscriptionEngine: 'browser' })} className="font-medium text-amber-100 underline decoration-amber-200/35 underline-offset-2 hover:decoration-amber-100">
                                        Use Browser dictation
                                    </button>
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                </div>

                <AssistantAttachmentPreviewModal
                    file={controller.previewAttachment}
                    meta={controller.previewAttachment ? getContextFileMeta(controller.previewAttachment) : null}
                    contentType={controller.previewAttachment ? getContentTypeTag(controller.previewAttachment) : ''}
                    sizeLabel={controller.previewAttachment ? toKbLabel(controller.previewAttachment.sizeBytes) : ''}
                    showFormattingWarning={controller.previewAttachment ? isPastedTextAttachment(controller.previewAttachment) : false}
                    onUpdatePastedText={controller.updateContextFileText}
                    onClose={() => controller.setPreviewAttachment(null)}
                />
            </div>

            <ConfirmModal
                isOpen={showBrowserSpeechFallbackModal}
                title="Browser speech failed"
                message="The browser speech service could not complete dictation. Open assistant settings to switch to ChatGPT voice-note transcription."
                confirmLabel="Open settings"
                cancelLabel="Dismiss"
                variant="info"
                onConfirm={() => {
                    setShowBrowserSpeechFallbackModal(false)
                    navigate('/settings/assistant/defaults?setting=settings-row-voice-transcription-transcription-engine')
                }}
                onCancel={() => setShowBrowserSpeechFallbackModal(false)}
            />
        </>
    )
}
