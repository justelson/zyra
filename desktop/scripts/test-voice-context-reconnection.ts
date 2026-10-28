import assert from 'node:assert/strict'
import { AssistantRealtimeContinuitySource, type AssistantContinuitySnapshot } from '../src/main/assistant/voice/assistant-realtime-continuity-source'
import { applyRealtimeHydrationDelta } from '../src/main/assistant/voice/realtime-hydration'
import { VoiceContextRevisions } from '../src/main/assistant/voice/voice-context-revisions'
const claim = { conversationId: 'fixture-conversation', foregroundRouteId: 'fixture-route', routeEpoch: 2, ownerClaimId: 'fixture-owner' }
let snapshot: AssistantContinuitySnapshot = {
    contextVersion: 100, routeCount: 2,
    messages: Array.from({ length: 30 }, (_, index) => ({ id: `message-${index + 1}`, role: index % 2 ? 'assistant' : 'user', text: `Historical turn ${index + 1}`, sequence: index + 1 })),
    pendingApprovals: [{ id: 'approval', title: 'Review requested change' }], pendingInputs: [],
    attachedTaskIds: ['task-running'], taskSummaries: ['Task is running, no verified result yet.'], totalMessageCount: 30
}
const source = new AssistantRealtimeContinuitySource(async id => { assert.equal(id, claim.conversationId); return structuredClone(snapshot) }, () => '2026-10-23T21:00:00.000Z')
const first = await source.materialize(claim.conversationId, claim)
assert.equal(first.items.filter(item => item.canonicalMessageId).length, 20)
assert.match(JSON.stringify(first.items), /Historical turn 30/)
assert.match(JSON.stringify(first.items), /bounded historical context/)
assert.match(JSON.stringify(first.items), /Task is running/)
assert.ok(first.items.some(item => item.itemId === 'zyra_voice_history_boundary'))
snapshot.messages.push({ id: 'message-31', role: 'user', text: 'Arrived while the provider was connecting.', sequence: 31 })
snapshot.contextVersion++
snapshot.totalMessageCount = 31
const delta = await source.deltaAfter(first, first.sourceWatermarks)
assert.ok(delta)
assert.equal(delta.items.filter(item => item.canonicalMessageId).length, 1)
assert.match(JSON.stringify(delta.items), /Arrived while the provider/)
const through = applyRealtimeHydrationDelta(first, first.sourceWatermarks, delta)
assert.equal(await source.deltaAfter(first, through), null)
// Fresh connection rematerializes current history and task state, never reuses an old seed.
snapshot.taskSummaries = ['Task completed. Verified output is stored at the requested path.']
snapshot.contextVersion++
snapshot.attachedTaskIds = []
const statusDelta = await source.deltaAfter(first, through)
assert.ok(statusDelta)
assert.match(JSON.stringify(statusDelta.items), /Task completed/)
const reconnect = await source.materialize(claim.conversationId, { ...claim, routeEpoch: 4, foregroundRouteId: 'route-reconnected', ownerClaimId: 'owner-reconnected' })
assert.match(JSON.stringify(reconnect.items), /Arrived while the provider/)
assert.match(JSON.stringify(reconnect.items), /Task completed/)
assert.equal(reconnect.activeRouteClaim.routeEpoch, 4)
assert.notEqual(reconnect.packetId, first.packetId)
const beforeEdit = structuredClone(snapshot)
snapshot.messages[10].text = 'Changed earlier history.'
snapshot.contextVersion++
await assert.rejects(source.deltaAfter(first, through), /Chat history changed/)
snapshot = beforeEdit
const revisions = new VoiceContextRevisions()
const thread: any = { id: 'thread', messageCount: 1, activityCount: 0, messages: [], activities: [], pendingApprovals: [], pendingUserInputs: [] }
const revision = revisions.read(thread, [], 1_000_000_000_000)
assert.equal(revisions.read(thread, [], revision), revision, 'Unchanged snapshots settle the barrier')
thread.pendingApprovals.push({ id: 'decision', status: 'pending', title: 'Approval arrived during connection' })
assert.ok(revisions.read(thread, [], revision) > revision, 'An in-place approval update advances context even without another message or activity')
// UTF-8 budgeting matters: 22,000 characters can exceed the 32 KiB provider packet cap.
snapshot.messages = Array.from({ length: 30 }, (_, index) => ({ id: `unicode-${index}`, role: 'user', text: '日本語🌍'.repeat(2000), sequence: index + 1 }))
snapshot.totalMessageCount = 30
const unicode = await source.materialize(claim.conversationId, claim)
assert.ok(Buffer.byteLength(JSON.stringify(unicode), 'utf8') <= 32 * 1024)
assert.ok(unicode.items.filter(item => item.canonicalMessageId).length > 0)
assert.match(JSON.stringify(unicode.items), /bounded historical context/)
// Never silently declare a startup barrier complete when new messages do not fit.
const unicodeSeed = await source.materialize(claim.conversationId, claim)
await assert.rejects(source.deltaAfter(unicodeSeed, { ...unicodeSeed.sourceWatermarks, conversation: 0 }), /Chat changed too much/)
console.log('PASS: current connection/reconnection history, explicit coverage, task state, startup deltas, Unicode packet bounds and overflow rejection')
