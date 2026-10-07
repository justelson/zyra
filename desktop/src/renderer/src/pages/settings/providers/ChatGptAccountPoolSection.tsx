import type { ReactNode } from 'react'
import { useId, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { SettingsButton, SettingsNotice, SettingsRow, SettingsSection } from '../settings-layout'
import { SettingsPageLink } from '../SettingsPageTabs'
import { groupChatGptUsage } from './chatgpt-usage-groups'
import { ChatGptUsageGroup, usageGroupResetLabel } from './ChatGptUsageGroup'
import { ChatGptUsageRules } from './ChatGptUsageRules'
import { ChatGptUsageComparison } from './ChatGptUsageComparison'
import { ChatGptSummaryToggle } from './ChatGptSummaryToggle'
import type { useChatGptAccountPool } from './useChatGptAccountPool'

export function ChatGptAccountPoolSection({ pool, mode = 'remaining', onModeChange, onRefresh, resetCredits, notice }: {
    pool: ReturnType<typeof useChatGptAccountPool>
    mode?: 'used' | 'remaining'
    onModeChange?: (mode: 'used' | 'remaining') => void
    onRefresh?: () => void
    resetCredits?: ReactNode
    notice?: ReactNode
}) {
    const { snapshot, busy } = pool
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
    const summaryPrefix = useId()
    const toggleSummary = (key: string) => setCollapsed(current => ({ ...current, [key]: !current[key] }))
    const groups = groupChatGptUsage(snapshot?.accounts || [])
    const headerGroup = groups.length === 1 ? groups[0] : groups.length === 2 ? groups[1] : undefined
    const resetOwnerGroup = groups.find(group => group.entries.some(entry => entry.account.primary))?.key
    return <>
        <SettingsSection title="ChatGPT usage" displayTitle={headerGroup ? <ChatGptSummaryToggle label={headerGroup.label} expanded={!collapsed[headerGroup.key]} summaryId={`${summaryPrefix}-${headerGroup.key}`} onToggle={() => toggleSummary(headerGroup.key)} /> : undefined} bodyClassName="!border-0 !bg-transparent !shadow-none" headerAction={<div className="flex flex-wrap items-center justify-end gap-2">
            {headerGroup && snapshot ? <span className="mr-2 text-[11px] text-[var(--settings-text-muted)]">{usageGroupResetLabel(headerGroup, snapshot.policy)}</span> : null}
            <SettingsButton variant="ghost" disabled={busy} onClick={() => { void pool.refresh(true); onRefresh?.() }}><RefreshCw size={12} />Refresh</SettingsButton>
        </div>}>
            {pool.error ? <SettingsNotice tone="error">{pool.error}</SettingsNotice> : null}
            {notice}
            {!snapshot && !pool.error ? <SettingsRow title="Checking usage" description="Loading your connected accounts." /> : null}
            {snapshot?.accounts.length === 0 ? <SettingsPageLink to="/settings/providers" title="Connect a ChatGPT account" description="Add accounts in Connections to see usage here." /> : null}
            {groups.length === 2 ? <ChatGptUsageComparison groups={[groups[0], groups[1]]} pool={pool} mode={mode} onModeChange={onModeChange} resetCredits={resetCredits} summaryId={`${summaryPrefix}-${groups[1].key}`} summaryExpanded={!collapsed[groups[1].key]} /> : groups.map(group => <ChatGptUsageGroup key={group.key} group={group} pool={pool} mode={mode} onModeChange={onModeChange} summaryId={`${summaryPrefix}-${group.key}`} summaryExpanded={!collapsed[group.key]} onToggleSummary={() => toggleSummary(group.key)} showPeriodHeading={groups.length !== 1} resetCredits={group.key === resetOwnerGroup ? resetCredits : undefined} />)}
        </SettingsSection>
        <ChatGptUsageRules pool={pool} />
    </>
}
