import { stripAnsi } from '../tui/render-utils.mjs';

const plain = value => stripAnsi(String(value || '')).replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*_#>]/g, '').replace(/\s+/g, ' ').trim();

/** Observe text included in an actual terminal write, not an incoming event. */
export class TerminalTimingDisplay {
  constructor(displayed) { this.displayed = displayed; this.pending = new Map(); this.reported = new Set(); }
  observe(event) {
    if (!event?.timingTurnId || event.historical || this.pending.has(event.timingTurnId) || this.reported.has(event.timingTurnId)) return;
    const message = event.message;
    if (message?.role !== 'assistant') return;
    const text = typeof message.content === 'string' ? message.content : (message.content || []).filter(part => part.type === 'text').map(part => part.text).join(' ');
    const sample = plain(text).slice(0, 40);
    if (sample) this.pending.set(event.timingTurnId, sample);
    while (this.pending.size > 64) this.pending.delete(this.pending.keys().next().value);
  }
  written(lines) {
    if (!this.pending.size) return;
    const visible = plain(lines.join(' '));
    for (const [id, sample] of this.pending) if (visible.includes(sample)) {
      this.displayed(id); this.pending.delete(id); this.reported.add(id);
      if (this.reported.size > 200) this.reported.delete(this.reported.values().next().value);
    }
  }
}
