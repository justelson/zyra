import { defineTool } from "@earendil-works/pi-coding-agent";
import { browserControlSchema, BROWSER_CONTROL_OPERATIONS } from "./tool-contracts.mjs";
import { normalizeControlToolInput, unavailableControlResult } from "./contracts.mjs";

export function createBrowserControlTool(options = {}) {
  return defineTool({
    name: "browser_control",
    label: "Browser control",
    description: "Discover and reveal Browser targets, create normal or incognito in-app tabs when needed, request bounded access, then visually observe and control only granted targets. The chat permission mode applies here too: Full access and routine Auto review in-app grants proceed automatically; Supervised, Edits only, and Auto review for paired Chrome ask in chat. Critical side effects always pause in chat. New tabs default to incognito; choose normal only when saved sign-in or site state is required.",
    parameters: browserControlSchema,
    execute: async (_toolCallId, input = {}, signal) => {
      const normalized = normalizeControlToolInput(input);
      if (!BROWSER_CONTROL_OPERATIONS.includes(normalized.operation)) {
        return toolResult(`Operation ${normalized.operation} is not available for browser_control.`, { ok: false, code: "CONTROL_UNKNOWN_OPERATION" });
      }
      if (!options.client) {
        const unavailable = unavailableControlResult("Browser control");
        return toolResult(unavailable.error.message, unavailable);
      }
      try {
        const operation = toBridgeOperation(normalized);
        const waitsForUser = normalized.operation === "request_grant" || (normalized.sideEffect && normalized.sideEffect !== "none");
        const timeoutMs = normalized.timeoutMs ?? (waitsForUser ? 10 * 60 * 1000 : normalized.operation === "open_tab" ? 30000 : undefined);
        const result = await options.client.request(operation, { signal, timeoutMs });
        return toolResult(formatControlResult(normalized.operation, result), result);
      } catch (error) {
        return toolResult(`Browser control failed: ${error instanceof Error ? error.message : String(error)}`, {
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
  if (["list_targets", "open_tab", "reveal_tab", "close_tab", "refresh_tab", "open_external", "set_tab_layout", "resize_inspector", "request_grant", "observe", "release"].includes(input.operation)) return input;
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
      ...(input.x !== undefined ? { x: input.x } : {}),
      ...(input.y !== undefined ? { y: input.y } : {}),
      ...(input.fromX !== undefined ? { fromX: input.fromX } : {}),
      ...(input.fromY !== undefined ? { fromY: input.fromY } : {}),
      ...(input.toX !== undefined ? { toX: input.toX } : {}),
      ...(input.toY !== undefined ? { toY: input.toY } : {}),
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
      ...(input.button ? { button: input.button } : {}),
      ...(input.clickCount !== undefined ? { clickCount: input.clickCount } : {}),
      ...(input.url ? { url: input.url } : {}),
      ...(input.text !== undefined ? { text: input.text } : {}),
      ...(input.replace !== undefined ? { replace: input.replace } : {}),
      ...(input.key ? { key: input.key } : {}),
      ...(input.modifiers ? { modifiers: input.modifiers } : {}),
      ...(input.deltaX !== undefined ? { deltaX: input.deltaX } : {}),
      ...(input.deltaY !== undefined ? { deltaY: input.deltaY } : {}),
      ...(input.values ? { values: input.values } : {}),
      ...(input.condition ? { condition: input.condition } : {}),
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      ...(input.sideEffect ? { sideEffect: input.sideEffect } : {}),
    },
  };
}

function formatControlResult(operation, result) {
  if (operation === "list_targets") {
    const targets = (Array.isArray(result.targets) ? result.targets : []).slice(0, 32).map((target) => ({
      targetId: target.targetId,
      kind: target.kind,
      tabId: target.tabId,
      sessionMode: target.sessionMode,
      title: target.title,
      url: target.url,
      origin: target.origin,
    }));
    const grants = (Array.isArray(result.grants) ? result.grants : []).slice(0, 32).map((grant) => ({
      grantId: grant.grantId,
      targetId: grant.targetId,
      capabilities: grant.capabilities,
      expiresAt: grant.expiresAt,
      remainingActions: Math.max(0, Number(grant.maxActions) - Number(grant.actionCount)),
    }));
    return `Available Browser targets, active grants, and visible workspace state:\n${JSON.stringify({ targets, grants, workspace: result.workspace || null }, null, 2)}`;
  }
  if (operation === "open_tab") {
    const target = result.target || {};
    return `A blank in-app Browser tab is registered. It has no navigation or input authority yet. Request a scoped grant before using it.\n${JSON.stringify({ targetId: target.targetId, tabId: target.tabId, sessionMode: target.sessionMode, title: target.title, url: target.url, revealed: Boolean(result.revealed) }, null, 2)}`;
  }
  if (operation === "reveal_tab") {
    const target = result.target || {};
    return `The existing Browser tab is now the primary visible tab.\n${JSON.stringify({ targetId: target.targetId, tabId: target.tabId, sessionMode: target.sessionMode, title: target.title, url: target.url }, null, 2)}`;
  }
  if (operation === "close_tab") return "The selected Browser tab was closed and its control authority was revoked.";
  if (operation === "refresh_tab") return "The selected Browser tab was refreshed.";
  if (operation === "open_external") return `The approved URL was opened in the default browser.\n${JSON.stringify({ url: result.url }, null, 2)}`;
  if (operation === "set_tab_layout") {
    return `Browser layout updated.\n${JSON.stringify({ layout: result.layout, primaryTargetId: result.primaryTargetId, secondaryTargetId: result.secondaryTargetId || null }, null, 2)}`;
  }
  if (operation === "resize_inspector") return `Inspector width updated to ${Number(result.width)}px (requested ${Number(result.requestedWidth)}px).`;
  if (operation === "request_grant") {
    return result.pending
      ? `Browser access is waiting for approval in chat.\n${JSON.stringify({ requestId: result.request?.requestId, targetId: result.request?.targetId, capabilities: result.request?.capabilities, expiresAt: result.request?.expiresAt }, null, 2)}`
      : `Control grant issued.\n${JSON.stringify({ grantId: result.grant?.grantId, targetId: result.grant?.targetId, capabilities: result.grant?.capabilities, expiresAt: result.grant?.expiresAt, remainingActions: Math.max(0, Number(result.grant?.maxActions) - Number(result.grant?.actionCount)) }, null, 2)}`;
  }
  if (operation === "release") return "Control grant released.";
  if (result.observation) {
    const observation = result.observation;
    return `Browser ${operation} completed.\n${JSON.stringify({ revision: observation.revision, targetId: observation.targetId, url: observation.url, title: observation.title, viewport: observation.viewport, screenshotAttached: Boolean(result.screenshot) }, null, 2)}`;
  }
  return `Browser ${operation} completed.`;
}

function toolResult(text, details) {
  const screenshot = details?.screenshot;
  const content = [{ type: "text", text }];
  if (screenshot?.data && /^image\/(?:jpeg|png|webp)$/.test(String(screenshot.mimeType || ""))) {
    content.push({ type: "image", data: screenshot.data, mimeType: screenshot.mimeType });
  }
  const boundedDetails = screenshot
    ? { ...details, screenshot: { mimeType: screenshot.mimeType, bytes: screenshot.bytes } }
    : details;
  return { content, details: boundedDetails };
}
