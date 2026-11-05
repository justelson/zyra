import assert from 'node:assert/strict'
import type { AssistantDomainEvent, AssistantMessage, AssistantSnapshot } from '../src/shared/assistant/contracts'
import { applyAssistantDomainEvents, createDefaultAssistantSnapshot } from '../src/shared/assistant/projector'
import { createAssistantDevelopmentChatFixtures } from '../src/main/assistant/development-chat-fixtures'
import { collapseAssistantDeltaEvents } from '../src/renderer/src/lib/assistant/event-batching'

const session = createAssistantDevelopmentChatFixtures({ cwd: 'C:/fixture', now: 1_800_000_000_000 }).sessions[0]!
const thread = { ...session.threads[0]!, messages: [], activities: [], proposedPlans: [], latestTurn: null, messageCount: 0, activityCount: 0, proposedPlanCount: 0 }
const base = { ...createDefaultAssistantSnapshot(), sessions: [{ ...session, threads: [thread] }], selectedSessionId: session.id }
const at = (sequence: number) => new Date(1_800_000_000_000 + sequence * 1000).toISOString()
const event = (sequence: number, type: AssistantDomainEvent['type'], payload: Record<string, unknown>): AssistantDomainEvent => ({
    sequence, eventId: `batch-${sequence}`, occurredAt: at(sequence), type, sessionId: session.id, threadId: thread.id, payload: { threadId: thread.id, ...payload }
})
const delta = (sequence: number, messageId = 'm0', extra: Record<string, unknown> = {}) => event(sequence, 'thread.message.assistant.delta', { messageId, delta: ` ${sequence}`, ...extra })
const activity = (sequence: number, id = 'a0') => ({ id, kind: 'command', tone: 'tool', summary: `Command ${sequence}`, turnId: 'turn', createdAt: at(sequence), payload: { status: 'running', output: `Output ${sequence}` } })
const populated: AssistantSnapshot = { ...base, sessions: [{ ...session, threads: [{ ...thread,
    messages: [{ id: 'm0', role: 'assistant', text: 'Existing answer', turnId: 'turn', streaming: false, createdAt: at(0), updatedAt: at(0) }],
    activities: [activity(0)], messageCount: 1, activityCount: 1
}] }] }
function verify(events: AssistantDomainEvent[], label: string, initial: AssistantSnapshot = base) {
    const raw = applyAssistantDomainEvents(structuredClone(initial), events)
    const batched = applyAssistantDomainEvents(structuredClone(initial), collapseAssistantDeltaEvents(events, initial))
    assert.deepEqual(batched, raw, label)
}

verify([delta(1), event(2, 'thread.updated', { patch: { messageCount: 1 } }), delta(3)], 'an authoritative message count cannot move before its creating delta')
verify([delta(1, 'm0'), delta(2, 'm1'), delta(3, 'm0')], 'interleaved message creation preserves chronological order and timestamps')
verify([event(1, 'thread.activity.appended', { activity: activity(1) }), event(2, 'thread.updated', { patch: { activityCount: 1 } }), event(3, 'thread.activity.appended', { activity: activity(3) })], 'authoritative activity counters stay ordered')
verify([event(1, 'thread.activity.appended', { activity: activity(1) }), event(2, 'thread.activity.appended', { activity: activity(2), updateOnly: true })], 'an update-only completion cannot erase the creator')
verify([event(1, 'thread.activity.appended', { activity: activity(1), updateOnly: true }), event(2, 'thread.activity.appended', { activity: activity(2) }), event(3, 'thread.activity.appended', { activity: activity(3), updateOnly: true })], 'update-only transitions preserve the middle creating event')
verify([delta(1), delta(2, 'm0', { turnId: 'first-turn' }), delta(3)], 'first-set turn metadata cannot disappear from a collapsed tail')
verify([delta(10), delta(5), delta(6), delta(11)], 'ignored out-of-order deltas cannot enter a later accepted tail')
verify([delta(5), delta(6), delta(11)], 'the snapshot watermark excludes ignored leading deltas', { ...base, snapshotSequence: 10 })
const legacyMessage: AssistantMessage = { id: 'assistant-message-legacy', role: 'assistant', text: 'AB', turnId: 'turn', streaming: false, createdAt: at(1), updatedAt: at(1) }
const legacyBase = { ...base, sessions: [{ ...session, threads: [{ ...thread, messages: [legacyMessage], messageCount: 1 }] }] }
verify([delta(1, 'canonical-current', { delta: 'A' }), delta(2, 'canonical-current', { delta: 'B' }), delta(3, 'canonical-current', { delta: 'C' })], 'resident legacy replay cleanup retains intermediate exact matches', legacyBase)
const addedLegacy = event(1, 'thread.updated', { patch: { messages: [legacyMessage] } })
verify([addedLegacy, delta(2, 'canonical-current', { delta: 'A' }), delta(3, 'canonical-current', { delta: 'B' }), delta(4, 'canonical-current', { delta: 'C' })], 'legacy rows introduced inside the batch also retain exact replay cleanup')

let seed = 0x5a17c0de
function random(limit: number) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit }
for (let sample = 0; sample < 1000; sample++) {
    const events: AssistantDomainEvent[] = []
    for (let sequence = 1; sequence <= 40; sequence++) {
        const id = `m${random(3)}`
        const activityId = `a${random(3)}`
        const message: AssistantMessage = { id, role: 'assistant', text: `Replacement ${sequence}`, turnId: 'turn', streaming: true, createdAt: at(sequence), updatedAt: at(sequence) }
        switch (random(12)) {
            case 0: case 1: events.push(delta(sequence, id)); break
            case 2: events.push(delta(sequence, id, { replaceText: `Corrected ${sequence}` })); break
            case 3: events.push(event(sequence, 'thread.updated', { patch: { messages: [message] } })); break
            case 4: events.push(event(sequence, 'thread.updated', { patch: {}, removedMessageIds: [id] })); break
            case 5: events.push(event(sequence, 'thread.updated', { patch: { messageCount: random(8), activityCount: random(8) } })); break
            case 6: case 7: events.push(event(sequence, 'thread.activity.appended', { activity: activity(sequence, activityId), updateOnly: Boolean(random(2)) })); break
            case 8: events.push(event(sequence, 'thread.updated', { patch: { activities: [activity(sequence, activityId)] } })); break
            case 9: events.push(event(sequence, 'thread.updated', { patch: {}, removedActivityIds: [activityId] })); break
            case 10: events.push(event(sequence, 'thread.message.assistant.completed', { messageId: id, text: `Completed ${sequence}` })); break
            default: events.push(delta(sequence, id, { phase: random(2) ? 'final_answer' : 'commentary', turnId: random(2) ? 'turn' : null })); break
        }
    }
    verify(events, `seeded mixed projection sample ${sample}`, sample % 2 ? base : populated)
}
const stream = Array.from({ length: 1000 }, (_, index) => delta(index + 1))
assert.equal(collapseAssistantDeltaEvents(stream).length, 2, 'a normal token run remains bounded to its creator and one coalesced tail')
verify(stream, 'long token run preserves the exact raw result')
console.log('Batch projection order: 1000 seeded mixed streams, creators, counts, replacements, removal, turn metadata and update-only transitions match raw replay: ok')
