import { defineTool } from "@earendil-works/pi-coding-agent";
import { computerControlSchema, COMPUTER_CONTROL_OPERATIONS } from "./tool-contracts.mjs";
import { normalizeControlToolInput, unavailableControlResult } from "./contracts.mjs";

export function createComputerControlTool(options = {}) {
  return defineTool({
    name: "computer_control",
    label: "Computer control",
    description: "Open, observe, and control one ordinary Windows application through the desktop permission broker. Use open_app when the requested app is not running, otherwise start with list_windows. For the app the user requested, call request_grant with its windowToken; this selects that exact window and requests access in one step. Full access issues routine grants automatically. Supervised, Auto review, and Edits only ask in chat. Critical side effects always pause in chat.",
    parameters: computerControlSchema,
    execute: async (_toolCallId, input = {}, signal) => {
      const normalized = normalizeControlToolInput(input);
      if (!COMPUTER_CONTROL_OPERATIONS.includes(normalized.operation)) {
        return toolResult(`Operation ${normalized.operation} is not available for computer_control.`, { ok: false, code: "CONTROL_UNKNOWN_OPERATION" });
      }
      if (!options.client) {
        const unavailable = unavailableControlResult("Windows computer control");
        return toolResult(unavailable.error.message, unavailable);
      }
      try {
        const operation = toBridgeOperation(normalized);
        const waitsForUser = normalized.operation === "request_grant" || (normalized.sideEffect && normalized.sideEffect !== "none");
        const timeoutMs = normalized.timeoutMs ?? (waitsForUser ? 10 * 60 * 1000 : undefined);
        const result = await options.client.request(operation, { signal, timeoutMs });
        return toolResult(formatControlResult(normalized.operation, result), result);
      } catch (error) {
        return toolResult(`Computer control failed: ${error instanceof Error ? error.message : String(error)}`, {
          ok: false,
          code: error?.code || "CONTROL_ERROR",
          retryable: Boolean(error?.retryable),
          freshRevision: error?.freshRevision,
        });
      }
    },
  });
}

function toBridgeOperation(input) {
  if (["open_app", "list_windows", "request_grant", "observe", "release"].includes(input.operation)) return input;
  return {
    operation: "act",
    version: 1,
    requestId: input.requestId || `tool:${Date.now()}`,
    grantId: input.grantId,
    targetId: input.targetId,
    observationRevision: input.observationRevision,
    action: {
      type: input.operation,
      ...(input.elementRef ? { elementRef: input.elementRef } : {}),
      ...(input.text !== undefined ? { text: input.text } : {}),
      ...(input.replace !== undefined ? { replace: input.replace } : {}),
      ...(input.key ? { key: input.key } : {}),
      ...(input.modifiers ? { modifiers: input.modifiers } : {}),
      ...(input.deltaX !== undefined ? { deltaX: input.deltaX } : {}),
      ...(input.deltaY !== undefined ? { deltaY: input.deltaY } : {}),
      ...(input.condition ? { condition: input.condition } : {}),
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      ...(input.sideEffect ? { sideEffect: input.sideEffect } : {}),
    },
  };
}

function formatControlResult(operation, result) {
  if (operation === "list_windows") {
    const windows = Array.isArray(result.windows) ? result.windows : [];
    const available = windows.filter((entry) => entry && typeof entry === "object" && !entry.blocked);
    if (available.length === 0) return "No controllable ordinary Windows application windows are currently available.";
    return [
      `Controllable Windows applications (${available.length}). Use request_grant with the windowToken for the app the user requested:`,
      ...available.slice(0, 32).map((entry, index) => {
        const application = String(entry.applicationName || "Unknown application").slice(0, 128);
        const target = entry.targetId
          ? `targetId: ${String(entry.targetId).slice(0, 256)}`
          : `windowToken: ${String(entry.windowToken || "").slice(0, 512)}`;
        return `- ${application} window ${index + 1} — ${target}`;
      }),
      "Window titles stay private until access to the selected target is granted.",
    ].join("\n");
  }
  if (operation === "request_grant") return result.pending ? "Control grant is waiting for approval in chat." : "Control grant issued.";
  if (operation === "release") return "Control grant released.";
  if (result.observation) return `Computer ${operation} completed at revision ${result.observation.revision}.`;
  return `Computer ${operation} completed.`;
}

function toolResult(text, details) {
  return { content: [{ type: "text", text }], details };
}
