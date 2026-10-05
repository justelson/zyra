import { Type } from "typebox";
import { DEFAULT_MANAGED_BASH_AUTO_POLL_MS, MANAGED_BASH_BACKGROUND_DESCRIPTION } from "./tool-contracts.mjs";
import { createZyraLocalBashOperations } from "./zyra-shell-operations.mjs";

const DEFAULT_INITIAL_WAIT_MS = 8000;
const DEFAULT_STATUS_WAIT_MS = 5000;
export const DEFAULT_AUTO_POLL_MS = DEFAULT_MANAGED_BASH_AUTO_POLL_MS;
const DEFAULT_MAX_AUTO_POLLS = 20;
const MAX_BUFFER_CHARS = 120000;
const STATUS_OUTPUT_LINES = 80;
const FINAL_OUTPUT_LINES = 2000;
const STATUS_OUTPUT_CHARS = 24000;
const FINAL_OUTPUT_CHARS = 50000;
const LIVE_UPDATE_INTERVAL_MS = 500;
const MAX_RETAINED_TERMINAL_JOBS = 64;

const bashSchema = Type.Object({
  command: Type.Optional(Type.String({ description: "Bash command to execute. Required for action=run." })),
  timeout: Type.Optional(Type.Number({ description: "Timeout in seconds for the command process." })),
  background: Type.Optional(Type.Boolean({ description: MANAGED_BASH_BACKGROUND_DESCRIPTION })),
  action: Type.Optional(Type.Union([
    Type.Literal("run"),
    Type.Literal("status"),
    Type.Literal("stop"),
  ], { description: "run a command, check a running command, or stop a running command." })),
  jobId: Type.Optional(Type.String({ description: "Managed command job id returned by a long-running command." })),
  wait: Type.Optional(Type.Number({ description: "Seconds to wait before returning a running status update." })),
});

export function createManagedBashState() {
  const state = {
    jobs: new Map(),
    listeners: new Set(),
    nextId: 1,
    abortAll(reason = "Command aborted") {
      for (const job of state.jobs.values()) {
        if (!job.completedAt) stopJob(job, reason);
      }
    },
    abortForeground(reason = "Command aborted") {
      return abortManagedBashForegroundJobs(state, reason);
    },
    list(input) {
      return listManagedBashJobs(state, input);
    },
    stop(input) {
      return stopManagedBashJobs(state, input);
    },
    hasAutoPollJobs() {
      return hasManagedBashAutoPollJobs(state);
    },
    subscribe(listener) {
      if (typeof listener !== "function") return () => {};
      state.listeners.add(listener);
      return () => state.listeners.delete(listener);
    },
  };
  return state;
}

export function createManagedBashTool(options = {}) {
  const state = options.state ?? createManagedBashState();
  const operations = options.operations ?? createZyraLocalBashOperations({ shellPath: options.shellPath });
  const commandPrefix = String(options.commandPrefix ?? "");
  const cwd = options.cwd ?? process.cwd();
  const ownerAgentRunId = options.ownerAgentRunId;

  return {
    name: "bash",
    label: "bash",
    description: "Execute a bash command. Use background=true for persistent servers/watchers to return promptly without automatic polling. Any command that yields is adopted as a background job and survives Stop turn. Use action=status to inspect output or action=stop to stop a job.",
    promptSnippet: "Use background=true for intentional persistent servers/watchers. Yielded commands survive Stop turn; inspect job output with action=status and explicitly stop unneeded jobs with action=stop.",
    parameters: bashSchema,
    async execute(toolCallId, input = {}, signal, onUpdate) {
      const action = normalizeAction(input);
      if (action === "status") return statusAction(state, input, signal, ownerAgentRunId);
      if (action === "stop") return stopAction(state, input, ownerAgentRunId);
      return runAction({ state, operations, commandPrefix, cwd, toolCallId, input, signal, onUpdate, ownerAgentRunId });
    },
  };
}

function normalizeAction(input = {}) {
  const action = String(input.action ?? "").trim().toLowerCase();
  if (action === "status" || action === "stop" || action === "run") return action;
  return input.jobId && !input.command ? "status" : "run";
}

async function runAction({ state, operations, commandPrefix, cwd, toolCallId, input, signal, onUpdate, ownerAgentRunId }) {
  const command = String(input.command ?? "").trim();
  if (!command) throw new Error("bash command is required");
  if (signal?.aborted) throw new Error("Command aborted before start");

  pruneRetainedTerminalJobs(state);
  const executionCommand = prepareManagedBashCommand(command);
  const job = startJob({ state, operations, commandPrefix, cwd, command, executionCommand, toolCallId, timeout: input.timeout, onUpdate, background: input.background === true, ownerAgentRunId });
  const waitMs = secondsToMs(input.wait, DEFAULT_INITIAL_WAIT_MS);
  const abortResult = job.background ? { unlink() {} } : linkAbort(signal, job);

  try {
    if (job.persistent) {
      job.onUpdate = undefined;
      return runningJobResult(job, { initial: true });
    }
    const completed = await waitForJob(job, waitMs, signal);
    // A cancelled foreground invocation must wait for verified cleanup, not adopt
    // a process merely because its abort signal won the initial wait race.
    if (signal?.aborted || job.abortController.signal.aborted) {
      await job.done;
      return finalJobResult(state, job);
    }
    if (completed) return finalJobResult(state, job);
    abortResult.unlink();
    job.background = true;
    flushLiveUpdate(job, { force: true });
    job.onUpdate = undefined;
    return runningJobResult(job, { initial: true });
  } finally {
    abortResult.unlink();
  }
}

async function statusAction(state, input = {}, signal, ownerAgentRunId) {
  const job = getJob(state, input.jobId, ownerAgentRunId);
  const waitMs = secondsToMs(input.wait, job.completedAt ? 0 : DEFAULT_STATUS_WAIT_MS);
  if (!job.completedAt && waitMs > 0) await waitForJob(job, waitMs, signal);
  if (job.completedAt) return finalJobResult(state, job);
  return runningJobResult(job);
}

async function stopAction(state, input = {}, ownerAgentRunId) {
  const job = getJob(state, input.jobId, ownerAgentRunId);
  stopJob(job, "Command stopped");
  await job.done.catch(() => {});
  if (job.error?.code === "SHELL_CLEANUP_FAILED") throw job.error;
  job.autoPollDone = true;
  return toolResult(formatStoppedJob(job), { jobId: job.id, status: managedBashJobStatus(job), background: job.background === true, outputLineCount: countOutputLines(job.output) });
}

function startJob({ state, operations, commandPrefix, cwd, command, executionCommand, toolCallId, timeout, onUpdate, background = false, ownerAgentRunId }) {
  const id = `cmd-${state.nextId++}`;
  const abortController = new AbortController();
  const startedAt = Date.now();
  const resolvedCommand = commandPrefix ? `${commandPrefix}\n${executionCommand}` : executionCommand;
  const job = {
    id,
    toolCallId,
    ownerAgentRunId,
    command,
    startedAt,
    lastOutputAt: undefined,
    completedAt: undefined,
    exitCode: undefined,
    error: undefined,
    output: "",
    abortController,
    stoppedReason: undefined,
    background,
    persistent: background,
    autoPolls: 0,
    autoPollDone: background,
    onUpdate,
    lastLiveUpdateAt: 0,
    liveUpdateTimer: undefined,
    done: undefined,
    state,
  };
  state.jobs.set(id, job);

  job.done = executeManagedOperation(operations, resolvedCommand, cwd, {
    timeout,
    signal: abortController.signal,
    onData(data) {
      appendOutput(job, data);
      scheduleLiveUpdate(job);
    },
  }).then((result) => {
    flushLiveUpdate(job);
    clearLiveUpdateTimer(job);
    job.exitCode = result.exitCode;
    job.completedAt = Date.now();
    emitManagedBashJobUpdate(job);
    return job;
  }).catch((error) => {
    flushLiveUpdate(job);
    clearLiveUpdateTimer(job);
    job.error = error instanceof Error ? error : new Error(String(error));
    if (job.error.code === "SHELL_CLEANUP_FAILED") job.stoppedReason = undefined;
    job.completedAt = Date.now();
    emitManagedBashJobUpdate(job);
    return job;
  });

  flushLiveUpdate(job, { force: true });
  return job;
}

function executeManagedOperation(operations, command, cwd, execution) {
  try {
    return Promise.resolve(operations.exec(command, cwd, execution));
  } catch (error) {
    return Promise.reject(error);
  }
}

function appendOutput(job, data) {
  const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data ?? "");
  if (!text) return;
  job.lastOutputAt = Date.now();
  job.output += text;
  if (job.output.length > MAX_BUFFER_CHARS) {
    job.output = job.output.slice(job.output.length - MAX_BUFFER_CHARS);
  }
}

function scheduleLiveUpdate(job) {
  if ((!job.onUpdate && job.state.listeners.size === 0) || job.completedAt) return;
  const elapsed = Date.now() - (job.lastLiveUpdateAt || 0);
  if (elapsed >= LIVE_UPDATE_INTERVAL_MS) {
    flushLiveUpdate(job);
    return;
  }
  if (job.liveUpdateTimer) return;
  job.liveUpdateTimer = setTimeout(() => {
    job.liveUpdateTimer = undefined;
    flushLiveUpdate(job);
  }, Math.max(0, LIVE_UPDATE_INTERVAL_MS - elapsed));
}

function flushLiveUpdate(job, options = {}) {
  if (job.completedAt || (!job.output && !options.force)) return;
  if (!job.onUpdate && job.state.listeners.size === 0) return;
  job.lastLiveUpdateAt = Date.now();
  const update = toolResult(outputSnapshot(job.output, STATUS_OUTPUT_CHARS), {
      jobId: job.id,
      status: "running",
      background: job.background === true,
      live: true,
      outputLineCount: countOutputLines(job.output),
      startedAt: new Date(job.startedAt).toISOString(),
      lastOutputAt: job.lastOutputAt ? new Date(job.lastOutputAt).toISOString() : undefined,
    });
  if (job.onUpdate) {
    try {
      job.onUpdate(update);
    } catch {
      // Pi live updates are best-effort; the managed job observer remains authoritative.
    }
  }
  notifyManagedBashListeners(job.state, createManagedBashJobSnapshot(job, "running", update.content[0].text));
}

function emitManagedBashJobUpdate(job) {
  notifyManagedBashListeners(job.state, createManagedBashJobSnapshot(job));
}

function managedBashJobStatus(job) {
  if (job.error?.code === "SHELL_CLEANUP_FAILED") return "failed";
  if (!job.completedAt) return "running";
  if (job.stoppedReason) return "stopped";
  return job.error || (job.exitCode !== 0 && job.exitCode !== null && job.exitCode !== undefined) ? "failed" : "completed";
}

export function createManagedBashJobSnapshot(job, status = managedBashJobStatus(job), output = outputSnapshot(job.output, FINAL_OUTPUT_CHARS)) {
  return {
    jobId: job.id,
    toolCallId: job.toolCallId,
    ownerAgentRunId: job.ownerAgentRunId,
    command: job.command,
    status,
    background: job.background === true,
    cleanupFailed: job.error?.code === "SHELL_CLEANUP_FAILED",
    output,
    startedAt: new Date(job.startedAt).toISOString(),
    lastOutputAt: job.lastOutputAt ? new Date(job.lastOutputAt).toISOString() : undefined,
    completedAt: job.completedAt ? new Date(job.completedAt).toISOString() : undefined,
    exitCode: job.exitCode,
    errorMessage: status === "stopped" ? undefined : job.error?.message,
  };
}

function notifyManagedBashListeners(state, update) {
  for (const listener of state.listeners) {
    try {
      listener(update);
    } catch {
      // Lifecycle observers must not affect command execution.
    }
  }
}

function clearLiveUpdateTimer(job) {
  if (!job.liveUpdateTimer) return;
  clearTimeout(job.liveUpdateTimer);
  job.liveUpdateTimer = undefined;
}

function outputSnapshot(output, maxChars) {
  const text = String(output ?? "").replace(/\r\n/g, "\n").trimEnd();
  if (!text || text.length <= maxChars) return text;
  return text.slice(text.length - maxChars);
}

function countOutputLines(output) {
  const text = String(output ?? "").replace(/\r\n/g, "\n").trimEnd();
  return text ? text.split("\n").length : 0;
}

function stopJob(job, reason) {
  if (job.completedAt) return;
  job.stoppedReason = reason;
  job.abortController.abort();
}

// These helpers operate on the owned runtime Map, never inferred command names
// or a client-side event cache. Stop turn selects foreground jobs once; disposal
// continues to use abortAll and retains authority over every process.
export function listManagedBashJobs(state, input = {}) {
  return { jobs: [...state.jobs.values()]
    .filter(job => input.ownerAgentRunId === undefined || job.ownerAgentRunId === input.ownerAgentRunId)
    .map(job => {
      // Controls need lifecycle metadata, not output tails on every poll.
      // Bash status and lifecycle events retain the full output projection.
      const snapshot = createManagedBashJobSnapshot(job, undefined, "");
      delete snapshot.output;
      return snapshot;
    }) };
}

export function assertManagedBashCleanup(results, jobs = []) {
  const failures = results.filter(result => result.status === "rejected").map(result => result.reason);
  for (const job of jobs) {
    if (job.error?.code === "SHELL_CLEANUP_FAILED") failures.push(job.error);
  }
  if (failures.length) throw new AggregateError(failures, failures.map(error => error?.message || String(error)).join("; "));
}

export function abortManagedBashForegroundJobs(state, reason = "Command aborted") {
  const jobs = [...(state?.jobs?.values?.() ?? [])].filter(job => !job.completedAt && !job.background);
  for (const job of jobs) stopJob(job, reason);
  return jobs;
}

export async function stopManagedBashJobs(state, input = {}) {
  const hasId = typeof input.jobId === "string" && input.jobId.trim().length > 0;
  if ((input.all === true && input.jobId !== undefined) || (!hasId && input.all !== true) || (hasId && input.all !== undefined)) {
    throw new Error("Provide either jobId or all:true to stop managed commands");
  }
  const jobs = input.all === true
    ? [...state.jobs.values()].filter(job => job.background
      && (input.ownerAgentRunId === undefined || job.ownerAgentRunId === input.ownerAgentRunId)
      && (!job.completedAt || job.error?.code === "SHELL_CLEANUP_FAILED"))
    : [getJob(state, input.jobId, input.ownerAgentRunId)];
  for (const job of jobs) stopJob(job, "Command stopped");
  await Promise.all(jobs.map(async job => {
    try { await job.done; }
    catch (error) {
      // Retain an unconfirmed cleanup failure instead of claiming a stop.
      job.error = error instanceof Error ? error : new Error(String(error));
      job.error.code = "SHELL_CLEANUP_FAILED";
      job.stoppedReason = undefined;
      job.completedAt = Date.now();
      emitManagedBashJobUpdate(job);
    }
    job.autoPollDone = true;
  }));
  // Stop responses are the same authoritative list as a subsequent list call,
  // so replacing a client's projection cannot hide surviving jobs.
  return listManagedBashJobs(state, input);
}

function getJob(state, jobId, ownerAgentRunId) {
  const id = String(jobId ?? "").trim();
  if (!id) throw new Error("jobId is required");
  const job = state.jobs.get(id);
  if (!job || (ownerAgentRunId !== undefined && job.ownerAgentRunId !== ownerAgentRunId)) {
    throw new Error(`No managed command found for jobId ${id}`);
  }
  return job;
}

async function waitForJob(job, waitMs, signal) {
  if (job.completedAt) return true;
  let timer;
  let onAbort;
  const timeout = new Promise(resolve => { timer = setTimeout(resolve, Math.max(0, waitMs)); });
  const abort = new Promise(resolve => {
    onAbort = resolve;
    if (signal?.aborted) resolve();
    else signal?.addEventListener?.("abort", onAbort, { once: true });
  });
  try {
    await Promise.race([job.done, timeout, abort]);
    return Boolean(job.completedAt);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.("abort", onAbort);
  }
}

function linkAbort(signal, job) {
  if (!signal) return { unlink() {} };
  const abort = () => stopJob(job, "Command aborted");
  if (signal.aborted) abort();
  signal.addEventListener?.("abort", abort, { once: true });
  return {
    unlink() {
      signal.removeEventListener?.("abort", abort);
    },
  };
}

function abortPromise(signal) {
  if (!signal) return new Promise(() => {});
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
}

function finalJobResult(_state, job) {
  job.autoPollDone = true;
  const text = formatFinalJob(job);
  if (job.stoppedReason) {
    return toolResult(text, { jobId: job.id, status: "stopped", background: job.background === true, exitCode: job.exitCode, outputLineCount: countOutputLines(job.output) });
  }
  if (job.error || (job.exitCode !== 0 && job.exitCode !== null && job.exitCode !== undefined)) {
    throw new Error(text);
  }
  return toolResult(text, { jobId: job.id, status: "completed", background: job.background === true, exitCode: job.exitCode, outputLineCount: countOutputLines(job.output) });
}

function runningJobResult(job, options = {}) {
  return toolResult(formatRunningJob(job, options), {
    jobId: job.id,
    status: "running",
    background: job.background === true,
    outputLineCount: countOutputLines(job.output),
    startedAt: new Date(job.startedAt).toISOString(),
    lastOutputAt: job.lastOutputAt ? new Date(job.lastOutputAt).toISOString() : undefined,
  });
}

function toolResult(text, details = undefined) {
  return {
    content: [{ type: "text", text }],
    details,
  };
}

export function hasManagedBashAutoPollJobs(state) {
  return [...state.jobs.values()].some((job) => !job.autoPollDone);
}

export async function waitForManagedBashAutoUpdate(state, options = {}) {
  const jobs = [...state.jobs.values()].filter((job) => !job.autoPollDone);
  if (jobs.length === 0) return "";

  const completed = jobs.some((job) => job.completedAt);
  if (!completed) {
    await Promise.race([
      Promise.any(jobs.map((job) => job.done)).catch(() => undefined),
      sleep(options.waitMs ?? DEFAULT_AUTO_POLL_MS),
      abortPromise(options.signal),
    ]);
  }

  const maxPolls = Number.isFinite(Number(options.maxPolls)) ? Number(options.maxPolls) : DEFAULT_MAX_AUTO_POLLS;
  const updates = [];
  for (const job of [...state.jobs.values()]) {
    if (job.autoPollDone) continue;
    if (job.completedAt) {
      updates.push(formatFinalJob(job));
      job.autoPollDone = true;
      continue;
    }
    job.autoPolls += 1;
    updates.push(formatRunningJob(job, { auto: true }));
    if (job.autoPolls >= maxPolls) {
      job.autoPollDone = true;
      updates.push(`Auto-poll limit reached for ${job.id}. Leave it running only if useful, or call bash action=status/action=stop with this jobId.`);
    }
  }
  return updates.filter(Boolean).join("\n\n---\n\n");
}

function formatRunningJob(job, options = {}) {
  const elapsed = formatDuration(Date.now() - job.startedAt);
  const lastOutput = job.lastOutputAt ? `${formatDuration(Date.now() - job.lastOutputAt)} ago` : "no output yet";
  const heading = options.initial
    ? `Command still running (${job.id}) after ${elapsed}.`
    : `Command still running (${job.id}). Elapsed: ${elapsed}.`;
  const output = formatOutputTail(job.output, { maxLines: STATUS_OUTPUT_LINES, maxChars: STATUS_OUTPUT_CHARS });
  return [
    heading,
    `Background: ${job.background === true}${job.persistent ? " (persistent; automatic polling disabled)" : ""}`,
    `Last output: ${lastOutput}`,
    `Command: ${job.command}`,
    "",
    output ? `Current output:\n${output}` : "Current output: (none yet)",
    "",
    `To check again, call bash with action=status and jobId=${job.id}. To stop it, call action=stop with jobId=${job.id}.`,
  ].join("\n");
}

function formatFinalJob(job) {
  const elapsed = formatDuration((job.completedAt ?? Date.now()) - job.startedAt);
  const output = formatOutputTail(job.output, { maxLines: FINAL_OUTPUT_LINES, maxChars: FINAL_OUTPUT_CHARS }) || "(no output)";
  const status = job.stoppedReason
    ? job.stoppedReason
    : job.error
      ? job.error.message
      : job.exitCode === 0 || job.exitCode === null || job.exitCode === undefined
        ? "Command completed"
        : `Command exited with code ${job.exitCode}`;
  return [
    `${status} (${job.id}) after ${elapsed}.`,
    `Command: ${job.command}`,
    "",
    output,
  ].join("\n");
}

function formatStoppedJob(job) {
  const elapsed = formatDuration((job.completedAt ?? Date.now()) - job.startedAt);
  const output = formatOutputTail(job.output, { maxLines: STATUS_OUTPUT_LINES, maxChars: STATUS_OUTPUT_CHARS }) || "(no output)";
  return [`Command stopped (${job.id}) after ${elapsed}.`, `Command: ${job.command}`, "", output].join("\n");
}

function formatOutputTail(output, options = {}) {
  const text = String(output ?? "").replace(/\r\n/g, "\n").trimEnd();
  if (!text) return "";
  const maxChars = options.maxChars ?? STATUS_OUTPUT_CHARS;
  const maxLines = options.maxLines ?? STATUS_OUTPUT_LINES;
  let truncatedByChars = false;
  let sliced = text;
  if (sliced.length > maxChars) {
    sliced = sliced.slice(sliced.length - maxChars);
    truncatedByChars = true;
  }
  const lines = sliced.split("\n");
  const overflowLines = Math.max(0, lines.length - maxLines);
  const visible = overflowLines > 0 ? lines.slice(lines.length - maxLines) : lines;
  const prefix = truncatedByChars || overflowLines > 0
    ? `[Showing latest output${overflowLines > 0 ? `, skipped ${overflowLines} earlier line${overflowLines === 1 ? "" : "s"}` : ""}]\n`
    : "";
  return `${prefix}${visible.join("\n")}`;
}

export function prepareManagedBashCommand(commandValue, platform = process.platform) {
  const command = String(commandValue ?? "");
  if (platform !== "win32") return command;
  if (/^\s*cmd(?:\.exe)?\b/i.test(command)) return `MSYS_NO_PATHCONV=1 ${command}`;
  if (!/^\s*(?:powershell(?:\.exe)?|pwsh(?:\.exe)?)\b/i.test(command)) return command;

  let prepared = "";
  let quote = null;
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (character === "\\" && quote !== "'") {
      prepared += character;
      if (index + 1 < command.length) prepared += command[index += 1];
      continue;
    }
    if (character === "'" && quote !== '"') quote = quote === "'" ? null : "'";
    else if (character === '"' && quote !== "'") quote = quote === '"' ? null : '"';
    if (character === "$" && quote !== "'") prepared += "\\";
    prepared += character;
  }
  return prepared;
}

function pruneRetainedTerminalJobs(state) {
  const terminalJobs = [...state.jobs.values()]
    .filter((job) => job.completedAt && job.error?.code !== "SHELL_CLEANUP_FAILED")
    .sort((left, right) => Number(left.completedAt) - Number(right.completedAt));
  const overflow = terminalJobs.length - MAX_RETAINED_TERMINAL_JOBS + 1;
  for (let index = 0; index < overflow; index += 1) state.jobs.delete(terminalJobs[index].id);
}

function secondsToMs(value, fallbackMs) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallbackMs;
  return Math.round(number * 1000);
}

function sleep(ms) {
  const duration = Math.max(0, Number(ms) || 0);
  return new Promise((resolve) => setTimeout(resolve, duration));
}

function formatDuration(ms) {
  const total = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}
