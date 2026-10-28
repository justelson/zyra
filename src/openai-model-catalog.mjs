import { refreshModelPricing } from './model-pricing/refresh.mjs';
import { getModelPricing, runtimeModelCost } from './model-pricing/index.mjs';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { resolveZyraAuthPath } from './zyra-auth-store.mjs';
import { writeProviderJson, withProviderStoreLock } from './provider-transactions.mjs';

const PROVIDERS = ['openai', 'openai-codex'];
const EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
const TTL_MS = 15 * 60_000;
const REFRESH_TIMEOUT_MS = 25_000;
// Protocol compatibility version for OpenAI's models manifest, not a model list.
const CLIENT_VERSION = '0.159.0';
const digest = value => createHash('sha256').update(value).digest('hex');

function tokenIdentity(token) {
  try {
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    return { account: claims['https://api.openai.com/auth']?.chatgpt_account_id, subject: claims.sub };
  } catch { return {}; }
}

async function identityFor(authStorage, provider, signal) {
  if (!authStorage?.hasAuth?.(provider)) return null;
  // Cache reads do not refresh an OAuth token. Its stable account identity
  // survives token rotation while isolating login/account replacements.
  const stored = authStorage.get?.(provider);
  const key = provider === 'openai-codex' && stored?.access
    ? stored.access : await authStorage.getApiKey(provider, { signal });
  if (!key) throw new Error(`${provider} credentials are unavailable.`);
  const identity = provider === 'openai-codex' ? tokenIdentity(key) : {};
  return { fingerprint: digest(identity.account && identity.subject ? `${identity.account}:${identity.subject}` : key) };
}

const COMPAT_FIELDS = ['supportsAdditionalTools', 'supportsToolSearch', 'supportsOpenAIGrammarTools', 'supportsStrictMode', 'supportsExplicitPromptCacheMode'];
const manifestCompat = model => Object.fromEntries(COMPAT_FIELDS.flatMap(key => {
  const snake = key.replace(/[A-Z]/g, char => `_${char.toLowerCase()}`);
  const value = model.compat?.[key] ?? model[snake];
  return typeof value === 'boolean' ? [[key, value]] : [];
}));

/** Transport support is independent of account availability and pricing. Only
 * preserve the same model's flags or documented protocol-family support. */
export function resolveOpenAITransportCompat(provider, model, existing) {
  const documentedAdditionalTools = /^gpt-(?:5\.6-(?:luna|sol|terra)|6(?:\.\d+)?-(?:astra|sol|luna))(?:-\d{4}-\d{2}-\d{2})?$/.test(model.id);
  const compat = { ...(existing?.compat ?? {}),
    ...(documentedAdditionalTools ? { supportsAdditionalTools: true, ...(provider === 'openai' ? { supportsExplicitPromptCacheMode: true } : {}) } : {}),
    ...manifestCompat(model) };
  return Object.keys(compat).length ? compat : undefined;
}

const hasRetired = (date, now) => typeof date === 'string' && Number.isFinite(Date.parse(date)) && Date.parse(date) <= now;

export function normalizeOpenAIManifest(body, provider, now = Date.now()) {
  if (!Array.isArray(body?.models)) throw new Error('OpenAI returned an invalid model manifest.');
  const seen = new Set();
  return body.models.flatMap(model => {
    if (typeof model?.slug !== 'string' || !model.slug.trim() || seen.has(model.slug)) throw new Error('OpenAI returned an invalid model manifest.');
    seen.add(model.slug);
    if (['hide', 'none'].includes(model.visibility) || model.show_in_picker === false
      || hasRetired(model.upgrade?.retirement_at, now) || hasRetired(model.shutdown_date, now)
      || (provider === 'openai' && model.supported_in_api === false)) return [];
    const efforts = [...new Set((model.supported_reasoning_levels ?? []).map(level => level.effort).filter(effort => EFFORTS.has(effort)))];
    const tokens = value => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
    return [{ id: model.slug, provider, label: model.display_name || model.slug,
      metadataSource: 'openai-models-manifest',
      compat: manifestCompat(model),
      auto_compact_token_limit: tokens(model.auto_compact_token_limit),
      context_window: tokens(model.context_window),
      max_context_window: tokens(model.max_context_window),
      effective_context_window_percent: tokens(model.effective_context_window_percent),
      description: typeof model.description === 'string' ? model.description : provider,
      supportedEfforts: efforts,
      inputModes: Array.isArray(model.input_modalities) ? model.input_modalities.filter(mode => ['text', 'image'].includes(mode)) : ['text', 'image'],
      contextWindow: Number(model.context_window) > 0 ? Number(model.context_window) : null,
      maxTokens: Number(model.max_output_tokens) > 0 ? Number(model.max_output_tokens) : 4096,
    }];
  });
}

async function getJson(fetchImpl, url, headers, signal) {
  const requestTimeout = AbortSignal.timeout(15_000);
  const response = await fetchImpl(url, { method: 'GET', headers, redirect: 'error', signal: signal ? AbortSignal.any([signal, requestTimeout]) : requestTimeout });
  if (!response.ok) throw new Error(`OpenAI model list failed (HTTP ${response.status}).`);
  return response.json();
}

async function discoverModels(provider, options) {
  const { authStorage, signal, fetchImpl = fetch } = options;
  const key = await authStorage.getApiKey(provider, { signal });
  if (!key) throw new Error(`${provider} credentials are unavailable.`);
  const account = provider === 'openai-codex' ? tokenIdentity(key).account : null;
  const headers = { Authorization: `Bearer ${key}`, originator: 'zyra_desktop', ...(account ? { 'ChatGPT-Account-Id': account } : {}) };
  const manifestUrl = `https://chatgpt.com/backend-api/codex/models?client_version=${CLIENT_VERSION}`;
  if (provider === 'openai-codex') return normalizeOpenAIManifest(await getJson(fetchImpl, manifestUrl, headers, signal), provider);

  // /v1/models is authoritative for API account availability. The manifest
  // supplies richer capabilities when supported; releases need no local entry.
  const body = await getJson(fetchImpl, 'https://api.openai.com/v1/models', headers, signal);
  if (!Array.isArray(body?.data) || body.data.some(m => typeof m?.id !== 'string' || !m.id.trim())) throw new Error('OpenAI returned an invalid model list.');
  let metadata = new Map();
  let excluded = new Set();
  try {
    const manifest = await getJson(fetchImpl, manifestUrl, headers, signal);
    metadata = new Map(normalizeOpenAIManifest(manifest, provider).map(m => [m.id, m]));
    excluded = new Set(manifest.models.filter(m => !metadata.has(m.slug)).map(m => m.slug));
  } catch (error) { if (signal?.aborted) throw error; /* API keys may not support the richer manifest. */ }
  return body.data.filter(model => !excluded.has(model.id) && !hasRetired(model.shutdown_date, Date.now()) && (
    metadata.has(model.id) || (/^(?:gpt-|chatgpt-|o\d|ft:(?:gpt-|o\d))/.test(model.id)
      && !/(?:embedding|realtime|audio|transcrib|tts|image)/i.test(model.id))
  )).map(model => metadata.get(model.id) ?? {
    id: model.id, provider, label: model.id, description: 'OpenAI', supportedEfforts: [], inputModes: ['text'], contextWindow: null, maxTokens: 4096,
    metadataSource: 'openai-models-api', context_window: null, max_context_window: null,
    auto_compact_token_limit: null, effective_context_window_percent: null,
  });
}

/** Zyra owns discovery/cache. Provider results replace lists, never merge built-ins. */
export async function syncOpenAIModelCatalog(options = {}) {
  if (options.cacheOnly || /^(?:1|true|yes)$/i.test(String((options.env ?? process.env).ZYRA_OFFLINE ?? ''))) return readOrRefreshCatalog(options);
  const controller = new AbortController();
  const requestedTimeout = Number(options.refreshTimeoutMs);
  const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0 ? Math.min(requestedTimeout, REFRESH_TIMEOUT_MS) : REFRESH_TIMEOUT_MS;
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(new DOMException('OpenAI model catalog refresh timed out.', 'TimeoutError')), timeoutMs);
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = () => reject(signal.reason); });
  signal.addEventListener('abort', rejectAbort, { once: true });
  try {
    signal.throwIfAborted();
    return await Promise.race([readOrRefreshCatalog({ ...options, signal }), aborted]);
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason;
    if (controller.signal.aborted && options.allowStale) return readOrRefreshCatalog({ ...options, cacheOnly: true, signal: options.signal }, error);
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', rejectAbort);
  }
}

async function readOrRefreshCatalog(options, cacheFailure) {
  const authPath = options.authPath ?? resolveZyraAuthPath(options);
  const authDirectory = dirname(authPath);
  const fileRoot = options.catalogDirectory ?? join(authDirectory.endsWith('credentials') ? dirname(authDirectory) : authDirectory, 'model-catalog');
  const offline = /^(?:1|true|yes)$/i.test(String((options.env ?? process.env).ZYRA_OFFLINE ?? ""));
  const pricingTask = refreshModelPricing({ ...options, directory: fileRoot, fetchImpl: options.pricingFetchImpl ?? options.fetchImpl });
  const catalog = new Map();
  const errors = [];
  let missingCacheOnFailure = false;
  await Promise.all(PROVIDERS.map(async provider => {
    const identity = await identityFor(options.authStorage, provider, options.signal);
    if (!identity) { catalog.set(provider, []); return; }
    const file = join(fileRoot, `${provider}.json`);
    let cached;
    try { cached = JSON.parse(await readFile(file, 'utf8')); } catch { /* Missing/corrupt cache is rediscovered. */ }
    const valid = cached?.version === 1 && cached.fingerprint === identity.fingerprint && Array.isArray(cached.models)
      && cached.models.every(model => typeof model?.id === 'string' && Array.isArray(model.supportedEfforts) && Array.isArray(model.inputModes));
    if (cacheFailure && !valid) throw cacheFailure;
    if (options.cacheOnly || offline || (valid && !options.forceRefresh && Date.now() - cached.updatedAt < TTL_MS)) {
      catalog.set(provider, valid ? cached.models : []);
      return;
    }
    try {
      const models = await discoverModels(provider, options);
      options.signal?.throwIfAborted();
      // Never publish results obtained during an account replacement.
      const currentIdentity = await identityFor(options.authStorage, provider, options.signal);
      if (currentIdentity?.fingerprint !== identity.fingerprint) throw new Error('OpenAI account changed during model discovery.');
      await withProviderStoreLock(file, () => {
        options.signal?.throwIfAborted();
        return writeProviderJson(file, { version: 1, fingerprint: identity.fingerprint, updatedAt: Date.now(), models });
      });
      catalog.set(provider, models);
    } catch (error) {
      catalog.set(provider, valid ? cached.models : []);
      errors.push(error);
      if (!valid) missingCacheOnFailure = true;
    }
  }));
  const pricingSnapshot = await pricingTask;
  if (errors.length && (!options.allowStale || missingCacheOnFailure)) throw new Error(errors.map(error => error.message).join(' '));
  for (const [provider, models] of catalog) catalog.set(provider, models.map(model => ({ ...model, pricing: getModelPricing(model.id, pricingSnapshot), pricingFetchedAt: pricingSnapshot.fetchedAt, pricingSource: pricingSnapshot.source })));
  return catalog;
}

/** Adapt Zyra metadata to the existing inference engine's transport contract. */
export async function applyOpenAIModelCatalog(registry, catalog) {
  registry.zyraOpenAIModelCatalog = catalog;
  for (const [provider, models] of catalog) {
    const existing = new Map((registry.getAll?.() ?? []).filter(model => model.provider === provider).map(model => [model.id, model]));
    registry.registerProvider(provider, { models: models.map(model => ({
      compat: resolveOpenAITransportCompat(provider, model, existing.get(model.id)),
      id: model.id, name: model.label, api: provider === 'openai' ? 'openai-responses' : 'openai-codex-responses',
      baseUrl: provider === 'openai' ? 'https://api.openai.com/v1' : 'https://chatgpt.com/backend-api',
      reasoning: model.supportedEfforts.length > 0,
      zyraSupportedEfforts: model.supportedEfforts,
      zyraModelInfo: model,
      thinkingLevelMap: Object.fromEntries(model.supportedEfforts.filter(effort => effort !== 'max' || !model.supportedEfforts.includes('xhigh')).map(effort => [effort === 'max' ? 'xhigh' : effort === 'none' ? 'off' : effort, effort])),
      // Unknown is retained, not fabricated as an 8k model. Extended capacity
      // requires a separate provider/runtime configuration, never a higher limit.
      input: model.inputModes, contextWindow: model.contextWindow, maxTokens: model.maxTokens,
      // The discovery API does not supply prices. Do not borrow a different model's price.
      cost: runtimeModelCost(model.id, model.pricing),
    })) });
  }
  await registry.refresh?.({ allowNetwork: false });
  // Preserve the provider's reasoning metadata even if the transport drops
  // extension fields while composing its model definitions.
  for (const model of registry.getAll?.() ?? []) {
    const metadata = catalog.get(model.provider)?.find(entry => entry.id === model.id);
    if (metadata) { model.zyraSupportedEfforts = metadata.supportedEfforts; model.zyraModelInfo = metadata; model.cost = runtimeModelCost(model.id, metadata.pricing); }
  }
}
