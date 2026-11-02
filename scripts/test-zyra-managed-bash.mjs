#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  createManagedBashState,
  createManagedBashTool,
  prepareManagedBashCommand,
  waitForManagedBashAutoUpdate,
} from "../src/managed-bash-tool.mjs";
import { createZyraSession } from "../src/zyra-sdk.mjs";

assert.equal(
  prepareManagedBashCommand('powershell -NoProfile -Command "Write-Output $_.Free"', 'win32'),
  'powershell -NoProfile -Command "Write-Output \\$_.Free"',
  "PowerShell variables inside double quotes must survive the outer Bash shell",
);
assert.equal(
  prepareManagedBashCommand("powershell -NoProfile -Command 'Write-Output $_.Free'", 'win32'),
  "powershell -NoProfile -Command 'Write-Output $_.Free'",
  "PowerShell variables already protected by single quotes must remain unchanged",
);
assert.equal(
  prepareManagedBashCommand('cmd.exe /c fsutil volume diskfree C:', 'win32'),
  'MSYS_NO_PATHCONV=1 cmd.exe /c fsutil volume diskfree C:',
  "cmd.exe switches must not be converted into MSYS paths",
);

const state = createManagedBashState();
const tool = createManagedBashTool({ cwd: process.cwd(), state });
const stateUpdates = [];
const unsubscribeState = state.subscribe((update) => stateUpdates.push(update));

const short = await tool.execute("short", { command: "printf hello" }, new AbortController().signal);
assert.match(short.content[0].text, /hello/);

const liveUpdates = [];
const long = await tool.execute(
  "long",
  { command: "node -e \"console.log(1); setInterval(()=>console.log(Date.now()), 200)\"", wait: 3 },
  new AbortController().signal,
  (partial) => liveUpdates.push(partial),
);
assert.match(long.content[0].text, /Command still running/);
assert.equal(long.details.status, "running");
assert.ok(long.details.jobId);
assert.ok(liveUpdates.some((update) => update.details?.status === "running" && update.details?.live === true), "managed bash should emit live output updates before the first command block returns");

const status = await tool.execute("status", { action: "status", jobId: long.details.jobId, wait: 0.2 }, new AbortController().signal);
assert.match(status.content[0].text, /Command still running|Command completed|Command exited|Command stopped/);

if (state.jobs.has(long.details.jobId)) {
  const stopped = await tool.execute("stop", { action: "stop", jobId: long.details.jobId }, new AbortController().signal);
  assert.match(stopped.content[0].text, /Command stopped|Command aborted/);
  const stoppedUpdate = stateUpdates.findLast((update) => update.jobId === long.details.jobId && update.status === "stopped");
  assert.ok(stoppedUpdate, "managed bash should publish a stopped terminal snapshot");
  assert.equal(stoppedUpdate.errorMessage, undefined, "an intentional stop must not be reported as a command failure");
}
unsubscribeState();

const observedState = createManagedBashState();
const observedTool = createManagedBashTool({ cwd: process.cwd(), state: observedState });
const observedUpdates = [];
const unsubscribeObserved = observedState.subscribe((update) => observedUpdates.push(update));
const observedRun = await observedTool.execute(
  "observer-background",
  { command: "node -e \"console.log('observer started'); setTimeout(()=>console.log('observer done'), 180)\"", wait: 0.01 },
  new AbortController().signal,
);
assert.equal(observedRun.details.status, "running");
await waitFor(() => observedUpdates.some((update) => update.status === "completed"), 3000);
const observedTerminal = observedUpdates.findLast((update) => update.status === "completed");
assert.equal(observedTerminal?.toolCallId, "observer-background");
assert.equal(observedTerminal?.jobId, observedRun.details.jobId);
assert.match(observedTerminal?.output || "", /observer done/);
assert.equal(typeof observedTerminal?.completedAt, "string");
await waitFor(() => observedState.jobs.get(observedRun.details.jobId)?.completedAt, 3000);
const observedAutoUpdate = await waitForManagedBashAutoUpdate(observedState, { waitMs: 0 });
assert.match(observedAutoUpdate, /observer done/);
const observedStatusAfterAutoUpdate = await observedTool.execute(
  "observer-status-after-auto-update",
  { action: "status", jobId: observedRun.details.jobId, wait: 0 },
  new AbortController().signal,
);
assert.equal(observedStatusAfterAutoUpdate.details.status, "completed", "terminal jobs must remain queryable after automatic completion delivery");
unsubscribeObserved();

const runtime = await createZyraSession({
  noSession: true,
  skipGuide: true,
  skipMemoryStartup: true,
  skipMemoryInjection: true,
  skipProfileInjection: true,
  skipProjectMemory: true,
  managedBashAutoPollMs: 100,
});

try {
  const runtimeTool = runtime.session._toolRegistry.get("bash");
  const running = await runtimeTool.execute(
    "runtime-long",
    { command: "node -e \"setInterval(()=>console.log(Date.now()), 200)\"", wait: 0.05 },
    new AbortController().signal,
  );
  assert.equal(running.details.status, "running");

  const originalCheckCompaction = runtime.session._checkCompaction;
  assert.equal(typeof originalCheckCompaction, "function", "the pinned Pi runtime must expose the compaction checkpoint used between turns");
  const compactedMessages = [{
    role: "user",
    content: [{ type: "text", text: "compacted context" }],
    timestamp: Date.now(),
  }];
  let checkedAssistant;
  runtime.session._checkCompaction = async (assistantMessage) => {
    checkedAssistant = assistantMessage;
    runtime.session.agent.state.messages = compactedMessages;
    return false;
  };
  const assistantMessage = {
    role: "assistant",
    content: [{ type: "toolCall", id: "runtime-long", name: "bash", arguments: {} }],
    provider: "test",
    model: "test",
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "toolUse",
    timestamp: Date.now(),
  };
  // Between-turn compaction runs after a settled tool batch, not an empty turn.
  const toolResult = {
    role: "toolResult", toolCallId: "runtime-long", toolName: "bash",
    content: running.content, details: running.details, isError: false, timestamp: Date.now(),
  };
  const nextTurnSnapshot = await runtime.session.agent.prepareNextTurnWithContext?.({
    message: assistantMessage,
    toolResults: [toolResult],
    context: {
      systemPrompt: runtime.session.agent.state.systemPrompt,
      messages: [assistantMessage, toolResult],
      tools: runtime.session.agent.state.tools,
    },
    newMessages: [assistantMessage, toolResult],
  }, new AbortController().signal);
  runtime.session._checkCompaction = originalCheckCompaction;

  assert.equal(checkedAssistant, assistantMessage, "the between-turn checkpoint should evaluate the completed assistant turn for compaction");
  assert.deepEqual(nextTurnSnapshot?.context?.messages, compactedMessages, "the next provider request should receive the rebuilt compacted context");

  const queued = runtime.session.agent.steeringQueue.drain();
  assert.equal(queued.length, 1);
  assert.equal(queued[0].role, "custom");
  assert.equal(queued[0].customType, "zyra.managed-bash.update.v1");
  assert.match(queued[0].content[0].text, /Zyra managed command update/);
} finally {
  runtime.managedBash?.abortAll?.();
  runtime.session.dispose();
}

console.log("zyra-managed-bash regression: ok");

async function waitFor(predicate, timeoutMs) {
  const startedAt = Date.now();
  while (!predicate() && Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
