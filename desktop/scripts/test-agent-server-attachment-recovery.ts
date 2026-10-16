import assert from 'node:assert/strict'
import { recoverAttachmentReplay } from '../src/main/assistant/agent-server-attachment-recovery'
const attention = { type: 'approval_requested', requestId: 'pending' }
const tool = { type: 'tool_execution_start', toolCallId: 'tool' }
const attachment = { latestSequence: 100, activeRequestContext: { turnId: 'turn' }, pendingAttention: [attention], pendingTools: [tool], liveMessage: { role: 'assistant', content: 'current' }, replay: [{ sequence: 100, event: { type: 'status' } }] }
const recovered = recoverAttachmentReplay(attachment, 2)
assert.deepEqual(recovered.entries.slice(1).map(entry => (entry.event as any).type), ['tool_execution_start', 'approval_requested', 'message_update'])
assert.equal(recovered.entries[1].requestContext?.turnId, 'turn')
assert.equal(recovered.resetWatermark, false)
assert.equal(recoverAttachmentReplay(attachment, 99).entries.length, 1, 'contiguous replay must not duplicate UI events')
assert.equal(recoverAttachmentReplay(attachment, 200).resetWatermark, true, 'a replaced journal must not strand a higher UI watermark')
const existing = recoverAttachmentReplay({ ...attachment, replay: [{ sequence: 99, event: attention }, { sequence: 100, event: { type: 'message_update', message: attachment.liveMessage } }] }, 2)
assert.equal(existing.entries.filter(entry => (entry.event as any).type === 'approval_requested').length, 1)

const staleStart = { sequence: 40, occurredAt: '2026-01-01T00:00:00Z', event: { type: 'compaction_start', reason: 'threshold' }, requestContext: { turnId: 'old-turn' } }
const pendingStart = { sequence: 60, occurredAt: '2026-01-01T01:00:00Z', event: { type: 'compaction_start', reason: 'threshold' }, requestContext: { turnId: 'maintained-turn' } }
const orphan = recoverAttachmentReplay({ latestSequence: 40, pendingOperations: [], replay: [staleStart] }, 39)
assert.equal((orphan.entries[0].event as any).type, 'compaction_end', 'a journal start absent from authoritative pending work cannot reopen a spinner')
assert.equal((orphan.entries[0].event as any).recoveredAfterRestart, true)
assert.equal(orphan.entries[0].requestContext?.turnId, 'old-turn')
const maintained = recoverAttachmentReplay({ latestSequence: 100, pendingOperations: [pendingStart], replay: [] }, 100)
assert.equal(maintained.entries.length, 1, 'attach restores active maintenance even beyond the retained journal and UI watermark')
assert.equal(maintained.entries[0].sequence, 60)
assert.equal(maintained.entries[0].requestContext?.turnId, 'maintained-turn', 'maintenance retains its original completed turn envelope')
const paired = recoverAttachmentReplay({ latestSequence: 41, pendingOperations: [], replay: [staleStart, { sequence: 41, event: { type: 'compaction_end', result: { tokensBefore: 42 } } }] }, 39)
assert.equal((paired.entries[0].event as any).type, 'compaction_start', 'complete history keeps the original lifecycle')
assert.equal((recoverAttachmentReplay({ latestSequence: 40, replay: [staleStart] }, 39).entries[0].event as any).type, 'compaction_start', 'legacy snapshots without authoritative pending operations stay compatible')
console.log('Desktop bounded replay recovery: passed')
