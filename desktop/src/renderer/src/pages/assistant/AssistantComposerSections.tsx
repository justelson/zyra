import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type Dispatch, type RefObject, type SetStateAction, type WheelEvent as ReactWheelEvent } from 'react'
import { AnimatedHeight } from '@/components/ui/AnimatedHeight'
import { FileEntryIcon } from '@/components/ui/FileEntryIcon'
import { cn } from '@/lib/utils'
import { AudioLines, Check, ChevronDown, ChevronUp, FilePenLine, Gauge, GitBranch, Loader2, Lock, LockOpen, Mic, RotateCw, SendHorizontal, ShieldCheck, Square, Zap } from 'lucide-react'
import type { AssistantRuntimeMode } from '@shared/assistant/contracts'
import type { PreviewOpenOptions } from '@/components/ui/file-preview/types'
import { formatAssistantModelLabel } from './assistant-model-labels'
import { getContentTypeTag, getContextFileMeta, isPastedTextAttachment } from './assistant-composer-utils'
import { parseAssistantBrowserAnnotation } from './assistant-browser-annotation-composer'
import type { ComposerContextFile } from './assistant-composer-types'
import type { MentionCandidate } from './assistant-composer-mentions'
import { buildEffortSliderTicks } from './assistant-composer-controller-constants'
import { AssistantFileAttachmentCard, AssistantPastedTextCard } from './AssistantAttachmentCards'
import { AssistantAttachmentImageCard } from './AssistantAttachmentImageCard'
import { AssistantBrowserAnnotationCard } from './AssistantBrowserAnnotationCard'

function getEffortTone(effort: string): { textClass: string } {
    return effort === 'off' || effort === 'none'
        ? { textClass: 'text-sparkle-text-dark' }
        : { textClass: 'text-sparkle-text' }
}

function isLatestModel(model: { id: string; label?: string }, latestModelId: string | null): boolean {
    return Boolean(latestModelId && model.id === latestModelId)
}

const ASSISTANT_ACCESS_OPTIONS: Array<{
    mode: AssistantRuntimeMode
    label: string
    shortLabel: string
    pillWidth: string
    description: string
    pillClass: string
    accentClass: string
    selectedMenuClass: string
    icon: typeof Lock
}> = [
    { mode: 'approval-required', label: 'Supervised', shortLabel: 'Supervised', pillWidth: '104px', description: 'Ask before commands, edits, and control.', pillClass: 'border-emerald-400/35 bg-emerald-500/[0.13] text-emerald-100 hover:bg-emerald-500/[0.18]', accentClass: 'text-emerald-300', selectedMenuClass: 'bg-emerald-500/[0.09]', icon: Lock },
    { mode: 'auto-review', label: 'Auto review', shortLabel: 'Auto', pillWidth: '68px', description: 'Review automatically; ask when risk is unclear.', pillClass: 'border-sky-400/35 bg-sky-500/[0.13] text-sky-100 hover:bg-sky-500/[0.18]', accentClass: 'text-sky-300', selectedMenuClass: 'bg-sky-500/[0.09]', icon: ShieldCheck },
    { mode: 'edits-only', label: 'Edits only', shortLabel: 'Edits', pillWidth: '72px', description: 'Allow project edits; ask for commands and control.', pillClass: 'border-amber-400/35 bg-amber-500/[0.13] text-amber-100 hover:bg-amber-500/[0.18]', accentClass: 'text-amber-300', selectedMenuClass: 'bg-amber-500/[0.09]', icon: FilePenLine },
    { mode: 'full-access', label: 'Full access', shortLabel: 'Full', pillWidth: '64px', description: 'Run routine work; ask only for critical actions.', pillClass: 'border-rose-400/35 bg-rose-500/[0.13] text-rose-100 hover:bg-rose-500/[0.18]', accentClass: 'text-rose-300', selectedMenuClass: 'bg-rose-500/[0.09]', icon: LockOpen }
]

export const ComposerAttachmentsShelf = memo(function ComposerAttachmentsShelf({
    contextFiles,
    compact,
    removingAttachmentIds,
    onOpenAttachmentPreview,
    onPreview,
    onRemove
}: {
    contextFiles: ComposerContextFile[]
    compact: boolean
    removingAttachmentIds: string[]
    onOpenAttachmentPreview?: (
        file: { name: string; path: string },
        ext: string,
        options?: PreviewOpenOptions
    ) => Promise<void> | void
    onPreview: (file: ComposerContextFile) => void
    onRemove: (id: string) => void
}) {
    const shelfRef = useRef<HTMLDivElement | null>(null)
    const previousRectsRef = useRef(new Map<string, DOMRect>())
    const runningAnimationsRef = useRef(new Map<string, Animation>())
    const attachmentLayoutKey = contextFiles.map((file) => file.id).join('\u0000')
    const handleAttachmentShelfWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
        const element = event.currentTarget
        const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight)
        if (maxScrollTop <= 0 || event.deltaY === 0) return
        const canScrollShelf = event.deltaY < 0
            ? element.scrollTop > 1
            : maxScrollTop - element.scrollTop > 1
        if (canScrollShelf) event.stopPropagation()
    }

    useLayoutEffect(() => {
        const shelf = shelfRef.current
        if (!shelf) {
            previousRectsRef.current.clear()
            return
        }

        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
        const nextRects = new Map<string, DOMRect>()
        const elements = shelf.querySelectorAll<HTMLElement>('[data-composer-attachment-layout-id]')

        for (const element of elements) {
            const id = element.dataset.composerAttachmentLayoutId
            if (!id) continue

            const previousRect = previousRectsRef.current.get(id)
            const runningAnimation = runningAnimationsRef.current.get(id)
            const transformedRect = runningAnimation ? element.getBoundingClientRect() : null
            runningAnimation?.cancel()
            runningAnimationsRef.current.delete(id)

            const nextRect = element.getBoundingClientRect()
            nextRects.set(id, nextRect)
            if (!previousRect || reduceMotion) continue

            const carriedX = transformedRect ? transformedRect.left - nextRect.left : 0
            const carriedY = transformedRect ? transformedRect.top - nextRect.top : 0
            const deltaX = previousRect.left + carriedX - nextRect.left
            const deltaY = previousRect.top + carriedY - nextRect.top
            if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) continue

            const animation = element.animate([
                { transform: `translate3d(${deltaX}px, ${deltaY}px, 0)` },
                { transform: 'translate3d(0, 0, 0)' }
            ], {
                duration: 240,
                easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
            })
            runningAnimationsRef.current.set(id, animation)
            animation.addEventListener('finish', () => {
                if (runningAnimationsRef.current.get(id) === animation) runningAnimationsRef.current.delete(id)
            }, { once: true })
        }

        previousRectsRef.current = nextRects
    }, [attachmentLayoutKey])

    useEffect(() => () => {
        for (const animation of runningAnimationsRef.current.values()) animation.cancel()
        runningAnimationsRef.current.clear()
        previousRectsRef.current.clear()
    }, [])

    return (
    <AnimatedHeight isOpen={contextFiles.length > 0} duration={220}>
        <div
            ref={shelfRef}
            onWheel={handleAttachmentShelfWheel}
            className={cn(
                'custom-scrollbar pointer-events-auto flex max-h-[206px] flex-wrap items-start overflow-y-auto overscroll-contain pr-1',
                compact ? 'gap-1.5 pb-1' : 'gap-2 pb-1.5'
            )}
        >
            {contextFiles.map((file) => {
                const meta = getContextFileMeta(file)
                const contentType = getContentTypeTag(file)
                const isRemoving = removingAttachmentIds.includes(file.id)
                const isEntering = Boolean(file.animateIn)
                const browserAnnotation = parseAssistantBrowserAnnotation(file.content)
                const isImageAttachment = meta.category === 'image' && Boolean(file.previewDataUrl)
                const isPastedText = isPastedTextAttachment(file)
                const cardWidthClass = isPastedText ? 'w-[92px]' : 'w-[116px]'
                const handleOpenImagePreview = () => {
                    if (onOpenAttachmentPreview) {
                        void onOpenAttachmentPreview({ name: meta.name, path: file.path }, meta.ext)
                        return
                    }
                    onPreview(file)
                }
                const handleOpenPastedTextPreview = () => {
                    onPreview(file)
                }

                return (
                    <div
                        key={file.id}
                        data-composer-attachment-layout-id={file.id}
                        className="shrink-0 will-change-transform"
                    >
                        {browserAnnotation && file.previewDataUrl ? (
                            <AssistantBrowserAnnotationCard
                                annotation={browserAnnotation}
                                previewDataUrl={file.previewDataUrl}
                                onOpen={() => onPreview(file)}
                                onRemove={() => onRemove(file.id)}
                                removing={isRemoving || isEntering}
                            />
                        ) : isImageAttachment ? (
                            <AssistantAttachmentImageCard
                                name={meta.name}
                                src={file.previewDataUrl || ''}
                                widthClassName={cardWidthClass}
                                heightClassName="h-[84px]"
                                onClick={handleOpenImagePreview}
                                onRemove={() => onRemove(file.id)}
                                removable
                                removing={isRemoving || isEntering}
                            />
                        ) : isPastedText ? (
                            <AssistantPastedTextCard
                                widthClassName={cardWidthClass}
                                onClick={handleOpenPastedTextPreview}
                                onRemove={() => onRemove(file.id)}
                                removable
                                removing={isRemoving || isEntering}
                                previewText={file.content || file.previewText}
                            />
                        ) : (
                            <AssistantFileAttachmentCard
                                widthClassName={cardWidthClass}
                                name={meta.name}
                                contentType={contentType}
                                category={meta.category}
                                pathLabel={file.path}
                                onClick={() => onPreview(file)}
                                onRemove={() => onRemove(file.id)}
                                removable
                                removing={isRemoving || isEntering}
                            />
                        )}
                    </div>
                )
            })}
        </div>
    </AnimatedHeight>
    )
})

export const ComposerMentionMenu = memo(({
    isOpen,
    mentionCanScrollUp,
    mentionCanScrollDown,
    mentionLoading,
    mentionCandidates,
    activeMentionIndex,
    mentionListRef,
    iconTheme,
    onScroll,
    onApplyMention
}: {
    isOpen: boolean
    mentionCanScrollUp: boolean
    mentionCanScrollDown: boolean
    mentionLoading: boolean
    mentionCandidates: MentionCandidate[]
    activeMentionIndex: number
    mentionListRef: RefObject<HTMLDivElement | null>
    iconTheme: 'light' | 'dark'
    onScroll: (element: HTMLDivElement) => void
    onApplyMention: (candidate: MentionCandidate) => void
}) => (
    <div className={cn('pointer-events-none absolute inset-x-0 bottom-full z-[170] mb-1 overflow-hidden', isOpen ? 'pointer-events-auto' : 'pointer-events-none')}>
        <AnimatedHeight isOpen={isOpen} duration={220}>
            <div className="overflow-hidden rounded-xl border border-white/10 bg-sparkle-card shadow-2xl shadow-black/70 backdrop-blur-xl">
                <div className="relative">
                    {mentionCanScrollUp ? <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex h-6 items-start justify-center before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-[150%] before:rounded-t-[10px] before:bg-gradient-to-b before:from-sparkle-card before:from-40% before:to-transparent"><ChevronUp size={11} className="relative mt-0.5 text-sparkle-text-muted/70" /></div> : null}
                    <div ref={mentionListRef} onScroll={(event) => onScroll(event.currentTarget)} className="max-h-56 overflow-y-auto px-1.5 pb-6 pt-6">
                        {mentionLoading ? (
                            <div className="flex items-center gap-2 px-2 py-3 text-[11px] text-sparkle-text-secondary"><Loader2 size={12} className="animate-spin" /><span>Indexing project files...</span></div>
                        ) : mentionCandidates.length === 0 ? (
                            <div className="px-2 py-3 text-[11px] text-sparkle-text-secondary">No matching files or folders.</div>
                        ) : mentionCandidates.map((candidate, index) => (
                            <button key={candidate.path} type="button" data-mention-index={index} onClick={() => onApplyMention(candidate)} className={cn('flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors', index === activeMentionIndex ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]')}>
                                <FileEntryIcon pathValue={candidate.relativePath || candidate.name} kind={candidate.type} theme={iconTheme} className="shrink-0" />
                                <div className="min-w-0 flex-1 truncate"><span className="text-[13px] font-semibold text-sparkle-text">{candidate.name}</span><span className="ml-2 font-mono text-[11px] text-white/[0.12]">{candidate.relativePath}</span></div>
                            </button>
                        ))}
                    </div>
                    {mentionCanScrollDown ? <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex h-6 items-end justify-center before:pointer-events-none before:absolute before:inset-x-0 before:bottom-0 before:h-[150%] before:rounded-b-[10px] before:bg-gradient-to-t before:from-sparkle-card before:from-40% before:to-transparent"><ChevronDown size={11} className="relative mb-0.5 text-sparkle-text-muted/70" /></div> : null}
                </div>
            </div>
        </AnimatedHeight>
    </div>
))

export const ComposerSendButton = memo(({
    disabled,
    isConnected,
    isThinking,
    canSend,
    label = 'Send',
    reconnectPending = false,
    onStop,
    onReconnect,
    onSend
}: {
    disabled: boolean
    isConnected: boolean
    isThinking: boolean
    canSend: boolean
    label?: string
    reconnectPending?: boolean
    onStop?: () => Promise<void> | void
    onReconnect?: () => Promise<void> | void
    onSend: () => void
}) => {
    const canStop = isThinking && Boolean(onStop) && isConnected && !disabled
    const canReconnect = !isConnected && Boolean(onReconnect)
    const isEmptyState = !canStop && !disabled && isConnected && !canSend
    const isDisabled = canStop || canReconnect ? false : disabled || !isConnected || !canSend

    return (
        <button
            type="button"
            disabled={isDisabled}
            onClick={() => {
                if (canStop) {
                    void onStop?.()
                    return
                }
                if (canReconnect) {
                    void onReconnect?.()
                    return
                }
                onSend()
            }}
            title={canReconnect ? 'Reconnect assistant' : undefined}
            className={cn(
                'relative inline-flex h-[36px] items-center justify-center overflow-hidden rounded-full border transition-all duration-150',
                label === 'Send' || canReconnect ? 'w-[36px]' : 'gap-1.5 px-3.5',
                canStop
                    ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--accent-contrast)] hover:scale-[1.03] hover:bg-[color-mix(in_srgb,var(--accent-primary)_88%,var(--color-text))]'
                    : canReconnect
                        ? 'border-white/10 bg-white/[0.045] text-sparkle-text-secondary hover:scale-[1.03] hover:border-white/20 hover:bg-white/[0.075] hover:text-sparkle-text'
                    : isEmptyState
                        ? 'border-transparent bg-white/[0.02] text-sparkle-text-muted/80 hover:border-transparent hover:bg-white/[0.03]'
                        : isDisabled
                        ? 'border-transparent bg-white/[0.015] text-sparkle-text-muted/45 opacity-70'
                        : 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--accent-contrast)] hover:scale-[1.03] hover:bg-[color-mix(in_srgb,var(--accent-primary)_88%,var(--color-text))]'
            )}
        >
            {canStop ? <span className="absolute inset-0 animate-shimmer opacity-60" aria-hidden="true" /> : null}
            <span className="relative z-10 inline-flex items-center justify-center gap-1.5">
                {canStop ? (
                    <Square size={15} fill="currentColor" />
                ) : canReconnect ? (
                    reconnectPending ? <Loader2 size={17} className="animate-spin" /> : <RotateCw size={17} />
                ) : label === 'Send' ? (
                    <SendHorizontal size={18} className={isEmptyState ? 'opacity-35' : undefined} />
                ) : (
                    <>
                        <Check size={16} />
                        <span className="text-[12px] font-semibold">{label}</span>
                    </>
                )}
            </span>
        </button>
    )
})

export const ComposerRealtimeVoiceButton = memo(({ onStart }: { onStart: () => void }) => (
    <button
        type="button"
        onClick={onStart}
        className="relative inline-flex h-[36px] w-[36px] items-center justify-center overflow-hidden rounded-full border border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--accent-contrast)] transition-all duration-150 hover:scale-[1.03] hover:bg-[color-mix(in_srgb,var(--accent-primary)_88%,var(--color-text))]"
        title="Start Voice in this chat"
        aria-label="Start Voice in this chat"
    >
        <AudioLines size={18} />
    </button>
))

export const ComposerVoiceButton = memo(({
    supported,
    isStarting,
    isRecording,
    disabled,
    onToggle
}: {
    supported: boolean
    isStarting: boolean
    isRecording: boolean
    disabled: boolean
    onToggle: () => void
}) => {
    if (!supported) return null

    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onToggle}
            className={cn(
                'relative inline-flex h-[36px] w-[36px] items-center justify-center overflow-visible rounded-full border transition-all duration-150',
                isRecording
                    ? 'border-transparent bg-rose-500 text-white hover:scale-[1.03] hover:bg-rose-400'
                    : disabled
                        ? 'border-transparent bg-white/[0.02] text-sparkle-text-muted/45'
                        : 'border-transparent bg-white/[0.03] text-sparkle-text-secondary hover:bg-white/[0.06] hover:text-sparkle-text'
            )}
            title={isStarting ? 'Opening microphone' : isRecording ? 'Stop recording' : 'Start voice input'}
        >
            {isStarting ? (
                <Loader2 size={16} className="animate-spin motion-reduce:animate-none" />
            ) : isRecording ? (
                <>
                    <span className="pointer-events-none absolute inset-0 rounded-full border border-rose-300/28 animate-subtle-recording-ripple" aria-hidden="true" />
                    <span className="pointer-events-none absolute inset-0 rounded-full border border-rose-300/16 animate-subtle-recording-ripple-delayed" aria-hidden="true" />
                    <Square size={14} fill="currentColor" className="relative z-10" />
                </>
            ) : (
                <Mic size={17} className="relative z-10" />
            )}
        </button>
    )
})

export const ComposerFooterControls = memo(function ComposerFooterControls({
    isCompactFooter,
    forceSingleRow = false,
    placement = 'bottom',
    controlsLocked = false,
    modelDropdownRef,
    setShowModelDropdown,
    modelsLoading,
    modelsError,
    modelQuery,
    setModelQuery,
    setActiveModelIndex,
    modelListRef,
    filteredModelOptions,
    activeModelIndex,
    selectedModel,
    selectedModelLabel,
    latestModelId,
    setSelectedModel,
    onRefreshModels,
    traitsDropdownRef,
    showTraitsDropdown,
    setShowTraitsDropdown,
    EFFORT_OPTIONS,
    selectedEffort,
    setSelectedEffort,
    EFFORT_LABELS,
    fastModeEnabled,
    setFastModeEnabled,
    selectedRuntimeMode,
    setSelectedRuntimeMode,
    isConnected = true,
    isConnecting = false,
    reconnectPending = false,
    onReconnect,
}: {
    isCompactFooter: boolean
    forceSingleRow?: boolean
    placement?: 'bottom' | 'center'
    controlsLocked?: boolean
    modelDropdownRef: RefObject<HTMLDivElement | null>
    showModelDropdown: boolean
    setShowModelDropdown: Dispatch<SetStateAction<boolean>>
    modelsLoading: boolean
    modelsError: string | null
    modelQuery: string
    setModelQuery: Dispatch<SetStateAction<string>>
    setActiveModelIndex: Dispatch<SetStateAction<number>>
    modelListRef: RefObject<HTMLDivElement | null>
    filteredModelOptions: Array<{ id: string; label: string; description?: string }>
    activeModelIndex: number
    selectedModel: string
    selectedModelLabel: string
    latestModelId: string | null
    setSelectedModel: Dispatch<SetStateAction<string>>
    onRefreshModels?: () => void
    traitsDropdownRef: RefObject<HTMLDivElement | null>
    showTraitsDropdown: boolean
    setShowTraitsDropdown: Dispatch<SetStateAction<boolean>>
    EFFORT_OPTIONS: string[]
    selectedEffort: string
    setSelectedEffort: Dispatch<SetStateAction<any>>
    EFFORT_LABELS: Record<string, string>
    fastModeEnabled: boolean
    setFastModeEnabled: Dispatch<SetStateAction<boolean>>
    selectedInteractionMode: string
    setSelectedInteractionMode: Dispatch<SetStateAction<any>>
    selectedRuntimeMode: AssistantRuntimeMode
    setSelectedRuntimeMode: Dispatch<SetStateAction<AssistantRuntimeMode>>
    displayedProfile: string
    zyraProfile?: 'default' | 'builder'
    onZyraProfileChange?: (profile: 'default' | 'builder') => void
    isConnected?: boolean
    isConnecting?: boolean
    reconnectPending?: boolean
    onReconnect?: () => Promise<void> | void
}) {
    const [activeSubmenu, setActiveSubmenu] = useState<'model' | 'speed' | null>(null)
    const [showAccessMenu, setShowAccessMenu] = useState(false)
    const [submenuLeft, setSubmenuLeft] = useState({ model: 234, speed: 234 })
    const submenuCloseTimerRef = useRef<number | null>(null)
    const submenuContainerRef = useRef<HTMLDivElement | null>(null)
    const accessMenuRef = useRef<HTMLDivElement | null>(null)
    const selectedModelText = formatAssistantModelLabel(selectedModelLabel)
    const selectedEffortText = EFFORT_LABELS[selectedEffort] || selectedEffort
    const selectedEffortTone = getEffortTone(selectedEffort)
    const selectedEffortIndex = Math.max(0, EFFORT_OPTIONS.indexOf(selectedEffort))
    const effortSliderMax = Math.max(0, EFFORT_OPTIONS.length - 1)
    const effortSliderPercent = effortSliderMax > 0 ? (selectedEffortIndex / effortSliderMax) * 100 : 0
    const effortSliderTicks = buildEffortSliderTicks(EFFORT_OPTIONS.length)
    const effortSliderColor = selectedEffort === 'off' || selectedEffort === 'none'
        ? 'var(--color-text-dark)'
        : 'var(--accent-primary)'
    const traitsMenuOpensDown = placement === 'center'
    const selectedAccess = ASSISTANT_ACCESS_OPTIONS.find((option) => option.mode === selectedRuntimeMode) || ASSISTANT_ACCESS_OPTIONS[0]
    const SelectedAccessIcon = selectedAccess.icon

    const menuPanelClass = 'overflow-hidden rounded-xl border border-[color-mix(in_srgb,var(--color-text)_16%,transparent)] bg-[var(--surface-floating)] p-1.5 text-[13px] text-sparkle-text shadow-[0_18px_48px_rgba(0,0,0,0.22),inset_0_1px_0_color-mix(in_srgb,var(--color-text)_5%,transparent)] backdrop-blur-xl'
    const menuRouteClass = 'group flex h-[36px] w-full items-center gap-3 rounded-lg px-2.5 text-left transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]'
    const menuOptionClass = 'flex w-full items-center gap-2 rounded-lg px-2.5 text-left transition-colors hover:bg-[var(--surface-hover)] hover:text-sparkle-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]'
    const modelSubmenuPositionClass = traitsMenuOpensDown
        ? 'absolute top-[76px] w-[252px] max-w-[calc(100vw-32px)]'
        : 'absolute bottom-0 w-[252px] max-w-[calc(100vw-32px)]'
    const speedSubmenuPositionClass = traitsMenuOpensDown
        ? 'absolute top-[106px] w-[216px] max-w-[calc(100vw-32px)]'
        : 'absolute bottom-0 w-[216px] max-w-[calc(100vw-32px)]'
    const submenuMotionClass = 'transition-opacity duration-[120ms] ease-out'
    const connectionPillState = isConnected || reconnectPending || isConnecting
        ? null
        : {
            label: 'Disconnected',
            title: 'Reconnect chat',
            className: 'border-amber-400/25 bg-amber-500/[0.10] text-amber-100 hover:bg-amber-500/[0.14]',
            spinning: false
        }

    const cancelSubmenuClose = () => {
        if (submenuCloseTimerRef.current !== null) {
            window.clearTimeout(submenuCloseTimerRef.current)
            submenuCloseTimerRef.current = null
        }
    }
    const openSubmenu = (submenu: 'model' | 'speed') => {
        cancelSubmenuClose()
        setActiveSubmenu(submenu)
    }
    const scheduleSubmenuClose = () => {
        cancelSubmenuClose()
        submenuCloseTimerRef.current = window.setTimeout(() => {
            submenuCloseTimerRef.current = null
            setActiveSubmenu(null)
        }, 90)
    }
    const getSubmenuVisibilityClass = (submenu: 'model' | 'speed') => activeSubmenu === submenu
        ? 'pointer-events-auto opacity-100'
        : 'pointer-events-none opacity-0'
    const showModelRefreshState = modelsLoading

    const toggleTraitsDropdown = () => {
        if (controlsLocked) return
        const next = !showTraitsDropdown
        setShowTraitsDropdown(next)
        setShowModelDropdown(false)
        if (!next) return
        setActiveSubmenu(null)
        onRefreshModels?.()
    }

    useEffect(() => {
        if (!showTraitsDropdown) setActiveSubmenu(null)
    }, [showTraitsDropdown])

    useEffect(() => {
        if (!showAccessMenu) return
        const closeOnPointerDown = (event: PointerEvent) => {
            if (!accessMenuRef.current?.contains(event.target as Node)) setShowAccessMenu(false)
        }
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setShowAccessMenu(false)
        }
        window.addEventListener('pointerdown', closeOnPointerDown)
        window.addEventListener('keydown', closeOnEscape)
        return () => {
            window.removeEventListener('pointerdown', closeOnPointerDown)
            window.removeEventListener('keydown', closeOnEscape)
        }
    }, [showAccessMenu])

    useLayoutEffect(() => {
        if (!showTraitsDropdown) return
        const container = submenuContainerRef.current
        if (!container) return
        const boundary = container.closest('.assistant-conversation-pane')

        const updateSubmenuPlacement = () => {
            const containerRect = container.getBoundingClientRect()
            const boundaryRect = boundary?.getBoundingClientRect() ?? {
                left: 0,
                right: window.innerWidth
            }
            const resolveLeft = (submenuWidth: number) => {
                const gutter = 8
                const preferredLeft = 234
                const minLeft = boundaryRect.left - containerRect.left + gutter
                const maxLeft = boundaryRect.right - containerRect.left - submenuWidth - gutter
                return Math.round(maxLeft < minLeft ? minLeft : Math.max(minLeft, Math.min(preferredLeft, maxLeft)))
            }
            const next = {
                model: resolveLeft(Math.min(252, window.innerWidth - 32)),
                speed: resolveLeft(Math.min(216, window.innerWidth - 32))
            }
            setSubmenuLeft((current) => current.model === next.model && current.speed === next.speed ? current : next)
        }

        updateSubmenuPlacement()
        window.addEventListener('resize', updateSubmenuPlacement)
        const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateSubmenuPlacement)
        resizeObserver?.observe(container)
        if (boundary) resizeObserver?.observe(boundary)
        return () => {
            window.removeEventListener('resize', updateSubmenuPlacement)
            resizeObserver?.disconnect()
        }
    }, [showTraitsDropdown])

    useEffect(() => () => {
        cancelSubmenuClose()
    }, [])

    return (
        <div className={cn('flex min-w-0 flex-1 flex-nowrap items-center justify-start text-[14px]', forceSingleRow ? 'gap-1' : 'gap-1.5 max-[520px]:gap-1', isCompactFooter ? 'overflow-visible' : 'overflow-visible')}>
            <div className="relative min-w-0 flex-[1_1_0%] max-w-full" ref={traitsDropdownRef}>
                <div
                    className={cn(
                        traitsMenuOpensDown ? 'absolute left-0 top-[36px] z-[170]' : 'absolute bottom-[36px] left-0 z-[170]',
                        'transition-opacity duration-[120ms] ease-out',
                        showTraitsDropdown ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
                    )}
                >
                    {showTraitsDropdown ? (
                        <div ref={submenuContainerRef} className="relative">
                            <div className={cn('w-[236px]', menuPanelClass)}>
                                <div className="px-2.5 pb-2 pt-1.5">
                                    <div className="relative py-1">
                                        <input
                                            type="range"
                                            min={0}
                                            max={effortSliderMax}
                                            step={1}
                                            value={selectedEffortIndex}
                                            onChange={(event) => setSelectedEffort(EFFORT_OPTIONS[Number(event.currentTarget.value)] || selectedEffort)}
                                            className="zyra-effort-slider relative h-6 w-full cursor-pointer"
                                            style={{
                                                ['--zyra-effort-color' as string]: effortSliderColor,
                                                ['--zyra-effort-progress' as string]: `${effortSliderPercent}%`,
                                                ['--zyra-effort-ticks' as string]: effortSliderTicks
                                            }}
                                            aria-label="Reasoning effort"
                                            aria-valuetext={`${selectedEffortText} reasoning`}
                                        />
                                    </div>
                                    <div className="mt-1 flex items-center justify-between text-[9px] font-medium leading-none text-sparkle-text-dark">
                                        <span>Faster</span>
                                        <span>Smarter</span>
                                    </div>
                                </div>
                                <div className="border-t border-[var(--surface-divider)] pt-1">
                                    <button
                                        type="button"
                                        onMouseEnter={() => openSubmenu('model')}
                                        onMouseLeave={scheduleSubmenuClose}
                                        onFocus={() => openSubmenu('model')}
                                        className={cn(menuRouteClass, activeSubmenu === 'model' && 'bg-[var(--surface-active)] text-sparkle-text')}
                                    >
                                        <span className="min-w-0 flex-1 truncate font-medium text-sparkle-text">Model</span>
                                        <span className="inline-flex min-w-0 shrink-0 items-center gap-1">
                                            <span className={cn('max-w-[128px] truncate text-right font-medium text-sparkle-text-dark', showModelRefreshState && 'assistant-model-name-shimmer')} aria-label={showModelRefreshState ? `Refreshing models; current model ${selectedModelText || 'not selected'}` : undefined}>{selectedModelText || 'Select'}</span>
                                            <ChevronDown size={14} className="shrink-0 -rotate-90 text-sparkle-text-muted transition-colors group-hover:text-sparkle-text-secondary" />
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        onMouseEnter={() => openSubmenu('speed')}
                                        onMouseLeave={scheduleSubmenuClose}
                                        onFocus={() => openSubmenu('speed')}
                                        className={cn(menuRouteClass, activeSubmenu === 'speed' && 'bg-[var(--surface-active)] text-sparkle-text')}
                                    >
                                        <span className="min-w-0 flex-1 truncate font-medium text-sparkle-text">Speed</span>
                                        <span className="inline-flex min-w-0 shrink-0 items-center gap-1">
                                            <span className={cn('truncate text-right font-medium text-sparkle-text-dark', fastModeEnabled && 'text-sparkle-text')}>{fastModeEnabled ? 'Fast' : 'Standard'}</span>
                                            <ChevronDown size={14} className="shrink-0 -rotate-90 text-sparkle-text-muted transition-colors group-hover:text-sparkle-text-secondary" />
                                        </span>
                                    </button>
                                </div>
                                {modelsError ? <p className="px-3 py-1 text-[12px] font-medium text-rose-300">{modelsError}</p> : null}
                            </div>

                            <div
                                ref={modelDropdownRef}
                                onMouseEnter={() => openSubmenu('model')}
                                onMouseLeave={scheduleSubmenuClose}
                                className={cn(modelSubmenuPositionClass, menuPanelClass, submenuMotionClass, getSubmenuVisibilityClass('model'))}
                                style={{ left: submenuLeft.model }}
                            >
                                    <div className="px-2.5 py-1.5 text-[12px] font-medium text-sparkle-text-dark">Models</div>
                                    <div
                                        ref={modelListRef}
                                        className="assistant-chat-scrollbar relative max-h-[min(196px,calc(100vh-136px))] overflow-y-auto"
                                    >
                                        {filteredModelOptions.length === 0 ? (
                                            <div className="px-2.5 py-2.5 text-[12px] text-sparkle-text-dark">No models found.</div>
                                        ) : filteredModelOptions.map((model, index) => {
                                            const isActive = model.id === selectedModel
                                            const isHighlighted = index === activeModelIndex
                                            const isLatest = isLatestModel(model, latestModelId)
                                            return (
                                                <button
                                                    key={model.id}
                                                    type="button"
                                                    data-model-index={index}
                                                    onClick={() => {
                                                        setSelectedModel(model.id)
                                                        setShowModelDropdown(false)
                                                        openSubmenu('model')
                                                    }}
                                                    className={cn(
                                                        menuOptionClass,
                                                        'h-[32px] text-[12px]',
                                                        isActive || isHighlighted ? 'bg-[var(--surface-active)] text-sparkle-text' : 'text-sparkle-text-dark'
                                                    )}
                                                >
                                                    <span className="min-w-0 flex-1 truncate">{formatAssistantModelLabel(model.label || model.id)}</span>
                                                    {isLatest ? <span className="rounded-md bg-emerald-400/12 px-1.5 py-0.5 text-[10px] font-medium text-emerald-200">Latest</span> : null}
                                                    {isActive ? <Check size={16} className="text-sparkle-text-secondary" /> : null}
                                                </button>
                                            )
                                        })}
                                    </div>
                            </div>

                            <div
                                onMouseEnter={() => openSubmenu('speed')}
                                onMouseLeave={scheduleSubmenuClose}
                                className={cn(speedSubmenuPositionClass, menuPanelClass, submenuMotionClass, getSubmenuVisibilityClass('speed'))}
                                style={{ left: submenuLeft.speed }}
                            >
                                    <div className="px-2.5 py-1.5 text-[12px] font-medium text-sparkle-text-dark">Speed</div>
                                    {[true, false].map((fast) => (
                                        <button
                                            key={String(fast)}
                                            type="button"
                                            onClick={() => {
                                                setFastModeEnabled(fast)
                                                openSubmenu('speed')
                                            }}
                                            className={cn(menuOptionClass, 'h-[32px]', fastModeEnabled === fast ? 'bg-[var(--surface-active)] text-sparkle-text' : 'text-sparkle-text-dark')}
                                        >
                                            <span className="inline-flex min-w-0 flex-1 items-center gap-1.5">
                                                {fast
                                                    ? <Zap size={13} className="shrink-0 text-amber-200" strokeWidth={2.6} />
                                                    : <Gauge size={13} className="shrink-0 text-sparkle-text-muted" strokeWidth={2.2} />}
                                                <span className="truncate">{fast ? 'Fast' : 'Standard'}</span>
                                            </span>
                                            {fastModeEnabled === fast ? <Check size={17} className="text-sparkle-text-secondary" /> : null}
                                        </button>
                                    ))}
                            </div>
                        </div>
                    ) : null}
                </div>
                <button
                    type="button"
                    disabled={controlsLocked}
                    onClick={toggleTraitsDropdown}
                    className={cn(
                        'relative inline-flex h-7 w-fit min-w-0 max-w-full items-center overflow-hidden whitespace-nowrap rounded-md px-1 text-[12px] font-medium text-sparkle-text-secondary transition-colors hover:text-sparkle-text sm:px-1.5',
                        controlsLocked && 'cursor-not-allowed opacity-45 hover:text-sparkle-text-secondary'
                    )}
                    title={showModelRefreshState ? 'Refreshing controls...' : 'Model, thinking, and speed'}
                >
                    <span
                        className={cn(
                            'pointer-events-none absolute left-1 top-1/2 inline-flex -translate-y-1/2 items-center justify-center text-amber-200 transition-opacity duration-150 sm:left-1.5',
                            fastModeEnabled ? 'opacity-100' : 'opacity-0'
                        )}
                        aria-hidden="true"
                    >
                        <Zap size={13} strokeWidth={2.6} />
                    </span>
                    <span
                        className={cn(
                            'assistant-composer-footer-model-summary inline-flex min-w-0 max-w-full items-center gap-1.5 transition-[transform,gap] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]',
                            fastModeEnabled && 'translate-x-[18px]'
                        )}
                    >
                        <span className={cn('assistant-composer-footer-model-label min-w-0 truncate rounded px-0.5', showModelRefreshState && 'assistant-model-name-shimmer')} aria-label={showModelRefreshState ? `Refreshing models; current model ${selectedModelText || 'not selected'}` : undefined}>{selectedModelText}</span>
                        <span className={cn('shrink-0', selectedEffortTone.textClass)}>{selectedEffortText}</span>
                        <ChevronDown size={12} className="-mr-0.5 ml-0.5 shrink-0 text-sparkle-text-muted" />
                    </span>
                </button>
            </div>
            <div ref={accessMenuRef} className="relative shrink-0">
                {showAccessMenu ? (
                    <div
                        role="menu"
                        aria-label="Permission mode"
                        className={cn(
                            'absolute right-0 z-[180] w-[226px] overflow-hidden rounded-xl border border-[color-mix(in_srgb,var(--color-text)_16%,transparent)] bg-[var(--surface-floating)] p-1.5 text-[12px] text-sparkle-text shadow-[0_18px_48px_rgba(0,0,0,0.24)] backdrop-blur-xl animate-in fade-in duration-150',
                            traitsMenuOpensDown ? 'top-[36px] slide-in-from-top-1' : 'bottom-[36px] slide-in-from-bottom-1'
                        )}
                    >
                        {ASSISTANT_ACCESS_OPTIONS.map((option) => {
                            const Icon = option.icon
                            const selected = option.mode === selectedRuntimeMode
                            return (
                                <button
                                    key={option.mode}
                                    type="button"
                                    role="menuitemradio"
                                    aria-checked={selected}
                                    onClick={() => {
                                        setShowAccessMenu(false)
                                        setSelectedRuntimeMode(option.mode)
                                    }}
                                    className={cn(
                                        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]',
                                        selected && option.selectedMenuClass
                                    )}
                                >
                                    <Icon size={14} className={cn('shrink-0', option.accentClass)} />
                                    <span className="min-w-0 flex-1">
                                        <span className="block font-medium text-sparkle-text">{option.label}</span>
                                        <span className="block truncate text-[10px] text-sparkle-text-dark">{option.description}</span>
                                    </span>
                                    {selected ? <Check size={14} className={cn('shrink-0', option.accentClass)} /> : null}
                                </button>
                            )
                        })}
                    </div>
                ) : null}
                <button
                    type="button"
                    disabled={controlsLocked}
                    aria-haspopup="menu"
                    aria-expanded={showAccessMenu}
                    onClick={() => setShowAccessMenu((open) => !open)}
                    aria-label={`${selectedAccess.label} permission mode`}
                    style={{ '--assistant-access-expanded-width': selectedAccess.pillWidth } as CSSProperties}
                    className={cn(
                        'assistant-composer-footer-access-control inline-flex h-7 shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-full border px-2.5 text-[12px] font-medium transition-[width,height,padding,gap,color,background-color,border-color]',
                        selectedAccess.pillClass,
                        controlsLocked && 'cursor-not-allowed opacity-45'
                    )}
                    title={selectedAccess.label}
                >
                    <SelectedAccessIcon className="assistant-composer-footer-access-icon" />
                    <span className="assistant-composer-footer-access-label">{selectedAccess.shortLabel}</span>
                </button>
            </div>
            {connectionPillState ? (
                <button
                    type="button"
                    disabled={connectionPillState.spinning || !onReconnect}
                    onClick={() => {
                        if (!connectionPillState.spinning) void onReconnect?.()
                    }}
                    className={cn(
                        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium transition-colors max-[520px]:w-7 max-[520px]:justify-center max-[520px]:px-0',
                        connectionPillState.className,
                        (connectionPillState.spinning || !onReconnect) && 'cursor-default'
                    )}
                    title={connectionPillState.title}
                >
                    {connectionPillState.spinning
                        ? <Loader2 size={12} className="animate-spin" />
                        : <RotateCw size={12} />}
                    <span className="max-[520px]:sr-only">{connectionPillState.label}</span>
                </button>
            ) : null}
        </div>
    )
})

export const ComposerStatusBar = memo(({
    isThinking,
    mentionLoading,
    modelsLoading,
    branchesLoading,
    thinkingLabel,
    fastModeEnabled,
    branchDropdownRef,
    showBranchDropdown,
    setShowBranchDropdown,
    isGitRepo,
    currentBranch,
    branchButtonLabel
}: {
    isThinking: boolean
    mentionLoading: boolean
    modelsLoading: boolean
    branchesLoading: boolean
    thinkingLabel: string
    fastModeEnabled: boolean
    branchDropdownRef: RefObject<HTMLDivElement | null>
    showBranchDropdown: boolean
    setShowBranchDropdown: Dispatch<SetStateAction<boolean>>
    isGitRepo: boolean
    currentBranch: string | null
    branchButtonLabel: string
}) => (
    <div className="flex items-center justify-between px-1 pt-2 text-[11px] font-medium text-sparkle-text-secondary">
        <div className="flex items-center gap-2">
            <span>Local</span>
            {(isThinking || mentionLoading || branchesLoading) ? (
                <span className="inline-flex items-center gap-1 text-[10px] text-sparkle-text-muted">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white/35" />
                    <span>{isThinking ? thinkingLabel : mentionLoading ? 'Indexing...' : 'Loading...'}</span>
                </span>
            ) : null}
        </div>

        <div className="relative" ref={branchDropdownRef}>
            <button type="button" onClick={() => setShowBranchDropdown((prev) => !prev)} className="inline-flex max-w-[220px] items-center gap-1.5 px-1 py-0.5 text-sparkle-text-secondary transition-colors hover:text-sparkle-text" title={isGitRepo ? (currentBranch || 'Current branch') : 'No git repository detected'}>
                {isGitRepo ? <GitBranch size={12} /> : null}
                <span className="truncate">{branchButtonLabel}</span>
                <ChevronDown size={11} className={cn('-mr-0.5 ml-0.5 opacity-60 transition-transform', showBranchDropdown && 'rotate-180')} />
            </button>
        </div>
    </div>
))
