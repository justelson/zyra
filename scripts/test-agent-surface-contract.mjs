import assert from "node:assert/strict";
import {
  AGENT_SURFACE_CONTRACT_VERSION,
  isAgentSurfaceDescriptor,
  normalizeAgentSurfaceLifecycle,
  normalizeAgentSurfacePhase,
  normalizeAgentSurfaceTool,
} from "../src/agent-surface.mjs";
import { createAssistantActionBatchTool } from "../src/assistant-action-batch-tool.mjs";
import { describeZyraToolPermission } from "../src/zyra-permission-gate.mjs";

const actionBatchTool = createAssistantActionBatchTool();
assert.equal(actionBatchTool.name, "begin_action_batch");
const actionBatchResult = await actionBatchTool.execute("batch-1", { title: "  Reviewing   timeline behavior  " });
assert.equal(actionBatchResult.details.actionBatchIntent, "Reviewing timeline behavior");
assert.equal(actionBatchResult.details.hiddenFromTimeline, true);
assert.equal(describeZyraToolPermission({ toolName: "begin_action_batch", input: { title: "Reviewing timeline behavior" } }), null, "declaring a presentation-only batch title never opens an approval gate");

const command = normalizeAgentSurfaceTool({
  type: "tool_execution_start",
  toolName: "bash",
  args: { command: "npm test" },
});
assert.equal(command.version, AGENT_SURFACE_CONTRACT_VERSION);
assert.equal(command.kind, "command");
assert.equal(command.lifecycle, "running");
assert.equal(command.phase, "start");
assert.equal(command.primaryText, "npm test");
assert.equal(command.summary, "Running command");
assert.equal(isAgentSurfaceDescriptor(command), true);

const edit = normalizeAgentSurfaceTool({
  type: "tool_execution_end",
  toolName: "edit",
  args: { path: "src/app.ts", oldString: "old", newString: "new" },
  result: { details: { status: "completed" } },
});
assert.equal(edit.kind, "file-change");
assert.equal(edit.lifecycle, "completed");
assert.equal(edit.phase, "end");
assert.deepEqual(edit.paths, ["src/app.ts"]);
assert.equal(edit.summary, "Edited file");

const read = normalizeAgentSurfaceTool({
  type: "tool_execution_end",
  toolName: "read",
  args: { path: "README.md" },
});
assert.equal(read.kind, "file-read");
assert.equal(read.summary, "Read file");

const search = normalizeAgentSurfaceTool({
  type: "tool_execution_start",
  toolName: "web_search",
  args: { query: "Pi SDK" },
});
assert.equal(search.kind, "web-search");
assert.equal(search.query, "Pi SDK");

const fetchPage = normalizeAgentSurfaceTool({
  type: "tool_execution_start",
  toolName: "web_fetch",
  args: { url: "https://example.com/docs" },
});
assert.equal(fetchPage.kind, "web-fetch");
assert.equal(fetchPage.url, "https://example.com/docs");

const skill = normalizeAgentSurfaceTool({
  type: "tool_execution_end",
  toolName: "read",
  args: { path: "C:/Users/example/.agents/skills/diagnose/SKILL.md" },
});
assert.equal(skill.kind, "skill");

const agent = normalizeAgentSurfaceTool({
  type: "tool_execution_start",
  toolName: "agent",
  args: { action: "spawn", agent: "code-reviewer", prompt: "Review this change" },
});
assert.equal(agent.kind, "agent");
assert.equal(agent.action, "spawn");

const browser = normalizeAgentSurfaceTool({
  type: "tool_execution_start",
  toolName: "browser_observe",
  args: { url: "https://example.com" },
});
assert.equal(browser.kind, "browser-control");

assert.equal(normalizeAgentSurfaceLifecycle({ isError: true, state: "done" }), "failed");
assert.equal(normalizeAgentSurfaceLifecycle({ result: { details: { status: "stopped" } } }), "stopped");
assert.equal(normalizeAgentSurfaceLifecycle({ state: "done", result: { details: { status: "running" } } }), "running");
assert.equal(normalizeAgentSurfaceLifecycle({ type: "tool_execution_end" }), "completed");
assert.equal(normalizeAgentSurfacePhase({ type: "tool_execution_update" }), "update");
assert.equal(isAgentSurfaceDescriptor({ ...command, phase: "finished" }), false);
assert.equal(isAgentSurfaceDescriptor({ ...command, version: 2 }), false);
assert.equal("className" in command, false, "the middle contract must not contain renderer styling");
assert.equal("color" in command, false, "the middle contract must remain theme-agnostic");

console.log("Agent surface contract: ok");
