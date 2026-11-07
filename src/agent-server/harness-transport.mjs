/** The canonical server owns one local harness transport across chat workers. */
export class HarnessTransport {
  constructor(cwd, loadHarness = () => import('../opencode-harness.mjs')) {
    this.cwd = cwd;
    this.loadHarness = loadHarness;
    this.pending = null;
    this.preparation = null;
    this.lease = null;
    this.disposed = false;
    this.projects = new Map();
  }

  async get() {
    if (this.disposed) throw new Error('Harness transport is closed.');
    if (this.lease) {
      const currentLease = this.lease;
      const { harnessServeStatus } = await this.loadHarness();
      if (this.lease === currentLease && !harnessServeStatus(this.cwd).running) {
        currentLease.release();
        this.lease = null;
        this.pending = null;
        this.preparation = null;
        this.projects.clear();
      }
    }
    if (this.disposed) throw new Error('Harness transport is closed.');
    if (!this.pending) {
      this.pending = this.create().catch(error => { this.pending = null; throw error; });
    }
    return this.pending;
  }

  async create() {
    const { prepareHarnessServe, ensureHarnessServe, findHarnessExecutable } = await this.loadHarness();
    const executable = findHarnessExecutable();
    let lease;
    try {
      lease = await ensureHarnessServe({ cwd: this.cwd, executable });
    } catch (error) {
      const { stopHarnessServe } = await this.loadHarness();
      await stopHarnessServe(this.cwd);
      throw error;
    }
    if (this.disposed) { lease.release(); throw new Error('Harness transport is closed.'); }
    this.lease = lease;
    // Project initialization and the worker's chat setup can overlap. Only
    // explicit background preparation waits for the empty project session.
    this.preparation = prepareHarnessServe({ cwd: this.cwd, executable });
    void this.preparation.catch(() => {});
    // This descriptor travels only on the private bridge pipe, never in the
    // canonical catalog, events, connected result, or renderer response.
    return { baseUrl: lease.baseUrl, password: lease.client.password, ...(lease.client.apiVersion === 2 ? { apiVersion: 2 } : {}) };
  }

  async prepare() {
    await this.get();
    await this.preparation;
    return { prepared: true };
  }

  async prepareProject(cwd) {
    const descriptor = await this.get();
    const directory = String(cwd || this.cwd);
    if (directory === this.cwd) { await this.preparation; return descriptor; }
    if (!this.projects.has(directory)) {
      // Directory has already passed canonical attachment authorization.
      const preparation = this.loadHarness().then(({ prepareHarnessClient }) => prepareHarnessClient({ ...descriptor, cwd: directory }))
        .catch(error => { if (this.projects.get(directory) === preparation) this.projects.delete(directory); throw error; });
      this.projects.set(directory, preparation);
      if (this.projects.size > 32) this.projects.delete(this.projects.keys().next().value);
    }
    await this.projects.get(directory);
    return descriptor;
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (!this.pending && !this.lease) return;
    await this.pending?.catch(() => {});
    this.lease?.release();
    const { stopHarnessServe } = await this.loadHarness();
    await stopHarnessServe(this.cwd);
    await this.preparation?.catch(() => {});
    await Promise.allSettled([...this.projects.values()]);
    this.projects.clear();
    this.lease = null;
  }
}
