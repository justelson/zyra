import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, Check, Info, Loader2, X } from 'lucide-react'
import { AnchoredNativeOverlay } from '@/components/ui/AnchoredNativeOverlay'
import { supportsNativeOverlay } from '@/components/ui/native-overlay-host'
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

function getToastOwnerGeometry(owner: HTMLElement | null) {
    const view = owner?.ownerDocument.defaultView
    const rem = view ? parseFloat(view.getComputedStyle(owner!.ownerDocument.documentElement).fontSize) || 16 : 16
    return { width: Math.max(0, Math.min(24 * rem, (view?.innerWidth ?? 416) - 2 * rem)), inset: rem }
}

/** Floating, non-modal feedback. Hover/focus pauses expiry; actions never take focus on arrival. */
export function AssistantTransientToast({ toast, onDismiss }: { toast: AssistantToastState | null; onDismiss: (id?: number) => void }) {
    const regionRef = useRef<HTMLDivElement>(null)
    const ownerRef = useRef<HTMLElement | null>(typeof document === 'undefined' ? null : document.body)
    const native = supportsNativeOverlay()
    const [geometry, setGeometry] = useState(() => getToastOwnerGeometry(ownerRef.current))
    const [region, setRegion] = useState<HTMLDivElement | null>(null)
    const [readyRegion, setReadyRegion] = useState<HTMLDivElement | null>(null)
    const [enteredId, setEnteredId] = useState<number | null>(null)
    const mountRegion = useCallback((node: HTMLDivElement | null) => {
        regionRef.current = node
        setRegion(node)
        setReadyRegion(null)
        setEnteredId(null)
    }, [])
    const onReady = useCallback(() => setReadyRegion(regionRef.current), [])
    useEffect(() => {
        const view = ownerRef.current?.ownerDocument.defaultView
        if (!view) return
        const update = () => {
            const next = getToastOwnerGeometry(ownerRef.current)
            setGeometry(current => current.width === next.width && current.inset === next.inset ? current : next)
        }
        update()
        view.addEventListener('resize', update)
        return () => view.removeEventListener('resize', update)
    }, [toast?.id])
    useEffect(() => {
        const view = ownerRef.current?.ownerDocument.defaultView
        if (!view || !region || readyRegion !== region || !toast?.visible) return
        const id = toast.id
        // The visibility timer may finish before a cold native portal exists.
        let second = 0
        let entered = false
        const enter = () => {
            if (entered) return
            entered = true
            view.clearTimeout(fallback)
            setEnteredId(id)
        }
        // Owner frames can pause while minimized; never strand a ready notice.
        const fallback = view.setTimeout(enter, 60)
        const first = view.requestAnimationFrame(() => {
            second = view.requestAnimationFrame(enter)
        })
        return () => { view.clearTimeout(fallback); view.cancelAnimationFrame(first); view.cancelAnimationFrame(second) }
    }, [region, readyRegion, toast?.id, toast?.visible])
    const presented = Boolean(toast?.visible && enteredId === toast.id)
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
        if (!toast?.visible || !presented || hovered || focused || pending) return
        const id = toast.id
        const duration = toast.durationMs ?? (toast.action || actionError ? 5_000 : 2_600)
        const timer = window.setTimeout(() => onDismiss(id), duration)
        return () => window.clearTimeout(timer)
    }, [toast?.id, toast?.visible, toast?.durationMs, toast?.action, presented, hovered, focused, pending, actionError, onDismiss])
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
    const visual = <div ref={native ? undefined : mountRegion} data-assistant-toast role={tone === 'error' ? 'alert' : 'status'} aria-live={tone === 'error' ? 'assertive' : 'polite'} aria-atomic="true" aria-hidden={!presented}
            style={native ? undefined : { width: geometry.width, bottom: geometry.inset, right: geometry.inset }}
            onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
            onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}
            className={cn(native ? 'relative w-full' : 'fixed z-[110]', 'flex items-center gap-3 rounded-xl border border-[var(--surface-divider)] bg-[var(--surface-floating)] px-4 py-3 text-sm text-sparkle-text shadow-lg transition-[opacity,transform] duration-200 motion-reduce:transition-none', presented ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0')}>
            <Icon size={16} aria-hidden="true" className={cn('shrink-0', tone === 'error' ? 'text-[var(--status-danger)]' : tone === 'success' ? 'text-[var(--status-success)]' : 'text-sparkle-text-muted')} />
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-xs leading-5 [overflow-wrap:anywhere]">{actionError || toast.message}</span>
            {toast.action ? <button type="button" disabled={pending} tabIndex={presented ? 0 : -1} onClick={() => void runAction()} className="inline-flex min-h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-sparkle-text-secondary hover:bg-[var(--surface-hover)] hover:text-sparkle-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)] disabled:opacity-50">{pending ? <Loader2 size={12} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}{toast.action.label}</button> : null}
            <button type="button" aria-label="Dismiss notification" tabIndex={presented ? 0 : -1} onClick={() => onDismiss(toast.id)} className="inline-flex size-6 shrink-0 items-center justify-center rounded text-sparkle-text-muted hover:bg-[var(--surface-hover)] hover:text-sparkle-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)]"><X size={13} aria-hidden="true" /></button>
        </div>
    return <AnchoredNativeOverlay anchorRef={ownerRef} inputRegionRef={regionRef} autoFocus={false} browserZIndex={110} onReady={onReady}>
        {native ? <div ref={mountRegion} data-assistant-toast-region style={{ position: 'absolute', width: geometry.width, bottom: geometry.inset, right: geometry.inset, pointerEvents: presented ? 'auto' : 'none' }}>
            {/* Measure the untransformed box, never the moving visual or native crop viewport. */}
            {visual}
        </div> : visual}
    </AnchoredNativeOverlay>
}
