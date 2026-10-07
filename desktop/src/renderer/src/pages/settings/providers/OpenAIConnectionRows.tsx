import { KeyRound, MessageSquarePlus, MonitorSmartphone, RefreshCw, Unplug } from 'lucide-react'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { SettingsProviderIcon } from '../SettingsProviderIcon'
import { SettingsActionsMenu } from '../SettingsActionsMenu'
import { SettingsButton, SettingsDialog, SettingsInput, SettingsNotice } from '../settings-layout'
import { ProviderConnectionRow } from './ProviderConnectionRow'
import { createSettingsRowTargetId } from '../settings-search'
import { connectionStatusLabel, connectionStatusTone, useOpenAIAccountSettings } from './useOpenAIAccountSettings'
import { ChatGptAuthenticationSuccess } from './ChatGptAuthenticationSuccess'
import { ChatGptDeviceCodeDialog } from './ChatGptDeviceCodeDialog'

export function OpenAIConnectionNotices({ connection }: { connection: ReturnType<typeof useOpenAIAccountSettings> }) {
    const { desktopHost, connectionError, connectionAction, connectionBusy, refreshAll, cancelChatGpt } = connection
    return <>
        {!desktopHost ? <SettingsNotice tone="neutral">Open Zyra Desktop on this computer to manage OpenAI credentials.</SettingsNotice> : null}
        {connectionError ? <SettingsNotice tone="error">{connectionError}<SettingsButton variant="ghost" disabled={connectionBusy} onClick={() => void refreshAll()}>Retry</SettingsButton></SettingsNotice> : null}
        {connectionAction === 'chatgpt' ? <SettingsNotice>Waiting for ChatGPT sign-in… <SettingsButton variant="ghost" onClick={() => void cancelChatGpt()}>Cancel sign-in</SettingsButton></SettingsNotice> : null}
    </>
}

export function OpenAIConnectionRows({ connection, onBackToProviders, showChatGpt = true, showNotices = true }: { connection: ReturnType<typeof useOpenAIAccountSettings>; onBackToProviders?: () => void; showChatGpt?: boolean; showNotices?: boolean }) {
    const { desktopHost, connectionAction, apiKeyDialogOpen, setApiKeyDialogOpen, apiKeyDraft, setApiKeyDraft, disconnectMethod, setDisconnectMethod, chatGptAuthenticationSuccessOpen, setChatGptAuthenticationSuccessOpen, chatGptDeviceCode, chatGptDeviceCodeOpen, dismissChatGptDeviceCode, connectChatGpt, cancelChatGpt, connectApiKey, switchDefaultConnection, disconnect, chatGptConnection, apiKeyConnection, activeDefaultMethod, connectionBusy } = connection
    const backFromApiKey = () => {
        setApiKeyDraft('')
        setApiKeyDialogOpen(false)
        onBackToProviders?.()
    }
    return <>
                {showNotices ? <OpenAIConnectionNotices connection={connection} /> : null}
                {showChatGpt && chatGptConnection?.configured ? (<ProviderConnectionRow
                    title="ChatGPT subscription"
                    searchTargetId={createSettingsRowTargetId('OpenAI connections', 'ChatGPT subscription')}
                    description="Use your subscription for ChatGPT models, Voice and usage limits."
                    icon={<SettingsProviderIcon provider="chatgpt" />}
                    status={desktopHost ? connectionStatusLabel(chatGptConnection) : 'Managed in Desktop'}
                    statusTone={desktopHost ? connectionStatusTone(chatGptConnection) : 'muted'}
                    statusTitle={chatGptConnection?.detail || undefined}
                    control={desktopHost ? (
                        <SettingsActionsMenu label={connectionAction === 'chatgpt' ? 'Waiting…' : 'Manage'} ariaLabel="Manage ChatGPT connection" disabled={connectionBusy} items={[
                            { id: 'reconnect', label: 'Reconnect', icon: <RefreshCw size={13} />, onSelect: connectChatGpt },
                            { id: 'reconnect-device-code', label: 'Reconnect with device code', icon: <MonitorSmartphone size={13} />, onSelect: () => connectChatGpt('device-code') },
                            ...(chatGptConnection.verified ? [{ id: 'default', label: 'Use for new chats', icon: <MessageSquarePlus size={13} />, checked: activeDefaultMethod === 'chatgpt', disabled: activeDefaultMethod === 'chatgpt', onSelect: () => switchDefaultConnection('chatgpt') }] : []),
                            { id: 'disconnect', label: 'Disconnect', icon: <Unplug size={13} />, danger: true, separatorBefore: true, onSelect: () => setDisconnectMethod('chatgpt') }
                        ]} />
                    ) : <span className="text-xs text-sparkle-text-muted">Managed in Desktop</span>}
                />) : null}
                {apiKeyConnection?.configured ? (<ProviderConnectionRow
                    title="OpenAI API key"
                    searchTargetId={createSettingsRowTargetId('OpenAI connections', 'OpenAI API key')}
                    description="API billing"
                    info="Usage is billed to your OpenAI API account. The key is verified before saving and is never returned to this page."
                    icon={<SettingsProviderIcon provider="openai" />}
                    status={desktopHost ? connectionStatusLabel(apiKeyConnection) : 'Desktop only'}
                    statusTone={desktopHost ? connectionStatusTone(apiKeyConnection) : 'muted'}
                    statusTitle={apiKeyConnection?.detail || undefined}
                    control={desktopHost ? (
                        <SettingsActionsMenu ariaLabel="Manage OpenAI API key" disabled={connectionBusy} items={[
                            { id: 'replace', label: 'Replace key', icon: <KeyRound size={13} />, onSelect: () => setApiKeyDialogOpen(true) },
                            ...(apiKeyConnection.verified ? [{ id: 'default', label: 'Use for new chats', icon: <MessageSquarePlus size={13} />, checked: activeDefaultMethod === 'api-key', disabled: activeDefaultMethod === 'api-key', onSelect: () => switchDefaultConnection('api-key') }] : []),
                            { id: 'disconnect', label: 'Remove key', icon: <Unplug size={13} />, danger: true, separatorBefore: true, onSelect: () => setDisconnectMethod('api-key') }
                        ]} />
                    ) : <span className="text-xs text-sparkle-text-muted">Managed in Desktop</span>}
                />) : null}
            <SettingsDialog
                open={apiKeyDialogOpen}
                title="Connect OpenAI API"
                titleIcon={<SettingsProviderIcon provider="openai" />}
                description="Paste an API key. Zyra verifies it before saving."
                descriptionMode="info"
                onClose={() => {
                    if (connectionAction === 'api-key') return
                    backFromApiKey()
                }}
                footer={(
                    <>
                        <SettingsButton variant="ghost" disabled={connectionAction === 'api-key'} onClick={backFromApiKey}>Back</SettingsButton>
                        <SettingsButton variant="accent" disabled={!apiKeyDraft.trim() || connectionAction === 'api-key'} onClick={() => void connectApiKey()}>
                            {connectionAction === 'api-key' ? <RefreshCw size={12} className="animate-spin motion-reduce:animate-none" /> : null}
                            {connectionAction === 'api-key' ? 'Verifying…' : 'Verify and save'}
                        </SettingsButton>
                    </>
                )}
            >
                <label htmlFor="account-openai-api-key" className="text-[12px] font-medium text-[var(--settings-text)]">API key</label>
                <SettingsInput
                    id="account-openai-api-key"
                    autoFocus
                    type="password"
                    value={apiKeyDraft}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => setApiKeyDraft(event.target.value)}
                    placeholder="sk-…"
                    className="sm:w-full"
                />
            </SettingsDialog>

            <ConfirmModal
                isOpen={disconnectMethod !== null}
                title={disconnectMethod === 'chatgpt' ? 'Disconnect ChatGPT?' : 'Remove OpenAI API key?'}
                message={disconnectMethod === 'chatgpt'
                    ? 'Zyra will remove the ChatGPT OAuth connection from Pi. Completed onboarding stays complete, but ChatGPT models, Voice, usage, and resets will require reconnection.'
                    : 'Zyra will remove the OpenAI API key from Pi. Chats configured for API models may require another working connection.'}
                confirmLabel={connectionAction === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
                variant="warning"
                onCancel={() => {
                    if (connectionAction !== 'disconnect') setDisconnectMethod(null)
                }}
                onConfirm={() => void disconnect()}
            />
            <ChatGptAuthenticationSuccess open={chatGptAuthenticationSuccessOpen} onClose={() => setChatGptAuthenticationSuccessOpen(false)} />
            <ChatGptDeviceCodeDialog open={chatGptDeviceCodeOpen} deviceCode={chatGptDeviceCode} onClose={dismissChatGptDeviceCode} onCancel={() => void cancelChatGpt()} />

    </>
}
