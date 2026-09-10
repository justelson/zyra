import { useEffect, useState } from 'react'
import { Copy, FolderOpen } from 'lucide-react'
import type { ControlPairingState } from '@shared/agent-control/contracts'
import { SettingsButton, SettingsRow, SettingsSection } from './settings-layout'
import chromeLogo from '@/assets/browser-logos/chrome.svg'

export function ChromeBrowserConnectionSettings() {
    const [pairing, setPairing] = useState<ControlPairingState>({ state: 'stopped' })
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [copied, setCopied] = useState(false)
    useEffect(() => {
        let disposed = false
        void window.devscope.agentControl.getState().then(result => { if (!disposed && result.success) setPairing(result.state.pairing) }).catch(() => { if (!disposed) setError('Could not read the Chrome connection.') })
        const unsubscribe = window.devscope.agentControl.onStateChange(state => setPairing(state.pairing))
        return () => { disposed = true; unsubscribe() }
    }, [])
    const run = async (operation: () => Promise<{ success: boolean; error?: string }>) => {
        setBusy(true); setError(null)
        try { const result = await operation(); if (!result.success) throw new Error(result.error || 'Could not update the Chrome connection.') }
        catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update the Chrome connection.') }
        finally { setBusy(false) }
    }
    return <SettingsSection title="Chrome browser">
        <SettingsRow title={<span className="inline-flex items-center gap-2"><img src={chromeLogo} width={16} height={16} alt="" aria-hidden="true" />Zyra Browser extension</span>} description="Connect Chrome tabs for read or control access from chat." status={pairing.state === 'paired' ? 'Connected' : pairing.state === 'waiting' ? 'Waiting for Chrome' : 'Disconnected'} statusTone={pairing.state === 'paired' ? 'ready' : 'muted'} control={<>
            <SettingsButton variant="ghost" disabled={busy} onClick={() => void run(() => window.devscope.agentControl.openChromeExtensionFolder())}><FolderOpen size={12} />Extension folder</SettingsButton>
            {pairing.state === 'stopped' || pairing.state === 'error' ? <SettingsButton disabled={busy} onClick={() => void run(() => window.devscope.agentControl.startChromePairing())}>Connect Chrome</SettingsButton> : <SettingsButton disabled={busy} onClick={() => void run(() => window.devscope.agentControl.stopChromePairing())}>{pairing.state === 'waiting' ? 'Cancel pairing' : 'Disconnect'}</SettingsButton>}
        </>}>
            {pairing.state === 'waiting' && <div className="mt-3 flex flex-wrap items-center gap-5 rounded-lg border border-[var(--settings-border)] bg-[var(--settings-control)] px-3 py-3 text-xs">
                <div><div className="mb-1 text-[var(--settings-text-secondary)]">Pairing code</div><button className="flex items-center gap-2 font-mono text-base tracking-widest" aria-label="Copy pairing code" onClick={() => void run(async () => { const result = await window.devscope.copyToClipboard(pairing.code || ''); if (result.success) setCopied(true); return result })}>{pairing.code}<Copy size={12} /></button>{copied && <span className="text-[10px]">Copied</span>}</div>
                <div><div className="mb-1 text-[var(--settings-text-secondary)]">Port</div><code className="select-all text-base">{pairing.port}</code></div>
                <p className="basis-full text-[11px] text-[var(--settings-text-secondary)]">Enter these in the extension's Connect tab. This code expires in five minutes.</p>
            </div>}
            <details className="mt-3 text-xs text-[var(--settings-text-secondary)]"><summary className="cursor-pointer">First-time setup</summary><div className="pt-3"><ol className="list-decimal space-y-2 pl-4"><li>Open the extension folder using the button in this row.</li><li>In Chrome, open chrome://extensions, enable Developer mode and load that folder unpacked.</li><li>Connect Chrome here, then enter the code and port in the extension's Connect tab.</li><li>Choose which tabs to share with Read or Control access.</li></ol></div></details>
            {error && <p role="alert" className="mt-2 text-xs text-[var(--status-danger)]">{error}</p>}
        </SettingsRow>
    </SettingsSection>
}
