import { AgentBridgeWorker } from './bridge-worker.mjs';

/** One unbound worker amortizes module loading without sharing chat state. */
export class SessionWorkerPool {
  constructor(root, createWorker = input => new AgentBridgeWorker(input)) {
    this.root = root;
    this.createWorker = createWorker;
    this.spare = null;
    this.disposed = false;
  }

  prepare() {
    if (this.disposed || this.paused || this.spare) return;
    const worker = this.createWorker({ root: this.root, cwd: this.root });
    this.spare = worker;
    // Never make acquisition await discovery or a separate warmup deadline.
    // Concurrent connect shares the bridge's in-flight module imports.
    void worker.request('prepare', {}, { timeoutMs: 60_000 }).catch(() => {
      if (this.spare !== worker) return;
      this.spare = null;
      worker.dispose('Session preparation failed.');
    });
  }

  acquire(input) {
    if (this.disposed || this.paused) throw new Error('Session worker pool is closed for an update.');
    const worker = this.spare;
    this.spare = null;
    if (!worker?.isAlive()) worker?.dispose('Prepared session worker exited.');
    const acquired = worker?.isAlive() ? worker : this.createWorker(input);
    return acquired;
  }

  dispose(reason) {
    this.disposed = true;
    this.spare?.dispose(reason);
    this.spare = null;
  }
}
