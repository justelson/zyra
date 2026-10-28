import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const directory = mkdtempSync(join(tmpdir(), 'zyra-model-ping-'))
const noop = () => undefined
mock.module('electron-log', () => ({ default: { info: noop, warn: noop, error: noop, debug: noop } }))
mock.module('../src/main/agent-control', () => ({ getAgentControlBroker: () => ({ revokePrincipal: noop, materializeUserAuthorizedBrowserGrant: noop }) }))
mock.module('electron', () => ({
    app: { getPath: () => directory, isReady: () => true, on: noop, once: noop },
    BrowserWindow: class { static getAllWindows() { return [] } static fromWebContents() { return null } },
    screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }) },
    nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) }, webContents: { fromId: () => null },
    safeStorage: { isEncryptionAvailable: () => false }, shell: { openExternal: noop, openPath: async () => '' },
    globalShortcut: { register: () => true, unregisterAll: noop }
}))
try {
    const { pingActiveModel } = await import('../../src/model-ping.mjs')
    const { readModelRequestProgress } = await import('../src/shared/assistant/model-progress')
    const { ZyraRuntime } = await import('../src/main/assistant/zyra-runtime')
    const { pingAssistantModelAction } = await import('../src/main/assistant/service-session-actions')
    const { handleAssistantRuntimeEvent } = await import('../src/main/assistant/service-runtime-events')
    const { toAssistantThreadShell } = await import('../src/main/assistant/persistence-snapshot')
    const { projectCanonicalTimeline } = await import('../src/main/assistant/service')
    const { isAssistantConnectionRecoveryActivity } = await import('../src/renderer/src/pages/assistant/assistant-timeline-helpers')
    const progress = { requestId: 'request-1', startedAt: Date.now() - 180_000, lastActivityAt: Date.now() - 130_000, phase: 'waiting' as const, canPing: true }
    let received: any
    const fakeAgent = { modelRequestProgress: progress, pingModel: (id: string, message: unknown) => { received = { id, message } } }
    assert.deepEqual(pingActiveModel({ session: { agent: fakeAgent } }, 'request-1'), { accepted: true, requestId: 'request-1' })
    assert.equal(received.message.role, 'custom')
    assert.equal(received.message.display, false)
    assert.match(received.message.content[0].text, /Do not repeat completed actions/)
    assert.throws(() => pingActiveModel({ session: { agent: fakeAgent, isCompacting: true } }, 'request-1'))
    assert.throws(() => pingActiveModel({ session: { agent: fakeAgent } }, 'stale'))
    fakeAgent.modelRequestProgress = { ...progress, lastActivityAt: Date.now() }
    assert.throws(() => pingActiveModel({ session: { agent: fakeAgent } }, 'request-1'), /activity again/)
    assert.equal(readModelRequestProgress({ ...progress, lastActivityAt: NaN }, 'turn-1'), null)
    assert.equal(readModelRequestProgress({ ...progress, phase: 'recovering' }, 'turn-1')?.canPing, false)
    const runtime = new ZyraRuntime()
    const events: any[] = [], calls: any[] = []
    runtime.on('runtime', event => events.push(event))
    let canonical: string | null = 'turn-1'
    const context = { localThreadId: 'local', providerThreadId: 'zyra_remote', activeTurnId: 'turn-1', model: 'original', thinking: 'high',
        completedTurnIds: new Set(), assistantMessageSequence: 0, activeAssistantItemId: null,
        toolArgsByCallId: new Map(), toolStartedAtByCallId: new Map(), assistantTextByItemId: new Map(), assistantCompletedItemIds: new Set(),
        internalTextByItemId: new Map(), internalCompletedItemIds: new Set(), lastAssistantItemId: null,
        worker: { readPresence: async () => ({ activeTurnId: canonical }), request: async (type: string, payload: unknown) => { calls.push({ type, payload }); return {} } } }
    ;(runtime as any).sessions.set('zyra_remote', context)
    ;(runtime as any).ensureConnected = async () => undefined
    await runtime.pingModel('zyra_remote', 'turn-1', 'request-1')
    assert.deepEqual(calls, [{ type: 'model_ping', payload: { requestId: 'request-1', targetTurnId: 'turn-1' } }])
    assert.equal(events.length, 0, 'transport does not manufacture user bubbles or turn boundaries')
    canonical = 'new-turn'
    await assert.rejects(runtime.pingModel('zyra_remote', 'turn-1', 'request-1'), /changed/)
    canonical = null
    await assert.rejects(runtime.pingModel('zyra_remote', 'turn-1', 'request-1'), /changed/)
    assert.equal(calls.length, 1)
    const thread: any = { id: 'local', providerThreadId: 'zyra_remote', latestTurn: { id: 'turn-1', state: 'running' }, pendingApprovals: [], pendingUserInputs: [], activities: [], messages: [] }
    const session: any = { id: 'session', activeThreadId: 'local', threads: [thread] }
    const projected: any[] = []
    const deps: any = { ensureReady: async () => {}, getSnapshot: () => ({ sessions: [session] }), runtime: { pingModel: async (...args: any[]) => { projected.push(args) } } }
    await pingAssistantModelAction(deps, { sessionId: 'session', turnId: 'turn-1', requestId: 'request-1' })
    assert.deepEqual(projected, [['zyra_remote', 'turn-1', 'request-1']])
    await assert.rejects(pingAssistantModelAction(deps, { sessionId: 'session', turnId: 'old', requestId: 'request-1' }), /changed/)
    await assert.rejects(pingAssistantModelAction(deps, { sessionId: 'missing', turnId: 'turn-1', requestId: 'request-1' }))
    const handle = (event: any, metadata: any = {}) => (runtime as any).handleZyraEvent(context, event, { turnId: 'turn-1', ...metadata })
    handle({ type: 'model_request_progress', progress })
    assert.equal(events.at(-1).type, 'model.progress')
    const progressEvent = events.at(-1)
    assert.equal(progressEvent.payload.progress.turnId, 'turn-1')
    const count = events.length
    handle({ type: 'model_request_progress', progress }, { replay: true })
    assert.equal(events.length, count, 'replayed progress never becomes liveness evidence')
    const projectionDeps: any = { findThreadRecord: () => ({ session, thread }), flushAssistantTextDelta: noop, flushAssistantActivityDelta: noop,
        appendEvent: (_type: any, _at: any, data: any) => {
            if (data.patch) Object.assign(thread, data.patch)
            if (data.activity) { thread.activities = [...thread.activities.filter((activity: any) => activity.id !== data.activity.id), data.activity] }
        } }
    handleAssistantRuntimeEvent(progressEvent, projectionDeps)
    assert.equal(thread.modelRequestProgress.requestId, 'request-1')
    assert.equal(toAssistantThreadShell(thread).modelRequestProgress?.requestId, 'request-1', 'progress crosses shell boundary')
    handleAssistantRuntimeEvent({ ...progressEvent, turnId: 'stale', payload: { progress: null } }, projectionDeps)
    assert.ok(thread.modelRequestProgress, 'stale null cannot clear current request')
    handleAssistantRuntimeEvent({ ...progressEvent, payload: { progress: null } }, projectionDeps)
    assert.equal(thread.modelRequestProgress, null)
    handle({ type: 'message_start', message: { role: 'assistant', timestamp: 42, content: [] } })
    handle({ type: 'message_discarded', reason: 'model_ping', requestId: 'request-1', message: { role: 'assistant', timestamp: 42, content: [] } })
    assert.equal(context.activeAssistantItemId, null)
    for (const status of ['accepted', 'resumed']) handle({ type: 'model_ping', requestId: 'request-1', status })
    const activities = events.filter(event => event.type === 'activity' && event.payload.kind === 'model.ping')
    assert.equal(activities.length, 2)
    assert.equal(activities[0].payload.activityId, activities[1].payload.activityId)
    assert.equal(activities[1].payload.data.status, 'completed')
    for (const event of activities) handleAssistantRuntimeEvent(event, projectionDeps)
    assert.equal(thread.activities.length, 1, 'accepted/resumed update one durable action')
    assert.equal(thread.activities[0].payload.status, 'completed')
    handleAssistantRuntimeEvent(activities[0], projectionDeps)
    assert.equal(thread.activities[0].payload.status, 'completed', 'late accepted replay cannot revive completed recovery')
    thread.activities = []
    handleAssistantRuntimeEvent(activities[0], projectionDeps)
    handleAssistantRuntimeEvent({ type: 'session.state.changed', threadId: 'local', turnId: 'turn-1', createdAt: new Date().toISOString(), payload: { state: 'ready' } } as any, projectionDeps)
    assert.equal(thread.activities[0].payload.status, 'cancelled', 'Stop/completion closes pending recovery rather than leaving a spinner')
    assert.equal(isAssistantConnectionRecoveryActivity({ kind: 'model.ping' } as any), true)
    assert.equal(events.some(event => ['turn.started', 'turn.completed', 'content.user'].includes(event.type)), false)
    const timeline = projectCanonicalTimeline([
        { type: 'message', id: 'user', timestamp: new Date().toISOString(), message: { role: 'user', content: 'Original task', timestamp: Date.now() } },
        { type: 'custom_message', id: 'ping', timestamp: new Date().toISOString(), customType: received.message.customType, display: false, content: received.message.content, details: received.message.details }
    ], 'zyra_remote', 'local', new Date().toISOString(), 0)
    assert.equal(timeline.messages.length, 1, 'hidden recovery is never a saved user bubble')
    assert.equal(timeline.activities.filter(activity => activity.kind === 'model.ping').length, 1)
    assert.equal(timeline.activities.find(activity => activity.kind === 'model.ping')?.id, activities[0].payload.activityId)
    console.log('Model Ping integration: hidden prompt, inactivity validation, exact-turn IPC/runtime/service, progress projection, discard and canonical action: ok')
} finally { rmSync(directory, { recursive: true, force: true }) }
