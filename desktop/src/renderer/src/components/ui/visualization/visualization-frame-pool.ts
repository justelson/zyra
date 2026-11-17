type AtomicParent = HTMLElement & { moveBefore?: (node: Node, before: Node | null) => void }
type Entry = {
    frame: HTMLIFrameElement
    source: string
    scope: string | null
    channel: string
    initialized: boolean
    ready: boolean
    height: number
    width: number
    owner: symbol | null
}
export type VisualizationFrameLease = { entry: Entry; token: symbol }
const MAX_PARKED_FRAMES = 32
// Bounds retained source strings, not the browser's iframe heap/GPU allocation.
const MAX_PARKED_BYTES = 2 * 1024 * 1024
const pools = new WeakMap<Document, VisualizationFramePool>()

export function attachVisualizationFrame(parent: HTMLElement, frame: HTMLIFrameElement) {
    const atomic = (parent as AtomicParent).moveBefore
    if (frame.isConnected && typeof atomic === 'function') atomic.call(parent, frame, null)
    else parent.appendChild(frame)
}

export class VisualizationFramePool {
    private parked = new Map<Entry, number>()
    private parking: HTMLElement | null = null
    private bytes = 0
    private created = 0
    private reused = 0
    private disposed = 0
    private active = 0
    constructor(private owner: Document) {}

    acquire(source: string, scope: string | null): VisualizationFrameLease {
        let entry = scope ? [...this.parked.keys()].find(item => item.scope === scope && item.source === source) : undefined
        if (entry) {
            this.bytes -= this.parked.get(entry)!
            this.parked.delete(entry)
            this.reused++
        } else {
            const frame = this.owner.createElement('iframe')
            frame.setAttribute('sandbox', 'allow-scripts')
            frame.setAttribute('referrerpolicy', 'no-referrer')
            frame.loading = 'lazy'
            frame.src = './visualization-frame.html'
            frame.className = 'block w-full border-0 bg-transparent'
            entry = { frame, source, scope, channel: crypto.randomUUID(), initialized: false, ready: false, height: 0, width: 0, owner: null }
            this.created++
        }
        const token = Symbol('visualization-frame-owner')
        entry.owner = token
        entry.frame.dataset.visualizationActive = 'true'
        Object.assign(entry.frame.style, { position: '', left: '', top: '', width: '100%', height: '100%', colorScheme: 'normal' })
        this.active++
        return { entry, token }
    }

    release(lease: VisualizationFrameLease) {
        const entry = lease.entry
        if (entry.owner !== lease.token) return
        entry.owner = null
        this.active--
        entry.frame.dataset.visualizationActive = 'false'
        const bytes = entry.source.length * 2
        // Rapid scrolling can release a frame before its first height reply.
        // Keep that pending document too, so returning does not restart its load.
        if (entry.scope && entry.width <= 0) entry.width = entry.frame.clientWidth || 0
        if (!entry.ready) entry.height = entry.frame.clientHeight || entry.height
        if (!entry.frame.isConnected || !entry.scope || entry.width <= 0 || bytes > MAX_PARKED_BYTES || typeof (this.owner.body as AtomicParent).moveBefore !== 'function') {
            entry.frame.remove(); this.disposed++; return
        }
        if (!this.parking) {
            this.parking = this.owner.createElement('div')
            this.parking.dataset.visualizationFrameCache = ''
            this.parking.setAttribute('aria-hidden', 'true')
            this.parking.inert = true
            Object.assign(this.parking.style, { position: 'fixed', left: '-100000px', top: '0', width: '1px', height: '1px', overflow: 'hidden', visibility: 'hidden', pointerEvents: 'none', contain: 'strict' })
            this.owner.body.appendChild(this.parking)
        }
        if (this.owner.activeElement === entry.frame) entry.frame.blur()
        entry.frame.contentWindow?.postMessage({ type: 'zyra:visualization-park', channel: entry.channel }, '*')
        Object.assign(entry.frame.style, { position: 'absolute', left: '0', top: '0', width: `${entry.width}px`, height: `${Math.max(32, entry.height)}px` })
        attachVisualizationFrame(this.parking, entry.frame)
        this.parked.set(entry, bytes)
        this.bytes += bytes
        while (this.parked.size > MAX_PARKED_FRAMES || this.bytes > MAX_PARKED_BYTES) {
            const oldest = this.parked.keys().next().value!
            this.bytes -= this.parked.get(oldest)!
            this.parked.delete(oldest)
            oldest.frame.remove(); this.disposed++
        }
    }

    stats() { return { entries: this.parked.size, bytes: this.bytes, active: this.active, created: this.created, reused: this.reused, disposed: this.disposed, maxEntries: MAX_PARKED_FRAMES, maxBytes: MAX_PARKED_BYTES } }
}

export function visualizationFramePool(owner: Document): VisualizationFramePool {
    let pool = pools.get(owner)
    if (!pool) { pool = new VisualizationFramePool(owner); pools.set(owner, pool) }
    return pool
}
