// Source-only synthetic regression: bun scripts/test-cache-transport.mjs
import assert from 'node:assert/strict';
import { installSessionReasoningOptions } from '../src/session-reasoning-options.mjs';
import { stream, streamSimple, closeOpenAICodexWebSocketSessions, resetOpenAICodexWebSocketDebugStats, getOpenAICodexRequestDiagnostics } from '../src/runtime/providers/source/api/openai-codex-responses.ts';
import { acquireCodexWebSocketProbe, finishCodexWebSocketProbe, beginCodexRequestDiagnostic, finishCodexRequestDiagnostic } from '../src/runtime/providers/source/api/codex-request-diagnostics.ts';
const model = { id: 'fixture-model', api: 'openai-codex-responses', provider: 'openai-codex', baseUrl: 'https://fixture.test', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 1000 };
const jwt = id => `fixture.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: id } })).toString('base64url')}.fixture`;
const completed = { type: 'response.completed', response: { id: 'private-response-id', status: 'completed', output: [], usage: { input_tokens: 100, output_tokens: 2, input_tokens_details: { cached_tokens: 80 } } } };
let clock = Date.now(), connects = 0, fetches = 0, mode = 'fail';
const handshakes = [];
const realNow = Date.now, original = globalThis.WebSocket;
class FakeSocket {
  readyState = 1; listeners = new Map();
  constructor(url, options) { connects++; handshakes.push({ url, headers: options.headers }); queueMicrotask(() => this.emit(mode === 'fail' ? 'error' : 'open', { message: 'private-token-must-not-leak' })); }
  addEventListener(type, callback) { const list = this.listeners.get(type) || new Set(); list.add(callback); this.listeners.set(type, list); }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  emit(type, event) { for (const listener of this.listeners.get(type) || []) listener(event); }
  send(raw) { assert.equal(JSON.parse(raw).store, false); setTimeout(() => { if (mode === 'partial') { this.emit('message', { data: JSON.stringify({ type: 'response.created', response: { id: 'private-response-id' } }) }); setTimeout(() => this.emit('error', { message: 'fixture disconnect' }), 0); } else this.emit('message', { data: JSON.stringify(completed) }); }, 0); }
  close() { this.readyState = 3; }
}
Date.now = () => clock; globalThis.WebSocket = FakeSocket;
// Full fixture IDs cannot collide with the public account-<fingerprint> label.
const privateAccountA = 'fixture-private-account-alpha';
const privateAccountB = 'fixture-private-account-beta';
const options = (sessionId = 'fixture-session', account = privateAccountA) => ({ sessionId, apiKey: jwt(account), transport: 'auto', fetch: async () => { fetches++; return new Response(`data: ${JSON.stringify(completed)}\n\n`, { headers: { 'content-type': 'text/event-stream' } }); } });
const context = { systemPrompt: 'private-system-prompt', messages: [{ role: 'user', content: 'private-user-prompt', timestamp: clock }] };
try {
  assert.equal((await stream(model, context, options()).result()).stopReason, 'stop');
  assert.equal(connects, 1);
  await stream(model, context, options('other-session')).result();
  assert.equal(connects, 1, 'account/endpoint failure circuit also protects another session');
  mode = 'ok';
  await stream(model, context, options('fixture-session', privateAccountB)).result();
  assert.equal(connects, 2, 'one account failure never suppresses a healthy account');
  await stream({ ...model, baseUrl: 'https://other-endpoint.fixture.test' }, context, options('endpoint-session')).result();
  assert.equal(connects, 3, 'one endpoint failure never suppresses another endpoint');
  clock += 61000;
  await stream(model, context, options()).result();
  assert.equal(connects, 4, 'expired cooldown permits a controlled websocket retry');
  closeOpenAICodexWebSocketSessions(); mode = 'partial'; clock += 61000;
  const beforeFetch = fetches;
  assert.equal((await stream(model, context, options('partial-session')).result()).stopReason, 'error');
  assert.equal(fetches, beforeFetch, 'never replay after the response starts');
  const rows = getOpenAICodexRequestDiagnostics('fixture-session');
  assert.equal(rows.length, 3);
  assert.equal(rows[0].cacheOutcome, 'hit');
  assert.equal(rows[0].uncachedInput, 20);
  assert.equal(rows[0].cacheRead, 80);
  assert.equal(rows[0].output, 2);
  assert.ok(rows[0].requestBytes > 0);
  assert.equal(rows[0].retries, 1, 'failed websocket connection and SSE fallback are separate attempts');
  assert.equal(rows[0].websocketAttempts, 1);
  assert.equal(rows[0].sseAttempts, 1);
  assert.equal(rows[0].fullBytes + rows[0].deltaBytes, rows[0].requestBytes);
  assert.ok(rows[1].localFingerprintChanges.includes('account-changed'));
  assert.ok(rows[2].localFingerprintChanges.includes('account-changed'));
  const serialized = JSON.stringify(rows);
  for (const privateValue of ['private-system-prompt', 'private-user-prompt', 'private-token-must-not-leak', 'private-response-id', privateAccountA, privateAccountB, jwt(privateAccountA)]) assert.ok(!serialized.includes(privateValue), `Diagnostics must not contain fixture value ${privateValue}`);
  rows[0].localFingerprintChanges.push('mutated');
  assert.ok(!getOpenAICodexRequestDiagnostics('fixture-session')[0].localFingerprintChanges.includes('mutated'), 'getter returns detached snapshots');
  mode = 'ok';
  await stream(model, context, options('delta-session', privateAccountB)).result();
  await stream(model, { ...context, messages: [...context.messages, { role: 'user', content: 'private-follow-up', timestamp: clock }] }, options('delta-session', privateAccountB)).result();
  const delta = getOpenAICodexRequestDiagnostics('delta-session').at(-1);
  assert.equal(delta.context, 'delta', 'stable history continues over the same connection');
  assert.ok(delta.deltaBytes > 0);
  for (const [name, transport] of [['default', undefined], ['explicit-auto', 'auto'], ['cached', 'websocket-cached'], ['full', 'websocket']]) {
    const sessionId = `transport-${name}`;
    const config = { ...options(sessionId, privateAccountB), transport };
    await streamSimple(model, context, config).result();
    await streamSimple(model, { ...context, messages: [...context.messages,
      { role: 'user', content: 'Only the appended follow-up should be sent.', timestamp: clock }] }, config).result();
    const request = getOpenAICodexRequestDiagnostics(sessionId).at(-1);
    assert.equal(request.context, name === 'full' ? 'full' : 'delta', `${name} transport honors continuation through the normal streamSimple caller`);
  }
  const routedOptions = options('routing-session', privateAccountB);
  const repaired = { model, modelRegistry: { zyraOpenAIModelCatalog: new Map([[model.provider,[{id:model.id,supportedEfforts:['high']}]]]) }, agent: { streamFunction: streamSimple } };
  installSessionReasoningOptions(repaired, () => 'high');
  const repairedOptions = options('repaired-reasoning-session', privateAccountB);
  await repaired.agent.streamFunction(model, context, repairedOptions).result();
  const repairedConnects = connects;
  await repaired.agent.streamFunction(model, { ...context, messages: [...context.messages,
    { role:'user',content:'Append after recovering reasoning metadata.',timestamp:clock }] }, repairedOptions).result();
  assert.equal(getOpenAICodexRequestDiagnostics('repaired-reasoning-session').at(-1).context,'delta','reasoning capability repair retains warm delta continuation through the real stream wrapper');
  assert.equal(connects,repairedConnects,'reasoning capability repair reuses the warm socket');
  await stream(model, context, routedOptions).result();
  assert.equal(handshakes.at(-1).headers['x-codex-routing-hint'], 'model=fixture-model', 'the handshake announces the actual request model before frames are sent');
  const routedConnects = connects;
  await stream(model, context, routedOptions).result();
  assert.equal(connects, routedConnects, 'unchanged routing keeps its connection');
  await stream(model, context, { ...routedOptions, serviceTier: 'priority' }).result();
  assert.equal(connects, routedConnects + 1, 'a tier change cannot reuse an old handshake route');
  assert.equal(handshakes.at(-1).headers['x-codex-routing-hint'], 'model=fixture-model;tier=priority');
  await stream({ ...model, id: 'other-fixture-model' }, context, { ...routedOptions, serviceTier: 'priority' }).result();
  assert.equal(connects, routedConnects + 2, 'a model change establishes a matching handshake route');
  assert.equal(handshakes.at(-1).headers['x-codex-routing-hint'], 'model=other-fixture-model;tier=priority');
  await stream(model, context, { ...options('hook-routing-session', privateAccountB), onPayload: body => ({ ...body, model: 'hook-selected-model', service_tier: 'default' }) }).result();
  assert.equal(handshakes.at(-1).headers['x-codex-routing-hint'], 'model=hook-selected-model;tier=default', 'routing follows the post-hook payload');
  const key = 'synthetic-probe';
  finishCodexWebSocketProbe(key, 'failure');
  assert.equal(acquireCodexWebSocketProbe(key), false);
  clock += 61000;
  assert.equal(acquireCodexWebSocketProbe(key), true);
  assert.equal(acquireCodexWebSocketProbe(key), false, 'only one in-flight recovery probe is admitted');
  finishCodexWebSocketProbe(key, 'neutral');
  assert.equal(acquireCodexWebSocketProbe(key), true, 'abort/auth failure releases probe ownership');
  finishCodexWebSocketProbe(key, 'success');
  const syntheticBody = { model: model.id, input: [{ text: 'private-unit-history' }], instructions: 'private-unit-prompt' };
  const encodedBytes = new TextEncoder().encode(JSON.stringify({ ...syntheticBody, instructions: 'Unicode 音 prompt' })).byteLength;
  const precomputed = beginCodexRequestDiagnostic('precomputed-session', { ...syntheticBody, instructions: 'Unicode 音 prompt', toJSON() { throw new Error('Request must not be serialized twice'); } }, privateAccountA, 'https://fixture.test', encodedBytes);
  assert.equal(precomputed.fullRequestBytes, encodedBytes, 'diagnostics reuse the exact UTF-8 byte count without serializing the request again');
  for (let i = 0; i < 70; i++) {
    const row = beginCodexRequestDiagnostic('bounded-session', syntheticBody, privateAccountA, 'https://fixture.test');
    finishCodexRequestDiagnostic(row, { stopReason: 'stop', usage: { input: 100, output: 2, cacheRead: 0, cacheWrite: 0 } });
  }
  const bounded = getOpenAICodexRequestDiagnostics('bounded-session');
  assert.equal(bounded.length, 64);
  assert.equal(bounded[0].sequence, 7, 'eviction preserves stable request sequence numbers');
  assert.equal(bounded.at(-1).cacheOutcome, 'miss');
  assert.deepEqual(bounded.at(-1).localFingerprintChanges, ['history-unchanged'], 'provider cache miss is independent of local fingerprint changes');
  clock += 30 * 60000;
  assert.deepEqual(getOpenAICodexRequestDiagnostics('bounded-session'), [], 'idle request history expires');
  for (let i = 0; i < 129; i++) beginCodexRequestDiagnostic(`bounded-${i}`, syntheticBody, privateAccountA, 'https://fixture.test');
  assert.deepEqual(getOpenAICodexRequestDiagnostics('bounded-0'), [], 'session storage has a hard bound');
  console.log('Cache transport: account/endpoint isolation, cooldown/single-probe recovery, delta bytes, no partial replay, bounded private diagnostics: ok');
} finally { Date.now = realNow; globalThis.WebSocket = original; closeOpenAICodexWebSocketSessions(); resetOpenAICodexWebSocketDebugStats(); }
