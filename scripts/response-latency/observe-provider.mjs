// Read the production adapter's existing diagnostics inside each bridge worker.
// This observes protocol output without changing requests, provider streams or replies.
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { projectRequest } from './metrics.mjs';

const destination = process.env.ZYRA_LATENCY_OBSERVATIONS;
if (destination && process.env.ZYRA_ROOT) {
  let sessionId, adapter, loading, pending = '', previous = '';
  const snapshot = () => {
    if (!sessionId || !adapter) return;
    try {
      const requests = adapter.getOpenAICodexRequestDiagnostics(sessionId).map(projectRequest);
      const serialized = JSON.stringify(requests);
      if (serialized === previous || !requests.length) return;
      previous = serialized;
      appendFileSync(destination, `${JSON.stringify({ pid: process.pid, rssBytes: process.memoryUsage().rss, requests })}\n`, { mode: 0o600 });
    } catch { /* A diagnostic observer cannot interrupt a chat. */ }
  };
  const write = process.stdout.write;
  process.stdout.write = function (chunk, ...args) {
    const result = write.call(this, chunk, ...args);
    try {
      // Each owned bridge is bound to one Chat. After its connect receipt,
      // observe the adapter directly instead of reparsing token payloads.
      if (sessionId) { snapshot(); return result; }
      pending += typeof chunk === 'string' ? chunk : chunk.toString();
      let index;
      while ((index = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, index); pending = pending.slice(index + 1);
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.type === 'response' && message.ok && message.result?.providerThreadId) {
          sessionId = message.result.providerThreadId;
          loading ??= import(pathToFileURL(path.join(process.env.ZYRA_ROOT,
            'src/runtime/providers/src/api/openai-codex-responses.js')).href)
            .then(module => { adapter = module; snapshot(); }).catch(() => {});
        }
        if (message.type === 'event' || message.type === 'response') snapshot();
      }
      if (pending.length > 2 * 1024 * 1024) pending = '';
    } catch { /* Keep protocol semantics intact. */ }
    return result;
  };
  setInterval(snapshot, 250).unref();
  process.on('exit', snapshot);
}
