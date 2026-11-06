import { normalizeCanonicalMessageSourceId } from './message-identity.mjs';

export function readUserTurnRootMessageId(message) {
  const value = message?.zyraUserTurn;
  return message?.role === 'user' && value?.version === 1
    && typeof value.rootMessageId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/.test(value.rootMessageId)
    ? value.rootMessageId : null;
}

/** Runs before SessionManager persists message_end. No prompt text is copied.
 * Steering is another user message within the same agent run; a terminal end
 * releases the root so a later prompt starts a separate task. */
export function createUserTurnContinuity() {
  let running = false;
  let rootMessageId = null;
  let lastMessageId = null;
  const pendingSteers = [];
  return {
    expectSteeringMessage() {
      const token = Symbol('steer');
      pendingSteers.push(token);
      return () => {
        const index = pendingSteers.indexOf(token);
        if (index >= 0) pendingSteers.splice(index, 1);
      };
    },
    observe(event) {
      if (event?.type === 'agent_start') { running = true; return; }
      if (event?.type === 'agent_end' && event.willRetry !== true) {
        running = false;
        rootMessageId = null;
        lastMessageId = null;
        pendingSteers.length = 0;
        return;
      }
      const message = event?.message;
      if (!running || !['message_start', 'message_end'].includes(event?.type) || message?.role !== 'user') return;
      const timestamp = Number(message.timestamp);
      const sourceId = message.zyraCanonicalMessage?.canonicalMessageId
        || (Number.isFinite(timestamp) && timestamp > 0 ? `zyra-message:user:${Math.trunc(timestamp)}` : message.id);
      const messageId = normalizeCanonicalMessageSourceId(sourceId);
      if (typeof messageId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/.test(messageId)) return;
      if (messageId !== lastMessageId) {
        if (rootMessageId && pendingSteers.length) pendingSteers.shift();
        else rootMessageId = messageId;
        lastMessageId = messageId;
      }
      message.zyraUserTurn = { version: 1, rootMessageId };
    }
  };
}
