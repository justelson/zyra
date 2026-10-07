import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ListFilter, RefreshCw, UserRoundMinus, UserRoundPlus, Users } from 'lucide-react'
import type { ChatGptAccountProfile, ChatGptAccountUsageWindow, ChatGptRoutingPolicy } from '@shared/onboarding/contracts'
import { SettingsActionsMenu } from '../SettingsActionsMenu'
import { SettingsStatusPill, SettingsSwitch } from '../settings-layout'
import { accountLabel, accountPlan, accountStates, saveRoutingPolicy } from './chatgpt-account-presentation'
import { currentUsedPercent } from './chatgpt-usage-groups'
import { usageResetDate } from './ChatGptUsageSummary'
import type { useChatGptAccountPool } from './useChatGptAccountPool'

export function ChatGptUsageAccountRow({ account, windows, pool, mode, resetCredits }: {
    account: ChatGptAccountProfile
    windows: { key: string; label: string; window: ChatGptAccountUsageWindow | null }[]
    pool: ReturnType<typeof useChatGptAccountPool>
    mode: 'used' | 'remaining'
    resetCredits?: ReactNode
}) {
    const policy = pool.snapshot!.policy
    const label = accountLabel(account)
    const selected = policy.accountMode === 'all' || policy.accountIds.includes(account.id)
    const save = (patch: Partial<ChatGptRoutingPolicy>) => saveRoutingPolicy(pool, patch)
    return <div data-chatgpt-usage-account={account.id} className={`chatgpt-usage-account ${windows.length === 2 ? 'chatgpt-usage-account-dual' : ''} border-b border-[var(--settings-row-divider)] px-4 py-3 last:border-b-0`}>
        <div className="chatgpt-usage-identity min-w-0">
            <h4 title={label} className="truncate text-[12px] font-medium text-[var(--settings-text)]">{label}</h4>
            <div className="mt-1 flex flex-wrap items-center gap-1.5"><SettingsStatusPill label={accountPlan(account)} /><SettingsStatusPill label={accountStates[account.state]} tone={account.state === 'ready' ? 'ready' : account.state === 'limited' || account.state === 'needs-sign-in' ? 'warning' : 'muted'} />{!selected ? <SettingsStatusPill label="Excluded" /> : null}{account.primary && resetCredits ? <span data-chatgpt-reset-owner={account.id}>{resetCredits}</span> : null}</div>
        </div>
        {windows.map(({ key, label: period, window }) => {
            const used = window ? currentUsedPercent(window) : null
            return <div key={key} data-chatgpt-usage-window={key} aria-label={`${period} usage for ${label}`} title={window?.resetAt ? `Resets ${usageResetDate(window.resetAt)}` : 'Reset time unavailable'} className="chatgpt-usage-values text-[11px] tabular-nums">
                {windows.length === 2 ? <span className="chatgpt-usage-period">{period}</span> : null}
                <div key={mode} className="chatgpt-usage-number">
                    <span className="block font-medium text-[var(--settings-text)]">{used === null ? 'Unavailable' : `${Math.round(mode === 'remaining' ? 100 - used : used)}% ${mode}`}</span>
                    {used !== null ? <span className="mt-0.5 block text-[var(--settings-text-muted)]">{Math.round(mode === 'remaining' ? used : 100 - used)}% {mode === 'remaining' ? 'used' : 'remaining'}</span> : null}
                </div>
            </div>
        })}
        <div className="chatgpt-usage-controls flex items-center justify-end gap-2">
            {account.state === 'needs-sign-in' ? <Link to="/settings/providers" className="chatgpt-usage-signin" aria-label={`Sign in again to ${label}`}><RefreshCw size={13} aria-hidden="true" />Sign in again</Link> : <SettingsActionsMenu ariaLabel={`Usage options for ${label}`} label="Options" disabled={pool.busy} items={[
                ...(policy.accountMode === 'selected' ? [{ id: 'allowed', label: selected ? 'Exclude this account' : 'Include this account', icon: selected ? <UserRoundMinus size={13} /> : <UserRoundPlus size={13} />, onSelect: () => save({ accountIds: selected ? policy.accountIds.filter(id => id !== account.id) : [...policy.accountIds, account.id] }) }] : []),
                { id: 'only', label: 'Use only this account', icon: <ListFilter size={13} />, checked: policy.accountMode === 'selected' && policy.accountIds.length === 1 && selected, onSelect: () => save({ accountMode: 'selected', accountIds: [account.id] }) },
                { id: 'all', label: 'Use all enabled accounts', icon: <Users size={13} />, checked: policy.accountMode === 'all', onSelect: () => save({ accountMode: 'all', accountIds: [] }) }
            ]} />}
            <SettingsSwitch label={`Enable ${label}`} checked={account.enabled} disabled={pool.busy} onCheckedChange={enabled => void pool.update({ action: 'enabled', accountId: account.id, enabled })} />
        </div>
    </div>
}
