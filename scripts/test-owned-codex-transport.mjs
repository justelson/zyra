import assert from 'node:assert/strict';
import { zstdDecompressSync } from 'node:zlib';
import { streamSimple, stream as streamCodex } from '../src/runtime/providers/src/api/openai-codex-responses.js';

const model = { id: 'future-model', name: 'Future model', api: 'openai-codex-responses', provider: 'openai-codex', baseUrl: 'https://chatgpt.com/backend-api', reasoning: true, input: ['text', 'image'], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const token = ['fixture', Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'fixture-account' } })).toString('base64'), 'fixture'].join('.');
const output = { type: 'message', id: 'fixture-message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: 'Owned transport reply.', annotations: [] }] };
const events = [
  { type: 'response.created', response: { id: 'fixture-response', status: 'in_progress' } },
  { type: 'response.output_item.added', output_index: 0, item: { ...output, status: 'in_progress', content: [] } },
  { type: 'response.content_part.added', item_id: output.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
  { type: 'response.output_text.delta', item_id: output.id, output_index: 0, content_index: 0, delta: output.content[0].text },
  { type: 'response.output_item.done', output_index: 0, item: output },
  { type: 'response.completed', response: { id: 'fixture-response', status: 'completed', output: [output], usage: { input_tokens: 12, output_tokens: 4, total_tokens: 16, input_tokens_details: { cached_tokens: 0 } } } },
];
let requests = 0;
const stream = streamSimple(model, { systemPrompt: 'Fixture only.', messages: [{ role: 'user', content: 'Reply to the fixture.', timestamp: 0 }] }, {
  apiKey: token, transport: 'sse', reasoning: 'high', maxRetries: 0,
  fetch: async (url, options) => {
    requests++;
    assert.equal(url, 'https://chatgpt.com/backend-api/codex/responses');
    assert.equal(options.headers.get('originator'), 'zyra');
    assert.match(options.headers.get('User-Agent'), /^zyra\b/);
    assert.equal(options.headers.get('chatgpt-account-id'), 'fixture-account');
    assert.equal(options.headers.get('x-codex-routing-hint'), 'model=future-model');
    assert.equal(options.headers.get('Authorization'), `Bearer ${token}`);
    const body = options.headers.get("content-encoding") === "zstd" ? zstdDecompressSync(options.body).toString("utf8") : String(options.body);
    const payload = JSON.parse(body);
    assert.equal(payload.model, 'future-model', 'A new model ID must pass through without a catalog release.');
    assert.equal(payload.reasoning.effort, 'high');
    assert.equal(payload.store, false);
    return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  },
});
const received = [];
for await (const event of stream) received.push(event);
const result = await stream.result();
assert.equal(requests, 1);
assert.equal(result.stopReason, 'stop', result.errorMessage);
assert.equal(result.content[0].text, 'Owned transport reply.');
assert.equal(result.usage.input, 12);
assert.equal(result.usage.output, 4);
assert.ok(received.some(event => event.type === 'text_delta'));
assert.equal(result.usage.cost.source, 'unpriced', 'an undiscovered price is not a free model');
const oldReasoning = { type: 'reasoning', id: 'rs_past_fixture', summary: [], encrypted_content: 'opaque-past-fixture' };
const activeReasoning = { type: 'reasoning', id: 'rs_active_fixture', summary: [], encrypted_content: 'opaque-active-fixture' };
const longHistory = [
  { role: 'user', content: 'Earlier request', timestamp: 0 },
  { role: 'assistant', api: model.api, provider: model.provider, model: 'gpt-6.1-sol', content: [
    { type: 'thinking', thinking: '', thinkingSignature: JSON.stringify(oldReasoning) }, { type: 'text', text: 'Earlier visible answer' }], stopReason: 'stop', usage: result.usage, timestamp: 1 },
  { role: 'user', content: 'Current request', timestamp: 2 },
  { role: 'assistant', api: model.api, provider: model.provider, model: 'gpt-6.1-sol', content: [
    { type: 'thinking', thinking: '', thinkingSignature: JSON.stringify(activeReasoning) },
    { type: 'toolCall', id: 'call_fixture|fc_fixture', name: 'fixture_tool', arguments: {} }], stopReason: 'toolUse', usage: result.usage, timestamp: 3 },
  { role: 'toolResult', toolCallId: 'call_fixture|fc_fixture', toolName: 'fixture_tool', content: [{ type: 'text', text: 'Existing tool result' }], isError: false, timestamp: 4 },
];
for (const [id, contextOverride] of [['gpt-6.1-sol'], ['future-model'], ['gpt-6.1-terra'], ['gpt-6.1-sol', 'all_turns']]) {
  const scoped = streamSimple({ ...model, id, reasoning: true }, { messages: longHistory }, {
    apiKey: token, transport: 'sse', reasoning: 'high', maxRetries: 0,
    ...(contextOverride ? { onPayload: body => ({ ...body, reasoning: { ...body.reasoning, context: contextOverride } }) } : {}),
    fetch: async (_url, options) => {
      const raw = options.headers.get('content-encoding') === 'zstd' ? zstdDecompressSync(options.body).toString() : String(options.body);
      const payload = JSON.parse(raw);
      assert.equal(payload.reasoning.context, contextOverride ?? (id === 'gpt-6.1-sol' ? 'current_turn' : undefined), 'Sol scopes opaque reasoning reuse, preserves explicit overrides and does not guess other model policies');
      assert.equal(payload.reasoning.effort, 'high', 'the selected effort is preserved');
      if (id === 'gpt-6.1-sol') {
        assert.deepEqual(payload.input.filter(item => item.type === 'reasoning'), [oldReasoning, activeReasoning], 'the provider receives both past and active reasoning items unchanged');
        assert.ok(payload.input.some(item => item.role === 'assistant' && item.content?.some(part => part.text === 'Earlier visible answer')));
        assert.ok(payload.input.some(item => item.type === 'function_call_output' && item.output === 'Existing tool result'));
      }
      return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  const scopedResult = await scoped.result();
  assert.equal(scopedResult.stopReason, 'stop', scopedResult.errorMessage);
}
const defaultEffort = await streamCodex({ ...model, id: 'gpt-6.1-sol', reasoning: true }, { messages: longHistory }, {
  apiKey: token, transport: 'sse', maxRetries: 0,
  fetch: async (_url, options) => {
    const raw = options.headers.get('content-encoding') === 'zstd' ? zstdDecompressSync(options.body).toString() : String(options.body);
    const payload = JSON.parse(raw);
    assert.deepEqual(payload.reasoning, { context: 'current_turn' }, 'direct callers get the same context scope without overriding the provider effort default');
    return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
  },
}).result();
assert.equal(defaultEffort.stopReason, 'stop', defaultEffort.errorMessage);
for (const returnedTier of ['default', 'priority']) {
  const pricedModel = { ...model, id: 'gpt-6.1-sol' };
  const responseEvents = events.map(event => event.type === 'response.completed' ? { ...event, response: { ...event.response, service_tier: returnedTier } } : event);
  const pricedStream = streamSimple(pricedModel, { messages: [{ role: 'user', content: 'Synthetic tier check', timestamp: 0 }] }, {
    apiKey: token, transport: 'sse', serviceTier: 'priority', maxRetries: 0,
    fetch: async () => new Response(responseEvents.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } }),
  });
  const priced = await pricedStream.result();
  assert.equal(priced.stopReason, 'stop', priced.errorMessage);
  assert.equal(priced.usage.cost.serviceTier, returnedTier === 'default' ? 'standard' : 'fast', 'actual response tier overrides a requested tier');
  assert.ok(Math.abs(priced.usage.cost.total - (returnedTier === 'default' ? .000064 : .000128)) < 1e-12);
}
console.log('Owned Codex transport: direct request, Zyra identity, new model ID, SSE streaming and usage: ok');
