/** Prompt execution is server-owned and may legitimately outlive a client read. */
export function agentServerRequestTimeout(method, params = {}) {
  if (method === 'session.request' && params.type === 'prompt') return 0;
  if (method === 'runtime.models') return 65_000;
  if (method === 'runtime.generateText') return Math.max(1_000, Math.min(120_000, Number(params.timeoutMs) || 60_000)) + 5_000;
  if (method === 'tools.control') return 0;
  if (method === 'session.request' && params.type === 'compact') return 120_000;
  if (method === 'session.request' && params.type === 'memory.run') return 125_000;
  if (method === 'session.request' && params.type === 'agents.wait') return Math.min(3_605_000, Math.max(5_000, Number(params.payload?.timeoutMs) || 30_000) + 5_000);
  if (method === 'session.request' && ['abort', 'bash.abort', 'approval.respond', 'user_input.respond'].includes(params.type)) return 15_000;
  return 35_000;
}
