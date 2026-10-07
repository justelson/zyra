import assert from 'node:assert/strict'
import type { AssistantDomainEvent } from '../src/shared/assistant/contracts'
import { collapseAssistantDeltaEvents } from '../src/renderer/src/lib/assistant/event-batching'
const event = (sequence: number, patch: Record<string, unknown>): AssistantDomainEvent => ({ sequence, eventId: `phase-${sequence}`,
    occurredAt: '2026-10-06T10:00:00.000Z', threadId: 'phase-thread', type: 'thread.message.assistant.delta',
    payload: { threadId: 'phase-thread', messageId: 'phase-message', delta: '', ...patch } })
const phase = event(1, { phase: 'final_answer' })
const text = event(2, { delta: 'Final text.' })
const batched = collapseAssistantDeltaEvents([phase, text])
assert.equal(batched.length, 1)
assert.equal(batched[0]?.payload.phase, 'final_answer', 'coalescing a later plain-text delta retains the earlier empty phase transition')
assert.equal(batched[0]?.payload.delta, 'Final text.')
const latest = collapseAssistantDeltaEvents([event(1, { phase: 'commentary', delta: 'Work. ' }), event(2, { phase: 'final_answer' }), event(3, { delta: 'Done.' })])
assert.equal(latest[0]?.payload.phase, 'final_answer', 'the latest structured phase wins')
assert.equal(latest[0]?.payload.delta, 'Work. Done.')
const replacement = collapseAssistantDeltaEvents([phase, event(2, { replaceText: 'Authoritative text.' }), event(3, { delta: ' More.' })])
assert.equal(replacement.length, 3, 'replacement remains an ordered boundary and cannot drop phase')
assert.equal(replacement[0]?.payload.phase, 'final_answer')
assert.equal(collapseAssistantDeltaEvents([text, event(3, { messageId: 'another', delta: 'Other.' })]).length, 2)
console.log('Phase batching: empty onset survives plain text, latest phase wins, replacements and other messages stay ordered: ok')
