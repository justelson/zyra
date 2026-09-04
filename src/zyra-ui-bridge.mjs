import { randomUUID } from "node:crypto";
import path from "node:path";
import readline from "node:readline";
import { pathToFileURL } from "node:url";
import { normalizeAgentSurfaceTool } from "./agent-surface.mjs";
import { formatRequestUserInputContinuationPrompt, normalizeRequestUserInputQuestions } from "./request-user-input.mjs";
import { classifyRecoveryError } from "./network-recovery.mjs";
import { AgentControlBridgeClient } from "./agent-control/bridge-client.mjs";
import { startTemporaryBrowserRelay } from "./agent-control/temporary-browser-relay.mjs";
import { appendCanonicalMessage, findCanonicalMessageReceipt } from "./agent-server/canonical-message-ledger.mjs";
import { resolveLiveContextUsage } from "./live-context-usage.mjs";
import { normalizeZyraPermissionMode } from "./permission-mode.mjs";
import { createZyraPermissionReviewer } from "./zyra-permission-reviewer.mjs";

const root = path.resolve(process.env.ZYRA_ROOT ?? path.resolve(import.meta.dirname, ".."));
const sdkPath = path.join(root, "src", "zyra-sdk.mjs");

let sdkPromise;
let runtime;
let unsubscribe;
let unsubscribeManagedBash;
let unsubscribeFleet;
let temporaryBrowserRelay;
let activePermissionMode = "approval-required";
let permissionReviewer;
let liveContextBaselineTokens;
let lastLiveContextPublishedAt = 0;
const ZYRA_CHAT_CONFIG_CUSTOM_TYPE = "zyra.chat-config.v1";
const pendingPermissionRequests = new Map();
const pendingUserInputRequests = new Map();
const controlBridgeClient = new AgentControlBridgeClient({ send: (message) => send(message) });

function stringifyProtocol(value) {
  return JSON.stringify(value);
}

function send(message) {
  process.stdout.write(`${stringifyProtocol(message)}\n`);
}

function sendResponse(id, ok, payload = {}) {
  send({ type: "response", id, ok, ...payload });
}

function requestToolPermission(request = {}) {
  const requestId = randomUUID();
  send({
    type: "event",
    event: {
      type: "approval_requested",
      requestId,
      requestType: request.requestType || "command",
      title: request.title,
      detail: request.detail,
      command: request.command,
      paths: request.paths,
      toolName: request.toolName,
      grantLabel: request.grantLabel,
    },
  });
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolvePermissionRequest(requestId, "decline", "Approval timed out."), 10 * 60 * 1000);
    timer.unref?.();
    pendingPermissionRequests.set(requestId, { resolve, timer });
  });
}

function reviewToolPermission(request = {}) {
  if (activePermissionMode !== "auto-review" && activePermissionMode !== "full-access") {
    return Promise.resolve({ decision: "ask", reason: "Automatic permission review is not active for this mode." });
  }
  syncPermissionReviewer();
  if (!permissionReviewer) {
    return Promise.resolve({ decision: "ask", reason: "Automatic review is unavailable." });
  }
  return permissionReviewer.review({
    ...request,
    userRequest: latestUserRequest(),
  });
}

function latestUserRequest() {
  const messages = Array.isArray(runtime?.session?.state?.messages)
    ? runtime.session.state.messages
    : [];
  const message = [...messages].reverse().find((entry) => entry?.role === "user");
  return messageTextForTitle(message).trim().slice(0, 4_000);
}

function syncPermissionReviewer() {
  if (!runtime || (activePermissionMode !== "auto-review" && activePermissionMode !== "full-access")) {
    permissionReviewer?.dispose?.();
    permissionReviewer = undefined;
    return;
  }
  permissionReviewer ??= createZyraPermissionReviewer({
    runtime,
    project: runtime.project || runtime.session?.sessionManager?.getCwd?.(),
  });
  void permissionReviewer.warm().catch((error) => {
    process.stderr.write(`[permission-reviewer] ${error instanceof Error ? error.message : String(error)}\n`);
  });
}

function resolvePermissionRequest(requestId, decision, reason) {
  const pending = pendingPermissionRequests.get(String(requestId || ""));
  if (!pending) return false;
  pendingPermissionRequests.delete(String(requestId));
  clearTimeout(pending.timer);
  const normalizedDecision = ["acceptOnce", "acceptForSession", "decline"].includes(decision) ? decision : "decline";
  send({ type: "event", event: { type: "approval_resolved", requestId: String(requestId), decision: normalizedDecision, reason } });
  pending.resolve(normalizedDecision);
  return true;
}

function declinePendingPermissions(reason = "Zyra bridge disconnected.") {
  for (const requestId of [...pendingPermissionRequests.keys()]) {
    resolvePermissionRequest(requestId, "decline", reason);
  }
}

function requestUserInput(request = {}) {
  const requestId = randomUUID();
  const questions = Array.isArray(request.questions) ? request.questions : [];
  pendingUserInputRequests.set(requestId, { questions });
  send({ type: "event", event: { type: "user_input_requested", requestId, questions } });
  return Promise.resolve({ answers: {}, cancelled: false, deferred: true, requestId });
}

function resolveUserInputRequest(requestId, result = {}) {
  const id = String(requestId || "");
  const pending = pendingUserInputRequests.get(id) || {
    questions: normalizeRequestUserInputQuestions(result.questions),
  };
  if (pending.questions.length === 0) return null;
  pendingUserInputRequests.delete(id);
  const rawAnswers = result.answers && typeof result.answers === "object" && !Array.isArray(result.answers) ? result.answers : {};
  const answers = Object.fromEntries(Object.entries(rawAnswers).map(([questionId, value]) => [
    questionId,
    Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : typeof value === "string" ? value : "",
  ]));
  const cancelled = result.cancelled === true;
  const resolved = {
    answers,
    cancelled,
    questions: pending.questions,
    continuationPrompt: cancelled ? null : formatRequestUserInputContinuationPrompt(pending.questions, answers),
  };
  send({ type: "event", event: { type: "user_input_resolved", requestId: id, answers, cancelled, reason: result.reason } });
  return resolved;
}

function abandonPendingUserInputs() {
  pendingUserInputRequests.clear();
}

function stopTemporaryBrowserRelay() {
  temporaryBrowserRelay?.stop();
  temporaryBrowserRelay = undefined;
}

function modelToInfo(model, sdk) {
  return {
    id: `${model.provider}/${model.id}`,
    label: model.id,
    description: model.name && model.name !== model.id ? model.name : model.provider,
    supportedEfforts: sdk.getZyraModelThinkingLevels(model),
    contextWindow: numberValue(model.contextWindow),
  };
}

async function loadSdk() {
  if (!sdkPromise) {
    sdkPromise = process.env.ZYRA_STANDALONE === "1"
      ? import("./zyra-sdk.mjs")
      : import(pathToFileURL(sdkPath).href);
  }
  return sdkPromise;
}

function disposeRuntime() {
  declinePendingPermissions();
  abandonPendingUserInputs();
  stopTemporaryBrowserRelay();
  permissionReviewer?.dispose?.();
  permissionReviewer = undefined;
  if (typeof unsubscribe === "function") {
    unsubscribe();
  }
  unsubscribe = undefined;
  if (typeof unsubscribeManagedBash === "function") {
    unsubscribeManagedBash();
  }
  unsubscribeManagedBash = undefined;
  if (typeof unsubscribeFleet === "function") {
    unsubscribeFleet();
  }
  unsubscribeFleet = undefined;
  runtime?.managedBash?.abortAll?.("Zyra bridge disposed");
  void runtime?.fleet?.cancelAll?.("Zyra bridge disposed");
  runtime?.session?.dispose?.();
  runtime = undefined;
  liveContextBaselineTokens = undefined;
  lastLiveContextPublishedAt = 0;
}

function isMissingLocalChatError(error) {
  return error instanceof Error && /No local chat matches:/i.test(error.message);
}

async function handleConnect(payload) {
  disposeRuntime();
  activePermissionMode = normalizeRuntimeMode(payload.runtimeMode);
  const sdk = await loadSdk();
  const requestedThreadId = payload.threadId || payload.providerThreadId || undefined;
  const createRuntime = (overrides = {}) => sdk.createZyraSession({
    project: payload.cwd,
    filesystemScope: payload.filesystemScope,
    session: requestedThreadId,
    noSession: Boolean(payload.noSession),
    model: payload.model,
    profile: requestedThreadId ? undefined : payload.profile,
    thinking: payload.thinking ?? "medium",
    reasoningSummary: payload.reasoningSummary ?? (payload.surface === "memory-worker" ? "auto" : undefined),
    contextCompactionThresholdTokens: payload.contextCompactionThresholdTokens,
    tools: Array.isArray(payload.tools) ? payload.tools : undefined,
    excludeTools: Array.isArray(payload.excludeTools) ? payload.excludeTools : undefined,
    surface: payload.surface === "memory-worker" ? "memory-worker" : "agent-server",
    skipMemoryStartup: true,
    skipModelAvailability: true,
    persistStartupPreferences: payload.purpose === "voice-primary" ? false : undefined,
    rootThreadId: payload.localThreadId || undefined,
    controlBridgeClient,
    permissionRequest: requestToolPermission,
    permissionReview: reviewToolPermission,
    requestUserInput,
    getPermissionMode: () => activePermissionMode,
    ...overrides,
  });
  try {
    runtime = await createRuntime();
  } catch (error) {
    if (!requestedThreadId || !isMissingLocalChatError(error)) {
      throw error;
    }
    runtime = await createRuntime({ session: undefined, noSession: Boolean(payload.noSession) });
  }
  const storedChatConfig = readStoredChatConfig(runtime.session.sessionManager);
  await applyChatConfig(sdk, storedChatConfig || normalizeChatConfig(payload), { emit: false });
  const chatConfig = currentChatConfig(sdk);
  unsubscribe = runtime.session.subscribe((event) => {
    const normalized = normalizeEvent(event, getRuntimeContextWindow(runtime));
    if (!normalized) return;
    const isAssistantMessageEvent = (
      (event?.type === "message_start" || event?.type === "message_update" || event?.type === "message_end")
      && normalized.message?.role === "assistant"
    );
    if (isAssistantMessageEvent) {
      const now = Date.now();
      const shouldPublishLiveContext = event.type !== "message_update" || now - lastLiveContextPublishedAt >= 250;
      if (shouldPublishLiveContext) {
        const current = sdk.describeRuntime(runtime);
        if (event.type === "message_start") {
          liveContextBaselineTokens = Number(current.contextUsage?.tokens) || 0;
        }
        normalized.sessionUsage = cloneJsonValue(current.usage);
        normalized.contextUsage = cloneJsonValue(resolveLiveContextUsage({
          reported: current.contextUsage,
          baselineTokens: liveContextBaselineTokens,
          activeMessage: normalized.message,
          contextWindow: getRuntimeContextWindow(runtime),
        }));
        normalized.autoCompactionEnabled = runtime.session.autoCompactionEnabled !== false;
        lastLiveContextPublishedAt = now;
      }
      if (event.type === "message_end") liveContextBaselineTokens = undefined;
    }
    send({ type: "event", event: normalized });
  });
  unsubscribeManagedBash = runtime.managedBash?.subscribe?.((update) => {
    const payload = cloneJsonValue(update);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
    send({ type: "event", event: { type: "managed_bash_job_update", ...payload } });
  });
  unsubscribeFleet = runtime.fleet?.subscribe?.(({ event, snapshot }) => {
    send({ type: "event", event: { ...summarizeFleetEvent(event), fleet: projectFleetSnapshot(snapshot) } });
  });
  if (payload.surface !== "memory-worker") {
    try {
      temporaryBrowserRelay = await startTemporaryBrowserRelay({
        controlClient: controlBridgeClient,
        threadId: payload.localThreadId
      });
    } catch (error) {
      process.stderr.write(`[temporary-browser-relay] ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
  const described = sdk.describeRuntime(runtime);
  const threadId = String(
    runtime.session.sessionManager?.getSessionId?.()
      || described.threadId
      || described.sessionId
      || requestedThreadId
      || randomUUID()
  );
  return {
    threadId,
    providerThreadId: threadId,
    model: chatConfig.model || String(described.model || payload.model || "openai-codex/gpt-5.6-sol"),
    thinking: chatConfig.thinking,
    profile: chatConfig.profile || String(described.profile || payload.profile || "default"),
    runtimeMode: chatConfig.runtimeMode,
    webSearch: chatConfig.webSearch,
    webFetch: chatConfig.webFetch,
    config: chatConfig,
    usage: described.usage,
    contextUsage: described.contextUsage,
    autoCompactionEnabled: runtime.session.autoCompactionEnabled !== false,
    fleet: projectFleetSnapshot(runtime.fleet?.snapshot?.()),
    agentDefinitions: cloneJsonValue(runtime.fleet?.listDefinitions?.()),
    workflowDefinitions: cloneJsonValue(runtime.workflows?.listDefinitions?.()),
    sessionFile: runtime.session.sessionManager?.getSessionFile?.() || undefined,
    sessionName: runtime.session.sessionManager?.getSessionName?.() || undefined,
    cwd: runtime.session.sessionManager?.getCwd?.() || payload.cwd,
    messages: Array.isArray(runtime.session.state?.messages)
      ? runtime.session.state.messages.slice(-500)
        .filter((message) => message?.role !== "toolResult")
        .map((message) => normalizeMessage(message, getRuntimeContextWindow(runtime)))
        .filter(Boolean)
      : [],
  };
}

function normalizeEvent(event, modelContextWindow) {
  if (!event || typeof event !== "object") return null;
  const type = typeof event.type === "string" ? event.type : null;
  if (!type) return null;

  if (type === "message_update" || type === "message_end" || type === "message_start") {
    const message = normalizeMessage(event.message, modelContextWindow);
    return {
      type,
      message,
      timestamp: Number.isFinite(message?.timestamp) ? new Date(message.timestamp).toISOString() : undefined,
      assistantMessageEvent: normalizeAssistantMessageEvent(event.assistantMessageEvent),
    };
  }

  if (type === "tool_execution_start" || type === "tool_execution_update" || type === "tool_execution_end") {
    const normalized = {
      type,
      id: stringValue(event.id),
      toolCallId: stringValue(event.toolCallId),
      toolName: stringValue(event.toolName) || stringValue(event.name),
      name: stringValue(event.name),
      args: cloneJsonValue(event.args ?? event.arguments),
      arguments: cloneJsonValue(event.arguments),
      input: cloneJsonValue(event.input),
      result: cloneJsonValue(event.result),
      partialResult: cloneJsonValue(event.partialResult),
      output: cloneJsonValue(event.output),
      metadata: cloneJsonValue(event.metadata),
      startedAt: cloneJsonValue(event.startedAt ?? event.started_at),
      endedAt: cloneJsonValue(event.endedAt ?? event.ended_at ?? event.completedAt ?? event.completed_at),
      isError: Boolean(event.isError),
    };
    return { ...normalized, surface: normalizeAgentSurfaceTool(normalized) };
  }

  if (type === "session_title") {
    return { type, title: stringValue(event.title) };
  }

  if (type === "agent_end") {
    return { type, willRetry: event.willRetry === true };
  }

  if (type === "auto_retry_start") {
    const errorMessage = stringValue(event.errorMessage);
    return {
      type,
      attempt: numberValue(event.attempt),
      maxAttempts: numberValue(event.maxAttempts),
      delayMs: numberValue(event.delayMs),
      errorMessage,
      recoveryKind: classifyRecoveryError(errorMessage),
    };
  }

  if (type === "auto_retry_end") {
    return {
      type,
      success: event.success === true,
      attempt: numberValue(event.attempt),
      finalError: stringValue(event.finalError),
    };
  }

  if (type === "compaction_start") {
    return {
      type,
      reason: stringValue(event.reason),
    };
  }

  if (type === "compaction_end") {
    const result = event.result && typeof event.result === "object" && !Array.isArray(event.result)
      ? {
          firstKeptEntryId: stringValue(event.result.firstKeptEntryId),
          tokensBefore: numberValue(event.result.tokensBefore),
          estimatedTokensAfter: numberValue(event.result.estimatedTokensAfter),
        }
      : undefined;
    return {
      type,
      reason: stringValue(event.reason),
      result,
      aborted: Boolean(event.aborted),
      willRetry: Boolean(event.willRetry),
      errorMessage: stringValue(event.errorMessage),
    };
  }

  return { type };
}

function normalizeMessage(message, modelContextWindow) {
  if (!message || typeof message !== "object") return null;
  const timestamp = normalizeMessageTimestamp(message.timestamp);
  const role = stringValue(message.role);
  return {
    id: stringValue(message.id)
      || stringValue(message.messageId)
      || stringValue(message.entryId)
      || stringValue(message.uuid)
      || stablePiMessageId(role, timestamp),
    role,
    content: normalizeContent(message.content),
    usage: normalizeUsage(message.usage, modelContextWindow),
    stopReason: stringValue(message.stopReason),
    errorMessage: stringValue(message.errorMessage),
    timestamp,
  };
}

function normalizeMessageTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stablePiMessageId(role, timestamp) {
  if (!Number.isFinite(timestamp)) return undefined;
  return `pi-message:${role || "unknown"}:${Math.trunc(timestamp)}`;
}

function normalizeAssistantMessageEvent(event) {
  if (!event || typeof event !== "object") return undefined;
  const normalized = {};
  const type = stringValue(event.type);
  if (type) normalized.type = type;
  const id = stringValue(event.id) || stringValue(event.itemId) || stringValue(event.messageId);
  if (id) normalized.id = id;
  const channel = stringValue(event.channel);
  if (channel) normalized.channel = channel;
  const kind = stringValue(event.kind);
  if (kind) normalized.kind = kind;
  const delta = stringValue(event.delta);
  if (delta) normalized.delta = delta;
  const partial = event.partial && typeof event.partial === "object" ? event.partial : undefined;
  if (partial) {
    normalized.partial = {
      ...cloneJsonValue(partial),
      content: normalizeContent(partial.content),
    };
  }
  const content = normalizeContent(event.content);
  if (typeof content === "string" ? content : content.length > 0) {
    normalized.content = content;
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((part) => {
    if (!part || typeof part !== "object") return [];
    if (part.type === "text") {
      return [{ type: "text", text: stringValue(part.text) || "" }];
    }
    if (part.type === "thinking") {
      return [{ type: "thinking", thinking: stringValue(part.thinking) || stringValue(part.text) || "" }];
    }
    if (part.type === "image") {
      return [{
        type: "image",
        data: stringValue(part.data),
        mimeType: stringValue(part.mimeType) || stringValue(part.mime_type) || "image/png"
      }];
    }
    if (part.type === "toolCall") {
      return [{
        type: "toolCall",
        id: stringValue(part.id),
        name: stringValue(part.name),
        arguments: cloneJsonValue(part.arguments)
      }];
    }
    return [cloneJsonValue(part)];
  });
}

function getRuntimeContextWindow(runtimeValue) {
  const modelWindow = Number(runtimeValue?.session?.state?.model?.contextWindow);
  if (Number.isFinite(modelWindow) && modelWindow > 0) return modelWindow;
  const contextWindow = Number(runtimeValue?.session?.getContextUsage?.()?.contextWindow);
  return Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : undefined;
}

function normalizeUsage(usage, modelContextWindow) {
  if (!usage || typeof usage !== "object") return undefined;
  const totalTokens = numberValue(usage.totalTokens ?? usage.total);
  const cost = usage.cost && typeof usage.cost === "object" ? {
    input: numberValue(usage.cost.input),
    output: numberValue(usage.cost.output),
    cacheRead: numberValue(usage.cost.cacheRead),
    cacheWrite: numberValue(usage.cost.cacheWrite),
    total: numberValue(usage.cost.total),
  } : undefined;
  return {
    input: numberValue(usage.input),
    output: numberValue(usage.output),
    cacheRead: numberValue(usage.cacheRead),
    cacheWrite: numberValue(usage.cacheWrite),
    reasoning: numberValue(usage.reasoning ?? usage.reasoningTokens),
    total: totalTokens,
    totalTokens,
    modelContextWindow: numberValue(modelContextWindow),
    cost,
  };
}

function cloneJsonValue(value) {
  if (value === undefined || typeof value === "function") return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function stringValue(value) {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

const supportedPromptImageMimeTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const maxPromptImageBase64Chars = 28 * 1024 * 1024;

function normalizePromptImages(value) {
  if (value == null) return undefined;
  if (!Array.isArray(value)) throw new Error("Invalid prompt image payload.");
  if (value.length > 12) throw new Error("Attach at most 12 images per message.");

  const images = value.map((image, index) => {
    if (!image || typeof image !== "object") throw new Error(`Image ${index + 1} is invalid.`);
    const data = stringValue(image.data);
    const mimeType = stringValue(image.mimeType)?.toLowerCase();
    if (image.type !== "image" || !data || !mimeType || !supportedPromptImageMimeTypes.has(mimeType)) {
      throw new Error(`Image ${index + 1} is not a supported visual input.`);
    }
    if (data.length > maxPromptImageBase64Chars) throw new Error(`Image ${index + 1} is larger than 20 MB.`);
    return { type: "image", data, mimeType };
  });

  return images.length > 0 ? images : undefined;
}

const VALID_THINKING_LEVELS = new Set(["off", "none", "minimal", "low", "medium", "high", "xhigh", "max"]);

function normalizeRuntimeMode(value) {
  return normalizeZyraPermissionMode(value) || "approval-required";
}

function normalizeChatConfig(value) {
  const source = value && typeof value === "object" ? value : {};
  const model = String(source.model || "").trim();
  const thinkingValue = String(source.thinking || "").trim().toLowerCase();
  const profileValue = String(source.profile || "").trim().toLowerCase();
  return {
    ...(model ? { model } : {}),
    ...(VALID_THINKING_LEVELS.has(thinkingValue) ? { thinking: thinkingValue } : {}),
    ...(/^[a-z0-9_-]{1,64}$/.test(profileValue) ? { profile: profileValue } : {}),
    ...(normalizeZyraPermissionMode(source.runtimeMode)
      ? { runtimeMode: normalizeRuntimeMode(source.runtimeMode) }
      : {}),
    ...(typeof source.webSearch === "boolean" ? { webSearch: source.webSearch } : {}),
    ...(typeof source.webFetch === "boolean" ? { webFetch: source.webFetch } : {}),
  };
}

function readStoredChatConfig(sessionManager) {
  const entries = typeof sessionManager?.getEntries === "function" ? sessionManager.getEntries() : [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type === "custom" && entry.customType === ZYRA_CHAT_CONFIG_CUSTOM_TYPE) {
      return normalizeChatConfig(entry.data);
    }
  }
  return null;
}

function currentChatConfig(sdk) {
  const model = runtime?.session?.model;
  return normalizeChatConfig({
    model: model?.provider && model?.id ? `${model.provider}/${model.id}` : undefined,
    thinking: sdk.getZyraThinkingLevel(runtime),
    profile: runtime?.profile,
    runtimeMode: activePermissionMode,
    webSearch: runtime?.webSearch,
    webFetch: runtime?.webFetch,
  });
}

function sameChatConfig(left, right) {
  return left?.model === right?.model
    && left?.thinking === right?.thinking
    && left?.profile === right?.profile
    && left?.runtimeMode === right?.runtimeMode
    && left?.webSearch === right?.webSearch
    && left?.webFetch === right?.webFetch;
}

async function applyChatConfig(sdk, value, options = {}) {
  if (!runtime) throw new Error("Zyra bridge is not connected.");
  const requested = normalizeChatConfig(value);
  const currentBeforeRefresh = currentChatConfig(sdk);
  const requestedProvider = String(requested.model || currentBeforeRefresh.model || "").split(/[/:]/, 1)[0];
  if (requestedProvider) await refreshServerAuthProvider(requestedProvider);
  const current = currentChatConfig(sdk);
  if (requested.model && requested.model !== current.model) {
    await sdk.setModel(runtime, requested.model, { skipAvailabilityCheck: true });
  }
  if (requested.thinking && requested.thinking !== current.thinking) {
    sdk.setThinking(runtime, requested.thinking);
  }
  if (requested.profile && requested.profile !== current.profile) {
    await sdk.setProfile(runtime, requested.profile);
  }
  if (requested.runtimeMode) activePermissionMode = requested.runtimeMode;
  if (
    (typeof requested.webSearch === "boolean" && requested.webSearch !== current.webSearch)
    || (typeof requested.webFetch === "boolean" && requested.webFetch !== current.webFetch)
  ) {
    sdk.setWebTools(runtime, {
      webSearch: typeof requested.webSearch === "boolean" ? requested.webSearch : runtime.webSearch,
      webFetch: typeof requested.webFetch === "boolean" ? requested.webFetch : runtime.webFetch,
    });
  }
  syncPermissionReviewer();

  const next = currentChatConfig(sdk);
  const configurationChanged = !sameChatConfig(current, next);
  const sessionManager = runtime.session.sessionManager;
  const stored = readStoredChatConfig(sessionManager);
  if (!sameChatConfig(stored, next) && typeof sessionManager?.appendCustomEntry === "function" && sessionManager.getSessionFile?.()) {
    sessionManager.appendCustomEntry(ZYRA_CHAT_CONFIG_CUSTOM_TYPE, { ...next, savedAt: new Date().toISOString() });
  }
  if (options.emit !== false && configurationChanged) send({ type: "event", event: { type: "session_config", ...next } });
  return next;
}

async function handleConfigure(payload) {
  const sdk = await loadSdk();
  return { config: await applyChatConfig(sdk, payload) };
}

async function handleAuthRefresh(payload) {
  const provider = String(payload?.provider || "").trim();
  await refreshServerAuthProvider(provider);
  return { provider, configured: runtime.session.modelRegistry.authStorage.hasAuth(provider) };
}

async function refreshServerAuthProvider(provider) {
  if (!runtime) throw new Error("Zyra bridge is not connected.");
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(provider)) throw new Error("Auth refresh provider is invalid.");
  const modelRuntime = runtime.session?.modelRegistry?.authStorage?.modelRuntime;
  if (typeof modelRuntime?.refresh !== "function") throw new Error("The server model runtime cannot refresh authentication.");
  const result = await modelRuntime.refresh({ allowNetwork: false, providers: [provider] });
  const refreshError = result?.errors?.get?.(provider);
  if (refreshError) throw refreshError;
}

async function handlePrompt(payload) {
  if (!runtime) {
    throw new Error("Zyra bridge is not connected.");
  }
  const sdk = await loadSdk();
  await applyChatConfig(sdk, payload);
  sdk.setZyraReasoningSummary(runtime, payload.reasoningSummary);
  const shouldGenerateTitle = !runtime.session.sessionManager?.getSessionName?.();
  const images = normalizePromptImages(payload.images);
  await sdk.runZyraPrompt(runtime, payload.prompt, {
    images,
    contextCompactionThresholdTokens: payload.contextCompactionThresholdTokens,
  });
  if (shouldGenerateTitle && payload.skipTitleGeneration !== true) {
    const titleTargetRuntime = runtime;
    void generateAndPersistSessionTitle(titleTargetRuntime, payload.cwd || runtime.project).catch((error) => {
      process.stderr.write(`[session-title] ${error instanceof Error ? error.message : String(error)}\n`);
    });
  }
  return {};
}

async function generateAndPersistSessionTitle(targetRuntime, cwd) {
  const sessionManager = targetRuntime?.session?.sessionManager;
  if (!sessionManager?.appendSessionInfo || sessionManager.getSessionName?.()) return;
  const transcript = buildCompletedTitleTranscript(targetRuntime.session.state?.messages);
  if (!transcript) return;
  const result = await handleGenerateText({
    cwd: cwd || targetRuntime.project,
    model: "openai-codex/gpt-5.6-luna",
    thinking: "low",
    prompt: [
      "You write concise titles for coding assistant chat sessions.",
      "Return only the title text. Do not use quotes, markdown, JSON, or commentary.",
      "Keep the title under 60 characters.",
      "Prefer concrete technical nouns and task intent over generic wording.",
      "Do not mention tools, implementation steps, or title generation.",
      "",
      "Completed conversation:",
      transcript
    ].join("\n")
  });
  const title = String(result.text || "")
    .replace(/^title\s*:\s*/i, "")
    .replace(/^[\"'`]+|[\"'`]+$/g, "")
    .split(/\r?\n/)[0]
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  if (!title || runtime !== targetRuntime || sessionManager.getSessionName?.()) return;
  sessionManager.appendSessionInfo(title);
  send({ type: "event", event: { type: "session_title", title } });
}

function buildCompletedTitleTranscript(messages = []) {
  const visible = Array.isArray(messages) ? messages : [];
  const userMessage = visible.find((message) => message?.role === "user");
  const assistantMessage = [...visible].reverse().find((message) => message?.role === "assistant" && message.stopReason !== "error" && message.stopReason !== "aborted");
  const userText = messageTextForTitle(userMessage).replace(/\s+/g, " ").trim().slice(0, 720);
  const assistantText = messageTextForTitle(assistantMessage).replace(/\s+/g, " ").trim().slice(0, 1_200);
  if (!userText) return "";
  return [`User prompt: ${userText}`, assistantText ? `Final assistant response: ${assistantText}` : ""].filter(Boolean).join("\n");
}

function messageTextForTitle(message) {
  if (typeof message?.content === "string") return message.content;
  if (!Array.isArray(message?.content)) return "";
  return message.content
    .filter((part) => part?.type === "text")
    .map((part) => String(part.text || ""))
    .join("\n");
}

async function handleGenerateText(payload) {
  const prompt = String(payload.prompt || '').trim();
  if (!prompt) throw new Error('Prompt is required.');

  const sdk = await loadSdk();
  const titleRuntime = await sdk.createZyraSession({
    project: payload.cwd,
    noSession: true,
    noTools: "all",
    model: payload.model,
    thinking: payload.thinking || 'low',
    reasoningSummary: 'auto',
    skipGuide: true,
    skipMemoryStartup: true,
    skipMemoryInjection: true,
    skipProfileInjection: true,
    skipProjectMemory: true,
    skipModelAvailability: true,
    persistStartupPreferences: false,
    enableFleet: false,
  });
  try {
    const text = await sdk.runZyraBackgroundTextPrompt(titleRuntime, prompt);
    const described = sdk.describeRuntime(titleRuntime);
    return { text, model: described.model };
  } finally {
    titleRuntime.session.dispose();
  }
}

async function handleModels(payload) {
  const sdk = await loadSdk();
  if (runtime?.session?.modelRegistry) {
    if (payload.forceRefresh && typeof runtime.session.modelRegistry.refresh === "function") {
      runtime.session.modelRegistry.refresh();
    }
    return {
      models: sdk.getZyraAvailableModels(runtime.session.modelRegistry).map((model) => modelToInfo(model, sdk)),
    };
  }
  return {
    models: await sdk.listAvailableModels({ forceRefresh: Boolean(payload.forceRefresh) }),
  };
}

async function handleWarmup(payload) {
  const sdk = await loadSdk();
  return sdk.warmupZyraRuntime({
    forceRefresh: Boolean(payload.forceRefresh),
    skipAvailability: payload.skipAvailability === true,
  });
}

async function handleAbort() {
  runtime?.session?.abortCompaction?.();
  await Promise.allSettled([
    runtime?.fleet?.cancelAll?.("root turn aborted"),
    runtime?.session?.abort?.(),
  ]);
  return {};
}

async function handleCanonicalMessageOperation(type, payload = {}) {
  const sessionManager = runtime?.session?.sessionManager;
  if (!sessionManager) throw new Error("Zyra canonical session is not connected.");
  if (type === "canonical_message.append") {
    return { receipt: appendCanonicalMessage(sessionManager, payload) };
  }
  if (type === "canonical_message.find") {
    return { receipt: findCanonicalMessageReceipt(sessionManager, payload.operationId) };
  }
  throw new Error(`Unknown canonical message operation: ${type}.`);
}

async function handleSessionOperation(type, payload = {}) {
  if (!runtime?.session) throw new Error("Zyra bridge is not connected.");
  if (type === "steer") {
    await runtime.session.steer(String(payload.prompt || ""), payload.images);
    return {};
  }
  if (type === "follow_up") {
    await runtime.session.followUp(String(payload.prompt || ""), payload.images);
    return {};
  }
  if (type === "compact") return runtime.session.compact(String(payload.instructions || "").trim() || undefined);
  if (type === "clear_queue") {
    runtime.session.clearQueue?.();
    return {};
  }
  if (type === "reload") {
    const sdk = await loadSdk();
    return sdk.reloadZyraRuntime(runtime);
  }
  throw new Error(`Unknown session operation: ${type}.`);
}

async function handleFleetOperation(type, payload = {}) {
  if (!runtime?.fleet || !runtime?.workflows) throw new Error("Fleet runtime is not connected.");
  const agents = runtime.fleet;
  const workflows = runtime.workflows;
  switch (type) {
    case "agents.list": return { definitions: agents.listDefinitions(), runs: Object.values(agents.snapshot()?.agents ?? {}), snapshot: projectFleetSnapshot(agents.snapshot()) };
    case "agents.listDefinitions": return agents.listDefinitions();
    case "agents.listRuns": return { runs: Object.values(agents.snapshot()?.agents ?? {}) };
    case "agents.get":
    case "agents.status": return agents.status(payload.agentRunId);
    case "agents.wait": return agents.wait(payload.agentRunId, payload);
    case "agents.spawn": return agents.spawn({ ...payload, goal: payload.goal ?? payload.prompt });
    case "agents.send": return agents.send(payload.agentRunId, payload.message ?? payload.prompt);
    case "agents.stop": return agents.stop(payload.agentRunId, payload.reason);
    case "agents.retry": return agents.retry(payload.agentRunId, payload.overrides ?? {});
    case "agents.resume": return agents.resume(payload.agentRunId, payload.message);
    case "agents.transcript":
    case "agents.getTranscript": return agents.getTranscript(payload.agentRunId, payload);
    case "workflows.list": return { definitions: workflows.listDefinitions(), runs: workflows.listRuns(), snapshot: projectFleetSnapshot(agents.snapshot()) };
    case "workflows.listDefinitions": return workflows.listDefinitions();
    case "workflows.listRuns": return { runs: workflows.listRuns() };
    case "workflows.status": return workflows.status(payload.workflowRunId);
    case "workflows.run": return workflows.run(payload.name, payload.args ?? {}, { approved: payload.approved === true, background: payload.background !== false });
    case "workflows.pause": return workflows.pause(payload.workflowRunId);
    case "workflows.resume": return workflows.resume(payload.workflowRunId);
    case "workflows.stop": return workflows.stop(payload.workflowRunId, payload.reason);
    case "workflows.restart": return workflows.restart(payload.workflowRunId, { args: payload.args });
    case "workflows.save": return workflows.save(payload.workflowRunId, payload);
    case "workflows.getScript": return { source: workflows.getScript(payload.workflowRunId) };
    default: throw new Error(`Unknown fleet operation: ${type}.`);
  }
}

function projectFleetSnapshot(snapshot) {
  if (!snapshot) return null;
  const allAgents = Object.values(snapshot.agents ?? {});
  const allWorkflows = Object.values(snapshot.workflows ?? {});
  const selectedAgents = allAgents.slice(-200);
  const selectedWorkflows = allWorkflows.slice(-100);
  const summarizeAgent = (run) => ({
    version: run.version, rootSessionId: snapshot.rootSessionId,
    agentRunId: run.agentRunId, agentId: run.agentId, definitionName: run.definitionName, label: run.label,
    parentAgentRunId: run.parentAgentRunId, workflowRunId: run.workflowRunId, workflowPhaseId: run.phaseId, workflowCallId: null,
    goal: String(run.goal ?? "").slice(0, 1000), status: run.status, depth: run.depth, contextFork: run.contextFork,
    attempt: run.attempt, maxAttempts: 1, requestedModel: run.requestedModel, selectedModel: run.selectedModel, modelRoute: run.modelRoute,
    effort: run.effort, requestedTools: run.tools, grantedTools: run.tools, deniedTools: [], deniedCapabilities: [],
    controlLease: run.controlLease ?? null,
    permissionMode: run.permissionMode, isolation: run.isolation, readScope: run.readScope, writeScope: run.writeScope,
    worktree: run.worktree, providerSessionId: run.providerSessionId, sessionFile: run.sessionFile,
    createdAt: run.createdAt, queuedAt: run.createdAt, startedAt: run.startedAt, completedAt: run.completedAt, heartbeatAt: run.heartbeatAt,
    elapsedMs: run.elapsedMs, activity: run.activity, usage: run.usage,
    result: run.result ? { text: String(run.result.text ?? "").slice(0, 4000), warnings: run.result.warnings, truncated: run.result.truncated } : null,
    error: run.error,
  });
  const summarizeWorkflow = (run) => ({
    version: run.version, rootSessionId: snapshot.rootSessionId,
    workflowRunId: run.workflowRunId, definitionName: run.definitionName, definitionPath: run.source, definitionHash: run.scriptHash,
    status: run.status, attempt: run.attempt, args: run.args,
    phases: Object.fromEntries(Object.entries(run.phases ?? {}).map(([phaseId, phase]) => [phaseId, { name: phaseId, ...phase, phaseId }])),
    calls: Object.fromEntries(Object.entries(run.calls ?? {}).slice(-200)), agentRunIds: run.agentRunIds,
    usage: run.usage, projected: run.projected, budget: run.budget, cacheHits: run.cacheHits, warnings: run.warnings,
    approvedAt: run.approval?.approved ? run.createdAt : null,
    createdAt: run.createdAt, startedAt: run.startedAt, completedAt: run.completedAt,
    result: run.result === undefined ? null : cloneJsonValue(run.result), error: run.error,
  });
  const agents = Object.fromEntries(selectedAgents.map((run) => [run.agentRunId, summarizeAgent(run)]));
  const workflows = Object.fromEntries(selectedWorkflows.map((run) => [run.workflowRunId, summarizeWorkflow(run)]));
  const relationships = selectedAgents.map((run) => ({
    parentAgentRunId: run.parentAgentRunId ?? null, childAgentRunId: run.agentRunId,
    workflowRunId: run.workflowRunId ?? null, workflowPhaseId: run.phaseId ?? null,
  })).slice(-400);
  const artifacts = selectedAgents.flatMap((run) => (run.artifacts ?? []).map((artifact, index) => ({
    artifactId: String(artifact.artifactId ?? `${run.agentRunId}:${index}`), agentRunId: run.agentRunId,
    workflowRunId: run.workflowRunId ?? null, kind: String(artifact.kind ?? "artifact"), path: artifact.path ?? null,
    createdAt: run.completedAt ?? run.startedAt ?? run.createdAt,
  }))).slice(-400);
  return {
    version: snapshot.version, fleetId: snapshot.fleetId, rootSessionId: snapshot.rootSessionId,
    rootThreadId: snapshot.rootThreadId, lastAppliedSequence: snapshot.lastAppliedSequence,
    agents, workflows, relationships, artifacts, eventWindow: [], usage: snapshot.usage, updatedAt: snapshot.updatedAt,
    truncated: { agents: allAgents.length > selectedAgents.length, workflows: allWorkflows.length > selectedWorkflows.length, relationships: false, artifacts: false, events: false },
  };
}

function summarizeFleetEvent(event) {
  return {
    type: event?.type ?? "fleet_snapshot",
    eventId: event?.eventId,
    sequence: event?.sequence,
    timestamp: event?.occurredAt,
    agentRunId: event?.agentRunId,
    workflowRunId: event?.workflowRunId,
    phaseId: event?.phaseId,
  };
}

async function handleMessage(message) {
  if (message?.type === "control.response") {
    controlBridgeClient.handleResponse(message);
    return;
  }
  const id = message?.id;
  try {
    if (message?.type === "connect") {
      sendResponse(id, true, { result: await handleConnect(message.payload ?? {}) });
      return;
    }
    if (message?.type === "prompt") {
      sendResponse(id, true, { result: await handlePrompt(message.payload ?? {}) });
      return;
    }
    if (message?.type === "configure") {
      sendResponse(id, true, { result: await handleConfigure(message.payload ?? {}) });
      return;
    }
    if (message?.type === "auth.refresh") {
      sendResponse(id, true, { result: await handleAuthRefresh(message.payload ?? {}) });
      return;
    }
    if (message?.type === "generate_text") {
      sendResponse(id, true, { result: await handleGenerateText(message.payload ?? {}) });
      return;
    }
    if (message?.type === "models") {
      sendResponse(id, true, { result: await handleModels(message.payload ?? {}) });
      return;
    }
    if (message?.type === "warmup") {
      sendResponse(id, true, { result: await handleWarmup(message.payload ?? {}) });
      return;
    }
    if (message?.type === "abort") {
      sendResponse(id, true, { result: await handleAbort() });
      return;
    }
    if (message?.type === "approval.respond") {
      const requestId = String(message.payload?.requestId || "");
      if (!resolvePermissionRequest(requestId, message.payload?.decision)) {
        throw new Error(`Unknown approval request: ${requestId || "missing"}`);
      }
      sendResponse(id, true, { result: {} });
      return;
    }
    if (message?.type === "user_input.respond") {
      const requestId = String(message.payload?.requestId || "");
      const result = resolveUserInputRequest(requestId, message.payload || {});
      if (!result) {
        throw new Error(`Unknown user-input request: ${requestId || "missing"}`);
      }
      sendResponse(id, true, { result });
      return;
    }
    if (["canonical_message.append", "canonical_message.find"].includes(message?.type)) {
      sendResponse(id, true, { result: await handleCanonicalMessageOperation(message.type, message.payload ?? {}) });
      return;
    }
    if (["steer", "follow_up", "compact", "clear_queue", "reload"].includes(message?.type)) {
      sendResponse(id, true, { result: await handleSessionOperation(message.type, message.payload ?? {}) });
      return;
    }
    if (/^(?:agents|workflows)\./.test(message?.type ?? "")) {
      sendResponse(id, true, { result: await handleFleetOperation(message.type, message.payload ?? {}) });
      return;
    }
    if (message?.type === "dispose") {
      controlBridgeClient.dispose();
      disposeRuntime();
      sendResponse(id, true, { result: {} });
      process.exit(0);
    }
    throw new Error(`Unknown bridge message: ${message?.type ?? "missing"}`);
  } catch (error) {
    sendResponse(id, false, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  try {
    void handleMessage(JSON.parse(line));
  } catch (error) {
    send({
      type: "protocol_error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

process.on("SIGTERM", () => {
  controlBridgeClient.dispose();
  disposeRuntime();
  process.exit(0);
});

process.on("SIGINT", () => {
  controlBridgeClient.dispose();
  disposeRuntime();
  process.exit(0);
});
