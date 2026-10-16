import { useCallback, useEffect } from 'react'
import { AccountResetCreditsSection } from './AccountResetCreditsSection'
import { AccountUsageLimits } from './AccountUsageLimits'
import { SettingsNotice } from './settings-layout'
import { useOpenAIAccountSettings } from './providers/useOpenAIAccountSettings'
import { useChatGptAccountPool } from './providers/useChatGptAccountPool'
import { ChatGptAccountPoolSection } from './providers/ChatGptAccountPoolSection'

export default function AccountSettings({ onRefreshReady }: { onRefreshReady?: (refresh: (() => Promise<void>) | null) => void } = {}) {
    const connection = useOpenAIAccountSettings({ usageActive: true })
    const pool = useChatGptAccountPool()
    const { settings, updateSettings, overview, overviewLoading, overviewError, loadOverview, applyAccountOverview } = connection
    const refreshPool = pool.refresh
    const refreshUsage = useCallback(async () => {
        // Wait for both sources even if one request fails. Their hooks retain errors and stale data.
        const results = await Promise.allSettled([refreshPool(true), loadOverview(true)])
        const failed = results.find(result => result.status === 'rejected')
        if (failed?.status === 'rejected') throw failed.reason
    }, [refreshPool, loadOverview])
    useEffect(() => {
        onRefreshReady?.(pool.busy ? null : refreshUsage)
        return () => onRefreshReady?.(null)
    }, [onRefreshReady, pool.busy, refreshUsage])
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
