import { registerSavedProviders, readProviderConnections, providerConfigPath } from "./provider-connections.mjs";
import { recoverProviderTransaction } from "./provider-transactions.mjs";
import { getChatGptAccountPool } from './chatgpt-account-pool.mjs';
import { createChatGptRequestCredentials, installChatGptAccountRouting } from './chatgpt-account-runtime.mjs';
import { loginOpenAICodexAuth } from './openai-codex-login.mjs';
import { syncOpenAIModelCatalog, applyOpenAIModelCatalog } from "./openai-model-catalog.mjs";
import {
  getZyraCredentialAuthStatus,
  migrateLegacyPiCredentials,
  createZyraCredentialAuthStorage,
  resolveZyraApiKeyCredential,
  resolveZyraAuthPath,
  ZyraCredentialStore,
} from "./zyra-auth-store.mjs";
let runtimeEnginePromise;

export { resolveZyraAuthPath };

async function loadRuntimeEngine() {
  runtimeEnginePromise ??= Promise.all([
    import("./runtime/engine/src/core/model-registry.js"),
    import("./runtime/engine/src/core/model-runtime.js"),
  ]).then(([registry, runtime]) => ({ ...registry, ...runtime }));
  return runtimeEnginePromise;
}

export async function createZyraRuntime(options = {}) {
  const { ModelRegistry, ModelRuntime } = await loadRuntimeEngine();
  const authPath = options.authPath ?? resolveZyraAuthPath(options);
  const credentials = options.credentialStore ?? new ZyraCredentialStore({ authPath });
  const accountPool = getChatGptAccountPool(credentials, options);
  if (options.refreshAccountUsage !== false && !accountPool.refreshUsageInBackground) {
    let lastCheck = 0, pending = false;
    accountPool.refreshUsageInBackground = () => {
      if (pending || Date.now() - lastCheck < 60_000) return;
      pending = true;
      lastCheck = Date.now();
      import('./chatgpt-pool-service.mjs').then(module => module.getChatGptAccounts({ ...options, credentialStore: credentials, refreshUsage: true, usageMaxAgeMs: 60_000 }))
        .catch(() => {}).finally(() => { pending = false; });
    };
  }
  const requestCredentials = createChatGptRequestCredentials(credentials);
  const zyraAuthStorage = await createZyraCredentialAuthStorage({
    credentialStore: credentials,
    migrateLegacy: false,
    env: options.env,
    fetchImpl: options.fetchImpl ?? options.fetch,
    authBaseUrl: options.authBaseUrl,
    clientId: options.oauthClientId,
  });
  const modelRuntime = options.modelRuntime ?? await ModelRuntime.create({
    authPath,
    credentials: requestCredentials.credentials,
    ...(options.modelsPath !== undefined ? { modelsPath: options.modelsPath } : {}),
    allowModelNetwork: options.allowModelNetwork === true,
    ...(options.refreshOnCreate !== undefined
      ? { refreshOnCreate: options.refreshOnCreate === true }
      : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!options.modelRuntime) installChatGptAccountRouting(modelRuntime, accountPool, requestCredentials.context);
  if (!options.modelRuntime && options.confirmLegacyPiCredentialMigration === true) {
    const migratedProviders = await migrateLegacyPiCredentials(credentials, authPath, options.legacyPiAuthPath, {
      signal: options.signal,
      confirmLegacyPiCredentialMigration: true,
    });
    if (migratedProviders.length > 0) {
      await modelRuntime.refresh({ allowNetwork: false, providers: migratedProviders, signal: options.signal });
    }
  }
  const initialCredentialSnapshot = typeof credentials.snapshot === "function"
    ? await credentials.snapshot({ signal: options.signal })
    : {};
  const authStorage = createAuthStorageFacade(modelRuntime, credentials, initialCredentialSnapshot, zyraAuthStorage);
  const modelRegistry = new ModelRegistry(modelRuntime);
  if (!options.modelRuntime && options.loadSavedProviders !== false) {
    await recoverProviderTransaction(options.providerConfigPath || providerConfigPath(), { authStorage, modelRegistry }, readProviderConnections);
    registerSavedProviders(modelRegistry, options.providerConfigPath, { authStorage, harness: options.harness });
  }

  // Zyra extensions and older internal call sites use this property as the
  // narrow auth boundary. Pi no longer exposes it on ModelRegistry itself.
  Object.defineProperty(modelRegistry, "authStorage", {
    configurable: true,
    enumerable: false,
    value: authStorage,
  });

  if (options.loadOpenAICatalog !== false) {
    modelRegistry.zyraOpenAIModelCatalogOptions = { authPath };
    const catalog = await syncOpenAIModelCatalog({ ...options, authPath, authStorage: zyraAuthStorage, cacheOnly: true });
    await applyOpenAIModelCatalog(modelRegistry, catalog);
  }

  return { authStorage, modelRegistry, modelRuntime };
}

export async function createZyraAuthStorage(options = {}) {
  return (await createZyraRuntime(options)).authStorage;
}

function createAuthStorageFacade(modelRuntime, credentials, initialCredentials = {}, zyraAuthStorage) {
  const credentialSnapshot = new Map(Object.entries(initialCredentials));
  const refreshAuthProvider = async (provider, authOptions = {}) => {
    const result = await modelRuntime.refresh({ allowNetwork: false, providers: [provider], signal: authOptions.signal });
    if (!result?.errors?.get?.(provider)) credentialSnapshot.set(provider, credentials.read(provider));
    return result;
  };
  return {
    modelRuntime,

    get(provider) {
      return credentials.read(provider);
    },

    getAuthStatus(provider) {
      if (credentialSnapshot.has(provider)) {
        const storedStatus = getZyraCredentialAuthStatus(credentialSnapshot.get(provider));
        if (storedStatus?.configured) return storedStatus;
      }
      return modelRuntime.getProviderAuthStatus(provider);
    },

    hasAuth(provider) {
      if (credentialSnapshot.has(provider) && getZyraCredentialAuthStatus(credentialSnapshot.get(provider))?.configured) return true;
      return modelRuntime.hasConfiguredAuth(provider);
    },

    async getApiKey(provider, authOptions = {}) {
      const zyraApiKey = await zyraAuthStorage.getApiKey(provider, authOptions);
      if (zyraApiKey !== undefined) {
        credentialSnapshot.set(provider, credentials.read(provider));
        return zyraApiKey;
      }
      const credential = credentials.read(provider);
      const storedApiKey = resolveZyraApiKeyCredential(credential, authOptions.env ?? process.env);
      if (storedApiKey !== undefined) return storedApiKey;
      const result = await modelRuntime.getAuth(provider, {
        ...(authOptions.signal ? { signal: authOptions.signal } : {}),
      });
      return result?.auth?.apiKey;
    },

    async login(provider, interaction) {
      if (provider === 'openai-codex') {
        const result = await loginOpenAICodexAuth(zyraAuthStorage, interaction);
        await refreshAuthProvider(provider);
        return result;
      }
      const result = await modelRuntime.login(provider, "oauth", normalizeAuthInteraction(interaction));
      credentialSnapshot.set(provider, credentials.read(provider));
      return result;
    },

    async loginApiKey(provider, apiKey, authOptions = {}) {
      const key = String(apiKey ?? "");
      if (!key) throw new Error("API key cannot be empty.");
      const credential = await credentials.modify(provider, async () => ({ type: "api_key", key }), {
        signal: authOptions.signal,
      });
      credentialSnapshot.set(provider, credential);
      await refreshAuthProvider(provider, authOptions);
      return credential;
    },

    async set(provider, credential, authOptions = {}) {
      if (credential?.type !== "api_key") {
        throw new Error(`Zyra cannot directly store ${credential?.type ?? "unknown"} credentials.`);
      }
      return this.loginApiKey(provider, credential.key, authOptions);
    },

    async logout(provider, authOptions = {}) {
      await zyraAuthStorage.logout(provider, authOptions);
      credentialSnapshot.set(provider, undefined);
      await refreshAuthProvider(provider, authOptions);
    },

    refreshAuthProvider,

    async remove(provider, authOptions = {}) {
      return this.logout(provider, authOptions);
    },
  };
}

function normalizeAuthInteraction(interaction = {}) {
  if (typeof interaction.prompt === "function" && typeof interaction.notify === "function") {
    return interaction;
  }

  return {
    signal: interaction.signal,
    prompt: async (prompt) => {
      if (prompt.type === "select") return interaction.onSelect(prompt);
      if (prompt.type === "manual_code") return interaction.onManualCodeInput(prompt);
      return interaction.onPrompt(prompt);
    },
    notify: (event) => {
      if (event.type === "auth_url") interaction.onAuth(event);
      else if (event.type === "device_code") interaction.onDeviceCode(event);
      else if (event.type === "progress" || event.type === "info") {
        interaction.onProgress(event.message);
      }
    },
  };
}
