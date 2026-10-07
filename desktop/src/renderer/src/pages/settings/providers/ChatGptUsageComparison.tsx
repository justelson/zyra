import type { ReactNode } from 'react'
import { ChatGptUsageSummary } from './ChatGptUsageSummary'
import { ChatGptUsageAccountRow } from './ChatGptUsageAccountRow'
import type { ChatGptUsageGroup } from './chatgpt-usage-groups'
import type { useChatGptAccountPool } from './useChatGptAccountPool'
import './ChatGptUsageGroup.css'

export function ChatGptUsageComparison({ groups, pool, mode, onModeChange, resetCredits, summaryId, summaryExpanded }: {
    groups: [ChatGptUsageGroup, ChatGptUsageGroup]
    pool: ReturnType<typeof useChatGptAccountPool>
    mode: 'used' | 'remaining'
    onModeChange?: (mode: 'used' | 'remaining') => void
    resetCredits?: ReactNode
    summaryId: string
    summaryExpanded: boolean
}) {
    const { accounts, policy } = pool.snapshot!
    const visibleAccounts = accounts.filter(account => groups.some(group => group.entries.some(entry => entry.account.id === account.id)))
    return <div data-chatgpt-usage-comparison data-chatgpt-usage-group={groups[1].key} className="overflow-hidden rounded-xl border border-[var(--settings-border)] bg-[var(--settings-section)]">
        <ChatGptUsageSummary group={groups[1]} policy={policy} mode={mode} onModeChange={onModeChange} summaryId={summaryId} expanded={summaryExpanded} />
        {visibleAccounts.map(account => <ChatGptUsageAccountRow key={account.id} account={account} pool={pool} mode={mode} resetCredits={resetCredits} windows={groups.map(group => ({ key: group.key, label: group.label, window: group.entries.find(entry => entry.account.id === account.id)?.window || null }))} />)}
    </div>
}
