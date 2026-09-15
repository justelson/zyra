import assert from 'node:assert/strict'
import { BrowserSurfaceInbox } from '../src/preload/adapters/browser-surface-inbox'

const inbox = new BrowserSurfaceInbox<{ requestId: string }>(2)
const received: string[] = []
inbox.receive({ requestId: 'before-mount' })
inbox.receive({ requestId: 'cancelled' })
inbox.cancel('cancelled')
const unsubscribe = inbox.subscribe(request => received.push(request.requestId))
assert.deepEqual(received, ['before-mount'])
inbox.receive({ requestId: 'live' })
unsubscribe()
inbox.receive({ requestId: 'during-remount' })
const off = inbox.subscribe(request => received.push(request.requestId))
assert.deepEqual(received, ['before-mount', 'live', 'during-remount'])
off()
inbox.receive({ requestId: 'old' })
inbox.receive({ requestId: 'newer' })
inbox.receive({ requestId: 'newest' })
inbox.subscribe(request => received.push(request.requestId))
assert.deepEqual(received.slice(-2), ['newer', 'newest'], 'inbox stays bounded without creating tabs itself')
console.log('Browser surface delivery: mount, remount, cancellation and bounded buffering passed.')
