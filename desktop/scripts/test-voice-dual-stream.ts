import assert from 'node:assert/strict'
import fixture from './fixtures/voice-dual-stream-events.json'
import { applyRealtimeTranscriptEvent, type InstructorTranscriptEntry } from '../src/renderer/src/pages/assistant/instructor-voice-transcript'
import { projectVoiceLiveTimelineMessages } from '../src/renderer/src/pages/assistant/assistant-voice-live-timeline'
import { normalizeWebRtcTranscriptEvent } from '../src/main/assistant/voice/codex-realtime-foreground-adapter'
import type { AssistantMessage } from '../src/shared/assistant/contracts'

let entries: InstructorTranscriptEntry[] = []
const canonical: AssistantMessage[] = [], roles = new Map<string, 'user' | 'assistant'>(), completed = new Set<string>()
const base = Date.parse('2026-09-01T10:00:00Z')
for (const event of fixture.events) {
    entries = applyRealtimeTranscriptEvent(entries, event)
    if (entries.some(entry => entry.role === 'user' && entry.transcriptSource === 'turn')) {
        assert.equal(entries.filter(entry => entry.role === 'user' && entry.transcriptSource === 'chunk' && !entry.final).length, 0, 'no transient chunk identity survives after the user turn stream is identified')
    }
    const normalized = normalizeWebRtcTranscriptEvent(event, roles)
    if (normalized?.kind === 'completed' && !completed.has(normalized.providerItemId)) {
        completed.add(normalized.providerItemId)
        const time = new Date(base + event.atMs + 1).toISOString()
        canonical.push({ id: `saved-${normalized.providerItemId}`, providerItemId: normalized.providerItemId, role: normalized.role, text: normalized.text, turnId: null, streaming: false, modality: 'voice', createdAt: time, updatedAt: time })
    }
}
for (let committedCount = 0; committedCount <= canonical.length; committedCount++) {
    const saved = canonical.slice(0, committedCount)
    const live = projectVoiceLiveTimelineMessages({ transcript: entries, canonicalMessages: saved, voiceStartedAt: new Date(base).toISOString(), nowMs: base + 30000 })
    const visible = [...saved, ...live.messages]
    assert.equal(visible.length, canonical.length, 'delayed canonical commits replace complete turns without adding or losing bubbles')
    assert.ok(visible.every(message => message.providerItemId?.startsWith('turn-')), 'physical transcript chunk IDs never survive as message identities')
}
const first = projectVoiceLiveTimelineMessages({ transcript: entries, canonicalMessages: canonical, voiceStartedAt: new Date(base).toISOString(), nowMs: base + 30000 })
assert.equal(first.messages.length, 0, 'real dual-stream capture must leave no chunk bubbles after its canonical turns are saved')
assert.equal(entries.filter(entry => entry.role === 'user').length, canonical.filter(message => message.role === 'user').length, 'one visible entry per identified user turn')
const next = projectVoiceLiveTimelineMessages({ transcript: entries, canonicalMessages: [...canonical, { ...canonical.at(-1)!, id: 'later-history', createdAt: new Date(base + 40000).toISOString() }], voiceStartedAt: new Date(base).toISOString(), previousAnchors: first.anchors, nowMs: base + 45000 })
assert.equal(next.messages.length, 0, 'later history cannot drag old chunk entries to the bottom')

let repeated: InstructorTranscriptEntry[] = []
for (const id of ['repeat-one', 'repeat-two']) {
    repeated = applyRealtimeTranscriptEvent(repeated, { type: 'input_transcript.added', item: { id: `chunk-${id}`, text: 'Hello' } })
    repeated = applyRealtimeTranscriptEvent(repeated, { type: 'turn.created', turn: { id, role: 'user', transcript: 'Hello' } })
    repeated = applyRealtimeTranscriptEvent(repeated, { type: 'turn.done', turn: { id, role: 'user', transcript: 'Hello' } })
}
assert.deepEqual(repeated.map(entry => entry.id), ['repeat-one', 'repeat-two'], 'identical words in distinct turns remain distinct')
const late = applyRealtimeTranscriptEvent(repeated, { type: 'input_transcript.added', item: { id: 'late-tail', text: 'Hello' } })
assert.deepEqual(late, repeated, 'chunk mirrors cannot reopen a completed turn')
let legacy = applyRealtimeTranscriptEvent([], { type: 'input_transcript.added', item: { id: 'legacy-chunk', text: 'Legacy' } })
legacy = applyRealtimeTranscriptEvent(legacy, { type: 'input_transcript.added', item: { id: 'legacy-chunk-2', text: ' input' } })
legacy = applyRealtimeTranscriptEvent(legacy, { type: 'conversation.item.input_audio_transcription.completed', item_id: 'legacy-final', transcript: 'Legacy input' })
assert.deepEqual(legacy.map(entry => [entry.text, entry.final]), [['Legacy input', true]], 'turnless provider fallback stays supported')
let completionOnly = applyRealtimeTranscriptEvent([], { type: 'input_transcript.added', item: { id: 'early-chunk', text: 'Hello' } })
completionOnly = applyRealtimeTranscriptEvent(completionOnly, { type: 'turn.done', turn: { id: 'complete-without-created', role: 'user', transcript: 'Hello again' } })
assert.deepEqual(completionOnly.map(entry => entry.id), ['complete-without-created'], 'a completion alone can promote the stream without retaining its provisional chunk')
let mixed = applyRealtimeTranscriptEvent([], { type: 'turn.done', turn: { id: 'assistant-logical', role: 'assistant', transcript: 'Ready' } })
mixed = applyRealtimeTranscriptEvent(mixed, { type: 'input_transcript.added', item: { id: 'legacy-user-chunk', text: 'User input' } })
assert.equal(mixed.filter(entry => entry.role === 'user').length, 1, 'one speaker using logical turns must not disable the other speaker\'s fallback')
console.log('Real Voice dual-stream replay: zero orphan bubbles, stable history, turn identity, repeated utterances and legacy fallback: ok')
