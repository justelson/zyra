import assert from 'node:assert/strict'
import { mock } from 'bun:test'

const noop = () => undefined
mock.module('electron-log', () => ({ default: { info: noop, warn: noop, error: noop, debug: noop } }))
mock.module('../src/main/agent-control', () => ({ getAgentControlBroker: () => ({ revokePrincipal: noop, authorizeUserWindowsTurn: noop }) }))
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
// Canonical observation repairs a stale runtime context without making Stop
// depend on the Desktop's saved terminal/busy state.
let canonicalTurnId: string | null = 'canonical-live'
let canonicalAbortCount = 0
Object.assign(context, { worker: {
    readPresence: async () => ({ activeTurnId: canonicalTurnId }),
    request: async (_type: string, payload: any) => {
        canonicalAbortCount++
        assert.equal(payload.turnId, 'canonical-live', 'abort stays pinned to its observation')
        return {}
    }
} })
context.activeTurnId = 'stale-desktop-turn'
await runtime.interruptTurn(thread.providerThreadId)
assert.equal(canonicalAbortCount, 1)
assert.equal(events.at(-1).turnId, 'canonical-live')
assert.equal(context.activeTurnId, null)
canonicalTurnId = 'newer-canonical-turn'
await runtime.interruptTurn(thread.providerThreadId, 'canonical-live')
assert.equal(canonicalAbortCount, 1, 'an explicit stale Stop cannot move to a newer canonical turn')
canonicalTurnId = null
await runtime.interruptTurn(thread.providerThreadId)
assert.equal(canonicalAbortCount, 1, 'an idle canonical turn cannot trigger an unbounded abort')
const terminalCount = events.length
Object.assign(context.worker, { readPresence: async () => { throw new Error('Canonical presence unavailable') } })
await assert.rejects(runtime.interruptTurn(thread.providerThreadId), /presence unavailable/)
assert.equal(events.length, terminalCount, 'failed observation never invents terminal events')
// Send acknowledges locally before slow preference/attachment setup finishes.
// Stop must cancel this submission, not treat canonical idle as success and let
// that delayed prompt start after the user already pressed Stop.
Object.assign(context, { activeTurnId: null, model: 'fixture/model', runtimeMode: 'full-access', profile: 'default',
    toolArgsByCallId: new Map(), toolStartedAtByCallId: new Map(), assistantTextByItemId: new Map(), assistantPhaseByItemId: new Map(),
    assistantCompletedItemIds: new Set(), internalTextByItemId: new Map(), internalCompletedItemIds: new Set(),
    usageAccountedAssistantMessageIds: new Set() })
let releaseMemory!: (enabled: boolean) => void
let promptDispatches = 0
internals.isMemoryEnabled = () => new Promise<boolean>(resolve => { releaseMemory = resolve })
Object.assign(context, { worker: {
    serverOwnedLifecycle: true, readPresence: async () => ({ activeTurnId: null }),
    request: async () => { promptDispatches++; return {} }
} })
await runtime.sendPrompt(thread.providerThreadId, 'Cancel while preferences are loading', { turnId: 'pending-before-dispatch' })
await runtime.interruptTurn(thread.providerThreadId, 'pending-before-dispatch')
releaseMemory(true)
await new Promise(resolve => setTimeout(resolve, 10))
assert.equal(promptDispatches, 0, 'Stop before dispatch prevents a later rogue prompt')
assert.equal(context.activeTurnId, null)
assert.equal(events.at(-1).turnId, 'pending-before-dispatch')
assert.equal(events.at(-1).payload.outcome, 'interrupted')

// The actual transport may also wait after request() is called. Its dispatch
// callback is the final synchronous cancellation seam before writing the pipe.
internals.isMemoryEnabled = async () => true
let releaseTransport!: () => void
let reachedTransport!: () => void
const transportReached = new Promise<void>(resolve => { reachedTransport = resolve })
const transportGate = new Promise<void>(resolve => { releaseTransport = resolve })
Object.assign(context, { worker: {
    serverOwnedLifecycle: true, readPresence: async () => ({ activeTurnId: null }),
    request: async (_type: string, _payload: any, options: any) => {
        reachedTransport(); await transportGate; options?.beforeDispatch?.(); promptDispatches++; return {}
    }
} })
await runtime.sendPrompt(thread.providerThreadId, 'Cancel while transport is attaching', { turnId: 'pending-transport' })
await transportReached
await runtime.interruptTurn(thread.providerThreadId, 'pending-transport')
releaseTransport(); await new Promise(resolve => setTimeout(resolve, 10))
assert.equal(promptDispatches, 0, 'a late transport attachment cannot dispatch a cancelled prompt')
// A written prompt can still be awaiting canonical admission. Stop waits for
// the exact acceptance instead of mistaking that momentary idle observation
// for proof that no work can start.
let admittedTurn: string | null = null
let finishSubmitted!: () => void
let written!: () => void
const writtenGate = new Promise<void>(resolve => { written = resolve })
let acceptedAbortCount = 0
Object.assign(context, { worker: {
    serverOwnedLifecycle: true, readPresence: async () => ({ activeTurnId: admittedTurn }),
    request: async (type: string, payload: any, options?: any) => {
        if (type === 'prompt') {
            options?.beforeDispatch?.(); written()
            await new Promise<void>(resolve => { finishSubmitted = resolve }); return {}
        }
        assert.equal(payload.turnId, 'awaiting-admission')
        acceptedAbortCount++; return {}
    }
} })
await runtime.sendPrompt(thread.providerThreadId, 'Stop before admission', { turnId: 'awaiting-admission' })
await writtenGate
let stopReturned = false
const stoppingAdmission = runtime.interruptTurn(thread.providerThreadId, 'awaiting-admission').then(() => { stopReturned = true })
await new Promise(resolve => setTimeout(resolve, 10))
assert.equal(stopReturned, false, 'Stop cannot report success before written work is admitted or cancelled')
admittedTurn = 'awaiting-admission'
internals.handleZyraEvent(context, { type: 'zyra_server_prompt_accepted', prompt: 'Stop before admission' }, { turnId: admittedTurn })
await stoppingAdmission
assert.equal(acceptedAbortCount, 1)
assert.equal(context.activeTurnId, null)
finishSubmitted(); await new Promise(resolve => setTimeout(resolve, 10))
console.log('Force interrupt runtime: canonical recovery, pending dispatch/admission cancellation, connection failure and turn ownership passed')
