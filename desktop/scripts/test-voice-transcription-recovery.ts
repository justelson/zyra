import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { VoiceTranscriptionJobs } from '../src/main/assistant/voice-transcription-jobs'
import type { AssistantTranscribeVoiceInput } from '../src/shared/assistant/contracts'
import type { SaveVoiceHistoryInput } from '../src/main/assistant/voice-history'
const source = readFileSync(new URL('../src/main/assistant/voice-history.ts', import.meta.url), 'utf8')
const start = source.indexOf('export async function transcribeVoiceAndSave(')
assert.ok(start >= 0)
const body = source.slice(start).replace(/^export /, '')
const code = new Bun.Transpiler({ loader: 'ts' }).transformSync(body)
const recording: AssistantTranscribeVoiceInput = { requestId: '11111111-1111-4111-8111-111111111111', audioBase64: 'synthetic-audio', mimeType: 'audio/wav', sampleRateHz: 24000, durationMs: 1000 }
const saved: SaveVoiceHistoryInput[] = []
const transcribe = new Function('transcribeVoiceWithCodex', 'saveVoiceHistory', `${code}; return transcribeVoiceAndSave`)(
    async (_input: AssistantTranscribeVoiceInput, signal?: AbortSignal) => { if (signal?.aborted) throw signal.reason; return 'Recovered transcript.' },
    async (input: SaveVoiceHistoryInput) => { saved.push(input) }
) as (input: AssistantTranscribeVoiceInput, signal?: AbortSignal) => Promise<string>
assert.equal(await transcribe(recording), 'Recovered transcript.')
assert.equal(saved[0].transcript, 'Recovered transcript.')
const explicit = new AbortController()
explicit.abort(new Error('User cancelled.'))
await assert.rejects(transcribe(recording, explicit.signal), /User cancelled/)
assert.equal(saved.length, 1, 'Explicit discard does not retain cancelled audio')
const owner = new AbortController()
owner.abort(Object.assign(new Error('Window closed.'), { code: 'VOICE_OWNER_CLOSED' }))
await assert.rejects(transcribe(recording, owner.signal), /Window closed/)
assert.equal(saved.length, 2, 'Renderer loss saves the audio for recovery')
assert.equal(saved[1].recording.audioBase64, recording.audioBase64)
assert.equal(saved[1].error, 'Window closed.')
const cancels: Array<() => void> = []
const jobs = new VoiceTranscriptionJobs(async (_input, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true }); cancels.push(() => {})
}), async input => { await transcribe(input, owner.signal).catch(() => undefined) })
const first = jobs.run('window-one', recording), second = jobs.run('window-two', recording)
const firstDone = assert.rejects(first, /cancelled/), secondDone = assert.rejects(second, /cancelled/)
await assert.rejects(jobs.run('window-three', recording), /Too many/)
assert.equal(saved.length, 3, 'Concurrency admission retains the recording without dispatching a third provider call')
assert.equal(cancels.length, 2)
jobs.cancelAll()
await Promise.all([firstDone, secondDone])
console.log('PASS: successful dictation, explicit discard, owner-close recovery and rejected-admission audio preservation')
