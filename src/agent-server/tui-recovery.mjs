import { normalizeCanonicalMessageSourceId } from '../message-identity.mjs';

/** Snapshot history may already contain completions delivered during its read. */
export function tuiHistoryCoverage(entries) {
  const messages = new Set(), tools = new Set();
  for (const entry of entries || []) {
    const message = entry?.message;
    if (!message) continue;
    const id = normalizeCanonicalMessageSourceId(message.id || entry.id);
    if (id) messages.add(id);
    if (message.role === 'toolResult' && (message.toolCallId || message.tool_call_id)) tools.add(message.toolCallId || message.tool_call_id);
  }
  return { messages, tools };
}

export function isCoveredTuiEvent(event, coverage) {
  if (event?.message?.id && ['message_start', 'message_update', 'message_end'].includes(event.type)) {
    return coverage.messages.has(normalizeCanonicalMessageSourceId(event.message.id));
  }
  return Boolean(event?.toolCallId && coverage.tools.has(event.toolCallId) && String(event.type).startsWith('tool_execution_'));
}

export function normalizeTuiQueue(value) {
  return {
    steering: Array.isArray(value?.steering) ? value.steering.filter(item => typeof item === 'string') : [],
    followUp: Array.isArray(value?.followUp) ? value.followUp.filter(item => typeof item === 'string') : []
  };
}

export function tuiSnapshotEvents(snapshot, historyEvents, coverage) {
  const events = [...historyEvents];
  if (snapshot.presence?.latestTurn?.state === 'running' || snapshot.activeRequestContext?.turnId) events.push({ type: 'turn_start', recovered: true });
  for (const entry of snapshot.pendingOperations || []) if (entry?.event) events.push(entry.event);
  if (snapshot.liveMessage && !coverage.messages.has(normalizeCanonicalMessageSourceId(snapshot.liveMessage.id))) {
    events.push({ type: 'message_start', message: snapshot.liveMessage }, { type: 'message_update', message: snapshot.liveMessage });
  }
  for (const event of snapshot.pendingTools || []) if (!isCoveredTuiEvent(event, coverage)) events.push(event);
  return events;
}
