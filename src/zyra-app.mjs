#!/usr/bin/env node
import { copyFileSync, rmSync } from "node:fs";
import os from "node:os";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import {
  buildInspectPrompt,
  checkSetup,
  configureZyraOpenAIApiKey,
  createZyraSession,
  defaults,
  describeRuntime,
  fetchCodexUsageStats,
  formatZyraAuthMethodsStatus,
  getZyraAuthOverview,
  listZyraSessions,
  loginZyraAuth,
  queueZyraMidRunInput,
  removeZyraAuth,
  runZyraPrompt,
  runZyraPrintPrompt,
  saveZyraExitSummary,
  setZyraAuthMethodPreference,
  startZyraMemoryBackgroundStartup,
} from "./zyra-sdk.mjs";
import { chooseVerifiedApiModel, normalizeZyraAuthMethod } from "./auth-methods.mjs";
import { promptSecret } from "./secret-input.mjs";
import { createZyraUi } from "./zyra-ui.mjs";
import { runOnboarding, shouldRunOnboarding } from "./onboarding.mjs";
import { handleSlash } from "./slash-command-handlers.mjs";
import { selectSession } from "./session-picker.mjs";
import { applySlashSuggestion, getSlashSuggestions } from "./slash-suggestions.mjs";
import { renderStatusLine } from "./status-line.mjs";
import { createZyraTerminalTitle } from "./terminal-title.mjs";
import { normalizeWebToolsMode, selectWebTools } from "./web-tools-picker.mjs";
import { formatZyraVersion, isZyraVersionRequest } from "./version.mjs";
import { createZyraTuiClientRuntime, listCanonicalZyraChats } from "./agent-server/tui-runtime.mjs";
import { captureCliEvent, initializeCliAnalytics, shutdownCliAnalytics } from "./analytics/cli.mjs";
import { classifyErrorCode, normalizeAnalyticsCommandName } from "./analytics/contracts.mjs";
import { extractZyraPermissionModeArgs } from "./permission-mode.mjs";
import { isNetworkRecoveryError } from "./network-recovery.mjs";

const useEmbeddedRuntime = process.env.ZYRA_EMBEDDED_RUNTIME === "1";
const createCliRuntime = (options) => useEmbeddedRuntime ? createZyraSession(options) : createZyraTuiClientRuntime(options);
const listCliSessions = (options) => useEmbeddedRuntime ? listZyraSessions(options) : listCanonicalZyraChats(options);
let cliStartupCompleted = false;

function parse(argv) {
  const permissionArgs = extractZyraPermissionModeArgs(argv);
  const args = [...permissionArgs.args];
  let command = "chat";
  let project = defaults.project;
  let prompt = "";
  let sessionMode = "new";
  let session = "";
  let noSession = false;
  let pickSession = false;
  let printMode = false;
  let model = "";
  let thinking = "";
  let serviceTier = "";
  const permissionMode = permissionArgs.permissionMode;
  let profile = "";
  let terminalTheme = "";
  let statusLine = "";
  let notifications = "";
  let interruptMode = "";
  let webSearch;
  let webFetch;
  let webMenu = false;
  let forceOnboarding = false;
  let skipOnboarding = false;

  if (isZyraVersionRequest(args)) {
    return { command: "version", project, prompt, sessionMode, session, noSession, pickSession, printMode, model, thinking, serviceTier, permissionMode, profile, terminalTheme, statusLine, notifications, interruptMode, webSearch, webFetch, webMenu, forceOnboarding, skipOnboarding };
  }
  if (args[0] === "--help" || args[0] === "-h") {
    return { command: args[0], project, prompt, sessionMode, session, noSession, pickSession, printMode, model, thinking, serviceTier, permissionMode, profile, terminalTheme, statusLine, notifications, interruptMode, webSearch, webFetch, webMenu, forceOnboarding, skipOnboarding };
  }

  if (args[0] && !args[0].startsWith("-")) {
    command = args.shift();
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if ((arg === "--project" || arg === "--cwd") && args[i + 1]) {
      project = path.resolve(args[i + 1]);
      i += 1;
    } else if (arg === "--thinking" && args[i + 1]) {
      thinking = args[i + 1];
      i += 1;
    } else if (arg === "--model" && args[i + 1]) {
      model = args[i + 1];
      i += 1;
    } else if ((arg === "--mode" || arg === "--service-tier" || arg === "--tier" || arg === "--codex-tier") && args[i + 1]) {
      serviceTier = args[i + 1];
      i += 1;
    } else if (arg === "--fast") {
      serviceTier = "fast";
    } else if (arg === "--cheap") {
      serviceTier = "cheap";
    } else if (arg === "--normal-mode") {
      serviceTier = "normal";
    } else if (arg === "--profile" && args[i + 1]) {
      profile = args[i + 1];
      i += 1;
    } else if (arg === "--theme" && args[i + 1]) {
      terminalTheme = args[i + 1];
      i += 1;
    } else if (arg === "--statusline" || arg === "--status-line") {
      statusLine = args[i + 1] && !args[i + 1].startsWith("-") ? args[i + 1] : "default";
      if (args[i + 1] && !args[i + 1].startsWith("-")) i += 1;
    } else if (arg === "--no-statusline" || arg === "--no-status-line") {
      statusLine = "off";
    } else if (arg === "--notifications" && args[i + 1]) {
      notifications = args[i + 1];
      i += 1;
    } else if ((arg === "--interrupt" || arg === "--interrupt-mode" || arg === "--midrun" || arg === "--mid-run") && args[i + 1]) {
      interruptMode = args[i + 1];
      i += 1;
    } else if (arg === "--websearch" || arg === "--web-search") {
      webSearch = true;
    } else if (arg === "--no-websearch" || arg === "--no-web-search") {
      webSearch = false;
    } else if (arg === "--webfetch" || arg === "--web-fetch") {
      webFetch = true;
    } else if (arg === "--no-webfetch" || arg === "--no-web-fetch") {
      webFetch = false;
    } else if (arg === "--web") {
      const mode = normalizeWebToolsMode(args[i + 1]);
      if (mode) {
        webSearch = mode.webSearch;
        webFetch = mode.webFetch;
        i += 1;
      } else {
        webMenu = true;
      }
    } else if (arg === "--onboarding") {
      forceOnboarding = true;
    } else if (arg === "--no-onboarding") {
      skipOnboarding = true;
    } else if ((arg === "--continue" || arg === "-c")) {
      sessionMode = "continue";
    } else if ((arg === "--thread" || arg === "--session") && args[i + 1]) {
      session = args[i + 1];
      i += 1;
    } else if ((arg === "--resume" || arg === "-r") && args[i + 1] && !args[i + 1].startsWith("-")) {
      session = args[i + 1];
      i += 1;
    } else if (arg === "--resume" || arg === "-r") {
      pickSession = true;
    } else if (arg === "--no-session") {
      noSession = true;
    } else if (arg === "--update") {
      command = "update";
    } else if (arg === "--print" || arg === "-p") {
      printMode = true;
      command = command === "chat" ? "ask" : command;
    } else {
      prompt = prompt ? `${prompt} ${arg}` : arg;
    }
  }

  if (command === "here") {
    command = "chat";
    project = process.env.ZYRA_CALLER_CWD ?? process.cwd();
  }
  if (command === "inspect") {
    prompt = buildInspectPrompt();
  }
  if (command === "continue") {
    command = "chat";
    sessionMode = "continue";
  }
  if (command === "resume") {
    command = "chat";
    if (prompt) {
      session = prompt;
      prompt = "";
    } else {
      pickSession = true;
    }
  }
  if (command === "new") {
    command = "chat";
    sessionMode = "new";
  }
  if (command === "onboarding" || command === "onboard") {
    command = "onboarding";
    forceOnboarding = true;
  }
  if (command === "ask" && !prompt) {
    throw new Error('Usage: zyra ask "your question" or zyra -p "your question"');
  }
  if (!["chat", "ask", "inspect", "doctor", "threads", "sessions", "login", "logout", "auth", "account", "codexusage", "update", "onboarding", "version", "help", "--help", "-h"].includes(command)) {
    prompt = command + (prompt ? ` ${prompt}` : "");
    command = "ask";
  }
  if (printMode && !prompt) {
    throw new Error('Usage: zyra -p "your question"');
  }

  return { command, project, prompt, sessionMode, session, noSession, pickSession, printMode, model, thinking, serviceTier, permissionMode, profile, terminalTheme, statusLine, notifications, interruptMode, webSearch, webFetch, webMenu, forceOnboarding, skipOnboarding };
}

async function runUpdate() {
  if (process.env.ZYRA_DISTRIBUTION === "desktop-bundle") {
    console.log("This Zyra TUI is bundled with Zyra Desktop. Install updates from Desktop Settings → About.");
    return;
  }
  const root = defaults.root;
  const sourceDirectory = String(process.env.ZYRA_UPDATE_SOURCE_DIRECTORY ?? "").trim();
  if (process.platform === "win32") {
    const script = path.join(root, "install.ps1");
    const tempScript = path.join(os.tmpdir(), `zyra-update-${process.pid}.ps1`);
    copyFileSync(script, tempScript);
    process.chdir(os.tmpdir());
    let result;
    try {
      result = spawnSync("powershell.exe", [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        tempScript,
        ...(sourceDirectory ? ["-SourceDirectory", sourceDirectory] : []),
        ...(process.env.ZYRA_UPDATE_NO_PATH_UPDATE === "1" ? ["-NoPathUpdate"] : []),
      ], { stdio: "inherit", cwd: os.tmpdir() });
    } finally {
      rmSync(tempScript, { force: true });
    }
    if (result.error) throw result.error;
    await shutdownCliAnalytics();
    process.exit(result.status ?? 1);
  }

  const script = path.join(root, "install.sh");
  const result = spawnSync("bash", [
    script,
    ...(sourceDirectory ? ["--source-dir", sourceDirectory] : []),
  ], { stdio: "inherit" });
  if (result.error) throw result.error;
  await shutdownCliAnalytics();
  process.exit(result.status ?? 1);
}

function printDoctor(ui) {
  const status = checkSetup();
  ui.banner({
    project: defaults.project,
    mode: "doctor",
    thinking: defaults.thinking,
    model: "not loaded",
  });
  for (const [key, value] of Object.entries(status)) {
    console.log(`${key}: ${value ? "ok" : "missing"}`);
  }
  if (Object.values(status).some((value) => !value)) process.exitCode = 1;
}

async function printSessions(_ui, _project) {
  console.log("Use `zyra resume` to browse chats, or `/chat` inside Zyra for the current chat.");
}

async function runMain() {
  const parsed = parse(process.argv.slice(2));
  captureCliEvent("zyra_v1_cli", {
    action: "startup",
    command: normalizeAnalyticsCommandName(parsed.command),
    outcome: "started",
    session_mode: parsed.noSession ? "none" : parsed.session ? "resume" : parsed.sessionMode === "continue" ? "continue" : "new",
    runtime: useEmbeddedRuntime ? "embedded" : "client",
  });
  if (parsed.command === "version") {
    process.stdout.write(`${formatZyraVersion()}\n`);
    cliStartupCompleted = true;
    captureCliEvent("zyra_v1_cli", { action: "startup", command: "version", outcome: "completed", runtime: useEmbeddedRuntime ? "embedded" : "client" });
    return;
  }

  let ui = createZyraUi();
  cliStartupCompleted = true;
  captureCliEvent("zyra_v1_cli", { action: "startup", outcome: "completed", runtime: useEmbeddedRuntime ? "embedded" : "client" });
  const terminalTitle = createZyraTerminalTitle({ project: parsed.project, state: "ready" });
  process.once("exit", () => terminalTitle.dispose());

  const setTerminalTitleState = (state, runtime) => {
    terminalTitle.update({ state, runtime, project: runtime?.project ?? parsed.project });
  };

  const notifyTerminalIfUnfocused = (runtime) => {
    terminalTitle.notify(runtime?.notifications ?? "unfocused");
  };

  const subscribeRuntimeEvents = (runtime, handler = (event) => ui.event(event)) => {
    runtime.agentServer?.setApprovalHandler?.((request, options) => ui.requestApproval?.(request, options) || "decline");
    runtime.agentServer?.setUserInputHandler?.((request, options) => ui.requestUserInput?.(request, options) || { answers: {}, cancelled: true });
    const forward = (event) => {
      handler(event);
      terminalTitle.fromEvent(event, runtime);
    };
    const unsubscribeSession = runtime.session.subscribe(forward);
    const unsubscribeManagedBash = runtime.managedBash?.subscribe?.((update) => {
      forward({ type: "managed_bash_job_update", ...update });
    });
    const unsubscribeFleet = runtime.fleet?.subscribe?.(({ event, snapshot }) => ui.fleet?.(event, snapshot));
    return () => {
      unsubscribeSession?.();
      unsubscribeManagedBash?.();
      unsubscribeFleet?.();
    };
  };

  if (parsed.command === "help" || parsed.command === "--help" || parsed.command === "-h") {
    ui.commands();
    return;
  }
  if (parsed.command === "doctor") {
    printDoctor(ui);
    return;
  }
  if (parsed.command === "threads" || parsed.command === "sessions") {
    await printSessions(ui, parsed.project);
    return;
  }
  if (parsed.command === "update") {
    await runUpdate();
    return;
  }
  let onboardingResult;
  if (parsed.command === "onboarding") {
    onboardingResult = await runOnboarding({
      root: defaults.dataRoot,
      assetRoot: defaults.root,
      project: parsed.project,
      currentTheme: parsed.terminalTheme,
      webSearch: parsed.webSearch,
      webFetch: parsed.webFetch,
    });
    if (!onboardingResult?.completed) return;
    if (onboardingResult.terminalTheme) parsed.terminalTheme = onboardingResult.terminalTheme;
    if (onboardingResult.webSearch !== undefined) parsed.webSearch = onboardingResult.webSearch;
    if (onboardingResult.webFetch !== undefined) parsed.webFetch = onboardingResult.webFetch;
    if (onboardingResult.model) parsed.model = onboardingResult.model;
    parsed.command = "chat";
    parsed.forceOnboarding = false;
    parsed.sessionMode = "new";
    parsed.session = "";
    parsed.noSession = false;
    ui = createZyraUi({ terminalTheme: parsed.terminalTheme });
  }
  if (parsed.command === "login") {
    const method = normalizeZyraAuthMethod(parsed.prompt || "subscription");
    if (!method) throw new Error("Usage: zyra login subscription | zyra login api");
    if (method === "api") {
      const key = await promptSecret("OpenAI API key");
      console.log("Verifying OpenAI API key...");
      const verification = await configureZyraOpenAIApiKey(key);
      const model = chooseVerifiedApiModel(verification);
      if (!model) throw new Error("The API key is valid, but this account does not expose a supported GPT-5.6 API model.");
      setZyraAuthMethodPreference(parsed.project, method, model);
      console.log(`OpenAI API connected. New chats will use ${model}.`);
    } else {
      console.log("Connecting ChatGPT subscription...");
      await loginZyraAuth("openai-codex");
      const model = setZyraAuthMethodPreference(parsed.project, method);
      console.log(`ChatGPT subscription connected. New chats will use ${model}.`);
    }
    console.log(formatZyraAuthMethodsStatus(await getZyraAuthOverview(undefined, { project: parsed.project })));
    return;
  }
  if (parsed.command === "logout") {
    const method = normalizeZyraAuthMethod(parsed.prompt || "subscription");
    if (!method) throw new Error("Usage: zyra logout subscription | zyra logout api");
    const before = await getZyraAuthOverview(undefined, { project: parsed.project });
    await removeZyraAuth(method);
    const after = await getZyraAuthOverview(undefined, { project: parsed.project });
    const fallback = method === "api" ? "subscription" : "api";
    if (before.active === method && after[fallback]?.configured) {
      const model = setZyraAuthMethodPreference(parsed.project, fallback);
      console.log(`New chats will fall back to ${model}.`);
    }
    console.log(`${method === "api" ? "OpenAI API" : "ChatGPT subscription"} credentials removed. Environment credentials remain active when configured.`);
    console.log(formatZyraAuthMethodsStatus(await getZyraAuthOverview(undefined, { project: parsed.project })));
    return;
  }
  if (parsed.command === "auth" || parsed.command === "account") {
    console.log(formatZyraAuthMethodsStatus(await getZyraAuthOverview(undefined, { project: parsed.project })));
    return;
  }
  if (parsed.command === "codexusage") {
    ui.codexUsage(await fetchCodexUsageStats());
    return;
  }

  if (parsed.pickSession) {
    const sessions = await listCliSessions({ project: parsed.project });
    const selected = await selectSession(sessions);
    if (!selected) return;
    parsed.session = selected;
    const selectedChat = sessions.find((chat) => chat.path === selected);
    if (selectedChat?.project) parsed.project = selectedChat.project;
  }

  if (parsed.webMenu) {
    const selected = await selectWebTools({
      webSearch: parsed.webSearch ?? true,
      webFetch: parsed.webFetch ?? true,
    });
    if (selected) {
      parsed.webSearch = selected.webSearch;
      parsed.webFetch = selected.webFetch;
    }
  }

  if (shouldShowStartupRecommendations(parsed) && shouldRunOnboarding({
    root: defaults.dataRoot,
    force: parsed.forceOnboarding,
    skip: parsed.skipOnboarding,
  })) {
    onboardingResult = await runOnboarding({
      root: defaults.dataRoot,
      assetRoot: defaults.root,
      project: parsed.project,
      currentTheme: parsed.terminalTheme,
      webSearch: parsed.webSearch,
      webFetch: parsed.webFetch,
    });
    if (onboardingResult?.terminalTheme) parsed.terminalTheme = onboardingResult.terminalTheme;
    if (onboardingResult?.webSearch !== undefined) parsed.webSearch = onboardingResult.webSearch;
    if (onboardingResult?.webFetch !== undefined) parsed.webFetch = onboardingResult.webFetch;
    if (onboardingResult?.model) parsed.model = onboardingResult.model;
  }

  const runtimeOptions = {
    project: parsed.project,
    sessionMode: parsed.sessionMode,
    session: parsed.session,
    noSession: parsed.noSession || (parsed.printMode && parsed.sessionMode === "new" && !parsed.session),
    model: parsed.model || undefined,
    thinking: parsed.thinking || undefined,
    codexServiceTier: parsed.serviceTier || undefined,
    permissionMode: parsed.permissionMode,
    profile: parsed.profile || undefined,
    terminalTheme: parsed.terminalTheme || undefined,
    statusLine: parsed.statusLine || undefined,
    notifications: parsed.notifications || undefined,
    interruptMode: parsed.interruptMode || undefined,
    webSearch: parsed.webSearch,
    webFetch: parsed.webFetch,
    requestUserInput: (request, options) => ui.requestUserInput?.(request, options) || { answers: {}, cancelled: true },
  };

  if (parsed.printMode || parsed.prompt) {
    setTerminalTitleState("starting");
    const runtime = await createCliRuntime(runtimeOptions);
    setTerminalTitleState("ready", runtime);
    ui = createZyraUi({ openingTheme: runtime.theme, terminalTheme: runtime.terminalTheme });

    if (parsed.printMode) {
      runtime.agentServer?.setApprovalHandler?.((request, options) => ui.requestApproval?.(request, options) || "decline");
      runtime.agentServer?.setUserInputHandler?.((request, options) => ui.requestUserInput?.(request, options) || { answers: {}, cancelled: true });
      if (runtime.modelFallbackMessage) {
        console.error(runtime.modelFallbackMessage);
      }
      try {
        setTerminalTitleState("thinking", runtime);
        const text = await runZyraPrintPrompt(runtime, parsed.prompt);
        setTerminalTitleState("ready", runtime);
        notifyTerminalIfUnfocused(runtime);
        if (text) process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
      } finally {
        runtime.session.dispose();
      }
      return;
    }

    const unsubscribe = subscribeRuntimeEvents(runtime);
    const status = describeRuntime(runtime);
    ui.banner(status);
    if (runtime.modelFallbackMessage) {
      console.log(runtime.modelFallbackMessage);
    }
    try {
      setTerminalTitleState("thinking", runtime);
      await runZyraPrompt(runtime, parsed.prompt);
      setTerminalTitleState("ready", runtime);
      notifyTerminalIfUnfocused(runtime);
      ui.done();
    } finally {
      unsubscribe?.();
      runtime.session.dispose();
    }
    return;
  }

  setTerminalTitleState("starting");
  const stopStarting = ui.starting("Starting agent");
  let runtime = await createCliRuntime(runtimeOptions).finally(stopStarting);
  setTerminalTitleState("ready", runtime);
  ui.setTheme(runtime.terminalTheme);
  ui.banner(describeRuntime(runtime));
  ui.history?.(runtime.history?.events?.() || []);
  if (useEmbeddedRuntime) startZyraMemoryBackgroundStartup(runtime);
  let unsubscribe = subscribeRuntimeEvents(runtime);
  if (runtime.modelFallbackMessage) {
    ui.info(runtime.modelFallbackMessage);
  }

  let exitRequested = false;
  let restartMode = "";
  let activeRun = false;
  let suppressNextAbortError = false;
  let previewingThemeSuggestion = false;

  const abortActiveRuntime = async () => {
    runtime.managedBash?.abortAll?.();
    runtime.session.abortBash?.();
    await Promise.allSettled([
      runtime.fleet?.cancelAll?.("root turn cancelled"),
      runtime.session.abort?.(),
    ]);
  };

  const replaceRuntime = (nextRuntime) => {
    unsubscribe?.();
    runtime.session.dispose();
    runtime = nextRuntime;
    ui.setTheme(runtime.terminalTheme);
    ui.resetSession(describeRuntime(runtime));
    ui.history?.(runtime.history?.events?.() || []);
    setTerminalTitleState("ready", runtime);
    if (useEmbeddedRuntime) startZyraMemoryBackgroundStartup(runtime);
    unsubscribe = subscribeRuntimeEvents(runtime);
    if (runtime.modelFallbackMessage) ui.info(runtime.modelFallbackMessage);
  };

  const startFreshChat = async () => {
    ui.info("Starting a fresh Zyra chat...");
    setTerminalTitleState("starting", runtime);
    const nextRuntime = await createCliRuntime({
      ...runtimeOptions,
      project: runtime.project,
      sessionMode: "new",
      session: "",
    });
    replaceRuntime(nextRuntime);
  };

  const openChatPicker = async () => {
    const chats = await listCliSessions({ project: runtime.project, allProjects: true });
    const selectedPath = await selectSession(chats, { theme: runtime.terminalTheme });
    if (!selectedPath) return true;
    const selected = chats.find((chat) => chat.path === selectedPath);
    ui.info("Opening the shared chat...");
    setTerminalTitleState("starting", runtime);
    const nextRuntime = await createCliRuntime({
      ...runtimeOptions,
      project: selected?.project || runtime.project,
      sessionMode: "resume",
      session: selectedPath,
      noSession: false,
    });
    replaceRuntime(nextRuntime);
    return true;
  };

  const loadOlderHistory = async () => {
    if (!runtime.history?.loadOlder) {
      ui.info("Older transcript paging is unavailable for this runtime.");
      return true;
    }
    const result = await runtime.history.loadOlder();
    ui.resetSession(describeRuntime(runtime));
    ui.history?.(result.events || []);
    ui.info(result.added > 0
      ? `Loaded ${result.added} earlier transcript events${result.hasOlder ? ". Run /older again for more." : "."}`
      : "No older transcript entries remain.");
    return true;
  };

  const runPromptTurn = async (submission) => {
    const text = getSubmissionText(submission);
    const slashResult = await handleSlash(runtime, ui, text, {
      startFreshChat,
      openChatPicker,
      loadOlderHistory,
      setTerminalTitleState: (state) => setTerminalTitleState(state, runtime),
      notifyTerminalIfUnfocused: () => notifyTerminalIfUnfocused(runtime),
    });
    if (slashResult) {
      restartMode = slashResult === "restart" ? slashResult : "";
      exitRequested = Boolean(restartMode) || isExitInput(text);
      if (restartMode) return "restart";
      return exitRequested;
    }
    setTerminalTitleState("thinking", runtime);
    try {
      await runZyraPrompt(runtime, text, getSubmissionOptions(submission));
    } finally {
      setTerminalTitleState("ready", runtime);
      notifyTerminalIfUnfocused(runtime);
    }
    return false;
  };

  await ui.interactive(async (submission) => {
    try {
      const text = getSubmissionText(submission);
      if (activeRun || runtime.session.isStreaming) {
        if (isHardInterruptInput(text)) {
          suppressNextAbortError = true;
          setTerminalTitleState("stopped", runtime);
          ui.info("Stopping this run.");
          await abortActiveRuntime();
          return false;
        }
        if (text.startsWith("/")) {
          ui.info("Slash commands wait until the active run finishes. Use Escape to stop first.");
          return false;
        }
        const mode = await queueZyraMidRunInput(runtime, text, {
          ...getSubmissionOptions(submission),
          mode: submission?.delivery,
        });
        ui.info(mode === "queue" ? "Queued until this turn finishes." : "Steering queued for the next tool-call boundary.");
        ui.refreshInput?.();
        return false;
      }

      activeRun = true;
      try {
        return await runPromptTurn(submission);
      } catch (error) {
        if (!(suppressNextAbortError && isExpectedAbortError(error)) && !isNetworkRecoveryError(error)) {
          ui.error(error);
        }
      } finally {
        activeRun = false;
        suppressNextAbortError = false;
      }
    } catch (error) {
      ui.error(error);
    }
    return false;
  }, {
    suggestions: (text) => getSlashSuggestions(runtime, text),
    applySuggestion: applySlashSuggestion,
    onSuggestionSelect: (item) => {
      if (item?.kind === "theme" && item.previewTheme) {
        previewingThemeSuggestion = true;
        ui.setTheme(item.previewTheme);
      } else if (previewingThemeSuggestion) {
        previewingThemeSuggestion = false;
        ui.setTheme(runtime.terminalTheme);
      }
    },
    statusLine: (width, state) => renderStatusLine(runtime, width, state),
    isRunActive: () => activeRun || runtime.session.isStreaming,
    shouldEchoUserMessage: () => !activeRun,
    getQueuedMessages: () => getQueuedMessages(runtime),
    onRestoreQueued: (currentText) => {
      const restored = restoreQueuedMessagesToEditorText(runtime, currentText);
      ui.info(restored.count > 0 ? `Restored ${restored.count} queued message${restored.count === 1 ? "" : "s"}.` : "No queued messages to restore.");
      ui.refreshInput?.();
      return restored.text;
    },
    onAbortQueued: async (currentText) => {
      suppressNextAbortError = true;
      setTerminalTitleState("stopped", runtime);
      const restored = restoreQueuedMessagesToEditorText(runtime, currentText);
      ui.info(restored.count > 0 ? `Stopping this run. Restored ${restored.count} queued message${restored.count === 1 ? "" : "s"}.` : "Stopping this run.");
      await abortActiveRuntime();
      ui.refreshInput?.();
      return restored.text;
    },
    starterRecommendations: onboardingResult?.starterPrompt ? [{ prompt: onboardingResult.starterPrompt }] : [],
    project: runtime.project,
    theme: runtime.terminalTheme,
    onTerminalFocusChange: (focused) => terminalTitle.setFocused(focused),
  });
  if (restartMode) {
    await restartZyraProcess(runtime, { mode: restartMode });
    return;
  }
  if (exitRequested) {
    const exitSummary = ui.goodbye(describeRuntime(runtime));
    saveZyraExitSummary(runtime, exitSummary);
  }
  unsubscribe?.();
  runtime.session.dispose();
  terminalTitle.dispose();
}

async function restartZyraProcess(runtime, options = {}) {
  const sessionManager = runtime.session.sessionManager;
  const selector = sessionManager.getSessionId?.() || sessionManager.getSessionFile?.();
  const args = process.env.ZYRA_STANDALONE === "1"
    ? []
    : [path.join(runtime.root, "bin", "zyra.mjs")];
  if (options.mode === "new") {
    args.push("new");
  } else if (selector) {
    args.push("resume", selector);
  } else {
    args.push("new");
  }
  args.push("--project", runtime.project);
  if (runtime.profile) args.push("--profile", runtime.profile);
  const thinking = describeRuntime(runtime).thinking;
  if (thinking) args.push("--thinking", thinking);
  if (runtime.terminalTheme?.name) args.push("--theme", runtime.terminalTheme.name);
  if (runtime.statusLine) args.push("--statusline", runtime.statusLine);
  if (runtime.notifications) args.push("--notifications", runtime.notifications);
  if (runtime.interruptMode) args.push("--interrupt", runtime.interruptMode);
  if (runtime.permissionMode === "full-access") args.push("--full-access");
  if (runtime.permissionMode === "auto-review") args.push("--auto-review");
  if (runtime.permissionMode === "edits-only") args.push("--edits-only");
  if (runtime.permissionMode === "approval-required") args.push("--supervised");
  const codexServiceTier = runtime.codexServiceTierState?.value ?? runtime.codexServiceTier;
  if (codexServiceTier && codexServiceTier !== "default") args.push("--service-tier", codexServiceTier);
  if (runtime.session.model) args.push("--model", `${runtime.session.model.provider}/${runtime.session.model.id}`);
  args.push(runtime.webSearch ? "--websearch" : "--no-websearch");
  args.push(runtime.webFetch ? "--webfetch" : "--no-webfetch");

  runtime.session.dispose();
  prepareStdinForRestart();
  await sleep(35);
  const child = spawn(process.execPath, args, {
    stdio: "inherit",
    cwd: runtime.root,
    env: {
      ...process.env,
      ZYRA_CALLER_CWD: runtime.project,
    },
  });

  const result = await new Promise((resolve) => {
    child.once("error", (error) => resolve({ error, status: 1 }));
    child.once("exit", (status, signal) => resolve({ status, signal }));
  });

  if (result.error) {
    console.error(result.error.message);
    await shutdownCliAnalytics();
    process.exit(1);
  }
  await shutdownCliAnalytics();
  process.exit(result.status ?? 0);
}

function prepareStdinForRestart() {
  if (!process.stdin?.isTTY) return;
  try {
    process.stdin.setRawMode?.(false);
  } catch {
    // Best-effort terminal handoff before spawning the replacement process.
  }
  process.stdin.removeAllListeners?.("keypress");
  process.stdin.removeAllListeners?.("data");
  process.stdin.pause?.();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isExitInput(input) {
  const text = input.trim().toLowerCase();
  return text === "/exit" || text === "/quit" || text === "exit" || text === "quit";
}

function isHardInterruptInput(input) {
  const text = String(input ?? "").trim().toLowerCase();
  return /^(stop|wait|cancel|pause|hold on|nevermind|never mind|wrong|don'?t|do not|abort)\b/.test(text);
}

function getQueuedMessages(runtime) {
  return {
    steering: typeof runtime?.session?.getSteeringMessages === "function" ? [...runtime.session.getSteeringMessages()] : [],
    followUp: typeof runtime?.session?.getFollowUpMessages === "function" ? [...runtime.session.getFollowUpMessages()] : [],
  };
}

function restoreQueuedMessagesToEditorText(runtime, currentText = "") {
  const cleared = typeof runtime?.session?.clearQueue === "function"
    ? runtime.session.clearQueue()
    : { steering: [], followUp: [] };
  const queued = [...(cleared.steering ?? []), ...(cleared.followUp ?? [])]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  const existing = String(currentText ?? "").trim();
  return {
    count: queued.length,
    text: [...queued, existing].filter(Boolean).join("\n\n"),
  };
}

function isExpectedAbortError(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /\babort(?:ed)?\b|cancel(?:led|ed)?/i.test(message);
}

function shouldShowStartupRecommendations(parsed) {
  return parsed.command === "chat" && parsed.sessionMode === "new" && !parsed.session && !parsed.prompt;
}

function getSubmissionText(submission) {
  if (typeof submission === "string") return submission;
  return String(submission?.text ?? "");
}

function getSubmissionOptions(submission) {
  if (!submission || typeof submission === "string") return {};
  return {
    images: Array.isArray(submission.images) ? submission.images : undefined,
  };
}

async function main() {
  void initializeCliAnalytics();
  try {
    await runMain();
  } catch (error) {
    if (!cliStartupCompleted) captureCliEvent("zyra_v1_cli", { action: "startup", outcome: "failed", error_code: classifyErrorCode(error) });
    throw error;
  } finally {
    await shutdownCliAnalytics();
  }
}

main().catch((error) => {
  const ui = createZyraUi();
  ui.error(error);
  process.exitCode = 1;
});
