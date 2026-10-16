import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addOverlayEventListener, createOverlayPortal as createPortal, isOverlayEventInside } from './native-overlay-portal'
import { supportsNativeOverlay } from './native-overlay-host'
import { AnchoredMenuPopover } from './AnchoredMenuPopover'
import { Bot, ChevronDown, Folder, FolderOpen, LoaderCircle, Terminal } from 'lucide-react'
import type { DevScopeInstalledIde } from '@shared/contracts/devscope-project-contracts'
import { AnimatedHeight } from '@/components/ui/AnimatedHeight'
import { cn } from '@/lib/utils'
import {
    ALLOWED_IDE_ORDER,
    type AssistantOpenWithTargetId,
    AssistantIdeLogo,
    formatOpenWithError,
    OpenWithTriggerIcon,
    type OpenWithContextAction,
    type OpenWithMenuPosition,
    persistLastOpenWithTargetId,
    readLastOpenWithTargetId
} from './openWithProjectButton.shared'

export function OpenWithProjectButton(props: {
    projectPath: string | null
    preferredShell: 'powershell' | 'cmd'
    menuOpen?: boolean
    onMenuOpenChange?: (open: boolean) => void
    menuWidthMode?: 'content' | 'trigger'
    menuPresentation?: 'portal' | 'inline'
    compactMenuRow?: boolean
    contextActions?: OpenWithContextAction[]
}) {
    const {
        projectPath,
        preferredShell,
        menuOpen: controlledMenuOpen,
        onMenuOpenChange,
        menuWidthMode = 'content',
        menuPresentation: requestedPresentation = 'portal',
        contextActions = [],
        compactMenuRow = false
    } = props
    const menuPresentation = compactMenuRow ? 'popover' : supportsNativeOverlay() ? 'portal' : requestedPresentation
    const triggerRef = useRef<HTMLDivElement | null>(null)
    const menuRef = useRef<HTMLDivElement | null>(null)
    const [uncontrolledMenuOpen, setUncontrolledMenuOpen] = useState(false)
    const [idesLoaded, setIdesLoaded] = useState(false)
    const [loadingIdes, setLoadingIdes] = useState(false)
    const [installedIdes, setInstalledIdes] = useState<DevScopeInstalledIde[]>([])
    const [openingTargetId, setOpeningTargetId] = useState<string | null>(null)
    const [errorMessage, setErrorMessage] = useState<string | null>(null)
    const [lastTargetId, setLastTargetId] = useState<AssistantOpenWithTargetId>(() => readLastOpenWithTargetId())
    const [menuPosition, setMenuPosition] = useState<OpenWithMenuPosition | null>(null)
    const menuOpen = controlledMenuOpen ?? uncontrolledMenuOpen

    const setMenuOpen = useCallback((value: boolean | ((current: boolean) => boolean)) => {
        const nextValue = typeof value === 'function' ? value(menuOpen) : value
        if (controlledMenuOpen === undefined) {
            setUncontrolledMenuOpen(nextValue)
        }
        onMenuOpenChange?.(nextValue)
    }, [controlledMenuOpen, menuOpen, onMenuOpenChange])

    const availableIdes = useMemo(() => {
        const order = new Map(ALLOWED_IDE_ORDER.map((id, index) => [id, index]))
        return installedIdes
            .filter((ide) => order.has(ide.id as (typeof ALLOWED_IDE_ORDER)[number]))
            .sort((left, right) => (order.get(left.id as (typeof ALLOWED_IDE_ORDER)[number]) ?? 99) - (order.get(right.id as (typeof ALLOWED_IDE_ORDER)[number]) ?? 99))
    }, [installedIdes])

    const terminalLabel = preferredShell === 'cmd' ? 'CMD' : 'PowerShell'
    const disabled = !projectPath
    const primaryTargetId: AssistantOpenWithTargetId = useMemo(() => {
        if (lastTargetId === 'explorer' || lastTargetId === 'terminal') return lastTargetId
        return installedIdes.some((ide) => ide.id === lastTargetId) ? lastTargetId : 'terminal'
    }, [installedIdes, lastTargetId])

    const loadInstalledIdes = useCallback(async () => {
        if (idesLoaded || loadingIdes) return
        setLoadingIdes(true)
        try {
            const result = await window.devscope.listInstalledIdes()
            if (result.success) {
                setInstalledIdes(result.ides || [])
            } else {
                setInstalledIdes([])
            }
            setIdesLoaded(true)
        } catch {
            setInstalledIdes([])
            setIdesLoaded(true)
        } finally {
            setLoadingIdes(false)
        }
    }, [idesLoaded, loadingIdes])

    useEffect(() => {
        if (!menuOpen) return
        void loadInstalledIdes()
    }, [loadInstalledIdes, menuOpen])

    useEffect(() => {
        if (lastTargetId === 'explorer' || lastTargetId === 'terminal') return
        void loadInstalledIdes()
    }, [lastTargetId, loadInstalledIdes])

    useEffect(() => {
        if (!menuOpen) return

        const handlePointerDown = (event: PointerEvent) => {
            if (isOverlayEventInside(event, triggerRef.current, menuRef.current)) return
            setMenuOpen(false)
            setErrorMessage(null)
        }

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setMenuOpen(false)
                setErrorMessage(null)
            }
        }

        const removePointer = addOverlayEventListener('pointerdown', handlePointerDown)
        const removeEscape = addOverlayEventListener('keydown', handleEscape)
        return () => {
            removePointer()
            removeEscape()
        }
    }, [menuOpen])

    useEffect(() => {
        if (menuOpen || !errorMessage) return
        setErrorMessage(null)
    }, [errorMessage, menuOpen])

    const updateMenuPosition = useCallback((menuHeight = 220) => {
        const trigger = triggerRef.current
        if (!trigger) return

        const viewportPadding = 12
        const rect = trigger.getBoundingClientRect()
        const menuWidth = menuWidthMode === 'trigger'
            ? Math.ceil(rect.width)
            : Math.max(Math.ceil(rect.width), 188)
        const spaceBelow = window.innerHeight - rect.bottom - viewportPadding
        const spaceAbove = rect.top - viewportPadding
        const shouldOpenUpward = spaceBelow < menuHeight && spaceAbove > spaceBelow
        const maxTop = Math.max(viewportPadding, window.innerHeight - menuHeight - viewportPadding)
        const top = shouldOpenUpward
            ? Math.max(viewportPadding, rect.top - menuHeight + 1)
            : Math.max(viewportPadding, Math.min(maxTop, rect.bottom - 1))
        const maxLeft = Math.max(viewportPadding, window.innerWidth - menuWidth - viewportPadding)
        const left = Math.max(viewportPadding, Math.min(rect.right - menuWidth, maxLeft))

        setMenuPosition({
            top,
            left,
            width: menuWidth,
            attachment: shouldOpenUpward ? 'top' : 'bottom',
            originClassName: shouldOpenUpward ? 'origin-bottom-right animate-scaleIn' : 'origin-top-right animate-scaleIn',
            shellClassName: shouldOpenUpward
                ? 'rounded-t-lg rounded-b-none border-b-transparent'
                : 'rounded-b-lg rounded-t-none border-t-transparent'
        })
    }, [menuWidthMode])

    useEffect(() => {
        if (menuPresentation !== 'portal') return
        if (!menuOpen) {
            setMenuPosition(null)
            return
        }

        updateMenuPosition()
        const handleResize = () => {
            const height = menuRef.current?.offsetHeight ?? 220
            updateMenuPosition(height)
        }

        const rafId = window.requestAnimationFrame(handleResize)
        window.addEventListener('resize', handleResize)
        return () => {
            window.cancelAnimationFrame(rafId)
            window.removeEventListener('resize', handleResize)
        }
    }, [menuOpen, menuPresentation, updateMenuPosition])

    useEffect(() => {
        if (!menuOpen) return

        const handleScroll = () => {
            setMenuOpen(false)
            setErrorMessage(null)
        }

        window.addEventListener('scroll', handleScroll, true)
        return () => window.removeEventListener('scroll', handleScroll, true)
    }, [menuOpen, setMenuOpen])

    const handleOpenExplorer = useCallback(async () => {
        if (!projectPath) return
        setOpeningTargetId('explorer')
        setErrorMessage(null)
        try {
            const result = await window.devscope.openInExplorer(projectPath)
            if (!result.success) {
                setErrorMessage(formatOpenWithError(result, 'Failed to open in File Explorer'))
                return
            }
            setLastTargetId('explorer')
            persistLastOpenWithTargetId('explorer')
            setMenuOpen(false)
        } finally {
            setOpeningTargetId(null)
        }
    }, [projectPath])

    const handleOpenTerminal = useCallback(async () => {
        if (!projectPath) return
        setOpeningTargetId('terminal')
        setErrorMessage(null)
        try {
            const result = await window.devscope.openInTerminal(projectPath, preferredShell)
            if (!result.success) {
                setErrorMessage(formatOpenWithError(result, `Failed to open in ${terminalLabel}`))
                return
            }
            setLastTargetId('terminal')
            persistLastOpenWithTargetId('terminal')
            setMenuOpen(false)
        } finally {
            setOpeningTargetId(null)
        }
    }, [preferredShell, projectPath, terminalLabel])

    const handleOpenIde = useCallback(async (ide: DevScopeInstalledIde) => {
        if (!projectPath) return
        setOpeningTargetId(ide.id)
        setErrorMessage(null)
        try {
            const result = await window.devscope.openProjectInIde(projectPath, ide.id)
            if (!result.success) {
                setErrorMessage(formatOpenWithError(result, `Failed to open in ${ide.name}`))
                return
            }
            setLastTargetId(ide.id as AssistantOpenWithTargetId)
            persistLastOpenWithTargetId(ide.id as AssistantOpenWithTargetId)
            setMenuOpen(false)
        } finally {
            setOpeningTargetId(null)
        }
    }, [projectPath])

    const handleContextAction = useCallback(async (action: OpenWithContextAction) => {
        if (disabled) return
        setErrorMessage(null)
        setMenuOpen(false)
        await action.onSelect()
    }, [disabled, setMenuOpen])

    const handlePrimaryAction = useCallback(() => {
        if (disabled) return
        setMenuOpen(false)

        if (primaryTargetId === 'explorer') {
            void handleOpenExplorer()
            return
        }

        if (primaryTargetId === 'terminal') {
            void handleOpenTerminal()
            return
        }

        const targetIde = installedIdes.find((ide) => ide.id === primaryTargetId)
        if (targetIde) {
            void handleOpenIde(targetIde)
            return
        }

        void handleOpenTerminal()
    }, [disabled, handleOpenExplorer, handleOpenIde, handleOpenTerminal, installedIdes, primaryTargetId])

    const primaryActionLabel = useMemo(() => {
        if (primaryTargetId === 'explorer') return 'File Explorer'
        if (primaryTargetId === 'terminal') return terminalLabel
        return installedIdes.find((ide) => ide.id === primaryTargetId)?.name || terminalLabel
    }, [installedIdes, primaryTargetId, terminalLabel])

    const inlineSurfaceClassName = 'bg-[var(--surface-floating)]'

    const menuContent = (
        <AnimatedHeight isOpen={menuOpen} duration={240}>
            <div className={cn(
                compactMenuRow ? 'relative' : 'relative border border-white/10 p-1 shadow-[0_16px_40px_rgba(0,0,0,0.28)]',
                inlineSurfaceClassName,
                compactMenuRow ? undefined : menuPresentation === 'inline'
                    ? 'rounded-b-lg rounded-t-none border-t-transparent'
                    : menuPosition?.shellClassName,
                menuPresentation === 'portal' && menuPosition?.originClassName
            )}>
                {loadingIdes && !idesLoaded ? (
                    <div className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-sparkle-text-secondary">
                        <LoaderCircle size={11} className="animate-spin" />
                        <span>Checking apps...</span>
                    </div>
                ) : null}

                {availableIdes.map((ide) => {
                    const opening = openingTargetId === ide.id
                    return (
                        <button
                            key={ide.id}
                            type="button"
                            disabled={Boolean(openingTargetId)}
                            onClick={() => void handleOpenIde(ide)}
                            className={cn(
                                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                                openingTargetId
                                    ? 'cursor-not-allowed text-sparkle-text-muted/60'
                                    : 'text-sparkle-text-secondary hover:bg-white/[0.04] hover:text-sparkle-text'
                            )}
                        >
                            <AssistantIdeLogo ide={ide} />
                            <div className="min-w-0 flex-1 truncate text-[11px] font-medium">{ide.name}</div>
                            {opening ? <LoaderCircle size={11} className="animate-spin text-sparkle-text-muted" /> : null}
                        </button>
                    )
                })}

                {idesLoaded && !loadingIdes && availableIdes.length === 0 ? (
                    <div className="px-2.5 py-2 text-[11px] text-sparkle-text-muted">
                        Cursor, VS Code, and Android Studio were not detected.
                    </div>
                ) : null}

                {contextActions.length > 0 ? (
                    <>
                        <div className="my-1 border-t border-white/5" />
                        {contextActions.map((action) => (
                            <button
                                key={action.id}
                                type="button"
                                disabled={Boolean(openingTargetId)}
                                onClick={() => void handleContextAction(action)}
                                className={cn(
                                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                                    openingTargetId
                                        ? 'cursor-not-allowed text-sparkle-text-muted/60'
                                        : 'text-sparkle-text-secondary hover:bg-white/[0.04] hover:text-sparkle-text'
                                )}
                            >
                                <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.03]">
                                    {action.icon === 'assistant' ? <Bot size={12} /> : <Folder size={12} />}
                                </span>
                                <div className="min-w-0 flex-1 truncate text-[11px] font-medium">{action.label}</div>
                            </button>
                        ))}
                    </>
                ) : null}

                <div className="my-1 border-t border-white/5" />

                <button
                    type="button"
                    disabled={Boolean(openingTargetId)}
                    onClick={() => void handleOpenExplorer()}
                    className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                        openingTargetId
                            ? 'cursor-not-allowed text-sparkle-text-muted/60'
                            : 'text-sparkle-text-secondary hover:bg-white/[0.04] hover:text-sparkle-text'
                    )}
                >
                    <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.03]">
                        <FolderOpen size={12} />
                    </span>
                    <div className="min-w-0 flex-1 truncate text-[11px] font-medium">File Explorer</div>
                    {openingTargetId === 'explorer' ? <LoaderCircle size={11} className="animate-spin text-sparkle-text-muted" /> : null}
                </button>

                <button
                    type="button"
                    disabled={Boolean(openingTargetId)}
                    onClick={() => void handleOpenTerminal()}
                    className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                        openingTargetId
                            ? 'cursor-not-allowed text-sparkle-text-muted/60'
                            : 'text-sparkle-text-secondary hover:bg-white/[0.04] hover:text-sparkle-text'
                    )}
                >
                    <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.03]">
                        <Terminal size={12} />
                    </span>
                    <div className="min-w-0 flex-1 truncate text-[11px] font-medium">{terminalLabel}</div>
                    {openingTargetId === 'terminal' ? <LoaderCircle size={11} className="animate-spin text-sparkle-text-muted" /> : null}
                </button>

                {errorMessage ? (
                    <div className="mt-1 px-2.5 py-2 text-[11px] text-red-300">
                        {errorMessage}
                    </div>
                ) : null}
            </div>
        </AnimatedHeight>
    )

    return (
        <div className={cn('relative inline-flex', compactMenuRow && 'w-full shrink-0')} ref={triggerRef}>
            <div
                className={cn(
                    'inline-flex overflow-hidden rounded-lg border transition-[border-color,background-color,box-shadow,border-radius] duration-200',
                    inlineSurfaceClassName,
                    menuOpen && !disabled && !compactMenuRow && (
                        menuPresentation === 'inline' || menuPosition?.attachment !== 'top'
                            ? 'rounded-b-none border-b-transparent border-white/20 shadow-[0_10px_24px_rgba(0,0,0,0.16)]'
                            : 'rounded-t-none border-t-transparent border-white/20 shadow-[0_10px_24px_rgba(0,0,0,0.16)]'
                    ),
                    disabled
                        ? 'border-white/10 opacity-60'
                        : 'border-white/10',
                    compactMenuRow && 'w-full rounded-md border-transparent bg-transparent shadow-none'
                )}
            >
                <button
                    type="button"
                    onClick={handlePrimaryAction}
                    disabled={disabled || Boolean(openingTargetId)}
                    className={cn(
                        'inline-flex h-8 items-center gap-1.5 px-2.5 text-[11px] font-medium transition-colors',
                        compactMenuRow && 'min-w-0 flex-1 px-2 text-xs',
                        disabled || openingTargetId
                            ? 'cursor-not-allowed text-sparkle-text-muted/60'
                            : cn(
                                'text-sparkle-text-secondary hover:bg-white/[0.03] hover:text-sparkle-text',
                                menuOpen && 'text-sparkle-text'
                            )
                    )}
                    title={disabled ? 'No project directory selected' : `Open project folder in ${primaryActionLabel}`}
                >
                    <OpenWithTriggerIcon
                        targetId={primaryTargetId}
                        installedIdes={installedIdes}
                        opening={Boolean(openingTargetId && openingTargetId === primaryTargetId)}
                    />
                    <span>{compactMenuRow ? `Open in ${primaryActionLabel}` : 'Open with'}</span>
                </button>
                <button
                    type="button"
                    onClick={() => {
                        if (disabled) return
                        setMenuOpen((current) => !current)
                    }}
                    disabled={disabled || Boolean(openingTargetId)}
                    className={cn(
                        'inline-flex h-8 w-8 items-center justify-center border-l border-white/10 transition-colors',
                        disabled || openingTargetId
                            ? 'cursor-not-allowed text-sparkle-text-muted/60'
                            : cn(
                                'text-sparkle-text-secondary hover:bg-white/[0.03] hover:text-sparkle-text',
                                menuOpen && 'text-sparkle-text'
                            )
                    )}
                    title={disabled ? 'No project directory selected' : 'Choose another app'}
                    aria-label="Choose another app"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                >
                    <ChevronDown size={13} className={cn('transition-transform', menuOpen && 'rotate-180')} />
                </button>
            </div>

            {menuOpen && compactMenuRow && <AnchoredMenuPopover anchorRef={triggerRef} contentRef={menuRef} label="Open project in" onClose={() => setMenuOpen(false)}>{menuContent}</AnchoredMenuPopover>}

            {menuPresentation === 'inline' ? (
                <div
                    ref={menuRef}
                    className={cn(
                        compactMenuRow ? 'relative w-full overflow-hidden rounded-lg' : 'absolute right-0 top-full z-[160] -mt-px overflow-hidden',
                        menuWidthMode === 'trigger' ? 'w-full min-w-0' : 'min-w-[188px]',
                        menuOpen ? 'pointer-events-auto' : 'pointer-events-none'
                    )}
                    onClick={(event) => event.stopPropagation()}
                >
                    {menuContent}
                </div>
            ) : null}

            {menuOpen && menuPresentation === 'portal' && menuPosition && typeof document !== 'undefined' && createPortal(
                <div
                    ref={menuRef}
                    className={cn(
                        'fixed z-[160] overflow-visible',
                        menuWidthMode === 'trigger' ? 'min-w-0' : 'min-w-[188px]'
                    )}
                    style={{
                        top: `${menuPosition.top}px`,
                        left: `${menuPosition.left}px`,
                        width: `${menuPosition.width}px`
                    }}
                    onClick={(event) => event.stopPropagation()}
                >
                    {menuContent}
                </div>,
                document.body
            )}
        </div>
    )
}
