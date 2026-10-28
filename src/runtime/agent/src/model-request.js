// Generated from the maintained TypeScript in ../source by scripts/build-owned-runtime.mjs.
import { uuidv7 } from "../../providers/src/index.js";
class ModelRequestControl {
  constructor(emit) {
    this.emit = emit;
  }
  current;
  events = Promise.resolve();
  get progress() {
    return this.current ? { ...this.current.progress } : null;
  }
  get recovery() {
    return this.current?.recovery;
  }
  get requestId() {
    return this.current?.progress.requestId;
  }
  publish(event) {
    this.events = this.events.then(() => this.emit(event));
    void this.events.catch(() => {
    });
  }
  async flush() {
    await this.events;
  }
  async begin(root) {
    if (this.current) throw new Error("A model request is already active");
    const controller = new AbortController();
    const now = Date.now();
    const progress = {
      requestId: uuidv7(),
      startedAt: now,
      lastActivityAt: now,
      phase: "waiting",
      canPing: !root?.aborted
    };
    const onAbort = () => {
      progress.canPing = false;
      controller.abort();
      this.publish({ type: "model_request_progress", progress: { ...progress } });
    };
    this.current = { progress, controller, root, onAbort, lastEmittedAt: now };
    root?.addEventListener("abort", onAbort, { once: true });
    if (root?.aborted) controller.abort();
    this.publish({ type: "model_request_progress", progress: { ...progress } });
    await this.flush();
    return controller.signal;
  }
  /** Called before forwarding every provider event, including hidden reasoning. */
  async activity(unsafe) {
    const current = this.current;
    if (!current || current.recovery || current.root?.aborted) return;
    const previousPhase = current.progress.phase;
    const previousCanPing = current.progress.canPing;
    current.progress.lastActivityAt = Date.now();
    current.progress.phase = "streaming";
    if (unsafe) current.progress.canPing = false;
    if (previousPhase !== current.progress.phase || previousCanPing !== current.progress.canPing || current.progress.lastActivityAt - current.lastEmittedAt >= 1e3) {
      current.lastEmittedAt = current.progress.lastActivityAt;
      this.publish({ type: "model_request_progress", progress: { ...current.progress } });
    }
    await this.flush();
  }
  ping(requestId, message) {
    const current = this.current;
    if (!current || current.progress.requestId !== requestId) throw new Error("Stale model request");
    if (current.root?.aborted || !current.progress.canPing || current.recovery) {
      throw new Error("Model request cannot be pinged safely");
    }
    current.recovery = message;
    current.progress.phase = "recovering";
    current.progress.canPing = false;
    this.publish({ type: "model_ping", requestId, status: "accepted" });
    this.publish({ type: "model_request_progress", progress: { ...current.progress } });
    current.controller.abort();
  }
  /** No request remains advertised once execution leaves the provider stage. */
  async end() {
    const current = this.current;
    if (!current) return;
    current.root?.removeEventListener("abort", current.onAbort);
    this.current = void 0;
    this.publish({ type: "model_request_progress", progress: null });
    await this.flush();
  }
}
export {
  ModelRequestControl
};
