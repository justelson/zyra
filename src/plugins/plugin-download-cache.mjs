// Session-only cache. The downloader validates pinned content before storing it
// and revalidates hits. Review IDs and installation approvals are never cached.
const MAX_BYTES = 16 * 1024 * 1024
const MAX_ENTRIES = 512
const TTL_MS = 15 * 60_000
const KEY = /^blob:[a-f0-9]{40}$/

export class PluginDownloadCache {
  constructor({ maxBytes = MAX_BYTES, maxEntries = MAX_ENTRIES, ttlMs = TTL_MS, now = Date.now } = {}) {
    this.maxBytes = Math.max(0, Math.min(MAX_BYTES, Math.trunc(maxBytes) || 0))
    this.maxEntries = Math.max(0, Math.min(MAX_ENTRIES, Math.trunc(maxEntries) || 0))
    this.ttlMs = Math.max(1, Math.min(TTL_MS, Number(ttlMs) || TTL_MS))
    this.now = now
    this.entries = new Map()
    this.bytes = 0
  }

  get(key) {
    const entry = this.entries.get(key)
    if (!entry) return null
    if (entry.expiresAt <= this.now()) { this.delete(key); return null }
    this.entries.delete(key)
    this.entries.set(key, entry)
    return Buffer.from(entry.bytes)
  }

  set(key, bytes) {
    if (!KEY.test(key) || !Buffer.isBuffer(bytes) || bytes.length > this.maxBytes || !this.maxEntries) return false
    for (const [id, entry] of this.entries) if (entry.expiresAt <= this.now()) this.delete(id)
    this.delete(key)
    while (this.entries.size >= this.maxEntries || this.bytes + bytes.length > this.maxBytes) this.delete(this.entries.keys().next().value)
    this.entries.set(key, { bytes: Buffer.from(bytes), expiresAt: this.now() + this.ttlMs })
    this.bytes += bytes.length
    return true
  }

  delete(key) {
    const entry = this.entries.get(key)
    if (!entry) return
    this.bytes -= entry.bytes.length
    this.entries.delete(key)
  }

  clear() { this.entries.clear(); this.bytes = 0 }
}
