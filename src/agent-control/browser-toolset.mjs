import { randomUUID } from "node:crypto";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { CONTROL_CAPABILITIES, unavailableControlResult } from "./contracts.mjs";
import { formatControlObservation } from "./observation-feedback.mjs";

export const BROWSER_LOADER_TOOL_NAME = "browser_use";
export const BROWSER_TOOLSET_NAMES = Object.freeze([
  "browser_tabs",
  "browser_access",
  "browser_observe",
  "browser_perform",
  "browser_session",
]);
const LEGACY_BROWSER_TOOL_NAME = "browser_control";

const operation = (...values) => Type.Union(values.map((value) => Type.Literal(value)));
const capability = Type.Union(CONTROL_CAPABILITIES.map((value) => Type.Literal(value)));
const observationMode = operation("visual", "structure", "both");
const button = operation("left", "middle", "right");
const sideEffect = operation(
  "none", "send-or-publish", "purchase", "account-change", "security-change", "destructive-delete",
  "file-upload", "sensitive-data-submit", "software-install", "legal-acceptance",
);
const point = Type.Object({ x: Type.Number(), y: Type.Number() }, { additionalProperties: false });
const waitCondition = Type.Union([
  Type.Object({ type: Type.Literal("delay"), durationMs: Type.Number() }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("target-ready") }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("url-changed"), from: Type.Optional(Type.String()) }, { additionalProperties: false }),
]);
const action = Type.Union([
  Type.Object({ type: Type.Literal("move"), x: Type.Number(), y: Type.Number(), durationMs: Type.Optional(Type.Number()) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("click"), elementRef: Type.Optional(Type.String()), x: Type.Optional(Type.Number()), y: Type.Optional(Type.Number()), button: Type.Optional(button), clickCount: Type.Optional(Type.Number()), sideEffect: Type.Optional(sideEffect) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("drag"), fromX: Type.Number(), fromY: Type.Number(), toX: Type.Number(), toY: Type.Number(), durationMs: Type.Optional(Type.Number()), button: Type.Optional(button) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("stroke"), points: Type.Array(point, { minItems: 2, maxItems: 512 }), durationMs: Type.Optional(Type.Number()), button: Type.Optional(button) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("type"), elementRef: Type.Optional(Type.String()), x: Type.Optional(Type.Number()), y: Type.Optional(Type.Number()), text: Type.String(), replace: Type.Optional(Type.Boolean()), sideEffect: Type.Optional(sideEffect) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("key"), key: Type.String(), modifiers: Type.Optional(Type.Array(Type.String(), { maxItems: 8 })), sideEffect: Type.Optional(sideEffect) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("scroll"), elementRef: Type.Optional(Type.String()), x: Type.Optional(Type.Number()), y: Type.Optional(Type.Number()), deltaX: Type.Number(), deltaY: Type.Number() }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("select"), elementRef: Type.String(), values: Type.Array(Type.String(), { minItems: 1, maxItems: 32 }), sideEffect: Type.Optional(sideEffect) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("navigate"), url: Type.String() }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("wait"), condition: waitCondition, timeoutMs: Type.Number() }, { additionalProperties: false }),
]);

const browserUseSchema = Type.Object({ action: operation("load", "unload", "status") }, { additionalProperties: false });
const browserTabsSchema = Type.Object({
  operation: operation("list", "open", "reveal", "layout", "resize", "refresh", "close", "open_external"),
  targetId: Type.Optional(Type.String()),
  primaryTargetId: Type.Optional(Type.String()),
  secondaryTargetId: Type.Optional(Type.String()),
  grantId: Type.Optional(Type.String()),
  reveal: Type.Optional(Type.Boolean()),
  sessionMode: Type.Optional(operation("normal", "incognito")),
  width: Type.Optional(Type.Number()),
  url: Type.Optional(Type.String()),
}, { additionalProperties: false });
const browserAccessSchema = Type.Object({
  operation: operation("request", "release"),
  targetId: Type.Optional(Type.String()),
  grantId: Type.Optional(Type.String()),
  capabilities: Type.Optional(Type.Array(capability, { maxItems: CONTROL_CAPABILITIES.length })),
  durationMs: Type.Optional(Type.Number()),
  maxActions: Type.Optional(Type.Number()),
  allowedOrigins: Type.Optional(Type.Array(Type.String(), { maxItems: 32 })),
}, { additionalProperties: false });
const browserObserveSchema = Type.Object({
  targetId: Type.String(),
  grantId: Type.String(),
  mode: Type.Optional(observationMode),
  includeScreenshot: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });
const browserPerformSchema = Type.Object({
  targetId: Type.String(),
  grantId: Type.String(),
  observationRevision: Type.Number(),
  stage: Type.Object({
    summary: Type.String(),
    expectedActivity: operation("pointer", "keyboard", "scroll", "mixed"),
    expectedRegion: Type.Optional(Type.Object({ x: Type.Number(), y: Type.Number(), width: Type.Number(), height: Type.Number() }, { additionalProperties: false })),
  }, { additionalProperties: false }),
  steps: Type.Array(action, { minItems: 1, maxItems: 64 }),
  observationMode: Type.Optional(observationMode),
  includeScreenshot: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });
const browserSessionSchema = Type.Object({
  operation: operation("status", "resume", "cancel", "unload"),
  planId: Type.Optional(Type.String()),
  disposition: Type.Optional(operation("continue-with-changes", "replan-from-here")),
  releaseGrant: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

export function createBrowserToolSet(options = {}) {
  const controller = createActivationController(options.sessionRef);
  return [
    defineTool({
      name: BROWSER_LOADER_TOOL_NAME,
      label: "Browser tools",
      description: "Load or unload Zyra's bounded in-app Browser tools on demand. Use this only when the task requires Browser tabs or web interaction.",
      parameters: browserUseSchema,
      execute: async (_toolCallId, input = {}) => localToolResult(controller.run(input.action)),
    }),
    bridgeTool({
      name: "browser_tabs",
      label: "Browser tabs",
      description: "Discover, open, reveal, arrange, resize, refresh, close, or externally hand off retained in-app Browser tabs. New tabs default to incognito; choose normal only when the task needs saved sign-in or site state. Closing requires an exact tab.manage grantId; refreshing requires navigate; external handoff requires tab.manage plus the exact allowed origin.",
      parameters: browserTabsSchema,
      client: options.client,
      timeoutMs: 60_000,
      toOperation: (input) => ({
        ...input,
        operation: ({ list: "list_targets", open: "open_tab", reveal: "reveal_tab", layout: "set_tab_layout", resize: "resize_inspector", refresh: "refresh_tab", close: "close_tab", open_external: "open_external" })[input.operation],
      }),
    }),
    bridgeTool({
      name: "browser_access",
      label: "Browser access",
      description: "Request an exact-target, user-approved Browser grant or release an existing grant. A grant containing observe.structure returns its initial structural observation, so do not call browser_observe again unless the page changes or another action is needed.",
      parameters: browserAccessSchema,
      client: options.client,
      timeoutMs: 10 * 60 * 1000,
      toOperation: (input) => input.operation === "request"
        ? { ...input, operation: "request_grant" }
        : { operation: "release", grantId: input.grantId },
    }),
    bridgeTool({
      name: "browser_observe",
      label: "Observe Browser",
      description: "Capture a current visual, structural, or combined observation of one granted Browser target.",
      parameters: browserObserveSchema,
      client: options.client,
      timeoutMs: 30_000,
      toOperation: (input) => ({ operation: "observe", ...input, mode: input.mode || "both", includeScreenshot: input.includeScreenshot ?? input.mode !== "structure" }),
    }),
    bridgeTool({
      name: "browser_perform",
      label: "Perform Browser stage",
      description: "Execute one bounded target-local Browser stage continuously, including multi-point pen strokes, then return one checkpoint observation. Stages pause only for purposeful interaction on that exact target; other tabs never interrupt them.",
      parameters: browserPerformSchema,
      client: options.client,
      timeoutMs: 30_000,
      toOperation: (input) => ({
        operation: "perform",
        version: 1,
        requestId: `tool:${randomUUID()}`,
        ...input,
        observationMode: input.observationMode || "visual",
        includeScreenshot: input.includeScreenshot ?? true,
      }),
    }),
    bridgeTool({
      name: "browser_session",
      label: "Browser session",
      description: "Inspect, reobserve for replanning, cancel a paused Browser stage, or unload the on-demand Browser tool set. Resume always requires a fresh plan.",
      parameters: browserSessionSchema,
      client: options.client,
      local: (input) => input.operation === "unload" ? controller.run("unload") : null,
      toOperation: (input) => {
        if (input.operation === "status") return { operation: "plan_status", ...(input.planId ? { planId: input.planId } : {}) };
        if (input.operation === "resume") return { operation: "resume_plan", planId: input.planId, disposition: input.disposition || "replan-from-here" };
        return { operation: "cancel_plan", planId: input.planId, releaseGrant: Boolean(input.releaseGrant) };
      },
    }),
  ];
}

export function applyBrowserLoaderOnlyState(session) {
  if (!session?.getActiveToolNames || !session?.setActiveToolsByName) return [];
  const active = new Set(session.getActiveToolNames());
  active.delete(LEGACY_BROWSER_TOOL_NAME);
  for (const name of BROWSER_TOOLSET_NAMES) active.delete(name);
  active.add(BROWSER_LOADER_TOOL_NAME);
  session.setActiveToolsByName([...active]);
  return [...active];
}

export function installBrowserToolTurnCleanup(session) {
  if (!session?.subscribe) return () => {};
  return session.subscribe((event) => {
    if (event?.type === "agent_end") applyBrowserLoaderOnlyState(session);
  });
}

function createActivationController(sessionRef) {
  return {
    run(actionValue) {
      const action = String(actionValue || "status");
      const session = sessionRef?.current;
      if (!session?.getActiveToolNames || !session?.setActiveToolsByName) {
        return { ok: false, code: "CONTROL_CAPABILITY_UNAVAILABLE", message: "Browser tools are unavailable before the agent session is ready." };
      }
      const active = new Set(session.getActiveToolNames());
      if (action === "load") {
        active.delete(LEGACY_BROWSER_TOOL_NAME);
        active.add(BROWSER_LOADER_TOOL_NAME);
        for (const name of BROWSER_TOOLSET_NAMES) active.add(name);
        session.setActiveToolsByName([...active]);
      } else if (action === "unload") {
        active.delete(LEGACY_BROWSER_TOOL_NAME);
        for (const name of BROWSER_TOOLSET_NAMES) active.delete(name);
        active.add(BROWSER_LOADER_TOOL_NAME);
        session.setActiveToolsByName([...active]);
      }
      return {
        ok: true,
        loaded: BROWSER_TOOLSET_NAMES.every((name) => active.has(name)),
        activeBrowserTools: [...active].filter((name) => name === BROWSER_LOADER_TOOL_NAME || BROWSER_TOOLSET_NAMES.includes(name)),
        message: action === "load" ? "Browser tool set loaded for this session." : action === "unload" ? "Browser tool set unloaded." : "Browser tool set status.",
      };
    },
  };
}

function bridgeTool({ name, label, description, parameters, client, toOperation, timeoutMs, local }) {
  return defineTool({
    name,
    label,
    description,
    parameters,
    execute: async (_toolCallId, input = {}, signal) => {
      const localResult = local?.(input);
      if (localResult) return localToolResult(localResult);
      if (!client) {
        const unavailable = unavailableControlResult("Browser control");
        return toolResult(unavailable.error.message, unavailable);
      }
      try {
        const result = await client.request(toOperation(input), { signal, timeoutMs });
        return toolResult(formatResult(name, input, result), result);
      } catch (error) {
        return toolResult(`Browser operation failed: ${error instanceof Error ? error.message : String(error)}`, {
          ok: false,
          code: error?.code || "CONTROL_ERROR",
          retryable: Boolean(error?.retryable),
          freshRevision: error?.freshRevision,
        });
      }
    },
  });
}

function formatResult(name, input, result) {
  if (name === "browser_tabs" && input.operation === "list") {
    return `Available Browser tabs and grants:\n${JSON.stringify({ targets: result.targets || [], grants: result.grants || [], workspace: result.workspace || null }, null, 2)}`;
  }
  if (name === "browser_access" && input.operation === "request") {
    const grant = `Control grant issued.\n${JSON.stringify({ grantId: result.grant?.grantId, targetId: result.grant?.targetId, capabilities: result.grant?.capabilities, expiresAt: result.grant?.expiresAt, remainingActions: Math.max(0, Number(result.grant?.maxActions) - Number(result.grant?.actionCount)) }, null, 2)}`;
    return result.observation ? `${grant}\n${formatBrowserObservation("Initial Browser observation ready.", result)}` : grant;
  }
  if (name === "browser_perform") {
    const summary = {
      planId: result.planId,
      outcome: result.outcome,
      completedSteps: result.completedSteps,
      totalSteps: result.totalSteps,
      revision: result.observation?.revision,
      targetId: result.targetId,
      screenshotAttached: Boolean(result.screenshot),
      pause: result.pause || null,
    };
    const checkpoint = result.observation ? `\n${formatBrowserObservation("Browser checkpoint observation ready.", result)}` : "";
    return `${result.outcome === "paused" ? "Browser stage paused at a clean boundary. Explain the target-local evidence and ask the user to choose: Continue with your changes, Replan from here, or I'm taking over. Do not replay the interrupted stage." : "Browser stage completed."}\n${JSON.stringify(summary, null, 2)}${checkpoint}`;
  }
  if (result.observation) return formatBrowserObservation("Browser observation ready.", result);
  return `Browser operation completed.\n${JSON.stringify(result, null, 2)}`;
}

function formatBrowserObservation(prefix, result) {
  const observation = result.observation;
  return formatControlObservation(prefix, observation, {
    url: observation?.url,
    origin: observation?.origin,
    viewport: observation?.viewport,
    screenshotAttached: Boolean(result.screenshot),
    replanningRequired: result.replanningRequired,
  });
}

function localToolResult(details) {
  return { content: [{ type: "text", text: details.message || JSON.stringify(details, null, 2) }], details };
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
