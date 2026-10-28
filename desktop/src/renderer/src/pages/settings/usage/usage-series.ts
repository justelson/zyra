import { emptyUsageTotals, type UsageSummary, type UsageBreakdown, type UsageTotals } from '../../../../../shared/assistant/usage-summary'
import { projectUsageChart, type UsageChartView } from '../../../../../shared/assistant/usage-chart'
import { groupUsageRows, usageToolColor, type UsageBreakdownSelection, type UsageMetric } from './usage-presentation'

// One identity-based palette for paths, legends and rows. Order/metric/range never assign colors.
const providerColors: Record<string, string> = { openai: '#4d9f8a', 'openai-codex': '#809bd6', anthropic: '#d97757', opencode: '#5b9bbd', 'opencode-zen': '#8c7bd1', google: '#c59b45', unknown: '#8b8b8b' }
const modelPalette = ['#809bd6', '#d97757', '#4d9f8a', '#b28ad5', '#c59b45', '#5b9bbd', '#d77fa6', '#9aaf69', '#a79adc', '#d19362', '#65b6ad', '#c18089']
function identityColor(id: string): string {
    let hash = 2166136261
    for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
    return modelPalette[(hash >>> 0) % modelPalette.length]
}
export function usageSeriesColor(mode: UsageBreakdownSelection, id: string): string {
    return mode === 'harness' ? usageToolColor(id) : mode === 'provider' ? providerColors[id] || identityColor('provider:' + id) : identityColor('model:' + id)
}
export type UsageDetailSelection = { mode: UsageBreakdownSelection; id: string; label: string } | { mode: 'period'; date: string; view: UsageChartView; label: string }
export function usageModelMatches(row: UsageBreakdown, selection: Exclude<UsageDetailSelection, { mode: 'period' }>): boolean {
    return (selection.mode === 'model' ? `${row.provider}/${row.model}` : selection.mode === 'provider' ? row.provider : row.harness || 'zyra') === selection.id
}
const fields = Object.keys(emptyUsageTotals()) as Array<keyof UsageTotals>
function add(target: UsageTotals, row: UsageTotals) { for (const key of fields) target[key] += row[key] }
export function usagePeriodContains(date: string, selected: { date: string; view: UsageChartView }): boolean {
    if (selected.view === 'cumulative') return date <= selected.date
    if (selected.view !== 'weekly') return date === selected.date
    const end = new Date(selected.date + 'T12:00:00Z'); end.setUTCDate(end.getUTCDate() + 7)
    return date >= selected.date && date < end.toISOString().slice(0, 10)
}
/** Scope real buckets only. Legacy totals stay usable without invented model/day allocation. */
export function scopeUsageSummary(summary: UsageSummary, selection: UsageDetailSelection): UsageSummary {
    const dates = summary.daily.filter(day => selection.mode !== 'period' || usagePeriodContains(day.date, selection))
    const selectedDates = new Set(dates.map(day => day.date))
    const buckets = summary.dayModels?.filter(row => selectedDates.has(row.date) && (selection.mode === 'period' || usageModelMatches(row, selection)))
    const daily = dates.map(day => ({ date: day.date, ...emptyUsageTotals() }))
    const models = new Map<string, UsageBreakdown>(), totals = emptyUsageTotals()
    if (buckets) {
        const byDate = new Map(daily.map(day => [day.date, day]))
        for (const bucket of buckets) {
            const row = models.get(bucket.id) || { ...bucket, ...emptyUsageTotals() }
            add(row, bucket); models.set(bucket.id, row); add(totals, bucket); add(byDate.get(bucket.date)!, bucket)
        }
    } else if (selection.mode === 'period') {
        dates.forEach(day => add(totals, day))
        daily.splice(0, daily.length, ...dates)
    } else {
        for (const model of summary.models.filter(row => usageModelMatches(row, selection))) {
            const row = models.get(model.id) || { ...model, ...emptyUsageTotals() }
            add(totals, model); add(row, model); models.set(model.id, row)
        }
    }
    return { ...summary, days: dates.length, totals, daily, models: [...models.values()], dayModels: buckets }
}
export function buildUsageSeries(summary: UsageSummary, mode: UsageBreakdownSelection, metric: UsageMetric, view: UsageChartView) {
    if (!summary.dayModels) return []
    return groupUsageRows(summary, mode, metric).map(row => ({ ...row, color: usageSeriesColor(mode, row.id), daily: projectUsageChart(scopeUsageSummary(summary, { mode, id: row.id, label: row.label }).daily, view) }))
}
