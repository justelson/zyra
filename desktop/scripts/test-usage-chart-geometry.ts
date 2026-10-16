import assert from 'node:assert/strict'
import { usageCurvePaths, usageNiceScale, type UsagePlotPoint } from '../src/renderer/src/pages/settings/usage/usage-chart-geometry'
import { readUsagePreferences, saveUsagePreferences, type UsagePagePreferences } from '../src/renderer/src/pages/settings/usage/usage-page-preferences'
import { emptyUsageTotals, usageHarnessLabels } from '../src/shared/assistant/usage-summary'
import { hasUsageValue, usageMetricValue } from '../src/renderer/src/pages/settings/usage/usage-presentation'

let passed = 0
let failed = 0
function test(name: string, run: () => void): void {
    try {
        run()
        passed += 1
        console.log(`PASS ${name}`)
    } catch (error) {
        failed += 1
        console.error(`FAIL ${name}`)
        console.error(error)
    }
}

type Point = { x: number; y: number }
type Segment = { from: Point; first: Point; second: Point; to: Point }
function parseLine(path: string): { start: Point; segments: Segment[] } {
    assert.doesNotMatch(path, /NaN|Infinity/)
    const tokenPattern = /[MC]|[-+]?(?:\d*\.?\d+)(?:e[-+]?\d+)?/gi
    assert.equal(path.replace(tokenPattern, '').replace(/[\s,]/g, ''), '', 'valid SVG line syntax')
    const tokens = path.match(tokenPattern) || []
    let index = 0
    const coordinate = () => {
        const value = Number(tokens[index++])
        assert.ok(Number.isFinite(value), 'finite coordinates')
        return value
    }
    const point = (): Point => ({ x: coordinate(), y: coordinate() })
    assert.equal(tokens[index++], 'M')
    const start = point()
    let from = start
    const segments: Segment[] = []
    while (index < tokens.length) {
        assert.equal(tokens[index++], 'C')
        const first = point(), second = point(), to = point()
        segments.push({ from, first, second, to })
        from = to
    }
    return { start, segments }
}
const cubic = (a: number, b: number, c: number, d: number, t: number) =>
    (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t ** 2 * c + t ** 3 * d
const derivative = (a: number, b: number, c: number, d: number, t: number) =>
    3 * ((b - a) * (1 - t) ** 2 + 2 * (c - b) * (1 - t) * t + (d - c) * t ** 2)

function verifyCurve(points: UsagePlotPoint[], baseline = 212): void {
    const paths = usageCurvePaths(points, baseline)
    assert.equal(paths.length, 1)
    const parsed = parseLine(paths[0].line)
    assert.deepEqual(parsed.start, { x: points[0].x, y: points[0].y })
    assert.equal(parsed.segments.length, points.length - 1)
    const tolerance = .011 // SVG coordinates are rounded to hundredths of a pixel.
    parsed.segments.forEach((segment, index) => {
        const { from, first, second, to } = segment
        assert.deepEqual(to, { x: points[index + 1].x, y: points[index + 1].y })
        assert.ok(first.x >= from.x && second.x >= first.x && to.x >= second.x, 'curve moves forward along dates')
        const low = Math.min(from.y, to.y), high = Math.max(from.y, to.y)
        const direction = Math.sign(to.y - from.y)
        for (let sample = 0; sample <= 200; sample++) {
            const t = sample / 200
            const x = cubic(from.x, first.x, second.x, to.x, t)
            const y = cubic(from.y, first.y, second.y, to.y, t)
            assert.ok(Number.isFinite(x) && Number.isFinite(y))
            assert.ok(x >= from.x - tolerance && x <= to.x + tolerance)
            assert.ok(y >= low - tolerance && y <= high + tolerance, `overshoot on segment ${index}: ${y} outside ${low}..${high}`)
            const dy = derivative(from.y, first.y, second.y, to.y, t)
            if (direction) assert.ok(direction * dy >= -.04, `reversed direction on segment ${index}`)
            else assert.ok(Math.abs(y - from.y) <= tolerance, 'flat interval remains flat')
        }
    })
    assert.equal(paths[0].area, `${paths[0].line} L${points.at(-1)!.x},${baseline} L${points[0].x},${baseline} Z`)
}

test('monotone rising and falling data preserve direction with uneven date spacing', () => {
    const x = [0, 1, 3, 50, 240, 960]
    for (const y of [[212, 211, 210, 80, 79, 8], [8, 9, 10, 140, 141, 212]]) {
        verifyCurve(x.map((value, index) => ({ x: value, y: y[index], known: true })))
    }
})

test('peaks, valleys and flat intervals never overshoot neighboring values', () => {
    for (const values of [[212, 8, 212, 8, 212], [100, 100, 8, 8, 212], [8, 212, 211, 210, 8]]) {
        verifyCurve(values.map((y, index) => ({ x: index * 240, y, known: true })))
    }
    // Deterministic varied slopes catch regressions beyond hand-picked shapes.
    let seed = 19
    for (let trial = 0; trial < 40; trial++) {
        let x = 0
        const points = Array.from({ length: 12 }, () => {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
            x += 1 + seed % 100
            return { x, y: 8 + seed % 205, known: true }
        })
        verifyCurve(points)
    }
})

test('unknown records split paths and area fills without bridging or inventing points', () => {
    const points: UsagePlotPoint[] = [
        { x: -1, y: NaN, known: false },
        { x: 0, y: 212, known: true }, { x: 120, y: 100, known: true },
        { x: 240, y: Infinity, known: false }, { x: 360, y: 0, known: false },
        { x: 480, y: 8, known: true },
        { x: 600, y: 0, known: false },
        { x: 720, y: 50, known: true }, { x: 960, y: 75, known: true },
        { x: 1080, y: NaN, known: false }
    ]
    const paths = usageCurvePaths(points, 212)
    assert.equal(paths.length, 3)
    const expectedRuns = [[points[1], points[2]], [points[5]], [points[7], points[8]]]
    paths.forEach((path, index) => {
        const run = expectedRuns[index]
        assert.deepEqual(path, usageCurvePaths(run, 212)[0], 'each segment is independent of adjacent unknown values')
        const parsed = parseLine(path.line)
        assert.equal(parsed.start.x, run[0].x)
        assert.equal(parsed.segments.at(-1)?.to.x ?? parsed.start.x, run.at(-1)!.x)
        assert.ok(path.area.endsWith(`L${run.at(-1)!.x},212 L${run[0].x},212 Z`))
    })
    assert.deepEqual(usageCurvePaths(points.filter(point => !point.known), 212), [])
    assert.deepEqual(usageCurvePaths([], 212), [])
})

test('empty periods and reported zeros stay known while unavailable cost or tokens create gaps', () => {
    const records = [
        emptyUsageTotals(),
        { ...emptyUsageTotals(), turns: 1 },
        { ...emptyUsageTotals(), turns: 1, meteredTurns: 1 },
        { ...emptyUsageTotals(), turns: 1, meteredTurns: 1, pricedTurns: 1 },
        { ...emptyUsageTotals(), turns: 2, meteredTurns: 1, pricedTurns: 1, tokens: 30, costUsd: .1 }
    ]
    for (const metric of ['tokens', 'cost'] as const) {
        const scale = usageNiceScale(Math.max(...records.map(row => usageMetricValue(row, metric))))
        const points = records.map((row, index) => ({ x: index * 240, y: 212 - usageMetricValue(row, metric) / scale.max * 204, known: hasUsageValue(row, metric) }))
        assert.deepEqual(points.map(point => point.known), metric === 'cost' ? [true, false, false, true, true] : [true, false, true, true, true])
        const paths = usageCurvePaths(points, 212)
        assert.equal(paths.length, 2)
        assert.equal(parseLine(paths[0].line).segments.length, 0, 'empty calendar day stays zero, not joined across unavailable activity')
        assert.equal(parseLine(paths[1].line).start.x, metric === 'cost' ? 720 : 480)
        assert.equal(parseLine(paths[1].line).segments.at(-1)!.to.x, 960)
        for (const path of paths) assert.doesNotMatch(path.line + path.area, /NaN|Infinity/)
    }
})

test('all-zero and single-point geometry remain finite and use the supplied baseline', () => {
    verifyCurve([0, 480, 960].map(x => ({ x, y: 212, known: true })))
    const single = usageCurvePaths([{ x: 480, y: 8, known: true }], 212)
    assert.deepEqual(single, [{ line: 'M480.00,8.00', area: 'M480.00,8.00 L480,212 L480,212 Z' }])
    assert.equal(parseLine(single[0].line).segments.length, 0, 'one point does not invent a curve')
    assert.deepEqual(usageCurvePaths([{ x: 480, y: 212, known: false }], 212), [])
    verifyCurve([{ x: 0, y: 0, known: true }, { x: 960, y: 10, known: true }], 300)
})

test('curve construction accepts frozen points and leaves geometry unchanged', () => {
    const points = [{ x: 0, y: 212, known: true }, { x: 480, y: 8, known: false }, { x: 960, y: 100, known: true }]
    const snapshot = structuredClone(points)
    points.forEach(Object.freeze)
    Object.freeze(points)
    const paths = usageCurvePaths(points, 212)
    paths[0].line = 'caller change'
    paths.reverse()
    assert.deepEqual(points, snapshot)
    assert.deepEqual(usageCurvePaths(points, 212), usageCurvePaths(snapshot, 212))
})

test('zero, negative and nonfinite peaks return a usable finite scale', () => {
    for (const peak of [0, -1, NaN, Infinity, -Infinity]) assert.deepEqual(usageNiceScale(peak), { max: 1, ticks: [0] })
    assert.deepEqual(usageNiceScale(37), { max: 40, ticks: [0, 10, 20, 30, 40] })
    assert.deepEqual(usageNiceScale(.0031), { max: .004, ticks: [0, .001, .002, .003, .004] })
})

test('cost and token scales cover the peak with finite, ascending, uniformly spaced ticks', () => {
    const peaks = [1e-12, .00001, .0012, .01, .99, 1, 1.01, 2, 5, 10, 37, 99, 100, 100.01, 999999, 158400000000, 1e15]
    for (const peak of peaks) for (const count of [1, 2, 4, 7]) {
        const { max, ticks } = usageNiceScale(peak, count)
        assert.ok(Number.isFinite(max) && max >= peak && max > 0)
        assert.equal(ticks[0], 0)
        assert.ok(ticks.length >= 2 && ticks.length <= count + 2, 'bounded tick density')
        const step = ticks[1]
        const tolerance = step * 1e-8
        assert.ok(max <= peak + step + tolerance, 'no unnecessary extra scale range')
        assert.ok(Math.abs(ticks.at(-1)! - max) <= tolerance, 'top tick aligns with scale maximum')
        ticks.forEach((tick, index) => {
            assert.ok(Number.isFinite(tick) && tick >= 0 && tick <= max + tolerance)
            if (index) {
                assert.ok(tick > ticks[index - 1])
                assert.ok(Math.abs(tick - ticks[index - 1] - step) <= tolerance)
            }
            assert.ok(Number.isFinite(212 - tick / max * 204), 'finite plot position')
        })
        const normalized = step / 10 ** Math.floor(Math.log10(step))
        assert.ok([1, 2, 5, 10].some(value => Math.abs(value - normalized) < 1e-8), 'readable tick interval')
    }
    let previous = 0
    for (const peak of peaks) {
        const max = usageNiceScale(peak).max
        assert.ok(max >= previous, 'increasing peaks do not shrink the scale')
        previous = max
    }
})

const preferenceKey = 'zyra:usage-page:v1'
const defaults: UsagePagePreferences = { metric: 'cost', days: 30, harness: 'all', breakdown: 'model', chartView: 'daily' }
type FakeStore = { values: Map<string, string>; reads: string[]; writes: Array<[string, string]> }
function withWindow(value: unknown, run: () => void): void {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
    try {
        if (value === undefined) Reflect.deleteProperty(globalThis, 'window')
        else Object.defineProperty(globalThis, 'window', { configurable: true, value })
        run()
    } finally {
        if (original) Object.defineProperty(globalThis, 'window', original)
        else Reflect.deleteProperty(globalThis, 'window')
    }
}
function withStore(raw: string | null, run: (store: FakeStore) => void, failure?: 'read' | 'write'): void {
    const store: FakeStore = { values: new Map(raw === null ? [] : [[preferenceKey, raw]]), reads: [], writes: [] }
    withWindow({ localStorage: {
        getItem(key: string) {
            store.reads.push(key)
            if (failure === 'read') throw new Error('Storage unavailable')
            return store.values.get(key) ?? null
        },
        setItem(key: string, value: string) {
            if (failure === 'write') throw new Error('Storage full')
            store.writes.push([key, value])
            store.values.set(key, value)
        }
    } }, () => run(store))
}

test('missing and corrupt preference records use defaults without rewriting stored data', () => {
    for (const raw of [null, '', '{', 'undefined', 'null', '42', 'true', '"old"', '[]', '{}', '[{"harness":"codex"}]']) {
        withStore(raw, store => {
            assert.deepEqual(readUsagePreferences(), defaults)
            assert.deepEqual(store.reads, [preferenceKey])
            assert.deepEqual(store.writes, [])
            assert.equal(store.values.get(preferenceKey) ?? null, raw)
        })
    }
})

test('legacy partial preferences preserve valid fields and default newly added settings', () => {
    withStore(JSON.stringify({ days: 7, harness: 'codex', breakdown: 'harness', chartView: 'weekly', oldFlag: true }), () => {
        assert.deepEqual(readUsagePreferences(), { ...defaults, days: 7, harness: 'codex', breakdown: 'harness', chartView: 'weekly' })
    })
    withStore(JSON.stringify({ metric: 'tokens', chartView: 'activity' }), () => {
        assert.deepEqual(readUsagePreferences(), { ...defaults, metric: 'tokens', chartView: 'activity' })
    })
})

test('every supported metric, period, tool, breakdown and chart view survives saving and reading', () => {
    const choices: { [K in keyof UsagePagePreferences]: UsagePagePreferences[K][] } = {
        metric: ['cost', 'tokens', 'limits'], days: [7, 30, 90, 365, 'all'],
        harness: ['all', ...Object.keys(usageHarnessLabels) as Array<keyof typeof usageHarnessLabels>],
        breakdown: ['model', 'day', 'harness', 'provider'], chartView: ['daily', 'weekly', 'cumulative', 'activity']
    }
    for (const field of Object.keys(choices) as Array<keyof UsagePagePreferences>) for (const choice of choices[field]) {
        const value = { ...defaults, [field]: choice }
        const snapshot = { ...value }
        Object.freeze(value)
        withStore(null, store => {
            saveUsagePreferences(value)
            assert.deepEqual(store.writes, [[preferenceKey, JSON.stringify(value)]])
            assert.deepEqual(readUsagePreferences(), value)
            assert.deepEqual(value, snapshot)
        })
    }
})

test('invalid preference fields default independently without discarding valid settings', () => {
    const valid: UsagePagePreferences = { metric: 'tokens', days: 90, harness: 'pi', breakdown: 'day', chartView: 'weekly' }
    const corrupt: Record<keyof UsagePagePreferences, unknown[]> = {
        metric: ['spend', '', 1, null, {}, ['tokens']],
        days: [0, 14, -7, '7', null, {}, [7]],
        harness: ['future-tool', '', 'constructor', '__proto__', 7, null, {}],
        breakdown: ['tool', '', 1, null, {}, ['day']],
        chartView: ['monthly', '', 1, null, {}, ['daily']]
    }
    for (const field of Object.keys(corrupt) as Array<keyof UsagePagePreferences>) for (const invalid of corrupt[field]) {
        withStore(JSON.stringify({ ...valid, [field]: invalid }), () => {
            assert.deepEqual(readUsagePreferences(), { ...valid, [field]: defaults[field] }, `${field}: ${JSON.stringify(invalid)}`)
        })
    }
})

test('corrupt harness arrays cannot masquerade as a supported tool', () => {
    for (const harness of [['codex'], ['zyra'], ['claude'], [['pi']]]) {
        withStore(JSON.stringify({ ...defaults, metric: 'tokens', harness }), () => {
            assert.deepEqual(readUsagePreferences(), { ...defaults, metric: 'tokens' }, 'stored harness must be a string')
        })
    }
})

test('disabled storage and absent window do not block reading or saving preferences', () => {
    withStore(null, () => assert.deepEqual(readUsagePreferences(), defaults), 'read')
    withStore(null, store => {
        assert.doesNotThrow(() => saveUsagePreferences(defaults))
        assert.deepEqual(store.writes, [])
    }, 'write')
    for (const window of [undefined, {}]) withWindow(window, () => {
        assert.deepEqual(readUsagePreferences(), defaults)
        assert.doesNotThrow(() => saveUsagePreferences(defaults))
    })
})

test('preference reads return independent objects and cannot mutate future defaults or saved choices', () => {
    for (const raw of [null, '{', JSON.stringify({ ...defaults, metric: 'tokens', harness: 'codex' })]) withStore(raw, store => {
        const first = readUsagePreferences()
        const snapshot = { ...first }
        first.metric = 'limits'
        first.harness = 'pi'
        assert.deepEqual(readUsagePreferences(), snapshot)
        assert.deepEqual(store.writes, [])
    })
})

console.log(`Usage chart geometry/preferences: ${passed} tests passed, ${failed} failed.`)
if (failed) process.exitCode = 1
