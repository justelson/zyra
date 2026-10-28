import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { QueuedPromptDeliveryOwner } from '../src/main/assistant/queued-prompt-delivery'
import { mock } from 'bun:test'
const noop = () => undefined
mock.module('electron-log', () => ({ default: { info: noop, warn: noop, error: noop, debug: noop } }))
mock.module('../src/main/agent-control', () => ({ getAgentControlBroker: () => ({ revokePrincipal: noop, authorizeUserWindowsTurn: noop, materializeUserAuthorizedBrowserGrant: noop }) }))
mock.module('electron', () => ({
    app: { getPath: () => process.env.TEMP || process.cwd(), isReady: () => true, on: noop, once: noop },
    BrowserWindow: class { static getAllWindows() { return [] } static fromWebContents() { return null } },
    screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }) },
    nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) }, webContents: { fromId: () => null },
    safeStorage: { isEncryptionAvailable: () => false }, shell: { openExternal: noop, openPath: async () => '' },
    globalShortcut: { register: () => true, unregisterAll: noop }
}))
const { sendAssistantPromptAction, interruptAssistantTurnAction, cancelPendingAssistantSubmissions, countPendingAssistantSubmissions } = await import('../src/main/assistant/service-session-actions')
const { ZyraRuntime } = await import('../src/main/assistant/zyra-runtime')
const runtime = new ZyraRuntime()
const events: unknown[] = []
runtime.on('runtime', event => events.push(event))
const calls: unknown[] = []
let canonical: string | null = 'turn-1'
const context = { localThreadId: 'local', providerThreadId: 'zyra_remote', activeTurnId: 'turn-1', model: 'original', thinking: 'high',
    worker: { readPresence: async () => ({ activeTurnId: canonical }), request: async (type: string, payload: unknown) => { calls.push({ type, payload }); return {} } } }
;(runtime as any).sessions.set('zyra_remote', context)
;(runtime as any).ensureConnected = async () => undefined
assert.deepEqual(await runtime.steerPrompt('zyra_remote', 'Use the other test', { targetTurnId: 'turn-1' }), { turnId: 'turn-1' })
assert.deepEqual(calls, [{ type: 'steer', payload: { prompt: 'Use the other test', images: undefined, targetTurnId: 'turn-1' } }])
assert.equal(context.activeTurnId, 'turn-1')
assert.equal(context.model, 'original')
assert.equal(context.thinking, 'high')
assert.equal(events.length, 0, 'Steer does not manufacture a new turn or terminal event')
canonical = 'turn-2'
await assert.rejects(runtime.steerPrompt('zyra_remote', 'late correction', { targetTurnId: 'turn-1' }), /changed/)
assert.equal(calls.length, 1, 'stale steer cannot reach a newer turn')
canonical = null
await assert.rejects(runtime.steerPrompt('zyra_remote', 'idle correction', { targetTurnId: 'turn-1' }), /changed/)
const thread = { id: 'local', providerThreadId: 'zyra_remote', model: 'original', latestTurn: { id: 'turn-1', state: 'running' } }
const session = { id: 'session', activeThreadId: 'local', threads: [thread] }
const projected: any[] = []
let reject = false
const deps = { ensureReady: async () => undefined, getSnapshot: () => ({ selectedSessionId: 'session', sessions: [session] }),
    runtime: { steerPrompt: async (_id: string, _prompt: string, options: any) => { assert.equal(options.targetTurnId, 'turn-1'); if (reject) throw Error('Unsupported steer'); return { turnId: 'turn-1' } },
        ensurePromptAvailable: async () => { throw Error('Steer must not run the new-turn busy rejection') } },
    appendEvent: (...args: any[]) => projected.push(args) }
await sendAssistantPromptAction(deps as never, 'Keep the existing interface', { dispatchMode: 'steer', model: 'must-not-switch', effort: 'low' }, [])
assert.equal(projected.length, 1)
assert.equal(projected[0][0], 'thread.message.user')
assert.equal(projected[0][2].message.turnId, 'turn-1')
reject = true
await assert.rejects(sendAssistantPromptAction(deps as never, 'Unsupported correction', { dispatchMode: 'steer' }, []), /Unsupported/)
assert.equal(projected.length, 1, 'Rejected steering does not leave an unsent optimistic user message')
const receipts = await mkdtemp(join(tmpdir(), 'zyra-steer-deliveries-'))
try {
    let deliveries = 0
    let release!: () => void
    const blocked = new Promise<void>(resolve => { release = resolve })
    const queueDeps = { ...deps, queuedPromptDeliveries: new QueuedPromptDeliveryOwner(receipts), runtime: { ...deps.runtime,
        steerPrompt: async (_id: string, _prompt: string, input: any) => { input.beforeSubmit?.(); deliveries++; await blocked; return { turnId: input.targetTurnId } } } }
    const shared = { sessionId: 'session', queueEntryId: 'shared-live-entry', dispatchMode: 'steer' as const, targetTurnId: 'turn-1' }
    const before = projected.length
    const first = sendAssistantPromptAction(queueDeps as never, 'Shared correction', shared, [])
    const second = sendAssistantPromptAction(queueDeps as never, 'Shared correction', shared, [])
    for (let i = 0; deliveries === 0 && i < 400; i++) await new Promise(resolve => setTimeout(resolve, 5))
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(deliveries, 1, 'two renderers sharing one queue entry must deliver one Steer')
    assert.ok(countPendingAssistantSubmissions(queueDeps as never) > 0, 'in-flight queue claims participate in update inspection')
    release()
    assert.deepEqual(await first, await second)
    assert.equal(projected.length - before, 1, 'joined delivery projects one user message')
    thread.latestTurn.state = 'completed'
    const restored = { ...queueDeps, queuedPromptDeliveries: new QueuedPromptDeliveryOwner(receipts) }
    const replay = await sendAssistantPromptAction(restored as never, 'Shared correction', { ...shared, dispatchMode: 'immediate', targetTurnId: undefined }, [])
    assert.equal(replay.turnId, 'turn-1', 'accepted receipt wins over later turn state or routing changes')
    assert.equal(deliveries, 1)
    await assert.rejects(sendAssistantPromptAction(restored as never, 'Changed correction', shared, []), /conflicting payload/)
    await assert.rejects(sendAssistantPromptAction(restored as never, 'After the turn', { ...shared, queueEntryId: 'retry-after-rejection' }, []), /turn has ended/)
    thread.latestTurn.state = 'running'
    await sendAssistantPromptAction(restored as never, 'After the turn', { ...shared, queueEntryId: 'retry-after-rejection' }, [])
    assert.equal(deliveries, 2, 'a known rejection before runtime submission permits retry')
    let releaseReady!: () => void
    let preparing = false
    const waiting = { ...restored, ensureReady: async () => { preparing = true; await new Promise<void>(resolve => { releaseReady = resolve }) } }
    const cancelled = sendAssistantPromptAction(waiting as never, 'Stop preparation', { ...shared, queueEntryId: 'cancel-before-submission' }, [])
    const stopped = assert.rejects(cancelled, /cancelled before dispatch/)
    for (let i = 0; !preparing && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 5))
    assert.ok(preparing)
    cancelPendingAssistantSubmissions(waiting as never)
    releaseReady()
    await stopped
    assert.equal(deliveries, 2, 'Stop prevents a late queued dispatch')
    assert.equal(countPendingAssistantSubmissions(waiting as never), 0)
    for (const stale of [true, false]) {
        let readyCalls = 0, entered = false
        let releaseSend!: () => void
        const stopDeps = { ...restored, getSessionRuntimeCwd: () => '.',
            ensureReady: async () => { if (++readyCalls === 1) { entered = true; await new Promise<void>(resolve => { releaseSend = resolve }) } },
            runtime: { ...restored.runtime, hasSession: () => true,
                getCanonicalChat: async () => ({ presence: { activeTurnId: 'turn-1' } }), interruptTurn: async () => {} } }
        const pending = sendAssistantPromptAction(stopDeps as never, `Scoped Stop ${stale}`, { ...shared, queueEntryId: `stop-${stale}` }, [])
        const outcome = stale ? pending : assert.rejects(pending, /cancelled before dispatch/)
        for (let i = 0; !entered && i < 400; i++) await new Promise(resolve => setTimeout(resolve, 5))
        assert.ok(entered)
        await interruptAssistantTurnAction(stopDeps as never, stale ? 'obsolete-turn' : 'turn-1', 'session')
        releaseSend()
        await outcome
        assert.equal(deliveries, 3, stale ? 'an old Stop cannot cancel the new queue claim' : 'current Stop cancels receipt preparation before runtime dispatch')
    }
    const realDeps = { ...deps, queuedPromptDeliveries: new QueuedPromptDeliveryOwner(receipts), runtime }
    const beforePresenceRace = calls.length
    canonical = null
    await assert.rejects(sendAssistantPromptAction(realDeps as never, 'Retry after presence rejection', { ...shared, queueEntryId: 'runtime-presence-race' }, []), /active turn changed/)
    assert.equal(calls.length, beforePresenceRace, 'canonical pre-submission rejection made no worker request')
    canonical = 'turn-1'
    context.worker.request = async (type: string, payload: unknown, guard?: { beforeDispatch?: () => void }) => {
        guard?.beforeDispatch?.(); calls.push({ type, payload }); return {}
    }
    await sendAssistantPromptAction(realDeps as never, 'Retry after presence rejection', { ...shared, queueEntryId: 'runtime-presence-race' }, [])
    assert.equal(calls.length, beforePresenceRace + 1, 'the same entry can retry after a definitive runtime preflight rejection')

    // New turns are accepted by the runtime before their asynchronous prompt run.
    // Their receipt marker belongs after the final busy guard, not before it.
    const admitted: any = context
    for (const name of ['completedTurnIds', 'assistantCompletedItemIds', 'internalCompletedItemIds']) admitted[name] = new Set()
    for (const name of ['toolArgsByCallId', 'toolStartedAtByCallId', 'commandActivityIdByJobId', 'assistantTextByItemId', 'internalTextByItemId']) admitted[name] = new Map()
    let runnerOptions: any
    ;(runtime as any).runPromptTurn = async (_context: unknown, _turn: string, _prompt: string, value: unknown) => { runnerOptions = value }
    admitted.activeTurnId = 'busy-turn'; canonical = 'busy-turn'
    const admissionInput = { sessionId: 'session', entryId: 'runtime-admission-race', payload: { prompt: 'New turn after busy rejection' } }
    const submit = (mark: () => void) => runtime.sendPrompt('zyra_remote', 'New turn after busy rejection', { turnId: 'admitted-once', beforeSubmit: mark })
        .then(value => ({ success: true as const, sessionId: 'session', threadId: 'local', turnId: value.turnId }))
    await assert.rejects(realDeps.queuedPromptDeliveries.run(admissionInput, submit), /already working/)
    admitted.activeTurnId = null; canonical = null
    assert.equal((await realDeps.queuedPromptDeliveries.run(admissionInput, submit)).turnId, 'admitted-once')
    assert.equal('beforeSubmit' in runnerOptions, false, 'the long-running prompt must not retain the receipt marker closure')
} finally { await rm(receipts, { recursive: true, force: true }) }
context.activeTurnId = 'still-working'
let asyncReceipt: any
context.worker.request = async (type: string, payload: any) => { asyncReceipt = { type, payload }; return { continuationPrompt: 'Which target?\\nDesktop' } }
const answered = await runtime.respondUserInput('zyra_remote', 'async-question', { choice: 'Desktop' }, [], { mode: 'async' })
assert.equal(answered.continuationPrompt, 'Which target?\\nDesktop')
assert.equal(context.activeTurnId, 'still-working', 'Answer-later resolution does not wait for or stop independent work')
assert.equal(asyncReceipt.payload.deferContinuation, true, 'Desktop-owned durable queue suppresses duplicate server-side answer dispatch')
assert.equal(asyncReceipt.type, 'user_input.respond')
console.log('Assistant steering: exact-turn delivery, no abort/new turn/config changes, rejection preservation and deferred async answer delivery passed')
