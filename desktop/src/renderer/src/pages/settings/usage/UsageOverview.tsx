import type { UsageSummary } from '@shared/assistant/usage-summary'
import type { UsageChartView } from '@shared/assistant/usage-chart'
import { SettingsInfoTooltip } from '../SettingsInfoTooltip'
import { SettingsProviderIcon } from '../SettingsProviderIcon'
import { formatUsageMeasurement, groupUsageRows, hasUsageValue, usageMetricValue, usageToolColor } from './usage-presentation'
import { UsageTrendChart } from './UsageTrendChart'
import { createSettingsSectionTargetId } from '../settings-search'

export function UsageOverview({ summary, metric, chartView, onChartView }: { summary: UsageSummary; metric: 'cost' | 'tokens'; chartView: UsageChartView; onChartView: (value: UsageChartView) => void }) {
    const tools = groupUsageRows(summary, 'harness', metric)
    return <section className="usage-overview" aria-label="Token activity" data-settings-section-title="Token activity" data-settings-search-target={createSettingsSectionTargetId('Token activity')} tabIndex={-1}>
        <div className="usage-headline-column"><div className="usage-headline"><strong data-usage-headline title={hasUsageValue(summary.totals, metric) ? usageMetricValue(summary.totals, metric).toLocaleString() : 'Usage is not metered'}>{hasUsageValue(summary.totals, metric) ? formatUsageMeasurement(summary.totals, metric) : '—'}</strong><span>{summary.totals.turns.toLocaleString()} records{metric === 'cost' ? ' · API value' : ''}{metric === 'cost' && <SettingsInfoTooltip label="About usage cost">Recorded model costs and API-equivalent estimates. This is not your subscription bill. An asterisk marks partial measurements.</SettingsInfoTooltip>}</span></div>
            <div className="usage-tool-list">{tools.map(row => <div key={row.id} className="usage-tool-summary"><div><span className="usage-tool-name"><i style={{ backgroundColor: usageToolColor(row.harness || '') }} /><SettingsProviderIcon provider={row.harness === 'zyra-cli' ? 'zyra' : row.harness || ''} size={15} /><strong>{row.label}</strong><small>{row.totals.turns.toLocaleString()} records</small></span><strong>{hasUsageValue(row.totals, metric) ? formatUsageMeasurement(row.totals, metric) : '—'}</strong></div><p>{hasUsageValue(row.totals, metric) ? `${(row.share * 100).toFixed(row.share > 0 && row.share < .01 ? 1 : 0)}% of ${metric}` : metric === 'cost' ? 'Unpriced activity' : 'Unmetered activity'} · {metric === 'cost' ? `${formatUsageMeasurement(row.totals, 'tokens')}${hasUsageValue(row.totals, 'tokens') ? ' tokens' : ''}` : formatUsageMeasurement(row.totals, 'cost')}</p></div>)}</div>
            {!tools.length && <p className="usage-quiet-copy">No recorded activity in this period.</p>}
        </div>
        <UsageTrendChart daily={summary.daily} metric={metric} view={chartView} onViewChange={onChartView} />
    </section>
}
