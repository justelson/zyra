const VIEW_LEASE_MS = 35_000;
const MAX_RECEIPTS = 2048;

/** Viewing is explicit and expires; an attached background worker is never a reader. */
export class CanonicalChatAttention {
  constructor(server, options = {}) {
    this.server = server;
    this.now = options.now || Date.now;
    this.views = new Map();
    this.receipts = new Map();
  }
  report(client, canonicalChatId, input) {
    const key = `${client.connectionId || client.clientId}:${input.viewId || 'main'}`;
    const previous = this.views.get(key);
    const surface = client.surface === 'desktop' && input.surface === 'browser' ? 'browser' : client.surface;
    if (input.viewing === true) this.views.set(key, { client, surface, canonicalChatId, expiresAt: this.now() + VIEW_LEASE_MS });
    else if (previous?.canonicalChatId === canonicalChatId) this.views.delete(key);
    const turn = this.server.sessions.get(canonicalChatId)?.latestTurn;
    if (input.viewing === true && turn && ['completed', 'interrupted'].includes(turn.state)) this.acknowledge(canonicalChatId, turn.id, turn.completedAt);
    else if (input.viewing === true && !turn && typeof input.seenTurnId === 'string' && input.seenTurnId.length <= 256) this.acknowledge(canonicalChatId, input.seenTurnId, input.seenCompletedAt);
    if (previous?.canonicalChatId !== (input.viewing ? canonicalChatId : undefined)) {
      for (const id of new Set([previous?.canonicalChatId, canonicalChatId].filter(Boolean))) this.server.broadcastCatalogChanged({ canonicalChatId: id, presence: true });
    }
    return { viewing: this.isViewed(canonicalChatId), lastSeenCompletedTurnId: this.server.catalog.record?.metadata?.[canonicalChatId]?.lastSeenCompletedTurnId || null };
  }
  viewers(canonicalChatId) {
    const clients = new Map();
    for (const [key, view] of this.views) {
      if (view.expiresAt <= this.now() || view.client.socket?.writable === false) { this.views.delete(key); continue; }
      if (view.canonicalChatId === canonicalChatId) clients.set(`${view.client.clientId}:${view.surface}`, { clientId: view.client.clientId, surface: view.surface });
    }
    return [...clients.values()];
  }
  isViewed(id) { return this.viewers(id).length > 0; }
  drop(client) {
    const affected = new Set();
    for (const [key, view] of this.views) if (view.client === client) { this.views.delete(key); affected.add(view.canonicalChatId); }
    for (const id of affected) this.server.broadcastCatalogChanged({ canonicalChatId: id, presence: true });
  }
  acknowledge(id, turnId, completedAt) {
    if (!this.server.catalog.markCompletionSeen?.(id, turnId, completedAt)) return;
    this.server.broadcastCatalogChanged({ canonicalChatId: id, readState: true, presence: true });
  }
  observe(session, event) {
    const id = session.sessionKey;
    const turn = session.latestTurn;
    const ended = ['agent_end', 'zyra_server_turn_completed'].includes(event?.type) && event.willRetry !== true;
    if (ended && turn && ['completed', 'interrupted'].includes(turn.state) && this.isViewed(id)) this.acknowledge(id, turn.id, turn.completedAt);
    const kind = event?.type === 'user_input_requested' ? 'input' : event?.type === 'approval_requested' ? 'approval' : ended && turn?.state === 'completed' ? 'completed' : null;
    if (!kind) return;
    const token = `${id}:${kind}:${kind === 'completed' ? turn.id : event.requestId}`;
    if (this.receipts.has(token)) return;
    this.receipts.set(token, this.now());
    if (this.receipts.size > MAX_RECEIPTS) this.receipts.delete(this.receipts.keys().next().value);
    if (this.isViewed(id) || kind === 'completed' && this.server.catalog.record?.metadata?.[id]?.lastSeenCompletedTurnId === turn.id) return;
    const desktop = [...this.server.clients.values()].find(client => client.authenticated && client.canOpenWorkspace && client.socket?.writable);
    if (desktop) this.server.send(desktop, { type: 'chat.attention', canonicalChatId: id, kind, token, turnId: turn?.id || null, occurredAt: new Date(this.now()).toISOString() });
  }
}
