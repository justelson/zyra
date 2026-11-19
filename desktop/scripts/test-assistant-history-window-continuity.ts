import assert from 'node:assert/strict'
import { createAssistantLongHistoryFixture } from './fixtures/assistant-long-history-fixture'
import { applyAssistantThreadDetail, boundAssistantActiveHistoryWindow, type AssistantRetainedHistory } from '../src/renderer/src/lib/assistant/assistant-history-state'
import { getAssistantThreadHydrationRevision } from '../src/renderer/src/lib/assistant/assistant-thread-hydration-revision'

const snapshot = createAssistantLongHistoryFixture(8)
const thread = snapshot.sessions[0]!.threads[0]!
const history: AssistantRetainedHistory = { threadId: thread.id, messages: thread.messages, activities: thread.activities, proposedPlans: [], initialLoading: false, loadingOlder: false, loadingNewer: false, loadOlderError: null, loadNewerError: null, fullyLoaded: true, pageInfo: { oldestCursor: null, newestCursor: null, hasOlder: false, hasNewer: false, turnCount: 8 }, lastUsedAt: Date.now(), shellRevision: getAssistantThreadHydrationRevision(thread) }
const older = { ...history, messages: thread.messages.slice(0, 8), activities: thread.activities.slice(0, 16), fullyLoaded: false, pageInfo: { ...history.pageInfo, newestCursor: 'middle', hasNewer: true } }
const latest = { ...history, messages: thread.messages.slice(-4), activities: thread.activities.slice(-8), fullyLoaded: false, pageInfo: { ...history.pageInfo, oldestCursor: 'latest-window', hasOlder: true } }
const applied = applyAssistantThreadDetail(snapshot, { threadId: thread.id, history: latest, activePlan: null, pendingApprovals: [], pendingUserInputs: [] }, older)
assert.deepEqual(applied.history.messages.map(message => message.id), older.messages.map(message => message.id), 'background latest bootstrap cannot replace a deliberately detached reading window')
assert.equal(applied.history.pageInfo.hasNewer, true, 'detached reading keeps its newer cursor until explicit Latest/send navigation')
assert.equal(applied.history.pageInfo.newestCursor, 'middle')
const expensive = { ...history, activities: history.activities.map((activity, index) => index === history.activities.length - 1 ? { ...activity, detail: 'x'.repeat(6_100_000) } : activity) }
const bounded = boundAssistantActiveHistoryWindow(expensive, 'newer')
assert.equal(bounded.messages.filter(message => message.role === 'user').length, 3, 'a large live Work result cannot evict every previous prompt/response')
assert.equal(bounded.pageInfo.hasOlder, true, 'trimmed context stays discoverable')
assert.equal(bounded.messages.at(-1)?.id, history.messages.at(-1)?.id, 'the latest response is retained')
console.log('History window continuity: detached background hydration and large-Work recent context passed')
