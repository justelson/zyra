import path from "node:path";

const SAFE_TOOL_NAMES = new Set([
  "read",
  "grep",
  "find",
  "ls",
  "web_search",
  "web_fetch",
  "request_user_input",
]);
const CRITICAL_TOOL_NAME_PATTERN = /(?:^|[._-])(delete|remove|publish|deploy|release|purchase|payment|billing|account|security|credential|password|secret|upload|install|message|email|send)(?:[._-]|$)/;
const DEFINITE_CRITICAL_COMMAND_PATTERNS = [
  /\bgit\s+(?:push|reset\s+--hard|clean\s+-[^\r\n]*f|rebase|filter-(?:repo|branch)|branch\s+-D)\b/i,
  /\b(?:npm|pnpm|yarn|bun)\s+publish\b/i,
  /\b(?:gh\s+release|docker\s+push|terraform\s+(?:apply|destroy)|kubectl\s+(?:apply|delete)|vercel\s+(?:deploy|--prod)|railway\s+up)\b/i,
  /\b(?:rm\s+-[^\r\n]*r[^\r\n]*f|remove-item\b[^\r\n]*(?:-recurse[^\r\n]*-force|-force[^\r\n]*-recurse)|rmdir\s+\/s|del\s+\/s|format\b|diskpart\b)/i,
  /\b(?:drop\s+(?:database|schema|table)|truncate\s+table)\b/i,
  /\b(?:winget|choco|scoop|apt(?:-get)?|brew)\s+(?:install|upgrade|uninstall|remove)\b/i,
  /\b(?:set-executionpolicy|reg(?:\.exe)?\s+(?:add|delete)|sc(?:\.exe)?\s+(?:create|delete|config)|net\s+user)\b/i,
];
const AMBIGUOUS_CRITICAL_WORD_PATTERN = /\b(?:login|logout|password|credential|secret|token|billing|payment|purchase|production|prod|deploy|publish|release)\b/i;

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeToolName(value) {
  return String(value || "").trim().toLowerCase();
}

function displayToolName(value) {
  const normalized = String(value || "tool").replace(/[._-]+/g, " ").trim();
  return normalized ? normalized.replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Tool";
}

function boundedJson(value, limit = 1800) {
  try {
    const text = JSON.stringify(value, null, 2);
    return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
  } catch {
    return String(value || "").slice(0, limit);
  }
}

function collectPaths(input) {
  const values = [];
  for (const key of ["path", "filePath", "targetPath", "sourcePath", "destinationPath"]) {
    const value = stringValue(input[key]);
    if (value) values.push(value);
  }
  for (const key of ["paths", "files"]) {
    if (!Array.isArray(input[key])) continue;
    for (const value of input[key]) {
      const pathValue = stringValue(value);
      if (pathValue) values.push(pathValue);
    }
  }
  return [...new Set(values)].slice(0, 20);
}

function isSeparatelySupervisedControlTool(toolName) {
  return /(?:^|[._-])(browser|computer|control|workflow|agent)(?:[._-]|$)/.test(toolName);
}

export function describeZyraToolPermission(event, options = {}) {
  const toolName = normalizeToolName(event?.toolName || event?.name);
  if (!toolName || SAFE_TOOL_NAMES.has(toolName) || isSeparatelySupervisedControlTool(toolName)) return null;

  const input = asRecord(event?.input);
  const project = path.resolve(options.project || process.cwd());
  const paths = collectPaths(input);
  const outsideProject = paths.some((value) => isPathOutsideProject(value, project));
  const command = toolName === "bash" || /(?:shell|terminal|exec|command)/.test(toolName)
    ? stringValue(input.command || input.cmd || input.script)
    : "";
  const requestType = toolName === "edit" || toolName === "write" || /(?:write|edit|patch|delete|move|rename|create)/.test(toolName)
    ? "file-change"
    : command
      ? "command"
      : "command";
  const scopeLabel = requestType === "file-change" ? "file changes" : toolName === "bash" ? "shell commands" : toolName;

  return {
    requestType,
    title: `${displayToolName(toolName)} needs approval`,
    detail: command || (paths.length > 0 ? paths.join("\n") : boundedJson(input)),
    ...(command ? { command } : {}),
    ...(paths.length > 0 ? { paths } : {}),
    toolName,
    outsideProject,
    grantKey: `${requestType}:${toolName}:${project.toLowerCase()}`,
    grantLabel: `Allow ${scopeLabel} for this chat`,
  };
}

export function isDefinitelyCriticalZyraToolPermission(request = {}) {
  const toolName = normalizeToolName(request.toolName);
  if (CRITICAL_TOOL_NAME_PATTERN.test(toolName)) return true;
  const text = [request.command, request.detail].map(stringValue).filter(Boolean).join("\n");
  return Boolean(text && DEFINITE_CRITICAL_COMMAND_PATTERNS.some((pattern) => pattern.test(text)));
}

export function isPotentiallyCriticalZyraToolPermission(request = {}) {
  if (request.outsideProject || isDefinitelyCriticalZyraToolPermission(request)) return true;
  const text = [request.command, request.detail].map(stringValue).filter(Boolean).join("\n");
  return Boolean(text && AMBIGUOUS_CRITICAL_WORD_PATTERN.test(text));
}

function isPathOutsideProject(value, project) {
  const candidate = path.resolve(project, value);
  const relative = path.relative(project, candidate);
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

export function createZyraPermissionGateExtension(options = {}) {
  const sessionGrants = new Set();
  const requestPermission = typeof options.requestPermission === "function" ? options.requestPermission : null;
  const reviewPermission = typeof options.reviewPermission === "function" ? options.reviewPermission : null;
  const getPermissionMode = typeof options.getPermissionMode === "function"
    ? options.getPermissionMode
    : () => "approval-required";
  const handleToolCall = async (event) => {
    const permissionMode = getPermissionMode();
    const request = describeZyraToolPermission(event, options);
    if (!request || sessionGrants.has(request.grantKey)) return undefined;

    if (permissionMode === "full-access") {
      if (!isPotentiallyCriticalZyraToolPermission(request)) return undefined;
      if (!isDefinitelyCriticalZyraToolPermission(request)) {
        const reviewed = await reviewZyraToolPermission(request, reviewPermission);
        if (reviewed?.decision === "approve") return undefined;
        if (reviewed?.decision === "deny") return reviewed.result;
      }
    } else if (permissionMode === "auto-review") {
      if (!isDefinitelyCriticalZyraToolPermission(request)) {
        const reviewed = await reviewZyraToolPermission(request, reviewPermission);
        if (reviewed?.decision === "approve") return undefined;
        if (reviewed?.decision === "deny") return reviewed.result;
      }
    } else if (
      permissionMode === "edits-only"
      && request.requestType === "file-change"
      && !request.outsideProject
      && !isDefinitelyCriticalZyraToolPermission(request)
    ) {
      return undefined;
    }

    if (!requestPermission) {
      return {
        block: true,
        reason: `${request.title || "This tool"}, but no approval surface is available.`,
      };
    }

    const decision = await requestPermission(request);
    if (decision === "acceptForSession") {
      sessionGrants.add(request.grantKey);
      return undefined;
    }
    if (decision === "acceptOnce") return undefined;
    return {
      block: true,
      reason: `The user declined ${request.toolName || "this tool"}.`,
    };
  };

  return {
    path: "<zyra:permission-gate>",
    resolvedPath: "<zyra:permission-gate>",
    sourceInfo: { source: "builtin", scope: "temporary", label: "Zyra permission gate" },
    handlers: new Map([["tool_call", [handleToolCall]]]),
    tools: new Map(),
    messageRenderers: new Map(),
    commands: new Map(),
    flags: new Map(),
    shortcuts: new Map(),
  };
}

async function reviewZyraToolPermission(request, reviewPermission) {
  if (!reviewPermission) return null;
  try {
    const review = normalizeReviewDecision(await reviewPermission(request));
    if (review.decision !== "deny") return { decision: review.decision };
    return {
      decision: "deny",
      result: {
        block: true,
        reason: review.reason || `Zyra's safety review declined ${request.toolName || "this tool"}.`,
      },
    };
  } catch {
    return null;
  }
}

function normalizeReviewDecision(value) {
  if (typeof value === "string") return { decision: normalizeReviewDecisionName(value), reason: "" };
  const record = asRecord(value);
  return {
    decision: normalizeReviewDecisionName(record.decision),
    reason: stringValue(record.reason).slice(0, 600),
  };
}

function normalizeReviewDecisionName(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["approve", "approved", "accept", "acceptonce"].includes(normalized)) return "approve";
  if (["deny", "denied", "decline", "rejected"].includes(normalized)) return "deny";
  return "ask";
}
