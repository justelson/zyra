import { randomUUID } from "node:crypto";
import path from "node:path";
import { createZyraPiRuntime } from "../pi-runtime.mjs";
import {
  defaults,
  getProjectSessionsDir,
  getZyraModelThinkingLevels,
  registerZyraRuntimeModels,
  resolveZyraStartupPreferences
} from "../zyra-sdk.mjs";
import { resolveTerminalTheme } from "../terminal-theme.mjs";
import { launchInstalledDesktop } from "../desktop-app.mjs";
import { removeZyraTitleGenerationMessages } from "../title-generation.mjs";
import { ZyraAgentServerClient } from "./client.mjs";
import { captureCliEvent } from "../analytics/cli.mjs";
import { normalizeZyraPermissionMode } from "../permission-mode.mjs";
import { ZYRA_RETRY_MAX_ATTEMPTS } from "../network-recovery.mjs";
import { formatRequestUserInputContinuationPrompt } from "../request-user-input.mjs";

export const TUI_RESUME_HISTORY_ENTRY_LIMIT = 120;

export function resolveTuiPermissionAttachFields(options = {}, preferences = {}) {
  const explicitMode = normalizeZyraPermissionMode(options.permissionMode);
  const runtimeMode = explicitMode || (preferences.profile === "yolo-fast" ? "full-access" : null);
  return runtimeMode ? { runtimeMode } : {};
}

export async function createZyraTuiClientRuntime(options = {}) {
  const project = path.resolve(options.project || defaults.project);
  const preferences = resolveZyraStartupPreferences(project, options);
  const requestedPermissionFields = resolveTuiPermissionAttachFields(options, preferences);
  const requestedChatConfig = normalizeRemoteChatConfig({
    thinking: options.thinking,
    ...requestedPermissionFields,
  });
  const clientId = `tui:${process.pid}:${randomUUID()}`;
  const client = new ZyraAgentServerClient({
    root: defaults.root,
    clientId,
    surface: "tui",
    ...(options.agentServer || {})
  });
  await client.connect();
  const earlyServerEvents = [];
  const captureEarlyServerEvent = (message) => earlyServerEvents.push(message);
  client.on("session-event", captureEarlyServerEvent);
  let sessionSelector = options.session || undefined;
  if (!sessionSelector && options.sessionMode === "continue") {
    const recent = await client.request("catalog.list", { project, limit: 1 });
    sessionSelector = recent.chats?.[0]?.sessionPath || recent.chats?.[0]?.canonicalChatId;
  }
  const localThreadId = `tui-thread:${randomUUID()}`;
  const attached = await client.attach({
    project,
    cwd: project,
    session: sessionSelector,
    localThreadId,
    noSession: Boolean(options.noSession),
    model: preferences.model,
    thinking: preferences.thinking,
    profile: preferences.profile || "default",
    ...requestedPermissionFields,
    webSearch: preferences.webSearch,
    webFetch: preferences.webFetch,
    lastSequence: 0
  });
  const connected = asRecord(attached.connected) || {};
  const connectedConfig = normalizeRemoteChatConfig(asRecord(connected.config) || connected);
  const canonicalChatId = String(attached.canonicalChatId || attached.sessionKey);
  const { modelRegistry } = await createZyraPiRuntime();
  registerZyraRuntimeModels(modelRegistry);
  const model = resolveModel(modelRegistry, String(connectedConfig.model || connected.model || preferences.model));
  const sessionFile = typeof connected.sessionFile === "string" ? connected.sessionFile : null;
  const state = {
    messages: dedupeRemoteMessages(Array.isArray(connected.messages) ? connected.messages.filter(Boolean) : [])
  };
  const connectedUsage = asRecord(connected.usage);
  const connectedCost = asRecord(connectedUsage?.cost);
  let cumulativeCost = Number(connectedCost?.total);
  if (!Number.isFinite(cumulativeCost)) cumulativeCost = sumRemoteMessageCost(state.messages);
  const costAccountedMessageIds = new Set(state.messages
    .filter((message) => message?.role === "assistant" && message.id)
    .map((message) => message.id));
  let currentSessionName = asString(connected.sessionName);
  let currentProject = asString(connected.cwd) || asString(connected.project) || project;
  let historyEvents = [];
  let historyCursor = null;
  let historyHasOlder = false;
  try {
    const historyResult = await client.request("catalog.history", {
      session: canonicalChatId,
      project,
      limit: TUI_RESUME_HISTORY_ENTRY_LIMIT
    }, { timeoutMs: 35_000 });
    const history = asRecord(historyResult.history);
    historyEvents = projectHistoryEntries(selectTuiResumeEntries(history?.entries));
    const pageInfo = asRecord(history?.pageInfo);
    historyCursor = asString(pageInfo?.oldestCursor);
    historyHasOlder = pageInfo?.hasOlder === true;
  } catch {
    historyEvents = projectConnectedMessages(state.messages);
  }
  const eventListeners = new Set();
  const fleetListeners = new Set();
  const respondedApprovalRequestIds = new Set();
  const resolvedApprovalRequestIds = new Set();
  const approvalAbortControllers = new Map();
  const respondedUserInputRequestIds = new Set();
  const resolvedUserInputRequestIds = new Set();
  const locallyResolvedUserInputRequestIds = new Set();
  const userInputAbortControllers = new Map();
  const pendingUserInputEvents = new Map();
  const pendingUserInputResponses = new Map();
  let approvalHandler = null;
  let userInputHandler = null;
  const activeTools = new Set(["read", "bash", "edit", "write", "request_user_input", ...(preferences.webSearch ? ["web_search"] : []), ...(preferences.webFetch ? ["web_fetch"] : [])]);
  const steering = [];
  const followUp = [];
  let disposed = false;
  let latestSequence = 0;
  let currentPresence = asRecord(attached.presence);
  let activeTurnId = asString(asRecord(attached.activeRequestContext)?.turnId) || activeTurnFromPresence(currentPresence);
  let remotelyAttached = true;
  let reconnectDetached = () => Promise.resolve();
  let systemPrompt = "";
  let thinkingLevel = requestedChatConfig.thinking || connectedConfig.thinking || connected.thinking || preferences.thinking;
  const thinkingState = { value: thinkingLevel };
  let currentModel = model;
  let currentProfile = connectedConfig.profile || connected.profile || preferences.profile || "default";
  const connectedPermissionMode = connectedConfig.runtimeMode || connected.runtimeMode;
  let currentPermissionMode = normalizeRemoteRuntimeMode(requestedChatConfig.runtimeMode || connectedPermissionMode);
  let currentWebSearch = typeof connectedConfig.webSearch === "boolean" ? connectedConfig.webSearch : preferences.webSearch;
  let currentWebFetch = typeof connectedConfig.webFetch === "boolean" ? connectedConfig.webFetch : preferences.webFetch;
  let compacting = false;
  let configSyncQueued = false;
  let latestFleet = asRecord(connected.fleet);
  let agentDefinitions = normalizeDefinitions(connected.agentDefinitions);
  let workflowDefinitions = normalizeDefinitions(connected.workflowDefinitions);
  let drainUserInputContinuations = async () => undefined;
  let enqueueUserInputContinuation = async () => undefined;
  let flushPendingUserInputResponses = async () => undefined;

  const presentUserInputRequest = (event) => {
    const requestId = asString(event?.requestId);
    if (!requestId || resolvedUserInputRequestIds.has(requestId) || respondedUserInputRequestIds.has(requestId)) return;
    pendingUserInputEvents.set(requestId, event);
    if (!userInputHandler) return;
    pendingUserInputEvents.delete(requestId);
    respondedUserInputRequestIds.add(requestId);
    void Promise.resolve().then(async () => {
      if (resolvedUserInputRequestIds.has(requestId)) return;
      const controller = new AbortController();
      userInputAbortControllers.set(requestId, controller);
      let result = { answers: {}, cancelled: true };
      try {
        result = await userInputHandler(event, { signal: controller.signal }) || result;
      } catch {}
      userInputAbortControllers.delete(requestId);
      if (resolvedUserInputRequestIds.has(requestId) || controller.signal.aborted) return;
      pendingUserInputResponses.set(requestId, {
        requestId,
        questions: Array.isArray(event.questions) ? event.questions : [],
        answers: result?.answers || {},
        cancelled: result?.cancelled === true,
      });
      await flushPendingUserInputResponses();
    });
  };

  const dispatch = (event, requestContext, replay = false) => {
    if (!event || typeof event !== "object") return;
    // Replay rebuilds transcript/UI state only. Live turn ownership comes from
    // authoritative attach presence; otherwise a historical post-agent_end event
    // carrying the old request context can resurrect a completed turn locally.
    if (!replay && requestContext?.turnId && event.type !== "zyra_server_turn_completed") {
      activeTurnId = requestContext.turnId;
      currentPresence = {
        ...(currentPresence || {}),
        state: "running",
        activeTurnId,
      };
    }
    if (!replay && (event.type === "zyra_server_turn_completed" || (event.type === "agent_end" && event.willRetry !== true))) {
      if (!requestContext?.turnId || requestContext.turnId === activeTurnId) activeTurnId = null;
      currentPresence = {
        ...(currentPresence || {}),
        state: "ready",
        activeTurnId: null,
      };
      queueMicrotask(() => { void drainUserInputContinuations(); });
    }
    if (event.type === "zyra_server_turn_completed") return;
    if (event.type === "session_config") {
      const config = normalizeRemoteChatConfig(event);
      if (config.model) currentModel = resolveModel(modelRegistry, config.model);
      if (config.thinking) {
        thinkingLevel = config.thinking;
        thinkingState.value = config.thinking;
      }
      if (config.profile) currentProfile = config.profile;
      if (config.runtimeMode) currentPermissionMode = config.runtimeMode;
      if (typeof config.webSearch === "boolean") currentWebSearch = config.webSearch;
      if (typeof config.webFetch === "boolean") currentWebFetch = config.webFetch;
    }
    if (event.type === "compaction_start") compacting = true;
    if (event.type === "compaction_end") compacting = false;
    if (event.type === "session_title") {
      currentSessionName = asString(event.title) || currentSessionName;
    }
    if (event.type === "session_metadata") {
      currentSessionName = asString(event.title) || currentSessionName;
      currentProject = asString(event.cwd) || asString(event.project) || currentProject;
    }
    if (event.type === "approval_resolved") {
      const requestId = asString(event.requestId);
      if (requestId) {
        resolvedApprovalRequestIds.add(requestId);
        approvalAbortControllers.get(requestId)?.abort();
        approvalAbortControllers.delete(requestId);
      }
    }
    if (event.type === "approval_requested") {
      const requestId = asString(event.requestId);
      if (requestId && !respondedApprovalRequestIds.has(requestId)) {
        respondedApprovalRequestIds.add(requestId);
        void Promise.resolve().then(async () => {
          if (resolvedApprovalRequestIds.has(requestId)) return;
          const controller = new AbortController();
          approvalAbortControllers.set(requestId, controller);
          let decision = "decline";
          try {
            decision = await approvalHandler?.(event, { signal: controller.signal }) || "decline";
          } catch {}
          approvalAbortControllers.delete(requestId);
          if (resolvedApprovalRequestIds.has(requestId) || controller.signal.aborted) return;
          if (!['acceptOnce', 'acceptForSession', 'decline'].includes(decision)) decision = "decline";
          await request("approval.respond", { requestId, decision }).catch(() => undefined);
        });
      }
    }
    if (event.type === "user_input_resolved") {
      const requestId = asString(event.requestId);
      if (requestId) {
        pendingUserInputEvents.delete(requestId);
        const resolvedLocally = asString(event.responseOwnerClientId) === clientId;
        if (resolvedLocally) locallyResolvedUserInputRequestIds.add(requestId);
        else pendingUserInputResponses.delete(requestId);
        resolvedUserInputRequestIds.add(requestId);
        userInputAbortControllers.get(requestId)?.abort();
        userInputAbortControllers.delete(requestId);
      }
    }
    if (event.type === "user_input_requested") presentUserInputRequest(event);
    if (event.type === "message_end" && event.message?.role === "assistant" && event.message.id && !costAccountedMessageIds.has(event.message.id)) {
      cumulativeCost += Number(event.message.usage?.cost?.total) || 0;
      costAccountedMessageIds.add(event.message.id);
    }
    updateMessages(state.messages, event);
    if (event.type === "fleet_snapshot" || String(event.type || "").startsWith("agent.") || String(event.type || "").startsWith("workflow.")) {
      latestFleet = asRecord(event.fleet) || latestFleet;
      for (const listener of fleetListeners) listener({ event, snapshot: latestFleet });
    }
    for (const listener of eventListeners) listener(event);
  };

  const consumeServerEntry = (entry, replay = false) => {
    const sequence = Number(entry?.sequence) || 0;
    if (sequence && sequence <= latestSequence) return;
    if (sequence) {
      latestSequence = sequence;
      currentPresence = { ...(currentPresence || {}), latestSequence: sequence };
    }
    dispatch(entry?.event, entry?.requestContext, replay);
  };
  const onServerEvent = (message) => {
    if (message.sessionKey !== canonicalChatId) return;
    consumeServerEntry(message);
  };
  const onDisconnect = () => {
    remotelyAttached = false;
    void reconnectDetached();
  };
  client.on("session-event", onServerEvent);
  client.on("disconnect", onDisconnect);
  client.off("session-event", captureEarlyServerEvent);
  const initialEntries = [
    ...(Array.isArray(attached.replay) ? attached.replay.map((entry) => ({ entry, replay: true })) : []),
    ...earlyServerEvents
      .filter((entry) => entry?.sessionKey === canonicalChatId)
      .map((entry) => ({ entry, replay: false }))
  ].sort((left, right) => (Number(left.entry?.sequence) || 0) - (Number(right.entry?.sequence) || 0));
  for (const item of initialEntries) consumeServerEntry(item.entry, item.replay);
  latestSequence = Math.max(latestSequence, Number(attached.latestSequence) || 0);

  const synchronizePresence = (value) => {
    const presence = asRecord(value);
    if (!presence) return currentPresence;
    currentPresence = presence;
    const remoteTurnId = activeTurnFromPresence(presence);
    if (remoteTurnId) activeTurnId = remoteTurnId;
    else if (["ready", "idle", "completed", "failed", "interrupted"].includes(asString(presence.state))) {
      activeTurnId = null;
      queueMicrotask(() => { void drainUserInputContinuations(); });
    }
    return currentPresence;
  };

  const ensureAttached = async () => {
    if (remotelyAttached) return;
    const result = await client.attach({
      project: currentProject,
      cwd: currentProject,
      session: canonicalChatId,
      localThreadId,
      lastSequence: latestSequence
    });
    remotelyAttached = true;
    synchronizePresence(result.presence);
    for (const entry of Array.isArray(result.replay) ? result.replay : []) consumeServerEntry(entry, true);
    queueMicrotask(() => { void flushPendingUserInputResponses(); });
  };

  let reconnectPromise = null;
  reconnectDetached = () => {
    if (disposed) return Promise.resolve();
    if (reconnectPromise) return reconnectPromise;
    const retryTurnId = activeTurnId;
    const requestContext = retryTurnId ? { turnId: retryTurnId, localThreadId } : undefined;
    captureCliEvent("zyra_v1_cli", { action: "recovery", outcome: "started", runtime: "client" });
    reconnectPromise = (async () => {
      let delayMs = 120;
      let lastError = "Agent-server connection closed.";
      for (let attempt = 1; attempt <= ZYRA_RETRY_MAX_ATTEMPTS && !disposed && !remotelyAttached; attempt += 1) {
        dispatch({
          type: "auto_retry_start",
          attempt,
          maxAttempts: ZYRA_RETRY_MAX_ATTEMPTS,
          delayMs,
          errorMessage: lastError,
          recoveryKind: "network"
        }, requestContext);
        try {
          await ensureAttached();
          const recoveredRequestContext = activeTurnFromPresence(currentPresence) ? requestContext : undefined;
          dispatch({ type: "auto_retry_end", success: true, attempt, recoveryKind: "network" }, recoveredRequestContext);
          captureCliEvent("zyra_v1_cli", { action: "recovery", outcome: "recovered", runtime: "client" });
          return;
        } catch (error) {
          lastError = String(error?.message || error || lastError);
          if (attempt < ZYRA_RETRY_MAX_ATTEMPTS) await delay(delayMs);
          delayMs = Math.min(2_500, Math.round(delayMs * 1.7));
        }
      }
      if (!disposed && !remotelyAttached) {
        dispatch({
          type: "auto_retry_end",
          success: false,
          attempt: ZYRA_RETRY_MAX_ATTEMPTS,
          finalError: lastError,
          recoveryKind: "network"
        }, requestContext);
        activeTurnId = null;
        currentPresence = { ...(currentPresence || {}), state: "interrupted", activeTurnId: null };
        captureCliEvent("zyra_v1_cli", { action: "recovery", outcome: "failed", runtime: "client" });
      }
    })().finally(() => { reconnectPromise = null; });
    return reconnectPromise;
  };

  const resolveDesktopWorkspaceChat = async (selector) => {
    const requested = String(selector || "").trim();
    if (!requested) return { canonicalChatId, title: currentSessionName || "this chat" };
    const result = await client.request("catalog.list", {
      query: requested,
      allProjects: true,
      includeArchived: false,
      limit: 40
    });
    const chats = Array.isArray(result.chats) ? result.chats.filter((chat) => !chat?.deleted && !chat?.archived) : [];
    const normalized = requested.toLowerCase();
    const exact = chats.filter((chat) => String(chat?.canonicalChatId || "").toLowerCase() === normalized
      || String(chat?.title || "").trim().toLowerCase() === normalized);
    const matches = exact.length > 0 ? exact : chats.filter((chat) => String(chat?.canonicalChatId || "").toLowerCase().startsWith(normalized)
      || String(chat?.title || "").toLowerCase().includes(normalized));
    if (matches.length === 0) throw Object.assign(new Error(`No chat matched “${requested}”.`), { code: "DESKTOP_WORKSPACE_CHAT_NOT_FOUND" });
    if (matches.length > 1) throw Object.assign(new Error(`More than one chat matched “${requested}”. Use a longer title or ID.`), { code: "DESKTOP_WORKSPACE_CHAT_AMBIGUOUS" });
    return { canonicalChatId: String(matches[0].canonicalChatId), title: String(matches[0].title || "Untitled chat") };
  };

  const openDesktopWorkspace = async (input = {}) => {
    if (input.background === true) await refreshPresence();
    const chat = await resolveDesktopWorkspaceChat(input.chat);
    const request = () => client.request("desktop.workspace.open", {
      operation: input.operation || "open",
      sourceCanonicalChatId: canonicalChatId,
      canonicalChatId: chat.canonicalChatId,
      workspace: input.workspace,
      url: input.url || "",
      path: input.path || "",
      background: input.background === true,
      focus: input.focus === true,
      newWindow: input.newWindow === true,
      activeTurnId: input.background === true ? activeTurnId || undefined : undefined
    }, { timeoutMs: 20_000 });
    let result;
    try {
      result = await request();
    } catch (error) {
      if (error?.code !== "DESKTOP_WORKSPACE_UNAVAILABLE") throw error;
      const launch = await launchInstalledDesktop();
      if (!launch.launched) throw error;
      let lastError = error;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await delay(250);
        try {
          result = await request();
          lastError = null;
          break;
        } catch (retryError) {
          lastError = retryError;
          if (retryError?.code !== "DESKTOP_WORKSPACE_UNAVAILABLE") throw retryError;
        }
      }
      if (lastError) throw lastError;
    }
    return { ...result, chatTitle: result.chatTitle || chat.title };
  };

  const refreshPresence = async () => {
    try {
      const result = await client.request("catalog.list", {
        query: canonicalChatId,
        allProjects: true,
        limit: 4
      });
      const chats = Array.isArray(result.chats) ? result.chats : [];
      const chat = chats.find((entry) => entry?.canonicalChatId === canonicalChatId);
      synchronizePresence(chat?.presence);
    } catch {}
    return currentPresence;
  };

  const request = async (type, payload = {}, requestContext) => {
    const send = () => client.request("session.request", {
      sessionKey: canonicalChatId,
      type,
      payload,
      ...(requestContext ? { requestContext } : {})
    });
    await ensureAttached();
    try {
      return await send();
    } catch (error) {
      if (isAgentServerTransportFailure(error)) {
        remotelyAttached = false;
        void reconnectDetached();
        throw error;
      }
      if (!["AGENT_SERVER_SESSION_NOT_FOUND", "AGENT_SERVER_AUTH_FAILED"].includes(String(error?.code || ""))) throw error;
      remotelyAttached = false;
      await ensureAttached();
      return send();
    }
  };

  let flushingPendingUserInputResponses = false;
  flushPendingUserInputResponses = async () => {
    if (flushingPendingUserInputResponses || disposed || !remotelyAttached || pendingUserInputResponses.size === 0) return;
    flushingPendingUserInputResponses = true;
    try {
      for (const [requestId, payload] of [...pendingUserInputResponses]) {
        if (disposed || !remotelyAttached) return;
        let response;
        try {
          response = await request("user_input.respond", payload);
        } catch (error) {
          const code = asString(error?.code);
          if (code === "AGENT_SERVER_USER_INPUT_UNKNOWN" && locallyResolvedUserInputRequestIds.has(requestId)) {
            pendingUserInputResponses.delete(requestId);
            if (payload.cancelled !== true) {
              await enqueueUserInputContinuation(formatRequestUserInputContinuationPrompt(payload.questions, payload.answers));
            }
            continue;
          }
          if (code === "AGENT_SERVER_USER_INPUT_ALREADY_ANSWERED") pendingUserInputResponses.delete(requestId);
          return;
        }
        pendingUserInputResponses.delete(requestId);
        const continuationPrompt = asString(response?.continuationPrompt);
        if (continuationPrompt && payload.cancelled !== true) await enqueueUserInputContinuation(continuationPrompt);
      }
    } finally {
      flushingPendingUserInputResponses = false;
    }
  };

  const sessionManager = {
    getSessionId: () => canonicalChatId,
    getSessionFile: () => sessionFile,
    getSessionName: () => currentSessionName,
    getCwd: () => currentProject,
    getEntries: () => state.messages.map((message, index) => ({ type: "message", id: message.id || `remote-message:${index}`, message })),
    getSessionUsage: () => ({ cost: { total: cumulativeCost } }),
    appendCustomEntry: () => undefined
  };

  const remoteChatConfig = () => ({
    model: `${currentModel.provider}/${currentModel.id}`,
    thinking: thinkingLevel,
    profile: currentProfile,
    runtimeMode: currentPermissionMode,
    webSearch: currentWebSearch,
    webFetch: currentWebFetch,
  });
  const syncRemoteChatConfig = () => request("configure", remoteChatConfig());
  const queueRemoteChatConfigSync = () => {
    if (configSyncQueued || disposed) return;
    configSyncQueued = true;
    queueMicrotask(() => {
      configSyncQueued = false;
      if (!disposed) void syncRemoteChatConfig().catch(() => undefined);
    });
  };
  if (
    (requestedChatConfig.thinking && requestedChatConfig.thinking !== connectedConfig.thinking)
    || (requestedChatConfig.runtimeMode && requestedChatConfig.runtimeMode !== connectedPermissionMode)
  ) {
    await syncRemoteChatConfig();
  }

  const session = {
    state,
    messages: state.messages,
    sessionManager,
    modelRegistry,
    get model() { return currentModel; },
    get thinkingLevel() { return thinkingLevel; },
    get isStreaming() { return Boolean(activeTurnId); },
    get isCompacting() { return compacting; },
    agent: {
      getSystemPrompt: () => systemPrompt,
      setSystemPrompt: (value) => { systemPrompt = String(value || ""); }
    },
    subscribe(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    async prompt(prompt, promptOptions = {}) {
      if (activeTurnId) throw new Error("This canonical chat already has an active turn.");
      const turnId = `turn:${randomUUID()}`;
      let preserveServerOwnedTurn = false;
      activeTurnId = turnId;
      try {
        return await request("prompt", {
          prompt,
          images: promptOptions.images,
          model: `${currentModel.provider}/${currentModel.id}`,
          thinking: thinkingLevel,
          profile: runtime.profile,
          runtimeMode: runtime.permissionMode,
          webSearch: runtime.webSearch,
          webFetch: runtime.webFetch,
          turnId
        }, { turnId, localThreadId: runtime.localThreadId });
      } catch (error) {
        preserveServerOwnedTurn = isAgentServerTransportFailure(error);
        throw error;
      } finally {
        if (!preserveServerOwnedTurn && activeTurnId === turnId) activeTurnId = null;
        if (!activeTurnId) queueMicrotask(() => { void drainUserInputContinuations(); });
      }
    },
    abort: () => request("abort"),
    abortBash: () => undefined,
    async steer(prompt, images) {
      steering.push(String(prompt || ""));
      try { return await request("steer", { prompt, images }); }
      finally { steering.shift(); }
    },
    async followUp(prompt, images) {
      followUp.push(String(prompt || ""));
      try { return await request("follow_up", { prompt, images }); }
      finally { followUp.shift(); }
    },
    compact: (instructions) => request("compact", { instructions }),
    reload: () => request("reload"),
    clearQueue() {
      const queued = { steering: [...steering], followUp: [...followUp] };
      steering.length = 0;
      followUp.length = 0;
      void request("clear_queue").catch(() => undefined);
      return queued;
    },
    getSteeringMessages: () => [...steering],
    getFollowUpMessages: () => [...followUp],
    getActiveToolNames: () => [...activeTools],
    setActiveToolsByName(names) {
      activeTools.clear();
      for (const name of names || []) activeTools.add(String(name));
    },
    acceptsZyraThinkingLevels: true,
    getAvailableThinkingLevels: () => getZyraModelThinkingLevels(currentModel),
    setThinkingLevel(value) {
      thinkingLevel = String(value || "off");
      thinkingState.value = thinkingLevel;
      queueRemoteChatConfigSync();
    },
    async setModel(nextModel) {
      const previousModel = currentModel;
      currentModel = nextModel;
      try {
        await syncRemoteChatConfig();
      } catch (error) {
        currentModel = previousModel;
        throw error;
      }
    },
    getContextUsage: () => getRemoteContextUsage(state.messages, currentModel),
    dispose() {
      if (disposed) return;
      disposed = true;
      client.off("session-event", onServerEvent);
      client.off("disconnect", onDisconnect);
      for (const controller of approvalAbortControllers.values()) controller.abort();
      for (const controller of userInputAbortControllers.values()) controller.abort();
      approvalAbortControllers.clear();
      userInputAbortControllers.clear();
      locallyResolvedUserInputRequestIds.clear();
      pendingUserInputEvents.clear();
      pendingUserInputResponses.clear();
      queuedUserInputContinuations.length = 0;
      eventListeners.clear();
      fleetListeners.clear();
      void client.detach(canonicalChatId).catch(() => undefined).finally(() => client.close());
    }
  };

  const queuedUserInputContinuations = [];
  let drainingUserInputContinuations = false;
  drainUserInputContinuations = async () => {
    if (drainingUserInputContinuations || disposed || activeTurnId || queuedUserInputContinuations.length === 0) return;
    drainingUserInputContinuations = true;
    try {
      while (!disposed && !activeTurnId && queuedUserInputContinuations.length > 0) {
        const prompt = queuedUserInputContinuations.shift();
        try {
          await session.prompt(prompt);
        } catch {
          if (activeTurnId && prompt) queuedUserInputContinuations.unshift(prompt);
          return;
        }
      }
    } finally {
      drainingUserInputContinuations = false;
    }
  };
  enqueueUserInputContinuation = async (prompt) => {
    if (!prompt || disposed) return;
    queuedUserInputContinuations.push(prompt);
    await drainUserInputContinuations();
  };

  const fleet = createFleetProxy(request, () => latestFleet, fleetListeners, {
    get: () => agentDefinitions,
    set: (value) => { agentDefinitions = normalizeDefinitions(value); }
  });
  const workflows = createWorkflowProxy(request, () => latestFleet, {
    get: () => workflowDefinitions,
    set: (value) => { workflowDefinitions = normalizeDefinitions(value); }
  });
  const terminalTheme = resolveTerminalTheme(preferences.terminalTheme, { root: defaults.root, project });
  const runtime = {
    session,
    root: defaults.root,
    get project() { return currentProject; },
    get sessions() { return getProjectSessionsDir(currentProject); },
    theme: "dark",
    terminalTheme,
    get profile() { return currentProfile; },
    set profile(value) { currentProfile = String(value || "default"); queueRemoteChatConfigSync(); },
    get permissionMode() { return currentPermissionMode; },
    set permissionMode(value) { currentPermissionMode = normalizeRemoteRuntimeMode(value); queueRemoteChatConfigSync(); },
    surface: "tui-client",
    async syncAuthProvider(providerValue) {
      const provider = String(providerValue || "").trim();
      if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(provider)) throw new Error("Auth refresh provider is invalid.");
      const result = await modelRegistry.authStorage.modelRuntime.refresh({ allowNetwork: false, providers: [provider] });
      const refreshError = result?.errors?.get?.(provider);
      if (refreshError) throw refreshError;
      return client.request("auth.refresh", { provider });
    },
    projectMemory: [],
    memoryStartup: null,
    get thinking() { return thinkingLevel; },
    set thinking(value) {
      thinkingLevel = String(value || "off");
      thinkingState.value = thinkingLevel;
    },
    thinkingState,
    get webSearch() { return currentWebSearch; },
    set webSearch(value) { currentWebSearch = Boolean(value); queueRemoteChatConfigSync(); },
    get webFetch() { return currentWebFetch; },
    set webFetch(value) { currentWebFetch = Boolean(value); queueRemoteChatConfigSync(); },
    statusLine: preferences.statusLine,
    notifications: preferences.notifications,
    interruptMode: preferences.interruptMode,
    codexServiceTier: preferences.codexServiceTier,
    codexServiceTierState: { value: preferences.codexServiceTier },
    managedBash: { abortAll: () => undefined, subscribe: () => () => undefined },
    modelAvailability: null,
    modelFallbackMessage: null,
    fleet,
    workflows,
    localThreadId,
    history: {
      events: () => [...historyEvents],
      hasOlder: () => historyHasOlder,
      async loadOlder() {
        if (!historyHasOlder || !historyCursor) return { events: [...historyEvents], added: 0, hasOlder: false };
        const result = await client.request("catalog.history", {
          session: canonicalChatId,
          project: currentProject,
          before: historyCursor,
          limit: TUI_RESUME_HISTORY_ENTRY_LIMIT
        }, { timeoutMs: 35_000 });
        const history = asRecord(result.history);
        const olderEvents = projectHistoryEntries(selectTuiResumeEntries(history?.entries));
        historyEvents = [...olderEvents, ...historyEvents];
        const pageInfo = asRecord(history?.pageInfo);
        historyCursor = asString(pageInfo?.oldestCursor);
        historyHasOlder = pageInfo?.hasOlder === true;
        return { events: [...historyEvents], added: olderEvents.length, hasOlder: historyHasOlder };
      }
    },
    agentServer: {
      client,
      canonicalChatId,
      activeTurnId: () => activeTurnId,
      presence: () => currentPresence,
      refreshPresence,
      openDesktopWorkspace,
      setApprovalHandler(handler) {
        approvalHandler = typeof handler === "function" ? handler : null;
      },
      setUserInputHandler(handler) {
        userInputHandler = typeof handler === "function" ? handler : null;
        if (userInputHandler) {
          for (const event of [...pendingUserInputEvents.values()]) presentUserInputRequest(event);
        }
      },
      respondApproval(requestId, decision) {
        return request("approval.respond", { requestId, decision });
      },
      respondUserInput(requestId, answers, cancelled = false) {
        return request("user_input.respond", { requestId, answers, cancelled });
      }
    }
  };
  return runtime;
}

export async function listCanonicalZyraChats(options = {}) {
  const client = new ZyraAgentServerClient({
    root: defaults.root,
    clientId: `tui-catalog:${process.pid}:${randomUUID()}`,
    surface: "tui",
    ...(options.agentServer || {})
  });
  try {
    const result = await client.request("catalog.list", {
      project: options.project,
      query: options.query,
      limit: options.limit,
      allProjects: options.allProjects !== false
    });
    return (Array.isArray(result.chats) ? result.chats : []).map((chat) => ({
      path: chat.sessionPath,
      id: chat.canonicalChatId,
      cwd: chat.cwd,
      name: chat.title,
      firstMessage: chat.title,
      created: new Date(chat.createdAt),
      modified: new Date(chat.modifiedAt),
      messageCount: chat.messageCount,
      project: chat.project
    }));
  } finally {
    client.close();
  }
}

function createFleetProxy(request, snapshot, listeners, definitions) {
  const call = (action, payload = {}) => request(`agents.${action}`, payload);
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    snapshot,
    listDefinitions: () => definitions.get(),
    spawn: (input) => call("spawn", input),
    send: (agentRunId, message) => call("send", { agentRunId, message }),
    stop: (agentRunId, reason) => call("stop", { agentRunId, reason }),
    retry: (agentRunId, overrides) => call("retry", { agentRunId, overrides }),
    resume: (agentRunId, message) => call("resume", { agentRunId, message }),
    status: (agentRunId) => snapshot()?.agents?.[agentRunId] || null,
    wait: (agentRunId, options) => call("wait", { agentRunId, ...options }),
    cancelAll: (reason) => Promise.allSettled(Object.keys(snapshot()?.agents || {}).map((agentRunId) => call("stop", { agentRunId, reason }))),
    reloadDefinitions: async () => {
      const result = await call("listDefinitions");
      definitions.set(result);
      return definitions.get();
    },
    dispose: async () => undefined
  };
}

function createWorkflowProxy(request, snapshot, definitions) {
  const call = (action, payload = {}) => request(`workflows.${action}`, payload);
  return {
    listDefinitions: () => definitions.get(),
    listRuns: () => Object.values(snapshot()?.workflows || {}),
    status: (workflowRunId) => snapshot()?.workflows?.[workflowRunId] || null,
    run: (name, args, options) => call("run", { name, args, ...options }),
    pause: (workflowRunId) => call("pause", { workflowRunId }),
    resume: (workflowRunId) => call("resume", { workflowRunId }),
    stop: (workflowRunId, reason) => call("stop", { workflowRunId, reason }),
    restart: (workflowRunId, options) => call("restart", { workflowRunId, ...options }),
    save: (workflowRunId, options) => call("save", { workflowRunId, ...options }),
    reloadDefinitions: async () => definitions.get()
  };
}

function normalizeDefinitions(value) {
  return asRecord(value) || { active: [], shadowed: [], invalid: [], all: [] };
}

function resolveModel(modelRegistry, selector) {
  const [provider, ...idParts] = String(selector || defaults.model).split("/");
  const id = idParts.join("/");
  return modelRegistry.find(provider, id)
    || { provider: provider || "openai-codex", id: id || "gpt-5.6-sol", name: id || "GPT-5.6 Sol", reasoning: true, contextWindow: 400_000 };
}

function updateMessages(messages, event) {
  if (!["message_start", "message_update", "message_end"].includes(event.type) || !event.message) return;
  const incoming = event.message;
  const id = incoming.id;
  let index = id ? messages.findIndex((message) => message?.id === id) : -1;
  if (index < 0 && event.type !== "message_start" && incoming.role) {
    for (let candidate = messages.length - 1; candidate >= 0; candidate -= 1) {
      if (messages[candidate]?.role === incoming.role) {
        index = candidate;
        break;
      }
    }
  }
  if (index >= 0) messages[index] = { ...messages[index], ...incoming };
  else if (event.type !== "message_update" || incoming.role) messages.push(incoming);
}

function dedupeRemoteMessages(messages) {
  const result = [];
  const indexById = new Map();
  for (const message of messages) {
    const id = message?.id;
    const existingIndex = id ? indexById.get(id) : undefined;
    if (existingIndex !== undefined) {
      result[existingIndex] = { ...result[existingIndex], ...message };
      continue;
    }
    if (id) indexById.set(id, result.length);
    result.push(message);
  }
  return result;
}

function normalizeRemoteRuntimeMode(value) {
  return normalizeZyraPermissionMode(value) || "approval-required";
}

function normalizeRemoteChatConfig(value) {
  const source = asRecord(value) || {};
  const thinking = asString(source.thinking);
  return {
    model: asString(source.model),
    thinking: ["off", "none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(thinking) ? thinking : null,
    profile: asString(source.profile),
    runtimeMode: normalizeZyraPermissionMode(source.runtimeMode),
    webSearch: typeof source.webSearch === "boolean" ? source.webSearch : undefined,
    webFetch: typeof source.webFetch === "boolean" ? source.webFetch : undefined,
  };
}

function sumRemoteMessageCost(messages) {
  return messages.reduce((total, message) => (
    message?.role === "assistant" ? total + (Number(message.usage?.cost?.total) || 0) : total
  ), 0);
}

function getRemoteContextUsage(messages, model) {
  const contextWindow = Number(model?.contextWindow) || 0;
  if (contextWindow <= 0) return undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant" || message.stopReason === "aborted" || message.stopReason === "error") continue;
    const usage = asRecord(message.usage);
    if (!usage) continue;
    const tokens = Number(usage.totalTokens ?? usage.total)
      || [usage.input, usage.output, usage.cacheRead, usage.cacheWrite].reduce((sum, value) => sum + (Number(value) || 0), 0);
    if (tokens <= 0) continue;
    return { tokens, contextWindow, percent: (tokens / contextWindow) * 100 };
  }
  return undefined;
}

function projectConnectedMessages(messages) {
  return messages.flatMap((message) => {
    if (message?.role === "user") return [{ type: "message_start", message }];
    if (message?.role === "assistant") return [
      { type: "message_start", message },
      { type: "message_end", message }
    ];
    return [];
  });
}

export function selectTuiResumeEntries(entries) {
  const bounded = (Array.isArray(entries) ? entries : []).slice(-TUI_RESUME_HISTORY_ENTRY_LIMIT);
  const firstUserIndex = bounded.findIndex((entry) => entry?.type === "message" && entry.message?.role === "user");
  return firstUserIndex > 0 ? bounded.slice(firstUserIndex) : bounded;
}

export function projectHistoryEntries(entries) {
  const events = [];
  const tools = new Map();
  const messages = entries.map((entry) => asRecord(entry)?.message).filter(Boolean);
  const visibleMessages = new Set(removeZyraTitleGenerationMessages(messages));
  for (const entryValue of entries) {
    const entry = asRecord(entryValue);
    if (!entry || entry.type !== "message") continue;
    const message = asRecord(entry.message);
    if (!message || !visibleMessages.has(entry.message)) continue;
    const role = asString(message.role);
    const content = normalizeHistoryContent(message.content);
    const id = asString(message.id) || asString(entry.id) || `history:${events.length + 1}`;
    const normalizedMessage = {
      id,
      role,
      content,
      stopReason: asString(message.stopReason),
      errorMessage: asString(message.errorMessage)
    };
    if (role === "user") {
      events.push({ type: "message_start", message: normalizedMessage, historical: true });
      continue;
    }
    if (role === "assistant") {
      let visibleParts = [];
      let segmentIndex = 0;
      const flushVisibleParts = () => {
        if (visibleParts.length === 0) return;
        segmentIndex += 1;
        const visibleMessage = {
          ...normalizedMessage,
          id: `${id}:visible:${segmentIndex}`,
          content: visibleParts
        };
        visibleParts = [];
        events.push({ type: "message_start", message: visibleMessage, historical: true });
        events.push({ type: "message_end", message: visibleMessage, historical: true });
      };
      for (const [partIndex, part] of content.entries()) {
        if (part?.type === "text" && asString(part.text)) {
          visibleParts.push(part);
          continue;
        }
        if (part?.type === "image") {
          visibleParts.push({ type: "text", text: `[Image ${partIndex + 1}: ${part.mimeType || part.mime_type || "image"}]` });
          continue;
        }
        if (part?.type !== "toolCall") continue;
        flushVisibleParts();
        const toolCallId = asString(part.id) || `${id}:tool:${tools.size + 1}`;
        const toolEvent = {
          type: "tool_execution_start",
          toolCallId,
          toolName: asString(part.name) || "tool",
          args: part.arguments,
          historical: true
        };
        tools.set(toolCallId, toolEvent);
        events.push(toolEvent);
      }
      flushVisibleParts();
      if (normalizedMessage.errorMessage && segmentIndex === 0) {
        events.push({ type: "history_error", errorMessage: normalizedMessage.errorMessage, historical: true });
      }
      continue;
    }
    if (role === "toolResult") {
      const toolCallId = asString(message.toolCallId) || asString(message.tool_call_id) || `${id}:tool-result`;
      const started = tools.get(toolCallId) || {};
      const details = asRecord(message.details);
      events.push({
        ...started,
        type: "tool_execution_end",
        toolCallId,
        toolName: asString(message.toolName) || started.toolName || "tool",
        result: {
          content,
          ...(details ? { details: structuredClone(details) } : {})
        },
        isError: message.isError === true,
        historical: true
      });
    }
  }
  return events;
}

function normalizeHistoryContent(value) {
  if (typeof value === "string") return [{ type: "text", text: value }];
  if (!Array.isArray(value)) return [];
  return value.filter((part) => part && typeof part === "object").map((part) => ({ ...part }));
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function asString(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

function activeTurnFromPresence(value) {
  const presence = asRecord(value);
  const latestTurn = asRecord(presence?.latestTurn);
  return asString(presence?.activeTurnId)
    || (["running", "background"].includes(asString(presence?.state)) && latestTurn?.state === "running" ? asString(latestTurn.id) : null);
}

function isAgentServerTransportFailure(error) {
  const code = String(error?.code || "").toUpperCase();
  if (["AGENT_SERVER_DISCONNECTED", "AGENT_SERVER_UNAVAILABLE", "AGENT_SERVER_TIMEOUT", "ECONNRESET", "ECONNREFUSED", "EPIPE"].includes(code)) return true;
  return /agent[- ]server.*(?:closed|disconnect|unavailable|timed out)|socket.*(?:closed|hang up)|fetch failed/i.test(String(error?.message || error || ""));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}
