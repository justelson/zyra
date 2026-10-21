import { useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { runtimeLifecyclePresentation } from '@shared/runtime-activation'
import { useRuntimeConnection } from '@/lib/runtime-connection'
import { SettingsButton, SettingsNotice, SettingsRow, SettingsSection } from './settings-layout'
import { SettingsKeyValueList } from './SettingsKeyValueList'

export function RuntimeLifecycleSection() {
    const runtime = useRuntimeConnection()
    const lifecycle = runtimeLifecyclePresentation(runtime.state)
    const api = window.devscope.runtimeActivation
    const [pending, setPending] = useState<'refresh' | 'activate' | null>(null)
    const [error, setError] = useState<string | null>(null)
    const inFlight = useRef(false)
    const run = async (action: 'refresh' | 'activate') => {
        if (inFlight.current) return
        const operation = action === 'refresh' ? api?.refresh : api?.activateUpdate
        if (!operation) return
        inFlight.current = true
        setPending(action); setError(null)
        try { await operation() }
        catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not confirm the agent status. Refresh and try again.') }
        finally { inFlight.current = false; setPending(null) }
    }
    const codeLabel = lifecycle.codeState === 'current' ? 'Installed code active'
        : lifecycle.codeState === 'pending' ? 'Installed code not active' : 'Active code not confirmed'
    const description = lifecycle.codeState === 'pending'
        ? 'Installed and running agent code differ. Activation replaces only an idle agent with the installed code. Running work is never stopped automatically.'
        : lifecycle.codeState === 'current'
            ? 'The running agent matches the code installed with this app. This does not verify a particular bug fix.'
            : 'Refresh the connection to compare installed code with the running agent. Closing the app does not stop its work.'
    const short = (value?: string | null) => value ? <span className="font-mono" title={value}>{value.slice(0, 12)}</span> : 'Not confirmed'
    return <SettingsSection title="Background agent">
        <SettingsRow title="Connection" description={runtime.message || 'The agent owns running chats, workflows and background processes independently of the window.'}
            status={runtime.detail} statusTone={runtime.live ? 'ready' : 'warning'}
            control={api?.refresh ? <SettingsButton disabled={pending !== null} onClick={() => void run('refresh')}>
                <RefreshCw size={12} className={pending === 'refresh' ? 'animate-spin motion-reduce:animate-none' : ''} />
                {pending === 'refresh' ? 'Refreshing…' : runtime.live ? 'Refresh status' : 'Reconnect'}
            </SettingsButton> : undefined} />
        <SettingsRow title="Agent update" description={description} status={codeLabel}
            statusTone={lifecycle.codeState === 'current' ? 'ready' : 'warning'}
            control={api?.activateUpdate ? <SettingsButton disabled={pending !== null || !lifecycle.canActivate} onClick={() => void run('activate')}>
                {pending === 'activate' ? 'Activating…' : 'Activate agent update'}
            </SettingsButton> : undefined} />
        {lifecycle.blockers.length > 0 ? <SettingsNotice tone="warning">Waiting for {lifecycle.blockers.join(', ')}. Finish or explicitly stop that work, then refresh. Nothing is cancelled by this page.</SettingsNotice> : null}
        {!api?.activateUpdate ? <SettingsNotice>Manage agent updates in the Desktop app. This connection is read-only.</SettingsNotice> : null}
        {error ? <div role="alert"><SettingsNotice tone="error">{error}</SettingsNotice></div> : null}
        <details className="border-t border-[var(--settings-row-divider)]">
            <summary className="cursor-pointer px-4 py-3 text-[12px] text-[var(--settings-text-secondary)]">Agent details</summary>
            <SettingsKeyValueList label="Agent details" items={[
                { id: 'app', label: 'Desktop version', value: runtime.state.installation?.appVersion || 'Not confirmed' },
                { id: 'installed', label: 'Installed agent code', value: short(runtime.state.expectedRuntimeRevision) },
                { id: 'active', label: 'Last observed agent code', value: short(runtime.state.instance?.runtimeRevision) },
                { id: 'instance', label: 'Last observed instance', value: runtime.state.instance?.instanceId.slice(0, 12) || 'Not confirmed' },
                { id: 'confirmed', label: 'Last confirmed', value: runtime.state.lastConfirmedAt ? new Date(runtime.state.lastConfirmedAt).toLocaleString() : 'Not confirmed' }
            ]} />
        </details>
    </SettingsSection>
}
