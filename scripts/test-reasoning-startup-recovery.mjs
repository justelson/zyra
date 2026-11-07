import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { getZyraAvailableThinkingLevels, setThinking, getZyraThinkingLevel } from '../src/zyra-sdk.mjs';
import { installSessionReasoningOptions } from '../src/session-reasoning-options.mjs';

const root = await mkdtemp(join(tmpdir(), 'zyra-reasoning-startup-'));
const originalFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = () => { networkCalls++; throw new Error('Startup recovery cannot fetch models or call a provider'); };
try {
  const model = { provider: 'openai-codex', id: 'gpt-6.1-sol', api: 'openai-codex-responses', reasoning: false };
  const catalog = new Map([['openai-codex', [{ id: model.id, supportedEfforts: ['low', 'high', 'variant:ultra'] }]]]);
  const requests = [];
  const session = { model, modelRegistry: { zyraOpenAIModelCatalog: catalog },
    getAvailableThinkingLevels: () => [], setThinkingLevel() {},
    agent: { streamFunction: (selected, _context, options) => { requests.push({ selected, options }); return options; } } };
  const runtime = { session, project: root, thinkingState: { value: 'low' } };
  assert.deepEqual(getZyraAvailableThinkingLevels(runtime), ['low', 'high', 'variant:ultra'], 'admission must use known catalog capabilities even if a runtime model copy lost its fields');
  assert.equal(setThinking(runtime, 'high'), 'high');
  assert.equal(getZyraThinkingLevel(runtime), 'high');
  installSessionReasoningOptions(session, () => runtime.thinkingState.value);
  const options = session.agent.streamFunction(model, {}, {});
  assert.equal((await options.onPayload({model:model.id})).reasoning.effort,'high','the restored effort reaches the actual request, not only the UI');
  assert.equal(requests[0].selected.reasoning,true,'transport receives the same known reasoning capability');
  assert.equal(networkCalls,0,'no startup discovery or provider call is needed');
  assert.equal(model.reasoning,false,'repair does not mutate shared model objects');
  console.log('Reasoning startup: catalog/runtime drift recovers High through admission and request payload without network');
} finally {
  globalThis.fetch = originalFetch;
  assert.equal(dirname(resolve(root)),resolve(tmpdir()));
  assert.ok(basename(root).startsWith('zyra-reasoning-startup-'));
  await rm(root,{recursive:true,force:true});
}
