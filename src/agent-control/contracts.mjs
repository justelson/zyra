export const CONTROL_PROTOCOL_VERSION = 1;
export const CONTROL_CAPABILITIES = Object.freeze([
  "observe.structure",
  "observe.screenshot",
  "navigate",
  "pointer.click",
  "pointer.move",
  "pointer.drag",
  "keyboard.type",
  "keyboard.key",
  "scroll",
  "form.select",
  "window.focus",
  "tab.manage",
]);

export const CONTROL_BOUNDS = Object.freeze({
  maxObservationElements: 1500,
  maxObservationBytes: 512 * 1024,
  maxScreenshotBytes: 2 * 1024 * 1024,
  maxVisualScreenshotBytes: 300 * 1024,
  maxPendingActionsPerTarget: 32,
  maxAuditEntries: 500,
  maxPendingPairingRequests: 32,
  maxBridgeMessageBytes: 512 * 1024,
  maxTypedTextLength: 16384,
  maxUrlLength: 2048,
  maxGrantDurationMs: 30 * 60 * 1000,
  maxGrantActions: 500,
  defaultActionTimeoutMs: 15000,
  minInspectorWidth: 340,
  maxInspectorWidth: 1600,
});

const capabilities = new Set(CONTROL_CAPABILITIES);
const identifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,191}$/;

export class ControlContractError extends Error {
  constructor(message, code = "CONTROL_VALIDATION_ERROR") {
    super(message);
    this.name = "ControlContractError";
    this.code = code;
  }
}

function fail(message) {
  throw new ControlContractError(message);
}

export function assertControlIdentifier(value, label = "identifier") {
  if (typeof value !== "string" || !identifierPattern.test(value)) fail(`${label} is invalid.`);
  return value;
}

export function assertControlCapabilities(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > CONTROL_CAPABILITIES.length) {
    fail("Capabilities must be a non-empty bounded array.");
  }
  return [...new Set(value.map((entry) => {
    if (!capabilities.has(entry)) fail(`Unknown control capability: ${String(entry)}`);
    return entry;
  }))];
}

export function assertControlPrincipal(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Principal is invalid.");
  if (value.type === "root") {
    return {
      type: "root",
      threadId: assertControlIdentifier(value.threadId, "threadId"),
      turnId: assertControlIdentifier(value.turnId, "turnId"),
    };
  }
  if (value.type === "agent") {
    return {
      type: "agent",
      fleetId: assertControlIdentifier(value.fleetId, "fleetId"),
      agentRunId: assertControlIdentifier(value.agentRunId, "agentRunId"),
      parentThreadId: assertControlIdentifier(value.parentThreadId, "parentThreadId"),
    };
  }
  fail("Principal type is invalid.");
}

export function normalizeControlToolInput(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Control tool input is invalid.");
  const operation = String(value.operation || "");
  const allowed = new Set([
    "list_targets", "open_tab", "reveal_tab", "close_tab", "refresh_tab", "open_external", "set_tab_layout", "resize_inspector", "open_app", "list_windows", "request_grant", "observe", "navigate", "move", "click", "drag",
    "type", "key", "scroll", "select", "wait", "focus", "release",
  ]);
  if (!allowed.has(operation)) fail(`Unknown control operation: ${operation || "missing"}`);
  if (JSON.stringify(value).length > CONTROL_BOUNDS.maxBridgeMessageBytes) fail("Control request is too large.");
  return { ...value, operation };
}

export function unavailableControlResult(target = "desktop control") {
  return {
    ok: false,
    error: {
      code: "CONTROL_CAPABILITY_UNAVAILABLE",
      message: `${target} is available only from a connected Zyra desktop session.`,
      retryable: false,
    },
  };
}
