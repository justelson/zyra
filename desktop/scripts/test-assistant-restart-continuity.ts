import assert from 'node:assert/strict'
import { recoverPersistedSnapshot } from '../src/main/assistant/projector'
import { mergeCanonicalPresenceLatestTurn, resolveCanonicalPresenceThreadState } from '../src/main/assistant/service-canonical-presence'
import type { AssistantLatestTurn, AssistantSnapshot, AssistantThread } from '../src/shared/assistant/contracts'
import type { CanonicalAgentChatPresence } from '../src/main/assistant/zyra-agent-server-worker'
import { handleAssistantRuntimeEvent } from '../src/main/assistant/service-runtime-events'
import { applyAssistantDomainEvent } from '../src/shared/assistant/projector'

const startedAt = '2026-10-01T10:00:00.000Z'
const endedAt = '2026-10-01T10:05:00.000Z'
const turn: AssistantLatestTurn = { id: 'surviving-turn', state: 'running', requestedAt: startedAt, startedAt, completedAt: null, assistantMessageId: null }
const running: CanonicalAgentChatPresence = { state: 'running', activeTurnId: turn.id, latestTurn: turn, clients: [], backgroundWorkActive: false, latestSequence: 12 }
function restore(state: AssistantLatestTurn['state'] = 'running', canonical = true, cachedPresence: CanonicalAgentChatPresence | undefined = running) {
    const snapshot = { sessions: [{ id: 'chat', title: 'Restart fixture', threadIds: ['thread'], activeThreadId: 'thread', threads: [{
        id: 'thread', providerThreadId: canonical ? 'canonical-chat' : null, state: state === 'completed' ? 'ready' : state,
        latestTurn: { ...turn, state, completedAt: state === 'running' ? null : endedAt },
        canonicalPresence: cachedPresence, messages: [], pendingApprovals: [], pendingUserInputs: []
    }] }] } as unknown as AssistantSnapshot
    return recoverPersistedSnapshot(snapshot).sessions[0]!.threads[0]!
}
function observe(thread: AssistantThread, presence: CanonicalAgentChatPresence) {
    return {
        ...thread,
        state: resolveCanonicalPresenceThreadState({ currentState: thread.state, localThread: thread, presence }),
        latestTurn: mergeCanonicalPresenceLatestTurn(thread.latestTurn, presence)
    }
}

const restored = restore()
assert.equal(restored.latestTurn?.state, 'running', 'closing Desktop must not invent a terminal outcome for server-owned work')
assert.equal(restored.state, 'running', 'the restored composer cannot appear idle while canonical observation is pending')
const live = observe(restored, running)
assert.equal(live.latestTurn?.state, 'running')
assert.equal(live.latestTurn?.completedAt, null)
assert.equal(live.state, 'running', 'live work remains queueable/stoppable after reopening')

const completed = observe(restore(), { ...running, state: 'ready', activeTurnId: null, latestTurn: { ...turn, state: 'completed', completedAt: endedAt } })
assert.equal(completed.latestTurn?.state, 'completed', 'completion while Desktop was closed wins on reconnect')
assert.equal(completed.state, 'ready')
const detached = observe(restore(), { ...running, state: 'detached', activeTurnId: null, latestTurn: null })
assert.equal(detached.latestTurn?.state, 'interrupted', 'a confirmed missing server turn must not stay busy forever')
assert.notEqual(detached.state, 'running')
assert.equal(restore('running', false).latestTurn?.state, 'interrupted', 'unattached process-owned submissions still settle on restart')

// Older builds already saved a synthetic interruption alongside running presence.
const legacy = observe(restore('interrupted'), running)
assert.equal(legacy.latestTurn?.state, 'running', 'fresh canonical observation repairs the old false-interruption state')
assert.equal(legacy.latestTurn?.completedAt, null)
assert.equal(legacy.state, 'running')
for (const state of ['completed', 'error'] as const) {
    assert.equal(observe(restore(state), running).latestTurn?.state, state, 'known terminal outcomes remain immutable')
}
const stoppedPresence = { ...running, state: 'ready' as const, activeTurnId: null, latestTurn: { ...turn, state: 'interrupted' as const, completedAt: endedAt } }
assert.equal(observe(restore('interrupted', true, stoppedPresence), running).latestTurn?.state, 'interrupted', 'a real saved Stop must not be revived by an older running observation')
assert.equal(observe(restore('interrupted'), stoppedPresence).latestTurn?.state, 'interrupted', 'canonical Stop confirms an ambiguous legacy interruption')
assert.equal(observe(live, { ...running, state: 'detached', activeTurnId: null, latestTurn: null }).latestTurn?.state, 'running', 'ordinary catalog detachment cannot settle a new local submission')
// The terminal runtime event can beat the catalog response during reconnect.
for (const outcome of ['completed', 'failed', 'interrupted'] as const) {
    const recoveredThread = { ...restore(), model: 'fixture-model', activities: [], messages: [], proposedPlans: [] }
    let snapshot = { sessions: [{ id: 'chat', activeThreadId: recoveredThread.id, threads: [recoveredThread] }] } as unknown as AssistantSnapshot
    let sequence = 0
    const currentThread = () => snapshot.sessions[0]!.threads[0]!
    handleAssistantRuntimeEvent({
        eventId: `recovered-${outcome}`, type: 'turn.completed', threadId: recoveredThread.id,
        turnId: turn.id, createdAt: endedAt, payload: { outcome }
    }, {
        planBuffers: new Map(), assistantTextBuffers: new Map(), isAssistantTextSuppressed: () => false,
        findSessionByThreadId: () => snapshot.sessions[0]!, requireThread: currentThread,
        findThreadRecord: () => ({ session: snapshot.sessions[0]!, thread: currentThread() }),
        appendEvent: (type, occurredAt, payload, sessionId, threadId) => {
            snapshot = applyAssistantDomainEvent(snapshot, { eventId: `terminal-${++sequence}`, sequence, type, occurredAt, payload, sessionId, threadId } as any)
        },
        queueAssistantTextDelta: () => {}, flushAssistantTextDelta: () => {},
        queueAssistantActivityDelta: () => {}, flushAssistantActivityDelta: () => {},
        updateLatestTurnAssistantMessage: () => {}, projectFleet: () => false
    })
    const terminal = currentThread().latestTurn!
    assert.equal(terminal.runtimeRecoveryPending, undefined, 'an authoritative runtime outcome clears pending recovery')
    const afterDetached = observe(currentThread(), { ...running, state: 'detached', activeTurnId: null, latestTurn: null })
    assert.equal(afterDetached.latestTurn?.state, outcome === 'failed' ? 'error' : outcome, 'late detached presence cannot replace a real outcome')
    assert.equal(afterDetached.latestTurn?.completedAt, endedAt)
}
console.log('PASS Desktop restart continuity and canonical reconciliation')
