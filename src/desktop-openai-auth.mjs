import {
  chooseVerifiedApiModel,
  configureOpenAIApiKey,
  removeZyraAuthMethod,
  verifyOpenAIApiKey,
} from "./auth-methods.mjs";
import { loginOpenAICodexAuth } from "./openai-codex-login.mjs";
export { getChatGptAccounts, updateChatGptAccounts } from './chatgpt-pool-service.mjs';
import { createZyraCredentialAuthReader, createZyraCredentialAuthStorage } from "./zyra-auth-store.mjs";

export async function loginZyraAuth(provider = "openai-codex", options = {}) {
  if (provider !== "openai-codex") {
    throw new Error(`Native OpenAI sign-in does not support provider ${provider}.`);
  }
  const authStorage = options.authStorage ?? await createZyraCredentialAuthStorage(options);
  const signInMethod = options.signInMethod ?? "browser";
  if (signInMethod === "browser" && typeof options.onAuth !== "function") {
    throw new TypeError("Native ChatGPT sign-in needs a callback to open its browser link.");
  }
  if (signInMethod === "device-code" && typeof options.onDeviceCode !== "function") {
    throw new TypeError("Native ChatGPT sign-in needs a callback to display its device code.");
  }
  await loginOpenAICodexAuth(authStorage, {
    ...options,
    clientId: options.oauthClientId ?? options.clientId,
    onAuth: options.onAuth,
    onDeviceCode: options.onDeviceCode,
    onProgress: options.onProgress,
  });
  return { provider, status: authStorage.getAuthStatus(provider) };
}

export async function getZyraAuthStatus(provider = "openai-codex", options = {}) {
  const authStorage = options.authStorage ?? await createZyraCredentialAuthReader(options);
  return { provider, status: authStorage.getAuthStatus(provider) };
}

export async function configureZyraOpenAIApiKey(apiKey, options = {}) {
  const authStorage = options.authStorage ?? await createZyraCredentialAuthStorage(options);
  return withVerifiedApiModel(await configureOpenAIApiKey(authStorage, apiKey, options));
}

export async function verifyZyraOpenAIApiAuth(options = {}) {
  const authStorage = options.authStorage ?? await createZyraCredentialAuthReader(options);
  if (!authStorage.hasAuth?.("openai")) throw new Error("OpenAI API is not connected.");
  const key = await authStorage.getApiKey("openai");
  return withVerifiedApiModel(await verifyOpenAIApiKey(key, options));
}

function withVerifiedApiModel(verification) {
  return { ...verification, model: chooseVerifiedApiModel(verification) };
}

export async function removeZyraAuth(method, options = {}) {
  const authStorage = options.authStorage ?? await createZyraCredentialAuthStorage(options);
  return await removeZyraAuthMethod(authStorage, method);
}
