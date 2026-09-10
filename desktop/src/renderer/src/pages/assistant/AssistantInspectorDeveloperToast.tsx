import { Copy, ExternalLink, FolderOpen, MousePointer2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
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

export function AssistantInspectorDeveloperToast({
    toast,
    onDismiss
}: {
    toast: ToastState | null
    onDismiss: () => void
}) {
    const dragStartXRef = useRef<number | null>(null)
    const [dragX, setDragX] = useState(0)
    const [dragging, setDragging] = useState(false)

    useEffect(() => {
        setDragX(0)
        setDragging(false)
        dragStartXRef.current = null
    }, [toast?.id])

    if (!toast) return null

    const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
        const startX = dragStartXRef.current
        if (startX === null) return
        const distance = Math.max(0, event.clientX - startX)
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        dragStartXRef.current = null
        setDragging(false)
        if (distance >= 72) onDismiss()
        else setDragX(0)
    }
    const artifact = toast.artifact || null
    const annotation = toast.annotation || null
    const hasImage = artifact?.kind === 'screenshot' && Boolean(artifact.thumbnailDataUrl)

    if (hasImage && artifact?.thumbnailDataUrl) {
        return (
            <div
                className="absolute bottom-3 right-3 z-[390] w-[min(320px,calc(100%-24px))]"
                data-zyra-native-view-occluder="true"
                style={{
                    transform: toast.closing ? 'translate3d(calc(100% + 24px),0,0)' : `translate3d(${dragX}px,0,0)`,
                    opacity: toast.closing ? 0 : Math.max(0.22, 1 - dragX / 260),
                    transition: dragging ? 'none' : 'transform 190ms cubic-bezier(.4,0,.2,1), opacity 160ms ease',
                    touchAction: 'pan-y'
                }}
                role="status"
                aria-label={annotation ? 'Browser annotation attached' : 'Browser screenshot captured'}
                onPointerDown={(event) => {
                    const target = event.target
                    if (event.button !== 0 || (target instanceof Element && target.closest('button'))) return
                    event.preventDefault()
                    dragStartXRef.current = event.clientX
                    setDragging(true)
                    event.currentTarget.setPointerCapture(event.pointerId)
                }}
                onPointerMove={(event) => {
                    if (dragStartXRef.current === null) return
                    setDragX(Math.max(0, event.clientX - dragStartXRef.current))
                }}
                onPointerUp={finishDrag}
                onPointerCancel={finishDrag}
            >
                <div key={toast.id} className="assistant-screenshot-preview-arrive">
                    <img
                        src={artifact.thumbnailDataUrl}
                        alt={annotation ? 'Browser annotation preview' : 'Browser screenshot preview'}
                        width={artifact.width}
                        height={artifact.height}
                        className="block h-auto max-h-[min(46vh,320px)] w-full rounded-lg border border-[var(--surface-divider)] bg-media-black object-contain shadow-[0_14px_36px_rgba(0,0,0,0.34)]"
                        draggable={false}
                    />
                    <div className="mt-1.5 flex flex-wrap justify-end gap-1">
                        <button type="button" onClick={() => void window.devscope.copyBrowserPreviewArtifact({ artifactId: artifact.artifactId, mode: 'image' })} className={ACTION_CLASS}><Copy size={10} />Copy</button>
                        <button type="button" onClick={() => void window.devscope.openBrowserPreviewArtifact(artifact.artifactId)} className={ACTION_CLASS}><ExternalLink size={10} />Open</button>
                        <button type="button" onClick={() => void window.devscope.revealBrowserPreviewArtifact(artifact.artifactId)} className={ACTION_CLASS}><FolderOpen size={10} />Reveal</button>
                        <button type="button" onClick={() => void window.devscope.copyBrowserPreviewArtifact({ artifactId: artifact.artifactId, mode: 'path' })} className={ACTION_CLASS}><Copy size={10} />Path</button>
                        {annotation ? <button type="button" onClick={() => void window.devscope.copyToClipboard(JSON.stringify(annotation, null, 2))} className={ACTION_CLASS}><MousePointer2 size={10} />Annotation</button> : null}
                        <button type="button" onClick={onDismiss} className={cn(ACTION_CLASS, 'w-7 justify-center px-0')} aria-label="Close preview"><X size={11} /></button>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div
            className={cn(
                'absolute bottom-3 right-3 z-[390] flex max-w-[min(320px,calc(100%-24px))] items-center gap-2 rounded-lg border bg-[var(--color-card)] px-2.5 py-2 text-[10px] shadow-lg transition-[transform,opacity] duration-200',
                toast.closing && 'translate-x-[calc(100%_+_24px)] opacity-0',
                toast.tone === 'error' ? 'border-red-400/30 text-red-300' : 'border-[var(--surface-divider)] text-sparkle-text-secondary'
            )}
            data-zyra-native-view-occluder="true"
            role="status"
            aria-live="polite"
        >
            <span className="min-w-0 flex-1">{toast.message || (artifact ? 'Capture ready' : 'Done')}</span>
            {artifact ? <button type="button" onClick={() => void window.devscope.openBrowserPreviewArtifact(artifact.artifactId)} className={ACTION_CLASS}>Open</button> : null}
            <button type="button" onClick={onDismiss} className="inline-flex size-6 items-center justify-center rounded bg-[var(--surface-floating)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-card)_82%,var(--accent-primary)_18%)]" aria-label="Dismiss"><X size={11} /></button>
        </div>
    )
}
