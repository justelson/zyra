import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ModelRuntime } from '../src/runtime/engine/src/core/model-runtime.js';
import { ModelRegistry } from '../src/runtime/engine/src/core/model-registry.js';
import { AssistantMessageEventStream } from '../src/runtime/providers/src/utils/event-stream.js';
import { envApiKeyAuth } from '../src/runtime/providers/src/auth/helpers.js';
import { AgentFleetController } from '../src/agents/runtime/fleet-controller.mjs';
import { ChildSessionFactory } from '../src/agents/runtime/child-session-factory.mjs';
import { ZyraSessionManager } from '../src/agent-server/zyra-session-manager.mjs';
import { ensureSessionDurable } from '../src/agent-server/session-durability.mjs';
import { ZyraAgentServer } from '../src/agent-server/server.mjs';
import { ThreadMailbox } from '../src/agent-server/thread-mailbox.mjs';
import { createThreadTool } from '../src/threads/tool.mjs';
import { createFleetTools } from '../src/agents/tools.mjs';
import { resolveThreadStartSettings, threadStartOptions } from '../src/threads/start-settings.mjs';
import { threadMessageReceipt } from '../src/threads/delivery.mjs';
import { ThreadBridgeClient } from '../src/threads/bridge-client.mjs';

const directory = await mkdtemp(path.join(os.tmpdir(), 'zyra-thread-collaboration-'));
const project = path.join(directory, 'project');
await mkdir(project);
const client = { clientId: 'fixture-desktop', surface: 'desktop', attachedSessionIds: new Set() };
let fleet, server, owner;
const oldFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error('No network permitted in this fixture.'); };
try {
  const mailboxDir = path.join(directory, 'mailbox');
  const mailbox = new ThreadMailbox(mailboxDir, { maxCompleted: 2 });
  const sender = { senderThreadId: 'sender', senderLabel: 'Fixture', project };
  for (let i = 0; i < 4; i++) {
    const receipt = mailbox.enqueue(sender, { threadId: 'recipient', prompt: `message-${i}`, dedupeKey: `call-${i}` });
    assert.equal(mailbox.enqueue(sender, { threadId: 'recipient', prompt: `message-${i}`, dedupeKey: `call-${i}` }).messageId, receipt.messageId);
    await mailbox.deliver(receipt, async () => {});
  }
  assert.equal(mailbox.messages.size, 2);
  assert.equal((await readdir(mailboxDir)).length, 2);
  const queued = mailbox.enqueue(sender, { threadId: 'recipient', prompt: 'persist me', dedupeKey: 'queued' });
  assert.equal(new ThreadMailbox(mailboxDir).get(queued.messageId, 'sender').status, 'queued');
  const broken = new ThreadMailbox(path.join(directory, 'broken'));
  const diskFailure = broken.enqueue(sender, { threadId: 'recipient', prompt: 'disk failure', dedupeKey: 'disk' });
  broken.save = () => { throw new Error('Synthetic disk failure'); };
  await assert.rejects(broken.deliver(diskFailure, async () => {}), /disk failure/);
  assert.equal(broken.delivering.size, 0);
  console.log('PASS bounded durable mailbox, idempotent delivery identity, restart and disk failure cleanup');

  let protocol;
  const rpc = new ThreadBridgeClient(message => { protocol = message; });
  const rpcRequest = rpc.forAgent('bound-agent').request({ action: 'list' });
  assert.equal(protocol.agentRunId, 'bound-agent');
  rpc.handleResponse({ type: 'threads.response', requestId: protocol.requestId, ok: true, result: { threads: [] } });
  assert.deepEqual(await rpcRequest, { threads: [] });
  rpc.dispose();

  const model = { provider: 'thread-fixture', id: 'model', name: 'Offline thread fixture', api: 'thread-fixture', baseUrl: 'https://fixture.invalid', reasoning: true, input: ['text'], contextWindow: 32768, maxTokens: 2048, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const usage = { input: 2, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 4, cost: { total: 0 } };
  let calls = 0, providerFail = false, holdArmed = false, releaseHeldTurn, reportAbortAsError = false;
  const stream = (_model, context, options) => {
    assert.equal(options.apiKey, 'synthetic-thread-key');
    calls++;
    const messages = context.messages;
    const userIndex = messages.findLastIndex(message => message.role === 'user');
    const userText = JSON.stringify(messages[userIndex]?.content || '');
    const peer = userText.match(/send-peer:([a-zA-Z0-9:._-]+)/)?.[1];
    const alreadyCalled = messages.slice(userIndex + 1).some(message => message.role === 'toolResult');
    if (peer && !alreadyCalled) assert(context.tools.some(tool => tool.name === 'thread'));
    const message = { role: 'assistant', provider: model.provider, model: model.id, api: model.api, timestamp: Date.now(), usage,
      stopReason: providerFail ? 'error' : peer && !alreadyCalled ? 'toolUse' : 'stop',
      ...(providerFail ? { errorMessage: 'Synthetic thread provider failure' } : {}),
      content: providerFail ? [] : peer && !alreadyCalled ? [{ type: 'toolCall', id: `peer-call-${calls}`, name: 'thread', arguments: { action: 'send', threadId: peer, prompt: 'Peer evidence, no user approval.' } }] : [{ type: 'text', text: `Independent answer ${calls}` }] };
    const result = new AssistantMessageEventStream();
    let finished = false;
    const abort = () => { message.stopReason = reportAbortAsError ? 'error' : 'aborted'; message.errorMessage = 'Synthetic turn aborted'; finish(); };
    const finish = () => {
      if (finished) return;
      finished = true;
      options.signal?.removeEventListener('abort', abort);
      result.push({ type: 'start', partial: message });
      result.push(['error', 'aborted'].includes(message.stopReason) ? { type: 'error', reason: message.stopReason, error: message } : { type: 'done', reason: message.stopReason, message }); result.end();
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    if (holdArmed && userText.includes('hold-turn')) { holdArmed = false; releaseHeldTurn = finish; }
    else queueMicrotask(finish);
    return result;
  };
  const modelRuntime = await ModelRuntime.create({ authPath: path.join(directory, 'auth.json'), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  modelRuntime.registerNativeProvider({ id: model.provider, auth: { apiKey: envApiKeyAuth('Fixture', []) }, getModels: () => [model], stream, streamSimple: stream });
  await modelRuntime.setRuntimeApiKey(model.provider, 'synthetic-thread-key');
  const rootManager = ZyraSessionManager.create(project, path.join(project, '.zyra', 'sessions'));
  ensureSessionDurable(rootManager);
  const factory = new ChildSessionFactory({ project, agentDir: directory, transcriptDirectory: path.join(project, '.zyra', 'agent-runs', rootManager.getSessionId(), 'child-sessions'), modelRuntime,
    settings: { compaction: { enabled: false }, retry: { enabled: false } } });
  const threadClient = { forAgent: agentRunId => ({ request: input => server.threads.request(owner, { agentRunId, input }) }) };
  fleet = new AgentFleetController({ project, rootSessionId: rootManager.getSessionId(), rootThreadId: rootManager.getSessionId(),
    rootSession: { model, modelRuntime, modelRegistry: new ModelRegistry(modelRuntime) }, sessionFactory: factory, threadBridgeClient: threadClient });
  await fleet.initialize({ installRoot: directory });
  let workersCreated = 0;
  class Worker extends EventEmitter {
    isAlive() { return !this.disposed; }
    async request(type, payload) {
      if (type === 'connect') return { threadId: rootManager.getSessionId(), providerThreadId: rootManager.getSessionId(), sessionFile: rootManager.getSessionFile(), cwd: project, model: `${model.provider}/${model.id}`, messages: [], fleet: fleet.snapshot() };
      if (type === 'agents.spawn') return fleet.spawn(payload);
      if (type === 'agents.models') return fleet.delegationModelOptions(payload);
      if (type === 'agents.inspectSession') return fleet.inspectSession(payload.agentRunId);
      if (type === 'agents.chatPrompt') return fleet.chatPrompt(payload.agentRunId, payload.prompt);
      if (type === 'agents.receiveThreadMessage') return fleet.send(payload.agentRunId, payload.message.text, payload.message);
      if (type === 'agents.stop') return fleet.stop(payload.agentRunId, payload.reason, payload.interruption);
      throw new Error(`Unexpected worker operation ${type}`);
    }
    dispose() { this.disposed = true; this.removeAllListeners(); }
  }
  const worker = new Worker();
  server = new ZyraAgentServer({ root: path.resolve('.'), stateDirectory: path.join(directory, 'state'), channel: 'thread-fixture', createWorker: () => { workersCreated++; return worker; } });
  server.send = () => true;
  const attached = await server.attachSession(client, { project, session: rootManager.getSessionFile(), model: `${model.provider}/${model.id}`, memoryEnabled: false, noSession: true });
  owner = server.sessions.get(attached.sessionKey);
  fleet.subscribe(({ snapshot }) => worker.emit('event', { type: 'fleet.updated', fleet: { ...snapshot, agents: Object.fromEntries(Object.values(snapshot.agents).map(run => [run.agentRunId, { ...run, grantedTools: run.tools }])) } }));
  fleet.subscribeSessionEvents(({ agentRunId, event }) => worker.emit('event', { type: 'zyra_child_session_event', agentRunId, event }));
  const tool = createThreadTool({ request: input => server.threads.request(owner, { input }) })[0];
  const options = JSON.parse((await tool.execute('available-settings', { action: 'models' })).content[0].text);
  assert(options.models.some(option => option.id === `${model.provider}/${model.id}` && option.supportedEfforts.includes('high')));
  assert.deepEqual(options.permissionModes, ['read-only']);
  const configured = JSON.parse((await tool.execute('configured-start', { action: 'start', prompt: 'Configured independent task', label: 'Configured', model: `${model.provider}/${model.id}`, effort: 'high', permissionMode: 'read-only' })).content[0].text);
  await fleet.wait(configured.agentRunId);
  assert.equal(fleet.status(configured.agentRunId).effort, 'high');
  assert.equal(fleet.status(configured.agentRunId).conversationKind, 'thread', 'thread:start preserves explicit conversation intent in the real fleet');
  const configuredChat = await server.catalog.find(fleet.status(configured.agentRunId).providerSessionId, { project });
  assert.equal(configuredChat.agentConversationKind, 'thread', 'The actual child transcript is indexed only as an independent conversation');
  assert.equal(configuredChat.agentCreatedBy, owner.sessionKey, 'Conversation visibility retains owned-child provenance');
  assert.equal(fleet.status(configured.agentRunId).selectedModel, `${model.provider}/${model.id}`);
  assert.equal(configured.configuration.permissionMode, 'read-only');
  const beforeRejected = Object.keys(fleet.snapshot().agents).length;
  await assert.rejects(tool.execute('wrong-effort', { action: 'start', prompt: 'Invalid effort', effort: 'max' }), /Thinking effort .* unavailable/);
  await assert.rejects(tool.execute('unavailable-model', { action: 'start', prompt: 'Missing model', model: 'thread-fixture/missing' }), /No authenticated compatible/);
  await assert.rejects(tool.execute('wrong-permission', { action: 'start', prompt: 'Too much authority', permissionMode: 'full-access', writeScope: [project] }), /permission mode .* unavailable/);
  await assert.rejects(tool.execute('configured-start', { action: 'start', prompt: 'Configured independent task', effort: 'low' }), /different settings/);
  assert.equal(Object.keys(fleet.snapshot().agents).length, beforeRejected, 'Invalid settings never create a queued or failed child');
  console.log('PASS upfront model/effort/permission discovery and configuration, with invalid settings rejected before child creation');
  const writingParent = { agent: { agentRunId: 'writing-parent', selectedModel: `${model.provider}/${model.id}`, permissionMode: 'writer', effort: 'high', grantedTools: ['read', 'edit', 'write'], readScope: [project], writeScope: [project] } };
  assert.deepEqual(threadStartOptions(writingParent).permissionModes, ['read-only', 'writer']);
  assert.equal(resolveThreadStartSettings({ permissionMode: 'read-only', effort: 'low' }, writingParent).permissionMode, 'read-only');
  assert.throws(() => resolveThreadStartSettings({ permissionMode: 'full-access' }, writingParent), /unavailable/);
  assert.throws(() => resolveThreadStartSettings({ permissionMode: 'writer' }, { agent: null }, { runtimeMode: 'full-access' }), /writeScope/);
  const start = async (call, label) => JSON.parse((await tool.execute(call, { action: 'start', prompt: `Independent task ${label}`, label })).content[0].text);
  const [a, retryA] = await Promise.all([start('start-a', 'A'), start('start-a', 'A')]);
  assert.equal(a.agentRunId, retryA.agentRunId);
  const b = await start('start-b', 'B');
  await fleet.wait(a.agentRunId); await fleet.wait(b.agentRunId);
  assert.equal(Object.keys(fleet.snapshot().agents).length, 3);
  assert.notEqual(fleet.status(a.agentRunId).sessionFile, fleet.status(b.agentRunId).sessionFile);
  assert.equal(rootManager.getEntries().filter(entry => entry.type === 'message').length, 0);

  const waitReceipts = async () => {
    const deadline = Date.now() + 10_000;
    while ([...server.threads.mailbox.messages.values()].some(message => message.status === 'queued')) {
      if (Date.now() > deadline) throw new Error('Thread fixture delivery did not settle.');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  };
  await fleet.send(a.agentRunId, `send-peer:${b.threadId}`);
  await waitReceipts();
  await fleet.send(b.agentRunId, `send-peer:${a.threadId}`);
  await waitReceipts();
  const receipts = [...server.threads.mailbox.messages.values()];
  assert.equal(receipts.length, 2);
  assert(receipts.every(receipt => receipt.status === 'delivered'));
  for (const receipt of receipts) {
    const recipient = receipt.recipientThreadId === a.threadId ? a : b;
    assert(threadMessageReceipt(fleet.completedHosts.get(recipient.agentRunId).requireSession(), receipt.messageId));
  }
  assert.equal(rootManager.getEntries().filter(entry => entry.type === 'message').length, 0, 'Private agent contexts never become root chat transcripts');
  console.log('PASS real SDK tools start independent agents once and send bidirectional durable peer messages');

  holdArmed = true;
  const busy = await server.threads.request(owner, { input: { action: 'start', prompt: 'hold-turn', label: 'Busy recipient', dedupeKey: 'start-busy' } });
  while (!releaseHeldTurn) await new Promise(resolve => setTimeout(resolve, 5));
  const began = performance.now();
  const busyReceipt = await server.threads.request(owner, { input: { action: 'send', threadId: busy.threadId, prompt: 'Queued evidence while you work', dedupeKey: 'send-busy' } });
  assert.equal(busyReceipt.status, 'queued', 'Acknowledgement does not wait for an active provider turn');
  assert.equal(server.threads.mailbox.get(busyReceipt.messageId, owner.sessionKey).status, 'queued');
  releaseHeldTurn();
  await fleet.wait(busy.agentRunId); await waitReceipts();
  assert.equal(server.threads.mailbox.get(busyReceipt.messageId, owner.sessionKey).status, 'delivered');
  console.log(`PASS active recipients accept queued follow-ups without blocking the sender (ack observed in ${(performance.now() - began).toFixed(1)}ms including fixture drain)`);

  const mainAgentTool = createFleetTools({ controller: fleet })[0];
  holdArmed = true; releaseHeldTurn = null; reportAbortAsError = true;
  const stopped = await server.threads.request(owner, { input: { action: 'start', prompt: 'hold-turn for stop', label: 'Stop test', dedupeKey: 'start-stop' } });
  while (!releaseHeldTurn) await new Promise(resolve => setTimeout(resolve, 5));
  await mainAgentTool.execute('stop-other-agent', { action: 'stop', agentRunId: stopped.agentRunId });
  await fleet.wait(stopped.agentRunId);
  const stoppedRun = fleet.status(stopped.agentRunId);
  const stoppedView = server.sessions.get(stoppedRun.providerSessionId);
  assert.equal(stoppedRun.status, 'cancelled');
  assert.equal(stoppedRun.error.interruption.source, 'agent');
  assert.equal(stoppedView.latestTurn.state, 'interrupted', 'A stop is never Failed even when the provider reports abortion as an error');
  assert(stoppedView.replay(0).some(entry => entry.event.type === 'agent_end' && entry.event.interruption?.kind === 'stopped'));

  holdArmed = true; releaseHeldTurn = null;
  const replaced = await server.threads.request(owner, { input: { action: 'start', prompt: 'hold-turn for replacement', label: 'Replace test', dedupeKey: 'start-replace' } });
  while (!releaseHeldTurn) await new Promise(resolve => setTimeout(resolve, 5));
  await mainAgentTool.execute('replace-other-agent', { action: 'send', agentRunId: replaced.agentRunId, prompt: 'Do this replacement task.', interrupt: true });
  const replacementRun = await fleet.wait(replaced.agentRunId);
  assert.equal(replacementRun.status, 'completed');
  assert.equal(replacementRun.attempt, 2);
  const replacementView = server.sessions.get(replacementRun.providerSessionId);
  assert(replacementView.replay(0).some(entry => entry.event.type === 'agent_end' && entry.event.interruption?.kind === 'interrupted' && entry.event.interruption?.source === 'agent'));
  reportAbortAsError = false;
  console.log('PASS agent stop provenance and atomic interrupt-with-new-instruction retain canonical outcomes and resume correctly');

  const bRun = fleet.status(b.agentRunId);
  // Await catalog metadata publication before exercising the public attach path.
  while (!(await server.catalog.find(bRun.providerSessionId, { project }))?.agentCreatedBy) await new Promise(resolve => setTimeout(resolve, 10));
  const view = await server.attachSession(client, { project, session: bRun.providerSessionId, noSession: true, memoryEnabled: false });
  assert.equal(workersCreated, 1, 'Viewing a child must reuse its owner, never start another full worker');
  assert.equal(view.connected.agentPermissionMode, bRun.permissionMode);
  assert.equal(view.connected.runtimeMode, 'approval-required');
  const ownedView = server.sessions.get(view.sessionKey);
  await ownedView.request(client, 'prompt', { prompt: 'Continue within the original scope.' }, { turnId: 'child-view-followup' });
  assert.equal(workersCreated, 1);
  assert(ownedView.replay(0).some(entry => entry.event.type === 'message_end' && entry.event.message?.role === 'assistant'));
  assert(!owner.replay(0).some(entry => entry.event.type === 'message_end' && entry.event.message?.role === 'assistant'));
  await assert.rejects(ownedView.request(client, 'configure', { runtimeMode: 'full-access' }), /retains its fleet/);
  await assert.rejects(owner.request(client, 'agents.receiveThreadMessage', { agentRunId: a.agentRunId, message: {} }), /server-assigned/);
  server.catalog.recordAttachment({ canonicalChatId: bRun.providerSessionId, aliases: ['recipient-alias'] });
  const aliasReceipt = await server.threads.request(owner, { agentRunId: a.agentRunId, input: { action: 'send', threadId: 'recipient-alias', prompt: 'Alias routing', dedupeKey: 'alias-call' } });
  assert.equal(aliasReceipt.recipientThreadId, bRun.providerSessionId);
  await waitReceipts();
  console.log('PASS scoped single-owner child view, event separation, sender authority and canonical alias routing');

  const childTool = createThreadTool(threadClient.forAgent(a.agentRunId))[0];
  const nested = JSON.parse((await childTool.execute('nested', { action: 'start', prompt: 'Nested task', label: 'Nested' })).content[0].text);
  await fleet.wait(nested.agentRunId);
  assert.equal(fleet.status(nested.agentRunId).parentAgentRunId, a.agentRunId);
  assert.equal(fleet.status(nested.agentRunId).depth, 2);
  assert.deepEqual(fleet.status(nested.agentRunId).tools, fleet.status(a.agentRunId).tools);
  const grandchild = await server.threads.request(owner, { agentRunId: nested.agentRunId, input: { action: 'start', prompt: 'Third level', dedupeKey: 'third' } });
  await fleet.wait(grandchild.agentRunId);
  await assert.rejects(server.threads.request(owner, { agentRunId: grandchild.agentRunId, input: { action: 'start', prompt: 'Too deep', dedupeKey: 'fourth' } }), /depth 4 exceeds/);
  await fleet.stop(a.agentRunId);
  assert(!fleet.completedHosts.has(nested.agentRunId));
  assert(!fleet.completedHosts.has(grandchild.agentRunId));
  console.log('PASS inherited scopes, bounded depth, and descendant stop ownership');

  const workflowAgent = await fleet.spawn({ goal: 'Budgeted workflow task', model: 'inherit', workflowRunId: 'workflow-fixture', background: true });
  await fleet.wait(workflowAgent.agentRunId);
  await assert.rejects(server.threads.request(owner, { agentRunId: workflowAgent.agentRunId, input: { action: 'start', prompt: 'Unbudgeted work', dedupeKey: 'workflow-bypass' } }), /workflow scheduler/);
  await assert.rejects(fleet.send(workflowAgent.agentRunId, 'Unbudgeted follow-up'), /workflow scheduler/);
  console.log('PASS workflow agents cannot bypass request and cost budgets through thread creation or completed follow-ups');

  providerFail = true;
  const failReceipt = await server.threads.request(owner, { input: { action: 'send', threadId: b.threadId, prompt: 'Fail this recipient turn', dedupeKey: 'fail-provider' } });
  await waitReceipts();
  assert.equal(server.threads.mailbox.get(failReceipt.messageId, owner.sessionKey).status, 'failed');
  assert.equal(fleet.status(b.agentRunId).status, 'failed');
  assert.equal(server.sessionPresence(bRun.providerSessionId).latestTurn.state, 'error', 'Canonical child presence preserves provider failure across reattachment');
  assert.match(fleet.status(b.agentRunId).error.message, /Synthetic thread provider failure/);
  providerFail = false;
  await fleet.chatPrompt(b.agentRunId, 'Recover using the same child transcript');
  assert.equal(fleet.status(b.agentRunId).status, 'completed');
  assert.equal(fleet.status(b.agentRunId).sessionFile, bRun.sessionFile);
  console.log('PASS recipient provider failure remains a failure and scoped persisted retry recovers');

  await fleet.dispose();
  fleet = new AgentFleetController({ project, rootSessionId: rootManager.getSessionId(), rootThreadId: rootManager.getSessionId(),
    rootSession: { model, modelRuntime, modelRegistry: new ModelRegistry(modelRuntime) }, sessionFactory: factory, threadBridgeClient: threadClient });
  fleet.subscribe(({ snapshot }) => worker.emit('event', { type: 'fleet.updated', fleet: { ...snapshot, agents: Object.fromEntries(Object.values(snapshot.agents).map(run => [run.agentRunId, { ...run, grantedTools: run.tools }])) } }));
  fleet.subscribeSessionEvents(({ agentRunId, event }) => worker.emit('event', { type: 'zyra_child_session_event', agentRunId, event }));
  await fleet.initialize({ installRoot: directory });
  assert.equal(fleet.cancellation.nodes.get(nested.agentRunId)?.parentId, a.agentRunId, 'Persisted nested ownership is restored without replaying tasks');
  await fleet.chatPrompt(b.agentRunId, 'Continue after an explicit fleet restore');
  assert.equal(fleet.status(b.agentRunId).sessionFile, bRun.sessionFile);
  assert.equal(fleet.status(b.agentRunId).permissionMode, bRun.permissionMode);
  assert.equal(workersCreated, 1);
  console.log('PASS fleet restart restores scoped conversation ownership and explicitly resumes its existing transcript');
  await fleet.cancelAll('fixture complete');
  assert.equal(fleet.cancellation.nodes.size, 1);
} finally {
  await fleet?.dispose();
  for (const session of new Set(server?.sessions.values() || [])) session.dispose('fixture complete');
  globalThis.fetch = oldFetch;
  await rm(directory, { recursive: true, force: true });
}
