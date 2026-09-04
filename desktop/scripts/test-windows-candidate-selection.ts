import assert from 'node:assert/strict'
import { AgentControlError } from '../src/main/agent-control/control-errors'
import { isExpiredWindowTokenError, selectExactWindowsCandidate } from '../src/main/agent-control/windows-candidate-selection'

const token = 'window-token:exact'
const expired = new AgentControlError('CONTROL_DRIVER_UNAVAILABLE', 'The window token is unknown or expired.')
const blocked = new AgentControlError('CONTROL_TARGET_BLOCKED', 'This application is blocked.')
assert.equal(isExpiredWindowTokenError(expired), true)
assert.equal(isExpiredWindowTokenError(blocked), false)

const calls: string[] = []
let attempts = 0
const recovered = await selectExactWindowsCandidate({
    windowToken: token,
    select: async () => {
        calls.push('select')
        attempts += 1
        if (attempts === 1) throw expired
        return { windowToken: token }
    },
    listCurrent: async () => {
        calls.push('list')
        return [{ windowToken: token }]
    }
})
assert.deepEqual(recovered, { windowToken: token })
assert.deepEqual(calls, ['select', 'list', 'select'])

let changedSelectionAttempts = 0
await assert.rejects(selectExactWindowsCandidate({
    windowToken: token,
    select: async () => { changedSelectionAttempts += 1; throw expired },
    listCurrent: async () => [{ windowToken: 'window-token:replacement' }]
}), (error) => error === expired)
assert.equal(changedSelectionAttempts, 1, 'a changed target must not be selected after refresh')

let policyRefreshes = 0
await assert.rejects(selectExactWindowsCandidate({
    windowToken: token,
    select: async () => { throw blocked },
    listCurrent: async () => { policyRefreshes += 1; return [{ windowToken: token }] }
}), (error) => error === blocked)
assert.equal(policyRefreshes, 0, 'non-expiry failures must not trigger private enumeration')

console.log('Windows candidate expiry recovery and fail-closed selection passed.')
