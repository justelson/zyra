export const AGENT_SURFACE_CONTRACT_VERSION = 1;

export const AGENT_SURFACE_KINDS = Object.freeze([
  "command",
  "file-change",
  "file-read",
  "search",
  "web-search",
  "web-fetch",
  "skill",
  "agent",
  "workflow",
  "browser-control",
  "computer-control",
  "tool",
]);

export const AGENT_SURFACE_LIFECYCLES = Object.freeze([
  "running",
  "completed",
  "failed",
  "stopped",
]);

const surfaceKinds = new Set(AGENT_SURFACE_KINDS);
const surfaceLifecycles = new Set(AGENT_SURFACE_LIFECYCLES);

/**
 * Convert one provider tool event/state into the stable, UI-agnostic contract
 * consumed by Zyra's TUI and desktop adapters.
 */
export function normalizeAgentSurfaceTool(value = {}) {
  const args = objectValue(value.args ?? value.arguments ?? value.input);
  const result = objectValue(value.result);
  const partialResult = objectValue(value.partialResult ?? value.output);
  const details = objectValue(result?.details) ?? objectValue(partialResult?.details);
  const toolName = firstString(value, ["toolName", "name"]) ?? "tool";
  const normalizedToolName = normalizeToolName(toolName);
  const lifecycle = normalizeAgentSurfaceLifecycle(value);
  const phase = normalizeAgentSurfacePhase(value);
  const command = firstString(args, ["command", "cmd", "script"]);
  const query = firstString(args, ["query", "q", "pattern", "search"]);
  const url = firstString(args, ["url", "href"]);
  const action = firstString(args, ["action", "operation"]);
  const paths = readPaths(args, result, partialResult, details);
  const kind = classifyToolKind({ normalizedToolName, args, command, query, paths });
  const primaryText = command ?? paths[0] ?? query ?? url ?? firstString(args, ["label", "name", "prompt"]) ?? action ?? toolName;

  return {
    version: AGENT_SURFACE_CONTRACT_VERSION,
    kind,
    lifecycle,
    phase,
    toolName,
    toolKey: normalizedToolName,
    primaryText,
    command,
    query,
    url,
    action,
    paths,
    summary: summarizeSurfaceTool({ kind, lifecycle, toolName, pathCount: paths.length }),
  };
}

export function normalizeAgentSurfaceLifecycle(value = {}) {
  if (value.isError === true) return "failed";

  const direct = normalizeLifecycleValue(value.lifecycle ?? value.state ?? value.status);
  if (direct === "failed" || direct === "stopped") return direct;

  const result = objectValue(value.result);
  const partialResult = objectValue(value.partialResult ?? value.output);
  const resultDetails = objectValue(result?.details);
  const partialDetails = objectValue(partialResult?.details);
  for (const candidate of [
    resultDetails?.status,
    result?.status,
    partialDetails?.status,
    partialResult?.status,
  ]) {
    const lifecycle = normalizeLifecycleValue(candidate);
    if (lifecycle) return lifecycle;
  }
  if (direct) return direct;

  const eventType = String(value.eventType ?? value.type ?? "").trim().toLowerCase();
  if (eventType === "tool_execution_end") return "completed";
  return "running";
}

export function normalizeAgentSurfacePhase(value = {}) {
  const eventType = String(value.eventType ?? value.type ?? "").trim().toLowerCase();
  if (eventType === "tool_execution_start") return "start";
  if (eventType === "tool_execution_update") return "update";
  if (eventType === "tool_execution_end") return "end";
  return undefined;
}

export function isAgentSurfaceDescriptor(value) {
  return Boolean(
    value
      && typeof value === "object"
      && !Array.isArray(value)
      && value.version === AGENT_SURFACE_CONTRACT_VERSION
      && surfaceKinds.has(value.kind)
      && surfaceLifecycles.has(value.lifecycle)
      && (value.phase === undefined || ["start", "update", "end"].includes(value.phase))
      && typeof value.toolName === "string"
      && typeof value.primaryText === "string"
      && Array.isArray(value.paths),
  );
}

function classifyToolKind({ normalizedToolName, args, command, query, paths }) {
  if (normalizedToolName === "web search") return "web-search";
  if (normalizedToolName === "web fetch") return "web-fetch";
  if (normalizedToolName === "agent") return "agent";
  if (normalizedToolName === "workflow") return "workflow";
  if (/^browser(?:\s|$)/.test(normalizedToolName)) return "browser-control";
  if (/^computer(?:\s|$)/.test(normalizedToolName)) return "computer-control";
  if (command || /\b(bash|shell|powershell|terminal|exec|command|cmd)\b/.test(normalizedToolName)) {
    return "command";
  }
  if (isFileMutation(normalizedToolName, args)) return "file-change";
  if (paths.some((filePath) => /(?:^|[\\/])skills[\\/][^\\/]+[\\/]skill\.md$/i.test(filePath))) return "skill";
  if (paths.length > 0 || /\b(read|open|cat|view|inspect)\b/.test(normalizedToolName)) return "file-read";
  if (query || /\b(search|find|grep|rg)\b/.test(normalizedToolName)) return "search";
  return "tool";
}

function isFileMutation(toolName, args) {
  if (/\b(edit|write|patch|replace|append|create|delete|move|rename)\b/.test(toolName) && !/\bthread\b/.test(toolName)) {
    return true;
  }
  return Boolean(firstString(args, [
    "oldString",
    "old_string",
    "oldText",
    "old_text",
    "newString",
    "new_string",
    "newText",
    "new_text",
    "content",
    "fileContent",
    "file_content",
    "patch",
    "diff",
  ]));
}

function summarizeSurfaceTool({ kind, lifecycle, toolName, pathCount }) {
  if (kind === "web-search" || kind === "web-fetch") {
    const label = kind === "web-search" ? "Web search" : "Web fetch";
    if (lifecycle === "running") return `${label} in progress`;
    if (lifecycle === "failed") return `${label} failed`;
    if (lifecycle === "stopped") return `${label} stopped`;
    return `${label} completed`;
  }
  if (kind === "skill") {
    if (lifecycle === "running") return "Loading skill";
    if (lifecycle === "failed") return "Skill load failed";
    return "Loaded skill";
  }
  if (kind === "agent" || kind === "workflow") {
    const label = kind === "agent" ? "Agent" : "Workflow";
    if (lifecycle === "running") return `${label} action in progress`;
    if (lifecycle === "failed") return `${label} action failed`;
    if (lifecycle === "stopped") return `${label} action stopped`;
    return `${label} action completed`;
  }
  if (kind === "browser-control" || kind === "computer-control") {
    const label = kind === "browser-control" ? "Browser control" : "Computer control";
    if (lifecycle === "running") return `Using ${label}`;
    if (lifecycle === "failed") return `${label} failed`;
    if (lifecycle === "stopped") return `${label} stopped`;
    return `${label} completed`;
  }
  if (kind === "command") {
    if (lifecycle === "running") return "Running command";
    if (lifecycle === "failed") return "Command failed";
    if (lifecycle === "stopped") return "Stopped command";
    return "Ran command";
  }
  if (kind === "file-change") {
    if (lifecycle === "running") return "Editing files";
    if (lifecycle === "failed") return "File edit failed";
    if (lifecycle === "stopped") return "File edit stopped";
    return pathCount > 1 ? "Edited files" : "Edited file";
  }
  if (kind === "file-read") {
    if (lifecycle === "running") return "Reading file";
    if (lifecycle === "failed") return "File read failed";
    if (lifecycle === "stopped") return "File read stopped";
    return pathCount > 1 ? "Read files" : "Read file";
  }
  if (kind === "search") {
    if (lifecycle === "running") return "Searching";
    if (lifecycle === "failed") return "Search failed";
    if (lifecycle === "stopped") return "Search stopped";
    return "Searched";
  }
  if (lifecycle === "running") return `Using ${toolName}`;
  if (lifecycle === "failed") return `Failed ${toolName}`;
  if (lifecycle === "stopped") return `Stopped ${toolName}`;
  return `Used ${toolName}`;
}

function readPaths(...sources) {
  const values = [];
  for (const source of sources) {
    if (!source) continue;
    values.push(firstString(source, ["path", "filePath", "file_path", "targetPath", "target_path", "filename"]));
    for (const key of ["paths", "files"]) {
      if (Array.isArray(source[key])) values.push(...source[key]);
    }
    if (Array.isArray(source.changes)) {
      for (const entry of source.changes) {
        const change = objectValue(entry);
        values.push(firstString(change, ["path", "filePath", "file_path", "previousPath", "previous_path"]));
      }
    }
  }
  return [...new Set(values
    .filter((entry) => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean))];
}

function normalizeLifecycleValue(value) {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[-_\s]/g, "");
  if (["running", "inprogress", "pending", "started"].includes(normalized)) return "running";
  if (["complete", "completed", "done", "success", "succeeded", "applied"].includes(normalized)) return "completed";
  if (["error", "failed", "failure", "declined"].includes(normalized)) return "failed";
  if (["stopped", "aborted", "interrupted", "cancelled", "canceled"].includes(normalized)) return "stopped";
  return undefined;
}

function normalizeToolName(value) {
  return String(value ?? "tool").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase() || "tool";
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

function firstString(source, keys) {
  if (!source) return undefined;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}
