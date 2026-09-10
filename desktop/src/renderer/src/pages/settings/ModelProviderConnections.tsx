import { useCallback, useEffect, useState } from 'react'
import type { ModelProviderConnection } from '@shared/onboarding/contracts'
import { ModelProviderForm } from '@/components/ui/ModelProviderForm'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { useSettings } from '@/lib/settings'
import { invalidateSettingsModels, loadSettingsModels } from './settings-model-catalog-cache'
import { SettingsActionsMenu } from './SettingsActionsMenu'
import { SettingsNotice, SettingsRow } from './settings-layout'

export function ModelProviderConnections() {
    const { settings, updateSettings } = useSettings()
    const [connections, setConnections] = useState<ModelProviderConnection[]>([])
    const [error, setError] = useState('')
    const [removing, setRemoving] = useState<ModelProviderConnection | null>(null)
    const [busy, setBusy] = useState(false)
    const load = useCallback(async () => {
        const result = await window.devscope.onboarding.listModelProviders()
        if (!result.success) throw new Error(result.error)
        setConnections(result.connections)
    }, [])
    useEffect(() => { void load().catch(error => setError(String(error.message || error))) }, [load])
    async function refresh() { invalidateSettingsModels(); await Promise.all([load(), loadSettingsModels(true)]) }
    async function disconnect() {
        if (!removing || busy) return
        setBusy(true); setError('')
        try {
            const result = await window.devscope.onboarding.disconnectModelProvider(removing.provider)
            if (!result.success) throw new Error(result.error)
            await refresh()
            if (settings.assistantDefaultModel.startsWith(`${removing.provider}/`)) {
                const models = await loadSettingsModels()
                updateSettings({ assistantDefaultModel: models[0]?.id || '' })
            }
            setRemoving(null)
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not disconnect provider.') }
        finally { setBusy(false) }
    }
    return <>
        {error ? <SettingsNotice tone="error">{error}</SettingsNotice> : null}
        {connections.map(connection => <SettingsRow key={connection.provider} title={connection.label} description={connection.model} status={connection.verified ? 'Connected' : 'Reconnect'} control={<SettingsActionsMenu ariaLabel={`Manage ${connection.label}`} label="Manage" items={[
            { id: 'use', label: 'Use for new chats', disabled: !connection.verified, checked: settings.assistantDefaultModel === connection.model, onSelect: () => updateSettings({ assistantDefaultModel: connection.model }) },
            { id: 'remove', label: 'Disconnect', danger: true, onSelect: () => setRemoving(connection) }
        ]} />} />)}
        <details className="p-4" open={connections.length === 0}>
            <summary className="cursor-pointer text-[12px] text-sparkle-text-secondary">Add or replace a provider</summary>
            <div className="mt-4 max-w-md"><ModelProviderForm onConnected={refresh} /></div>
        </details>
        <ConfirmModal isOpen={Boolean(removing)} title={`Disconnect ${removing?.label || 'provider'}?`} message="Remove this saved connection and API key. Chats using it will need another connected model." confirmLabel={busy ? 'Disconnecting…' : 'Disconnect'} variant="warning" onCancel={() => { if (!busy) setRemoving(null) }} onConfirm={() => void disconnect()} />
    </>
}
