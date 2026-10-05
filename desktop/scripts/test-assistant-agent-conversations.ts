import assert from 'node:assert/strict'
import type { AssistantSession, AssistantSnapshot, AssistantThread } from '../src/shared/assistant/contracts'
import { projectCanonicalAgentOrigin } from '../src/main/assistant/service-canonical-agent-origin'
import { getVisibleAssistantSessions, getAssistantSessionsByMode, getSelectedAssistantSession, isAssistantUserFacingSession } from '../src/renderer/src/lib/assistant/selectors'

assert.equal(projectCanonicalAgentOrigin({}), undefined, 'Ordinary user-created chats retain their source')
assert.deepEqual(projectCanonicalAgentOrigin({ agentCreatedBy: 'parent', agentLabel: 'Review' }), {
    source: 'subagent', providerParentThreadId: 'parent', agentNickname: 'Review'
}, 'Unclassified legacy supporting work is not promoted')
const origin = projectCanonicalAgentOrigin({ agentCreatedBy: 'parent', agentLabel: 'Independent work', agentConversationKind: 'thread' })!
assert.equal(origin.source, 'root', 'Explicit independent conversations survive import as user-facing roots')
assert.equal(origin.providerParentThreadId, 'parent', 'Classification never erases creator ownership')
const thread = (id: string, source: AssistantThread['source']) => ({ id, source } as AssistantThread)
const session = (id: string, sources: AssistantThread['source'][], archived = false) => ({ id, mode: 'chat', archived, threads: sources.map((source, i) => thread(id + i, source)) } as AssistantSession)
const snapshot = { sessions: [session('root-with-worker', ['root', 'subagent']), session('private', ['subagent']), session('independent', [origin.source]), session('archived-private', ['subagent'], true), session('archived-root', ['root'], true)], selectedSessionId: 'private' } as AssistantSnapshot
assert.deepEqual(getVisibleAssistantSessions(snapshot).map(session => session.id), ['root-with-worker', 'independent'])
assert.deepEqual(getAssistantSessionsByMode(snapshot, 'chat', true).map(session => session.id), ['root-with-worker', 'independent', 'archived-root'])
assert.equal(getSelectedAssistantSession(snapshot)?.id, 'private', 'Existing selected/private histories remain addressable')
assert.equal(isAssistantUserFacingSession(session('draft', [])), true, 'Empty user drafts are not mistaken for workers')
console.log('Canonical origin and sidebar selectors: independent roots, nested workers, legacy artifacts and history access passed')
