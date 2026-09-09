// Pi records returned tool values as success, even when details.ok is false.
// Throwing preserves its real failure status; Pi retains the message as content.
export function computerToolError(error) {
  const code = typeof error?.code === 'string' && /^CONTROL_[A-Z_]+$/.test(error.code) ? error.code : 'CONTROL_ERROR';
  const freshRevision = Number.isInteger(error?.freshRevision) && error.freshRevision > 0 ? error.freshRevision : undefined;
  const message = String(error?.message ?? error ?? 'Computer operation failed.').slice(0, 1024);
  const focusRecovery = code === 'CONTROL_TARGET_BLOCKED' && /obscured|foreground|focused window/i.test(message);
  const details = { code, retryable: Boolean(error?.retryable) || focusRecovery, ...(freshRevision ? { freshRevision } : {}) };
  const recovery = code === 'CONTROL_STALE_OBSERVATION'
    ? 'Observe the same granted target and use its current revision before deciding the next action.'
    : code === 'CONTROL_TIMEOUT' || code === 'CONTROL_DRIVER_UNAVAILABLE'
      ? 'Input may have partially completed. Rediscover the requested app and inspect its current state; do not replay the previous action blindly.'
      : focusRecovery
        ? 'The exact selected app may be behind another window. If its grant includes window.focus, use computer_focus and inspect a fresh observation. Otherwise rediscover the same app and request its exact candidate with focus plus the capabilities needed for the remaining task. Never click the obstructing window or replay a failed sequence; inspect current state and continue only unfinished steps. If the target remains obscured after focusing, stop and report the blocker.'
        : undefined;
  return Object.assign(new Error(`Computer operation failed: ${message}\n${JSON.stringify({ ...details, ...(recovery ? { recovery } : {}) })}`), details);
}
