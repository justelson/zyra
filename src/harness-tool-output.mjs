/** Reconcile native deltas with snapshots without repeating prior tool-step text. */
export class HarnessToolOutput {
  constructor(offsets, publish, publishDelta) { this.offsets = offsets; this.publish = publish; this.publishDelta = publishDelta; this.parts = new Map(); this.events = new Set(); this.unknown = new Set(); }
  content() { return [...this.parts.values()].map(part => part.type === 'text' ? { type: 'text', text: part.text } : { type: 'thinking', thinking: part.text }); }
  delta(event) {
    const data = event.data;
    const match = /^session\.(text|reasoning)\.(started|delta|ended)$/.exec(event.type);
    if (!match || typeof data?.assistantMessageID !== 'string' || !Number.isSafeInteger(data.ordinal)) return false;
    if (event.id) {
      if (this.events.has(event.id)) return false;
      this.events.add(event.id);
      if (this.events.size > 2048) this.events.delete(this.events.values().next().value);
    }
    const key = `${data.assistantMessageID}:${match[1]}:${data.ordinal}`;
    if (match[2] === 'started') {
      if (!this.parts.has(key) && !this.offsets.has(key)) this.parts.set(key, { type: match[1], text: '', streaming: true });
      return false;
    }
    const part = this.parts.get(key);
    if (match[2] === 'ended') {
      if (typeof data.text !== 'string') return false;
      this.parts.set(key, { type: match[1], text: data.text.slice(this.offsets.get(key) ?? 0), streaming: false });
      this.publish?.(this.content());
      return true;
    }
    if (typeof data.delta !== 'string') return false;
    // A reconnect can miss the prefix. Recover it once before applying deltas.
    if (!part) { const fresh = !this.unknown.has(key); this.unknown.add(key); return fresh; }
    // Only a live Started boundary establishes an unambiguous delta prefix.
    // Snapshots can already contain an in-flight delta; use snapshots for parts
    // whose start was missed, and never append those same deltas a second time.
    if (!part.streaming) return false;
    part.text += data.delta;
    if (this.publishDelta) this.publishDelta(part.type, data.delta);
    else this.publish?.(this.content());
    return false;
  }
  snapshot(messages) {
    for (const message of messages) {
      const ordinals = { text: 0, reasoning: 0 };
      for (const part of message.content ?? []) {
        if (!['text', 'reasoning'].includes(part.type) || typeof part.text !== 'string') continue;
        const key = `${message.id}:${part.type}:${ordinals[part.type]++}`;
        const text = part.text.slice(this.offsets.get(key) ?? 0);
        const previous = this.parts.get(key);
        if (previous?.streaming && !message.time?.completed) continue;
        if (!previous || text.startsWith(previous.text)) this.parts.set(key, { type: part.type, text, streaming: false });
      }
    }
    const content = this.content(); this.publish?.(content); return content;
  }
  commit() { for (const [key, part] of this.parts) this.offsets.set(key, (this.offsets.get(key) ?? 0) + part.text.length); }
  disconnected() { for (const part of this.parts.values()) part.streaming = false; }
}
