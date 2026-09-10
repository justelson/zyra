import { registerSavedProviders } from "./provider-connections.mjs";
let piPackagePromise;

async function loadPiPackage() {
  piPackagePromise ??= import("@earendil-works/pi-coding-agent");
  return piPackagePromise;
}

export async function createZyraPiRuntime(options = {}) {
  const { ModelRegistry, ModelRuntime, readStoredCredential } = await loadPiPackage();
  const modelRuntime = options.modelRuntime ?? await ModelRuntime.create({
    ...(options.authPath ? { authPath: options.authPath } : {}),
    ...(options.modelsPath !== undefined ? { modelsPath: options.modelsPath } : {}),
    allowModelNetwork: options.allowModelNetwork === true,
    ...(options.refreshOnCreate !== undefined
      ? { refreshOnCreate: options.refreshOnCreate === true }
      : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const authStorage = createAuthStorageFacade(modelRuntime, readStoredCredential, options);
  const modelRegistry = new ModelRegistry(modelRuntime);
  if (!options.modelRuntime && options.loadSavedProviders !== false) registerSavedProviders(modelRegistry, options.providerConfigPath);

  // Zyra extensions and older internal call sites use this property as the
  // narrow auth boundary. Pi no longer exposes it on ModelRegistry itself.
  Object.defineProperty(modelRegistry, "authStorage", {
    configurable: true,
    enumerable: false,
    value: authStorage,
  });

  return { authStorage, modelRegistry, modelRuntime };
}

export async function createZyraAuthStorage(options = {}) {
  return (await createZyraPiRuntime(options)).authStorage;
}

function createAuthStorageFacade(modelRuntime, readStoredCredential, options) {
  const authPath = options.authPath;

  return {
    modelRuntime,

    get(provider) {
      return readStoredCredential(provider, authPath);
    },

    getAuthStatus(provider) {
      return modelRuntime.getProviderAuthStatus(provider);
    },

    hasAuth(provider) {
      return modelRuntime.hasConfiguredAuth(provider);
    },

    async getApiKey(provider, authOptions = {}) {
      const result = await modelRuntime.getAuth(provider, {
        ...(authOptions.signal ? { signal: authOptions.signal } : {}),
      });
      return result?.auth?.apiKey;
    },

    async login(provider, interaction) {
      return modelRuntime.login(provider, "oauth", normalizeAuthInteraction(interaction));
    },

    async loginApiKey(provider, apiKey, authOptions = {}) {
      const key = String(apiKey ?? "");
      return modelRuntime.login(provider, "api_key", {
        signal: authOptions.signal,
        prompt: async () => key,
        notify: () => undefined,
      });
    },

    async set(provider, credential, authOptions = {}) {
      if (credential?.type !== "api_key") {
        throw new Error(`Zyra cannot directly store ${credential?.type ?? "unknown"} credentials.`);
      }
      return this.loginApiKey(provider, credential.key, authOptions);
    },

    async logout(provider, authOptions = {}) {
      await modelRuntime.logout(provider, authOptions);
    },

    async remove(provider, authOptions = {}) {
      await modelRuntime.logout(provider, authOptions);
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
