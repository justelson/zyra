import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ResponseTimingRecorder, RESPONSE_TIMING_STORAGE_LIMIT } from '../src/main/diagnostics/response-timing-recorder'
import { readModelRequestProgress } from '../src/shared/assistant/model-progress'
import { sanitizeAnalyticsEvent } from '../../src/analytics/contracts.mjs'
import type { AssistantRuntimeEvent } from '../src/shared/assistant/contracts'

const directory = await mkdtemp(join(tmpdir(), 'zyra-response-timing-'))
let clock = 1_800_000_000_000
const captured: any[] = []
const recorder = new ResponseTimingRecorder(directory, input => captured.push(sanitizeAnalyticsEvent(input, { source: 'desktop_main' })), () => clock)
const turnId = 'assistant-turn-fixture'
const event = (type: string, payload: unknown, id = turnId) => recorder.observe({ eventId: 'event', threadId: 'thread', turnId: id, type, payload, createdAt: new Date(clock).toISOString() } as AssistantRuntimeEvent)
const progress = (value: unknown) => event('model.progress', { progress: readModelRequestProgress(value, turnId) })
try {
    recorder.start({ turnId, threadId: 'thread', model: 'openai-codex/gpt-6.1-sol', effort: 'high', submittedAt: clock - 50, receivedAt: clock })
    clock += 100
    recorder.dispatch(turnId)
    event('turn.accepted', {})
    const startedAt = clock + 30
    clock = startedAt
    progress({ requestId: 'request-1', startedAt, lastActivityAt: clock, phase: 'waiting', canPing: true })
    clock += 200
    progress({ requestId: 'request-1', startedAt, lastActivityAt: clock, firstEventAt: clock, phase: 'streaming', canPing: true })
    clock += 4000
    progress({ requestId: 'request-1', startedAt, lastActivityAt: clock, firstEventAt: startedAt + 200, firstTextAt: clock, maxActivityGapMs: 4000, phase: 'streaming', canPing: false })
    clock += 5
    event('content.delta', { streamKind: 'assistant_text', delta: 'PRIVATE_FIXTURE_TEXT' })
    assert.equal(recorder.displayed({ turnId, at: clock - 100 }), false, 'a display cannot precede incoming text')
    clock += 30
    assert.equal(recorder.displayed({ turnId, at: clock }), true)
    assert.equal(recorder.displayed({ turnId, at: clock }), false, 'only the first display counts')
    progress(null)
    clock += 300_000 // A slow tool is not a provider streaming gap.
    progress({ requestId: 'request-2', startedAt: clock, lastActivityAt: clock, phase: 'waiting', canPing: true })
    const retry = { activityId: 'retry-1', kind: 'connection.recovery', data: { status: 'retrying', attempt: 1 } }
    event('activity', retry); event('activity', retry)
    event('activity', { activityId: 'compact', kind: 'context.compaction', data: { status: 'running' } })
    clock += 500
    event('activity', { activityId: 'compact', kind: 'context.compaction', data: { status: 'completed' } })
    recorder.recordStall({ reason: 'main-event-loop-stall-recovered', processKind: 'main', durationMs: 2100 })
    recorder.recordStall({ reason: 'renderer-long-task-recovered', processKind: 'renderer', durationMs: 1000 }, 'another-thread')
    recorder.recordStall({ reason: 'sustained-renderer-high-cpu', processKind: 'renderer', durationMs: 3000 }, 'thread')
    event('turn.completed', { outcome: 'completed' })
    event('turn.completed', { outcome: 'completed' })
    const row = (await recorder.read()).records[0]
    assert.equal(row.stallCount, 1)
    assert.equal(row.mainStallMs, 2100)
    assert.equal(row.rendererStallMs, 0)
    assert.equal(row.mainReceivedMs, 50)
    assert.equal(row.dispatchMs, 150)
    assert.equal(row.firstEventMs, 380)
    assert.equal(row.firstTextMs, 4380)
    assert.equal(row.firstTextReceivedMs, 4385)
    assert.equal(row.firstDisplayMs, 4415)
    assert.equal(row.maxStreamingGapMs, 4000)
    assert.equal(row.requestCount, 2)
    assert.equal(row.retryCount, 1)
    assert.equal(row.compactionCount, 1)
    assert.equal(row.compactionMs, 500)
    await recorder.dispose()
    await recorder.flush()
    assert.equal(captured.length, 1, 'one summary, including a paint acknowledgement, per turn')
    const serialized = JSON.stringify(captured)
    assert(!serialized.includes(turnId) && !serialized.includes('PRIVATE_FIXTURE_TEXT') && !serialized.includes('request-1'))
    assert.equal(captured[0].properties.model_name, 'gpt-6.1-sol')
    assert.equal(captured[0].properties.first_display_ms, 4415)
    const stored = await readFile(join(directory, 'response-timings.json'), 'utf8')
    assert(!stored.includes('PRIVATE_FIXTURE_TEXT'))
    const reopened = new ResponseTimingRecorder(directory, undefined, () => clock)
    assert.deepEqual((await reopened.read()).records, [row], 'local timings survive restart independently of analytics')
    reopened.start({ turnId: 'assistant-turn-long-running', model: '', receivedAt: clock })
    reopened.observe({ eventId: 'actual-model', type: 'turn.started', threadId: 'thread', turnId: 'assistant-turn-long-running', createdAt: new Date(clock).toISOString(), payload: { model: 'openai-codex/gpt-6-luna', effort: 'low', interactionMode: 'default' } })
    for (let index = 0; index < 240; index++) {
        clock += 100
        reopened.start({ turnId: `assistant-turn-${index}`, model: 'secret-custom-model-value', receivedAt: clock })
        reopened.finish(`assistant-turn-${index}`, 'cancelled')
    }
    await reopened.dispose(); await reopened.flush()
    const retained = (await reopened.read()).records
    assert.equal(retained.length, 200)
    assert.equal(retained.find(row => row.turnId === 'assistant-turn-long-running')?.model, 'gpt-6-luna', 'actual runtime model replaces the initial unknown/requested model')
    assert.equal(retained.find(row => row.turnId === 'assistant-turn-long-running')?.outcome, 'running', 'an older active turn survives newer completed turns')
    assert.equal(retained[0].model, 'other')
    assert((await readFile(join(directory, 'response-timings.json'))).byteLength < RESPONSE_TIMING_STORAGE_LIMIT)
    const recoveredActive = new ResponseTimingRecorder(directory)
    assert.equal((await recoveredActive.read()).records.find(row => row.turnId === 'assistant-turn-long-running')?.outcome, 'unfinished', 'restart does not claim background work was interrupted')
    await recoveredActive.dispose()
    await writeFile(join(directory, 'response-timings.json'), '[{"unexpected":"PRIVATE_FIXTURE_TEXT"}]')
    const corrupt = new ResponseTimingRecorder(directory)
    assert.deepEqual((await corrupt.read()).records, [])
    await corrupt.dispose(); await corrupt.flush()
    assert.equal(readModelRequestProgress({ requestId: 'x', startedAt: 50, lastActivityAt: 100, phase: 'waiting', firstTextAt: 300 }, 'turn')?.firstTextAt, undefined)
    console.log('Response timing: provider/display stages, missing values, tool-gap isolation, retries, compaction, privacy, persistence and bounded retention: ok')
} finally {
    await recorder.dispose(); await recorder.flush()
    await rm(directory, { recursive: true, force: true })
}
