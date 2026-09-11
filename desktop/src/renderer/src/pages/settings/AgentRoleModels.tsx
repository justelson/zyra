import { useEffect, useState } from 'react'
import type { AgentRoleModels as RoleModels } from '@shared/onboarding/contracts'
import type { AssistantModelInfo } from '@shared/assistant/contracts'
import { providerFeatures } from '@shared/assistant/provider-features'
import { loadSettingsModels } from './settings-model-catalog-cache'
import { SettingsNotice, SettingsRow } from './settings-layout'

const roles = { planner: 'Planning', implementer: 'Implementation', reviewer: 'Review', debugger: 'Debugging', verifier: 'Verification', researcher: 'Research', specialist: 'Other agents' } as const
const selectClass = 'max-w-[260px] min-w-0 rounded-lg border border-[var(--surface-border)] bg-[var(--color-bg)] px-3 py-2 text-[12px] text-sparkle-text'
export function AgentRoleModels() {
    const [models, setModels] = useState<AssistantModelInfo[]>([])
    const [preferences, setPreferences] = useState<RoleModels>({})
    const [provider, setProvider] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    useEffect(() => {
        let live = true
        void Promise.all([loadSettingsModels(), window.devscope.onboarding.getAgentRoleModels()]).then(([models, result]) => {
            if (!live) return
            if (!result.success) throw new Error(result.error)
            setModels(models); setPreferences(result.models); setProvider(models[0]?.id.split('/')[0] || Object.keys(result.models)[0] || '')
        }).catch(error => { if (live) setError(error.message) })
        return () => { live = false }
    }, [])
    const providers = [...new Set([...models.map(model => model.id.split('/')[0]), ...Object.keys(preferences)])]
    async function save(role: string, model: string) {
        setBusy(true); setError('')
        try {
            const result = await window.devscope.onboarding.setAgentRoleModel({ provider, role, model })
            if (!result.success) throw new Error(result.error)
            setPreferences(result.models)
        } catch (error) { setError(error instanceof Error ? error.message : 'Could not save agent model.') }
        finally { setBusy(false) }
    }
    return <details className="border-t border-[var(--surface-border)] p-4">
        <summary className="cursor-pointer text-[12px] font-medium text-sparkle-text">Models for delegated work</summary>
        <p className="my-3 text-[12px] leading-5 text-sparkle-text-secondary">Choose defaults for agents launched from chats using each provider. Saved definitions with an explicit model keep that choice. Changes apply to the next agent you launch.</p>
        {error ? <SettingsNotice tone="error">{error}</SettingsNotice> : null}
        {providers.length ? <>
            <select aria-label="Agent model provider" className={selectClass} value={provider} disabled={busy} onChange={event => setProvider(event.target.value)}>{providers.map(id => <option key={id} value={id}>{id.startsWith('custom-') ? id.slice(7) : providerFeatures(id).label}</option>)}</select>
            {Object.entries(roles).map(([role, label]) => {
                const selected = preferences[provider]?.[role as keyof typeof roles] || 'inherit'
                const choices = models.filter(model => model.id.startsWith(`${provider}/`))
                return <SettingsRow key={role} title={label} description={null} control={<select aria-label={`${label} model`} className={selectClass} value={selected} disabled={busy} onChange={event => void save(role, event.target.value)}>
                    <option value="inherit">Same as the chat</option>
                    {selected !== 'inherit' && !choices.some(model => model.id === selected) ? <option value={selected}>{selected} (unavailable)</option> : null}
                    {choices.map(model => <option key={model.id} value={model.id}>{model.id}</option>)}
                </select>} />
            })}
        </> : <SettingsNotice>Connect a provider to choose agent models.</SettingsNotice>}
    </details>
}
