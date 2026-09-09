import assert from 'node:assert/strict'
import { AgentControlBroker } from '../src/main/agent-control/agent-control-broker'
import { FakeControlDriver } from '../src/main/agent-control/drivers/fake-driver'

class AcquisitionDriver extends FakeControlDriver {
    leases = 0
    ambiguous = false
    phases: string[] = []
    constructor() { super('windows-window') }
    retainAcquisition() {
        this.leases++
        let released = false
        return () => { if (!released) { released = true; this.leases-- } }
    }
    override async listWindows() {
        assert.equal(this.leases, 1, 'use_app pins helper lifetime before discovery')
        this.phases.push('list')
        const windows = await super.listWindows()
        return this.ambiguous ? [...windows, { ...windows[0], windowToken: 'fixture:second' }] : windows
    }
    override async selectWindow(token: string) {
        assert.equal(this.leases, 1, 'lease covers target selection')
        this.phases.push('select')
        return super.selectWindow(token)
    }
    override async observe(target: any, options: any) {
        assert.equal(this.leases, 1, 'lease remains until initial observation completes')
        assert.equal(this.retainedTargetCount(), 1, 'a real grant replaces acquisition-only lifetime before observation')
        this.phases.push('observe')
        return super.observe(target, options)
    }
}
const driver = new AcquisitionDriver()
const broker = new AgentControlBroker({ drivers: [driver] })
const principal = { type: 'root' as const, threadId: 'fixture:chat', turnId: 'fixture:turn' }
try {
    const result = await broker.handleToolOperation(principal, { operation: 'use_app', application: 'Fixture', capabilities: ['observe.structure'], maxActions: 10 }, undefined, { permissionMode: 'full-access' })
    assert.ok(result.grant && result.observation)
    assert.deepEqual(driver.phases, ['list', 'select', 'observe'])
    assert.equal(driver.leases, 0)
    broker.revokePrincipal(principal, 'Fixture turn complete')
    assert.equal(driver.retainedTargetCount(), 0)
    driver.ambiguous = true
    await assert.rejects(() => broker.handleToolOperation({ ...principal, turnId: 'fixture:retry' }, { operation: 'use_app', application: 'Fixture', capabilities: ['observe.structure'] }, undefined, { permissionMode: 'full-access' }), /matching windows/)
    assert.equal(driver.leases, 0, 'failed acquisition releases its lifetime pin')
    assert.equal(driver.retainedTargetCount(), 0, 'ambiguous discovery grants no target authority')
    console.log('Windows acquisition lifecycle: discovery -> selection -> grant -> observation, success/error cleanup: ok')
} finally { await broker.dispose() }
