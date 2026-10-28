import path from "node:path";
import { realpathSync, statSync } from "node:fs";
import { canonicalPermissionPath, resolvePermissionPath } from "./permission-paths.mjs";
import { createFilesystemAccessController, FILESYSTEM_ACCESS_TOOL } from "./filesystem-access-tool.mjs";
import { isDefinitelyCriticalZyraToolPermission, isPotentiallyCriticalZyraToolPermission } from "./permission-command-policy.mjs";
export { isDefinitelyCriticalZyraToolPermission, isPotentiallyCriticalZyraToolPermission } from "./permission-command-policy.mjs";

const SAFE_TOOL_NAMES = new Set([
  "read",
  "grep",
  "find",
  "ls",
  "web_search",
  "web_fetch",
  "request_user_input",
  "begin_action_batch",
  "set_chat_title",
  "set_work_context",
  // This tool is bound to the caller's own session and accepts no target.
  "context",
]);

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

function collectPaths(input, nativePaths = false) {
  const values = [];
  const pathValue = (value) => nativePaths && typeof value === "string" ? value : stringValue(value);
  for (const key of ["path", "filePath", "folderPath", "rootPath", "directory", "cwd", "targetPath", "sourcePath", "destinationPath"]) {
    const value = pathValue(input[key]);
    if (value) values.push(value);
  }
  for (const key of ["paths", "files"]) {
    if (!Array.isArray(input[key])) continue;
    for (const value of input[key]) {
      const entry = pathValue(value);
      if (entry) values.push(entry);
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
  if (Array.isArray(scope.roots)) {
    for (const root of roots) root.realPath = canonicalPermissionPath(root.path);
  }
  return roots
    .filter((root, index, entries) => Array.isArray(scope.roots)
      || entries.findIndex((candidate) => candidate.path.toLowerCase() === root.path.toLowerCase()) === index)
    .sort((left, right) => right.path.length - left.path.length);
}

function filesystemRootForPath(value, project, roots, nativePaths = false, toolName = "") {
  if (!nativePaths) {
    const candidate = path.resolve(project, value);
    return roots.find((root) => !isPathOutsideProject(candidate, root.path)) || null;
  }
  try {
    const candidate = resolvePermissionPath(value, project, toolName);
    // Keep the advertised scope boundary as well as the destination boundary.
    if (!roots.some((root) => !isPathOutsideProject(candidate, root.path))) return null;
    const canonical = canonicalPermissionPath(candidate);
    if (!canonical) return null;
    // A loaded root may not acquire a different destination between calls.
    const stableRoots = roots.filter((root) => root.realPath
      && canonicalPermissionPath(root.path) === root.realPath);
    const matches = stableRoots.filter((root) => !isPathOutsideProject(canonical, root.realPath));
    if (!matches.length) return null;
    // A writable alias must not override either spelling of a read-only root.
    const readOnly = roots.find((root) => root.access === "read-only"
      && (!isPathOutsideProject(candidate, root.path)
        || (root.realPath && !isPathOutsideProject(canonical, root.realPath))));
    return readOnly || matches[0];
  } catch {
    return null;
  }
}

export function collectCommandPathHints(command, platform = process.platform) {
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
      || (platform !== "win32" && token.startsWith("/"))
      || (platform === "win32" && (/^\/(?:mnt\/|cygdrive\/)?[a-z]\//i.test(token)
        || (/^\/(?:mnt\/|cygdrive\/)?[a-z]$/i.test(token) && /^(?:ls|cat|head|tail|find|grep|rg|stat|du|df)\s/i.test(command.trim()))))
    ) values.push(token);
  }
  return [...new Set(values)];
}

function commandHasUnboundedPathExpansion(command) {
  return /(?:%userprofile%|%homedrive%|%homepath%|\$home\b|\$env:userprofile\b|\$env:homedrive\b)/i.test(String(command || ""));
}

function isConservativelyReadOnlyCommand(command) {
  // Git's uppercase -C selects a working directory; lowercase -c changes
  // configuration and must not inherit this read-only classification.
  const normalized = String(command || "").trim()
    .replace(/^git\s+(?:-C\s+(?:"[^"]*"|'[^']*'|[^\s"']+)\s+)+/, "git ")
    .toLowerCase();
  if (!normalized || /[\r\n]|\$\(|`/.test(normalized)) return false;
  let unquoted = "";
  let quote = "";
  for (let index = 0; index < normalized.length; index++) {
    const character = normalized[index];
    if (character === "\\" && quote !== "'" && index + 1 < normalized.length) {
      unquoted += "  ";
      index++;
    } else if (character === quote) {
      quote = "";
      unquoted += " ";
    } else if (!quote && (character === "'" || character === '"')) {
      quote = character;
      unquoted += " ";
    } else {
      unquoted += quote ? " " : character;
    }
  }
  if (quote || /[;&><]/.test(unquoted) || /\|\|/.test(unquoted)) return false;
  const readOnlyCommand = /^(?:git\s+(?:status|diff|log|show|branch(?:\s+--show-current)?|rev-parse|ls-files)\b|(?:rg|grep|find|ls|dir|cat|type|more|head|tail|where|which|pwd|echo)\b|(?:get-content|get-childitem|get-item|select-string|test-path)\b)/i;
  const segments = [];
  let start = 0;
  for (let index = 0; index < unquoted.length; index++) {
    if (unquoted[index] !== "|") continue;
    segments.push(normalized.slice(start, index).trim());
    start = index + 1;
  }
  segments.push(normalized.slice(start).trim());
  return segments.every((segment) => readOnlyCommand.test(segment));
}

export function describeZyraToolPermission(event, options = {}) {
  return describeToolPermission(event, options);
}

function emailActionSummary(tool, value) {
  if (tool === 'send_draft') return 'Send the saved email draft to its stored recipients.';
  if (!['create_draft', 'update_draft', 'send_message'].includes(tool)) return '';
  const args = asRecord(value);
  // Counts only: no recipients, subject/body, attachment bytes or credentials
  // enter the approval/reviewer log. Uploads must nevertheless be visible.
  const count = key => Array.isArray(args[key]) ? Math.min(100, args[key].length) : 0;
  const textSize = ['body', 'htmlBody'].reduce((size, key) => size + (typeof args[key] === 'string' ? args[key].length : 0), 0);
  return `Email ${tool === 'send_message' ? 'send' : 'draft save'}: ${count('to')} To, ${count('cc')} Cc, ${count('bcc')} Bcc recipients; ${textSize} body characters. Attachment uploads: ${count('attachments')}.`;
}

function describeToolPermission(event, options, scopedRoots) {
  const toolName = normalizeToolName(event?.toolName || event?.name);
  if (!toolName || toolName === FILESYSTEM_ACCESS_TOOL || isSeparatelySupervisedControlTool(toolName)) return null;

  const input = asRecord(event?.input);
  if (toolName === 'plugin_mcp') {
    const action = stringValue(input.action).slice(0, 24);
    if (action === 'servers') return null;
    const pluginId = stringValue(input.pluginId).slice(0, 128);
    const server = stringValue(input.server).slice(0, 64);
    const tool = stringValue(input.tool).slice(0, 128);
    return {
      requestType: 'command',
      title: action === 'call' ? 'Use Plugin MCP tool' : 'Connect to Plugin MCP server',
      detail: [[pluginId, server, tool].filter(Boolean).join(' / ') || 'List Chat Plugin MCP servers', action === 'call' ? emailActionSummary(tool, input.arguments) : ''].filter(Boolean).join('\n'),
      toolName,
      outsideProject: false,
      scopeViolation: false,
      readOnlyViolation: false,
      grantKey: `plugin_mcp:${pluginId}:${server}:${action}:${tool}`,
      grantLabel: `Allow ${pluginId || 'Plugin'} MCP ${tool || server || 'discovery'} for this chat`,
    };
  }
  const project = path.resolve(options.project || process.cwd());
  const explicitFilesystemScope = Array.isArray(asRecord(options.filesystemScope).roots);
  const roots = scopedRoots || normalizeFilesystemRoots(options, project);
  const command = toolName === "bash" || /(?:shell|terminal|exec|command)/.test(toolName)
    ? stringValue(input.command || input.cmd || input.script)
    : "";
  const paths = [...new Set([...collectPaths(input, explicitFilesystemScope), ...collectCommandPathHints(command)])];
  if (explicitFilesystemScope && ["grep", "find", "ls"].includes(toolName) && !input.path) paths.push(".");
  const matchedRoots = paths.map((value) => filesystemRootForPath(value, project, roots, explicitFilesystemScope, toolName));
  const outsideProject = matchedRoots.some((root) => !root) || commandHasUnboundedPathExpansion(command);
  const requestType = toolName === "edit" || toolName === "write" || /(?:write|edit|patch|delete|move|rename|create)/.test(toolName)
    ? "file-change"
    : command
      ? "command"
      : "command";
  const workingRoot = filesystemRootForPath(project, project, roots, explicitFilesystemScope);
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

function isPathOutsideProject(value, project) {
  const candidate = path.resolve(project, value);
  const relative = path.relative(project, candidate);
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

function isLoadedSkillRead(event, options) {
  // Only Pi's single-file read tool. No recursive search, writes, or shell tools.
  if (event?.toolName !== "read" || typeof event.input?.path !== "string"
    || typeof options.getSkillReadResources !== "function") return false;
  try {
    const candidate = resolvePermissionPath(event.input.path, options.project || process.cwd(), "read");
    const canonical = realpathSync.native(candidate);
    if (!statSync(canonical).isFile()) return false;
    return options.getSkillReadResources().some((resource) => {
      // Both the advertised path and its canonical destination must stay inside
      // the load-time boundary. Replacing a Skill directory with a link revokes it.
      if (realpathSync.native(resource.path) !== resource.realPath) return false;
      return resource.directory
        ? !isPathOutsideProject(candidate, resource.path) && !isPathOutsideProject(canonical, resource.realPath)
        : candidate === resource.path && canonical === resource.realPath;
    });
  } catch {
    return false;
  }
}

export function createZyraPermissionGateExtension(options = {}) {
  const sessionGrants = new Set();
  const scopedRoots = Array.isArray(asRecord(options.filesystemScope).roots)
    ? normalizeFilesystemRoots(options, path.resolve(options.project || process.cwd()))
    : undefined;
  const requestPermission = typeof options.requestPermission === "function" ? options.requestPermission : null;
  const reviewPermission = typeof options.reviewPermission === "function" ? options.reviewPermission : null;
  const getPermissionMode = typeof options.getPermissionMode === "function"
    ? options.getPermissionMode
    : () => "approval-required";
  const access = scopedRoots && requestPermission ? createFilesystemAccessController({
    project: path.resolve(options.project || process.cwd()), roots: scopedRoots,
    requestPermission, getPermissionMode,
  }) : null;
  const consumeAccess = (event) => {
    const input = asRecord(event?.input);
    access?.consume([...collectPaths(input, true), ...collectCommandPathHints(input.command || input.cmd || input.script)], normalizeToolName(event?.toolName || event?.name));
  };
  const handleToolCall = async (event) => {
    // The saved-resource tool authorizes its trusted store destination from its
    // executor. Caller arguments cannot supply that path or bypass this check.
    if (['visualization', 'set_work_context'].includes(normalizeToolName(event?.toolName || event?.name))) return undefined;
    // App operations are authorized at the canonical server and owning service,
    // against the exact action/patch. Do not request a second generic tool grant.
    if (['settings', 'settings_action', 'app', 'usage'].includes(normalizeToolName(event?.toolName || event?.name))) return undefined;
    const permissionMode = getPermissionMode();
    if (permissionMode === "full-access") {
      consumeAccess(event);
      return undefined;
    }
    if (isLoadedSkillRead(event, options)) return undefined;
    const effectiveRoots = access?.currentRoots() || scopedRoots;
    const request = describeToolPermission(event, options, effectiveRoots);
    if (!request) { consumeAccess(event); return undefined; }
    if (permissionMode !== "full-access" && request.scopeViolation) {
      return {
        block: true,
        reason: `${request.toolName || "This tool"} requested a path outside this chat's filesystem scope. Folder limits apply in the current permission mode. ${access ? 'Call filesystem_access with operation inspect to see scope, then request the needed folder through approval and retry this same tool. Do not bypass a denial with Bash. ' : ''}For permanent access, associate the folder in Settings > Projects, then open Thread Details > Folder access and apply folder changes. Allowed folders: ${effectiveRoots?.map((root) => `${root.path} (${root.access})`).join("; ") || "project folder only"}.`,
      };
    }
    if (permissionMode !== "full-access" && request.readOnlyViolation) {
      return {
        block: true,
        reason: `${request.toolName || "This tool"} requested a write inside a read-only Project folder.`,
      };
    }
    consumeAccess(event);
    if (sessionGrants.has(request.grantKey)
      && (permissionMode !== "auto-review" || !isPotentiallyCriticalZyraToolPermission(request))) return undefined;

    let approvalRequest = request;
    if (permissionMode === "auto-review") {
      const reviewed = await reviewZyraToolPermission(request, reviewPermission);
      if (reviewed.decision === "approve") return undefined;
      approvalRequest = {
        ...request,
        detail: `${reviewed.reason}\n\n${request.detail}`,
      };
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

    const decision = await requestPermission({ ...approvalRequest, toolCallId: event?.toolCallId });
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

  const workRoots = scopedRoots || normalizeFilesystemRoots(options, path.resolve(options.project || process.cwd()))
    .map(root => ({ ...root, realPath: canonicalPermissionPath(root.path) }));
  return {
    // The metadata executor may inspect an existing readable directory, but it
    // cannot prompt for or consume a grant just to decorate the sidebar.
    canReadWorkFolder(folderPath) {
      if (getPermissionMode() === 'full-access') return true;
      return Boolean(filesystemRootForPath(folderPath, options.project || process.cwd(), access?.currentRoots() || workRoots, true, 'read'));
    },
    async authorizeVisualization(context, action, toolCallId) {
      if (!['list', 'read', 'embed', 'create', 'revise'].includes(action)) throw new Error('Unknown visualization action.');
      if (!context || typeof context.cwd !== 'string' || !context.cwd) throw new Error('Visualization workspace is unavailable.');
      const mutation = action === 'create' || action === 'revise';
      const destination = path.join(path.resolve(context.cwd), '.zyra', 'visualizations');
      const roots = access?.currentRoots() || scopedRoots;
      const mode = getPermissionMode();
      if (mutation && mode === 'read-only') throw new Error('Visualization revisions cannot be saved in read-only mode.');
      if (roots) {
        const matched = filesystemRootForPath(destination, options.project || process.cwd(), roots, true, mutation ? 'write' : 'read');
        if (!matched) throw new Error('Visualization store is outside this chat\'s filesystem scope.');
        if (mutation && matched.access === 'read-only') throw new Error('Visualization store is inside a read-only Project folder.');
      }
      const blocked = await handleToolCall({ toolName: mutation ? 'write' : 'read', toolCallId, input: { path: destination } });
      if (blocked?.block) throw new Error(blocked.reason || 'Visualization access was denied.');
    },
    path: "<zyra:permission-gate>",
    resolvedPath: "<zyra:permission-gate>",
    sourceInfo: { source: "builtin", scope: "temporary", label: "Zyra permission gate" },
    handlers: new Map([["tool_call", [handleToolCall]]]),
    tools: access ? new Map([[FILESYSTEM_ACCESS_TOOL, { definition: access.tool, sourceInfo: { source: "builtin", scope: "temporary", label: "Folder access" } }]]) : new Map(),
    messageRenderers: new Map(),
    commands: new Map(),
    flags: new Map(),
    shortcuts: new Map(),
  };
}

async function reviewZyraToolPermission(request, reviewPermission) {
  if (!reviewPermission) return { decision: "ask", reason: "Automatic review is unavailable." };
  try {
    return normalizeReviewDecision(await reviewPermission(request));
  } catch (error) {
    return { decision: "ask", reason: `Automatic review failed: ${String(error?.message || "unknown error").slice(0, 300)}` };
  }
}

function normalizeReviewDecision(value) {
  if (typeof value === "string") return { decision: normalizeReviewDecisionName(value), reason: "Automatic review requires your confirmation." };
  const record = asRecord(value);
  return {
    decision: normalizeReviewDecisionName(record.decision),
    reason: stringValue(record.reason).slice(0, 600) || "Automatic review requires your confirmation.",
  };
}

function normalizeReviewDecisionName(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["approve", "approved", "accept", "acceptonce"].includes(normalized)) return "approve";
  if (["deny", "denied", "decline", "rejected"].includes(normalized)) return "deny";
  return "ask";
}
