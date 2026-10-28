// Generated from the maintained TypeScript in ../source by scripts/build-owned-runtime.mjs.
const MAX_SESSIONS = 128;
const MAX_REQUESTS = 64;
const IDLE_TTL_MS = 30 * 6e4;
const MAX_CIRCUITS = 256;
const COOLDOWN_MS = 6e4;
const MAX_COOLDOWN_MS = 5 * 6e4;
const salt = `${Math.random()}-${Date.now()}`;
function fingerprint(value) {
  const text = `${salt}:${JSON.stringify(value) ?? ""}`;
  let a = 2166136261, b = 5381;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ text.charCodeAt(i);
  }
  return `${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`;
}
const sessions = /* @__PURE__ */ new Map();
const circuits = /* @__PURE__ */ new Map();
function prune() {
  const now = Date.now();
  for (const [id, state] of sessions) if (now - state.touched >= IDLE_TTL_MS) sessions.delete(id);
  while (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
  for (const [key, state] of circuits) if (!state.probing && now - state.touched >= IDLE_TTL_MS) circuits.delete(key);
  while (circuits.size > MAX_CIRCUITS) circuits.delete(circuits.keys().next().value);
}
function codexCircuitKey(accountId, endpoint) {
  return fingerprint([accountId, endpoint]);
}
function acquireCodexWebSocketProbe(key) {
  prune();
  const state = circuits.get(key);
  if (!state) return true;
  if (state.probing || Date.now() < state.retryAt) return false;
  state.probing = true;
  state.touched = Date.now();
  return true;
}
function finishCodexWebSocketProbe(key, outcome) {
  if (outcome === "success") {
    circuits.delete(key);
    return;
  }
  const previous = circuits.get(key);
  if (outcome === "neutral") {
    if (previous) previous.probing = false;
    return;
  }
  const failures = Math.min(4, (previous?.failures ?? 0) + 1);
  circuits.delete(key);
  circuits.set(key, { failures, probing: false, touched: Date.now(), retryAt: Date.now() + Math.min(MAX_COOLDOWN_MS, COOLDOWN_MS * 2 ** (failures - 1)) });
  prune();
}
function codexWebSocketRetryAt(key) {
  return circuits.get(key)?.retryAt;
}
function beginCodexRequestDiagnostic(sessionId, body, accountId, endpoint, serializedBytes) {
  if (!sessionId) return void 0;
  prune();
  let state = sessions.get(sessionId);
  if (!state) state = { touched: Date.now(), sequence: 0, rows: [] };
  sessions.delete(sessionId);
  sessions.set(sessionId, state);
  state.touched = Date.now();
  const reasoning = body.reasoning;
  const input = Array.isArray(body.input) ? body.input : [];
  const fields = Object.fromEntries(Object.entries({
    model: body.model,
    effort: reasoning?.effort,
    tier: body.service_tier,
    account: accountId,
    endpoint,
    instructions: body.instructions,
    tools: body.tools,
    cacheKey: body.prompt_cache_key,
    configuration: { text: body.text, tool_choice: body.tool_choice, parallel_tool_calls: body.parallel_tool_calls, temperature: body.temperature, reasoning: body.reasoning, include: body.include, store: body.store }
  }).map(([key, value]) => [key, fingerprint(value)]));
  const items = input.slice(0, 4096).map(fingerprint);
  const changes = state.snapshot ? Object.keys(fields).filter((key) => fields[key] !== state.snapshot.fields[key]).map((key) => `${key}-changed`) : ["first-request"];
  if (state.snapshot) {
    const previous = state.snapshot;
    if (input.length < previous.itemCount) changes.push("history-shortened");
    else if (previous.items.some((item, i) => items[i] !== item)) changes.push("history-rewritten");
    else if (input.length > previous.itemCount) changes.push("history-appended");
    else changes.push(input.length > 4096 ? "history-prefix-only-observed" : "history-unchanged");
  }
  state.snapshot = { fields, items, itemCount: input.length };
  const row = {
    sequence: ++state.sequence,
    startedAt: Date.now(),
    model: String(body.model ?? "").slice(0, 160),
    effort: reasoning?.effort?.slice(0, 32),
    tier: typeof body.service_tier === "string" ? body.service_tier.slice(0, 32) : void 0,
    account: `account-${fingerprint(accountId)}`,
    fullRequestBytes: serializedBytes ?? new TextEncoder().encode(JSON.stringify(body)).byteLength,
    requestBytes: 0,
    fullBytes: 0,
    deltaBytes: 0,
    websocketAttempts: 0,
    sseAttempts: 0,
    attempts: 0,
    retries: 0,
    latencyMs: 0,
    firstEventMs: null,
    firstTextMs: null,
    uncachedInput: 0,
    cacheRead: 0,
    cacheWrite: 0,
    output: 0,
    cacheOutcome: "unknown",
    localFingerprintChanges: changes,
    outcome: "pending"
  };
  state.rows.push(row);
  if (state.rows.length > MAX_REQUESTS) state.rows.shift();
  prune();
  return row;
}
function recordCodexRequestAttempt(row, transport, context, bytes) {
  if (!row) return;
  row.transport = transport;
  row.context = context;
  row.requestBytes += bytes;
  if (context === "full") row.fullBytes += bytes;
  else row.deltaBytes += bytes;
  if (transport === "websocket") row.websocketAttempts++;
  else row.sseAttempts++;
  row.attempts++;
  row.retries = Math.max(0, row.attempts - 1);
}
function finishCodexRequestDiagnostic(row, output) {
  if (!row) return;
  row.latencyMs = Math.max(0, Date.now() - row.startedAt);
  row.outcome = output.stopReason;
  row.uncachedInput = output.usage.input;
  row.output = output.usage.output;
  row.cacheRead = output.usage.cacheRead;
  row.cacheWrite = output.usage.cacheWrite;
  row.cacheOutcome = row.cacheRead > 0 ? "hit" : row.uncachedInput > 0 ? "miss" : "unknown";
}
function getOpenAICodexRequestDiagnostics(sessionId) {
  prune();
  return (sessions.get(sessionId)?.rows ?? []).map((row) => ({ ...row, localFingerprintChanges: [...row.localFingerprintChanges] }));
}
function resetCodexRequestDiagnostics(sessionId) {
  if (sessionId) sessions.delete(sessionId);
  else {
    sessions.clear();
    circuits.clear();
  }
}
export {
  acquireCodexWebSocketProbe,
  beginCodexRequestDiagnostic,
  codexCircuitKey,
  codexWebSocketRetryAt,
  finishCodexRequestDiagnostic,
  finishCodexWebSocketProbe,
  getOpenAICodexRequestDiagnostics,
  recordCodexRequestAttempt,
  resetCodexRequestDiagnostics
};
