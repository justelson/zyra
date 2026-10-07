import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createZyraRuntime } from '../src/zyra-runtime.mjs';
import { ZyraCredentialStore, createZyraCredentialAuthStorage } from '../src/zyra-auth-store.mjs';
import { chatGptIdentity, getChatGptAccountPool } from '../src/chatgpt-account-pool.mjs';
import { DEFAULT_CHATGPT_ROUTING, saveChatGptRouting } from '../src/chatgpt-routing-policy.mjs';

const root = await mkdtemp(join(tmpdir(), 'zyra-pool-runtime-'));
const authPath = join(root, 'credentials', 'auth.json');
const store = new ZyraCredentialStore({ authPath });
const options = { credentialStore: store, authPath, modelsPath: null, loadSavedProviders: false, loadOpenAICatalog: false, refreshOnCreate: false, refreshAccountUsage: false, env: {} };
const token = id => `fixture.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: id } })).toString('base64url')}.fixture`;
const credentials = id => ({ type: 'oauth', accountId: id, access: token(id), refresh: `fixture-refresh-${id}`, expires: Date.now() + 3600000 });
try {
  const auth = await createZyraCredentialAuthStorage(options);
  await auth.loginOAuth('openai-codex', credentials('a'));
  await auth.loginOAuth('openai-codex', credentials('b'));
  const pool = getChatGptAccountPool(store, options);
  const idA = chatGptIdentity(credentials('a')).id;
  const idB = chatGptIdentity(credentials('b')).id;
  await saveChatGptRouting(authPath, { ...DEFAULT_CHATGPT_ROUTING, strategy: 'fill-first', preferredAccountId: idA });
  const runtime = await createZyraRuntime(options);
  const model = { id: 'fixture-model', name: 'Fixture model', api: 'openai-codex-responses', provider: 'openai-codex', baseUrl: 'https://chatgpt.com/backend-api', reasoning: true, input: ['text'], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const output = { type: 'message', id: 'fixture-message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: 'Native pooled response.', annotations: [] }] };
  const events = [
    { type: 'response.created', response: { id: 'fixture-response', status: 'in_progress' } },
    { type: 'response.output_item.added', output_index: 0, item: { ...output, status: 'in_progress', content: [] } },
    { type: 'response.content_part.added', item_id: output.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
    { type: 'response.output_text.delta', item_id: output.id, output_index: 0, content_index: 0, delta: output.content[0].text },
    { type: 'response.output_item.done', output_index: 0, item: output },
    { type: 'response.completed', response: { id: 'fixture-response', status: 'completed', output: [output], usage: { input_tokens: 12, output_tokens: 4, total_tokens: 16 } } },
  ];
  const requests = [];
  let transformed = 0;
  const stream = runtime.modelRuntime.streamSimple(model, { systemPrompt: 'Fixture.', messages: [{ role: 'user', content: 'Reply.', timestamp: 0 }] }, {
    transport: 'sse', reasoning: 'high',
    transformHeaders: headers => { transformed++; return { ...headers, 'X-Zyra-Fixture': 'preserved' }; },
    fetch: async (_url, input) => {
      const id = input.headers.get('chatgpt-account-id');
      requests.push(id);
      assert.equal(input.headers.get('Authorization'), `Bearer ${token(id)}`);
      assert.equal(input.headers.get('x-zyra-fixture'), 'preserved', 'Native attribution/header transforms survive routing.');
      if (id === 'a') return new Response(JSON.stringify({ error: { code: 'usage_limit_reached', message: 'Usage limit reached' } }), { status: 429, headers: { 'retry-after': '120', 'x-codex-primary-used-percent': '100', 'x-codex-primary-reset-at': String(Math.floor(Date.now() / 1000) + 120) } });
      return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream', 'x-codex-primary-used-percent': '22' } });
    },
  });
  const received = [];
  for await (const event of stream) received.push(event);
  const result = await stream.result();
  assert.equal(result.stopReason, 'stop', result.errorMessage);
  assert.equal(result.content[0].text, 'Native pooled response.');
  assert.deepEqual(requests, ['a', 'b']);
  assert.equal(transformed, 2);
  assert.equal(received.filter(event => event.type === 'start').length, 1);
  assert.equal((await pool.list()).find(account => account.id === idA).state, 'limited');
  assert.equal((await pool.list()).find(account => account.id === idB).usage.primary.usedPercent, 22);
  assert.equal((await runtime.modelRegistry.getApiKeyAndHeaders(model)).apiKey, token('b'), 'Preflight uses an eligible account, even when primary is exhausted.');
  assert.equal(store.read('openai-codex').access, token('a'), 'Request routing never swaps global primary credentials.');
  console.log('Native ModelRuntime + real Codex SSE transport: account routing, auth headers, limit capture and safe failover: ok');
} finally { await rm(root, { recursive: true, force: true }); }
