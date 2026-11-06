import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runProviderBaseline } from './response-latency/provider-baseline.mjs';

const directory = mkdtempSync(path.join(os.tmpdir(), 'zyra-latency-provider-'));
try {
  for (const fail of [false, true]) {
    let closed, reset, usedSession;
    const adapter = {
      getOpenAICodexRequestDiagnostics: () => [],
      closeOpenAICodexWebSocketSessions: id => { closed = id; },
      resetOpenAICodexWebSocketDebugStats: id => {
        assert.equal(closed, id, 'release the live provider session before discarding diagnostics'); reset = id;
      },
    };
    const runtime = { modelRegistry: { find: () => ({ id: 'gpt-6.1-sol' }) }, modelRuntime: {
      streamSimple(_model, _context, options) {
        usedSession = options.sessionId;
        return (async function* () {
          if (fail) throw new Error('Synthetic stream failed.');
          yield { type: 'text_delta', delta: 'OK' };
          yield { type: 'done', message: { role: 'assistant', stopReason: 'stop' } };
        })();
      },
    } };
    const modules = { 'src/zyra-runtime.mjs': { createZyraRuntime: async () => runtime },
      'src/assistant-runtime-policy.mjs': { applyAssistantReasoningSummary: payload => payload },
      'src/runtime/providers/src/api/openai-codex-responses.js': adapter };
    const run = runProviderBaseline({ importRuntime: async file => modules[file], settings: { thinking: 'high' },
      prompt: 'Synthetic fixture.', count: 1, timeoutMs: 1000, output: directory, plan: {} });
    if (fail) await assert.rejects(run, /Synthetic stream failed/); else await run;
    assert.equal(closed, usedSession); assert.equal(reset, usedSession);
  }
  console.log('Provider baseline releases its exact cached session on success and stream failure.');
} finally {
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(directory).startsWith('zyra-latency-provider-'));
  rmSync(directory, { recursive: true, force: true });
}
