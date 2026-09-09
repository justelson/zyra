import assert from 'node:assert/strict'
import { mock } from 'bun:test'
mock.module('electron', () => ({ app: { getAppPath: () => '.' } }))
const { WindowsDesktopDriver } = await import('../src/main/agent-control/drivers/windows-desktop-driver')
const { AgentControlBroker } = await import('../src/main/agent-control/agent-control-broker')
const updates: any[] = []
let fail = false
const driver = Object.create(WindowsDesktopDriver.prototype) as InstanceType<typeof WindowsDesktopDriver>
;(driver as any).connection = { request: async (_method: string, _params: unknown, _signal: unknown, _timeout: unknown, _target: unknown, progress: (value: unknown) => void) => {
    assert.equal(updates.length, 0, 'coordinate actions must not predict an endpoint before native execution')
    progress({ x: -320, y: 140, phase: 'moving' })
    progress({ x: -300, y: 150, phase: 'dragging' })
    if (fail) throw Error('obscured')
    progress({ x: -220, y: 180, phase: 'dragging' })
    return { changed: true }
} }
const target = { target: { kind: 'windows-window', targetId: 'cursor-test' }, trustedIdentity: { windowToken: 'opaque' } } as any
const context = { revision: 1, previousObservation: { elements: [{ role: 'window', bounds: { x: -400, y: 100, width: 500, height: 400 } }] }, updateCursor: (value: unknown) => updates.push(value) } as any
const action = { type: 'drag', fromX: 80, fromY: 40, toX: 180, toY: 80 } as const
await driver.act(target, action, context)
assert.deepEqual(updates.map(p => [p.x,p.y,p.durationMs]), [[-320,140,0],[-300,150,0],[-220,180,0],[-220,180,0]])
updates.length = 0; fail = true
await assert.rejects(() => driver.act(target, action, context), /obscured/)
assert.equal(updates.at(-1).x, -300, 'failed input retains the last real point instead of claiming the endpoint')
const broker = new AgentControlBroker({ drivers: [] })
try {
    ;(broker as any).updateCursor('cursor-test', { type: 'root', threadId: 'fixture' }, 'move', { x: -320, y: -100, coordinateSpace: 'screen', phase: 'idle' })
    assert.equal(broker.state().cursors[0].x, -320)
    assert.equal(broker.state().cursors[0].y, -100)
    ;(broker as any).updateCursor('cursor-test', { type: 'root', threadId: 'fixture' }, 'move', { x: -320, y: -100, coordinateSpace: 'target', phase: 'idle' })
    assert.equal(broker.state().cursors[0].x, 0, 'window-local coordinates keep their lower bound')
} finally { await broker.dispose() }
console.log('Native cursor progress, failed-drag position and negative display coordinates passed.')

const nativeObservationDriver = Object.create(WindowsDesktopDriver.prototype) as InstanceType<typeof WindowsDesktopDriver>
let nativeBounds = { x: -400, y: 100, width: 1940, height: 1098 }
const nativeActions: any[] = []
const nativeRequests: any[] = []
;(nativeObservationDriver as any).connection = { request: async (method: string, parameters: any) => {
    if (method === 'observe') return { targetState: 'ready', title: 'Paint', elements: [
        { elementRef: `window-element:${parameters.revision}:0`, role: 'window', bounds: nativeBounds, name: 'Paint' },
        { elementRef: 'canvas', role: 'pane', name: 'Canvas', bounds: { x: -390, y: 280, width: 1614, height: 708 } }
    ], redactions: [] }
    assert.equal(method, 'action')
    nativeActions.push(parameters.action)
    nativeRequests.push(parameters)
    return { changed: true }
} }
const realShape = await nativeObservationDriver.observe(target, { revision: 1, includeScreenshot: false, mode: 'structure' })
assert.deepEqual(realShape.viewport, { width: 1940, height: 1098, scale: 1 }, 'native UIA root bounds provide physical-pixel viewport without a fictional native viewport field')
await nativeObservationDriver.act(target, action, { revision: 1, previousObservation: realShape })
assert.deepEqual(nativeActions[0], { ...action, fromX: -320, fromY: 140, toX: -220, toY: 180 }, 'negative-screen target translation is applied once with no DPI rescaling')
nativeBounds = { x: 100, y: -50, width: 900, height: 600 }
const movedShape = await nativeObservationDriver.observe(target, { revision: 2, includeScreenshot: false, mode: 'structure' })
assert.deepEqual(movedShape.viewport, { width: 900, height: 600, scale: 1 }, 'each observation refreshes viewport from the same geometry used by native input')
await nativeObservationDriver.act(target, action, { revision: 2, previousObservation: movedShape })
assert.deepEqual(nativeActions[1], { ...action, fromX: 180, fromY: -10, toX: 280, toY: 30 })

const visualOnly = await nativeObservationDriver.observe(target, { revision: 3, includeScreenshot: true, mode: 'visual' })
assert.deepEqual(visualOnly.elements, [], 'screenshot-only observation does not leak semantic controls without structure authority')
assert.equal(visualOnly.focusedElementRef, undefined)
assert.deepEqual(visualOnly.viewport, { width: 900, height: 600, scale: 1 })
await nativeObservationDriver.act(target, action, { revision: 3, previousObservation: visualOnly, allowWindowFocus: true } as any)
assert.equal(nativeRequests.at(-1).allowWindowFocus, true, 'only an explicitly granted focus right can activate a coordinate target')
assert.equal(nativeRequests[0].allowWindowFocus, undefined, 'absent focus authority must not activate a target')
await nativeObservationDriver.act(target, { type: 'click', elementRef: 'canvas' }, { revision: 2, previousObservation: movedShape, allowWindowFocus: true } as any)
assert.equal(nativeRequests.at(-1).allowWindowFocus, undefined, 'semantic invocation does not gain implicit activation')

const publishing = new AgentControlBroker({ drivers: [] })
const published: any[] = []
const originalDateNow = Date.now
Date.now = () => 10_000
publishing.on('cursor', cursor => published.push(cursor))
const progress = (id: string, x: number, coordinateSpace = 'screen') => (publishing as any).updateCursor(id,
    { type: 'root', threadId: 'fixture' }, 'move', { x, y: 100, coordinateSpace, phase: 'moving' })
try {
    progress('eligible', 10)
    assert.equal(published.length, 1, 'an eligible native update must publish synchronously without another Windows timer tick')
    for (let x = 11; x < 20; x++) progress('eligible', x)
    assert.equal(published.length, 1, 'updates within the frame must coalesce')
    assert.equal((publishing as any).cursorPublishTimers.size, 1)
    ;(publishing as any).clearCursor('eligible')
    await new Promise(resolve => setTimeout(resolve, 25))
    assert.equal(published.length, 1, 'revocation must discard the queued update')
    ;(publishing as any).cursorPublishedAt.set('browser', Date.now() - 20)
    progress('browser', 30, 'target')
    assert.equal(published.length, 1, 'browser updates must retain their 33ms cadence')
    assert.equal((publishing as any).cursorPublishTimers.size, 1)
} finally { Date.now = originalDateNow; await publishing.dispose() }
await new Promise(resolve => setTimeout(resolve, 25))
assert.equal(published.length, 1, 'disposal must discard the queued browser update')
