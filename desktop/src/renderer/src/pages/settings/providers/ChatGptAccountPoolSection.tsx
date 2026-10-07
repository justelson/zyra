import { useState } from 'react'
import { Plus, RefreshCw } from 'lucide-react'
import type { ChatGptAccountProfile, ChatGptAccountUsageWindow, ChatGptRoutingPolicy } from '@shared/onboarding/contracts'
import { SettingsActionsMenu } from '../SettingsActionsMenu'
import { SettingsButton, SettingsDialog, SettingsNotice, SettingsRow, SettingsSection, SettingsSelect, SettingsSwitch } from '../settings-layout'
import { ChatGptAuthenticationSuccess } from './ChatGptAuthenticationSuccess'
import { ChatGptDeviceCodeDialog } from './ChatGptDeviceCodeDialog'
import { useChatGptAccountPool } from './useChatGptAccountPool'
import type { useOpenAIAccountSettings } from './useOpenAIAccountSettings'

const states = { ready: 'Ready', limited: 'Limited', paused: 'Paused', 'needs-sign-in': 'Sign in again' }
function resetLabel(value: string | null) { return value ? new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Reset time unavailable' }
function UsageWindow({ window, label }: { window: ChatGptAccountUsageWindow | null; label: string }) {
    if (!window) return null
    const elapsed = Boolean(window.resetAt && Date.parse(window.resetAt) <= Date.now())
    const used = elapsed ? 0 : window.usedPercent
    return <div className="min-w-0 space-y-1.5">
        <div className="flex justify-between gap-3 text-[11px] text-[var(--settings-text-secondary)]"><span>{label}</span><span>{Math.round(used)}% used</span></div>
        <div role="meter" aria-label={`${label} usage`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={used} className="h-1.5 overflow-hidden rounded-full bg-[var(--settings-track)]"><div className="h-full rounded-full bg-[var(--accent-primary)]" style={{ width: `${used}%` }} /></div>
        <p className="text-[10px] text-[var(--settings-text-muted)]">{elapsed ? 'Reset passed · checking fresh usage' : window.resetAt ? `Resets ${resetLabel(window.resetAt)}` : resetLabel(null)}</p>
    </div>
}

export function ChatGptAccountPoolSection({ connection }: { connection: ReturnType<typeof useOpenAIAccountSettings> }) {
    const pool = useChatGptAccountPool()
    const [remove, setRemove] = useState<ChatGptAccountProfile | null>(null)
    const snapshot = pool.snapshot
    const busy = pool.busy || connection.connectionBusy
    const policy = snapshot?.policy
    const save = (patch: Partial<ChatGptRoutingPolicy>) => {
        if (!policy || !snapshot) return
        const ids = new Set(snapshot.accounts.map(account => account.id))
        void pool.update({ action: 'policy', policy: { ...policy, accountIds: policy.accountIds.filter(id => ids.has(id)), preferredAccountId: policy.preferredAccountId && ids.has(policy.preferredAccountId) ? policy.preferredAccountId : null, ...patch } })
    }
    const connect = async (accountId?: string, device = false) => { await connection.connectChatGpt(device ? 'device-code' : 'browser', accountId); await pool.refresh(true) }
    return <>
        <SettingsSection title="ChatGPT accounts" headerAction={<div className="flex gap-2">
            <SettingsButton variant="ghost" disabled={busy} onClick={() => void pool.refresh(true)}><RefreshCw size={12} />Refresh</SettingsButton>
            <SettingsButton disabled={busy} onClick={() => void connect()}><Plus size={12} />Add account</SettingsButton>
        </div>}>
            {pool.error || connection.connectionError ? <SettingsNotice tone="error">{pool.error || connection.connectionError}</SettingsNotice> : null}
            {connection.connectionAction === 'chatgpt' ? <SettingsNotice>Complete sign-in in your browser. Choose the account you want to add or reconnect. <SettingsButton variant="ghost" onClick={() => void connection.cancelChatGpt()}>Cancel</SettingsButton></SettingsNotice> : null}
            {!snapshot ? <SettingsRow title="Checking connected accounts" description="Your accounts and saved usage rules will appear here." /> : null}
            {snapshot?.accounts.length === 0 ? <SettingsRow title="Connect your first account" description="Add a ChatGPT account to use your subscription. Each sign-in is saved separately." control={<SettingsButton disabled={busy} onClick={() => void connect(undefined, true)}>Use device code</SettingsButton>} /> : null}
            {snapshot?.accounts.map(account => {
                const label = account.email || `Account ${account.id.slice(0, 6)}`
                const selected = policy?.accountMode === 'all' || Boolean(policy?.accountIds.includes(account.id))
                return <SettingsRow key={account.id} title={label} description={`${account.plan || 'ChatGPT'}${account.primary ? ' · Primary account for banked resets below' : ''}${!selected ? ' · Excluded by usage rule' : ''}`} status={states[account.state]} statusTone={account.state === 'ready' ? 'ready' : account.state === 'limited' || account.state === 'needs-sign-in' ? 'warning' : 'muted'} control={<>
                    <SettingsSwitch label={`Enable ${label}`} checked={account.enabled} disabled={busy} onCheckedChange={enabled => void pool.update({ action: 'enabled', accountId: account.id, enabled })} />
                    <SettingsActionsMenu disabled={busy} ariaLabel={`Manage ${label}`} items={[
                        { id: 'reconnect', label: 'Sign in again', onSelect: () => void connect(account.id) },
                        { id: 'device', label: 'Reconnect with device code', onSelect: () => void connect(account.id, true) },
                        { id: 'only', label: 'Use only this account', checked: policy?.accountMode === 'selected' && policy.accountIds.length === 1 && selected, onSelect: () => save({ accountMode: 'selected', accountIds: [account.id] }) },
                        { id: 'remove', label: 'Disconnect account', danger: true, separatorBefore: true, onSelect: () => setRemove(account) },
                    ]} />
                </>}>
                    {account.usage ? <div className="grid gap-3 py-3 sm:grid-cols-2"><UsageWindow window={account.usage.primary} label="Short window" /><UsageWindow window={account.usage.secondary} label="Long window" /></div> : <p className="py-2 text-[11px] text-[var(--settings-text-muted)]">Usage has not been returned yet. Refresh to check.</p>}
                    {account.state === 'limited' ? <p className="pb-2 text-[11px] text-[var(--settings-text-muted)]">Next retry {resetLabel(account.resetAt)}. Zyra uses reported reset times when choosing an account.</p> : null}
                </SettingsRow>
            })}
        </SettingsSection>
        {policy && snapshot?.accounts.length ? <SettingsSection title="ChatGPT usage rules">
            <SettingsRow title="Usage strategy" description="Automatic balance favors accounts with more remaining usage and shares concurrent requests. Limited accounts wait for their reset." control={<SettingsSelect aria-label="ChatGPT usage strategy" value={policy.strategy} disabled={busy} onChange={e => save({ strategy: e.target.value as ChatGptRoutingPolicy['strategy'] })}>
                <option value="balanced">Automatic balance</option><option value="round-robin">Rotate evenly</option><option value="fill-first">Drain one account first</option>
            </SettingsSelect>} />
            {policy.strategy === 'fill-first' ? <SettingsRow title="Use first" description="Use this account until it is unavailable, then another eligible account. Return to it after its limit resets." control={<SettingsSelect aria-label="ChatGPT preferred account" value={policy.preferredAccountId || ''} disabled={busy} onChange={e => save({ preferredAccountId: e.target.value || null })}>
                <option value="">First available account</option>{snapshot.accounts.map(account => <option key={account.id} value={account.id}>{account.email || `Account ${account.id.slice(0, 6)}`}</option>)}
            </SettingsSelect>} /> : null}
            <SettingsRow title="Allowed accounts" description="Only enabled accounts in this group can be used. Changes apply to the next request." control={<SettingsSelect aria-label="Allowed ChatGPT accounts" value={policy.accountMode} disabled={busy} onChange={e => save({ accountMode: e.target.value as 'all' | 'selected', accountIds: e.target.value === 'selected' ? snapshot.accounts.filter(a => a.enabled).map(a => a.id) : [] })}>
                <option value="all">All enabled accounts</option><option value="selected">Selected accounts only</option>
            </SettingsSelect>} />
            {policy.accountMode === 'selected' ? <div className="space-y-2 px-4 py-3">{snapshot.accounts.map(account => <label key={account.id} className="flex items-center gap-2 text-xs text-[var(--settings-text-secondary)]"><input type="checkbox" checked={policy.accountIds.includes(account.id)} disabled={busy} onChange={e => save({ accountIds: e.target.checked ? [...policy.accountIds, account.id] : policy.accountIds.filter(id => id !== account.id) })} />{account.email || `Account ${account.id.slice(0, 6)}`}</label>)}{!snapshot.accounts.some(a => a.enabled && policy.accountIds.includes(a.id)) ? <SettingsNotice tone="warning">No selected account is enabled. Select an account to send subscription requests.</SettingsNotice> : null}</div> : null}
        </SettingsSection> : null}
        <SettingsDialog open={remove !== null} title="Disconnect this ChatGPT account?" description={`Remove ${remove?.email || 'this account'} from Zyra. Other connected accounts are kept.`} onClose={() => setRemove(null)} footer={<><SettingsButton variant="ghost" onClick={() => setRemove(null)}>Cancel</SettingsButton><SettingsButton variant="danger" disabled={busy} onClick={() => { if (remove) void pool.update({ action: 'remove', accountId: remove.id, confirmed: true }); setRemove(null) }}>Disconnect</SettingsButton></>}>{null}</SettingsDialog>
        <ChatGptDeviceCodeDialog open={connection.chatGptDeviceCodeOpen} deviceCode={connection.chatGptDeviceCode} onClose={connection.dismissChatGptDeviceCode} onCancel={() => void connection.cancelChatGpt()} />
        <ChatGptAuthenticationSuccess open={connection.chatGptAuthenticationSuccessOpen} onClose={() => connection.setChatGptAuthenticationSuccessOpen(false)} />
    </>
}
