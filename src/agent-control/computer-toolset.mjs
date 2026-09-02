import { randomUUID } from "node:crypto";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { CONTROL_CAPABILITIES, unavailableControlResult } from "./contracts.mjs";

export const COMPUTER_TOOL_SEARCH_NAME = "tool_search";
export const COMPUTER_TOOLSET_NAMES = Object.freeze([
  "computer_open_app",
  "computer_list_windows",
  "computer_request_access",
  "computer_observe",
  "computer_click",
  "computer_type",
  "computer_key",
  "computer_scroll",
  "computer_focus",
  "computer_wait",
  "computer_release",
]);

const LEGACY_COMPUTER_TOOL_NAME = "computer_control";
const capabilityNames = Object.freeze({
  observe: "observe.structure",
  screenshot: "observe.screenshot",
  click: "pointer.click",
  type: "keyboard.type",
  key: "keyboard.key",
  scroll: "scroll",
  focus: "window.focus",
});
const accessName = Type.Union(Object.keys(capabilityNames).map((value) => Type.Literal(value)));
const sideEffect = Type.Union([
  "none", "send-or-publish", "purchase", "account-change", "security-change", "destructive-delete",
  "file-upload", "sensitive-data-submit", "software-install", "legal-acceptance",
].map((value) => Type.Literal(value)));

const searchSchema = Type.Object({
  query: Type.String({ description: "Capability to find, such as Windows computer control or desktop interaction." }),
}, { additionalProperties: false });
const openAppSchema = Type.Object({
  application: Type.String({ description: "Registered Windows app name requested by the user, such as Calculator. Paths, arguments, files, and URLs are not accepted.", minLength: 1, maxLength: 128 }),
}, { additionalProperties: false });
const listWindowsSchema = Type.Object({
  query: Type.String({ description: "Application requested by the user, such as Calculator or Notepad." }),
}, { additionalProperties: false });
const accessSchema = Type.Object({
  candidateRef: Type.String({ description: "Opaque candidateRef returned by computer_open_app or computer_list_windows." }),
  access: Type.Array(accessName, { minItems: 1, maxItems: Object.keys(capabilityNames).length }),
  durationMs: Type.Optional(Type.Number()),
  maxActions: Type.Optional(Type.Number()),
}, { additionalProperties: false });
const targetSchema = {
  targetId: Type.String(),
  grantId: Type.String(),
};
const observeSchema = Type.Object({
  ...targetSchema,
  includeScreenshot: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });
const revisionSchema = {
  ...targetSchema,
  observationRevision: Type.Number(),
};
const clickSchema = Type.Object({
  ...revisionSchema,
  elementRef: Type.Optional(Type.String()),
  x: Type.Optional(Type.Number()),
  y: Type.Optional(Type.Number()),
  button: Type.Optional(Type.Union([Type.Literal("left"), Type.Literal("middle"), Type.Literal("right")])),
  clickCount: Type.Optional(Type.Number()),
  sideEffect: Type.Optional(sideEffect),
}, { additionalProperties: false });
const typeSchema = Type.Object({
  ...revisionSchema,
  elementRef: Type.Optional(Type.String()),
  x: Type.Optional(Type.Number()),
  y: Type.Optional(Type.Number()),
  text: Type.String(),
  replace: Type.Optional(Type.Boolean()),
  sideEffect: Type.Optional(sideEffect),
}, { additionalProperties: false });
const keySchema = Type.Object({
  ...revisionSchema,
  key: Type.String(),
  modifiers: Type.Optional(Type.Array(Type.String(), { maxItems: 8 })),
  sideEffect: Type.Optional(sideEffect),
}, { additionalProperties: false });
const scrollSchema = Type.Object({
  ...revisionSchema,
  elementRef: Type.Optional(Type.String()),
  x: Type.Optional(Type.Number()),
  y: Type.Optional(Type.Number()),
  deltaX: Type.Number(),
  deltaY: Type.Number(),
}, { additionalProperties: false });
const focusSchema = Type.Object(revisionSchema, { additionalProperties: false });
const waitSchema = Type.Object({
  ...revisionSchema,
  durationMs: Type.Number(),
}, { additionalProperties: false });
const releaseSchema = Type.Object(targetSchema, { additionalProperties: false });

export function createComputerToolSet(options = {}) {
  const controller = createActivationController(options.sessionRef);
  return [
    defineTool({
      name: COMPUTER_TOOL_SEARCH_NAME,
      label: "Search tools",
      description: "Search and load deferred Zyra tools. Search for Windows computer control, desktop interaction, clicking, typing, or app automation when the task needs them.",
      parameters: searchSchema,
      execute: async (_toolCallId, input = {}) => localToolResult(controller.search(input.query)),
    }),
    bridgeTool({
      name: "computer_open_app",
      label: "Open Windows app",
      description: "Open one registered Windows Start app by name. This does not accept executable paths, command arguments, files, or URLs. Returns matching opaque candidates for computer_request_access.",
      parameters: openAppSchema,
      client: options.client,
      toOperation: (input) => ({ operation: "open_app", application: input.application }),
      format: (input, result) => `Opened registered app ${JSON.stringify(String(result.applicationName || input.application).slice(0, 256))}.\n${formatWindowMatches(result.applicationName || input.application, result.windows)}`,
      summarize: (input, result) => ({
        applicationName: String(result.applicationName || input.application).slice(0, 256),
        matchCount: Array.isArray(result.windows) ? result.windows.length : 0,
      }),
    }),
    bridgeTool({
      name: "computer_list_windows",
      label: "Find Windows application",
      description: "Find ordinary Windows application windows matching the app requested by the user. This grants no access and does not expose unrelated window titles.",
      parameters: listWindowsSchema,
      client: options.client,
      toOperation: (input) => ({ operation: "list_windows", query: input.query }),
      format: (input, result) => formatWindowMatches(input.query, result.windows),
      summarize: (_input, result) => ({ matchCount: Array.isArray(result.windows) ? result.windows.length : 0 }),
    }),
    bridgeTool({
      name: "computer_request_access",
      label: "Request computer access",
      description: "Select one candidate returned by computer_open_app or computer_list_windows and request bounded access in Chat. Full access may authorize routine use automatically.",
      parameters: accessSchema,
      client: options.client,
      waitsForUser: true,
      toOperation: (input) => ({
        operation: "request_grant",
        windowToken: input.candidateRef,
        capabilities: [...new Set(input.access.map((value) => capabilityNames[value]))],
        ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
        ...(input.maxActions === undefined ? {} : { maxActions: input.maxActions }),
      }),
      format: (_input, result) => `Computer access granted.\n${JSON.stringify(grantSummary(result.grant), null, 2)}`,
      summarize: (_input, result) => ({ grant: grantSummary(result.grant) }),
    }),
    bridgeTool({
      name: "computer_observe",
      label: "Observe computer window",
      description: "Observe the current granted Windows window. Returns revision-scoped semantic elements and an optional selected-window screenshot.",
      parameters: observeSchema,
      client: options.client,
      toOperation: (input) => ({ operation: "observe", ...input, mode: "both" }),
      format: (_input, result) => formatObservation("Computer observation ready.", result.observation),
      summarize: (_input, result) => observationSummary(result.observation),
    }),
    actionTool("computer_click", "Click computer control", "Click a semantic element or selected-window coordinate from the latest observation.", clickSchema, "click", options.client),
    actionTool("computer_type", "Type in computer control", "Type into a non-sensitive field from the latest observation.", typeSchema, "type", options.client),
    actionTool("computer_key", "Press computer key", "Press one bounded key or shortcut in the selected window.", keySchema, "key", options.client),
    actionTool("computer_scroll", "Scroll computer window", "Scroll inside the selected window from the latest observation.", scrollSchema, "scroll", options.client),
    actionTool("computer_focus", "Focus computer window", "Focus the selected ordinary application window.", focusSchema, "focus", options.client),
    actionTool("computer_wait", "Wait for computer window", "Wait briefly, then return a fresh observation for the feedback loop.", waitSchema, "wait", options.client, (input) => ({ condition: { type: "delay", durationMs: input.durationMs }, timeoutMs: input.durationMs })),
    bridgeTool({
      name: "computer_release",
      label: "Release computer access",
      description: "Release the current Windows control grant and unload the deferred computer tools.",
      parameters: releaseSchema,
      client: options.client,
      toOperation: (input) => ({ operation: "release", grantId: input.grantId }),
      format: () => "Computer access released.",
      summarize: () => ({ released: true }),
      after: () => controller.unload(),
    }),
  ];
}

export function applyComputerSearchOnlyState(session) {
  if (!session?.getActiveToolNames || !session?.setActiveToolsByName) return [];
  const active = new Set(session.getActiveToolNames());
  active.delete(LEGACY_COMPUTER_TOOL_NAME);
  for (const name of COMPUTER_TOOLSET_NAMES) active.delete(name);
  active.add(COMPUTER_TOOL_SEARCH_NAME);
  session.setActiveToolsByName([...active]);
  return [...active];
}

export function installComputerToolTurnCleanup(session) {
  if (!session?.subscribe) return () => {};
  return session.subscribe((event) => {
    if (event?.type === "agent_end") applyComputerSearchOnlyState(session);
  });
}

function createActivationController(sessionRef) {
  const session = () => sessionRef?.current;
  const unload = () => {
    const current = session();
    if (!current?.getActiveToolNames || !current?.setActiveToolsByName) return false;
    const active = new Set(current.getActiveToolNames());
    for (const name of COMPUTER_TOOLSET_NAMES) active.delete(name);
    active.delete(LEGACY_COMPUTER_TOOL_NAME);
    active.add(COMPUTER_TOOL_SEARCH_NAME);
    current.setActiveToolsByName([...active]);
    return true;
  };
  return {
    unload,
    search(queryValue) {
      const query = String(queryValue || "").trim();
      const current = session();
      if (!current?.getActiveToolNames || !current?.setActiveToolsByName) {
        return { ok: false, message: "Deferred computer tools are unavailable before the agent session is ready." };
      }
      const relevant = /(?:computer|windows|desktop|screen|app|application|click|type|keyboard|mouse|scroll|calculator|notepad)/i.test(query);
      if (!relevant) return { ok: true, loaded: [], message: `No deferred Zyra tools matched ${JSON.stringify(query)}.` };
      const active = new Set(current.getActiveToolNames());
      active.delete(LEGACY_COMPUTER_TOOL_NAME);
      active.add(COMPUTER_TOOL_SEARCH_NAME);
      for (const name of COMPUTER_TOOLSET_NAMES) active.add(name);
      current.setActiveToolsByName([...active]);
      return {
        ok: true,
        loaded: [...COMPUTER_TOOLSET_NAMES],
        message: "Windows computer tools loaded for this turn. Find the requested app, request access, observe, act from the latest revision, and release.",
      };
    },
  };
}

function actionTool(name, label, description, parameters, actionType, client, extraAction = () => ({})) {
  return bridgeTool({
    name,
    label,
    description,
    parameters,
    client,
    toOperation: (input) => ({
      operation: "act",
      version: 1,
      requestId: `tool:${randomUUID()}`,
      grantId: input.grantId,
      targetId: input.targetId,
      observationRevision: input.observationRevision,
      action: {
        type: actionType,
        ...copyDefined(input, ["elementRef", "x", "y", "button", "clickCount", "text", "replace", "key", "modifiers", "deltaX", "deltaY", "sideEffect"]),
        ...extraAction(input),
      },
    }),
    format: (_input, result) => formatObservation(`Computer ${actionType} completed.`, result.observation),
    summarize: (_input, result) => observationSummary(result.observation),
  });
}

function bridgeTool({ name, label, description, parameters, client, toOperation, format, summarize, waitsForUser = false, after }) {
  return defineTool({
    name,
    label,
    description,
    parameters,
    execute: async (_toolCallId, input = {}, signal) => {
      if (!client) {
        const unavailable = unavailableControlResult("Windows computer control");
        return toolResult(unavailable.error.message, unavailable);
      }
      try {
        const result = await client.request(toOperation(input), { signal, timeoutMs: waitsForUser ? 10 * 60 * 1000 : undefined });
        after?.();
        return toolResult(format(input, result), summarize(input, result), result.screenshot);
      } catch (error) {
        return toolResult(`Computer operation failed: ${error instanceof Error ? error.message : String(error)}`, {
          ok: false,
          code: error?.code || "CONTROL_ERROR",
          retryable: Boolean(error?.retryable),
          freshRevision: error?.freshRevision,
        });
      }
    },
  });
}

function formatWindowMatches(queryValue, windowsValue) {
  const query = String(queryValue || "").trim().slice(0, 128);
  const windows = Array.isArray(windowsValue) ? windowsValue.filter((entry) => entry && !entry.blocked) : [];
  if (windows.length === 0) return `No controllable Windows application matched ${JSON.stringify(query)}. Use computer_open_app if it is not running, then search again.`;
  return [
    `${windows.length} controllable window${windows.length === 1 ? "" : "s"} matched ${JSON.stringify(query)}:`,
    ...windows.slice(0, 16).map((entry, index) => `- match ${index + 1}: application ${JSON.stringify(String(entry.applicationName || "unknown").slice(0, 128))}; candidateRef ${String(entry.windowToken || "").slice(0, 512)}`),
    "Choose the matching candidateRef with computer_request_access. Exact window details appear in Chat approval before access begins.",
  ].join("\n");
}

function formatObservation(prefix, observation) {
  return `${prefix}\n${JSON.stringify({
    targetId: observation?.targetId,
    revision: observation?.revision,
    state: observation?.targetState,
    title: observation?.title,
    focusedElementRef: observation?.focusedElementRef,
    elements: Array.isArray(observation?.elements) ? observation.elements : [],
    truncation: observation?.truncation,
    redactions: observation?.redactions || [],
  }, null, 2)}`;
}

function observationSummary(observation) {
  return {
    targetId: observation?.targetId,
    revision: observation?.revision,
    state: observation?.targetState,
    elementCount: Array.isArray(observation?.elements) ? observation.elements.length : 0,
    screenshotAttached: Boolean(observation?.screenshotRef),
    redactions: observation?.redactions || [],
  };
}

function grantSummary(grant) {
  return {
    grantId: grant?.grantId,
    targetId: grant?.targetId,
    capabilities: grant?.capabilities || [],
    expiresAt: grant?.expiresAt,
    remainingActions: Math.max(0, Number(grant?.maxActions || 0) - Number(grant?.actionCount || 0)),
  };
}

function copyDefined(input, names) {
  return Object.fromEntries(names.filter((name) => input[name] !== undefined).map((name) => [name, input[name]]));
}

function localToolResult(details) {
  return { content: [{ type: "text", text: details.message || JSON.stringify(details, null, 2) }], details };
}

function toolResult(text, details, screenshot) {
  const content = [{ type: "text", text }];
  if (screenshot?.data && /^image\/(?:jpeg|png|webp)$/.test(String(screenshot.mimeType || ""))) {
    content.push({ type: "image", data: screenshot.data, mimeType: screenshot.mimeType });
  }
  return { content, details };
}
