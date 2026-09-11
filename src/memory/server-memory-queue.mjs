import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export function readMemoryJobHistory(file) {
  try { const value = JSON.parse(readFileSync(file, "utf8")); return { lastSuccessAt: value.lastSuccessAt || null, lastCheckedAt: value.lastCheckedAt || null, lastError: value.lastError || null }; }
  catch { return {}; }
}
export function writeMemoryJobStatus(file, status) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify({ ...status, pid: process.pid, updatedAt: Date.now() }), { mode: 0o600 });
  renameSync(temporary, file);
}

/** One cancellable memory job for the whole server. Foreground work always wins. */
export class ServerMemoryQueue {
  constructor({ run, onStatus = () => {}, history = {}, idleMs = 60_000, cooldownMs = 900_000, retryMs = [30_000, 120_000], now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
    Object.assign(this, { run, onStatus, idleMs, cooldownMs, retryMs, now, setTimer, clearTimer });
    this.pending = new Map(); this.busy = new Set(); this.cooldowns = new Map(); this.removed = new WeakSet();
    this.active = null; this.timer = null; this.disposed = false;
    this.lastSuccessAt = history.lastSuccessAt || null; this.lastCheckedAt = history.lastCheckedAt || null; this.lastError = history.lastError || null;
    this.notify();
  }
  snapshot() {
    return { phase: this.disposed ? "offline" : this.active ? "running" : this.pending.size ? "waiting" : this.lastError ? "error" : "idle", queued: this.pending.size, lastSuccessAt: this.lastSuccessAt, lastCheckedAt: this.lastCheckedAt, lastError: this.lastError };
  }
  notify() { this.onStatus(this.snapshot()); }
  observe(session, busy, eligible = true) {
    if (this.disposed || this.removed.has(session)) return;
    if (busy) {
      this.busy.add(session); this.pending.delete(session);
      this.active?.controller.abort();
    } else {
      this.busy.delete(session);
      if (eligible && this.active?.session !== session && !this.pending.has(session)) {
        this.pending.set(session, { due: Math.max(this.now() + this.idleMs, this.cooldowns.get(session) || 0), attempt: 0 });
      }
    }
    this.schedule();
  }
  remove(session) {
    this.removed.add(session); this.pending.delete(session); this.busy.delete(session); this.cooldowns.delete(session);
    if (this.active?.session === session) this.active.controller.abort();
    this.schedule();
  }
  schedule() {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    if (!this.disposed && !this.active && !this.busy.size && this.pending.size) {
      const [session, entry] = [...this.pending].sort((a, b) => a[1].due - b[1].due)[0];
      this.timer = this.setTimer(() => { this.timer = null; void this.execute(session, entry); }, Math.max(0, entry.due - this.now()));
      this.timer?.unref?.();
    }
    this.notify();
  }
  async execute(session, entry) {
    if (this.disposed || this.busy.size || this.active || !this.pending.has(session)) return this.schedule();
    this.pending.delete(session);
    const controller = new AbortController(); this.active = { session, controller }; this.notify();
    try {
      const result = await this.run(session, controller.signal);
      controller.signal.throwIfAborted();
      if (result?.failed) throw new Error("Memory extraction failed.");
      this.lastCheckedAt = this.now(); this.lastError = null;
      if (result?.updated) this.lastSuccessAt = this.now();
      this.cooldowns.set(session, this.now() + this.cooldownMs);
    } catch {
      if (!controller.signal.aborted) this.lastError = "Memory could not update. Check the connected model and try again after chatting.";
      if (!this.disposed && !this.removed.has(session)) {
        if (controller.signal.aborted) {
          if (!this.busy.has(session)) this.pending.set(session, { due: this.now() + this.idleMs, attempt: entry.attempt });
        } else if (entry.attempt < this.retryMs.length) {
          this.pending.set(session, { due: this.now() + this.retryMs[entry.attempt], attempt: entry.attempt + 1 });
        } else this.cooldowns.set(session, this.now() + this.cooldownMs);
      }
    } finally { this.active = null; this.schedule(); }
  }
  dispose() { this.disposed = true; this.pending.clear(); this.busy.clear(); this.active?.controller.abort(); this.schedule(); }
}
