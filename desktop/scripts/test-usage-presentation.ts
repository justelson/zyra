import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
    buildUsageSummary,
    emptyUsageTotals,
    usageHarnessLabels,
    type UsageBreakdown,
    type UsageEntry,
    type UsageSummary,
    type UsageTotals
} from '../src/shared/assistant/usage-summary'
import { projectUsageChart } from '../src/shared/assistant/usage-chart'
import {
    formatUsageDate,
    formatUsageTokens,
    formatUsageUsd,
    groupUsageRows,
    hasUsageValue,
    usageMetricValue,
    usageToolColor,
    type UsageBreakdownMode,
    type UsageMetric,
    type UsageTableRow
} from '../src/renderer/src/pages/settings/usage/usage-presentation'

let passed = 0
function test(name: string, run: () => void): void {
    run()
    passed += 1
    console.log(`PASS ${name}`)
}

const totals = (patch: Partial<UsageTotals> = {}): UsageTotals => ({ ...emptyUsageTotals(), ...patch })
const first = totals({ input: 60, output: 20, cached: 10, cacheWrite: 10, tokens: 100, costUsd: 2, turns: 3, meteredTurns: 2, pricedTurns: 1 })
const second = totals({ input: 100, output: 50, cached: 25, cacheWrite: 25, tokens: 200, costUsd: 1, turns: 2, meteredTurns: 2, pricedTurns: 2 })
const third = totals({ input: 250, output: 150, cached: 75, cacheWrite: 25, tokens: 500, costUsd: 1, turns: 4, meteredTurns: 3, pricedTurns: 1 })
const unpriced = totals({ input: 400, output: 100, tokens: 500, turns: 2, meteredTurns: 2 })
const unmetered = totals({ turns: 1 })
const expensive = totals({ input: 80, output: 20, tokens: 100, costUsd: 4, turns: 1, meteredTurns: 1, pricedTurns: 1 })
const summary: UsageSummary = {
    days: 4,
    timeZone: 'Pacific/Kiritimati',
    fetchedAt: '2026-10-13T12:00:00Z',
    totals: totals({ input: 890, output: 340, cached: 110, cacheWrite: 60, tokens: 1400, costUsd: 8, turns: 13, meteredTurns: 10, pricedTurns: 5 }),
    models: [
        { id: 'codex:openai/shared', provider: 'openai', model: 'shared', harness: 'codex', ...second },
        { id: 'legacy', provider: 'unknown', model: 'Mystery', ...unmetered },
        { id: 'pi:custom/future', provider: 'custom', model: 'future', harness: 'pi', ...unpriced },
        { id: 'zyra:openai/shared', provider: 'openai', model: 'shared', harness: 'zyra', ...first },
        { id: 'opencode:anthropic/small', provider: 'anthropic', model: 'small', harness: 'opencode', ...expensive },
        { id: 'claude:anthropic/shared', provider: 'anthropic', model: 'shared', harness: 'claude', ...third }
    ],
    daily: [
        { date: '2026-10-11', ...totals({ input: 650, output: 250, cached: 75, cacheWrite: 25, tokens: 1000, costUsd: 1, turns: 6, meteredTurns: 5, pricedTurns: 1 }) },
        { date: '2026-10-13', ...totals({ input: 160, output: 70, cached: 35, cacheWrite: 35, tokens: 300, costUsd: 3, turns: 5, meteredTurns: 4, pricedTurns: 3 }) },
        { date: '2026-10-10', ...totals() },
        { date: '2026-10-12', ...totals({ ...expensive, turns: 2 }) }
    ]
}
const modes: UsageBreakdownMode[] = ['model', 'provider', 'harness', 'day']
const metrics: Exclude<UsageMetric, 'limits'>[] = ['cost', 'tokens']
const ids = (rows: UsageTableRow[]) => rows.map(row => row.id)
const rowById = (rows: UsageTableRow[], id: string): UsageTableRow => {
    const row = rows.find(value => value.id === id)
    assert.ok(row, `Missing ${id}`)
    return row
}
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`)

test('models merge across tools, retain provider identity and every totals field', () => {
    const rows = groupUsageRows(summary, 'model', 'cost')
    assert.deepEqual(ids(rows), ['anthropic/small', 'openai/shared', 'anthropic/shared', 'custom/future', 'unknown/Mystery'])
    assert.deepEqual(rowById(rows, 'openai/shared'), {
        id: 'openai/shared', label: 'shared', provider: 'openai',
        totals: totals({ input: 160, output: 70, cached: 35, cacheWrite: 35, tokens: 300, costUsd: 3, turns: 5, meteredTurns: 4, pricedTurns: 3 }),
        share: 3 / 8
    })
    assert.deepEqual(rowById(rows, 'anthropic/shared').totals, third, 'same model name under a different provider stays separate')
    assert.equal(rowById(rows, 'anthropic/shared').harness, undefined, 'a merged model has no arbitrary tool identity')
    assert.deepEqual(ids(groupUsageRows(summary, 'model', 'tokens')), ['anthropic/shared', 'custom/future', 'openai/shared', 'anthropic/small', 'unknown/Mystery'])
})

test('provider and tool grouping rank by selected metric with shared labels and legacy tool fallback', () => {
    const providers = groupUsageRows(summary, 'provider', 'cost')
    assert.deepEqual(ids(providers), ['anthropic', 'openai', 'custom', 'unknown'])
    assert.deepEqual(rowById(providers, 'anthropic'), {
        id: 'anthropic', label: 'Anthropic', provider: 'anthropic',
        totals: totals({ input: 330, output: 170, cached: 75, cacheWrite: 25, tokens: 600, costUsd: 5, turns: 5, meteredTurns: 4, pricedTurns: 2 }), share: 5 / 8
    })
    assert.equal(rowById(providers, 'unknown').label, 'Unknown provider')
    assert.equal(rowById(providers, 'custom').label, 'custom')
    assert.deepEqual(ids(groupUsageRows(summary, 'provider', 'tokens')), ['anthropic', 'custom', 'openai', 'unknown'])
    const tools = groupUsageRows(summary, 'harness', 'cost')
    assert.deepEqual(ids(tools), ['opencode', 'zyra', 'claude', 'codex', 'pi'])
    assert.deepEqual(rowById(tools, 'zyra'), {
        id: 'zyra', label: 'Zyra', harness: 'zyra', totals: { ...first, turns: 4 }, share: 2 / 8
    })
    assert.equal(rowById(tools, 'claude').label, 'Claude Code')
    assert.equal(rowById(tools, 'zyra').provider, undefined, 'tool groups do not claim a single provider')
    assert.deepEqual(ids(groupUsageRows(summary, 'harness', 'tokens')), ['claude', 'pi', 'codex', 'opencode', 'zyra'])
})

test('all groupings conserve all totals and shares use the selected summary denominator', () => {
    for (const mode of modes) for (const metric of metrics) {
        const rows = groupUsageRows(summary, mode, metric)
        for (const field of Object.keys(summary.totals) as Array<keyof UsageTotals>) {
            assert.equal(rows.reduce((sum, row) => sum + row.totals[field], 0), summary.totals[field], `${mode}: ${field}`)
        }
        const denominator = metric === 'cost' ? 8 : 1400
        for (const row of rows) close(row.share, (metric === 'cost' ? row.totals.costUsd : row.totals.tokens) / denominator)
        close(rows.reduce((sum, row) => sum + row.share, 0), 1)
    }
    const subset = { ...summary, models: summary.models.slice(0, 1) }
    assert.equal(groupUsageRows(subset, 'model', 'cost')[0].share, 1 / 8, 'do not inflate a subset to 100%')
})

test('days are newest first including empty days, regardless of metric; chart input remains chronological', () => {
    const chronological = { ...summary, daily: [...summary.daily].sort((a, b) => a.date.localeCompare(b.date)) }
    for (const metric of metrics) {
        const rows = groupUsageRows(chronological, 'day', metric)
        assert.deepEqual(ids(rows), ['2026-10-13', '2026-10-12', '2026-10-11', '2026-10-10'])
        assert.equal(rows[0].date, '2026-10-13')
        assert.equal(rows[0].label, formatUsageDate('2026-10-13'))
        assert.deepEqual(rows[3].totals, emptyUsageTotals())
        assert.equal(rows[3].share, 0)
    }
    assert.deepEqual(chronological.daily.map(day => day.date), ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'])
    const cumulative = projectUsageChart(chronological.daily, 'cumulative')
    assert.deepEqual(cumulative.map(day => day.tokens), [0, 1000, 1100, 1400])
    assert.deepEqual(cumulative.map(day => day.costUsd), [0, 1, 5, 8])
    const weekly = projectUsageChart(chronological.daily, 'weekly')
    assert.deepEqual(weekly.map(day => [day.date, day.tokens, day.costUsd]), [['2026-10-05', 1000, 1], ['2026-10-12', 400, 7]])
})

test('ties are deterministic under reversed inputs, including unpriced and unmetered rows', () => {
    const reversed = { ...summary, models: [...summary.models].reverse(), daily: [...summary.daily].reverse() }
    for (const mode of modes) for (const metric of metrics) {
        assert.deepEqual(groupUsageRows(reversed, mode, metric), groupUsageRows(summary, mode, metric))
    }
})

test('actual shared summary keeps unknown prices, partial records, and reported zero honest', () => {
    const turn = (id: string, usage: UsageEntry['usage']): UsageEntry => ({
        id, threadId: 'one-thread', sessionId: 'one-session', model: 'custom/future-model',
        harness: 'codex', requestedAt: '2026-10-13T08:00:00Z', usage
    })
    const actual = buildUsageSummary([
        turn('unpriced', { inputTokens: 40, outputTokens: 10 }),
        turn('partial', { inputTokens: 20, costUsd: .25, costSource: 'reported' }),
        turn('missing', null),
        turn('context-only', { totalTokens: 999999, sessionCostUsd: 80 }),
        turn('zero', { inputTokens: 0, outputTokens: 0, costUsd: 0, costSource: 'reported' })
    ], { days: 7, timeZone: 'UTC' }, new Date('2026-10-13T12:00:00Z'))
    const row = groupUsageRows(actual, 'model', 'cost')[0]
    assert.deepEqual(row.totals, totals({ input: 60, output: 10, tokens: 70, costUsd: .25, turns: 5, meteredTurns: 3, pricedTurns: 2 }))
    assert.equal(row.share, 1)
    assert.equal(hasUsageValue(row.totals, 'cost'), true, 'available partial cost may be displayed')
    assert.equal(hasUsageValue(row.totals, 'tokens'), true)
    assert.equal(row.totals.turns, 5, 'five turn records in one session stay five turns')
    const unknown = buildUsageSummary([turn('unpriced', { inputTokens: 40, outputTokens: 10 })], { days: 7 }, new Date('2026-10-13T12:00:00Z'))
    const unknownRow = groupUsageRows(unknown, 'model', 'cost')[0]
    assert.equal(unknownRow.totals.costUsd, 0)
    assert.equal(unknownRow.totals.pricedTurns, 0, 'presentation must not invent model pricing')
    assert.equal(hasUsageValue(unknownRow.totals, 'cost'), false)
    assert.equal(unknownRow.share, 0)
    assert.equal(groupUsageRows(unknown, 'model', 'tokens')[0].share, 1)
})

test('availability distinguishes empty, unknown, partial, and metered or priced zero', () => {
    for (const metric of metrics) {
        assert.equal(hasUsageValue(totals(), metric), true)
        assert.equal(hasUsageValue(unmetered, metric), false)
        assert.equal(usageMetricValue(totals(), metric), 0)
    }
    assert.equal(hasUsageValue(totals({ turns: 1, meteredTurns: 1 }), 'tokens'), true)
    assert.equal(hasUsageValue(totals({ turns: 1, pricedTurns: 1 }), 'cost'), true)
    assert.equal(hasUsageValue(totals({ turns: 2, tokens: 100, meteredTurns: 1 }), 'cost'), false)
    assert.equal(hasUsageValue(totals({ turns: 2, costUsd: .01, pricedTurns: 1 }), 'tokens'), false)
    assert.equal(hasUsageValue(totals({ turns: 1, meteredTurns: NaN }), 'tokens'), false)
    assert.equal(hasUsageValue(totals({ turns: 1, pricedTurns: Infinity }), 'cost'), false)
    assert.equal(usageMetricValue(first, 'cost'), 2)
    assert.equal(usageMetricValue(first, 'tokens'), 100)
})

test('empty, zero, nonfinite and incomplete numeric data stay finite without dropping rows', () => {
    const empty = { ...summary, totals: totals(), daily: [], models: [] }
    for (const mode of modes) for (const metric of metrics) assert.deepEqual(groupUsageRows(empty, mode, metric), [])
    for (const invalid of [0, NaN, Infinity, -Infinity, -1]) for (const metric of metrics) {
        const invalidSummary = { ...summary, totals: { ...summary.totals, tokens: invalid, costUsd: invalid } }
        for (const mode of modes) {
            const rows = groupUsageRows(invalidSummary, mode, metric)
            assert.ok(rows.length > 0)
            assert.ok(rows.every(row => row.share === 0))
        }
        assert.equal(usageMetricValue(totals({ tokens: invalid, costUsd: invalid }), metric), 0)
    }
    // Simulate an older/incomplete serialized totals object at the typed boundary.
    const incomplete = { id: 'legacy', model: 'Legacy', provider: 'unknown', turns: 1 } as UsageBreakdown
    const invalidRow = { id: 'bad', model: 'Bad', provider: 'unknown', ...totals({ input: NaN, output: -1, cached: Infinity, tokens: NaN, costUsd: Infinity, turns: 1 }) }
    for (const metric of metrics) {
        const rows = groupUsageRows({ ...summary, models: [incomplete, invalidRow] }, 'model', metric)
        assert.equal(rows.length, 2)
        for (const row of rows) {
            assert.deepEqual(row.totals, totals({ turns: 1 }))
            assert.equal(row.share, 0)
            assert.equal(hasUsageValue(row.totals, metric), false)
        }
        const zeroSummary = { ...empty, totals: totals({ turns: 1, meteredTurns: 1, pricedTurns: 1 }), models: [{ ...summary.models[0], ...totals({ turns: 1, meteredTurns: 1, pricedTurns: 1 }) }] }
        assert.equal(groupUsageRows(zeroSummary, 'model', metric)[0].share, 0)
        assert.equal(hasUsageValue(zeroSummary.totals, metric), true)
    }
})

test('grouping never mutates inputs or shares totals objects with inputs or later results', () => {
    const freeze = <T>(value: T): T => {
        if (value !== null && typeof value === 'object') {
            for (const child of Object.values(value)) freeze(child)
            Object.freeze(value)
        }
        return value
    }
    const snapshot = structuredClone(summary)
    const frozen = freeze(structuredClone(summary))
    for (const mode of modes) for (const metric of metrics) {
        const rows = groupUsageRows(frozen, mode, metric)
        rows[0].totals.tokens = 999999
        rows[0].label = 'changed by caller'
        rows.reverse()
        assert.deepEqual(frozen, snapshot)
        assert.deepEqual(groupUsageRows(frozen, mode, metric), groupUsageRows(snapshot, mode, metric))
    }
})

test('formatters preserve compact tokens, small USD amounts, valid date keys, and numeric safety', () => {
    const tokenFormat = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
    for (const value of [0, 999, 1234, 1200000, 2300000000]) assert.equal(formatUsageTokens(value), tokenFormat.format(value))
    assert.notEqual(formatUsageTokens(1234), formatUsageTokens(0))
    const dollars = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
    const cents = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 4 })
    assert.equal(formatUsageUsd(0), dollars.format(0))
    assert.equal(formatUsageUsd(12.34), dollars.format(12.34))
    assert.equal(formatUsageUsd(.01), dollars.format(.01))
    assert.equal(formatUsageUsd(.0012), cents.format(.0012))
    assert.notEqual(formatUsageUsd(.0012), formatUsageUsd(0), 'small recorded costs must remain visible')
    for (const value of [NaN, Infinity, -Infinity, -1]) {
        assert.equal(formatUsageTokens(value), formatUsageTokens(0))
        assert.equal(formatUsageUsd(value), formatUsageUsd(0))
    }
    const calendar = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
    for (const key of ['2026-01-01', '2024-02-29', '2026-10-13', '2026-12-31']) assert.equal(formatUsageDate(key), calendar.format(new Date(`${key}T12:00:00Z`)))
    for (const key of ['', 'bad-date', '2026-02-29', '2026-02-30', '2026-13-01', '2026-1-1', '2026-10-13T00:00:00Z']) assert.equal(formatUsageDate(key), key)
})

test('all seven tool colors reference existing theme tokens and unknown keys have a safe fallback', () => {
    const css = readFileSync(new URL('../src/renderer/src/styles/theme-tokens.css', import.meta.url), 'utf8')
    const harnesses = Object.keys(usageHarnessLabels)
    assert.equal(harnesses.length, 7)
    const colors = harnesses.map(usageToolColor)
    assert.equal(new Set(colors).size, 7)
    for (const color of colors) {
        assert.doesNotMatch(color, /#[0-9a-f]|\b(?:rgb|hsl)a?\(/i, 'colors follow the active theme')
        const tokens = [...color.matchAll(/var\((--[a-z-]+)\)/g)].map(match => match[1])
        assert.ok(tokens.length > 0)
        for (const token of tokens) assert.ok(css.includes(`${token}:`), `Undefined token ${token}`)
    }
    for (const harness of ['future-tool', '', '__proto__', 'constructor']) {
        assert.equal(usageToolColor(harness), usageToolColor('devscope'))
    }
})

console.log(`Usage presentation: ${passed} tests passed.`)
