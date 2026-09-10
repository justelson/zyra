import { useState } from 'react'
import type { ModelProviderInput, ModelProviderConnection } from '@shared/onboarding/contracts'
import { useSettings } from '@/lib/settings'

const field = 'h-10 w-full min-w-0 rounded-lg border border-[var(--surface-border)] bg-[var(--color-bg)] px-3 text-[12px] text-sparkle-text outline-none focus:border-[var(--accent-primary)]'
export function ModelProviderForm({ onConnected }: { onConnected?: (connection: ModelProviderConnection) => void | Promise<void> }) {
    const { updateSettings } = useSettings()
    const [provider, setProvider] = useState<ModelProviderInput['provider']>('opencode')
    const [apiKey, setApiKey] = useState('')
    const [name, setName] = useState('')
    const [baseUrl, setBaseUrl] = useState('')
    const [model, setModel] = useState('')
    const [api, setApi] = useState<ModelProviderInput['api']>('openai-completions')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [success, setSuccess] = useState('')
    async function connect() {
        if (busy) return
        setBusy(true); setError(''); setSuccess('')
        try {
            const result = await window.devscope.onboarding.connectModelProvider({ provider, apiKey, name, baseUrl, model, api })
            if (!result.success) throw new Error(result.error)
            setApiKey('')
            updateSettings({ assistantDefaultModel: result.connection.model })
            setSuccess(`${result.connection.label} connected`)
            await onConnected?.(result.connection)
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not connect this provider.') }
        finally { setBusy(false) }
    }
    return <form className="space-y-3 text-left" onSubmit={event => { event.preventDefault(); void connect() }}>
        <label className="block text-[12px] text-sparkle-text-secondary">Provider
            <select className={`${field} mt-1.5`} value={provider} disabled={busy} onChange={event => { setProvider(event.target.value as ModelProviderInput['provider']); setApiKey(''); setModel(''); setError(''); setSuccess('') }}>
                <option value="opencode">OpenCode Zen</option><option value="anthropic">Claude API</option><option value="custom">Custom endpoint</option>
            </select>
        </label>
        {provider === 'custom' ? <>
            <input className={field} aria-label="Provider name" placeholder="Provider name" value={name} disabled={busy} onChange={event => setName(event.target.value)} required />
            <input className={field} aria-label="API base URL" placeholder="https://your-provider.com/v1" value={baseUrl} disabled={busy} onChange={event => setBaseUrl(event.target.value)} required />
            <select className={field} aria-label="API format" value={api} disabled={busy} onChange={event => setApi(event.target.value as ModelProviderInput['api'])}>
                <option value="openai-completions">Chat Completions</option><option value="openai-responses">Responses</option><option value="anthropic-messages">Anthropic Messages</option>
            </select>
        </> : null}
        <input className={field} type="password" aria-label={`${provider === 'anthropic' ? 'Claude' : provider === 'opencode' ? 'Zen' : 'Provider'} API key`} placeholder="API key" autoComplete="off" spellCheck={false} value={apiKey} disabled={busy} onChange={event => setApiKey(event.target.value)} required />
        <input className={field} aria-label="Model ID" placeholder="Model ID (optional, detected when available)" value={model} disabled={busy} onChange={event => setModel(event.target.value)} />
        <p className="text-[11px] leading-5 text-sparkle-text-secondary">{provider === 'opencode' ? 'Connect with a Zen API key. OpenCode currently restricts its public free tier to its own app.' : provider === 'anthropic' ? 'Uses your Anthropic API credits. Claude subscription sign-in is not supported.' : 'Use a provider that supports one of these API formats.'} A short request verifies model access.</p>
        <button className="h-10 w-full rounded-full bg-[var(--accent-primary)] px-4 text-[12px] font-medium text-[var(--accent-on-primary)] transition-opacity hover:opacity-90 disabled:opacity-50" disabled={busy || !apiKey.trim()}>{busy ? 'Connecting…' : 'Connect and use provider'}</button>
        {error || success ? <p role={error ? 'alert' : 'status'} className={`text-[12px] leading-5 ${error ? 'text-[var(--status-danger)]' : 'text-[var(--status-success)]'}`}>{error || success}</p> : null}
    </form>
}
