import { normalizeModelSelector } from "./model-router.mjs";

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ROLES = new Set(["reviewer", "planner", "implementer", "debugger", "verifier", "researcher", "specialist"]);
const PERMISSION_MODES = new Set(["read-only", "writer", "full-access"]);
const ISOLATIONS = new Set(["shared", "worktree"]);
const KNOWN_TOOLS = new Set(["read", "grep", "find", "ls", "context", "bash", "edit", "write", "web_search", "web_fetch"]);

export function validateAgentDefinition(input = {}, options = {}) {
  const errors = [];
  const warnings = [];
  const name = String(input.name ?? "").trim().toLowerCase();
  const description = String(input.description ?? "").trim();
  const prompt = String(input.prompt ?? input.body ?? "").trim();
  if (!NAME_RE.test(name)) errors.push("name must use lowercase letters, numbers, and hyphens (max 64)");
  if (!description) errors.push("description is required");
  if (!prompt) errors.push("agent prompt body is required");

  let model;
  try {
    model = normalizeModelSelector(input.model ?? "inherit");
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  const tools = strings(input.tools);
  const disallowedTools = strings(input.disallowedTools);
  for (const tool of tools) if (!KNOWN_TOOLS.has(tool)) warnings.push(`unsupported tool: ${tool}`);
  if (!tools.length) warnings.push("missing tool allowlist");
  const permissionMode = String(input.permissionMode ?? "read-only").toLowerCase();
  if (!PERMISSION_MODES.has(permissionMode)) errors.push(`unsupported permissionMode: ${permissionMode}`);
  if (permissionMode === "read-only" && tools.some((tool) => ["bash", "edit", "write"].includes(tool))) {
    warnings.push("claimed read-only role requests tools that can write; capability attenuation will remove them");
  }
  if (tools.includes("edit") || tools.includes("write") || permissionMode !== "read-only") warnings.push("broad writer access requires a declared write scope");
  if ((tools.includes("edit") || tools.includes("write")) && !strings(input.writeScope).length) warnings.push("writer has no declared writeScope");
  if (/\b(?:tell|instruct|require)\s+(?:the\s+)?parent\b|\b(?:publish|repeat|present)\s+.*verbatim\b/i.test(prompt)) warnings.push("prompt contains parent-presentation instructions");
  if (/\b(?:user approved|permission (?:is|has been) granted|I approve)\b/i.test(prompt)) warnings.push("prompt claims approval or permission");

  const role = String(input.role ?? "specialist").toLowerCase();
  if (!ROLES.has(role) && !options.allowCustomRole) warnings.push(`custom role: ${role}`);
  const isolation = String(input.isolation ?? "shared").toLowerCase();
  if (!ISOLATIONS.has(isolation)) errors.push(`unsupported isolation: ${isolation}`);
  const maxTurns = Number(input.maxTurns ?? 12);
  if (!Number.isSafeInteger(maxTurns) || maxTurns < 1 || maxTurns > 100) errors.push("maxTurns must be an integer from 1 to 100");

  const definition = {
    version: Number(input.version ?? 1),
    name,
    description,
    role,
    model: model ?? { requested: "inherit", prefer: "inherit", fallbacks: [], allowPreviousGenerations: true },
    effort: String(input.effort ?? "medium").toLowerCase(),
    tools,
    disallowedTools,
    permissionMode,
    background: input.background !== false,
    isolation,
    readScope: strings(input.readScope),
    writeScope: strings(input.writeScope),
    maxTurns,
    color: String(input.color ?? "violet"),
    skills: strings(input.skills),
    prompt,
    enabled: input.enabled !== false,
  };
  if (definition.version !== 1) errors.push(`unsupported definition version: ${definition.version}`);
  return { valid: errors.length === 0, definition, errors, warnings: [...new Set(warnings)] };
}

export function formatAgentDoctorReport(entries = []) {
  const lines = [];
  for (const entry of entries) {
    const status = entry.valid ? entry.warnings?.length ? "WARN" : "OK" : "ERROR";
    lines.push(`${status} ${entry.name ?? entry.definition?.name ?? entry.file ?? "unknown"}`);
    for (const error of entry.errors ?? []) lines.push(`  error: ${error}`);
    for (const warning of entry.warnings ?? []) lines.push(`  warning: ${warning}`);
  }
  return lines.length ? lines.join("\n") : "No agent definitions found.";
}

function strings(value) {
  const values = Array.isArray(value) ? value : value === undefined || value === null || value === "" ? [] : [value];
  return [...new Set(values.map((entry) => String(entry ?? "").trim().toLowerCase()).filter(Boolean))];
}
