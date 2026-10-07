import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { withProviderStoreLock, writeProviderJson } from "./provider-transactions.mjs";
import {
  openAICodexCredentialNeedsRefresh,
  refreshOpenAICodexCredential,
} from "./openai-codex-oauth.mjs";
import { saveChatGptAccount, removeAllChatGptAccounts } from './chatgpt-account-pool.mjs';

const LEGACY_PI_AUTH_PROVIDERS = Object.freeze(["openai-codex", "openai"]);
const LEGACY_PI_AUTH_MIGRATION_MARKER = "pi-auth-migrated-v1";

export function resolveZyraAuthPath(options = {}) {
  const stateDirectory = typeof options.stateDirectory === "string" && options.stateDirectory.trim()
    ? options.stateDirectory
    : typeof process.env.ZYRA_STATE_DIR === "string" && process.env.ZYRA_STATE_DIR.trim()
      ? process.env.ZYRA_STATE_DIR
      : path.join(homedir(), ".zyra");
  return path.join(path.resolve(stateDirectory), "credentials", "auth.json");
}

export class ZyraCredentialStore {
  constructor(options = {}) {
    if (typeof options.authPath !== "string" || !options.authPath.trim()) {
      throw new TypeError("A Zyra credential file path is required.");
    }
    this.authPath = path.resolve(options.authPath);
  }

  read(provider, options = {}) {
    assertProvider(provider);
    throwIfAborted(options.signal);
    return readCredentialFile(this.authPath, provider);
  }

  async snapshot(options = {}) {
    throwIfAborted(options.signal);
    return clone(await readCredentialFileAsync(this.authPath));
  }

  async modify(provider, update, options = {}) {
    assertProvider(provider);
    if (typeof update !== "function") throw new TypeError("A credential update function is required.");
    throwIfAborted(options.signal);
    await mkdir(path.dirname(this.authPath), { recursive: true, mode: 0o700 });
    return withProviderStoreLock(this.authPath, async () => {
      throwIfAborted(options.signal);
      const values = await readCredentialFileAsync(this.authPath);
      const current = clone(values[provider]);
      const next = await update(current);
      throwIfAborted(options.signal);
      if (next === undefined) delete values[provider];
      else values[provider] = normalizeCredential(next);
      await writeProviderJson(this.authPath, values);
      return clone(values[provider]);
    }, { waitMs: options.waitMs });
  }

  async delete(provider, options = {}) {
    return this.modify(provider, async () => undefined, options);
  }

  async modifyAll(update, options = {}) {
    throwIfAborted(options.signal);
    await mkdir(path.dirname(this.authPath), { recursive: true, mode: 0o700 });
    return withProviderStoreLock(this.authPath, async () => {
      throwIfAborted(options.signal);
      const next = await update(clone(await readCredentialFileAsync(this.authPath)));
      for (const [provider, credential] of Object.entries(next)) { assertProvider(provider); normalizeCredential(credential); }
      throwIfAborted(options.signal);
      await writeProviderJson(this.authPath, next);
      return clone(next);
    }, { waitMs: options.waitMs });
  }

  async list(options = {}) {
    throwIfAborted(options.signal);
    const values = await readCredentialFileAsync(this.authPath);
    return Object.entries(values).map(([providerId, credential]) => ({
      providerId,
      type: credential.type,
    }));
  }
}

export async function createZyraCredentialAuthReader(options = {}) {
  const credentials = await resolveCredentialStore(options);
  const snapshot = await credentials.snapshot({ signal: options.signal });
  const env = options.env ?? process.env;
  const statusFor = (provider, providerEnv = env) => {
    const stored = getZyraCredentialAuthStatus(snapshot[provider], providerEnv);
    if (stored) return stored;
    if (provider === "openai" && typeof providerEnv?.OPENAI_API_KEY === "string" && providerEnv.OPENAI_API_KEY) {
      return { configured: true, source: "environment" };
    }
    return { configured: false, source: "none" };
  };
  return {
    get(provider) {
      assertProvider(provider);
      throwIfAborted(options.signal);
      return clone(snapshot[provider]);
    },
    getAuthStatus(provider) {
      assertProvider(provider);
      return statusFor(provider);
    },
    hasAuth(provider) {
      return statusFor(provider).configured;
    },
    async getApiKey(provider, authOptions = {}) {
      assertProvider(provider);
      throwIfAborted(authOptions.signal ?? options.signal);
      const providerEnv = authOptions.env ?? env;
      return resolveZyraApiKeyCredential(snapshot[provider], providerEnv)
        ?? (provider === "openai" ? providerEnv?.OPENAI_API_KEY : undefined);
    },
  };
}

export async function createZyraCredentialAuthStorage(options = {}) {
  const credentials = await resolveCredentialStore(options);
  const env = options.env ?? process.env;
  const statusFor = (provider, providerEnv = env) => {
    const status = getZyraCredentialAuthStatus(credentials.read(provider, { signal: options.signal }), providerEnv);
    if (status) return status;
    if (provider === "openai" && typeof providerEnv?.OPENAI_API_KEY === "string" && providerEnv.OPENAI_API_KEY) {
      return { configured: true, source: "environment" };
    }
    return { configured: false, source: "none" };
  };
  return {
    get(provider, authOptions = {}) {
      return credentials.read(provider, { signal: authOptions.signal ?? options.signal });
    },
    getAuthStatus(provider) {
      assertProvider(provider);
      return statusFor(provider);
    },
    hasAuth(provider) {
      assertProvider(provider);
      return statusFor(provider).configured;
    },
    async getApiKey(provider, authOptions = {}) {
      assertProvider(provider);
      const providerEnv = authOptions.env ?? env;
      const signal = authOptions.signal ?? options.signal;
      throwIfAborted(signal);
      let credential = credentials.read(provider, { signal });
      if (provider === "openai-codex" && credential?.type === "oauth"
        && openAICodexCredentialNeedsRefresh(credential, {
          now: authOptions.now ?? options.now,
          refreshWindowMs: authOptions.refreshWindowMs ?? options.refreshWindowMs,
        })) {
        const expectedRefreshToken = credential.refresh;
        credential = await credentials.modify(provider, async (current) => {
          throwIfAborted(signal);
          if (current?.type !== "oauth") return current;
          if (current.refresh !== expectedRefreshToken
            && !openAICodexCredentialNeedsRefresh(current, {
              now: authOptions.now ?? options.now,
              refreshWindowMs: authOptions.refreshWindowMs ?? options.refreshWindowMs,
            })) return current;
          if (!openAICodexCredentialNeedsRefresh(current, {
            now: authOptions.now ?? options.now,
            refreshWindowMs: authOptions.refreshWindowMs ?? options.refreshWindowMs,
          })) return current;
          return refreshOpenAICodexCredential(current, {
            fetchImpl: authOptions.fetchImpl ?? authOptions.fetch ?? options.fetchImpl ?? options.fetch,
            authBaseUrl: authOptions.authBaseUrl ?? options.authBaseUrl,
            clientId: authOptions.clientId ?? options.clientId,
            env: authOptions.env ?? env,
            timeoutMs: authOptions.timeoutMs ?? options.timeoutMs,
            now: authOptions.now ?? options.now,
          });
        });
      }
      if (provider === "openai-codex" && credential?.type === "oauth") return credential.access;
      return resolveZyraApiKeyCredential(credential, providerEnv)
        ?? (provider === "openai" ? providerEnv?.OPENAI_API_KEY : undefined);
    },
    async loginApiKey(provider, apiKey, authOptions = {}) {
      const key = String(apiKey ?? "");
      if (!key) throw new Error("API key cannot be empty.");
      return credentials.modify(provider, async () => ({ type: "api_key", key }), {
        signal: authOptions.signal ?? options.signal,
      });
    },
    async loginOAuth(provider, credential, authOptions = {}) {
      assertProvider(provider);
      if (provider !== "openai-codex" || credential?.type !== "oauth"
        || typeof credential.access !== "string" || !credential.access
        || typeof credential.refresh !== "string" || !credential.refresh
        || !Number.isFinite(Number(credential.expires))) {
        throw new TypeError("Zyra OAuth credentials are invalid for this provider.");
      }
      await saveChatGptAccount(credentials, normalizeCredential(credential), {
        signal: authOptions.signal ?? options.signal, accountId: authOptions.accountId,
      });
      return credential;
    },
    async set(provider, credential, authOptions = {}) {
      if (credential?.type === "api_key") return this.loginApiKey(provider, credential.key, authOptions);
      if (credential?.type === "oauth") return this.loginOAuth(provider, credential, authOptions);
      throw new Error(`Zyra cannot directly store ${credential?.type ?? "unknown"} credentials.`);
    },
    async logout(provider, authOptions = {}) {
      if (provider === 'openai-codex') return removeAllChatGptAccounts(credentials, { signal: authOptions.signal ?? options.signal });
      return credentials.delete(provider, { signal: authOptions.signal ?? options.signal });
    },
    async remove(provider, authOptions = {}) {
      return this.logout(provider, authOptions);
    },
  };
}

export async function migrateLegacyPiCredentials(credentials, authPath, legacyAuthPath, options = {}) {
  if (options.confirmLegacyPiCredentialMigration !== true) {
    throw new Error("Legacy Pi credentials require explicit migration confirmation.");
  }
  const resolvedAuthPath = path.resolve(authPath);
  const credentialsDirectory = path.dirname(resolvedAuthPath);
  const markerPath = path.join(credentialsDirectory, LEGACY_PI_AUTH_MIGRATION_MARKER);
  return withProviderStoreLock(markerPath, async () => {
    throwIfAborted(options.signal);
    if (existsSync(markerPath)) return readLegacyMigrationProviders(markerPath);
    const sourcePath = legacyAuthPath ?? path.join(
      process.env.PI_CODING_AGENT_DIR || path.join(homedir(), ".pi", "agent"),
      "auth.json",
    );
    const copiedProviders = [];
    for (const provider of LEGACY_PI_AUTH_PROVIDERS) {
      const existing = await credentials.read(provider, { signal: options.signal });
      if (existing) continue;
      const legacy = readZyraStoredCredential(provider, sourcePath);
      if (!isMigratablePiCredential(legacy)) continue;
      await credentials.modify(provider, async () => structuredClone(legacy), { signal: options.signal });
      copiedProviders.push(provider);
    }
    mkdirSync(credentialsDirectory, { recursive: true, mode: 0o700 });
    writeFileSync(markerPath, JSON.stringify({ version: 1, providers: copiedProviders }), { encoding: "utf8", mode: 0o600 });
    return copiedProviders;
  });
}

export function readZyraStoredCredential(provider, authPath) {
  assertProvider(provider);
  return readCredentialFile(path.resolve(authPath), provider);
}

export function resolveZyraApiKeyCredential(credential, env = process.env) {
  if (credential?.type !== "api_key" || typeof credential.key !== "string") return undefined;
  if (!credential.key.startsWith("$")) return credential.key;
  const environmentName = credential.key.slice(1);
  const environmentValue = env?.[environmentName];
  return environmentName && typeof environmentValue === "string" && environmentValue
    ? environmentValue
    : undefined;
}

export function getZyraCredentialAuthStatus(credential, env = process.env) {
  if (credential?.type === "oauth") {
    const configured = [credential.access, credential.refresh].some((value) => typeof value === "string" && value.length > 0);
    return configured ? { configured: true, source: "stored" } : undefined;
  }
  const apiKey = resolveZyraApiKeyCredential(credential, env);
  if (typeof apiKey !== "string" || !apiKey) return undefined;
  return {
    configured: true,
    source: credential.key.startsWith("$") ? "environment" : "stored",
  };
}

async function resolveCredentialStore(options) {
  const credentials = options.credentialStore ?? new ZyraCredentialStore({
    authPath: options.authPath ?? resolveZyraAuthPath(options),
  });
  if (options.confirmLegacyPiCredentialMigration === true && typeof credentials.authPath === "string") {
    await migrateLegacyPiCredentials(credentials, credentials.authPath, options.legacyPiAuthPath, {
      signal: options.signal,
      confirmLegacyPiCredentialMigration: true,
    });
  }
  return credentials;
}

function readLegacyMigrationProviders(markerPath) {
  try {
    const marker = JSON.parse(readFileSync(markerPath, "utf8"));
    if (marker?.version !== 1 || !Array.isArray(marker.providers)) return [];
    return marker.providers.filter((provider) => LEGACY_PI_AUTH_PROVIDERS.includes(provider));
  } catch {
    return [];
  }
}

function isMigratablePiCredential(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (value.type === "oauth") {
    return typeof value.access === "string" && typeof value.refresh === "string"
      && Number.isFinite(value.expires);
  }
  return value.type === "api_key" && (typeof value.key === "string" || (value.env && typeof value.env === "object"));
}

async function readCredentialFileAsync(authPath) {
  let raw;
  try {
    raw = await readFile(authPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw new Error("Zyra credentials could not be read.", { cause: error });
  }
  return parseCredentialFile(raw);
}

function readCredentialFile(authPath, provider) {
  let raw;
  try {
    raw = readFileSync(authPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw new Error("Zyra credentials could not be read.", { cause: error });
  }
  const values = parseCredentialFile(raw);
  return clone(values[provider]);
}

function parseCredentialFile(raw) {
  let values;
  try {
    values = JSON.parse(raw);
  } catch (error) {
    throw new Error("Zyra credential file is invalid.", { cause: error });
  }
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw new Error("Zyra credential file is invalid.");
  }
  for (const credential of Object.values(values)) normalizeCredential(credential);
  return values;
}

function normalizeCredential(credential) {
  if (!credential || typeof credential !== "object" || Array.isArray(credential)
    || !["api_key", "oauth"].includes(credential.type)) {
    throw new TypeError("Zyra credential data is invalid.");
  }
  return structuredClone(credential);
}

function assertProvider(provider) {
  if (typeof provider !== "string" || !/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(provider)) {
    throw new TypeError("Credential provider id is invalid.");
  }
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Credential operation was cancelled.");
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}
