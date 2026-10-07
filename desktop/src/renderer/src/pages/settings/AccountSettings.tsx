import { useState } from 'react'
import { ChevronDown, RefreshCw } from 'lucide-react'
import { AccountUsageLimits } from './AccountUsageLimits'
import { AccountResetCreditsSection } from './AccountResetCreditsSection'
import { SettingsKeyValueList } from './SettingsKeyValueList'
import { createSettingsRowTargetId } from './settings-search'
import { SettingsButton, SettingsNotice, SettingsSection, SettingsStatusPill } from './settings-layout'
import { SensitiveSettingValue } from './SensitiveSettingValue'
import { useOpenAIAccountSettings } from './providers/useOpenAIAccountSettings'
import { ChatGptAccountPoolSection } from './providers/ChatGptAccountPoolSection'

export default function AccountSettings() {
    const connection = useOpenAIAccountSettings({ usageActive: true, connectionsActive: true })
    const { settings, updateSettings, overview, overviewLoading, overviewError, loadOverview, applyAccountOverview, usageCards, initialAccountLoading, displayAccountValue, connectionLabel, accountPlan } = connection
    const [accountDetailsOpen, setAccountDetailsOpen] = useState(false)
    return <>
            <ChatGptAccountPoolSection connection={connection} />
            <SettingsSection title="ChatGPT account" headerAction={<SettingsButton variant="ghost" onClick={() => void loadOverview(true)} disabled={overviewLoading}><RefreshCw size={12} className={overviewLoading ? 'animate-spin motion-reduce:animate-none' : ''} />Refresh</SettingsButton>}>
                {overviewError ? <SettingsNotice tone="error">{overviewError}</SettingsNotice> : null}
                {overview?.requiresOpenaiAuth ? <SettingsNotice tone="warning">Connect your ChatGPT account through Zyra to view its identity, plan, usage limits, and banked resets.</SettingsNotice> : null}
                <details className="group" onToggle={(event) => setAccountDetailsOpen(event.currentTarget.open)}>
                    <summary
                        aria-expanded={accountDetailsOpen}
                        aria-controls="chatgpt-account-details"
                        onClick={(event) => {
                            if (event.currentTarget.closest('details')?.open) setAccountDetailsOpen(false)
                        }}
                        data-settings-search-target={createSettingsRowTargetId('ChatGPT account', 'Connection')}
                        className="zyra-settings-row grid cursor-pointer list-none gap-3 px-4 py-3.5 text-left transition-colors duration-100 hover:bg-[var(--settings-row-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-primary)] sm:grid-cols-[minmax(0,1fr)_minmax(9rem,auto)] sm:items-center sm:gap-8 [&::-webkit-details-marker]:hidden"
                    >
                        <span className="min-w-0 space-y-1">
                            <span className="flex min-h-5 min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                                <span className="text-[13px] font-medium tracking-[-0.003em] text-[var(--settings-text)]">Connection</span>
                                <SettingsStatusPill
                                    label={initialAccountLoading ? 'Checking' : overview?.requiresOpenaiAuth ? 'Connect account' : overview ? 'Connected' : 'Unavailable'}
                                    tone={overview?.requiresOpenaiAuth ? 'warning' : overview ? 'ready' : 'muted'}
                                />
                            </span>
                            <span className="block max-w-[34rem] text-[12px] leading-[1.5] text-[var(--settings-text-secondary)]">Account used for subscription models and usage limits.</span>
                        </span>
                        <span className="flex min-w-0 items-center justify-end gap-2">
                            <span className="truncate text-xs font-medium text-sparkle-text-secondary">{connectionLabel}</span>
                            <ChevronDown size={14} aria-hidden="true" className="shrink-0 text-[var(--settings-text-muted)] transition-transform group-open:rotate-180" />
                        </span>
                    </summary>
                    <div id="chatgpt-account-details" className="border-t border-[var(--settings-row-divider)]">
                        <SettingsKeyValueList label="ChatGPT account details" items={[
                            {
                                id: 'email',
                                label: 'Email',
                                value: overview?.account?.email ? <span className="inline-flex max-w-full flex-wrap items-center justify-end gap-1">
                                    <SensitiveSettingValue value={accountDetailsOpen ? overview?.account?.email || '' : ''} label="Email" visiblePrefix={2} />
                                    {overview?.emailVerified === true ? <span className="text-[10px] text-[var(--status-success)]">Verified</span> : null}
                                </span> : displayAccountValue(overview?.account?.email),
                                searchTargetId: createSettingsRowTargetId('ChatGPT account', 'Email')
                            },
                            { id: 'plan', label: 'Plan', value: accountPlan, searchTargetId: createSettingsRowTargetId('ChatGPT account', 'Plan') },
                            { id: 'provider', label: 'Provider', value: displayAccountValue(overview?.provider), searchTargetId: createSettingsRowTargetId('ChatGPT account', 'Pi provider') },
                            {
                                id: 'account-id',
                                label: 'Account ID',
                                value: overview?.accountId
                                    ? <SensitiveSettingValue value={accountDetailsOpen ? overview.accountId : ''} label="Account ID" visiblePrefix={4} />
                                    : displayAccountValue(overview?.accountId),
                                searchTargetId: createSettingsRowTargetId('ChatGPT account', 'Account ID')
                            }
                        ]} />
                    </div>
                </details>
            </SettingsSection>

        <AccountUsageLimits cards={usageCards} mode={settings.assistantUsageDisplayMode}
            onModeChange={assistantUsageDisplayMode => updateSettings({ assistantUsageDisplayMode })}
            loading={initialAccountLoading} error={overview?.usageError} fetchedAt={overview?.fetchedAt} />


        <AccountResetCreditsSection overview={overview} loading={overviewLoading} onOverviewChange={applyAccountOverview} />
    </>
}
