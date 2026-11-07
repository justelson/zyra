import assert from 'node:assert/strict'
import type { ResponseTimingRecord } from '../src/shared/response-timing'
import { sortResponseTimings, summarizeResponseTimings } from '../src/renderer/src/pages/settings/response-timing-summary'

const record = (startedAt: number, text: number | null, visible = text, outcome: ResponseTimingRecord['outcome'] = 'completed') => ({ startedAt, firstTextReceivedMs: text, firstDisplayMs: visible, outcome }) as ResponseTimingRecord
const records = [record(1, 999999), record(3, 200, null), record(2, 100, 300), record(4, null), record(5, 900000, 900000, 'running')]
const before = [...records]
const summary = summarizeResponseTimings(records)
assert.equal(summary.total, 5)
assert.equal(summary.running, 1)
assert.equal(summary.firstText.value, 200, 'medians resist the historical slow-turn outlier and exclude running turns')
assert.equal(summary.firstText.count, 3)
assert.equal(summary.visible.value, (999999 + 300) / 2, 'missing display measurements are not zero')
assert.equal(summarizeResponseTimings([]).firstText.value, null)
assert.equal(summarizeResponseTimings([record(1, null)]).visible.count, 0)
assert.equal(summarizeResponseTimings(Array.from({ length: 21 }, (_, i) => record(i, i === 0 ? 999999 : 10))).firstText.value, 10, 'summary uses the latest 20 completed turns')
assert.equal(summarizeResponseTimings([record(1, 0), record(2, 100)]).firstText.value, 50, 'observed zero remains a real sample')
assert.deepEqual(sortResponseTimings(records, 'newest').map(row => row.startedAt), [5, 4, 3, 2, 1])
assert.deepEqual(sortResponseTimings(records, 'oldest').map(row => row.startedAt), [1, 2, 3, 4, 5])
assert.deepEqual(sortResponseTimings(records, 'first-text').map(row => row.startedAt), [1, 5, 3, 2, 4])
assert.deepEqual(sortResponseTimings(records, 'visible').map(row => row.startedAt), [1, 5, 2, 4, 3])
assert.deepEqual(records, before, 'sorting and summary preserve the source records and raw export order')
console.log('Response timing summary: recent completed medians, missing observations, all history sorts and source preservation passed')
