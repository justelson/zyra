import { Type } from "typebox";
import { defineZyraTool } from "./define-zyra-tool.mjs";

export function createFleetTools(holder) {
  const agentTool = defineZyraTool({
    name: "agent",
    label: "Agent fleet",
    description: "Manage supporting child agents without creating user-facing sidebar conversations. Use these for reviews, research and bounded implementation that the parent coordinates and integrates. Use thread:start only for a distinct ongoing conversation the user is likely to revisit or interact with directly; parallelism alone is not a reason. Before choosing a delegated model or effort, use action=models to read current delegation preferences and a small authenticated model/API-cost shortlist; choose suitable model and effort from that result. Respect explicit agent-model requirements and existing budgets/scopes. Children never receive this tool.",
    parameters: Type.Object({
      action: Type.Union(["models", "spawn", "send", "wait", "status", "stop", "retry", "resume"].map((value) => Type.Literal(value))),
      agentRunId: Type.Optional(Type.String()),
      agent: Type.Optional(Type.String()),
      prompt: Type.Optional(Type.String()),
      label: Type.Optional(Type.String()),
      model: Type.Optional(Type.String()),
      provider: Type.Optional(Type.String()),
      modelQuery: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Number()),
      fallbackModels: Type.Optional(Type.Array(Type.String())),
      effort: Type.Optional(Type.String()),
      interrupt: Type.Optional(Type.Boolean({ description: 'For send: stop the current work and replace it with this instruction. Omit to send without interrupting.' })),
      tools: Type.Optional(Type.Array(Type.String())),
      controlLease: Type.Optional(Type.Object({
        parentGrantId: Type.String(),
        targetId: Type.String(),
        capabilities: Type.Array(Type.String()),
        expiresAt: Type.String(),
        maxActions: Type.Number(),
        allowedOrigins: Type.Optional(Type.Array(Type.String())),
        allowedExecutableIdentities: Type.Optional(Type.Array(Type.String())),
      })),
      successCriteria: Type.Optional(Type.Array(Type.String())),
      permissionMode: Type.Optional(Type.String()),
      isolation: Type.Optional(Type.Union([Type.Literal("shared"), Type.Literal("worktree")])),
      readScope: Type.Optional(Type.Array(Type.String())),
      writeScope: Type.Optional(Type.Array(Type.String())),
      background: Type.Optional(Type.Boolean()),
      timeoutMs: Type.Optional(Type.Number()),
    }),
    execute: async (_id, params) => toolResult(await executeAgentAction(requireController(holder), params)),
  });

  const workflowTool = defineZyraTool({
    name: "workflow",
    label: "Workflow runtime",
    description: "Run and control a durable sandboxed workflow. Workflow JavaScript has no Node, filesystem, shell, credential, or network access.",
    parameters: Type.Object({
      action: Type.Union(["run", "pause", "resume", "status", "stop", "restart", "save"].map((value) => Type.Literal(value))),
      workflowRunId: Type.Optional(Type.String()),
      name: Type.Optional(Type.String()),
      args: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
      approved: Type.Optional(Type.Boolean()),
      scope: Type.Optional(Type.Union([Type.Literal("personal"), Type.Literal("project")])),
    }),
    execute: async (_id, params) => toolResult(await executeWorkflowAction(requireWorkflow(holder), params)),
  });
  return [agentTool, workflowTool];
}

async function executeAgentAction(controller, params) {
  switch (params.action) {
    case "models":
      return controller.delegationModelOptions(params);
    case "spawn":
      if (!params.prompt) throw new Error("agent spawn requires prompt.");
      return controller.spawn({ ...params, goal: params.prompt });
    case "send":
      if (params.interrupt) return controller.interruptAndSend(requiredId(params), requiredPrompt(params));
      return controller.send(requiredId(params), requiredPrompt(params));
    case "wait":
      return controller.wait(requiredId(params), { timeoutMs: params.timeoutMs });
    case "status":
      return controller.status(params.agentRunId);
    case "stop":
      return controller.stop(requiredId(params), 'Stopped by another agent.', { kind: 'stopped', source: 'agent', threadId: controller.rootThreadId });
    case "retry":
      return controller.retry(requiredId(params), params.prompt ? { goal: params.prompt } : {});
    case "resume":
      return controller.resume(requiredId(params), params.prompt);
    default:
      throw new Error(`Unknown agent action: ${params.action}.`);
  }
}

async function executeWorkflowAction(runtime, params) {
  switch (params.action) {
    case "run":
      if (!params.name) throw new Error("workflow run requires name.");
      return runtime.run(params.name, params.args ?? {}, { approved: params.approved === true });
    case "pause": return runtime.pause(requiredWorkflowId(params));
    case "resume": return runtime.resume(requiredWorkflowId(params));
    case "status": return params.workflowRunId ? runtime.status(params.workflowRunId) : runtime.listRuns();
    case "stop": return runtime.stop(requiredWorkflowId(params));
    case "restart": return runtime.restart(requiredWorkflowId(params), { args: params.args });
    case "save": return runtime.save(requiredWorkflowId(params), { scope: params.scope });
    default: throw new Error(`Unknown workflow action: ${params.action}.`);
  }
}

function requireController(holder) {
  if (!holder?.controller) throw new Error("Agent fleet is still initializing.");
  return holder.controller;
}

function requireWorkflow(holder) {
  if (!holder?.workflowRuntime) throw new Error("Workflow runtime is still initializing.");
  return holder.workflowRuntime;
}

function requiredId(params) {
  if (!params.agentRunId) throw new Error(`${params.action} requires agentRunId.`);
  return params.agentRunId;
}

function requiredWorkflowId(params) {
  if (!params.workflowRunId) throw new Error(`${params.action} requires workflowRunId.`);
  return params.workflowRunId;
}

function requiredPrompt(params) {
  if (!params.prompt) throw new Error(`${params.action} requires prompt.`);
  return params.prompt;
}

function toolResult(value) {
  const text = JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text: text.length > 50 * 1024 ? `${text.slice(0, 50 * 1024)}\n[truncated]` : text }], details: { fleet: true } };
}
