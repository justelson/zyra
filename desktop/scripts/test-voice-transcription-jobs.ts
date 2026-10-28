import assert from 'node:assert/strict'
import { VoiceTranscriptionJobs } from '../src/main/assistant/voice-transcription-jobs'
import type { AssistantTranscribeVoiceInput } from '../src/shared/assistant/contracts'
const input: AssistantTranscribeVoiceInput = {
    requestId: '11111111-1111-4111-8111-111111111111',
    audioBase64: 'fixture',
    mimeType: 'audio/wav',
    sampleRateHz: 24000,
    durationMs: 1000,
}
const recovered: AssistantTranscribeVoiceInput[] = []
const jobs = new VoiceTranscriptionJobs(
    async (_input, signal) =>
        new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        }),
    async recording => { recovered.push(recording) },
)
const first = jobs.run('desktop:one', input)
const firstCancelled = assert.rejects(first, /cancelled/)
assert.equal(
    jobs.cancel('desktop:other', input.requestId!),
    false,
    'a different window cannot cancel another recording',
)
await assert.rejects(jobs.run('desktop:one', input), /already running/)
const second = jobs.run('browser:two', input)
const secondCancelled = assert.rejects(second, /cancelled/)
await assert.rejects(jobs.run('browser:three', input), /Too many/)
assert.equal(recovered.length, 1, 'Admission rejection saves its audio before reporting failure')
assert.equal(recovered[0], input)
assert.equal(jobs.cancel('desktop:one', input.requestId!), true)
await firstCancelled
const ownerReason = second.catch(error => error)
jobs.cancelOwner('browser:two')
await secondCancelled
assert.equal((await ownerReason).code, 'VOICE_OWNER_CLOSED', 'Owner loss is distinguishable from explicit user discard')
assert.equal(
    jobs.cancel('desktop:one', input.requestId!),
    false,
    'completed/cancelled request identities are released',
)
const completed = new VoiceTranscriptionJobs(async () => 'complete transcript')
assert.equal(await completed.run('desktop:one', input), 'complete transcript')
assert.equal(
    await completed.run('desktop:one', input),
    'complete transcript',
    'settled jobs do not retain semaphore slots',
)
console.log('Voice transcription cancellation ownership, duplicate requests, bounds and cleanup: ok')
