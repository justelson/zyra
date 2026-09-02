#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createFetchTransport,
  createProductAnalytics,
  isRetryableExclusiveOpenError,
  resolveAnalyticsConfig,
  validatePostHogEndpoint,
} from "../src/analytics/client.mjs";
import {
  BUNDLED_RELEASE_ANALYTICS_CONFIG,
  withBundledReleaseAnalyticsConfig,
} from "../src/analytics/release-config.mjs";
import {
  ANALYTICS_EVENT_NAMES,
  sanitizeAnalyticsEvent,
} from "../src/analytics/contracts.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VALID_KEY = "phc_analytics_contract_placeholder_123456";
const VALID_ENV = {
  ZYRA_ANALYTICS_ENABLED: "1",
  ZYRA_POSTHOG_PROJECT_KEY: VALID_KEY,
  ZYRA_POSTHOG_HOST: "https://us.i.posthog.com",
};
const UUID_A = "123e4567-e89b-42d3-a456-426614174000";
const UUID_B = "123e4567-e89b-42d3-a456-426614174001";

const temporaryRoots = [];
try {
  await testDisabledIsInert();
  await testFetchTimeoutContract();
  testConfigurationAndEndpointValidation();
  testBundledReleaseConfiguration();
  testWindowsExclusiveOpenErrors();
  testPropertySanitation();
  await testBatchingRetryPersistenceAndIdentity();
  await testRetryBoundAndShutdownFlush();
  await testQueueAgeBound();
  await testConcurrentClients();
  await testRendererOwnedEventReload();
  await testImmediateOptOut();
  await testOptOutDoesNotBlockOnQueueCleanup();
  await testOptOutWhileCaptureWaitsForQueueLock();
  await testPersistedToggleAndRedactedStatus();
  await testSharedExplicitConsentAndCrossClientOptOut();
  await testRepresentativeCatalogEvents();
  await testInstrumentationReachability();
  await testRendererAndCredentialBoundaries();
  console.log("product analytics contracts: ok");
} finally {
  await Promise.all(temporaryRoots.map((directory) => rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 50,
  })));
}

async function temporaryDirectory(label) {
  const directory = await mkdtemp(path.join(os.tmpdir(), `zyra-analytics-${label}-`));
  temporaryRoots.push(directory);
  return directory;
}

async function waitForFileRemoval(file, message, timeoutMs = 2_500) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    try {
      await stat(file);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(message);
}

function clientOptions(storageDirectory, overrides = {}) {
  return {
    storageDirectory,
    source: "cli",
    appVersion: "0.6.0",
    platform: "win32",
    architecture: "x64",
    autoFlush: false,
    randomUUID: () => UUID_A,
    ...overrides,
  };
}

function testBundledReleaseConfiguration() {
  assert.match(BUNDLED_RELEASE_ANALYTICS_CONFIG.projectToken, /^phc_[A-Za-z0-9_-]{40,200}$/);
  assert.equal(BUNDLED_RELEASE_ANALYTICS_CONFIG.host, "https://us.i.posthog.com");
  const disabled = withBundledReleaseAnalyticsConfig({}, false);
  assert.equal(disabled.ZYRA_POSTHOG_PROJECT_KEY, undefined);
  const configured = withBundledReleaseAnalyticsConfig({}, true);
  assert.equal(configured.ZYRA_POSTHOG_PROJECT_KEY, BUNDLED_RELEASE_ANALYTICS_CONFIG.projectToken);
  assert.equal(configured.ZYRA_POSTHOG_HOST, BUNDLED_RELEASE_ANALYTICS_CONFIG.host);
  const overridden = withBundledReleaseAnalyticsConfig({
    ZYRA_POSTHOG_PROJECT_KEY: VALID_KEY,
    ZYRA_POSTHOG_HOST: "https://eu.i.posthog.com",
    ZYRA_ANALYTICS_ENABLED: "false",
  }, true);
  assert.equal(overridden.ZYRA_POSTHOG_PROJECT_KEY, VALID_KEY);
  assert.equal(overridden.ZYRA_POSTHOG_HOST, "https://eu.i.posthog.com");
  assert.equal(overridden.ZYRA_ANALYTICS_ENABLED, "false");
}

function testWindowsExclusiveOpenErrors() {
  assert.equal(isRetryableExclusiveOpenError({ code: "EEXIST" }, "linux"), true);
  assert.equal(isRetryableExclusiveOpenError({ code: "EPERM" }, "win32"), true, "Windows reports transient lock-file deletion races as EPERM");
  assert.equal(isRetryableExclusiveOpenError({ code: "EACCES" }, "win32"), true);
  assert.equal(isRetryableExclusiveOpenError({ code: "EPERM" }, "linux"), false);
  assert.equal(isRetryableExclusiveOpenError({ code: "EINVAL" }, "win32"), false);
}

async function testSharedExplicitConsentAndCrossClientOptOut() {
  const rootDirectory = await temporaryDirectory("shared-consent");
  const preferencePath = path.join(rootDirectory, "shared", "consent.json");
  const desktopDirectory = path.join(rootDirectory, "desktop");
  const cliDirectory = path.join(rootDirectory, "cli");
  await mkdir(desktopDirectory, { recursive: true });
  await writeFile(path.join(desktopDirectory, "config.json"), JSON.stringify({ schemaVersion: 1, enabled: true, projectKey: VALID_KEY, host: "https://us.i.posthog.com" }));
  let transportCalls = 0;
  let notifyRetrySleep;
  let releaseRetrySleep;
  const retrySleeping = new Promise((resolve) => { notifyRetrySleep = resolve; });
  const retryRelease = new Promise((resolve) => { releaseRetrySleep = resolve; });

  const desktop = createProductAnalytics(clientOptions(desktopDirectory, {
    env: VALID_ENV,
    preferencePath,
    requireExplicitPreference: true,
  }));
  await desktop.initialize();
  assert.equal(desktop.status().enabled, false, "release or legacy configuration cannot bypass explicit consent");
  assert.equal(desktop.status().preferenceSet, false);
  await assert.rejects(stat(path.join(desktopDirectory, "installation-id")));

  const cli = createProductAnalytics(clientOptions(cliDirectory, {
    env: VALID_ENV,
    preferencePath,
    requireExplicitPreference: true,
    retryDelaysMs: [1],
    transport: async () => {
      transportCalls += 1;
      return { ok: false, retryable: true };
    },
    sleep: async () => {
      notifyRetrySleep();
      await retryRelease;
    },
  }));
  await cli.initialize();
  assert.equal(cli.status().enabled, false);
  assert.equal((await desktop.updateEnabled(true)).enabled, true);
  assert.equal((await cli.refreshStatus()).enabled, true, "Desktop consent is shared with an already-running CLI/TUI client");
  const killed = createProductAnalytics(clientOptions(path.join(rootDirectory, "operator-disabled"), {
    env: { ...VALID_ENV, ZYRA_ANALYTICS_ENABLED: "false" },
    preferencePath,
    requireExplicitPreference: true,
  }));
  await killed.initialize();
  assert.equal(killed.status().enabled, false, "the explicit operator kill switch overrides user opt-in");
  assert.equal(killed.status().canChangeEnabled, false);
  assert.equal(await cli.capture("zyra_v1_cli", { action: "startup" }), true);

  const flushing = cli.flush({ maxAttempts: 2 });
  await retrySleeping;
  await desktop.updateEnabled(false);
  releaseRetrySleep();
  assert.equal(await flushing, false);
  assert.equal(transportCalls, 1, "a sibling process observes opt-out before retrying");
  assert.equal(await cli.capture("zyra_v1_cli", { action: "startup" }), false);
  await assert.rejects(stat(path.join(cliDirectory, "queue.json")), "inactive clients delete their persisted queue");
  assert.equal(JSON.parse(await readFile(preferencePath, "utf8")).enabled, false);

  const inactiveDirectory = path.join(rootDirectory, "inactive");
  await mkdir(inactiveDirectory, { recursive: true });
  await writeFile(path.join(inactiveDirectory, "config.json"), JSON.stringify({ schemaVersion: 1, enabled: false }));
  await writeFile(path.join(inactiveDirectory, "queue.json"), JSON.stringify({ schemaVersion: 1, events: [{ event: "zyra_v1_cli", timestamp: new Date().toISOString(), properties: { action: "startup" } }] }));
  const inactive = createProductAnalytics(clientOptions(inactiveDirectory, { env: {} }));
  await inactive.initialize();
  await assert.rejects(stat(path.join(inactiveDirectory, "queue.json")), "startup with inactive configuration removes an old queue");
}

async function testDisabledIsInert() {
  const parentDirectory = await temporaryDirectory("disabled");
  const storageDirectory = path.join(parentDirectory, "analytics-state");
  let calls = 0;
  let timers = 0;
  const client = createProductAnalytics(clientOptions(storageDirectory, {
    env: {},
    setTimer: (...args) => { timers += 1; return setTimeout(...args); },
    transport: async () => { calls += 1; return { ok: true, retryable: false }; },
  }));
  await client.initialize();
  assert.equal(client.status().enabled, false);
  assert.equal(client.status().preferenceSet, false);
  assert.equal(await client.capture("zyra_v1_cli", { action: "startup" }), false);
  assert.equal(await client.flush(), true);
  assert.equal(calls, 0);
  assert.equal(timers, 0);
  await assert.rejects(readFile(storageDirectory, "utf8"));

  const unconfiguredDirectory = path.join(parentDirectory, "unconfigured-state");
  let unconfiguredCalls = 0;
  const unconfigured = createProductAnalytics(clientOptions(unconfiguredDirectory, {
    env: { ZYRA_ANALYTICS_ENABLED: "1" },
    transport: async () => { unconfiguredCalls += 1; return { ok: true, retryable: false }; },
  }));
  await unconfigured.initialize();
  assert.equal(unconfigured.status().enabled, false);
  assert.equal(unconfigured.status().preferenceSet, true);
  assert.equal(await unconfigured.capture("zyra_v1_cli", { action: "startup" }), false);
  assert.equal(unconfiguredCalls, 0);
  await assert.rejects(readFile(unconfiguredDirectory, "utf8"));
  const attemptedOptInDirectory = path.join(parentDirectory, "attempted-opt-in");
  const attemptedOptIn = createProductAnalytics(clientOptions(attemptedOptInDirectory, { env: {} }));
  const attemptedStatus = await attemptedOptIn.updateEnabled(true);
  assert.equal(attemptedStatus.enabled, false);
  assert.equal(attemptedStatus.requested, true);
  assert.equal(attemptedStatus.preferenceSet, true);
  assert.deepEqual(JSON.parse(await readFile(path.join(attemptedOptInDirectory, "config.json"), "utf8")), { schemaVersion: 1, enabled: true }, "unconfigured opt-in remembers consent without activating capture");
  await assert.rejects(readFile(path.join(attemptedOptInDirectory, "installation-id"), "utf8"), undefined, "unconfigured consent creates no installation identity");
  await assert.rejects(readFile(path.join(attemptedOptInDirectory, "queue.json"), "utf8"), undefined, "unconfigured consent creates no event queue");

  const corruptDirectory = await temporaryDirectory("corrupt-config");
  await writeFile(path.join(corruptDirectory, "config.json"), "{not-json", "utf8");
  const corrupt = createProductAnalytics(clientOptions(corruptDirectory, { env: {} }));
  await corrupt.initialize();
  assert.equal(corrupt.status().reason, "config_invalid");
  assert.equal(await corrupt.capture("zyra_v1_cli", { action: "startup" }), false);
  await corrupt.updateEnabled(false);
  assert.deepEqual(JSON.parse(await readFile(path.join(corruptDirectory, "config.json"), "utf8")), { schemaVersion: 1, enabled: false });

  const oversizedDirectory = await temporaryDirectory("oversized-config");
  await writeFile(path.join(oversizedDirectory, "config.json"), " ".repeat(70 * 1024), "utf8");
  const oversized = createProductAnalytics(clientOptions(oversizedDirectory, { env: {} }));
  await oversized.initialize();
  assert.equal(oversized.status().reason, "config_invalid");
}

async function testFetchTimeoutContract() {
  let observedSignal = null;
  let observedHeaders = null;
  const transport = createFetchTransport((_url, options) => new Promise((_resolve, reject) => {
    observedSignal = options.signal;
    observedHeaders = options.headers;
    options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
  }));
  const keepAlive = setTimeout(() => {}, 100);
  try {
    await assert.rejects(transport({ url: "https://us.i.posthog.com/batch/", payload: {}, timeoutMs: 5 }), /aborted/);
  } finally {
    clearTimeout(keepAlive);
  }
  assert.equal(observedSignal.aborted, true);
  assert.deepEqual(observedHeaders, { "content-type": "application/json" });
}

function testConfigurationAndEndpointValidation() {
  assert.equal(resolveAnalyticsConfig({ env: VALID_ENV }).active, true);
  assert.equal(resolveAnalyticsConfig({ env: { ...VALID_ENV, ZYRA_ANALYTICS_ENABLED: "maybe" } }).active, false);
  assert.equal(resolveAnalyticsConfig({ env: {}, persisted: { schemaVersion: 99, enabled: true, projectKey: VALID_KEY, host: "https://us.i.posthog.com" } }).reason, "config_invalid");
  assert.equal(resolveAnalyticsConfig({ env: { ...VALID_ENV, ZYRA_POSTHOG_PROJECT_KEY: "personal-secret" } }).active, false);
  assert.equal(resolveAnalyticsConfig({ env: { ...VALID_ENV, ZYRA_POSTHOG_PROJECT_KEY: "phx_personal_api_key_rejected_123456" } }).active, false);
  assert.equal(resolveAnalyticsConfig({ env: { ...VALID_ENV, ZYRA_POSTHOG_HOST: "http://us.i.posthog.com" } }).active, false);
  assert.equal(resolveAnalyticsConfig({ env: { ...VALID_ENV, ZYRA_POSTHOG_HOST: "https://example.com" } }).active, false);
  assert.deepEqual(validatePostHogEndpoint("https://eu.i.posthog.com"), {
    valid: true,
    captureUrl: "https://eu.i.posthog.com/batch/",
    hostCategory: "posthog_eu",
  });
  assert.equal(validatePostHogEndpoint("https://analytics.example.com", ["analytics.example.com"]).valid, true);
  for (const invalid of [
    "http://localhost:8000",
    "https://user:pass@us.i.posthog.com",
    "https://us.i.posthog.com:8443",
    "https://us.i.posthog.com/project",
    "https://us.i.posthog.com?token=x",
    "file:///tmp/capture",
  ]) assert.equal(validatePostHogEndpoint(invalid).valid, false, invalid);
}

function testPropertySanitation() {
  const sanitized = sanitizeAnalyticsEvent({
    event: "zyra_v1_chat",
    properties: {
      action: "send",
      outcome: "started",
      attachment_count: 99,
      duration_ms: -4,
      model_family: "openai",
      prompt: "private prompt",
      response: "private response",
      path: "C:/private/repository",
      url: "https://private.example/?token=x",
      error: "raw stack",
      project_name: "private project",
      session_id: "session-private",
      chat_id: "chat-private",
      turn_id: "turn-private",
      account_email: "private@example.com",
      arbitrary: { nested: true },
    },
  }, {
    source: "desktop_main",
    app_version: "0.6.0",
    platform: "win32",
    architecture: "x64",
  });
  assert.ok(sanitized);
  assert.equal(sanitized.properties.attachment_count, 32);
  assert.equal(sanitized.properties.duration_ms, 0);
  assert.equal(sanitized.properties.source, "desktop_main");
  for (const forbidden of ["prompt", "response", "path", "url", "error", "project_name", "session_id", "chat_id", "turn_id", "account_email", "arbitrary"]) {
    assert.equal(Object.hasOwn(sanitized.properties, forbidden), false);
  }
  assert.equal(sanitizeAnalyticsEvent({ event: "unknown", properties: {} }), null);
  assert.equal(sanitizeAnalyticsEvent({ event: "zyra_v1_chat", properties: { outcome: "completed" } }), null);
  const unsafeSkill = sanitizeAnalyticsEvent({ event: "zyra_v1_cli", properties: { action: "skill", skill: "../../private" } }, {
    source: "cli", app_version: "0.6.0", platform: "win32", architecture: "x64",
  });
  assert.equal(Object.hasOwn(unsafeSkill.properties, "skill"), false);
  assert.equal(sanitizeAnalyticsEvent({ event: "zyra_v1_cli", properties: { action: "skill", skill: "private_email_alice_example_com" } }, {
    source: "desktop_renderer", app_version: "0.6.0", platform: "win32", architecture: "x64",
  }), null, "renderer-owned sources cannot forge CLI skill events");
}

async function testBatchingRetryPersistenceAndIdentity() {
  const storageDirectory = await temporaryDirectory("batch");
  const requests = [];
  const delays = [];
  const client = createProductAnalytics(clientOptions(storageDirectory, {
    env: { ...VALID_ENV, POSTHOG_PERSONAL_API_KEY: "phx_personal_key_must_never_be_used" },
    autoFlush: true,
    batchSize: 2,
    retryDelaysMs: [7],
    sleep: async (milliseconds) => { delays.push(milliseconds); },
    transport: async (request) => {
      requests.push(structuredClone(request));
      return requests.length === 1 ? { ok: false, retryable: true } : { ok: true, retryable: false };
    },
  }));
  await client.initialize();
  await client.capture("zyra_v1_cli", { action: "startup", command: "chat", outcome: "started" });
  assert.equal(await client.capture("zyra_v1_cli", { action: "slash_command", command: "commands", outcome: "completed" }), true, "a capture transport failure never fails the product action");
  assert.equal(requests.length, 1, "threshold flush uses one bounded attempt");
  assert.equal(await client.flush({ maxAttempts: 2 }), true);
  assert.equal(requests.length, 2);
  assert.deepEqual(delays, []);
  assert.equal(requests[1].url, "https://us.i.posthog.com/batch/");
  assert.equal(requests[1].payload.api_key, VALID_KEY);
  assert.equal(requests[1].payload.batch.length, 2);
  assert.equal(requests[1].payload.batch[0].distinct_id, undefined);
  assert.equal(requests[1].payload.batch[0].properties.distinct_id, UUID_A);
  assert.equal(requests[1].payload.batch[0].properties.$process_person_profile, false);
  assert.equal(requests[1].payload.historical_migration, false);
  assert.deepEqual(Object.keys(requests[1].payload).sort(), ["api_key", "batch", "historical_migration"]);
  assert.equal(JSON.stringify(requests[1].payload.batch[0].properties).includes(VALID_KEY), false);
  assert.equal((await readFile(path.join(storageDirectory, "installation-id"), "utf8")).trim(), UUID_A);
  assert.equal(requests[1].headers, undefined, "transport contract does not accept caller-supplied authorization headers");
  const serialized = JSON.stringify(requests);
  for (const forbidden of ["private prompt", "C:/private", "raw stack", "phx_personal_key_must_never_be_used"]) assert.equal(serialized.includes(forbidden), false);
}

async function testRetryBoundAndShutdownFlush() {
  const retryDirectory = await temporaryDirectory("retry");
  let attempts = 0;
  const delays = [];
  const failing = createProductAnalytics(clientOptions(retryDirectory, {
    env: VALID_ENV,
    retryDelaysMs: [2, 4],
    sleep: async (milliseconds) => { delays.push(milliseconds); },
    transport: async () => { attempts += 1; return { ok: false, retryable: true }; },
  }));
  await failing.capture("zyra_v1_cli", { action: "startup", outcome: "started" });
  assert.equal(await failing.flush({ maxAttempts: 3 }), false);
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [2, 4]);
  const persisted = JSON.parse(await readFile(path.join(retryDirectory, "queue.json"), "utf8"));
  assert.equal(persisted.events.length, 1);

  const shutdownDirectory = await temporaryDirectory("shutdown");
  let flushed = 0;
  const client = createProductAnalytics(clientOptions(shutdownDirectory, {
    env: VALID_ENV,
    randomUUID: () => UUID_B,
    transport: async () => { flushed += 1; return { ok: true, retryable: false }; },
  }));
  const pendingCapture = client.capture("zyra_v1_cli", { action: "startup", outcome: "started" });
  await client.shutdown({ timeoutMs: 10_000 });
  assert.equal(await pendingCapture, true, "shutdown drains capture work queued immediately before it closes the client");
  assert.equal(flushed, 1);
  assert.equal(client.status().queueSize, 0);

  const boundedShutdownDirectory = await temporaryDirectory("bounded-shutdown");
  const hanging = createProductAnalytics(clientOptions(boundedShutdownDirectory, {
    env: VALID_ENV,
    transport: async () => new Promise(() => {}),
  }));
  await hanging.capture("zyra_v1_cli", { action: "startup", outcome: "started" });
  const shutdownStartedAt = performance.now();
  const shutdownKeepAlive = setTimeout(() => {}, 300);
  try {
    await hanging.shutdown({ timeoutMs: 50 });
  } finally {
    clearTimeout(shutdownKeepAlive);
  }
  assert.ok(performance.now() - shutdownStartedAt < 250, "shutdown flush remains time-bounded when transport never settles");

  assert.notEqual(UUID_A, UUID_B);
  assert.equal(UUID_B.toLowerCase().includes(os.userInfo().username.toLowerCase()), false);

  const boundedDirectory = await temporaryDirectory("bounded-queue");
  const bounded = createProductAnalytics(clientOptions(boundedDirectory, { env: VALID_ENV, maxQueueSize: 3 }));
  for (let index = 0; index < 5; index += 1) {
    await bounded.capture("zyra_v1_cli", { action: "slash_command", command: "commands", outcome: "completed" });
  }
  assert.equal(bounded.status().queueSize, 3);
  const boundedFile = JSON.parse(await readFile(path.join(boundedDirectory, "queue.json"), "utf8"));
  assert.equal(boundedFile.events.length, 3);
  assert.ok((await stat(path.join(boundedDirectory, "queue.json"))).size <= 2 * 1024 * 1024);
  const restarted = createProductAnalytics(clientOptions(boundedDirectory, { env: VALID_ENV, randomUUID: () => UUID_B }));
  await restarted.initialize();
  assert.equal(restarted.status().queueSize, 3);
  assert.equal((await readFile(path.join(boundedDirectory, "installation-id"), "utf8")).trim(), UUID_A, "the pseudonymous installation ID stays stable across restarts");
}

async function testQueueAgeBound() {
  const storageDirectory = await temporaryDirectory("queue-age");
  let nowMs = Date.parse("2026-01-01T00:00:00.000Z");
  let calls = 0;
  const client = createProductAnalytics(clientOptions(storageDirectory, {
    env: VALID_ENV,
    maxEventAgeMs: 1_000,
    now: () => new Date(nowMs),
    transport: async () => { calls += 1; return { ok: true, retryable: false }; },
  }));
  await client.capture("zyra_v1_cli", { action: "startup", outcome: "started" });
  nowMs += 1_001;
  assert.equal(await client.flush(), true);
  assert.equal(calls, 0, "expired local events are dropped before transport");
  assert.equal(client.status().queueSize, 0);
  const queueFile = JSON.parse(await readFile(path.join(storageDirectory, "queue.json"), "utf8"));
  assert.equal(queueFile.events.length, 0);

  await client.capture("zyra_v1_cli", { action: "slash_command", command: "commands", outcome: "completed" });
  nowMs += 1_001;
  const reloaded = createProductAnalytics(clientOptions(storageDirectory, {
    env: VALID_ENV,
    maxEventAgeMs: 1_000,
    now: () => new Date(nowMs),
    randomUUID: () => UUID_B,
  }));
  await reloaded.initialize();
  assert.equal(reloaded.status().queueSize, 0, "expired local events are dropped during queue hydration");
}

async function testConcurrentClients() {
  const storageDirectory = await temporaryDirectory("concurrent-clients");
  const payloads = [];
  const first = createProductAnalytics(clientOptions(storageDirectory, {
    env: VALID_ENV,
    randomUUID: () => UUID_A,
    transport: async ({ payload }) => { payloads.push(payload); return { ok: true, retryable: false }; },
  }));
  const second = createProductAnalytics(clientOptions(storageDirectory, {
    env: VALID_ENV,
    randomUUID: () => UUID_B,
    transport: async ({ payload }) => { payloads.push(payload); return { ok: true, retryable: false }; },
  }));
  await Promise.all([first.initialize(), second.initialize()]);
  const installationId = (await readFile(path.join(storageDirectory, "installation-id"), "utf8")).trim();
  assert.ok(installationId === UUID_A || installationId === UUID_B);
  await Promise.all([
    first.capture("zyra_v1_cli", { action: "startup", outcome: "started" }),
    second.capture("zyra_v1_cli", { action: "recovery", outcome: "recovered" }),
  ]);
  const queued = JSON.parse(await readFile(path.join(storageDirectory, "queue.json"), "utf8"));
  assert.equal(queued.events.length, 2, "concurrent clients preserve both queue updates");
  await Promise.all([first.flush(), second.flush()]);
  assert.equal(payloads.reduce((count, payload) => count + payload.batch.length, 0), 2, "concurrent flushes claim each event once");
  for (const payload of payloads) {
    for (const event of payload.batch) assert.equal(event.properties.distinct_id, installationId);
  }
  const drained = JSON.parse(await readFile(path.join(storageDirectory, "queue.json"), "utf8"));
  assert.equal(drained.events.length, 0);
  await assert.rejects(readFile(path.join(storageDirectory, "queue.lock"), "utf8"));
}

async function testRendererOwnedEventReload() {
  const storageDirectory = await temporaryDirectory("renderer-owned-reload");
  const renderer = createProductAnalytics(clientOptions(storageDirectory, {
    env: VALID_ENV,
    source: "desktop_renderer",
  }));
  assert.equal(await renderer.capture("zyra_v1_files", { action: "preview" }), true);

  const payloads = [];
  const main = createProductAnalytics(clientOptions(storageDirectory, {
    env: VALID_ENV,
    source: "desktop_main",
    randomUUID: () => UUID_B,
    transport: async ({ payload }) => {
      payloads.push(payload);
      return { ok: true, retryable: false };
    },
  }));
  await main.initialize();
  assert.equal(main.status().queueSize, 1, "main reload preserves an event owned by the renderer");
  assert.equal(await main.flush(), true);
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].batch[0].event, "zyra_v1_files");
  assert.equal(payloads[0].batch[0].properties.source, "desktop_renderer");
}

async function testImmediateOptOut() {
  const storageDirectory = await temporaryDirectory("immediate-opt-out");
  await writeFile(path.join(storageDirectory, "config.json"), `${JSON.stringify({ schemaVersion: 1, enabled: true, projectKey: VALID_KEY, host: "https://us.i.posthog.com" })}\n`, "utf8");
  let transportStarted;
  const started = new Promise((resolve) => { transportStarted = resolve; });
  const client = createProductAnalytics(clientOptions(storageDirectory, {
    env: {},
    transport: async ({ signal }) => new Promise((resolve) => {
      transportStarted();
      signal.addEventListener("abort", () => resolve({ ok: false, retryable: true }), { once: true });
    }),
  }));
  const concurrentClient = createProductAnalytics(clientOptions(storageDirectory, { env: {}, randomUUID: () => UUID_B }));
  await Promise.all([client.initialize(), concurrentClient.initialize()]);
  await client.capture("zyra_v1_cli", { action: "startup", outcome: "started" });
  const flush = client.flush();
  await started;
  const disabledStartedAt = performance.now();
  const disabled = await client.updateEnabled(false);
  assert.ok(performance.now() - disabledStartedAt < 250, "opt-out does not wait behind an in-flight transport");
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.queueSize, 0);
  assert.equal(await flush, false);
  await waitForFileRemoval(
    path.join(storageDirectory, "queue.json"),
    "opt-out did not finish removing the queue after the cancelled transport settled",
  );
  assert.equal(await client.capture("zyra_v1_cli", { action: "startup", outcome: "started" }), false);
  assert.equal(await concurrentClient.capture("zyra_v1_cli", { action: "startup", outcome: "started" }), false, "other CLI clients observe persisted opt-out before their next capture");
}

async function testOptOutDoesNotBlockOnQueueCleanup() {
  const storageDirectory = await temporaryDirectory("opt-out-cleanup-lock");
  await writeFile(path.join(storageDirectory, "config.json"), `${JSON.stringify({ schemaVersion: 1, enabled: true, projectKey: VALID_KEY, host: "https://us.i.posthog.com" })}\n`, "utf8");
  const client = createProductAnalytics(clientOptions(storageDirectory, { env: {} }));
  await client.initialize();
  await client.capture("zyra_v1_cli", { action: "startup", outcome: "started" });
  await writeFile(path.join(storageDirectory, "queue.lock"), "held", "utf8");
  const startedAt = performance.now();
  const status = await client.updateEnabled(false);
  assert.equal(status.enabled, false);
  assert.ok(performance.now() - startedAt < 500, "saved opt-out is not blocked by queue cleanup");
  await rm(path.join(storageDirectory, "queue.lock"), { force: true });
  await waitForFileRemoval(
    path.join(storageDirectory, "queue.json"),
    "background opt-out queue cleanup did not finish",
  );
}

async function testOptOutWhileCaptureWaitsForQueueLock() {
  const storageDirectory = await temporaryDirectory("opt-out-during-lock-wait");
  await writeFile(path.join(storageDirectory, "config.json"), `${JSON.stringify({
    schemaVersion: 1,
    enabled: true,
    projectKey: VALID_KEY,
    host: "https://us.i.posthog.com",
  })}\n`, "utf8");
  let releaseCaptureWait;
  let releaseDisableWait;
  let captureWaitStarted;
  let disableWaitStarted;
  const captureWait = new Promise((resolve) => { releaseCaptureWait = resolve; });
  const disableWait = new Promise((resolve) => { releaseDisableWait = resolve; });
  const captureStarted = new Promise((resolve) => { captureWaitStarted = resolve; });
  const disableStarted = new Promise((resolve) => { disableWaitStarted = resolve; });
  let lockWaitCount = 0;
  const client = createProductAnalytics(clientOptions(storageDirectory, {
    env: {},
    sleep: async () => {
      lockWaitCount += 1;
      if (lockWaitCount === 1) {
        captureWaitStarted();
        await captureWait;
        return;
      }
      if (lockWaitCount === 2) {
        disableWaitStarted();
        await disableWait;
      }
    },
  }));
  await client.initialize();
  const queueLockPath = path.join(storageDirectory, "queue.lock");
  await writeFile(queueLockPath, "test-held-lock\n", "utf8");
  const capture = client.capture("zyra_v1_cli", { action: "startup", outcome: "started" });
  await captureStarted;
  const disable = client.updateEnabled(false);
  await disableStarted;
  await rm(queueLockPath, { force: true });
  releaseDisableWait();
  assert.equal((await disable).enabled, false);
  releaseCaptureWait();
  assert.equal(await capture, false, "a capture waiting for queue.lock must honor an opt-out that completes first");
  await assert.rejects(readFile(path.join(storageDirectory, "queue.json"), "utf8"), undefined, "opt-out leaves no queued event on disk");
}

async function testPersistedToggleAndRedactedStatus() {
  const storageDirectory = await temporaryDirectory("toggle");
  await writeFile(path.join(storageDirectory, "config.json"), `${JSON.stringify({
    schemaVersion: 1,
    enabled: false,
    projectKey: VALID_KEY,
    host: "https://eu.i.posthog.com",
  })}\n`, { encoding: "utf8", mode: 0o600 });
  let networkCalls = 0;
  let scheduledTimers = 0;
  let clearedTimers = 0;
  const client = createProductAnalytics(clientOptions(storageDirectory, {
    env: {},
    autoFlush: true,
    batchSize: 20,
    setTimer: (...args) => { scheduledTimers += 1; return setTimeout(...args); },
    clearTimer: (timer) => { clearedTimers += 1; clearTimeout(timer); },
    transport: async () => { networkCalls += 1; return { ok: true, retryable: false }; },
  }));
  await client.initialize();
  const status = await client.updateEnabled(true);
  assert.equal(status.enabled, true);
  assert.equal(JSON.stringify(status).includes(VALID_KEY), false);
  assert.equal(JSON.stringify(status).includes("eu.i.posthog.com"), false);
  const persisted = JSON.parse(await readFile(path.join(storageDirectory, "config.json"), "utf8"));
  assert.equal(persisted.projectKey, VALID_KEY);
  assert.equal(persisted.enabled, true);
  await client.capture("zyra_v1_cli", { action: "startup", outcome: "started" });
  assert.equal(client.status().queueSize, 1);
  assert.equal(scheduledTimers, 1);
  const stableIdentity = (await readFile(path.join(storageDirectory, "installation-id"), "utf8")).trim();
  const disabled = await client.updateEnabled(false);
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.queueSize, 0);
  assert.ok(clearedTimers >= 1);
  await assert.rejects(readFile(path.join(storageDirectory, "queue.json"), "utf8"));
  assert.equal(await client.flush(), true);
  assert.equal(networkCalls, 0);
  const reenabled = await client.updateEnabled(true);
  assert.equal(reenabled.enabled, true);
  assert.equal((await readFile(path.join(storageDirectory, "installation-id"), "utf8")).trim(), stableIdentity);
  const entries = await import("node:fs/promises").then(({ readdir }) => readdir(storageDirectory));
  assert.equal(entries.some((entry) => entry.includes(".tmp-")), false, "atomic writes leave no temporary files");
}

async function testRepresentativeCatalogEvents() {
  const clients = {
    desktop_main: createProductAnalytics(clientOptions(await temporaryDirectory("catalog-main"), { env: VALID_ENV, source: "desktop_main", maxQueueSize: 50 })),
    desktop_renderer: createProductAnalytics(clientOptions(await temporaryDirectory("catalog-renderer"), { env: VALID_ENV, source: "desktop_renderer", maxQueueSize: 50 })),
    cli: createProductAnalytics(clientOptions(await temporaryDirectory("catalog-cli"), { env: VALID_ENV, source: "cli", maxQueueSize: 50 })),
  };
  const representative = {
    zyra_v1_app_lifecycle: { action: "launch_ready" },
    zyra_v1_onboarding: { action: "step_completed" },
    zyra_v1_account_connection: { action: "connect" },
    zyra_v1_chat: { action: "send" },
    zyra_v1_voice: { action: "start" },
    zyra_v1_project: { action: "open" },
    zyra_v1_files: { action: "preview" },
    zyra_v1_browser: { action: "navigation" },
    zyra_v1_utility_window: { action: "tab_create" },
    zyra_v1_workspace_ui: { action: "settings_section" },
    zyra_v1_cli: { action: "startup" },
  };
  assert.deepEqual(Object.keys(representative).sort(), [...ANALYTICS_EVENT_NAMES].sort());
  const owners = {
    zyra_v1_app_lifecycle: "desktop_main", zyra_v1_onboarding: "desktop_main", zyra_v1_account_connection: "desktop_main",
    zyra_v1_chat: "desktop_main", zyra_v1_voice: "desktop_main", zyra_v1_project: "desktop_main",
    zyra_v1_files: "desktop_renderer", zyra_v1_browser: "desktop_main", zyra_v1_utility_window: "desktop_main",
    zyra_v1_workspace_ui: "desktop_renderer", zyra_v1_cli: "cli",
  };
  for (const [event, properties] of Object.entries(representative)) {
    assert.equal(await clients[owners[event]].capture(event, properties), true, event);
  }
  assert.equal(Object.values(clients).reduce((count, client) => count + client.status().queueSize, 0), ANALYTICS_EVENT_NAMES.length);
}

async function testInstrumentationReachability() {
  const sources = Object.fromEntries(await Promise.all([
    "desktop/src/main/index.ts",
    "desktop/src/main/ipc/handlers/setup-handlers.ts",
    "desktop/src/main/assistant/service.ts",
    "desktop/src/main/browser-view-manager.ts",
    "desktop/src/main/browser-popup-manager.ts",
    "desktop/src/main/browser-download-service.ts",
    "desktop/src/main/ipc/handlers/browser-preview-handlers.ts",
    "desktop/src/main/ipc/handlers/project-details-handlers.ts",
    "desktop/src/main/assistant/assistant-utility-window-manager.ts",
    "desktop/src/main/update/manager.ts",
    "desktop/src/main/diagnostics/renderer-hang-recorder.ts",
    "desktop/src/renderer/src/components/ui/file-preview/useFilePreview.ts",
    "desktop/src/renderer/src/components/ui/file-preview/useFilePreviewEditSession.ts",
    "desktop/src/renderer/src/components/ui/file-preview/usePreviewFileSearch.ts",
    "desktop/src/renderer/src/pages/assistant/AssistantBrowserHistoryImportDialog.tsx",
    "desktop/src/renderer/src/pages/assistant/AssistantBrowserWorkspace.tsx",
    "desktop/src/renderer/src/pages/settings/SettingsShell.tsx",
    "desktop/src/renderer/src/pages/folder-browse/useFolderBrowseActions.ts",
    "desktop/src/renderer/src/lib/settings.tsx",
    "src/zyra-app.mjs",
    "src/slash-command-handlers.mjs",
    "src/agent-server/tui-runtime.mjs",
  ].map(async (file) => [file, await source(file)])));
  const combined = Object.values(sources).join("\n");
  for (const event of ANALYTICS_EVENT_NAMES) assert.match(combined, new RegExp(event), `${event} has a real instrumentation owner`);
  for (const action of ["step_started", "abandoned", "connect", "replace", "retry", "context_compaction", "first_response", "save", "history_import", "terminal_transfer", "settings_section", "update_check", "workspace_command", "recovery"]) {
    assert.match(combined, new RegExp(`['\"]${action}['\"]`), `representative action ${action} is wired`);
  }
  assert.match(sources["desktop/src/main/browser-view-manager.ts"], /sessionMode === 'normal'[\s\S]*captureAnalytics/);
  assert.match(sources["desktop/src/main/browser-popup-manager.ts"], /sourceContents\.session === getGlobalBrowserSession\(\)/);
  assert.match(sources["desktop/src/main/browser-download-service.ts"], /analyticsAllowed = browserSession\.isPersistent\(\)/);
  assert.match(sources["desktop/src/main/ipc/handlers/browser-preview-handlers.ts"], /analyticsAllowed = browserSession\.isPersistent\(\)/);
  assert.match(sources["desktop/src/main/assistant/assistant-utility-window-manager.ts"], /shouldCaptureUtilityTab[\s\S]*sessionMode !== 'incognito'/);
  assert.doesNotMatch(sources["desktop/src/renderer/src/pages/assistant/AssistantBrowserHistoryImportDialog.tsx"], /captureProductEvent|zyra_v1_browser/);
  assert.doesNotMatch(sources["desktop/src/renderer/src/pages/assistant/AssistantBrowserWorkspace.tsx"], /captureProductEvent|zyra_v1_browser/);
  assert.match(sources["desktop/src/main/ipc/handlers/browser-preview-handlers.ts"], /captureBrowserActionAnalytics/);
  assert.match(sources["desktop/src/main/ipc/handlers/browser-preview-handlers.ts"], /handleImportExternalBrowserHistory[\s\S]*const analyticsAllowed[\s\S]*await getExternalBrowserHistoryService\(\)\.import/);
  assert.match(sources["desktop/src/main/ipc/handlers/browser-preview-handlers.ts"], /handleSetBrowserAdBlockEnabled[\s\S]*const analyticsAllowed[\s\S]*await service\.setEnabled/);
  assert.match(sources["desktop/src/main/ipc/handlers/browser-preview-handlers.ts"], /getPendingWarning[\s\S]*warningAtStart\.sourceGuestWebContentsId/);
  assert.match(sources["desktop/src/main/index.ts"], /isAnalyticsAllowedForOwner[\s\S]*isAnalyticsAllowedForGuest/);
  assert.match(sources["desktop/src/main/ipc/handlers/project-details-handlers.ts"], /handleRecordProjectOpen[\s\S]*recordProjectOpenAnalytics\(event\.sender\.id/);
  assert.doesNotMatch(sources["desktop/src/main/ipc/handlers/project-details-handlers.ts"].match(/handleGetProjectDetails[\s\S]*?handleRecordProjectOpen/)?.[0] || "", /recordProjectOpenAnalytics/);
  assert.match(sources["desktop/src/renderer/src/pages/folder-browse/useFolderBrowseActions.ts"], /recordProjectOpen\?\.\(project\.path\)[\s\S]*recordProjectOpen\?\.\(decodedPath\)/);
  assert.match(sources["desktop/src/main/index.ts"], /isIncognitoBrowserWebContents[\s\S]*hasIncognitoBrowserContents/);
  assert.match(sources["desktop/src/main/index.ts"], /render-process-gone[\s\S]*!isIncognitoBrowserWebContents/);
  assert.doesNotMatch(combined, /captureProductEvent\([^)]*(?:transcript\.delta|command_output|scroll|mousemove|keydown)/s, "high-frequency content loops are not capture points");
}

async function testRendererAndCredentialBoundaries() {
  const preload = await source("desktop/src/preload/index.ts");
  const popupPreload = await source("desktop/src/preload/browser-popup.ts");
  const browserRelay = await source("desktop/src/preload/browser-devscope-relay.ts");
  const rendererAnalytics = await source("desktop/src/renderer/src/lib/product-analytics.ts");
  const desktopAnalyticsService = await source("desktop/src/main/analytics/service.ts");
  const analyticsPreload = await source("desktop/src/preload/analytics.ts");
  const setupHandlers = await source("desktop/src/main/ipc/handlers/setup-handlers.ts");
  const mainProcess = await source("desktop/src/main/index.ts");
  const privacySettings = await source("desktop/src/renderer/src/pages/settings/DataPrivacySettings.tsx");
  const onboardingFlow = await source("desktop/src/renderer/src/onboarding/OnboardingFlow.tsx");
  const browserViewManager = await source("desktop/src/main/browser-view-manager.ts");
  const browserPopupManager = await source("desktop/src/main/browser-popup-manager.ts");
  const browserBridgePolicy = await source("desktop/src/shared/browser-assistant-bridge.ts");
  const tuiReleaseBuilder = await source("scripts/build-tui-release.mjs");
  const runtimeContract = await source("desktop/scripts/release/runtime-contract.mjs");
  const rootPackage = JSON.parse(await source("package.json"));
  const analyticsClient = await source("src/analytics/client.mjs");
  const releaseAnalyticsConfig = await source("src/analytics/release-config.mjs");
  const cliAnalytics = await source("src/analytics/cli.mjs");
  const slashCommands = await source("src/slash-commands.mjs");
  const cliSessionStore = await source("src/zyra-sdk.mjs");
  const agentJournal = await source("src/agent-server/event-journal.mjs");
  const desktopPersistence = await source("desktop/src/main/assistant/persistence.ts");
  assert.match(preload, /if \(process\.argv\.includes\(BROWSER_POPUP_PRELOAD_ARGUMENT\)\)/);
  assert.match(preload, /else \{[\s\S]*installDesktopAnalytics\(\)/);
  assert.doesNotMatch(popupPreload, /Analytics|analytics/);
  assert.doesNotMatch(browserRelay, /Analytics|analytics/);
  assert.doesNotMatch(rendererAnalytics, /POSTHOG|projectKey|personalApi|captureUrl/i);
  assert.match(desktopAnalyticsService, /RENDERER_ANALYTICS_EVENTS = new Set\(\['zyra_v1_files', 'zyra_v1_workspace_ui'\]\)/);
  assert.match(desktopAnalyticsService, /app\.isPackaged[\s\S]*withBundledReleaseAnalyticsConfig/);
  assert.match(desktopAnalyticsService, /preferencePath:[\s\S]*requireExplicitPreference: true/);
  assert.match(desktopAnalyticsService, /setInterval\([\s\S]*this\.refreshStatus\(\)[\s\S]*2_000/);
  assert.match(mainProcess, /await setupServices\.analytics\.initialize\(\)[\s\S]*setupServices\.onboarding\.initialize\(\)/);
  assert.match(setupHandlers, /subscribeStatus\(\(status\) => broadcast\(ANALYTICS_IPC\.statusChanged, status\)\)/);
  assert.match(analyticsPreload, /onStatusChange:[\s\S]*ANALYTICS_IPC\.statusChanged/);
  assert.match(rendererAnalytics, /onDesktopAnalyticsStatusChange/);
  assert.match(privacySettings, /onDesktopAnalyticsStatusChange[\s\S]*window\.addEventListener\('focus', refresh\)/);
  assert.match(onboardingFlow, /onDesktopAnalyticsStatusChange[\s\S]*window\.addEventListener\('focus', refresh\)/);
  assert.match(cliAnalytics, /existsSync\(path\.join\(repositoryRoot, "\.git"\)\)[\s\S]*withBundledReleaseAnalyticsConfig/);
  assert.match(cliAnalytics, /preferencePath:[\s\S]*requireExplicitPreference: true/);
  assert.match(releaseAnalyticsConfig, /projectToken: "phc_[A-Za-z0-9_-]{40,200}"/);
  assert.doesNotMatch(releaseAnalyticsConfig, /phx_|personal|secret/i);
  assert.match(slashCommands, /name: "analytics"[\s\S]*\/analytics \[status\|on\|off\]/);
  assert.match(setupHandlers, /Product analytics could not be updated\./);
  assert.match(setupHandlers, /status: await services\.analytics\.refreshStatus\(\)/);
  assert.doesNotMatch(setupHandlers.match(/async function analyticsResult[\s\S]*?\n}/)?.[0] || '', /error\.message/);
  assert.match(browserViewManager, /preload: undefined/);
  assert.match(browserPopupManager, /preload: undefined/);
  assert.doesNotMatch(browserViewManager, /executeJavaScript[^\n]*analytics/i);
  assert.match(browserBridgePolicy, /value\[0\] === 'analytics'/);
  assert.match(tuiReleaseBuilder, /["']analytics["']/);
  assert.match(runtimeContract, /RUNTIME_SOURCE_DIRECTORIES[^\n]*'analytics'/);
  assert.match(runtimeContract, /analytics\/events\.v1\.json/);
  assert.ok(rootPackage.files.includes("analytics"));
  const desktopPackage = JSON.parse(await source("desktop/package.json"));
  for (const packageManifest of [rootPackage, desktopPackage]) {
    assert.equal(Object.keys(packageManifest.dependencies || {}).some((name) => name.startsWith("posthog")), false, "analytics must remain zero-dependency");
  }
  assert.match(analyticsClient, /refreshGeneration = this\.cancellationGeneration[\s\S]*refreshGeneration !== this\.cancellationGeneration\) return/);
  assert.doesNotMatch(analyticsClient, /console\.|electron-log|Authorization|Bearer/);
  assert.doesNotMatch(cliSessionStore, /analytics\/client|captureCliEvent/);
  assert.doesNotMatch(agentJournal, /analytics\/client|captureCliEvent/);
  assert.doesNotMatch(desktopPersistence, /analytics\/client|captureAnalytics/);

  const rendererFiles = await gitFilesUnder("desktop/src/renderer");
  const rendererText = (await Promise.all(rendererFiles.map(source))).join("\n");
  for (const credentialName of ["ZYRA_POSTHOG_PROJECT_KEY", "POSTHOG_PERSONAL_API_KEY", "ZYRA_POSTHOG_HOST"]) {
    assert.equal(rendererText.includes(credentialName), false, `${credentialName} must stay out of renderer source`);
  }
  const trackedTextFiles = await gitFilesUnder("");
  const hardcodedKeyPattern = /\b(?:phc|phx)_[A-Za-z0-9_-]{40,}\b/g;
  for (const file of trackedTextFiles.filter((entry) => !entry.endsWith("package-lock.json") && !entry.endsWith("bun.lock"))) {
    const text = await source(file).catch(() => "");
    const hardcodedKeys = text.match(hardcodedKeyPattern) || [];
    if (file === "src/analytics/release-config.mjs") {
      assert.deepEqual(hardcodedKeys, [BUNDLED_RELEASE_ANALYTICS_CONFIG.projectToken], "only the public release project token may be bundled");
    } else {
      assert.equal(hardcodedKeys.length, 0, `hardcoded PostHog key in ${file}`);
    }
  }
}

async function source(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

async function gitFilesUnder(prefix) {
  const { execFile } = await import("node:child_process");
  const output = await new Promise((resolve, reject) => execFile("git", ["ls-files", "--cached", "--others", "--exclude-standard", prefix || "."], { cwd: root, encoding: "utf8" }, (error, stdout) => error ? reject(error) : resolve(stdout)));
  return String(output).split(/\r?\n/).filter(Boolean).filter((file) => !/\.(png|jpe?g|gif|webp|ico|icns|zip|sqlite|lockb|woff2?)$/i.test(file));
}
