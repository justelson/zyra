import assert from 'node:assert/strict'
import { AgentControlBroker } from '../src/main/agent-control/agent-control-broker'
import { FakeControlDriver } from '../src/main/agent-control/drivers/fake-driver'

class PaintDriver extends FakeControlDriver {
    launches = 0
    ambiguous = false
    captures: boolean[] = []
    imageReads: string[] = []
    constructor() { super('windows-window') }
    override async openApp(application: string) { this.launches++; return { applicationName: application } }
    override async listWindows() {
        const windows = (await super.listWindows()).map(window => ({ ...window, applicationName: 'mspaint', title: 'Drawing - Paint' }))
        return this.ambiguous ? [...windows, { ...windows[0], windowToken: 'fixture:another-paint' }] : windows
    }
    override async selectWindow(token: string) {
        const selected = await super.selectWindow(token)
        return { ...selected, target: { ...selected.target, applicationName: 'mspaint', title: 'Drawing - Paint' } }
    }
    override async observe(target: any, options: any) {
        this.captures.push(options.includeScreenshot)
        return { ...await super.observe(target, options), title: `Paint revision ${options.revision}`,
            screenshotRef: options.includeScreenshot ? `fixture:image:${options.revision}` : undefined }
    }
    override readScreenshot(ref: string) { this.imageReads.push(ref); return super.readScreenshot('control-artifact:fixture') }
}
const driver = new PaintDriver()
const broker = new AgentControlBroker({ drivers: [driver] })
const principal = { type: 'root' as const, threadId: 'fixture:paint', turnId: 'fixture:turn' }
const use = (capabilities: string[], steps?: unknown[]) => broker.handleToolOperation(principal,
    { operation: 'use_app', application: 'Paint', capabilities, maxActions: 10, ...(steps ? { steps } : {}) },
    undefined, { permissionMode: 'full-access' }) as Promise<any>
try {
    for (const application of ['Paint', 'Microsoft Paint']) {
        const opened = await broker.openWindowsApp(principal, application)
        assert.equal(opened.launched, false, `${application} must reuse mspaint`)
        assert.equal(opened.windows.length, 1)
    }
    assert.equal(driver.launches, 0)
    const plain = await use(['observe.structure'])
    assert.equal(plain.screenshot, undefined, 'a grant without screenshot authority emits no image')
    assert.deepEqual(driver.captures, [false])
    assert.equal(plain.selectedWindow.processId, 4242)
    assert.equal(plain.selectedWindow.applicationName, 'mspaint')
    assert.equal(plain.selectedWindow.candidateRef, 'fixture:window')
    assert.equal(plain.selectedWindow.targetId, plain.grant.targetId)
    const screenshotOnly = await use(['observe.screenshot'])
    assert.ok(screenshotOnly.screenshot)
    assert.deepEqual(screenshotOnly.observation.elements, [], 'screenshot-only authority does not return structure')
    driver.captures.length = 0
    const visual = await use(['observe.structure', 'observe.screenshot'])
    assert.ok(visual.screenshot, 'visual access includes its initial granted screenshot')
    assert.deepEqual(driver.captures, [true])
    assert.equal(driver.imageReads.at(-1), visual.observation.screenshotRef)
    driver.captures.length = 0
    const step = { type: 'click', name: 'Continue', sideEffect: 'none' }
    const sequence = await use(['observe.structure', 'observe.screenshot', 'pointer.click'], [step, step])
    assert.deepEqual(driver.captures, [false, false, true], 'embedded sequence captures only its final revision')
    assert.ok(sequence.screenshot)
    assert.equal(driver.imageReads.at(-1), sequence.observation.screenshotRef)
    assert.equal(sequence.selectedWindow.title, sequence.observation.title)
    driver.captures.length = 0
    const batch = await broker.handleToolOperation(principal, { operation: 'act_sequence', version: 1,
        requestId: 'fixture:batch', grantId: sequence.grant.grantId, targetId: sequence.grant.targetId,
        observationRevision: sequence.observation.revision, steps: [step] }) as any
    assert.deepEqual(driver.captures, [true])
    assert.ok(batch.screenshot)
    assert.equal(driver.imageReads.at(-1), batch.observation.screenshotRef)
    const activeBefore = broker.grants.list().filter(grant => grant.state === 'active').map(grant => grant.grantId)
    driver.ambiguous = true
    await assert.rejects(() => use(['observe.structure']), /matching windows/)
    assert.deepEqual(broker.grants.list().filter(grant => grant.state === 'active').map(grant => grant.grantId), activeBefore,
        'ambiguous Paint discovery cannot silently change target authority')
    assert.equal(driver.launches, 0)
    console.log('Paint reuse, exact selected identity, bounded initial/final screenshots and ambiguity isolation passed.')
} finally { await broker.dispose() }
