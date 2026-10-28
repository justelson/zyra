import { ChildSessionHost } from "./child-session-host.mjs";

export class AgentRunner {
  constructor(options = {}) {
    this.sessionFactory = options.sessionFactory;
    this.heartbeatMs = Math.max(1000, Number(options.heartbeatMs) || 10_000);
  }

  async run(run, options = {}) {
    if (options.signal?.aborted) throw abortError(options.signal.reason);
    const host = new ChildSessionHost({
      factory: this.sessionFactory,
      maxTurns: run.maxTurns,
      initialUsage: run.usage,
      onEvent: options.onSessionEvent,
      onActivity: options.onActivity,
    });
    const heartbeat = setInterval(() => options.onHeartbeat?.(new Date().toISOString()), this.heartbeatMs);
    heartbeat.unref?.();
    try {
      const linked = await host.open({
        cwd: run.cwd,
        sessionFile: options.sessionFile,
        parentSessionFile: options.parentSessionFile,
        model: options.model,
        effort: run.effort,
        tools: run.tools,
        permissionMode: run.permissionMode,
        readScope: run.readScope,
        writeScope: run.writeScope,
        successCriteria: run.successCriteria,
        controlClient: options.controlClient,
        threadClient: options.threadClient,
        controlLease: options.controlLease,
      });
      if (options.signal?.aborted) throw abortError(options.signal.reason);
      await options.onLinked?.({ ...linked, host });
      const result = await host.run(buildDelegatedPrompt(run), { signal: options.signal, delegation: {
        messageId: `agent-delegation:${run.attemptId}`,
        senderThreadId: options.senderThreadId || run.parentAgentRunId || run.fleetId,
        senderCanonicalThreadId: options.senderCanonicalThreadId,
        senderLabel: options.senderLabel || 'Zyra',
        recipientThreadId: linked.sessionId,
        text: run.goal,
        origin: 'delegation',
        taskLabel: run.label,
        createdAt: new Date().toISOString(),
      } });
      return { ...result, host };
    } catch (error) {
      // Capture billed requests before disposing the failed/cancelled session.
      // The controller persists this even when no successful result is returned.
      try { error.usage = host.resultSnapshot().usage; } catch { /* Opening may have failed before linking. */ }
      host.dispose();
      throw error;
    } finally {
      clearInterval(heartbeat);
    }
  }
}

function abortError(reason) {
  const error = new Error(`Child agent cancelled${reason ? `: ${reason}` : ""}.`);
  error.name = "AbortError";
  return error;
}

export function buildDelegatedPrompt(run) {
  return [
    `Delegated goal: ${run.goal}`,
    run.successCriteria?.length ? `Success criteria:\n${run.successCriteria.map((item) => `- ${item}`).join("\n")}` : "",
    run.readScope?.length ? `Read scope:\n${run.readScope.map((item) => `- ${item}`).join("\n")}` : "",
    run.writeScope?.length ? `Write scope:\n${run.writeScope.map((item) => `- ${item}`).join("\n")}` : "",
    run.controlLease ? `Delegated control lease: ${run.controlLease.grantId}\nTarget: ${run.controlLease.targetId}\nCapabilities: ${run.controlLease.capabilities.join(", ")}\nExpires: ${run.controlLease.expiresAt}` : "",
    `Attempt: ${run.attempt} (${run.attemptId})`,
    "Return only the bounded work result and evidence. Parent policy remains authoritative.",
  ].filter(Boolean).join("\n\n");
}
