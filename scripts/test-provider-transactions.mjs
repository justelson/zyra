import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { commitProviderConnection, recoverProviderTransaction, withProviderStoreLock } from "../src/provider-transactions.mjs";
import { readProviderConnections } from "../src/provider-connections.mjs";
import { ZyraCredentialStore } from "../src/zyra-auth-store.mjs";
import { ChatGptAccountPool } from "../src/chatgpt-account-pool.mjs";
const root = await mkdtemp(path.join(os.tmpdir(), "zyra-provider-transaction-"));
const file = path.join(root, "providers.json");
const keys = new Map();
const runtime = { authStorage: { loginApiKey: async (id, key) => keys.set(id, { type: "api_key", key }), logout: async id => keys.delete(id), get: id => keys.get(id) } };
const target = id => ({ label: id, model: `${id}/fixture`, config: { models: [{ id: "fixture" }] } });
const connect = (provider, options = {}) => commitProviderConnection(file, runtime, { provider, operation: "connect", apiKey: "synthetic-key", target: target(provider) }, { readConfig: readProviderConnections, ...options });
async function holdWindowsFile(file) {
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "$handle = [System.IO.File]::Open($env:ZYRA_LOCK_TEST_PATH, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite); try { [Console]::Out.WriteLine('locked'); [Console]::Out.Flush(); [Console]::In.ReadLine() | Out-Null } finally { $handle.Dispose() }"], {
    windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ZYRA_LOCK_TEST_PATH: file },
  });
  let output = "", error = "";
  child.stderr.on("data", chunk => error += chunk);
  const completion = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(Error(error || `File holder exited ${code}`)));
  });
  completion.catch(() => {});
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("File holder did not start")), 30_000);
      child.stdout.on("data", chunk => { output += chunk; if (output.includes("locked")) { clearTimeout(timer); resolve(); } });
      completion.then(() => { clearTimeout(timer); reject(Error("File holder exited before locking")); }, cause => { clearTimeout(timer); reject(cause); });
    });
  } catch (error) { child.kill(); throw error; }
  let released = false;
  return async () => { if (!released) { released = true; child.stdin.end("release\n"); } await completion; };
}
try {
  if (process.platform === "win32") {
    const authFile = path.join(root, "auth.json");
    const credentials = new ZyraCredentialStore({ authPath: authFile });
    await credentials.modify("openai", async () => ({ type: "api_key", key: "synthetic-old" }));
    const release = await holdWindowsFile(authFile);
    let releaseTimer;
    try {
      const update = credentials.modify("openai", async () => ({ type: "api_key", key: "synthetic-new" })).then(() => null, error => error);
      releaseTimer = setTimeout(() => { void release(); }, 250);
      const failure = await update;
      assert.equal(failure, null, "a temporary Windows read handle must not fail a credential update");
      assert.equal(credentials.read("openai").key, "synthetic-new");
      assert.ok(!(await readdir(root)).some(name => name.endsWith(".tmp")));
    } finally { clearTimeout(releaseTimer); await release(); }
    // A thread reserves its account in this same file before calling the model.
    await credentials.modify("openai-codex", async () => ({ type: "oauth", access: "synthetic-access", refresh: "synthetic-refresh", expires: Date.now() + 3_600_000, pool: { id: "fixture-account" } }));
    const pool = new ChatGptAccountPool(credentials);
    const releaseAccountLock = await holdWindowsFile(authFile);
    let accountTimer;
    try {
      const acquisition = pool.acquire("gpt-fixture").then(value => ({ value }), error => ({ error }));
      accountTimer = setTimeout(() => { void releaseAccountLock(); }, 250);
      const result = await acquisition;
      assert.equal(result.error, undefined, "a thread's account reservation recovers from a brief read lock");
      assert.equal(result.value.id, "fixture-account");
      assert.equal(Object.keys(credentials.read("openai-codex").pool.leases).length, 1);
      await result.value.release();
      assert.deepEqual(credentials.read("openai-codex").pool.leases, {});
    } finally { clearTimeout(accountTimer); await releaseAccountLock(); }
    const releasePermanentLock = await holdWindowsFile(authFile);
    const original = await readFile(authFile, "utf8");
    try {
      const startedAt = performance.now();
      await assert.rejects(credentials.modify("openai", async () => ({ type: "api_key", key: "synthetic-never-committed" })), { code: "EPERM" });
      assert.ok(performance.now() - startedAt < 10_000, "persistent locks fail within a bounded time");
      assert.equal(await readFile(authFile, "utf8"), original, "failed replacement preserves the complete original file");
      assert.ok(!(await readdir(root)).some(name => name.endsWith(".tmp")), "failed replacement removes its temporary file");
      assert.ok(!existsSync(`${authFile}.lock`), "failed replacement releases the writer lock");
    } finally { await releasePermanentLock(); }
    await credentials.modify("openai", async () => ({ type: "api_key", key: "synthetic-recovered" }));
    assert.equal(credentials.read("openai").key, "synthetic-recovered", "later updates recover after the lock is released");
  }
  await assert.rejects(connect("anthropic", { writeMetadata: async () => { throw Error("disk failure"); } }), /disk failure/);
  const journal = await readFile(`${file}.pending`, "utf8");
  assert.ok(!journal.includes("synthetic-key"));
  await recoverProviderTransaction(file, runtime, readProviderConnections);
  assert.equal(readProviderConnections(file).anthropic.model, "anthropic/fixture");
  assert.ok(!existsSync(`${file}.pending`));
  await assert.rejects(connect("opencode", { afterAuth: () => { throw Error("process exit"); } }), /process exit/);
  await recoverProviderTransaction(file, runtime, readProviderConnections);
  assert.ok(readProviderConnections(file).opencode);
  await assert.rejects(commitProviderConnection(file, runtime, { provider: "anthropic", operation: "disconnect" }, { readConfig: readProviderConnections, afterAuth: () => { throw Error("process exit"); } }));
  await recoverProviderTransaction(file, runtime, readProviderConnections);
  assert.ok(!readProviderConnections(file).anthropic && !keys.has("anthropic"));
  await Promise.all([connect("custom-a"), connect("custom-b")]);
  assert.deepEqual(Object.keys(readProviderConnections(file)).sort(), ["custom-a", "custom-b", "opencode"]);
  // An independent process must wait for the parent's critical section.
  const worker = path.join(root, "lock.mjs");
  const moduleUrl = new URL("../src/provider-transactions.mjs", import.meta.url).href;
  await writeFile(worker, `import { withProviderStoreLock } from ${JSON.stringify(moduleUrl)}; await withProviderStoreLock(process.argv[2], async () => console.log('acquired'));`);
  let output = "", completion;
  await withProviderStoreLock(file, async () => {
    const child = spawn(process.execPath, [worker, file], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", chunk => output += chunk); let error = ""; child.stderr.on("data", chunk => error += chunk);
    completion = new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", code => code === 0 ? resolve() : reject(Error(error))); });
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(output, "", "second process cannot enter while lock is owned");
  });
  await completion; assert.match(output, /acquired/); assert.ok(!existsSync(`${file}.lock`));
  console.log(`Provider transactions: credential-only crash, metadata failure, disconnect recovery, secret-free journal and cross-process exclusion passed${process.platform === "win32" ? "; Windows transient/persistent file locks and thread account reservation passed" : ""}`);
} finally { await rm(root, { recursive: true, force: true }); }
