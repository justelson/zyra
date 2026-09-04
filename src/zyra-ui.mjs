import { stdout as defaultOutput } from "node:process";
import { readFileSync } from "node:fs";
import os from "node:os";
import { ZyraComponentHost } from "./tui/component-host.mjs";
import { selectInterruptMode as selectInterruptModePicker } from "./interrupt-mode-picker.mjs";
import {
  createChoiceDialog,
  createCodexResetConfirmationDialog,
  createCodexResetSelectionDialog,
} from "./codex-reset-picker.mjs";
import { selectWebTools } from "./web-tools-picker.mjs";
import { promptSecret as promptSecretInput } from "./secret-input.mjs";
import { normalizeAgentSurfaceTool } from "./agent-surface.mjs";
import { classifyRecoveryError } from "./network-recovery.mjs";
import { normalizeToolFileChangeState } from "./file-change-lifecycle.mjs";
import { createRequestUserInputDialog } from "./request-user-input-dialog.mjs";
import { UserMessageComponent, AssistantMessageComponent, CheckedCommandsComponent, StoppedCommandsComponent, ToolMessageComponent } from "./tui/components/message-components.mjs";
import { SubagentMessageComponent } from "./tui/components/subagent-message.mjs";
import { WorkflowMessageComponent } from "./tui/components/workflow-message.mjs";
import { AgentDockComponent } from "./tui/components/agent-dock.mjs";
import { createAgentManagerDialog } from "./tui/components/agent-manager.mjs";
import { createWorkflowManagerDialog } from "./tui/components/workflow-manager.mjs";
import {
  accountPanel,
  codexUsagePanel,
  commandsPanel,
  errorPanel,
  infoPanel,
  LinesPanelComponent,
  memoryPanel,
  progressPanel,
  retryPanel,
  sessionInfoPanel,
  statusPanel,
} from "./tui/components/static-panels.mjs";
import { runTerminalInputLoop } from "./terminal-input.mjs";
import { applyTerminalTheme, buildTerminalTheme } from "./terminal-theme.mjs";
import { zyraLogoRows } from "./zyra-logo.mjs";

const bold = "\x1b[1m";
const reset = "\x1b[0m";
const fallbackTheme = buildTerminalTheme();
const TERMINAL_TOOL_TOMBSTONE_LIMIT = 500;
const outroMessages = loadJson("./outro-messages.json", {
  sessionComplete: ["another great coding session complete... or not, who knows"],
  closingNote: ["The work will still be here when you come back."],
});

class QuestionHandoffInputComponent {
  constructor(questionComponent, composerComponent) {
    this.key = `question-handoff-${questionComponent.key}`;
    this.questionComponent = questionComponent;
    this.composerComponent = composerComponent;
    this.focus = "questions";
  }

  setHost(host) {
    this.host = host;
    this.questionComponent.setHost?.(host);
    this.composerComponent.setHost?.(host);
  }

  handleInput(data) {
    if (data === "\t" || data === "\x1b[Z") {
      this.focus = this.focus === "questions" ? "composer" : "questions";
      this.host?.invalidate({ fixedOnly: true, force: true });
      return;
    }
    const target = this.focus === "questions" ? this.questionComponent : this.composerComponent;
    target.handleInput?.(data);
  }

  handleKeypress(str, key) {
    this.handleInput(key?.sequence ?? str ?? "");
  }

  render(width) {
    const questions = this.questionComponent.render?.(width) || [];
    const composer = this.composerComponent.render?.(width) || [];
    const focusHint = this.focus === "questions"
      ? `${fallbackTheme.accent}Questions active${reset}${fallbackTheme.dimMuted} • tab to write another message${reset}`
      : `${fallbackTheme.accent}Composer active${reset}${fallbackTheme.dimMuted} • tab to answer questions${reset}`;
    return [...questions, focusHint, ...composer];
  }

  cursorPosition(width) {
    if (this.focus !== "composer") return undefined;
    const cursor = this.composerComponent.cursorPosition?.(width);
    if (!cursor) return undefined;
    const questionRows = (this.questionComponent.render?.(width) || []).length + 1;
    return { ...cursor, row: Number(cursor.row || 0) + questionRows };
  }

  setTheme(theme) { this.composerComponent.setTheme?.(theme); }
  setInputLocked(value) { this.composerComponent.setInputLocked?.(value); }
  setWaiting(value) { this.composerComponent.setWaiting?.(value); }
  tickBusy() { this.composerComponent.tickBusy?.(); }
  resetSession() { this.composerComponent.resetSession?.(); }
  setText(value) { this.composerComponent.setText?.(value); }
  getText() { return this.composerComponent.getText?.() || ""; }
  dispose() {}
}

export async function runZyraInputDialog(host, dialog, options = {}) {
  const previousInput = host?.inputComponent;
  if (!previousInput || !dialog?.component || !dialog?.result) return null;
  const preserveComposer = options.preserveComposer === true;
  const activeComponent = preserveComposer
    ? new QuestionHandoffInputComponent(dialog.component, previousInput)
    : dialog.component;
  if (!preserveComposer) previousInput.setInputLocked?.(true);
  host.setInputComponent(activeComponent);
  try {
    return await dialog.result;
  } finally {
    dialog.component.dispose?.();
    activeComponent.dispose?.();
    if (host.inputComponent === activeComponent) host.setInputComponent(previousInput);
    if (!preserveComposer) previousInput.setInputLocked?.(false);
    host.markContentDirty();
    host.invalidate({ force: true });
  }
}

export function createZyraUi(options = {}) {
  const output = options.output ?? defaultOutput;
  const theme = buildTerminalTheme(options.terminalTheme ?? options.theme);
  const host = new ZyraComponentHost({ output });
  const assistantLifecycle = new AssistantMessageLifecycle();
  const activeTools = new Map();
  const terminalTools = new Map();
  const managedBashToolIds = new Map();
  const managedBashPollTargets = new Map();
  const checkedCommandIds = new Set();
  const checkedCommands = [];
  const stoppedCommandIds = new Set();
  const stoppedCommands = [];
  let checkedCommandsComponent = null;
  let stoppedCommandsComponent = null;
  let anonymousToolSequence = 0;
  let activeAssistantComponent = null;
  let activeAssistantKey = "";
  let activeProgress = null;
  let activeRetryComponent = null;
  let activeRetryKind = null;
  let pendingAssistantCommit = null;
  let assistantDividerPending = false;
  let isBusy = false;
  let suppressWorking = false;
  let activityLabel = "";
  let forcedActivityLabel = "";
  let inputActive = false;
  const committedAssistantIds = new Set();
  const committedAssistantKeys = new Set();
  const recentlyEchoedUserMessages = [];
  const suppressedUserMessages = [];
  const agentTimelineComponents = new Map();
  const workflowTimelineComponents = new Map();
  let fleetSnapshot = null;
  const agentDock = new AgentDockComponent({
    theme,
    getSnapshot: () => fleetSnapshot,
    onInspect: () => {
      host.focusEditor();
      const input = host.inputComponent;
      input?.setText?.("/agents");
      void input?.handleKeypress?.("", { name: "return" });
    },
  });

  const resetInteractiveState = () => {
    assistantLifecycle.reset();
    activeTools.clear();
    terminalTools.clear();
    managedBashToolIds.clear();
    managedBashPollTargets.clear();
    checkedCommandIds.clear();
    checkedCommands.length = 0;
    stoppedCommandIds.clear();
    stoppedCommands.length = 0;
    checkedCommandsComponent = null;
    stoppedCommandsComponent = null;
    anonymousToolSequence = 0;
    activeAssistantComponent = null;
    activeAssistantKey = "";
    activeProgress = null;
    activeRetryComponent = null;
    activeRetryKind = null;
    pendingAssistantCommit = null;
    assistantDividerPending = false;
    isBusy = false;
    suppressWorking = false;
    activityLabel = "";
    forcedActivityLabel = "";
    committedAssistantIds.clear();
    committedAssistantKeys.clear();
    recentlyEchoedUserMessages.length = 0;
    suppressedUserMessages.length = 0;
    agentTimelineComponents.clear();
    workflowTimelineComponents.clear();
    fleetSnapshot = null;
    host.removeAuxiliaryComponent("agent-dock");
  };

  const writeLines = (lines = []) => {
    const text = (Array.isArray(lines) ? lines : String(lines ?? "").split(/\r?\n/)).join("\n");
    if (text) output.write(text.endsWith("\n") ? text : `${text}\n`);
  };

  const appendPanel = (component) => {
    component?.setHost?.(host);
    host.components.push(component);
    host.markContentDirty();
    if (inputActive) {
      host.invalidate();
      return;
    }
    writeLines(component.render(host.width()));
    host.markRendered();
  };

  const appendLines = (lines) => {
    appendPanel(new LinesPanelComponent(`lines-${Date.now()}-${Math.random()}`, lines));
  };

  const setAssistantComponentContent = (content, options = {}) => {
    if (!hasAssistantContent(content)) return;
    if (!activeAssistantComponent) {
      activeAssistantKey = `assistant-${assistantMessageIdentity(options.message) || Date.now()}`;
      activeAssistantComponent = new AssistantMessageComponent(activeAssistantKey, content, theme, {
        showDivider: options.showDivider ?? assistantDividerPending,
      });
      assistantDividerPending = false;
      if (inputActive) host.append(activeAssistantComponent);
    }
    activeAssistantComponent.setContent(content, options);
  };

  const commitAssistant = (message, content, options = {}) => {
    if (!hasAssistantContent(content)) return;
    const id = assistantMessageIdentity(message);
    const key = assistantContentKey(content);

    if (inputActive) {
      if (id && committedAssistantIds.has(id) && committedAssistantKeys.has(key)) return;
      if (id) committedAssistantIds.add(id);
      committedAssistantKeys.add(key);
      setAssistantComponentContent(content, { final: true, message, showDivider: options.showDivider });
    } else {
      pendingAssistantCommit = { id, key, content, showDivider: options.showDivider, historical: options.historical === true };
    }
  };

  const flushAssistantCommit = () => {
    const pending = pendingAssistantCommit;
    pendingAssistantCommit = null;
    if (!pending?.content || !pending.key) return;
    if ((pending.id && committedAssistantIds.has(pending.id)) || committedAssistantKeys.has(pending.key)) return;
    if (pending.id) committedAssistantIds.add(pending.id);
    committedAssistantKeys.add(pending.key);
    const component = new AssistantMessageComponent(`assistant-committed-${pending.id || Date.now()}`, pending.content, theme, {
      showDivider: pending.showDivider === true,
    });
    if (pending.historical) host.append(component);
    else host.printLines(component.render(host.width()));
  };

  const setActivityLabel = (label = "") => {
    activityLabel = forcedActivityLabel || String(label ?? "");
  };

  const resetCommandSummaries = () => {
    checkedCommandIds.clear();
    checkedCommands.length = 0;
    stoppedCommandIds.clear();
    stoppedCommands.length = 0;
    checkedCommandsComponent = null;
    stoppedCommandsComponent = null;
  };

  const recordCheckedCommand = (toolState = {}) => {
    const toolCallId = String(toolState.toolCallId ?? toolState.id ?? toolEventSignature(toolState) ?? checkedCommands.length);
    if (checkedCommandIds.has(toolCallId)) return;
    checkedCommandIds.add(toolCallId);
    checkedCommands.push(commandTextFromTool(toolState));
    if (!checkedCommandsComponent) {
      checkedCommandsComponent = new CheckedCommandsComponent(`checked-commands-${Date.now()}-${Math.random()}`, checkedCommands, theme);
      if (inputActive) host.append(checkedCommandsComponent);
      return;
    }
    checkedCommandsComponent.update(checkedCommands);
  };

  const recordStoppedCommand = (toolState = {}) => {
    const toolCallId = String(toolState.toolCallId ?? toolState.id ?? toolEventSignature(toolState) ?? stoppedCommands.length);
    if (stoppedCommandIds.has(toolCallId)) return;
    stoppedCommandIds.add(toolCallId);
    stoppedCommands.push(commandTextFromTool(toolState));
    if (!stoppedCommandsComponent) {
      stoppedCommandsComponent = new StoppedCommandsComponent(`stopped-commands-${Date.now()}-${Math.random()}`, stoppedCommands, theme);
      if (inputActive) host.append(stoppedCommandsComponent);
      return;
    }
    stoppedCommandsComponent.update(stoppedCommands);
  };

  const flushNonInteractiveCommandSummaries = () => {
    if (inputActive) return;
    if (checkedCommandsComponent) host.printLines(checkedCommandsComponent.render(host.width()));
    if (stoppedCommandsComponent) host.printLines(stoppedCommandsComponent.render(host.width()));
  };

  const appendUserMessage = (text, options = {}) => {
    const normalized = normalizeUserMessageText(text);
    const imageAttachments = Array.isArray(options.imageAttachments) ? options.imageAttachments.filter(Boolean) : [];
    if (!normalized && imageAttachments.length === 0) return;
    if (normalized && !options.force && consumeSuppressedUserMessage(normalized)) return;
    if (!options.force && consumeRecentlyEchoedUserMessage(normalized, imageAttachments)) return;
    host.append(new UserMessageComponent(`user-${Date.now()}-${Math.random()}`, normalized, theme, { imageAttachments }));
  };

  const rememberEchoedUserMessage = (text, imageAttachments = []) => {
    const key = userMessageEchoKey(text, imageAttachments);
    if (!key) return;
    recentlyEchoedUserMessages.push(key);
    if (recentlyEchoedUserMessages.length > 12) recentlyEchoedUserMessages.shift();
  };

  const consumeRecentlyEchoedUserMessage = (text, imageAttachments = []) => {
    const key = userMessageEchoKey(text, imageAttachments);
    if (!key) return false;
    const index = recentlyEchoedUserMessages.findIndex((item) => item === key);
    if (index < 0) return false;
    recentlyEchoedUserMessages.splice(index, 1);
    return true;
  };

  const queueSuppressedUserMessage = (text) => {
    const normalized = normalizeUserMessageText(text);
    if (!normalized) return;
    suppressedUserMessages.push(normalized);
    if (suppressedUserMessages.length > 12) suppressedUserMessages.shift();
  };

  const consumeSuppressedUserMessage = (text) => {
    const normalized = normalizeUserMessageText(text);
    const index = suppressedUserMessages.findIndex((item) => item === normalized);
    if (index < 0) return false;
    suppressedUserMessages.splice(index, 1);
    return true;
  };

  const withActivityLabel = async (label, task) => {
    const previous = forcedActivityLabel;
    forcedActivityLabel = String(label ?? "").trim();
    setActivityLabel(forcedActivityLabel);
    suppressWorking = false;
    host.invalidate();
    try {
      return await task();
    } finally {
      forcedActivityLabel = previous;
      setActivityLabel("");
      host.invalidate();
    }
  };

  const beginAssistant = (message, options = {}) => {
    suppressWorking = false;
    assistantDividerPending = options.showDivider === true;
    setActivityLabel("thinking");
    assistantLifecycle.start(message);
    activeAssistantComponent = null;
    activeAssistantKey = "";
    host.invalidate();
  };

  const streamAssistantEvent = (event) => {
    const content = assistantLifecycle.update(event);
    setActivityLabel(activityFromAssistantEvent(event));
    if (inputActive) {
      setAssistantComponentContent(content, { message: event.message });
    }
    if (activeProgress) {
      updateProgressBox({
        done: false,
        label: "writing",
        detail: "turning the scan into the start note",
        percent: Math.max(activeProgress.percent, 88),
      });
    } else {
      host.invalidate();
    }
  };

  const finishAssistant = (message, options = {}) => {
    setActivityLabel("writing");
    suppressWorking = true;
    const finalContent = assistantLifecycle.end(message);
    if (!finalContent) {
      host.invalidate();
      return;
    }
    if (activeProgress) activeProgress.done = true;
    commitAssistant(message, finalContent, {
      historical: options.historical === true,
      showDivider: options.showDivider ?? assistantDividerPending,
    });
  };

  const rememberTerminalTool = (toolCallId, tool) => {
    terminalTools.set(toolCallId, tool);
    while (terminalTools.size > TERMINAL_TOOL_TOMBSTONE_LIMIT) {
      terminalTools.delete(terminalTools.keys().next().value);
    }
  };

  const updateTool = (event, requestedState) => {
    const jobId = managedBashJobId(event);
    const controlEvent = isManagedBashControlEvent(event);
    const explicitToolCallId = event.toolCallId ?? event.id;
    const previousPollTarget = explicitToolCallId ? managedBashPollTargets.get(String(explicitToolCallId)) : undefined;
    const jobTarget = controlEvent && jobId ? managedBashToolIds.get(jobId) : undefined;
    const correlatedToolCallId = previousPollTarget ?? jobTarget;
    const toolCallId = correlatedToolCallId ?? resolveToolCallId(event, requestedState);
    if (controlEvent && explicitToolCallId && correlatedToolCallId) {
      rememberManagedBashTool(String(explicitToolCallId), correlatedToolCallId, managedBashPollTargets);
    }
    if (terminalTools.has(toolCallId)) return;

    const current = activeTools.get(toolCallId) ?? {};
    const eventArgs = event.args ?? event.arguments;
    const next = {
      ...current,
      ...event,
      state: requestedState,
      toolCallId,
      toolName: event.toolName ?? event.name ?? current.toolName ?? "tool",
      args: controlEvent && current.args ? current.args : eventArgs ?? current.args,
      result: event.result ?? event.partialResult ?? current.result,
      isError: event.isError ?? requestedState === "error",
      startedAt: current.startedAt ?? event.startedAt ?? event.started_at ?? Date.now(),
    };
    next.surface = normalizeAgentSurfaceTool(next);
    const state = toolStateFromLifecycle(next.surface.lifecycle, requestedState);
    next.state = state;
    next.isError = next.surface.lifecycle === "failed";
    next.endedAt = state === "running"
      ? current.endedAt
      : event.endedAt ?? event.completedAt ?? event.ended_at ?? Date.now();
    next.toolLifecyclePhase = next.surface.phase
      ?? (event.type === "tool_execution_start" ? "start" : event.type === "tool_execution_update" ? "update" : "end");
    if (jobId) rememberManagedBashTool(jobId, toolCallId, managedBashToolIds);
    const fileChange = normalizeToolFileChangeState(next);
    if (fileChange) next.fileChange = fileChange;

    if (String(next.toolName || "").toLowerCase().replace(/[^a-z0-9]+/g, "") === "requestuserinput") {
      activeTools.delete(toolCallId);
      return;
    }

    const checkCommand = isCheckCommandTool(next);
    const completedCheck = checkCommand && next.surface.lifecycle === "completed" && !next.historical;
    const stoppedCommand = next.surface.kind === "command" && next.surface.lifecycle === "stopped";
    if (activeProgress) {
      if (completedCheck) recordCheckedCommand(next);
      if (stoppedCommand) recordStoppedCommand(next);
      if (!checkCommand) updateProgressBox(progressPatchFromTool(activeProgress, next, state));
      if (state !== "running") rememberTerminalTool(toolCallId, next);
      return;
    }

    const key = `tool-${toolCallId}`;
    let component = activeTools.get(toolCallId)?.component;
    if (!component) {
      component = new ToolMessageComponent(key, next, theme);
      if (inputActive && !checkCommand && !stoppedCommand) host.append(component);
    }
    component.update(next);

    if (state === "running") {
      activeTools.set(toolCallId, { ...next, component });
      suppressWorking = false;
      setActivityLabel(activityFromActiveTools(activeTools));
      if (!inputActive) {
        // Non-interactive turns keep running tool rows out of stdout until they finish.
        return;
      }
      host.invalidate({ force: next.toolLifecyclePhase === "start" && !controlEvent });
      return;
    }

    activeTools.delete(toolCallId);
    rememberTerminalTool(toolCallId, { ...next, component });
    setActivityLabel(activeTools.size > 0 ? activityFromActiveTools(activeTools) : "thinking");
    if (completedCheck) {
      host.remove(key);
      recordCheckedCommand(next);
      if (inputActive) host.invalidate();
      return;
    }
    if (stoppedCommand) {
      if ((inputActive || next.historical) && !component.host) host.append(component);
      if (!inputActive && !next.historical) host.printLines(component.render(host.width()));
      recordStoppedCommand(next);
      if (inputActive) host.invalidate();
      return;
    }
    if ((inputActive || next.historical) && !component.host) host.append(component);
    if (!inputActive && !next.historical) host.printLines(component.render(host.width()));
    else host.invalidate();
  };

  const resolveToolCallId = (event, state) => {
    const explicitId = event.toolCallId ?? event.id;
    if (explicitId) return String(explicitId);

    const toolName = event.toolName ?? event.name ?? "tool";
    if (event.type !== "tool_execution_start" || state !== "running") {
      const signature = toolEventSignature(event);
      const activeCandidates = [...activeTools.entries()].filter(([, tool]) => sameToolName(tool, toolName));
      const activeMatch = activeCandidates.find(([, tool]) => signature && toolEventSignature(tool) === signature);
      if (activeMatch) return activeMatch[0];
      if (activeCandidates.length === 1) return activeCandidates[0][0];

      const terminalCandidates = [...terminalTools.entries()].filter(([, tool]) => sameToolName(tool, toolName));
      const terminalMatch = terminalCandidates.findLast(([, tool]) => signature && toolEventSignature(tool) === signature);
      if (terminalMatch) return terminalMatch[0];
      if (terminalCandidates.length === 1) return terminalCandidates[0][0];
    }

    const anonymousId = `${toolName}:${anonymousToolSequence}`;
    anonymousToolSequence += 1;
    return anonymousId;
  };

  const beginProgressBox = (title = "Working", options = {}) => {
    activeProgress = {
      title,
      label: options.label ?? "starting",
      detail: options.detail ?? "preparing",
      percent: options.percent ?? 4,
      toolCount: 0,
      toolIds: new Set(),
      done: false,
    };
    setActivityLabel(title.toLowerCase());
    suppressWorking = false;
    renderProgressComponent();
  };

  const updateProgressBox = (next = {}) => {
    if (!activeProgress) return;
    activeProgress = {
      ...activeProgress,
      ...next,
      percent: clamp(Number(next.percent ?? activeProgress.percent) || 0, 0, 100),
    };
    renderProgressComponent();
  };

  const finishProgressBox = () => {
    if (!activeProgress) return;
    activeProgress = null;
    host.remove("progress");
    host.invalidate();
  };

  const renderProgressComponent = () => {
    if (!activeProgress) return;
    if (inputActive) {
      const existing = host.components.find((component) => component.key === "progress");
      const lines = progressPanel(activeProgress, theme, host.width()).render(host.width());
      if (existing?.setLines) existing.setLines(lines);
      else host.append(new LinesPanelComponent("progress", lines));
    }
  };

  return {
    banner(status = {}) {
      appendPanel(new StartupBannerComponent(status, { ...options, theme }));
    },
    resetSession(status = {}) {
      resetInteractiveState();
      host.inputComponent?.resetSession?.();
      const banner = new StartupBannerComponent(status, { ...options, theme });
      host.replaceComponents([banner], { clear: true });
    },
    commands() {
      appendPanel(commandsPanel(theme, host.width()));
    },
    status(status) {
      appendPanel(statusPanel(status, theme, host.width()));
    },
    account(account) {
      appendPanel(accountPanel(account, theme, host.width()));
    },
    codexUsage(stats) {
      appendPanel(codexUsagePanel(stats, theme, host.width()));
    },
    starting(label = "Starting agent") {
      let stopped = false;
      const width = () => Math.max(24, (output.columns ?? 100) - 1);
      const text = `${theme.accent}~${reset} ${theme.muted}${label}...${reset}`;
      output.write("\n");
      output.write(`\r${padDisplay(text, width())}`);
      return () => {
        if (stopped) return;
        stopped = true;
        output.write(`\r${" ".repeat(width())}\r`);
      };
    },
    beginProgress(title, options) {
      beginProgressBox(title, options);
    },
    updateProgress(next = {}) {
      updateProgressBox(next);
    },
    endProgress() {
      finishProgressBox();
    },
    memory(status) {
      appendPanel(memoryPanel(status, theme));
    },
    sessionInfo(info = {}) {
      appendPanel(sessionInfoPanel(info, theme));
    },
    fleet(event, snapshot) {
      fleetSnapshot = snapshot;
      host.setAuxiliaryComponent("agent-dock", agentDock);
      agentDock.update();
      const agentRunId = event?.agentRunId;
      if (agentRunId) {
        const run = snapshot?.agents?.[agentRunId];
        if (run) {
          let component = agentTimelineComponents.get(agentRunId);
          if (!component && event.type === "agent.created") {
            component = new SubagentMessageComponent(`agent-${agentRunId}`, run, theme);
            agentTimelineComponents.set(agentRunId, component);
            host.append(component);
          } else component?.update(run);
        }
      }
      const workflowRunId = event?.workflowRunId;
      if (workflowRunId) {
        const run = snapshot?.workflows?.[workflowRunId];
        if (run) {
          const agents = (run.agentRunIds ?? []).map((id) => snapshot.agents?.[id]).filter(Boolean);
          let component = workflowTimelineComponents.get(workflowRunId);
          if (!component && event.type === "workflow.created") {
            component = new WorkflowMessageComponent(`workflow-${workflowRunId}`, run, agents, theme);
            workflowTimelineComponents.set(workflowRunId, component);
            host.append(component);
          } else component?.update(run, agents);
        }
      }
      host.invalidate();
    },
    async openAgents(controller) {
      return runZyraInputDialog(host, createAgentManagerDialog(controller, { theme }));
    },
    async openWorkflows(workflows) {
      return runZyraInputDialog(host, createWorkflowManagerDialog(workflows, { theme }));
    },
    history(events = []) {
      for (const event of events) this.event(event);
      if (events.length === 0) appendPanel(infoPanel("This chat has no stored transcript entries.", theme));
    },
    event(event) {
      if (event.type === "history_error") {
        appendPanel(errorPanel(event.errorMessage || "Stored chat error", theme));
        return;
      }
      if (event.type === "turn_start") {
        resetCommandSummaries();
        isBusy = true;
        suppressWorking = false;
        setActivityLabel("thinking");
        host.invalidate();
      }
      if (event.type === "queue_update") {
        host.invalidate();
        return;
      }
      if (event.type === "message_start" && event.message?.role === "user") {
        const content = extractUserMessageContent(event.message);
        appendUserMessage(content.text, { imageAttachments: content.imageAttachments });
      }
      if (event.type === "message_start" && event.message?.role === "assistant") beginAssistant(event.message, { showDivider: false });
      if (event.type === "message_update" && event.message?.role === "assistant") {
        streamAssistantEvent(event);
        return;
      }
      if (event.type === "managed_bash_job_update") {
        const managedEvent = managedBashUpdateToolEvent(event);
        updateTool(managedEvent, event.status === "running" ? "running" : event.status === "failed" ? "error" : event.status === "stopped" ? "stopped" : "done");
        return;
      }
      if (event.type === "tool_execution_start") updateTool(event, "running");
      if (event.type === "tool_execution_update") updateTool(event, "running");
      if (event.type === "tool_execution_end") updateTool(event, event.isError ? "error" : "done");
      if (event.type === "message_end" && event.message?.role === "assistant") {
        finishAssistant(event.message, {
          historical: event.historical === true,
          showDivider: event.historical !== true && isFinalAssistantResponse(event.message),
        });
        if (event.historical === true) {
          flushAssistantCommit();
          activeAssistantComponent = null;
          activeAssistantKey = "";
        }
      }
      if (event.type === "turn_end") {
        flushNonInteractiveCommandSummaries();
        flushAssistantCommit();
        suppressWorking = false;
        setActivityLabel(activityFromActiveTools(activeTools));
        activeAssistantComponent = null;
        activeAssistantKey = "";
        host.invalidate();
      }
      if (event.type === "agent_end" && event.willRetry !== true) {
        flushNonInteractiveCommandSummaries();
        flushAssistantCommit();
        isBusy = false;
        suppressWorking = false;
        setActivityLabel("");
        activeAssistantComponent = null;
        activeAssistantKey = "";
        host.invalidate();
      }
      if (event.type === "auto_retry_start") {
        activeRetryKind = event.recoveryKind || classifyRecoveryError(event.errorMessage);
        const nextRetry = retryPanel({ ...event, recoveryKind: activeRetryKind }, theme, host.width());
        setActivityLabel("retrying");
        if (activeRetryComponent) activeRetryComponent.setLines(nextRetry.lines);
        else {
          activeRetryComponent = nextRetry;
          appendPanel(activeRetryComponent);
        }
      }
      if (event.type === "auto_retry_end") {
        const recoveryKind = activeRetryKind || event.recoveryKind || classifyRecoveryError(event.finalError);
        const nextRetry = retryPanel({ ...event, recoveryKind }, theme, host.width());
        if (activeRetryComponent) activeRetryComponent.setLines(nextRetry.lines);
        else appendPanel(nextRetry);
        activeRetryComponent = null;
        activeRetryKind = null;
        setActivityLabel(event.success === true && isBusy ? "thinking" : "");
      }
      if (event.type === "compaction_start") {
        setActivityLabel("compacting");
        appendLines([`${theme.warning}compact${reset} ${event.reason}`]);
      }
      if (event.type === "compaction_end") {
        setActivityLabel("");
        if (event.aborted) {
          appendLines([`${theme.warning}compact cancelled${reset} ${event.reason}`]);
        } else if (event.result) {
          appendLines([`${theme.success}compacted${reset} ${event.reason}`]);
        } else {
          const errorText = String(event.errorMessage ?? "Context compaction failed").replace(/\s+/g, " ").trim();
          appendLines([`${theme.error}compact failed${reset} ${errorText}`]);
        }
      }
    },
    error(error) {
      appendPanel(errorPanel(error, theme));
    },
    info(text) {
      appendPanel(infoPanel(text, theme));
    },
    restartTransition(label = "reloading zyra") {
      const text = `${theme.accent}~${reset} ${theme.muted}${String(label ?? "reloading zyra").replace(/\s+/g, " ").trim() || "reloading zyra"}${reset}`;
      host.setInputComponent(new LinesPanelComponent("restart-transition", [`  ${text}`], { persistent: false }));
      host.setFooterComponent(null);
      host.invalidate({ force: true });
    },
    block(lines = []) {
      appendLines(Array.isArray(lines) ? lines : String(lines ?? "").split(/\r?\n/));
    },
    refreshInput() {
      host.invalidate();
    },
    suppressUserMessage(text) {
      queueSuppressedUserMessage(text);
    },
    withActivityLabel(label, task) {
      return withActivityLabel(label, task);
    },
    setTheme(nextTheme) {
      applyTerminalTheme(theme, nextTheme);
      host.inputComponent?.setTheme?.(theme);
      host.invalidate({ force: true });
    },
    async selectWebTools(current) {
      host.inputComponent?.setInputLocked?.(true);
      host.clearRendered();
      try {
        return await selectWebTools(current, { theme, output });
      } finally {
        host.inputComponent?.setInputLocked?.(false);
        host.markContentDirty();
        host.invalidate({ force: true });
      }
    },
    async promptSecret(message) {
      host.inputComponent?.setInputLocked?.(true);
      host.clearRendered();
      try {
        return await promptSecretInput(message, { output });
      } finally {
        host.inputComponent?.setInputLocked?.(false);
        host.markContentDirty();
        host.invalidate({ force: true });
      }
    },
    async selectInterruptMode(current) {
      host.inputComponent?.setInputLocked?.(true);
      host.clearRendered();
      try {
        return await selectInterruptModePicker(current, { theme, output });
      } finally {
        host.inputComponent?.setInputLocked?.(false);
        host.markContentDirty();
        host.invalidate({ force: true });
      }
    },
    async requestUserInput(request = {}, options = {}) {
      if (!inputActive || options.signal?.aborted) return { answers: {}, cancelled: true };
      const dialog = createRequestUserInputDialog(request, { theme });
      if (!dialog) return { answers: {}, cancelled: true };
      const cancel = () => dialog.cancel?.();
      options.signal?.addEventListener?.("abort", cancel, { once: true });
      try {
        const response = (await runZyraInputDialog(host, dialog, { preserveComposer: true })) || { answers: {}, cancelled: true };
        if (!response.cancelled) {
          const count = Array.isArray(request.questions) ? request.questions.length : 0;
          host.printLines([`${theme.success}✓ Answered ${count} ${count === 1 ? "question" : "questions"}${reset}`]);
        }
        return response;
      } finally {
        options.signal?.removeEventListener?.("abort", cancel);
      }
    },
    async requestApproval(request = {}, options = {}) {
      if (!inputActive || options.signal?.aborted) return "decline";
      const command = String(request.command || request.detail || "").replace(/\s+/g, " ").trim();
      const subject = command ? command.slice(0, 180) : String(request.title || "A tool needs approval.");
      const dialog = createChoiceDialog({
        title: String(request.title || "Tool approval"),
        subtitle: subject,
        subtitleTone: "warning",
        items: [
          { value: "decline", label: "Deny", description: "Block this tool call" },
          { value: "acceptOnce", label: "Allow once", description: "Run only this tool call" },
          { value: "acceptForSession", label: "Allow for chat", description: String(request.grantLabel || "Grant this bounded tool scope until the chat closes") },
        ],
        initialIndex: 0,
        help: "↑↓ navigate • enter choose • esc deny",
      }, { theme });
      const cancel = () => dialog.cancel?.();
      options.signal?.addEventListener?.("abort", cancel, { once: true });
      try {
        return (await runZyraInputDialog(host, dialog)) || "decline";
      } finally {
        options.signal?.removeEventListener?.("abort", cancel);
      }
    },
    async selectCodexResetCredit(credits) {
      if (!inputActive) return null;
      return runZyraInputDialog(host, createCodexResetSelectionDialog(credits, { theme }));
    },
    async confirmCodexResetRedemption(credit, warning) {
      if (!inputActive) return null;
      return runZyraInputDialog(host, createCodexResetConfirmationDialog(credit, warning, { theme }));
    },
    themes(themes, activeName) {
      const lines = ["", `${bold}Themes${reset}`];
      for (const item of themes) {
        const active = item.name === activeName ? `${theme.success}*${reset}` : " ";
        const source = item.source ? ` ${theme.muted}${item.source}${reset}` : "";
        lines.push(` ${active} ${theme.primary}${item.name}${reset} ${theme.muted}${item.displayName ?? item.description ?? ""}${reset}${source}`);
      }
      appendLines(lines);
    },
    async interactive(onInput, options = {}) {
      inputActive = true;
      const toolElapsedTimer = setInterval(() => {
        if (!inputActive || activeTools.size === 0) return;
        host.markContentDirty();
        host.invalidate();
      }, 1000);
      try {
        await runTerminalInputLoop(onInput, { ...options, theme }, {
          host,
          getBusy: () => isBusy,
          getActivityLabel: () => activityLabel,
          suppressWorking: () => suppressWorking,
          onUserMessage(text, metadata = {}) {
            rememberEchoedUserMessage(text, metadata.imageAttachments);
            appendUserMessage(text, { force: true, imageAttachments: metadata.imageAttachments });
          },
          onError(error) {
            appendPanel(errorPanel(error, theme));
          },
          onTerminalFocusChange: options.onTerminalFocusChange,
          setRenderers() {},
          clearRenderers() {
            inputActive = false;
          },
        });
      } finally {
        clearInterval(toolElapsedTimer);
      }
    },
    done() {
      appendLines(["", `${theme.muted}done${reset}`]);
    },
    goodbye(status) {
      const sessionComplete = pick(outroMessages.sessionComplete);
      const closingNote = pick(outroMessages.closingNote);
      appendLines(["", `${theme.primary}${sessionComplete}${reset}`, `${theme.muted}small note:${reset} ${closingNote}`]);
      return {
        sessionComplete,
        closingNote,
        technicalLines: [],
        usage: status.usage,
        threadId: status.threadId ?? status.sessionId,
        sessionId: status.sessionId,
        sessionFile: status.sessionFile,
      };
    },
    _host: host,
    _debugBeginInteractiveForTests() {
      inputActive = true;
    },
    _debugEchoUserMessageForTests(text, imageAttachments = []) {
      rememberEchoedUserMessage(text, imageAttachments);
      appendUserMessage(text, { force: true, imageAttachments });
    },
    _debugRenderLinesForTests(width = host.width()) {
      return host.renderLines(width);
    },
    _debugActivityLabelForTests() {
      return activityLabel;
    },
  };
}

class StartupBannerComponent {
  constructor(status = {}, options = {}) {
    this.key = `startup-${Date.now()}`;
    this.status = status;
    this.options = options;
  }

  setHost(host) {
    this.host = host;
  }

  render(width = 100) {
    return renderStartupBanner(this.status, this.options, width);
  }
}

function renderStartupBanner(status = {}, options = {}, width = 100) {
  const theme = options.theme ?? fallbackTheme;
  const maxWidth = Math.max(24, Number(width) || 100);
  const project = status.project ?? options.project ?? process.cwd();
  const model = status.model ?? options.model ?? "loading";
  const profile = status.profile ?? options.profile ?? "";
  const thinking = status.thinking ?? options.thinking ?? "medium";
  const themeName = status.terminalTheme ?? theme.name ?? "theme";
  const projectPath = formatHomePath(project);
  const logo = centeredBlock(zyraLogoRows, maxWidth, `${bold}${theme.primary}`, reset);
  const subtitle = compactJoin([shortModelName(model), profile]);
  const lines = ["", ...logo.rows, ""];

  if (subtitle) {
    lines.push(centerNearBlock(`${theme.info}${subtitle}${reset}`, maxWidth, logo.left, logo.width));
    lines.push("");
  }

  lines.push(
    ...renderStartupSection("Context", contextBannerValues(status, projectPath), theme, maxWidth),
    "",
    ...renderStartupSection("Runtime", [compactJoin([model, thinking])], theme, maxWidth),
    "",
    ...renderStartupSection("Theme", [themeName], theme, maxWidth),
    "",
  );

  return lines;
}

function centeredBlock(rows, width, prefix = "", suffix = "") {
  const blockWidth = Math.max(...rows.map((line) => stripAnsi(line).length), 0);
  const left = Math.max(0, Math.floor((width - blockWidth) / 2));
  const pad = " ".repeat(left);
  return {
    left,
    width: blockWidth,
    rows: rows.map((line) => `${pad}${prefix}${line}${suffix}`),
  };
}

function centerNearBlock(text, width, blockLeft, blockWidth) {
  const value = String(text ?? "");
  const valueWidth = stripAnsi(value).length;
  const left =
    valueWidth <= blockWidth
      ? blockLeft + Math.floor((blockWidth - valueWidth) / 2)
      : Math.floor((width - valueWidth) / 2);
  return `${" ".repeat(Math.max(0, left))}${value}`;
}

function renderStartupSection(label, values, theme, width) {
  const bodyWidth = Math.max(1, width - 2);
  const body = (Array.isArray(values) ? values : [values]).map((value) => String(value ?? "").trim()).filter(Boolean);
  const sectionColor = theme.accent || theme.info || theme.primary || "";
  const lines = [`${sectionColor}[${label}]${reset}`];
  for (const value of body.length ? body : ["none"]) {
    lines.push(`  ${theme.muted}${truncate(value, bodyWidth)}${reset}`);
  }
  return lines;
}

function contextBannerValues(status, projectPath) {
  const memoryFiles = Array.isArray(status.projectMemory)
    ? status.projectMemory.map((file) => String(file ?? "").trim()).filter(Boolean)
    : [];
  return uniqueCompact([...memoryFiles.slice(0, 2), projectPath]);
}

function uniqueCompact(values) {
  const seen = new Set();
  const result = [];
  for (const value of values.map((item) => String(item ?? "").trim()).filter(Boolean)) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function compactJoin(values) {
  return values.map((value) => String(value ?? "").trim()).filter(Boolean).join(" · ");
}

function shortModelName(model) {
  const value = String(model ?? "").trim();
  if (!value) return "";
  return value.split("/").filter(Boolean).at(-1) ?? value;
}

function summarizeTool(event) {
  const args = event.args ?? event.arguments;
  if (!args || typeof args !== "object") return "";
  const path = args.path ?? args.filePath ?? args.cwd ?? args.command ?? args.cmd;
  if (typeof path === "string" && path.length > 0) return truncate(path, 80);
  const keys = Object.keys(args).filter((key) => args[key] !== undefined && args[key] !== null);
  if (keys.length === 0) return "";
  return keys.slice(0, 3).join(", ");
}

function managedBashJobId(event = {}) {
  const args = event.args ?? event.arguments ?? {};
  const result = event.result ?? event.partialResult ?? {};
  const details = result?.details ?? {};
  const value = event.jobId ?? details.jobId ?? args.jobId;
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function isManagedBashControlEvent(event = {}) {
  const toolName = formatToolActivity(event.toolName ?? event.name ?? "");
  const args = event.args ?? event.arguments ?? {};
  const action = String(args.action ?? "").trim().toLowerCase();
  return toolName === "bash" && ["status", "stop"].includes(action) && Boolean(args.jobId);
}

function rememberManagedBashTool(jobId, toolCallId, managedBashToolIds) {
  managedBashToolIds.set(jobId, toolCallId);
  while (managedBashToolIds.size > TERMINAL_TOOL_TOMBSTONE_LIMIT) {
    managedBashToolIds.delete(managedBashToolIds.keys().next().value);
  }
}

function toolStateFromLifecycle(lifecycle, fallback = "running") {
  if (lifecycle === "completed") return "done";
  if (lifecycle === "failed") return "error";
  if (lifecycle === "stopped") return "stopped";
  if (lifecycle === "running") return "running";
  return fallback;
}

function managedBashUpdateToolEvent(event = {}) {
  const status = String(event.status ?? "running").trim().toLowerCase();
  const output = [event.output, event.errorMessage]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join("\n");
  return {
    type: status === "running" ? "tool_execution_update" : "tool_execution_end",
    toolCallId: event.toolCallId,
    toolName: "bash",
    args: { command: event.command },
    result: {
      content: output ? [{ type: "text", text: output }] : [],
      details: { jobId: event.jobId, status, exitCode: event.exitCode },
    },
    startedAt: event.startedAt,
    completedAt: event.completedAt,
    isError: status === "failed",
  };
}

function sameToolName(tool, name) {
  const left = formatToolActivity(tool?.toolName ?? tool?.name ?? "tool");
  const right = formatToolActivity(name ?? "tool");
  return left === right;
}

function toolEventSignature(event = {}) {
  const args = event.args ?? event.arguments;
  if (!args || typeof args !== "object") return "";
  const command = args.command ?? args.cmd;
  if (command) return `command:${String(command)}`;
  const target = args.path ?? args.filePath ?? args.file_path ?? args.targetPath ?? args.target_file ?? args.filename ?? args.cwd;
  if (target) return `target:${String(target)}`;
  return "";
}

function activityFromAssistantEvent(event) {
  const update = event.assistantMessageEvent;
  if (update?.type === "thinking_start" || update?.type === "thinking_delta") return "thinking";
  if (update?.type === "text_start" || update?.type === "text_delta" || hasAssistantContent(extractAssistantContent(event.message?.content))) return "writing";
  if (update?.type === "toolcall_start" || update?.type === "toolcall_delta") return activityFromTool(update);
  return "thinking";
}

function formatToolActivity(value) {
  return String(value ?? "tool").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase() || "tool";
}

function commandTextFromTool(toolState = {}) {
  const args = toolState.args ?? toolState.arguments ?? {};
  const command = typeof args.command === "string" ? args.command : typeof args.cmd === "string" ? args.cmd : "";
  return String(command).replace(/\s+/g, " ").trim() || "command";
}

function isCheckCommandTool(toolState = {}) {
  const command = commandTextFromTool(toolState);
  if (command === "command") return false;
  return /\b(?:test|tests|check|checks|typecheck|lint|build|verify|verification|doctor|audit|tsc|pytest|vitest|jest|eslint)\b/i.test(command);
}

function activityFromActiveTools(activeTools = new Map()) {
  const tools = [...activeTools.values()];
  const checks = tools.filter((tool) => isCheckCommandTool(tool));
  if (checks.length > 0) return checks.length === 1 ? "checking command" : `checking ${checks.length} commands`;
  return tools.length > 0 ? activityFromTool(tools[0]) : "thinking";
}

function activityFromTool(toolState = {}) {
  const rawName = toolState.toolName ?? toolState.name ?? toolState.functionName ?? toolState.type ?? "tool";
  const name = formatToolActivity(rawName);
  const args = toolState.args ?? toolState.arguments ?? {};
  const command = typeof args.command === "string" ? args.command : typeof args.cmd === "string" ? args.cmd : "";
  const value = `${name} ${command}`.toLowerCase();
  if (/\b(web|browser|chrome|navigate|click|screenshot)\b/.test(value)) return "browsing";
  if (/\b(search|find|grep|rg|list|ls|read|get|open|cat|sed|head|tail|view)\b/.test(value)) return "reading files";
  if (/\b(apply patch|patch|edit|write|create|update|replace|move|copy|delete|remove|mkdir)\b/.test(value)) return "editing";
  if (/\b(test|check|typecheck|lint|build|verify|doctor)\b/.test(value)) return "checking";
  if (/\b(exec|command|shell|bash|powershell|cmd|npm|node|bun|pnpm|yarn|git|run)\b/.test(value)) return "running command";
  return name && name !== "tool" ? `using ${name}` : "working";
}

function progressPatchFromTool(progress, toolState, state) {
  if (!toolState || !progress) return {};
  const toolId = toolState.toolCallId ?? toolState.id ?? toolState.toolName ?? "tool";
  const seen = progress.toolIds ?? new Set();
  const firstSeen = !seen.has(toolId);
  seen.add(toolId);
  const toolCount = progress.toolCount + (firstSeen ? 1 : 0);
  const running = state === "running";
  const toolName = formatToolActivity(toolState.toolName);
  const summary = summarizeTool(toolState);
  const percent = running
    ? Math.min(82, Math.max(progress.percent + 3, 12 + toolCount * 12))
    : Math.min(86, Math.max(progress.percent + 5, 20 + toolCount * 13));
  return {
    toolIds: seen,
    toolCount,
    done: false,
    label: running ? `checking ${toolName}` : `checked ${toolName}`,
    detail: summary || "reading project files",
    percent,
  };
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function formatHomePath(value) {
  const text = String(value ?? "");
  const home = os.homedir();
  if (!home) return text;
  if (text.toLowerCase() === home.toLowerCase()) return "~";
  if (text.toLowerCase().startsWith(`${home.toLowerCase()}\\`) || text.toLowerCase().startsWith(`${home.toLowerCase()}/`)) return `~${text.slice(home.length)}`;
  return text;
}

function padDisplay(text, width) {
  const value = String(text);
  return `${value}${" ".repeat(Math.max(0, width - stripAnsi(value).length))}`;
}

function stripAnsi(text) {
  return String(text).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

function pick(values) {
  return values[Math.floor(Math.random() * values.length)] ?? "";
}

function loadJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
  } catch {
    return fallback;
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function emptyAssistantContent() {
  return { thinking: "", text: "", hasThinkingBlock: false };
}

function hasAssistantContent(content) {
  return Boolean(content?.text?.trim());
}

function normalizeAssistantContent(primary, fallback) {
  if (hasAssistantContent(primary)) return primary;
  return fallback;
}

function extractAssistantEventContent(event, current = emptyAssistantContent()) {
  const messageContent = extractAssistantContent(event.message?.content);
  const partialContent = extractAssistantContent(event.assistantMessageEvent?.partial?.content);
  const next = longerAssistantContent(messageContent, partialContent, current);
  if (hasAssistantContent(next) && assistantContentKey(next) !== assistantContentKey(current)) return next;
  const delta = event.assistantMessageEvent;
  if (delta?.type === "text_delta" && typeof delta.delta === "string" && delta.delta.length > 0) {
    return { ...current, text: mergeAssistantTextDelta(current.text, delta.delta) };
  }
  return next;
}

export class AssistantMessageLifecycle {
  constructor() {
    this.open = false;
    this.content = emptyAssistantContent();
    this.lastCommittedKey = "";
  }

  start(message = {}) {
    this.open = true;
    this.content = extractAssistantContent(message.content);
    return this.content;
  }

  update(event = {}) {
    if (!this.open) this.start(event.message ?? {});
    const next = extractAssistantEventContent(event, this.content);
    if (hasAssistantContent(next)) this.content = next;
    return this.content;
  }

  end(message = {}) {
    const finalContent = normalizeAssistantContent(extractAssistantContent(message.content), this.content);
    const finalKey = assistantContentKey(finalContent);
    this.open = false;
    this.content = emptyAssistantContent();
    if (!finalKey || finalKey === this.lastCommittedKey) return null;
    this.lastCommittedKey = finalKey;
    return finalContent;
  }

  hasTransient() {
    return Boolean(this.open && hasAssistantContent(this.content));
  }

  getTransient() {
    return this.content;
  }

  reset() {
    this.open = false;
    this.content = emptyAssistantContent();
    this.lastCommittedKey = "";
  }
}

export function mergeAssistantTextDelta(currentText, deltaText) {
  if (!currentText) return deltaText;
  if (!deltaText) return currentText;
  if (deltaText === currentText || currentText.endsWith(deltaText)) return currentText;
  if (deltaText.startsWith(currentText)) return deltaText;
  const sharedPrefix = commonPrefixLength(currentText, deltaText);
  if (sharedPrefix >= 5 && deltaText.length >= Math.floor(currentText.length * 0.6)) return deltaText;
  if (sharedPrefix >= 12 && deltaText.length >= Math.floor(currentText.length * 0.35)) return deltaText;
  if (currentText.includes(deltaText) && (deltaText.length >= 8 || /\r|\n/.test(deltaText))) return currentText;

  const overlap = suffixPrefixOverlap(currentText, deltaText);
  if (overlap > 0) return `${currentText}${deltaText.slice(overlap)}`;

  return `${currentText}${deltaText}`;
}

function commonPrefixLength(left, right) {
  const max = Math.min(left.length, right.length);
  let index = 0;
  while (index < max && left[index] === right[index]) index += 1;
  return index;
}

function suffixPrefixOverlap(left, right) {
  const max = Math.min(left.length, right.length);
  for (let size = max; size > 0; size -= 1) {
    if (left.slice(-size) === right.slice(0, size)) return size;
  }
  return 0;
}

function longerAssistantContent(...contents) {
  return contents.reduce((best, content) => {
    if (!hasAssistantContent(content)) return best;
    return content.text.length > best.text.length ? content : best;
  }, emptyAssistantContent());
}

function assistantContentKey(content) {
  return content?.text?.trim() ?? "";
}

function assistantMessageIdentity(message = {}) {
  const value = message.id ?? message.messageId ?? message.entryId ?? message.uuid;
  return value ? String(value) : "";
}

function isFinalAssistantResponse(message = {}) {
  const stopReason = String(message.stopReason ?? message.stop_reason ?? "").trim().toLowerCase();
  return stopReason === "stop" || stopReason === "end_turn";
}

function extractUserMessageContent(message = {}) {
  const content = message.content ?? message.text ?? "";
  if (!Array.isArray(content)) {
    return {
      text: normalizeUserMessageText(typeof content === "string" ? content : content?.text),
      imageAttachments: [],
    };
  }
  const text = [];
  const imageAttachments = [];
  for (const part of content) {
    if (part?.type === "text" && part.text) {
      text.push(part.text);
      continue;
    }
    if (part?.type !== "image") continue;
    imageAttachments.push({
      index: imageAttachments.length + 1,
      mimeType: part.mimeType || part.mime_type || "image",
      width: Number(part.width) || undefined,
      height: Number(part.height) || undefined,
    });
  }
  return {
    text: normalizeUserMessageText(text.join("\n")),
    imageAttachments,
  };
}

function normalizeUserMessageText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function userMessageEchoKey(text, imageAttachments = []) {
  const normalized = normalizeUserMessageText(text);
  const imageCount = Array.isArray(imageAttachments) ? imageAttachments.filter(Boolean).length : 0;
  return normalized || imageCount > 0 ? `${normalized}\u0000${imageCount}` : "";
}

export function extractAssistantContent(content) {
  if (typeof content === "string") return { thinking: "", text: content };
  if (!Array.isArray(content)) return emptyAssistantContent();
  const thinking = [];
  const text = [];
  let hasThinkingBlock = false;
  let imageIndex = 0;
  for (const part of content) {
    if (part?.type === "thinking") {
      hasThinkingBlock = true;
      const value = part.thinking ?? part.text ?? "";
      if (value) thinking.push(value);
    } else if (part?.type === "text") {
      const value = part.text ?? "";
      if (value) text.push(value);
    } else if (part?.type === "image") {
      imageIndex += 1;
      text.push(`[Image ${imageIndex}: ${part.mimeType || part.mime_type || "image"}]`);
    }
  }
  return { thinking: thinking.join("\n"), text: text.join("\n"), hasThinkingBlock };
}

export function extractText(content) {
  return extractAssistantContent(content).text;
}
