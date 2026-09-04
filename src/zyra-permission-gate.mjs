import path from "node:path";

const SAFE_TOOL_NAMES = new Set([
  "read",
  "grep",
  "find",
  "ls",
  "web_search",
  "web_fetch",
  "request_user_input",
  "begin_action_batch",
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
  for (const key of ["path", "filePath", "folderPath", "rootPath", "directory", "cwd", "targetPath", "sourcePath", "destinationPath"]) {
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

function normalizeFilesystemRoots(options, project) {
  const scope = asRecord(options.filesystemScope);
  const roots = Array.isArray(scope.roots) ? scope.roots.flatMap((value) => {
    const root = asRecord(value);
    const rootPath = stringValue(root.path);
    if (!rootPath) return [];
    return [{
      path: path.resolve(rootPath),
      access: root.access === "read-only" ? "read-only" : "read-write",
    }];
  }) : [];
  if (roots.length === 0) roots.push({ path: project, access: "read-write" });
  return roots
    .filter((root, index, entries) => entries.findIndex((candidate) => candidate.path.toLowerCase() === root.path.toLowerCase()) === index)
    .sort((left, right) => right.path.length - left.path.length);
}

function filesystemRootForPath(value, project, roots) {
  const candidate = path.resolve(project, value);
  return roots.find((root) => !isPathOutsideProject(candidate, root.path)) || null;
}

function collectCommandPathHints(command) {
  const values = [];
  const tokens = String(command || "").match(/"[^"]+"|'[^']+'|[^\s;&|><]+/g) || [];
  for (const tokenValue of tokens) {
    const token = tokenValue.replace(/^["']|["'],?$/g, "").replace(/^[([]+|[),\]]+$/g, "");
    if (
      token === ".."
      || /^\.\.[\\/]/.test(token)
      || /^[a-z]:[\\/]/i.test(token)
      || /^\\\\[^\\]/.test(token)
      || /^~[\\/]/.test(token)
    ) values.push(token);
  }
  return [...new Set(values)];
}

function commandHasUnboundedPathExpansion(command) {
  return /(?:%userprofile%|%homedrive%|%homepath%|\$home\b|\$env:userprofile\b|\$env:homedrive\b)/i.test(String(command || ""));
}

function isConservativelyReadOnlyCommand(command) {
  const normalized = String(command || "").trim().toLowerCase();
  if (!normalized || /(?:^|[^<])>(?:>|&)?/.test(normalized) || /[;&|\r\n]|\$\(|`/.test(normalized)) return false;
  return /^(?:git\s+(?:status|diff|log|show|branch(?:\s+--show-current)?|rev-parse|ls-files)\b|(?:rg|grep|find|ls|dir|cat|type|more|head|tail|where|which|pwd|echo)\b|(?:get-content|get-childitem|get-item|select-string|test-path)\b)/i.test(normalized);
}

export function describeZyraToolPermission(event, options = {}) {
  const toolName = normalizeToolName(event?.toolName || event?.name);
  if (!toolName || isSeparatelySupervisedControlTool(toolName)) return null;

  const input = asRecord(event?.input);
  const project = path.resolve(options.project || process.cwd());
  const explicitFilesystemScope = Array.isArray(asRecord(options.filesystemScope).roots);
  const roots = normalizeFilesystemRoots(options, project);
  const command = toolName === "bash" || /(?:shell|terminal|exec|command)/.test(toolName)
    ? stringValue(input.command || input.cmd || input.script)
    : "";
  const paths = [...new Set([...collectPaths(input), ...collectCommandPathHints(command)])];
  const matchedRoots = paths.map((value) => filesystemRootForPath(value, project, roots));
  const outsideProject = matchedRoots.some((root) => !root) || commandHasUnboundedPathExpansion(command);
  const requestType = toolName === "edit" || toolName === "write" || /(?:write|edit|patch|delete|move|rename|create)/.test(toolName)
    ? "file-change"
    : command
      ? "command"
      : "command";
  const workingRoot = filesystemRootForPath(project, project, roots);
  const readOnlyViolation = requestType === "file-change"
    ? matchedRoots.some((root) => root?.access === "read-only")
    : Boolean(command)
      && !isConservativelyReadOnlyCommand(command)
      && (workingRoot?.access === "read-only" || matchedRoots.some((root) => root?.access === "read-only"));
  if (SAFE_TOOL_NAMES.has(toolName) && !outsideProject) return null;
  const scopeLabel = requestType === "file-change" ? "file changes" : toolName === "bash" ? "shell commands" : toolName;
  const scopeKey = roots.map((root) => `${root.path.toLowerCase()}:${root.access}`).join("|");

  return {
    requestType,
    title: `${displayToolName(toolName)} needs approval`,
    detail: command || (paths.length > 0 ? paths.join("\n") : boundedJson(input)),
    ...(command ? { command } : {}),
    ...(paths.length > 0 ? { paths } : {}),
    toolName,
    outsideProject,
    scopeViolation: explicitFilesystemScope && outsideProject,
    readOnlyViolation: explicitFilesystemScope && readOnlyViolation,
    grantKey: `${requestType}:${toolName}:${scopeKey}`,
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
    if (!request) return undefined;
    if (request.scopeViolation) {
      return {
        block: true,
        reason: `${request.toolName || "This tool"} requested a path outside this chat's filesystem scope.`,
      };
    }
    if (request.readOnlyViolation) {
      return {
        block: true,
        reason: `${request.toolName || "This tool"} requested a write inside a read-only Project folder.`,
      };
    }
    if (sessionGrants.has(request.grantKey)) return undefined;

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
