// Timing exports contain measurements only, never conversation or account data.
const numericFields = ['sequence', 'startedAt', 'fullRequestBytes', 'requestBytes', 'fullBytes', 'deltaBytes',
  'websocketAttempts', 'sseAttempts', 'attempts', 'retries', 'latencyMs', 'firstEventMs', 'firstTextMs',
  'uncachedInput', 'cacheRead', 'cacheWrite', 'output'];
const enums = {
  model: ['gpt-6.1-sol'], effort: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  tier: ['default', 'auto', 'priority', 'flex'],
  transport: ['sse', 'websocket'], context: ['full', 'delta'], cacheOutcome: ['hit', 'miss', 'unknown'],
  outcome: ['pending', 'stop', 'length', 'toolUse', 'error', 'aborted', 'deferred'],
};

export function projectRequest(row) {
  const result = {};
  for (const key of numericFields) {
    if (row[key] === null || Number.isFinite(row[key]) && row[key] >= 0) result[key] = row[key];
  }
  for (const [key, values] of Object.entries(enums)) if (values.includes(row[key])) result[key] = row[key];
  return result;
}

export function observeTurnEvent(sample, event, now) {
  if (event.type === 'zyra_server_prompt_accepted') sample.acceptedAt ??= now;
  if (event.type === 'model_request_progress' && event.progress) {
    sample.providerStartedAt ??= event.progress.startedAt;
    if (Number.isFinite(event.progress.firstEventAt)) sample.providerFirstEventAt ??= event.progress.firstEventAt;
    if (Number.isFinite(event.progress.firstTextAt)) sample.providerFirstTextAt ??= event.progress.firstTextAt;
  }
  const delta = event.assistantMessageEvent;
  if (delta?.type === 'thinking_delta' && typeof delta.delta === 'string' && delta.delta.length > 0) {
    sample.firstReasoningReceivedAt ??= now;
  }
  if (delta?.type === 'text_delta' && typeof delta.delta === 'string' && delta.delta.length > 0) {
    sample.firstTextReceivedAt ??= now;
    sample.textCharacters += delta.delta.length;
  }
  if (event.type === 'auto_retry_start') sample.retries++;
  if (event.type === 'compaction_start') sample.compactions++;
  if (event.type === 'tool_execution_start') sample.toolCalls++;
  if (event.type === 'zyra_server_turn_completed' || event.type === 'agent_end' && !event.willRetry) {
    if (['completed', 'failed', 'interrupted'].includes(event.outcome)) sample.outcome = event.outcome;
  }
}

export function summarizeSample(sample, requests) {
  const since = (at, start = sample.submittedAt) => Number.isFinite(at) ? Math.max(0, at - start) : null;
  const first = requests[0];
  return {
    name: sample.name, outcome: sample.failure || sample.outcome || 'unknown',
    serverAcceptedMs: since(sample.acceptedAt),
    providerStartedMs: since(first?.startedAt ?? sample.providerStartedAt),
    providerFirstEventMs: first?.firstEventMs ?? since(sample.providerFirstEventAt, sample.providerStartedAt),
    providerFirstTextMs: first?.firstTextMs ?? since(sample.providerFirstTextAt, sample.providerStartedAt),
    firstReasoningReceivedMs: since(sample.firstReasoningReceivedAt),
    submitToFirstTextMs: since(sample.firstTextReceivedAt),
    providerTextToClientMs: Number.isFinite(first?.startedAt) && Number.isFinite(first?.firstTextMs)
      ? since(sample.firstTextReceivedAt, first.startedAt + first.firstTextMs) : null,
    coldStartToFirstTextMs: sample.name === 'fresh-chat' && Number.isFinite(sample.instanceStartedAt)
      ? since(sample.firstTextReceivedAt, sample.instanceStartedAt) : null,
    submitToCompletedMs: since(sample.completedAt),
    textCharacters: sample.textCharacters, toolCalls: sample.toolCalls, retries: sample.retries,
    compactions: sample.compactions, requests,
  };
}

export function distribution(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return { count: sorted.length, min: sorted[0], median: sorted.length % 2 ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2, max: sorted.at(-1) };
}
