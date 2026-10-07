import { ArrowLeftRight } from 'lucide-react'
import { AnimatedHeight } from '@/components/ui/AnimatedHeight'
import { SettingsInfoTooltip } from '../SettingsInfoTooltip'
import { summarizeUsageGroup, type ChatGptUsageGroup as UsageGroup } from './chatgpt-usage-groups'
import type { ChatGptRoutingPolicy } from '@shared/onboarding/contracts'

export function usageResetDate(value: string | number) {
    return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
export function usageGroupResetLabel(group: UsageGroup, policy: ChatGptRoutingPolicy) {
    const now = Date.now()
    const { nextReset } = summarizeUsageGroup(group, policy, now)
    if (!nextReset) return group.entries.some(entry => entry.window?.resetAt && Date.parse(entry.window.resetAt) <= now) ? 'Reset passed · Refresh to check' : 'Reset time unavailable'
    const hours = Math.floor((nextReset - now) / 3600000)
    const countdown = hours < 1 ? `in ${Math.max(1, Math.ceil((nextReset - now) / 60000))}m` : hours >= 24 ? `in ${Math.floor(hours / 24)}d ${hours % 24}h` : `in ${hours}h`
    return `Next reset ${usageResetDate(nextReset)} · ${countdown}`
}

export function ChatGptUsageSummary({ group, policy, mode, onModeChange, summaryId, expanded = true }: {
    group: UsageGroup
    policy: ChatGptRoutingPolicy
    mode: 'used' | 'remaining'
    onModeChange?: (mode: 'used' | 'remaining') => void
    summaryId?: string
    expanded?: boolean
}) {
    const summary = summarizeUsageGroup(group, policy)
    const average = summary.averageUsed === null ? null : mode === 'used' ? summary.averageUsed : 100 - summary.averageUsed
    return <div id={summaryId} data-chatgpt-summary-collapse data-expanded={expanded}>
        <AnimatedHeight isOpen={expanded} duration={220} className="chatgpt-summary-motion">
            <div className="space-y-2 border-b border-[var(--settings-row-divider)] px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[12px]">
                    <span className="inline-flex items-center gap-1.5 text-[var(--settings-text-secondary)]">{policy.accountMode === 'all' ? 'All enabled accounts' : 'Selected enabled accounts'}<SettingsInfoTooltip label="About combined usage">Average usage across enabled accounts with reported usage in your allowed group. Each account keeps its own limits and reset time.</SettingsInfoTooltip></span>
                    <span data-chatgpt-summary-value className="chatgpt-usage-summary-value font-medium tabular-nums text-[var(--settings-text)]">
                        <span key={mode} className="chatgpt-usage-number">{average === null ? summary.allowedCount ? 'Usage unavailable' : 'No eligible accounts' : `${Math.round(average)}% ${mode} on average`}</span>
                        {average !== null && onModeChange ? <button type="button" data-chatgpt-mode-toggle data-mode={mode} className="chatgpt-usage-mode" aria-label={mode === 'remaining' ? 'Show used usage' : 'Show remaining usage'} title={mode === 'remaining' ? 'Show used usage' : 'Show remaining usage'} onClick={() => onModeChange(mode === 'remaining' ? 'used' : 'remaining')}><ArrowLeftRight size={14} aria-hidden="true" /></button> : null}
                    </span>
                </div>
                {average !== null ? <div data-chatgpt-summary={group.key} role="meter" aria-label={`${group.label} average ${mode}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={average} className="h-1.5 overflow-hidden rounded-full bg-[var(--settings-track)]"><div className="chatgpt-usage-fill h-full rounded-full bg-[var(--accent-primary)]" style={{ width: `${average}%` }} /></div> : null}
            </div>
        </AnimatedHeight>
    </div>
}
