import assert from 'node:assert/strict'
import { AgentControlBroker } from '../src/main/agent-control/agent-control-broker'
import { matchesWindowsApplication } from '../src/main/agent-control/windows-application-match'
import { FakeControlDriver } from '../src/main/agent-control/drivers/fake-driver'

class ProfileDriver extends FakeControlDriver {
    launches = 0
    clicked: string[] = []
    constructor() { super('windows-window') }
    override async openApp(application: string) { this.launches++; return { applicationName: application } }
    override async listWindows() {
        const windows = await super.listWindows()
        return [...windows.map(window => ({ ...window, applicationName: 'chrome', title: 'New Tab - Google Chrome' })), { ...windows[0], windowToken: 'unrelated:notes', applicationName: 'notepad', title: 'Google Chrome migration notes' }]
    }
    override async observe(target: any, options: any) {
        return { ...await super.observe(target, options), elements: [
            { elementRef: 'profile:upper', role: 'button', name: 'Open DEMO profile', actions: ['click'] },
            { elementRef: 'profile:title', role: 'button', name: 'Open Demo profile', actions: ['click'] }
        ] }
    }
    override async act(target: any, action: any, context: any) {
        this.clicked.push(action.elementRef)
        return super.act(target, action, context)
    }
}
assert.equal(matchesWindowsApplication({ applicationName: 'notepad', title: 'Google Chrome' }, 'Google Chrome'), false, 'an unrelated document title is not app identity')
const driver = new ProfileDriver()
const broker = new AgentControlBroker({ drivers: [driver] })
const principal = { type: 'root' as const, threadId: 'fixture:profiles', turnId: 'fixture:turn' }
try {
    const opened = await broker.openWindowsApp(principal, 'Google Chrome')
    assert.equal(opened.launched, false, 'display-name suffix reuses the existing browser instead of reopening its profile picker')
    assert.equal(driver.launches, 0)
    assert.equal((await broker.listWindows('Google Chrome')).length, 1, 'query-scoped metadata cannot leak unrelated documents mentioning the app')
    const result = await broker.handleToolOperation(principal, {
        operation: 'use_app', application: 'Google Chrome', capabilities: ['observe.structure', 'pointer.click'], maxActions: 10,
        steps: [{ type: 'click', role: 'button', name: 'Open Demo profile', sideEffect: 'none' }]
    }, undefined, { permissionMode: 'full-access' }) as any
    assert.deepEqual(driver.clicked, ['profile:title'], 'exact semantic names preserve case and select only the requested profile')
    await assert.rejects(() => broker.handleToolOperation(principal, {
        operation: 'act_sequence', version: 1, requestId: 'fixture:wrong-case', grantId: result.grant.grantId,
        targetId: result.grant.targetId, observationRevision: result.observation.revision,
        steps: [{ type: 'click', name: 'Open demo profile', sideEffect: 'none' }]
    }), /found 0/, 'wrong case cannot silently choose another profile')
    assert.equal(driver.clicked.length, 1)
    console.log('Windows profile recovery: existing app reuse and case-sensitive exact names: ok')
} finally { await broker.dispose() }
