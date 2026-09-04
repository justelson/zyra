import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
    CONTROL_CAPABILITIES,
    CONTROL_PROTOCOL_VERSION
} from '../src/shared/agent-control/contracts'
import { CONTROL_BOUNDS } from '../src/shared/agent-control/policy'
import { GrantStore } from '../src/main/agent-control/grant-store'
import {
    assertControlActionRequest,
    assertControlCapabilities,
    assertControlPrincipal,
    assertControlSemanticActionSequenceRequest
} from '../src/shared/agent-control/validation'

const fixture = JSON.parse(await readFile(path.resolve('scripts/fixtures/agent-control-wire-v1.json'), 'utf8'))
const windowsDriverSource = await readFile(path.resolve('src/main/agent-control/drivers/windows-desktop-driver.ts'), 'utf8')
const js = await import(pathToFileURL(path.resolve('../src/agent-control/contracts.mjs')).href)
assert.equal(CONTROL_PROTOCOL_VERSION, js.CONTROL_PROTOCOL_VERSION)
assert.deepEqual([...CONTROL_CAPABILITIES], [...js.CONTROL_CAPABILITIES])
assert.deepEqual(CONTROL_BOUNDS, js.CONTROL_BOUNDS)
assert.deepEqual(assertControlPrincipal(fixture.principal), fixture.principal)
assert.deepEqual(assertControlCapabilities(fixture.capabilities), fixture.capabilities)
assert.deepEqual(assertControlActionRequest(fixture.action), fixture.action)
assert.throws(() => assertControlCapabilities(['cookie.read']), /Unknown control capability/)
assert.throws(() => assertControlActionRequest({ ...fixture.action, observationRevision: 0 }), /observationRevision/)
assert.throws(() => assertControlActionRequest({ ...fixture.action, action: { type: 'navigate', url: 'file:///secret' } }), /HTTP and HTTPS/)
assert.throws(() => assertControlActionRequest({ ...fixture.action, action: { type: 'click', elementRef: 'element:1:1', sideEffect: 'harmless-trust-me' } }), /Side-effect class/)
assert.throws(() => assertControlActionRequest({ ...fixture.action, action: { type: 'key', key: 'Z', modifiers: ['hyper'] } }), /modifier.*allowlist/i)
const drag = assertControlActionRequest({ ...fixture.action, action: { type: 'drag', fromX: 10, fromY: 20, toX: 30, toY: 40, sideEffect: 'account-change' } })
assert.equal(drag.action.type === 'drag' ? drag.action.sideEffect : null, 'account-change')
const routineSequence = assertControlSemanticActionSequenceRequest({
    version: 1,
    requestId: 'sequence:test',
    grantId: 'grant:test',
    targetId: 'target:test',
    observationRevision: 2,
    steps: [
        { type: 'type', name: 'Name', text: 'seed', replace: true, sideEffect: 'none' },
        { type: 'key', key: 'A', modifiers: ['Ctrl'], sideEffect: 'none' },
        { type: 'type', role: 'edit', name: 'Name', text: 'replacement', replace: false, sideEffect: 'none' },
        { type: 'wait', durationMs: 100, sideEffect: 'none' }
    ]
})
assert.equal(routineSequence.steps.length, 4)
assert.throws(() => assertControlSemanticActionSequenceRequest({
    ...routineSequence,
    steps: [{ type: 'key', key: 'S', modifiers: ['Ctrl'], sideEffect: 'none' }]
}), /individual reviewed action/)
assert.throws(() => assertControlSemanticActionSequenceRequest({
    ...routineSequence,
    steps: [{ type: 'type', text: 'append', replace: false, sideEffect: 'none' }]
}), /name is invalid/)
const focusedType = assertControlActionRequest({ ...fixture.action, action: { type: 'type', text: 'Canvas text' } })
assert.equal(focusedType.action.type, 'type')
assert.equal(focusedType.action.type === 'type' ? focusedType.action.elementRef : null, undefined, 'typing may use the page current focus without a DOM reference')
const coordinateType = assertControlActionRequest({ ...fixture.action, action: { type: 'type', x: 320, y: 220, text: 'Canvas text' } })
assert.deepEqual(coordinateType.action.type === 'type' ? [coordinateType.action.x, coordinateType.action.y] : null, [320, 220])
assert.throws(
    () => assertControlActionRequest({ ...fixture.action, action: { type: 'type', x: 320, text: 'partial coordinates' } }),
    /both x and y/
)
assert.doesNotMatch(windowsDriverSource, /\bspawnSync\b/, 'closing the Windows sidecar must not block Electron main')
const expiryStore = new GrantStore()
const expiredGrant = expiryStore.issue({
    principal: fixture.principal,
    targetId: fixture.action.targetId,
    capabilities: ['observe.structure'],
    expiresAt: new Date(Date.now() - 1).toISOString(),
    maxActions: 1,
    issuedBy: 'user'
})
assert.throws(() => expiryStore.requireActive(expiredGrant.grantId, fixture.principal), /expired/)
assert.deepEqual(expiryStore.expire().map((grant) => grant.grantId), [expiredGrant.grantId], 'expiry discovered during an action remains available for broker cleanup')
assert.deepEqual(expiryStore.expire(), [], 'an expired grant is drained exactly once')
console.log('Agent control contract equivalence passed.')
