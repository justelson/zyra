import type { ReactNode } from 'react'
import type { ChatGptUsageGroup as UsageGroup } from './chatgpt-usage-groups'
import type { useChatGptAccountPool } from './useChatGptAccountPool'
import { ChatGptSummaryToggle } from './ChatGptSummaryToggle'
import { ChatGptUsageSummary, usageGroupResetLabel } from './ChatGptUsageSummary'
import { ChatGptUsageAccountRow } from './ChatGptUsageAccountRow'
import './ChatGptUsageGroup.css'

export { usageGroupResetLabel } from './ChatGptUsageSummary'

export function ChatGptUsageGroup({ group, pool, mode, onModeChange, resetCredits, showPeriodHeading = true, summaryId, summaryExpanded = true, onToggleSummary }: { group: UsageGroup; pool: ReturnType<typeof useChatGptAccountPool>; mode: 'used' | 'remaining'; onModeChange?: (mode: 'used' | 'remaining') => void; resetCredits?: ReactNode; showPeriodHeading?: boolean; summaryId?: string; summaryExpanded?: boolean; onToggleSummary?: () => void }) {
    const policy = pool.snapshot!.policy
    return <div className="!border-0 [&+div]:mt-4">
        {showPeriodHeading ? <header className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1">
            <h3 className="text-[13px] font-semibold text-[var(--settings-text)]">{onToggleSummary && summaryId ? <ChatGptSummaryToggle label={group.label} expanded={summaryExpanded} summaryId={summaryId} onToggle={onToggleSummary} /> : group.label}</h3>
            <span className="text-[11px] text-[var(--settings-text-muted)]">{usageGroupResetLabel(group, policy)}</span>
        </header> : null}
        <div data-chatgpt-usage-group={group.key} className="overflow-hidden rounded-xl border border-[var(--settings-border)] bg-[var(--settings-section)]">
            <ChatGptUsageSummary group={group} policy={policy} mode={mode} onModeChange={onModeChange} summaryId={summaryId} expanded={summaryExpanded} />
            {group.entries.map(({ account, window }) => <ChatGptUsageAccountRow key={account.id} account={account} windows={[{ key: group.key, label: group.label, window }]} pool={pool} mode={mode} resetCredits={resetCredits} />)}
        </div>
    </div>
}
