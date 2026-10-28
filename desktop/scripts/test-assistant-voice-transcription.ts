import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
    CODEX_VOICE_TRANSCRIPTION_URL,
    decodeCodexVoiceInput,
    requestCodexVoiceTranscription,
    transcribeCodexVoiceWithDependencies
} from '../src/main/assistant/codex-voice-transcription'
import {
    encodeAssistantVoiceWav,
    formatAssistantVoiceDuration,
    normalizeAssistantVoiceWaveformLevel,
    createAssistantVoicePcmPayload,
    resampleAssistantVoice
} from '../src/renderer/src/pages/assistant/assistant-voice-recorder'
import { splitVoiceWav } from '../src/main/assistant/voice-wav-chunks'
import { deriveAssistantComposerCapabilities } from '../src/renderer/src/pages/assistant/assistant-composer-capabilities'
import type { AssistantTranscribeVoiceInput } from '../src/shared/assistant/contracts'

function createWav(durationMs = 1_000): Buffer {
    const sampleRate = 24_000
    const sampleCount = Math.round(sampleRate * durationMs / 1000)
    const buffer = Buffer.alloc(44 + sampleCount * 2)
    buffer.write('RIFF', 0, 'ascii')
    buffer.writeUInt32LE(buffer.length - 8, 4)
    buffer.write('WAVE', 8, 'ascii')
    buffer.write('fmt ', 12, 'ascii')
    buffer.writeUInt32LE(16, 16)
    buffer.writeUInt16LE(1, 20)
    buffer.writeUInt16LE(1, 22)
    buffer.writeUInt32LE(sampleRate, 24)
    buffer.writeUInt32LE(sampleRate * 2, 28)
    buffer.writeUInt16LE(2, 32)
    buffer.writeUInt16LE(16, 34)
    buffer.write('data', 36, 'ascii')
    buffer.writeUInt32LE(sampleCount * 2, 40)
    return buffer
}

const wav = createWav()
const baseInput: AssistantTranscribeVoiceInput = {
    audioBase64: wav.toString('base64'),
    mimeType: 'audio/wav',
    sampleRateHz: 24_000,
    durationMs: 1_000
}

const mobileWav = readFileSync(resolve(import.meta.dirname, '../../mobile/android/app/src/test/resources/recovered-voice.wav'))
assert.deepEqual(decodeCodexVoiceInput({ audioBase64: mobileWav.toString('base64'), mimeType: 'audio/wav', sampleRateHz: 24000, durationMs: 2000 }), mobileWav, 'native PCM fixture must satisfy the actual PC WAV contract')

const cancelledHeaders = new AbortController()
const cancelledRequest = requestCodexVoiceTranscription({ audio: wav, accessToken: 'fixture', accountId: 'fixture', signal: cancelledHeaders.signal,
    fetchImpl: (async (_url, init) => new Promise((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true }) })) as typeof fetch })
const headerRejection = assert.rejects(cancelledRequest, /cancelled by phone/)
cancelledHeaders.abort(new Error('cancelled by phone'))
await headerRejection

const cancelledBody = new AbortController()
let bodyReady!: () => void, cancelledStream = false
const bodyWaiting = new Promise<void>(resolve => { bodyReady = resolve })
const bodyRequest = transcribeCodexVoiceWithDependencies(baseInput, {
    resolveCredentials: async () => ({ accessToken: 'fixture', accountId: 'fixture' }),
    requestTranscription: async () => new Response(new ReadableStream({ start() { bodyReady() }, cancel() { cancelledStream = true } }))
}, cancelledBody.signal)
const bodyRejection = assert.rejects(bodyRequest, /cancelled by phone/)
await bodyWaiting
cancelledBody.abort(new Error('cancelled by phone'))
await bodyRejection
assert.equal(cancelledStream, true, 'leaving Voice cancels response-body reads too')

const longWav = createWav(300_000)
for (let offset = 44; offset < longWav.length; offset += 2) longWav.writeInt16LE((offset / 2 % 2000) - 1000, offset)
const longInput = { ...baseInput, durationMs: 300_000, audioBase64: longWav.toString('base64') }
assert.deepEqual(decodeCodexVoiceInput(longInput), longWav, 'a five-minute note is not rejected at the old recording/upload limit')
let longRequests = 0
const longTranscript = await transcribeCodexVoiceWithDependencies(longInput, {
    resolveCredentials: async () => ({ accessToken: 'fixture', accountId: 'fixture' }),
    requestTranscription: async ({ audio }) => {
        longRequests++
        assert.ok(audio.readUInt32LE(40) / 48 <= 120_000, 'no endpoint upload exceeds two minutes')
        return new Response(JSON.stringify({ text: ['first part', 'second part', 'last part'][longRequests - 1] }), { status: 200 })
    }
})
assert.equal(longRequests, 3, 'a five-minute recording is sent as three bounded uploads')
assert.equal(longTranscript, 'first part second part last part', 'chunk responses combine in recording order')
const chunks = [...splitVoiceWav(longWav)]
assert.deepEqual(Buffer.concat(chunks.map(chunk => chunk.subarray(44))), longWav.subarray(44), 'pause-seeking splits neither lose nor repeat any PCM samples')
const abortLong = new AbortController()
let cancelledChunkCalls = 0
await assert.rejects(transcribeCodexVoiceWithDependencies(longInput, {
    resolveCredentials: async () => ({ accessToken: 'fixture', accountId: 'fixture' }),
    requestTranscription: async () => { cancelledChunkCalls++; abortLong.abort(new Error('cancel long note')); return new Response(JSON.stringify({ text: 'first part' })) }
}, abortLong.signal), /cancel long note/)
assert.equal(cancelledChunkCalls, 1, 'cancelling a long transcription never dispatches later chunks')
let quietCalls = 0
assert.equal(await transcribeCodexVoiceWithDependencies(longInput, {
    resolveCredentials: async () => ({ accessToken: 'fixture', accountId: 'fixture' }),
    requestTranscription: async () => new Response(JSON.stringify({ text: ++quietCalls === 2 ? '' : quietCalls === 1 ? 'before pause' : 'after pause' }))
}), 'before pause after pause', 'a silence-only chunk does not fail an otherwise valid long note')
Object.assign(globalThis, { window: { btoa: (value: string) => Buffer.from(value, 'binary').toString('base64') } })
const pcmPayload = createAssistantVoicePcmPayload([new Int16Array([32767, -32768]), new Int16Array([123, -456])])!
const pcmWav = Buffer.from(pcmPayload.audioBase64, 'base64')
assert.equal(pcmWav.readInt16LE(44), 32767)
assert.equal(pcmWav.readInt16LE(46), -32768)
assert.equal(pcmWav.readInt16LE(48), 123)
assert.equal(pcmWav.readInt16LE(50), -456)
assert.equal(pcmWav.readUInt32LE(40), 8, 'bounded PCM recording writes one complete WAV without float merging')

assert.deepEqual(decodeCodexVoiceInput(baseInput), wav, 'valid 24 kHz mono WAV data should pass validation')
assert.throws(
    () => decodeCodexVoiceInput({ ...baseInput, sampleRateHz: 16_000 as 24_000 }),
    /24 kHz/u,
    'non-normalized sample rates must be rejected'
)
assert.throws(
    () => decodeCodexVoiceInput({ ...baseInput, durationMs: 480_001 }),
    /eight minutes/u,
    'recordings beyond the duration bound must be rejected'
)
assert.throws(
    () => decodeCodexVoiceInput({ ...baseInput, audioBase64: Buffer.from('RIFF0000WAVE').toString('base64') }),
    /valid WAV/u,
    'truncated WAV headers must be rejected'
)

let outboundCalled = false
await assert.rejects(
    requestCodexVoiceTranscription({
        audio: wav,
        accessToken: 'secret-token',
        accountId: 'account-id',
        endpoint: 'https://attacker.example/transcribe',
        fetchImpl: async () => {
            outboundCalled = true
            return new Response('{}')
        }
    }),
    /not allowed/u,
    'an untrusted endpoint must fail before the bearer credential is forwarded'
)
assert.equal(outboundCalled, false)

let capturedUrl = ''
let capturedInit: RequestInit | undefined
const successfulResponse = await requestCodexVoiceTranscription({
    audio: wav,
    accessToken: 'secret-token',
    accountId: 'account-id',
    fetchImpl: async (input, init) => {
        capturedUrl = String(input)
        capturedInit = init
        return new Response(JSON.stringify({ text: 'hello' }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        })
    }
})
assert.equal(successfulResponse.status, 200)
assert.equal(capturedUrl, CODEX_VOICE_TRANSCRIPTION_URL)
const headers = new Headers(capturedInit?.headers)
assert.equal(headers.get('authorization'), 'Bearer secret-token')
assert.equal(headers.get('chatgpt-account-id'), 'account-id')
assert.match(headers.get('content-type') || '', /^multipart\/form-data; boundary=/u)
const multipartText = Buffer.from(capturedInit?.body as Uint8Array).toString('latin1')
assert.match(multipartText, /name="file"; filename="voice\.wav"/u)
assert.match(multipartText, /name="model"[\s\S]*whisper-1/u, 'the direct ChatGPT endpoint must receive its transcription model')
assert.doesNotMatch(multipartText, /secret-token/u, 'credentials must stay in headers rather than the multipart body')

const authRefreshCalls: boolean[] = []
const requestTokens: string[] = []
let requestCount = 0
const transcript = await transcribeCodexVoiceWithDependencies(baseInput, {
    resolveCredentials: async (refresh) => {
        authRefreshCalls.push(refresh)
        return {
            accessToken: refresh ? 'fresh-token' : 'stale-token',
            accountId: 'account-id'
        }
    },
    requestTranscription: async (request) => {
        requestCount += 1
        requestTokens.push(request.accessToken)
        return requestCount === 1
            ? new Response('{}', { status: 401 })
            : new Response(JSON.stringify({ text: ' refreshed transcript ' }), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            })
    }
})
assert.equal(transcript, 'refreshed transcript')
assert.deepEqual(authRefreshCalls, [false, true], '401 should trigger exactly one Zyra-authenticated credential refresh')
assert.deepEqual(requestTokens, ['stale-token', 'fresh-token'])

let forbiddenRequests = 0
await assert.rejects(
    transcribeCodexVoiceWithDependencies(baseInput, {
        resolveCredentials: async () => ({ accessToken: 'token', accountId: 'account-id' }),
        requestTranscription: async () => {
            forbiddenRequests += 1
            return new Response('{}', { status: 403 })
        }
    }),
    /did not allow transcription/u,
    'account-level refusal must offer a safe recovery path'
)
assert.equal(forbiddenRequests, 1, '403 must not repeat the same rejected upload as an auth refresh')

for (const [body, expectedMessage] of [
    [{ text: '' }, /No speech was detected/u],
    [{ detail: 'Error in ASR API' }, /could not process this recording/u],
    [{ detail: 'No active organization found' }, /no active organization/u]
] as const) {
    await assert.rejects(
        transcribeCodexVoiceWithDependencies(baseInput, {
            resolveCredentials: async () => ({ accessToken: 'token', accountId: 'account-id' }),
            requestTranscription: async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
        }),
        expectedMessage,
        'an HTTP success without transcript text must surface the actual transcription failure'
    )
}

await assert.rejects(
    transcribeCodexVoiceWithDependencies(baseInput, {
        resolveCredentials: async () => ({ accessToken: 'token', accountId: 'account-id' }),
        requestTranscription: async () => new Response('<html>challenge</html>', {
            status: 403,
            headers: { 'content-type': 'text/html', 'cf-mitigated': 'challenge' }
        })
    }),
    /browser check.*Browser dictation/u,
    'Cloudflare challenges must be identified instead of being mislabeled as an expired login'
)

assert.equal(formatAssistantVoiceDuration(0), '0:00')
assert.equal(formatAssistantVoiceDuration(120_000), '2:00')
assert.equal(normalizeAssistantVoiceWaveformLevel(0.001), 0, 'the waveform should suppress the configured room-noise floor')
const quietVoiceLevel = normalizeAssistantVoiceWaveformLevel(0.002)
const normalVoiceLevel = normalizeAssistantVoiceWaveformLevel(0.01)
const loudVoiceLevel = normalizeAssistantVoiceWaveformLevel(0.05)
assert.ok(quietVoiceLevel > 0.1, 'quiet captured speech should rise visibly above the baseline')
assert.ok(normalVoiceLevel > quietVoiceLevel, 'normal speech should produce taller waveform peaks than quiet speech')
assert.ok(loudVoiceLevel > normalVoiceLevel, 'louder speech should preserve a stronger waveform peak')
assert.equal(normalizeAssistantVoiceWaveformLevel(1), 1, 'waveform normalization must remain bounded')
const sourceSamples = new Float32Array(48_000).fill(0.25)
const resampled = resampleAssistantVoice(sourceSamples, 48_000)
assert.equal(resampled.length, 24_000)
const encoded = Buffer.from(encodeAssistantVoiceWav(resampled))
assert.equal(encoded.toString('ascii', 0, 4), 'RIFF')
assert.equal(encoded.toString('ascii', 8, 12), 'WAVE')
assert.equal(encoded.readUInt16LE(22), 1, 'renderer WAV should be mono')
assert.equal(encoded.readUInt32LE(24), 24_000, 'renderer WAV should be normalized to 24 kHz')
assert.equal(encoded.readUInt16LE(34), 16, 'renderer WAV should use 16-bit PCM')

const workingCapabilities = deriveAssistantComposerCapabilities({
    mode: 'standard',
    disabled: false,
    isConnected: true,
    isSending: false,
    isThinking: true,
    allowEmptySubmit: false,
    hasContent: false,
    hasStopHandler: true
})
assert.equal(workingCapabilities.voiceDisabled, false, 'voice input should remain clickable while the assistant is working')
assert.equal(workingCapabilities.canStop, true, 'active-turn Stop should remain available beside voice recording')

const speechHookSource = readFileSync(resolve(import.meta.dir, '../src/renderer/src/pages/assistant/useAssistantSpeechInput.ts'), 'utf8')
const transcriptionSource = readFileSync(resolve(import.meta.dir, '../src/main/assistant/codex-voice-transcription.ts'), 'utf8')
const mainIndexSource = readFileSync(resolve(import.meta.dir, '../src/main/index.ts'), 'utf8')
const recorderBarSource = readFileSync(resolve(import.meta.dir, '../src/renderer/src/pages/assistant/AssistantVoiceRecorderBar.tsx'), 'utf8')
const composerSource = readFileSync(resolve(import.meta.dir, '../src/renderer/src/pages/assistant/AssistantComposerView.tsx'), 'utf8')
const composerSectionsSource = readFileSync(resolve(import.meta.dir, '../src/renderer/src/pages/assistant/AssistantComposerSections.tsx'), 'utf8')
assert.doesNotMatch(composerSectionsSource, /assistant-model-name-shimmer/, 'composer model names stay plain while refreshing')
const rendererCssSource = readFileSync(resolve(import.meta.dir, '../src/renderer/src/index.css'), 'utf8')
assert.doesNotMatch(transcriptionSource, /\.codex|CodexAppServerRuntime|codex-app-server/u, 'subscription transcription must use Zyra auth rather than the retired Codex CLI')
assert.doesNotMatch(transcriptionSource, /chatgpt-account\.mjs|pathToFileURL|import\(\/\* @vite-ignore \*\//u, 'transcription must not cold-load Pi auth and OAuth modules on Electron main')
assert.doesNotMatch(transcriptionSource, /zyra-sdk\.mjs/u, 'subscription transcription must not import the full Pi SDK into Electron')
assert.match(transcriptionSource, /getSharedProviderWorkerClient\(\)\.account\.resolveChatGptAccountAuth\(\)/u, 'ChatGPT transcription must resolve the same Pi account source off the main event loop')
assert.match(transcriptionSource, /session\.defaultSession\.fetch/u, 'desktop transcription must use Chromium networking so ChatGPT browser checks can reuse the app session')
assert.match(mainIndexSource, /setupServices\.auth\.prewarm\(\)/u, 'Desktop startup must warm Pi auth before the first ChatGPT recording')
assert.doesNotMatch(mainIndexSource, /if \(setupServices\.onboarding\.shouldShowOnboarding\(\)\) \{[\s\S]{0,200}auth\.prewarm/u, 'auth warming must not be limited to onboarding')
assert.match(speechHookSource, /ASSISTANT_VOICE_MAX_DURATION_MS/u, 'the recorder should enforce the separate long-note capture bound')
assert.match(speechHookSource, /capturedSampleCount/u, 'captured PCM must stay bounded even while renderer timers are throttled')
assert.match(speechHookSource, /latest\.scopeKey !== recordingScopeKey/u, 'pending microphone permission cannot start recording in another chat')
assert.match(speechHookSource, /recoverRecordingRef/u, 'navigation and unmount recover captured audio instead of cancelling it')
assert.match(speechHookSource, /job\?\.transcript\(result\.text\)/u, 'late transcription applies through the captured owner job')
assert.doesNotMatch(speechHookSource, /!mountedRef\.current \|\| availableRef\.current\.scopeKey !== submittedScope/u, 'successful late results must not be dropped on navigation')
assert.match(speechHookSource, /transcribeVoice\(payload\)/u, 'only the finalized WAV payload should cross IPC')
assert.doesNotMatch(speechHookSource, /setInterval[\s\S]{0,300}transcribeVoice/u, 'recording must not repeatedly upload growing snapshots')
assert.match(recorderBarSource, /aria-label=\{isTranscribing \? 'Cancel transcription' : 'Cancel voice note'\}/u, 'recording and transcription should both expose an explicit cancel action')
assert.match(recorderBarSource, /disabled=\{disabled \|\| isTranscribing\}[\s\S]{0,120}aria-hidden=\{isTranscribing\}/u, 'the stop/transcribe action should leave focus and interaction while it collapses')
assert.doesNotMatch(recorderBarSource, /absolute inset-0 flex items-center justify-center/u, 'transcription status must not overlay or collide with the waveform')
assert.match(recorderBarSource, /transition-\[opacity,transform\][\s\S]{0,220}isTranscribing \? 'pointer-events-none -translate-y-1 opacity-0'/u, 'the waveform should cross-fade out when transcription begins')
assert.match(recorderBarSource, /transition-\[width,margin,opacity,transform\][\s\S]{0,220}isTranscribing \? '-ml-2 w-0 scale-75 opacity-0'/u, 'the recording action should collapse smoothly during transcription')
assert.match(recorderBarSource, /flex h-10[\s\S]{0,100}rounded-full/u, 'the active recording row should use a fully rounded surface')
assert.match(recorderBarSource, /h-8 w-8[\s\S]{0,160}rounded-full[\s\S]{0,420}Cancel voice note/u, 'the recorder cancel action should be circular')
assert.match(recorderBarSource, /inline-flex h-8 w-8[\s\S]{0,160}rounded-full[\s\S]{0,520}Stop and transcribe voice note/u, 'the stop-and-transcribe action should be circular')
assert.match(recorderBarSource, /Array<number>\([\s\S]{0,100}\.fill\(0\)/u, 'the live waveform should keep a quiet baseline before audio samples fill the track')
assert.doesNotMatch(recorderBarSource, /<VoiceWaveform levels=\{waveformSamples\} processing/u, 'transcription should not look like the microphone is still receiving audio')
assert.match(recorderBarSource, /<Loader2[\s\S]{0,160}animate-spin[\s\S]{0,220}Transcribing with ChatGPT/u, 'transcription should use one quiet processing indicator beside its status')
assert.match(recorderBarSource, /bg-\[var\(--color-text-secondary\)\] opacity-80/u, 'recording waveform bars must use a generated CSS-variable background utility')
assert.doesNotMatch(recorderBarSource, /bg-sparkle-[^'"\s]+\/\d+/u, 'waveform bars must not use unsupported slash opacity on raw theme variables')
assert.match(recorderBarSource, /motion-reduce:animate-none/u, 'transcription loading motion should respect reduced-motion preferences')
assert.match(recorderBarSource, /motion-reduce:transition-none/u, 'recorder state transitions should respect reduced-motion preferences')
assert.match(composerSource, /<AnimatedHeight[\s\S]{0,140}isOpen=\{!showCodexRecorder\}[\s\S]{0,120}duration=\{composerMotionDuration\}/u, 'the text-entry area should animate between composer and recorder states')
assert.match(composerSource, /showCodexRecorder \? 'rounded-full' : 'rounded-\[18px\]'/u, 'the composer shell should morph into a full pill while recording')
assert.match(composerSource, /showCodexRecorder[\s\S]{0,120}\? 'gap-2 px-1\.5 py-1\.5'/u, 'the active recorder should use one compact composer row')
assert.match(composerSource, /showCodexRecorder/u, 'the expanded recorder should replace compact footer actions while active')
assert.match(composerSource, /role="alert"[\s\S]{0,500}\{speechError\}/u, 'transcription failures must remain visible after the recorder closes')
assert.match(composerSource, /Reconnect ChatGPT[\s\S]{0,900}Use Browser dictation/u, 'ChatGPT transcription errors must expose working recovery actions')
assert.match(composerSource, /showCodexRecorder[\s\S]*?capabilities\.canStop[\s\S]*?<ComposerSendButton/u, 'the active-turn Stop button should remain beside the Codex recorder')

console.log('assistant voice transcription contract: ok')
