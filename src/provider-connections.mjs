import { mkdir, writeFile, rename } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

export function providerConfigPath() {
  return path.join(process.env.ZYRA_DATA_ROOT || homedir(), ".zyra", "providers.json");
}
export function readProviderConnections(file = providerConfigPath()) {
  try {
    const saved = JSON.parse(readFileSync(file, "utf8"));
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) throw new Error("Invalid provider metadata.");
    for (const [id, entry] of Object.entries(saved)) {
      if (!/^(opencode|anthropic|custom-[a-z0-9-]+)$/.test(id) || !entry || typeof entry.label !== "string"
        || typeof entry.model !== "string" || !entry.model.startsWith(`${id}/`)
        || !entry.config || !Array.isArray(entry.config.models)) throw new Error("Invalid provider metadata.");
    }
    return saved;
  }
  catch (error) { if (error.code === "ENOENT") return {}; throw new Error("Saved provider connections could not be read."); }
}
export function registerSavedProviders(registry, file) {
  let saved;
  try { saved = readProviderConnections(file); } catch { return; }
  // One damaged custom connection must not prevent built-in providers from starting.
  for (const [id, entry] of Object.entries(saved || {})) {
    try { registry.registerProvider(id, entry.config); } catch { /* A malformed extension cannot block the built-in catalog. */ }
  }
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
  const connections = readProviderConnections(file);
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
  const { createZyraPiRuntime } = await import("./pi-runtime.mjs");
  const runtime = options.runtime || await createZyraPiRuntime();
  const models = [...new Set([modelId, ...catalog.map(model => model.id)])].map(id => {
    const known = runtime.modelRegistry.find?.(entry.id, id);
    return { id, name: catalog.find(model => model.id === id)?.display_name || known?.name || id, api: apiFor(id),
      ...(known ? { contextWindow: known.contextWindow, maxTokens: known.maxTokens, reasoning: known.reasoning, input: known.input, cost: known.cost } : {}) };
  });
  const config = { name: entry.label, baseUrl: entry.baseUrl, api: entry.api, authHeader: entry.api !== "anthropic-messages", models };
  runtime.modelRegistry.registerProvider(entry.id, config);
  await runtime.authStorage.loginApiKey(entry.id, entry.apiKey);
  connections[entry.id] = { label: entry.label, model: `${entry.id}/${modelId}`, verifiedAt: new Date().toISOString(), config };
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(connections, null, 2), { mode: 0o600 });
  await rename(temp, file);
  return { provider: entry.id, label: entry.label, model: `${entry.id}/${modelId}`, verified: true };
}
export async function listModelProviders(options = {}) {
  const { createZyraPiRuntime } = await import("./pi-runtime.mjs");
  const runtime = options.runtime || await createZyraPiRuntime();
  return Object.entries(readProviderConnections(options.file)).map(([provider, entry]) => ({ provider, label: entry.label, model: entry.model, verified: runtime.authStorage.hasAuth(provider), verifiedAt: entry.verifiedAt }));
}

export function disconnectModelProvider(provider, options = {}) {
  const task = mutations.catch(() => {}).then(async () => {
    const file = options.file || providerConfigPath();
    const connections = readProviderConnections(file);
    if (typeof provider !== "string" || !Object.hasOwn(connections, provider)) throw new Error("Saved provider connection not found.");
    const { createZyraPiRuntime } = await import("./pi-runtime.mjs");
    const runtime = options.runtime || await createZyraPiRuntime();
    await runtime.authStorage.logout(provider);
    delete connections[provider];
    const temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(connections, null, 2), { mode: 0o600 });
    await rename(temp, file);
    return { provider };
  });
  mutations = task;
  return task;
}
