import { AccountResetCreditsSection } from './AccountResetCreditsSection'
import { AccountUsageLimits } from './AccountUsageLimits'
import { SettingsNotice } from './settings-layout'
import { useOpenAIAccountSettings } from './providers/useOpenAIAccountSettings'
import { useChatGptAccountPool } from './providers/useChatGptAccountPool'
import { ChatGptAccountPoolSection } from './providers/ChatGptAccountPoolSection'

export default function AccountSettings() {
    const connection = useOpenAIAccountSettings({ usageActive: true })
    const pool = useChatGptAccountPool()
    const { settings, updateSettings, overview, overviewLoading, overviewError, loadOverview, applyAccountOverview } = connection
    if (!pool.snapshot) return <>
        {pool.error ? <SettingsNotice tone="warning">{pool.error}</SettingsNotice> : null}
        {overviewError ? <SettingsNotice tone="error">{overviewError}</SettingsNotice> : null}
        <AccountUsageLimits cards={connection.usageCards} mode={settings.assistantUsageDisplayMode}
            onModeChange={assistantUsageDisplayMode => updateSettings({ assistantUsageDisplayMode })}
            loading={connection.initialAccountLoading} error={overview?.usageError} fetchedAt={overview?.fetchedAt} />
        <AccountResetCreditsSection overview={overview} loading={overviewLoading} onOverviewChange={applyAccountOverview} />
    </>
    return <ChatGptAccountPoolSection pool={pool} mode={settings.assistantUsageDisplayMode}
        onModeChange={assistantUsageDisplayMode => updateSettings({ assistantUsageDisplayMode })}
        onRefresh={() => void loadOverview(true)}
        notice={overviewError ? <SettingsNotice tone="error">Could not check reset credits: {overviewError}</SettingsNotice> : undefined}
        resetCredits={overviewError ? undefined : <AccountResetCreditsSection compact overview={overview} loading={overviewLoading} onOverviewChange={next => { applyAccountOverview(next); void pool.refresh(true) }} />} />
}
