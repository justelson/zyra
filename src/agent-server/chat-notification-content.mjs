import { normalizeNotificationText, normalizeUserNotification } from '../user-notification-tool.mjs';

const clean = (value, limit) => normalizeNotificationText(String(value || '').replace(/```[\s\S]*?```/g, '')
  .replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/^[#>*\s-]+/gm, '').replace(/[`*_]/g, ''), limit);

/** Turn-scoped drafts never create a completion edge themselves. */
export class ChatNotificationContent {
  constructor() { this.turnId = null; this.drafts = new Map(); this.finalText = ''; this.updates = 0; this.lastUpdateAt = 0; }

  observe(turnId, event, now) {
    if (turnId !== this.turnId) {
      this.turnId = turnId; this.drafts.clear(); this.finalText = ''; this.updates = 0; this.lastUpdateAt = 0;
    }
    if (event.type === 'auto_retry_start') { this.drafts.clear(); this.finalText = ''; }
    if (event.type === 'message_end' && event.message?.role === 'assistant'
      && ['stop', 'length'].includes(event.message.stopReason)) {
      const content = event.message.content;
      this.finalText = clean(typeof content === 'string' ? content : (content ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n'), 400);
    }
    if (event.type !== 'session_notification') return null;
    const content = normalizeUserNotification(event);
    if (content.kind !== 'update') { this.drafts.set(content.kind, content); return null; }
    if (this.updates >= 3 || this.updates > 0 && now - this.lastUpdateAt < 30_000) return null;
    this.updates++; this.lastUpdateAt = now;
    return content;
  }

  take(kind, event) {
    const authored = this.drafts.get(kind);
    this.drafts.delete(kind);
    if (authored) return authored;
    if (kind === 'completed' && this.finalText) return { title: 'Work completed', body: this.finalText };
    if (kind === 'input') {
      const question = event.questions?.[0];
      const body = clean(question?.question || question?.prompt || question?.title, 400);
      if (body) return { title: clean(question?.header, 80) || 'Your input is needed', body };
    }
    if (kind === 'approval') {
      const body = clean(event.detail || event.grantLabel, 400);
      if (body) return { title: clean(event.title, 80) || 'Your approval is needed', body };
    }
    return null;
  }
}
