import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import type { AssistantRuntimeEvent, AssistantSnapshot, AssistantSession, AssistantThread } from '../src/shared/assistant/contracts'
import { applyAssistantDomainEvent } from '../src/shared/assistant/projector'
const noop = () => undefined
mock.module('electron-log', () => ({ default: { info: noop, warn: noop, error: noop, debug: noop } }))
mock.module('../src/main/agent-control', () => ({ getAgentControlBroker: () => ({ revokePrincipal: noop }) }))
mock.module('electron', () => ({ app: { getPath: () => process.env.TEMP || process.cwd(), isReady: () => true, on: noop, once: noop },
    BrowserWindow: class { static getAllWindows() { return [] } }, screen: { getAllDisplays: () => [] },
    nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) }, webContents: { fromId: () => null }, safeStorage: { isEncryptionAvailable: () => false } }))
const { ZyraRuntime } = await import('../src/main/assistant/zyra-runtime')
const { handleAssistantRuntimeEvent } = await import('../src/main/assistant/service-runtime-events')
const at = '2026-10-06T10:00:00.000Z'
const thread = { id: 'phase-thread', providerThreadId: 'phase-canonical', messages: [], activities: [], pendingApprovals: [], pendingUserInputs: [],
    state: 'running', latestTurn: { id: 'phase-turn', state: 'running', requestedAt: at, startedAt: at, completedAt: null, assistantMessageId: null } } as unknown as AssistantThread
const session = { id: 'phase-session', title: 'Phase repair', threads: [thread], threadIds: [thread.id], activeThreadId: thread.id } as unknown as AssistantSession
let snapshot = { sessions: [session], selectedSessionId: session.id, snapshotSequence: 0, updatedAt: at, knownModels: [], fleetByThreadId: {}, playground: { rootPath: null, labs: [] } } as AssistantSnapshot
let sequence = 0
const record = () => ({ session: snapshot.sessions[0]!, thread: snapshot.sessions[0]!.threads[0]! })
const deps = {
    planBuffers: new Map(), flushAssistantActivityDelta: noop, queueAssistantActivityDelta: noop, projectFleet: () => true,
    findThreadRecord: record, findSessionByThreadId: () => record().session, requireThread: () => record().thread,
    assistantTextBuffers: new Map(), isAssistantTextSuppressed: () => false, flushAssistantTextDelta: noop,
    updateLatestTurnAssistantMessage: noop,
    appendEvent: (type: any, occurredAt: string, payload: Record<string, unknown>) => {
        snapshot = applyAssistantDomainEvent(snapshot, { eventId: `phase-event-${++sequence}`, sequence, type, occurredAt, payload, sessionId: session.id, threadId: thread.id })
    },
    queueAssistantTextDelta: (delta: any) => deps.appendEvent('thread.message.assistant.delta', delta.occurredAt, delta)
}
const runtime = new ZyraRuntime()
const context = { localThreadId: thread.id, providerThreadId: thread.providerThreadId, activeTurnId: 'phase-turn', activeAssistantItemId: null,
    assistantMessageSequence: 0, completedTurnIds: new Set(), internalTextByItemId: new Map(), assistantTextByItemId: new Map(),
    assistantCompletedItemIds: new Set(), sessionUsage: null, lastUsage: null, lastUsageTurnId: null }
const runtimeEvents: AssistantRuntimeEvent[] = []
runtime.on('runtime', event => { runtimeEvents.push(event); handleAssistantRuntimeEvent(event, deps as never) })


const send = (event: Record<string, unknown>) => (runtime as any).handleZyraEvent(context, event, { turnId: 'phase-turn' })
send({ type: 'message_end', message: { id: 'failed-attempt', role: 'assistant', stopReason: 'error', errorMessage: 'An unexpected model response failed.', content: [] } })
send({ type: 'agent_end', willRetry: true, outcome: 'failed' })
assert.equal(runtimeEvents.some(e => e.type === 'turn.completed'), false, 'retryable agent_end must not finish/collapse the work')
send({ type: 'auto_retry_start', attempt: 1, maxAttempts: 3, recoveryKind: 'provider', errorMessage: 'An unexpected model response failed.' })
const issue = runtimeEvents.find(e => e.type === 'activity' && e.payload.summary === 'Errored out')
assert.ok(issue, 'the failed attempt stays visible as an error row before retry progress')
assert.equal(issue.payload.tone, 'error')
send({ type: 'auto_retry_start', attempt: 1, maxAttempts: 3, recoveryKind: 'provider', errorMessage: 'An unexpected model response failed.' })
send({ type: 'auto_retry_start', attempt: 2, maxAttempts: 3, recoveryKind: 'provider', errorMessage: '503 temporarily unavailable' })
assert.equal(record().thread.activities.filter(a => a.payload?.category === 'retry-error').length, 1, 'replay and further attempts update one failure row')
assert.equal(record().thread.activities.filter(a => a.payload?.category === 'connection-recovery').length, 1, 'retry progress updates in place')

assert.equal(record().thread.latestTurn?.state, 'running')
assert.ok(runtimeEvents.some(e => e.type === 'activity' && e.payload.summary === 'Retrying 1 of 3'))
assert.ok(runtimeEvents.some(e => e.type === 'activity' && e.payload.summary === 'Retrying 2 of 3'))
send({ type: 'message_end', message: { id: 'resumed', role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Resumed successfully.' }] } })
send({ type: 'auto_retry_end', success: true, attempt: 1 })
send({ type: 'agent_end', willRetry: false })
assert.equal(runtimeEvents.filter(e => e.type === 'turn.completed').length, 1)
assert.equal(record().thread.latestTurn?.state, 'completed')
assert.equal(runtimeEvents.find(e => e.type === 'turn.completed')?.turnId, 'phase-turn')
assert.ok(runtimeEvents.some(e => e.type === 'activity' && e.payload.summary === 'Retry succeeded'))
assert.equal(record().thread.lastError, null)
console.log('Desktop mid-turn recovery: error + retry rows, no premature turn completion, same-turn success and cleared failure passed')
