import { readRoleModels, saveRoleModel } from "./agents/role-model-preferences.mjs";
import { readDelegationPreferences, saveDelegationPreferences, delegationSettingsSnapshot } from "./agents/delegation-preferences.mjs";
import { connectHarnessProvider, connectModelProvider, disconnectHarnessProvider, disconnectModelProvider, listModelProviders } from "./provider-connections.mjs";
import { HARNESS_PROVIDER_ID, detectHarness } from "./opencode-harness.mjs";
import { parentPort } from "node:worker_threads";
import { getChatGptAccounts, updateChatGptAccounts } from './chatgpt-pool-service.mjs';
import {
  configureZyraOpenAIApiKey,
  getZyraAuthStatus,
  loginZyraAuth,
  removeZyraAuth,
  verifyZyraOpenAIApiAuth,
} from "./desktop-openai-auth.mjs";
import { waitForAutomaticBrowserCallback } from "./oauth-login-callbacks.mjs";
import {
  buildChatGptAccountStatus,
  fetchCodexResetCredits,
  resolveChatGptAccountAuth,
} from "./chatgpt-account.mjs";

if (!parentPort) throw new Error("Desktop provider worker requires a parent port.");
const activeLogins = new Map();

function messageFor(error) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "Provider connection action failed.";
}

async function execute(message, signal) {
  switch (message.operation) {
    case 'getChatGptAccounts': return getChatGptAccounts(message.options);
    case 'updateChatGptAccounts': return updateChatGptAccounts(message.input);
    case "readDelegationPreferences": return delegationSettingsSnapshot(readDelegationPreferences());
    case "saveDelegationPreferences": return delegationSettingsSnapshot(await saveDelegationPreferences(message.input));
    case "readRoleModels": return readRoleModels();
    case "saveRoleModel": return saveRoleModel(message.input);
    case "disconnectModelProvider": return message.provider === HARNESS_PROVIDER_ID
      ? disconnectHarnessProvider()
      : disconnectModelProvider(message.provider);
    case "connectModelProvider": return connectModelProvider(message.input);
    case "connectHarness": return connectHarnessProvider(message.input ?? {});
    case "detectHarness": return { detected: await detectHarness() };
    case "listModelProviders": return listModelProviders();
    case "warm":
      await Promise.all([
        getZyraAuthStatus("openai-codex"),
        getZyraAuthStatus("openai"),
      ]);
      return null;
    case "buildChatGptAccountStatus":
      return buildChatGptAccountStatus(message.provider, message.options);
    case "resolveChatGptAccountAuth":
      return resolveChatGptAccountAuth();
    case "fetchCodexResetCredits":
      return fetchCodexResetCredits();
    case "getZyraAuthStatus":
      return getZyraAuthStatus(message.provider);
    case "loginZyraAuth":
      return loginZyraAuth(message.provider, {
        signInMethod: message.signInMethod,
        accountId: message.accountId,
        signal,
        onAuth: (info) => parentPort.postMessage({ type: "auth", id: message.id, info }),
        onDeviceCode: (info) => parentPort.postMessage({ type: "deviceCode", id: message.id, info }),
        onProgress: (progress) => parentPort.postMessage({ type: "progress", id: message.id, progress }),
        onSelect: async (prompt) => {
          const choices = Array.isArray(prompt?.options) ? prompt.options : [];
          const preferred = message.signInMethod === "device-code"
            ? choices.find((choice) => /device/i.test(`${choice?.id || ""} ${choice?.label || ""}`))
            : choices.find((choice) => /browser/i.test(`${choice?.id || ""} ${choice?.label || ""}`));
          if (!preferred?.id) throw new Error(message.signInMethod === "device-code" ? "Device-code sign-in is unavailable in this provider runtime." : "Browser sign-in is unavailable in this provider runtime.");
          return preferred.id;
        },
        onPrompt: waitForAutomaticBrowserCallback,
      });
    case "configureZyraOpenAIApiKey":
      return configureZyraOpenAIApiKey(message.apiKey);
    case "verifyZyraOpenAIApiAuth":
      return verifyZyraOpenAIApiAuth();
    case "removeZyraAuth":
      return removeZyraAuth(message.method);
    default:
      throw new Error("Unsupported Desktop provider operation.");
  }
}

parentPort.on("message", async (message) => {
  if (!message || typeof message !== "object") return;
  if (message.operation === "cancelRequest") {
    const controller = activeLogins.get(message.targetId);
    if (controller) {
      const error = new Error("ChatGPT sign-in was cancelled.");
      error.code = "ZYRA_OAUTH_CANCELLED";
      controller.abort(error);
    }
    return;
  }
  if (typeof message.id !== "number") return;
  const controller = message.operation === "loginZyraAuth" ? new AbortController() : null;
  if (controller) activeLogins.set(message.id, controller);
  try {
    const result = await execute(message, controller?.signal);
    parentPort.postMessage({ type: "result", id: message.id, result });
  } catch (error) {
    parentPort.postMessage({ type: "error", id: message.id, error: messageFor(error), code: error?.code });
  } finally {
    if (controller) activeLogins.delete(message.id);
  }
});
