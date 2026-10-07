import type { ChatGptRoutingPolicy } from '@shared/onboarding/contracts'
import { SettingsNotice, SettingsRow, SettingsSection, SettingsSelect } from '../settings-layout'
import { accountLabel, saveRoutingPolicy } from './chatgpt-account-presentation'
import type { useChatGptAccountPool } from './useChatGptAccountPool'

export function ChatGptUsageRules({ pool }: { pool: ReturnType<typeof useChatGptAccountPool> }) {
    const snapshot = pool.snapshot
    if (!snapshot?.accounts.length) return null
    const { policy, accounts } = snapshot
    const save = (patch: Partial<ChatGptRoutingPolicy>) => saveRoutingPolicy(pool, patch)
    return <SettingsSection title="ChatGPT usage rules">
        <SettingsRow title="Usage strategy" description="Choose how accounts share usage." control={<SettingsSelect aria-label="ChatGPT usage strategy" value={policy.strategy} disabled={pool.busy} onChange={e => save({ strategy: e.target.value as ChatGptRoutingPolicy['strategy'] })}>
            <option value="balanced">Automatic balance</option><option value="round-robin">Rotate evenly</option><option value="fill-first">Drain one account first</option>
        </SettingsSelect>} />
        {policy.strategy === 'fill-first' ? <SettingsRow title="Use first" description="Use this account until its limit, then another enabled account. Return when its usage resets." control={<SettingsSelect aria-label="ChatGPT preferred account" value={policy.preferredAccountId || ''} disabled={pool.busy} onChange={e => save({ preferredAccountId: e.target.value || null })}>
            <option value="">First available account</option>{accounts.map(account => <option key={account.id} value={account.id}>{accountLabel(account)}</option>)}
        </SettingsSelect>} /> : null}
        <SettingsRow title="Allowed accounts" description={policy.accountMode === 'selected' ? 'Choose accounts in their Options menus.' : 'Changes apply to the next request.'} control={<SettingsSelect aria-label="Allowed ChatGPT accounts" value={policy.accountMode} disabled={pool.busy} onChange={e => save({ accountMode: e.target.value as 'all' | 'selected', accountIds: e.target.value === 'selected' ? accounts.filter(a => a.enabled).map(a => a.id) : [] })}>
            <option value="all">All enabled accounts</option><option value="selected">Selected accounts only</option>
        </SettingsSelect>} />
        {policy.accountMode === 'selected' && !accounts.some(a => a.enabled && policy.accountIds.includes(a.id)) ? <SettingsNotice tone="warning">No selected account is enabled. Include an account from its Options menu to send requests.</SettingsNotice> : null}
    </SettingsSection>
}
