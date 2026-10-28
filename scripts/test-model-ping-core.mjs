import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Type } from 'typebox';

// bun scripts/test-model-ping-core.mjs; after runtime:build:
// node scripts/test-model-ping-core.mjs --compiled
const compiled = process.argv.includes('--compiled');
const { Agent } = await import(compiled ? '../src/runtime/agent/src/agent.js' : '../src/runtime/agent/source/agent.ts');
const model = { id: 'fixture', name: 'Fixture', api: 'fixture', provider: 'fixture', baseUrl: '', reasoning: true, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, maxTokens: 100, contextWindow: 8192 };
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const answer = (content = [], stopReason = 'stop') => ({ role: 'assistant', content, stopReason, usage, api: 'fixture', provider: 'fixture', model: 'fixture', timestamp: Date.now() });
const recovery = () => ({ role: 'ping_fixture', content: 'Resume the same task without repeating completed tools.', timestamp: Date.now() });
const deferred = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; };
async function until(predicate, label) {
  for (let i = 0; i < 1000; i++) { if (predicate()) return; await delay(2); }
  throw new Error(`Timed out: ${label}`);
}
async function tick() { await delay(5); }

// Deliberately independent iterator/result settlement, unlike the usual provider helper.
function controlled() {
  const result = deferred();
  const queue = [];
  let ended = false, iteratorError;
  let wake;
  return {
    push(event) { queue.push(event); wake?.(); wake = undefined; },
    endIterator(error) { ended = true; iteratorError = error; wake?.(); wake = undefined; },
    settle(message) { result.resolve(message); },
    reject(error) { result.reject(error); },
    complete(message) { this.push({ type: 'done', reason: message.stopReason, message }); this.endIterator(); this.settle(message); },
    result: () => result.promise,
    async *[Symbol.asyncIterator]() {
      while (true) {
        if (queue.length) yield queue.shift();
        else if (ended) { if (iteratorError) throw iteratorError; return; }
        else await new Promise(resolve => { wake = resolve; });
      }
    },
  };
}
function finished(message) { const response = controlled(); response.push({ type: 'start', partial: answer() }); response.complete(message); return response; }
function fixture(streamFn, extra = {}) {
  const agent = new Agent({ initialState: { model }, streamFn, ...extra });
  const events = [];
  agent.subscribe(event => { events.push(event); });
  return { agent, events };
}
function assertOneLifecycle(events) {
  assert.equal(events.filter(e => e.type === 'agent_start').length, 1);
  assert.equal(events.filter(e => e.type === 'agent_end').length, 1);
  assert.equal(events.at(-1).type, 'agent_end');
}

// Completed tool work remains durable. Ping cancels only the current provider call.
{
  const stalled = controlled();
  const toolGate = deferred();
  let calls = 0, executions = 0, stalledSignal, oldRequestId, replacementContext;
  const { agent, events } = fixture((_model, context, options) => {
    calls++;
    if (calls === 1) return finished(answer([{ type: 'toolCall', id: 'once', name: 'once', arguments: {} }], 'toolUse'));
    if (calls === 2) { stalledSignal = options.signal; return stalled; }
    replacementContext = context.messages.slice();
    return finished(answer([{ type: 'text', text: 'Recovered.' }]));
  }, {
    initialState: { model, tools: [{ name: 'once', label: 'Once', description: 'Synthetic tool', parameters: Type.Object({}, { additionalProperties: false }), execute: async () => { executions++; await toolGate.promise; return { content: [{ type: 'text', text: 'Completed once' }], details: {} }; } }] },
    convertToLlm: messages => messages.map(message => message.role === 'ping_fixture' ? { ...message, role: 'user' } : message),
  });
  agent.subscribe(event => { if (event.type === 'model_request_progress' && event.progress && !oldRequestId) oldRequestId = event.progress.requestId; });
  const run = agent.prompt('Synthetic task');
  await until(() => executions === 1, 'tool starts');
  assert.equal(agent.modelRequestProgress, null, 'no model progress during tools');
  assert.throws(() => agent.pingModel(oldRequestId, recovery()), /safe|Stale/);
  toolGate.resolve();
  await until(() => calls === 2, 'second provider call');
  const partial = answer([{ type: 'thinking', thinking: 'Hidden reasoning' }]);
  stalled.push({ type: 'start', partial: answer() });
  stalled.push({ type: 'thinking_delta', contentIndex: 0, delta: 'Hidden reasoning', partial });
  await until(() => events.some(e => e.type === 'message_update'), 'reasoning is observed');
  const progress = agent.modelRequestProgress;
  assert.equal(progress.phase, 'streaming');
  assert.equal(progress.canPing, true);
  progress.canPing = false;
  assert.equal(agent.modelRequestProgress.canPing, true, 'getter returns a snapshot');
  assert.throws(() => agent.pingModel(oldRequestId, recovery()), /Stale/);
  const requestId = agent.modelRequestProgress.requestId;
  const marker = recovery();
  agent.pingModel(requestId, marker);
  assert.equal(agent.modelRequestProgress.phase, 'recovering');
  assert.equal(stalledSignal.aborted, true);
  assert.equal(agent.signal.aborted, false);
  assert.notEqual(stalledSignal, agent.signal);
  assert.throws(() => agent.pingModel(requestId, recovery()), /safely/);
  // Even a provider's late text/tool data is drained and discarded after acceptance.
  stalled.push({ type: 'text_delta', contentIndex: 0, delta: 'late', partial: answer([{ type: 'text', text: 'late' }]) });
  stalled.endIterator();
  await tick();
  assert.equal(calls, 2, 'result must settle after iterator completion');
  stalled.settle(answer([], 'aborted'));
  await run;
  assert.equal(calls, 3);
  assert.equal(executions, 1, 'completed tools are never replayed');
  assert.equal(events.filter(e => e.type === 'turn_start').length, 2, 'replacement stays in existing turn');
  assertOneLifecycle(events);
  assert.equal(events.filter(e => e.type === 'model_ping' && e.status === 'accepted').length, 1);
  assert.equal(events.filter(e => e.type === 'model_ping' && e.status === 'resumed').length, 1);
  const discarded = events.find(e => e.type === 'message_discarded');
  assert.ok(discarded);
  assert.equal(discarded.requestId, requestId);
  assert.ok(!events.some(e => e.type === 'message_end' && e.message === discarded.message));
  assert.ok(!agent.state.messages.some(m => m.role === 'assistant' && m.content.some(c => c.type === 'thinking')));
  assert.ok(!events.some(e => e.type === 'message_update' && e.assistantMessageEvent.delta === 'late'));
  assert.equal(agent.state.messages.filter(m => m === marker).length, 1);
  assert.ok(events.some(e => e.type === 'message_start' && e.message === marker));
  assert.ok(events.some(e => e.type === 'message_end' && e.message === marker));
  assert.equal(replacementContext.filter(m => m.role === 'toolResult').length, 1);
  assert.equal(replacementContext.at(-1).content, marker.content);
  assert.equal(agent.modelRequestProgress, null);
  assert.throws(() => agent.pingModel(requestId, recovery()));
}

// Reverse settlement order: a settled result cannot bypass a still-live iterator.
{
  const stalled = controlled();
  let calls = 0;
  const { agent, events } = fixture(() => ++calls === 1 ? stalled : finished(answer([{ type: 'text', text: 'Done' }])));
  const run = agent.prompt('Wait');
  await until(() => calls === 1, 'silent provider');
  agent.pingModel(agent.modelRequestProgress.requestId, recovery());
  stalled.settle(answer([], 'aborted'));
  await tick();
  assert.equal(calls, 1, 'iterator must settle after result completion');
  stalled.endIterator();
  await run;
  assert.equal(calls, 2);
  assertOneLifecycle(events);
}

// Cancellation may reject both provider surfaces. Recovery owns those errors.
{
  const stalled = controlled();
  let calls = 0;
  const { agent, events } = fixture(() => ++calls === 1 ? stalled : finished(answer([{ type: 'text', text: 'Recovered' }])));
  const run = agent.prompt('Wait');
  await until(() => calls === 1, 'rejecting provider');
  agent.pingModel(agent.modelRequestProgress.requestId, recovery());
  stalled.endIterator(new Error('Synthetic stream cancellation'));
  stalled.reject(new Error('Synthetic result cancellation'));
  await run;
  assert.equal(calls, 2);
  assert.equal(agent.state.messages.at(-1).stopReason, 'stop');
  assert.equal(agent.state.errorMessage, undefined);
  assertOneLifecycle(events);
}

// A provider may not return its stream immediately after accepting cancellation.
{
  const acquiring = deferred();
  const oldResponse = controlled();
  let calls = 0;
  const { agent, events } = fixture(() => ++calls === 1 ? acquiring.promise : finished(answer([{ type: 'text', text: 'Recovered' }])));
  const run = agent.prompt('Wait');
  await until(() => calls === 1, 'stream acquisition');
  agent.pingModel(agent.modelRequestProgress.requestId, recovery());
  await tick();
  assert.equal(calls, 1);
  acquiring.resolve(oldResponse);
  await tick();
  assert.equal(calls, 1, 'acquired old stream still needs full settlement');
  oldResponse.complete(answer([], 'aborted'));
  await run;
  assert.equal(calls, 2);
  assert.equal(agent.state.messages.filter(m => m.role === 'assistant').length, 1);
  assertOneLifecycle(events);
}

// Stop wins both immediately after Ping and while discard listeners are running.
for (const stopAtDiscard of [false, true]) {
  const stalled = controlled();
  let calls = 0;
  const { agent, events } = fixture(() => { calls++; return stalled; });
  if (stopAtDiscard) agent.subscribe(event => { if (event.type === 'message_discarded') agent.abort(); });
  const run = agent.prompt('Wait');
  await until(() => calls === 1, 'stop race provider');
  stalled.push({ type: 'start', partial: answer() });
  await until(() => agent.state.streamingMessage?.role === 'assistant', 'placeholder');
  const requestId = agent.modelRequestProgress.requestId;
  agent.pingModel(requestId, recovery());
  if (!stopAtDiscard) agent.abort();
  assert.throws(() => agent.pingModel(requestId, recovery()));
  stalled.complete(answer([{ type: 'toolCall', id: 'late', name: 'never', arguments: {} }], 'toolUse'));
  await run;
  assert.equal(calls, 1);
  assert.ok(!events.some(e => e.type === 'model_ping' && e.status === 'resumed'));
  assert.ok(!agent.state.messages.some(m => m.role === 'ping_fixture'));
  assert.equal(agent.state.messages.at(-1).stopReason, 'aborted');
  assert.equal(agent.modelRequestProgress, null);
  assertOneLifecycle(events);
}

// Text and tool arguments make cancellation/replacement unsafe before listener delivery.
for (const type of ['text_delta', 'toolcall_delta']) {
  const stalled = controlled();
  const { agent, events } = fixture(() => stalled);
  const run = agent.prompt('Wait');
  await until(() => agent.modelRequestProgress, 'unsafe case request');
  const content = type === 'text_delta' ? [{ type: 'text', text: 'Partial answer' }] : [{ type: 'toolCall', id: 'partial', name: 'never', arguments: { partial: true } }];
  stalled.push({ type: 'start', partial: answer() });
  stalled.push({ type, contentIndex: 0, delta: 'partial', partial: answer(content) });
  await until(() => events.some(e => e.type === 'message_update'), 'partial emission');
  assert.equal(agent.modelRequestProgress.canPing, false);
  assert.throws(() => agent.pingModel(agent.modelRequestProgress.requestId, recovery()), /safely/);
  agent.abort();
  stalled.complete(answer(content, 'toolUse'));
  await run;
  assert.ok(!events.some(e => e.type === 'tool_execution_start'));
  assertOneLifecycle(events);
}

// Context preparation can compact via another inference. No Ping/progress is
// advertised there, and root Stop must prevent dispatch after preparation settles.
for (const stage of ['transform', 'key']) {
  const gate = deferred();
  let entered = 0, calls = 0;
  const options = stage === 'transform' ? { transformContext: async messages => { if (++entered === 1) await gate.promise; return messages; } } : { getApiKey: async () => { if (++entered === 1) await gate.promise; return undefined; } };
  const { agent, events } = fixture(() => { calls++; return finished(answer([{ type: 'text', text: 'Done' }])); }, options);
  const run = agent.prompt('Prepare');
  await until(() => entered === 1, `${stage} entered`);
  assert.equal(agent.modelRequestProgress, null);
  assert.throws(() => agent.pingModel('not-a-provider-stage', recovery()));
  agent.abort();
  await tick();
  assert.equal(calls, 0);
  assert.equal(entered, 1);
  gate.resolve();
  await run;
  assert.equal(calls, 0, 'cancelled preparation never dispatches its provider');
  assert.equal(entered, 1);
  assertOneLifecycle(events);
}

// Hidden activity updates snapshots on every event, but notifications are throttled.
{
  const stalled = controlled();
  const { agent, events } = fixture(() => stalled);
  const now = Date.now;
  let clock = now();
  Date.now = () => clock;
  try {
    const run = agent.prompt('Think');
    await until(() => agent.modelRequestProgress, 'progress request');
    const initial = agent.modelRequestProgress.lastActivityAt;
    stalled.push({ type: 'start', partial: answer() });
    await until(() => agent.modelRequestProgress.phase === 'streaming', 'streaming transition');
    for (let index = 0; index < 10; index++) {
      clock += 50;
      stalled.push({ type: 'thinking_delta', contentIndex: 0, delta: 'x', partial: answer([{ type: 'thinking', thinking: 'x' }]) });
      await until(() => events.filter(e => e.type === 'message_update').length === index + 1, 'hidden activity');
    }
    assert.equal(agent.modelRequestProgress.lastActivityAt, initial + 500);
    assert.equal(events.filter(e => e.type === 'model_request_progress' && e.progress).length, 2, 'waiting plus streaming only within one second');
    clock += 501;
    stalled.push({ type: 'thinking_delta', contentIndex: 0, delta: 'x', partial: answer([{ type: 'thinking', thinking: 'x' }]) });
    await until(() => events.filter(e => e.type === 'message_update').length === 11, 'throttled activity');
    assert.equal(events.filter(e => e.type === 'model_request_progress' && e.progress).length, 3);
    stalled.complete(answer([{ type: 'text', text: 'Done' }]));
    await run;
    const count = events.length;
    await tick();
    assert.equal(events.length, count, 'no stale timer/progress after agent_end');
    assert.equal(agent.modelRequestProgress, null);
    assertOneLifecycle(events);
  } finally { Date.now = now; }
}
// Adding Ping must not change ordinary Stop's preservation of partial text/usage.
{
  const response = controlled();
  const { agent, events } = fixture(() => response);
  const run = agent.prompt('Ordinary Stop');
  const partial = answer([{ type: 'text', text: 'Already visible text' }]);
  response.push({ type: 'start', partial });
  await until(() => agent.state.streamingMessage, 'ordinary partial');
  agent.abort();
  response.endIterator();
  response.settle({ ...partial, stopReason: 'aborted' });
  await run;
  const message = events.filter(event => event.type === 'message_end').at(-1).message;
  assert.equal(message.stopReason, 'aborted');
  assert.equal(message.content[0].text, 'Already visible text');
  assert.deepEqual(message.usage, usage);
  assertOneLifecycle(events);
}
console.log(`Model Ping core (${compiled ? 'compiled' : 'source'}): same-turn recovery, tool preservation, unsafe/stale/duplicate rejection, Stop races, dual settlement and progress: ok`);
