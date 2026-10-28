const SAFE_READ_TOOLS = new Set(["read", "grep", "find", "ls", "context"]);
const PERMISSION_MODES = new Set(["read-only", "writer", "full-access"]);
const PERMISSION_MODE_ALIASES = new Map([["workspace-write", "writer"]]);
const DELEGATABLE_CONTROL_TOOLS = new Set(["browser_control", "computer_control"]);
const CONTROL_CAPABILITIES = new Set([
  "observe.structure", "observe.screenshot", "navigate", "pointer.click", "pointer.move", "pointer.drag",
  "keyboard.type", "keyboard.key", "scroll", "form.select", "window.focus",
]);
const KNOWN_TOOLS = new Set(["read", "grep", "find", "ls", "context", "bash", "edit", "write", ...DELEGATABLE_CONTROL_TOOLS]);
const CONTROL_TOOL_RE = /(?:browser|chrome|computer|windows|desktop|agent[_-]?control|pair|click|navigate|screenshot)/i;
const DESTRUCTIVE_GIT_RE = /\bgit\s+(?:reset\s+--hard|clean\s+-[a-z]*f|push\s+--force|rebase|merge|cherry-pick)\b/i;
const SENSITIVE_COMMAND_RE = /\b(?:deploy|publish|release|terraform\s+apply|kubectl\s+(?:apply|delete)|rm\s+-rf|format\s+[a-z]:|drop\s+(?:database|table))\b/i;

export const DEFAULT_CHILD_DENIED_CAPABILITIES = Object.freeze([
  "browser-control", "chrome-control", "windows-control", "computer-use", "agent-control", "spawn-agent", "run-workflow",
]);

export function attenuateAgentCapabilities(definition = {}, request = {}, policy = {}) {
  const permissionMode = normalizePermissionMode(request.permissionMode ?? definition.permissionMode);
  const requestedTools = uniqueStrings([...(request.tools ?? definition.tools ?? ["read", "grep", "find", "ls"]), 'context']);
  const disallowed = new Set(uniqueStrings([...(definition.disallowedTools ?? []), ...(request.disallowedTools ?? []), ...(policy.disallowedTools ?? [])]));
  const warnings = [];
  const denied = [];
  const tools = [];

  for (const tool of requestedTools) {
    if (DELEGATABLE_CONTROL_TOOLS.has(tool)) {
      if (tool === "browser_control" && policy.allowOnDemandBrowser === true) {
        tools.push(tool);
      } else if (policy.allowDelegatedControl === true && request.controlLease) {
        tools.push(tool);
      } else {
        denied.push({ tool, reason: "child_control_denied" });
      }
      continue;
    }
    if (CONTROL_TOOL_RE.test(tool) || ["agent", "workflow"].includes(tool)) {
      denied.push({ tool, reason: "child_control_denied" });
      continue;
    }
    if (!KNOWN_TOOLS.has(tool)) {
      denied.push({ tool, reason: "unknown_tool" });
      continue;
    }
    if (disallowed.has(tool)) {
      denied.push({ tool, reason: "definition_disallowed" });
      continue;
    }
    if (tool === "bash") {
      denied.push({ tool, reason: "shell_cannot_enforce_child_scope" });
      continue;
    }
    if (permissionMode === "read-only" && !SAFE_READ_TOOLS.has(tool)) {
      denied.push({ tool, reason: "read_only" });
      continue;
    }
    tools.push(tool);
  }

  if (requestedTools.includes("bash")) {
    warnings.push("Removed bash because the unrestricted shell cannot enforce a child read/write scope.");
  }
  if (["writer", "full-access"].includes(permissionMode) && !uniqueStrings(request.writeScope ?? definition.writeScope).length) {
    warnings.push("Writer has no declared write scope; execution must remain blocked until scope is declared.");
  }

  const delegatedCapabilities = new Set(uniqueStrings(request.controlLease?.capabilities));
  const requestedCapabilities = uniqueStrings([
    ...uniqueStrings(request.capabilities ?? definition.capabilities),
    ...uniqueStrings(request.controlLease?.capabilities),
  ]);
  const capabilities = requestedCapabilities.filter((capability) => {
    if (DEFAULT_CHILD_DENIED_CAPABILITIES.includes(capability) || CONTROL_TOOL_RE.test(capability) || CONTROL_CAPABILITIES.has(capability)) {
      if (policy.allowDelegatedControl === true && delegatedCapabilities.has(capability)) return true;
      denied.push({ capability, reason: "child_control_denied" });
      return false;
    }
    return true;
  });

  return {
    permissionMode,
    tools: [...new Set(tools)],
    capabilities,
    denied,
    warnings,
    writeScope: uniqueStrings(request.writeScope ?? definition.writeScope),
    readScope: uniqueStrings(request.readScope ?? definition.readScope),
    isolation: request.isolation ?? definition.isolation ?? "shared",
    requiresExplicitApproval: uniqueStrings([
      "merge", "deploy", "publish", "destructive-git", "capability-elevation",
      ...(request.requiresExplicitApproval ?? []),
    ]),
  };
}

export function commandRequiresExplicitApproval(command) {
  const text = String(command ?? "");
  if (DESTRUCTIVE_GIT_RE.test(text)) return { required: true, reason: "destructive_git" };
  if (SENSITIVE_COMMAND_RE.test(text)) return { required: true, reason: "irreversible_or_external_action" };
  return { required: false };
}

export function assertNoControlCapabilities(tools = [], capabilities = [], options = {}) {
  const delegatedCapabilities = new Set(uniqueStrings(options.delegatedCapabilities));
  const forbidden = [
    ...tools.filter((value) => (CONTROL_TOOL_RE.test(value) || ["agent", "workflow"].includes(value))
      && !(options.allowOnDemandBrowser === true && value === "browser_control")
      && !(options.allowDelegatedControl === true && DELEGATABLE_CONTROL_TOOLS.has(value))),
    ...capabilities.filter((value) => (CONTROL_TOOL_RE.test(value) || CONTROL_CAPABILITIES.has(value))
      && !(options.allowDelegatedControl === true && delegatedCapabilities.has(value))),
  ];
  if (forbidden.length) throw new Error(`Child control capabilities are denied: ${forbidden.join(", ")}.`);
}

function normalizePermissionMode(value) {
  const requested = String(value ?? "read-only").trim().toLowerCase();
  const permissionMode = PERMISSION_MODE_ALIASES.get(requested) ?? requested;
  if (!PERMISSION_MODES.has(permissionMode)) throw new Error(`Unsupported permissionMode: ${requested}.`);
  return permissionMode;
}

function uniqueStrings(value) {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(list.map((entry) => String(entry ?? "").trim()).filter(Boolean))];
}
