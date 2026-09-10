import { Chrome, Copy, LoaderCircle } from 'lucide-react'
import type { ControlPairingState } from '@shared/agent-control/contracts'

export function AssistantChromePairing({ pairing, busy, onStart, onStop }: {
    pairing: ControlPairingState
    busy: boolean
    onStart: () => void
    onStop: () => void
}) {
    return (
        <section className="p-2.5">
            <div className="border border-white/[0.07] bg-white/[0.02] p-3">
                <Chrome size={16} className="text-[var(--accent-primary)]" />
                <h3 className="mt-2 text-[11px] font-semibold text-sparkle-text-secondary">Connect Chrome</h3>
                <p className="mt-1 text-[9px] leading-4 text-sparkle-text-muted/65">Connect Zyra Browser, then choose which tabs to share with Read or Control access. Install it from Settings → Device connections.</p>
                {pairing.state === 'waiting' ? (
                    <div className="mt-3 border border-[var(--accent-primary)]/20 bg-[var(--accent-primary)]/[0.06] p-2">
                        <div className="text-[8px] text-sparkle-text-muted/55">Loopback port</div>
                        <div className="font-mono text-[12px] text-sparkle-text-secondary">{pairing.port}</div>
                        <div className="mt-2 text-[8px] text-sparkle-text-muted/55">Short-lived pairing code</div>
                        <button type="button" onClick={() => void navigator.clipboard.writeText(pairing.code || '')} className="mt-0.5 inline-flex items-center gap-1 font-mono text-[15px] tracking-[0.18em] text-[var(--accent-primary)]"><Copy size={10} />{pairing.code}</button>
                        <div className="mt-1 text-[8px] text-sparkle-text-muted/45">Expires {pairing.expiresAt ? new Date(pairing.expiresAt).toLocaleTimeString() : 'soon'}</div>
                    </div>
                ) : pairing.state === 'paired' ? <p className="mt-3 text-[9px] text-emerald-200/80">Extension paired. Use its popup to choose the tabs you want to share.</p> : null}
                <div className="mt-3 flex gap-1.5">
                    <button type="button" disabled={busy || pairing.state === 'waiting'} onClick={onStart} className="inline-flex h-7 flex-1 items-center justify-center gap-1 border border-[var(--accent-primary)]/25 bg-[var(--accent-primary)]/[0.08] text-[9px] disabled:opacity-40">{busy ? <LoaderCircle size={10} className="animate-spin" /> : null}Pair Chrome</button>
                    <button type="button" disabled={busy || pairing.state === 'stopped'} onClick={onStop} className="h-7 flex-1 border border-white/[0.08] text-[9px] disabled:opacity-40">Disconnect</button>
                </div>
            </div>
        </section>
    )
}
