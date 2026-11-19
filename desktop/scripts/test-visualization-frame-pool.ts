import assert from 'node:assert/strict'
import { VisualizationFramePool, attachVisualizationFrame } from '../src/renderer/src/components/ui/visualization/visualization-frame-pool'

class ElementFixture {
    style: Record<string, string> = {}; dataset: Record<string, string> = {}; children: ElementFixture[] = []
    parent: ElementFixture | null = null; attributes = new Map<string, string>(); reloads = 0
    contentWindow = { postMessage: (_message: unknown) => {} }
    clientWidth = 600; clientHeight = 180
    constructor(public tag: string, public owner: DocumentFixture) {}
    get isConnected(): boolean { return this === this.owner.body || Boolean(this.parent?.isConnected) }
    setAttribute(name: string, value: string) { this.attributes.set(name, value) }
    appendChild(node: ElementFixture) { if (node.isConnected) node.reloads++; this.moveBefore(node, null); return node }
    moveBefore(node: ElementFixture, _before: unknown) { node.remove(); node.parent = this; this.children.push(node) }
    remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null }
    blur() { this.owner.activeElement = null }
}
class DocumentFixture {
    body = new ElementFixture('body', this)
    activeElement: ElementFixture | null = null
    createElement(tag: string) { return new ElementFixture(tag, this) }
}
const document = new DocumentFixture(), owner = document as unknown as Document
const host = document.createElement('div'); document.body.appendChild(host)
const pool = new VisualizationFramePool(owner)
const ready = (lease: ReturnType<typeof pool.acquire>) => { lease.entry.ready = true; lease.entry.width = 600; lease.entry.height = 200; attachVisualizationFrame(host as any, lease.entry.frame) }
const first = pool.acquire('<p>chart</p>', 'chat-a:row-a:0'); ready(first)
document.activeElement = first.entry.frame as any
pool.release(first)
assert.equal(document.activeElement, null, 'parking never retains offscreen keyboard focus')
const second = pool.acquire('<p>chart</p>', 'chat-a:row-a:0')
assert.equal(second.entry.frame, first.entry.frame, 'same document/thread/row/block/source reuses its loaded browsing context')
ready(second); pool.release(first)
assert.equal(second.entry.owner, second.token, 'obsolete cleanup cannot park a new lease')
pool.release(second)
assert.equal((second.entry.frame as any).reloads, 0, 'atomic parking/mount moves never detach and reload the frame')
for (const scope of ['chat-b:row-a:0', 'chat-a:row-b:0', 'chat-a:row-a:1']) {
    const isolated = pool.acquire('<p>chart</p>', scope); assert.notEqual(isolated.entry.frame, first.entry.frame); ready(isolated); pool.release(isolated)
}
const changed = pool.acquire('<p>changed</p>', 'chat-a:row-a:0')
assert.notEqual(changed.entry.frame, first.entry.frame, 'changed source cannot reuse an old document')
pool.release(changed)
const pending = pool.acquire('<p>still loading</p>', 'pending-row')
attachVisualizationFrame(host as any, pending.entry.frame)
pool.release(pending)
const resumedPending = pool.acquire('<p>still loading</p>', 'pending-row')
assert.equal(resumedPending.entry.frame, pending.entry.frame, 'an in-flight document survives a rapid scroll/remount before its first height reply')
assert.equal(resumedPending.entry.ready, false)
assert.equal(resumedPending.entry.width, 600)
pool.release(resumedPending)
const unscoped = pool.acquire('<p>standalone</p>', null); ready(unscoped); pool.release(unscoped)
assert.equal(unscoped.entry.frame.isConnected, false, 'standalone/fullscreen views do not enter chat cache')
const detached = pool.acquire('<p>detached</p>', 'detached-row'); ready(detached)
detached.entry.frame.remove(); pool.release(detached)
const recreated = pool.acquire('<p>detached</p>', 'detached-row')
assert.notEqual(recreated.entry.frame, detached.entry.frame, 'a browsing context already destroyed by detachment cannot be cached as initialized')
ready(recreated); pool.release(recreated)
for (let index = 0; index < 80; index++) { const lease = pool.acquire(`<p>${index}</p>`, `row-${index}`); ready(lease); pool.release(lease) }
assert.equal(pool.stats().entries, pool.stats().maxEntries)
assert(pool.stats().bytes <= pool.stats().maxBytes)
const oversized = pool.acquire('x'.repeat(pool.stats().maxBytes), 'huge'); ready(oversized); pool.release(oversized)
assert(pool.stats().bytes <= pool.stats().maxBytes, 'oversized sources are discarded instead of escaping the cache budget')
assert.equal(pool.stats().active, 0, 'every completed or obsolete lease releases exactly once')
const bytesPool = new VisualizationFramePool(owner)
for (const scope of ['large-a', 'large-b']) { const lease = bytesPool.acquire('x'.repeat(600_000), scope); ready(lease); bytesPool.release(lease) }
assert.equal(bytesPool.stats().entries, 1, 'source-byte eviction applies before the frame count limit')
assert.equal(bytesPool.stats().bytes, 1_200_000)
const oldDocument = new DocumentFixture(); (oldDocument.body as any).moveBefore = undefined
const oldPool = new VisualizationFramePool(oldDocument as unknown as Document)
const oldLease = oldPool.acquire('chart', 'row'); oldLease.entry.ready = true; oldLease.entry.width = 600
oldPool.release(oldLease)
assert.equal(oldPool.stats().entries, 0, 'browsers without atomic moves keep the reload-on-remount fallback')
console.log('Frame pool: exact identity, ownership, focus release, no detach/reload, bounded eviction and older-browser fallback passed')
