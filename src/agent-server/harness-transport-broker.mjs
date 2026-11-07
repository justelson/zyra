/** Private parent/worker RPC, separate from public canonical events. */
export class HarnessTransportBrokerClient {
  constructor(send, timeoutMs = 30_000) { this.send = send; this.timeoutMs = timeoutMs; this.pending = new Map(); this.nextId = 1; this.closed = false; }
  get() {
    if (this.closed) return Promise.reject(Error('Shared harness worker closed.'));
    if (this.pending.size >= 128) return Promise.reject(Error('Shared harness request queue is full.'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error('Shared harness transport timed out.')); }, this.timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ type: 'harness.transport.request', id }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  handleResponse(message) {
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id); clearTimeout(pending.timer);
    if (message.error) pending.reject(Error(message.error));
    else pending.resolve(message.transport);
  }
  dispose() {
    this.closed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(Error('Shared harness worker closed.')); }
    this.pending.clear();
  }
}

export function borrowedHarnessHooks(resolveTransport) {
  return { executable: 'server-owned-harness', ensureServe: async ({ cwd } = {}) => {
    const transport = await resolveTransport();
    if (!transport?.baseUrl || !transport.password || transport.deferred) throw Error('The server-owned harness transport is still starting.');
    return { baseUrl: transport.baseUrl, client: { baseUrl: transport.baseUrl, password: transport.password, cwd, ...(transport.apiVersion === 2 ? { apiVersion: 2 } : {}) }, release() {} };
  } };
}
