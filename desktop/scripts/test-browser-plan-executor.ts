import assert from 'node:assert/strict'
import { AgentControlBroker } from '../src/main/agent-control/agent-control-broker'
import { FakeControlDriver } from '../src/main/agent-control/drivers/fake-driver'
import { TargetInteractionArbiter } from '../src/main/agent-control/interaction-arbiter'

const arbiter = new TargetInteractionArbiter()
const targetA = 'control-target:browser:a'
const targetB = 'control-target:browser:b'
const baseline = arbiter.checkpoint(targetA)
arbiter.record(targetB, 'pointer-action', 'mouseDown', 'stage:b')
arbiter.record(targetB, 'keyboard', 'rawKeyDown', 'stage:b')
assert.equal(arbiter.decide(targetA, baseline).disposition, 'continue', 'another tab must never pause the target tab')
arbiter.record(targetA, 'pointer-action', 'mouseDown', 'stage:a')
assert.equal(arbiter.decide(targetA, baseline).disposition, 'adapt', 'one target-local event should trigger reobservation, not pause')
await new Promise((resolve) => setTimeout(resolve, 90))
arbiter.record(targetA, 'pointer-action', 'mouseDown', 'stage:a')
const divergence = arbiter.decide(targetA, baseline)
assert.equal(divergence.disposition, 'pause')
assert.ok(!JSON.stringify(divergence).includes('typed text'), 'interaction evidence must not contain typed content')
const collaborationTarget = 'control-target:browser:collaboration'
const collaborationBaseline = arbiter.checkpoint(collaborationTarget)
arbiter.record(collaborationTarget, 'pointer-action', 'mouseDown', 'stage:collaboration', { x: 120, y: 120 })
arbiter.record(collaborationTarget, 'pointer-action', 'mouseDown', 'stage:collaboration', { x: 140, y: 140 })
assert.equal(arbiter.decide(collaborationTarget, collaborationBaseline, {
    summary: 'Collaborate inside this drawing region',
    expectedActivity: 'pointer',
    expectedRegion: { x: 100, y: 100, width: 80, height: 80 }
}).disposition, 'adapt', 'same-direction target activity should reobserve and continue')
const outsideBaseline = arbiter.checkpoint(collaborationTarget)
await new Promise((resolve) => setTimeout(resolve, 90))
arbiter.record(collaborationTarget, 'pointer-action', 'mouseDown', 'stage:collaboration', { x: 300, y: 300 })
await new Promise((resolve) => setTimeout(resolve, 90))
arbiter.record(collaborationTarget, 'pointer-action', 'mouseDown', 'stage:collaboration', { x: 320, y: 320 })
assert.equal(arbiter.decide(collaborationTarget, outsideBaseline, {
    summary: 'Collaborate inside this drawing region',
    expectedActivity: 'pointer',
    expectedRegion: { x: 100, y: 100, width: 80, height: 80 }
}).disposition, 'pause', 'repeated activity outside the stage region should pause')

const driver = new FakeControlDriver()
let afterWaitAction: (() => void) | null = null
const act = driver.act.bind(driver)
driver.act = async (...args: Parameters<FakeControlDriver['act']>) => {
    const result = await act(...args)
    if (args[1].type === 'wait') {
        const callback = afterWaitAction
        afterWaitAction = null
        callback?.()
    }
    return result
}
const broker = new AgentControlBroker({ drivers: [driver] })
const firstTargetId = broker.targets.createTargetId('zyra-browser')
const otherTargetId = broker.targets.createTargetId('zyra-browser')
broker.registerTarget({
    target: { kind: 'zyra-browser', targetId: firstTargetId, tabId: 'browser:plan', ownerThreadId: 'thread:plan', guestIdentity: 'guest:plan', origin: 'http://127.0.0.1' },
    driver,
    trustedIdentity: {}
})
broker.registerTarget({
    target: { kind: 'zyra-browser', targetId: otherTargetId, tabId: 'browser:other', ownerThreadId: 'thread:plan', guestIdentity: 'guest:other', origin: 'http://127.0.0.1' },
    driver,
    trustedIdentity: {}
})
const principal = { type: 'root' as const, threadId: 'thread:plan', turnId: 'turn:plan' }
const pending = broker.requestGrant({
    principal,
    targetId: firstTargetId,
    capabilities: ['observe.structure', 'observe.screenshot', 'pointer.move', 'pointer.drag'],
    maxActions: 30
})
const grant = broker.approvePendingGrant({
    pendingRequestId: pending.requestId,
    targetId: firstTargetId,
    capabilities: pending.capabilities,
    durationMs: 60_000,
    maxActions: 30
})
const first = await broker.observe(principal, grant.grantId, firstTargetId, true, undefined, 'both')

afterWaitAction = () => {
    broker.recordUserInteraction(otherTargetId, 'pointer-action', 'mouseDown')
    broker.recordUserInteraction(otherTargetId, 'keyboard', 'rawKeyDown')
}
const unrelated = await broker.perform(principal, {
    version: 1,
    requestId: 'plan:unrelated-tab',
    grantId: grant.grantId,
    targetId: firstTargetId,
    observationRevision: first.revision,
    stage: { summary: 'Wait, then move on target A', expectedActivity: 'mixed' },
    steps: [
        { type: 'wait', condition: { type: 'delay', durationMs: 1 }, timeoutMs: 100 },
        { type: 'move', x: 120, y: 140, durationMs: 10 }
    ],
    observationMode: 'visual',
    includeScreenshot: true
})
assert.equal(unrelated.outcome, 'completed', 'activity in another tab must not interrupt the stage')
assert.equal(unrelated.completedSteps, 2)

afterWaitAction = () => {
    broker.recordUserInteraction(firstTargetId, 'keyboard', 'rawKeyDown')
    broker.recordUserInteraction(firstTargetId, 'scroll', 'mouseWheel')
}
const paused = await broker.perform(principal, {
    version: 1,
    requestId: 'plan:target-divergence',
    grantId: grant.grantId,
    targetId: firstTargetId,
    observationRevision: unrelated.observation.revision,
    stage: { summary: 'Pause at the next boundary if target-local activity diverges', expectedActivity: 'pointer' },
    steps: [
        { type: 'wait', condition: { type: 'delay', durationMs: 1 }, timeoutMs: 100 },
        { type: 'move', x: 180, y: 200, durationMs: 10 }
    ],
    observationMode: 'visual',
    includeScreenshot: true
})
assert.equal(paused.outcome, 'paused')
assert.equal(paused.completedSteps, 1, 'pause must happen after the current atomic action')
assert.deepEqual(paused.pause?.choices, ['continue-with-changes', 'replan-from-here', 'user-takeover'])
assert.ok(paused.pause?.evidence.every((event) => event.targetId === firstTargetId))

const status = await broker.handleToolOperation(principal, { operation: 'plan_status', planId: paused.planId })
assert.equal((status.plans as any[]).length, 1)
const resumed = await broker.handleToolOperation(principal, {
    operation: 'resume_plan',
    planId: paused.planId,
    disposition: 'replan-from-here'
})
assert.equal(resumed.replanningRequired, true, 'resume must reobserve and require a fresh plan')
assert.ok((resumed.observation as any).revision > paused.observation.revision)

const cursorEvents: any[] = []
broker.on('cursor', (cursor) => cursorEvents.push(cursor))
const stroke = await broker.perform(principal, {
    version: 1,
    requestId: 'plan:stroke',
    grantId: grant.grantId,
    targetId: firstTargetId,
    observationRevision: (resumed.observation as any).revision,
    stage: {
        summary: 'Draw one continuous bounded stroke',
        expectedActivity: 'pointer',
        expectedRegion: { x: 0, y: 0, width: 800, height: 600 }
    },
    steps: [{
        type: 'stroke',
        points: Array.from({ length: 40 }, (_value, index) => ({ x: 100 + index * 3, y: 100 + (index % 7) * 4 })),
        durationMs: 320
    }],
    observationMode: 'visual',
    includeScreenshot: true
})
assert.equal(stroke.outcome, 'completed')
assert.ok(cursorEvents.length <= 3, `cursor updates should be coalesced, received ${cursorEvents.length}`)
assert.equal(cursorEvents.at(-1)?.phase, 'idle')
assert.deepEqual(
    { x: cursorEvents.at(-1)?.x, y: cursorEvents.at(-1)?.y },
    { x: 217, y: 116 },
    'the cursor must end at the last CDP-acknowledged point'
)

const workspace = (width: number) => ({
    version: 1 as const,
    threadId: 'thread:plan',
    inspector: { open: true, width: 900, activeWorkspace: 'browser' as const, openWorkspaces: ['browser' as const] },
    browser: {
        open: true,
        activeTabId: 'browser:plan',
        splitTabId: null,
        visibleTabIds: ['browser:plan'],
        tabs: [{
            tabId: 'browser:plan', targetId: firstTargetId, trusted: true,
            url: 'http://127.0.0.1/fixture', title: 'Fixture', origin: 'http://127.0.0.1',
            status: 'ready' as const, position: 'primary' as const, visible: true,
            viewportRect: { x: 400, y: 100, width, height: 600 }
        }]
    },
    updatedAt: new Date().toISOString()
})
broker.updateWorkspaceState(workspace(800))
const revisionBeforeResize = broker.observations.currentRevision(firstTargetId)
broker.updateWorkspaceState(workspace(400))
assert.equal(broker.observations.currentRevision(firstTargetId), revisionBeforeResize + 1, 'split or Inspector geometry changes must invalidate target coordinates')
await assert.rejects(() => broker.perform(principal, {
    version: 1,
    requestId: 'plan:stale-after-resize',
    grantId: grant.grantId,
    targetId: firstTargetId,
    observationRevision: stroke.observation.revision,
    stage: { summary: 'Reject stale pre-resize coordinates', expectedActivity: 'pointer' },
    steps: [{ type: 'move', x: 100, y: 100 }],
    observationMode: 'visual',
    includeScreenshot: true
}), (error: any) => error.code === 'CONTROL_STALE_OBSERVATION')
broker.revokeGrant(grant.grantId, principal)
assert.equal(broker.state().cursors.some((cursor) => cursor.targetId === firstTargetId), false, 'cursor ownership must disappear when the last target grant ends')

await broker.dispose()
console.log('Browser staged execution, exact-target arbitration, resume, stroke, and cursor contracts passed.')
