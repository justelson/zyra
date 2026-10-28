import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncOpenAIModelCatalog, applyOpenAIModelCatalog, normalizeOpenAIManifest, resolveOpenAITransportCompat } from '../src/openai-model-catalog.mjs';
assert.equal(resolveOpenAITransportCompat('openai-codex', { id: 'gpt-6.1-sol' }).supportsAdditionalTools, true);
assert.equal(resolveOpenAITransportCompat('openai-codex', { id: 'gpt-unknown', compat: { supportsAdditionalTools: true } }).supportsAdditionalTools, true);
assert.equal(resolveOpenAITransportCompat('openai-codex', { id: 'gpt-6.1-sol', compat: { supportsAdditionalTools: false } }).supportsAdditionalTools, false, 'explicit provider capability wins');
assert.equal(resolveOpenAITransportCompat('openai', { id: 'custom' }, { compat: { supportsStrictMode: false } }).supportsStrictMode, false, 'preserve the SAME model capability');
const discoveredMetadata = normalizeOpenAIManifest({ models: [{ slug: 'metadata-fixture', context_window: 400_000, max_context_window: 1_000_000, auto_compact_token_limit: 350_000, effective_context_window_percent: 95, unknown_capability_flag: true }] }, 'openai-codex')[0];
assert.equal(discoveredMetadata.context_window, 400_000);
assert.equal(discoveredMetadata.max_context_window, 1_000_000);
assert.equal(discoveredMetadata.auto_compact_token_limit, 350_000);
assert.equal(discoveredMetadata.effective_context_window_percent, 95);
assert.equal(discoveredMetadata.metadataSource, 'openai-models-manifest');
assert.equal(discoveredMetadata.unknown_capability_flag, undefined, 'unknown flags never become verified transport capabilities');
const unknownCatalogRegistry = { registerProvider(provider, config) { this.models = config.models; } };
await applyOpenAIModelCatalog(unknownCatalogRegistry, new Map([['openai', [{ id: 'unknown', label: 'Unknown', supportedEfforts: [], inputModes: ['text'], contextWindow: null, maxTokens: 4096 }]]]));
assert.equal(unknownCatalogRegistry.models[0].contextWindow, null, 'unknown context is never replaced by a fictional8k model');
assert.equal(unknownCatalogRegistry.models[0].compat, undefined, 'unverified capabilities are not borrowed from a neighboring model');

const stateDirectory = await mkdtemp(join(tmpdir(), 'zyra-catalog-'));
const token = (account) => `header.${Buffer.from(JSON.stringify({ sub: 'user', 'https://api.openai.com/auth': { chatgpt_account_id: account } })).toString('base64url')}.sig`;
let account = 'account-one';
const authStorage = { hasAuth: p => p === 'openai-codex', get: () => ({ type: 'oauth', access: token(account) }), getApiKey: async () => token(account) };
let manifest = [{ slug: 'future-new-model', display_name: 'Future model', visibility: 'list', input_modalities: ['text', 'image'], context_window: 272000, supported_reasoning_levels: [{ effort: 'high' }, { effort: 'max' }], base_instructions: 'Do not import this prompt' }, { slug: 'hidden', visibility: 'hide' }];
const requests = [];
let fail = false;
const fetchImpl = async (url, init) => {
  requests.push({ url, headers: init.headers });
  return { ok: !fail, status: 503, json: async () => ({ models: manifest }) };
};
const options = { stateDirectory, authStorage, fetchImpl };
try {
  let catalog = await syncOpenAIModelCatalog({ ...options, forceRefresh: true });
  assert.deepEqual(catalog.get('openai-codex').map(m => m.id), ['future-new-model'], 'Provider discovery must add models absent from Pi.');
  assert.deepEqual(catalog.get('openai-codex')[0].supportedEfforts, ['high', 'max']);
  const modelRequest = requests.find(request => request.url.includes('/codex/models'));
  assert.equal(modelRequest.headers['ChatGPT-Account-Id'], 'account-one');
  assert.match(modelRequest.url, /backend-api\/codex\/models\?client_version=/);
  const pricingRequest = requests.find(request => request.url.endsWith('/pricing.md'));
  assert.equal(pricingRequest.headers.Authorization, undefined);
  assert.equal(pricingRequest.headers['ChatGPT-Account-Id'], undefined);
  const registry = { registerProvider(provider, config) { this[provider] = config.models; }, async refresh(options) { assert.equal(options.allowNetwork, false); } };
  await applyOpenAIModelCatalog(registry, catalog);
  assert.equal(registry['openai-codex'][0].api, 'openai-codex-responses');
  assert.equal(registry['openai-codex'][0].contextWindow, 272000);
  assert.equal(registry['openai-codex'][0].thinkingLevelMap.xhigh, 'max');
  const saved = await readFile(join(stateDirectory, 'model-catalog', 'openai-codex.json'), 'utf8');
  assert.ok(!saved.includes('Do not import') && !saved.includes(token(account)), 'Cache contains metadata, never prompts or tokens.');
  manifest = [{ slug: 'replacement', visibility: 'list' }, { slug: 'retired', visibility: 'list', upgrade: { retirement_at: '2000-01-01' } }];
  catalog = await syncOpenAIModelCatalog({ ...options, forceRefresh: true });
  assert.deepEqual(catalog.get('openai-codex').map(m => m.id), ['replacement']);
  await applyOpenAIModelCatalog(registry, catalog);
  assert.deepEqual(registry['openai-codex'].map(m => m.id), ['replacement'], 'Registry replacement cannot resurrect deleted built-ins.');
  fail = true;
  await assert.rejects(syncOpenAIModelCatalog({ ...options, forceRefresh: true }), /HTTP 503/);
  catalog = await syncOpenAIModelCatalog({ ...options, cacheOnly: true });
  assert.deepEqual(catalog.get('openai-codex').map(m => m.id), ['replacement'], 'Failed refresh preserves last good data.');
  catalog = await syncOpenAIModelCatalog({ ...options, forceRefresh: true, allowStale: true });
  assert.deepEqual(catalog.get('openai-codex').map(m => m.id), ['replacement'], 'Inference can use cached capabilities during a provider outage.');
  account = 'account-two';
  catalog = await syncOpenAIModelCatalog({ ...options, cacheOnly: true });
  assert.deepEqual(catalog.get('openai-codex'), [], 'Another account cannot inherit cached availability.');
  fail = false;
  manifest = [];
  catalog = await syncOpenAIModelCatalog({ ...options, forceRefresh: true });
  await applyOpenAIModelCatalog(registry, catalog);
  assert.deepEqual(registry['openai-codex'], [], 'Authoritative empty list removes all choices.');
  manifest = [{ slug: '' }];
  await assert.rejects(syncOpenAIModelCatalog({ ...options, forceRefresh: true }), /invalid/);
  const apiCatalog = await syncOpenAIModelCatalog({ stateDirectory, forceRefresh: true,
    authStorage: { hasAuth: p => p === 'openai', getApiKey: async () => 'fake-api-key' },
    fetchImpl: async url => ({ ok: true, json: async () => url.includes('api.openai.com') ? { data: [{ id: 'gpt-future' }, { id: 'text-embedding-3-large' }, { id: 'gpt-retired', shutdown_date: '2000-01-01' }] } : { models: [{ slug: 'old-api-model', visibility: 'list', supported_in_api: true }] } }),
  });
  assert.deepEqual(apiCatalog.get('openai').map(m => m.id), ['gpt-future'], 'API account endpoint adds releases and excludes removed, retired and non-chat models.');
  const stalledOptions = {
    ...options, forceRefresh: true, refreshTimeoutMs: 100,
    fetchImpl: async () => new Promise(() => {}),
    pricingFetchImpl: async () => { throw new Error('Synthetic pricing unavailable'); },
  };
  // Even an injected adapter that ignores AbortSignal cannot consume the entire
  // bridge deadline. A timeout must not publish a false authoritative empty list.
  const started = performance.now();
  await assert.rejects(syncOpenAIModelCatalog(stalledOptions), /refresh timed out/);
  assert.ok(performance.now() - started < 2_000, 'catalog has an aggregate deadline, independent of per-request signals');
  const preserved = await syncOpenAIModelCatalog({ ...stalledOptions, allowStale: true });
  assert.deepEqual(preserved.get('openai-codex'), [], 'a valid authoritative empty cache survives a stalled refresh');
  account = 'uncached-account';
  await assert.rejects(syncOpenAIModelCatalog({ ...stalledOptions, allowStale: true }), /refresh timed out/, 'timeouts cannot claim empty availability for an account without a matching saved catalog');
  const aborted = new AbortController();
  aborted.abort(new Error('Fixture cancelled'));
  await assert.rejects(syncOpenAIModelCatalog({ ...stalledOptions, signal: aborted.signal, allowStale: true }), /Fixture cancelled/, 'caller cancellation remains visible');
  console.log('Zyra OpenAI catalog: direct discovery, additions, removals, account isolation, runtime registration and failure preservation: ok');
} finally { await rm(stateDirectory, { recursive: true, force: true }); }
