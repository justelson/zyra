import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { EventEmitter } from "node:events";
import { AgentBridgeWorker } from "./bridge-worker.mjs";
import { ServerPluginAuthority } from "./plugin-authority.mjs";
import { AgentEventJournal } from "./event-journal.mjs";
import { CanonicalChatCatalog } from "./catalog.mjs";
import { getAgentServerPaths } from "./paths.mjs";
import { isNetworkRecoveryError } from "../network-recovery.mjs";
import {
  AGENT_SERVER_PROTOCOL_VERSION,
  AgentServerProtocolError,
  MAX_AGENT_SERVER_REPLAY_EVENTS,
  assertAgentServerIdentifier,
  assertAgentServerMessageSize,
  assertAgentServerMethod,
  createAgentServerLineReader,
  writeAgentServerMessage
} from "./protocol.mjs";

const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const HANDSHAKE_TIMEOUT_MS = 5_000;
const BRIDGE_CONNECT_TIMEOUT_MS = 60_000;
const DESKTOP_WORKSPACE_TIMEOUT_MS = 15_000;
const DESKTOP_WORKSPACE_KINDS = new Set(["browser", "details", "explorer", "resources", "agents", "diff", "terminal"]);
const DESKTOP_WORKSPACE_OPERATIONS = new Set(["open", "list", "show"]);
const ACTIVE_FLEET_STATUSES = new Set(["queued", "starting", "running", "waiting", "blocked", "paused", "recovering"]);
const BRIDGE_REQUEST_PATTERN = /^(?:prompt|configure|auth\.refresh|abort|steer|follow_up|compact|clear_queue|reload|canonical_message\.(?:append|find)|approval\.respond|user_input\.respond|agents\.[a-zA-Z0-9._-]+|workflows\.[a-zA-Z0-9._-]+)$/;

function hashAuthorityProof(value) {
  return createHash("sha256").update(String(value || "")).digest("base64url");
}

function tokensMatch(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue || ""));
  const right = Buffer.from(String(rightValue || ""));
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

function normalizeRequestContext(value) {
  if (!value || typeof value !== "object") return null;
  const turnId = value.turnId ? assertAgentServerIdentifier(value.turnId, "turn id") : null;
  const localThreadId = value.localThreadId ? assertAgentServerIdentifier(value.localThreadId, "local thread id") : null;
  if (!turnId && !localThreadId) return null;
  return Object.freeze({ ...(turnId ? { turnId } : {}), ...(localThreadId ? { localThreadId } : {}) });
}

export class ZyraAgentServer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.root = path.resolve(options.root || path.resolve(import.meta.dirname, "../.."));
    this.paths = getAgentServerPaths(options);
    this.endpoint = options.endpoint !== undefined ? options.endpoint : this.paths.endpoint;
    this.token = options.token || randomBytes(32).toString("base64url");
    this.desktopAuthorityHash = options.desktopAuthorityToken
      ? hashAuthorityProof(options.desktopAuthorityToken)
      : String(options.desktopAuthorityHash || "").trim() || null;
    this.idleTimeoutMs = Math.max(1_000, Number(options.idleTimeoutMs) || DEFAULT_IDLE_TIMEOUT_MS);
    this.createWorker = options.createWorker || ((input) => new AgentBridgeWorker(input));
    this.catalog = options.catalog || new CanonicalChatCatalog(options);
    this.clients = new Map();
    this.sessions = new Map();
    this.pluginAuthority = new ServerPluginAuthority();
    this.utilityWorker = null;
    this.canonicalMessageQueues = new Map();
    this.desktopWorkspaceRequests = new Map();
    this.server = null;
    this.startedAt = null;
  }

  async start() {
    if (this.server) return this.descriptor();
    mkdirSync(this.paths.stateDirectory, { recursive: true });
    this.assertNoIncompatibleServer();
    if (!this.desktopAuthorityHash) {
      try {
        this.desktopAuthorityHash = readFileSync(this.paths.desktopAuthorityFile, "utf8").trim() || null;
      } catch {}
    }
    if (process.platform !== "win32" && existsSync(this.endpoint)) rmSync(this.endpoint, { force: true });
    this.server = net.createServer((socket) => this.accept(socket));
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.endpoint, resolve);
    });
    if (this.endpoint === 0) {
      const address = this.server.address();
      if (!address || typeof address === "string") throw new Error("Agent-server test endpoint did not bind to TCP.");
      this.endpoint = address.port;
    }
    this.startedAt = new Date().toISOString();
    if (this.desktopAuthorityHash) {
      writeFileSync(this.paths.desktopAuthorityFile, this.desktopAuthorityHash, { encoding: "utf8", mode: 0o600 });
    }
    this.writeDescriptor();
    return this.descriptor();
  }

  async stop(reason = "Agent server stopped.") {
    for (const session of new Set(this.sessions.values())) session.dispose(reason);
    this.sessions.clear();
    this.utilityWorker?.dispose(reason);
    this.utilityWorker = null;
    for (const pending of this.desktopWorkspaceRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(Object.assign(new Error(reason), { code: "DESKTOP_WORKSPACE_UNAVAILABLE" }));
    }
    this.desktopWorkspaceRequests.clear();
    for (const client of this.clients.values()) client.socket.destroy();
    this.clients.clear();
    const server = this.server;
    this.server = null;
    if (server) {
      const closed = new Promise((resolve) => server.close(resolve));
      server.closeAllConnections?.();
      await closed;
    }
    if (process.platform !== "win32") rmSync(this.endpoint, { force: true });
    rmSync(this.paths.descriptorFile, { force: true });
  }

  assertNoIncompatibleServer() {
    const descriptorSuffix = `-${this.paths.channel}.json`;
    const legacyLockSuffix = `-${this.paths.channel}.lock`;
    for (const name of readdirSync(this.paths.stateDirectory)) {
      const generationFile = name.startsWith('agent-server-v') && (name.endsWith(descriptorSuffix) || name.endsWith(legacyLockSuffix));
      if (!generationFile || name === path.basename(this.paths.descriptorFile)) continue;
      const generationPath = path.join(this.paths.stateDirectory, name);
      let pid = 0;
      try {
        pid = Number(JSON.parse(readFileSync(generationPath, 'utf8')).pid) || 0;
      } catch {
        rmSync(generationPath, { force: true });
        continue;
      }
      if (pid > 0) {
        try {
          process.kill(pid, 0);
          throw new AgentServerProtocolError(`Another Zyra agent server generation is still running (PID ${pid}). Close the older Zyra client before starting this version.`, 'AGENT_SERVER_PROTOCOL_CONFLICT');
        } catch (error) {
          if (error instanceof AgentServerProtocolError) throw error;
        }
      }
      // Generation descriptors and locks contain no chat data. Removing dead
      // discovery state prevents a later unrelated PID reuse from blocking startup.
      rmSync(generationPath, { force: true });
    }
  }

  descriptor() {
    return {
      version: AGENT_SERVER_PROTOCOL_VERSION,
      pid: process.pid,
      endpoint: this.endpoint,
      token: this.token,
      channel: this.paths.channel,
      startedAt: this.startedAt
    };
  }

  state() {
    const uniqueSessions = [...new Set(this.sessions.values())];
    return {
      version: AGENT_SERVER_PROTOCOL_VERSION,
      pid: process.pid,
      startedAt: this.startedAt,
      clients: this.clients.size,
      sessions: uniqueSessions.map((session) => session.summary())
    };
  }

  accept(socket) {
    const connectionId = `agent-client:${randomUUID()}`;
    const client = {
      connectionId,
      clientId: null,
      surface: null,
      canControl: false,
      canOpenWorkspace: false,
      authenticated: false,
      socket,
      attachedSessionIds: new Set(),
      cleanupReader: null,
      handshakeTimer: null
    };
    client.handshakeTimer = setTimeout(() => socket.destroy(), HANDSHAKE_TIMEOUT_MS);
    client.handshakeTimer.unref?.();
    client.cleanupReader = createAgentServerLineReader(
      socket,
      (message) => void this.handleClientMessage(client, message),
      (error) => this.sendError(client, undefined, error)
    );
    socket.on("error", () => undefined);
    socket.once("close", () => this.dropClient(client));
  }

  async handleClientMessage(client, message) {
    try {
      assertAgentServerMessageSize(message);
      if (!client.authenticated) {
        this.authenticate(client, message);
        return;
      }
      if (message?.type === "control.response") {
        this.handleControlResponse(client, message);
        return;
      }
      if (message?.type === "desktop.workspace.response") {
        this.handleDesktopWorkspaceResponse(client, message);
        return;
      }
      if (message?.type !== "request") throw new AgentServerProtocolError("Expected an agent-server request.");
      const id = assertAgentServerIdentifier(message.id, "request id");
      const method = assertAgentServerMethod(message.method);
      const result = await this.handleRequest(client, method, message.params || {});
      this.send(client, { type: "response", id, ok: true, result });
    } catch (error) {
      this.sendError(client, message?.id, error);
      if (!client.authenticated) client.socket.destroy();
    }
  }

  authenticate(client, message) {
    if (message?.type !== "hello" || message.version !== AGENT_SERVER_PROTOCOL_VERSION || !tokensMatch(message.token, this.token)) {
      throw new AgentServerProtocolError("Agent-server authentication failed.", "AGENT_SERVER_AUTH_FAILED");
    }
    client.clientId = assertAgentServerIdentifier(message.clientId, "client id");
    client.surface = String(message.surface || "unknown").slice(0, 64);
    const expectedAuthorityHash = this.getDesktopAuthorityHash();
    const verifiedDesktop = client.surface === "desktop"
      && Boolean(expectedAuthorityHash)
      && tokensMatch(hashAuthorityProof(message.authorityProof), expectedAuthorityHash);
    client.canControl = verifiedDesktop && message.authorities?.includes?.("desktop-control") === true;
    client.canOpenWorkspace = verifiedDesktop && message.authorities?.includes?.("desktop-workspace") === true;
    client.authenticated = true;
    clearTimeout(client.handshakeTimer);
    this.clients.set(client.connectionId, client);
    this.send(client, {
      type: "hello.ok",
      version: AGENT_SERVER_PROTOCOL_VERSION,
      connectionId: client.connectionId,
      server: this.state()
    });
  }

  getDesktopAuthorityHash() {
    try {
      const persisted = readFileSync(this.paths.desktopAuthorityFile, "utf8").trim();
      if (persisted) this.desktopAuthorityHash = persisted;
    } catch {}
    return this.desktopAuthorityHash;
  }

  async handleRequest(client, method, params) {
    if (method === "server.status") return this.state();
    if (method === "runtime.models") {
      return this.getUtilityWorker().request("warmup", {
        forceRefresh: params.forceRefresh === true,
        skipAvailability: params.skipAvailability === true,
      }, { timeoutMs: 60_000 });
    }
    if (method === "runtime.generateText") {
      const timeoutMs = Math.max(1_000, Math.min(120_000, Number(params.timeoutMs) || 60_000));
      return this.getUtilityWorker().request("generate_text", params, { timeoutMs });
    }
    if (method === "desktop.workspace.open") return this.openDesktopWorkspace(client, params);
    if (method === "auth.refresh") return this.refreshAuthProvider(client, params);
    if (method === "catalog.registerProject") {
      return { project: this.catalog.registerProject(params.project) };
    }
    if (method === "catalog.list") {
      const chats = await this.catalog.list(params);
      return { chats: chats.map((chat) => ({ ...chat, presence: this.sessionPresence(chat.canonicalChatId) })) };
    }
    if (method === "catalog.get") {
      const chat = await this.catalog.find(params.session, params);
      return { chat: chat ? { ...chat, presence: this.sessionPresence(chat.canonicalChatId) } : null };
    }
    if (method === "catalog.history") {
      return { history: await this.catalog.history(params.session, params) };
    }
    if (method === "catalog.entry.body") {
      const body = await this.catalog.historyEntryBody(params.session, params.ref, params);
      return { body };
    }
    if (method === "catalog.tool-output.search") {
      const matches = await this.catalog.searchToolResults(params.session, params.query, params);
      return { matches };
    }
    if (method === "catalog.message.append" || method === "catalog.message.find") {
      if (!client.canControl) {
        throw new AgentServerProtocolError("Canonical message writes require verified Desktop authority.", "AGENT_SERVER_AUTH_FAILED");
      }
      const selector = String(params.session || params.conversationId || "").trim();
      if (!selector) throw new AgentServerProtocolError("Canonical chat id is required.");
      const canonicalChatId = this.catalog.resolveAlias(selector);
      if (method === "catalog.message.append"
        && String(params.message?.conversationId || "").trim() !== canonicalChatId) {
        throw new AgentServerProtocolError("Canonical message conversation does not match its selected transcript.");
      }
      return this.withCanonicalMessageLock(canonicalChatId, async () => {
        const activeSession = this.sessions.get(canonicalChatId);
        const receipt = activeSession
          ? method === "catalog.message.append"
            ? await activeSession.appendCanonicalMessage(params.message)
            : await activeSession.findCanonicalMessageReceipt(params.operationId)
          : method === "catalog.message.append"
            ? await this.catalog.appendCanonicalMessage(canonicalChatId, params.message)
            : await this.catalog.findCanonicalMessageReceipt(canonicalChatId, params.operationId);
        if (method === "catalog.message.append") {
          this.broadcastCatalogChanged({ canonicalChatId, canonicalMessage: true });
        }
        return { receipt };
      });
    }
    if (method === "catalog.update") {
      const chat = await this.catalog.updateChat(params.session, {
        ...(params.title !== undefined ? { title: params.title } : {}),
        ...(params.project !== undefined ? { project: params.project } : {}),
        ...(params.cwd !== undefined ? { cwd: params.cwd } : {}),
        ...(params.archived !== undefined ? { archived: params.archived === true } : {}),
        ...(params.deleted !== undefined ? { deleted: params.deleted === true } : {})
      });
      const activeSession = this.sessions.get(chat.canonicalChatId);
      if (activeSession && chat.deleted) {
        activeSession.dispose("Canonical chat was deleted.");
        this.removeSession(activeSession);
      } else if (activeSession) {
        activeSession.connectedResult = {
          ...(activeSession.connectedResult || {}),
          sessionName: chat.title,
          project: chat.project,
          cwd: chat.cwd,
          archived: chat.archived,
          deleted: chat.deleted
        };
        activeSession.publish({
          type: "session_metadata",
          title: chat.title,
          project: chat.project,
          cwd: chat.cwd,
          archived: chat.archived,
          deleted: chat.deleted
        });
      }
      this.broadcastCatalogChanged({ canonicalChatId: chat.canonicalChatId, metadata: true });
      return { chat: { ...chat, presence: this.sessionPresence(chat.canonicalChatId) } };
    }
    if (method === "session.pluginAuthority") {
      if (!client.canControl) throw new AgentServerProtocolError('Plugin revocation requires verified Desktop authority.', 'AGENT_SERVER_AUTH_FAILED');
      this.pluginAuthority.update(params, (key) => this.catalog.resolveAlias(key));
      const affected = [...new Set(this.sessions.values())].filter((session) =>
        !this.pluginAuthority.allows(session.sessionKey, session.pluginSkillSources));
      const results = await Promise.allSettled(affected.map((session) => session.revokePluginAuthority()));
      if (results.some((result) => result.status === 'rejected')) {
        throw new AgentServerProtocolError('Plugin authority is blocked, but runtime cleanup could not be confirmed.', 'AGENT_SERVER_PLUGIN_CLEANUP_FAILED');
      }
      return { revoked: affected.map((session) => session.sessionKey) };
    }
    if (method === "session.attach") return this.attachSession(client, params);
    const session = this.requireSession(params.sessionKey);
    if (!session.clients.has(client)) {
      throw new AgentServerProtocolError("Client is not attached to this canonical chat.", "AGENT_SERVER_AUTH_FAILED");
    }
    if (method === "session.request") {
      if (client.surface === 'tui' && ['prompt', 'steer', 'follow_up'].includes(String(params.type || ''))) session.foregroundTuiClient = client;
      return session.request(client, params.type, params.payload || {}, params.requestContext);
    }
    if (method === "session.detach") {
      session.detach(client);
      return { detached: true, sessionKey: session.sessionKey };
    }
    if (method === "session.stop") {
      session.dispose(String(params.reason || "Session stopped explicitly."));
      this.removeSession(session);
      return { stopped: true, sessionKey: session.sessionKey };
    }
    throw new AgentServerProtocolError(`Unsupported method: ${method}.`);
  }

  async refreshAuthProvider(client, params) {
    const provider = String(params.provider || "").trim();
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(provider)) throw new AgentServerProtocolError("Auth refresh provider is invalid.");
    if (![...this.sessions.values()].some((session) => session.clients.has(client))) {
      throw new AgentServerProtocolError("Auth refresh requires an attached Zyra session.", "AGENT_SERVER_AUTH_FAILED");
    }
    const sessions = [...new Set(this.sessions.values())];
    // Utility operations create disposable SDK runtimes from the shared auth file, so the
    // persistent utility bridge owns no credential snapshot. Only connected chat runtimes refresh.
    const refreshed = await Promise.allSettled(
      sessions.map((session) => session.request(client, "auth.refresh", { provider })),
    );
    const failed = refreshed.filter((result) => result.status === "rejected");
    if (failed.length > 0) {
      throw new AgentServerProtocolError(`Authentication refresh failed in ${failed.length} live session${failed.length === 1 ? "" : "s"}.`);
    }
    return { provider, refreshedSessions: sessions.length };
  }

  async openDesktopWorkspace(client, params) {
    if (client.surface !== "tui") {
      throw new AgentServerProtocolError("Graphical workspace commands require an authenticated TUI client.", "AGENT_SERVER_AUTH_FAILED");
    }
    const sourceCanonicalChatId = String(params.sourceCanonicalChatId || "").trim();
    const sourceSession = this.sessions.get(sourceCanonicalChatId);
    if (!sourceSession || !sourceSession.clients.has(client)) {
      throw new AgentServerProtocolError("The TUI is not attached to its source chat.", "AGENT_SERVER_AUTH_FAILED");
    }
    const foregroundTui = sourceSession.foregroundTuiClient;
    if (foregroundTui !== client) {
      throw new AgentServerProtocolError("Only the foreground TUI for this chat can open graphical workspaces.", "AGENT_SERVER_AUTH_FAILED");
    }
    const operation = String(params.operation || "open");
    const workspace = String(params.workspace || "");
    if (!DESKTOP_WORKSPACE_OPERATIONS.has(operation) || !DESKTOP_WORKSPACE_KINDS.has(workspace)) {
      throw new AgentServerProtocolError("Desktop workspace request is invalid.");
    }
    if (params.background === true && workspace !== "browser") {
      throw new AgentServerProtocolError("Only Browser tabs can open in the background.");
    }
    const selector = String(params.canonicalChatId || "").trim();
    if (params.background === true && selector !== sourceCanonicalChatId) {
      throw new AgentServerProtocolError("Background Browser access is limited to the current TUI chat.", "AGENT_SERVER_AUTH_FAILED");
    }
    const requestedActiveTurnId = params.activeTurnId ? assertAgentServerIdentifier(params.activeTurnId, "active turn id") : null;
    const canonicalActiveTurnId = sourceSession.activeRequestContext?.turnId || null;
    if (params.background === true && canonicalActiveTurnId && !requestedActiveTurnId) {
      throw new AgentServerProtocolError("The active canonical turn must be bound to this Browser grant request.", "AGENT_SERVER_AUTH_FAILED");
    }
    if (requestedActiveTurnId && requestedActiveTurnId !== canonicalActiveTurnId) {
      throw new AgentServerProtocolError("The Browser grant request does not match the active canonical turn.", "AGENT_SERVER_AUTH_FAILED");
    }
    const chat = selector ? await this.catalog.find(selector, { allProjects: true }) : null;
    if (!chat || chat.deleted || chat.archived) {
      throw new AgentServerProtocolError("The requested chat is unavailable.", "AGENT_SERVER_SESSION_NOT_FOUND");
    }
    const desktop = [...this.clients.values()].find((candidate) => candidate.authenticated && candidate.canOpenWorkspace && candidate.socket.writable);
    if (!desktop) {
      throw new AgentServerProtocolError("Zyra Desktop is not connected.", "DESKTOP_WORKSPACE_UNAVAILABLE");
    }
    const requestId = `workspace:${randomUUID()}`;
    const request = {
      operation,
      workspace,
      canonicalChatId: chat.canonicalChatId,
      chatTitle: String(chat.title || "Untitled chat").slice(0, 240),
      project: String(chat.project || chat.cwd || "").slice(0, 2_048),
      url: String(params.url || "").slice(0, 8_192),
      path: String(params.path || "").slice(0, 2_048),
      background: params.background === true,
      focus: params.focus === true,
      newWindow: params.newWindow === true,
      activeTurnId: requestedActiveTurnId
    };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.desktopWorkspaceRequests.delete(requestId);
        if (desktop.socket.writable) this.send(desktop, { type: 'desktop.workspace.cancel', requestId });
        reject(Object.assign(new Error("Zyra Desktop did not answer the workspace request."), { code: "AGENT_SERVER_TIMEOUT", retryable: true }));
      }, DESKTOP_WORKSPACE_TIMEOUT_MS);
      timer.unref?.();
      this.desktopWorkspaceRequests.set(requestId, { owner: desktop, requester: client, resolve, reject, timer });
      this.send(desktop, { type: "desktop.workspace.request", requestId, request });
    });
  }

  notifyDesktopWorkspaceTurn(canonicalChatId, turnId) {
    for (const client of this.clients.values()) {
      if (!client.authenticated || !client.canOpenWorkspace || !client.socket.writable) continue;
      this.send(client, { type: 'desktop.workspace.turn', canonicalChatId, turnId });
    }
  }

  notifyDesktopWorkspaceTurnEnded(canonicalChatId, turnId) {
    for (const client of this.clients.values()) {
      if (!client.authenticated || !client.canOpenWorkspace || !client.socket.writable) continue;
      this.send(client, { type: 'desktop.workspace.turn-ended', canonicalChatId, turnId });
    }
  }

  handleDesktopWorkspaceResponse(client, message) {
    const requestId = String(message.requestId || "");
    const pending = this.desktopWorkspaceRequests.get(requestId);
    if (!pending || pending.owner !== client) {
      throw new AgentServerProtocolError("Desktop workspace response came from a client without matching authority.", "AGENT_SERVER_AUTH_FAILED");
    }
    this.desktopWorkspaceRequests.delete(requestId);
    clearTimeout(pending.timer);
    if (message.ok === true) pending.resolve(message.result || {});
    else pending.reject(Object.assign(new Error(message.error?.message || "Desktop workspace request failed."), message.error || {}));
  }

  async withCanonicalMessageLock(canonicalChatId, operation) {
    const previous = this.canonicalMessageQueues.get(canonicalChatId) || Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.canonicalMessageQueues.set(canonicalChatId, current);
    try {
      return await current;
    } finally {
      if (this.canonicalMessageQueues.get(canonicalChatId) === current) this.canonicalMessageQueues.delete(canonicalChatId);
    }
  }

  sessionPresence(sessionKeyValue) {
    const sessionKey = String(sessionKeyValue || "").trim();
    const session = this.sessions.get(sessionKey);
    if (!session) return {
      state: "detached",
      activeTurnId: null,
      clients: [],
      backgroundWorkActive: false,
      attention: null,
      latestTurn: null
    };
    const activeTurnId = session.activeRequestContext?.turnId || null;
    const turnRunning = Boolean(activeTurnId && session.latestTurn?.id === activeTurnId && session.latestTurn.state === "running");
    return {
      state: turnRunning ? "running" : session.hasBackgroundWork() ? "background" : "ready",
      activeTurnId: turnRunning ? activeTurnId : null,
      clients: [...session.clients].map((client) => ({ clientId: client.clientId, surface: client.surface })),
      backgroundWorkActive: session.hasBackgroundWork(),
      attention: session.pendingUserInputRequestIds.size > 0 ? "user-input" : session.pendingApprovalRequestIds.size > 0 ? "approval" : null,
      latestTurn: session.latestTurn ? { ...session.latestTurn } : null,
      latestSequence: session.sequence
    };
  }

  getUtilityWorker() {
    if (this.utilityWorker?.isAlive()) return this.utilityWorker;
    this.utilityWorker = this.createWorker({ root: this.root, cwd: this.root });
    this.utilityWorker.on("stderr", (text) => this.emit("worker-stderr", { sessionKey: "utility", text }));
    this.utilityWorker.on("worker-error", (error) => this.emit("worker-error", { sessionKey: "utility", error }));
    this.utilityWorker.on("exit", () => { this.utilityWorker = null; });
    return this.utilityWorker;
  }

  async attachSession(client, params) {
    const project = this.catalog.registerProject(params.project || params.cwd);
    const requestedCandidate = params.session
      ? await this.catalog.find(params.session, { project, includeDeleted: true })
      : null;
    if (requestedCandidate?.deleted) {
      throw new AgentServerProtocolError("Canonical chat was deleted and cannot be reattached.", "AGENT_SERVER_SESSION_NOT_FOUND");
    }
    const requested = requestedCandidate;
    const requestedCanonicalId = requested?.canonicalChatId || this.catalog.resolveAlias(params.session || params.localThreadId || "");
    const sessionProject = params.project || requested?.project || project;
    const sessionCwd = params.cwd || requested?.cwd || requested?.project || project;
    const provisionalKey = requestedCanonicalId || `pending:${assertAgentServerIdentifier(params.localThreadId || randomUUID(), "local thread id")}`;
    let session = this.sessions.get(provisionalKey);
    const connectionPayload = { ...params, cwd: sessionCwd };
    this.pluginAuthority.assertAllowed(provisionalKey, params.pluginSkillSources || []);
    if (session?.revocationPromise) await session.revocationPromise;
    if (session?.disposed) session = null;
    if (session?.requiresAuthorityReconnect(connectionPayload)) {
      if (session.activeRequests > 0 || session.hasBackgroundWork()) {
        throw new AgentServerProtocolError(
          "Chat filesystem scope changed while canonical work is still active.",
          "AGENT_SERVER_SESSION_BUSY"
        );
      }
      session.dispose("Chat filesystem scope changed; reconnecting with the saved scope.");
      this.removeSession(session);
      session = null;
    }
    if (!session) {
      session = new ServerOwnedSession({
        server: this,
        sessionKey: provisionalKey,
        root: this.root,
        cwd: sessionCwd,
        createWorker: this.createWorker,
        idleTimeoutMs: this.idleTimeoutMs,
        journalDirectory: this.paths.journalDirectory
      });
      this.sessions.set(provisionalKey, session);
    }
    try {
      const connected = await session.connect({
        ...params,
        cwd: sessionCwd,
        project: sessionProject,
        threadId: requested?.sessionPath || params.session,
        providerThreadId: requested?.sessionPath || params.session
      });
      const canonicalChatId = String(connected.threadId || connected.providerThreadId || requestedCanonicalId || provisionalKey);
      this.pluginAuthority.bindCanonicalKey(provisionalKey, canonicalChatId);
      this.pluginAuthority.assertAllowed(canonicalChatId, params.pluginSkillSources || []);
      if (session.disposed || session.revocationPromise) throw new AgentServerProtocolError('Chat Plugin authority was revoked during connect.', 'AGENT_SERVER_PLUGIN_AUTHORITY_REVOKED');
      session.connectedResult = {
        ...connected,
        sessionName: connected.sessionName || requested?.title || undefined,
        project: sessionProject,
        cwd: sessionCwd
      };
      session.setCanonicalKey(canonicalChatId);
      this.sessions.set(canonicalChatId, session);
      for (const [key, candidate] of this.sessions) {
        if (candidate === session && key !== canonicalChatId) this.sessions.delete(key);
      }
      this.catalog.recordAttachment({
        canonicalChatId,
        project: sessionProject,
        localThreadId: params.localThreadId,
        aliases: [params.session],
        surface: client.surface
      });
      this.broadcastCatalogChanged({ canonicalChatId, project: sessionProject });
    } catch (error) {
      if (session.revocationPromise) await session.revocationPromise.catch(() => undefined);
      else {
        session.dispose("Session connection failed.");
        this.removeSession(session);
      }
      throw error;
    }
    session.attach(client);
    const lastSequence = Math.max(0, Number(params.lastSequence) || 0);
    return {
      sessionKey: session.sessionKey,
      canonicalChatId: session.sessionKey,
      connected: session.connectedResult,
      replay: session.replay(lastSequence),
      latestSequence: session.sequence,
      activeRequestContext: session.latestTurn?.state === "running" ? session.activeRequestContext : null,
      presence: this.sessionPresence(session.sessionKey)
    };
  }

  requireSession(sessionKeyValue) {
    const sessionKey = String(sessionKeyValue || "").trim();
    const session = this.sessions.get(sessionKey);
    if (!session) throw new AgentServerProtocolError("Agent-server session was not found.", "AGENT_SERVER_SESSION_NOT_FOUND");
    return session;
  }

  routeControlRequest(session, message) {
    if ((session.disposed || session.revocationPromise) && message.type !== 'control.cancel' && message.operation?.operation !== 'revoke_current_principal') {
      session.worker.sendControlResponse({ type: 'control.response', requestId: message.requestId, ok: false,
        error: { code: 'CONTROL_CANCELLED', message: 'Chat Plugin authority was revoked.', retryable: false } });
      return;
    }
    if (message.type === "control.cancel") {
      const owner = session.controlOwners.get(message.requestId);
      if (owner) this.send(owner, { ...message, sessionKey: session.sessionKey, requestContext: session.activeRequestContext });
      return;
    }
    const client = [...session.clients].find((candidate) => candidate.authenticated && candidate.canControl && candidate.socket.writable)
      || [...this.clients.values()].find((candidate) => candidate.authenticated && candidate.canControl && candidate.socket.writable);
    if (!client) {
      session.worker.sendControlResponse({
        type: "control.response",
        requestId: message.requestId,
        ok: false,
        error: { code: "CONTROL_DRIVER_UNAVAILABLE", message: "No attached desktop client owns control authority for this chat.", retryable: true }
      });
      return;
    }
    session.controlOwners.set(message.requestId, client);
    this.send(client, { ...message, sessionKey: session.sessionKey, requestContext: session.activeRequestContext });
  }

  handleControlResponse(client, message) {
    const session = this.requireSession(message.sessionKey);
    const owner = session.controlOwners.get(message.requestId);
    if (owner !== client) throw new AgentServerProtocolError("Control response came from a client without matching authority.", "AGENT_SERVER_AUTH_FAILED");
    session.controlOwners.delete(message.requestId);
    session.worker.sendControlResponse({
      type: "control.response",
      requestId: message.requestId,
      ok: message.ok === true,
      ...(message.ok === true ? { result: message.result || {} } : { error: message.error || { code: "CONTROL_ERROR", message: "Control request failed.", retryable: false } })
    });
  }

  dropClient(client) {
    clearTimeout(client.handshakeTimer);
    client.cleanupReader?.();
    this.clients.delete(client.connectionId);
    for (const [requestId, pending] of this.desktopWorkspaceRequests) {
      if (pending.owner !== client && pending.requester !== client) continue;
      this.desktopWorkspaceRequests.delete(requestId);
      clearTimeout(pending.timer);
      if (pending.requester === client && pending.owner?.socket?.writable) this.send(pending.owner, { type: 'desktop.workspace.cancel', requestId })
      pending.reject(Object.assign(new Error(pending.owner === client ? "Zyra Desktop disconnected before opening the workspace." : "The requesting TUI disconnected."), { code: "DESKTOP_WORKSPACE_UNAVAILABLE", retryable: true }));
    }
    for (const session of new Set(this.sessions.values())) session.detach(client);
  }

  broadcastCatalogChanged(change) {
    for (const client of this.clients.values()) {
      if (client.authenticated) this.send(client, { type: "catalog.changed", change, occurredAt: new Date().toISOString() });
    }
  }

  removeSession(session) {
    for (const [key, candidate] of this.sessions) if (candidate === session) this.sessions.delete(key);
  }

  send(client, message) {
    try {
      return writeAgentServerMessage(client.socket, message);
    } catch (error) {
      this.emit("protocol-send-error", { connectionId: client.connectionId, messageType: message?.type, error });
      try {
        if (message?.type === "response" && message.id) {
          return writeAgentServerMessage(client.socket, {
            type: "response",
            id: message.id,
            ok: false,
            error: { code: "AGENT_SERVER_RESPONSE_TOO_LARGE", message: "Agent-server response exceeded the transport limit.", retryable: true }
          });
        }
        if (message?.type === "session.event") {
          return writeAgentServerMessage(client.socket, {
            type: "session.event",
            sessionKey: message.sessionKey,
            sequence: message.sequence,
            occurredAt: message.occurredAt,
            requestContext: message.requestContext,
            event: { type: "zyra_server_event_omitted", reason: "transport-limit" }
          });
        }
      } catch {}
      return false;
    }
  }

  sendError(client, id, error) {
    const message = error instanceof Error ? error.message : String(error || "Agent-server request failed.");
    this.send(client, {
      type: "response",
      ...(id ? { id: String(id) } : {}),
      ok: false,
      error: {
        code: error?.code || "AGENT_SERVER_ERROR",
        message,
        retryable: Boolean(error?.retryable)
      }
    });
  }

  writeDescriptor() {
    mkdirSync(this.paths.stateDirectory, { recursive: true });
    const temporary = `${this.paths.descriptorFile}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.descriptor(), null, 2), { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, this.paths.descriptorFile);
  }
}

function canonicalConnectionAuthorityKey(payload) {
  const normalizePath = (value) => {
    const normalized = String(value || "").trim();
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
  };
  const scope = payload?.filesystemScope && typeof payload.filesystemScope === "object"
    ? payload.filesystemScope
    : null;
  const roots = Array.isArray(scope?.roots)
    ? scope.roots.map((root) => ({
        id: String(root?.id || ""),
        kind: root?.kind === "project-home" ? "project-home" : "associated-folder",
        path: normalizePath(root?.path),
        access: root?.access === "read-only" ? "read-only" : "read-write"
      }))
    : [];
  const pluginSkillSources = Array.isArray(payload?.pluginSkillSources)
    ? payload.pluginSkillSources.slice(0, 24).map((source) => ({
        pluginId: String(source?.pluginId || ""),
        releaseId: String(source?.releaseId || ""),
        contentDigest: String(source?.contentDigest || ""),
        dir: normalizePath(source?.dir),
        scope: source?.scope === "project" ? "project" : "personal"
      }))
    : [];
  return JSON.stringify({
    cwd: normalizePath(payload?.cwd),
    projectId: String(scope?.projectId || ""),
    revision: Number(scope?.revision) || 0,
    workingRoot: normalizePath(scope?.workingRoot),
    roots,
    pluginSkillSources
  });
}

class ServerOwnedSession {
  constructor(options) {
    this.server = options.server;
    this.sessionKey = options.sessionKey;
    this.worker = options.createWorker({ root: options.root, cwd: options.cwd });
    this.idleTimeoutMs = options.idleTimeoutMs;
    this.clients = new Set();
    this.foregroundTuiClient = null;
    this.controlOwners = new Map();
    this.events = [];
    this.sequence = 0;
    this.journalDirectory = options.journalDirectory;
    this.journal = null;
    this.activeRequests = 0;
    this.activeRequestContext = null;
    this.latestTurn = null;
    this.pendingApprovalRequestIds = new Set();
    this.pendingUserInputRequestIds = new Set();
    this.userInputResponseStates = new Map();
    this.backgroundFleetActive = false;
    this.managedJobIds = new Set();
    this.connectPromise = null;
    this.connectedResult = null;
    this.connectionAuthorityKey = null;
    this.pluginSkillSources = [];
    this.revocationPromise = null;
    this.latestFleetSnapshot = null;
    this.idleTimer = null;
    this.disposed = false;
    if (!this.sessionKey.startsWith("pending:")) this.openJournal(this.sessionKey);
    this.worker.on("event", (event) => this.publish(event));
    this.worker.on("control", (message) => this.server.routeControlRequest(this, message));
    this.worker.on("stderr", (text) => this.server.emit("worker-stderr", { sessionKey: this.sessionKey, text }));
    this.worker.on("worker-error", (error) => this.server.emit("worker-error", { sessionKey: this.sessionKey, error }));
    this.worker.on("exit", ({ error }) => {
      this.publish({ type: "server.worker.exited", error: error.message });
      this.server.removeSession(this);
    });
  }

  requiresAuthorityReconnect(payload) {
    if ((!this.connectedResult && !this.connectPromise) || !this.connectionAuthorityKey) return false;
    return this.connectionAuthorityKey !== canonicalConnectionAuthorityKey(payload);
  }

  connect(payload) {
    if (this.connectedResult) return Promise.resolve(this.connectedResult);
    if (!this.connectPromise) {
      this.connectionAuthorityKey = canonicalConnectionAuthorityKey(payload);
      this.pluginSkillSources = structuredClone(payload.pluginSkillSources || []);
      this.connectPromise = this.worker.request("connect", payload, { timeoutMs: BRIDGE_CONNECT_TIMEOUT_MS })
        .then((result) => {
          const connected = projectConnectedResult(result);
          const fleet = selectCurrentFleetSnapshot(connected?.fleet, this.latestFleetSnapshot);
          this.latestFleetSnapshot = fleet;
          this.connectedResult = fleet ? { ...connected, fleet } : connected;
          return this.connectedResult;
        })
        .catch((error) => {
          this.connectPromise = null;
          this.connectionAuthorityKey = null;
          throw error;
        });
    }
    return this.connectPromise;
  }

  setCanonicalKey(value) {
    const canonicalChatId = String(value || this.sessionKey);
    if (canonicalChatId === this.sessionKey && this.journal) return;
    this.sessionKey = canonicalChatId;
    this.openJournal(canonicalChatId);
  }

  openJournal(canonicalChatId) {
    const pendingEvents = this.events;
    const journal = new AgentEventJournal(this.journalDirectory, canonicalChatId);
    this.journal = journal;
    this.events = journal.replay(0);
    this.sequence = journal.latestSequence();
    for (const pending of pendingEvents) {
      const entry = { ...pending, sequence: ++this.sequence };
      this.events.push(entry);
      this.journal.append(entry);
    }
    if (this.events.length > MAX_AGENT_SERVER_REPLAY_EVENTS) {
      this.events.splice(0, this.events.length - MAX_AGENT_SERVER_REPLAY_EVENTS);
    }
    this.rebuildLatestTurnSummary();
    for (const entry of this.events) {
      const fleet = entry?.event?.fleet || entry?.event?.fleetSnapshot;
      this.latestFleetSnapshot = selectCurrentFleetSnapshot(this.latestFleetSnapshot, fleet);
    }
    if (this.latestFleetSnapshot) {
      this.updateBackgroundWork({ fleet: this.latestFleetSnapshot });
      if (this.connectedResult) this.connectedResult = { ...this.connectedResult, fleet: this.latestFleetSnapshot };
    }
  }

  attach(client) {
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.clients.add(client);
    if (client.surface === 'tui' && (!this.foregroundTuiClient || !this.clients.has(this.foregroundTuiClient))) this.foregroundTuiClient = client;
    client.attachedSessionIds.add(this.sessionKey);
    this.server.broadcastCatalogChanged({ canonicalChatId: this.sessionKey, presence: true });
  }

  detach(client) {
    this.clients.delete(client);
    if (this.foregroundTuiClient === client) this.foregroundTuiClient = [...this.clients].find((candidate) => candidate.surface === 'tui') || null;
    client.attachedSessionIds.delete(this.sessionKey);
    for (const [requestId, owner] of this.controlOwners) {
      if (owner !== client) continue;
      this.controlOwners.delete(requestId);
      this.worker.sendControlResponse({
        type: "control.response",
        requestId,
        ok: false,
        error: { code: "CONTROL_DRIVER_UNAVAILABLE", message: "Desktop control authority disconnected.", retryable: true }
      });
    }
    this.server.broadcastCatalogChanged({ canonicalChatId: this.sessionKey, presence: true });
    this.scheduleIdleStop();
  }

  async appendCanonicalMessage(input) {
    if (this.activeRequestContext) {
      throw new AgentServerProtocolError("Canonical Voice cannot append while the strong foreground turn is active.", "AGENT_SERVER_SESSION_BUSY");
    }
    const result = await this.worker.request("canonical_message.append", input);
    return result.receipt || null;
  }

  async findCanonicalMessageReceipt(operationId) {
    const result = await this.worker.request("canonical_message.find", { operationId });
    return result.receipt || null;
  }

  async request(client, typeValue, payload, requestContextValue) {
    if (this.disposed || this.revocationPromise) throw new AgentServerProtocolError('Chat Plugin authority was revoked.', 'AGENT_SERVER_PLUGIN_AUTHORITY_REVOKED');
    this.server.pluginAuthority.assertAllowed(this.sessionKey, this.pluginSkillSources);
    const type = String(typeValue || "");
    if (!BRIDGE_REQUEST_PATTERN.test(type)) throw new AgentServerProtocolError(`Bridge request type is not allowed: ${type || "missing"}.`);
    let userInputResponsePromise = null;
    if (type === "user_input.respond") {
      const requestId = String(payload?.requestId || "").trim();
      if (!requestId) throw new AgentServerProtocolError("User-input responses require a request id.", "AGENT_SERVER_USER_INPUT_INVALID");
      const ownerClientId = String(client?.clientId || "unknown");
      const existing = this.userInputResponseStates.get(requestId);
      if (existing) {
        if (existing.ownerClientId !== ownerClientId) {
          throw new AgentServerProtocolError("This user-input request was already answered by another attached surface.", "AGENT_SERVER_USER_INPUT_ALREADY_ANSWERED");
        }
        userInputResponsePromise = existing.promise;
      } else {
        if (!this.pendingUserInputRequestIds.has(requestId)) {
          throw new AgentServerProtocolError(`Unknown user-input request: ${requestId}`, "AGENT_SERVER_USER_INPUT_UNKNOWN");
        }
        const state = { ownerClientId, promise: null, settled: false };
        state.promise = Promise.resolve().then(() => this.worker.request(type, payload)).then((result) => {
          state.settled = true;
          while (this.userInputResponseStates.size > 128) {
            const removable = [...this.userInputResponseStates].find(([, candidate]) => candidate.settled);
            if (!removable) break;
            this.userInputResponseStates.delete(removable[0]);
          }
          return result;
        }, (error) => {
          if (this.userInputResponseStates.get(requestId) === state) this.userInputResponseStates.delete(requestId);
          throw error;
        });
        this.userInputResponseStates.set(requestId, state);
        userInputResponsePromise = state.promise;
      }
    }
    const requestContext = normalizeRequestContext(requestContextValue);
    if (type === "prompt" && !requestContext?.turnId) {
      throw new AgentServerProtocolError("Prompt requests require a durable turn id.");
    }
    if (type === "prompt" && this.activeRequestContext) {
      throw new AgentServerProtocolError("This canonical chat already has an active turn.", "AGENT_SERVER_SESSION_BUSY");
    }
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.activeRequests += 1;
    if (type === "prompt") {
      this.activeRequestContext = requestContext;
      const startedAt = new Date().toISOString();
      this.latestTurn = {
        id: requestContext.turnId,
        state: "running",
        requestedAt: startedAt,
        startedAt,
        completedAt: null,
        assistantMessageId: null
      };
      this.server.broadcastCatalogChanged({ canonicalChatId: this.sessionKey, presence: true });
      this.server.notifyDesktopWorkspaceTurn(this.sessionKey, requestContext.turnId);
    }
    try {
      const result = await (userInputResponsePromise || this.worker.request(type, payload));
      if (type === "prompt" && !this.isTurnTerminal(requestContext.turnId)) {
        this.publish({ type: "zyra_server_turn_completed", outcome: "completed" });
      }
      return result;
    } catch (error) {
      if (type === "prompt" && !this.isTurnTerminal(requestContext.turnId)) {
        const errorMessage = error instanceof Error ? error.message : String(error || "Zyra prompt failed.");
        const interrupted = isNetworkRecoveryError(error)
          || /\b(?:abort(?:ed)?|cancel(?:led|ed)?|interrupt(?:ed)?|stopp?ed)\b/i.test(errorMessage);
        this.publish({
          type: "zyra_server_turn_completed",
          outcome: interrupted ? "interrupted" : "failed",
          errorMessage
        });
      }
      throw error;
    } finally {
      this.activeRequests = Math.max(0, this.activeRequests - 1);
      if (type === "prompt") this.server.notifyDesktopWorkspaceTurnEnded(this.sessionKey, requestContext.turnId);
      if (type === "prompt" && this.activeRequestContext === requestContext) {
        this.activeRequestContext = null;
        this.server.broadcastCatalogChanged({ canonicalChatId: this.sessionKey });
      }
      this.scheduleIdleStop();
    }
  }

  publish(event) {
    if (this.revocationPromise && (event?.type === 'agent_end' || event?.type === 'zyra_server_turn_completed')) {
      event = { type: 'zyra_server_turn_completed', outcome: 'interrupted', turnId: event.turnId || this.latestTurn?.id };
    }
    const userInputResponseState = event?.type === "user_input_resolved" && event.requestId
      ? this.userInputResponseStates.get(String(event.requestId))
      : null;
    if (userInputResponseState && !event.responseOwnerClientId) {
      event = { ...event, responseOwnerClientId: userInputResponseState.ownerClientId };
    }
    const occurredAt = new Date().toISOString();
    const publishedRequestContext = this.activeRequestContext;
    const previousAttention = this.pendingApprovalRequestIds.size > 0 || this.pendingUserInputRequestIds.size > 0;
    const previousBackgroundWork = this.hasBackgroundWork();
    this.updateBackgroundWork(event);
    this.updateRuntimeSummary(event, publishedRequestContext, occurredAt);
    if (event?.type === "session_config") {
      const config = {
        model: event.model,
        thinking: event.thinking,
        profile: event.profile,
        runtimeMode: event.runtimeMode,
        webSearch: event.webSearch,
        webFetch: event.webFetch
      };
      this.connectedResult = { ...(this.connectedResult || {}), ...config, config };
    }
    const fleetSnapshot = event?.fleet || event?.fleetSnapshot;
    if (fleetSnapshot && typeof fleetSnapshot === "object" && !Array.isArray(fleetSnapshot)) {
      this.latestFleetSnapshot = selectCurrentFleetSnapshot(this.latestFleetSnapshot, fleetSnapshot);
      this.connectedResult = { ...(this.connectedResult || {}), fleet: this.latestFleetSnapshot };
    }
    if (event?.type === "session_title" && event.title) {
      void this.server.catalog.updateChat(this.sessionKey, { title: event.title }).then(() => {
        this.server.broadcastCatalogChanged({ canonicalChatId: this.sessionKey, title: true });
      });
    }
    const entry = {
      sequence: ++this.sequence,
      occurredAt,
      event,
      ...(publishedRequestContext ? { requestContext: publishedRequestContext } : {})
    };
    this.events.push(entry);
    try {
      this.journal?.append(entry);
    } catch (error) {
      this.server.emit("journal-error", { sessionKey: this.sessionKey, error });
    }
    if (this.events.length > MAX_AGENT_SERVER_REPLAY_EVENTS) this.events.splice(0, this.events.length - MAX_AGENT_SERVER_REPLAY_EVENTS);
    for (const client of this.clients) {
      this.server.send(client, { type: "session.event", sessionKey: this.sessionKey, ...entry });
    }
    if (
      publishedRequestContext
      && this.activeRequestContext === publishedRequestContext
      && ((event?.type === "agent_end" && event.willRetry !== true) || event?.type === "zyra_server_turn_completed")
    ) {
      this.activeRequestContext = null;
      this.server.broadcastCatalogChanged({ canonicalChatId: this.sessionKey, presence: true });
    }
    if (
      previousAttention !== (this.pendingApprovalRequestIds.size > 0 || this.pendingUserInputRequestIds.size > 0)
      || previousBackgroundWork !== this.hasBackgroundWork()
      || (event?.type === "auto_retry_end" && event.success === false)
    ) {
      this.server.broadcastCatalogChanged({ canonicalChatId: this.sessionKey, presence: true });
    }
    this.scheduleIdleStop();
  }

  isTurnTerminal(turnIdValue) {
    const turnId = String(turnIdValue || "").trim();
    return Boolean(
      turnId
      && this.latestTurn?.id === turnId
      && this.latestTurn.completedAt
      && this.latestTurn.state !== "running"
    );
  }

  rebuildLatestTurnSummary() {
    this.latestTurn = null;
    for (const entry of this.events) {
      this.updateLatestTurnSummary(entry.event, entry.requestContext, entry.occurredAt);
    }
  }

  updateRuntimeSummary(event, requestContext, occurredAt) {
    if (event?.type === "approval_requested" && event.requestId) {
      this.pendingApprovalRequestIds.add(String(event.requestId));
    }
    if (event?.type === "approval_resolved" && event.requestId) {
      this.pendingApprovalRequestIds.delete(String(event.requestId));
    }
    if (event?.type === "user_input_requested" && event.requestId) {
      this.pendingUserInputRequestIds.add(String(event.requestId));
    }
    if (event?.type === "user_input_resolved" && event.requestId) {
      this.pendingUserInputRequestIds.delete(String(event.requestId));
    }
    this.updateLatestTurnSummary(event, requestContext, occurredAt);
    if (event?.type === "zyra_server_turn_completed") {
      this.pendingApprovalRequestIds.clear();
      this.pendingUserInputRequestIds.clear();
    }
  }

  updateLatestTurnSummary(event, requestContext, occurredAt) {
    const turnId = String(requestContext?.turnId || event?.turnId || "").trim();
    if (turnId && this.latestTurn?.id !== turnId) {
      this.latestTurn = {
        id: turnId,
        state: "running",
        requestedAt: occurredAt,
        startedAt: occurredAt,
        completedAt: null,
        assistantMessageId: null
      };
    }
    if (event?.type === "message_end" && event.message?.role === "assistant" && event.message.id && this.latestTurn) {
      this.latestTurn = { ...this.latestTurn, assistantMessageId: String(event.message.id) };
    }
    if (event?.type === "auto_retry_end" && event.success === false && this.latestTurn) {
      this.latestTurn = {
        ...this.latestTurn,
        state: isNetworkRecoveryError(event.finalError) ? "interrupted" : "error",
        completedAt: occurredAt
      };
      return;
    }
    if (event?.type === "agent_end" && event.willRetry === true) return;
    if (event?.type !== "zyra_server_turn_completed" && event?.type !== "agent_end") return;
    const completedTurnId = turnId || this.latestTurn?.id;
    if (!completedTurnId) return;
    const base = this.latestTurn?.id === completedTurnId
      ? this.latestTurn
      : {
          id: completedTurnId,
          requestedAt: occurredAt,
          startedAt: occurredAt,
          assistantMessageId: null
        };
    const outcome = event?.type === "agent_end" ? "completed" : String(event.outcome || "completed");
    this.latestTurn = {
      ...base,
      state: outcome === "failed" ? "error" : outcome === "interrupted" ? "interrupted" : "completed",
      completedAt: occurredAt
    };
  }

  updateBackgroundWork(event) {
    if (!event || typeof event !== "object") return;
    if (event.type === "managed_bash_job_update" && event.jobId) {
      if (event.status === "running") this.managedJobIds.add(String(event.jobId));
      else this.managedJobIds.delete(String(event.jobId));
    }
    const fleet = event.fleet || event.fleetSnapshot;
    if (fleet && typeof fleet === "object") {
      const agents = Object.values(fleet.agents || {});
      const workflows = Object.values(fleet.workflows || {});
      this.backgroundFleetActive = [...agents, ...workflows].some((run) => ACTIVE_FLEET_STATUSES.has(String(run?.status || "")));
    }
  }

  hasBackgroundWork() {
    return this.backgroundFleetActive || this.managedJobIds.size > 0;
  }

  replay(afterSequence) {
    return this.events.filter((entry) => entry.sequence > afterSequence);
  }

  summary() {
    return {
      sessionKey: this.sessionKey,
      clients: [...this.clients].map((client) => ({ clientId: client.clientId, surface: client.surface })),
      activeRequests: this.activeRequests,
      activeRequestContext: this.activeRequestContext,
      latestTurn: this.latestTurn ? { ...this.latestTurn } : null,
      attention: this.pendingUserInputRequestIds.size > 0 ? "user-input" : this.pendingApprovalRequestIds.size > 0 ? "approval" : null,
      backgroundWorkActive: this.hasBackgroundWork(),
      latestSequence: this.sequence,
      alive: this.worker.isAlive()
    };
  }

  scheduleIdleStop() {
    if (this.disposed || this.clients.size > 0 || this.activeRequests > 0 || this.hasBackgroundWork() || this.idleTimer) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.clients.size > 0 || this.activeRequests > 0 || this.hasBackgroundWork()) return;
      this.dispose("Detached session reached its idle timeout.");
      this.server.removeSession(this);
    }, this.idleTimeoutMs);
    this.idleTimer.unref?.();
  }

  revokePluginAuthority() {
    if (this.revocationPromise) return this.revocationPromise;
    // Install the barrier before invoking any asynchronous worker cleanup.
    this.revocationPromise = Promise.resolve().then(async () => {
      const turnId = this.activeRequestContext?.turnId;
      for (const [requestId, owner] of this.controlOwners) {
        this.server.send(owner, { type: 'control.cancel', requestId, sessionKey: this.sessionKey });
      }
      if (turnId) this.publish({ type: 'zyra_server_turn_completed', outcome: 'interrupted', turnId });
      try {
        const result = await this.worker.request('plugin.revoke', {}, { timeoutMs: 15_000 });
        if (result?.revoked !== true) throw new Error('Worker did not acknowledge Plugin cleanup.');
      } finally {
        if (turnId) this.server.notifyDesktopWorkspaceTurnEnded(this.sessionKey, turnId);
        this.dispose('Chat Plugin authority revoked.');
        this.server.removeSession(this);
      }
    });
    return this.revocationPromise;
  }

  dispose(reason) {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.idleTimer);
    this.worker.dispose(reason);
    for (const client of this.clients) client.attachedSessionIds.delete(this.sessionKey);
    this.clients.clear();
    this.controlOwners.clear();
  }
}

function selectCurrentFleetSnapshot(current, incoming) {
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) return current || null;
  if (!current || typeof current !== "object" || Array.isArray(current)) return incoming;
  const currentSequence = Math.max(0, Number(current.lastAppliedSequence) || 0);
  const incomingSequence = Math.max(0, Number(incoming.lastAppliedSequence) || 0);
  if (incomingSequence !== currentSequence) return incomingSequence > currentSequence ? incoming : current;
  const currentRecords = Object.keys(current.agents || {}).length + Object.keys(current.workflows || {}).length;
  const incomingRecords = Object.keys(incoming.agents || {}).length + Object.keys(incoming.workflows || {}).length;
  return incomingRecords >= currentRecords ? incoming : current;
}

function projectConnectedResult(connectedResult) {
  if (!Array.isArray(connectedResult?.messages)) return connectedResult;
  return {
    ...connectedResult,
    messages: connectedResult.messages.filter((message) => message?.role !== "toolResult")
  };
}
