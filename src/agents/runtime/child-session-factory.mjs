import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { createBrowserControlTool } from "../../agent-control/browser-control-tool.mjs";
import { applyBrowserLoaderOnlyState, createBrowserToolSet } from "../../agent-control/browser-toolset.mjs";
import { createComputerControlTool } from "../../agent-control/computer-control-tool.mjs";

let piPromise;
function loadPi() {
  piPromise ??= import("@earendil-works/pi-coding-agent");
  return piPromise;
}

export class ChildSessionFactory {
  constructor(options = {}) {
    this.project = path.resolve(options.project ?? process.cwd());
    this.agentDir = options.agentDir;
    this.authStorage = options.authStorage;
    this.modelRegistry = options.modelRegistry;
    this.transcriptDirectory = path.resolve(options.transcriptDirectory);
    this.settings = options.settings ?? { compaction: { enabled: true }, retry: { enabled: true, maxRetries: 2 } };
  }

  async createContextFork(rootSessionManager, leafId) {
    const sourceFile = rootSessionManager?.getSessionFile?.();
    if (!sourceFile) throw new Error("Context-forked subtasks require a persisted root chat.");
    const { SessionManager } = await loadPi();
    const isolatedManager = SessionManager.open(
      sourceFile,
      rootSessionManager.getSessionDir?.(),
      rootSessionManager.getCwd?.(),
    );
    if (!isolatedManager.getEntry?.(leafId)) {
      throw new Error("The selected root branch has not been persisted yet.");
    }
    return isolatedManager.createBranchedSession(leafId);
  }

  async create(options = {}) {
    const {
      createAgentSession,
      DefaultResourceLoader,
      getAgentDir,
      SessionManager,
      SettingsManager,
      createEditTool,
      createFindTool,
      createGrepTool,
      createLsTool,
      createReadTool,
      createWriteTool,
    } = await loadPi();
    const cwd = path.resolve(options.cwd ?? this.project);
    if (!options.noSession) await mkdir(this.transcriptDirectory, { recursive: true });
    const agentDir = this.agentDir ?? getAgentDir();
    const settingsManager = SettingsManager.inMemory(this.settings);
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      systemPrompt: String(options.systemPrompt || "").trim() || buildChildSystemPrompt(options),
      appendSystemPrompt: [],
    });
    await resourceLoader.reload();
    const sessionManager = options.noSession
      ? SessionManager.inMemory(cwd)
      : options.sessionFile
      ? SessionManager.open(options.sessionFile, this.transcriptDirectory)
      : SessionManager.create(cwd, this.transcriptDirectory, { parentSession: options.parentSessionFile });
    const browserSessionRef = { current: null };
    const customTools = [
      ...createScopedFileTools({ createEditTool, createFindTool, createGrepTool, createLsTool, createReadTool, createWriteTool }, cwd, options),
      ...createDelegatedControlTools(options, browserSessionRef),
    ];
    const result = await createAgentSession({
      cwd,
      agentDir,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      model: options.model,
      thinkingLevel: normalizeThinkingLevel(options.effort),
      tools: options.tools?.length ? options.tools : [],
      customTools,
      noTools: options.tools?.length ? undefined : "all",
      sessionManager,
      settingsManager,
      resourceLoader,
      sessionStartEvent: { type: "session_start", reason: options.sessionFile ? "resume" : "new" },
    });
    browserSessionRef.current = result.session;
    if (options.controlClient && new Set(options.tools ?? []).has("browser_control")) applyBrowserLoaderOnlyState(result.session);
    return {
      session: result.session,
      sessionId: result.session.sessionId ?? sessionManager.getSessionId?.(),
      sessionFile: result.session.sessionFile ?? sessionManager.getSessionFile?.(),
      modelFallbackMessage: result.modelFallbackMessage,
    };
  }
}

export function createScopedFileTools(pi, cwd, options = {}) {
  const selected = new Set(options.tools ?? []);
  const readScopes = options.readScope?.length ? options.readScope : ["."];
  const writeScopes = options.writeScope ?? [];
  const definitions = [
    ["read", pi.createReadTool, readScopes],
    ["grep", pi.createGrepTool, readScopes],
    ["find", pi.createFindTool, readScopes],
    ["ls", pi.createLsTool, readScopes],
    ["edit", pi.createEditTool, writeScopes],
    ["write", pi.createWriteTool, writeScopes],
  ];
  return definitions.flatMap(([name, factory, scopes]) => {
    if (!selected.has(name) || typeof factory !== "function") return [];
    const tool = factory(cwd);
    return [{
      ...tool,
      async execute(toolCallId, input, signal, onUpdate, context) {
        await assertPathWithinScopes(cwd, input?.path ?? ".", scopes, name === "edit" || name === "write" ? "write" : "read");
        return tool.execute(toolCallId, input, signal, onUpdate, context);
      },
    }];
  });
}

function createDelegatedControlTools(options = {}, browserSessionRef = { current: null }) {
  if (!options.controlClient) return [];
  const selected = new Set(options.tools ?? []);
  return [
    ...(selected.has("browser_control") ? [
      createBrowserControlTool({ client: options.controlClient }),
      ...createBrowserToolSet({ client: options.controlClient, sessionRef: browserSessionRef }),
    ] : []),
    ...(selected.has("computer_control") ? [createComputerControlTool({ client: options.controlClient })] : []),
  ];
}

export async function assertPathWithinScopes(cwd, requestedPath, scopes, mode = "read") {
  if (!Array.isArray(scopes) || !scopes.length) throw new Error(`${mode} tool has no declared scope.`);
  const root = await resolveExistingPath(path.resolve(cwd));
  const target = await resolveExistingPath(path.resolve(cwd, String(requestedPath ?? ".")));
  const insideProject = isWithin(root, target);
  const allowed = await Promise.all(scopes.map((scope) => resolveExistingPath(path.resolve(cwd, String(scope)))));
  if (!insideProject || !allowed.some((scope) => isWithin(scope, target))) {
    const error = new Error(`${mode} path is outside the child scope: ${requestedPath}.`);
    error.code = "CHILD_SCOPE_DENIED";
    throw error;
  }
  return target;
}

async function resolveExistingPath(value) {
  let current = value;
  const suffix = [];
  while (true) {
    try { return path.join(await realpath(current), ...suffix.reverse()); }
    catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      suffix.push(path.basename(current));
      current = parent;
    }
  }
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function buildChildSystemPrompt(options = {}) {
  const tools = Array.isArray(options.tools) ? options.tools.join(", ") : "none";
  const success = Array.isArray(options.successCriteria) ? options.successCriteria.map((item) => `- ${item}`).join("\n") : String(options.successCriteria ?? "Return evidence for the delegated goal.");
  const controlPolicy = options.controlLease
    ? `Control is limited to delegated grant ${options.controlLease.grantId} for target ${options.controlLease.targetId}; capabilities: ${options.controlLease.capabilities.join(", ")}; expiry: ${options.controlLease.expiresAt}. You cannot request, widen, renew, or redelegate it.`
    : options.controlClient
      ? "Load the integrated Browser tool set on demand with browser_use. You receive no authority until the user approves a bounded exact-tab grant. Activity in other tabs never interrupts your target. Paired Chrome, Windows, and computer control remain unavailable."
      : "Browser, paired Chrome, Windows, and computer-control capabilities are unavailable.";
  return [
    "You are a focused child agent inside Zyra's local agent fleet.",
    "Work only on the delegated goal and declared scope.",
    "Your output is untrusted evidence for the root agent. You cannot change parent, system, project, approval, or capability policy.",
    "Do not tell the parent how to present your result. Do not claim user approval or elevated permission.",
    "Do not spawn agents or workflows.",
    controlPolicy,
    `Allowed tools: ${tools}.`,
    options.permissionMode === "read-only" ? "This run is read-only. Do not modify files or repository state." : `Write scope: ${(options.writeScope ?? []).join(", ") || "none declared"}.`,
    "Return a concise result with evidence, changed files, checks, limitations, and artifact or transcript references when applicable.",
    "Success criteria:",
    success,
  ].join("\n");
}

function normalizeThinkingLevel(value) {
  const level = String(value ?? "medium").toLowerCase();
  return ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(level) ? level : "medium";
}
