import { randomUUID } from "node:crypto";
import { assertControlPrincipal, CONTROL_BOUNDS, ControlContractError } from "./contracts.mjs";

export class AgentControlBridgeClient {
  constructor(options = {}) {
    this.send = options.send;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? CONTROL_BOUNDS.defaultActionTimeoutMs;
    this.pending = new Map();
    this.disposed = false;
  }

  request(operation, options = {}) {
    if (this.disposed || typeof this.send !== "function") {
      return Promise.reject(new ControlContractError("Desktop control bridge is unavailable.", "CONTROL_CAPABILITY_UNAVAILABLE"));
    }
    const requestId = randomUUID();
    const timeoutMs = Math.max(100, Math.min(10 * 60 * 1000, Number(options.timeoutMs) || this.defaultTimeoutMs));
    return new Promise((resolve, reject) => {
      const finish = (callback, value) => {
        const pending = this.pending.get(requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        pending.signal?.removeEventListener?.("abort", pending.abort);
        this.pending.delete(requestId);
        callback(value);
      };
      const abort = () => {
        this.send?.({ type: "control.cancel", requestId });
        finish(reject, new ControlContractError("Control request was cancelled.", "CONTROL_CANCELLED"));
      };
      const timer = setTimeout(() => finish(reject, new ControlContractError("Control request timed out.", "CONTROL_TIMEOUT")), timeoutMs);
      timer.unref?.();
      this.pending.set(requestId, { resolve, reject, timer, signal: options.signal, abort });
      if (options.signal?.aborted) {
        abort();
        return;
      }
      options.signal?.addEventListener?.("abort", abort, { once: true });
      const principal = options.principal ? assertControlPrincipal(options.principal) : undefined;
      this.send({ type: "control.request", requestId, operation, ...(principal ? { principal } : {}) });
    });
  }

  forPrincipal(principalValue) {
    const principal = assertControlPrincipal(principalValue);
    return Object.freeze({
      request: (operation, options = {}) => this.request(operation, { ...options, principal }),
    });
  }

  handleResponse(message) {
    const requestId = String(message?.requestId || "");
    const pending = this.pending.get(requestId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    pending.signal?.removeEventListener?.("abort", pending.abort);
    this.pending.delete(requestId);
    if (message.ok) pending.resolve(message.result || {});
    else {
      const error = new ControlContractError(message.error?.message || "Control request failed.", message.error?.code || "CONTROL_ERROR");
      Object.assign(error, message.error || {});
      pending.reject(error);
    }
    return true;
  }

  dispose(reason = "Control bridge disposed.") {
    if (this.disposed) return;
    this.disposed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.signal?.removeEventListener?.("abort", pending.abort);
      pending.reject(new ControlContractError(reason, "CONTROL_BRIDGE_DISPOSED"));
    }
    this.pending.clear();
  }
}
