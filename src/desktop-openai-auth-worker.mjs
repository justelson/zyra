import { connectModelProvider, listModelProviders, disconnectModelProvider } from "./provider-connections.mjs";
import { parentPort } from "node:worker_threads";
import {
  configureZyraOpenAIApiKey,
  getZyraAuthStatus,
  loginZyraAuth,
  removeZyraAuth,
  verifyZyraOpenAIApiAuth,
} from "./desktop-openai-auth.mjs";
import {
  buildChatGptAccountStatus,
  fetchCodexResetCredits,
  resolveChatGptAccountAuth,
} from "./chatgpt-account.mjs";

if (!parentPort) throw new Error("Desktop OpenAI auth worker requires a parent port.");

function messageFor(error) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "OpenAI connection action failed.";
}

async function execute(message) {
  switch (message.operation) {
    case "disconnectModelProvider": return disconnectModelProvider(message.provider);
    case "connectModelProvider": return connectModelProvider(message.input);
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
        onAuth: (info) => parentPort.postMessage({ type: "auth", id: message.id, info }),
        onProgress: (progress) => parentPort.postMessage({ type: "progress", id: message.id, progress }),
        onPrompt: async () => {
          throw new Error("Browser sign-in did not complete automatically. Try again or use an API key.");
        },
      });
    case "configureZyraOpenAIApiKey":
      return configureZyraOpenAIApiKey(message.apiKey);
    case "verifyZyraOpenAIApiAuth":
      return verifyZyraOpenAIApiAuth();
    case "removeZyraAuth":
      return removeZyraAuth(message.method);
    default:
      throw new Error("Unsupported Desktop OpenAI auth operation.");
  }
}

parentPort.on("message", async (message) => {
  if (!message || typeof message !== "object" || typeof message.id !== "number") return;
  try {
    const result = await execute(message);
    parentPort.postMessage({ type: "result", id: message.id, result });
  } catch (error) {
    parentPort.postMessage({ type: "error", id: message.id, error: messageFor(error) });
  }
});
