import { randomUUID } from "node:crypto";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { CONTROL_CAPABILITIES, unavailableControlResult } from "./contracts.mjs";

export const COMPUTER_TOOL_SEARCH_NAME = "tool_search";
export const COMPUTER_TOOLSET_NAMES = Object.freeze([
  "computer_use_app",
  "computer_open_app",
  "computer_list_windows",
  "computer_request_access",
  "computer_observe",
  "computer_move",
  "computer_click",
  "computer_drag",
  "computer_sequence",
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
  move: "pointer.move",
  click: "pointer.click",
  drag: "pointer.drag",
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
const pointerButton = Type.Union([Type.Literal("left"), Type.Literal("middle"), Type.Literal("right")]);
const moveSchema = Type.Object({
  ...revisionSchema,
  x: Type.Number(),
  y: Type.Number(),
  durationMs: Type.Optional(Type.Number()),
}, { additionalProperties: false });
const clickSchema = Type.Object({
  ...revisionSchema,
  elementRef: Type.Optional(Type.String()),
  x: Type.Optional(Type.Number()),
  y: Type.Optional(Type.Number()),
  button: Type.Optional(pointerButton),
  clickCount: Type.Optional(Type.Number()),
  sideEffect: Type.Optional(sideEffect),
}, { additionalProperties: false });
const dragSchema = Type.Object({
  ...revisionSchema,
  fromX: Type.Number(),
  fromY: Type.Number(),
  toX: Type.Number(),
  toY: Type.Number(),
  durationMs: Type.Optional(Type.Number()),
  button: Type.Optional(pointerButton),
  sideEffect: Type.Optional(sideEffect),
}, { additionalProperties: false });
const semanticTargetSchema = {
  role: Type.Optional(Type.String({ description: "Exact semantic role when known. Omit it to require one unique actionable control with the exact name.", minLength: 1, maxLength: 128 })),
  name: Type.String({ description: "Exact semantic name from the latest observation or a confidently known app label.", minLength: 1, maxLength: 512 }),
};
const routineSideEffect = Type.Literal("none", { description: "Sequences support routine side-effect-free work only." });
const sequenceStepSchema = Type.Union([
  Type.Object({ type: Type.Literal("click"), ...semanticTargetSchema, sideEffect: routineSideEffect }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("type"), ...semanticTargetSchema, text: Type.String(), replace: Type.Boolean({ description: "Replace the exact field value, or preserve its current selection/caret before typing." }), sideEffect: routineSideEffect }, { additionalProperties: false }),
  Type.Object({
    type: Type.Literal("key"),
    key: Type.String({ description: "Routine navigation key or Ctrl+A/Z/Y shortcut.", minLength: 1, maxLength: 64 }),
    modifiers: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 24 }), { maxItems: 4 })),
    sideEffect: routineSideEffect,
  }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("wait"), durationMs: Type.Number({ minimum: 0, maximum: 2000 }), sideEffect: routineSideEffect }, { additionalProperties: false }),
]);
const sequenceStepsSchema = Type.Array(sequenceStepSchema, { minItems: 1, maxItems: 16 });
const sequenceSchema = Type.Object({
  ...revisionSchema,
  steps: sequenceStepsSchema,
}, { additionalProperties: false });
const useAppSchema = Type.Object({
  application: Type.String({ description: "Registered Windows app name requested by the user.", minLength: 1, maxLength: 128 }),
  access: Type.Array(accessName, { description: "All capabilities needed for this app task.", minItems: 1, maxItems: Object.keys(capabilityNames).length }),
  steps: Type.Optional(sequenceStepsSchema),
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
      name: "computer_use_app",
      label: "Use Windows app",
      description: "Preferred first tool for a Windows app task. Reuse one exact running app or open its registered Start app, request all needed capabilities, and optionally run already-clear routine semantic steps in the same call. Returns the latest observation and replaces an older Windows grant for the same turn only after the new grant succeeds. It fails closed when multiple windows match. Paths, arguments, files, URLs, unrelated apps, and child-agent selection are forbidden.",
      parameters: useAppSchema,
      client: options.client,
      waitsForUser: true,
      toOperation: (input) => ({
        operation: "use_app",
        application: input.application,
        capabilities: [...new Set(input.access.map((value) => capabilityNames[value]))],
        durationMs: 10 * 60 * 1000,
        maxActions: 32,
        ...(input.steps?.length ? { requestId: `tool:${randomUUID()}`, steps: input.steps } : {}),
      }),
      format: (input, result) => [
        `${result.launched === false ? "Using already-running app" : "Opened registered app"} ${JSON.stringify(String(result.applicationName || input.application).slice(0, 256))}. Computer access granted.\n${JSON.stringify(grantSummary(result.grant), null, 2)}`,
        result.observation ? formatObservation(result.sequence ? `Computer sequence completed ${result.sequence.completedSteps} of ${result.sequence.totalSteps} steps. Final changed and readback elements follow.` : "Initial computer observation ready; act from this revision.", result.observation) : "",
      ].filter(Boolean).join("\n"),
      summarize: (input, result) => ({
        applicationName: String(result.applicationName || input.application).slice(0, 256),
        launched: result.launched !== false,
        grant: grantSummary(result.grant),
        ...(result.sequence ? { sequence: { completedSteps: result.sequence.completedSteps, totalSteps: result.sequence.totalSteps } } : {}),
        ...(result.observation ? { observation: observationSummary(result.observation) } : {}),
      }),
    }),
    bridgeTool({
      name: "computer_open_app",
      label: "Open Windows app",
      description: "Fallback when computer_use_app reports multiple exact matches. Open the registered Windows Start app requested by the user without granting access. Never open an unrelated app to diagnose a failure. Paths, arguments, files, and URLs are rejected. Returns opaque candidates for exact selection.",
      parameters: openAppSchema,
      client: options.client,
      toOperation: (input) => ({ operation: "open_app", application: input.application }),
      format: (input, result) => `${result.launched === false ? "Using already-running app" : "Opened registered app"} ${JSON.stringify(String(result.applicationName || input.application).slice(0, 256))}.\n${formatWindowMatches(result.applicationName || input.application, result.windows)}`,
      summarize: (input, result) => ({
        applicationName: String(result.applicationName || input.application).slice(0, 256),
        launched: result.launched !== false,
        matchCount: Array.isArray(result.windows) ? result.windows.length : 0,
      }),
    }),
    bridgeTool({
      name: "computer_list_windows",
      label: "Find Windows application",
      description: "Fallback when computer_use_app reports multiple exact matches. Find ordinary Windows application windows matching the requested app. This grants no access and does not expose unrelated window titles.",
      parameters: listWindowsSchema,
      client: options.client,
      toOperation: (input) => ({ operation: "list_windows", query: input.query }),
      format: (input, result) => formatWindowMatches(input.query, result.windows),
      summarize: (_input, result) => ({ matchCount: Array.isArray(result.windows) ? result.windows.length : 0 }),
    }),
    bridgeTool({
      name: "computer_request_access",
      label: "Request computer access",
      description: "After an ambiguous app search, select one candidate and request all capabilities needed for that app in one bounded Chat grant. Include screenshot when the task needs visual verification or coordinate pointer work. A successful grant returns the first current observation, so do not call computer_observe again before acting. Full access may authorize routine use automatically.",
      parameters: accessSchema,
      client: options.client,
      waitsForUser: true,
      toOperation: (input) => ({
        operation: "request_grant",
        windowToken: input.candidateRef,
        capabilities: [...new Set(input.access.map((value) => capabilityNames[value]))],
        durationMs: 10 * 60 * 1000,
        maxActions: 32,
      }),
      format: (_input, result) => [
        `Computer access granted.\n${JSON.stringify(grantSummary(result.grant), null, 2)}`,
        result.observation ? formatObservation("Initial computer observation ready; act from this revision.", result.observation) : "",
      ].filter(Boolean).join("\n"),
      summarize: (_input, result) => ({ grant: grantSummary(result.grant), ...(result.observation ? { observation: observationSummary(result.observation) } : {}) }),
    }),
    bridgeTool({
      name: "computer_observe",
      label: "Observe computer window",
      description: "Observe the current granted Windows window. Set includeScreenshot only when the grant includes screenshot access. Returns revision-scoped semantic elements and an optional selected-window screenshot.",
      parameters: observeSchema,
      client: options.client,
      toOperation: (input) => ({ operation: "observe", ...input, mode: "both" }),
      format: (_input, result) => formatObservation("Computer observation ready.", result.observation),
      summarize: (_input, result) => observationSummary(result.observation),
    }),
    actionTool("computer_move", "Move computer pointer", "Move the pointer to one selected-window coordinate from the latest observation without clicking.", moveSchema, "move", options.client),
    actionTool("computer_click", "Click computer control", "Click a semantic element or selected-window coordinate from the latest observation.", clickSchema, "click", options.client),
    actionTool("computer_drag", "Drag in computer window", "Drag between two selected-window coordinates from the latest observation. Declare any side effect explicitly.", dragSchema, "drag", options.client),
    bridgeTool({
      name: "computer_sequence",
      label: "Run computer steps",
      description: "Run 1 to 16 already-clear routine steps in one bounded call. Supports exact semantic clicks, exact-field typing, safe editing/navigation keys, and short waits. A semantic role is optional only when the exact name identifies one unique actionable control. Prefer this over serial calls. Zyra re-observes and revision-checks after every step, then returns the final observation. Missing, ambiguous, sensitive, critical, stale, unauthorized, expired, or interrupted steps stop immediately. Use an individual tool for any external or critical side effect.",
      parameters: sequenceSchema,
      client: options.client,
      toOperation: (input) => ({
        operation: "act_sequence",
        version: 1,
        requestId: `tool:${randomUUID()}`,
        grantId: input.grantId,
        targetId: input.targetId,
        observationRevision: input.observationRevision,
        steps: input.steps,
      }),
      format: (_input, result) => formatObservation(`Computer sequence completed ${result.completedSteps} of ${result.totalSteps} steps.`, result.observation),
      summarize: (_input, result) => ({
        completedSteps: result.completedSteps,
        totalSteps: result.totalSteps,
        observation: observationSummary(result.observation),
      }),
    }),
    actionTool("computer_type", "Type in computer control", "Type into a non-sensitive field from the latest observation.", typeSchema, "type", options.client),
    actionTool("computer_key", "Press computer key", "Press one bounded key or shortcut in the selected window.", keySchema, "key", options.client),
    actionTool("computer_scroll", "Scroll computer window", "Scroll inside the selected window from the latest observation.", scrollSchema, "scroll", options.client),
    actionTool("computer_focus", "Focus computer window", "Focus the selected ordinary application window.", focusSchema, "focus", options.client),
    actionTool("computer_wait", "Wait for computer window", "Wait briefly, then return a fresh observation for the feedback loop.", waitSchema, "wait", options.client, (input) => ({ condition: { type: "delay", durationMs: input.durationMs }, timeoutMs: input.durationMs })),
    bridgeTool({
      name: "computer_release",
      label: "Release computer access",
      description: "Release the current Windows grant only when control must end immediately. Starting another requested app with computer_use_app replaces the older Windows grant after the new grant succeeds. Do not spend a final standalone call on release: all grants unload automatically when the turn ends.",
      parameters: releaseSchema,
      client: options.client,
      toOperation: (input) => ({ operation: "release", grantId: input.grantId }),
      format: () => "Computer access released.",
      summarize: () => ({ released: true }),
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
        message: "Windows computer tools loaded for this turn. Stay within the requested app and never use an unrelated app or tool to diagnose a failure. Prefer computer_use_app, embed confidently known routine semantic steps, and answer as soon as its returned observation proves the result. Do not make a final release call; turn completion cleans up.",
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
        ...copyDefined(input, ["elementRef", "x", "y", "fromX", "fromY", "toX", "toY", "durationMs", "button", "clickCount", "text", "replace", "key", "modifiers", "deltaX", "deltaY", "sideEffect"]),
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
  const sourceElements = Array.isArray(observation?.elements) ? observation.elements : [];
  const elements = sourceElements
    .filter((element) => isUsefulObservationElement(element, observation))
    .slice(0, 256)
    .map(compactObservationElement);
  return `${prefix}\n${JSON.stringify({
    targetId: observation?.targetId,
    revision: observation?.revision,
    state: observation?.targetState,
    title: observation?.title,
    focusedElementRef: observation?.focusedElementRef,
    elements,
    ...(elements.length < sourceElements.length ? { omittedElementCount: sourceElements.length - elements.length } : {}),
    truncation: observation?.truncation,
    redactions: observation?.redactions || [],
  }, null, 2)}`;
}

function isUsefulObservationElement(element, observation) {
  if (!element) return false;
  const actions = Array.isArray(element.actions) ? element.actions : [];
  const states = Array.isArray(element.states) ? element.states : [];
  if (states.includes("offscreen")) return false;
  if (actions.length > 0 || element.sensitive || element.value !== undefined && element.value !== "" || element.description) return true;
  const name = String(element.name || "").trim();
  if (!name || name === "System" || name === "System Menu Bar") return false;
  const role = String(element.role || "control");
  if ((role === "window" || role === "titlebar") && name === String(observation?.title || "").trim()) return false;
  return true;
}

function compactObservationElement(element) {
  const actions = Array.isArray(element.actions) ? element.actions : [];
  const states = Array.isArray(element.states) ? element.states.filter((state) => state !== "enabled") : [];
  return {
    ...(actions.length ? { elementRef: element.elementRef } : {}),
    role: element.role,
    ...(element.name ? { name: element.name } : {}),
    ...(element.value !== undefined && element.value !== "" ? { value: element.value } : {}),
    ...(element.description ? { description: element.description } : {}),
    ...(actions.length ? { actions } : {}),
    ...(states.length ? { states } : {}),
    ...(element.sensitive ? { sensitive: true } : {}),
  };
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
