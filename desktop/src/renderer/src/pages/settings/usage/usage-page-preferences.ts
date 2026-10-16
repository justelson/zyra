import { usageHarnessLabels, type UsageRange, type UsageSummaryInput } from '@shared/assistant/usage-summary'
import type { UsageChartView } from '@shared/assistant/usage-chart'
import type { UsageBreakdownMode, UsageMetric } from './usage-presentation'

export type UsagePagePreferences = { metric: UsageMetric; days: UsageRange; harness: NonNullable<UsageSummaryInput['harness']>; breakdown: UsageBreakdownMode; chartView: UsageChartView }
const key = 'zyra:usage-page:v1'
const defaults: UsagePagePreferences = { metric: 'cost', days: 30, harness: 'all', breakdown: 'model', chartView: 'daily' }
export function readUsagePreferences(): UsagePagePreferences {
    try {
        const value = JSON.parse(window.localStorage.getItem(key) || '{}')
        return {
            metric: ['cost', 'tokens', 'limits'].includes(value?.metric) ? value.metric : defaults.metric,
            days: [7, 30, 90, 365, 'all'].includes(value?.days) ? value.days : defaults.days,
            harness: typeof value?.harness === 'string' && (value.harness === 'all' || Object.hasOwn(usageHarnessLabels, value.harness)) ? value.harness : defaults.harness,
            breakdown: ['model', 'day', 'harness', 'provider'].includes(value?.breakdown) ? value.breakdown : defaults.breakdown,
            chartView: ['daily', 'weekly', 'cumulative', 'activity'].includes(value?.chartView) ? value.chartView : defaults.chartView
        }
    } catch { return { ...defaults } }
}
export function saveUsagePreferences(value: UsagePagePreferences) {
    try { window.localStorage.setItem(key, JSON.stringify(value)) } catch { /* A disabled preference store does not block usage. */ }
}
