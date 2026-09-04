import {
    type CSSProperties,
    type KeyboardEvent as ReactKeyboardEvent,
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState
} from 'react'
import type { ControlCursorState } from '@shared/agent-control/contracts'
import { cn } from '@/lib/utils'
import { AssistantBrowserAgentCursor } from './AssistantBrowserAgentCursor'
import { AssistantAgentUseOverlay } from './AssistantAgentUseOverlay'
import {
    resolveAssistantBrowserViewportLayout,
    resizeAssistantBrowserViewport,
    ASSISTANT_BROWSER_VIEWPORT_RAIL_SIZE,
    type AssistantBrowserViewportResizeDirection
} from './assistant-browser-viewport-layout'
import {
    viewportSettingKey,
    type AssistantBrowserViewportSetting
} from './assistant-browser-workspace-state'

type ResizeDraft = {
    direction: AssistantBrowserViewportResizeDirection
    startX: number
    startY: number
    startWidth: number
    startHeight: number
    presentationScale: number
    width: number
    height: number
}

const HANDLE_CLASS = 'absolute z-20 touch-none border-0 bg-transparent p-0 outline-none before:absolute before:-inset-1 before:content-[\'\'] focus-visible:bg-[var(--surface-hover)]'

export function AssistantBrowserViewportFrame({
    viewport,
    zoomFactor,
    visible,
    controlled,
    cursor,
    children,
    onViewportChange
}: {
    viewport: AssistantBrowserViewportSetting
    zoomFactor: number
    visible: boolean
    controlled: boolean
    cursor: ControlCursorState | null
    children: ReactNode
    onViewportChange: (viewport: AssistantBrowserViewportSetting) => void
}) {
    const rootRef = useRef<HTMLDivElement | null>(null)
    const [container, setContainer] = useState({ width: 1, height: 1 })
    const [draft, setDraft] = useState<ResizeDraft | null>(null)
    const viewportKey = viewportSettingKey(viewport)

    useLayoutEffect(() => {
        const node = rootRef.current
        if (!node) return
        const measure = () => {
            const rect = node.getBoundingClientRect()
            setContainer((current) => {
                const width = Math.max(1, Math.round(rect.width))
                const height = Math.max(1, Math.round(rect.height))
                return current.width === width && current.height === height ? current : { width, height }
            })
        }
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(node)
        return () => observer.disconnect()
    }, [])

    useEffect(() => {
        setDraft(null)
    }, [viewportKey])

    const presentedViewport = useMemo<AssistantBrowserViewportSetting>(() => {
        if (!draft || viewport.mode === 'fill') return viewport
        return {
            ...viewport,
            mode: 'freeform',
            presetId: null,
            width: draft.width,
            height: draft.height
        }
    }, [draft, viewport])
    const layout = useMemo(
        () => resolveAssistantBrowserViewportLayout(container, presentedViewport, zoomFactor),
        [container, presentedViewport, zoomFactor]
    )

    const beginResize = useCallback((
        direction: AssistantBrowserViewportResizeDirection,
        event: ReactPointerEvent<HTMLButtonElement>
    ) => {
        if (viewport.mode === 'fill') return
        event.preventDefault()
        event.currentTarget.setPointerCapture?.(event.pointerId)
        setDraft({
            direction,
            startX: event.clientX,
            startY: event.clientY,
            startWidth: presentedViewport.mode === 'fill' ? 1280 : presentedViewport.width,
            startHeight: presentedViewport.mode === 'fill' ? 800 : presentedViewport.height,
            presentationScale: layout.scale,
            width: presentedViewport.mode === 'fill' ? 1280 : presentedViewport.width,
            height: presentedViewport.mode === 'fill' ? 800 : presentedViewport.height
        })
    }, [layout.scale, presentedViewport, viewport.mode])

    useEffect(() => {
        if (!draft || viewport.mode === 'fill') return
        let latest = draft
        let frame = 0
        const move = (event: PointerEvent) => {
            const apply = () => {
                frame = 0
                const size = resizeAssistantBrowserViewport(
                    { width: draft.startWidth, height: draft.startHeight },
                    { x: event.clientX - draft.startX, y: event.clientY - draft.startY },
                    draft.direction,
                    draft.presentationScale,
                    viewport.aspectRatio
                )
                latest = { ...draft, ...size }
                setDraft(latest)
            }
            if (frame) cancelAnimationFrame(frame)
            frame = requestAnimationFrame(apply)
        }
        const finish = () => {
            if (frame) cancelAnimationFrame(frame)
            onViewportChange({
                mode: 'freeform',
                presetId: null,
                width: latest.width,
                height: latest.height,
                aspectRatio: viewport.aspectRatio
            })
            setDraft(null)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', finish, { once: true })
        window.addEventListener('pointercancel', finish, { once: true })
        return () => {
            if (frame) cancelAnimationFrame(frame)
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', finish)
            window.removeEventListener('pointercancel', finish)
        }
    }, [draft?.direction, draft?.presentationScale, draft?.startHeight, draft?.startWidth, draft?.startX, draft?.startY, onViewportChange, viewport.mode === 'fill' ? null : viewport.aspectRatio, viewport.mode])

    const resizeWithKeyboard = useCallback((
        direction: AssistantBrowserViewportResizeDirection,
        event: ReactKeyboardEvent<HTMLButtonElement>
    ) => {
        if (viewport.mode === 'fill' || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
        event.preventDefault()
        const amount = event.shiftKey ? 50 : 10
        const delta = {
            x: event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0,
            y: event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0
        }
        const size = resizeAssistantBrowserViewport(viewport, delta, direction, layout.scale, viewport.aspectRatio)
        onViewportChange({ ...viewport, mode: 'freeform', presetId: null, ...size })
    }, [layout.scale, onViewportChange, viewport])

    const viewportStyle = layout.fillsPanel
        ? { left: 0, top: 0, width: '100%', height: '100%' }
        : {
            left: layout.x,
            top: layout.y,
            width: layout.width,
            height: layout.height,
            transform: `scale(${layout.scale})`,
            transformOrigin: 'top left'
        }
    const overlayStyle = {
        left: layout.x,
        top: layout.y,
        width: layout.visibleWidth,
        height: layout.visibleHeight
    }
    const right = layout.x + layout.visibleWidth
    const bottom = layout.y + layout.visibleHeight
    const rail = ASSISTANT_BROWSER_VIEWPORT_RAIL_SIZE

    const handle = (
        direction: AssistantBrowserViewportResizeDirection,
        label: string,
        className: string,
        style: CSSProperties,
        grip: 'vertical' | 'horizontal' | 'corner'
    ) => (
        <button
            type="button"
            aria-label={`${label}. Use arrow keys to resize.`}
            className={cn(HANDLE_CLASS, className)}
            style={style}
            onPointerDown={(event) => beginResize(direction, event)}
            onKeyDown={(event) => resizeWithKeyboard(direction, event)}
        >
            <span className={cn(
                'pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-sparkle-text-muted/45 transition-colors group-hover:text-sparkle-text motion-reduce:transition-none',
                grip === 'vertical' && 'h-7 w-1 border-x border-current',
                grip === 'horizontal' && 'h-1 w-7 border-y border-current',
                grip === 'corner' && 'size-2.5 border-b border-r border-current'
            )} />
        </button>
    )

    return (
        <div
            ref={rootRef}
            className={cn(
                'assistant-browser-viewport-frame absolute inset-0 overflow-hidden bg-[color-mix(in_srgb,var(--color-bg)_92%,var(--color-text)_8%)]',
                !visible && 'pointer-events-none'
            )}
            style={{ zIndex: visible ? 2 : 1 }}
            aria-hidden={visible ? undefined : true}
            data-active={visible ? 'true' : 'false'}
            data-assistant-browser-viewport={viewport.mode}
        >
            <div
                className={cn(
                    'absolute overflow-hidden bg-media-white shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-text)_12%,transparent),0_14px_36px_rgba(0,0,0,0.18)]',
                    layout.fillsPanel && 'shadow-none',
                    !draft && 'transition-[left,top,width,height,transform] duration-150 ease-out motion-reduce:transition-none'
                )}
                style={viewportStyle}
            >
                {children}
            </div>
            {visible && !layout.fillsPanel ? (
                <>
                    {handle('west', 'Resize Browser viewport from left edge', 'group cursor-ew-resize', { left: layout.x - rail, top: layout.y, width: rail, height: layout.visibleHeight }, 'vertical')}
                    {handle('east', 'Resize Browser viewport from right edge', 'group cursor-ew-resize', { left: right, top: layout.y, width: rail, height: layout.visibleHeight }, 'vertical')}
                    {handle('south', 'Resize Browser viewport from bottom edge', 'group cursor-ns-resize', { left: layout.x, top: bottom, width: layout.visibleWidth, height: rail }, 'horizontal')}
                    {handle('southwest', 'Resize Browser viewport from bottom-left corner', 'group cursor-nesw-resize', { left: layout.x - rail, top: bottom, width: rail, height: rail }, 'corner')}
                    {handle('southeast', 'Resize Browser viewport from bottom-right corner', 'group cursor-nwse-resize', { left: right, top: bottom, width: rail, height: rail }, 'corner')}
                </>
            ) : null}
            {visible ? (
                <div className="pointer-events-none absolute z-[25] overflow-hidden" style={overlayStyle}>
                    {controlled ? <AssistantAgentUseOverlay application="Browser" /> : null}
                    <AssistantBrowserAgentCursor cursor={cursor} scale={(layout.visibleWidth / Math.max(1, layout.width)) * zoomFactor} />
                </div>
            ) : null}
        </div>
    )
}
