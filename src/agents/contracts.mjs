import { randomUUID } from "node:crypto";

export const FLEET_SCHEMA_VERSION = 1;
export const MAX_FLEET_EVENT_BYTES = 256 * 1024;
export const MAX_FLEET_SUMMARY_BYTES = 50 * 1024;
export const MAX_APPLIED_EVENT_IDS = 2048;
export const MAX_PENDING_EVENTS = 2048;

export const AGENT_RUN_STATES = Object.freeze([
  "queued", "starting", "running", "waiting", "blocked", "completed", "failed", "cancelled", "interrupted", "recovering",
]);
export const WORKFLOW_RUN_STATES = Object.freeze([
  "draft", "awaiting-approval", "queued", "running", "paused", "completed", "partial", "failed", "cancelled", "recovering",
]);
export const TERMINAL_AGENT_STATES = new Set(["completed", "failed", "cancelled"]);
export const TERMINAL_WORKFLOW_STATES = new Set(["completed", "partial", "failed", "cancelled"]);

const agentStateSet = new Set(AGENT_RUN_STATES);
const workflowStateSet = new Set(WORKFLOW_RUN_STATES);

export function createFleetSnapshot(input = {}) {
  const now = input.createdAt ?? new Date().toISOString();
  return {
    version: FLEET_SCHEMA_VERSION,
    fleetId: requiredString(input.fleetId ?? randomUUID(), "fleetId"),
    rootSessionId: requiredString(input.rootSessionId, "rootSessionId"),
    rootThreadId: requiredString(input.rootThreadId ?? input.rootSessionId, "rootThreadId"),
    project: typeof input.project === "string" ? input.project : "",
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    lastAppliedSequence: finiteInteger(input.lastAppliedSequence, 0),
    appliedEventIds: normalizeStringArray(input.appliedEventIds).slice(-MAX_APPLIED_EVENT_IDS),
    pendingEvents: Array.isArray(input.pendingEvents) ? input.pendingEvents.slice(-MAX_PENDING_EVENTS) : [],
    definitionsRevision: finiteInteger(input.definitionsRevision, 0),
    agents: Object.fromEntries(Object.entries(objectRecord(input.agents)).map(([id, run]) => [id,
      run?.status === 'failed' && run.error?.code === 'CHILD_MAX_TURNS' ? { ...run, status: 'cancelled' } : run
    ])),
    workflows: objectRecord(input.workflows),
    writeLocks: objectRecord(input.writeLocks),
    usage: normalizeUsage(input.usage),
    recovery: objectRecord(input.recovery),
  };
}

export function createFleetEvent(input = {}) {
  const event = {
    version: FLEET_SCHEMA_VERSION,
    sequence: finitePositiveInteger(input.sequence, "sequence"),
    eventId: requiredString(input.eventId ?? randomUUID(), "eventId"),
    occurredAt: requiredString(input.occurredAt ?? new Date().toISOString(), "occurredAt"),
    rootSessionId: requiredString(input.rootSessionId, "rootSessionId"),
    rootThreadId: requiredString(input.rootThreadId ?? input.rootSessionId, "rootThreadId"),
    fleetId: requiredString(input.fleetId, "fleetId"),
    ...(optionalString(input.agentRunId) ? { agentRunId: optionalString(input.agentRunId) } : {}),
    ...(optionalString(input.workflowRunId) ? { workflowRunId: optionalString(input.workflowRunId) } : {}),
    ...(optionalString(input.phaseId) ? { phaseId: optionalString(input.phaseId) } : {}),
    type: requiredString(input.type, "type"),
    payload: boundedJsonObject(input.payload ?? {}, MAX_FLEET_EVENT_BYTES),
  };
  validateFleetEvent(event);
  return event;
}

export function validateFleetEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) throw new TypeError("Fleet event must be an object.");
  if (event.version !== FLEET_SCHEMA_VERSION) throw new Error(`Unsupported fleet event version: ${event.version}.`);
  finitePositiveInteger(event.sequence, "sequence");
  for (const key of ["eventId", "occurredAt", "rootSessionId", "rootThreadId", "fleetId", "type"]) requiredString(event[key], key);
  if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) throw new TypeError("Fleet event payload must be an object.");
  const bytes = Buffer.byteLength(JSON.stringify(event), "utf8");
  if (bytes > MAX_FLEET_EVENT_BYTES) throw new RangeError(`Fleet event exceeds ${MAX_FLEET_EVENT_BYTES} bytes.`);
  return event;
}

/** Legacy independent threads have the coordinator's stable hashed operation ID. */
export function getAgentConversationKind(run = {}) {
  if (run.conversationKind === 'thread' || run.conversationKind === 'subagent') return run.conversationKind;
  return /^thread-[a-f0-9]{64}$/.test(String(run.agentRunId || '')) ? 'thread' : 'subagent';
}

export function normalizeAgentRun(input = {}) {
  const status = normalizeAgentRunState(input.status === 'failed' && input.error?.code === 'CHILD_MAX_TURNS' ? 'cancelled' : input.status ?? "queued");
  const now = input.createdAt ?? new Date().toISOString();
  return {
    version: FLEET_SCHEMA_VERSION,
    fleetId: requiredString(input.fleetId, "fleetId"),
    agentRunId: requiredString(input.agentRunId ?? randomUUID(), "agentRunId"),
    agentId: requiredString(input.agentId ?? input.definitionName ?? "dynamic", "agentId"),
    definitionName: optionalString(input.definitionName) ?? null,
    parentAgentRunId: optionalString(input.parentAgentRunId) ?? null,
    contextFork: Boolean(input.contextFork),
    conversationKind: getAgentConversationKind(input),
    workflowRunId: optionalString(input.workflowRunId) ?? null,
    phaseId: optionalString(input.phaseId) ?? null,
    label: optionalString(input.label) ?? input.definitionName ?? "agent",
    goal: requiredString(input.goal, "goal"),
    successCriteria: normalizeStringArray(input.successCriteria),
    status,
    attempt: finitePositiveInteger(input.attempt ?? 1, "attempt"),
    attemptId: requiredString(input.attemptId ?? randomUUID(), "attemptId"),
    depth: finiteInteger(input.depth, 1),
    requestedModel: input.requestedModel ?? "inherit",
    selectedModel: optionalString(input.selectedModel) ?? null,
    modelRoute: input.modelRoute && typeof input.modelRoute === "object" ? cloneJson(input.modelRoute) : null,
    effort: optionalString(input.effort) ?? "medium",
    maxTurns: Math.max(1, Math.min(100, finiteInteger(input.maxTurns, 12))),
    tools: normalizeStringArray(input.tools),
    capabilities: normalizeStringArray(input.capabilities),
    controlLease: input.controlLease && typeof input.controlLease === "object"
      ? boundedJsonObject(input.controlLease, 16 * 1024)
      : null,
    permissionMode: optionalString(input.permissionMode) ?? "read-only",
    isolation: ["shared", "worktree"].includes(input.isolation) ? input.isolation : "shared",
    readScope: normalizeStringArray(input.readScope),
    writeScope: normalizeStringArray(input.writeScope),
    cwd: optionalString(input.cwd) ?? null,
    worktree: input.worktree && typeof input.worktree === "object" ? cloneJson(input.worktree) : null,
    providerSessionId: optionalString(input.providerSessionId) ?? null,
    sessionFile: optionalString(input.sessionFile) ?? null,
    createdAt: now,
    queuedAt: input.queuedAt ?? now,
    startedAt: input.startedAt ?? null,
    completedAt: input.completedAt ?? null,
    heartbeatAt: input.heartbeatAt ?? null,
    elapsedMs: finiteInteger(input.elapsedMs, 0),
    activity: input.activity && typeof input.activity === "object" ? cloneJson(input.activity) : null,
    usage: normalizeUsage(input.usage),
    result: input.result && typeof input.result === "object" ? boundedJsonObject(input.result, MAX_FLEET_SUMMARY_BYTES) : null,
    error: input.error && typeof input.error === "object" ? boundedJsonObject(input.error, 16 * 1024) : null,
    artifacts: Array.isArray(input.artifacts) ? cloneJson(input.artifacts).slice(0, 128) : [],
    transcriptRef: input.transcriptRef && typeof input.transcriptRef === "object" ? cloneJson(input.transcriptRef) : null,
    retryOfAttemptId: optionalString(input.retryOfAttemptId) ?? null,
  };
}

export function normalizeWorkflowRun(input = {}) {
  const now = input.createdAt ?? new Date().toISOString();
  return {
    version: FLEET_SCHEMA_VERSION,
    fleetId: requiredString(input.fleetId, "fleetId"),
    workflowRunId: requiredString(input.workflowRunId ?? randomUUID(), "workflowRunId"),
    definitionName: requiredString(input.definitionName ?? "temporary", "definitionName"),
    definitionRevision: optionalString(input.definitionRevision) ?? "1",
    scriptHash: requiredString(input.scriptHash, "scriptHash"),
    source: optionalString(input.source) ?? "temporary",
    trust: optionalString(input.trust) ?? "trusted",
    status: normalizeWorkflowRunState(input.status ?? "draft"),
    args: cloneJson(input.args ?? {}),
    originatingThreadId: optionalString(input.originatingThreadId) ?? null,
    createdAt: now,
    startedAt: input.startedAt ?? null,
    completedAt: input.completedAt ?? null,
    updatedAt: input.updatedAt ?? now,
    attempt: finitePositiveInteger(input.attempt ?? 1, "attempt"),
    phases: objectRecord(input.phases),
    calls: objectRecord(input.calls),
    agentRunIds: normalizeStringArray(input.agentRunIds),
    usage: normalizeUsage(input.usage),
    budget: normalizeBudget(input.budget),
    projected: normalizeUsage(input.projected),
    warnings: normalizeStringArray(input.warnings).slice(0, 128),
    result: input.result === undefined ? null : boundedJsonValue(input.result, MAX_FLEET_SUMMARY_BYTES),
    error: input.error && typeof input.error === "object" ? boundedJsonObject(input.error, 16 * 1024) : null,
    approval: input.approval && typeof input.approval === "object" ? cloneJson(input.approval) : null,
    cacheHits: finiteInteger(input.cacheHits, 0),
  };
}

export function normalizeAgentRunState(value) {
  const state = String(value ?? "").trim().toLowerCase();
  if (!agentStateSet.has(state)) throw new Error(`Invalid agent run state: ${value}.`);
  return state;
}

export function normalizeWorkflowRunState(value) {
  const state = String(value ?? "").trim().toLowerCase();
  if (!workflowStateSet.has(state)) throw new Error(`Invalid workflow run state: ${value}.`);
  return state;
}

export function normalizeUsage(input = {}) {
  return {
    inputTokens: finiteNumber(input?.inputTokens ?? input?.input, 0),
    outputTokens: finiteNumber(input?.outputTokens ?? input?.output, 0),
    cacheReadTokens: finiteNumber(input?.cacheReadTokens ?? input?.cacheRead, 0),
    cacheWriteTokens: finiteNumber(input?.cacheWriteTokens ?? input?.cacheWrite, 0),
    reasoningTokens: finiteNumber(input?.reasoningTokens ?? input?.reasoning, 0),
    totalTokens: finiteNumber(input?.totalTokens ?? input?.total, 0),
    requests: finiteInteger(input?.requests, 0),
    cost: finiteNumber(typeof input?.cost === "object" ? input.cost?.total : input?.cost, 0),
  };
}

export function addUsage(left = {}, right = {}) {
  const a = normalizeUsage(left);
  const b = normalizeUsage(right);
  return Object.fromEntries(Object.keys(a).map((key) => [key, a[key] + b[key]]));
}

export function normalizeBudget(input = {}) {
  return {
    maxCalls: finitePositiveInteger(input?.maxCalls ?? 1000, "maxCalls"),
    maxTokens: finitePositiveInteger(input?.maxTokens ?? 1_500_000, "maxTokens"),
    maxRequests: finitePositiveInteger(input?.maxRequests ?? input?.maxCalls ?? 1000, "maxRequests"),
    maxCostUsd: finitePositiveNumber(input?.maxCostUsd ?? 1000, "maxCostUsd"),
    maxConcurrency: finitePositiveInteger(input?.maxConcurrency ?? 4, "maxConcurrency"),
  };
}

export function boundedJsonObject(value, maxBytes = MAX_FLEET_SUMMARY_BYTES) {
  const cloned = cloneJson(value ?? {});
  if (!cloned || typeof cloned !== "object" || Array.isArray(cloned)) throw new TypeError("Expected a JSON object.");
  assertJsonBytes(cloned, maxBytes);
  return cloned;
}

export function boundedJsonValue(value, maxBytes = MAX_FLEET_SUMMARY_BYTES) {
  const cloned = cloneJson(value);
  assertJsonBytes(cloned, maxBytes);
  return cloned;
}

export function cloneJson(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function assertJsonBytes(value, maxBytes) {
  const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  if (bytes > maxBytes) throw new RangeError(`JSON value exceeds ${maxBytes} bytes.`);
}

function objectRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? cloneJson(value) : {};
}

function normalizeStringArray(value) {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return [...new Set(values.map((entry) => String(entry ?? "").trim()).filter(Boolean))];
}

function requiredString(value, name) {
  const text = String(value ?? "").trim();
  if (!text) throw new TypeError(`${name} is required.`);
  return text;
}

function optionalString(value) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function finiteInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function finitePositiveNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new TypeError(`${name} must be a positive number.`);
  return number;
}

function finitePositiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${name} must be a positive integer.`);
  return number;
}
