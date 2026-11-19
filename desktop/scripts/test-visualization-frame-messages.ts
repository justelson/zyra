import assert from 'node:assert/strict'
import { subscribeVisualizationFrameMessages } from '../src/renderer/src/components/ui/visualization/visualization-frame-messages'
const listeners = new Set<(event: MessageEvent) => void>()
const view = { addEventListener: (_name: string, listener: (event: MessageEvent) => void) => listeners.add(listener), removeEventListener: (_name: string, listener: (event: MessageEvent) => void) => listeners.delete(listener) } as unknown as Window
const sources = Array.from({ length: 32 }, () => ({} as Window))
const deliveries = Array.from({ length: sources.length }, () => 0)
const close = sources.map((source, index) => subscribeVisualizationFrameMessages(view, source, () => { deliveries[index]++ }))
const emit = (source: Window, origin = 'null') => { for (const listener of listeners) listener({ source, origin } as MessageEvent) }
assert.equal(listeners.size, 1, 'a dense gallery owns one native listener')
emit(sources[13]!)
assert.equal(deliveries[13], 1)
assert.equal(deliveries.reduce((sum, count) => sum + count), 1, 'a message reaches only its exact registered source')
emit({} as Window); emit(sources[13]!, 'https://example.com')
assert.equal(deliveries.reduce((sum, count) => sum + count), 1, 'unknown frames and non-opaque origins cannot dispatch')
let replacement = 0
const closeNew = subscribeVisualizationFrameMessages(view, sources[13]!, () => { replacement++ })
close[13]!(); emit(sources[13]!)
assert.equal(replacement, 1, 'old cleanup cannot remove a replacement owner')
close.forEach(dispose => dispose()); closeNew()
assert.equal(listeners.size, 0, 'the last preview removes the window listener')
const remount = subscribeVisualizationFrameMessages(view, sources[0]!, () => { deliveries[0]++ })
assert.equal(listeners.size, 1); remount(); assert.equal(listeners.size, 0)
console.log('Visualization message routing: one listener, exact-source/origin isolation, replacement ownership and teardown passed')
