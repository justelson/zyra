import { readRoleModels } from "../role-model-preferences.mjs";
import { readDelegationPreferences } from "../delegation-preferences.mjs";
import { buildDelegationModelOptions } from "../delegation-model-options.mjs";
import { getModelThinkingLevels, coerceThinkingLevelForModel } from '../../thinking-levels.mjs';
import { randomUUID } from "node:crypto";
import path from "node:path";
import { assertControlCapabilities, assertControlIdentifier, assertControlPrincipal } from "../../agent-control/contracts.mjs";
import { attenuateAgentCapabilities, assertNoControlCapabilities } from "../capability-policy.mjs";
import { normalizeAgentRun, TERMINAL_AGENT_STATES } from "../contracts.mjs";
import { discoverAgentDefinitions } from "../definition-loader.mjs";
import { FleetEventStore } from "../event-store.mjs";
import { buildFleetModelCatalog, buildFleetModelCatalogAsync } from "../model-catalog.mjs";
import { ModelRouter } from "../model-router.mjs";
import { scanChildOutput } from "../output-scanner.mjs";
import { AgentRunner } from "./agent-runner.mjs";
import { CancellationTree } from "./cancellation-tree.mjs";
import { ChildSessionFactory } from "./child-session-factory.mjs";
import { planFleetRecovery } from "./recovery.mjs";
import { ChildTranscriptStore } from "./transcript-store.mjs";
import { WorkspaceGuard } from "./workspace-guard.mjs";
import { WorktreeManager } from "./worktree-manager.mjs";

export class AgentFleetController {
  constructor(options = {}) {
    this.project = path.resolve(options.project ?? process.cwd());
    this.rootSession = options.rootSession;
    this.readRoleModels = options.readRoleModels ?? readRoleModels;
    this.readDelegationPreferences = options.readDelegationPreferences ?? readDelegationPreferences;
    this.modelRegistry = options.modelRegistry ?? this.rootSession?.modelRegistry;
    this.modelCatalogOptions = options.modelCatalogOptions;
    this.rootSessionId = String(options.rootSessionId ?? this.rootSession?.sessionManager?.getSessionId?.() ?? randomUUID());
    this.rootThreadId = String(options.rootThreadId ?? this.rootSessionId);
    this.fleetId = String(options.fleetId ?? randomUUID());
    this.maxSessions = Math.max(2, Math.min(16, Number(options.maxSessions) || 4));
    this.maxDepth = Math.max(1, Math.min(8, Number(options.maxDepth) || 3));
    this.projectTrusted = Boolean(options.projectTrusted);
    this.listeners = new Set();
    this.queue = [];
    this.active = new Map();
    this.launching = new Set();
    this.completedHosts = new Map();
    this.followUps = new Set();
    this.followUpChains = new Map();
    this.sessionListeners = new Set();
    this.interruptions = new Map();
    this.executions = new Set();
    this.agentExecutions = new Map();
    this.waiters = new Map();
    this.disposed = false;
    this.definitions = { active: [], shadowed: [], all: [] };
    this.cancellation = new CancellationTree();
    this.cancellation.create(this.fleetId);
    this.cancellationRootId = this.fleetId;
    this.workspaceGuard = new WorkspaceGuard({ project: this.project });
    this.worktreeManager = new WorktreeManager({ project: this.project });
    this.transcripts = new ChildTranscriptStore();
    this.eventStore = options.eventStore ?? new FleetEventStore({
      project: this.project,
      rootSessionId: this.rootSessionId,
      rootThreadId: this.rootThreadId,
      fleetId: this.fleetId,
    });
    this.unsubscribeEventStore = this.eventStore.subscribe?.(({ event, snapshot }) => {
      for (const listener of this.listeners) listener({ event, snapshot });
    });
    this.modelCatalog = options.modelCatalog ?? buildFleetModelCatalog(options.modelRegistry ?? this.rootSession?.modelRegistry, options.modelCatalogOptions);
    this.modelRouter = options.modelRouter ?? new ModelRouter({ catalog: this.modelCatalog, policy: options.modelPolicy });
    const transcriptDirectory = path.join(this.project, ".zyra", "agent-runs", this.rootSessionId, "child-sessions");
    this.sessionFactory = options.sessionFactory ?? new ChildSessionFactory({
      project: this.project,
      managedBash: options.managedBash,
      transcriptDirectory,
      modelRuntime: options.modelRuntime ?? this.rootSession?.modelRuntime,
      authStorage: options.authStorage ?? this.rootSession?.modelRegistry?.authStorage,
      modelRegistry: options.modelRegistry ?? this.rootSession?.modelRegistry,
    });
    this.runner = options.runner ?? new AgentRunner({ sessionFactory: this.sessionFactory });
    this.controlBridgeClient = options.controlBridgeClient;
    this.threadBridgeClient = options.threadBridgeClient;
    this.workflowRuntime = null;
  }

  async initialize(options = {}) {
    const loaded = await this.eventStore.initialize({ fleetId: this.fleetId });
    const initialCancellationRootId = this.cancellationRootId;
    this.fleetId = loaded.snapshot.fleetId;
    if (initialCancellationRootId !== this.fleetId) this.cancellation.remove(initialCancellationRootId);
    if (!this.cancellation.nodes.has(this.fleetId)) this.cancellation.create(this.fleetId);
    this.cancellationRootId = this.fleetId;
    this.definitions = await discoverAgentDefinitions({
      installRoot: options.installRoot,
      project: this.project,
      projectTrusted: this.projectTrusted,
      sessionOverrides: options.sessionOverrides,
    });
    await this.emit("definitions.changed", { revision: loaded.snapshot.definitionsRevision + 1, count: this.definitions.active.length });
    if (loaded.snapshot.lastAppliedSequence > 1) await this.recover(loaded.snapshot);
    // Restore ownership without replaying any task. A later explicit resume
    // keeps the original ancestry and scope instead of becoming a new root.
    const pendingParents = new Map(Object.values(this.snapshot().agents || {}).map(run => [run.agentRunId, run]));
    while (pendingParents.size) {
      let progress = false;
      for (const [id, run] of pendingParents) {
        const parent = run.parentAgentRunId || this.cancellationRootId;
        if (!this.cancellation.nodes.has(parent)) continue;
        if (!this.cancellation.nodes.has(id)) this.cancellation.create(id, parent);
        pendingParents.delete(id);
        progress = true;
      }
      if (!progress) break; // Corrupt ancestry stays unavailable for execution.
    }
    return this;
  }

  attachWorkflowRuntime(runtime) {
    this.workflowRuntime = runtime;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot() {
    return this.eventStore.getSnapshot();
  }

  listDefinitions() {
    return this.definitions;
  }

  async reloadDefinitions(options = {}) {
    this.definitions = await discoverAgentDefinitions({
      installRoot: options.installRoot,
      project: this.project,
      projectTrusted: this.projectTrusted,
      sessionOverrides: options.sessionOverrides,
    });
    await this.emit("definitions.changed", { revision: this.snapshot().definitionsRevision + 1, count: this.definitions.active.length });
    return this.definitions;
  }

  async delegationModelOptions(request = {}) {
    this.assertUsable();
    await this.refreshModelCatalog();
    return buildDelegationModelOptions(this.modelCatalog, this.readDelegationPreferences(), {
      provider: request.provider,
      modelQuery: request.modelQuery,
      limit: request.limit,
      inheritModel: this.rootSession?.model,
    });
  }

  subscribeSessionEvents(listener) {
    this.sessionListeners.add(listener);
    return () => this.sessionListeners.delete(listener);
  }

  async refreshModelCatalog() {
    if (this.modelRegistry) {
      this.modelCatalog = await buildFleetModelCatalogAsync(this.modelRegistry, this.modelCatalogOptions);
      this.modelRouter.setCatalog?.(this.modelCatalog);
    }
  }

  previewRoute(request = {}) {
    const definition = request.agent ? this.definitions.active.find(entry => entry.name === request.agent)?.definition : null;
    return this.modelRouter.route({
      ...request,
      model: request.model ?? definition?.model ?? "role-default",
      role: request.role ?? definition?.role ?? "specialist",
      roleModels: this.readRoleModels(),
      inheritModel: request.inheritModel ?? this.rootSession?.model,
    });
  }

  async spawn(request = {}) {
    this.assertUsable();
    const parentRun = request.parentAgentRunId ? this.status(request.parentAgentRunId) : null;
    if (parentRun) {
      if (!['running', 'waiting', 'completed'].includes(parentRun.status) && !(request.retryOfAttemptId && ['recovering', 'interrupted'].includes(parentRun.status))) throw new Error('The parent agent is unavailable for delegation.');
      // A descendant receives the parent's existing file authority. It cannot
      // choose a wider scope, shell, or control grant through another thread.
      const permissionRank = { 'read-only': 0, writer: 1, 'full-access': 2 };
      const permissionMode = request.permissionMode ?? parentRun.permissionMode;
      if (!(permissionMode in permissionRank) || permissionRank[permissionMode] > permissionRank[parentRun.permissionMode]) throw new Error('A descendant cannot expand parent permission mode.');
      request = { ...request, tools: (parentRun.tools || []).filter(tool => !['browser_control', 'computer_control'].includes(tool)),
        permissionMode, readScope: parentRun.readScope, writeScope: parentRun.writeScope,
        controlLease: undefined, depth: parentRun.depth + 1 };
    }
    // Capture ownership before any await: a stop must also cancel in-flight spawns.
    const cancellationParent = request.parentAgentRunId ?? this.cancellationRootId;
    const cancellationParentNode = this.cancellation.nodes.get(cancellationParent);
    if (!cancellationParentNode) throw new Error(`Cancellation parent not found: ${cancellationParent}.`);
    const cancellationParentSignal = cancellationParentNode.controller.signal;
    await this.refreshModelCatalog();
    const definitionEntry = request.agent ? this.definitions.active.find((entry) => entry.name === request.agent) : null;
    if (request.agent && !definitionEntry) throw new Error(`Agent definition not found: ${request.agent}.`);
    if (definitionEntry && !definitionEntry.runnable) throw new Error(`Agent definition is not runnable: ${request.agent}. ${definitionEntry.errors?.join("; ") || "project trust required"}`);
    const definition = definitionEntry?.definition ?? {};
    if (request.contextFork && !request.sessionFile) {
      const manager = this.rootSession?.sessionManager;
      const leafId = manager?.getLeafId?.();
      if (!leafId || typeof this.sessionFactory.createContextFork !== "function") throw new Error("The root chat cannot be forked from its current state.");
      request = { ...request, sessionFile: await this.sessionFactory.createContextFork(manager, leafId) };
      if (!request.sessionFile) throw new Error("Context-forked subtasks require a persisted root chat.");
    }
    const depth = Number(request.depth ?? 1);
    if (depth > this.maxDepth) throw new Error(`Agent depth ${depth} exceeds fleet maximum ${this.maxDepth}.`);
    const agentRunId = String(request.agentRunId ?? randomUUID());
    const controlLeaseRequest = normalizeControlLeaseRequest(request.controlLease);
    if (controlLeaseRequest && request.parentAgentRunId) {
      throw new Error("Only the root agent may delegate a control lease.");
    }
    if (controlLeaseRequest && !this.controlBridgeClient?.request) {
      throw new Error("Delegated control requires a connected desktop control broker.");
    }
    const allowDelegatedControl = Boolean(controlLeaseRequest && this.controlBridgeClient?.request);
    const allowOnDemandBrowser = Boolean(this.controlBridgeClient?.request && !parentRun);
    const requestedTools = request.tools ?? definition.tools ?? ["read", "grep", "find", "ls"];
    const capability = attenuateAgentCapabilities(definition, {
      ...request,
      tools: allowOnDemandBrowser ? [...new Set([...requestedTools, "browser_control"])] : requestedTools,
      controlLease: controlLeaseRequest,
    }, {
      ...request.policy,
      allowDelegatedControl,
      allowOnDemandBrowser,
    });
    assertNoControlCapabilities(capability.tools, capability.capabilities, {
      allowDelegatedControl,
      allowOnDemandBrowser,
      delegatedCapabilities: controlLeaseRequest?.capabilities,
    });
    const delegatedTools = capability.tools.filter((tool) => tool === "browser_control" || tool === "computer_control");
    if (controlLeaseRequest && delegatedTools.length === 0) {
      throw new Error("A delegated control lease requires browser_control or computer_control in the child tool allowlist.");
    }
    if (["writer", "full-access"].includes(capability.permissionMode) && !capability.writeScope.length) {
      throw new Error("Writer agents require an explicit writeScope.");
    }
    const route = this.previewRoute({
      model: request.model ?? definition.model ?? "role-default",
      role: request.role ?? definition.role ?? "specialist",
      fallbackModels: request.fallbackModels ?? definition.model?.fallbacks,
      envelope: { ...request, tools: capability.tools },
      policy: request.modelPolicy,
    });
    const attemptId = randomUUID();
    if (request.effort != null) {
      const efforts = route.selectedModel?.reasoning === false ? ['off'] : getModelThinkingLevels(route.selectedModel);
      const effort = request.effort === 'none' ? 'off' : request.effort;
      if (!efforts.includes(effort)) throw new Error(`Thinking effort ${request.effort} is unavailable for ${route.selectedKey}. Choose: ${efforts.join(', ')}.`);
      request = { ...request, effort };
    } else {
      request = { ...request, effort: coerceThinkingLevelForModel(definition.effort ?? this.rootSession?.thinkingLevel ?? 'medium', route.selectedModel) };
    }
    const childPrincipal = this.controlBridgeClient?.request ? {
      type: "agent",
      fleetId: this.fleetId,
      agentRunId,
      parentThreadId: this.rootThreadId,
    } : null;
    const onDemandControl = childPrincipal ? {
      childPrincipal,
      client: typeof this.controlBridgeClient.forPrincipal === "function"
        ? this.controlBridgeClient.forPrincipal(childPrincipal)
        : Object.freeze({ request: (operation, options = {}) => this.controlBridgeClient.request(operation, { ...options, principal: childPrincipal }) }),
      revoked: false,
      revoking: false,
    } : null;
    const run = normalizeAgentRun({
      fleetId: this.fleetId,
      agentRunId,
      agentId: definition.name ?? request.agentId ?? "dynamic",
      definitionName: definition.name,
      parentAgentRunId: request.parentAgentRunId,
      contextFork: request.contextFork,
      conversationKind: request.conversationKind,
      workflowRunId: request.workflowRunId,
      phaseId: request.phaseId,
      label: request.label ?? definition.name ?? request.role ?? "agent",
      goal: request.goal ?? request.prompt,
      successCriteria: request.successCriteria,
      status: "queued",
      attempt: request.attempt ?? 1,
      attemptId,
      depth,
      requestedModel: route.requested,
      selectedModel: route.selectedKey,
      modelRoute: route,
      effort: request.effort ?? definition.effort,
      tools: capability.tools,
      capabilities: capability.capabilities,
      controlLease: null,
      permissionMode: capability.permissionMode,
      isolation: capability.isolation,
      readScope: capability.readScope,
      writeScope: capability.writeScope,
      maxTurns: request.maxTurns ?? definition.maxTurns,
      cwd: parentRun?.cwd || this.project,
    });
    let delegatedControl = null;
    let cancellationCreated = false;
    try {
      if (controlLeaseRequest && childPrincipal) {
        delegatedControl = await this.delegateControlLease(agentRunId, childPrincipal, controlLeaseRequest);
        run.controlLease = summarizeControlGrant(delegatedControl.grant);
      }
      await this.emit("agent.created", { agent: run, warnings: capability.warnings }, { agentRunId });
      // Retry/resume replaces the old conversation host. Keeping it here would
      // leak subscriptions and let send() reach the previous attempt.
      this.completedHosts.get(agentRunId)?.dispose?.();
      this.completedHosts.delete(agentRunId);
      if (this.cancellation.nodes.has(agentRunId)) {
        await this.cancellation.cancel(agentRunId, 'agent attempt replaced');
        this.cancellation.remove(agentRunId);
      }
      if (this.cancellation.nodes.get(cancellationParent) === cancellationParentNode) {
        this.cancellation.create(agentRunId, cancellationParent);
      } else {
        const child = this.cancellation.create(agentRunId);
        child.controller.abort(cancellationParentSignal.reason);
      }
      cancellationCreated = true;
      const controlSession = delegatedControl ?? onDemandControl;
      if (controlSession) {
        this.cancellation.addCleanup(agentRunId, (reason) => this.revokeDelegatedControl(agentRunId, controlSession, reason));
      }
      const queueItem = { run, route, request, delegatedControl, controlSession };
      this.queue.push(queueItem);
    } catch (error) {
      if (delegatedControl) await this.revokeDelegatedControl(agentRunId, delegatedControl, "agent spawn failed");
      if (cancellationCreated) this.cancellation.remove(agentRunId);
      throw error;
    }
    const resultPromise = this.resultPromise(agentRunId);
    this.interruptions.delete(agentRunId);
    void this.drain();
    if (request.returnHandle === true || (request.background !== false && definition.background !== false)) {
      return { fleetId: this.fleetId, agentRunId, attemptId, status: "queued", model: route.selectedKey, effort: run.effort, permissionMode: run.permissionMode };
    }
    return resultPromise;
  }

  async send(agentRunId, message, threadMessage) {
    const active = this.active.get(agentRunId);
    if (active?.host) {
      await active.host.send(message, threadMessage);
      return { agentRunId, delivered: true, mode: "steer" };
    }
    const host = this.completedHosts.get(agentRunId);
    if (host) {
      if (this.status(agentRunId).workflowRunId) throw new Error('A completed workflow agent must continue through its workflow scheduler so request and cost budgets remain enforced.');
      const previous = this.followUpChains.get(agentRunId) || Promise.resolve();
      const operation = previous.catch(() => {}).then(() => this.sendCompleted(agentRunId, host, message, threadMessage));
      this.followUpChains.set(agentRunId, operation);
      this.executions.add(operation);
      try { return await operation; } finally {
        this.executions.delete(operation);
        if (this.followUpChains.get(agentRunId) === operation) this.followUpChains.delete(agentRunId);
      }
    }
    throw new Error(`Agent is not available for steering: ${agentRunId}.`);
  }

  async sendCompleted(agentRunId, host, message, threadMessage) {
      this.assertUsable();
      this.throwIfCancelled(agentRunId);
      if (this.completedHosts.get(agentRunId) !== host) throw new Error('The agent conversation has been replaced.');
      while (this.active.size + this.launching.size + this.followUps.size >= this.maxSessions - 1) {
        await new Promise(resolve => setTimeout(resolve, 25));
        this.throwIfCancelled(agentRunId);
        this.assertUsable();
      }
      this.followUps.add(agentRunId);
      const runBefore = this.status(agentRunId);
      let lock;
      let followUp;
      try {
        if (['writer', 'full-access'].includes(runBefore.permissionMode) && runBefore.isolation !== 'worktree') {
          lock = await this.workspaceGuard.acquire(agentRunId, runBefore.writeScope, { wait: true, signal: this.cancellation.signal(agentRunId) });
        }
        this.throwIfCancelled(agentRunId);
        await this.emit('agent.state.changed', { status: 'running', completedAt: null }, { agentRunId, flush: true });
        followUp = await host.send(message, threadMessage);
        this.throwIfCancelled(agentRunId);
      } catch (error) {
        const usage = host.resultSnapshot?.()?.usage;
        if (usage) await this.emit("agent.usage.updated", { usage }, { agentRunId });
        const cancelled = error?.name === "AbortError" || error?.code === 'CHILD_MAX_TURNS' || this.cancellation.signal(agentRunId)?.aborted;
        await this.emit("agent.failed", {
          status: cancelled ? "cancelled" : "failed",
          error: { name: error?.name ?? "Error", message: error instanceof Error ? error.message : String(error), ...(error?.code ? { code: error.code } : {}), ...(cancelled && this.interruptions.has(agentRunId) ? { interruption: this.interruptions.get(agentRunId) } : {}) },
        }, { agentRunId, flush: true });
        this.completedHosts.delete(agentRunId);
        host.dispose?.();
        this.resolveWaiters(agentRunId, this.status(agentRunId));
        throw error;
      } finally {
        lock?.release?.();
        this.followUps.delete(agentRunId);
        void this.drain();
      }
      if (followUp?.mode === "follow-up") {
        const run = this.status(agentRunId);
        const transcriptRef = { type: "pi-jsonl", sessionId: followUp.sessionId, file: followUp.sessionFile };
        const scanned = scanChildOutput(followUp.text, {
          agentRunId,
          attemptId: run.attemptId,
          label: run.label,
          transcriptRef,
        });
        await this.emit("agent.usage.updated", { usage: followUp.usage }, { agentRunId });
        await this.emit("agent.result.completed", {
          result: scanned,
          transcriptRef,
          artifacts: scanned.artifactRefs,
          elapsedMs: run.elapsedMs,
        }, { agentRunId, flush: true });
      }
      return { agentRunId, delivered: true, mode: followUp?.mode ?? "follow-up", turns: followUp?.turns };
  }

  async wait(agentRunId, options = {}) {
    const run = this.snapshot()?.agents?.[agentRunId];
    if (!run) throw new Error(`Agent run not found: ${agentRunId}.`);
    if (TERMINAL_AGENT_STATES.has(run.status)) return run;
    const timeoutMs = Math.max(0, Number(options.timeoutMs) || 0);
    const result = this.resultPromise(agentRunId);
    if (!timeoutMs) return result;
    return Promise.race([result, new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out waiting for agent ${agentRunId}.`)), timeoutMs))]);
  }

  status(agentRunId) {
    if (!agentRunId) return this.snapshot();
    const run = this.snapshot()?.agents?.[agentRunId];
    if (!run) throw new Error(`Agent run not found: ${agentRunId}.`);
    return run;
  }

  async interruptAndSend(agentRunId, message) {
    if (this.status(agentRunId).workflowRunId) throw new Error('Use the workflow scheduler to replace a workflow task.');
    const previousExecution = this.agentExecutions.get(agentRunId) || this.followUpChains.get(agentRunId);
    await this.stop(agentRunId, 'Interrupted by another agent.', { kind: 'interrupted', source: 'agent', threadId: this.rootThreadId });
    await previousExecution;
    return this.resume(agentRunId, message);
  }

  async stop(agentRunId, reason = "stopped by root", interruption = { kind: 'stopped', source: 'system' }) {
    const stoppingRun = this.snapshot()?.agents?.[agentRunId];
    if (stoppingRun && !TERMINAL_AGENT_STATES.has(stoppingRun.status)) {
      this.interruptions.set(agentRunId, interruption);
      for (const listener of this.sessionListeners) listener({ agentRunId, event: { type: 'zyra_agent_interruption', interruption } });
    }
    const children = [...(this.cancellation.nodes.get(agentRunId)?.children || [])];
    await Promise.allSettled(children.map(id => this.stop(id, reason, interruption)));
    const queuedIndex = this.queue.findIndex((item) => item.run.agentRunId === agentRunId);
    const wasQueued = queuedIndex >= 0;
    if (wasQueued) this.queue.splice(queuedIndex, 1);
    await this.cancellation.cancel(agentRunId, reason);
    if (!this.followUps.has(agentRunId)) {
      this.completedHosts.get(agentRunId)?.dispose?.();
      this.completedHosts.delete(agentRunId);
    }
    const run = this.snapshot()?.agents?.[agentRunId];
    if (run && !TERMINAL_AGENT_STATES.has(run.status)) {
      await this.emit("agent.failed", { status: "cancelled", error: { message: reason, interruption } }, { agentRunId, flush: true });
      this.resolveWaiters(agentRunId, this.snapshot().agents[agentRunId]);
    }
    if (wasQueued || !this.active.has(agentRunId) && !this.launching.has(agentRunId) && !this.followUps.has(agentRunId)) this.cancellation.remove(agentRunId);
    return this.snapshot()?.agents?.[agentRunId];
  }

  async retry(agentRunId, overrides = {}) {
    const previous = this.status(agentRunId);
    if (!TERMINAL_AGENT_STATES.has(previous.status) && previous.status !== "interrupted" && previous.status !== "recovering") {
      throw new Error("Only terminal, interrupted, or recovering agents can retry.");
    }
    return this.spawn({
      ...previous,
      ...overrides,
      goal: overrides.goal ?? previous.goal,
      model: overrides.model ?? previous.requestedModel,
      agentRunId,
      attempt: previous.attempt + 1,
      background: overrides.background ?? true,
      retryOfAttemptId: previous.attemptId,
      controlLease: overrides.controlLease,
    });
  }

  async resume(agentRunId, message) {
    const previous = this.status(agentRunId);
    return this.retry(agentRunId, { sessionFile: previous.sessionFile, goal: message ?? previous.goal, background: true });
  }

  async getTranscript(agentRunId, options = {}) {
    const run = this.status(agentRunId);
    if (!run.sessionFile) throw new Error("Child transcript is not available yet.");
    return this.transcripts.page(run.sessionFile, options);
  }

  async inspectSession(agentRunId) {
    const run = this.status(agentRunId);
    const host = this.active.get(agentRunId)?.host || this.completedHosts.get(agentRunId);
    let messages;
    if (host?.sessionResult?.session) messages = host.requireSession().messages.slice(-500);
    else {
      const page = await this.getTranscript(agentRunId, { limit: 200 });
      messages = page.entries.flatMap(entry => entry.type === 'message' ? [entry.message]
        : entry.type === 'custom_message' ? [{ role: 'custom', customType: entry.customType, content: entry.content, details: entry.details, display: entry.display, timestamp: Date.parse(entry.timestamp) }] : []);
    }
    const runtimeMode = run.permissionMode === 'full-access' ? 'full-access' : run.permissionMode === 'writer' ? 'edits-only' : 'approval-required';
    return { threadId: run.providerSessionId, providerThreadId: run.providerSessionId, sessionFile: run.sessionFile,
      sessionName: run.label, cwd: run.cwd, model: run.selectedModel, thinking: run.effort,
      profile: 'default', runtimeMode, agentPermissionMode: run.permissionMode, webSearch: false, webFetch: false, messages,
      config: { model: run.selectedModel, thinking: run.effort, profile: 'default', runtimeMode, webSearch: false, webFetch: false },
      usage: run.usage, agentRunId, agentCreatedBy: this.rootThreadId };
  }

  async chatPrompt(agentRunId, prompt) {
    const active = this.active.get(agentRunId);
    if (active || this.launching.has(agentRunId) || this.followUps.has(agentRunId)) throw new Error('This agent is already working. Send a follow-up or interrupt it first.');
    if (this.completedHosts.has(agentRunId)) return this.send(agentRunId, prompt);
    await this.resume(agentRunId, prompt);
    const run = await this.wait(agentRunId);
    if (run.status !== 'completed') throw new Error(run.error?.message || `The agent finished with state ${run.status}.`);
    return { agentRunId, delivered: true };
  }

  async cancelAll(reason = "root cancelled") {
    const rootId = this.cancellationRootId;
    const runIds = [];
    const collect = (id) => {
      for (const childId of this.cancellation.nodes.get(id)?.children ?? []) {
        runIds.push(childId);
        collect(childId);
      }
    };
    collect(rootId);
    // AbortController is one-shot. New turns need a fresh root while old spawns
    // retain their cancelled parent, including those not yet in the queue.
    if (!this.disposed) {
      this.cancellationRootId = randomUUID();
      this.cancellation.create(this.cancellationRootId);
    }
    await this.cancellation.cancel(rootId, reason);
    await Promise.allSettled(runIds.map((id) => this.stop(id, reason)));
    this.cancellation.remove(rootId);
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    await this.cancelAll("fleet disposed");
    await Promise.allSettled([...this.executions]);
    for (const host of this.completedHosts.values()) host.dispose?.();
    this.completedHosts.clear();
    await this.cancellation.dispose();
    await this.workflowRuntime?.dispose?.();
    this.unsubscribeEventStore?.();
    await this.eventStore.flush();
  }

  async recover(snapshot) {
    const plan = planFleetRecovery(snapshot);
    for (const runId of plan.staleWriteLockRunIds) this.workspaceGuard.release(runId);
    for (const event of plan.events) await this.emit(event.type, event.payload, event);
    await this.emit("recovery.changed", {
      recoveredAt: plan.recoveredAt,
      interruptedAgentRunIds: plan.interruptedAgentRunIds,
      interruptedWorkflowRunIds: plan.interruptedWorkflowRunIds,
      resumedAutomatically: false,
    }, { flush: true });
    return plan;
  }

  async drain() {
    if (this.disposed) return;
    const childCapacity = this.maxSessions - 1;
    while (this.active.size + this.launching.size + this.followUps.size < childCapacity && this.queue.length) {
      const item = this.queue.shift();
      this.launching.add(item.run.agentRunId);
      const execution = this.execute(item);
      this.agentExecutions.set(item.run.agentRunId, execution);
      this.executions.add(execution);
      void execution.finally(() => { this.executions.delete(execution); if (this.agentExecutions.get(item.run.agentRunId) === execution) this.agentExecutions.delete(item.run.agentRunId); });
    }
  }

  async execute(item) {
    const { run, route, request, delegatedControl, controlSession } = item;
    const agentRunId = run.agentRunId;
    let lock;
    let worktree;
    const startedAt = Date.now();
    try {
      this.throwIfCancelled(agentRunId);
      await this.emit("agent.attempt.started", {
        status: "starting", attempt: run.attempt, attemptId: run.attemptId, retryOfAttemptId: request.retryOfAttemptId, startedAt: new Date(startedAt).toISOString(),
      }, { agentRunId, flush: true });
      // A late spawn can attach to an already-cancelled root after agent.created.
      // Do not initialize a worktree, writer lock, or child session for it.
      this.throwIfCancelled(agentRunId);
      if (run.isolation === "worktree") {
        worktree = await this.worktreeManager.create(agentRunId, { fleetId: this.fleetId });
        run.cwd = worktree.directory;
      } else if (["writer", "full-access"].includes(run.permissionMode)) {
        lock = await this.workspaceGuard.acquire(agentRunId, run.writeScope, { wait: true, signal: this.cancellation.signal(agentRunId) });
      }
      this.throwIfCancelled(agentRunId);
      const active = { run, route, request, host: null, lock, worktree };
      this.active.set(agentRunId, active);
      this.launching.delete(agentRunId);
      await this.emit("agent.state.changed", { status: "running", startedAt: new Date(startedAt).toISOString(), heartbeatAt: new Date().toISOString() }, { agentRunId });
      const result = await this.runner.run(run, {
        senderThreadId: run.parentAgentRunId ? `agent-run:${run.parentAgentRunId}` : this.rootThreadId,
        senderCanonicalThreadId: run.parentAgentRunId
          ? this.snapshot().agents[run.parentAgentRunId]?.providerSessionId || this.rootSessionId
          : this.rootSessionId,
        senderLabel: run.parentAgentRunId ? this.snapshot().agents[run.parentAgentRunId]?.label || 'Zyra' : this.rootSession?.sessionManager?.getSessionName?.() || 'Zyra',
        model: route.selectedModel,
        sessionFile: request.sessionFile,
        signal: this.cancellation.signal(agentRunId),
        controlClient: controlSession?.client,
        threadClient: this.threadBridgeClient?.forAgent(agentRunId),
        onSessionEvent: event => {
          if (event?.type === 'zyra_agent_interruption' && event.interruption) this.interruptions.set(agentRunId, event.interruption);
          const interruption = this.interruptions.get(agentRunId);
          if (event?.type === 'agent_end' && interruption) event = { ...event, outcome: 'interrupted', interruption };
          for (const listener of this.sessionListeners) listener({ agentRunId, event });
        },
        controlLease: delegatedControl?.grant,
        onLinked: async (linked) => {
          active.host = linked.host ?? active.host;
          this.cancellation.addCleanup(agentRunId, reason => active.host?.abort?.(reason));
          await this.emit("agent.session.linked", {
            providerSessionId: linked.sessionId,
            sessionFile: linked.sessionFile,
            transcriptRef: { type: "pi-jsonl", sessionId: linked.sessionId, file: linked.sessionFile },
            cwd: run.cwd,
            worktree,
          }, { agentRunId, flush: true });
        },
        onActivity: (activity) => void this.emit("agent.activity", { activity }, { agentRunId }),
        onHeartbeat: (heartbeatAt) => void this.emit("agent.state.changed", { status: "running", heartbeatAt }, { agentRunId }),
      });
      active.host = result.host;
      const transcriptRef = { type: "pi-jsonl", sessionId: result.sessionId, file: result.sessionFile };
      const scanned = scanChildOutput(result.text, { agentRunId, attemptId: run.attemptId, label: run.label, transcriptRef });
      let worktreeResult = worktree;
      if (worktree) {
        const inspection = await this.worktreeManager.inspect(agentRunId);
        const overlaps = this.workspaceGuard.recordChangedFiles(agentRunId, inspection.changedFiles);
        worktreeResult = this.worktreeManager.markRetained(agentRunId);
        scanned.diffRefs = inspection.changedFiles.map((file) => ({ worktree: worktree.directory, file }));
        if (overlaps.length) scanned.warnings.push("overlapping_worktree_changes");
      }
      await this.emit("agent.usage.updated", { usage: result.usage }, { agentRunId });
      await this.emit("agent.result.completed", {
        result: scanned,
        transcriptRef,
        artifacts: scanned.artifactRefs,
        worktree: worktreeResult,
        elapsedMs: Date.now() - startedAt,
      }, { agentRunId, flush: true });
      this.completedHosts.set(agentRunId, result.host);
      this.resolveWaiters(agentRunId, this.snapshot().agents[agentRunId]);
    } catch (error) {
      const cancelled = error?.name === "AbortError" || error?.code === 'CHILD_MAX_TURNS' || this.cancellation.signal(agentRunId)?.aborted;
      await this.emit("agent.failed", {
        status: cancelled ? "cancelled" : "failed",
        error: { name: error?.name ?? "Error", message: error instanceof Error ? error.message : String(error), ...(error?.code ? { code: error.code } : {}), ...(cancelled && this.interruptions.has(agentRunId) ? { interruption: this.interruptions.get(agentRunId) } : {}) },
        elapsedMs: Date.now() - startedAt,
      }, { agentRunId, flush: true });
      this.resolveWaiters(agentRunId, this.snapshot().agents[agentRunId]);
    } finally {
      lock?.release?.();
      if (controlSession) await this.revokeDelegatedControl(agentRunId, controlSession, "agent run ended");
      this.launching.delete(agentRunId);
      this.active.delete(agentRunId);
      if (!this.completedHosts.has(agentRunId) && !(this.cancellation.nodes.get(agentRunId)?.children.size)) this.cancellation.remove(agentRunId);
      void this.drain();
    }
  }

  async delegateControlLease(agentRunId, childPrincipal, request) {
    const result = await this.controlBridgeClient.request({
      operation: "delegate_lease",
      parentGrantId: request.parentGrantId,
      childPrincipal,
      targetId: request.targetId,
      capabilities: request.capabilities,
      expiresAt: request.expiresAt,
      maxActions: request.maxActions,
      allowedOrigins: request.allowedOrigins,
      allowedExecutableIdentities: request.allowedExecutableIdentities,
    });
    const grant = result?.grant;
    if (!grant || typeof grant !== "object") throw new Error("The control broker returned no delegated grant.");
    const principal = assertControlPrincipal(grant.principal);
    if (principal.type !== "agent" || principal.fleetId !== this.fleetId || principal.agentRunId !== agentRunId || principal.parentThreadId !== this.rootThreadId) {
      throw new Error("The control broker returned a lease for another child principal.");
    }
    assertControlIdentifier(grant.grantId, "grantId");
    if (grant.parentGrantId !== request.parentGrantId || grant.targetId !== request.targetId || grant.issuedBy !== "delegated-parent") {
      throw new Error("The control broker returned a lease outside the requested parent or target scope.");
    }
    const client = typeof this.controlBridgeClient.forPrincipal === "function"
      ? this.controlBridgeClient.forPrincipal(childPrincipal)
      : Object.freeze({ request: (operation, options = {}) => this.controlBridgeClient.request(operation, { ...options, principal: childPrincipal }) });
    return { grant, childPrincipal, client, revoked: false, revoking: false };
  }

  async revokeDelegatedControl(agentRunId, delegatedControl, reason) {
    if (!delegatedControl || delegatedControl.revoked || delegatedControl.revoking) return;
    delegatedControl.revoking = true;
    try {
      await delegatedControl.client.request({ operation: "revoke_current_principal", reason });
      delegatedControl.revoked = true;
      const run = this.snapshot()?.agents?.[agentRunId];
      if (run?.controlLease) {
        await this.emit("agent.state.changed", {
          controlLease: { ...run.controlLease, state: "revoked" },
        }, { agentRunId });
      }
    } catch (error) {
      await this.emit("agent.activity", {
        activity: {
          type: "control-lease-revocation-failed",
          message: error instanceof Error ? error.message : String(error),
        },
      }, { agentRunId });
    } finally {
      delegatedControl.revoking = false;
    }
  }

  resultPromise(agentRunId) {
    const terminal = this.snapshot()?.agents?.[agentRunId];
    if (terminal && TERMINAL_AGENT_STATES.has(terminal.status)) return Promise.resolve(terminal);
    return new Promise((resolve) => {
      const list = this.waiters.get(agentRunId) ?? [];
      list.push(resolve);
      this.waiters.set(agentRunId, list);
    });
  }

  resolveWaiters(agentRunId, result) {
    for (const resolve of this.waiters.get(agentRunId) ?? []) resolve(result);
    this.waiters.delete(agentRunId);
  }

  async emit(type, payload, refs = {}) {
    return this.eventStore.append(type, payload, refs);
  }

  throwIfCancelled(agentRunId) {
    const signal = this.cancellation.signal(agentRunId);
    if (signal?.aborted) {
      const error = new Error(`Child agent cancelled${signal.reason ? `: ${signal.reason}` : ""}.`);
      error.name = "AbortError";
      throw error;
    }
  }

  assertUsable() {
    if (this.disposed) throw new Error("Agent fleet is disposed.");
  }
}

function normalizeControlLeaseRequest(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("controlLease must be an object.");
  const expiresAtMs = Date.parse(String(value.expiresAt ?? ""));
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) throw new Error("controlLease.expiresAt must be a future timestamp.");
  const maxActions = Number(value.maxActions);
  if (!Number.isSafeInteger(maxActions) || maxActions < 1) throw new Error("controlLease.maxActions must be a positive integer.");
  return {
    parentGrantId: assertControlIdentifier(value.parentGrantId, "parentGrantId"),
    targetId: assertControlIdentifier(value.targetId, "targetId"),
    capabilities: assertControlCapabilities(value.capabilities),
    expiresAt: new Date(expiresAtMs).toISOString(),
    maxActions,
    allowedOrigins: normalizeLeaseScope(value.allowedOrigins, "allowedOrigins"),
    allowedExecutableIdentities: normalizeLeaseScope(value.allowedExecutableIdentities, "allowedExecutableIdentities"),
  };
}

function normalizeLeaseScope(value, label) {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > 32 || value.some((entry) => typeof entry !== "string" || !entry.trim())) {
    throw new Error(`controlLease.${label} must be a bounded string array.`);
  }
  return [...new Set(value.map((entry) => entry.trim()))];
}

function summarizeControlGrant(grant) {
  return {
    version: 1,
    grantId: grant.grantId,
    parentGrantId: grant.parentGrantId,
    targetId: grant.targetId,
    capabilities: [...grant.capabilities],
    allowedOrigins: grant.allowedOrigins,
    allowedExecutableIdentities: grant.allowedExecutableIdentities,
    issuedAt: grant.issuedAt,
    expiresAt: grant.expiresAt,
    maxActions: grant.maxActions,
    actionCount: grant.actionCount,
    state: grant.state,
    issuedBy: grant.issuedBy,
  };
}
