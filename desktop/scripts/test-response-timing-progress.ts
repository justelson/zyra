import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ModelRequestControl } from '../../src/runtime/agent/source/model-request'
import { readModelRequestProgress } from '../src/shared/assistant/model-progress'
import { ResponseTimingRecorder } from '../src/main/diagnostics/response-timing-recorder'

const directory = await mkdtemp(join(tmpdir(), 'zyra-timing-progress-'))
const originalNow = Date.now
let clock = 1_800_000_000_000
const turnId = 'assistant-turn-progress'
const recorder = new ResponseTimingRecorder(directory, undefined, () => clock)
try {
    Date.now = () => clock
    recorder.start({ turnId, model: 'openai-codex/gpt-6.1-sol', receivedAt: clock })
    const control = new ModelRequestControl(event => {
        if (event.type !== 'model_request_progress') return
        recorder.observe({ eventId: 'progress', type: 'model.progress', threadId: 'thread', turnId,
            createdAt: new Date(clock).toISOString(), payload: { progress: readModelRequestProgress(event.progress, turnId) } })
    })
    await control.begin()
    for (let i = 0; i < 100; i++) { clock += 20; await control.activity(false, i > 10) }
    await control.end()
    assert.equal((await recorder.read()).records[0].maxStreamingGapMs, 20, 'coalesced one-second progress snapshots must not inflate real 20ms provider gaps')
    assert.equal((await recorder.read()).records[0].requests[0].lastEventMs, 2000, 'the final actual activity offset remains available for diagnosing a trailing wait')
    recorder.finish(turnId, 'completed')
    recorder.start({ turnId: 'assistant-turn-legacy', model: '', receivedAt: clock })
    for (let i = 0; i < 3; i++) {
        clock += 1000
        recorder.observe({ eventId: 'legacy', type: 'model.progress', threadId: 'thread', turnId: 'assistant-turn-legacy', createdAt: new Date(clock).toISOString(),
            payload: { progress: { requestId: 'legacy', turnId: 'assistant-turn-legacy', startedAt: clock - i * 1000, lastActivityAt: clock, phase: 'streaming', canPing: false } } })
    }
    assert.equal((await recorder.read()).records.find(row => row.turnId === 'assistant-turn-legacy')?.maxStreamingGapMs, null, 'older runtimes leave unavailable gap statistics unobserved')
    console.log('Response timing integration: unthrottled provider gaps survive progress coalescing; older runtimes remain unobserved: ok')
} finally { Date.now = originalNow; await recorder.dispose(); await rm(directory, { recursive: true, force: true }) }
