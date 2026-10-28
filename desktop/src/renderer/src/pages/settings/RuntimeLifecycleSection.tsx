import { useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { runtimeLifecyclePresentation, type RuntimeActivationStatus } from '@shared/runtime-activation'
import type { AgentUpdatePlan } from '@shared/agent-update'
import { AgentUpdateDialog, updateBlockerRows } from '@/components/updates/AgentUpdateDialog'
import { useRuntimeConnection } from '@/lib/runtime-connection'
import { SettingsButton, SettingsRow, SettingsSection } from './settings-layout'
import { SettingsInfoTooltip } from './SettingsInfoTooltip'
import { SettingsKeyValueList } from './SettingsKeyValueList'

export function RuntimeLifecycleSection() {
    const runtime = useRuntimeConnection()
    const lifecycle = runtimeLifecyclePresentation(runtime.state)
    const api = window.devscope.runtimeActivation
    const [pending, setPending] = useState<'refresh' | 'activate' | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [review, setReview] = useState(false)
    const [plan, setPlan] = useState<AgentUpdatePlan | null>(null)
    const inFlight = useRef(false)
    const activating = useRef(false)
    const reviewGeneration = useRef(0)
    const toPlan = (state: RuntimeActivationStatus): AgentUpdatePlan => {
        const view = runtimeLifecyclePresentation(state)
        return { id: state.instance?.instanceId || '', version: state.installation?.appVersion || '', agentServerUpdate: true,
            state: view.codeState !== 'pending' || !view.activityKnown ? 'unknown' : view.blockers.length ? 'blocked' : 'ready',
            instanceId: state.instance?.instanceId, namespaceId: state.instance?.namespaceId, activity: state.activity,
            expiresAt: new Date(Date.now() + 60_000).toISOString() }
    }
    const refresh = async (forReview = false) => {
        if (inFlight.current || !api?.refresh) return
        const generation = ++reviewGeneration.current
        inFlight.current = true; setPending('refresh'); setError(null)
        if (forReview) { setReview(true); setPlan(null) }
        try {
            const state = await api.refresh()
            if (forReview && generation === reviewGeneration.current) setPlan(toPlan(state))
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not confirm agent status.') }
        finally { inFlight.current = false; setPending(null) }
    }
    const activate = async (stopBlockers: boolean) => {
        if (inFlight.current || !api?.activateUpdate || !plan?.instanceId) return
        if (Date.parse(plan.expiresAt) <= Date.now()) { setError('The check expired. Review again.'); setPlan(null); return }
        inFlight.current = true; activating.current = true; setPending('activate'); setError(null)
        try {
            const result = await api.activateUpdate({ expectedInstanceId: plan.instanceId, stopBlockers })
            if (runtimeLifecyclePresentation(result).codeState !== 'current') throw new Error('Work changed. Refresh and review again.')
            setReview(false); setPlan(null)
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'The agent update did not finish.'); setPlan(null) }
        finally { inFlight.current = false; activating.current = false; setPending(null) }
    }
    const codeLabel = lifecycle.codeState === 'current' ? 'Up to date' : lifecycle.codeState === 'pending' ? 'Update ready' : 'Unconfirmed'
    const short = (value?: string | null) => value ? <span className="font-mono" title={value}>{value.slice(0, 12)}</span> : 'Not confirmed'
    return <>
        <SettingsSection title="Background agent">
            <SettingsRow className="[&_p]:truncate" title="Connection" description={runtime.live ? 'Runs independently of this window.' : 'Refresh to confirm agent status.'}
                info={runtime.message || 'Closing the app does not stop running chats or background work.'}
                status={runtime.detail} statusTone={runtime.live ? 'ready' : 'warning'}
                control={api?.refresh ? <SettingsButton disabled={pending !== null} onClick={() => void refresh()}>
                    <RefreshCw size={12} className={pending === 'refresh' ? 'animate-spin motion-reduce:animate-none' : ''} />
                    {pending === 'refresh' ? 'Refreshing…' : runtime.live ? 'Refresh' : 'Reconnect'}
                </SettingsButton> : undefined} />
            <SettingsRow className="[&_p]:truncate" title="Agent update" description={lifecycle.codeState === 'current' ? 'Installed code is running.' : lifecycle.codeState === 'pending' ? 'Review work before updating.' : 'Active code is not confirmed.'}
                info="Installed and active code are checked separately. Matching code does not verify a particular bug fix. Updates never stop work without your confirmation."
                status={codeLabel} statusTone={lifecycle.codeState === 'current' ? 'ready' : 'warning'}
                control={api?.activateUpdate ? <SettingsButton disabled={pending !== null || lifecycle.codeState !== 'pending'} onClick={() => void refresh(true)}>Review update</SettingsButton> : undefined} />
            {lifecycle.blockers.length ? <details className="border-t border-[var(--settings-row-divider)]">
                <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-[12px] text-[var(--settings-text-secondary)]">Work running<span>{lifecycle.blockers.length} {lifecycle.blockers.length === 1 ? 'category' : 'categories'}</span></summary>
                <ul className="px-4 pb-3">{updateBlockerRows.map(([key, label]) => runtime.state.activity?.[key] ? <li key={key} className="flex justify-between py-1 text-[12px] text-[var(--settings-text-secondary)]"><span>{label}</span><span>{runtime.state.activity[key]}</span></li> : null)}</ul>
            </details> : null}
            {!api?.activateUpdate ? <div className="px-4 py-3 text-[12px] text-[var(--settings-text-muted)]">This connection is read-only.</div> : null}
            {error && !review ? <div role="alert" className="flex items-center gap-1 px-4 py-2 text-[12px] text-[var(--status-danger)]">Agent check failed.<SettingsInfoTooltip label="Agent error">{error}</SettingsInfoTooltip></div> : null}
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
        {review ? <AgentUpdateDialog kind="runtime" plan={plan} checking={pending === 'refresh'} busy={pending === 'activate'} error={error}
            onLater={() => { if (!activating.current) { reviewGeneration.current++; setReview(false); setPlan(null); setError(null) } }}
            onRefresh={() => void refresh(true)} onConfirm={stop => void activate(stop)} /> : null}
    </>
}
