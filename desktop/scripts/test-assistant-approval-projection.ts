import { encodeApprovalScope, decodeApprovalScope } from '../src/main/assistant/approval-persistence'
import assert from 'node:assert/strict'
import { applyAssistantDomainEvent } from '../src/shared/assistant/projector'
import { createAssistantLongHistoryFixture } from './fixtures/assistant-long-history-fixture'
import { countRunningCommandActivities, shouldRenderActivity } from '../src/renderer/src/pages/assistant/assistant-timeline-helpers'
import type { AssistantDomainEvent, AssistantPendingApproval } from '../src/shared/assistant/contracts'
let snapshot = createAssistantLongHistoryFixture(1)
const thread = () => snapshot.sessions[0]!.threads[0]!
thread().state = 'running'
thread().latestTurn = { id: 'turn', state: 'running', requestedAt: new Date().toISOString(), assistantMessageId: null, startedAt: new Date().toISOString(), completedAt: null }
thread().activities = [{ id: 'zyra-tool-call', kind: 'command', tone: 'tool', summary: 'Running command', createdAt: new Date().toISOString(), turnId: 'turn', payload: { status: 'running', toolCallId: 'call', command: 'echo fixture' } }]
let sequence = 1
const event = (type: AssistantDomainEvent['type'], payload: Record<string, unknown>) => {
    snapshot = applyAssistantDomainEvent(snapshot, { id: `event-${sequence}`, sequence: sequence++, type, occurredAt: new Date().toISOString(), sessionId: snapshot.sessions[0]!.id, threadId: thread().id, payload: { threadId: thread().id, ...payload } } as AssistantDomainEvent)
}
const approval = { id: 'approval', requestId: 'request', toolCallId: 'call', requestType: 'command', status: 'pending', decision: null, turnId: 'turn', createdAt: new Date().toISOString(), resolvedAt: null } as AssistantPendingApproval
const original = snapshot
event('thread.approval.updated', { approval })
assert.equal(thread().state, 'waiting', 'approval changes running state to waiting')
assert.equal(shouldRenderActivity(thread().activities[0]!), false, 'blocked action is represented by approval panel, not a running tool card')
assert.equal(countRunningCommandActivities(thread().activities), 0, 'blocked commands are not counted as executing')
assert.equal(original.sessions[0]!.threads[0]!.state, 'running', 'projection preserves previous snapshot')
event('thread.updated', { patch: { state: 'running' } })
assert.equal(thread().state, 'waiting', 'late running status cannot override pending approval')
event('thread.activity.appended', { activity: { ...thread().activities[0], payload: { status: 'running', toolCallId: 'call' } } })
assert.equal(shouldRenderActivity(thread().activities[0]!), false, 'late tool start cannot override waiting')
event('thread.approval.updated', { approval: { ...approval, id: 'approval-2', requestId: 'request-2', toolCallId: 'call-2' } })
event('thread.approval.updated', { approval: { ...approval, status: 'resolved', decision: 'acceptOnce' } })
assert.equal(thread().state, 'waiting', 'a second pending approval keeps chat waiting')
assert.equal(shouldRenderActivity(thread().activities[0]!), true, 'approved action returns to timeline')
event('thread.approval.updated', { approval: { ...approval, id: 'approval-2', requestId: 'request-2', toolCallId: 'call-2', status: 'resolved', decision: 'decline' } })
assert.equal(thread().state, 'running', 'resolved approvals resume the active turn')
event('thread.approval.updated', { approval })
event('thread.approval.updated', { approval: { ...approval, status: 'resolved', decision: 'decline' } })
assert.equal(countRunningCommandActivities(thread().activities), 0, 'decline never flashes a running action while its blocked result arrives')
assert.equal(thread().activities[0]!.summary, 'Action declined')
event('thread.updated', { patch: { state: 'error' } })
event('thread.approval.updated', { approval })
assert.equal(thread().state, 'error', 'terminal errors are never changed to waiting')
console.log('Approval projection: waiting, correlation, late events, concurrent requests and terminal state: ok')

event('thread.updated', { patch: { pendingApprovals: [], state: 'waiting' } })
assert.equal(thread().state, 'waiting', 'runtime waiting for another reason is preserved')

assert.deepEqual(decodeApprovalScope(['README.md']).paths, ['README.md'], 'legacy approval rows retain file paths')
const scope = { paths: ['README.md'], toolCallId: 'call', grantLabel: 'Allow shell commands for this chat' }
assert.deepEqual(decodeApprovalScope(JSON.parse(JSON.stringify(encodeApprovalScope(scope)))), scope, 'hydration preserves action correlation and exact grant scope')
assert.deepEqual(decodeApprovalScope(null), { paths: undefined, toolCallId: undefined, grantLabel: undefined })
