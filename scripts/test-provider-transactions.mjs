import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { commitProviderConnection, recoverProviderTransaction, withProviderStoreLock } from "../src/provider-transactions.mjs";
import { readProviderConnections } from "../src/provider-connections.mjs";
const root = await mkdtemp(path.join(os.tmpdir(), "zyra-provider-transaction-"));
const file = path.join(root, "providers.json");
const keys = new Map();
const runtime = { authStorage: { loginApiKey: async (id, key) => keys.set(id, { type: "api_key", key }), logout: async id => keys.delete(id), get: id => keys.get(id) } };
const target = id => ({ label: id, model: `${id}/fixture`, config: { models: [{ id: "fixture" }] } });
const connect = (provider, options = {}) => commitProviderConnection(file, runtime, { provider, operation: "connect", apiKey: "synthetic-key", target: target(provider) }, { readConfig: readProviderConnections, ...options });
try {
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
  console.log("Provider transactions: credential-only crash, metadata failure, disconnect recovery, secret-free journal and cross-process exclusion passed");
} finally { await rm(root, { recursive: true, force: true }); }
