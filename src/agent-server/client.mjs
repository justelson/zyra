import { RUNTIME_ACTIVATION_VERSION, readRuntimeRevision } from "./runtime-revision.mjs";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { constants as fsConstants, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { getAgentServerPaths } from "./paths.mjs";
import {
  AGENT_SERVER_PROTOCOL_VERSION,
  AGENT_SERVER_METHODS,
  createAgentServerLineReader,
  writeAgentServerMessage
} from "./protocol.mjs";

const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;
const DEFAULT_ATTACH_TIMEOUT_MS = 65_000;
// Bound replacement across connection objects recreated by Desktop recovery.
const SERVICE_UPGRADE_ATTEMPTS = new Set();

export class ZyraAgentServerClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.root = path.resolve(options.root || path.resolve(import.meta.dirname, "../.."));
    this.paths = getAgentServerPaths(options);
    this.dataRoot = path.resolve(options.dataRoot || process.env.ZYRA_DATA_ROOT || os.homedir());
    this.clientId = String(options.clientId || `agent-client:${process.pid}`);
    this.surface = String(options.surface || "unknown");
    this.authorities = Array.isArray(options.authorities) ? [...new Set(options.authorities)] : [];
    this.authorityProof = String(options.authorityProof || "");
    this.autoStart = options.autoStart !== false;
    this.requiredMethods = options.requiredMethods || AGENT_SERVER_METHODS;
    this.serverMethods = [];
    this.serverRuntimeRevision = null;
    this.verifyRuntimeRevision = options.verifyRuntimeRevision ?? this.autoStart;
    this.socket = null;
    this.cleanupReader = null;
    this.pending = new Map();
    this.nextRequestId = 1;
    this.connectPromise = null;
    this.helloResolve = null;
    this.helloReject = null;
    this.controlHandler = null;
    this.desktopWorkspaceHandler = null;
    this.desktopWorkspaceCancelHandler = null;
    this.desktopWorkspaceTurnHandler = null;
    this.desktopWorkspaceTurnEndHandler = null;
  }

  setControlHandler(handler) {
    this.controlHandler = typeof handler === "function" ? handler : null;
  }

  setDesktopWorkspaceHandler(handler) {
    this.desktopWorkspaceHandler = typeof handler === "function" ? handler : null;
  }

  setDesktopWorkspaceCancelHandler(handler) {
    this.desktopWorkspaceCancelHandler = typeof handler === "function" ? handler : null;
  }

  setDesktopWorkspaceTurnHandler(handler) {
    this.desktopWorkspaceTurnHandler = typeof handler === "function" ? handler : null;
  }

  setDesktopWorkspaceTurnEndHandler(handler) {
    this.desktopWorkspaceTurnEndHandler = typeof handler === "function" ? handler : null;
  }

  async connect() {
    if (this.connectPromise) return this.connectPromise;
    if (this.socket?.writable) return;
    this.connectPromise = this.connectInternal().finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  async connectInternal() {
    const expectedRevision = this.verifyRuntimeRevision ? await readRuntimeRevision(this.root) : null;
    let descriptor = readDescriptor(this.paths.descriptorFile);
    if (!descriptor && this.autoStart) {
      assertNoLiveIncompatibleAgentServer(this.paths);
      this.startServer();
      descriptor = await waitForDescriptor(this.paths.descriptorFile, DEFAULT_CONNECT_TIMEOUT_MS, undefined, this.paths);
    }
    if (!descriptor) throw Object.assign(new Error("Zyra agent server is not running."), { code: "AGENT_SERVER_UNAVAILABLE" });
    try {
      await this.openSocket(descriptor);
    } catch (error) {
      if (!this.autoStart) throw error;
      assertNoLiveIncompatibleAgentServer(this.paths);
      this.startServer();
      descriptor = await waitForDescriptor(this.paths.descriptorFile, DEFAULT_CONNECT_TIMEOUT_MS, descriptor.pid, this.paths);
      await this.openSocket(descriptor);
    }
    const missing = () => this.requiredMethods.filter((method) => !this.serverMethods.includes(method));
    const revisionMatches = () => !expectedRevision || this.serverRuntimeRevision === expectedRevision;
    if (missing().length === 0 && revisionMatches()) {
      this.emit("runtime-status", { phase: "ready", revision: this.serverRuntimeRevision }); return;
    }
    this.emit("runtime-status", { phase: "checking" });
    const upgradeError = () => Object.assign(new Error("Zyra's background service is older than this app. Restart the background service to finish updating, then try again."), { code: "AGENT_SERVER_UPGRADE_REQUIRED", missingMethods: missing() });
    const upgradeKey = JSON.stringify([this.root, this.paths.descriptorFile, [...this.requiredMethods].sort(), expectedRevision]);
    try {
      if (!this.autoStart || !this.serverMethods.includes("server.retire") || SERVICE_UPGRADE_ATTEMPTS.has(upgradeKey)) throw upgradeError();
      const retired = await this.requestConnected("server.retire", { activationVersion: RUNTIME_ACTIVATION_VERSION, expectedRevision }, { timeoutMs: 5_000 });
      if (retired.retiring !== true) throw upgradeError();
      SERVICE_UPGRADE_ATTEMPTS.add(upgradeKey);
      this.emit("runtime-status", { phase: "restarting" });
      this.close();
      const deadline = Date.now() + 10_000;
      while (processAlive(descriptor.pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 75));
      if (processAlive(descriptor.pid)) throw upgradeError();
      this.startServer();
      descriptor = await waitForDescriptor(this.paths.descriptorFile, DEFAULT_CONNECT_TIMEOUT_MS, descriptor.pid, this.paths);
      await this.openSocket(descriptor);
      // A competing older client can win startup. Never enter an upgrade loop.
      if (missing().length > 0 || !revisionMatches()) throw upgradeError();
      this.emit("runtime-status", { phase: "ready", revision: this.serverRuntimeRevision });
    } catch (error) {
      this.emit("runtime-status", { phase: error.code === "AGENT_SERVER_UPGRADE_BUSY" ? "waiting" : "failed" });
      this.close();
      throw error;
    }
  }

  async openSocket(descriptor) {
    const socket = net.createConnection(descriptor.endpoint);
    this.socket = socket;
    socket.setNoDelay(true);
    this.cleanupReader = createAgentServerLineReader(
      socket,
      (message) => void this.handleMessage(message),
      (error) => this.emit("protocol-error", error)
    );
    socket.on("error", (error) => {
      this.helloReject?.(error);
      this.rejectPending(error);
    });
    socket.once("close", () => {
      if (this.socket !== socket) return;
      this.cleanupReader?.();
      this.cleanupReader = null;
      if (this.socket === socket) this.socket = null;
      const error = Object.assign(new Error("Zyra agent-server connection closed."), { code: "AGENT_SERVER_DISCONNECTED" });
      this.helloReject?.(error);
      this.rejectPending(error);
      this.emit("disconnect", error);
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.destroy();
        reject(Object.assign(new Error("Timed out authenticating with the Zyra agent server."), { code: "AGENT_SERVER_TIMEOUT" }));
      }, 5_000);
      timer.unref?.();
      this.helloResolve = (value) => {
        clearTimeout(timer);
        resolve(value);
      };
      this.helloReject = (error) => {
        clearTimeout(timer);
        reject(error);
      };
      socket.once("connect", () => {
        writeAgentServerMessage(socket, {
          type: "hello",
          version: AGENT_SERVER_PROTOCOL_VERSION,
          token: descriptor.token,
          clientId: this.clientId,
          surface: this.surface,
          authorities: this.authorities,
          ...(this.authorityProof ? { authorityProof: this.authorityProof } : {})
        });
      });
    });
    this.helloResolve = null;
    this.helloReject = null;
  }

  async request(method, params = {}, options = {}) {
    await this.connect();
    return this.requestConnected(method, params, options);
  }

  async requestConnected(method, params = {}, options = {}) {
    if (!this.socket?.writable) throw Object.assign(new Error("Zyra agent server is disconnected."), { code: "AGENT_SERVER_DISCONNECTED" });
    const id = `request:${process.pid}:${this.nextRequestId++}`;
    return new Promise((resolve, reject) => {
      let timer;
      if (options.timeoutMs) {
        timer = setTimeout(() => {
          this.pending.delete(id);
          reject(Object.assign(new Error(`Agent-server request ${method} timed out.`), { code: "AGENT_SERVER_TIMEOUT" }));
        }, Math.max(100, Number(options.timeoutMs)));
        timer.unref?.();
      }
      this.pending.set(id, { resolve, reject, timer });
      try {
        writeAgentServerMessage(this.socket, { type: "request", id, method, params });
      } catch (error) {
        this.pending.delete(id);
        if (timer) clearTimeout(timer);
        reject(error);
      }
    });
  }

  async attach(params) {
    return this.request("session.attach", params, { timeoutMs: DEFAULT_ATTACH_TIMEOUT_MS });
  }

  async detach(sessionKey) {
    return this.request("session.detach", { sessionKey }, { timeoutMs: 5_000 });
  }

  close() {
    this.cleanupReader?.();
    this.cleanupReader = null;
    this.socket?.destroy();
    this.socket = null;
    this.rejectPending(Object.assign(new Error("Zyra agent-server client closed."), { code: "AGENT_SERVER_DISCONNECTED" }));
  }

  startServer() {
    const entry = path.join(this.root, "src", "agent-server", "main.mjs");
    // Electron's Windows executable exits immediately when launched detached with
    // ignored stdio, so Windows carries Node. Signed macOS/Linux Electron binaries
    // run the same entrypoint with ELECTRON_RUN_AS_NODE.
    const { executable, electronAsNode } = resolveAgentServerNodeLaunch(this.dataRoot);
    const standalone = process.env.ZYRA_STANDALONE === "1";
    const childArgs = standalone
      ? ["--internal-agent-server", "--channel", this.paths.channel]
      : [entry, "--channel", this.paths.channel];
    const child = spawn(executable, childArgs, {
      cwd: this.root,
      detached: true,
      windowsHide: true,
      stdio: "ignore",
      env: {
        ...process.env,
        ZYRA_ROOT: this.root,
        ZYRA_DATA_ROOT: this.dataRoot,
        ZYRA_STATE_DIR: this.paths.stateDirectory,
        ...(electronAsNode ? { ELECTRON_RUN_AS_NODE: "1" } : {})
      }
    });
    child.once("error", (error) => this.emit("server-start-error", error));
    child.unref();
  }

  async handleMessage(message) {
    if (message?.type === "hello.ok") {
      this.serverRuntimeRevision = message.server?.activationVersion === RUNTIME_ACTIVATION_VERSION ? message.server?.runtimeRevision : null;
      this.serverMethods = Array.isArray(message.server?.methods) ? message.server.methods : [];
      this.helloResolve?.(message.server || {});
      this.emit("connect", message.server || {});
      return;
    }
    if (message?.type === "catalog.changed") {
      this.emit("catalog-changed", message);
      return;
    }
    if (message?.type === "session.event") {
      this.emit("session-event", message);
      this.emit(`session-event:${message.sessionKey}`, message);
      return;
    }
    if (message?.type === "control.request" || message?.type === "control.cancel") {
      await this.handleControl(message);
      return;
    }
    if (message?.type === "desktop.workspace.request") {
      await this.handleDesktopWorkspace(message);
      return;
    }
    if (message?.type === "desktop.workspace.cancel") {
      this.desktopWorkspaceCancelHandler?.(String(message.requestId || ""));
      return;
    }
    if (message?.type === "desktop.workspace.turn") {
      this.desktopWorkspaceTurnHandler?.(String(message.canonicalChatId || ""), String(message.turnId || ""));
      return;
    }
    if (message?.type === "desktop.workspace.turn-ended") {
      this.desktopWorkspaceTurnEndHandler?.(String(message.canonicalChatId || ""), String(message.turnId || ""));
      return;
    }
    if (message?.type !== "response" || !message.id) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (pending.timer) clearTimeout(pending.timer);
    if (message.ok) pending.resolve(message.result || {});
    else {
      const error = Object.assign(new Error(message.error?.message || "Agent-server request failed."), message.error || {});
      pending.reject(error);
    }
  }

  async handleControl(message) {
    if (message.type === "control.cancel") {
      this.emit("control-cancel", message);
      return;
    }
    try {
      if (!this.controlHandler) throw Object.assign(new Error("This client does not own desktop control authority."), { code: "CONTROL_DRIVER_UNAVAILABLE", retryable: true });
      const result = await this.controlHandler(message.operation, message);
      writeAgentServerMessage(this.socket, {
        type: "control.response",
        sessionKey: message.sessionKey,
        requestId: message.requestId,
        ok: true,
        result
      });
    } catch (error) {
      writeAgentServerMessage(this.socket, {
        type: "control.response",
        sessionKey: message.sessionKey,
        requestId: message.requestId,
        ok: false,
        error: {
          code: error?.code || "CONTROL_ERROR",
          message: error instanceof Error ? error.message : String(error),
          retryable: Boolean(error?.retryable)
        }
      });
    }
  }

  async handleDesktopWorkspace(message) {
    try {
      if (!this.desktopWorkspaceHandler) throw Object.assign(new Error("This Desktop client cannot open graphical workspaces."), { code: "DESKTOP_WORKSPACE_UNAVAILABLE", retryable: true });
      const result = await this.desktopWorkspaceHandler(message.request || {}, message);
      writeAgentServerMessage(this.socket, {
        type: "desktop.workspace.response",
        requestId: message.requestId,
        ok: true,
        result
      });
    } catch (error) {
      writeAgentServerMessage(this.socket, {
        type: "desktop.workspace.response",
        requestId: message.requestId,
        ok: false,
        error: {
          code: error?.code || "DESKTOP_WORKSPACE_ERROR",
          message: error instanceof Error ? error.message : String(error),
          retryable: Boolean(error?.retryable)
        }
      });
    }
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function resolveAgentServerNodeLaunch(dataRoot) {
  if (!process.versions.electron) return { executable: process.execPath, electronAsNode: false };
  const configured = String(process.env.ZYRA_NODE_EXECUTABLE || "");
  if (configured) return { executable: configured, electronAsNode: false };
  if (process.platform !== "win32") return { executable: process.execPath, electronAsNode: true };
  const packaged = process.resourcesPath ? path.join(process.resourcesPath, "zyra-node", "node.exe") : "";
  return {
    executable: packaged && existsSync(packaged) ? cachePackagedWindowsNode(packaged, dataRoot) : "node",
    electronAsNode: false
  };
}

function cachePackagedWindowsNode(source, dataRoot) {
  const sourceSize = statSync(source).size;
  const directory = path.join(dataRoot, ".zyra", "runtime");
  const target = path.join(directory, `node-${process.versions.node}-${sourceSize}.exe`);
  if (existsSync(target) && statSync(target).size !== sourceSize) rmSync(target, { force: true });
  if (!existsSync(target)) {
    mkdirSync(directory, { recursive: true });
    try { copyFileSync(source, target, fsConstants.COPYFILE_EXCL); }
    catch (error) { if (error?.code !== "EEXIST") throw error; }
  }
  if (!existsSync(target) || statSync(target).size !== sourceSize) throw new Error("Cached Node runtime is incomplete.");
  for (const name of readdirSync(directory)) {
    if (name === path.basename(target) || !/^node-.*\.exe$/i.test(name)) continue;
    try { rmSync(path.join(directory, name), { force: true }); } catch {}
  }
  return target;
}

function readDescriptor(file) {
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    return value?.version === AGENT_SERVER_PROTOCOL_VERSION && value.endpoint && value.token ? value : null;
  } catch {
    return null;
  }
}

async function waitForDescriptor(file, timeoutMs, previousPid, paths) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const descriptor = readDescriptor(file);
    if (descriptor && (!previousPid || descriptor.pid !== previousPid || processAlive(descriptor.pid))) return descriptor;
    if (paths) assertNoLiveIncompatibleAgentServer(paths);
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw Object.assign(new Error("Timed out waiting for the Zyra agent server."), { code: "AGENT_SERVER_TIMEOUT" });
}

function assertNoLiveIncompatibleAgentServer(paths) {
  let names;
  try {
    names = readdirSync(paths.stateDirectory);
  } catch {
    return;
  }
  for (const name of names) {
    const match = /^agent-server-v(\d+)-(.+)\.(?:json|lock)$/i.exec(name);
    if (!match || match[2].toLowerCase() !== paths.channel || Number(match[1]) === AGENT_SERVER_PROTOCOL_VERSION) continue;
    let value;
    try {
      value = JSON.parse(readFileSync(path.join(paths.stateDirectory, name), "utf8"));
    } catch {
      continue;
    }
    const pid = Number(value?.pid);
    if (!Number.isInteger(pid) || pid < 1 || !processAlive(pid)) continue;
    const runningVersion = Number(value?.version) || Number(match[1]);
    throw Object.assign(
      new Error(`Zyra agent server v${runningVersion} is still running (PID ${pid}), but this client requires v${AGENT_SERVER_PROTOCOL_VERSION}. Close or restart older Zyra Desktop/TUI clients, then try again.`),
      {
        code: "AGENT_SERVER_PROTOCOL_CONFLICT",
        pid,
        runningVersion,
        requiredVersion: AGENT_SERVER_PROTOCOL_VERSION,
      }
    );
  }
}

function processAlive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}
