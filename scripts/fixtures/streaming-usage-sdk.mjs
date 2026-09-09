// Synthetic provider boundary for the real bridge's streaming contract test.
// No credentials, model requests, filesystem operations or private session data.
let listener;
const usage = { input: 100, output: 16, cacheRead: 200, cacheWrite: 0, reasoning: 4, cost: 0.01, costComplete: true, total: 316 };
const contextUsage = { tokens: 300, contextWindow: 32768, percent: 300 / 32768 * 100 };
export async function createZyraSession({ project }) {
  const model = { provider: 'fixture', id: 'streaming', contextWindow: 32768 };
  return {
    project, profile: 'default', webSearch: false, webFetch: false, streaming: false,
    session: {
      model, state: { model, messages: [] }, autoCompactionEnabled: true,
      modelRegistry: { authStorage: { modelRuntime: { refresh: async () => ({ errors: new Map() }) } } },
      sessionManager: {
        getEntries: () => [], getSessionId: () => 'fixture-streaming', getSessionFile: () => undefined,
        getSessionName: () => 'Synthetic streaming check', getCwd: () => project,
      },
      subscribe(callback) { listener = callback; return () => { listener = undefined; }; },
      dispose() {},
    },
  };
}
export function getZyraThinkingLevel() { return 'low'; }
export function setZyraReasoningSummary() {}
export function getRuntimeUsageSnapshot() { return { usage, contextUsage }; }
export function describeRuntime(runtime) {
  if (runtime.streaming) throw new Error('Full runtime description entered the streaming hot path.');
  return { ...getRuntimeUsageSnapshot(), model: 'fixture/streaming', profile: 'default' };
}
export async function runZyraPrompt(runtime) {
  runtime.streaming = true;
  const message = {
    role: 'assistant', timestamp: 1_700_000_000_000,
    content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '' }],
  };
  try {
    listener({ type: 'message_start', message });
    message.content[0].thinking = 'Synthetic reasoning';
    listener({ type: 'message_update', message, assistantMessageEvent: { type: 'thinking_delta', delta: 'Synthetic reasoning', partial: message } });
    for (let i = 0; i < 32; i++) {
      if (i === 16) await new Promise((resolve) => setTimeout(resolve, 275));
      const delta = `word-${i} λ `;
      message.content[1].text += delta;
      listener({ type: 'message_update', message, assistantMessageEvent: { type: 'text_delta', delta, partial: message } });
    }
    message.stopReason = 'stop';
    message.usage = { input: 100, output: 16, cacheRead: 200, cacheWrite: 0, totalTokens: 316, cost: { total: .01 } };
    listener({ type: 'message_end', message });
    listener({ type: 'agent_end' });
  } finally {
    runtime.streaming = false;
  }
}
