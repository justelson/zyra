import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseMarkdownDefinition } from "./definition-loader.mjs";
import { validateAgentDefinition } from "./definition-validator.mjs";

export const CLAUDE_TOOL_MAP = Object.freeze({
  Read: "read", read_file: "read", Grep: "grep", grep: "grep", Glob: "find", search_files: "find",
  Bash: "bash", run_bash_command: "bash", Edit: "edit", Write: "write", write_file: "write",
  WebSearch: "web_search", WebFetch: "web_fetch",
});

export const CLAUDE_MODEL_MAP = Object.freeze({
  inherit: { prefer: "inherit", fallbacks: [] },
  opus: { prefer: "sol", fallbacks: ["openai-codex/gpt-5.5", "openai-codex/gpt-5.4"] },
  sonnet: { prefer: "terra", fallbacks: ["openai-codex/gpt-5.5", "openai-codex/gpt-5.4"] },
  haiku: { prefer: "luna", fallbacks: ["openai-codex/gpt-5.4-mini", "openai-codex/gpt-5.3-codex-spark"] },
});

export async function previewClaudeAgentImports(options = {}) {
  const roots = options.roots ?? [
    path.join(os.homedir(), ".claude", "agents"),
    path.join(options.project ?? process.cwd(), ".claude", "agents"),
  ];
  const existingNames = new Set((options.existingNames ?? []).map((name) => String(name).toLowerCase()));
  const previews = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const files = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => path.join(root, entry.name));
    for (const file of files) previews.push(await previewClaudeAgentFile(file, { ...options, existingNames }));
  }
  return { previews, copied: 0, requiresConfirmation: true };
}

export async function importClaudeAgentPreviews(preview, options = {}) {
  if (options.confirmed !== true) throw new Error("Claude agent import requires explicit confirmation.");
  const scope = options.scope === "project" ? "project" : "user";
  const targetRoot = scope === "project"
    ? path.join(options.project ?? process.cwd(), ".zyra", "agents")
    : path.join(os.homedir(), ".zyra", "agents");
  const selectedNames = new Set((options.names ?? []).map((name) => String(name).toLowerCase()));
  const selected = preview.previews.filter((entry) => !selectedNames.size || selectedNames.has(entry.candidate.name));
  if (!selected.length) throw new Error("No matching Claude agent definitions were selected.");
  const blocked = selected.filter((entry) => !entry.valid || entry.warnings.includes("duplicate name"));
  if (blocked.length) throw new Error(`Blocked Claude agent imports: ${blocked.map((entry) => entry.candidate.name).join(", ")}. Resolve validation errors or duplicate names first.`);
  await mkdir(targetRoot, { recursive: true });
  const files = [];
  for (const entry of selected) {
    const file = path.join(targetRoot, `${entry.candidate.name}.md`);
    const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(temporary, serializeImportedAgent(entry.candidate), "utf8");
    await rename(temporary, file);
    files.push(file);
  }
  return { copied: files.length, files, scope };
}

export async function previewClaudeAgentFile(file, options = {}) {
  const text = await readFile(file, "utf8");
  const parsed = parseMarkdownDefinition(text);
  const metadata = parsed.metadata ?? {};
  const warnings = [];
  const unsupportedTools = [];
  const mappedTools = [];
  for (const tool of toStrings(metadata.tools)) {
    const mapped = CLAUDE_TOOL_MAP[tool] ?? CLAUDE_TOOL_MAP[tool.toLowerCase()];
    if (mapped) mappedTools.push(mapped);
    else unsupportedTools.push(tool);
  }
  if (!toStrings(metadata.tools).length) warnings.push("missing tool allowlist");
  if (unsupportedTools.length) warnings.push(`unsupported tools: ${unsupportedTools.join(", ")}`);

  const sourceModel = String(metadata.model ?? "inherit").toLowerCase();
  const mappedModel = options.model ? { prefer: options.model, fallbacks: [] } : CLAUDE_MODEL_MAP[sourceModel];
  if (!mappedModel) warnings.push(`unsupported model '${sourceModel}'; choose inherit, role-default, or a provider/model ID before import`);
  else if (options.model) warnings.push(`Import will use ${options.model}; existing definitions are unchanged`);
  else if (sourceModel !== "inherit") warnings.push(`${sourceModel} maps semantically to Codex ${mappedModel.prefer}; this is not model equivalence`);

  const name = String(metadata.name ?? path.basename(file, ".md")).toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  if (options.existingNames?.has(name)) warnings.push("duplicate name");
  const skills = toStrings(metadata.skills);
  const brokenSkills = skills.filter((skill) => !skillExists(skill, options));
  if (brokenSkills.length) warnings.push(`broken skill references: ${brokenSkills.join(", ")}`);
  if (/\b(?:tell|instruct|require)\s+(?:the\s+)?parent\b|\b(?:publish|repeat|present)\s+.*verbatim\b/i.test(parsed.prompt)) warnings.push("parent-presentation instructions");
  if (/\b(?:user approved|permission (?:is|has been) granted|I approve)\b/i.test(parsed.prompt)) warnings.push("prompt claims approvals or permissions");
  const claimedReadOnly = /read[- ]only/i.test(String(metadata.permissionMode ?? metadata.description ?? ""));
  if (claimedReadOnly && mappedTools.some((tool) => ["bash", "edit", "write"].includes(tool))) warnings.push("claimed read-only behavior is not enforced by requested tools");
  if (mappedTools.some((tool) => ["edit", "write", "bash"].includes(tool))) warnings.push("broad writer access");

  const candidate = {
    version: 1,
    name,
    description: String(metadata.description ?? `Imported Claude agent ${name}`),
    role: String(metadata.role ?? "specialist"),
    model: mappedModel ?? { prefer: "inherit", fallbacks: [] },
    effort: String(metadata.effort ?? "medium"),
    tools: [...new Set(mappedTools)],
    disallowedTools: toStrings(metadata.disallowedTools).map((tool) => CLAUDE_TOOL_MAP[tool] ?? tool),
    permissionMode: claimedReadOnly ? "read-only" : mappedTools.some((tool) => ["edit", "write"].includes(tool)) ? "writer" : "read-only",
    background: metadata.background !== false,
    isolation: String(metadata.isolation ?? "shared"),
    maxTurns: Number(metadata.maxTurns ?? 12),
    skills,
    prompt: parsed.prompt,
  };
  const validation = mappedModel ? validateAgentDefinition(candidate, { allowCustomRole: true }) : { valid: false, errors: ["model selection required"], warnings: [] };
  return {
    file,
    candidate: validation.definition ?? candidate,
    valid: validation.valid && unsupportedTools.length === 0 && brokenSkills.length === 0,
    errors: validation.errors,
    warnings: [...new Set([...warnings, ...(validation.warnings ?? [])])],
    unsupportedTools,
    brokenSkills,
    requiresConfirmation: true,
    copied: false,
  };
}

function serializeImportedAgent(candidate) {
  const fields = [
    ["name", candidate.name], ["description", candidate.description], ["role", candidate.role],
    ["model", candidate.model], ["effort", candidate.effort], ["tools", candidate.tools],
    ["disallowedTools", candidate.disallowedTools], ["permissionMode", candidate.permissionMode],
    ["background", candidate.background], ["isolation", candidate.isolation], ["maxTurns", candidate.maxTurns],
    ["skills", candidate.skills],
  ];
  const frontmatter = fields.map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join("\n");
  return `---\n${frontmatter}\n---\n\n${String(candidate.prompt ?? "").trim()}\n`;
}

function skillExists(skill, options) {
  const roots = options.skillRoots ?? [path.join(os.homedir(), ".zyra", "skills"), path.join(options.project ?? process.cwd(), ".zyra", "skills")];
  return roots.some((root) => existsSync(path.join(root, skill, "SKILL.md")) || existsSync(path.join(root, `${skill}.md`)));
}

function toStrings(value) {
  const entries = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return entries.map((entry) => String(entry ?? "").trim()).filter(Boolean);
}
