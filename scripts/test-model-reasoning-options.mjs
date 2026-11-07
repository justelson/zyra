import assert from 'node:assert/strict';
import { mapProviderCatalog, createHarnessStreamSimple } from '../src/opencode-harness.mjs';
import { v2CatalogPayload } from '../src/harness-v2-client.mjs';
import { getModelThinkingLevels, coerceThinkingLevelForModel } from '../src/thinking-levels.mjs';
import { harnessV2Fixture } from './fixtures/harness-v2.mjs';
import { installSessionReasoningOptions } from '../src/session-reasoning-options.mjs';
import { normalizeOpenAIManifest } from '../src/openai-model-catalog.mjs';
import { applyProviderDefaultReasoning } from '../src/provider-default-reasoning.mjs';
import { normalizeReasoningChoice } from '../src/reasoning-choices.mjs';

function model(variants, output = ['text']) {
  return { ...mapProviderCatalog(v2CatalogPayload({ data: [{
    providerID: 'new-provider', id: 'unreleased-model-999', name: 'Future model', type: 'chat', enabled: true,
    capabilities: { tools: true, input: ['text'], output },
    variants: variants.map(id => ({ id, settings: { reasoningEffort: id } })), cost: [{ input: 0, output: 0 }],
  }] }))[0], provider: 'opencode-harness' };
}
const glmShape = model(['low', 'high', 'max']);
assert.deepEqual(getModelThinkingLevels(glmShape), ['low', 'high', 'max'], 'text output must not erase advertised reasoning controls');
const future = model(['none', 'off', 'Deep mode', 'ultra', 'default']);
assert.deepEqual(getModelThinkingLevels(future), ['none', 'variant:off', 'variant:Deep%20mode', 'variant:ultra', 'variant:default'], 'future native IDs survive without adding model names or enum values');
assert.equal(coerceThinkingLevelForModel('default', future), 'default', 'provider default is distinct from off and a native variant named default');
assert.equal(coerceThinkingLevelForModel('high', future), 'default', 'unsupported prior-model effort uses provider default, never off');
assert.equal(coerceThinkingLevelForModel('high', model([])), 'default', 'no advertised controls must not force reasoning off');
const next = normalizeOpenAIManifest({ models: [{ slug: 'future-native', supported_reasoning_levels: [{ effort: 'ultra' }, { effort: 'high' }] }] }, 'openai-codex')[0];
assert.deepEqual(next.supportedEfforts, ['variant:ultra', 'high'], 'future manifest efforts are retained without an enum update');
for (const invalid of ['variant:%ZZ', 'variant:%00hidden', 'variant:'+ 'x'.repeat(129)]) assert.equal(normalizeReasoningChoice(invalid), undefined);
const payload = { thinking: { type: 'disabled' }, reasoning_effort: 'low', reasoning: { effort: 'low', summary: 'auto' }, output_config: { effort: 'low', format: 'text' }, generationConfig: { thinkingConfig: { thinkingBudget: 0 }, temperature: 1 } };
const defaultPayload = applyProviderDefaultReasoning(payload);
assert.deepEqual(defaultPayload, { reasoning: { summary: 'auto' }, output_config: { format: 'text' }, generationConfig: { temperature: 1 } });
assert.equal(payload.reasoning.effort, 'low', 'default conversion never mutates the provider request source');
const records = [];
const shared = (model, _context, options) => { records.push(options); return options; };
const one = { agent: { streamFunction: shared } }, two = { agent: { streamFunction: shared } };
let choice = 'variant:ultra';
installSessionReasoningOptions(one, () => choice); installSessionReasoningOptions(two, () => 'default');
const direct = { id: next.id, api: 'openai-responses', zyraSupportedEfforts: next.supportedEfforts };
const firstRequest = one.agent.streamFunction(direct, {}, { onPayload: async body => ({ ...body, marker: true }) });
choice = 'high';
const secondRequest = two.agent.streamFunction(direct, {}, {});
assert.equal((await firstRequest.onPayload({ model: next.id })).reasoning.effort, 'ultra', 'an admitted request snapshots its own session selection');
assert.equal((await firstRequest.onPayload({ model: next.id })).marker, true, 'existing asynchronous payload hooks remain intact');
assert.deepEqual(await secondRequest.onPayload({ thinking: { type: 'disabled' } }), {}, 'another chat keeps provider-default semantics');

for (const [choice, expected] of [['variant:off', 'off'], ['variant:Deep%20mode', 'Deep mode'], ['variant:ultra', 'ultra'], ['variant:default', 'default'], ['default', undefined]]) {
  const fixture = harnessV2Fixture();
  const stream = createHarnessStreamSimple({ executable: 'fixture', fetchImpl: fixture.client.fetch, ensureServe: async () => ({ client: fixture.client, release() {} }) });
  const session = { agent: { streamFunction: stream } };
  installSessionReasoningOptions(session, () => choice);
  const result = await session.agent.streamFunction(future, { messages: [{ role: 'user', content: 'fixture' }] }, { reasoning: 'off' }).result();
  assert.equal(result.stopReason, 'stop', result.errorMessage);
  const sent = fixture.calls.find(call => call.route.endsWith('/model') && call.body?.model)?.body.model;
  assert(sent, 'native model selection must be exercised');
  assert.equal(sent.variant, expected, 'the native API receives the exact selected variant, while default omits an override');
}
console.log('Model reasoning: text-only outputs, unknown models/native variants, default semantics and exact V2 requests passed.');
