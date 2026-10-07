import { useState } from 'react'
import { MessageSquarePlus, MonitorSmartphone, RefreshCw, Unplug } from 'lucide-react'
import type { ChatGptAccountProfile } from '@shared/onboarding/contracts'
import { SettingsActionsMenu } from '../SettingsActionsMenu'
import { SettingsProviderIcon } from '../SettingsProviderIcon'
import { SettingsButton, SettingsDialog } from '../settings-layout'
import { ProviderConnectionRow } from './ProviderConnectionRow'
import { createSettingsRowTargetId } from '../settings-search'
import { accountLabel, accountPlan } from './chatgpt-account-presentation'
import type { useChatGptAccountPool } from './useChatGptAccountPool'
import type { useOpenAIAccountSettings } from './useOpenAIAccountSettings'

export function ChatGptConnectionRows({ connection, pool }: { connection: ReturnType<typeof useOpenAIAccountSettings>; pool: ReturnType<typeof useChatGptAccountPool> }) {
    const [remove, setRemove] = useState<ChatGptAccountProfile | null>(null)
    const busy = pool.busy || connection.connectionBusy
    const connect = async (accountId?: string, device = false) => { await connection.connectChatGpt(device ? 'device-code' : 'browser', accountId); await pool.refresh() }
    const disconnect = async () => {
        if (!remove) return
        if (!await pool.update({ action: 'remove', accountId: remove.id, confirmed: true })) return
        await connection.refreshAll()
        setRemove(null)
    }
    return <>
            {pool.snapshot?.accounts.map(account => <ProviderConnectionRow key={account.id} data-chatgpt-connection-account={account.id} icon={<SettingsProviderIcon provider="chatgpt" />} title={`ChatGPT · ${accountLabel(account)}`} description={`${accountPlan(account)}${account.primary ? ' · Primary' : ''}`} info={account.primary ? 'This account also provides Voice and reset credits.' : undefined} status={account.state === 'needs-sign-in' ? 'Sign in again' : 'Connected'} statusTone={account.state === 'needs-sign-in' ? 'warning' : 'ready'} searchTargetId={account.primary ? createSettingsRowTargetId('OpenAI connections', 'ChatGPT subscription') : undefined} control={connection.desktopHost ? <SettingsActionsMenu disabled={busy} ariaLabel={`Manage ${accountLabel(account)}`} items={[
                { id: 'reconnect', label: 'Sign in again', icon: <RefreshCw size={13} />, onSelect: () => void connect(account.id) },
                { id: 'device', label: 'Reconnect with device code', icon: <MonitorSmartphone size={13} />, onSelect: () => void connect(account.id, true) },
                ...(account.primary && connection.chatGptConnection?.verified ? [{ id: 'default', label: 'Use for new chats', icon: <MessageSquarePlus size={13} />, checked: connection.activeDefaultMethod === 'chatgpt', disabled: connection.activeDefaultMethod === 'chatgpt', onSelect: () => void connection.switchDefaultConnection('chatgpt') }] : []),
                { id: 'remove', label: 'Disconnect account', icon: <Unplug size={13} />, danger: true, separatorBefore: true, onSelect: () => setRemove(account) }
            ]} /> : undefined} />)}
        <SettingsDialog open={remove !== null} title="Disconnect this ChatGPT account?" description={`Remove ${remove ? accountLabel(remove) : 'this account'} from Zyra. Other connected accounts are kept.`} onClose={() => { if (!busy) setRemove(null) }} footer={<><SettingsButton variant="ghost" disabled={busy} onClick={() => setRemove(null)}>Cancel</SettingsButton><SettingsButton variant="danger" disabled={busy} onClick={() => void disconnect()}>Disconnect</SettingsButton></>}>{null}</SettingsDialog>
    </>
}
