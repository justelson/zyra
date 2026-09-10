import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MousePointer2, Square, X } from 'lucide-react'
import type { ControlStateSnapshot } from '@shared/agent-control/contracts'

/** One quiet entry point for surface access and the global emergency brake. */
export function AssistantControlStatus({ state }: { state: ControlStateSnapshot | null }) {
    const [open, setOpen] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [position, setPosition] = useState({ top: 34, right: 12 })
    const trigger = useRef<HTMLButtonElement>(null)
    const panel = useRef<HTMLDivElement>(null)
    const grants = state?.grants.filter((grant) => grant.state === 'active') || []
    const pending = (state?.pendingGrants.length || 0) + (state?.pendingActionApprovals.length || 0)
    useLayoutEffect(() => {
        if (!open) return
        const place = () => {
            const rect = trigger.current?.getBoundingClientRect()
            if (rect) setPosition({ top: rect.bottom + 7, right: Math.max(8, window.innerWidth - rect.right) })
        }
        place()
        window.addEventListener('resize', place)
        return () => window.removeEventListener('resize', place)
    }, [open])
    useEffect(() => {
        if (!open) return
        const dismiss = (event: PointerEvent) => {
            if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false)
        }
        const key = (event: KeyboardEvent) => {
            if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); trigger.current?.focus() }
        }
        document.addEventListener('pointerdown', dismiss, true)
        document.addEventListener('keydown', key, true)
        panel.current?.focus()
        return () => {
            document.removeEventListener('pointerdown', dismiss, true)
            document.removeEventListener('keydown', key, true)
        }
    }, [open])
    if (!state) return null
    const stop = async () => {
        setBusy(true); setError(null)
        try {
            const result = await window.devscope.agentControl.emergencyStop()
            if (!result.success) throw new Error(result.error || 'Could not stop control.')
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not stop control.') }
        finally { setBusy(false) }
    }
    return <>
        <button ref={trigger} type="button" aria-label="Browser and computer access" title="Browser and computer access" aria-haspopup="dialog" aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="mr-1 inline-flex size-7 items-center justify-center rounded-md text-[var(--color-text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]">
            <MousePointer2 size={17} strokeWidth={1.8} className={grants.length ? 'text-[var(--accent-secondary)]' : ''} />
        </button>
        {open && createPortal(<div ref={panel} tabIndex={-1} role="dialog" aria-label="Browser and computer access" data-zyra-native-view-occluder="true"
            className="fixed z-[1200] w-72 max-w-[calc(100vw-16px)] rounded-xl border border-[var(--surface-divider)] bg-[var(--surface-floating)] p-3 text-[var(--color-text)] shadow-xl outline-none animate-[inspector-tab-in_180ms_ease-out_both] motion-reduce:animate-none" style={position}>
            <div className="mb-2 flex items-center justify-between text-xs font-medium"><span>Browser and computer access</span><button type="button" aria-label="Close access details" onClick={() => { setOpen(false); trigger.current?.focus() }} className="rounded p-1 hover:bg-[var(--surface-hover)]"><X size={13} /></button></div>
            <p className="text-[11px] leading-5 text-[var(--color-text-muted)]">{grants.length ? 'Zyra has access to the surfaces below.' : pending ? 'An access request is waiting in chat.' : 'No surfaces are under control.'}</p>
            {grants.length > 0 && <ul className="my-2 max-h-44 space-y-2 overflow-auto">{grants.map((grant) => <li key={grant.grantId} className="flex items-center gap-2 text-[11px]">
                <MousePointer2 size={12} className="shrink-0 text-[var(--accent-secondary)]" /><span className="min-w-0 flex-1 truncate">{state.targets.find((target) => target.targetId === grant.targetId)?.title || 'Connected surface'}</span>
                <button type="button" className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]" onClick={() => { void window.devscope.agentControl.revokeGrant(grant.grantId).then((result) => { if (!result.success) setError(result.error || 'Could not release access.') }).catch(() => setError('Could not release access.')) }}>Release</button>
            </li>)}</ul>}
            {state.pairing.state === 'paired' && <p className="mt-2 text-[10px] text-[var(--color-text-muted)]">Chrome extension connected</p>}
            {error && <p role="alert" className="mt-2 text-[11px] text-[var(--status-danger)]">{error}</p>}
            <button type="button" disabled={busy || (!state.active && state.pairing.state === 'stopped' && !pending)} onClick={() => void stop()} className="mt-3 flex h-8 w-full items-center justify-center gap-2 rounded-md bg-[color-mix(in_srgb,var(--status-danger)_10%,transparent)] text-[11px] text-[var(--status-danger)] transition-colors hover:bg-[color-mix(in_srgb,var(--status-danger)_18%,transparent)] disabled:opacity-40"><Square size={11} />{busy ? 'Stopping…' : 'Emergency stop'}</button>
        </div>, document.body)}
    </>
}
