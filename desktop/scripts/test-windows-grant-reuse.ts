import assert from 'node:assert/strict'
import { AgentControlBroker } from '../src/main/agent-control/agent-control-broker'
import { FakeControlDriver } from '../src/main/agent-control/drivers/fake-driver'

const principal = { type: 'root' as const, threadId: 'reuse-thread', turnId: 'reuse-turn' }
class IdentityDriver extends FakeControlDriver {
    generation = 0
    constructor() { super('windows-window') }
    override async selectWindow(token: string) {
        const selected = await super.selectWindow(token)
        return { ...selected, target: { ...selected.target, processId: selected.target.processId + this.generation } }
    }
}
const driver = new IdentityDriver()
const broker = new AgentControlBroker({ drivers: [driver] })
const operation = { operation: 'use_app', application: 'Fixture', capabilities: ['observe.structure', 'pointer.drag'], durationMs: 60_000, maxActions: 8 }
async function consent(result: Promise<Record<string, unknown>>) {
    for (let attempt = 0; attempt < 100 && !broker.state().pendingGrants.length; attempt++) await new Promise(resolve => setTimeout(resolve, 1))
    const request = broker.state().pendingGrants[0]!
    assert.ok(request, 'a new or expanded grant needs ordinary consent')
    broker.approvePendingGrant({ pendingRequestId: request.requestId, targetId: request.targetId, capabilities: request.capabilities, durationMs: 60_000, maxActions: request.maxActions })
    return await result as any
}
try {
    const first = await consent(broker.handleToolOperation(principal, operation as any))
    const originalExpiry = first.grant.expiresAt
    const originalCount = first.grant.actionCount
    const again = await broker.handleToolOperation(principal, operation as any) as any
    assert.equal(again.reusedGrant, true)
    assert.equal(again.grant.grantId, first.grant.grantId)
    assert.equal(again.grant.expiresAt, originalExpiry)
    assert.equal(again.grant.maxActions, 8)
    assert.equal(again.grant.actionCount, originalCount + 1)
    assert.equal(again.observation.revision, first.observation.revision + 1)
    assert.equal(broker.state().pendingGrants.length, 0)
    const expanded = await consent(broker.handleToolOperation(principal, { ...operation, capabilities: [...operation.capabilities, 'window.focus'] } as any))
    assert.notEqual(expanded.grant.grantId, again.grant.grantId)
    const otherTurn = await consent(broker.handleToolOperation({ ...principal, turnId: 'other-turn' }, operation as any))
    assert.notEqual(otherTurn.grant.grantId, expanded.grant.grantId)
    const exhausted = await consent(broker.handleToolOperation(principal, { ...operation, maxActions: 1 } as any))
    assert.equal(exhausted.grant.state, 'consumed')
    const renewed = await consent(broker.handleToolOperation(principal, operation as any))
    assert.notEqual(renewed.grant.grantId, exhausted.grant.grantId)
    broker.revokeGrant(renewed.grant.grantId, principal)
    const revoked = await consent(broker.handleToolOperation(principal, operation as any))
    assert.notEqual(revoked.grant.grantId, renewed.grant.grantId)
    revoked.grant.expiresAt = new Date(Date.now() - 1).toISOString()
    const expired = await consent(broker.handleToolOperation(principal, operation as any))
    assert.notEqual(expired.grant.grantId, revoked.grant.grantId)
    driver.generation++
    const replaced = await consent(broker.handleToolOperation(principal, operation as any))
    assert.notEqual(replaced.grant.targetId, expired.grant.targetId)
    assert.notEqual(replaced.grant.grantId, expired.grant.grantId)

} finally { await broker.dispose() }
console.log('Windows exact grant reuse: fresh observation, fixed expiry/budget, new capability/turn/consumed/revoked consent: ok')

for (const restriction of [{ maxActions: 1 }, { durationMs: 1000 }]) {
    const scoped = new AgentControlBroker({ drivers: [new FakeControlDriver('windows-window')] })
    try {
        await scoped.handleToolOperation(principal, operation as any, undefined, { permissionMode: 'full-access' })
        const started = Date.now()
        const limited = await scoped.handleToolOperation(principal, { ...operation, ...restriction } as any, undefined, { permissionMode: 'full-access' }) as any
        if (restriction.maxActions) assert.equal(limited.grant.maxActions, 1, 'reuse must respect a newly requested lower action limit')
        if (restriction.durationMs) assert.ok(Date.parse(limited.grant.expiresAt) <= started + 1100, 'reuse must respect a newly requested shorter lifetime')
    } finally { await scoped.dispose() }
}
