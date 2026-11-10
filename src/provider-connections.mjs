import { commitProviderConnection, recoverProviderTransaction, withProviderStoreLock, writeProviderJson } from "./provider-transactions.mjs";
import {
  HARNESS_BASE_URL_SENTINEL,
  HARNESS_MODEL_API,
  HARNESS_PROVIDER_ID,
  HARNESS_PROVIDER_LABEL,
  buildHarnessExtensionConfig,
  createHarnessRefreshModels,
  createHarnessStreamSimple,
  detectHarness,
  ensureHarnessServe,
  findHarnessExecutable,
  listHarnessModels,
  stopHarnessServe,
} from "./opencode-harness.mjs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { getZyraCredentialAuthStatus, resolveZyraApiKeyCredential, resolveZyraAuthPath, ZyraCredentialStore } from "./zyra-auth-store.mjs";

export function providerConfigPath() {
  return path.join(process.env.ZYRA_DATA_ROOT || homedir(), ".zyra", "providers.json");
}

function createStandaloneAuthStorage(options = {}) {
  const credentials = options.credentialStore ?? new ZyraCredentialStore({
    authPath: options.authPath ?? resolveZyraAuthPath(options),
  });
  const env = options.env ?? process.env;
  return {
    get(provider) {
      return credentials.read(provider);
    },
    hasAuth(provider) {
      return Boolean(getZyraCredentialAuthStatus(credentials.read(provider), env)?.configured);
    },
    getApiKey(provider, authOptions = {}) {
      return resolveZyraApiKeyCredential(credentials.read(provider, { signal: authOptions.signal }), authOptions.env ?? env);
    },
    loginApiKey(provider, apiKey, authOptions = {}) {
      const key = String(apiKey ?? "");
      if (!key) throw new Error("API key cannot be empty.");
      return credentials.modify(provider, async () => ({ type: "api_key", key }), authOptions);
    },
    logout(provider, authOptions = {}) {
      return credentials.delete(provider, authOptions);
    },
  };
}

export function readProviderConnections(file = providerConfigPath()) {
  try {
    const saved = JSON.parse(readFileSync(file, "utf8"));
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) throw new Error("Invalid provider metadata.");
    for (const [id, entry] of Object.entries(saved)) {
      if (!/^(opencode|anthropic|opencode-harness|custom-[a-z0-9-]+)$/.test(id) || !entry || typeof entry.label !== "string"
        || typeof entry.model !== "string" || !entry.model.startsWith(`${id}/`)
        || !entry.config || !Array.isArray(entry.config.models)) throw new Error("Invalid provider metadata.");
    }
    return saved;
  }
  catch (error) { if (error.code === "ENOENT") return {}; throw new Error("Saved provider connections could not be read."); }
}
export function registerSavedProviders(registry, file, options = {}) {
  let saved;
  try { saved = readProviderConnections(file); } catch { return; }
  const authStorage = options.authStorage ?? registry?.authStorage;
  // One damaged custom connection must not prevent built-in providers from starting.
  for (const [id, entry] of Object.entries(saved || {})) {
    try {
      if (id === HARNESS_PROVIDER_ID) restoreHarnessProvider(registry, entry, options.harness);
      else registry.registerProvider(id, withConnectedProviderRefresh(id, entry.config, {
        authStorage,
        file,
        fetchImpl: options.fetch,
      }));
    } catch { /* A malformed extension cannot block the built-in catalog. */ }
  }
}
/** Rebuilds the harness extension config with live closures; the stored
 * metadata carries models only, never functions or credentials. */
export function restoreHarnessProvider(registry, entry, harness = {}) {
  const models = entry?.config?.models;
  if (!Array.isArray(models) || !models.length) throw new Error("Saved harness metadata has no models.");
  for (const model of models) {
    if (!model || typeof model.id !== "string" || model.api !== HARNESS_MODEL_API || typeof model.baseUrl !== "string") {
      throw new Error("Saved harness metadata is invalid.");
    }
  }
  registry.registerProvider(HARNESS_PROVIDER_ID, buildHarnessExtensionConfig({
    models: models.map((model) => ({ ...model,
      toolUse: model.harness?.toolcall === true })),
    streamSimple: createHarnessStreamSimple({ executable: harness.executable, ensureServe: harness.ensureServe, fetchImpl: harness.fetch, spawnImpl: harness.spawn,
      onPermission: harness.onPermission, onActivity: harness.onActivity, conversation: harness.conversation, onMetric: harness.onMetric, resolveCwd: harness.resolveCwd }),
    refreshModels: createHarnessRefreshModels({ storedModels: models, executable: harness.executable, ensureServe: harness.ensureServe, spawnImpl: harness.spawn, fetchImpl: harness.fetch }),
  }));
}

/**
 * Last-resort recovery when a saved harness model no longer resolves: the
 * free-model catalog rotates, so re-list live (no model request, no spend),
 * re-register, and retry the match. Returns the Pi registry model or null.
 * Never throws: the caller's original error stays authoritative.
 */
export async function resolveHarnessModelSelection(registry, selector, options = {}) {
  const query = String(selector ?? "").trim().toLowerCase();
  if (!query.startsWith(`${HARNESS_PROVIDER_ID}/`) && !query.startsWith(`${HARNESS_PROVIDER_ID}:`)) return null;
  const harness = options.harness ?? {};
  try {
    const detected = harness.ensureServe ? { executable: harness.executable || 'server-owned-harness' }
      : await detectHarness({ executable: harness.executable, ...(harness.detect ?? {}) });
    if (!detected) return null;
    const cwd = options.project ?? process.cwd();
    const lease = await (harness.ensureServe ?? ensureHarnessServe)({
      cwd, executable: detected.executable, spawnImpl: harness.spawn, fetchImpl: harness.fetch, startTimeoutMs: 15_000,
    });
    try {
      const models = await listHarnessModels(lease.client, { fetchImpl: harness.fetch });
      if (!models.length) return null;
      restoreHarnessProvider(registry, { config: { models } }, harness);
      const available = typeof registry.getAvailable === "function" ? registry.getAvailable() : [];
      const match = matchHarnessSelector(available, query);
      if (match) await persistHarnessModels(models, options.file).catch(() => {});
      return match;
    } finally {
      try { lease.release(); } catch { /* Release must not mask resolution. */ }
    }
  } catch { return null; }
}

function matchHarnessSelector(available, query) {
  const exact = (available ?? []).find((model) => {
    if (model?.provider !== HARNESS_PROVIDER_ID) return false;
    const fullSlash = `${model.provider}/${model.id}`.toLowerCase();
    const fullColon = `${model.provider}:${model.id}`.toLowerCase();
    return fullSlash === query || fullColon === query || String(model.id).toLowerCase() === query;
  });
  if (exact) return exact;
  return (available ?? []).find((model) => {
    if (model?.provider !== HARNESS_PROVIDER_ID) return false;
    return `${model.provider}/${model.id} ${model.name ?? ""}`.toLowerCase().includes(query);
  }) ?? null;
}

/** Converges stored metadata toward the live catalog after a successful refresh. */
async function persistHarnessModels(models, file) {
  return persistProviderModels(HARNESS_PROVIDER_ID, models, file);
}

function withConnectedProviderRefresh(provider, config, options = {}) {
  if (typeof options.authStorage?.getApiKey !== "function" || typeof config?.baseUrl !== "string") return config;
  return {
    ...config,
    refreshModels: createConnectedProviderRefreshModels(provider, config, options),
  };
}

function createConnectedProviderRefreshModels(provider, config, options = {}) {
  let cachedModels = structuredClone(Array.isArray(config.models) ? config.models : []);
  return async (context = {}) => {
    const signal = context.signal;
    if (context.allowNetwork === false) return structuredClone(cachedModels);
    try {
      const apiKey = await options.authStorage.getApiKey(provider, { signal });
      if (!apiKey) return structuredClone(cachedModels);
      const headers = config.api === "anthropic-messages"
        ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json", "User-Agent": "Zyra" }
        : { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "User-Agent": "Zyra" };
      const response = await (options.fetchImpl ?? fetch)(`${config.baseUrl.replace(/\/+$/, "")}/models`, {
        headers,
        redirect: "error",
        signal: signal ?? AbortSignal.timeout(20_000),
      });
      if (!response.ok) return structuredClone(cachedModels);
      const result = await response.json();
      signal?.throwIfAborted();
      if (!Array.isArray(result?.data)) return structuredClone(cachedModels);
      const discovered = result.data
        .filter((model) => typeof model?.id === "string" && model.id.length > 0)
        .slice(0, 500);
      if (discovered.length === 0) return structuredClone(cachedModels);
      const previous = new Map(cachedModels.map((model) => [model.id, model]));
      cachedModels = discovered
        .map((model) => {
          const known = previous.get(model.id) ?? {};
          return {
            ...known,
            id: model.id,
            name: model.display_name || model.name || known.name || model.id,
            api: known.api || providerModelApi(provider, config.api, model.id),
            baseUrl: known.baseUrl || config.baseUrl,
          };
        });
      await persistProviderModels(provider, cachedModels, options.file, signal).catch(() => {});
      return structuredClone(cachedModels);
    } catch (error) {
      if (signal?.aborted) throw error;
      return structuredClone(cachedModels);
    }
  };
}

export async function refreshSavedProviderModels(options = {}) {
  const file = options.file ?? options.providerConfigPath ?? providerConfigPath();
  const authStorage = options.authStorage ?? options.runtime?.authStorage ?? createStandaloneAuthStorage(options);
  const harness = options.harness ?? {};
  const connections = readProviderConnections(file);
  const controller = new AbortController();
  const requestedTimeout = Number(options.refreshTimeoutMs);
  const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0 ? Math.min(requestedTimeout, 20_000) : 20_000;
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(new DOMException('Saved provider model refresh timed out.', 'TimeoutError')), timeoutMs);
  const cached = () => Object.entries(connections).map(([provider, entry]) => ({ provider, models: structuredClone(entry?.config?.models ?? []) }));
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(signal.reason);
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    signal.throwIfAborted();
    const refresh = Promise.all(Object.entries(connections).map(async ([provider, entry]) => {
      const models = provider === HARNESS_PROVIDER_ID
        ? await refreshHarnessProviderModels(entry, { ...options, signal, harness }, file)
        : await createConnectedProviderRefreshModels(provider, entry.config, {
          authStorage,
          file,
          fetchImpl: options.fetchImpl ?? options.fetch,
        })({ signal });
      return { provider, models };
    }));
    return await Promise.race([refresh, aborted]);
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason;
    if (controller.signal.aborted) return cached();
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

async function refreshHarnessProviderModels(entry, options, file) {
  const storedModels = Array.isArray(entry?.config?.models) ? structuredClone(entry.config.models) : [];
  const harness = options.harness ?? {};
  try {
    const executable = harness.ensureServe ? harness.executable || 'server-owned-harness' : typeof harness.findExecutable === "function"
      ? await harness.findExecutable()
      : (await detectHarness({ executable: harness.executable, ...(harness.detect ?? {}) }))?.executable;
    if (!executable) return storedModels;
    options.signal?.throwIfAborted();
    const lease = await (harness.ensureServe ?? ensureHarnessServe)({
      cwd: options.cwd ?? process.cwd(),
      executable,
      spawnImpl: harness.spawn,
      fetchImpl: harness.fetch,
      startTimeoutMs: options.startTimeoutMs ?? 15_000,
    });
    try {
      options.signal?.throwIfAborted();
      const models = await listHarnessModels(lease.client, { fetchImpl: harness.fetch, signal: options.signal });
      options.signal?.throwIfAborted();
      if (!models.length) return storedModels;
      await persistProviderModels(HARNESS_PROVIDER_ID, models, file, options.signal).catch(() => {});
      return models;
    } finally {
      try { lease.release(); } catch { /* Keep refresh results authoritative. */ }
    }
  } catch (error) {
    if (options.signal?.aborted) {
      throw options.signal.reason instanceof Error ? options.signal.reason : error;
    }
    return storedModels;
  }
}

function providerModelApi(provider, defaultApi, modelId) {
  if (provider !== "opencode") return defaultApi;
  const id = modelId.toLowerCase();
  if (id.startsWith("claude")) return "anthropic-messages";
  if (id.startsWith("gpt")) return "openai-responses";
  return "openai-completions";
}

async function persistProviderModels(provider, models, file, signal) {
  const target = file || providerConfigPath();
  await withProviderStoreLock(target, async () => {
    signal?.throwIfAborted();
    const connections = readProviderConnections(target);
    const entry = connections[provider];
    if (!entry) return;
    const selectedId = entry.model.slice(provider.length + 1);
    const selectedStillExists = models.some((model) => model.id === selectedId);
    connections[provider] = {
      ...entry,
      ...(!selectedStillExists && models.length > 0 ? { model: `${provider}/${models[0].id}` } : {}),
      config: { ...entry.config, models },
    };
    await writeProviderJson(target, connections);
  });
}
export function normalizeProviderInput(input) {
  const kind = input?.provider;
  if (!["opencode", "anthropic", "custom"].includes(kind)) throw new Error("Choose a supported provider.");
  const url = new URL(kind === "opencode" ? "https://opencode.ai/zen/v1" : kind === "anthropic" ? "https://api.anthropic.com/v1" : String(input.baseUrl || ""));
  if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) throw new Error("Use an HTTPS endpoint, or HTTP on localhost.");
  const id = kind === "custom" ? `custom-${String(input.name || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 48)}` : kind;
  if (id === "custom-") throw new Error("Give this provider a name.");
  const apiKey = String(input.apiKey || "").trim();
  if (!apiKey || /\s/.test(apiKey) || apiKey.length > 4096) throw new Error("Enter a valid API key.");
  const api = kind === "anthropic" ? "anthropic-messages" : ["openai-completions", "openai-responses", "anthropic-messages"].includes(input.api) ? input.api : "openai-completions";
  return { id, kind, label: kind === "opencode" ? "OpenCode Zen" : kind === "anthropic" ? "Claude API" : String(input.name).trim().slice(0, 80), baseUrl: url.href.replace(/\/$/, ""), apiKey, api, model: String(input.model || "").trim().slice(0, 160) };
}
const requestHeaders = (entry) => entry.api === "anthropic-messages"
  ? { "x-api-key": entry.apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json", "User-Agent": "Zyra" }
  : { Authorization: `Bearer ${entry.apiKey}`, "Content-Type": "application/json", "User-Agent": "Zyra" };
async function requestJson(url, init, fetcher) {
  const response = await fetcher(url, { ...init, redirect: "error", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Provider request failed (${response.status}). Check the key, endpoint and model access.`);
  return response.json();
}
let mutations = Promise.resolve();
export function connectModelProvider(input, options = {}) {
  const task = mutations.catch(() => {}).then(() => connect(input, options));
  mutations = task;
  return task;
}
async function connect(input, options) {
  const entry = normalizeProviderInput(input);
  const file = options.file || providerConfigPath();
  readProviderConnections(file);
  const fetcher = options.fetch || fetch;
  let catalog = [];
  try {
    const result = await requestJson(`${entry.baseUrl}/models`, { headers: requestHeaders(entry) }, fetcher);
    catalog = (Array.isArray(result.data) ? result.data : []).filter(model => typeof model.id === "string").slice(0, 500);
  } catch (error) { if (!entry.model) throw error; }
  const modelId = entry.model || catalog.find(model => entry.kind !== "anthropic" || model.id.includes("sonnet"))?.id || catalog[0]?.id;
  if (!modelId) throw new Error("Enter a model ID offered by this endpoint.");
  const apiFor = (id) => entry.kind === "opencode" ? id.startsWith("claude") ? "anthropic-messages" : id.startsWith("gpt") ? "openai-responses" : "openai-completions" : entry.api;
  const api = apiFor(modelId);
  const route = api === "anthropic-messages" ? "messages" : api === "openai-responses" ? "responses" : "chat/completions";
  const body = api === "openai-responses" ? { model: modelId, input: "Reply OK.", max_output_tokens: 16, store: false } : { model: modelId, messages: [{ role: "user", content: "Reply OK." }], max_tokens: 16 };
  await requestJson(`${entry.baseUrl}/${route}`, { method: "POST", headers: requestHeaders({ ...entry, api }), body: JSON.stringify(body) }, fetcher);
  const runtime = options.runtime;
  const models = [...new Set([modelId, ...catalog.map(model => model.id)])].map(id => {
    const known = runtime?.modelRegistry?.find?.(entry.id, id);
    return { id, name: catalog.find(model => model.id === id)?.display_name || known?.name || id, api: apiFor(id),
      ...(known ? { contextWindow: known.contextWindow, maxTokens: known.maxTokens, reasoning: known.reasoning, input: known.input, cost: known.cost } : {}) };
  });
  const config = { name: entry.label, baseUrl: entry.baseUrl, api: entry.api, authHeader: entry.api !== "anthropic-messages", models };
  runtime?.modelRegistry?.registerProvider?.(entry.id, withConnectedProviderRefresh(entry.id, config, {
    authStorage: runtime.authStorage,
    file,
    fetchImpl: fetcher,
  }));
  const authStorage = options.authStorage ?? runtime?.authStorage ?? createStandaloneAuthStorage(options);
  await commitProviderConnection(file, authStorage, { operation: "connect", provider: entry.id, apiKey: entry.apiKey,
    target: { label: entry.label, model: `${entry.id}/${modelId}`, verifiedAt: new Date().toISOString(), config } }, { readConfig: readProviderConnections });
  return { provider: entry.id, label: entry.label, model: `${entry.id}/${modelId}`, verified: true };
}
/**
 * Connects the local OpenCode harness. No API key is involved: detection
 * proves the binary answers, and verification lists the harness catalog
 * without sending any model request (no spend, no account side effects).
 * Metadata persists without credentials; Zyra does not create a chat runtime.
 */
export async function connectHarnessProvider(input = {}, options = {}) {
  const file = options.file || providerConfigPath();
  readProviderConnections(file);
  const harness = options.harness ?? {};
  const detected = await detectHarness({ executable: harness.executable, ...(harness.detect ?? {}) });
  if (!detected) throw new Error("OpenCode is not installed or did not answer. Install it and run `opencode auth login` first.");
  const cwd = options.cwd ?? process.cwd();
  const lease = await ensureHarnessServe({ cwd, executable: detected.executable, spawnImpl: harness.spawn, fetchImpl: harness.fetch });
  try {
    const models = await listHarnessModels(lease.client, { fetchImpl: harness.fetch });
    if (!models.length) throw new Error("The OpenCode harness reports no connected providers. Run `opencode auth login` (or /connect) first.");
    const wanted = String(input.model ?? "").trim();
    const pick = wanted
      ? models.find((model) => model.id === wanted || `${HARNESS_PROVIDER_ID}/${model.id}` === wanted)
      : models.find((model) => model.harness?.free) ?? models[0];
    if (!pick) throw new Error(`Model '${wanted}' is not offered by the OpenCode harness.`);
    const entry = {
      label: HARNESS_PROVIDER_LABEL,
      model: `${HARNESS_PROVIDER_ID}/${pick.id}`,
      verifiedAt: new Date().toISOString(),
      config: { name: HARNESS_PROVIDER_LABEL, api: HARNESS_MODEL_API, authHeader: false, baseUrl: HARNESS_BASE_URL_SENTINEL, models },
    };
    await withProviderStoreLock(file, async () => {
      const connections = readProviderConnections(file);
      connections[HARNESS_PROVIDER_ID] = entry;
      await writeProviderJson(file, connections);
    });
    options.runtime?.modelRegistry?.registerProvider?.(HARNESS_PROVIDER_ID, buildHarnessExtensionConfig({
      models: models.map((model) => ({ ...model,
        toolUse: model.harness?.toolcall === true })),
      streamSimple: createHarnessStreamSimple({ executable: detected.executable, fetchImpl: harness.fetch, spawnImpl: harness.spawn,
        onPermission: harness.onPermission, onActivity: harness.onActivity, conversation: harness.conversation, onMetric: harness.onMetric, resolveCwd: harness.resolveCwd }),
      refreshModels: createHarnessRefreshModels({ storedModels: models, executable: detected.executable, spawnImpl: harness.spawn, fetchImpl: harness.fetch }),
    }));
    return { provider: HARNESS_PROVIDER_ID, label: entry.label, model: entry.model, verified: true };
  } finally {
    try { lease.release(); } catch { /* Release must not mask connect results. */ }
  }
}

export async function disconnectHarnessProvider(options = {}) {
  const file = options.file || providerConfigPath();
  await withProviderStoreLock(file, async () => {
    const connections = readProviderConnections(file);
    if (!Object.hasOwn(connections, HARNESS_PROVIDER_ID)) throw new Error("Saved provider connection not found.");
    delete connections[HARNESS_PROVIDER_ID];
    await writeProviderJson(file, connections);
  });
  try { options.runtime?.modelRegistry.unregisterProvider?.(HARNESS_PROVIDER_ID); } catch { /* Metadata removal is the durable part; registry cleanup is best-effort. */ }
  await stopHarnessServe().catch(() => {});
  return { provider: HARNESS_PROVIDER_ID };
}

export async function listModelProviders(options = {}) {
  const file = options.file || providerConfigPath();
  const authStorage = options.authStorage ?? options.runtime?.authStorage ?? createStandaloneAuthStorage(options);
  await recoverProviderTransaction(file, authStorage, readProviderConnections);
  const entries = Object.entries(readProviderConnections(file));
  const resolved = [];
  for (const [provider, entry] of entries) {
    const verified = provider === HARNESS_PROVIDER_ID
      ? (options.harness?.findExecutable ? await options.harness.findExecutable() !== null : findHarnessExecutable(options.harness?.find ?? {}) !== null)
      : authStorage.hasAuth(provider);
    resolved.push({ provider, label: entry.label, model: entry.model, verified, verifiedAt: entry.verifiedAt });
  }
  return resolved;
}

export function disconnectModelProvider(provider, options = {}) {
  const task = mutations.catch(() => {}).then(async () => {
    const file = options.file || providerConfigPath();
    const connections = readProviderConnections(file);
    if (typeof provider !== "string" || !Object.hasOwn(connections, provider)) throw new Error("Saved provider connection not found.");
    const authStorage = options.authStorage ?? options.runtime?.authStorage ?? createStandaloneAuthStorage(options);
    await commitProviderConnection(file, authStorage, { operation: "disconnect", provider }, { readConfig: readProviderConnections });
    return { provider };
  });
  mutations = task;
  return task;
}
