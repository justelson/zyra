import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { MessageSquarePlus, Plus, RefreshCw, Repeat2, Unplug } from 'lucide-react'
import type { ModelProviderConnection } from '@shared/onboarding/contracts'
import { HARNESS_PROVIDER_ID, type ChatGptSignInMethod } from '@shared/onboarding/contracts'
import { HarnessConnectPanel } from './providers/HarnessConnectPanel'
import { ModelProviderForm } from '@/components/ui/ModelProviderForm'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { isElectronRendererRuntime } from '@/lib/browser-file-url'
import { useSettings } from '@/lib/settings'
import { invalidateSettingsModels, loadSettingsModels } from './settings-model-catalog-cache'
import { SettingsActionsMenu } from './SettingsActionsMenu'
import { SettingsProviderIcon } from './SettingsProviderIcon'
import { createSettingsRowTargetId } from './settings-search'
import { ProviderAddPicker } from './providers/ProviderAddPicker'
import { ProviderConnectionRow } from './providers/ProviderConnectionRow'
import { availableProviderAddChoices, type ProviderAddKind } from './providers/provider-add-options'
import { SettingsButton, SettingsDialog, SettingsNotice, SettingsSection } from './settings-layout'

export function ModelProviderConnections({ children, notices, onRefresh, refreshDisabled = false, chatGptConfigured = false, openAiConfigured = false, onAddChatGpt, onAddOpenAiKey }: {
    children?: ReactNode
    notices?: ReactNode
    onRefresh?: () => Promise<void>
    refreshDisabled?: boolean
    chatGptConfigured?: boolean
    openAiConfigured?: boolean
    onAddChatGpt?: (signInMethod?: ChatGptSignInMethod) => Promise<void>
    onAddOpenAiKey?: (onBackToProviders: () => void) => void
}) {
    const { settings, updateSettings } = useSettings()
    const desktopHost = isElectronRendererRuntime()
    const [connections, setConnections] = useState<ModelProviderConnection[]>([])
    const [loading, setLoading] = useState(desktopHost)
    const [error, setError] = useState('')
    const [removing, setRemoving] = useState<ModelProviderConnection | null>(null)
    const [busy, setBusy] = useState(false)
    const [adding, setAdding] = useState(false)
    const [addProvider, setAddProvider] = useState<'chatgpt' | 'opencode' | 'anthropic' | 'custom' | 'opencode-harness' | null>(null)
    const [connecting, setConnecting] = useState(false)
    const [providerFormReady, setProviderFormReady] = useState(false)
    const requestId = useRef(0)
    const mounted = useRef(false)
    const currentDefault = useRef(settings.assistantDefaultModel)
    currentDefault.current = settings.assistantDefaultModel
    const load = useCallback(async () => {
        if (!desktopHost) return
        const id = ++requestId.current
        setLoading(true)
        try {
            const result = await window.devscope.onboarding.listModelProviders()
            if (!mounted.current || id !== requestId.current) return
            if (!result.success) throw new Error(result.error)
            setConnections(result.connections)
        } finally {
            if (mounted.current && id === requestId.current) setLoading(false)
        }
    }, [desktopHost])
    useEffect(() => {
        mounted.current = true
        void load().catch(cause => { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Could not load providers.') })
        return () => { mounted.current = false; requestId.current += 1 }
    }, [load])
    async function refresh() {
        invalidateSettingsModels()
        await Promise.all([load(), loadSettingsModels(true)])
    }
    async function refreshConnections() {
        setError('')
        try { await Promise.all([load(), onRefresh?.()]) }
        catch { if (mounted.current) setError('Could not refresh provider connections.') }
    }
    async function connected() {
        try { await refresh(); setError('') }
        catch { if (mounted.current) setError('Provider connected, but its model list could not be refreshed.') }
        finally { if (mounted.current) setAdding(false) }
    }
    const addChoices = availableProviderAddChoices(connections.map(connection => connection.provider), chatGptConfigured, openAiConfigured)
        .filter(choice => choice.id === 'openai-codex' ? Boolean(onAddChatGpt) : choice.id === 'openai' ? Boolean(onAddOpenAiKey) : true)
    const chooseProvider = (provider: ProviderAddKind) => {
        if (provider === 'openai-codex') { setAddProvider('chatgpt'); return }
        if (provider === 'openai') { setAdding(false); onAddOpenAiKey?.(() => setAdding(true)); return }
        setProviderFormReady(false)
        setAddProvider(provider)
    }
    const startChatGptSignIn = (signInMethod: ChatGptSignInMethod) => {
        setAdding(false)
        setAddProvider(null)
        void onAddChatGpt?.(signInMethod)
    }
    const addProviderTitle = addProvider === 'chatgpt' ? 'Connect ChatGPT subscription'
        : addProvider === 'opencode' ? 'Connect OpenCode Zen'
            : addProvider === 'anthropic' ? 'Connect Claude API'
                : addProvider === 'opencode-harness' ? 'Connect OpenCode harness'
                    : addProvider === 'custom' ? 'Connect custom endpoint'
                        : 'Add provider'
    const addProviderIcon = addProvider === 'chatgpt' ? 'chatgpt'
        : addProvider === 'anthropic' ? 'claude'
            : addProvider === 'custom' ? 'custom-provider'
                : addProvider
    const addProviderDescription = addProvider === 'chatgpt'
        ? 'Sign in to use your ChatGPT subscription with OpenAI models in Zyra.'
        : addProvider === 'opencode'
            ? 'Uses a Zen API key. OpenCode restricts its public free tier to its own app. Zyra verifies model access before saving.'
            : addProvider === 'anthropic'
                ? 'Uses Anthropic API credits. Claude subscription sign-in is not supported. Zyra verifies model access before saving.'
                : addProvider === 'custom'
                    ? 'Choose an API format supported by this endpoint. Zyra verifies model access before saving.'
                    : undefined
    const providerFormId = addProvider && ['opencode', 'anthropic', 'custom'].includes(addProvider) ? `connect-provider-${addProvider}` : undefined
    const replaceProvider = (provider: string) => {
        setProviderFormReady(false)
        setAddProvider(provider === 'anthropic' ? 'anthropic' : provider === 'opencode' ? 'opencode' : provider === HARNESS_PROVIDER_ID ? 'opencode-harness' : 'custom')
        setAdding(true)
    }
    async function disconnect() {
        if (!removing || busy) return
        const provider = removing.provider
        setBusy(true); setError('')
        let disconnected = false
        try {
            const result = await window.devscope.onboarding.disconnectModelProvider(provider)
            if (!result.success) throw new Error(result.error)
            disconnected = true
            if (mounted.current) {
                setConnections(current => current.filter(connection => connection.provider !== provider))
                setRemoving(null)
            }
            await refresh()
            const previousDefault = currentDefault.current
            if (previousDefault.startsWith(`${provider}/`)) {
                const models = await loadSettingsModels()
                if (currentDefault.current === previousDefault) updateSettings({ assistantDefaultModel: models[0]?.id || '' })
            }
            if (mounted.current) setRemoving(null)
        } catch (cause) {
            if (mounted.current) setError(disconnected ? 'Provider disconnected, but the model list could not be refreshed.' : cause instanceof Error ? cause.message : 'Could not disconnect provider.')
        } finally { if (mounted.current) setBusy(false) }
    }
    return <>
        <SettingsSection title="Connections" headerAction={desktopHost ? <SettingsButton variant="ghost" onClick={() => void refreshConnections()} disabled={loading || busy || connecting || refreshDisabled}><RefreshCw size={13} className={loading ? 'animate-spin motion-reduce:animate-none' : ''} />Refresh</SettingsButton> : undefined}>
            {notices}
            {error ? <SettingsNotice tone="error">{error}<SettingsButton variant="ghost" onClick={() => { setError(''); void load().catch(() => setError('Could not refresh providers.')) }}>Retry</SettingsButton></SettingsNotice> : null}
            {loading ? <SettingsNotice>Checking provider connections…</SettingsNotice> : null}
            {children}
            {connections.map(connection => <ProviderConnectionRow key={connection.provider} title={connection.label} description={connection.model}
                icon={<SettingsProviderIcon provider={connection.provider === 'anthropic' ? 'claude' : connection.provider} />}
                status={connection.verified ? 'Connected' : 'Needs attention'} statusTone={connection.verified ? 'ready' : 'warning'}
                control={desktopHost ? <SettingsActionsMenu ariaLabel={`Manage ${connection.label}`} label="Manage" disabled={busy || connecting} items={[
                    { id: 'use', label: 'Use for new chats', icon: <MessageSquarePlus size={13} />, disabled: !connection.verified, checked: settings.assistantDefaultModel === connection.model, onSelect: () => updateSettings({ assistantDefaultModel: connection.model }) },
                    { id: 'replace', label: 'Replace connection', icon: <Repeat2 size={13} />, onSelect: () => replaceProvider(connection.provider) },
                    { id: 'remove', label: 'Disconnect', icon: <Unplug size={13} />, danger: true, separatorBefore: true, onSelect: () => setRemoving(connection) }
                ]} /> : undefined} />)}
            {desktopHost && addChoices.length > 0 ? <div data-settings-search-target={!chatGptConfigured ? createSettingsRowTargetId('OpenAI connections', 'ChatGPT subscription') : undefined} tabIndex={-1}>
                <div data-settings-search-target={!openAiConfigured ? createSettingsRowTargetId('OpenAI connections', 'OpenAI API key') : undefined} tabIndex={-1}>
                <button type="button" data-add-provider-row="true"
                disabled={loading || busy || connecting}
                onClick={() => { setAddProvider(null); setAdding(true) }}
                className="flex h-9 w-full items-center justify-center gap-2 rounded-b-xl px-3 text-[12px] font-medium text-[var(--settings-text-secondary)] transition-colors hover:bg-[var(--settings-row-hover)] hover:text-[var(--settings-text)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-primary)] disabled:cursor-not-allowed disabled:opacity-45">
                <Plus size={13} />Add provider
                </button></div>
            </div> : null}
        </SettingsSection>
        <SettingsDialog open={adding} title={addProviderTitle} titleIcon={addProviderIcon ? <SettingsProviderIcon provider={addProviderIcon} /> : undefined} description={addProviderDescription} descriptionMode="info" onClose={() => { if (!connecting) setAdding(false) }}
            footer={<>{addProvider ? <SettingsButton variant="ghost" disabled={connecting} onClick={() => { setProviderFormReady(false); setAddProvider(null) }}>Back</SettingsButton> : <SettingsButton variant="ghost" disabled={connecting} onClick={() => setAdding(false)}>Cancel</SettingsButton>}{providerFormId ? <SettingsButton type="submit" form={providerFormId} variant="accent" className="min-w-44" disabled={connecting || !providerFormReady}>{connecting ? 'Connecting…' : 'Connect provider'}</SettingsButton> : null}</>}>
            {adding ? addProvider ? addProvider === 'chatgpt' ? <div className="space-y-3">
                <SettingsButton variant="accent" className="w-full" onClick={() => startChatGptSignIn('browser')}>Continue with browser</SettingsButton>
                <SettingsButton variant="ghost" className="w-full" onClick={() => startChatGptSignIn('device-code')}>Use device code instead</SettingsButton>
            </div> : addProvider === 'opencode-harness' ? <HarnessConnectPanel onConnected={connected} onBusyChange={setConnecting} /> : <ModelProviderForm key={addProvider} formId={providerFormId} initialProvider={addProvider} lockProvider onConnected={connected} onBusyChange={setConnecting} onReadyChange={setProviderFormReady} /> : <ProviderAddPicker choices={addChoices} onSelect={chooseProvider} builtInBusy={refreshDisabled} /> : null}
        </SettingsDialog>
        <ConfirmModal isOpen={Boolean(removing)} title={`Disconnect ${removing?.label || 'provider'}?`} message={removing?.provider === HARNESS_PROVIDER_ID ? 'Remove this saved harness connection and stop its local server. Your OpenCode login stays untouched. Chats using it will need another connected model.' : 'Remove this saved connection and API key. Chats using it will need another connected model.'} confirmLabel={busy ? 'Disconnecting…' : 'Disconnect'} variant="warning" onCancel={() => { if (!busy) setRemoving(null) }} onConfirm={() => void disconnect()} />
    </>
}
