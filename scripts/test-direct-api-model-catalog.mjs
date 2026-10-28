import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyDirectApiModelCatalog, discoverDirectApiModels, getDirectApiBaseline, normalizeDirectApiModels, syncDirectApiModelCatalog } from '../src/direct-api-model-catalog.mjs';

const googleModel = (id, extra = {}) => ({ name: `models/${id}`, displayName: id, supportedGenerationMethods: ['generateContent'], inputTokenLimit: 1048576, outputTokenLimit: 65536, ...extra });
const response = body => ({ ok: true, json: async () => body });
const google = normalizeDirectApiModels('google', [googleModel('gemini-future'), googleModel('gemini-future'), googleModel('gemini-tts'), googleModel('gemini-live'), googleModel('gemini-image'), googleModel('gemini-robotics-er-2-preview'), googleModel('gemini-embedding', { supportedGenerationMethods: ['embedContent'] })]);
assert.deepEqual(google.map(model => model.id), ['gemini-future']);
assert.equal(google[0].contextWindow, 1048576);
assert.equal(google[0].cost.pricing, null, 'unknown price is not claimed to be free');
assert.equal(google[0].reasoning, false, 'unknown reasoning controls are not guessed');
const groq = normalizeDirectApiModels('groq', [{ id: 'future/model', context_window: 262144 }, { id: 'whisper-large-v3' }, { id: 'canopylabs/orpheus-v1-english' }, { id: 'meta-llama/llama-prompt-guard-2-22m' }, { id: 'groq/compound' }, { id: 'retired', active: false }]);
assert.deepEqual(groq.map(model => model.id), ['future/model']);
assert.equal(groq[0].contextWindow, 262144);
assert.equal(normalizeDirectApiModels('groq', [{ id: 'future/unknown' }])[0].contextWindow, null);
assert.throws(() => normalizeDirectApiModels('google', [{}]), /invalid model/);
assert.throws(() => normalizeDirectApiModels('groq', [{ id: '../secret' }]), /invalid model/);
assert.throws(() => normalizeDirectApiModels('other', []), /Choose/);

const requests = [];
const paged = await discoverDirectApiModels({ provider: 'google', apiKey: 'synthetic-google-key', fetchImpl: async (url, init) => {
  requests.push({ url, init });
  return response(requests.length === 1 ? { models: [googleModel('gemini-first')], nextPageToken: 'next-page' } : { models: [googleModel('gemini-second')] });
} });
assert.deepEqual(paged.map(model => model.id), ['gemini-first', 'gemini-second']);
assert.equal(new URL(requests[1].url).searchParams.get('pageToken'), 'next-page');
assert.equal(requests[0].init.headers['x-goog-api-key'], 'synthetic-google-key');
assert.equal(requests[0].init.redirect, 'error');
assert.ok(requests.every(request => !request.url.includes('synthetic-google-key')));
await discoverDirectApiModels({ provider: 'groq', apiKey: 'synthetic-groq-key', fetchImpl: async (url, init) => {
  assert.equal(url, 'https://api.groq.com/openai/v1/models');
  assert.equal(init.headers.Authorization, 'Bearer synthetic-groq-key');
  return response({ data: [{ id: 'openai/gpt-oss-120b' }] });
} });
await assert.rejects(discoverDirectApiModels({ provider: 'google', apiKey: 'fixture', fetchImpl: async () => response({ models: [], nextPageToken: 'repeated' }) }), /pagination/);
await assert.rejects(discoverDirectApiModels({ provider: 'groq', apiKey: 'fixture', fetchImpl: async () => ({ ok: false, status: 401 }) }), /HTTP 401/);

const directStop = new AbortController();
const directPending = discoverDirectApiModels({ provider: 'groq', apiKey: 'fixture', signal: directStop.signal, fetchImpl: () => new Promise(() => {}) });
setTimeout(() => directStop.abort(new Error('Direct listing stopped')), 5);
await assert.rejects(directPending, /Direct listing stopped/);

const directory = await mkdtemp(join(tmpdir(), 'zyra-direct-models-'));
try {
  let keys = { google: 'fixture-google-a', groq: 'fixture-groq-a' };
  let lists = { google: [googleModel('gemini-account-a')], groq: [{ id: 'account-a/model' }] };
  let calls = 0;
  const authStorage = { hasAuth: provider => Boolean(keys[provider]), getApiKey: async provider => keys[provider] };
  const fetchImpl = async url => { calls++; return response(url.includes('googleapis') ? { models: lists.google } : { data: lists.groq }); };
  const options = { authStorage, catalogDirectory: directory, fetchImpl, env: {}, allowStale: false };
  const first = await syncDirectApiModelCatalog(options);
  assert.equal(calls, 2);
  assert.deepEqual(first.get('google').map(model => model.id), ['gemini-account-a']);
  assert.deepEqual(first.get('groq').map(model => model.id), ['account-a/model']);
  const saved = await readFile(join(directory, 'google.json'), 'utf8');
  assert.ok(!saved.includes(keys.google), 'keys are never persisted in model caches');
  assert.deepEqual(await syncDirectApiModelCatalog({ ...options, cacheOnly: true }), first);
  await syncDirectApiModelCatalog(options);
  assert.equal(calls, 2, 'fresh cache avoids network');
  lists = { google: [googleModel('gemini-account-new')], groq: [] };
  const changed = await syncDirectApiModelCatalog({ ...options, forceRefresh: true });
  assert.deepEqual(changed.get('google').map(model => model.id), ['gemini-account-new']);
  assert.deepEqual(changed.get('groq'), [], 'successful empty list removes stale models');
  const failed = await syncDirectApiModelCatalog({ ...options, forceRefresh: true, allowStale: true, fetchImpl: async () => { throw new Error('Offline'); } });
  assert.deepEqual(failed, changed, 'failed fetch keeps the same account last-known list');
  const rotatedFailure = await syncDirectApiModelCatalog({ ...options, forceRefresh: true, allowStale: true, fetchImpl: async url => {
    if (url.includes('googleapis')) keys.google = 'fixture-google-rotated';
    throw new Error('Offline during key rotation');
  } });
  assert.deepEqual(rotatedFailure.get('google'), getDirectApiBaseline('google'), 'a failed request cannot restore the old account cache after rotation');
  const loggedOut = await syncDirectApiModelCatalog({ ...options, authStorage: { hasAuth: () => false } });
  assert.deepEqual(loggedOut.get('google'), getDirectApiBaseline('google'), 'logout replaces previous provider overrides');
  const stalledAuth = await syncDirectApiModelCatalog({ ...options, allowStale: true, refreshTimeoutMs: 20,
    authStorage: { hasAuth: () => true, getApiKey: () => new Promise(() => {}) } });
  assert.deepEqual(stalledAuth.get('google'), getDirectApiBaseline('google'), 'credential resolution cannot block model refresh indefinitely');
  keys.google = 'fixture-google-b';
  const switched = await syncDirectApiModelCatalog({ ...options, cacheOnly: true });
  assert.deepEqual(switched.get('google'), getDirectApiBaseline('google'), 'another key cannot inherit account-specific model visibility');
  await assert.rejects(syncDirectApiModelCatalog({ ...options, forceRefresh: true, fetchImpl: async url => {
    if (url.includes('googleapis')) keys.google = 'fixture-google-c';
    return response(url.includes('googleapis') ? { models: [googleModel('gemini-wrong-account')] } : { data: [] });
  } }), /account changed/);
  assert.ok(!(await readFile(join(directory, 'google.json'), 'utf8')).includes('wrong-account'));

  const beforeTimeout = await readFile(join(directory, 'google.json'), 'utf8');
  const late = [];
  const timed = await syncDirectApiModelCatalog({ ...options, allowStale: true, forceRefresh: true, refreshTimeoutMs: 30,
    fetchImpl: () => new Promise(resolve => late.push(resolve)) });
  assert.equal(late.length, 2, 'providers refresh concurrently');
  assert.deepEqual(timed.get('google'), getDirectApiBaseline('google'));
  for (const resolve of late) resolve(response({ models: [googleModel('gemini-late')], data: [{ id: 'late/model' }] }));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(await readFile(join(directory, 'google.json'), 'utf8'), beforeTimeout, 'expired requests cannot overwrite caches');
  const controller = new AbortController(); controller.abort(new Error('Stopped fixture'));
  await assert.rejects(syncDirectApiModelCatalog({ ...options, signal: controller.signal }), /Stopped fixture/);

  // Exercise the actual registry adapter, then cold restoration and SDK listing.
  const authPath = join(directory, 'auth.json');
  await writeFile(authPath, JSON.stringify(Object.fromEntries(Object.entries(keys).map(([provider, key]) => [provider, { type: 'api_key', key }]))));
  const runtimeOptions = { authPath, modelsPath: join(directory, 'models.json'), catalogDirectory: directory,
    loadSavedProviders: false, loadOpenAICatalog: false, refreshAccountUsage: false, env: {}, fetchImpl };
  lists = { google: [googleModel('gemini-sdk-fixture')], groq: [{ id: 'sdk/fixture' }] };
  const catalog = await syncDirectApiModelCatalog({ ...options, forceRefresh: true });
  const { createZyraRuntime } = await import('../src/zyra-runtime.mjs');
  const runtime = await createZyraRuntime(runtimeOptions);
  await applyDirectApiModelCatalog(runtime.modelRegistry, catalog);
  assert.equal(runtime.modelRegistry.find('google', 'gemini-sdk-fixture')?.contextWindow, 1048576);
  assert.equal(runtime.modelRegistry.find('groq', 'sdk/fixture')?.cost.pricing, null);
  assert.equal(runtime.modelRegistry.find('groq', 'openai/gpt-oss-120b'), undefined, 'baseline is replaced, not merged back');
  const cold = await createZyraRuntime(runtimeOptions);
  assert.ok(cold.modelRegistry.getAvailable().some(model => model.id === 'gemini-sdk-fixture'));
  const { listAvailableModels } = await import('../src/zyra-sdk.mjs');
  const sdk = await listAvailableModels({ ...runtimeOptions, forceRefresh: true, skipAvailability: true,
    fetchImpl: async (url, init) => String(url).includes('googleapis') || String(url).includes('api.groq.com') ? fetchImpl(url, init) : { ok: false, status: 503 },
  });
  assert.ok(sdk.some(model => model.id === 'google/gemini-sdk-fixture'));
  assert.ok(sdk.some(model => model.id === 'groq/sdk/fixture'));
  console.log('Direct API models: pagination, metadata, removals, empty accounts, key isolation, cancellation, offline restore and SDK refresh: ok');
} finally {
  await rm(directory, { recursive: true, force: true });
}
