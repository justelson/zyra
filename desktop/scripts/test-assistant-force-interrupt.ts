import assert from 'node:assert/strict'
import { mock } from 'bun:test'

const noop = () => undefined
mock.module('electron-log', () => ({ default: { info: noop, warn: noop, error: noop, debug: noop } }))
mock.module('../src/main/agent-control', () => ({ getAgentControlBroker: () => ({ revokePrincipal: noop }) }))
mock.module('electron', () => ({
    app: { getPath: () => process.env.TEMP || process.cwd(), isReady: () => true, on: noop, once: noop },
    BrowserWindow: class { static getAllWindows() { return [] } static fromWebContents() { return null } },
    screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }) },
    nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) }, webContents: { fromId: () => null },
    safeStorage: { isEncryptionAvailable: () => false }, shell: { openExternal: noop, openPath: async () => '' },
    globalShortcut: { register: () => true, unregisterAll: noop }
}))
const { interruptAssistantTurnAction } = await import('../src/main/assistant/service-session-actions')
const { ZyraRuntime } = await import('../src/main/assistant/zyra-runtime')
const thread = { id: 'local-thread', providerThreadId: 'zyra_remote', latestTurn: { id: 'turn-1' } }
const session = { id: 'session', activeThreadId: thread.id, threads: [thread] }
let attached = false
const order: string[] = []
const deps = {
    ensureReady: async () => undefined,
    getSnapshot: () => ({ sessions: [session], selectedSessionId: session.id }),
    connectSessionRuntime: async () => { order.push('attach'); attached = true },
    runtime: {
        hasSession: () => attached,
        interruptTurn: async (id: string, turnId?: string) => {
            assert.ok(attached, 'reattach the canonical chat before interrupting a missing desktop session')
            assert.equal(id, thread.providerThreadId)
            assert.equal(turnId, 'turn-1')
            order.push('abort')
        }
    }
}
await interruptAssistantTurnAction(deps as never, 'turn-1', session.id)
assert.deepEqual(order, ['attach', 'abort'])
await interruptAssistantTurnAction(deps as never, 'turn-1', session.id)
assert.deepEqual(order, ['attach', 'abort', 'abort'], 'existing attachment is reused')
attached = false
deps.connectSessionRuntime = async () => { throw new Error('Disconnected from server') }
await assert.rejects(interruptAssistantTurnAction(deps as never, 'turn-1', session.id), /Disconnected/)
assert.equal(order.length, 3, 'failed reattachment must not dispatch an abort')

const runtime = new ZyraRuntime()
const internals = runtime as any
const events: any[] = []
runtime.on('runtime', event => events.push(event))
const context = { localThreadId: 'local-thread', providerThreadId: 'zyra_remote', activeTurnId: 'turn-1', completedTurnIds: new Set() }
internals.sessions.set(thread.providerThreadId, context)
let connected = false
internals.ensureConnected = async () => { connected = true }
let failAbort = true
let advanceTurn = false
Object.assign(context, { worker: { request: async (type: string, payload: unknown) => {
    assert.deepEqual(payload, { turnId: 'turn-1' }, 'Stop is bound to its actual active turn')
    assert.ok(connected, 'interrupt waits for the attachment handshake')
    assert.equal(type, 'abort')
    if (failAbort) throw new Error('Abort connection failed')
    if (advanceTurn) context.activeTurnId = 'turn-2'
    return {}
} } })
await assert.rejects(runtime.interruptTurn(thread.providerThreadId, 'turn-1'), /Abort connection failed/)
assert.equal(context.activeTurnId, 'turn-1', 'failed abort must not pretend the turn stopped')
assert.equal(events.length, 0)
failAbort = false
advanceTurn = true
await runtime.interruptTurn(thread.providerThreadId, 'turn-1')
assert.equal(context.activeTurnId, 'turn-2', 'late abort completion must not mark a newer turn interrupted')
assert.equal(events.length, 0)
advanceTurn = false
context.activeTurnId = 'turn-1'
await runtime.interruptTurn(thread.providerThreadId, 'turn-1')
assert.equal(context.activeTurnId, null)
assert.equal(events[0].turnId, 'turn-1')
assert.deepEqual(events[0].payload.interruption, { kind: 'stopped', source: 'user' })
console.log('Force interrupt runtime: reattachment, connection failure and turn ownership passed')
