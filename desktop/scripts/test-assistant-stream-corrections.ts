import { applyAssistantDomainEvents } from '../src/shared/assistant/projector'
import { handleAssistantRuntimeEvent } from '../src/main/assistant/service-runtime-events'
import type { AssistantRuntimeEvent, AssistantSnapshot } from '../src/shared/assistant/contracts'
import assert from 'node:assert/strict'
import { assistantTextUpdate, applyAssistantTextUpdate } from '../src/shared/assistant/stream-text-update'
import { collapseAssistantDeltaEvents } from '../src/renderer/src/lib/assistant/event-batching'
import { assistantStreamPresentation } from '../src/renderer/src/lib/assistant/assistant-stream-presentation'
import { emptyAssistantContentParts, extractAssistantEventContentParts } from '../src/main/assistant/assistant-message-content'
import type { AssistantDomainEvent } from '../src/shared/assistant/contracts'
const snapshots = ['I think printers', 'I think', 'I think printers can', 'I think printers can smell urgency.', 'I think printers can smell urgency..', '', 'Very very good.']
let source = '', projected = ''
const events: AssistantDomainEvent[] = []
for (const [index, text] of snapshots.entries()) {
    const update = assistantTextUpdate(source, text)!
    const event = { sequence: index + 1, eventId: `event-${index}`, occurredAt: new Date().toISOString(), type: 'thread.message.assistant.delta', threadId: 'thread', payload: { messageId: 'message', ...update } } as AssistantDomainEvent
    events.push(event)
    projected = applyAssistantTextUpdate(projected, update)
    assistantStreamPresentation.ingestEvent(event)
    assert.equal(projected, text)
    assert.equal(assistantStreamPresentation.getSnapshot('message', 'message').text, text)
    source = text
}
let collapsedText = ''
for (const event of collapseAssistantDeltaEvents(events)) collapsedText = applyAssistantTextUpdate(collapsedText, event.payload)
assert.equal(collapsedText, source)
let content = emptyAssistantContentParts()
for (const delta of ['Very', ' ', 'very', ' good', '.', '.']) content = extractAssistantEventContentParts({ assistantMessageEvent: { type: 'text_delta', delta } }, content, 'message_update')
assert.equal(content.text, 'Very very good..', 'delta-only transport preserves whitespace and intentional repetition')
assistantStreamPresentation.clear()
console.log('Streaming corrections and repeated tokens: ok')

// Exercise the main-process batching boundary before replaying persisted domain events.
const thread = { id: 'thread', messages: [], activities: [], pendingApprovals: [], pendingUserInputs: [] }
const session = { id: 'session', threads: [thread] }
const persisted: AssistantDomainEvent[] = []
let pending = ''
function appendEvent(type: string, occurredAt: string, payload: Record<string, unknown>) {
    persisted.push({ type, occurredAt, payload, eventId: `persisted-${persisted.length}`, sequence: persisted.length + 1, sessionId: session.id, threadId: thread.id } as AssistantDomainEvent)
}
function flush() {
    if (!pending) return
    appendEvent('thread.message.assistant.delta', new Date().toISOString(), { messageId: 'assistant-message-item', threadId: thread.id, delta: pending })
    pending = ''
}
const deps = { findThreadRecord: () => ({ session, thread }), findSessionByThreadId: () => session, isAssistantTextSuppressed: () => false, assistantTextBuffers: new Map(), flushAssistantTextDelta: flush, queueAssistantTextDelta: (input: { delta: string }) => { pending += input.delta }, appendEvent, updateLatestTurnAssistantMessage: () => {} }
let previous = ''
for (const text of snapshots) {
    const update = assistantTextUpdate(previous, text)!
    handleAssistantRuntimeEvent({ type: 'content.delta', eventId: 'runtime', threadId: thread.id, turnId: 'turn', itemId: 'item', createdAt: new Date().toISOString(), payload: { streamKind: 'assistant_text', ...update } } as AssistantRuntimeEvent, deps as unknown as Parameters<typeof handleAssistantRuntimeEvent>[1])
    previous = text
}
flush()
const restored = applyAssistantDomainEvents({ snapshotSequence: 0, sessions: [session], knownModels: [], fleetByThreadId: {}, selectedSessionId: session.id } as unknown as AssistantSnapshot, persisted)
assert.equal(restored.sessions[0].threads[0].messages[0].text, snapshots.at(-1))
console.log('Main batching and persisted text replay: ok')
