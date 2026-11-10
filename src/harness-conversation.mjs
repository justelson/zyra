import { createHash } from 'node:crypto';
import { HarnessToolConversation } from './harness-tool-turn.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value) ?? 'null').digest('hex');

/** One runtime owns one native conversation. Never shared between chats. */
export class HarnessConversation {
  constructor({ idleMs = 5 * 60_000 } = {}) {
    this.idleMs = idleMs;
    this.record = null;
    this.busy = false;
    this.disposed = false;
    this.tools = new HarnessToolConversation({ idleMs });
  }

  async acquire({ client, identity, history, create, remove }) {
    if (this.disposed) throw new Error('Harness conversation is closed.');
    if (this.busy) throw new Error('Harness conversation already has an active turn.');
    this.busy = true;
    clearTimeout(this.timer);
    try {
      // OpenCode uses the latest user message's system field on every request.
      // Updated memory/guides do not change ownership or require history replay.
      const key = digest([client.baseUrl, client.password, client.cwd, identity[0], identity[1], identity[3]]);
      const previous = this.record;
      const identityMatches = previous?.identityDigest === digest(identity);
      const identityChanges = Object.fromEntries(['modelChanged', 'effortChanged', 'systemChanged', 'toolsChanged'].map((field, i) => [field,
        Boolean(previous) && previous.identityParts?.[i] !== digest(identity[i])]));
      const historyMatches = previous?.historyDigest === digest(history);
      const canReuse = this.record?.key === key && this.record.historyDigest === digest(history);
      if (!canReuse) {
        await this.clear();
        const id = await create();
        this.record = { id, key, remove, identityDigest: digest(identity), identityParts: identity.map(digest), historyDigest: null, historySize: 0 };
      }
      if (this.disposed) { await this.clear(); throw new Error('Harness conversation is closed.'); }
      return { id: this.record.id, history: canReuse ? [] : history, reused: canReuse,
        priorRecord: Boolean(previous), identityMatches, historyMatches, ...identityChanges, expectedHistoryEntries: previous?.historySize ?? 0, historyEntries: history.length };
    } catch (error) {
      this.busy = false;
      throw error;
    }
  }

  async finish(history, success) {
    try {
      if (!success || this.disposed) await this.clear();
      else if (this.record) {
        this.record.historyDigest = digest(history);
        this.record.historySize = history.length;
        this.timer = setTimeout(() => { void this.clear(); }, this.idleMs);
        this.timer.unref?.();
      }
    } finally { this.busy = false; }
  }

  async clear() {
    clearTimeout(this.timer);
    const record = this.record;
    this.record = null;
    if (record) await record.remove(record.id).catch(() => {});
  }

  dispose() {
    if (!this.disposal) {
      this.disposed = true;
      this.disposal = Promise.all([this.clear(), this.tools.dispose()]);
    }
    return this.disposal;
  }
}
