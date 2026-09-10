import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { applyRealtimeTranscriptEvent, type InstructorTranscriptEntry } from '../src/renderer/src/pages/assistant/instructor-voice-transcript'
import { projectVoiceLiveTimelineMessages } from '../src/renderer/src/pages/assistant/assistant-voice-live-timeline'

let entries: InstructorTranscriptEntry[] = [{ id: 'speech-user', role: 'user', text: 'Hello', final: false }]
entries = applyRealtimeTranscriptEvent(entries, { type: 'turn.created', turn: { id: 'assistant-overlap', role: 'assistant', transcript: '' } })
entries = applyRealtimeTranscriptEvent(entries, { type: 'turn.done', turn: { id: 'user-complete', role: 'user', transcript: 'Hello can you check this' } })
const canonical = [{ id: 'saved-user', providerItemId: 'user-complete', role: 'user' as const, text: 'Hello can you check this', turnId: null, streaming: false, modality: 'voice' as const, createdAt: '2026-09-10T10:00:01Z', updatedAt: '2026-09-10T10:00:01Z' }]
const projected = projectVoiceLiveTimelineMessages({ transcript: entries, canonicalMessages: canonical, voiceStartedAt: '2026-09-10T10:00:00Z', nowMs: Date.parse('2026-09-10T10:00:02Z') })
assert.equal(entries.filter(entry => entry.role === 'user').length, 1, 'interleaved assistant activity must not strand the first-word user entry')
assert.equal(projected.messages.filter(message => message.role === 'user').length, 0, 'canonical completion must leave no first-word bubble to pin at the bottom')

let chunks: InstructorTranscriptEntry[] = [{ id: 'speech-chunks', role: 'user', text: 'Hello', final: false }]
chunks = applyRealtimeTranscriptEvent(chunks, { type: 'turn.created', turn: { id: 'assistant-chunks', role: 'assistant', transcript: '' } })
chunks = applyRealtimeTranscriptEvent(chunks, { type: 'input_transcript.added', item: { id: 'chunk-two', text: 'Hello can you check this' } })
assert.deepEqual(chunks.filter(entry => entry.role === 'user').map(entry => [entry.id, entry.text]), [['speech-chunks', 'Hello can you check this']], 'later user chunks update the same utterance across assistant events')
chunks = applyRealtimeTranscriptEvent(chunks, { type: 'conversation.item.input_audio_transcription.completed', item_id: 'user-complete', transcript: 'Hello can you check this' })
assert.equal(projectVoiceLiveTimelineMessages({ transcript: chunks, canonicalMessages: canonical, voiceStartedAt: '2026-09-10T10:00:00Z' }).messages.length, 0)

let repeat: InstructorTranscriptEntry[] = []
for (const id of ['user-one', 'user-two']) repeat = applyRealtimeTranscriptEvent(repeat, { type: 'turn.done', turn: { id, role: 'user', transcript: 'Hello' } })
assert.equal(repeat.length, 2, 'genuine repeated messages remain separate')
const otherPending = [{ id: 'older', role: 'user', text: 'Earlier', final: false }, { id: 'newer', role: 'user', text: 'Later', final: false }]
const unknown = applyRealtimeTranscriptEvent(otherPending, { type: 'turn.done', turn: { id: 'unknown-final', role: 'user', transcript: 'Unrelated' } })
assert.equal(unknown.filter(entry => !entry.final).length, 2, 'ambiguous pending utterances cannot be merged by guessing')
const pane = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantConversationPane.tsx', import.meta.url), 'utf8')
const timelinePane = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantConversationTimelinePane.tsx', import.meta.url), 'utf8')
assert.match(pane, /suppressEmptyProjectBadge=\{voiceVisible\}/)
assert.match(timelinePane, /projectLabel=\{projectRootPath && !props\.suppressEmptyProjectBadge \? props\.latestProjectLabel : null\}/)
assert.match(timelinePane, /projectRootPath=\{projectRootPath\}/, 'hiding the empty badge cannot remove file-link project context')
console.log('Voice transcript interleaving: first-word promotion, canonical replacement, intentional repeats, ambiguous identities and startup badge isolation: ok')
