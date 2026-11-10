// Generated from the maintained TypeScript in ../source by scripts/build-owned-runtime.mjs.
function buildProviderErrorPattern(patterns) {
  return new RegExp(patterns.join("|"), "i");
}
const NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN = buildProviderErrorPattern([
  // OpenCode Go/free-tier limits returned as 429 JSON error types by OpenCode's
  // Zen API. These are subscription/account limits, not transient throttles.
  "GoUsageLimitError",
  "FreeUsageLimitError",
  // OpenCode Go subscription-limit text asks users to enable available-balance
  // usage after rolling/weekly/monthly limits are reached.
  "Monthly usage limit reached",
  "available balance",
  // Generic quota/budget/billing exhaustion. `insufficient_quota` is OpenAI's
  // quota/billing error code; the other strings cover common gateway wording.
  "insufficient_quota",
  "out of budget",
  "quota exceeded",
  "billing"
]);
const RETRYABLE_PROVIDER_ERROR_PATTERN = buildProviderErrorPattern([
  // Generic provider load, HTTP status, and server-side transient failures.
  "overloaded",
  "rate.?limit",
  "too many requests",
  "429",
  "500",
  "502",
  "503",
  "504",
  "524",
  "service.?unavailable",
  "server.?error",
  "internal.?error",
  // Wrapper/provider text for transient upstream failures, including OpenRouter
  // "Provider returned error" responses (#2264).
  "provider.?returned.?error",
  "exceeded request buffer limit while retrying upstream",
  // Network, proxy, and fetch transport failures. This includes OpenAI Codex
  // raw-fetch failures such as "upstream connect", "connection refused", and
  // "reset before headers" (#733), plus OpenRouter connection drops (#3317).
  "network.?error",
  "connection.?error",
  "connection.?refused",
  "connection.?lost",
  "other side closed",
  "fetch failed",
  "getaddrinfo",
  "ENOTFOUND",
  "EAI_AGAIN",
  "upstream.?connect",
  "reset before headers",
  "socket hang up",
  "socket connection was closed",
  "timed? out",
  "timeout",
  "terminated",
  // WebSocket transports can report close/error text instead of HTTP/fetch text.
  "websocket.?closed",
  "websocket.?error",
  // Premature stream endings from SDKs and transports. Anthropic can throw
  // "stream ended without ..." and "Anthropic stream ended before message_stop"
  // (#4433); Bedrock/Smithy can throw an HTTP/2 no-response error (#3594).
  "ended without",
  "stream ended before message_stop",
  "stream ended before a terminal response event",
  "http2 request did not get a response",
  // Provider-requested retry delay cap failures should flow through the outer
  // retry policy so callers can surface/abort the backoff (#1123).
  "retry delay",
  // Explicit retry guidance emitted mid-stream by OpenAI Responses and Bedrock
  // stream exceptions (#6019).
  "you can retry your request",
  "try your request again",
  "please retry your request",
  // gRPC based providers (e.g. NVIDIA NIM)
  "ResourceExhausted"
]);
const NON_RETRYABLE_REQUEST_ERROR_PATTERN = /\b(?:401|403)\b|unauthori[sz]ed|authentication|invalid api key|no api key|permission denied|access denied|invalid (?:request|argument)|(?:request|input|json) schema|unsupported (?:model|parameter|effort)|thinking must be one of|no (?:chatgpt )?account.*available|usage limit|context_length_exceeded|maximum context|content.?policy|websocket.*\b1008\b/i;
class RetrySleepAbortError extends Error {
  constructor() {
    super("Aborted");
  }
}
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new RetrySleepAbortError());
      return;
    }
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(new RetrySleepAbortError());
      },
      { once: true }
    );
  });
}
async function retryAssistantCall(produce, policy, signal, callbacks) {
  const maxAttempts = policy?.enabled ? policy.maxRetries : 0;
  let attempt = 0;
  let lastRetry;
  for (; ; ) {
    const response = await produce();
    if (response.stopReason === "aborted") {
      if (lastRetry) await callbacks?.onRetryFinished?.(false, lastRetry.attempt);
      return response;
    }
    if (response.stopReason !== "error") {
      if (lastRetry) await callbacks?.onRetryFinished?.(true, lastRetry.attempt);
      return response;
    }
    if (attempt >= maxAttempts || !isRetryableAssistantError(response, attempt)) {
      if (lastRetry) await callbacks?.onRetryFinished?.(false, lastRetry.attempt, response.errorMessage);
      return response;
    }
    attempt++;
    lastRetry = { attempt, errorMessage: response.errorMessage || "Unknown error" };
    const delayMs = policy.baseDelayMs * 2 ** (attempt - 1);
    await callbacks?.onRetryScheduled?.(attempt, maxAttempts, delayMs, lastRetry.errorMessage);
    try {
      await sleep(delayMs, signal);
    } catch (error) {
      await callbacks?.onRetryFinished?.(false, attempt, lastRetry.errorMessage);
      if (error instanceof RetrySleepAbortError) {
        return { ...response, stopReason: "aborted", errorMessage: void 0 };
      }
      throw error;
    }
    await callbacks?.onRetryAttemptStart?.();
  }
}
function isRetryableAssistantError(message, previousAttempts = 0) {
  if (message.stopReason !== "error" || message.errorRetryable === false) return false;
  const errorMessage = message.errorMessage || "Unknown error";
  if (NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN.test(errorMessage) || NON_RETRYABLE_REQUEST_ERROR_PATTERN.test(errorMessage)) return false;
  return message.errorRetryable === true || RETRYABLE_PROVIDER_ERROR_PATTERN.test(errorMessage) || previousAttempts === 0;
}
export {
  isRetryableAssistantError,
  retryAssistantCall
};
