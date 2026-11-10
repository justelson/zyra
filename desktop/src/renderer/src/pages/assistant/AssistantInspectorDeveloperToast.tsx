import { createPortal } from 'react-dom'
import { NativeOverlayPortal, addOverlayEventListener } from '@/components/ui/native-overlay-portal'
import { supportsNativeOverlay } from '@/components/ui/native-overlay-host'
import { TRANSIENT_MENU_DISMISS_EVENT } from '@/lib/transient-menu'
import { CircleAlert, Copy, ExternalLink, FolderOpen, Info, MousePointer2, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type {
    DevScopeBrowserAnnotationPayload,
    DevScopeBrowserCaptureArtifact
} from '@shared/contracts/devscope-api'
import { cn } from '@/lib/utils'

export type AssistantInspectorDeveloperToastInput = {
    id?: string
    tone?: 'info' | 'error'
    message: string
    artifact?: DevScopeBrowserCaptureArtifact | null
    captureSessionId?: string | null
    annotation?: DevScopeBrowserAnnotationPayload | null
}

type ToastState = AssistantInspectorDeveloperToastInput & { id: string; closing: boolean }

export function useAssistantInspectorDeveloperToast() {
    const [toast, setToast] = useState<ToastState | null>(null)
    const showDeveloperToast = useCallback((input: AssistantInspectorDeveloperToastInput) => {
        setToast({
            ...input,
            id: input.id || `inspector-toast:${Date.now()}:${Math.random().toString(36).slice(2)}`,
            closing: false
        })
    }, [])
    const dismissDeveloperToast = useCallback(() => {
        setToast((current) => current && !current.closing ? { ...current, closing: true } : current)
    }, [])

    useEffect(() => {
        if (!toast || toast.closing) return
        const duration = toast.artifact || toast.annotation ? 12_000 : toast.tone === 'error' ? 7_000 : 4_500
        const timer = window.setTimeout(dismissDeveloperToast, duration)
        return () => window.clearTimeout(timer)
    }, [dismissDeveloperToast, toast])

    useEffect(() => {
        if (!toast?.closing) return
        const closingId = toast.id
        const timer = window.setTimeout(() => {
            setToast((current) => current?.id === closingId && current.closing ? null : current)
        }, 190)
        return () => window.clearTimeout(timer)
    }, [toast?.closing, toast?.id])

    return { developerToast: toast, showDeveloperToast, dismissDeveloperToast }
}

const ACTION_CLASS = 'inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--surface-divider)] bg-[var(--surface-floating)] px-2 text-[9px] text-sparkle-text-secondary shadow-sm transition-[background-color,border-color,color] duration-150 hover:border-[color-mix(in_srgb,var(--accent-primary)_38%,var(--surface-divider))] hover:bg-[color-mix(in_srgb,var(--color-card)_82%,var(--accent-primary)_18%)] hover:text-sparkle-text motion-reduce:transition-none'

function ToastNativeSurface({ children, onDismiss }: { children: ReactNode; onDismiss: () => void }) {
    const mirrorRef = useRef<HTMLDivElement | null>(null)
    const contentRef = useRef<HTMLDivElement | null>(null)
    const [bounds, setBounds] = useState<{ x: number; y: number; width: number; height: number } | null>(null)

    useLayoutEffect(() => {
        const mirror = mirrorRef.current
        if (!mirror) return
        const measure = () => {
            const rect = mirror.getBoundingClientRect()
            if (!rect.width || !rect.height) return
            const next = { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
            setBounds((current) => current && current.x === next.x && current.y === next.y && current.width === next.width && current.height === next.height ? current : next)
        }
        const observer = new ResizeObserver(measure)
        observer.observe(mirror)
        window.addEventListener('resize', measure)
        measure()
        return () => { observer.disconnect(); window.removeEventListener('resize', measure) }
    }, [])

    useEffect(() => {
        const dismissOutside = (event: PointerEvent) => {
            if (contentRef.current?.contains(event.target as Node)) return
            onDismiss()
        }
        const unsubscribe = addOverlayEventListener('pointerdown', dismissOutside, true)
        window.addEventListener(TRANSIENT_MENU_DISMISS_EVENT, onDismiss)
        return () => { unsubscribe(); window.removeEventListener(TRANSIENT_MENU_DISMISS_EVENT, onDismiss) }
    }, [onDismiss])

    return <>
        {createPortal(<div ref={mirrorRef} aria-hidden="true" className="pointer-events-none invisible fixed bottom-3 right-3 w-max max-w-[calc(100vw-24px)]">{children}</div>, document.body)}
        {bounds ? <NativeOverlayPortal bounds={bounds} autoFocus={false}>
            <div ref={contentRef} style={{ position: 'fixed', left: supportsNativeOverlay() ? 0 : bounds.x, top: supportsNativeOverlay() ? 0 : bounds.y, width: bounds.width, height: bounds.height }}>{children}</div>
        </NativeOverlayPortal> : null}
    </>
}

export function AssistantInspectorDeveloperToast({
    toast,
    onDismiss,
    allowChatAttachment = true
}: {
    toast: ToastState | null
    allowChatAttachment?: boolean
    onDismiss: () => void
}) {
    const dragStartXRef = useRef<number | null>(null)
    const [dragX, setDragX] = useState(0)
    const [dragging, setDragging] = useState(false)
    const [attaching, setAttaching] = useState(false)
    const [attachError, setAttachError] = useState<string | null>(null)

    useEffect(() => {
        setDragX(0)
        setAttaching(false)
        setAttachError(null)
        setDragging(false)
        dragStartXRef.current = null
    }, [toast?.id])

    if (!toast) return null

    const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
        const startX = dragStartXRef.current
        if (startX === null) return
        const distance = Math.abs(event.clientX - startX)
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        dragStartXRef.current = null
        setDragging(false)
        if (distance >= 72) onDismiss()
        else setDragX(0)
    }
    const artifact = toast.artifact || null
    const annotation = toast.annotation || null
    const hasImage = artifact?.kind === 'screenshot' && Boolean(artifact.thumbnailDataUrl)
    const attach = async () => {
        if (!artifact || attaching) return
        setAttaching(true); setAttachError(null)
        try {
            const result = await window.devscope.attachBrowserCaptureToChat({ artifactId: artifact.artifactId, sessionId: toast.captureSessionId, annotation: toast.annotation || undefined })
            if (!result.success) throw new Error(result.error || 'Could not attach capture.')
            onDismiss()
        } catch (error) { setAttachError(error instanceof Error ? error.message : 'Could not attach capture.') }
        finally { setAttaching(false) }
    }
    const attachButton = allowChatAttachment && artifact && toast.captureSessionId !== undefined ? <button type="button" disabled={attaching} onClick={() => void attach()} className={ACTION_CLASS}>{attaching ? 'Attaching…' : 'Attach to chat'}</button> : null


    if (hasImage && artifact?.thumbnailDataUrl) {
        return (
            <ToastNativeSurface onDismiss={onDismiss}><div
                className="w-[min(320px,calc(100vw-24px))]"
                style={{
                    transform: toast.closing ? 'translate3d(calc(100% + 24px),0,0)' : `translate3d(${dragX}px,0,0)`,
                    opacity: toast.closing ? 0 : Math.max(0.22, 1 - Math.abs(dragX) / 260),
                    transition: dragging ? 'none' : 'transform 190ms cubic-bezier(.4,0,.2,1), opacity 160ms ease',
                    touchAction: 'pan-y'
                }}
                role="status"
                aria-label={annotation ? 'Browser annotation attached' : 'Browser screenshot captured'}
                onPointerDown={(event) => {
                    const target = event.target
                    if (event.button !== 0 || (target as Element | null)?.closest?.('button')) return
                    event.preventDefault()
                    dragStartXRef.current = event.clientX
                    setDragging(true)
                    event.currentTarget.setPointerCapture(event.pointerId)
                }}
                onPointerMove={(event) => {
                    if (dragStartXRef.current === null) return
                    setDragX(event.clientX - dragStartXRef.current)
                }}
                onPointerUp={finishDrag}
                onPointerCancel={finishDrag}
            >
                <div key={toast.id} className="assistant-screenshot-preview-arrive relative">
                    <img
                        src={artifact.thumbnailDataUrl}
                        alt={annotation ? 'Browser annotation preview' : 'Browser screenshot preview'}
                        width={artifact.width}
                        height={artifact.height}
                        className="block h-auto max-h-[min(46vh,320px)] w-full rounded-lg border border-[var(--surface-divider)] bg-media-black object-contain shadow-[0_14px_36px_rgba(0,0,0,0.34)]"
                        draggable={false}
                    />
                    <button type="button" onClick={onDismiss} className={cn(ACTION_CLASS, 'absolute right-1 top-1 w-7 justify-center px-0')} aria-label="Close preview"><X size={11} /></button>
                    <div className="mt-1.5 flex flex-wrap justify-end gap-1">
                        {attachButton}
                        <button type="button" onClick={() => void window.devscope.copyBrowserPreviewArtifact({ artifactId: artifact.artifactId, mode: 'image' })} className={ACTION_CLASS}><Copy size={10} />Copy</button>
                        <button type="button" onClick={() => void window.devscope.openBrowserPreviewArtifact(artifact.artifactId)} className={ACTION_CLASS}><ExternalLink size={10} />Open</button>
                        <button type="button" onClick={() => void window.devscope.revealBrowserPreviewArtifact(artifact.artifactId)} className={ACTION_CLASS}><FolderOpen size={10} />Reveal</button>
                        <button type="button" onClick={() => void window.devscope.copyBrowserPreviewArtifact({ artifactId: artifact.artifactId, mode: 'path' })} className={cn(ACTION_CLASS, 'w-7 justify-center px-0')} title="Copy capture path" aria-label="Copy capture path"><Copy size={10} /></button>
                        {annotation ? <button type="button" onClick={() => void window.devscope.copyToClipboard(JSON.stringify(annotation, null, 2))} className={ACTION_CLASS}><MousePointer2 size={10} />Annotation</button> : null}

                    </div>
                    {attachError ? <p role="alert" className="mt-1 text-xs text-sparkle-text-secondary">{attachError}</p> : null}
                </div>
            </div></ToastNativeSurface>
        )
    }

    return (
        <ToastNativeSurface onDismiss={onDismiss}><div
            className={cn(
                'flex max-w-[min(320px,calc(100vw-24px))] items-center gap-2 rounded-lg border bg-[var(--color-card)] px-2.5 py-2 text-[10px] shadow-lg',
                toast.tone === 'error' ? 'border-red-400/30 text-red-300' : 'border-[var(--surface-divider)] text-sparkle-text-secondary'
            )}
            style={{
                transform: toast.closing ? 'translate3d(calc(100% + 24px),0,0)' : `translate3d(${dragX}px,0,0)`,
                opacity: toast.closing ? 0 : Math.max(0.22, 1 - Math.abs(dragX) / 260),
                transition: dragging ? 'none' : 'transform 190ms cubic-bezier(.4,0,.2,1), opacity 160ms ease',
                touchAction: 'pan-y'
            }}
            role="status"
            aria-live="polite"
            onPointerDown={(event) => {
                if (event.button !== 0 || (event.target as Element | null)?.closest?.('button')) return
                dragStartXRef.current = event.clientX
                setDragging(true)
                event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={(event) => {
                if (dragStartXRef.current !== null) setDragX(event.clientX - dragStartXRef.current)
            }}
            onPointerUp={finishDrag}
            onPointerCancel={finishDrag}
        >
            {toast.tone === 'error' ? <CircleAlert size={14} className="shrink-0 text-red-300" aria-hidden="true" /> : <Info size={14} className="shrink-0 text-[var(--accent-primary)]" aria-hidden="true" />}
            <span className="min-w-0 flex-1">{toast.message || (artifact ? 'Capture ready' : 'Done')}</span>
            {attachButton}
            {attachError ? <span role="alert">{attachError}</span> : null}
            {artifact ? <button type="button" onClick={() => void window.devscope.openBrowserPreviewArtifact(artifact.artifactId)} className={ACTION_CLASS}>Open</button> : null}
            <button type="button" onClick={onDismiss} className="inline-flex size-6 items-center justify-center rounded bg-[var(--surface-floating)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-card)_82%,var(--accent-primary)_18%)]" aria-label="Dismiss"><X size={11} /></button>
        </div></ToastNativeSurface>
    )
}
