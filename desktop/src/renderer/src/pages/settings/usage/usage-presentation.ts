import {
    emptyUsageTotals,
    usageHarnessLabels,
    usageProviderLabel,
    type UsageHarness,
    type UsageSummary,
    type UsageTotals
} from '../../../../../shared/assistant/usage-summary'

export type UsageMetric = 'cost' | 'tokens' | 'limits'
export type UsageBreakdownMode = 'model' | 'day' | 'harness' | 'provider'
export type UsageTableRow = {
    id: string
    label: string
    provider?: string
    harness?: UsageHarness
    date?: string
    totals: UsageTotals
    /** Fraction of the summary's available selected metric, from 0 to 1. */
    share: number
}

type NumericUsageMetric = Exclude<UsageMetric, 'limits'>
const totalFields = Object.keys(emptyUsageTotals()) as Array<keyof UsageTotals>
const nonNegative = (value: number): number => Number.isFinite(value) && value >= 0 ? value : 0
const compareIds = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0

export function hasUsageValue(totals: UsageTotals, metric: NumericUsageMetric): boolean {
    return totals.turns === 0 || nonNegative(metric === 'cost' ? totals.pricedTurns : totals.meteredTurns) > 0
}

export function usageMetricValue(totals: UsageTotals, metric: NumericUsageMetric): number {
    return nonNegative(metric === 'cost' ? totals.costUsd : totals.tokens)
}

/** Preserve missing and partial measurements in every display, including secondary metrics. */
export function formatUsageMeasurement(totals: UsageTotals, metric: NumericUsageMetric): string {
    if (!hasUsageValue(totals, metric)) return metric === 'cost' ? 'Unpriced' : 'Unmetered'
    const value = metric === 'cost' ? formatUsageUsd(totals.costUsd) : formatUsageTokens(totals.tokens)
    const measured = metric === 'cost' ? totals.pricedTurns : totals.meteredTurns
    return value + (measured < totals.turns ? ' *' : '')
}

export function groupUsageRows(summary: UsageSummary, mode: UsageBreakdownMode, metric: NumericUsageMetric): UsageTableRow[] {
    const groups = new Map<string, UsageTableRow>()
    const add = (identity: Omit<UsageTableRow, 'totals' | 'share'>, totals: UsageTotals) => {
        const row = groups.get(identity.id) || { ...identity, totals: emptyUsageTotals(), share: 0 }
        for (const field of totalFields) row.totals[field] += nonNegative(totals[field])
        groups.set(identity.id, row)
    }

    if (mode === 'day') {
        for (const day of summary.daily) add({ id: day.date, date: day.date, label: formatUsageDate(day.date) }, day)
    } else {
        for (const model of summary.models) {
            if (mode === 'model') {
                add({ id: `${model.provider}/${model.model}`, label: model.model, provider: model.provider }, model)
            } else if (mode === 'provider') {
                add({ id: model.provider, label: usageProviderLabel(model.provider), provider: model.provider }, model)
            } else {
                const harness = model.harness || 'zyra'
                add({ id: harness, label: usageHarnessLabels[harness], harness }, model)
            }
        }
    }

    const denominator = hasUsageValue(summary.totals, metric) ? usageMetricValue(summary.totals, metric) : 0
    const rows = [...groups.values()]
    for (const row of rows) {
        const value = hasUsageValue(row.totals, metric) ? usageMetricValue(row.totals, metric) : 0
        row.share = denominator > 0 ? Math.min(1, value / denominator) : 0
    }
    return rows.sort(mode === 'day'
        ? (left, right) => compareIds(right.id, left.id)
        : (left, right) => usageMetricValue(right.totals, metric) - usageMetricValue(left.totals, metric) || compareIds(left.id, right.id))
}

const tokenFormatter = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
const usdFormatter = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
const smallUsdFormatter = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 4 })
const dateFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })

export function formatUsageTokens(value: number): string {
    return tokenFormatter.format(nonNegative(value))
}

export function formatUsageUsd(value: number): string {
    const amount = nonNegative(value)
    return (amount > 0 && amount < .01 ? smallUsdFormatter : usdFormatter).format(amount)
}

export function formatUsageDate(dateKey: string): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return dateKey
    const date = new Date(`${dateKey}T12:00:00Z`)
    // Reject calendar rollover as well as invalid input; never relabel a date.
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === dateKey
        ? dateFormatter.format(date) : dateKey
}

const toolColors: Record<UsageHarness, string> = {
    zyra: 'var(--accent-primary)',
    codex: 'var(--status-success)',
    claude: 'var(--status-warning)',
    opencode: 'var(--status-info)',
    pi: 'var(--status-danger)',
    devscope: 'var(--color-text-secondary)',
    'zyra-cli': 'color-mix(in srgb, var(--accent-primary) 60%, var(--color-text))'
}

export function usageToolColor(harness: string): string {
    return Object.hasOwn(toolColors, harness) ? toolColors[harness as UsageHarness] : 'var(--color-text-secondary)'
}
