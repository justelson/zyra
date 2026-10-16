import lockfile from "proper-lockfile";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

async function replaceProviderFile(temporary, file) {
  for (let attempt = 0; ; attempt++) {
    try { await rename(temporary, file); return; }
    catch (error) {
      // Windows readers/scanners can briefly deny replacement despite our writer
      // lock. Retry the same atomic rename; never delete or overwrite the old file.
      if (process.platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes(error.code) || attempt >= 10) throw error;
      await delay(Math.min(50 * (attempt + 1), 250));
    }
  }
}

const digest = (value) => createHash("sha256").update(value).digest("hex");
export async function writeProviderJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 }); await replaceProviderFile(temporary, file); }
  finally { await rm(temporary, { force: true }).catch(() => {}); }
}

/** Shared file lock for provider metadata and credential transactions. */
export async function withProviderStoreLock(file, action, { waitMs = 5000 } = {}) {
  await mkdir(path.dirname(file), { recursive: true });
  const release = await lockfile.lock(file, {
    realpath: false, stale: 30_000, update: 5_000,
    retries: { retries: Math.ceil(waitMs / 100), factor: 1, minTimeout: 100, maxTimeout: 100 },
  }).catch(error => {
    if (error.code === "ELOCKED") throw new Error("Another Zyra window is updating provider connections. Try again shortly.");
    throw error;
  });
  try { return await action(); } finally { await release(); }
}

async function recoverLocked(file, runtime, readConfig) {
  const authStorage = runtime?.authStorage ?? runtime;
  const journalFile = `${file}.pending`;
  if (!existsSync(journalFile)) return;
  const journal = JSON.parse(await readFile(journalFile, "utf8"));
  if (journal.version !== 1 || !/^(opencode|anthropic|opencode-harness|custom-[a-z0-9-]+)$/.test(journal.provider) || !["connect", "disconnect"].includes(journal.operation)) throw new Error("Provider recovery metadata is invalid.");
  if (journal.operation === "connect" && (!journal.target || typeof journal.target.label !== "string"
    || typeof journal.target.model !== "string" || !journal.target.model.startsWith(`${journal.provider}/`)
    || !Array.isArray(journal.target.config?.models) || !/^[a-f0-9]{64}$/.test(journal.keyDigest))) throw new Error("Provider recovery metadata is invalid.");
  const connections = readConfig(file);
  if (journal.operation === "disconnect") {
    await authStorage.logout(journal.provider);
    delete connections[journal.provider];
  } else {
    const credential = authStorage.get(journal.provider);
    if (credential?.type !== "api_key" || digest(String(credential.key)) !== journal.keyDigest) {
      await rm(journalFile, { force: true });
      if (journal.phase === "credential-written") throw new Error("The provider key changed during recovery. Reconnect this provider.");
      return;
    }
    connections[journal.provider] = journal.target;
  }
  await writeProviderJson(file, connections);
  await rm(journalFile, { force: true });
}

export async function recoverProviderTransaction(file, runtime, readConfig) {
  if (existsSync(`${file}.pending`)) await withProviderStoreLock(file, () => recoverLocked(file, runtime, readConfig));
}
export async function commitProviderConnection(file, runtime, transaction, { readConfig, afterAuth, writeMetadata = writeProviderJson } = {}) {
  const authStorage = runtime?.authStorage ?? runtime;
  return withProviderStoreLock(file, async () => {
    await recoverLocked(file, runtime, readConfig);
    const connections = readConfig(file);
    const { provider, operation, target, apiKey } = transaction;
    if (operation === "disconnect" && !Object.hasOwn(connections, provider)) throw new Error("Saved provider connection not found.");
    const journalFile = `${file}.pending`;
    const journal = { version: 1, operation, provider, target, keyDigest: apiKey ? digest(apiKey) : undefined, phase: "intent" };
    await writeProviderJson(journalFile, journal);
    if (operation === "connect") await authStorage.loginApiKey(provider, apiKey);
    else await authStorage.logout(provider);
    await afterAuth?.();
    await writeProviderJson(journalFile, { ...journal, phase: "credential-written" });
    if (operation === "connect") connections[provider] = target;
    else delete connections[provider];
    await writeMetadata(file, connections);
    await rm(journalFile, { force: true });
  });
}
