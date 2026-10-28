import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Type } from 'typebox';
import { installZyraNextTurnCheckpoint } from '../src/zyra-next-turn-checkpoint.mjs';
import { createContextManagementTool } from '../src/context-management.mjs';
import { createAgentSession } from '../src/runtime/engine/source/core/sdk.ts';
import { DefaultResourceLoader } from '../src/runtime/engine/source/core/resource-loader.ts';
import { SettingsManager } from '../src/runtime/engine/source/core/settings-manager.ts';
import { SessionManager } from '../src/runtime/engine/source/core/session-manager.ts';
import { AssistantMessageEventStream } from '../src/runtime/providers/source/utils/event-stream.ts';

// bun scripts/test-context-management.mjs. Synthetic completions, isolated in-memory histories.
const directory = await mkdtemp(path.join(tmpdir(), 'zyra-context-test-'));
const model = { id: 'fixture', provider: 'fixture', api: 'fixture', name: 'Fixture', baseUrl: 'https://fixture.invalid', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, maxTokens: 1024, contextWindow: 8192 };
const usage = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const answer = (content, stopReason = 'stop') => ({ role: 'assistant', content: typeof content === 'string' ? [{ type: 'text', text: content }] : content, stopReason, usage, api: 'fixture', provider: 'fixture', model: 'fixture', timestamp: Date.now() });
function streamAnswer(message) {
  const stream = new AssistantMessageEventStream();
  queueMicrotask(() => {
    stream.push({ type: 'start', partial: message });
    stream.push({ type: 'done', reason: message.stopReason, message });
    stream.end();
  });
  return stream;
}
const hidden = text => ({ role: 'custom', customType: 'synthetic_hidden_context', content: text, display: false, timestamp: Date.now() });
const sessions = [];
async function fixture({ mode = 'success', keepRecentTokens = 256, seed = true, infer } = {}) {
  let session;
  let modelCalls = 0;
  let summaryCalls = 0;
  let requestCalls = 0;
  let previousHookCalls = 0;
  let auth = true;
  const observedContexts = [];
  const manager = SessionManager.inMemory(directory);
  if (seed) {
    manager.appendMessage({ role: 'user', content: `prior synthetic history ${'h'.repeat(1200)}`, timestamp: 1 });
    manager.appendMessage(answer(`prior completed work ${'d'.repeat(800)}`));
  }
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false, reserveTokens: 1024, keepRecentTokens }, retry: { enabled: false } });
  const resourceLoader = new DefaultResourceLoader({ cwd: directory, agentDir: directory, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, systemPrompt: 'Synthetic context safety test.' });
  await resourceLoader.reload();
  const tool = createContextManagementTool({ getSession: () => session });
  const originalExecute = tool.execute;
  tool.execute = async (...args) => {
    requestCalls++;
    const before = summaryCalls;
    const result = await originalExecute(...args);
    assert.equal(summaryCalls, before, 'Tool execution must never run compaction');
    assert.equal(result.details.status, 'pending');
    assert.equal(session.requestContextCompaction().status, 'pending', 'Same-batch requests coalesce');
    return result;
  };
  const evidence = { name: 'evidence', label: 'Evidence', description: 'Synthetic batch evidence', parameters: Type.Object({}), execute: async () => {
    await Promise.resolve();
    assert.equal(summaryCalls, 0, 'Maintenance must wait for the entire batch');
    return { content: [{ type: 'text', text: `BATCH_EVIDENCE ${'e'.repeat(500)}` }], details: {} };
  } };
  const modelRuntime = { hasConfiguredAuth: () => auth, checkAuth: async () => undefined, isUsingOAuth: () => false, getAuth: async () => undefined };
  ({ session } = await createAgentSession({ cwd: directory, agentDir: directory, model, modelRuntime, settingsManager, resourceLoader, sessionManager: manager, tools: ['context', 'evidence'], customTools: [tool, evidence] }));
  sessions.push(session);
  session.compact = () => { throw new Error('Public compact must never be called from a tool'); };
  const originalPrepare = session.agent.prepareNextTurnWithContext;
  session.agent.prepareNextTurnWithContext = async (...args) => {
    const snapshot = await originalPrepare(...args);
    previousHookCalls++;
    return snapshot;
  };
  session.agent.streamFunction = (_model, context, options) => {
    if (options?.toolChoice === 'none') {
      summaryCalls++;
      const saved = manager.getEntries().filter(entry => entry.type === 'message').map(entry => entry.message);
      assert.equal(saved.filter(message => message.role === 'toolResult').length, 2, 'Both results are persisted before summary generation');
      if (mode === 'cancel') session.agent.abort();
      return streamAnswer(answer(mode === 'empty' ? '   ' : 'Goal: finish the same synthetic task. Preserve constraints and next steps.', mode === 'truncated' ? 'length' : 'stop'));
    }
    modelCalls++;
    observedContexts.push(context);
    if (infer) return infer({ session, context, options, modelCalls, streamAnswer, answer });
    if (modelCalls === 1) return streamAnswer(answer([
      { type: 'toolCall', id: 'ctx-1', name: 'context', arguments: { action: 'compact' } },
      { type: 'toolCall', id: 'evidence-1', name: 'evidence', arguments: {} },
    ], 'toolUse'));
    if (mode === 'repeat' && modelCalls === 2) return streamAnswer(answer([{ type: 'toolCall', id: 'ctx-2', name: 'context', arguments: { action: 'compact' } }], 'toolUse'));
    return streamAnswer(answer('Finished the SAME task using BATCH_EVIDENCE.'));
  };
  return { session, manager, tool, observedContexts, setAuth: value => { auth = value; }, counts: () => ({ modelCalls, summaryCalls, requestCalls, previousHookCalls }) };
}
try {
  const primary = await fixture();
  const child = await fixture();
  assert.notEqual(primary.session.inspectContext().sessionId, child.session.inspectContext().sessionId);
  const childBefore = child.manager.getEntries();
  await primary.session.prompt('Continue the synthetic task.');
  assert.equal(primary.session.inspectContext().compaction.status, 'completed', JSON.stringify(primary.session.inspectContext().compaction));
  assert.deepEqual(child.manager.getEntries(), childBefore, 'Primary context cannot mutate child context');
  assert.equal(child.session.inspectContext().compaction.status, 'idle');
  const next = primary.observedContexts[1].messages;
  assert.equal(next.filter(message => message.role === 'toolResult').length, 2);
  assert.ok(next.some(message => message.role === 'assistant' && message.content.some(block => block.type === 'toolCall' && block.id === 'ctx-1')));
  assert.ok(primary.counts().summaryCalls > 0);
  assert.equal(primary.counts().modelCalls, 2, 'Compaction continues the existing run exactly once');
  assert.equal(primary.manager.getEntries().filter(entry => entry.type === 'compaction').length, 1);
  await child.session.prompt('Child continues its own task.');
  assert.equal(child.session.inspectContext().compaction.status, 'completed');
  assert.equal(primary.manager.getEntries().filter(entry => entry.type === 'compaction').length, 1);
  await assert.rejects(primary.tool.execute('foreign', { action: 'inspect', target: child.session.sessionId }), /only accepts/);
  assert.throws(() => primary.session.requestContextCompaction({ target: child.session.sessionId }), /only instructions/);

  for (const mode of ['empty', 'truncated']) {
    const test = await fixture({ mode });
    await test.session.prompt('Continue after failed maintenance.');
    assert.equal(test.session.inspectContext().compaction.status, 'failed');
    assert.equal(test.manager.getEntries().filter(entry => entry.type === 'compaction').length, 0);
    assert.ok(test.observedContexts[1].messages.some(message => message.role === 'user' && JSON.stringify(message.content).includes('prior synthetic history')), 'Original history remains after summary failure');
    assert.equal(test.observedContexts[1].messages.filter(message => message.role === 'toolResult').length, 2);
  }
  // Host-resolved thresholds are honored between tool batches, before the next inference.
  const automatic = await fixture({ infer: ({ modelCalls, streamAnswer, answer }) => {
    if (modelCalls === 1) {
      const message = answer([
        { type: 'toolCall', id: 'evidence-a', name: 'evidence', arguments: {} },
        { type: 'toolCall', id: 'evidence-b', name: 'evidence', arguments: {} },
      ], 'toolUse');
      message.usage = { ...message.usage, input: 295, output: 5, totalTokens: 300 };
      return streamAnswer(message);
    }
    return streamAnswer(answer('automatic done'));
  } });
  const autoEvents = [];
  automatic.session.subscribe(event => { if (event.type.startsWith('compaction')) autoEvents.push(event); });
  automatic.session.setAutoCompactionEnabled(true);
  automatic.session.getContextCompactionPolicy = () => ({ thresholdTokens: 100, contextWindow: 8192, maxThresholdTokens: 7168, source: 'override' });
  assert.equal(automatic.session.inspectContext().policy.thresholdTokens, 100);
  await automatic.session.prompt('Automatic checkpoint before continuation.');
  assert.equal(automatic.counts().modelCalls, 2);
  assert.equal(automatic.manager.getEntries().filter(entry => entry.type === 'compaction').length, 1, JSON.stringify({ events: autoEvents, counts: automatic.counts(), inspect: automatic.session.inspectContext() }));
  assert.ok(automatic.observedContexts[1].messages.some(message => JSON.stringify(message.content).includes('synthetic task')));
  const diagnosed = createContextManagementTool({ getSession: () => automatic.session, getDiagnostics: async () => ({ policy: 'safe own diagnostics', requests: 2 }) });
  assert.equal((await diagnosed.execute('inspect', { action: 'inspect' })).details.diagnostics.requests, 2);

  const repeated = await fixture({ mode: 'repeat' });
  await repeated.session.prompt('Finish despite a repeated compact request.');
  assert.equal(repeated.counts().modelCalls, 3);
  assert.equal(repeated.manager.getEntries().filter(entry => entry.type === 'compaction').length, 1);
  assert.ok(repeated.session.messages.some(message => message.role === 'toolResult' && message.toolCallId === 'ctx-2' && message.isError));
  const cancelled = await fixture({ mode: 'cancel' });
  await cancelled.session.prompt('Cancel only the synthetic run.');
  assert.equal(cancelled.counts().modelCalls, 1, 'Abort during summary must not make a final inference');
  assert.equal(cancelled.session.inspectContext().compaction.status, 'cancelled');
  assert.equal(cancelled.manager.getEntries().filter(entry => entry.type === 'compaction').length, 0);

  // Atomic hidden turn context: failed auth creates neither a user entry nor an orphan aside.
  const atomic = await fixture({ seed: false, infer: ({ streamAnswer, answer }) => streamAnswer(answer('ok')) });
  atomic.setAuth(false);
  const before = atomic.manager.getEntries();
  await assert.rejects(atomic.session.prompt('unauthorized', { contextMessages: [hidden('must not persist')] }));
  assert.deepEqual(atomic.manager.getEntries(), before);
  atomic.setAuth(true);
  atomic.session.getContextCompactionPolicy = () => ({ thresholdTokens: 50, contextWindow: 8192, usableContextWindow: 128 });
  const rejectedBefore = atomic.manager.getEntries();
  await assert.rejects(atomic.session.prompt('oversized', { contextMessages: [hidden('x'.repeat(1024))] }), /safe input budget/);
  await assert.rejects(atomic.session.prompt('oversized image', { images: [{ type: 'image', mimeType: 'image/png', data: 'synthetic' }] }), /safe input budget/);
  assert.deepEqual(atomic.manager.getEntries(), rejectedBefore, 'Rejected prompt context and images cannot orphan hidden history');
  assert.equal(atomic.counts().modelCalls, 0);
  assert.equal(atomic.session.inspectContext().inputBudgetTokens, 128);
  assert.equal(atomic.session.inspectContext().headroomTokens, 8064);
  assert.equal(atomic.session.inspectContext().remainingTokens, 128);
  atomic.session.getContextCompactionPolicy = () => ({ thresholdTokens: 4096, contextWindow: 8192, usableContextWindow: 7168 });
  await atomic.session.prompt('original user text', { contextMessages: [hidden('memory context')] });
  assert.deepEqual(atomic.session.messages.map(message => message.role), ['user', 'custom', 'assistant']);
  assert.equal(atomic.session.messages[0].content[0].text, 'original user text');
  assert.equal(atomic.session.messages[1].display, false);
  assert.equal(atomic.session.systemPrompt.includes('memory context'), false);

  // one-at-a-time drains whole prompt batches, with no detached context-only inference.
  for (const streamingBehavior of ['steer', 'followUp']) {
    let release;
    let entered;
    const ready = new Promise(resolve => { entered = resolve; });
    const queued = await fixture({ seed: false, infer: ({ context, modelCalls, streamAnswer, answer }) => {
      if (modelCalls !== 1) return streamAnswer(answer('queue done'));
      const stream = new AssistantMessageEventStream();
      release = () => { const message = answer('initial done'); stream.push({ type: 'done', reason: 'stop', message }); stream.end(); };
      entered();
      return stream;
    } });
    queued.session.agent.steeringMode = 'one-at-a-time';
    queued.session.agent.followUpMode = 'one-at-a-time';
    const run = queued.session.prompt('initial');
    await ready;
    queued.session.getContextCompactionPolicy = () => ({ thresholdTokens: 50, contextWindow: 8192, usableContextWindow: 128 });
    const entriesBeforeOversize = queued.manager.getEntries();
    await assert.rejects(queued.session.prompt('oversized queued', { streamingBehavior, contextMessages: [hidden('x'.repeat(1024))] }), /safe input budget/);
    assert.equal(queued.session.inspectContext().pendingPromptCount, 0, 'Oversized queued prompts cannot leak into either queue');
    assert.deepEqual(queued.manager.getEntries(), entriesBeforeOversize);
    queued.session.getContextCompactionPolicy = () => ({ thresholdTokens: 4096, contextWindow: 8192, usableContextWindow: 7168 });
    await queued.session.prompt('queued one', { streamingBehavior, contextMessages: [hidden('context one')] });
    await queued.session.prompt('queued two', { streamingBehavior, contextMessages: [hidden('context two')] });
    release();
    await run;
    assert.equal(queued.counts().modelCalls, 3);
    const texts = context => context.messages.map(message => typeof message.content === 'string' ? message.content : message.content?.map(block => block.text ?? '').join('')).join('\n');
    assert.match(texts(queued.observedContexts[1]), /queued one\ncontext one/);
    assert.doesNotMatch(texts(queued.observedContexts[1]), /context two/);
    assert.match(texts(queued.observedContexts[2]), /queued two\ncontext two/);
  }
  // Root host wrappers cannot retry an invalid explicit checkpoint in the same
  // batch, even if the provider usage is above the automatic threshold.
  const rootFailure = await fixture({ mode: 'empty', infer: ({ modelCalls, streamAnswer, answer }) => {
    const message = modelCalls === 1 ? answer([
      { type: 'toolCall', id: 'root-context', name: 'context', arguments: { action: 'compact' } },
      { type: 'toolCall', id: 'root-evidence', name: 'evidence', arguments: {} },
    ], 'toolUse') : answer('Continue after failed maintenance');
    message.usage = { ...message.usage, input: 295, output: 5, totalTokens: 300 };
    return streamAnswer(message);
  } });
  rootFailure.session.setAutoCompactionEnabled(true);
  rootFailure.session.getContextCompactionPolicy = () => ({ thresholdTokens: 100, contextWindow: 8192, usableContextWindow: 7168 });
  installZyraNextTurnCheckpoint(rootFailure.session, { hasAutoPollJobs: () => false });
  await rootFailure.session.prompt('Keep working after a failed checkpoint.');
  assert.equal(rootFailure.counts().summaryCalls, 1, 'Outer checkpoint and post-run hook cannot bypass the attempted-compaction guard');
  assert.equal(rootFailure.counts().modelCalls, 2);

  // Context extensions execute before the final provider-budget validation.
  const extensionPressure = await fixture({ seed: false, infer: ({ streamAnswer, answer }) => streamAnswer(answer('unexpected inference')) });
  extensionPressure.session.getContextCompactionPolicy = () => ({ thresholdTokens: 7000, contextWindow: 8192, usableContextWindow: 7168 });
  extensionPressure.session.extensionRunner.emitContext = async messages => [...messages, hidden('extension-content'.repeat(4000))];
  await extensionPressure.session.prompt('Small original prompt');
  assert.equal(extensionPressure.counts().modelCalls, 0, 'An extension cannot append unchecked context after the budget guard');
  assert.match(extensionPressure.session.messages.findLast(message => message.role === 'assistant').errorMessage, /safe input budget/);

  // Several individually valid queued batches cannot exceed the provider budget
  // together and cause an unguarded inference. No provider call is made for them.
  let releaseBudget;
  let markBudgetEntered;
  const budgetEntered = new Promise(resolve => { markBudgetEntered = resolve; });
  const pressure = await fixture({ seed: false, infer: ({ streamAnswer, answer, modelCalls }) => {
    if (modelCalls !== 1) return streamAnswer(answer('unexpected inference'));
    const stream = new AssistantMessageEventStream();
    releaseBudget = () => { const message = answer('initial done'); stream.push({ type: 'done', reason: 'stop', message }); stream.end(); };
    markBudgetEntered(); return stream;
  } });
  pressure.session.agent.followUpMode = 'all';
  const pressuredRun = pressure.session.prompt('initial');
  await budgetEntered;
  const overhead = Math.ceil((pressure.session.systemPrompt.length + JSON.stringify(pressure.session.agent.state.tools.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters }))).length) / 4);
  pressure.session.getContextCompactionPolicy = () => ({ thresholdTokens: overhead + 300, contextWindow: 8192, usableContextWindow: overhead + 500 });
  for (let i = 0; i < 3; i++) await pressure.session.prompt(`queued ${i}`, { streamingBehavior: 'followUp', contextMessages: [hidden('q'.repeat(1000))] });
  releaseBudget();
  let budgetFailure;
  try { await pressuredRun; } catch (error) { budgetFailure = error; }
  const budgetMessage = pressure.session.messages.findLast(message => message.role === 'assistant');
  assert.match(budgetFailure?.message || budgetMessage?.errorMessage || '', /safe input budget/);
  if (!budgetFailure) assert.equal(budgetMessage.stopReason, 'error');
  assert.equal(pressure.counts().modelCalls, 1, 'Combined queue pressure cannot make a provider call over budget');
  console.log('Context management: own primary/child sessions, safe full-batch checkpoint, failure preservation, bounded loop, abort, atomic prompt context and queued budgets: ok');
} finally {
  for (const session of sessions) session.dispose();
  await rm(directory, { recursive: true, force: true });
}
