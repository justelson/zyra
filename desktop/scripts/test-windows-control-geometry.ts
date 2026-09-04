import assert from 'node:assert/strict'
import type { ControlObservation } from '../src/shared/agent-control/contracts'
import { resolveWindowsActionScreenPoint, resolveWindowsControlBounds, resolveWindowsDragEndScreenPoint, translateWindowsPointerAction } from '../src/main/agent-control/windows-control-geometry'

const observation: ControlObservation = {
    version: 1,
    observationId: 'control-observation:test',
    revision: 1,
    targetId: 'control-target:windows-window:test',
    capturedAt: new Date().toISOString(),
    targetState: 'ready',
    title: 'Calculator',
    elements: [
        { elementRef: 'root', role: 'window', name: 'Calculator', bounds: { x: -8, y: -8, width: 816, height: 616 } },
        { elementRef: 'title', role: 'titlebar', name: 'Calculator', bounds: { x: 0, y: 0, width: 800, height: 32 } },
        { elementRef: 'seven', role: 'button', name: 'Seven', actions: ['click'], bounds: { x: 120, y: 220, width: 40, height: 40 } }
    ],
    redactions: []
}

assert.deepEqual(resolveWindowsControlBounds(observation), { x: -8, y: -8, width: 816, height: 616 })
assert.deepEqual(resolveWindowsActionScreenPoint({ type: 'click', elementRef: 'seven' }, observation), { x: 140, y: 240 })
assert.deepEqual(resolveWindowsActionScreenPoint({ type: 'click', x: 10, y: 20 }, observation), { x: 2, y: 12 })
assert.deepEqual(resolveWindowsActionScreenPoint({ type: 'move', x: 20, y: 30 }, observation), { x: 12, y: 22 })
const drag = { type: 'drag' as const, fromX: 30, fromY: 40, toX: 130, toY: 140 }
assert.deepEqual(resolveWindowsActionScreenPoint(drag, observation), { x: 22, y: 32 })
assert.deepEqual(resolveWindowsDragEndScreenPoint(drag, observation), { x: 122, y: 132 })
assert.deepEqual(translateWindowsPointerAction(drag, observation), { type: 'drag', fromX: 22, fromY: 32, toX: 122, toY: 132 })
assert.equal(resolveWindowsActionScreenPoint({ type: 'focus' }, observation), null)
assert.equal(resolveWindowsControlBounds(undefined), null)

console.log('Windows control overlay geometry passed.')
