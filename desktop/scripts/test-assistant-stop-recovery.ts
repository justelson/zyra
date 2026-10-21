import assert from 'node:assert/strict'
import { mock } from 'bun:test'
const noop = () => undefined
mock.module('electron-log', () => ({ default: { info: noop, warn: noop, error: noop, debug: noop } }))
mock.module('../src/main/utils', () => ({ is: { dev: false } }))
const { interruptAssistantTurnAction } = await import('../src/main/assistant/service-session-actions')

const thread = { id: 'local-thread', providerThreadId: 'canonical-chat', state: 'interrupted', latestTurn: { id: 'stale-ui-turn', state: 'interrupted' } }
const session = { id: 'chat', activeThreadId: thread.id, threads: [thread] }
let active: string | null = 'server-live-turn'
let connected = false
let failRead = false
let failAbort = false
const aborted: string[] = [], order: string[] = []
const deps = {
    ensureReady: async () => {}, getSnapshot: () => ({ sessions: [session], selectedSessionId: session.id }),
    getSessionRuntimeCwd: () => 'C:/synthetic', appendEvent: () => { throw new Error('an observation cannot invent terminal events') },
    connectSessionRuntime: async () => { connected = true; order.push('attach') },
    runtime: {
        hasSession: () => connected,
        getCanonicalChat: async (id: string) => {
            assert.equal(id, 'canonical-chat'); assert.ok(connected); order.push('observe')
            if (failRead) throw new Error('Synthetic disconnected observation')
            return { presence: { state: active ? 'running' : 'ready', activeTurnId: active } }
        },
        interruptTurn: async (_id: string, turnId: string) => {
            assert.ok(turnId, 'never send an unbounded abort')
            if (failAbort) throw new Error('Synthetic failed abort')
            aborted.push(turnId); order.push('abort')
        }
    }
}
await interruptAssistantTurnAction(deps as any, undefined, session.id)
assert.deepEqual(aborted, ['server-live-turn'], 'Stop from an interrupted UI targets the currently observed canonical turn')
assert.deepEqual(order, ['attach', 'observe', 'abort'])
active = 'newer-server-turn'
await interruptAssistantTurnAction(deps as any, 'server-live-turn', session.id)
assert.equal(aborted.length, 1, 'an explicit old Stop cannot substitute a newer turn')
active = null
await interruptAssistantTurnAction(deps as any, undefined, session.id)
assert.equal(aborted.length, 1, 'an idle server cannot fall back to the stale local turn')
failRead = true
await assert.rejects(interruptAssistantTurnAction(deps as any, undefined, session.id), /disconnected observation/)
assert.equal(aborted.length, 1)
failRead = false; active = 'newer-server-turn'; failAbort = true
await assert.rejects(interruptAssistantTurnAction(deps as any, undefined, session.id), /failed abort/)
assert.equal(thread.latestTurn.state, 'interrupted', 'a failed abort does not fabricate a new local ending')
console.log('PASS canonical Stop recovery, exact-turn ownership, no-active and disconnected safety')
