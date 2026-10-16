import assert from 'node:assert/strict'
import type { AssistantActivity } from '../src/shared/assistant/contracts'
import { findReplayedCompaction, findSupersededRuntimeCompactionIds, reconcileRuntimeCompaction } from '../src/main/assistant/compaction-reconciliation'
const live: AssistantActivity = { id: 'live-first', kind: 'context.compaction', tone: 'tool', summary: 'AUTO-COMPACTED', turnId: 'local-turn', createdAt: '2026-01-01T12:00:00Z', payload: { status: 'completed', firstKeptEntryId: 'kept-1', tokensBefore: 4000, sourceSequence: 20, startedSequence: 19 } }
const canonical: AssistantActivity = { id: 'shared-activity:canonical-1', kind: 'context-compaction', tone: 'info', summary: 'Context compacted', createdAt: '2026-01-01T12:00:00Z', payload: { canonicalEntry: { id: 'canonical-1', type: 'compaction', firstKeptEntryId: 'kept-1', tokensBefore: 4000 } } }
assert.equal(findReplayedCompaction([live], { replay: true, status: 'completed', sourceSequence: 20 })?.id, live.id)
assert.equal(findReplayedCompaction([live], { replay: true, status: 'running', sourceSequence: 19 })?.id, live.id, 'a replayed start must find the already settled operation')
assert.equal(findReplayedCompaction([live], { replay: true, status: 'completed', firstKeptEntryId: 'kept-1', tokensBefore: 4000 })?.id, live.id, 'old saved projections can reconcile without source sequence')
assert.equal(findReplayedCompaction([live], { replay: true, status: 'completed', sourceSequence: 99, firstKeptEntryId: 'kept-1', tokensBefore: 4000 }), null, 'a missed independent operation with a different durable sequence is not swallowed by equal metrics')
assert.equal(findReplayedCompaction([canonical], { replay: true, status: 'completed', firstKeptEntryId: 'kept-1', tokensBefore: 4000 })?.id, canonical.id)
assert.equal(findReplayedCompaction([live], { replay: false, status: 'completed', firstKeptEntryId: 'kept-1', tokensBefore: 4000 }), null, 'a genuinely new live operation is not swallowed')
assert.equal(findReplayedCompaction([live], { replay: true, status: 'completed', firstKeptEntryId: 'kept-2', tokensBefore: 4000 }), null)
const copies = Array.from({ length: 4 }, (_, index) => ({ ...live, id: `old-replay-${index}`, payload: { ...live.payload, sourceSequence: undefined, startedSequence: undefined }, createdAt: `2026-01-01T12:0${index}:00Z` }))
assert.deepEqual(findSupersededRuntimeCompactionIds([live, ...copies, canonical], [canonical]), [live.id, ...copies.map(activity => activity.id)], 'old accumulated copies disappear when canonical history is imported')
const secondCanonical = { ...canonical, id: 'shared-activity:canonical-2' }
assert.deepEqual(findSupersededRuntimeCompactionIds([canonical, secondCanonical], [canonical, secondCanonical]), [], 'separate canonical compactions remain even with identical result metrics')
assert.deepEqual(findSupersededRuntimeCompactionIds([{ ...live, payload: { ...live.payload, status: 'failed' } }], [canonical]), [], 'failed attempts are not hidden by successful canonical compactions')

assert.equal(findReplayedCompaction([live], { replay: true, status: 'completed', sourceSequence: 21, startedSequence: 19 })?.id, live.id, 'a terminal replay matches its original start identity')
const duplicateStart = { ...live, id: 'duplicate-running', payload: { status: 'running', sourceSequence: 19, startedSequence: 19 } }
assert.equal(findReplayedCompaction([duplicateStart, live], { replay: true, status: 'running', sourceSequence: 19 })?.id, live.id, 'a settled result takes priority over a stale duplicate start')
const recoveredStart = { ...live, id: 'saved-interrupted-start', payload: { status: 'cancelled', recoveredAfterRestart: true, sourceSequence: 19, startedSequence: 19 } }
const recoveredResult = reconcileRuntimeCompaction([recoveredStart, canonical], { replay: true, status: 'completed', sourceSequence: 20, startedSequence: 19, firstKeptEntryId: 'kept-1', tokensBefore: 4000 })
assert.equal(recoveredResult.target?.id, canonical.id, 'successful canonical history wins over an inferred interruption from attachment recovery')
assert.deepEqual(recoveredResult.duplicateIds, [recoveredStart.id])
const laterResult = { replay: true, status: 'completed', sourceSequence: 99, completedAt: '2026-01-01T12:10:00Z', firstKeptEntryId: 'kept-1', tokensBefore: 4000 }
assert.equal(findReplayedCompaction([canonical], laterResult), null, 'equal result metrics at another occurrence must not consume canonical history')
assert.deepEqual(findSupersededRuntimeCompactionIds([{ ...live, payload: { ...live.payload, ...laterResult } }], [canonical]), [], 'canonical cleanup preserves a distinct known completion time')
const oldTerminal = { replay: true, status: 'completed', sourceSequence: 20 }
assert.equal(reconcileRuntimeCompaction([recoveredStart], oldTerminal, 'new-end-id', live.turnId).target?.id, recoveredStart.id, 'end-only legacy replay recovers its unique saved start within the durable turn')
assert.equal(reconcileRuntimeCompaction([recoveredStart], oldTerminal, 'new-end-id', 'another-turn').target, null, 'end-only fallback never crosses turns')
assert.equal(reconcileRuntimeCompaction([recoveredStart, { ...recoveredStart, id: 'ambiguous-start' }], oldTerminal, 'new-end-id', live.turnId).target, null, 'ambiguous legacy starts are never guessed')
assert.equal(reconcileRuntimeCompaction([recoveredStart], { ...oldTerminal, startedSequence: 99 }, 'new-end-id', live.turnId).target, null, 'explicit start identity cannot fall back to another attempt')
assert.equal(reconcileRuntimeCompaction([{ ...recoveredStart, payload: { ...recoveredStart.payload, status: 'completed' } }], oldTerminal, 'new-end-id', live.turnId).target, null, 'legacy matching does not reuse an already completed attempt')
const timedLegacy = { ...live, id: 'timed-legacy', payload: { ...live.payload, sourceSequence: undefined, startedSequence: undefined, completedAt: '2026-01-01T12:00:00Z' } }
assert.equal(findReplayedCompaction([timedLegacy], laterResult), null, 'legacy runtime result matching preserves distinct known completion times')
assert.equal(findReplayedCompaction([timedLegacy], { ...laterResult, completedAt: '2026-01-01T12:00:00.000Z' })?.id, timedLegacy.id, 'the same legacy completion still reconciles')
console.log('Compaction replay identity, legacy-copy cleanup and distinct operations: ok')
