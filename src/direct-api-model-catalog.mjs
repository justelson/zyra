import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import google from './runtime/providers/src/providers/data/google.json' with { type: 'json' };
import groq from './runtime/providers/src/providers/data/groq.json' with { type: 'json' };
import { resolveZyraAuthPath } from './zyra-auth-store.mjs';
import { withProviderStoreLock, writeProviderJson } from './provider-transactions.mjs';

const CONFIG = {
  google: { api: 'google-generative-ai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', baseline: google['google-generative-ai'] },
  groq: { api: 'openai-completions', baseUrl: 'https://api.groq.com/openai/v1', baseline: groq['openai-completions'] },
};
const TTL_MS = 15 * 60_000;
const TIMEOUT_MS = 15_000;
const MAX_PAGES = 20;
const UNKNOWN_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, pricing: null };
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
const fingerprint = key => createHash('sha256').update(key).digest('hex');
const providerConfig = provider => {
  if (!Object.hasOwn(CONFIG, provider)) throw new Error('Choose Google or Groq.');
  return CONFIG[provider];
};

export function getDirectApiBaseline(provider) {
  return structuredClone(Object.values(providerConfig(provider).baseline));
}

/** List endpoints also expose speech, embeddings, safety classifiers and managed
 * agents. They cannot be used as ordinary chat-completion models. */
function isChatModel(provider, row, id) {
  if (provider === 'google') {
    return Array.isArray(row.supportedGenerationMethods) && row.supportedGenerationMethods.includes('generateContent')
      && /^(gemini-|gemma-)/.test(id)
      && !/(?:embedding|image|live|audio|tts|transcrib|robotics|computer-use|deep-research|omni)/i.test(id);
  }
  return row.active !== false && !/(?:whisper|orpheus|tts|transcrib|embedding|guard|safeguard|compound)/i.test(id);
}

export function normalizeDirectApiModels(provider, rows) {
  const config = providerConfig(provider);
  if (!Array.isArray(rows)) throw new Error(`${provider} returned an invalid model list.`);
  const seen = new Set();
  return rows.flatMap(row => {
    const rawId = provider === 'google' ? row?.name : row?.id;
    if (typeof rawId !== 'string' || !rawId.trim()) throw new Error(`${provider} returned an invalid model entry.`);
    const id = provider === 'google' ? rawId.replace(/^models\//, '') : rawId;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(id) || id.includes('..')) throw new Error(`${provider} returned an invalid model ID.`);
    if (seen.has(id)) return [];
    seen.add(id);
    if (!isChatModel(provider, row, id)) return [];
    const known = config.baseline[id];
    const contextWindow = positive(provider === 'google' ? row.inputTokenLimit : row.context_window) ?? known?.contextWindow ?? null;
    const maxTokens = positive(provider === 'google' ? row.outputTokenLimit : row.max_completion_tokens) ?? known?.maxTokens ?? 4096;
    // New endpoint IDs remain usable without borrowing another model's prices,
    // vision support or reasoning controls. Provider defaults handle unknowns.
    return [{ ...(known ? structuredClone(known) : {}), id, provider,
      name: (provider === 'google' ? row.displayName : row.name) || known?.name || id,
      api: config.api, baseUrl: config.baseUrl,
      reasoning: known?.reasoning ?? false, input: known?.input ? [...known.input] : ['text'],
      contextWindow, maxTokens, cost: known?.cost ? structuredClone(known.cost) : { ...UNKNOWN_COST },
    }];
  });
}

/** Read-only, key-scoped discovery. No completion request or credential storage.
 * Shared by Zyra and the temporary BYOK chat. Never place keys in URLs/errors. */
export async function discoverDirectApiModels({ provider, apiKey, signal, fetchImpl = fetch } = {}) {
  const config = providerConfig(provider);
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('Enter an API key.');
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new DOMException('Model discovery timed out.', 'TimeoutError')), TIMEOUT_MS);
  const requestSignal = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  try {
  const rows = [];
  const pageTokens = new Set();
  let pageToken;
  for (let page = 0; page < MAX_PAGES; page++) {
    requestSignal.throwIfAborted();
    const url = new URL(`${config.baseUrl}/models`);
    if (provider === 'google') {
      url.searchParams.set('pageSize', '1000');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
    }
    const response = await abortable(() => fetchImpl(url.toString(), {
      method: 'GET', redirect: 'error', signal: requestSignal,
      headers: provider === 'google' ? { 'x-goog-api-key': apiKey } : { Authorization: `Bearer ${apiKey}` },
    }), requestSignal);
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw Object.assign(new Error(`${provider} model list failed (HTTP ${response.status}). Check the key and account access.`), { status: response.status });
    }
    const body = await abortable(() => response.json(), requestSignal);
    requestSignal.throwIfAborted();
    const entries = provider === 'google' ? body?.models : body?.data;
    if (!Array.isArray(entries)) throw new Error(`${provider} returned an invalid model list.`);
    rows.push(...entries);
    if (rows.length > 10_000) throw new Error(`${provider} returned too many models.`);
    pageToken = provider === 'google' ? body.nextPageToken : undefined;
    if (!pageToken) return normalizeDirectApiModels(provider, rows);
    if (typeof pageToken !== 'string' || pageTokens.has(pageToken)) throw new Error('Google returned invalid model pagination.');
    pageTokens.add(pageToken);
  }
  throw new Error('Google model pagination exceeded its limit.');
  } finally {
    clearTimeout(timer);
  }
}

async function identityFor(authStorage, provider, signal) {
  if (!authStorage?.hasAuth?.(provider)) return null;
  const key = await authStorage.getApiKey(provider, { signal });
  if (!key) throw new Error(`${provider} credentials are unavailable.`);
  return { key, fingerprint: fingerprint(key) };
}

function validCachedModels(value, provider, identity) {
  const config = providerConfig(provider);
  return value?.version === 1 && value.fingerprint === identity.fingerprint && Number.isFinite(value.updatedAt)
    && Array.isArray(value.models) && value.models.every(model => model?.provider === provider
      && model.api === config.api && model.baseUrl === config.baseUrl && typeof model.id === 'string'
      && typeof model.name === 'string' && Array.isArray(model.input) && model.cost && positive(model.maxTokens));
}

/** Successful provider lists replace the baseline, including removals and empty
 * accounts. Failed refreshes keep only that key's last-known list or baseline. */
export async function syncDirectApiModelCatalog(options = {}) {
  const authDirectory = dirname(options.authPath ?? resolveZyraAuthPath(options));
  const directory = options.catalogDirectory ?? join(authDirectory.endsWith('credentials') ? dirname(authDirectory) : authDirectory, 'model-catalog');
  const offline = options.cacheOnly || /^(1|true|yes)$/i.test(String((options.env ?? process.env).ZYRA_OFFLINE ?? ''));
  const timeoutMs = Math.min(Math.max(Number(options.refreshTimeoutMs) || TIMEOUT_MS, 1), TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Provider model discovery timed out.', 'TimeoutError')), timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const catalog = new Map();
  const errors = new Map();
  try {
  await Promise.all(Object.keys(CONFIG).map(async provider => {
    let fallback = getDirectApiBaseline(provider);
    let identity;
    catalog.set(provider, fallback); // Logout also removes the previous account's override.
    try {
      identity = await abortable(() => identityFor(options.authStorage, provider, signal), signal);
      if (!identity) return;
      const file = join(directory, `${provider}.json`);
      let cached;
      try { cached = JSON.parse(await readFile(file, 'utf8')); } catch { /* Missing or corrupt cache uses the baseline. */ }
      const valid = validCachedModels(cached, provider, identity);
      if (valid) fallback = cached.models;
      catalog.set(provider, fallback);
      if (offline || (valid && !options.forceRefresh && Date.now() - cached.updatedAt < TTL_MS)) return;
      const models = await abortable(() => discoverDirectApiModels({ provider, apiKey: identity.key, signal, fetchImpl: options.fetchImpl ?? options.fetch ?? fetch }), signal);
      signal.throwIfAborted();
      const current = await abortable(() => identityFor(options.authStorage, provider, signal), signal);
      if (current?.fingerprint !== identity.fingerprint) throw new Error(`${provider} account changed during model discovery.`);
      await withProviderStoreLock(file, () => {
        signal.throwIfAborted();
        return writeProviderJson(file, { version: 1, fingerprint: identity.fingerprint, updatedAt: Date.now(), models });
      });
      catalog.set(provider, models);
    } catch (error) {
      // A failed request must not restore another account's cached model list.
      if (identity) {
        // Discovery expiry cannot invalidate a same-key cache. Identity gets its
        // own bounded check, while an explicit caller cancellation still wins.
        const recheck = new AbortController();
        const recheckTimer = setTimeout(() => recheck.abort(new DOMException('Provider model identity check timed out.', 'TimeoutError')), timeoutMs);
        const recheckSignal = options.signal ? AbortSignal.any([options.signal, recheck.signal]) : recheck.signal;
        try {
          const current = await abortable(() => identityFor(options.authStorage, provider, recheckSignal), recheckSignal);
          if (current?.fingerprint !== identity.fingerprint) fallback = getDirectApiBaseline(provider);
        } catch { fallback = getDirectApiBaseline(provider); }
        finally { clearTimeout(recheckTimer); }
      }
      errors.set(provider, error);
      catalog.set(provider, fallback);
    }
  }));
  options.signal?.throwIfAborted();
  if (options.allowStale === false && errors.size) throw new Error([...errors.values()].map(error => error.message).join(' '));
  return catalog;
  } finally {
    clearTimeout(timer);
  }
}

function abortable(operation, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve().then(operation).then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

export async function refreshDirectApiModelCatalog(registry, options = {}) {
  if (!registry.zyraDirectApiModelCatalogOptions) return;
  const catalog = await syncDirectApiModelCatalog({
    ...registry.zyraDirectApiModelCatalogOptions, ...options, authStorage: registry.authStorage,
  });
  await applyDirectApiModelCatalog(registry, catalog);
}

export async function applyDirectApiModelCatalog(registry, catalog) {
  for (const [provider, models] of catalog) {
    providerConfig(provider);
    registry.registerProvider(provider, { models });
  }
  if (catalog.size) await registry.refresh?.({ allowNetwork: false });
}
