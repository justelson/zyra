import { randomUUID } from 'node:crypto';
import { HistoryMedia } from './history-media.mjs';
import { fault } from './errors.mjs';
import { actionArgsPreview, actionSurfacePreview } from './action-preview.mjs';
export const INLINE_BYTES = 32 * 1024;
export const MAX_FRAME_BYTES = 256 * 1024;
export class BodyCache {
  constructor({ budget = 16 * 1024 * 1024, ttl = 600000, now = Date.now } = {}) {
    this.media = new HistoryMedia(); this.items = new Map(); this.bytes = 0; this.budget = budget; this.ttl = ttl; this.now = now;
  }
  prune() {
    for (const [id, item] of this.items) if (item.expires <= this.now()) { this.items.delete(id); this.bytes -= item.data.length; }
  }
  clearOwner(owner) {
    for (const [id, item] of this.items) if (item.owner === owner) { this.items.delete(id); this.bytes -= item.data.length; }
  }
  put(owner, value) {
    this.prune();
    const data = Buffer.from(JSON.stringify(value));
    if (data.length > this.budget) return { unavailable: true, bytes: data.length, reason: 'Open this output on the PC.' };
    while (this.bytes + data.length > this.budget) { const [id, item] = this.items.entries().next().value; this.items.delete(id); this.bytes -= item.data.length; }
    const id = randomUUID(); this.items.set(id, { owner, data, expires: this.now() + this.ttl }); this.bytes += data.length;
    return { bodyId: id, bytes: data.length };
  }
  chunk(owner, id, offset = 0) {
    this.prune(); const item = this.items.get(id);
    if (!item || item.owner !== owner) throw fault('BODY_EXPIRED', 'Output is unavailable. Refresh its source and try again.');
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > item.data.length) throw fault('INVALID_REQUEST', 'Invalid output offset.');
    const end = Math.min(offset + 48 * 1024, item.data.length);
    return { base64: item.data.subarray(offset, end).toString('base64'), next: end, total: item.data.length };
  }
  project(owner, value) {
    if (Buffer.byteLength(JSON.stringify(value)) <= INLINE_BYTES) return value;
    return { deferred: this.put(owner, value) };
  }
}
export function mobileEvent(message, owner, cache) {
  const event = message.event || {};
  const delta = event.assistantMessageEvent;
  // Pi emits the accumulated message with every delta. Only send the new text.
  const projected = hiddenMessage(event.message) ? { type: 'message_hidden' }
    : event.type === 'message_update' && ['text_delta', 'thinking_delta'].includes(delta?.type)
    ? { type: delta.type, delta: delta.delta, contentIndex: delta.contentIndex }
    : projectEvent(event, owner, cache, message.sessionKey);
  return { type: 'session.event', sessionKey: message.sessionKey, sequence: message.sequence,
    occurredAt: message.occurredAt, requestContext: message.requestContext, event: projected };
}
export function replayGap(after, latest, replay) {
  return after > latest || (latest > after && (!replay.length || replay[0].sequence > after + 1));
}

export function projectEvent(event, owner, cache, chat) {
  // Internal context still reaches the agent, but never becomes a mobile body or delta.
  // Retain an empty envelope so replay cursors remain contiguous.
  if (hiddenMessage(event.message)) return { type: 'message_hidden' };
  if (chat) event = cache.media.project(owner, chat, event);
  const projected = cache.project(owner, event);
  if (!projected?.deferred) return projected;
  const message = event.message;
  const preview = message && typeof message === 'object' ? {
    role: message.role, id: message.id, timestamp: message.timestamp, toolCallId: message.toolCallId,
    ...(message.zyraUserTurn?.version === 1 && typeof message.zyraUserTurn.rootMessageId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/.test(message.zyraUserTurn.rootMessageId)
      ? { zyraUserTurn: { version: 1, rootMessageId: message.zyraUserTurn.rootMessageId } } : {}),
    toolName: message.toolName, isError: message.isError, display: message.display, customType: message.customType,
    content: typeof message.content === 'string' ? message.content.slice(0, 4096) : Array.isArray(message.content)
      ? message.content.slice(0, 24).map(part => part?.type === 'image' && part.mediaRef ? part
        : part?.type === 'text' ? { type: 'text', text: String(part.text || '').slice(0, 1024) }
        : part?.type === 'toolCall' ? { type: 'toolCall', id: String(part.id || '').slice(0, 128), name: String(part.name || '').slice(0, 96), arguments: actionArgsPreview(part.arguments) }
        : { type: 'text', text: '' }) : []
  } : undefined;
  return { ...projected, ...(preview ? { message: preview } : {}), type: event.type, requestId: event.requestId, toolCallId: event.toolCallId, toolName: event.toolName,
    ...(event.args ? { args: actionArgsPreview(event.args) } : {}), surface: actionSurfacePreview(event.surface), isError: event.isError,
    command: typeof event.command === 'string' ? event.command.slice(0, 1000) : undefined,
    description: typeof event.description === 'string' ? event.description.slice(0, 1000) : undefined,
    outcome: event.outcome, willRetry: event.willRetry,
    timingStartedAt: Number.isFinite(event.timingStartedAt) ? event.timingStartedAt : undefined,
    ...(event.interruption?.kind === 'stopped' ? { interruption: { kind: 'stopped', source: 'user' } } : {}),
    // Oversized failure details stay deferred; retain lifecycle fields so the
    // activity row still settles without fetching or rendering the raw output.
    reason: typeof event.reason === 'string' ? event.reason.slice(0, 256) : undefined,
    errorMessage: typeof event.errorMessage === 'string' ? event.errorMessage.slice(0, 1000) : undefined,
    finalError: typeof event.finalError === 'string' ? event.finalError.slice(0, 1000) : undefined,
    recoveryKind: event.recoveryKind, attempt: event.attempt, maxAttempts: event.maxAttempts,
    delayMs: event.delayMs, success: event.success, aborted: event.aborted,
    ...(event.type === 'compaction_end' && event.result ? { result: {
      tokensBefore: event.result.tokensBefore, estimatedTokensAfter: event.result.estimatedTokensAfter,
    } } : {}) };
}

function hiddenMessage(message) {
  return message?.display === false || (message?.role === 'custom' && message.display !== true);
}
