import { Type } from 'typebox';
import { redactSecretText } from './secret-redaction.mjs';

export const normalizeNotificationText = (value, limit) => typeof value === 'string'
  ? redactSecretText(value)
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [REDACTED_SECRET]')
    .replace(/((?:password|secret|access[_-]?token|api[_-]?key|authorization)\s*[=:]\s*)[^\s,;&]+/gi, '$1[REDACTED_SECRET]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) : '';

export function normalizeUserNotification(input) {
  const title = normalizeNotificationText(input?.title, 80), body = normalizeNotificationText(input?.body, 400);
  if (!['completed', 'input', 'update'].includes(input?.kind) || !title || !body) throw new Error('Provide a notification kind, a specific headline and a useful short summary.');
  return { kind: input.kind, title, body };
}

/** Content only. The canonical chat owns delivery, timing, focus and deduplication. */
export function createUserNotificationTool(onNotification) {
  return {
    name: 'notify_user', label: 'Notify user', executionMode: 'sequential',
    description: 'Prepare an informative notification for this chat. Use completed before the final answer after verifying the work, input before request_user_input, or update for a meaningful milestone during lengthy work. State the concrete result or decision needed and the next useful action. Completion is delivered only after the turn actually succeeds. Viewing and OS notification preferences still apply. Never include credentials or sensitive excerpts. Does not send messages to anyone else or open windows.',
    parameters: Type.Object({
      kind: Type.Union([Type.Literal('completed'), Type.Literal('input'), Type.Literal('update')]),
      title: Type.String({ minLength: 1, maxLength: 80, description: 'Specific outcome or decision, e.g. Preview build ready or Choose the deployment target.' }),
      body: Type.String({ minLength: 1, maxLength: 400, description: 'One or two useful sentences with the result, evidence or question and next action. Do not repeat the chat title or say only Done.' }),
    }, { additionalProperties: false }),
    async execute(id, input, signal) {
      signal?.throwIfAborted();
      await onNotification({ ...normalizeUserNotification(input), id });
      return { content: [{ type: 'text', text: 'Notification content prepared. Delivery follows the chat state and viewing preferences.' }], details: { hiddenFromTimeline: true } };
    },
  };
}
