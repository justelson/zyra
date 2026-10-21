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
const { sendAssistantPromptAction } = await import('../src/main/assistant/service-session-actions')
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
context.activeTurnId = 'still-working'
let asyncReceipt: any
context.worker.request = async (type: string, payload: any) => { asyncReceipt = { type, payload }; return { continuationPrompt: 'Which target?\\nDesktop' } }
const answered = await runtime.respondUserInput('zyra_remote', 'async-question', { choice: 'Desktop' }, [], { mode: 'async' })
assert.equal(answered.continuationPrompt, 'Which target?\\nDesktop')
assert.equal(context.activeTurnId, 'still-working', 'Answer-later resolution does not wait for or stop independent work')
assert.equal(asyncReceipt.payload.deferContinuation, true, 'Desktop-owned durable queue suppresses duplicate server-side answer dispatch')
assert.equal(asyncReceipt.type, 'user_input.respond')
console.log('Assistant steering: exact-turn delivery, no abort/new turn/config changes, rejection preservation and deferred async answer delivery passed')
