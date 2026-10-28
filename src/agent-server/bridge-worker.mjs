import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import path from "node:path";
import readline from "node:readline";
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export class AgentBridgeWorker extends EventEmitter {
  constructor(options = {}) {
    super();
    this.root = path.resolve(options.root);
    this.cwd = path.resolve(options.cwd || this.root);
    this.bridgePath = path.resolve(options.bridgePath || path.join(this.root, "src", "zyra-ui-bridge.mjs"));
    this.child = null;
    this.lines = null;
    this.nextId = 1;
    this.pending = new Map();
    this.disposed = false;
  }

  isAlive() {
    return Boolean(!this.disposed && this.child && this.child.exitCode === null && !this.child.killed && this.child.stdin.writable);
  }

  request(type, payload = {}, options = {}) {
    if (this.shutdownReason && type !== 'dispose') return Promise.reject(new Error(this.shutdownReason));
    this.ensureStarted();
    if (!this.child?.stdin.writable) return Promise.reject(new Error("Agent bridge stdin is closed."));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      let timer;
      if (options.timeoutMs) {
        timer = setTimeout(() => {
          this.pending.delete(id);
          reject(Object.assign(new Error(`Agent bridge request ${type} timed out.`), { code: "AGENT_SERVER_TIMEOUT" }));
        }, Math.max(100, Number(options.timeoutMs)));
        timer.unref?.();
      }
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ id, type, payload })}\n`, (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        this.pending.delete(id);
        if (pending?.timer) clearTimeout(pending.timer);
        reject(error);
      });
    });
  }

  sendControlResponse(message) {
    if (!this.child?.stdin.writable) return false;
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
    return true;
  }

  async shutdown(reason = 'Stopped for agent update.') {
    const child = this.child;
    if (!child || child.exitCode === 0) return;
    if (child.exitCode !== null) throw new Error('Worker cleanup was not confirmed.');
    if (!this.shutdownPromise) {
      this.shutdownReason = reason;
      this.shutdownPromise = new Promise((resolve, reject) => {
        child.once('exit', code => code === 0 ? resolve() : reject(new Error('Worker cleanup failed.')));
        // Keep this exit observer after a caller's deadline. A later retry can
        // observe eventual cleanup instead of reusing a permanently timed-out promise.
        void this.request('dispose', {}, { timeoutMs: 8_000 }).catch(() => {});
      });
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Worker cleanup has not finished. Installation has not started.')), this.shutdownTimeoutMs || 8_000);
      this.shutdownPromise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
    });
  }

  dispose(reason = "Agent bridge stopped.") {
    if (this.disposed) return;
    this.disposed = true;
    if (this.child?.stdin.writable) {
      this.child.stdin.write(`${JSON.stringify({ id: this.nextId++, type: "dispose", payload: {} })}\n`);
    }
    this.lines?.close();
    const child = this.child;
    this.child = null;
    setTimeout(() => child?.kill(), 100).unref?.();
    this.rejectPending(new Error(reason));
    this.removeAllListeners();
  }

  ensureStarted() {
    if (this.child) return;
    if (this.disposed) throw new Error("Agent bridge worker is disposed.");
    const schemaPreload = path.join(this.root, 'src', 'runtime', 'schema', 'preload.mjs');
    const childArgs = process.env.ZYRA_STANDALONE === "1"
      ? ["--internal-agent-bridge"]
      : [...(existsSync(schemaPreload) ? ['--import', pathToFileURL(schemaPreload).href] : []), this.bridgePath];
    this.child = spawn(process.execPath, childArgs, {
      cwd: this.root,
      env: {
        ...process.env,
        ZYRA_ROOT: this.root,
        ZYRA_CALLER_CWD: this.cwd
      },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const child = this.child;
    // Writes can fail after the child begins exiting, including a dispose write.
    // Keep the pipe listener through shutdown so EPIPE cannot crash the server.
    child.stdin.on("error", (error) => {
      if (this.disposed || this.child !== child) return;
      this.rejectPending(error);
      this.emit("worker-error", error);
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.lines = readline.createInterface({ input: this.child.stdout });
    this.lines.on("line", (line) => this.handleLine(line));
    this.child.stderr.on("data", (chunk) => {
      const text = String(chunk || "").trim();
      if (text) this.emit("stderr", text);
    });
    this.child.on("error", (error) => {
      this.emit("worker-error", error);
      this.rejectPending(error);
    });
    this.child.on("exit", (code, signal) => {
      const error = new Error(this.shutdownReason || `Agent bridge exited${code === null ? "" : ` with code ${code}`}${signal ? ` signal ${signal}` : ""}.`);
      this.child = null;
      this.rejectPending(error);
      if (!this.disposed) this.emit("exit", { code, signal, error });
    });
  }

  handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.emit("stderr", line);
      return;
    }
    if (message?.type === "event") {
      this.emit("event", message.event);
      return;
    }
    if (message?.type === "control.request" || message?.type === "control.cancel") {
      this.emit("control", message);
      return;
    }
    if (message?.type === 'threads.request') { this.emit('thread-request', message); return; }
    if (message?.type === 'harness.transport.request') { this.emit('harness-transport-request', message); return; }
    if (message?.type === "protocol_error") {
      this.emit("stderr", String(message.error || "Agent bridge protocol error."));
      return;
    }
    if (message?.type !== "response" || typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (pending.timer) clearTimeout(pending.timer);
    if (message.ok) pending.resolve(message.result || {});
    else {
      const error = Object.assign(new Error(message.error || "Agent bridge request failed."), { stack: message.stack });
      pending.reject(error);
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
