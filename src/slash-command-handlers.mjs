import {
  buildSessionInfo,
  configureZyraOpenAIApiKey,
  createZyraMemoryController,
  describeRuntime,
  fetchCodexResetCredits,
  fetchCodexUsageStats,
  isCodexResetCreditAvailable,
  loadCustomCommand,
  loadZyraSkillPrompt,
  loginZyraAuth,
  reloadZyraRuntime,
  runZyraPrompt,
  setModel,
  setInterruptMode,
  setNotifications,
  setProfile,
  setStatusLine,
  setThinking,
  setCodexMode,
  setWebFetch,
  setWebSearch,
  setWebTools,
  setZyraTheme,
  getRuntimeContextUsage,
  getAutoProfile,
  formatZyraModelAvailabilitySummary,
  formatZyraAuthMethodsStatus,
  getZyraAuthOverview,
  redeemCodexResetCredit,
  refreshZyraModelAvailability,
  removeZyraAuth,
  switchZyraAuthMethod,
} from "./zyra-sdk.mjs";
import { normalizeZyraAuthMethod, providerForZyraAuthMethod } from "./auth-methods.mjs";
import { importClaudeAgentPreviews, previewClaudeAgentImports } from "./agents/claude-importer.mjs";
import { formatAgentDoctorReport } from "./agents/definition-validator.mjs";
import { buildProjectStartPrompt } from "./project-start.mjs";
import { getSlashCommand, parseSlashInput } from "./slash-commands.mjs";
import { normalizeWebToolsMode } from "./web-tools-picker.mjs";
import { normalizeZyraPermissionMode } from "./permission-mode.mjs";
import {
  DESKTOP_WORKSPACE_COMMANDS,
  formatDesktopWorkspaceResult,
  parseDesktopWorkspaceCommand,
} from "./desktop-workspace-commands.mjs";
import { captureCliEvent, getCliAnalyticsStatus, updateCliAnalyticsEnabled } from "./analytics/cli.mjs";
import { classifyErrorCode, normalizeAnalyticsCommandName } from "./analytics/contracts.mjs";
import {
  formatCodexResetCreditsSummary,
  formatCodexResetRedemptionWarning,
  formatCodexUsageSnapshot,
} from "./codex-reset-format.mjs";

const UNKNOWN_SLASH_COMMAND = Symbol("unknown-slash-command");

export async function handleSlash(runtime, ui, input, controls = {}) {
  const text = String(input ?? "").trim();
  if (!text.startsWith("/") && !["exit", "quit"].includes(text.toLowerCase())) return false;
  const parsed = parseSlashInput(text.startsWith("/") ? text : `/${text}`);
  const commandName = normalizeAnalyticsCommandName(parsed.command?.name ?? parsed.commandName);
  const skillCommand = /^\/skill:/i.test(text);
  const workspaceCommand = DESKTOP_WORKSPACE_COMMANDS.includes(parsed.command?.name ?? parsed.commandName);
  const captureWrapperOutcome = !workspaceCommand && !skillCommand;
  if (captureWrapperOutcome) captureCliEvent("zyra_v1_cli", {
    action: "slash_command",
    command: commandName,
    outcome: "started",
  });
  try {
    const result = await handleSlashCommand(runtime, ui, text, parsed, controls);
    if (captureWrapperOutcome) captureCliEvent("zyra_v1_cli", {
      action: "slash_command",
      command: commandName,
      outcome: result === UNKNOWN_SLASH_COMMAND ? "failed" : "completed",
      ...(result === UNKNOWN_SLASH_COMMAND ? { error_code: "invalid_input" } : {}),
    });
    return result === UNKNOWN_SLASH_COMMAND ? true : result;
  } catch (error) {
    if (captureWrapperOutcome) captureCliEvent("zyra_v1_cli", {
      action: "slash_command",
      command: commandName,
      outcome: "failed",
      error_code: classifyErrorCode(error),
    });
    throw error;
  }
}

async function handleSlashCommand(runtime, ui, text, parsed, controls = {}) {
  const command = parsed.command;
  const name = command?.name ?? parsed.commandName;
  const arg = parsed.arg;

  if (name === "exit") return true;

  if (!command) {
    return runCustomSlashCommand(runtime, ui, `/${parsed.commandName}`, arg, controls);
  }

  switch (name) {
    case "commands":
      ui.commands();
      return true;
    case "agents":
      return runAgents(runtime, ui, arg);
    case "agent":
      return runAgent(runtime, ui, arg);
    case "subtask":
      return runSubtask(runtime, ui, arg);
    case "workflows":
      return runWorkflows(runtime, ui);
    case "workflow":
      return runWorkflow(runtime, ui, arg);
    case "start":
      return runStart(runtime, ui, arg, controls);
    case "session":
      if (arg.trim().toLowerCase() === "copy") {
        const threadId = runtime.session?.sessionManager?.getSessionId?.();
        if (!threadId) {
          ui.info("This runtime does not expose a thread ID.");
          return true;
        }
        process.stdout.write(`\u001b]52;c;${Buffer.from(String(threadId), "utf8").toString("base64")}\u0007`);
        ui.info(`Copied thread ID: ${threadId}`);
        return true;
      }
      await runtime.agentServer?.refreshPresence?.();
      ui.status(describeRuntime(runtime));
      return true;
    case "profile":
      return runProfile(runtime, ui, arg);
    case "memory":
      return runMemory(runtime, ui, arg);
    case "browser":
    case "details-ui":
    case "explore-files":
    case "resources":
    case "subagents-ui":
    case "diff-ui":
    case "terminal-ui":
      return runDesktopWorkspace(runtime, ui, name, arg);
    case "web":
      return runWeb(runtime, ui, arg);
    case "websearch":
      return runWebSearch(runtime, ui, arg);
    case "webfetch":
      return runWebFetch(runtime, ui, arg);
    case "auth":
      return runAuth(runtime, ui, arg, controls);
    case "codexusage":
      return runCodexUsage(ui);
    case "codexresets":
      return runCodexResets(ui);
    case "codexresetlist":
      return runCodexResetList(ui);
    case "login":
      return runLogin(runtime, ui, arg, controls);
    case "logout":
      return runLogout(runtime, ui, arg);
    case "reload":
      return runReload(runtime, ui, arg, controls);
    case "new":
      await controls.startFreshChat?.();
      return true;
    case "compact":
      return runContextCompact(runtime, ui, arg, controls);
    case "consolidate":
      return runMemoryConsolidate(runtime, ui, controls);
    case "chat":
      if (arg.trim().toLowerCase() === "info") {
        await runtime.agentServer?.refreshPresence?.();
        ui.sessionInfo(buildSessionInfo(runtime));
        return true;
      }
      if (typeof controls.openChatPicker === "function") return controls.openChatPicker();
      ui.sessionInfo(buildSessionInfo(runtime));
      return true;
    case "older":
      if (typeof controls.loadOlderHistory === "function") return controls.loadOlderHistory();
      ui.info("Older transcript paging is unavailable in this runtime.");
      return true;
    case "thinking":
      return runThinking(runtime, ui, arg);
    case "mode":
      return runMode(runtime, ui, arg);
    case "access":
      return runAccess(runtime, ui, arg);
    case "themes":
      return runThemes(runtime, ui, arg);
    case "models":
      return runModels(runtime, ui, arg);
    case "analytics":
      return runAnalyticsPreference(ui, arg);
    case "statusline":
      return runStatusLine(runtime, ui, arg);
    case "notifications":
      return runNotifications(runtime, ui, arg);
    case "interrupt":
      return runInterruptMode(runtime, ui, arg);
    default:
      return runCustomSlashCommand(runtime, ui, `/${parsed.commandName}`, arg, controls);
  }
}

async function runDesktopWorkspace(runtime, ui, commandName, arg) {
  if (!DESKTOP_WORKSPACE_COMMANDS.includes(commandName)) return false;
  if (typeof runtime.agentServer?.openDesktopWorkspace !== "function") {
    captureCliEvent("zyra_v1_cli", { action: "workspace_command", command: normalizeAnalyticsCommandName(commandName), outcome: "unavailable", error_code: "unavailable" });
    ui.info("Zyra Desktop is required for this command.");
    return true;
  }
  try {
    const command = parseDesktopWorkspaceCommand(commandName, arg);
    const result = await runtime.agentServer.openDesktopWorkspace(command);
    captureCliEvent("zyra_v1_cli", { action: "workspace_command", command: normalizeAnalyticsCommandName(commandName), outcome: "completed" });
    ui.info(formatDesktopWorkspaceResult(command, result));
  } catch (error) {
    captureCliEvent("zyra_v1_cli", { action: "workspace_command", command: normalizeAnalyticsCommandName(commandName), outcome: "failed", error_code: classifyErrorCode(error) });
    const code = String(error?.code || "");
    if (code === "DESKTOP_WORKSPACE_UNAVAILABLE" || code === "AGENT_SERVER_TIMEOUT") {
      ui.info("Zyra Desktop is not connected. Open Desktop and retry.");
      return true;
    }
    ui.info(error instanceof Error ? error.message : "Could not open Zyra Desktop.");
  }
  return true;
}

async function runAgents(runtime, ui, arg) {
  if (!runtime.fleet) throw new Error("Agent fleet is unavailable in this session.");
  const action = String(arg ?? "").trim().toLowerCase();
  if (!action) {
    const result = await ui.openAgents?.(runtime.fleet);
    if (result?.action === "steer") {
      ui._host?.inputComponent?.setText?.(`/agent send ${result.agentRunId} `);
    }
    return true;
  }
  if (action === "doctor") {
    ui.block(formatAgentDoctorReport(runtime.fleet.listDefinitions().all).split("\n"));
    return true;
  }
  if (action === "import claude" || action.startsWith("import claude confirm")) {
    const definitions = runtime.fleet.listDefinitions();
    const preview = await previewClaudeAgentImports({
      project: runtime.project,
      existingNames: definitions.active.map((entry) => entry.name),
    });
    if (action.startsWith("import claude confirm")) {
      const selections = action.slice("import claude confirm".length).trim().split(/\s+/).filter(Boolean);
      const scope = selections.includes("project") ? "project" : "user";
      const names = selections.filter((entry) => !["all", "project", "user"].includes(entry));
      const imported = await importClaudeAgentPreviews(preview, { confirmed: true, project: runtime.project, scope, names });
      await runtime.fleet.reloadDefinitions();
      ui.info(`Imported ${imported.copied} Claude agent definition${imported.copied === 1 ? "" : "s"} into ${scope} scope. Run /reload to refresh the root agent guide.`);
      return true;
    }
    const lines = ["Claude agent import preview (nothing copied):"];
    for (const item of preview.previews) {
      lines.push(`${item.valid ? "READY" : "BLOCKED"} ${item.candidate.name}`);
      for (const warning of item.warnings) lines.push(`  warning: ${warning}`);
      for (const error of item.errors) lines.push(`  error: ${error}`);
    }
    if (!preview.previews.length) lines.push("No Claude agent definitions found.");
    else lines.push("Confirm with /agents import claude confirm <name|all> [user|project].");
    ui.block(lines);
    return true;
  }
  ui.info("Usage: /agents, /agents doctor, /agents import claude");
  return true;
}

async function runAgent(runtime, ui, arg) {
  if (!runtime.fleet) throw new Error("Agent fleet is unavailable in this session.");
  const [name, ...rest] = String(arg ?? "").trim().split(/\s+/).filter(Boolean);
  if (!name) { ui.info("Usage: /agent <name> <task>"); return true; }
  if (["send", "stop", "retry", "resume", "status", "wait"].includes(name)) {
    const [agentRunId, ...messageParts] = rest;
    if (!agentRunId) throw new Error(`/agent ${name} requires an agent run id.`);
    let result;
    if (name === "send") result = await runtime.fleet.send(agentRunId, messageParts.join(" "));
    if (name === "stop") result = await runtime.fleet.stop(agentRunId);
    if (name === "retry") result = await runtime.fleet.retry(agentRunId, messageParts.length ? { goal: messageParts.join(" ") } : {});
    if (name === "resume") result = await runtime.fleet.resume(agentRunId, messageParts.join(" ") || undefined);
    if (name === "status") result = runtime.fleet.status(agentRunId);
    if (name === "wait") result = await runtime.fleet.wait(agentRunId);
    ui.info(formatFleetActionResult(result));
    return true;
  }
  const prompt = rest.join(" ");
  if (!prompt) throw new Error("Named agent invocation requires a task.");
  const result = await runtime.fleet.spawn({ agent: name.replace(/^@agent-/, ""), prompt, goal: prompt, background: true });
  ui.info(`Agent queued: ${result.agentRunId} · ${result.model}. Keep chatting or open /agents.`);
  return true;
}

async function runSubtask(runtime, ui, arg) {
  const prompt = String(arg ?? "").trim();
  if (!prompt) throw new Error("Usage: /subtask <task>");
  const result = await runtime.fleet.spawn({ prompt, goal: prompt, contextFork: true, label: "subtask", background: true });
  ui.info(`Context-forked subtask queued: ${result.agentRunId}.`);
  return true;
}

async function runWorkflows(runtime, ui) {
  if (!runtime.workflows) throw new Error("Workflow runtime is unavailable in this session.");
  const result = await ui.openWorkflows?.(runtime.workflows);
  if (result?.action === "save") {
    const saved = await runtime.workflows.save(result.workflowRunId, { scope: "personal" });
    ui.info(`Workflow saved: ${saved.file}. Use /reload after editing definition files.`);
  }
  return true;
}

async function runWorkflow(runtime, ui, arg) {
  if (!runtime.workflows) throw new Error("Workflow runtime is unavailable in this session.");
  const match = String(arg ?? "").trim().match(/^(\S+)(?:\s+([\s\S]+))?$/);
  if (!match) { ui.info("Usage: /workflow <name> [json args]"); return true; }
  let args = {};
  if (match[2]) {
    try { args = JSON.parse(match[2]); } catch (error) { throw new Error(`Workflow arguments must be JSON: ${error instanceof Error ? error.message : String(error)}`); }
  }
  const run = await runtime.workflows.run(match[1], args, { approved: true, background: true });
  ui.info(`Workflow queued: ${run.workflowRunId} · ${run.definitionName}. Keep chatting or open /workflows.`);
  return true;
}

function formatFleetActionResult(result) {
  if (!result) return "Agent action completed.";
  if (result.agentRunId) return `${result.label ?? result.agentId ?? "Agent"}: ${result.status ?? "updated"} · ${result.agentRunId}`;
  return JSON.stringify(result);
}

async function runStart(runtime, ui, arg, controls) {
  ui.beginProgress("Project scan");
  controls.setTerminalTitleState?.("working");
  try {
    await runZyraPrompt(runtime, buildProjectStartPrompt(runtime, arg));
    controls.notifyTerminalIfUnfocused?.();
  } finally {
    ui.endProgress();
    controls.setTerminalTitleState?.("ready");
  }
  return true;
}

async function runProfile(runtime, ui, arg) {
  if (!arg) {
    ui.info(`Profile: ${describeRuntime(runtime).profile}`);
    return true;
  }
  const autoProfile = getAutoProfile();
  const previousProfile = describeRuntime(runtime).profile ?? autoProfile;
  const requestedProfile = arg.trim().toLowerCase();
  const profile = setProfile(runtime, requestedProfile);
  const prompt = buildProfileChangePrompt({ autoProfile, previousProfile, requestedProfile, profile });
  ui.suppressUserMessage?.(prompt);
  const runSwitchPrompt = () => runZyraPrompt(runtime, prompt);
  if (typeof ui.withActivityLabel === "function") await ui.withActivityLabel("changing current profile", runSwitchPrompt);
  else await runSwitchPrompt();
  return true;
}

export function buildProfileChangePrompt({ autoProfile, previousProfile, requestedProfile, profile } = {}) {
  return [
    "[Internal Zyra profile-change notice]",
    "This message is hidden from the visible transcript UI, but it is intentionally part of chat history so the assistant can adapt.",
    `The configured auto profile is ${quoteProfile(autoProfile)}.`,
    `The active profile before the command was ${quoteProfile(previousProfile)}.`,
    `The user ran /profile ${String(requestedProfile ?? "").trim() || quoteProfile(profile)} and the active profile is now ${quoteProfile(profile)}.`,
    "Write one short, witty, human confirmation that spotlights the user changed profile. Do not mention this internal notice. Do not continue into unrelated work.",
  ].join("\n");
}

function quoteProfile(value) {
  return JSON.stringify(String(value ?? "unknown"));
}

function runMemory(runtime, ui, arg) {
  const memory = createZyraMemoryController(runtime);
  const action = arg.trim().toLowerCase();
  if (action && !["on", "off", "enable", "enabled", "disable", "disabled"].includes(action)) {
    ui.info("Usage: /memory, /memory on, /memory off");
    return true;
  }

  const current = memory.threadMode();
  const nextMode = ["on", "enable", "enabled"].includes(action)
    ? "enabled"
    : ["off", "disable", "disabled"].includes(action)
      ? "disabled"
      : current.mode === "enabled" ? "disabled" : "enabled";
  const result = memory.setThreadMode(nextMode);
  ui.info(`Memory ${result.mode === "enabled" ? "on" : "off"} for this chat.`);
  return true;
}

async function runWeb(runtime, ui, arg) {
  const mode = normalizeWebToolsMode(arg);
  const selected = mode ?? await ui.selectWebTools?.({
    webSearch: runtime.webSearch,
    webFetch: runtime.webFetch,
  });
  if (!selected) {
    ui.info("Web tools unchanged.");
    return true;
  }
  const next = setWebTools(runtime, selected);
  ui.info(formatWebToolsStatus(next));
  return true;
}

function runWebSearch(runtime, ui, arg) {
  const action = arg.trim().toLowerCase();
  if (action && !["on", "off", "enable", "enabled", "disable", "disabled"].includes(action)) {
    ui.info("Usage: /websearch, /websearch on, /websearch off");
    return true;
  }
  const enabled = setWebSearch(runtime, action || undefined);
  ui.info(`Web search ${enabled ? "on" : "off"}.`);
  return true;
}

function runWebFetch(runtime, ui, arg) {
  const action = arg.trim().toLowerCase();
  if (action && !["on", "off", "enable", "enabled", "disable", "disabled"].includes(action)) {
    ui.info("Usage: /webfetch, /webfetch on, /webfetch off");
    return true;
  }
  const enabled = setWebFetch(runtime, action || undefined);
  ui.info(`Web fetch ${enabled ? "on" : "off"}.`);
  return true;
}

async function runAuth(runtime, ui, arg, controls) {
  const [rawMethod, rawAction] = String(arg ?? "").trim().toLowerCase().split(/\s+/, 2);
  if (!rawMethod) {
    await showAuthOverview(runtime, ui);
    return true;
  }

  const method = normalizeZyraAuthMethod(rawMethod);
  if (!method || (rawAction && !["setup", "rotate", "remove"].includes(rawAction))) {
    ui.info("Usage: /auth, /auth subscription, /auth api, /auth api setup, /auth api remove");
    return true;
  }

  if (rawAction === "remove") {
    return runLogout(runtime, ui, method);
  }

  await connectAndSwitchAuth(runtime, ui, method, controls, {
    forceSetup: method === "api" && ["setup", "rotate"].includes(rawAction),
  });
  return true;
}

async function runCodexUsage(ui) {
  ui.info("Checking Codex usage...");
  ui.codexUsage(await fetchCodexUsageStats());
  return true;
}

async function runCodexResetList(ui) {
  ui.info("Loading banked Codex resets...");
  ui.block(formatCodexResetCreditsSummary(await fetchCodexResetCredits()));
  return true;
}

export async function runCodexResets(ui, dependencies = {}) {
  const loadResetCredits = dependencies.fetchResetCredits ?? fetchCodexResetCredits;
  const loadUsage = dependencies.fetchUsage ?? fetchCodexUsageStats;
  const redeemReset = dependencies.redeemReset ?? redeemCodexResetCredit;
  ui.info("Loading banked Codex resets...");
  const [resetCredits, usage] = await Promise.all([
    loadResetCredits(),
    loadUsage(),
  ]);

  if (resetCredits.credits.length === 0) {
    ui.info("No banked Codex resets were returned for this account.");
    return true;
  }

  const selected = await ui.selectCodexResetCredit(resetCredits.credits);
  if (!selected) return true;
  if (!isCodexResetCreditAvailable(selected)) {
    ui.info(`That reset is ${selected.status} and cannot be redeemed.`);
    return true;
  }

  const confirmed = await ui.confirmCodexResetRedemption(
    selected,
    formatCodexResetRedemptionWarning(selected, usage),
  );
  if (confirmed !== true) {
    ui.info("Reset cancelled. No credit was used.");
    return true;
  }

  const freshCredits = await loadResetCredits();
  const freshSelected = freshCredits.credits.find((credit) => credit.id === selected.id);
  if (!freshSelected || !isCodexResetCreditAvailable(freshSelected)) {
    ui.info("That reset is no longer available. Nothing was redeemed.");
    return true;
  }

  ui.info("Redeeming Codex reset...");
  const redemption = await redeemReset(freshSelected.id);
  const [updatedUsage, updatedCredits] = await Promise.all([
    loadUsage(),
    loadResetCredits(),
  ]);
  const windows = redemption.windowsReset === undefined
    ? "eligible windows"
    : `${redemption.windowsReset} window${redemption.windowsReset === 1 ? "" : "s"}`;
  ui.block([
    `Codex reset redeemed: ${windows} reset.`,
    formatCodexUsageSnapshot(updatedUsage),
    `${updatedCredits.availableCount} banked reset${updatedCredits.availableCount === 1 ? "" : "s"} remaining.`,
  ]);
  return true;
}

async function runLogin(runtime, ui, arg, controls) {
  const method = normalizeZyraAuthMethod(arg || "subscription");
  if (!method) {
    ui.info("Usage: /login subscription | /login api");
    return true;
  }
  await connectAndSwitchAuth(runtime, ui, method, controls, { forceSetup: method === "api" });
  return true;
}

async function runLogout(runtime, ui, arg) {
  const method = normalizeZyraAuthMethod(arg || "subscription");
  if (!method) {
    ui.info("Usage: /logout subscription | /logout api");
    return true;
  }
  ui.info(`Disconnecting ${authMethodLabel(method)}...`);
  await runtime.syncAuthProvider?.(providerForZyraAuthMethod(method));
  const before = await getZyraAuthOverview(runtime);
  await removeZyraAuth(method, { authStorage: runtime.session.modelRegistry.authStorage });
  await runtime.syncAuthProvider?.(providerForZyraAuthMethod(method));
  const fallback = method === "api" ? "subscription" : "api";
  const after = await getZyraAuthOverview(runtime);
  if (before.active === method && after[fallback]?.configured) {
    const result = await switchZyraAuthMethod(runtime, fallback, {
      authStorage: runtime.session.modelRegistry.authStorage,
    });
    ui.info(`Switched to ${authMethodLabel(fallback)} with ${result.model.provider}/${result.model.id}.`);
  }
  await showAuthOverview(runtime, ui);
  return true;
}

async function connectAndSwitchAuth(runtime, ui, method, controls, options = {}) {
  const authStorage = runtime.session.modelRegistry.authStorage;
  const provider = providerForZyraAuthMethod(method);
  let verification;

  controls?.setTerminalTitleState?.("working");
  try {
    await runtime.syncAuthProvider?.(provider);
    if (method === "api" && (options.forceSetup || !authStorage.hasAuth(provider))) {
      const key = await ui.promptSecret("OpenAI API key");
      ui.info("Verifying OpenAI API key...");
      verification = await configureZyraOpenAIApiKey(key, { authStorage });
      ui.info("OpenAI API key verified and saved securely.");
    } else if (method === "subscription" && !authStorage.hasAuth(provider)) {
      ui.beginProgress("ChatGPT login");
      await loginZyraAuth(provider, {
        authStorage,
        onMessage: (message) => ui.info(message),
      });
    }

    await runtime.syncAuthProvider?.(provider);
    const result = await switchZyraAuthMethod(runtime, method, { authStorage, verification });
    ui.info(`Using ${authMethodLabel(method)} with ${result.model.provider}/${result.model.id}.`);
    await showAuthOverview(runtime, ui);
  } finally {
    ui.endProgress?.();
    controls?.setTerminalTitleState?.("ready");
  }
}

async function showAuthOverview(runtime, ui) {
  ui.info("Checking authentication...");
  const status = await getZyraAuthOverview(runtime);
  ui.block(formatZyraAuthMethodsStatus(status).split("\n"));
}

function authMethodLabel(method) {
  return method === "api" ? "OpenAI API" : "ChatGPT subscription";
}

async function runReload(runtime, ui, arg, controls) {
  if (arg.trim() === "--soft") {
    ui.info("Reloading commands, themes, prompt, and memory without restarting...");
    controls.setTerminalTitleState?.("reloading");
    const result = await reloadZyraRuntime(runtime);
    ui.setTheme(result.theme);
    ui.info(`Reloaded resources: ${result.commands} command${result.commands === 1 ? "" : "s"}, ${result.themes} theme${result.themes === 1 ? "" : "s"}.`);
    controls.setTerminalTitleState?.("ready");
    return true;
  }
  controls.setTerminalTitleState?.("reloading");
  ui.restartTransition("reloading zyra");
  return "restart";
}

async function runContextCompact(runtime, ui, arg, controls) {
  controls.setTerminalTitleState?.("compacting");
  try {
    const result = await runtime.session.compact(String(arg ?? "").trim() || undefined);
    const afterUsage = getRuntimeContextUsage(runtime);
    ui.info(formatContextCompactionResult(result, afterUsage));
  } finally {
    controls.setTerminalTitleState?.("ready");
  }
  return true;
}

async function runMemoryConsolidate(runtime, ui, controls) {
  const memory = createZyraMemoryController(runtime);
  ui.beginProgress("Consolidating Zyra memory");
  controls.setTerminalTitleState?.("compacting");
  try {
    const result = await memory.consolidate();
    ui.info(memory.formatConsolidationResult(result));
  } finally {
    ui.endProgress();
    controls.setTerminalTitleState?.("ready");
  }
  return true;
}

function runThinking(runtime, ui, arg) {
  const level = setThinking(runtime, arg);
  ui.info(`Thinking: ${level}`);
  return true;
}

function runMode(runtime, ui, arg) {
  if (!arg) {
    ui.info(`Mode: ${describeRuntime(runtime).codexServiceTier}. Use /mode normal|fast|cheap|auto.`);
    return true;
  }
  const mode = setCodexMode(runtime, arg);
  ui.info(`Mode: ${mode}. Fast uses Codex priority service tier and can cost more.`);
  return true;
}

function runThemes(runtime, ui, arg) {
  if (!arg) {
    ui.themes(describeRuntime(runtime).themes, runtime.terminalTheme?.name);
    return true;
  }
  const theme = setZyraTheme(runtime, arg);
  ui.setTheme(theme);
  ui.info(`Theme: ${theme.name}`);
  return true;
}

async function runModels(runtime, ui, arg) {
  if (!arg) {
    ui.info("Choose a model from the picker: type /models and press Enter. Use /models refresh to ping OpenAI models.");
    return true;
  }
  if (["refresh", "--refresh", "ping", "check"].includes(arg.trim().toLowerCase())) {
    ui.info("Pinging OpenAI models...");
    const report = await refreshZyraModelAvailability(runtime.session.modelRegistry, { forceRefresh: true });
    ui.info(formatZyraModelAvailabilitySummary(report));
    return true;
  }
  const model = await setModel(runtime, arg);
  ui.info(`Model: ${model.provider}/${model.id} · Thinking: ${describeRuntime(runtime).thinking}`);
  return true;
}

function runStatusLine(runtime, ui, arg) {
  if (!arg) {
    ui.info(`Status line: ${runtime.statusLine ?? "default"}. Use /statusline default|minimal|full|off.`);
    return true;
  }
  const next = setStatusLine(runtime, arg);
  ui.info(`Status line: ${next}.`);
  return true;
}

async function runAnalyticsPreference(ui, arg) {
  const choice = String(arg || "").trim().toLowerCase();
  if (!choice || choice === "status") {
    const status = await getCliAnalyticsStatus();
    const label = status.enabled ? "on" : status.preferenceSet ? "off" : "not chosen";
    ui.info(`Product analytics: ${label}. Use /analytics on or /analytics off.`);
    return true;
  }
  if (choice !== "on" && choice !== "off") {
    ui.info("Use /analytics on, /analytics off, or /analytics status.");
    return true;
  }
  const status = await updateCliAnalyticsEnabled(choice === "on");
  if (choice === "off") {
    ui.info("Product analytics is off. Queued events were removed.");
    return true;
  }
  ui.info(status.enabled
    ? "Product analytics is on. Zyra shares coarse feature usage, timings, and allowlisted diagnostic codes. It never sends prompts, responses, transcripts, files, paths, URLs, account identity, or terminal content."
    : "Your analytics choice was saved. This build has no configured analytics destination, so Zyra sends nothing.");
  return true;
}

function runNotifications(runtime, ui, arg) {
  if (!arg) {
    ui.info(`Notifications: ${runtime.notifications ?? "unfocused"}. Use /notifications unfocused|always|off.`);
    return true;
  }
  const next = setNotifications(runtime, arg);
  ui.info(`Notifications: ${formatNotificationMode(next)}.`);
  return true;
}

async function runInterruptMode(runtime, ui, arg) {
  const selected = arg.trim() || await ui.selectInterruptMode?.(runtime.interruptMode ?? "steer");
  if (!selected) {
    ui.info(`Interrupt mode unchanged: ${formatInterruptMode(runtime.interruptMode ?? "steer")}.`);
    return true;
  }
  const next = setInterruptMode(runtime, selected);
  ui.info(`Interrupt mode: ${formatInterruptMode(next)}.`);
  return true;
}

function runAccess(runtime, ui, arg) {
  const requested = String(arg || "").trim();
  if (!requested) {
    ui.info(`Access: ${formatPermissionMode(runtime.permissionMode)}. Use /access supervised|auto|edits|full.`);
    return true;
  }
  const next = normalizeZyraPermissionMode(requested);
  if (!next) {
    ui.info("Use /access supervised, /access auto, /access edits, or /access full.");
    return true;
  }
  runtime.permissionMode = next;
  ui.info(`Access: ${formatPermissionMode(next)}.`);
  return true;
}

async function runCustomSlashCommand(runtime, ui, rawCommand, arg, controls) {
  const skillMatch = rawCommand.match(/^\/skill:([a-z0-9][a-z0-9_-]{0,63})$/i);
  const prompt = skillMatch
    ? loadZyraSkillPrompt(runtime, rawCommand, arg)
    : loadCustomCommand(runtime, rawCommand, arg);
  if (prompt) {
    if (skillMatch) captureCliEvent("zyra_v1_cli", { action: "skill", skill: skillMatch[1].toLowerCase(), outcome: "started" });
    controls.setTerminalTitleState?.("thinking");
    try {
      await runZyraPrompt(runtime, prompt);
      if (skillMatch) captureCliEvent("zyra_v1_cli", { action: "skill", skill: skillMatch[1].toLowerCase(), outcome: "completed" });
      controls.notifyTerminalIfUnfocused?.();
    } catch (error) {
      if (skillMatch) captureCliEvent("zyra_v1_cli", { action: "skill", skill: skillMatch[1].toLowerCase(), outcome: "failed", error_code: classifyErrorCode(error) });
      throw error;
    } finally {
      controls.setTerminalTitleState?.("ready");
    }
    return true;
  }

  if (!getSlashCommand(rawCommand)) {
    ui.error(new Error("Unknown slash command. Type /commands."));
    return UNKNOWN_SLASH_COMMAND;
  }
  return true;
}

function formatWebToolsStatus(status = {}) {
  if (status.webSearch && status.webFetch) return "Web tools: all on.";
  if (!status.webSearch && !status.webFetch) return "Web tools: off.";
  if (status.webSearch) return "Web tools: search only.";
  return "Web tools: fetch only.";
}

function formatContextCompactionResult(result = {}, afterUsage) {
  const before = Number(result.tokensBefore);
  const after = Number(afterUsage?.tokens);
  const beforeText = Number.isFinite(before) && before > 0 ? ` from about ${before.toLocaleString()} tokens` : "";
  const afterText = Number.isFinite(after) && after > 0 ? ` to about ${after.toLocaleString()} tokens` : "";
  return `Context compacted${beforeText}${afterText}.`;
}

function formatNotificationMode(mode) {
  if (mode === "always") return "always ring when a turn finishes";
  if (mode === "off") return "off";
  return "ring only when the terminal is not focused";
}

function formatInterruptMode(mode) {
  if (mode === "queue") return "queue Enter until the active turn finishes";
  return "steer Enter after the next tool-call boundary";
}

function formatPermissionMode(mode) {
  if (mode === "full-access") return "full access";
  if (mode === "auto-review") return "auto review";
  if (mode === "edits-only") return "edits only";
  return "supervised";
}
