import assert from 'node:assert/strict'
import { applyAssistantThreadDetail } from '../src/renderer/src/lib/assistant/assistant-history-state'
const messages = [1, 2, 3].map(n => ({id: `message-${n}`, role: 'user', text: `turn ${n}`, createdAt: `2026-01-01T00:00:0${n}.000Z`, turnId: `turn-${n}`}))
const thread = {id: 'thread', messages, activities: [], proposedPlans: [], updatedAt: 'revision', messageCount: 3}
const snapshot = {sessions: [{id: 'chat', threads: [thread]}]}
const detail = {threadId: 'thread', activePlan: null, pendingApprovals: [], pendingUserInputs: [], history: {
    threadId: 'thread', messages: [messages[2]], activities: [], proposedPlans: [],
    pageInfo: {oldestCursor: 'server-cursor', newestCursor: null, hasOlder: true, hasNewer: false, turnCount: 1},
    initialLoading: false, loadingOlder: false, loadingNewer: false, loadOlderError: null, loadNewerError: null, fullyLoaded: false
}}
const applied = applyAssistantThreadDetail(snapshot as any, detail as any, undefined, thread as any)
assert.deepEqual(applied.history.messages.map(m => m.id), messages.map(m => m.id), 'a one-turn bootstrap must not retract a validated multi-turn preview')
assert.equal(applied.history.pageInfo.oldestCursor, 'server-cursor', 'keep the authoritative cursor so bounded previews cannot skip uncached records')
const authoritative = applyAssistantThreadDetail(snapshot as any, {...detail, history: {...detail.history, pageInfo: {...detail.history.pageInfo, hasOlder: false}, fullyLoaded: true}} as any, undefined, thread as any)
assert.equal(authoritative.history.messages.length, 1, 'a complete authoritative history must still remove deleted rows')
const cold = applyAssistantThreadDetail(snapshot as any, detail as any)
assert.equal(cold.history.messages.length, 1, 'unvalidated snapshot rows cannot be reused')
console.log('assistant preview hydration regression passed')
