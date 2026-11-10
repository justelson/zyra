/** Keep presentation, a chosen decision, and canonical resolution separate. */
export class TuiApprovals {
  constructor({ send, available, report }) {
    this.send = send; this.available = available; this.report = report;
    this.pending = new Map(); this.resolved = new Set(); this.handler = null;
    this.flushing = false; this.disposed = false; this.retry = null;
  }
  receive(event) {
    const id = String(event?.requestId || '');
    if (!id || this.disposed || this.resolved.has(id)) return;
    if (!this.pending.has(id)) this.pending.set(id, { event, controller: null, decision: null, attempts: 0 });
    this.present(id); void this.flush();
  }
  setHandler(handler) {
    this.handler = typeof handler === 'function' ? handler : null;
    if (this.handler) for (const id of this.pending.keys()) this.present(id);
  }
  present(id) {
    const item = this.pending.get(id);
    if (!this.handler || !item || item.controller || item.decision || this.disposed) return;
    const controller = item.controller = new AbortController();
    const handler = this.handler;
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      try {
        const decision = await handler(item.event, { signal: controller.signal });
        if (controller.signal.aborted || this.pending.get(id) !== item) return;
        if (!['acceptOnce', 'acceptForSession', 'decline'].includes(decision)) throw new Error('No approval decision was selected.');
        item.decision = decision;
        await this.flush();
      } catch (error) {
        if (!controller.signal.aborted) this.report(`Approval needs attention: ${error?.message || error}`);
      } finally { if (item.controller === controller) item.controller = null; }
    });
  }
  resolve(id) {
    id = String(id || ''); if (!id) return;
    this.pending.get(id)?.controller?.abort(); this.pending.delete(id); this.resolved.add(id);
    if (this.resolved.size > 512) this.resolved.delete(this.resolved.values().next().value);
  }
  reconcile(events) {
    const ids = new Set(events.filter(event => event?.type === 'approval_requested').map(event => String(event.requestId)));
    for (const id of this.pending.keys()) if (!ids.has(id)) this.resolve(id);
    for (const event of events) if (event?.type === 'approval_requested') this.receive(event);
  }
  async flush() {
    if (this.flushing || this.disposed || !this.available()) return;
    clearTimeout(this.retry); this.retry = null; this.flushing = true;
    try {
      for (const [id, item] of this.pending) {
        if (!item.decision || item.delivered || this.disposed || !this.available()) continue;
        try {
          await this.send({ requestId: id, decision: item.decision });
          item.delivered = true;
        } catch (error) {
          if (['AGENT_SERVER_APPROVAL_UNKNOWN', 'AGENT_SERVER_APPROVAL_ALREADY_ANSWERED'].includes(error?.code)) { this.resolve(id); continue; }
          item.attempts++;
          this.report('Approval reply was not confirmed. The selected decision is retained for delivery.');
          if (item.attempts < 4) {
            this.retry = setTimeout(() => { this.retry = null; void this.flush(); }, Math.min(2_000, 250 * 2 ** item.attempts));
            this.retry.unref?.();
          }
          break;
        }
      }
    } finally { this.flushing = false; }
  }
  dispose() {
    this.disposed = true; clearTimeout(this.retry);
    for (const item of this.pending.values()) item.controller?.abort();
    this.pending.clear(); this.resolved.clear();
  }
}
