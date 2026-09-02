import assert from 'node:assert/strict'
import type { AssistantMessage } from '../src/shared/assistant/contracts'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import previewContent from '../src/renderer/src/assets/voice-previews/content.json'
import {
    DEFAULT_INSTRUCTOR_OUTPUT_MODALITY,
    DEFAULT_INSTRUCTOR_REALTIME_VOICE,
    DEFAULT_INSTRUCTOR_VOICE_INSTRUCTIONS,
    INSTRUCTOR_REALTIME_VOICES
} from '../src/shared/assistant/contracts/realtime-voice'
import {
    calculateInstructorVoiceActivity,
    smoothInstructorVoiceActivity
} from '../src/renderer/src/pages/assistant/instructor-voice-activity'
import { INSTRUCTOR_VOICE_VISUAL_THEMES } from '../src/renderer/src/pages/assistant/instructor-voice-visuals'
import {
    applyRealtimeTranscriptEvent,
    latestStreamingVoiceTranscript
} from '../src/renderer/src/pages/assistant/instructor-voice-transcript'
import { shouldShowComposerRealtimeVoicePrimaryAction } from '../src/renderer/src/pages/assistant/assistant-composer-view-state'
import { buildAssistantVoiceExecutionConfiguration } from '../src/renderer/src/pages/assistant/assistant-voice-execution-configuration'
import {
    consumeCanonicalVoiceSpeechReplay,
    isCurrentRealtimeVoiceClientCommand,
    isCurrentRealtimeVoicePresentationEvent,
    normalizeRealtimeVoiceSpeechText,
    readRealtimeVoiceAssistantCompletion,
    readRealtimeVoiceProviderItemId,
    readRealtimeVoiceResponseActivity,
    sendRealtimeVoiceClientCommand
} from '../src/renderer/src/pages/assistant/assistant-realtime-client-commands'
import { filterVoiceHydrationReplay } from '../src/renderer/src/pages/assistant/assistant-voice-hydration-replay'
import { projectVoiceLiveTimelineMessages } from '../src/renderer/src/pages/assistant/assistant-voice-live-timeline'
import {
    buildRecoveredRealtimeUserTranscript,
    readCompletedRealtimeUserTranscriptId,
    readRealtimeInputSpeechBoundary
} from '../src/renderer/src/pages/assistant/assistant-realtime-input-recovery'
import {
    getAssistantTimelineMessageEntryId,
    getTimelineEntries
} from '../src/renderer/src/pages/assistant/assistant-timeline-helpers'
import { shouldDelegateVoiceInspection } from '../src/main/assistant/voice/voice-strong-routing'
import { buildVoiceStrongTaskActivity } from '../src/main/assistant/voice/voice-strong-task-activity'
import {
    normalizeWebRtcDelegationEvent,
    normalizeWebRtcTranscriptEvent
} from '../src/main/assistant/voice/codex-realtime-foreground-adapter'
import {
    normalizeInstructorVoicePreferences,
    readInstructorVoicePreferences,
    shouldPlayInstructorAudio,
    writeInstructorVoicePreferences
} from '../src/renderer/src/pages/assistant/instructor-voice-preferences'
import { CodexRealtimeVoiceRuntime } from '../src/main/assistant/codex-realtime-voice'
import {
    chunkFramelessContextText,
    normalizeInstructorRealtimeMessage,
    normalizeInstructorRealtimeVoice,
    normalizeInstructorVoiceInstructions,
    normalizeWebRtcOfferSdp
} from '../src/main/assistant/codex-realtime-voice-contract'

const instructions = normalizeInstructorVoiceInstructions('  Teach me TypeScript one step at a time.  ')
assert.equal(instructions, 'Teach me TypeScript one step at a time.')
assert.equal(normalizeInstructorVoiceInstructions(''), DEFAULT_INSTRUCTOR_VOICE_INSTRUCTIONS)
assert.throws(() => normalizeInstructorVoiceInstructions('x'.repeat(8_001)), /8,000 characters/)

const offerSdp = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n'
assert.equal(normalizeWebRtcOfferSdp(offerSdp), offerSdp)
assert.equal(normalizeWebRtcOfferSdp(offerSdp).endsWith('\r\n'), true)
assert.throws(() => normalizeWebRtcOfferSdp('not an sdp'), /WebRTC offer/)

assert.equal(normalizeInstructorRealtimeVoice('sol'), 'sol')
assert.equal(normalizeInstructorRealtimeVoice('verse'), DEFAULT_INSTRUCTOR_REALTIME_VOICE)
const multibyteContext = '🙂'.repeat(300)
const contextChunks = chunkFramelessContextText(multibyteContext)
assert.equal(contextChunks.join(''), multibyteContext)
assert.equal(contextChunks.every((chunk) => Buffer.byteLength(chunk, 'utf8') <= 500), true)

const rendererCommandBinding = {
    adapterSessionId: 'adapter-renderer-1',
    realtimeSessionId: 'realtime-renderer-1',
    realtimeSessionGeneration: 3
}
const rendererClientCommand = {
    type: 'client.command' as const,
    commandId: 'renderer-command-1',
    ...rendererCommandBinding,
    threadId: 'thread-renderer-1',
    messages: [{
        type: 'session.context.append' as const,
        channel: 'commentary' as const,
        content: [{ type: 'input_text' as const, text: 'Bounded renderer context.' }]
    }]
}
const rendererCommandMessages: string[] = []
const rendererDataChannel = {
    readyState: 'open' as const,
    send: (value: string) => rendererCommandMessages.push(value)
}
assert.equal(isCurrentRealtimeVoiceClientCommand(rendererClientCommand, rendererCommandBinding), true)
assert.equal(sendRealtimeVoiceClientCommand(rendererDataChannel, rendererClientCommand, rendererCommandBinding), true)
assert.deepEqual(rendererCommandMessages.map((value) => JSON.parse(value).type), ['session.context.append'])
assert.equal(sendRealtimeVoiceClientCommand(rendererDataChannel, {
    ...rendererClientCommand,
    realtimeSessionGeneration: 2
}, rendererCommandBinding), false, 'stale generation commands must never reach oai-events')
assert.equal(sendRealtimeVoiceClientCommand(rendererDataChannel, {
    ...rendererClientCommand,
    commandId: 'renderer-command-oversized',
    messages: [{
        type: 'session.context.append',
        channel: 'commentary',
        content: [{ type: 'input_text', text: '🙂'.repeat(126) }]
    }]
}, rendererCommandBinding), false, 'renderer validation must independently enforce the 500-byte command bound')
assert.equal(readRealtimeVoiceResponseActivity({
    type: 'turn.created',
    turn: { id: 'assistant-turn', role: 'assistant' }
}), 'started')
assert.equal(readRealtimeVoiceResponseActivity({
    type: 'turn.done',
    turn: { id: 'assistant-turn', role: 'assistant', transcript: 'Done.' }
}), 'finished')
assert.equal(readRealtimeVoiceResponseActivity({
    type: 'turn.done',
    turn: { id: 'user-turn', role: 'user', transcript: 'Question.' }
}), null)
assert.deepEqual(readRealtimeVoiceAssistantCompletion({
    type: 'turn.done',
    turn: { id: 'assistant-turn', role: 'assistant', transcript: '**Typed response!**' }
}), { providerItemId: 'assistant-turn', text: '**Typed response!**' })
assert.equal(normalizeRealtimeVoiceSpeechText('**Typed response!**'), 'typed response')
assert.equal(normalizeRealtimeVoiceSpeechText('typed RESPONSE.'), 'typed response')
const pendingCanonicalSpeech = [{ canonicalMessageId: 'canonical-typed-response', normalizedText: 'typed response' }]
const unrelatedSpeech = consumeCanonicalVoiceSpeechReplay(pendingCanonicalSpeech, 'An unrelated assistant response.')
assert.equal(unrelatedSpeech.canonicalMessageId, null)
assert.equal(unrelatedSpeech.remaining, pendingCanonicalSpeech, 'an interleaved unrelated response cannot consume the pending canonical replay')
assert.deepEqual(consumeCanonicalVoiceSpeechReplay(unrelatedSpeech.remaining, '**Typed RESPONSE!**'), {
    canonicalMessageId: 'canonical-typed-response',
    remaining: []
})
assert.equal(readRealtimeVoiceProviderItemId({ type: 'turn.delta', turn_id: 'assistant-turn' }), 'assistant-turn')

const normalizedRealtimeMessage = normalizeInstructorRealtimeMessage({
    text: '  What changed?  ',
    images: []
})
assert.deepEqual(normalizedRealtimeMessage, { text: 'What changed?', images: [] })
assert.throws(
    () => normalizeInstructorRealtimeMessage({
        images: [{ mimeType: 'image/jpeg', dataUrl: 'data:image/png;base64,aA==' }]
    }),
    /inconsistent image metadata/
)

const createCallInputs: Array<Record<string, unknown>> = []
const directRuntime = new CodexRealtimeVoiceRuntime({
    createCall: async (input) => {
        createCallInputs.push(input as unknown as Record<string, unknown>)
        return { sdp: 'v=0\r\no=- 2 3 IN IP4 127.0.0.1\r\n', callId: 'rtc_test_voice' }
    }
})
const directRuntimeEvents: any[] = []
directRuntime.on('event', (event) => directRuntimeEvents.push(event))
const directStart = await directRuntime.start({
    cwd: 'C:\\workspace',
    sdp: offerSdp,
    instructions,
    voice: 'sol',
    initialItems: [
        { role: 'user', text: 'Earlier canonical user turn.' },
        { role: 'assistant', text: 'Earlier canonical assistant turn.' }
    ],
    clientManagedHandoffs: true,
    adapterSessionId: 'adapter-session-1',
    conversationId: 'conversation-1',
    realtimeSessionGeneration: 7
})
assert.equal(directStart.realtimeVersion, 'v3')
assert.equal(directStart.realtimeSessionId, 'rtc_test_voice')
assert.equal(directStart.realtimeSessionGeneration, 7)
assert.equal(directStart.adapterSessionId, 'adapter-session-1')
assert.match(directStart.threadId, /^zyra_realtime_thread_/u)
assert.equal(createCallInputs.length, 1)
assert.equal(createCallInputs[0]?.['sdp'], offerSdp)
assert.equal(createCallInputs[0]?.['instructions'], instructions)
assert.equal(createCallInputs[0]?.['voice'], 'sol')
assert.deepEqual(createCallInputs[0]?.['initialItems'], [
    { role: 'user', text: 'Earlier canonical user turn.' },
    { role: 'assistant', text: 'Earlier canonical assistant turn.' }
])
assert.equal((createCallInputs[0]?.['signal'] as AbortSignal).aborted, false)
assert.deepEqual(directRuntimeEvents.slice(0, 2).map((event) => event.type), ['session.starting', 'session.started'])

await directRuntime.appendContext([{ role: 'developer', text: multibyteContext }])
await directRuntime.requestSpeech('Narrate this result.', 'canonical-spoken-result')
directRuntime.presentComposerResponse({ turnId: 'typed-turn-1', text: 'Typed response.', canonicalMessageId: 'canonical-typed-response-1' })
const clientCommands = directRuntimeEvents.filter((event) => event.type === 'client.command')
assert.equal(clientCommands.length, 2)
for (const command of clientCommands) {
    assert.equal(command.adapterSessionId, 'adapter-session-1')
    assert.equal(command.realtimeSessionId, 'rtc_test_voice')
    assert.equal(command.realtimeSessionGeneration, 7)
    assert.equal(directRuntime.isCurrentClientCommand(command), true)
}
assert.equal(
    clientCommands[0].messages.every((message: any) => Buffer.byteLength(message.content[0].text, 'utf8') <= 500),
    true,
    'Frameless context commands must stay within the 500-byte provider bound'
)
assert.equal(clientCommands[1].messages.every((message: any) => message.type === 'session.context.append'), true)
assert.equal(clientCommands[1].messages.every((message: any) => message.channel === 'speakable'), true)
assert.equal(clientCommands[1].canonicalMessageId, 'canonical-spoken-result')
const directComposerResponse = directRuntimeEvents.find((event) => event.type === 'composer.response.done')
assert.equal(directComposerResponse?.text, 'Typed response.')
assert.equal(directComposerResponse?.canonicalMessageId, 'canonical-typed-response-1')
assert.equal(isCurrentRealtimeVoicePresentationEvent(directComposerResponse, rendererCommandBinding), false)
assert.equal(isCurrentRealtimeVoicePresentationEvent(directComposerResponse, {
    adapterSessionId: 'adapter-session-1',
    realtimeSessionId: 'rtc_test_voice',
    realtimeSessionGeneration: 7
}), true, 'typed Voice presentation events carry the exact owning generation')
assert.equal(isCurrentRealtimeVoicePresentationEvent({
    ...directComposerResponse,
    realtimeSessionGeneration: 6
}, {
    adapterSessionId: 'adapter-session-1',
    realtimeSessionId: 'rtc_test_voice',
    realtimeSessionGeneration: 7
}), false, 'a stale typed response cannot appear in a replacement Voice generation')
assert.equal(directRuntime.isCurrentClientCommand({ ...clientCommands[0], realtimeSessionGeneration: 6 }), false)
await directRuntime.stop()
assert.deepEqual(directRuntimeEvents.at(-1).messages, [{ type: 'session.close' }])
assert.equal(directRuntime.currentSessionIdentity(), null)
directRuntime.dispose()

assert.deepEqual(INSTRUCTOR_REALTIME_VOICES, [
    'arbor',
    'breeze',
    'cove',
    'ember',
    'juniper',
    'maple',
    'sol',
    'spruce',
    'vale'
])
assert.deepEqual(Object.keys(INSTRUCTOR_VOICE_VISUAL_THEMES), INSTRUCTOR_REALTIME_VOICES)
assert.deepEqual(Object.keys(previewContent), INSTRUCTOR_REALTIME_VOICES)
const previewHashes = new Set<string>()
const previewTopics = new Set<string>()
for (const voice of INSTRUCTOR_REALTIME_VOICES) {
    const preview = previewContent[voice]
    assert.ok(preview.topic.length >= 12)
    assert.ok(preview.text.split(/\s+/).length >= 45)
    assert.ok((preview.text.match(/[.!?](?:\s|$)/g) ?? []).length >= 3)
    previewTopics.add(preview.topic)
    const audio = readFileSync(new URL(`../src/renderer/src/assets/voice-previews/${voice}.ogg`, import.meta.url))
    assert.ok(audio.byteLength > 40_000)
    assert.equal(audio.subarray(0, 4).toString('ascii'), 'OggS')
    previewHashes.add(createHash('sha256').update(audio).digest('hex'))
}
assert.equal(previewTopics.size, INSTRUCTOR_REALTIME_VOICES.length)
assert.equal(previewHashes.size, INSTRUCTOR_REALTIME_VOICES.length)
assert.equal(calculateInstructorVoiceActivity(new Uint8Array(64).fill(128)), 0)
const loudSamples = new Uint8Array(64).map((_, index) => index % 2 === 0 ? 84 : 172)
assert.ok(calculateInstructorVoiceActivity(loudSamples) > 0.8)
const attackLevel = smoothInstructorVoiceActivity(0, 1)
assert.ok(attackLevel > 0.1 && attackLevel < 0.3)
let sustainedLevel = 0
for (let index = 0; index < 16; index += 1) sustainedLevel = smoothInstructorVoiceActivity(sustainedLevel, 1)
assert.ok(sustainedLevel > 0.9)
assert.ok(smoothInstructorVoiceActivity(sustainedLevel, 0) < sustainedLevel)
const typedVoiceTranscript = applyRealtimeTranscriptEvent([{
    id: 'composer-response-typed-turn-1',
    role: 'assistant',
    text: 'Typed response spoken through ChatGPT.',
    final: true
}], {
    type: 'turn.done',
    turn: {
        id: 'provider-spoken-turn-1',
        role: 'assistant',
        transcript: 'Typed response spoken through ChatGPT.'
    }
})
assert.deepEqual(typedVoiceTranscript.map(({ id, text }) => ({ id, text })), [{
    id: 'provider-spoken-turn-1',
    text: 'Typed response spoken through ChatGPT.'
}], 'the provider completion must replace the optimistic typed Voice bubble instead of duplicating it')
assert.equal(
    latestStreamingVoiceTranscript(typedVoiceTranscript),
    null,
    'the orb caption must clear after a finalized utterance enters the canonical timeline'
)
const streamingCaption = { id: 'assistant-streaming', role: 'assistant', text: 'Still speaking', final: false }
assert.equal(
    latestStreamingVoiceTranscript([...typedVoiceTranscript, streamingCaption])?.id,
    streamingCaption.id,
    'the orb caption must keep showing the current streaming utterance'
)
let repeatedUserPrefix = applyRealtimeTranscriptEvent([], {
    type: 'turn.done',
    turn: { id: 'fallback-user-yo', role: 'user', transcript: 'Yo' }
})
repeatedUserPrefix = applyRealtimeTranscriptEvent(repeatedUserPrefix, {
    type: 'turn.created',
    turn: { id: 'provider-user-full', role: 'user', transcript: '' }
})
repeatedUserPrefix = applyRealtimeTranscriptEvent(repeatedUserPrefix, {
    type: 'turn.done',
    turn: { id: 'provider-user-full', role: 'user', transcript: 'Yo, so can you please help me check the time' }
})
assert.deepEqual(repeatedUserPrefix.map(({ id, text }) => ({ id, text })), [{
    id: 'provider-user-full',
    text: 'Yo, so can you please help me check the time'
}], 'a provider completion must replace an adjacent shorter fallback prefix with a different item ID')
let intentionalRepeatedUser = applyRealtimeTranscriptEvent([], {
    type: 'turn.done',
    turn: { id: 'intentional-user-1', role: 'user', transcript: 'Hello' }
})
intentionalRepeatedUser = applyRealtimeTranscriptEvent(intentionalRepeatedUser, {
    type: 'turn.done',
    turn: { id: 'intentional-user-2', role: 'user', transcript: 'Hello' }
})
assert.equal(intentionalRepeatedUser.length, 2, 'two exact repeated user utterances must remain separate turns')

const repeatedUserText = "We're going to take a shower"
let transcript = applyRealtimeTranscriptEvent([], {
    type: 'turn.created',
    turn: { id: 'user-turn-1', role: 'user', transcript: " We're going to" }
})
transcript = applyRealtimeTranscriptEvent(transcript, {
    type: 'turn.delta',
    turn_id: 'user-turn-1',
    delta: ' take a shower'
})
transcript = applyRealtimeTranscriptEvent(transcript, {
    type: 'turn.done',
    turn: { id: 'user-turn-1', role: 'user', transcript: ` ${repeatedUserText}` }
})
transcript = applyRealtimeTranscriptEvent(transcript, {
    type: 'turn.done',
    turn: { id: 'assistant-turn-1', role: 'assistant', transcript: ' Alright.' }
})

transcript = applyRealtimeTranscriptEvent(transcript, {
    type: 'turn.done',
    turn: { id: 'user-turn-1', role: 'user', transcript: ` ${repeatedUserText}` }
})
assert.deepEqual(
    transcript.map(({ id, role, text, final }) => ({ id, role, text, final })),
    [
        { id: 'user-turn-1', role: 'user', text: repeatedUserText, final: true },
        { id: 'assistant-turn-1', role: 'assistant', text: 'Alright.', final: true }
    ],
    'a replayed v3 turn should update its original bubble instead of creating a duplicate'
)

transcript = applyRealtimeTranscriptEvent(transcript, {
    type: 'turn.done',
    turn: { id: 'user-turn-2', role: 'user', transcript: repeatedUserText }
})
assert.equal(
    transcript.filter((entry) => entry.role === 'user').length,
    2,
    'the same words with a new turn id should remain visible as an intentional repeat'
)

let dataChannelTranscript = applyRealtimeTranscriptEvent([], {
    type: 'conversation.item.created',
    item: { id: 'assistant-item-1', role: 'assistant' }
})
dataChannelTranscript = applyRealtimeTranscriptEvent(dataChannelTranscript, {
    type: 'response.audio_transcript.delta',
    item_id: 'assistant-item-1',
    delta: 'You have '
})
dataChannelTranscript = applyRealtimeTranscriptEvent(dataChannelTranscript, {
    type: 'response.audio_transcript.delta',
    item_id: 'assistant-item-1',
    delta: 'You have '
})
assert.equal(dataChannelTranscript[0]?.text, 'You have ', 'a replayed provider delta should not duplicate visible words')
dataChannelTranscript = applyRealtimeTranscriptEvent(dataChannelTranscript, {
    type: 'response.audio_transcript.delta',
    item_id: 'assistant-item-1',
    delta: 'You have 120'
})
assert.equal(dataChannelTranscript[0]?.text, 'You have 120', 'a cumulative provider delta should replace its shorter prefix')
dataChannelTranscript = applyRealtimeTranscriptEvent(dataChannelTranscript, {
    type: 'response.audio_transcript.done',
    item_id: 'assistant-item-1',
    transcript: 'You have 120 GB free.'
})
assert.equal(dataChannelTranscript[0]?.final, false, 'assistant audio transcript completion remains provisional until turn.done')
dataChannelTranscript = applyRealtimeTranscriptEvent(dataChannelTranscript, {
    type: 'turn.done',
    turn: { id: 'assistant-item-1', role: 'assistant', transcript: 'You have 120 GB free.' }
})
dataChannelTranscript = applyRealtimeTranscriptEvent(dataChannelTranscript, {
    type: 'conversation.item.input_audio_transcription.completed',
    item_id: 'user-item-1',
    transcript: 'How much storage is free?'
})
assert.deepEqual(dataChannelTranscript.map(({ id, role, text, final }) => ({ id, role, text, final })), [
    { id: 'assistant-item-1', role: 'assistant', text: 'You have 120 GB free.', final: true },
    { id: 'user-item-1', role: 'user', text: 'How much storage is free?', final: true }
])

const liveUserVoiceStartedAt = '2026-08-29T09:32:00.000Z'
const projectVisibleUserVoiceTexts = (
    currentTranscript: Parameters<typeof projectVoiceLiveTimelineMessages>[0]['transcript'],
    canonicalMessages: AssistantMessage[]
) => {
    const projection = projectVoiceLiveTimelineMessages({
        transcript: currentTranscript,
        canonicalMessages,
        voiceStartedAt: liveUserVoiceStartedAt,
        nowMs: Date.parse('2026-08-29T09:32:30.000Z')
    })
    return [...canonicalMessages, ...projection.messages]
        .filter((message) => message.role === 'user')
        .map((message) => message.text)
}
const applyTranscriptEvents = (
    initial: typeof dataChannelTranscript,
    events: unknown[]
) => events.reduce(applyRealtimeTranscriptEvent, initial)

let framelessUserTranscript: typeof dataChannelTranscript = [{
    id: 'user-speech-item-1',
    role: 'user',
    text: '',
    final: false
}]
framelessUserTranscript = applyTranscriptEvents(framelessUserTranscript, [{
    type: 'conversation.item.created',
    item: { id: 'user-transcript-chunk-1', role: 'user' }
}, {
    type: 'input_transcript.added',
    item: { id: 'user-transcript-chunk-1', text: 'Hello' }
}])
assert.deepEqual(
    projectVisibleUserVoiceTexts(framelessUserTranscript, []),
    ['Hello'],
    'the first provisional chunk projects as one live user utterance'
)
assert.deepEqual(
    framelessUserTranscript.map(({ id, final }) => ({ id, final })),
    [{ id: 'user-speech-item-1', final: false }],
    'the speech boundary owns the stable provisional identity'
)
framelessUserTranscript = applyTranscriptEvents(framelessUserTranscript, [{
    type: 'conversation.item.created',
    item: { id: 'user-transcript-chunk-2', role: 'user' }
}, {
    type: 'input_transcript.added',
    item: { id: 'user-transcript-chunk-2', text: 'Hello, respond with' }
}])
assert.deepEqual(
    projectVisibleUserVoiceTexts(framelessUserTranscript, []),
    ['Hello, respond with'],
    'cumulative per-chunk transcript items must replace one stable live user utterance in place'
)
assert.equal(
    framelessUserTranscript[0]?.id,
    'user-speech-item-1',
    'per-chunk transport IDs cannot replace the logical utterance identity'
)
framelessUserTranscript = applyRealtimeTranscriptEvent(framelessUserTranscript, {
    type: 'conversation.item.input_audio_transcription.completed',
    item_id: 'user-speech-item-1',
    transcript: 'Hello, respond with exactly I am here'
})
assert.deepEqual(
    projectVisibleUserVoiceTexts(framelessUserTranscript, []),
    ['Hello, respond with exactly I am here'],
    'the final user transcript must promote the same live utterance without retaining partial bubbles'
)
assert.deepEqual(
    framelessUserTranscript.map(({ id, final }) => ({ id, final })),
    [{ id: 'user-speech-item-1', final: true }],
    'final promotion preserves the speech item identity and settles it once'
)
const firstCanonicalVoiceUser: AssistantMessage = {
    id: 'canonical-user-speech-item-1',
    role: 'user',
    text: 'Hello, respond with exactly I am here',
    turnId: null,
    streaming: false,
    providerItemId: 'user-speech-item-1',
    modality: 'voice',
    createdAt: '2026-08-29T09:32:08.697Z',
    updatedAt: '2026-08-29T09:32:08.697Z'
}
assert.deepEqual(
    projectVisibleUserVoiceTexts(framelessUserTranscript, [firstCanonicalVoiceUser]),
    ['Hello, respond with exactly I am here'],
    'canonical promotion must replace the live user projection and leave one visible row'
)

framelessUserTranscript = [...framelessUserTranscript, {
    id: 'user-speech-item-2',
    role: 'user',
    text: '',
    final: false
}]
framelessUserTranscript = applyTranscriptEvents(framelessUserTranscript, [{
    type: 'conversation.item.created',
    item: { id: 'user-transcript-chunk-3', role: 'user' }
}, {
    type: 'input_transcript.added',
    item: { id: 'user-transcript-chunk-3', text: 'Some' }
}])
assert.deepEqual(
    projectVisibleUserVoiceTexts(framelessUserTranscript, [firstCanonicalVoiceUser]),
    ['Hello, respond with exactly I am here', 'Some'],
    'a consecutive utterance must add only one new provisional user row'
)
assert.equal(
    framelessUserTranscript.at(-1)?.id,
    'user-speech-item-2',
    'a consecutive speech boundary receives its own stable identity'
)
framelessUserTranscript = applyRealtimeTranscriptEvent(framelessUserTranscript, {
    type: 'conversation.item.input_audio_transcription.completed',
    item_id: 'user-speech-item-2',
    transcript: 'Some other random long statement'
})
const secondCanonicalVoiceUser: AssistantMessage = {
    id: 'canonical-user-speech-item-2',
    role: 'user',
    text: 'Some other random long statement',
    turnId: null,
    streaming: false,
    providerItemId: 'user-speech-item-2',
    modality: 'voice',
    createdAt: '2026-08-29T09:32:18.921Z',
    updatedAt: '2026-08-29T09:32:18.921Z'
}
assert.deepEqual(
    projectVisibleUserVoiceTexts(
        framelessUserTranscript,
        [firstCanonicalVoiceUser, secondCanonicalVoiceUser]
    ),
    ['Hello, respond with exactly I am here', 'Some other random long statement'],
    'the consecutive final must reconcile to one canonical user row without an orphaned partial'
)

const turnlessUserTranscript = applyTranscriptEvents([], [{
    type: 'conversation.item.created',
    item: { id: 'legacy-user-chunk-1', role: 'user' }
}, {
    type: 'input_transcript.added',
    item: { id: 'legacy-user-chunk-1', text: 'Legacy' }
}, {
    type: 'conversation.item.created',
    item: { id: 'legacy-user-chunk-2', role: 'user' }
}, {
    type: 'input_transcript.added',
    item: { id: 'legacy-user-chunk-2', text: 'Legacy turnless input' }
}, {
    type: 'conversation.item.input_audio_transcription.completed',
    item_id: 'legacy-user-final',
    transcript: 'Legacy turnless input completed'
}])
assert.deepEqual(
    turnlessUserTranscript.map(({ id, role, text, final }) => ({ id, role, text, final })),
    [{
        id: 'legacy-user-final',
        role: 'user',
        text: 'Legacy turnless input completed',
        final: true
    }],
    'turnless legacy chunks must promote one provisional row to the final provider identity'
)

let framelessTranscript: typeof dataChannelTranscript = []
for (const [id, text] of [
    ['transcript-chunk-1', 'Hey there'],
    ['transcript-chunk-2', '! Zy'],
    ['transcript-chunk-3', 'ra here,']
] as const) {
    framelessTranscript = applyRealtimeTranscriptEvent(framelessTranscript, {
        type: 'output_transcript.added',
        item: { id, text }
    })
}
assert.deepEqual(
    framelessTranscript.map(({ role, text, final }) => ({ role, text, final })),
    [{ role: 'assistant', text: 'Hey there! Zyra here,', final: false }],
    'Frameless transcript chunks with per-chunk item IDs must remain one streaming message'
)
framelessTranscript = applyRealtimeTranscriptEvent(framelessTranscript, {
    type: 'turn.done',
    turn: {
        id: 'assistant-turn-frameless-1',
        role: 'assistant',
        transcript: 'Hey there! Zyra here, spelled with a Y.'
    }
})
assert.deepEqual(
    framelessTranscript.map(({ id, role, text, final }) => ({ id, role, text, final })),
    [{
        id: 'assistant-turn-frameless-1',
        role: 'assistant',
        text: 'Hey there! Zyra here, spelled with a Y.',
        final: true
    }],
    'Frameless turn completion must finalize its streaming message with the canonical turn identity'
)
const framelessChatProjection = projectVoiceLiveTimelineMessages({
    transcript: framelessTranscript,
    canonicalMessages: [],
    voiceStartedAt: '2026-08-24T12:00:00.000Z',
    nowMs: Date.parse('2026-08-24T12:00:01.000Z')
})
assert.deepEqual(
    framelessChatProjection.messages.map(({ role, text, streaming }) => ({ role, text, streaming })),
    [{ role: 'assistant', text: 'Hey there! Zyra here, spelled with a Y.', streaming: false }],
    'the regular Chat timeline must receive one Voice message after Frameless transcript reconciliation'
)
assert.equal(projectVoiceLiveTimelineMessages({
    transcript: [{ id: 'assistant-partial', role: 'assistant', text: 'ZYRA', final: false }],
    canonicalMessages: [],
    voiceStartedAt: '2026-08-24T12:00:00.000Z'
}).messages.length, 0, 'provisional assistant chunks stay in the Voice stage instead of looking canonical in Chat')
assert.equal(projectVoiceLiveTimelineMessages({
    transcript: [{ id: 'composer-response-typed-turn', role: 'assistant', text: 'ZYRA_VOICE_SINGLE_830', final: true }],
    canonicalMessages: [],
    voiceStartedAt: '2026-08-24T12:00:00.000Z'
}).messages.length, 0, 'composer responses use their canonical row rather than a final-looking local Chat message')
assert.equal(projectVoiceLiveTimelineMessages({
    transcript: [{
        id: 'spoken-provider-turn',
        role: 'assistant',
        text: 'ZYRA_VOICE_SINGLE_830!',
        final: true,
        canonicalMessageId: 'canonical-typed-response'
    }],
    canonicalMessages: [{
        id: 'canonical-typed-response',
        role: 'assistant',
        text: 'ZYRA_VOICE_SINGLE_830',
        turnId: 'canonical-turn',
        streaming: false,
        providerItemId: 'typed-response:830',
        modality: 'voice',
        createdAt: '2026-08-24T12:00:01.000Z',
        updatedAt: '2026-08-24T12:00:01.000Z'
    }],
    voiceStartedAt: '2026-08-24T12:00:00.000Z'
}).messages.length, 0, 'a spoken provider replay remains hidden by canonical message identity even when its wording changes')
const committedFramelessMessage: AssistantMessage = {
    id: 'canonical-frameless-message-1',
    role: 'assistant',
    text: 'Yep, I’m here. No storage results have come through to me yet.',
    turnId: 'canonical-frameless-turn-1',
    streaming: false,
    providerItemId: 'assistant-turn-frameless-1',
    createdAt: '2026-08-24T12:00:01.000Z',
    updatedAt: '2026-08-24T12:00:01.000Z'
}
assert.equal(projectVoiceLiveTimelineMessages({
    transcript: [{
        id: 'assistant-turn-frameless-1',
        role: 'assistant',
        text: 'Yep, I’m here.',
        final: true
    }],
    canonicalMessages: [committedFramelessMessage],
    voiceStartedAt: '2026-08-24T12:00:00.000Z'
}).messages.length, 0, 'a shorter local completion must yield to the canonical message with the same Frameless turn identity')

assert.equal(shouldDelegateVoiceInspection("What's the storage left on my PC if the storage is free?"), true)
assert.equal(shouldDelegateVoiceInspection('What are you able to do here?'), false)
assert.equal(shouldDelegateVoiceInspection('Checking on what?'), false)
assert.equal(shouldDelegateVoiceInspection('Run the build and fix the file if it fails'), true)
assert.deepEqual(readRealtimeInputSpeechBoundary({
    type: 'input_audio_buffer.speech_started',
    item_id: 'user-speech-item'
}), { kind: 'started', providerItemId: 'user-speech-item' })
assert.deepEqual(readRealtimeInputSpeechBoundary({
    type: 'input_audio_buffer.speech_stopped',
    item_id: 'user-speech-item'
}), { kind: 'stopped', providerItemId: 'user-speech-item' })
assert.equal(readCompletedRealtimeUserTranscriptId({
    type: 'conversation.item.input_audio_transcription.completed',
    item_id: 'user-speech-item',
    transcript: 'Recovered speech.'
}), 'user-speech-item')
const recoveredUserTranscript = buildRecoveredRealtimeUserTranscript('user-speech-item', ' Recovered speech. ')
assert.deepEqual(recoveredUserTranscript, {
    type: 'zyra.input_audio_transcription.completed',
    item_id: 'user-speech-item',
    role: 'user',
    transcript: 'Recovered speech.'
})
assert.deepEqual(normalizeWebRtcTranscriptEvent(recoveredUserTranscript), {
    kind: 'completed',
    role: 'user',
    providerItemId: 'user-speech-item',
    text: 'Recovered speech.'
}, 'a locally recovered speech segment must cross the same identity-bearing canonical commit boundary')
assert.deepEqual(normalizeWebRtcTranscriptEvent({
    type: 'input_transcript.added',
    item: { id: 'user-transcript-chunk', text: 'Partial speech' }
}), {
    kind: 'delta',
    role: 'user',
    providerItemId: 'user-transcript-chunk',
    delta: 'Partial speech'
}, 'per-chunk user transcript items remain noncanonical deltas')
assert.deepEqual(normalizeWebRtcTranscriptEvent({
    type: 'conversation.item.input_audio_transcription.completed',
    item_id: 'user-speech-item',
    transcript: 'Final speech'
}), {
    kind: 'completed',
    role: 'user',
    providerItemId: 'user-speech-item',
    text: 'Final speech'
}, 'only the identity-bearing completed user transcript crosses the canonical commit boundary')
assert.deepEqual(normalizeWebRtcTranscriptEvent({
    type: 'response.audio_transcript.done',
    item_id: 'assistant-partial-item',
    role: 'assistant',
    transcript: 'ZYRA'
}), {
    kind: 'delta',
    role: 'assistant',
    providerItemId: 'assistant-partial-item',
    delta: 'ZYRA'
}, 'assistant transcript done events remain provisional until the authoritative turn.done')
assert.deepEqual(normalizeWebRtcTranscriptEvent({
    type: 'turn.done',
    turn: { id: 'assistant-partial-item', role: 'assistant', transcript: 'ZYRA_VOICE_SINGLE_830' }
}), {
    kind: 'completed',
    role: 'assistant',
    providerItemId: 'assistant-partial-item',
    text: 'ZYRA_VOICE_SINGLE_830'
}, 'turn.done is the canonical assistant completion')
assert.deepEqual(normalizeWebRtcDelegationEvent({
    type: 'delegation.created',
    item: {
        id: 'handoff-check-time',
        type: 'delegation',
        target: 'client',
        content: [{ type: 'input_text', text: 'Can you check the time?' }]
    }
}), {
    providerItemId: 'handoff-check-time',
    text: 'Can you check the time?'
}, 'Frameless client delegation must route the exact provider handoff to Zyra')
assert.equal(normalizeWebRtcDelegationEvent({
    type: 'delegation.created',
    item: {
        id: 'handoff-other-target',
        type: 'delegation',
        target: 'server',
        content: [{ type: 'input_text', text: 'Do not route this.' }]
    }
}), null, 'Zyra must ignore delegations owned by another target')

const voiceTaskStartedAt = '2026-08-10T10:00:00.000Z'
const runningVoiceTaskActivity = buildVoiceStrongTaskActivity({
    taskId: 'voice-task-stable-timeline',
    sourceProviderItemId: 'provider-user-task',
    startedAt: voiceTaskStartedAt,
    occurredAt: voiceTaskStartedAt,
    status: 'running',
    summary: 'Primary agent working',
    detail: 'Run the requested check.'
})
const completedVoiceTaskActivity = buildVoiceStrongTaskActivity({
    taskId: 'voice-task-stable-timeline',
    sourceProviderItemId: 'provider-user-task',
    startedAt: voiceTaskStartedAt,
    occurredAt: '2026-08-10T10:00:12.000Z',
    status: 'completed',
    summary: 'Primary agent finished',
    detail: 'The requested check passed.'
})
assert.equal(completedVoiceTaskActivity.createdAt, runningVoiceTaskActivity.createdAt, 'Voice task completion must not move its timeline row into a later exchange')
assert.equal(completedVoiceTaskActivity.payload?.sourceProviderItemId, 'provider-user-task', 'Voice task lifecycle must stay bound to the spoken request that created it')
assert.equal(completedVoiceTaskActivity.payload?.completedAt, '2026-08-10T10:00:12.000Z')

const hydrationHistory: AssistantMessage[] = [{
    id: 'canonical-earlier-answer',
    role: 'assistant',
    text: 'Earlier canonical answer.',
    turnId: null,
    streaming: false,
    createdAt: '2026-08-10T09:59:00.000Z',
    updatedAt: '2026-08-10T09:59:00.000Z'
}]
assert.deepEqual(filterVoiceHydrationReplay([
    { id: 'hydrated-item', role: 'assistant', text: 'Earlier canonical answer.', final: true },
    { id: 'new-item', role: 'assistant', text: 'Fresh Voice answer.', final: true }
], hydrationHistory, '2026-08-10T10:00:00.000Z').map((entry) => entry.id), ['new-item'])
assert.deepEqual(filterVoiceHydrationReplay([
    { id: 'hydrated-partial', role: 'assistant', text: 'Earlier canonical', final: false }
], hydrationHistory, '2026-08-10T10:00:00.000Z'), [])

const canonicalBeforeVoice: AssistantMessage[] = [{
    id: 'canonical-before-voice',
    role: 'assistant',
    text: 'Previous event.',
    turnId: null,
    streaming: false,
    timelineSequence: 20,
    createdAt: '2026-08-10T10:00:05.000Z',
    updatedAt: '2026-08-10T10:00:05.000Z'
}]
const liveProjection = projectVoiceLiveTimelineMessages({
    transcript: [{ id: 'live-user-item', role: 'user', text: 'Streaming words', final: false }],
    canonicalMessages: canonicalBeforeVoice,
    activities: [{
        id: 'canonical-activity-after-voice-start',
        kind: 'command',
        tone: 'neutral',
        summary: 'Recent event',
        timelineSequence: 21,
        createdAt: '2026-08-10T10:00:06.000Z'
    } as any],
    voiceStartedAt: '2026-08-10T10:00:00.000Z',
    nowMs: Date.parse('2026-08-10T10:00:02.000Z')
})
assert.equal(liveProjection.messages.length, 1)
assert.equal(
    Date.parse(liveProjection.messages[0]!.createdAt) > Date.parse('2026-08-10T10:00:06.000Z'),
    true,
    'a live Voice row must stay after the newest canonical event instead of sorting back to Voice startup'
)
assert.equal(
    getTimelineEntries([...canonicalBeforeVoice, ...liveProjection.messages], [], []).at(-1)?.id,
    getAssistantTimelineMessageEntryId(liveProjection.messages[0]!),
    'timeline sorting must keep the streamed Voice row at the rail end'
)
const updatedLiveProjection = projectVoiceLiveTimelineMessages({
    transcript: [{ id: 'live-user-item', role: 'user', text: 'Streaming words continue', final: false }],
    canonicalMessages: canonicalBeforeVoice,
    activities: [{
        id: 'canonical-activity-after-voice-start',
        kind: 'command',
        tone: 'neutral',
        summary: 'Recent event',
        timelineSequence: 21,
        createdAt: '2026-08-10T10:00:06.000Z'
    } as any],
    voiceStartedAt: '2026-08-10T10:00:00.000Z',
    previousAnchors: liveProjection.anchors,
    nowMs: Date.parse('2026-08-10T10:00:20.000Z')
})
assert.equal(
    updatedLiveProjection.messages[0]?.createdAt,
    liveProjection.messages[0]?.createdAt,
    'streaming deltas must update one bottom-anchored row without moving it'
)
const committedVoiceMessage: AssistantMessage = {
    ...liveProjection.messages[0]!,
    id: 'canonical-voice-message',
    streaming: false
}
assert.equal(
    getAssistantTimelineMessageEntryId(liveProjection.messages[0]!),
    getAssistantTimelineMessageEntryId(committedVoiceMessage),
    'live and canonical Voice projections must share one virtual-row identity'
)
assert.equal(projectVoiceLiveTimelineMessages({
    transcript: [{ id: 'live-user-item', role: 'user', text: 'Streaming words continue', final: true }],
    canonicalMessages: [...canonicalBeforeVoice, committedVoiceMessage],
    voiceStartedAt: '2026-08-10T10:00:00.000Z'
}).messages.length, 0, 'the live row must disappear as soon as its canonical provider item is projected')
const canonicalWithoutProviderIdentity: AssistantMessage = {
    ...committedVoiceMessage,
    id: 'persisted-voice-without-provider-identity',
    providerItemId: undefined,
    createdAt: '2026-08-10T10:00:08.000Z',
    updatedAt: '2026-08-10T10:00:08.000Z'
}
assert.equal(projectVoiceLiveTimelineMessages({
    transcript: [{ id: 'live-user-item', role: 'user', text: committedVoiceMessage.text, final: true }],
    canonicalMessages: [...canonicalBeforeVoice, canonicalWithoutProviderIdentity],
    voiceStartedAt: '2026-08-10T10:00:00.000Z'
}).messages.length, 0, 'an exact finalized transcript must not duplicate a canonical Voice row when legacy hydration lost provider metadata')

const preferenceStorage = new Map<string, string>()
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
        getItem: (key: string) => preferenceStorage.get(key) ?? null,
        setItem: (key: string, value: string) => preferenceStorage.set(key, value)
    }
})

const preferences = normalizeInstructorVoicePreferences({
    instructions: '  Remember this instructor prompt.  ',
    voice: 'sol',
    outputModality: 'text'
})
assert.deepEqual(preferences, {
    instructions: '  Remember this instructor prompt.  ',
    voice: 'sol',
    outputModality: 'text'
})
writeInstructorVoicePreferences(preferences)
assert.deepEqual(readInstructorVoicePreferences(), preferences)
assert.equal(shouldPlayInstructorAudio('audio'), true)
assert.equal(shouldPlayInstructorAudio('text'), false)
assert.deepEqual(
    normalizeInstructorVoicePreferences({ voice: 'invalid', outputModality: 'video' }),
    {
        instructions: DEFAULT_INSTRUCTOR_VOICE_INSTRUCTIONS,
        voice: DEFAULT_INSTRUCTOR_REALTIME_VOICE,
        outputModality: DEFAULT_INSTRUCTOR_OUTPUT_MODALITY
    }
)
if (originalLocalStorage) Object.defineProperty(globalThis, 'localStorage', originalLocalStorage)
else Reflect.deleteProperty(globalThis, 'localStorage')

const emptyRealtimeVoiceAction = {
    currentSubmitLabel: 'Send',
    text: '',
    contextFilesLength: 0,
    realtimeVoiceAvailable: true,
    composerAvailable: true,
    isConnected: true,
    canStop: false,
    showBusySendActions: false,
    dictationBusy: false
}
assert.equal(
    shouldShowComposerRealtimeVoicePrimaryAction(emptyRealtimeVoiceAction),
    true,
    'an empty connected composer should put realtime Voice in the primary Send slot'
)
assert.equal(
    shouldShowComposerRealtimeVoicePrimaryAction({ ...emptyRealtimeVoiceAction, text: 'Send this' }),
    false,
    'sendable text should restore the Send action'
)
assert.equal(
    shouldShowComposerRealtimeVoicePrimaryAction({ ...emptyRealtimeVoiceAction, contextFilesLength: 1 }),
    false,
    'an attachment-only message should restore the Send action'
)
assert.equal(
    shouldShowComposerRealtimeVoicePrimaryAction({ ...emptyRealtimeVoiceAction, canStop: true }),
    false,
    'stopping an active assistant turn should take priority over starting realtime Voice'
)
assert.equal(
    shouldShowComposerRealtimeVoicePrimaryAction({ ...emptyRealtimeVoiceAction, dictationBusy: true }),
    false,
    'realtime Voice should not start while composer dictation is active'
)
assert.equal(
    shouldShowComposerRealtimeVoicePrimaryAction({ ...emptyRealtimeVoiceAction, realtimeVoiceAvailable: false }),
    false,
    'the unavailable realtime service should not replace Send with a dead action'
)
assert.deepEqual(buildAssistantVoiceExecutionConfiguration({
    model: 'openai-codex/gpt-5.6-sol',
    runtimeMode: 'full-access',
    effort: 'high',
    interactionMode: 'default',
    profile: 'builder',
    fastModeEnabled: true
}), {
    model: 'openai-codex/gpt-5.6-sol',
    runtimeMode: 'full-access',
    effort: 'high',
    interactionMode: 'default',
    profile: 'builder',
    serviceTier: 'fast'
}, 'Voice startup and chat-open preparation must share one exact configuration builder')
for (const runtimeMode of ['approval-required', 'auto-review', 'edits-only', 'full-access'] as const) {
    assert.equal(buildAssistantVoiceExecutionConfiguration({
        model: 'openai-codex/gpt-5.6-sol',
        runtimeMode,
        effort: 'high',
        interactionMode: 'default',
        profile: 'default',
        fastModeEnabled: false
    }).runtimeMode, runtimeMode, `Voice must preserve the ${runtimeMode} Chat permission mode`)
}

const voiceLabSource = readFileSync(
    new URL('../src/renderer/src/pages/assistant/InstructorVoiceLab.tsx', import.meta.url),
    'utf8'
)
const voiceConversationSource = readFileSync(
    new URL('../src/renderer/src/pages/assistant/InstructorVoiceConversation.tsx', import.meta.url),
    'utf8'
)
const voiceConversationStyles = readFileSync(
    new URL('../src/renderer/src/pages/assistant/InstructorVoiceConversation.css', import.meta.url),
    'utf8'
)
const voiceOrbSource = readFileSync(
    new URL('../src/renderer/src/pages/assistant/InstructorVoiceOrb.tsx', import.meta.url),
    'utf8'
)
const voiceOrbStyles = readFileSync(
    new URL('../src/renderer/src/pages/assistant/InstructorVoiceOrb.css', import.meta.url),
    'utf8'
)
const strandsSource = readFileSync(
    new URL('../src/renderer/src/components/ui/strands/Strands.tsx', import.meta.url),
    'utf8'
)
const voiceSettingsStyles = readFileSync(
    new URL('../src/renderer/src/pages/assistant/InstructorVoiceSettings.css', import.meta.url),
    'utf8'
)
const composerViewSource = readFileSync(
    new URL('../src/renderer/src/pages/assistant/AssistantComposerView.tsx', import.meta.url),
    'utf8'
)
const composerSource = readFileSync(
    new URL('../src/renderer/src/pages/assistant/AssistantComposer.tsx', import.meta.url),
    'utf8'
)
const assistantStoreSource = readFileSync(
    new URL('../src/renderer/src/lib/assistant/assistant-store-core.ts', import.meta.url),
    'utf8'
)
const voiceSessionSource = readFileSync(
    new URL('../src/renderer/src/pages/assistant/useInstructorVoiceSession.ts', import.meta.url),
    'utf8'
)
const realtimeVoiceContractSource = readFileSync(
    new URL('../src/shared/assistant/contracts/realtime-voice.ts', import.meta.url),
    'utf8'
)
const codexRealtimeVoiceSource = readFileSync(
    new URL('../src/main/assistant/codex-realtime-voice.ts', import.meta.url),
    'utf8'
)
const realtimeForegroundAdapterSource = readFileSync(
    new URL('../src/main/assistant/voice/codex-realtime-foreground-adapter.ts', import.meta.url),
    'utf8'
)
const conversationPaneSource = readFileSync(
    new URL('../src/renderer/src/pages/assistant/AssistantConversationPane.tsx', import.meta.url),
    'utf8'
)
const conversationHeaderSource = readFileSync(
    new URL('../src/renderer/src/pages/assistant/AssistantConversationHeader.tsx', import.meta.url),
    'utf8'
)
const canonicalVoiceStageSource = readFileSync(
    new URL('../src/renderer/src/pages/assistant/AssistantCanonicalVoiceStage.tsx', import.meta.url),
    'utf8'
)
const canonicalVoiceDockSource = readFileSync(
    new URL('../src/renderer/src/pages/assistant/AssistantCanonicalVoiceDock.tsx', import.meta.url),
    'utf8'
)
const voiceComposerSource = readFileSync(
    new URL('../src/renderer/src/pages/assistant/InstructorVoiceComposer.tsx', import.meta.url),
    'utf8'
)
const canonicalVoiceStageStyles = readFileSync(
    new URL('../src/renderer/src/pages/assistant/AssistantCanonicalVoiceStage.css', import.meta.url),
    'utf8'
)
const timelineRowsSource = readFileSync(
    new URL('../src/renderer/src/pages/assistant/AssistantTimelineRows.tsx', import.meta.url),
    'utf8'
)
const assistantServiceSource = readFileSync(
    new URL('../src/main/assistant/service.ts', import.meta.url),
    'utf8'
)
const zyraRuntimeSource = readFileSync(
    new URL('../src/main/assistant/zyra-pi-runtime.ts', import.meta.url),
    'utf8'
)
const liveTranscriptSource = readFileSync(
    new URL('../src/renderer/src/pages/assistant/InstructorVoiceLiveTranscript.tsx', import.meta.url),
    'utf8'
)
assert.match(voiceLabSource, /<InstructorVoiceConversation/)
assert.doesNotMatch(voiceLabSource, /ConversationDrawer/)
assert.match(voiceConversationSource, /userMessage \? 'is-user' : 'is-assistant'/)
assert.match(voiceConversationStyles, /instructor-voice-conversation-user-bubble/)
assert.match(voiceConversationStyles, /background: color-mix\(/)
assert.doesNotMatch(voiceConversationStyles, /--sparkle-/)
assert.match(voiceOrbSource, /animateLayout/)
assert.match(voiceOrbSource, /instructor-voice-orb-render-surface/)
assert.match(voiceOrbSource, /instructor-voice-orb-volume/)
assert.match(voiceOrbSource, /maxFps=\{active \? 20 : connecting \? 16 : 8\}/, 'the Voice orb keeps its two-pass WebGL work inside a bounded active, connecting, and idle frame budget')
assert.match(voiceSessionSource, /ACTIVITY_UPDATE_INTERVAL_MS = 96/, 'Voice activity reaches React at no more than roughly ten updates per second')
assert.match(strandsSource, /frameIntervalMs = 1_000 \/ Math\.min\(60, Math\.max\(1, current\.maxFps\)\)/, 'the WebGL loop must enforce its configured frame ceiling')
assert.match(strandsSource, /antialias: false/, 'the full-screen shader must not pay for redundant multisampling')
assert.match(voiceOrbStyles, /--instructor-orb-layout-scale/)
assert.match(voiceOrbStyles, /--instructor-orb-volume-scale/)
assert.match(voiceSettingsStyles, /grid-template-columns: minmax\(280px/)
assert.match(voiceSettingsStyles, /instructor-voice-settings-instructions-pane/)
assert.doesNotMatch(voiceSettingsStyles, /--sparkle-/)
assert.match(composerViewSource, /showRealtimeVoicePrimaryAction[\s\S]{0,120}<ComposerRealtimeVoiceButton/u)
assert.match(
    composerViewSource,
    /onStartRealtimeVoice\?\.\([\s\S]{0,150}buildAssistantVoiceExecutionConfiguration\(\{[\s\S]{0,500}model: controller\.selectedModel[\s\S]{0,500}runtimeMode: controller\.selectedRuntimeMode[\s\S]{0,500}effort: controller\.selectedEffort/u,
    'Voice activation must snapshot the configuration currently visible in the composer'
)
assert.match(
    composerSource,
    /controller\.loadedSessionId !== props\.sessionId[\s\S]{0,250}onPrepareRealtimeVoice\(buildAssistantVoiceExecutionConfiguration/u,
    'the primary worker must start only after the active composer has loaded that chat configuration'
)
assert.match(
    assistantStoreSource,
    /connectionContextKey[\s\S]{0,500}voicePreparationKey[\s\S]{0,600}const key = `\$\{sessionId\}:\$\{threadId\}:\$\{connectionContextKey\}:\$\{voicePreparationKey\}`[\s\S]{0,700}voicePreparation \? \{ voicePreparation \} : \{\}/u,
    'chat-open preparation must be distinct across canonical-only work and project changes'
)
assert.match(
    voiceSessionSource,
    /executionConfiguration: options\.executionConfiguration/u,
    'the current composer configuration must cross the renderer-to-main Voice start boundary'
)
assert.match(
    voiceSessionSource,
    /assistant\.connect\(\{[\s\S]{0,250}sessionId: binding\.sessionId,[\s\S]{0,250}voicePreparation: options\.executionConfiguration[\s\S]{0,500}getUserMedia/u,
    'the canonical assistant connection and primary-agent preparation must overlap microphone and WebRTC setup'
)
assert.match(
    assistantServiceSource,
    /async connect\(options\?: AssistantConnectOptions\)[\s\S]{0,350}const result = await connectAssistantSession\(this\.actionDeps, options\)[\s\S]{0,1200}prepareVoicePrimaryWorker\([\s\S]{0,300}return result/u,
    'cold canonical startup must finish before the private Voice worker starts so both bridges cannot exhaust the startup timeout together'
)
assert.match(
    assistantServiceSource,
    /const hasVoiceState = Boolean\([\s\S]{0,400}if \(!hasVoiceState\) return \{ success: true as const \}[\s\S]{0,120}await this\.cancelPendingCanonicalVoiceStart\(\)/u,
    'an idle Voice cleanup must not cancel chat-open primary-worker preparation'
)
assert.doesNotMatch(
    assistantServiceSource,
    /async stopRealtimeVoice\(senderId: number\)[\s\S]{0,900}invalidateVoicePrimaryWorkerPreparation\(\)/u,
    'stopping Voice must retain the healthy worker owned by the still-active chat'
)
assert.doesNotMatch(
    assistantServiceSource,
    /private async stopCanonicalVoiceInternal\(reason: string\)[\s\S]{0,650}invalidateVoicePrimaryWorkerPreparation\(\)/u,
    'closing the Voice transport must not destroy the independent chat-scoped primary worker'
)
assert.match(
    zyraRuntimeSource,
    /const cancelled = this\.preparedPrivateVoiceWorker !== prepared[\s\S]{0,250}if \(cancelled\) return[\s\S]{0,100}throw error/u,
    'intentionally disposing an unclaimed Voice preparation must settle quietly instead of reporting a false startup failure'
)
assert.match(
    zyraRuntimeSource,
    /if \(current\?\.key === key\)[\s\S]{0,350}if \(this\.preparedPrivateVoiceWorker !== current\) return[\s\S]{0,100}throw error/u,
    'every waiter sharing a cancelled Voice preparation must settle quietly'
)
assert.match(
    voiceSessionSource,
    /peer\.connectionState === 'disconnected'[\s\S]{0,650}REALTIME_PEER_DISCONNECT_GRACE_MS/u,
    'brief WebRTC disconnects should receive a bounded recovery grace instead of killing Voice immediately'
)
assert.match(voiceSessionSource, /sentClientCommandIdsRef/u, 'renderer commands must be deduplicated before reaching oai-events')
assert.match(voiceSessionSource, /type === 'delegation\.created'/u, 'the renderer must forward the provider handoff event across the canonical Voice bridge')
assert.match(voiceSessionSource, /realtimeSessionGeneration/u, 'renderer commands must be bound to the active Voice generation')
assert.match(voiceSessionSource, /requiresIdleResponse && realtimeResponseActiveRef\.current/u, 'context commands must queue while ChatGPT is already speaking')
assert.doesNotMatch(realtimeVoiceContractSource, /response\.create/u, 'Frameless client commands must stay within the live provider command set')
assert.doesNotMatch(codexRealtimeVoiceSource, /type: 'response\.create'/u, 'Voice speech must not emit the removed response.create command')
assert.match(
    realtimeVoiceContractSource,
    /executionConfiguration\?: AssistantVoiceExecutionConfiguration/u,
    'canonical Voice start must carry a typed primary-agent execution configuration'
)
assert.match(conversationPaneSource, /onStartRealtimeVoice=\{handleStartCanonicalVoice\}/u)
assert.match(conversationPaneSource, /onPrepareRealtimeVoice=\{handlePrepareCanonicalVoice\}/u)
assert.match(conversationPaneSource, /messages=\{displayedTimelineMessages\}/u)
assert.match(
    conversationPaneSource,
    /isConnecting=\{isThreadConnecting && !voiceVisible\}/u,
    'the regular empty-thread connecting mark must yield while the Voice orb owns the focal state'
)
assert.match(canonicalVoiceStageSource, /<InstructorVoiceOrb/u)
assert.match(canonicalVoiceDockSource, /<InstructorVoiceComposer/u)
assert.match(canonicalVoiceDockSource, /allowImages=\{false\}/u)
assert.match(canonicalVoiceDockSource, /AssistantPendingApprovalPanel/u)
assert.doesNotMatch(
    voiceComposerSource,
    /onClick=\{active \|\| connecting \? onStop : onStart\}/u,
    'Voice retry must not forward React click events as execution configuration'
)
assert.match(
    voiceComposerSource,
    /onClick=\{\(\) => \{[\s\S]{0,160}if \(active \|\| connecting\) onStop\(\)[\s\S]{0,100}else onStart\(\)/u,
    'Voice start and stop controls must invoke their callbacks without DOM event arguments'
)
assert.match(canonicalVoiceStageStyles, /bottom: 90px/u)
assert.match(conversationPaneSource, /VOICE_TIMELINE_RESERVE_PX = 500/u)
assert.match(conversationPaneSource, /VOICE_SCROLL_BUTTON_BOTTOM_PX = 78/u)
assert.doesNotMatch(conversationPaneSource, /voiceTimelineInsetFrameRef/u, 'Voice startup must not relayout the virtual timeline on every animation frame')
assert.match(timelineRowsSource, /usesProviderNativeStreaming = message\.modality === 'voice'/u)
assert.match(assistantServiceSource, /Approval received\. The primary agent is continuing\./u)
assert.match(
    assistantServiceSource,
    /const executionConfiguration = requireCanonicalVoiceExecutionConfiguration\(input\.executionConfiguration\)/u,
    'canonical Voice must fail closed when the selected Chat execution configuration is absent'
)
assert.match(
    assistantServiceSource,
    /model: active\.executionConfiguration\.model[\s\S]{0,500}runtimeMode: active\.executionConfiguration\.runtimeMode/u,
    'delegated Voice work must use the immutable configuration captured at Voice activation'
)
assert.match(
    assistantServiceSource,
    /await this\.runtime\.configureSession\(connected\.thread\.providerThreadId, executionConfiguration\)/u,
    'Voice activation must synchronize the visible Chat configuration before handing off authority'
)
assert.match(
    assistantServiceSource,
    /prepareVoicePrimaryWorker\(connected\.thread\.id, projectCwd, executionConfiguration\)[\s\S]{0,500}startVoice\(/u,
    'the chat-scoped primary-agent worker must still prepare while realtime Voice signaling is in flight as a fallback'
)
assert.match(
    assistantServiceSource,
    /const historyPreload = record\.thread\.providerThreadId[\s\S]{0,900}runtime\.connect[\s\S]{0,900}if \(historyPreload\) await historyPreload/u,
    'cold Voice overlaps canonical history hydration with the already-required Assistant connection'
)
assert.match(
    realtimeForegroundAdapterSource,
    /requestSpeech\(item\.text, item\.canonicalMessageId\)/u,
    'primary-task narration carries its canonical identity through the speakable command'
)
assert.match(
    realtimeForegroundAdapterSource,
    /normalizeWebRtcDelegationEvent\(value\)[\s\S]{0,500}type: 'realtime\.delegation\.requested'/u,
    'the main adapter must turn the provider handoff into one owner-scoped domain event'
)
assert.match(
    assistantServiceSource,
    /event\.type === 'realtime\.delegation\.requested'[\s\S]{0,180}routeVoiceStrongRequest\(event\)/u,
    'spoken primary-agent work must start from the provider delegation instead of a transcript keyword guess'
)
assert.match(
    assistantServiceSource,
    /private async submitVoiceTaskNarration[\s\S]{0,900}committer\.commit\([\s\S]{0,500}providerItemId: `voice-result:\$\{taskId\}`[\s\S]{0,500}requestSpeech/u,
    'primary-task narration becomes canonical before its spoken replay'
)
assert.match(
    assistantServiceSource,
    /this\.disposeRequested = true[\s\S]{0,2500}await this\.canonicalVoiceSetupPromise\?\.catch/u,
    'service disposal fences and drains asynchronous Voice capability setup before teardown'
)
assert.match(
    zyraRuntimeSource,
    /claimPreparedPrivateVoiceWorker[\s\S]{0,3500}prepared\?\.connected[\s\S]{0,500}worker\.request\('prompt'/u,
    'delegated Voice work must claim the prepared primary-agent session before prompting'
)
assert.match(
    zyraRuntimeSource,
    /configuration\.localThreadId,[\s\S]{0,350}configuration\.cwd,[\s\S]{0,350}configuration\.model/u,
    'prepared primary workers must be keyed to the chat as well as their execution configuration'
)
assert.match(
    zyraRuntimeSource,
    /canReusePreparedWorker[\s\S]{0,500}prepared\.prepared\.claimed = false/u,
    'a healthy completed primary worker must return to the chat-scoped pool for the next Voice handoff'
)
assert.match(
    zyraRuntimeSource,
    /if \(prepared && this\.preparedPrivateVoiceWorker === prepared\.prepared\)[\s\S]{0,180}this\.preparedPrivateVoiceWorker = null[\s\S]{0,120}worker\.dispose\(\)/u,
    'failed, cancelled, stale, or unhealthy primary workers must be evicted instead of reused'
)
assert.match(zyraRuntimeSource, /\[AssistantVoiceTiming\] Primary worker ready/u)
assert.match(zyraRuntimeSource, /\[AssistantVoiceTiming\] Primary task finished/u)
assert.match(
    assistantServiceSource,
    /private queueTypedVoiceResponse[\s\S]{0,1500}appendContext\(\[\{ role: 'user', text: input\.text \}\]\)[\s\S]{0,1500}generateTypedVoiceResponse/u,
    'typed Voice input must enter the current Frameless context before its Pi-generated response is spoken'
)
assert.match(
    assistantServiceSource,
    /if \(shouldDelegateVoiceInspection\(text\)\)[\s\S]{0,1200}routeVoiceStrongRequest\(\{[\s\S]{0,500}providerItemId: `typed:\$\{clientMessageId\}`[\s\S]{0,300}mode: 'strong-task'/u,
    'actionable typed Voice input must use the same primary-agent route as spoken work'
)
assert.match(
    assistantServiceSource,
    /requireRealtimeContinuity\(\)\.materialize[\s\S]{0,800}runtime\.generateText/u,
    'typed Voice utility generation must receive bounded canonical conversation context'
)
assert.match(
    assistantServiceSource,
    /typedVoiceResponseQueues\.get\(key\)[\s\S]{0,500}previous[\s\S]{0,1500}generateTypedVoiceResponse/u,
    'typed Voice utility responses must preserve submission order within one Voice session'
)
assert.match(
    assistantServiceSource,
    /canonicalMessageId[\s\S]{0,2000}seed\.items\.findIndex[\s\S]{0,500}seed\.items\.slice\(0, messageIndex \+ 1\)/u,
    'each queued typed response must exclude canonical messages submitted after its own user turn'
)
assert.match(
    zyraRuntimeSource,
    /async configureSession\([\s\S]{0,1500}context\.worker\.request\('configure', \{[\s\S]{0,500}runtimeMode: configuration\.runtimeMode/u,
    'the canonical runtime session must receive the selected model, effort, and permission mode'
)
assert.doesNotMatch(
    assistantServiceSource,
    /Strong task \$\{activeTask\.taskId\} tool \$\{lifecycle\}/u,
    'tool lifecycle events must stay visual instead of prompting unverified realtime narration'
)
assert.doesNotMatch(liveTranscriptSource, /data-transcript-word|element\.animate/u, 'the orb caption should use one calm transition rather than per-word animation')
assert.doesNotMatch(conversationHeaderSource, /onToggleVoice|Start Voice in this chat/u, 'realtime Voice activation should live in the empty composer instead of the title bar')

console.log('Assistant realtime voice contract passed.')
