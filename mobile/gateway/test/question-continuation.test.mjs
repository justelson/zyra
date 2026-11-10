import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ZyraAgentServer } from '../../../src/agent-server/server.mjs';
import { ZyraAgentServerClient } from '../../../src/agent-server/client.mjs';
import { HostRouter } from '../src/router.mjs';
import { BodyCache } from '../src/projection.mjs';
import { OperationLedger } from '../src/operations.mjs';

const until = async predicate => { for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); } assert.fail('Expected continuation state was not reached'); };
async function fixture(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'zyra-question-continuation-'));
  const chat = { canonicalChatId: 'question-chat', project: directory, cwd: directory };
  class Worker extends EventEmitter {
    calls = []; prompts = []; alive = true;
    isAlive() { return this.alive; }
    async request(type, payload) {
      this.calls.push({ type, payload });
      if (type === 'connect') return { threadId: chat.canonicalChatId, cwd: directory };
      if (type === 'user_input.respond') {
        if (this.responseGate) await this.responseGate;
        this.emit('event', { type: 'user_input_resolved', requestId: payload.requestId, answers: payload.answers, cancelled: payload.cancelled === true });
        return { answers: payload.answers, cancelled: payload.cancelled === true, continuationPrompt: payload.cancelled ? null : 'Continue with the selected answer.' };
      }
      if (type === 'prompt') return new Promise((resolve, reject) => this.prompts.push({ resolve, reject, payload }));
      return {};
    }
    dispose() { this.alive = false; this.prompts.forEach(p => p.resolve({})); }
    sendControlResponse() {}
  }
  const worker = new Worker();
  const catalog = { record: { metadata: {} }, history: async () => ({ entries: [] }), registerProject: () => directory, find: async () => chat, resolveAlias: v => v || '', recordAttachment() {}, updateChat: async () => chat, list: async () => [chat], snapshot: () => ({ projects: [{ path: directory }] }) };
  const server = new ZyraAgentServer({ stateDirectory: directory, root: process.cwd(), endpoint: 0, catalog, createWorker: () => worker });
  const clients = [];
  t.after(async () => { clients.forEach(c => c.close()); await server.stop(); const relative = path.relative(realpathSync(os.tmpdir()), realpathSync(directory)); assert.ok(relative.startsWith('zyra-question-continuation-') && !relative.includes(path.sep)); rmSync(directory, { recursive: true, force: true }); });
  await server.start();
  async function connect(owner = 'phone') {
    const client = new ZyraAgentServerClient({ stateDirectory: directory, autoStart: false, clientId: 'mobile:' + owner, surface: 'mobile' });
    clients.push(client);
    await client.attach({ project: directory, session: chat.canonicalChatId });
    const router = new HostRouter({ client, owner, projects: [directory], cache: new BodyCache() });
    router.attached.add(chat.canonicalChatId);
    return { client, router };
  }
  const phone = await connect();
  const answer = (requestId = 'question', cancelled = false) => ({ sessionKey: chat.canonicalChatId, type: 'user_input.respond', payload: { requestId, answers: { choice: 'One' }, cancelled } });
  const question = id => worker.emit('event', { type: 'user_input_requested', requestId: id, questions: [{ id: 'choice', question: 'Choose', options: [{ label: 'One' }] }] });
  return { ...phone, connect, worker, server, directory, answer, question };
}

test('phone answer dispatches the returned continuation with authenticated canonical turn context', async t => {
  const f = await fixture(t); f.question('question');
  let settled = false;
  const result = f.router.dispatch('session.request', f.answer(), 'answer-one').then(v => { settled = true; return v; });
  await until(() => f.worker.calls.some(c => c.type === 'user_input.respond'));
  await until(() => f.worker.prompts.length === 1);
  assert.equal(settled, false, 'answer RPC cannot claim continuation completed before its prompt');
  assert.equal(f.worker.prompts[0].payload.prompt, 'Continue with the selected answer.');
  const session = [...f.server.sessions.values()][0];
  assert.deepEqual(session.activeRequestContext, { turnId: 'mobile:answer-one', localThreadId: 'mobile-device:phone' });
  f.worker.prompts[0].resolve({});
  assert.equal((await result).continuation.state, 'completed');
});

test('cancel resolves the question without starting a prompt', async t => {
  const f = await fixture(t); f.question('cancel');
  const result = await f.router.dispatch('session.request', f.answer('cancel', true), 'cancel-one');
  assert.equal(result.cancelled, true); assert.equal(f.worker.prompts.length, 0);
});

test('a reply during a foreground turn waits and then enters the normal prompt lifecycle', async t => {
  const f = await fixture(t);
  const active = f.client.request('session.request', { sessionKey: 'question-chat', type: 'prompt', payload: { prompt: 'Existing turn' }, requestContext: { turnId: 'existing-turn' } });
  await until(() => f.worker.prompts.length === 1);
  f.question('question');
  const answer = f.router.dispatch('session.request', f.answer(), 'queued-answer');
  await until(() => f.worker.calls.some(c => c.type === 'user_input.respond'));
  assert.equal(f.worker.prompts.length, 1, 'continuation cannot race the active prompt');
  f.worker.emit('event', { type: 'agent_end' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.worker.prompts.length, 1, 'agent_end cannot start continuation before the original prompt RPC settles');
  f.worker.prompts[0].resolve({}); await active;
  await until(() => f.worker.prompts.length === 2);
  assert.equal(f.worker.prompts[1].payload.turnId, 'mobile:queued-answer');
  f.worker.prompts[1].resolve({});
  assert.equal((await answer).continuation.state, 'completed');
});

test('same-phone reconnect and new operation IDs cannot duplicate an answered question continuation', async t => {
  const f = await fixture(t); f.question('question');
  const first = f.router.dispatch('session.request', f.answer(), 'first-answer');
  const lost = first.catch(error => error);
  await until(() => f.worker.prompts.length === 1);
  f.client.close(); await lost;
  const reconnected = await f.connect();
  const retry = reconnected.router.dispatch('session.request', f.answer(), 'retry-new-id');
  const changed = f.answer(); changed.payload.answers.choice = 'Other';
  await assert.rejects(reconnected.router.dispatch('session.request', changed, 'changed'), { code: 'AGENT_SERVER_USER_INPUT_ALREADY_ANSWERED' });
  const other = await f.connect('other-phone');
  await assert.rejects(other.router.dispatch('session.request', f.answer(), 'other-answer'), { code: 'AGENT_SERVER_USER_INPUT_ALREADY_ANSWERED' });
  f.worker.prompts[0].resolve({});
  assert.equal((await retry).continuation.turnId, 'mobile:first-answer');
  await reconnected.router.dispatch('session.request', f.answer(), 'completed-retry');
  assert.equal(f.worker.prompts.length, 1);
  assert.equal(f.worker.calls.filter(c => c.type === 'user_input.respond').length, 1);
});

test('durable gateway receipt replays completion and never reruns an uncertain continuation', async t => {
  const f = await fixture(t); const ledger = new OperationLedger(f.directory);
  const id = Date.now() + ':answer'; const input = f.answer(); f.question('question');
  const run = () => f.router.dispatch('session.request', input, id);
  const result = ledger.run('phone', id, input, run);
  await until(() => f.worker.prompts.length === 1); f.worker.prompts[0].resolve({}); await result;
  const restored = new OperationLedger(f.directory);
  assert.equal((await restored.run('phone', id, input, () => assert.fail('Completed work replayed'))).continuation.state, 'completed');
  f.question('failed'); const failedInput = f.answer('failed'); const failedId = Date.now() + ':failed';
  const failure = ledger.run('phone', failedId, failedInput, () => f.router.dispatch('session.request', failedInput, failedId));
  const rejected = assert.rejects(failure, /Synthetic continuation failure/);
  await until(() => f.worker.prompts.length === 2); f.worker.prompts[1].reject(new Error('Synthetic continuation failure')); await rejected;
  await assert.rejects(f.router.dispatch('session.request', failedInput, 'different-id'), /Synthetic continuation failure/);
  const afterFailure = new OperationLedger(f.directory);
  await assert.rejects(afterFailure.run('phone', failedId, failedInput, () => assert.fail('Uncertain work replayed')), { code: 'OUTCOME_UNKNOWN' });
  assert.equal(f.worker.prompts.length, 2);
});

test('stop cancels a queued continuation instead of starting it after the active turn ends', async t => {
  const f = await fixture(t);
  const active = f.client.request('session.request', { sessionKey: 'question-chat', type: 'prompt', payload: { prompt: 'Existing turn' }, requestContext: { turnId: 'existing' } });
  await until(() => f.worker.prompts.length === 1); f.question('question');
  const answer = f.router.dispatch('session.request', f.answer(), 'cancel-queued');
  const rejected = assert.rejects(answer, /stopped/);
  await until(() => [...f.server.sessions.values()][0].userInputContinuationWaiters.size === 1);
  await f.client.request('session.request', { sessionKey: 'question-chat', type: 'abort', payload: {} });
  await rejected;
  f.worker.prompts[0].resolve({}); await active;
  assert.equal(f.worker.prompts.length, 1);
});

test('a legacy server that only returns continuation text cannot report mobile success', async () => {
  const router = new HostRouter({ owner: 'phone', projects: ['/shared'], cache: new BodyCache(), client: { request: async () => ({ continuationPrompt: 'not executed' }) } });
  router.attached.add('chat');
  await assert.rejects(router.dispatch('session.request', { sessionKey: 'chat', type: 'user_input.respond', payload: { requestId: 'question', answers: {} } }, 'legacy'), { code: 'HOST_UPDATE_REQUIRED' });
});

test('questions remain answerable after the asking turn finishes normally', async t => {
  const f = await fixture(t);
  const asking = f.client.request('session.request', { sessionKey: 'question-chat', type: 'prompt', payload: { prompt: 'Ask a question' }, requestContext: { turnId: 'asking' } });
  await until(() => f.worker.prompts.length === 1);
  f.question('question'); f.worker.emit('event', { type: 'agent_end' });
  f.worker.prompts[0].resolve({}); await asking;
  const answer = f.router.dispatch('session.request', f.answer(), 'after-complete');
  await until(() => f.worker.prompts.length === 2);
  f.worker.prompts[1].resolve({});
  assert.equal((await answer).continuation.state, 'completed');
});

test('stop received while the worker is resolving the answer also cancels its later continuation', async t => {
  const f = await fixture(t); f.question('question');
  let release;
  f.worker.responseGate = new Promise(resolve => { release = resolve; });
  const answer = f.router.dispatch('session.request', f.answer(), 'stop-before-queue');
  const rejected = assert.rejects(answer, /stopped/);
  await until(() => f.worker.calls.some(c => c.type === 'user_input.respond'));
  await f.client.request('session.request', { sessionKey: 'question-chat', type: 'abort', payload: {} });
  release(); await rejected;
  assert.equal(f.worker.prompts.length, 0);
});
