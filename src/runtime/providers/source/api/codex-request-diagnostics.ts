// Local observations only. Fingerprints explain request changes, never provider cache decisions.
const MAX_SESSIONS = 128;
const MAX_REQUESTS = 64;
const IDLE_TTL_MS = 30 * 60_000;
const MAX_CIRCUITS = 256;
const COOLDOWN_MS = 60_000;
const MAX_COOLDOWN_MS = 5 * 60_000;
const salt = `${Math.random()}-${Date.now()}`;

// Ephemeral, non-exported fingerprints. No prompt text, account ids, keys or response ids are retained.
function fingerprint(value: unknown): string {
 const text = `${salt}:${JSON.stringify(value) ?? ''}`;
 let a = 2166136261, b = 5381;
 for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ text.charCodeAt(i); }
 return `${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`;
}
export interface OpenAICodexRequestDiagnostic {
 sequence: number;
 startedAt: number;
 model: string;
 effort?: string;
 tier?: string;
 account: string;
 transport?: 'sse' | 'websocket';
 context?: 'full' | 'delta';
 fullRequestBytes: number;
 requestBytes: number;
 fullBytes: number;
 deltaBytes: number;
 websocketAttempts: number;
 sseAttempts: number;
 attempts: number;
 retries: number;
 latencyMs: number;
 firstEventMs: number | null;
 firstTextMs: number | null;
 uncachedInput: number;
 cacheRead: number;
 cacheWrite: number;
 output: number;
 cacheOutcome: 'hit' | 'miss' | 'unknown';
 localFingerprintChanges: string[];
 outcome: 'pending' | 'stop' | 'length' | 'toolUse' | 'error' | 'aborted' | 'deferred';
}
interface Snapshot { fields: Record<string, string>; items: string[]; itemCount: number; }
interface Session { touched: number; sequence: number; snapshot?: Snapshot; rows: OpenAICodexRequestDiagnostic[]; }
const sessions = new Map<string, Session>();
interface Circuit { failures: number; retryAt: number; touched: number; probing: boolean; }
const circuits = new Map<string, Circuit>();

function prune(): void {
 const now = Date.now();
 for (const [id, state] of sessions) if (now - state.touched >= IDLE_TTL_MS) sessions.delete(id);
 while (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value!);
 for (const [key, state] of circuits) if (!state.probing && now - state.touched >= IDLE_TTL_MS) circuits.delete(key);
 while (circuits.size > MAX_CIRCUITS) circuits.delete(circuits.keys().next().value!);
}
export function codexCircuitKey(accountId: string, endpoint: string): string { return fingerprint([accountId, endpoint]); }
// The first request after cooldown owns the probe. Other requests keep using SSE.
export function acquireCodexWebSocketProbe(key: string): boolean {
 prune();
 const state = circuits.get(key);
 if (!state) return true;
 if (state.probing || Date.now() < state.retryAt) return false;
 state.probing = true; state.touched = Date.now();
 return true;
}
export function finishCodexWebSocketProbe(key: string, outcome: 'success' | 'failure' | 'neutral'): void {
 if (outcome === 'success') { circuits.delete(key); return; }
 const previous = circuits.get(key);
 if (outcome === 'neutral') { if (previous) previous.probing = false; return; }
 const failures = Math.min(4, (previous?.failures ?? 0) + 1);
 circuits.delete(key);
 circuits.set(key, { failures, probing: false, touched: Date.now(), retryAt: Date.now() + Math.min(MAX_COOLDOWN_MS, COOLDOWN_MS * 2 ** (failures - 1)) });
 prune();
}
export function codexWebSocketRetryAt(key: string): number | undefined { return circuits.get(key)?.retryAt; }

export function beginCodexRequestDiagnostic(sessionId: string | undefined, body: Record<string, unknown>, accountId: string, endpoint: string, serializedBytes?: number): OpenAICodexRequestDiagnostic | undefined {
 if (!sessionId) return undefined;
 prune();
 let state = sessions.get(sessionId);
 if (!state) state = { touched: Date.now(), sequence: 0, rows: [] };
 sessions.delete(sessionId); sessions.set(sessionId, state); state.touched = Date.now();
 const reasoning = body.reasoning as { effort?: string } | undefined;
 const input = Array.isArray(body.input) ? body.input : [];
 const fields = Object.fromEntries(Object.entries({ model: body.model, effort: reasoning?.effort, tier: body.service_tier, account: accountId, endpoint, instructions: body.instructions, tools: body.tools, cacheKey: body.prompt_cache_key,
  configuration: { text: body.text, tool_choice: body.tool_choice, parallel_tool_calls: body.parallel_tool_calls, temperature: body.temperature, reasoning: body.reasoning, include: body.include, store: body.store } }).map(([key, value]) => [key, fingerprint(value)]));
 const items = input.slice(0, 4096).map(fingerprint);
 const changes = state.snapshot ? Object.keys(fields).filter(key => fields[key] !== state!.snapshot!.fields[key]).map(key => `${key}-changed`) : ['first-request'];
 if (state.snapshot) {
  const previous = state.snapshot;
  if (input.length < previous.itemCount) changes.push('history-shortened');
  else if (previous.items.some((item, i) => items[i] !== item)) changes.push('history-rewritten');
  else if (input.length > previous.itemCount) changes.push('history-appended');
  else changes.push(input.length > 4096 ? 'history-prefix-only-observed' : 'history-unchanged');
 }
 state.snapshot = { fields, items, itemCount: input.length };
 const row: OpenAICodexRequestDiagnostic = { sequence: ++state.sequence, startedAt: Date.now(), model: String(body.model ?? '').slice(0, 160), effort: reasoning?.effort?.slice(0, 32), tier: typeof body.service_tier === 'string' ? body.service_tier.slice(0, 32) : undefined,
  account: `account-${fingerprint(accountId)}`, fullRequestBytes: serializedBytes ?? new TextEncoder().encode(JSON.stringify(body)).byteLength, requestBytes: 0, fullBytes: 0, deltaBytes: 0, websocketAttempts: 0, sseAttempts: 0, attempts: 0, retries: 0, latencyMs: 0, firstEventMs: null, firstTextMs: null, uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 0, cacheOutcome: 'unknown', localFingerprintChanges: changes, outcome: 'pending' };
 state.rows.push(row); if (state.rows.length > MAX_REQUESTS) state.rows.shift();
 prune(); return row;
}
export function recordCodexRequestAttempt(row: OpenAICodexRequestDiagnostic | undefined, transport: 'sse' | 'websocket', context: 'full' | 'delta', bytes: number): void {
 if (!row) return;
 row.transport = transport; row.context = context; row.requestBytes += bytes;
 if (context === 'full') row.fullBytes += bytes; else row.deltaBytes += bytes;
 if (transport === 'websocket') row.websocketAttempts++; else row.sseAttempts++;
 row.attempts++; row.retries = Math.max(0, row.attempts - 1);
}
export function finishCodexRequestDiagnostic(row: OpenAICodexRequestDiagnostic | undefined, output: { stopReason: OpenAICodexRequestDiagnostic['outcome']; usage: { input: number; output: number; cacheRead: number; cacheWrite: number } }): void {
 if (!row) return;
 row.latencyMs = Math.max(0, Date.now() - row.startedAt); row.outcome = output.stopReason;
 row.uncachedInput = output.usage.input; row.output = output.usage.output; row.cacheRead = output.usage.cacheRead; row.cacheWrite = output.usage.cacheWrite;
 row.cacheOutcome = row.cacheRead > 0 ? 'hit' : row.uncachedInput > 0 ? 'miss' : 'unknown';
}
export function getOpenAICodexRequestDiagnostics(sessionId: string): OpenAICodexRequestDiagnostic[] {
 prune();
 return (sessions.get(sessionId)?.rows ?? []).map(row => ({ ...row, localFingerprintChanges: [...row.localFingerprintChanges] }));
}
export function resetCodexRequestDiagnostics(sessionId?: string): void { if (sessionId) sessions.delete(sessionId); else { sessions.clear(); circuits.clear(); } }
