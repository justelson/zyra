import { addUsage, normalizeUsage } from "../contracts.mjs";
import { aggregateSessionUsage } from '../../usage-aggregation.mjs';
import { deliverThreadMessage } from '../../threads/delivery.mjs';
import { isSupportingAgentMessage } from '../../threads/message-origin.mjs';

export class ChildSessionHost {
  constructor(options = {}) {
    this.factory = options.factory;
    this.onEvent = options.onEvent ?? (() => {});
    this.onActivity = options.onActivity ?? (() => {});
    this.sessionResult = null;
    this.unsubscribe = null;
    this.initialUsage = normalizeUsage(options.initialUsage);
    this.usage = normalizeUsage(this.initialUsage);
    this.usageBaseline = normalizeUsage();
    this.observedMessages = new Map();
    this.turns = 0;
    this.turnsStarted = 0;
    this.maxTurns = Math.max(1, Number(options.maxTurns) || 12);
    this.lastAssistantText = "";
    this.limitFailure = null;
    this.abortingForLimit = false;
    this.sendChain = Promise.resolve();
  }

  async open(options = {}) {
    if (!this.factory) throw new Error("ChildSessionHost requires a session factory.");
    this.sessionResult = await this.factory.create(options);
    // Restored transcripts already contributed to previous attempts. Only bill
    // the delta from this opening, on top of the run's persisted lifetime usage.
    this.usageBaseline = this.readSessionUsage();
    this.unsubscribe = this.sessionResult.session.subscribe((event) => this.handleEvent(event));
    return {
      sessionId: this.sessionResult.sessionId,
      sessionFile: this.sessionResult.sessionFile,
      modelFallbackMessage: this.sessionResult.modelFallbackMessage,
    };
  }

  async run(prompt, options = {}) {
    const session = this.requireSession();
    if (options.signal?.aborted) throw abortError(options.signal.reason);
    const abortListener = () => void session.abort?.();
    options.signal?.addEventListener("abort", abortListener, { once: true });
    try {
      if (options.delegation) {
        this.reserveTurn();
        await session.sendCustomMessage({ customType: 'zyra_thread_message', content: String(prompt), details: options.delegation, display: true }, { triggerTurn: true, deliverAs: 'followUp' });
        this.assertCompletedTurn(session);
      } else await this.executePrompt(session, prompt, "print");
      if (options.signal?.aborted) throw abortError(options.signal.reason);
      return this.resultSnapshot();
    } finally {
      options.signal?.removeEventListener("abort", abortListener);
    }
  }

  async send(message, threadMessage) {
    const deliver = this.sendChain.then(async () => {
      const session = this.requireSession();
      if (threadMessage) {
        if (isSupportingAgentMessage(threadMessage)) {
          await deliverThreadMessage(session, threadMessage);
          return this.resultSnapshot('context-only');
        }
        const streaming = session.isStreaming;
        if (!streaming) this.reserveTurn();
        await deliverThreadMessage(session, threadMessage);
        if (!streaming) this.assertCompletedTurn(session);
        return this.resultSnapshot(streaming ? 'follow-up-queued' : 'follow-up');
      }
      if (session.isStreaming) {
        await session.steer(String(message));
        return this.resultSnapshot("steer");
      }
      await this.executePrompt(session, message, "interactive");
      return this.resultSnapshot("follow-up");
    });
    this.sendChain = deliver.catch(() => {});
    return deliver;
  }

  async executePrompt(session, prompt, source) {
    this.reserveTurn();
    try {
      await session.prompt(String(prompt), { source });
    } catch (error) {
      if (this.limitFailure) throw this.limitFailure;
      throw error;
    }
    this.assertCompletedTurn(session);
  }

  assertCompletedTurn(session) {
    if (this.limitFailure) throw this.limitFailure;
    // The session's retry loop resolves prompt() even when the final provider
    // response is an error. Check the final response after retries settle so a
    // failed request cannot become an empty (or stale) successful child result.
    const latest = [...(session.messages ?? [])].reverse().find((entry) => entry?.role === "assistant");
    if (latest?.stopReason === "error") {
      const error = new Error(latest.errorMessage || "Child provider request failed.");
      error.code = "CHILD_PROVIDER_ERROR";
      throw error;
    }
    if (latest?.stopReason === "aborted") throw abortError(latest.errorMessage);
  }

  reserveTurn() {
    if (this.turnsStarted >= this.maxTurns || this.turns >= this.maxTurns) {
      const error = new Error(`Child agent reached its ${this.maxTurns}-turn limit.`);
      error.code = "CHILD_MAX_TURNS";
      throw error;
    }
    this.turnsStarted += 1;
  }

  readSessionUsage() {
    const session = this.requireSession();
    const entries = session.sessionManager?.getEntries?.()
      ?? (session.messages ?? []).map(message => ({ type: 'message', message }));
    const totals = aggregateSessionUsage([...entries, ...this.observedMessages.values()]);
    return normalizeUsage({ ...totals, requests: totals.assistantMessages });
  }

  reconcileUsage() {
    const current = this.readSessionUsage();
    const delta = Object.fromEntries(Object.keys(current).map(key => [key, Math.max(0, current[key] - this.usageBaseline[key])]));
    this.usage = addUsage(this.initialUsage, delta);
    return this.usage;
  }

  resultSnapshot(mode) {
    const session = this.requireSession();
    this.reconcileUsage();
    return {
      ...(mode ? { mode } : {}),
      text: this.lastAssistantText || extractLatestAssistantText(session.messages),
      usage: normalizeUsage(this.usage),
      sessionId: this.sessionResult.sessionId,
      sessionFile: this.sessionResult.sessionFile,
      turns: this.turns,
    };
  }

  async abort(reason = "cancelled") {
    await this.sessionResult?.session?.abort?.();
    void reason;
  }

  dispose() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.sessionResult?.session?.dispose?.();
    this.sessionResult = null;
  }

  handleEvent(event) {
    this.onEvent(event);
    if (event?.type === "turn_start" && this.turns >= this.maxTurns && !this.limitFailure && !this.abortingForLimit) {
      this.limitFailure = maxTurnsError(this.maxTurns);
      this.abortingForLimit = true;
      this.onEvent({ type: 'zyra_agent_interruption', interruption: { kind: 'stopped', source: 'system', reason: 'turn-limit' } });
      void Promise.resolve(this.sessionResult?.session?.abort?.()).finally(() => { this.abortingForLimit = false; });
    }
    if (event?.type === "turn_end") this.turns += 1;
    if (event?.type === "message_end" && event.message?.role === "assistant") {
      const text = extractMessageText(event.message);
      if (text) this.lastAssistantText = text;
    }
    if (event?.type === 'message_end' && event.message?.usage) {
      const message = event.message;
      const key = message.id ?? (message.timestamp != null ? `${message.role}:${message.provider || ''}:${message.model || ''}:${message.timestamp}` : message);
      this.observedMessages.set(key, message);
      this.reconcileUsage();
    }
    if (["tool_execution_start", "tool_execution_update", "tool_execution_end"].includes(event?.type)) {
      this.onActivity({
        type: event.type,
        toolCallId: event.toolCallId ?? event.id,
        toolName: event.toolName ?? event.name,
        args: boundValue(event.args ?? event.arguments, 16 * 1024),
        result: event.type === "tool_execution_end" ? boundValue(event.result, 16 * 1024) : undefined,
        isError: Boolean(event.isError),
        occurredAt: new Date().toISOString(),
      });
    }
  }

  requireSession() {
    if (!this.sessionResult?.session) throw new Error("Child session is not open.");
    return this.sessionResult.session;
  }
}

function extractLatestAssistantText(messages = []) {
  const message = [...(messages ?? [])].reverse().find((entry) => entry?.role === "assistant");
  return extractMessageText(message);
}

function extractMessageText(message = {}) {
  if (typeof message.content === "string") return message.content;
  return (Array.isArray(message.content) ? message.content : [])
    .filter((part) => part?.type === "text")
    .map((part) => String(part.text ?? ""))
    .join("");
}

function boundValue(value, maxBytes) {
  if (value === undefined) return undefined;
  try {
    const text = JSON.stringify(value);
    if (Buffer.byteLength(text, "utf8") <= maxBytes) return JSON.parse(text);
    return { truncated: true, bytes: Buffer.byteLength(text, "utf8") };
  } catch {
    return String(value).slice(0, maxBytes);
  }
}

function maxTurnsError(maxTurns) {
  const error = new Error(`Child agent reached its ${maxTurns}-turn limit while still executing tools.`);
  error.code = "CHILD_MAX_TURNS";
  return error;
}

function abortError(reason) {
  const error = new Error(`Child agent cancelled${reason ? `: ${reason}` : ""}.`);
  error.name = "AbortError";
  return error;
}
