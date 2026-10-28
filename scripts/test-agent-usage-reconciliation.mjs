import assert from 'node:assert/strict';
import { ChildSessionHost } from '../src/agents/runtime/child-session-host.mjs';
import { AgentRunner } from '../src/agents/runtime/agent-runner.mjs';
import { AgentFleetController } from '../src/agents/runtime/fleet-controller.mjs';
import { normalizeUsage } from '../src/agents/contracts.mjs';

function fixture(initial = [], { fail = false } = {}) {
  const entries = initial.map((message, index) => ({ type: 'message', id: `initial-${index}`, message }));
  let listener;
  let disposed = false;
  const session = {
    messages: initial.slice(),
    sessionManager: { getEntries: () => entries },
    subscribe(fn) { listener = fn; return () => { listener = null; }; },
    async prompt() {
      const timestamp = 100 + entries.length;
      const message = { role: 'assistant', timestamp, model: 'test', provider: 'test', stopReason: 'stop', content: 'result', usage: { input: 10, output: 5, cacheRead: 5, cacheWrite: 0, cost: { total: 0.1 } } };
      // Completion can precede persistence and may be replayed afterward.
      listener?.({ type: 'message_end', message });
      entries.push({ type: 'message', id: `new-${timestamp}`, message });
      session.messages.push(message);
      listener?.({ type: 'message_end', message: structuredClone(message) });
      if (fail) throw new Error('provider failed after billed tool request');
    },
    async sendCustomMessage() { return session.prompt(); },
    dispose() { disposed = true; },
  };
  const factory = { async create() { return { session, sessionId: 'session', sessionFile: 'fixture.jsonl' }; } };
  return { factory, session, entries, get disposed() { return disposed; } };
}

const first = fixture();
const host = new ChildSessionHost({ factory: first.factory });
await host.open();
const result = await host.run('first');
assert.equal(result.usage.inputTokens, 10);
assert.equal(result.usage.totalTokens, 20);
assert.equal(result.usage.requests, 1, 'replayed completion must not double bill');
assert.equal((await host.send('follow-up')).usage.requests, 2);

const failing = fixture([], { fail: true });
const runner = new AgentRunner({ sessionFactory: failing.factory });
let failure;
try { await runner.run({ goal: 'fail', attemptId: 'a', fleetId: 'f', maxTurns: 12, usage: normalizeUsage() }); } catch (error) { failure = error; }
assert.equal(failure?.usage?.totalTokens, 20, 'failed runner must capture usage before disposal');
assert.equal(failure?.usage?.requests, 1);
assert.equal(failing.disposed, true);

const restored = fixture(failing.session.messages);
const resumed = new ChildSessionHost({ factory: restored.factory, initialUsage: failure.usage });
await resumed.open();
assert.equal(resumed.resultSnapshot().usage.requests, 1, 'opening a transcript must not bill old requests again');
const resumedResult = await resumed.run('continue');
assert.equal(resumedResult.usage.requests, 2);
assert.equal(resumedResult.usage.totalTokens, 40);
const retry = new ChildSessionHost({ factory: fixture().factory, initialUsage: resumedResult.usage });
await retry.open();
assert.equal((await retry.run('new transcript')).usage.totalTokens, 60, 'retry in a fresh session must preserve earlier billed attempts');

// Exercise the controller error path without launching a model or touching disk.
const events = [];
const signal = new AbortController().signal;
const controller = Object.create(AgentFleetController.prototype);
Object.assign(controller, {
  active: new Map(), launching: new Set(['run']), completedHosts: new Map(), interruptions: new Map(),
  rootThreadId: 'root', rootSessionId: 'root', rootSession: {},
  cancellation: { signal: () => signal, nodes: new Map(), remove() {}, addCleanup() {} },
  runner: { async run() { throw failure; } },
  emit: async (type, payload) => { events.push({ type, payload }); },
  snapshot: () => ({ agents: { run: {} } }),
  resolveWaiters() {}, drain() {}, throwIfCancelled() {},
});
await controller.execute({ run: { agentRunId: 'run', attemptId: 'attempt', attempt: 1, permissionMode: 'read-only' }, route: {}, request: {} });
const usageIndex = events.findIndex(event => event.type === 'agent.usage.updated');
assert.ok(usageIndex >= 0);
assert.equal(events[usageIndex].payload.usage.totalTokens, 20);
assert.ok(usageIndex < events.findIndex(event => event.type === 'agent.failed'), 'usage must persist before terminal failure');

host.dispose(); resumed.dispose(); retry.dispose();
console.log('Child usage failure/resume reconciliation checks passed.');
