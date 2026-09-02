export const ZYRA_RETRY_MAX_ATTEMPTS = 10;
export const ZYRA_RETRY_BASE_DELAY_MS = 100;

const NETWORK_RECOVERY_ERROR_PATTERN = /\bfetch failed\b|network request failed|network(?: is)? (?:unavailable|offline)|socket(?: is)? (?:closed|hang up)|agent[- ]server (?:connection )?closed|agent server is disconnected|\b(?:econnreset|econnrefused|etimedout|enotfound|eai_again|epipe)\b|\bund_err_/i;

export function isNetworkRecoveryError(value) {
  const message = value instanceof Error ? value.message : String(value || "");
  const code = value && typeof value === "object" && "code" in value
    ? String(value.code || "")
    : "";
  return NETWORK_RECOVERY_ERROR_PATTERN.test(`${code} ${message}`);
}

export function classifyRecoveryError(value) {
  return isNetworkRecoveryError(value) ? "network" : "provider";
}

export function buildRecoveryPresentation(input = {}) {
  const error = input.errorMessage ?? input.finalError ?? input.error;
  const recoveryKind = input.recoveryKind === "network" || input.recoveryKind === "provider"
    ? input.recoveryKind
    : classifyRecoveryError(error);
  const attempt = Math.max(0, Math.floor(Number(input.attempt) || 0));
  const maxAttempts = Math.max(attempt, Math.floor(Number(input.maxAttempts) || ZYRA_RETRY_MAX_ATTEMPTS));
  const status = input.status === "recovered" || input.success === true
    ? "recovered"
    : input.status === "paused" || input.success === false
      ? "paused"
      : "retrying";

  if (status === "recovered") {
    return {
      recoveryKind,
      status,
      label: recoveryKind === "network" ? "Reconnected" : "Provider available",
      attempt,
      maxAttempts
    };
  }
  if (status === "paused") {
    return {
      recoveryKind,
      status,
      label: recoveryKind === "network" ? "Paused · Network issue" : "Paused · Provider unavailable",
      attempt,
      maxAttempts
    };
  }
  return {
    recoveryKind,
    status,
    label: `${recoveryKind === "network" ? "Reconnecting" : "Retrying"} ${attempt || 1} of ${maxAttempts}`,
    attempt: attempt || 1,
    maxAttempts
  };
}
