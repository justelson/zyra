import { randomUUID } from "node:crypto";
import {
  CHATGPT_REALTIME_ALPHA_HEADER,
  CHATGPT_REALTIME_CALL_URL,
  CHATGPT_REALTIME_MODEL,
} from "./chatgpt-realtime-contract.mjs";
import {
  extractCodexRateLimitWindows,
  extractCodexUsageLimitWindows,
  formatCodexUsageWindowLabel,
  listCodexUsageWindows,
  normalizeCodexLimitWindow,
} from "./codex-usage-windows.mjs";
import { createZyraAuthStorage } from "./pi-runtime.mjs";

const CHATGPT_ACCOUNT_PROVIDER = "openai-codex";
const CODEX_ACCOUNT_API_BASE = "https://chatgpt.com/backend-api";
export {
  CHATGPT_REALTIME_ALPHA_HEADER,
  CHATGPT_REALTIME_CALL_URL,
  CHATGPT_REALTIME_MODEL,
};

const CHATGPT_REALTIME_MAX_SDP_BYTES = 512 * 1024;
const CHATGPT_REALTIME_MAX_RESPONSE_BYTES = 512 * 1024;
const CHATGPT_REALTIME_MAX_INSTRUCTIONS_CHARACTERS = 8_000;
const CHATGPT_REALTIME_MAX_INITIAL_ITEMS = 128;
const CHATGPT_REALTIME_MAX_INITIAL_TEXT_BYTES = 32 * 1024;
const CHATGPT_REALTIME_REQUEST_TIMEOUT_MS = 30_000;
const CHATGPT_REALTIME_MAX_REQUEST_TIMEOUT_MS = 60_000;
class ChatGptRealtimeCallError extends Error {
  constructor(message) {
    super(message);
    this.name = "ChatGptRealtimeCallError";
  }
}

const CHATGPT_REALTIME_VOICES = new Set([
  "arbor",
  "breeze",
  "cove",
  "ember",
  "juniper",
  "maple",
  "sol",
  "spruce",
  "vale",
]);

export async function buildChatGptAccountStatus(provider = CHATGPT_ACCOUNT_PROVIDER, options = {}) {
  const authStorage = options.authStorage ?? await createZyraAuthStorage(options);
  const status = authStorage.getAuthStatus(provider);
  let credential = authStorage.get(provider);
  let claims = extractOpenAiCodexClaims(credential?.access);

  if (provider === CHATGPT_ACCOUNT_PROVIDER && status.configured) {
    const expiresAt = normalizeResetAt(credential?.expires);
    const credentialNeedsRefresh = !credential?.access
      || !expiresAt
      || Date.parse(expiresAt) <= Date.now() + 60_000;
    if (options.refreshCredential !== false || credentialNeedsRefresh) {
      const access = await authStorage.getApiKey(provider, { includeFallback: false }).catch(() => undefined);
      credential = authStorage.get(provider) ?? credential;
      claims = extractOpenAiCodexClaims(credential?.access ?? access) ?? claims;
    }
  }

  let usage;
  let usageError;
  if (provider === CHATGPT_ACCOUNT_PROVIDER && status.configured && options.includeUsage !== false) {
    try {
      usage = await fetchCodexUsageStats();
    } catch (error) {
      usageError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    provider,
    status,
    email: claims?.email,
    emailVerified: claims?.emailVerified,
    plan: claims?.plan ?? usage?.plan,
    accountId: credential?.accountId ?? claims?.accountId,
    tokenExpiresAt: normalizeResetAt(credential?.expires),
    usage,
    usageError,
    updatedAt: new Date().toISOString(),
  };
}

export const buildZyraAuthAccountStatus = buildChatGptAccountStatus;

export function formatZyraAuthAccountStatus(account = {}) {
  const separator = "─".repeat(58);
  const status = account.status?.configured ? "logged in" : "not logged in";
  const source = account.status?.source ? ` (${account.status.source})` : "";
  const lines = ["", separator, "Account status", ""];
  lines.push(` Provider: ${account.provider ?? CHATGPT_ACCOUNT_PROVIDER}`);
  lines.push(` Status: ${status}${source}`);
  lines.push(` Email: ${account.email ?? "unknown"}${account.emailVerified === true ? " ✓" : ""}`);
  lines.push(` Plan: ${account.plan ?? "unknown"}`);
  lines.push(` Account: ${shortId(account.accountId)}`);
  lines.push(` Token: ${account.tokenExpiresAt ? `expires ${formatLocalDateTime(account.tokenExpiresAt)}` : "unknown"}`);

  if (account.usage) {
    lines.push("", "Limits:");
    const windows = listCodexUsageWindows(account.usage);
    if (windows.length === 0) lines.push(" No rate-limit windows returned by ChatGPT.");
    for (const window of windows) {
      appendUsageWindow(lines, formatCodexUsageWindowLabel(window), window);
    }
  } else if (account.usageError) {
    lines.push("", ` Limits: unavailable — ${account.usageError}`);
  } else {
    lines.push("", " Limits: not checked");
  }

  lines.push("", ` Updated: ${formatLocalDateTime(account.updatedAt)}`, separator);
  return lines;
}

export async function fetchCodexUsageStats() {
  const { data, auth } = await requestCodexAccountJson("/wham/usage");
  return normalizeCodexUsageStats(data, auth.source, auth);
}

export async function fetchCodexResetCredits() {
  const { data } = await requestCodexAccountJson("/wham/rate-limit-reset-credits");
  return normalizeCodexResetCredits(data);
}

export async function redeemCodexResetCredit(creditId) {
  const normalizedId = String(creditId ?? "").trim();
  if (!normalizedId) throw new Error("Choose a banked Codex reset before redeeming.");
  const { data } = await requestCodexAccountJson("/wham/rate-limit-reset-credits/consume", {
    method: "POST",
    body: JSON.stringify({
      credit_id: normalizedId,
      redeem_request_id: randomUUID(),
    }),
  });
  return normalizeCodexResetRedemption(data);
}

export function formatCodexUsageStats(stats) {
  const separator = "─".repeat(54);
  const lines = ["", separator, "Codex usage", ""];
  lines.push(` Source: ${stats.source}`);
  lines.push(` Plan: ${stats.plan ?? "unknown"}`);
  if (stats.availableResetCount !== undefined) {
    lines.push(` Banked resets: ${stats.availableResetCount}`);
  }
  lines.push("");

  const windows = listCodexUsageWindows(stats);
  for (const window of windows) {
    const label = formatCodexUsageWindowLabel(window);
    lines.push(` ${label.padEnd(14)} ${formatUsagePercent(window.usedPercent)}${formatReset(window.resetAt)}`);
  }

  if (windows.length === 0) lines.push(" No rate-limit windows returned by ChatGPT.");
  lines.push("", ` Updated: ${formatLocalDateTime(stats.updatedAt)}`, separator);
  return lines;
}

export async function resolveChatGptAccountAuth() {
  const authStorage = await createZyraAuthStorage();
  const accessToken = await authStorage.getApiKey(CHATGPT_ACCOUNT_PROVIDER, { includeFallback: false });
  if (!accessToken) return undefined;

  const credential = authStorage.get(CHATGPT_ACCOUNT_PROVIDER);
  const claims = extractOpenAiCodexClaims(credential?.access ?? accessToken);
  return {
    source: "Pi auth storage",
    accessToken,
    accountId: typeof credential?.accountId === "string" ? credential.accountId : claims?.accountId,
    email: claims?.email,
  };
}

export const resolveZyraSubscriptionAuth = resolveChatGptAccountAuth;

export async function getChatGptAccountAuthStatus(dependencies = {}) {
  const resolveAuth = dependencies.resolveAuth ?? resolveChatGptAccountAuth;
  try {
    const auth = await resolveAuth();
    return {
      provider: CHATGPT_ACCOUNT_PROVIDER,
      configured: Boolean(nonEmptyString(auth?.accessToken) && nonEmptyString(auth?.accountId)),
    };
  } catch {
    return { provider: CHATGPT_ACCOUNT_PROVIDER, configured: false };
  }
}

/**
 * Creates a subscription-backed Frameless Bidi WebRTC call without exposing
 * OAuth credentials outside this narrow account boundary. The request shape
 * follows the reviewed public openai/codex realtime contract.
 */
export async function createChatGptRealtimeCall(input = {}, dependencies = {}) {
  const sdp = normalizeRealtimeSdp(input.sdp, "offer");
  const sessionId = normalizeRealtimeIdentifier(input.sessionId, "realtime session id");
  const threadId = normalizeRealtimeIdentifier(input.threadId, "realtime thread id");
  const session = buildChatGptRealtimeSession(input);
  const resolveAuth = dependencies.resolveAuth ?? resolveChatGptAccountAuth;
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new ChatGptRealtimeCallError("ChatGPT Voice signaling is unavailable.");

  const timeoutMs = normalizeRealtimeTimeout(input.timeoutMs);
  const controller = new AbortController();
  const externalSignal = input.signal;
  const abortFromCaller = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abortFromCaller();
  else externalSignal?.addEventListener?.("abort", abortFromCaller, { once: true });

  let timedOut = false;
  let phase = "account-access";
  const startedAt = performance.now();
  const scheduleTimeout = dependencies.setTimeoutImpl ?? setTimeout;
  const cancelTimeout = dependencies.clearTimeoutImpl ?? clearTimeout;
  const timeout = scheduleTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    let auth;
    try {
      auth = await runAbortableRealtimeOperation(
        () => resolveAuth({ signal: controller.signal }),
        controller.signal,
      );
    } catch (error) {
      if (controller.signal.aborted) throw error;
      throw new ChatGptRealtimeCallError("Connect your ChatGPT account through Zyra before starting Voice.");
    }
    const accessToken = normalizeRealtimeAccessToken(auth?.accessToken);
    const rawAccountId = nonEmptyString(auth?.accountId);
    if (!accessToken || !rawAccountId) {
      throw new ChatGptRealtimeCallError("Connect your ChatGPT account through Zyra before starting Voice.");
    }
    const accountId = normalizeRealtimeHeaderValue(rawAccountId, "ChatGPT account id");

    phase = "provider-response";
    const response = await runAbortableRealtimeOperation(
      () => fetchImpl(CHATGPT_REALTIME_CALL_URL, {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: {
          Accept: "application/sdp",
          Authorization: `Bearer ${accessToken}`,
          "ChatGPT-Account-Id": accountId,
          "Content-Type": "application/json",
          "User-Agent": "Zyra Desktop Realtime Voice",
          "openai-alpha": CHATGPT_REALTIME_ALPHA_HEADER,
          originator: "zyra_desktop",
          "session-id": sessionId,
          "thread-id": threadId,
          "x-session-id": sessionId,
        },
        body: JSON.stringify({ sdp, session }),
      }),
      controller.signal,
    );

    phase = "sdp-response";
    if (!response?.ok) {
      const failure = await runAbortableRealtimeOperation(
        () => readBoundedRealtimeFailure(response),
        controller.signal,
      );
      throw new ChatGptRealtimeCallError(formatRealtimeCallHttpFailure(response?.status, failure));
    }

    const answerSdp = normalizeRealtimeSdp(
      await runAbortableRealtimeOperation(
        () => readBoundedRealtimeResponseText(response),
        controller.signal,
      ),
      "answer",
    );
    const callId = parseChatGptRealtimeCallId(response.headers?.get?.("location"));
    return { sdp: answerSdp, callId };
  } catch (error) {
    // Diagnostics never contain auth, request bodies, SDP or provider errors.
    try {
      dependencies.onFailure?.({ phase, elapsedMs: Math.round(performance.now() - startedAt), timedOut, cancelled: Boolean(externalSignal?.aborted) });
    } catch { /* Diagnostics cannot change the signaling outcome. */ }
    if (timedOut) throw new ChatGptRealtimeCallError("ChatGPT Voice signaling timed out. Try again.");
    if (externalSignal?.aborted) throw new ChatGptRealtimeCallError("ChatGPT Voice signaling was cancelled.");
    if (error instanceof ChatGptRealtimeCallError) throw error;
    throw new ChatGptRealtimeCallError("ChatGPT Voice signaling failed.");
  } finally {
    cancelTimeout(timeout);
    externalSignal?.removeEventListener?.("abort", abortFromCaller);
  }
}

function runAbortableRealtimeOperation(operation, signal) {
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve()
      .then(() => {
        if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
        return operation();
      })
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export function buildChatGptRealtimeSession(input = {}) {
  const instructions = String(input.instructions ?? "").trim();
  if (!instructions || instructions.length > CHATGPT_REALTIME_MAX_INSTRUCTIONS_CHARACTERS) {
    throw new ChatGptRealtimeCallError(`Voice instructions must contain 1–${CHATGPT_REALTIME_MAX_INSTRUCTIONS_CHARACTERS.toLocaleString()} characters.`);
  }
  const voice = CHATGPT_REALTIME_VOICES.has(input.voice) ? input.voice : "cove";
  const initialItems = normalizeRealtimeInitialItems(input.initialItems);
  return {
    model: CHATGPT_REALTIME_MODEL,
    instructions,
    audio: { output: { voice } },
    delegation: { type: "client", ack_filler: false },
    ...(initialItems.length > 0 ? { initial_items: initialItems } : {}),
  };
}

export function parseChatGptRealtimeCallId(value) {
  const location = nonEmptyString(value);
  if (!location || location.length > 2_048 || /[\u0000-\u001f\u007f]/.test(location)) {
    throw new ChatGptRealtimeCallError("ChatGPT Voice signaling response is missing a valid call location.");
  }
  const path = location.split("?", 1)[0];
  const callId = path
    .split("/")
    .reverse()
    .find((segment) => /^rtc_[A-Za-z0-9_-]{1,248}$/.test(segment)
      || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment));
  if (!callId) throw new ChatGptRealtimeCallError("ChatGPT Voice signaling response contains an invalid call location.");
  return callId;
}

function normalizeRealtimeInitialItems(value) {
  const items = Array.isArray(value) ? value : [];
  if (items.length > CHATGPT_REALTIME_MAX_INITIAL_ITEMS) {
    throw new ChatGptRealtimeCallError(`Voice startup context supports at most ${CHATGPT_REALTIME_MAX_INITIAL_ITEMS} items.`);
  }
  let totalBytes = 0;
  return items.map((item, index) => {
    const role = item?.role;
    if (role !== "developer" && role !== "user" && role !== "assistant") {
      throw new ChatGptRealtimeCallError(`Voice startup context item ${index + 1} has an invalid role.`);
    }
    const text = String(item?.text ?? "").trim();
    const textBytes = Buffer.byteLength(text, "utf8");
    totalBytes += textBytes;
    if (!text || textBytes > CHATGPT_REALTIME_MAX_INITIAL_TEXT_BYTES || totalBytes > CHATGPT_REALTIME_MAX_INITIAL_TEXT_BYTES) {
      throw new ChatGptRealtimeCallError("Voice startup context exceeds its 32 KiB text limit.");
    }
    return {
      type: "message",
      role,
      content: [{
        type: role === "assistant" ? "output_text" : "input_text",
        text,
      }],
    };
  });
}

function normalizeRealtimeSdp(value, kind) {
  const sdp = typeof value === "string" ? value : "";
  const bytes = Buffer.byteLength(sdp, "utf8");
  if (!sdp.trimStart().startsWith("v=0") || bytes > CHATGPT_REALTIME_MAX_SDP_BYTES) {
    throw new ChatGptRealtimeCallError(`ChatGPT Voice returned an invalid WebRTC ${kind}.`);
  }
  return sdp;
}

function normalizeRealtimeIdentifier(value, label) {
  const normalized = String(value ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(normalized)) {
    throw new ChatGptRealtimeCallError(`The ${label} is invalid.`);
  }
  return normalized;
}

function normalizeRealtimeAccessToken(value) {
  const normalized = nonEmptyString(value);
  return normalized
    && normalized.length <= 32_768
    && !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : undefined;
}

function normalizeRealtimeHeaderValue(value, label) {
  const normalized = nonEmptyString(value);
  if (!normalized || normalized.length > 512 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new ChatGptRealtimeCallError(`The ${label} is invalid.`);
  }
  return normalized;
}

function normalizeRealtimeTimeout(value) {
  if (value === undefined) return CHATGPT_REALTIME_REQUEST_TIMEOUT_MS;
  const timeoutMs = Number(value);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > CHATGPT_REALTIME_MAX_REQUEST_TIMEOUT_MS) {
    throw new ChatGptRealtimeCallError("ChatGPT Voice signaling timeout is invalid.");
  }
  return Math.ceil(timeoutMs);
}

async function readBoundedRealtimeResponseText(response) {
  const declaredLength = Number(response.headers?.get?.("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > CHATGPT_REALTIME_MAX_RESPONSE_BYTES) {
    throw new ChatGptRealtimeCallError("ChatGPT Voice returned an oversized signaling response.");
  }
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > CHATGPT_REALTIME_MAX_RESPONSE_BYTES) {
      throw new ChatGptRealtimeCallError("ChatGPT Voice returned an oversized signaling response.");
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    totalBytes += value.byteLength;
    if (totalBytes > CHATGPT_REALTIME_MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new ChatGptRealtimeCallError("ChatGPT Voice returned an oversized signaling response.");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

async function readBoundedRealtimeFailure(response) {
  let raw;
  try {
    raw = await readBoundedRealtimeResponseText(response);
  } catch {
    await response?.body?.cancel?.().catch?.(() => undefined);
    return {};
  }
  if (!raw || raw.length > CHATGPT_REALTIME_MAX_RESPONSE_BYTES) return {};
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return {};
  }
  const candidates = [body?.error?.code, body?.error?.type, body?.code, body?.type];
  let code;
  for (const candidate of candidates) {
    const value = String(candidate ?? "").trim();
    if (/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(value)) {
      code = value;
      break;
    }
  }
  const rawParam = String(body?.error?.param ?? body?.param ?? "").trim();
  const param = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,159}$/.test(rawParam)
    ? rawParam
    : undefined;
  return { code, param };
}

function formatRealtimeCallHttpFailure(status, failure = {}) {
  const code = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(String(failure.code || ""))
    ? String(failure.code)
    : "";
  const param = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,159}$/.test(String(failure.param || ""))
    ? String(failure.param)
    : "";
  const safeFailure = code
    ? ` [${code}${param ? `: ${param}` : ""}]`
    : "";
  if (status === 401 || status === 403) return `ChatGPT Voice authentication expired${safeFailure}. Reconnect your account and try again.`;
  if (status === 429) return `ChatGPT Voice is temporarily rate limited${safeFailure}. Try again later.`;
  const statusCode = Number.isInteger(status) ? ` (${status})` : "";
  return `ChatGPT Voice signaling failed${statusCode}${safeFailure}.`;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function normalizeCodexUsageStats(data, source, auth = {}) {
  const rateLimit = data?.rate_limit ?? {};
  const additional = Array.isArray(data?.additional_rate_limits)
    ? data.additional_rate_limits.map((item, index) => ({
        name: String(item?.limit_name ?? item?.name ?? item?.id ?? `Additional ${index + 1}`),
        primary: normalizeCodexLimitWindow(item?.rate_limit?.primary_window),
        secondary: normalizeCodexLimitWindow(item?.rate_limit?.secondary_window),
        windows: extractCodexRateLimitWindows(item?.rate_limit ?? item, {
          idPrefix: `legacy-additional:${index}`,
          scope: String(item?.limit_name ?? item?.name ?? item?.id ?? `Additional ${index + 1}`),
        }),
      }))
    : [];
  const codeReviewWindows = extractCodexRateLimitWindows(data?.code_review_rate_limit, {
    idPrefix: "legacy-code-review",
    scope: "Code review",
  });

  return {
    source,
    account: auth.email ?? data?.email ?? data?.account_email,
    plan: data?.plan_type ?? data?.plan ?? "unknown",
    updatedAt: new Date().toISOString(),
    primary: normalizeCodexLimitWindow(rateLimit.primary_window),
    secondary: normalizeCodexLimitWindow(rateLimit.secondary_window),
    additional,
    codeReview: normalizeCodexLimitWindow(data?.code_review_rate_limit?.primary_window),
    codeReviewWindows,
    limitWindows: extractCodexUsageLimitWindows(data),
    availableResetCount: firstNumber(data?.rate_limit_reset_credits?.available_count),
  };
}

export function normalizeCodexResetCredits(data) {
  const credits = Array.isArray(data?.credits)
    ? data.credits
        .map(normalizeCodexResetCredit)
        .filter(Boolean)
        .sort(compareCodexResetCredits)
    : [];
  const reportedCount = firstNumber(data?.available_count);
  return {
    availableCount: reportedCount ?? credits.filter(isCodexResetCreditAvailable).length,
    credits,
  };
}

export function normalizeCodexResetCredit(value) {
  if (!value || typeof value.id !== "string" || !value.id) return undefined;
  return {
    id: value.id,
    title: String(value.title ?? "Codex rate-limit reset"),
    status: String(value.status ?? "unknown").toLowerCase(),
    resetType: stringOrUndefined(value.reset_type),
    grantedAt: normalizeResetAt(value.granted_at),
    expiresAt: normalizeResetAt(value.expires_at),
    description: stringOrUndefined(value.description),
  };
}

export function normalizeCodexResetRedemption(data) {
  return {
    code: stringOrUndefined(data?.code),
    windowsReset: firstNumber(data?.windows_reset),
    redeemedAt: normalizeResetAt(data?.credit?.redeemed_at),
    credit: normalizeCodexResetCredit(data?.credit),
  };
}

export function isCodexResetCreditAvailable(credit, now = Date.now()) {
  if (credit?.status !== "available") return false;
  if (!credit.expiresAt) return true;
  return new Date(credit.expiresAt).getTime() > now;
}

async function requestCodexAccountJson(pathname, init = {}) {
  const auth = await resolveChatGptAccountAuth();
  if (!auth) {
    throw new Error("No ChatGPT account is connected through Pi. Run /login or `zyra login subscription`.");
  }

  const response = await fetchCodexAccountWithAuth(auth, pathname, init);
  const raw = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(formatCodexUsageHttpFailure(response.status, response.statusText, raw));
  }
  if (!raw) return { data: {}, auth };
  try {
    return { data: JSON.parse(raw), auth };
  } catch {
    throw new Error(`Codex account request failed (${response.status}): expected JSON response.`);
  }
}

function fetchCodexAccountWithAuth(auth, pathname, init = {}) {
  const headers = {
    Authorization: `Bearer ${auth.accessToken}`,
    Accept: "application/json",
    "User-Agent": "zyra-codex-resets/1.0",
    Origin: "https://chatgpt.com",
  };
  if (auth.accountId) headers["ChatGPT-Account-Id"] = auth.accountId;
  if (init.body) headers["Content-Type"] = "application/json";
  return fetch(`${CODEX_ACCOUNT_API_BASE}${pathname}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  });
}

function extractOpenAiCodexClaims(accessToken) {
  const payload = decodeJwtPayload(accessToken);
  const auth = payload?.["https://api.openai.com/auth"] ?? {};
  const profile = payload?.["https://api.openai.com/profile"] ?? {};
  if (!payload) return undefined;
  return {
    email: typeof profile.email === "string" ? profile.email : undefined,
    emailVerified: typeof profile.email_verified === "boolean" ? profile.email_verified : undefined,
    plan: typeof auth.chatgpt_plan_type === "string" ? auth.chatgpt_plan_type : undefined,
    accountId: typeof auth.chatgpt_account_id === "string" ? auth.chatgpt_account_id : undefined,
  };
}

function decodeJwtPayload(token) {
  if (typeof token !== "string") return undefined;
  const parts = token.split(".");
  if (parts.length < 2) return undefined;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}

function appendUsageWindow(lines, label, bucket, options = {}) {
  if (!bucket) {
    if (!options.hideEmpty) lines.push(` ${label.padEnd(16)} unknown`);
    return;
  }
  if (options.hideEmpty && bucket.usedPercent <= 0) return;
  lines.push(` ${label.padEnd(16)} ${formatUsagePercent(bucket.usedPercent)}${formatReset(bucket.resetAt)}`);
}

function shortId(value) {
  const text = String(value ?? "");
  if (!text) return "unknown";
  return text.length <= 14 ? text : `${text.slice(0, 8)}…${text.slice(-4)}`;
}

function compareCodexResetCredits(left, right) {
  const availability = Number(isCodexResetCreditAvailable(right)) - Number(isCodexResetCreditAvailable(left));
  if (availability !== 0) return availability;
  return resetDateValue(left.expiresAt, Number.MAX_SAFE_INTEGER) - resetDateValue(right.expiresAt, Number.MAX_SAFE_INTEGER);
}

function formatCodexUsageHttpFailure(status, statusText, body) {
  if (isCloudflareChallenge(body)) {
    return `Codex usage request failed (${status}): ChatGPT returned a Cloudflare browser challenge. Try again after /reload, or check https://chatgpt.com/codex/settings/usage in the browser.`;
  }
  const clean = stripHtml(body).replace(/\s+/g, " ").trim();
  const detail = clean ? `: ${clean.slice(0, 240)}${clean.length > 240 ? "…" : ""}` : `: ${statusText}`;
  return `Codex usage request failed (${status})${detail}`;
}

function isCloudflareChallenge(body) {
  return /__cf_chl_|challenge-platform|Enable JavaScript and cookies|cloudflare/i.test(String(body ?? ""));
}

function stripHtml(value) {
  return String(value ?? "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ");
}

function stringOrUndefined(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function resetDateValue(value, fallback) {
  if (!value) return fallback;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : fallback;
}

function firstNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return undefined;
}

function normalizeResetAt(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number") {
    const ms = value > 10_000_000_000 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function formatUsagePercent(usedPercent) {
  const used = Math.max(0, Math.min(100, Number(usedPercent) || 0));
  const left = Math.max(0, 100 - used);
  return `${formatPercent(used)} used (${formatPercent(left)} left)`;
}

function formatPercent(value) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

function formatReset(iso) {
  if (!iso) return "";
  const reset = new Date(iso);
  const millis = reset.getTime() - Date.now();
  if (!Number.isFinite(millis) || millis <= 0) return "";
  return ` · resets in ${formatDuration(millis)}`;
}

function formatDuration(millis) {
  const minutes = Math.max(0, Math.round(millis / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d${hours ? ` ${hours}h` : ""}`;
  if (hours > 0) return `${hours}h${mins ? `${mins}m` : ""}`;
  return `${mins}m`;
}

function formatLocalDateTime(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? String(iso ?? "unknown") : date.toLocaleString();
}
