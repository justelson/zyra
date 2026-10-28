const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
const knownNumber = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

// Session entries include tool-loop requests as well as the final reply. Never
// derive lifetime usage from only the current branch or latest assistant reply.
export function aggregateSessionUsage(entries = [], { completedMessage, costForMessage } = {}) {
  const requests = new Map();
  const objects = new Set();
  const append = (message, entry, fallbackKey) => {
    if (!message || !['assistant', 'toolResult'].includes(message.role) || !message.usage) return;
    if (objects.has(message)) return;
    objects.add(message);
    // Unpersisted completion events can overlap entries already on disk.
    if (!entry?.id) {
      const existing = [...requests.entries()].find(([, previous]) => previous === message
        || (message.id && previous.id === message.id)
        || (message.timestamp != null && previous.timestamp === message.timestamp
          && previous.provider === message.provider && previous.model === message.model && previous.role === message.role));
      if (existing) { requests.set(existing[0], message); return; }
    }
    // Persisted entry ids are preferred: providers may reuse request ids.
    const key = entry?.id ? `entry:${entry.id}`
      : message.id ? `message:${message.id}`
      : message.timestamp != null ? `request:${message.role}:${message.provider || ''}:${message.model || ''}:${message.timestamp}`
      : fallbackKey;
    requests.set(key, message);
  };
  for (const [index, entry] of entries.entries()) {
    if (entry?.type === 'message' || ['assistant', 'toolResult'].includes(entry?.role)) {
      append(entry.message || entry, entry.type === 'message' ? entry : null, `index:${index}`);
    } else if (['compaction', 'branch_summary'].includes(entry?.type) && entry.usage) {
      append({ ...entry, role: 'assistant' }, entry, `index:${index}`);
    }
  }
  if (['assistant', 'toolResult'].includes(completedMessage?.role) && completedMessage.usage) {
    // A completion event commonly arrives just before/after the same message is
    // persisted. Match its identity without deduplicating distinct tool requests.
    const existing = [...requests.entries()].find(([, message]) => message === completedMessage
      || (completedMessage.id && message.id === completedMessage.id)
      || (completedMessage.timestamp != null && message.timestamp === completedMessage.timestamp
        && message.provider === completedMessage.provider && message.model === completedMessage.model && message.role === completedMessage.role));
    if (existing) requests.set(existing[0], completedMessage);
    else append(completedMessage, null, 'completed');
  }
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0,
    cost: 0, costComplete: requests.size > 0, costSource: 'unavailable', assistantMessages: [...requests.values()].filter(message => message.role === 'assistant' && !['compaction', 'branch_summary'].includes(message.type)).length,
    total: 0, cacheHitPercent: null, latestRequestCacheHitPercent: null, cacheInputTokens: 0 };
  const sources = new Set();
  for (const message of requests.values()) {
    const usage = message.usage;
    const output = number(usage.output ?? usage.outputTokens);
    const cacheRead = number(usage.cacheRead ?? usage.cachedInputTokens);
    const cacheWrite = number(usage.cacheWrite ?? usage.cacheWriteTokens);
    const rawInput = number(usage.input ?? usage.inputTokens);
    const input = usage.inputIncludesCachedTokens === true ? Math.max(0, rawInput - cacheRead - cacheWrite) : rawInput;
    const reasoning = number(usage.reasoning ?? usage.reasoningTokens ?? usage.reasoningOutputTokens ?? usage.outputDetails?.reasoningTokens);
    totals.input += input;
    totals.output += output;
    totals.cacheRead += cacheRead;
    totals.cacheWrite += cacheWrite;
    totals.reasoning += reasoning;
    // Reasoning is a subset of output, not additional billed output.
    totals.total += input + output + cacheRead + cacheWrite;
    const prompt = input + cacheRead + cacheWrite;
    totals.cacheInputTokens += prompt;
    if (message.role === 'assistant' && !['compaction', 'branch_summary'].includes(message.type)) {
      totals.latestRequestCacheHitPercent = prompt > 0 ? cacheRead / prompt * 100 : null;
    }
    const resolved = costForMessage ? costForMessage(message) : null;
    const recorded = typeof usage.cost === 'object' ? usage.cost?.total : usage.cost;
    const cost = typeof resolved === 'number' ? resolved : resolved?.total ?? resolved?.cost ?? resolved?.costUsd
      ?? (costForMessage ? (usage.cost?.source ? recorded : undefined) : recorded);
    const source = resolved?.costSource ?? resolved?.source ?? usage.costSource ?? usage.cost?.source ?? 'reported';
    const priced = !['unpriced', 'unavailable'].includes(source);
    const complete = resolved?.costComplete ?? resolved?.complete ?? usage.costComplete ?? knownNumber(cost);
    if (knownNumber(cost) && priced) totals.cost += cost;
    if (!complete || !knownNumber(cost) || !priced) totals.costComplete = false;
    if (knownNumber(cost) && priced) sources.add(source);
  }
  totals.cacheHitPercent = totals.cacheInputTokens > 0 ? totals.cacheRead / totals.cacheInputTokens * 100 : null;
  totals.costSource = sources.has('api-equivalent') ? 'api-equivalent'
    : sources.has('estimated') ? 'estimated' : sources.size ? [...sources][0] : 'unavailable';
  return totals;
}
