import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequestUserInputTool } from '../src/request-user-input-tool.mjs';
import { formatRequestUserInputContinuationPrompt } from '../src/request-user-input.mjs';
import { UserInputResponses } from '../src/agent-server/user-input-responses.mjs';
import { ZyraAgentServer } from '../src/agent-server/server.mjs';
import { ZyraAgentServerClient } from '../src/agent-server/client.mjs';
import { CanonicalChatCatalog } from '../src/agent-server/catalog.mjs';

const questions = [{ id: 'choice', header: 'Choice', question: 'Which target?', type: 'text' }];
const answers = { choice: 'Desktop' };
const continuationPrompt = formatRequestUserInputContinuationPrompt(questions, answers);
const toolRequests = [];
const tool = createRequestUserInputTool({ requestUserInput: async request => {
  toolRequests.push(request);
  return { deferred: true, requestId: 'tool-question' };
} });
for (const mode of [undefined, 'blocking', 'async']) {
  const result = await tool.execute('call', { questions, ...(mode ? { mode } : {}) });
  assert.equal(result.details.mode, mode || 'blocking');
  assert.equal(result.terminate === true, mode !== 'async', 'only blocking handoff terminates the tool turn');
  assert.equal(toolRequests.at(-1).mode, mode || 'blocking');
}

// The leaf gate preserves held text and owns dispatch even during concurrent retries.
let leafDispatches = 0;
let leafResumes = 0;
const leaf = new UserInputResponses(new Set(['leaf']), async (_prompt, _context, mode) => {
  leafResumes++;
  assert.equal(mode, 'async');
  return { state: 'held', turnId: 'answer-leaf' };
});
const leafPayload = { requestId: 'leaf', answers, continue: true, mode: 'async' };
const dispatch = async () => { leafDispatches++; return { mode: 'async', continuationPrompt }; };
const leafResults = await Promise.all([1, 2].map(() => leaf.respond('owner', leafPayload, { turnId: 'answer-leaf' }, dispatch)));
assert.equal(leafDispatches, 1);
assert.equal(leafResumes, 1);
assert.equal(leafResults[0].continuation.state, 'held');
assert.equal(leafResults[0].continuationPrompt, continuationPrompt);
assert.throws(() => leaf.respond('peer', leafPayload, { turnId: 'answer-leaf' }, dispatch), { code: 'AGENT_SERVER_USER_INPUT_ALREADY_ANSWERED' });

class FakeWorker extends EventEmitter {
  constructor() { super(); this.requests = []; this.activePrompt = null; this.disposed = false; }
  isAlive() { return !this.disposed; }
  request(type, payload = {}) {
    this.requests.push({ type, payload });
    if (type === 'connect') return Promise.resolve({ threadId: 'chat:async-test', messages: [] });
    if (type === 'prompt') {
      assert.equal(this.activePrompt, null, 'canonical prompts never overlap');
      return new Promise(resolve => { this.activePrompt = resolve; });
    }
    if (type === 'abort') return Promise.resolve({ aborted: true });
    if (type === 'user_input.respond') {
      this.emit('event', { type: 'user_input_resolved', requestId: payload.requestId, answers: payload.answers, cancelled: false });
      return Promise.resolve({ answers: payload.answers, mode: payload.mode || 'blocking', questions: payload.questions || questions,
        continuationPrompt: formatRequestUserInputContinuationPrompt(payload.questions || questions, payload.answers) });
    }
    return Promise.resolve({});
  }
  finish() { const done = this.activePrompt; this.activePrompt = null; this.emit('event', { type: 'agent_end' }); done?.({}); }
  sendControlResponse() { return true; }
  dispose() { this.disposed = true; this.removeAllListeners(); }
}

const stateDirectory = mkdtempSync(path.join(os.tmpdir(), 'zyra-async-questions-'));
const project = path.join(stateDirectory, 'project');
const sessionPath = path.join(project, '.zyra', 'sessions', 'async.jsonl');
const channel = `async-questions-${process.pid}`;
let server;
let worker;
const clients = new Set();
const clientOptions = { root: path.resolve('.'), stateDirectory, channel, autoStart: false, heartbeat: false, verifyRuntimeRevision: false };
const createCatalog = () => new CanonicalChatCatalog({ stateDirectory, channel, loadSessionManager: async () => ({
  list: async () => [{ id: 'chat:async-test', path: sessionPath, cwd: project, name: 'Async test',
    created: new Date('2026-01-01'), modified: new Date('2026-01-02'), messageCount: 4, firstMessage: 'test' }],
  open: () => ({ getEntries: () => [] }),
}) });
async function start() {
  server = new ZyraAgentServer({ root: path.resolve('.'), stateDirectory, channel, endpoint: 0, catalog: createCatalog(),
    createWorker: () => (worker = new FakeWorker()), idleTimeoutMs: 60_000 });
  await server.start();
}
async function connect(clientId = 'async:owner') {
  const client = new ZyraAgentServerClient({ ...clientOptions, clientId, surface: 'test' });
  clients.add(client);
  await client.connect();
  await client.request('catalog.registerProject', { project });
  const attachment = await client.attach({ project, cwd: project, session: 'chat:async-test', localThreadId: clientId });
  return { client, attachment };
}
const session = () => server.sessions.get('chat:async-test');
const send = (client, type, payload, turnId) => client.request('session.request', {
  sessionKey: 'chat:async-test', type, payload, ...(turnId ? { requestContext: { turnId, localThreadId: client.clientId } } : {}),
});
const ask = (requestId, mode = 'async') => worker.emit('event', { type: 'user_input_requested', requestId, mode, questions });
const count = type => worker.requests.filter(request => request.type === type).length;
async function waitFor(predicate, label) {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
async function restart() {
  for (const client of clients) client.close();
  clients.clear();
  await server.stop();
  await start();
  return connect();
}

try {
  await start();
  let { client: owner } = await connect();
  const firstTurn = send(owner, 'prompt', { prompt: 'independent work' }, 'turn:independent');
  await waitFor(() => worker.activePrompt, 'initial prompt');
  ask('q-steer');
  const badSteers = count('steer');
  await assert.rejects(send(owner, 'steer', { prompt: 'stale', targetTurnId: 'turn:stale' }), { code: 'AGENT_SERVER_SESSION_BUSY' });
  await assert.rejects(send(owner, 'steer', { prompt: 'missing target' }), { code: 'AGENT_SERVER_SESSION_BUSY' });
  assert.equal(count('steer'), badSteers);
  const response = { requestId: 'q-steer', answers };
  const [steered, duplicate] = await Promise.all([send(owner, 'user_input.respond', response), send(owner, 'user_input.respond', response)]);
  assert.deepEqual(duplicate, steered);
  assert.deepEqual(steered.continuation, { state: 'steered', turnId: 'turn:independent' });
  assert.equal(steered.continuationPrompt, null);
  assert.equal(count('steer'), 1);
  assert.equal(count('user_input.respond'), 1);
  assert.equal(count('prompt'), 1);
  assert.equal(session().activeRequestContext.turnId, 'turn:independent');
  assert.equal(worker.requests.find(request => request.type === 'steer').payload.targetTurnId, 'turn:independent');

  ask('q-persist');
  ask('q-defer');
  worker.finish();
  await firstTurn;
  assert.equal(session().pendingUserInputRequestIds.has('q-persist'), true, 'turn completion preserves async attention');
  assert.equal(session().pendingUserInputModes.get('q-persist'), 'async');
  assert.equal(server.sessionPresence('chat:async-test').attention, null, 'Async questions never advertise a blocking input state');
  assert.equal(server.sessionPresence('chat:async-test').pendingQuestionCount, 2);
  owner.close();
  ({ client: owner } = await connect());
  assert.equal(session().pendingAttentionEvents.get('q-persist').mode, 'async', 'reconnect preserves canonical mode');
  const lateSnapshot = server.attachmentSnapshot(session(), session().sequence);
  assert.ok(JSON.stringify(lateSnapshot).includes('q-persist'), 'late attach includes pending question even after its replay watermark');

  const beforeDefer = { prompt: count('prompt'), steer: count('steer') };
  const deferred = await send(owner, 'user_input.respond', { requestId: 'q-defer', answers, deferContinuation: true });
  assert.equal(deferred.continuation, undefined);
  assert.equal(deferred.continuationPrompt, continuationPrompt);
  assert.equal(count('prompt'), beforeDefer.prompt, 'Desktop-owned durable answer sends no automatic prompt');
  assert.equal(count('steer'), beforeDefer.steer, 'Desktop-owned durable answer sends no automatic steering');

  ask('q-blocking', 'blocking');
  const beforeForgedMode = count('prompt') + count('steer');
  const blocking = await send(owner, 'user_input.respond', { requestId: 'q-blocking', answers, mode: 'async' });
  assert.equal(blocking.mode, 'blocking', 'response payload cannot promote a canonical blocking question');
  assert.equal(count('prompt') + count('steer'), beforeForgedMode);

  ask('q-stop');
  await send(owner, 'abort', {});
  assert.equal(session().pendingUserInputRequestIds.has('q-stop'), true);
  ({ client: owner } = await restart());
  assert.equal(session().pendingUserInputModes.get('q-stop'), 'async', 'journal rebuild restores pending mode after process recreation');
  assert.equal(session().pendingUserInputModes.get('q-persist'), 'async');
  const held = await send(owner, 'user_input.respond', { requestId: 'q-stop', answers });
  assert.equal(held.continuation.state, 'held', 'answer after Stop cannot start a new turn, including after restart');
  assert.equal(held.continuationPrompt, continuationPrompt, 'held answer text is not consumed');
  assert.equal(count('prompt') + count('steer'), 0);
  assert.notEqual(session().latestTurn?.state, 'running', 'a held receipt cannot create false running presence');
  assert.ok(session().journal.replay().some(entry => entry.event.type === 'user_input_continuation_held' && entry.event.prompt === continuationPrompt));

  ({ client: owner } = await restart());
  const retryHeld = await send(owner, 'user_input.respond', { requestId: 'q-stop', answers });
  assert.deepEqual(retryHeld, held, 'a lost held acknowledgement is recovered without dispatch after restart');
  assert.equal(count('user_input.respond') + count('prompt') + count('steer'), 0);
  const { client: peer } = await connect('async:peer');
  await assert.rejects(send(peer, 'user_input.respond', { requestId: 'q-stop', answers }), { code: 'AGENT_SERVER_USER_INPUT_ALREADY_ANSWERED' });

  // A question created in the current epoch may resume idle work normally.
  ask('q-idle');
  const idleResponse = send(owner, 'user_input.respond', { requestId: 'q-idle', answers });
  await waitFor(() => worker.activePrompt, 'idle async continuation');
  assert.equal(count('steer'), 0);
  worker.finish();
  const idle = await idleResponse;
  assert.deepEqual(idle.continuation, { state: 'completed', turnId: 'answer-q-idle' });
  assert.equal(idle.continuationPrompt, null);

  // Blocking continuations retain serialization instead of joining live work.
  const running = send(owner, 'prompt', { prompt: 'blocking serialization' }, 'turn:blocking-host');
  await waitFor(() => worker.activePrompt, 'blocking host');
  ask('q-blocking-wait', 'blocking');
  const beforeBlocking = count('prompt');
  const blockingResponse = send(owner, 'user_input.respond', { requestId: 'q-blocking-wait', answers, continue: true }, 'answer-blocking-wait');
  await waitFor(() => session().userInputContinuationWaiters.size > 0, 'blocking answer waits');
  assert.equal(count('prompt'), beforeBlocking);
  assert.equal(count('steer'), 0);
  worker.finish();
  await running;
  await waitFor(() => worker.activePrompt, 'serialized blocking continuation');
  worker.finish();
  assert.equal((await blockingResponse).continuation.state, 'completed');

  ask('q-settle');
  const beforeSettle = count('prompt') + count('steer');
  await owner.request('catalog.update', { session: 'chat:async-test', settled: true });
  assert.equal(session().pendingUserInputRequestIds.size, 0, 'Explicitly settling idle work dismisses unanswered async questions');
  assert.equal(count('prompt') + count('steer'), beforeSettle, 'Settlement never sends an invented answer');
  assert.ok(worker.requests.some(entry => entry.type === 'user_input.respond' && entry.payload.requestId === 'q-settle' && entry.payload.cancelled === true));
  console.log('Async user input: tool modes, exact-turn steering, serialization, pending/reconnect/restart, duplicate recovery, Stop-held journal, Desktop defer and safe settlement passed');
} finally {
  for (const client of clients) client.close();
  await server?.stop();
  rmSync(stateDirectory, { recursive: true, force: true });
}
