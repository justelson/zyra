import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { SettingsNotice } from './settings-layout'
import { SettingsPageFrame } from './SettingsPageFrame'
import { createSettingsSectionTargetId } from './settings-search'
import { useUsageSummary } from './usage/useUsageSummary'
import { readUsagePreferences, saveUsagePreferences, type UsagePagePreferences } from './usage/usage-page-preferences'
import { UsageToolbar } from './usage/UsageToolbar'
import { UsageOverview } from './usage/UsageOverview'
import { UsageTotals } from './usage/UsageTotals'
import { UsageDistribution } from './usage/UsageDistribution'
import { UsageBreakdown } from './usage/UsageBreakdown'
import './usage/UsagePage.css'

const AccountSettings = lazy(() => import('./AccountSettings'))
export default function UsageSettings() {
    const location = useLocation()
    const searchTarget = new URLSearchParams(location.search).get('setting')
    const usageSearchTarget = [createSettingsSectionTargetId('Token activity'), createSettingsSectionTargetId('Breakdown')].includes(searchTarget || '')
    const [preferences, setPreferences] = useState(() => {
        const saved = readUsagePreferences()
        return usageSearchTarget && saved.metric === 'limits' ? { ...saved, metric: 'cost' as const } : saved
    })
    const [limitsBusy, setLimitsBusy] = useState(false)
    const [limitsReady, setLimitsReady] = useState(false)
    const [limitsError, setLimitsError] = useState<string | null>(null)
    const limitsRefresh = useRef<(() => Promise<void>) | null>(null)
    const limitsRequest = useRef<symbol | null>(null)
    const { metric, days, harness, breakdown, chartView } = preferences
    const limits = metric === 'limits'
    const { summary, loading, error, refresh } = useUsageSummary(days, harness, !limits)
    useEffect(() => saveUsagePreferences(preferences), [preferences])
    useEffect(() => {
        if (usageSearchTarget) setPreferences(current => current.metric === 'limits' ? { ...current, metric: 'cost' } : current)
    }, [location.key, usageSearchTarget])
    useEffect(() => {
        if (!limits) setLimitsBusy(false)
        return () => { limitsRequest.current = null }
    }, [limits])
    const change = (patch: Partial<UsagePagePreferences>) => setPreferences(current => ({ ...current, ...patch }))
    const registerLimitsRefresh = useCallback((refresh: (() => Promise<void>) | null) => {
        limitsRefresh.current = refresh
        setLimitsReady(refresh !== null)
    }, [])
    const refreshLimits = async () => {
        const refresh = limitsRefresh.current
        if (!refresh || limitsRequest.current) return
        const request = Symbol('limits-refresh')
        limitsRequest.current = request
        setLimitsBusy(true); setLimitsError(null)
        try {
            await refresh()
        } catch (failure) {
            if (limitsRequest.current === request) setLimitsError(failure instanceof Error ? failure.message : 'Could not refresh limits.')
        } finally {
            if (limitsRequest.current === request) { limitsRequest.current = null; setLimitsBusy(false) }
        }
    }
    return <SettingsPageFrame className="usage-page max-w-[1040px]">
        <div className="usage-page-content" data-settings-page-content="true">
            <UsageToolbar metric={metric} days={days} harness={harness} summary={summary} busy={limits ? limitsBusy || !limitsReady : loading} onMetric={value => change({ metric: value })} onDays={value => change({ days: value })} onHarness={value => change({ harness: value })} onRefresh={() => limits ? void refreshLimits() : refresh()} />
            {limits ? <div className="usage-limits-body">{limitsError && <SettingsNotice tone="error">{limitsError}</SettingsNotice>}<Suspense fallback={<p role="status" className="usage-quiet-copy">Loading limits...</p>}><AccountSettings onRefreshReady={registerLimitsRefresh} /></Suspense></div> : <>
                {error && <SettingsNotice tone="error">{error}{summary ? ' Showing the last successful refresh.' : ''}</SettingsNotice>}
                {!summary ? <p role="status" className="usage-quiet-copy">{error ? 'Usage is unavailable. Refresh to retry.' : 'Loading usage...'}</p> : <>
                    <UsageOverview summary={summary} metric={metric} chartView={chartView} onChartView={value => change({ chartView: value })} />
                    <UsageTotals totals={summary.totals} />
                    <UsageDistribution totals={summary.totals} />
                    <UsageBreakdown summary={summary} metric={metric} mode={breakdown} onMode={value => change({ breakdown: value })} />
                    <footer className="usage-footer"><p>Model costs include recorded amounts and API-equivalent estimates. They are not subscription charges. {summary.totals.turns > summary.totals.meteredTurns ? `${summary.totals.turns - summary.totals.meteredTurns} records have no token counts. ` : ''}{summary.totals.turns > summary.totals.pricedTurns ? `${summary.totals.turns - summary.totals.pricedTurns} records are unpriced. An asterisk marks partial cost.` : ''}</p><div><span>Updated {new Date(summary.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {summary.timeZone}</span><Link to="/settings/providers/limits">Account limits</Link></div>{summary.sources?.some(source => source.state === 'indexing') && <p role="status">Indexing local history. Totals are still growing.</p>}{summary.sources?.some(source => source.state === 'error') && <p>Some history is unavailable. Open the source menu for details.</p>}</footer>
                </>}
            </>}
        </div>
    </SettingsPageFrame>
}
