import { execFile as defaultExecFile, spawn as defaultSpawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from 'node:url';
import { subscribeHarnessEvents, createHarnessEventAccumulator } from './harness-events.mjs';
import { requestV2, v2CatalogPayload, prepareV2, listV2Models } from './harness-v2-client.mjs';
import { managedV2Config } from './harness-v2-config.mjs';
import { runHarnessV2Turn } from './harness-v2-turn.mjs';
import { nativeReasoningValue, isNativeReasoningId, reasoningChoiceForNativeId } from './reasoning-choices.mjs';

/**
 * Local OpenCode harness provider.
 *
 * When the user already has the OpenCode CLI installed and authenticated,
 * Zyra can route model inference through a Zyra-owned `opencode serve`
 * instance on loopback instead of requiring another API key. Credentials
 * stay inside OpenCode's own auth store; Zyra never reads them.
 *
 * History is replayed through private OpenCode sessions. Desktop turns can
 * use a small set of OpenCode tools, with every permission routed through
 * Zyra's existing gate and every tool state reported to the chat timeline.
 */

export const HARNESS_PROVIDER_ID = "opencode-harness";
export const HARNESS_PROVIDER_LABEL = "OpenCode harness";
/** Pi requires every registered provider to declare an auth method. This
 * marker is not a secret and is never transmitted: it only satisfies Pi's
 * required-auth-method invariant for a provider whose real credentials live
 * in OpenCode's own store. It exists in memory only, never in providers.json. */
export const HARNESS_RUNTIME_AUTH_MARKER = "local-harness-loopback";
/** Pi model definitions require a baseUrl. The harness transport is owned by
 * this module (per-call loopback endpoint), never by Pi's HTTP layer, so the
 * persisted value is a stable routing sentinel, not a reachable endpoint. */
export const HARNESS_BASE_URL_SENTINEL = "http://127.0.0.1/opencode-harness";
export const HARNESS_MODEL_API = "openai-completions";

const VERSION_TIMEOUT_MS = 15_000;
const HEALTH_TIMEOUT_MS = 5_000;
const START_TIMEOUT_MS = 30_000;
const HEALTH_POLL_MS = 250;
const HISTORY_MESSAGE_TIMEOUT_MS = 30_000;
const FINAL_MESSAGE_TIMEOUT_MS = 300_000;
const KILL_GRACE_MS = 5_000;
const IDLE_STOP_MS = 10 * 60_000;
const MANAGED_AGENT = "zyra-managed";
const harnessVersions = new Map();
const MANAGED_TOOLS = ["read", "glob", "grep", "list", "bash", "edit", "write", "patch", "webfetch", "websearch"];
const MANAGED_PERMISSION = Object.freeze({
  "*": "ask", read: "ask", glob: "ask", grep: "ask", list: "ask",
  bash: "ask", edit: "ask", webfetch: "ask", websearch: "ask",
  external_directory: "ask", task: "deny", question: "deny",
});

export function managedHarnessConfig(inline = process.env.OPENCODE_CONFIG_CONTENT) {
  let existing = {};
  if (typeof inline === "string" && inline.trim()) {
    try { existing = JSON.parse(inline); }
    catch { throw fail("OpenCode's inline config could not be safely merged with Zyra's permission policy."); }
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      throw fail("OpenCode's inline config must be a JSON object for Zyra's permission policy.");
    }
  }
  const inherited = existing.permission;
  const tighten = (rule) => {
    if (rule === "deny") return "deny";
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) return "ask";
    return { "*": "ask", ...Object.fromEntries(Object.entries(rule).map(([pattern, decision]) => [pattern, decision === "deny" ? "deny" : "ask"])) };
  };
  const permission = typeof inherited === "string"
    ? { "*": tighten(inherited) }
    : { "*": "ask", ...Object.fromEntries(Object.entries(inherited && typeof inherited === "object" ? inherited : {})
      .map(([name, rule]) => [name, tighten(rule)])) };
  for (const [name, rule] of Object.entries(MANAGED_PERMISSION)) {
    if (!(name in permission)) permission[name] = rule;
    if (rule === "deny" || permission["*"] === "deny") permission[name] = "deny";
  }
  const managedPermission = { ...permission };
  managedPermission['*'] = 'deny';
  const existingManaged = existing.agent?.[MANAGED_AGENT]?.permission;
  if (existingManaged && typeof existingManaged === "object" && !Array.isArray(existingManaged)) {
    for (const [name, rule] of Object.entries(existingManaged)) {
      if (rule === "deny") managedPermission[name] = "deny";
    }
  }
  managedPermission.task = "deny";
  managedPermission.question = "deny";
  // Zyra supplies its own skills. Native skill calls are not part of the
  // managed tool pipe, so do not advertise a second, unusable skill catalog.
  managedPermission.skill = "deny";
  return {
    ...existing,
    plugin: [...(Array.isArray(existing.plugin) ? existing.plugin : []), process.env.ZYRA_STANDALONE === '1' && process.env.ZYRA_ROOT
      ? pathToFileURL(path.join(process.env.ZYRA_ROOT, 'src', 'harness-config-plugin.mjs')).href
      : new URL('./harness-config-plugin.mjs', import.meta.url).href],
    permission,
    agent: { ...(typeof existing.agent === "object" ? existing.agent : {}),
      [MANAGED_AGENT]: { mode: "primary", permission: managedPermission } },
  };
}

function fail(message, options = {}) {
  const error = new Error(message);
  if (options.cause !== undefined) error.cause = options.cause;
  return error;
}

/* ------------------------------------------------------------------ */
/* Detection                                                             */
/* ------------------------------------------------------------------ */

/**
 * Resolves a spawnable OpenCode binary: native install locations first (the
 * real executable, not a shell shim), then a manual PATH scan. Detection
 * needs no subprocess and stays testable.
 */
export function findHarnessExecutable({ env = process.env, platform = process.platform, exists = existsSync } = {}) {
  const join = platform === "win32" ? path.win32.join : path.posix.join;
  const home = String(env?.HOME ?? env?.USERPROFILE ?? "");
  for (const candidate of nativeInstallCandidates({ env, platform, home, join })) {
    try {
      if (exists(candidate)) return candidate;
    } catch { /* An unreadable location cannot prove absence. */ }
  }
  const pathValue = String(env?.PATH ?? env?.Path ?? "");
  if (!pathValue) return null;
  const directories = pathValue.split(platform === "win32" ? ";" : ":").filter(Boolean);
  const names = platform === "win32" ? expandWindowsNames(env) : ["opencode"];
  const seen = new Set();
  for (const directory of directories) {
    for (const name of names) {
      const candidate = join(directory, name);
      const key = platform === "win32" ? candidate.toLowerCase() : candidate;
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        if (exists(candidate)) return candidate;
      } catch { /* An unreadable PATH entry cannot prove absence. */ }
    }
  }
  return null;
}

function nativeInstallCandidates({ env, platform, home, join }) {
  const candidates = [];
  const installDir = String(env?.OPENCODE_INSTALL_DIR ?? "").trim();
  if (platform === "win32") {
    const exe = (directory) => directory ? join(directory, "opencode.exe") : null;
    if (installDir) candidates.push(exe(installDir));
    const appData = String(env?.APPDATA ?? "");
    if (appData) candidates.push(join(appData, "npm", "node_modules", "@opencode", "cli", "bin", "opencode.exe"), join(appData, "npm", "node_modules", "opencode-ai", "bin", "opencode.exe"));
    if (home) candidates.push(exe(join(home, ".opencode", "bin")));
  } else {
    const binary = (directory) => directory ? join(directory, "opencode") : null;
    if (installDir) candidates.push(binary(installDir));
    const xdgBin = String(env?.XDG_BIN_DIR ?? "").trim();
    if (xdgBin) candidates.push(binary(xdgBin));
    if (home) candidates.push(binary(join(home, ".opencode", "bin")), binary(join(home, "bin")));
  }
  return candidates.filter(Boolean);
}

/** True for shell shims (.cmd/.bat/.com), which need a shell to execute on Windows. */
export function isHarnessScriptExecutable(executable, platform = process.platform) {
  return platform === "win32" && /\.(cmd|bat|com)$/i.test(String(executable ?? ""));
}

function spawnHarnessProcess(executable, args, options) {
  return defaultSpawn(executable, args, { ...options, shell: isHarnessScriptExecutable(executable) || undefined });
}

function expandWindowsNames(env) {
  const extensions = String(env?.PATHEXT ?? ".EXE;.CMD;.BAT;.COM;.PS1").split(";").map((entry) => entry.trim()).filter(Boolean);
  const names = [];
  for (const extension of extensions) {
    const upper = extension.toUpperCase();
    if (upper === ".PS1") continue; // A shim script cannot be spawned headless; prefer the real binary.
    names.push(`opencode${extension.toLowerCase()}`);
  }
  if (!names.length) names.push("opencode.exe");
  return [...new Set(names)];
}

function execFileAsync(executable, args, { execFile = defaultExecFile, timeoutMs = VERSION_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    execFile(executable, args, { timeout: timeoutMs, windowsHide: true, shell: isHarnessScriptExecutable(executable) || undefined }, (error, stdout, stderr) => {
      if (error) reject(fail(`OpenCode probe failed: ${error.message}`, { cause: error }));
      else resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });
}

export async function readHarnessVersion({ executable, execFile } = {}) {
  if (!executable) return null;
  try {
    const { stdout } = await execFileAsync(executable, ["--version"], { execFile });
    const match = stdout.match(/(\d+\.\d+\.\d+)/);
    return match?.[1] ?? null;
  } catch { return null; }
}

/** Returns { executable, version } or null when no genuine binary answers. */
export async function detectHarness(options = {}) {
  const executable = options.executable ?? findHarnessExecutable(options);
  if (!executable) return null;
  const version = await readHarnessVersion({ executable, execFile: options.execFile });
  if (!version) return null;
  harnessVersions.set(executable, version);
  return { executable, version };
}

/* ------------------------------------------------------------------ */
/* Owned serve lifecycle                                                 */
/* ------------------------------------------------------------------ */

function pickLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });
}

function basicAuthHeader(password) {
  return `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
}

async function fetchJson(client, pathname, { method = "GET", body, signal, timeoutMs = HEALTH_TIMEOUT_MS, fetchImpl = client?.fetch ?? fetch } = {}) {
  const url = `${client.baseUrl}${pathname}`;
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response;
  try {
    response = await fetchImpl(url, {
      method,
      signal: combined,
      redirect: "error",
      headers: {
        Authorization: basicAuthHeader(client.password),
        ...(client.cwd ? { 'x-opencode-directory': encodeURIComponent(client.cwd) } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    if (signal?.aborted) throw fail("OpenCode harness request was aborted.", { cause: error });
    throw fail(`Cannot reach the OpenCode harness at ${client.baseUrl}.`, { cause: error });
  }
  if (response.status === 401) throw fail("The OpenCode harness rejected the session password. Reconnect the harness.");
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw fail(`OpenCode harness request ${method} ${pathname} failed (${response.status}).${detail ? ` ${detail.slice(0, 300)}` : ""}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

function waitForHealth(client, { fetchImpl = client?.fetch ?? fetch, timeoutMs = START_TIMEOUT_MS } = {}) {
  const started = Date.now();
  return (async () => {
    for (;;) {
      try {
        const health = client.apiVersion === 2
          ? await requestV2(client, '/info', { timeoutMs: HEALTH_TIMEOUT_MS, fetchImpl })
          : await fetchJson(client, "/global/health", { timeoutMs: HEALTH_TIMEOUT_MS, fetchImpl });
        if (client.apiVersion === 2 ? /^2\./.test(health?.version) && Number.isSafeInteger(health?.pid) : health?.healthy) return;
      } catch { /* Still booting; retry until the deadline. */ }
      if (Date.now() - started > timeoutMs) throw fail("The OpenCode harness did not become healthy in time.");
      await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_MS));
    }
  })();
}

const serveRecords = new Map();
const servePending = new Map();

function defaultRandomPassword() {
  return randomBytes(32).toString("hex");
}

function armIdleStop(cwd, idleMs) {
  const record = serveRecords.get(cwd);
  if (!record || record.active > 0) return;
  clearTimeout(record.idleTimer);
  record.idleTimer = setTimeout(() => {
    const current = serveRecords.get(cwd);
    if (current && current.active <= 0) void stopHarnessServe(cwd).catch(() => {});
  }, idleMs);
  record.idleTimer.unref?.();
}

/**
 * Ensures one Zyra-owned `opencode serve` per working directory, bound to
 * loopback only (127.0.0.1 is passed explicitly; mDNS is never enabled).
 * The caller must release the lease; the instance stops after its idle
 * window without users, or immediately via stopHarnessServe.
 */
export async function ensureHarnessServe({ cwd = process.cwd(), executable, spawnImpl = spawnHarnessProcess, fetchImpl = fetch, randomPassword = defaultRandomPassword, idleMs = IDLE_STOP_MS, startTimeoutMs = START_TIMEOUT_MS } = {}) {
  const key = String(cwd);
  const live = serveRecords.get(key);
  if (live?.ready && !live.exited) {
    live.active += 1;
    live.lastUsed = Date.now();
    clearTimeout(live.idleTimer);
    return leaseHandle(key, live, fetchImpl);
  }
  if (live && !servePending.get(key)) serveRecords.delete(key);
  const pending = servePending.get(key);
  if (pending) {
    const record = await pending;
    record.active += 1;
    clearTimeout(record.idleTimer);
    return leaseHandle(key, record, fetchImpl);
  }
  const starting = startOwnedServe({ cwd: key, executable, spawnImpl, fetchImpl, randomPassword, idleMs, startTimeoutMs });
  servePending.set(key, starting);
  try {
    const record = await starting;
    serveRecords.set(key, record);
    record.active += 1;
    return leaseHandle(key, record, fetchImpl);
  } finally {
    servePending.delete(key);
  }
}

/** Prepare only the local transport and project instance; never send a model turn. */
export async function prepareHarnessServe({ cwd = process.cwd(), executable = findHarnessExecutable(), ...options } = {}) {
  const lease = await ensureHarnessServe({ ...options, cwd, executable });
  try {
    return await prepareHarnessClient(lease.client, options);
  } finally {
    lease.release();
  }
}

/** Initialize provider plugins/catalog without making a generation request. */
export async function prepareHarnessClient(client, options = {}) {
    if (client.apiVersion === 2) return prepareV2(client, options);
    // Health can answer before OpenCode has initialized the project/provider
    // instance. Create and remove an empty session to move that wait off Send.
    await Promise.all([
      fetchJson(client, '/provider', { timeoutMs: HISTORY_MESSAGE_TIMEOUT_MS, fetchImpl: options.fetchImpl }),
      // Older supported harnesses can lack this route. Discovery is optional;
      // the actual message request and its permissions remain authoritative.
      fetchJson(client, '/experimental/tool/ids', { timeoutMs: HISTORY_MESSAGE_TIMEOUT_MS, fetchImpl: options.fetchImpl }).catch(() => {}),
    ]);
    const session = await fetchJson(client, '/session', { method: 'POST', body: { title: 'Zyra preparation' }, timeoutMs: HISTORY_MESSAGE_TIMEOUT_MS, fetchImpl: options.fetchImpl });
    if (typeof session?.id !== 'string' || !session.id) throw fail('The OpenCode harness did not return a preparation session id.');
    await fetchJson(client, `/session/${encodeURIComponent(session.id)}`, { method: 'DELETE', timeoutMs: HISTORY_MESSAGE_TIMEOUT_MS, fetchImpl: options.fetchImpl });
    return { prepared: true };
}

async function startOwnedServe({ cwd, executable, spawnImpl, fetchImpl, randomPassword, idleMs, startTimeoutMs }) {
  if (!executable) throw fail("OpenCode is not installed. Install it first, then connect the harness.");
  const port = await pickLoopbackPort();
  if (!port) throw fail("Could not reserve a loopback port for the OpenCode harness.");
  const password = randomPassword();
  const baseUrl = `http://127.0.0.1:${port}`;
  const version = harnessVersions.get(executable) ?? (spawnImpl === spawnHarnessProcess ? await readHarnessVersion({ executable }) : null);
  const apiVersion = /^2\./.test(version) ? 2 : 1;
  let child;
  try {
    child = spawnImpl(executable, ["serve", "--port", String(port), "--hostname", "127.0.0.1"], {
      cwd,
      env: { ...process.env, OPENCODE_SERVER_PASSWORD: password, OPENCODE_CONFIG_CONTENT: JSON.stringify(apiVersion === 2 ? managedV2Config() : managedHarnessConfig()) },
      stdio: "ignore",
      windowsHide: true,
    });
  } catch (error) {
    throw fail("Could not start the OpenCode harness process.", { cause: error });
  }
  if (!child || typeof child.kill !== "function" || child.pid == null) {
    try { child?.kill?.(); } catch { /* Already gone. */ }
    throw fail("Could not start the OpenCode harness process.");
  }
  const record = {
    child, baseUrl, password, cwd, fetchImpl, idleMs, apiVersion, active: 0, ready: false,
    lastUsed: Date.now(), idleTimer: null, exited: false,
  };
  child.once("exit", () => { record.exited = true; });
  child.once("error", () => { record.exited = true; });
  const client = { baseUrl, password, fetch: fetchImpl, cwd, apiVersion };
  try {
    await waitForHealth(client, { fetchImpl, timeoutMs: startTimeoutMs });
  } catch (error) {
    await killChild(child);
    throw error;
  }
  if (record.exited) throw fail("The OpenCode harness process exited during startup.");
  record.ready = true;
  return record;
}

function leaseHandle(cwd, record, fetchImpl) {
  let released = false;
  const fetch = fetchImpl ?? record.fetchImpl ?? fetch;
  return {
    baseUrl: record.baseUrl,
    client: { baseUrl: record.baseUrl, password: record.password, fetch, cwd: record.cwd, apiVersion: record.apiVersion },
    release() {
      if (released) return;
      released = true;
      const current = serveRecords.get(cwd);
      if (current !== record) return;
      current.active = Math.max(0, current.active - 1);
      current.lastUsed = Date.now();
      armIdleStop(cwd, current.idleMs);
    },
  };
}

async function killChild(child) {
  // Windows launchers own a server descendant. Terminate the owned tree while
  // its root is still alive, rather than orphaning that server with kill().
  if (process.platform === 'win32' && typeof child.spawnfile === 'string' && child.exitCode === null && Number.isSafeInteger(child.pid)) {
    const killed = await new Promise(resolve => defaultExecFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: KILL_GRACE_MS }, error => resolve(!error)));
    if (killed) return;
  }
  try { child.kill(); } catch { return; }
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* Already gone. */ }
      resolve();
    }, KILL_GRACE_MS);
    timer.unref?.();
    child.once("exit", () => { clearTimeout(timer); resolve(); });
  });
}

export async function stopHarnessServe(cwd) {
  const keys = cwd === undefined ? [...serveRecords.keys()] : [String(cwd)];
  for (const key of keys) {
    const record = serveRecords.get(key);
    if (!record) continue;
    serveRecords.delete(key);
    clearTimeout(record.idleTimer);
    await killChild(record.child);
  }
}

export function harnessServeStatus(cwd) {
  if (cwd !== undefined) {
    const record = serveRecords.get(String(cwd));
    return record ? { running: !record.exited, active: record.active, baseUrl: record.baseUrl } : { running: false, active: 0 };
  }
  return [...serveRecords.entries()].map(([directory, record]) => ({ cwd: directory, running: !record.exited, active: record.active, baseUrl: record.baseUrl }));
}

/* ------------------------------------------------------------------ */
/* Catalog                                                               */
/* ------------------------------------------------------------------ */

/**
 * Maps a `GET /provider` payload to Pi model definitions. Only models from
 * providers the harness reports as connected are included, and ids are
 * qualified with the inner provider (`opencode/big-pickle`) so catalogs
 * from several inner providers cannot collide.
 */
export function mapProviderCatalog(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.all)) {
    throw fail("The OpenCode harness returned an unrecognized provider catalog.");
  }
  const connected = new Set(Array.isArray(payload.connected) ? payload.connected : []);
  const toNumber = (value) => { const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : 0; };
  const defs = [];
  for (const provider of payload.all) {
    if (!provider || typeof provider.id !== "string" || !connected.has(provider.id)) continue;
    const models = provider.models && typeof provider.models === "object" ? Object.values(provider.models) : [];
    for (const model of models) {
      if (!model || typeof model.id !== "string") continue;
      if (model.status !== undefined && model.status !== "active") continue;
      const capabilities = model.capabilities && typeof model.capabilities === "object" ? model.capabilities : {};
      const cost = model.cost && typeof model.cost === "object" ? model.cost : {};
      const cache = cost.cache && typeof cost.cache === "object" ? cost.cache : {};
      const limit = model.limit && typeof model.limit === "object" ? model.limit : {};
      const variants = modelVariantNames(model.variants);
      const contextWindow = toNumber(limit.context);
      const maxTokens = toNumber(limit.output);
      defs.push({
        id: `${provider.id}/${model.id}`,
        name: typeof model.name === "string" && model.name ? model.name : model.id,
        api: HARNESS_MODEL_API,
        baseUrl: HARNESS_BASE_URL_SENTINEL,
        reasoning: capabilities.reasoning === true,
        toolUse: capabilities.toolcall === true,
        input: ["text"],
        cost: { input: toNumber(cost.input), output: toNumber(cost.output), cacheRead: toNumber(cache.read), cacheWrite: toNumber(cache.write) },
        contextWindow: contextWindow > 0 ? contextWindow : 128000,
        maxTokens: maxTokens > 0 ? maxTokens : 16384,
        harness: {
          innerProvider: provider.id,
          innerModel: model.id,
          toolcall: capabilities.toolcall === true,
          free: hasExplicitZeroPrice(cost.input) && hasExplicitZeroPrice(cost.output),
          variants,
        },
      });
    }
  }
  return defs.sort((left, right) => left.id.localeCompare(right.id));
}

function modelVariantNames(variants) {
  if (Array.isArray(variants)) {
    return variants.filter(variant => variant?.disabled !== true).map((variant) => typeof variant === "string" ? variant : variant?.id)
      .filter(isNativeReasoningId);
  }
  return variants && typeof variants === "object" ? Object.keys(variants).filter(id => variants[id]?.disabled !== true && isNativeReasoningId(id)) : [];
}

function hasExplicitZeroPrice(value) {
  if (typeof value !== "number" && typeof value !== "string") return false;
  const normalized = typeof value === "string" ? value.trim() : value;
  return normalized !== "" && Number.isFinite(Number(normalized)) && Number(normalized) === 0;
}

export async function listHarnessModels(client, { fetchImpl, signal } = {}) {
  if (client.apiVersion === 2) return mapProviderCatalog(v2CatalogPayload(await listV2Models(client, { signal, fetchImpl: fetchImpl ?? client.fetch })));
  const payload = await fetchJson(client, "/provider", { signal, timeoutMs: HISTORY_MESSAGE_TIMEOUT_MS, fetchImpl: fetchImpl ?? client?.fetch });
  return mapProviderCatalog(payload);
}

/* ------------------------------------------------------------------ */
/* Text-pipe turn                                                       */
/* ------------------------------------------------------------------ */

function textOfContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const entry of content) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.type === "text" && typeof entry.text === "string") parts.push(entry.text);
    else if (entry.type === "thinking" && typeof entry.thinking === "string") parts.push(entry.thinking);
    else if (entry.type === "image") throw fail("The OpenCode harness text pipe does not carry images in this phase. Use a directly connected provider for image input.");
    else if (entry.type === "toolCall") parts.push(`[tool call ${entry.name ?? "unknown"} cannot be replayed through the harness text pipe]`);
  }
  return parts.join("");
}

function textOfToolResult(message) {
  const label = message.isError ? "error" : "result";
  return `[tool ${message.toolName ?? "unknown"} ${label}]: ${textOfContent(message.content)}`;
}

/**
 * Maps a Pi context to harness message turns. History is replayed with
 * noReply messages, then the final user message is sent with tools disabled
 * so the harness cannot act outside Zyra's permission scopes.
 */
export function mapPiContextToHarness(context = {}) {
  const system = typeof context.systemPrompt === "string" && context.systemPrompt ? context.systemPrompt : undefined;
  const messages = Array.isArray(context.messages) ? context.messages : [];
  const rendered = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    if (message.role === "user") rendered.push({ role: "user", text: textOfContent(message.content) });
    else if (message.role === "assistant") rendered.push({ role: "assistant", text: textOfContent(message.content) });
    else if (message.role === "toolResult") rendered.push({ role: "assistant", text: textOfToolResult(message) });
  }
  let inputIndex = -1;
  for (let index = rendered.length - 1; index >= 0; index -= 1) {
    if (rendered[index].role === "user") { inputIndex = index; break; }
  }
  if (inputIndex < 0) throw fail("The OpenCode harness text pipe needs at least one user message.");
  const history = rendered.slice(0, inputIndex).map((entry) => entry.text).filter((text) => text);
  let input = rendered[inputIndex].text;
  const trailing = rendered.slice(inputIndex + 1).map((entry) => entry.text).filter((text) => text);
  if (trailing.length) input = `${input}\n\n${trailing.join("\n\n")}`;
  if (!input.trim()) throw fail("The OpenCode harness text pipe needs non-empty user text.");
  return { system, history, input };
}

function splitInnerModel(id) {
  const text = String(id ?? "");
  const slash = text.indexOf("/");
  if (slash <= 0 || slash === text.length - 1) throw fail(`Harness model id "${text}" must look like "<provider>/<model>".`);
  return { providerID: text.slice(0, slash), modelID: text.slice(slash + 1) };
}

/**
 * Extracts text/thinking, usage, and the finish reason. step-start and
 * step-finish are message framing and carry no action; any other non-text
 * part (tool calls, patches, snapshots, agent handoffs) is a loud scope
 * error because the text pipe must never execute or silently drop actions.
 */
export function extractHarnessReply(payload, { allowTools = false } = {}) {
  const parts = payload && typeof payload === "object" && Array.isArray(payload.parts) ? payload.parts : null;
  if (!parts) throw fail("The OpenCode harness returned a message without parts.");
  const texts = [];
  const thinking = [];
  let finishReason = "stop";
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    if (part.type === "text") texts.push(typeof part.text === "string" ? part.text : "");
    else if (part.type === "reasoning" && typeof part.text === "string") thinking.push(part.text);
    else if (part.type === "reasoning" && typeof part.thinking === "string") thinking.push(part.thinking);
    else if (part.type === "step-start") continue;
    else if (allowTools && part.type === "tool") {
      if (!["completed", "error"].includes(part.state?.status)) throw fail("The OpenCode harness finished with an incomplete tool call.");
      if (!MANAGED_TOOLS.includes(part.tool)) throw fail(`The OpenCode harness used an unapproved tool: ${part.tool}.`);
    }
    else if (allowTools && part.type === "patch") continue;
    else if (part.type === "step-finish") {
      if (part.reason === "length") finishReason = "length";
      else if (allowTools && part.reason === 'tool-calls'
        && parts.some(item => item?.type === 'tool' && item.state?.status === 'error')) {
        // OpenCode stops the loop after a denied native tool. Its completed
        // error part is already visible in Zyra; do not start another request.
      }
      else if (typeof part.reason === "string" && part.reason && part.reason !== "stop") {
        throw fail(`The OpenCode harness stopped with reason "${part.reason}", which the text pipe does not handle.`);
      }
    }
    else throw fail(`The OpenCode harness returned a "${part.type}" part, which the text pipe cannot execute or translate. Tool-capable delegation needs a reviewed design.`);
  }
  const tokens = payload?.info?.tokens && typeof payload.info.tokens === "object" ? payload.info.tokens : {};
  const toNumber = (value) => { const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : 0; };
  const input = toNumber(tokens.input);
  const output = toNumber(tokens.output);
  const cacheRead = toNumber(tokens.cache?.read);
  const cacheWrite = toNumber(tokens.cache?.write);
  const total = toNumber(tokens.total) || input + output + cacheRead + cacheWrite;
  return {
    text: texts.join(""),
    thinking: thinking.join(""),
    stopReason: finishReason,
    usage: { input, output, cacheRead, cacheWrite, totalTokens: total, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
    responseModel: typeof payload?.info?.model === "string" ? payload.info.model : (typeof payload?.info?.modelID === "string" ? payload.info.modelID : undefined),
  };
}

async function postHarnessMessage(client, sessionId, body, { signal, timeoutMs, fetchImpl } = {}) {
  return fetchJson(client, `/session/${sessionId}/message`, { method: "POST", body, signal, timeoutMs, fetchImpl: fetchImpl ?? client?.fetch });
}

let messageTimestamp = 0;
let messageCounter = 0;
function harnessMessageId() {
  const now = Date.now();
  messageCounter = now === messageTimestamp ? messageCounter + 1 : 1;
  messageTimestamp = now;
  // Native IDs sort by their 48-bit millisecond/counter prefix.
  const prefix = ((BigInt(now) * 4096n + BigInt(messageCounter)) & 0xffffffffffffn).toString(16).padStart(12, '0');
  return `msg_${prefix}${randomBytes(7).toString('hex')}`;
}

/**
 * One private native turn. A runtime-owned conversation can continue without
 * replay; callers without an owner retain one-shot cleanup. sessionIdRef permits abort.
 */
export async function runHarnessTextTurn({ client, modelId, context, signal, variant, fetchImpl, sessionIdRef, onProgress, onPermission, conversation, onMetric, historyTimeoutMs = HISTORY_MESSAGE_TIMEOUT_MS, finalTimeoutMs = FINAL_MESSAGE_TIMEOUT_MS } = {}) {
  if (!client?.baseUrl || !client?.password) throw fail("The OpenCode harness client is not connected.");
  if (client.apiVersion === 2) return runHarnessV2Turn({ client, modelId, mapped: mapPiContextToHarness(context), signal, variant: normalizeHarnessVariant(variant), fetchImpl, sessionIdRef, onProgress, onPermission, conversation, onMetric, historyTimeoutMs, finalTimeoutMs, extract: extractHarnessReply, managedTools: MANAGED_TOOLS });
  const { providerID, modelID } = splitInnerModel(modelId);
  const mapped = mapPiContextToHarness(context);
  const modelVariant = normalizeHarnessVariant(variant);
  const fetch = fetchImpl ?? client.fetch;
  const started = performance.now();
  let requestCount = 0, snapshotReads = 0, firstTextMs;
  const metric = (phase, values) => { try { onMetric?.({ phase, elapsedMs: Math.round(performance.now() - started), ...values }); } catch {} };
  const wireFetch = (...args) => {
    requestCount++;
    if (String(args[0]).endsWith('/message') && (args[1]?.method ?? 'GET') === 'GET') snapshotReads++;
    return (fetch ?? globalThis.fetch)(...args);
  };
  const throwIfAborted = () => { if (signal?.aborted) throw fail("The OpenCode harness turn was aborted."); };
  throwIfAborted();
  const create = async () => {
    // Zyra owns the visible title. Avoid OpenCode's additional title-model call.
    const session = await fetchJson(client, "/session", { method: "POST", body: { title: 'Zyra conversation' }, signal, timeoutMs: historyTimeoutMs, fetchImpl: wireFetch });
    if (typeof session?.id !== "string" || !session.id) throw fail("The OpenCode harness did not return a session id.");
    return session.id;
  };
  const remove = id => fetchJson(client, `/session/${id}`, { method: 'DELETE', timeoutMs: historyTimeoutMs, fetchImpl: wireFetch });
  const attachment = conversation ? await conversation.acquire({ client,
    identity: [modelId, modelVariant, mapped.system, Boolean(onPermission)], history: mapped.history, create, remove })
    : { id: await create(), history: mapped.history, reused: false };
  const sessionId = attachment.id;
  metric('native-session', { reused: attachment.reused, replayedMessages: attachment.history.length,
    priorRecord: attachment.priorRecord, identityMatches: attachment.identityMatches, historyMatches: attachment.historyMatches,
    modelChanged: attachment.modelChanged, effortChanged: attachment.effortChanged, systemChanged: attachment.systemChanged, toolsChanged: attachment.toolsChanged,
    expectedHistoryEntries: attachment.expectedHistoryEntries, historyEntries: attachment.historyEntries });
  if (sessionIdRef) sessionIdRef.current = sessionId;
  let monitor = null;
  let completedReply;
  try {
    for (const text of attachment.history) {
      throwIfAborted();
      await postHarnessMessage(client, sessionId, {
        ...(mapped.system ? { system: mapped.system } : {}),
        model: { providerID, modelID },
        ...(modelVariant ? { variant: modelVariant } : {}),
        parts: [{ type: "text", text }],
        noReply: true,
      }, { signal, timeoutMs: historyTimeoutMs, fetchImpl: wireFetch });
    }
    throwIfAborted();
    const messageID = harnessMessageId();
    if (typeof onProgress === "function" || typeof onPermission === "function") {
      monitor = watchHarnessReply(client, sessionId, { onProgress: event => {
        if (event.type === 'text' && firstTextMs === undefined) {
          firstTextMs = Math.round(performance.now() - started);
          metric('first-text', { firstTextMs });
        }
        onProgress?.(event);
      }, onPermission, fetchImpl: wireFetch, signal, messageID, requireParent: attachment.reused });
    }
    const reply = await postHarnessMessage(client, sessionId, {
      messageID,
      ...(mapped.system ? { system: mapped.system } : {}),
      model: { providerID, modelID },
      ...(modelVariant ? { variant: modelVariant } : {}),
      agent: MANAGED_AGENT,
      parts: [{ type: "text", text: mapped.input }],
      // Native tools:true is an ALLOW permission, not only visibility. Leave
      // managed tools at ask; utility/text turns explicitly deny every tool.
      ...(!onPermission ? { tools: { '*': false } } : {}),
    }, { signal, timeoutMs: onPermission ? Math.max(finalTimeoutMs, 11 * 60_000) : finalTimeoutMs, fetchImpl: wireFetch });
    if (monitor?.failure) throw monitor.failure;
    if (typeof onProgress === "function" && Array.isArray(reply?.parts)) {
      for (const part of reply.parts) if (part?.type === "tool") onProgress({ type: "tool", part });
    }
    completedReply = extractHarnessReply(reply, { allowTools: Boolean(onPermission) });
    return completedReply;
  } finally {
    monitor?.stop();
    if (sessionIdRef) sessionIdRef.current = null;
    if (conversation) await conversation.finish([...mapped.history, mapped.input,
      `${completedReply?.thinking ?? ''}${completedReply?.text ?? ''}`].filter(Boolean), Boolean(completedReply) && !signal?.aborted);
    else try { await remove(sessionId); } catch { /* Cleanup must not mask the turn result. */ }
    metric('finished', { requestCount, snapshotReads, reused: attachment.reused, replayedMessages: attachment.history.length,
      firstTextMs: firstTextMs ?? Math.round(performance.now() - started), success: Boolean(completedReply),
      cacheRead: completedReply?.usage.cacheRead ?? 0, cacheWrite: completedReply?.usage.cacheWrite ?? 0 });
  }
}

function watchHarnessReply(client, sessionId, { onProgress, onPermission, fetchImpl, signal, messageID, requireParent }) {
  let stopped = false;
  let timer;
  let releaseWait;
  let failure = null;
  let failedPolls = 0;
  const pendingPermissions = new Set();
  const unresolvedPermissions = new Map();
  const publishedText = new Map();
  const publishProgress = event => {
    if (stopped || signal?.aborted) return;
    if (event.type === 'text' || event.type === 'reasoning') {
      const previous = publishedText.get(event.type) || '';
      if (!event.text || event.text === previous || !event.text.startsWith(previous)) return;
      publishedText.set(event.type, event.text);
    }
    onProgress?.(event);
  };
  const handlePermissions = (requests, parts) => {
    if (!onPermission || stopped || signal?.aborted) return;
    for (const request of requests) {
      if (request?.sessionID !== sessionId) continue;
      const id = String(request.id ?? request.requestID ?? '');
      if (!id || pendingPermissions.has(id)) continue;
      const callID = String(request.tool?.callID ?? request.metadata?.callID ?? request.metadata?.callId ?? '');
      const part = parts.find(item => item?.type === 'tool' && item.callID === callID
        && (!request.tool?.messageID || item.messageID === request.tool.messageID));
      if (!callID || !part) {
        const count = (unresolvedPermissions.get(id) ?? 0) + 1;
        unresolvedPermissions.set(id, count);
        if (count < 5) continue;
      }
      pendingPermissions.add(id);
      void (async () => {
        let approved = false;
        try {
          if (!stopped && !signal?.aborted && part && MANAGED_TOOLS.includes(part.tool)) {
            approved = await onPermission({ toolName: part.tool,
              input: { ...(part.state?.input ?? {}), paths: request.patterns },
              toolCallId: callID, permission: request.permission }) === true;
          }
          if (stopped || signal?.aborted) approved = false;
          await fetchJson(client, `/permission/${encodeURIComponent(id)}/reply`, {
            method: 'POST', body: { reply: approved ? 'once' : 'reject' }, timeoutMs: 10_000, fetchImpl,
          });
        } catch (error) {
          failure = error;
          void abortHarnessSession(client, sessionId, fetchImpl);
        }
      })();
    }
  };
  const receiveEvent = createHarnessEventAccumulator({ sessionId, messageID,
    onProgress: publishProgress,
    onPermissionRequest: (request, parts) => handlePermissions([request], parts),
  });
  const events = subscribeHarnessEvents(client, { fetchImpl, signal, onEvent: receiveEvent,
    onDisconnect: wasConnected => { if (wasConnected) { clearTimeout(timer); releaseWait?.(); } } });
  const wait = () => new Promise((resolve) => {
    releaseWait = resolve;
    // Keep bounded recovery reads while supported versions push text and approvals.
    timer = setTimeout(resolve, events.connected ? 3_000 : 750);
    timer.unref?.();
  });
  void (async () => {
    while (!stopped && !signal?.aborted) {
      await wait();
      if (stopped || signal?.aborted) break;
      try {
        const messages = await fetchJson(client, `/session/${sessionId}/message`, { timeoutMs: 4_000, fetchImpl });
        if (stopped || !Array.isArray(messages)) continue;
        const parts = messages.filter((message) => message?.info?.role === "assistant" && Array.isArray(message.parts)
          && (message.info.parentID === messageID || !requireParent && !message.info.parentID))
          .flatMap((message) => message.parts);
        for (const type of ["reasoning", "text"]) {
          const text = parts.filter((part) => part?.type === type && typeof part.text === "string")
            .map((part) => part.text).join("");
          if (text) publishProgress({ type, text });
        }
        for (const part of parts) if (part?.type === "tool") publishProgress({ type: "tool", part });
        if (onPermission) {
          const requests = await fetchJson(client, "/permission", { timeoutMs: 4_000, fetchImpl });
          if (!Array.isArray(requests)) throw fail("OpenCode returned an invalid permission list.");
          handlePermissions(requests, parts);
        }
        failedPolls = 0;
      } catch (error) {
        if (++failedPolls >= 3 && onPermission) {
          failure = error;
          void abortHarnessSession(client, sessionId, fetchImpl);
          break;
        }
      }
    }
  })();
  return {
    get failure() { return failure; },
    stop() {
      stopped = true;
      events.close();
      clearTimeout(timer);
      releaseWait?.();
    },
  };
}

/* ------------------------------------------------------------------ */
/* Pi event-stream contract (no SDK import; duck-typed by Pi)            */
/* ------------------------------------------------------------------ */

function baseAssistantMessage({ modelId, usage, stopReason, content, errorMessage, responseModel }) {
  return {
    role: "assistant",
    content,
    api: HARNESS_MODEL_API,
    provider: HARNESS_PROVIDER_ID,
    model: String(modelId ?? "unknown"),
    usage: usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
    stopReason,
    ...(responseModel ? { responseModel } : {}),
    ...(errorMessage ? { errorMessage } : {}),
    timestamp: Date.now(),
  };
}

/** Mirrors Pi's AssistantMessageEventStream contract: push, async iteration, result(). */
export function createHarnessMessageStream() {
  const queue = [];
  const waiting = [];
  let done = false;
  let resolveFinal;
  const finalResultPromise = new Promise((resolve) => { resolveFinal = resolve; });
  const isComplete = (event) => event?.type === "done" || event?.type === "error";
  const extractResult = (event) => {
    if (event?.type === "done") return event.message;
    if (event?.type === "error") return event.error;
    throw fail("Unexpected harness stream event for the final result.");
  };
  return {
    push(event) {
      if (done) return;
      if (isComplete(event)) {
        done = true;
        resolveFinal(extractResult(event));
      }
      const waiter = waiting.shift();
      if (waiter) waiter({ value: event, done: false });
      else queue.push(event);
    },
    end(result) {
      done = true;
      if (result !== undefined) resolveFinal(result);
      while (waiting.length) waiting.shift()({ value: undefined, done: true });
    },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        if (queue.length) yield queue.shift();
        else if (done) return;
        else {
          const next = await new Promise((resolve) => waiting.push(resolve));
          if (next.done) return;
          yield next.value;
        }
      }
    },
    result() { return finalResultPromise; },
  };
}

function abortHarnessSession(client, sessionId, fetchImpl) {
  if (!sessionId) return Promise.resolve();
  if (client?.apiVersion === 2) return requestV2(client, `/session/${encodeURIComponent(sessionId)}/interrupt`, { method: 'POST', fetchImpl: fetchImpl ?? client.fetch }).catch(() => {});
  return fetchJson(client, `/session/${sessionId}/abort`, { method: "POST", body: {}, timeoutMs: HISTORY_MESSAGE_TIMEOUT_MS, fetchImpl: fetchImpl ?? client?.fetch }).catch(() => {});
}

/**
 * Builds the Pi provider entry point: (model, context, options) => stream.
 * Runs the text pipe in the background, reads in-progress message snapshots,
 * and translates them into Pi stream events. Owns a serve lease for the turn.
 */
export function createHarnessStreamSimple({ executable, detect = detectHarness, fetchImpl = fetch, spawnImpl = spawnHarnessProcess, resolveCwd, ensureServe = ensureHarnessServe, onPermission, onActivity, conversation, onMetric } = {}) {
  let cachedExecutable = executable;
  const resolveExecutable = async () => {
    if (cachedExecutable) return cachedExecutable;
    const detected = await detect();
    if (!detected?.executable) throw fail("OpenCode is not installed. Install it first, then connect the harness.");
    cachedExecutable = detected.executable;
    return cachedExecutable;
  };
  return (model, context, options = {}) => {
    const stream = createHarnessMessageStream();
    const modelId = String(model?.id ?? model ?? "");
    const reasoning = options.zyraReasoningChoice ?? options.reasoning;
    const signal = options.signal;
    const partial = (content, stopReason = "pending", usage) => baseAssistantMessage({ modelId, content, stopReason, usage });
    void (async () => {
      const cwd = typeof resolveCwd === "function" ? resolveCwd() : (resolveCwd ?? process.cwd());
      const sessionIdRef = { current: null };
      const leaseRef = { current: null };
      const onAbort = () => { void abortHarnessSession(leaseRef.current?.client, sessionIdRef.current, fetchImpl); };
      try {
        const variant = resolveHarnessVariant(model, reasoning);
        if (signal?.aborted) throw fail("The OpenCode harness turn was aborted.");
        const lease = await ensureServe({ cwd,
          executable: harnessServeStatus(cwd).running ? cachedExecutable : await resolveExecutable(), spawnImpl, fetchImpl });
        leaseRef.current = lease;
        signal?.addEventListener?.("abort", onAbort, { once: true });
        stream.push({ type: "start", partial: partial([]) });
        const liveClient = { ...lease.client, fetch: fetchImpl, cwd };
        const content = [];
        const contentIndexByType = new Map();
        const toolStates = new Map();
        const emitProgress = ({ type, text, part }) => {
          if (type === "tool" && part?.callID && typeof onActivity === "function") {
            const state = part.state ?? {};
            const status = state.status;
            const previous = toolStates.get(part.callID);
            if (!previous) {
              toolStates.set(part.callID, "running");
              onActivity({ type: "tool_execution_start", toolCallId: part.callID, toolName: part.tool,
                args: state.input ?? {}, startedAt: state.time?.start });
            }
            if (["completed", "error"].includes(status) && previous !== status) {
              toolStates.set(part.callID, status);
              onActivity({ type: "tool_execution_end", toolCallId: part.callID, toolName: part.tool,
                args: state.input ?? {}, output: state.output ?? state.error ?? "", isError: status === "error",
                result: { content: state.output ?? state.error ?? "" }, endedAt: state.time?.end });
            }
            return;
          }
          if (!text || !["reasoning", "text"].includes(type)) return;
          const eventPrefix = type === "reasoning" ? "thinking" : "text";
          let index = contentIndexByType.get(type);
          if (index === undefined) {
            index = content.length;
            contentIndexByType.set(type, index);
            content.push(type === "reasoning" ? { type: "thinking", thinking: "" } : { type: "text", text: "" });
            stream.push({ type: `${eventPrefix}_start`, contentIndex: index, partial: partial([...content]) });
          }
          const previous = type === "reasoning" ? content[index].thinking : content[index].text;
          if (!text.startsWith(previous) || text.length === previous.length) return;
          const delta = text.slice(previous.length);
          if (type === "reasoning") content[index] = { type: "thinking", thinking: text };
          else content[index] = { type: "text", text };
          stream.push({ type: `${eventPrefix}_delta`, contentIndex: index, delta, partial: partial([...content]) });
        };
        const reply = await runHarnessTextTurn({ client: liveClient, modelId, context, signal, variant, fetchImpl, sessionIdRef,
          onProgress: emitProgress, onPermission, conversation, onMetric });
        emitProgress({ type: "reasoning", text: reply.thinking });
        emitProgress({ type: "text", text: reply.text });
        for (const [type, index] of contentIndexByType) {
          const eventPrefix = type === "reasoning" ? "thinking" : "text";
          stream.push({ type: `${eventPrefix}_end`, contentIndex: index, content: type === "reasoning" ? content[index].thinking : content[index].text, partial: partial([...content]) });
        }
        const doneReason = reply.stopReason === "length" ? "length" : "stop";
        stream.push({ type: "done", reason: doneReason, message: baseAssistantMessage({ modelId, content, stopReason: doneReason, usage: reply.usage, responseModel: reply.responseModel }) });
      } catch (error) {
        const aborted = signal?.aborted === true || /abort/i.test(error?.message ?? "");
        stream.push({
          type: "error",
          reason: aborted ? "aborted" : "error",
          error: baseAssistantMessage({ modelId, content: [], stopReason: aborted ? "aborted" : "error", errorMessage: error?.message ?? String(error) }),
        });
      } finally {
        signal?.removeEventListener?.("abort", onAbort);
        try { leaseRef.current?.release(); } catch { /* Release must not mask results. */ }
      }
    })().catch(() => {});
    return stream;
  };
}

function normalizeHarnessVariant(value) {
  if (typeof value === 'string' && value.startsWith('variant:')) return nativeReasoningValue(value);
  const variant = String(value ?? "");
  if (variant === "off") return "none";
  return isNativeReasoningId(variant) ? variant : undefined;
}

function resolveHarnessVariant(model, reasoning) {
  const value = nativeReasoningValue(reasoning);
  const requested = reasoning === 'off' ? 'none' : value;
  if (!requested) return undefined;
  const variants = model?.harness?.variants;
  if (Array.isArray(variants) && variants.length > 0) {
    const match = variants.find((variant) => variant === requested);
    if (match) return reasoningChoiceForNativeId(match);
    throw fail('The selected model option is unavailable. Refresh models or choose Provider default.');
  }
  const identity = `${model?.harness?.innerProvider ?? ""}/${model?.harness?.innerModel ?? model?.id ?? ""}`;
  if (/^(?:openai-codex|openai)\/.*gpt-5\.6-luna$/i.test(identity)) return requested;
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Pi provider registration                                              */
/* ------------------------------------------------------------------ */

/**
 * Builds the Pi extension provider config. The auth marker is intentionally
 * not a credential (see HARNESS_RUNTIME_AUTH_MARKER).
 */
export function buildHarnessExtensionConfig({ models = [], streamSimple, refreshModels, name = HARNESS_PROVIDER_LABEL } = {}) {
  return {
    name,
    api: HARNESS_MODEL_API,
    apiKey: HARNESS_RUNTIME_AUTH_MARKER,
    authHeader: false,
    models: Array.isArray(models) ? models : [],
    ...(streamSimple ? { streamSimple } : {}),
    ...(refreshModels ? { refreshModels } : {}),
  };
}

/**
 * Live catalog refresh for Pi availability passes. Never spawns a server on
 * its own: when the owned instance is down it returns the stored models.
 */
export function createHarnessRefreshModels({ storedModels = [], executable, spawnImpl, resolveCwd, ensureServe = ensureHarnessServe, fetchImpl = fetch } = {}) {
  return async (context = {}) => {
    if (context.allowNetwork === false) return structuredClone(Array.isArray(storedModels) ? storedModels : []);
    const cwd = typeof resolveCwd === "function" ? resolveCwd() : (resolveCwd ?? process.cwd());
    const status = harnessServeStatus(cwd);
    if (!status.running) return Array.isArray(storedModels) ? storedModels : [];
    try {
      const lease = await ensureServe({ cwd, executable, spawnImpl, fetchImpl });
      try {
        return await listHarnessModels({ ...lease.client, fetch: fetchImpl, cwd });
      } finally {
        try { lease.release(); } catch { /* Ignore release failures during refresh. */ }
      }
    } catch {
      // A failed refresh must never clear the known catalog.
      return Array.isArray(storedModels) ? storedModels : [];
    }
  };
}
