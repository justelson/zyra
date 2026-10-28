import { useComposerDrawerMotion } from './useComposerDrawerMotion'
import { AssistantQuestionTransition as ComposerControlsTransition } from './AssistantQuestionTransition'
import { AnchoredNativeOverlay } from '@/components/ui/AnchoredNativeOverlay'
import { getOverlayOwnerRect } from '@/components/ui/native-overlay-events'
import { addOverlayEventListener, isOverlayEventInside } from '@/components/ui/native-overlay-portal'
import { memo, useCallback, useEffect, useContext, useLayoutEffect, useRef, useState, type CSSProperties, type Dispatch, type RefObject, type SetStateAction, type WheelEvent as ReactWheelEvent } from 'react'
import { AnimatedHeight } from '@/components/ui/AnimatedHeight'
import { FileEntryIcon } from '@/components/ui/FileEntryIcon'
import { cn } from '@/lib/utils'
import { AudioLines, Check, ChevronDown, ChevronUp, FilePenLine, GitBranch, Loader2, Lock, LockOpen, Mic, RotateCw, Search, ShieldCheck, Square, X, Zap } from 'lucide-react'
import { OpenAiLogo } from '@/components/ui/OpenAiLogo'
import { OpenCodeLogo } from '@/components/ui/OpenCodeLogo'
import type { AssistantRuntimeMode } from '@shared/assistant/contracts'
import type { PreviewOpenOptions } from '@/components/ui/file-preview/types'
import { formatAssistantModelLabel } from './assistant-model-labels'
import { groupAssistantModels, supportsAssistantFastMode } from './assistant-model-groups'
import { getContentTypeTag, getContextFileMeta, isPastedTextAttachment } from './assistant-composer-utils'
import { parseAssistantBrowserAnnotation } from './assistant-browser-annotation-composer'
import type { ComposerContextFile } from './assistant-composer-types'
import type { MentionCandidate } from './assistant-composer-mentions'
import { buildEffortSliderTicks } from './assistant-composer-controller-constants'
import { AssistantAttachmentPill, AssistantFileAttachmentCard, AssistantPastedTextCard } from './AssistantAttachmentCards'
import { AssistantAttachmentImageCard } from './AssistantAttachmentImageCard'
import { AssistantBrowserAnnotationCard } from './AssistantBrowserAnnotationCard'
import { AssistantComposerMenuSurface, ComposerMenuContext } from './AssistantComposerMenuSurface'
import { AssistantContextAttachment } from './AssistantContextAttachment'
import { AssistantCitationChip } from './AssistantCitationChip'

function getEffortTone(effort: string): { textClass: string } {
    return effort === 'off' || effort === 'none'
        ? { textClass: 'text-sparkle-text-dark' }
        : { textClass: 'text-sparkle-text' }
}

function isLatestModel(model: { id: string; label?: string }, latestModelId: string | null): boolean {
    return Boolean(latestModelId && model.id === latestModelId)
}

function isGptFamilyModel(model: { id: string; label?: string }): boolean {
    return /^gpt-/i.test(model.id.split('/').at(-1) || '') || /^gpt-/i.test(model.label || '')
}

function isOpenCodeHarnessModel(model: { id: string; description?: string }): boolean {
    return model.id.split('/')[0]?.toLowerCase() === 'opencode-harness'
        || /opencode harness/i.test(model.description || '')
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
    { mode: 'full-access', label: 'Full access', shortLabel: 'Full', pillWidth: '64px', description: 'Run tools without permission checks or approval prompts.', pillClass: 'border-rose-400/35 bg-rose-500/[0.13] text-rose-100 hover:bg-rose-500/[0.18]', accentClass: 'text-rose-300', selectedMenuClass: 'bg-rose-500/[0.09]', icon: LockOpen }
]

export const ComposerAttachmentsShelf = memo(function ComposerAttachmentsShelf({
    contextFiles,
    compact,
    removingAttachmentIds,
    presentation = 'compact',
    onOpenAttachmentPreview,
    onPreview,
    onRemove,
    onUpdate
}: {
    contextFiles: ComposerContextFile[]
    compact: boolean
    removingAttachmentIds: string[]
    presentation?: 'compact' | 'cards' | 'pills' | 'compact-pills'
    onOpenAttachmentPreview?: (
        file: { name: string; path: string },
        ext: string,
        options?: PreviewOpenOptions
    ) => Promise<void> | void
    onPreview: (file: ComposerContextFile) => void
    onRemove: (id: string) => void
    onUpdate?: (file: ComposerContextFile) => void
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
                presentation === 'cards' ? 'gap-3 pb-4' : presentation === 'pills' ? 'gap-2 pb-2' : compact ? 'gap-1.5 pb-1' : 'gap-2 pb-1.5'
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
                    if (presentation === 'cards') {
                        onPreview(file)
                        return
                    }
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
                        {file.citation ? (
                            <AssistantCitationChip file={file} removing={isRemoving || isEntering} onUpdate={onUpdate} onRemove={() => onRemove(file.id)} />
                        ) : presentation === 'compact-pills' ? (
                            <AssistantAttachmentPill
                                name={meta.name}
                                category={meta.category}
                                previewDataUrl={isImageAttachment ? file.previewDataUrl : undefined}
                                removing={isRemoving || isEntering}
                                onOpen={() => onPreview(file)}
                                onRemove={() => onRemove(file.id)}
                            />
                        ) : meta.category === 'video' && presentation === 'pills' ? (
                            <AssistantAttachmentPill name={meta.name} category="video" removing={isRemoving || isEntering} onOpen={() => onPreview(file)} onRemove={() => onRemove(file.id)} />
                        ) : presentation === 'pills' || file.selection ? (
                            <AssistantContextAttachment file={file} removing={isRemoving || isEntering} onOpen={() => onPreview(file)} onRemove={() => onRemove(file.id)} />
                        ) : browserAnnotation && file.previewDataUrl ? (
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
                                widthClassName={presentation === 'cards' ? 'w-[168px]' : cardWidthClass}
                                heightClassName={presentation === 'cards' ? 'h-[112px]' : 'h-[84px]'}
                                presentation={presentation === 'cards' ? 'card' : 'compact'}
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
}) => {
    const { below } = useContext(ComposerMenuContext)
    const { present, open: animatedOpen } = useComposerDrawerMotion(isOpen)
    if (!present) return null
    return <div className={cn('pointer-events-none absolute inset-x-0 z-30 overflow-hidden', below ? 'top-full -mt-[17px]' : 'bottom-full -mb-[17px]')}>
        <AnimatedHeight isOpen={animatedOpen} duration={220} contentClassName={`transition-[opacity,transform] duration-[220ms] ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none ${animatedOpen ? 'opacity-100 translate-y-0' : below ? 'opacity-0 -translate-y-3' : 'opacity-0 translate-y-3'}`}>
            <AssistantComposerMenuSurface title="Files & folders" detail={mentionLoading ? 'Searching…' : undefined}>
                <div className="relative">
                    {mentionCanScrollUp ? <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex h-6 items-start justify-center before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-[150%] before:rounded-t-[10px] before:bg-gradient-to-b before:from-sparkle-card before:from-40% before:to-transparent"><ChevronUp size={11} className="relative mt-0.5 text-sparkle-text-muted/70" /></div> : null}
                    <div ref={mentionListRef} role="listbox" aria-label="Files and folders" onScroll={(event) => onScroll(event.currentTarget)} className="custom-scrollbar max-h-[min(18rem,36vh)] scroll-py-2 overflow-y-auto p-2 [scrollbar-gutter:stable]">
                        {mentionLoading ? (
                            <div className="flex items-center gap-2 px-2 py-3 text-[11px] text-sparkle-text-secondary"><Loader2 size={12} className="animate-spin" /><span>Indexing project files...</span></div>
                        ) : mentionCandidates.length === 0 ? (
                            <div className="px-2 py-3 text-[11px] text-sparkle-text-secondary">No matching files or folders.</div>
                        ) : mentionCandidates.map((candidate, index) => (
                            <button key={candidate.path} type="button" role="option" aria-selected={index === activeMentionIndex} disabled={!isOpen} data-mention-index={index} onMouseDown={event => event.preventDefault()} onClick={() => onApplyMention(candidate)} className={cn('flex h-8 w-full items-center gap-3 rounded-lg px-3 text-left transition-colors', index === activeMentionIndex ? 'bg-[color-mix(in_srgb,var(--accent-primary)_18%,transparent)]' : 'hover:bg-white/[0.045]')}>
                                <FileEntryIcon pathValue={candidate.relativePath || candidate.name} kind={candidate.type} theme={iconTheme} size={16} className="shrink-0" />
                                <span className="min-w-0 max-w-[45%] shrink-0 truncate text-xs font-medium text-sparkle-text" title={candidate.name}>{candidate.name}</span>
                                <span className="min-w-0 flex-1 truncate text-xs text-sparkle-text-muted/70" title={candidate.relativePath}>{candidate.relativePath.replace(/[\\/]?[^\\/]+$/, '') || 'Project root'}</span>
                            </button>
                        ))}
                    </div>
                    {mentionCanScrollDown ? <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex h-6 items-end justify-center before:pointer-events-none before:absolute before:inset-x-0 before:bottom-0 before:h-[150%] before:rounded-b-[10px] before:bg-gradient-to-t before:from-sparkle-card before:from-40% before:to-transparent"><ChevronDown size={11} className="relative mb-0.5 text-sparkle-text-muted/70" /></div> : null}
                </div>
            </AssistantComposerMenuSurface>
        </AnimatedHeight>
    </div>
})

export { ComposerSendButton } from './ComposerSendButton'

export const ComposerRealtimeVoiceButton = memo(({ onStart, onPrepare }: { onStart: () => void; onPrepare?: () => void }) => (
    <button
        type="button"
        onClick={onStart}
        onPointerEnter={onPrepare}
        onFocus={onPrepare}
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
    zyraProfile?: 'concise' | 'friendly' | 'direct' | 'thoughtful' | 'playful'
    onZyraProfileChange?: (profile: 'concise' | 'friendly' | 'direct' | 'thoughtful' | 'playful') => void
    isConnected?: boolean
    isConnecting?: boolean
    reconnectPending?: boolean
    onReconnect?: () => Promise<void> | void
}) {
    const [activeSubmenu, setActiveSubmenu] = useState<'model' | null>(null)
    const controlsMotion = useComposerDrawerMotion(showTraitsDropdown, 180)
    const [controlsReady, setControlsReady] = useState(false)
    const handleControlsReady = useCallback(() => setControlsReady(true), [])
    const controlsVisible = showTraitsDropdown && controlsMotion.open && controlsReady
    const [showAccessMenu, setShowAccessMenu] = useState(false)
    const [modelSearchOpen, setModelSearchOpen] = useState(false)
    const [expandedModelGroup, setExpandedModelGroup] = useState<string | null>(null)
    const modelSearchInputRef = useRef<HTMLInputElement | null>(null)
    const modelRouteRef = useRef<HTMLButtonElement | null>(null)
    const accessMenuRef = useRef<HTMLDivElement | null>(null)
    const selectedModelText = formatAssistantModelLabel(selectedModelLabel)
    const modelGroups = groupAssistantModels(filteredModelOptions)
    const visibleModelGroup = expandedModelGroup === '' ? null : expandedModelGroup && modelGroups.some(group => group.id === expandedModelGroup)
        ? expandedModelGroup
        : modelGroups.find(group => group.models.some(({ model }) => model.id === selectedModel))?.id || modelGroups[0]?.id || null
    const visibleModelGroups = modelQuery.trim() || !visibleModelGroup ? modelGroups : modelGroups.filter(group => group.id === visibleModelGroup)
    const canChooseSpeed = supportsAssistantFastMode(selectedModel)
    const canChooseEffort = EFFORT_OPTIONS.length > 1
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
    const menuOptionClass = 'flex w-full items-center gap-2 rounded-lg px-2.5 text-left transition-colors hover:bg-[var(--surface-hover)] hover:text-sparkle-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]'
    const connectionPillState = isConnected || reconnectPending || isConnecting
        ? null
        : {
            label: 'Disconnected',
            title: 'Reconnect chat',
            className: 'border-amber-400/25 bg-amber-500/[0.10] text-amber-100 hover:bg-amber-500/[0.14]',
            spinning: false
        }

    const openSubmenu = () => {
        setExpandedModelGroup(modelGroups.find(group => group.models.some(({ model }) => model.id === selectedModel))?.id || null)
        setActiveSubmenu('model')
        requestAnimationFrame(() => modelDropdownRef.current?.querySelector<HTMLButtonElement>('button')?.focus())
    }
    const returnToEffort = () => {
        setModelSearchOpen(false)
        setModelQuery('')
        setActiveModelIndex(0)
        setActiveSubmenu(null)
        requestAnimationFrame(() => modelRouteRef.current?.focus())
    }
    const chooseModel = (id: string) => {
        setSelectedModel(id)
        setShowModelDropdown(false)
        returnToEffort()
    }
    const showModelRefreshState = modelsLoading

    const toggleTraitsDropdown = () => {
        if (controlsLocked) return
        const next = !showTraitsDropdown
        setShowTraitsDropdown(next)
        setShowModelDropdown(false)
        if (!next) return
        if (!controlsMotion.present) setActiveSubmenu(null)
        onRefreshModels?.()
    }

    useEffect(() => {
        if (controlsMotion.present) return
        setActiveSubmenu(null)
        setControlsReady(false)
    }, [controlsMotion.present])

    useEffect(() => {
        if (modelSearchOpen) modelSearchInputRef.current?.focus()
    }, [modelSearchOpen])

    useEffect(() => {
        if (!controlsMotion.present && modelSearchOpen) {
            setModelSearchOpen(false)
            setModelQuery('')
            setActiveModelIndex(0)
        }
    }, [controlsMotion.present, modelSearchOpen, setModelQuery, setActiveModelIndex])

    const closeModelSearch = () => {
        setModelSearchOpen(false)
        setModelQuery('')
        setActiveModelIndex(0)
        requestAnimationFrame(() => modelDropdownRef.current?.querySelector<HTMLButtonElement>('button[aria-label="Search models"]')?.focus())
    }

    useEffect(() => {
        if (!showAccessMenu) return
        const closeOnPointerDown = (event: PointerEvent) => {
            if (!isOverlayEventInside(event, accessMenuRef.current)) setShowAccessMenu(false)
        }
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setShowAccessMenu(false)
        }
        const removePointer = addOverlayEventListener('pointerdown', closeOnPointerDown)
        const removeKey = addOverlayEventListener('keydown', closeOnEscape)
        return () => {
            removePointer()
            removeKey()
        }
    }, [showAccessMenu])

    return (
        <div className={cn('flex min-w-0 flex-1 flex-nowrap items-center justify-start text-[14px]', forceSingleRow ? 'gap-1' : 'gap-1.5 max-[520px]:gap-1', isCompactFooter ? 'overflow-visible' : 'overflow-visible')}>
            <div className="relative min-w-0 flex-[1_1_0%] max-w-full" ref={traitsDropdownRef}>
                {controlsMotion.present ? <AnchoredNativeOverlay browserZIndex={170} autoFocus={showTraitsDropdown} onReady={handleControlsReady}><div
                    data-composer-controls-motion
                    aria-hidden={!showTraitsDropdown}
                    inert={!showTraitsDropdown}
                    className={cn(
                        traitsMenuOpensDown ? 'absolute left-0 top-[36px] z-[170]' : 'absolute bottom-[36px] left-0 z-[170]',
                        'transition-[opacity,transform] duration-[180ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none motion-reduce:transform-none',
                        controlsVisible ? 'pointer-events-auto translate-y-0 opacity-100' : cn('pointer-events-none opacity-0', traitsMenuOpensDown ? '-translate-y-1' : 'translate-y-1')
                    )}
                >
                        <div data-model-controls-panel className={cn('relative w-[256px] max-w-[calc(100vw-32px)]', menuPanelClass)} role="dialog" aria-label="Model controls" onKeyDown={(event) => {
                            if (event.key !== 'Escape') return
                            event.preventDefault()
                            event.stopPropagation()
                            if (modelSearchOpen) closeModelSearch()
                            else if (activeSubmenu === 'model') returnToEffort()
                            else setShowTraitsDropdown(false)
                        }}>
                            <ComposerControlsTransition sectionKey={activeSubmenu || 'effort'}>
                            <div hidden={activeSubmenu === 'model'} data-effort-card className="w-full">
                                <div className="px-1.5 pb-1 pt-1">
                                    <div className="flex items-start gap-1">
                                        {canChooseSpeed ? <button
                                            type="button"
                                            onClick={() => setFastModeEnabled(!fastModeEnabled)}
                                            aria-label="Fast mode"
                                            aria-pressed={fastModeEnabled}
                                            title={fastModeEnabled ? 'Switch to standard speed' : 'Switch to fast speed'}
                                            className={cn(
                                                'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-[background-color,color,transform] duration-200 ease-out active:scale-95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)] motion-reduce:transition-none motion-reduce:transform-none',
                                                fastModeEnabled
                                                    ? 'bg-[color-mix(in_srgb,var(--accent-primary)_12%,transparent)] text-[var(--accent-primary)] hover:bg-[color-mix(in_srgb,var(--accent-primary)_18%,transparent)]'
                                                    : 'text-sparkle-text-muted hover:bg-[var(--surface-hover)]'
                                            )}
                                        >
                                            <Zap
                                                size={14}
                                                strokeWidth={2.2}
                                                fill={fastModeEnabled ? 'currentColor' : 'transparent'}
                                                className={cn(
                                                    'transition-[fill,transform] duration-200 ease-out motion-reduce:transition-none motion-reduce:transform-none',
                                                    fastModeEnabled ? 'scale-100 rotate-0' : 'scale-90 -rotate-[8deg]'
                                                )}
                                            />
                                        </button> : <span className="w-6 shrink-0" />}
                                        <div className="min-w-0 flex-1 text-center">
                                            {canChooseEffort ? <div className="text-[14px] font-semibold leading-6 text-[var(--accent-primary)]" aria-live="polite">{selectedEffortText}</div> : null}
                                            <button ref={modelRouteRef} type="button" onClick={openSubmenu} aria-label="Choose model" aria-haspopup="dialog" className="inline-flex h-6 max-w-full items-center justify-center gap-0.5 rounded-md px-1 text-[12px] font-medium text-sparkle-text-secondary transition-colors hover:text-sparkle-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]"><span className="truncate">{selectedModelText || 'Select model'}</span><ChevronDown size={12} className="shrink-0 -rotate-90 text-sparkle-text-muted" /></button>
                                        </div>
                                        {onRefreshModels ? <button type="button" onClick={onRefreshModels} disabled={modelsLoading} aria-label="Refresh models" title="Refresh models" className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-sparkle-text-muted transition-colors hover:bg-[var(--surface-hover)] hover:text-sparkle-text disabled:opacity-45 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]"><RotateCw size={14} className={modelsLoading ? 'animate-spin' : ''} /></button> : <span className="w-6 shrink-0" />}
                                    </div>
                                    {canChooseEffort ? <div className="relative mt-1.5 py-1">
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
                                    </div> : null}
                                </div>
                                {modelsError ? <p className="px-3 py-1 text-[12px] font-medium text-rose-300">{modelsError}</p> : null}
                            </div>

                            <div
                                ref={modelDropdownRef}
                                hidden={activeSubmenu !== 'model'}
                                data-model-chooser
                                className="w-full"
                            >
                                    <div className="relative flex h-[32px] items-center px-1.5">
                                        <div inert={modelSearchOpen} className={cn('flex w-full items-center transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none', modelSearchOpen ? 'pointer-events-none translate-x-1 opacity-0' : 'translate-x-0 opacity-100')}>
                                            <button type="button" onClick={returnToEffort} aria-label="Back to effort" className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-sparkle-text-muted hover:bg-[var(--surface-hover)] hover:text-sparkle-text"><ChevronDown size={13} className="rotate-90" /></button>
                                            <div className="min-w-0 flex-1 truncate px-1 text-[12px] font-medium text-sparkle-text-dark">Select model</div>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setModelSearchOpen(true)
                                                }}
                                                aria-label="Search models"
                                                title="Search models"
                                                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-sparkle-text-muted transition-colors hover:bg-[var(--surface-hover)] hover:text-sparkle-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]"
                                            >
                                                <Search size={13} />
                                            </button>
                                        </div>
                                        <div inert={!modelSearchOpen} className={cn('absolute inset-x-1.5 flex items-center gap-1 transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none', modelSearchOpen ? 'translate-x-0 opacity-100' : 'pointer-events-none -translate-x-1 opacity-0')}>
                                            <div className="flex h-[26px] min-w-0 flex-1 items-center gap-1.5 rounded-md bg-white/[0.04] px-1.5 ring-1 ring-white/10 transition-colors focus-within:ring-[var(--accent-primary)]">
                                                <Search size={12} className="shrink-0 text-sparkle-text-muted" aria-hidden="true" />
                                                <input
                                                    ref={modelSearchInputRef}
                                                    value={modelQuery}
                                                    onChange={(event) => {
                                                        setModelQuery(event.currentTarget.value)
                                                        setActiveModelIndex(0)
                                                    }}
                                                    onKeyDown={(event) => {
                                                        if (event.key === 'Escape') {
                                                            event.preventDefault()
                                                            event.stopPropagation()
                                                            closeModelSearch()
                                                        } else if (event.key === 'ArrowDown') {
                                                            event.preventDefault()
                                                            setActiveModelIndex((current) => filteredModelOptions.length > 0 ? (current + 1) % filteredModelOptions.length : 0)
                                                        } else if (event.key === 'ArrowUp') {
                                                            event.preventDefault()
                                                            setActiveModelIndex((current) => filteredModelOptions.length > 0 ? (current - 1 + filteredModelOptions.length) % filteredModelOptions.length : 0)
                                                        } else if (event.key === 'Enter') {
                                                            const pick = filteredModelOptions[activeModelIndex] || filteredModelOptions[0]
                                                            if (!pick) return
                                                            event.preventDefault()
                                                            event.stopPropagation()
                                                            chooseModel(pick.id)
                                                        }
                                                    }}
                                                    placeholder="Search models"
                                                    aria-label="Search models"
                                                    className="h-full w-full min-w-0 bg-transparent text-[12px] text-sparkle-text outline-none placeholder:text-sparkle-text-muted/60"
                                                />
                                                {modelQuery ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setModelQuery('')
                                                            setActiveModelIndex(0)
                                                            modelSearchInputRef.current?.focus()
                                                        }}
                                                        aria-label="Clear model search"
                                                        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-sparkle-text-muted transition-colors hover:text-sparkle-text"
                                                    >
                                                        <X size={12} />
                                                    </button>
                                                ) : null}
                                            </div>
                                            <button
                                                type="button"
                                                onClick={closeModelSearch}
                                                aria-label="Close model search"
                                                title="Close search"
                                                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-sparkle-text-muted transition-colors hover:bg-[var(--surface-hover)] hover:text-sparkle-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]"
                                            >
                                                <X size={13} />
                                            </button>
                                        </div>
                                    </div>
                                    <div
                                        ref={modelListRef}
                                        className="assistant-chat-scrollbar relative max-h-[min(196px,calc(100vh-136px))] overflow-y-auto"
                                        onWheel={(event) => {
                                            const list = event.currentTarget
                                            const canScroll = event.deltaY < 0
                                                ? list.scrollTop > 0
                                                : list.scrollTop + list.clientHeight < list.scrollHeight - 1
                                            if (canScroll) event.stopPropagation()
                                        }}
                                    >
                                        {filteredModelOptions.length === 0 ? (
                                            <div className="px-2.5 py-2.5 text-[12px] text-sparkle-text-dark">No models found.</div>
                                        ) : visibleModelGroups.map((group) => <div key={group.id}>
                                            <button
                                                type="button"
                                                aria-expanded={Boolean(modelQuery.trim()) || visibleModelGroup === group.id}
                                                onClick={() => setExpandedModelGroup(visibleModelGroup === group.id ? '' : group.id)}
                                                className={cn(menuOptionClass, 'h-[30px] text-[12px] font-medium text-sparkle-text-secondary')}
                                            >{group.label}<span className="ml-auto text-[10px] text-sparkle-text-muted">{group.models.length}</span><ChevronDown size={13} className={cn('text-sparkle-text-muted transition-transform', (modelQuery.trim() || visibleModelGroup === group.id) && 'rotate-180')} /></button>
                                            {(modelQuery.trim() || visibleModelGroup === group.id) ? group.models.map(({ model, index }) => {
                                            const isActive = model.id === selectedModel
                                            const isHighlighted = modelSearchOpen && index === activeModelIndex
                                            const isLatest = isLatestModel(model, latestModelId)
                                            const isHarnessModel = isOpenCodeHarnessModel(model)
                                            const isGptModel = isGptFamilyModel(model) && !isHarnessModel
                                            return (
                                                <button
                                                    key={model.id}
                                                    type="button"
                                                    data-model-index={index}
                                                    onClick={() => chooseModel(model.id)}
                                                    className={cn(
                                                        menuOptionClass,
                                                        'h-[32px] text-[12px]',
                                                        isActive || isHighlighted ? 'bg-[var(--surface-active)] text-sparkle-text' : 'text-sparkle-text-dark'
                                                    )}
                                                    title={isHarnessModel ? 'OpenCode harness route' : undefined}
                                                >
                                                    {isGptModel ? <OpenAiLogo width={14} height={14} className="shrink-0 text-sparkle-text-secondary" aria-hidden="true" /> : isHarnessModel ? <OpenCodeLogo width={11} height={14} className="shrink-0 text-sparkle-text-secondary" aria-hidden="true" /> : null}
                                                    <span className="min-w-0 flex-1 truncate">{formatAssistantModelLabel(model.label || model.id)}</span>
                                                    {isGptModel && isHarnessModel ? <span title="OpenCode harness route" className="inline-flex shrink-0 items-center"><OpenCodeLogo width={9} height={12} className="text-sparkle-text-muted" aria-hidden="true" /></span> : null}
                                                    {isLatest ? <span className="rounded-md bg-emerald-400/12 px-1.5 py-0.5 text-[10px] font-medium text-emerald-200">Latest</span> : null}
                                                    {isActive ? <Check size={16} className="text-sparkle-text-secondary" /> : null}
                                                </button>
                                            )
                                        }) : null}</div>)}
                                    </div>
                            </div>
                            </ComposerControlsTransition>
                        </div>
                </div></AnchoredNativeOverlay> : null}
                <button
                    type="button"
                    disabled={controlsLocked}
                    onClick={toggleTraitsDropdown}
                    className={cn(
                        'relative inline-flex h-7 w-fit min-w-0 max-w-full items-center overflow-hidden whitespace-nowrap rounded-md px-1 text-[12px] font-medium text-sparkle-text-secondary transition-colors hover:text-sparkle-text sm:px-1.5',
                        controlsLocked && 'cursor-not-allowed opacity-45 hover:text-sparkle-text-secondary'
                    )}
                    title={showModelRefreshState ? 'Refreshing controls...' : `Model${canChooseEffort ? ', reasoning' : ''}${canChooseSpeed ? ', speed' : ''}`}
                >
                    <span
                        className={cn(
                            'pointer-events-none absolute left-1 top-1/2 inline-flex -translate-y-1/2 items-center justify-center text-amber-200 transition-opacity duration-150 sm:left-1.5',
                            canChooseSpeed && fastModeEnabled ? 'opacity-100' : 'opacity-0'
                        )}
                        aria-hidden="true"
                    >
                        <Zap size={13} strokeWidth={2.6} fill="currentColor" />
                    </span>
                    <span
                        className={cn(
                            'assistant-composer-footer-model-summary inline-flex min-w-0 max-w-full items-center gap-1.5 transition-[transform,gap] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]',
                            canChooseSpeed && fastModeEnabled && 'translate-x-[18px]'
                        )}
                    >
                        <span className="assistant-composer-footer-model-label min-w-0 truncate rounded px-0.5">{selectedModelText}</span>
                        {canChooseEffort ? <span className={cn('shrink-0', selectedEffortTone.textClass)}>{selectedEffortText}</span> : null}
                        <ChevronDown size={12} className="-mr-0.5 ml-0.5 shrink-0 text-sparkle-text-muted" />
                    </span>
                </button>
            </div>
            <div ref={accessMenuRef} className="relative shrink-0">
                {showAccessMenu ? (
                    <AnchoredNativeOverlay enabled={true} browserZIndex={180}><div
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
                    </div></AnchoredNativeOverlay>
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
            {(isThinking || mentionLoading || branchesLoading || modelsLoading) ? (
                <span className="inline-flex items-center gap-1 text-[10px] text-sparkle-text-muted">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white/35" />
                    <span>{isThinking ? thinkingLabel : mentionLoading ? 'Indexing...' : modelsLoading ? 'Loading models...' : 'Loading...'}</span>
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
