import assert from 'node:assert/strict'
import { buildUsageSummary, mergeUsageSummaries, type UsageEntry } from '../src/shared/assistant/usage-summary'
import { buildUsageRollup, summarizeUsageRollup } from '../src/shared/assistant/usage-rollup'
import { buildUsageSeries, scopeUsageSummary, usageSeriesColor } from '../src/renderer/src/pages/settings/usage/usage-series'
import { formatUsageMeasurement } from '../src/renderer/src/pages/settings/usage/usage-presentation'

const now = new Date('2026-10-14T18:00:00Z')
const turns: UsageEntry[] = [
    { id: 'a', harness: 'codex', model: 'openai/fixture-a', requestedAt: '2026-10-12T12:00:00Z', usage: { inputTokens: 100, outputTokens: 20, costUsd: 2, costSource: 'reported' } },
    { id: 'b', harness: 'zyra', model: 'anthropic/fixture-b', requestedAt: '2026-10-13T12:00:00Z', usage: { inputTokens: 300, outputTokens: 40, costSource: 'unpriced' } },
    { id: 'c', harness: 'zyra', model: 'openai/fixture-a', requestedAt: '2026-10-14T12:00:00Z', usage: null }
]
const summary = buildUsageSummary(turns, { days: 7 }, now)
assert.equal(summary.dayModels?.length, 3)
assert.deepEqual(summarizeUsageRollup(buildUsageRollup(turns, 'UTC', now), { days: 7 }, now).dayModels, summary.dayModels)
const filtered = summarizeUsageRollup(buildUsageRollup(turns, 'UTC', now), { days: 7, harness: 'codex' }, now)
assert.equal(filtered.dayModels?.length, 1)
assert.equal(filtered.dayModels?.[0].harness, 'codex')
for (const view of ['daily', 'weekly', 'cumulative'] as const) {
    const series = buildUsageSeries(summary, 'provider', 'tokens', view)
    assert.equal(series.length, 2)
    for (const row of series) assert.equal(row.color, usageSeriesColor('provider', row.id))
    if (view === 'weekly') assert.equal(series.reduce((sum, row) => sum + row.daily.reduce((total, day) => total + day.tokens, 0), 0), summary.totals.tokens)
    for (let index = 0; index < series[0].daily.length; index++) {
        // Real series conserve available measurements, including cumulative/weekly projections.
        const actual = series.reduce((sum, row) => sum + row.daily[index].tokens, 0)
        if (view === 'daily') assert.equal(actual, summary.daily[index].tokens)
        if (view === 'cumulative' && index === series[0].daily.length - 1) assert.equal(actual, summary.totals.tokens)
    }
}
const providers = buildUsageSeries(summary, 'provider', 'cost', 'daily')
assert.notEqual(providers[0].color, providers[1].color)
for (const mode of ['provider', 'model'] as const) {
    const before = buildUsageSeries(summary, mode, 'tokens', 'daily')
    const after = buildUsageSeries({ ...summary, models: [...summary.models].reverse(), dayModels: [...summary.dayModels!].reverse() }, mode, 'cost', 'weekly')
    before.forEach(row => assert.equal(row.color, after.find(other => other.id === row.id)?.color))
}
const anthropic = scopeUsageSummary(summary, { mode: 'provider', id: 'anthropic', label: 'Anthropic' })
assert.equal(formatUsageMeasurement(anthropic.totals, 'cost'), 'Unpriced')
assert.equal(anthropic.daily.find(day => day.date === '2026-10-12')?.tokens, 0, 'do not assign aggregate day totals to each model')
assert.equal(anthropic.daily.find(day => day.date === '2026-10-13')?.tokens, 340)
assert.equal(scopeUsageSummary(summary, { mode: 'model', id: 'openai/fixture-a', label: 'a' }).totals.turns, 2)
const merged = mergeUsageSummaries(buildUsageSummary(turns.slice(0, 1), { days: 7 }, now), buildUsageSummary(turns.slice(1), { days: 7 }, now))
assert.equal(merged.dayModels?.length, 3)
const legacy = { ...summary, dayModels: undefined }
assert.deepEqual(buildUsageSeries(legacy, 'model', 'tokens', 'daily'), [])
assert.equal(mergeUsageSummaries(summary, legacy).dayModels, undefined, 'mixed legacy merges must not claim complete model trends')
assert.equal(scopeUsageSummary(legacy, { mode: 'provider', id: 'anthropic', label: 'Anthropic' }).totals.tokens, 340)
console.log('Usage chart color/bucket regression checks passed')
