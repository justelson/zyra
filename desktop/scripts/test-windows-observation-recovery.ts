import assert from 'node:assert/strict'
import { observeExactWindowsTarget } from '../src/main/agent-control/windows-observation-recovery'
import { AgentControlError } from '../src/main/agent-control/control-errors'

let calls = 0
const waits: number[] = []
const blocked = { targetState: 'blocked', elements: [{ elementRef: 'stale' }], redactions: ['uia-unavailable:Unrecognized error'] }
const input = {
    windowToken: 'window:picker',
    observe: async () => ++calls < 3 ? blocked : { targetState: 'ready', elements: [] },
    listCurrent: async () => [{ windowToken: 'window:picker' }],
    wait: async (ms: number) => { waits.push(ms) }
}
assert.equal((await observeExactWindowsTarget(input)).targetState, 'ready')
assert.equal(calls, 3)
assert.deepEqual(waits, [100, 200])
calls = 0
const replacement = await observeExactWindowsTarget({ ...input, listCurrent: async () => [{ windowToken: 'window:new-profile' }] })
assert.equal(replacement.targetState, 'closed', 'replacement window never inherits the picker grant')
assert.deepEqual(replacement.elements, [])
assert.equal(calls, 1)
calls = 0
const permanent = await observeExactWindowsTarget({ ...input, observe: async () => { calls++; return blocked } })
assert.equal(permanent.targetState, 'blocked')
assert.deepEqual(permanent.elements, [], 'failed partial trees never become actionable')
assert.equal(calls, 3, 'recovery is bounded')
await assert.rejects(() => observeExactWindowsTarget({ ...input, observe: async () => { throw new AgentControlError('CONTROL_CANCELLED', 'cancelled') } }), /cancelled/)
await assert.rejects(() => observeExactWindowsTarget({ ...input, observe: async () => { throw new AgentControlError('CONTROL_SCOPE_DENIED', 'denied') } }), /denied/)
calls = 0
assert.equal((await observeExactWindowsTarget({ ...input, observe: async () => {
    if (++calls === 1) throw new AgentControlError('CONTROL_DRIVER_UNAVAILABLE', 'The window token is unknown or expired.')
    return { targetState: 'ready', elements: [] }
} })).targetState, 'ready', 'rediscovery can refresh the same exact token after registry expiry')
assert.equal(calls, 2)
calls = 0
assert.equal((await observeExactWindowsTarget({ ...input, observe: async () => {
    calls++; return { targetState: 'blocked', elements: [], redactions: ['sensitive-window'] }
} })).targetState, 'blocked')
assert.equal(calls, 1, 'policy blocks are not retried as transient UIA failure')
console.log('Windows observation recovery: bounded exact-window retry, replacement isolation, stale reference removal and cancellation: ok')
