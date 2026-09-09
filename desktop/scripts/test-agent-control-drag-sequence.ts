import assert from 'node:assert/strict'
import { AgentControlBroker } from '../src/main/agent-control/agent-control-broker'
import { FakeControlDriver } from '../src/main/agent-control/drivers/fake-driver'
import type { ControlAction, ControlElement } from '../src/shared/agent-control/contracts'
import type { DriverActionContext, DriverObservationOptions } from '../src/main/agent-control/drivers/driver'
import type { RegisteredControlTarget } from '../src/main/agent-control/target-registry'

class DrawingDriver extends FakeControlDriver {
    readonly actions: Array<{ action: ControlAction; revision: number; allowWindowFocus?: boolean }> = []
    extra: ControlElement[] = []
    shrinkAfterAction = false
    onAction?: () => void
    constructor() { super('windows-window') }
    override async observe(target: RegisteredControlTarget, options: DriverObservationOptions) {
        const result = await super.observe(target, options)
        return { ...result, elements: [...result.elements, ...this.extra], viewport: this.shrinkAfterAction && this.actions.length ? { width: 80, height: 60, scale: 1 } : result.viewport }
    }
    override async act(target: RegisteredControlTarget, action: ControlAction, context: DriverActionContext) {
        this.actions.push({ action, revision: context.revision, allowWindowFocus: context.allowWindowFocus })
        const result = await super.act(target, action, context)
        this.onAction?.()
        return result
    }
}
const principal = { type: 'root' as const, threadId: 'drawing-thread', turnId: 'drawing-turn' }
const drag = { type: 'drag', fromX: 100, fromY: 120, toX: 250, toY: 270, durationMs: 220, sideEffect: 'none' }
const driver = new DrawingDriver()
const broker = new AgentControlBroker({ drivers: [driver] })
try {
    const access = await broker.handleToolOperation(principal, {
        operation: 'use_app', application: 'Fixture', capabilities: ['observe.structure', 'pointer.click', 'pointer.drag'], maxActions: 16,
        steps: [{ type: 'click', name: 'Apply smoke input', sideEffect: 'none' }, drag, { ...drag, toX: 300 }]
    }, undefined, { permissionMode: 'full-access' }) as any
    assert.equal(access.sequence.completedSteps, 3, 'use_app embeds both semantic selection and routine drawing')
    assert.deepEqual(driver.actions.map(({ revision }) => revision), [1, 2, 3], 'each step uses the latest post-action observation')
    assert.equal(access.observation.revision, 4)
    assert.equal(driver.actions.every(entry => entry.allowWindowFocus === false), true, 'pointer capabilities cannot silently grant focus')
    assert.equal(driver.actions[1]!.action.type === 'drag' && driver.actions[1]!.action.button, 'left')
    const sequence = (steps: unknown[], observationRevision = access.observation.revision, signal?: AbortSignal) => broker.handleToolOperation(principal, {
        operation: 'act_sequence', version: 1, requestId: 'drawing-sequence', grantId: access.grant.grantId, targetId: access.grant.targetId, observationRevision, steps
    }, signal)
    await assert.rejects(() => sequence([drag], 1), { code: 'CONTROL_STALE_OBSERVATION' })
    await assert.rejects(() => sequence([{ ...drag, toX: 900 }]), /outside.*viewport/i)
    await assert.rejects(() => sequence([{ ...drag, sideEffect: 'file-upload' }]), /routine side effect/i)
    assert.equal(driver.actions.length, 3, 'invalid steps never reach the input driver')
    driver.extra = [{ elementRef: 'fixture:critical', role: 'button', name: 'Confirm purchase', bounds: { x: -310, y: 200, width: 40, height: 40 }, actions: ['click'] }, { elementRef: 'fixture:window', role: 'window', bounds: { x: -400, y: 100, width: 800, height: 600 } }]
    const criticalObservation = await broker.observe(principal, access.grant.grantId, access.grant.targetId, false, undefined, 'structure')
    await assert.rejects(() => sequence([drag], criticalObservation.revision), /canonical side-effect review/i)
    driver.extra = [{ ...driver.extra[0]!, name: 'Password', sensitive: true }, driver.extra[1]!]
    const sensitiveObservation = await broker.observe(principal, access.grant.grantId, access.grant.targetId, false, undefined, 'structure')
    await assert.rejects(() => sequence([drag], sensitiveObservation.revision), /sensitive control/i)
    driver.extra = []
    const fresh = await broker.observe(principal, access.grant.grantId, access.grant.targetId, false, undefined, 'structure')
    driver.shrinkAfterAction = true
    await assert.rejects(() => sequence([drag, drag], fresh.revision), /outside.*viewport/i)
    assert.equal(driver.actions.length, 4, 'a changed viewport stops the next gesture without replaying the completed one')
    driver.shrinkAfterAction = false
    const abortFresh = await broker.observe(principal, access.grant.grantId, access.grant.targetId, false, undefined, 'structure')
    const controller = new AbortController()
    driver.onAction = () => controller.abort()
    await assert.rejects(() => sequence([drag, drag], abortFresh.revision, controller.signal), /abort|cancel|interrupt/i)
    assert.equal(driver.actions.length, 5, 'an interrupted sequence never replays or starts its next gesture')
    driver.onAction = undefined
    const limited = await broker.handleToolOperation(principal, { operation: 'use_app', application: 'Fixture', capabilities: ['observe.structure'], maxActions: 3 }, undefined, { permissionMode: 'full-access' }) as any
    await assert.rejects(() => broker.handleToolOperation(principal, { operation: 'act_sequence', version: 1, requestId: 'limited', grantId: limited.grant.grantId, targetId: limited.grant.targetId, observationRevision: limited.observation.revision, steps: [drag] }), /capability|grant.*allow/i)
    assert.equal(driver.actions.length, 5, 'batching cannot widen the grant to pointer.drag')
    const focusedAccess = await broker.handleToolOperation(principal, { operation: 'use_app', application: 'Fixture', capabilities: ['observe.structure', 'pointer.drag', 'window.focus'], maxActions: 3, steps: [drag] }, undefined, { permissionMode: 'full-access' }) as any
    assert.equal(focusedAccess.sequence.completedSteps, 1)
    assert.equal(driver.actions.at(-1)!.allowWindowFocus, true, 'the current grant carries explicit focus authority to the driver')
} finally { await broker.dispose() }
console.log('Computer drag sequences: embedded use_app, fresh revisions, bounded current viewport, critical/sensitive denial, capability and interruption: ok')
