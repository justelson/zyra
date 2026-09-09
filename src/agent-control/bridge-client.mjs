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
    return new Promise((resolve, reject) => {
      let operationTimeoutMs = this.defaultTimeoutMs;
      if (operation?.operation === "act_sequence") {
        if (!Array.isArray(operation.steps) || operation.steps.length < 1 || operation.steps.length > 16) {
          throw new ControlContractError("A computer interaction sequence requires 1 to 16 bounded steps.");
        }
        // Every step executes one bounded native action and then a fresh
        // observation. The enclosing request must allow both without changing
        // either per-operation deadline or the ten-minute bridge ceiling.
        operationTimeoutMs = CONTROL_BOUNDS.defaultActionTimeoutMs * (2 * operation.steps.length + 1);
      }
      const timeoutMs = Math.max(100, Math.min(10 * 60 * 1000, Number(options.timeoutMs) || operationTimeoutMs));
      const finish = (callback, value) => {
        const pending = this.pending.get(requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        pending.signal?.removeEventListener?.("abort", pending.abort);
        this.pending.delete(requestId);
        callback(value);
      };
      const cancel = (error) => {
        if (!this.pending.has(requestId)) return;
        // Settle once before sending: a synchronous late response or a second
        // abort cannot turn this deadline into success or replay the request.
        finish(reject, error);
        try { this.send?.({ type: "control.cancel", requestId }); } catch { /* A disconnected transport cannot accept cancellation. */ }
      };
      const abort = () => cancel(new ControlContractError("Control request was cancelled.", "CONTROL_CANCELLED"));
      const timer = setTimeout(() => cancel(new ControlContractError("Control request timed out.", "CONTROL_TIMEOUT")), timeoutMs);
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
