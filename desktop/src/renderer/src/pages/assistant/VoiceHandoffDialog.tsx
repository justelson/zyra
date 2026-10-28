import { useEffect, useId, useRef, useState } from 'react'
import { createOverlayPortal } from '@/components/ui/native-overlay-portal'

export function VoiceHandoffDialog({ currentTitle, nextTitle, onReturn, onSwitch, onCancel }: {
    currentTitle: string; nextTitle: string; onReturn(): Promise<void>; onSwitch(): Promise<void>; onCancel(): void
}) {
    const titleId = useId(), descriptionId = useId(), ref = useRef<HTMLElement>(null)
    const [busy, setBusy] = useState(false)
    const busyRef = useRef(busy), cancelRef = useRef(onCancel)
    busyRef.current = busy
    cancelRef.current = onCancel
    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null
        const dialog = ref.current
        dialog?.querySelector<HTMLButtonElement>('button')?.focus()
        const key = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !busyRef.current) { event.preventDefault(); cancelRef.current() }
            if (event.key !== 'Tab' || !dialog) return
            const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
            const first = buttons[0], last = buttons.at(-1)
            if (event.shiftKey && dialog.ownerDocument.activeElement === first) { event.preventDefault(); last?.focus() }
            else if (!event.shiftKey && dialog.ownerDocument.activeElement === last) { event.preventDefault(); first?.focus() }
        }
        dialog?.ownerDocument.addEventListener('keydown', key)
        return () => { dialog?.ownerDocument.removeEventListener('keydown', key); previous?.focus() }
    }, [])
    const run = async (action: () => Promise<void>) => { setBusy(true); try { await action() } finally { setBusy(false) } }
    return createOverlayPortal(<div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onCancel() }}>
        <section ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} className="w-full max-w-[440px] rounded-xl border border-white/10 bg-sparkle-card p-5 text-sparkle-text shadow-2xl">
            <h2 id={titleId} className="text-sm font-semibold">Voice is active in {currentTitle}</h2>
            <p id={descriptionId} className="mt-2 text-xs leading-5 text-sparkle-text-secondary">Keep the current call, or end it and start Voice in {nextTitle}. Agent work will continue.</p>
            <div className="mt-5 flex flex-wrap justify-end gap-2 text-xs">
                <button type="button" disabled={busy} className="rounded-md border border-white/10 px-3 py-2" onClick={onCancel}>Cancel</button>
                <button type="button" disabled={busy} className="rounded-md border border-white/10 px-3 py-2" onClick={() => { void run(onReturn) }}>Return to call</button>
                <button type="button" disabled={busy} className="rounded-md bg-[var(--accent-primary)] px-3 py-2 text-white disabled:opacity-50" onClick={() => { void run(onSwitch) }}>{busy ? 'Switching…' : 'End call and start here'}</button>
            </div>
        </section>
    </div>, document.body)
}
