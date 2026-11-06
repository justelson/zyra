import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { observeTurnEvent, summarizeSample, distribution, projectRequest } from './metrics.mjs';

/** Explicit comparison only: omits the Chat system prompt/tools/server/bridge. */
export async function runProviderBaseline({ importRuntime, settings, prompt, count, timeoutMs, output, plan }) {
  const { createZyraRuntime } = await importRuntime('src/zyra-runtime.mjs');
  const { applyAssistantReasoningSummary } = await importRuntime('src/assistant-runtime-policy.mjs');
  const runtime = await createZyraRuntime();
  const model = runtime.modelRegistry.find('openai-codex', 'gpt-6.1-sol');
  if (!model) throw new Error('The selected model is missing. No request was sent.');
  const adapter = await importRuntime('src/runtime/providers/src/api/openai-codex-responses.js');
  const sessionId = randomUUID(), messages = [], samples = [];
  try {
    for (let index = 0; index < count; index++) {
      const sample = { name: index ? `warm-followup-${index}` : 'fresh-chat', submittedAt: Date.now(),
        textCharacters: 0, toolCalls: 0, retries: 0, compactions: 0 };
      messages.push({ role: 'user', content: [{ type: 'text', text: prompt }], timestamp: Date.now() });
      console.log(JSON.stringify({ stage: 'submitted', path: 'direct-provider', sample: sample.name }));
      const stream = runtime.modelRuntime.streamSimple(model, { messages, systemPrompt: '', tools: [] }, {
        sessionId, reasoning: settings.thinking, signal: AbortSignal.timeout(timeoutMs), timeoutMs,
        onPayload: payload => ({ ...(applyAssistantReasoningSummary(payload, settings.reasoningSummary) || payload),
          ...(settings.serviceTier === 'fast' ? { service_tier: 'priority' } : {}) }),
        maxRetries: 0,
      });
      let terminal;
      for await (const event of stream) {
        observeTurnEvent(sample, { type: 'message_update', assistantMessageEvent: event }, Date.now());
        if (event.type === 'done') terminal = event.message;
        if (event.type === 'error') terminal = event.error;
      }
      sample.completedAt = Date.now();
      sample.outcome = terminal?.stopReason === 'stop' ? 'completed' : terminal?.stopReason === 'aborted' ? 'interrupted' : 'failed';
      if (terminal?.role === 'assistant') messages.push(terminal);
      const requests = adapter.getOpenAICodexRequestDiagnostics(sessionId).filter(row => row.startedAt >= sample.submittedAt).map(projectRequest);
      const result = summarizeSample(sample, requests); samples.push(result);
      writeFileSync(path.join(output, 'report.json'), JSON.stringify({ ...plan, samples,
        firstText: distribution(samples.map(row => row.submitToFirstTextMs)), note: 'Bare provider comparison excludes the Chat prompt/tools/server/bridge. No display paint measurement.' }, null, 2));
      console.log(JSON.stringify({ stage: 'measured', path: 'direct-provider', ...result }));
      if (sample.outcome !== 'completed') { process.exitCode = 1; break; }
    }
  } finally {
    adapter.closeOpenAICodexWebSocketSessions(sessionId);
    adapter.resetOpenAICodexWebSocketDebugStats(sessionId);
  }
}
