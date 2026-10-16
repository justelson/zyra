import { Activity } from 'lucide-react'
import type { ChatGptPoolSnapshot } from '@shared/onboarding/contracts'
import { accountLabel, accountPlan, accountStates } from '@/pages/settings/providers/chatgpt-account-presentation'
import { currentUsedPercent, groupChatGptUsage, isUsageAccountAllowed } from '@/pages/settings/providers/chatgpt-usage-groups'
import type { CommandPaletteResult } from './command-palette-types'
import { ChatGptAccountIdentity } from '@/pages/settings/providers/ChatGptAccountIdentity'
import { renameChatGptAccount } from '@/lib/chatgpt-account-events'

export function buildAccountUsageResults(pool: ChatGptPoolSnapshot, openLimits: () => void): CommandPaletteResult[] {
    const groups = groupChatGptUsage(pool.accounts)
    const rows = [...pool.accounts].sort((a, b) => Number(b.primary) - Number(a.primary)).map(account => {
        const selected = pool.policy.accountMode === 'all' || pool.policy.accountIds.includes(account.id)
        const identity = [accountPlan(account), account.primary ? 'Primary' : null,
            account.state === 'needs-sign-in' ? accountStates[account.state] : !account.enabled ? 'Paused' : account.state !== 'ready' ? accountStates[account.state] : null,
            account.enabled && !selected ? 'Excluded' : null]
            .filter(Boolean).join(' · ')
        return {
            id: `usage-account-${account.id}`, title: accountLabel(account),
            titleContent: <ChatGptAccountIdentity account={account} onRename={alias => renameChatGptAccount(account.id, alias)} />,
            detail: identity, icon: <Activity size={14} />, group: 'ChatGPT accounts', action: openLimits,
            trailing: <span className="flex gap-3 text-right tabular-nums sm:gap-5">
                {groups.map(group => {
                    const window = group.entries.find(entry => entry.account.id === account.id)?.window
                    const used = window && Number.isFinite(window.usedPercent) ? currentUsedPercent(window) : null
                    const reset = window?.resetAt && Number.isFinite(Date.parse(window.resetAt))
                        ? `Resets ${new Date(window.resetAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'Reset time unavailable'
                    return <span key={group.key} aria-label={`${group.label} usage for ${accountLabel(account)}`} title={reset} className="min-w-[64px]">
                        <span className="block text-[10px] leading-4 text-sparkle-text-muted/60">{group.label}</span>
                        <span className="flex items-center justify-end gap-1.5 text-[12px] leading-5 text-sparkle-text-secondary"><UsagePie remaining={used === null ? null : 100 - used} />{used === null ? 'Unavailable' : `${Math.round(100 - used)}% left`}</span>
                    </span>
                })}
            </span>
        }
    })
    if (!rows.length) return []
    return [{ id: 'usage-average', title: 'Average usage', detail: 'Enabled accounts', icon: <Activity size={14} />, group: 'ChatGPT accounts', action: openLimits,
        trailing: <span className="flex gap-3 text-right tabular-nums sm:gap-5">{groups.map(group => {
            const entries = group.entries.filter(entry => isUsageAccountAllowed(entry.account, pool.policy) && entry.window && Number.isFinite(entry.window.usedPercent))
            const remaining = entries.length ? 100 - entries.reduce((sum, entry) => sum + currentUsedPercent(entry.window!), 0) / entries.length : null
            return <span key={group.key} className="min-w-[64px]" title={`Average across ${entries.length} eligible accounts`}><span className="block text-[10px] leading-4 text-sparkle-text-muted/60">{group.label}</span><span className="flex items-center justify-end gap-1.5 text-xs text-sparkle-text-secondary"><UsagePie remaining={remaining} />{remaining === null ? 'Unavailable' : `${Math.round(remaining)}% left`}</span></span>
        })}</span>
    }, ...rows]
}

function UsagePie({ remaining }: { remaining: number | null }) {
    return <span aria-hidden="true" data-usage-pie className="inline-block size-3 shrink-0 rounded-full border border-white/10" style={{ background: remaining === null ? 'var(--surface-hover)' : `conic-gradient(var(--accent-primary) ${Math.max(0, Math.min(100, remaining)) * 3.6}deg, var(--surface-hover) 0deg)` }} />
}
