import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, Check, Info, Loader2, X } from 'lucide-react'
import { AnchoredNativeOverlay } from '@/components/ui/AnchoredNativeOverlay'
import { cn } from '@/lib/utils'

export type AssistantToastTone = 'success' | 'error' | 'info'
export type AssistantToastAction = { label: string; run: () => void | Promise<void> }
export type AssistantToastInput = {
    message: string
    tone?: AssistantToastTone
    action?: AssistantToastAction
    durationMs?: number
}
export type AssistantToastState = AssistantToastInput & { id: number; visible: boolean }

export function useAssistantTransientToast() {
    const [toast, setToast] = useState<AssistantToastState | null>(null)
    const revision = useRef(0)
    const showToast = useCallback((input: string | AssistantToastInput, tone: AssistantToastTone = 'success', action?: AssistantToastAction) => {
        const next = typeof input === 'string' ? { message: input, tone, action } : { ...input, tone: input.tone ?? 'success' }
        setToast({ ...next, id: ++revision.current, visible: false })
    }, [])
    const dismissToast = useCallback((id?: number) => {
        setToast(current => current && (id === undefined || current.id === id) ? { ...current, visible: false } : current)
    }, [])
    useEffect(() => {
        if (!toast) return
        const id = toast.id
        const timer = window.setTimeout(() => setToast(current => current?.id === id ? { ...current, visible: true } : current), 10)
        return () => window.clearTimeout(timer)
    }, [toast?.id])
    useEffect(() => {
        if (!toast || toast.visible) return
        const id = toast.id
        const timer = window.setTimeout(() => setToast(current => current?.id === id && !current.visible ? null : current), 300)
        return () => window.clearTimeout(timer)
    }, [toast?.id, toast?.visible])
    return { toast, showToast, dismissToast }
}

/** Floating, non-modal feedback. Hover/focus pauses expiry; actions never take focus on arrival. */
export function AssistantTransientToast({ toast, onDismiss }: { toast: AssistantToastState | null; onDismiss: (id?: number) => void }) {
    const regionRef = useRef<HTMLDivElement>(null)
    const ownerRef = useRef<HTMLElement | null>(typeof document === 'undefined' ? null : document.body)
    const [hovered, setHovered] = useState(false)
    const [focused, setFocused] = useState(false)
    const [pending, setPending] = useState(false)
    const [actionError, setActionError] = useState('')
    const pendingId = useRef<number | null>(null)
    const currentId = useRef(toast?.id)
    const mounted = useRef(true)
    currentId.current = toast?.id
    useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
    useEffect(() => {
        pendingId.current = null
        setPending(false); setActionError('')
        setHovered(Boolean(regionRef.current?.matches(':hover')))
        setFocused(Boolean(regionRef.current?.contains(regionRef.current.ownerDocument.activeElement)))
    }, [toast?.id])
    useEffect(() => {
        if (!toast?.visible || hovered || focused || pending) return
        const id = toast.id
        const duration = toast.durationMs ?? (toast.action || actionError ? 5_000 : 2_600)
        const timer = window.setTimeout(() => onDismiss(id), duration)
        return () => window.clearTimeout(timer)
    }, [toast?.id, toast?.visible, toast?.durationMs, toast?.action, hovered, focused, pending, actionError, onDismiss])
    if (!toast) return null
    const tone = actionError ? 'error' : toast.tone
    const Icon = tone === 'error' ? AlertCircle : tone === 'success' ? Check : Info
    const runAction = async () => {
        if (!toast.action || pendingId.current === toast.id) return
        const id = toast.id
        pendingId.current = id
        setPending(true); setActionError('')
        try {
            await toast.action.run()
            if (mounted.current && currentId.current === id) onDismiss(id)
        } catch (error) {
            if (mounted.current && currentId.current === id) setActionError(error instanceof Error ? error.message : 'Could not complete this action. Try again.')
        } finally {
            if (mounted.current && currentId.current === id) { pendingId.current = null; setPending(false) }
        }
    }
    return <AnchoredNativeOverlay anchorRef={ownerRef} inputRegionRef={regionRef} autoFocus={false} browserZIndex={110}>
        <div ref={regionRef} data-assistant-toast role={tone === 'error' ? 'alert' : 'status'} aria-live={tone === 'error' ? 'assertive' : 'polite'} aria-atomic="true" aria-hidden={!toast.visible}
            onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
            onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}
            className={cn('fixed bottom-4 right-4 z-[110] flex w-[min(24rem,calc(100vw-2rem))] items-center gap-3 rounded-xl border border-[var(--surface-divider)] bg-[var(--surface-floating)] px-4 py-3 text-sm text-sparkle-text shadow-lg transition-[opacity,transform] duration-200 motion-reduce:transition-none', toast.visible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0')}>
            <Icon size={16} aria-hidden="true" className={cn('shrink-0', tone === 'error' ? 'text-[var(--status-danger)]' : tone === 'success' ? 'text-[var(--status-success)]' : 'text-sparkle-text-muted')} />
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-xs leading-5 [overflow-wrap:anywhere]">{actionError || toast.message}</span>
            {toast.action ? <button type="button" disabled={pending} tabIndex={toast.visible ? 0 : -1} onClick={() => void runAction()} className="inline-flex min-h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-sparkle-text-secondary hover:bg-[var(--surface-hover)] hover:text-sparkle-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)] disabled:opacity-50">{pending ? <Loader2 size={12} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}{toast.action.label}</button> : null}
            <button type="button" aria-label="Dismiss notification" tabIndex={toast.visible ? 0 : -1} onClick={() => onDismiss(toast.id)} className="inline-flex size-6 shrink-0 items-center justify-center rounded text-sparkle-text-muted hover:bg-[var(--surface-hover)] hover:text-sparkle-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)]"><X size={13} aria-hidden="true" /></button>
        </div>
    </AnchoredNativeOverlay>
}
