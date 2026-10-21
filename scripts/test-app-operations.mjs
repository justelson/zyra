import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { appOperationPolicy, requestAgentAppOperation, completeAgentAppOperation, validateAgentAppOperation } from '../src/agent-server/app-operations.mjs';
import { createAppControlTools } from '../src/app-control-tool.mjs';
import { CanonicalChatCatalog } from '../src/agent-server/catalog.mjs';
import { getAgentServerPaths } from '../src/agent-server/paths.mjs';

const request = (domain, operation, params = {}) => ({ domain, operation, params });
assert.deepEqual(appOperationPolicy(request('settings', 'get', { keys: ['accentColor'] }), 'read-only'), { mutation: false, needsApproval: false });
assert.deepEqual(appOperationPolicy(request('usage', 'refresh'), 'read-only'), { mutation: false, needsApproval: false });
assert.equal(appOperationPolicy(request('settings', 'apply', { patch: { accentColor: '#f00' } }), 'full-access').needsApproval, false);
for (const value of [request('settings', 'apply', { patch: { assistantMemoryEnabled: true } }), request('settings', 'apply', { patch: { assistantCustomSkillDirectories: ['/x'] } }), request('settings_action', 'run', { area: 'runtime.activate' }), request('app', 'fork', { area: 'chats' }), request('app', 'rename', { area: 'chats' }), request('settings', 'undo')]) {
  assert.equal(appOperationPolicy(value, 'full-access').needsApproval, true);
}
for (const value of [request('settings', 'fork'), request('app', 'fork_prepare'), request('app', 'fork_attach'), request('app', 'fork_source'), request('app', 'fork_rollback'), request('raw_ipc', 'run'), request('settings', 'apply', { input: { confirmed: true } }), request('settings_action', 'run', { input: { approved: true } }), request('settings', 'get', { input: { apiKey: 'not-a-secret-fixture' } })]) assert.throws(() => appOperationPolicy(value, 'full-access'));
assert.throws(() => appOperationPolicy(request('settings', 'apply'), 'read-only'), /read-only/);
assert.throws(() => appOperationPolicy(request('app', 'rename', { area: 'chats' }), 'full-access', true), /Supporting/);
for (const operation of ['read', 'search', 'update', 'create']) assert.throws(() => appOperationPolicy(request('app', operation, { area: 'order', target: 'authorized', input: { owner: 'live', group: 'chats', before: 'other' } }), 'read-only'), /Unsupported operation/);
assert.throws(() => appOperationPolicy(request('app', 'preview', { area: 'queues', input: { messageId: 'saved' } }), 'read-only'), /Unsupported operation/);
assert.deepEqual(appOperationPolicy(request('app', 'preview', { area: 'order' }), 'read-only'), { mutation: false, needsApproval: false });
assert.equal(appOperationPolicy(request('app', 'resume', { area: 'queues' }), 'full-access').needsApproval, true);
assert.equal(appOperationPolicy(request('app', 'list', { area: 'chats', input: { appScope: 'installation' } }), 'full-access').needsApproval, true, 'expanded reads require real consent, not only mutations');
assert.throws(() => appOperationPolicy(request('app', 'list', { area: 'chats', input: { appScope: 'installation' } }), 'full-access', true), /cannot expand/);
const calls = [];
const tools = createAppControlTools({ request: async input => { calls.push(input); return { ok: true }; } });
assert.deepEqual(tools.map(tool => tool.name), ['settings', 'settings_action', 'app', 'usage']);
await tools[0].execute('trusted-tool-call', { action: 'get', area: 'appearance' });
assert.deepEqual(calls[0], { action: 'app', domain: 'settings', operation: 'get', params: { area: 'appearance' }, dedupeKey: 'trusted-tool-call' });
assert.deepEqual(createAppControlTools(null), []);

const temporary = mkdtempSync(path.join(tmpdir(), 'zyra-app-transport-'));
try {
  const desktop = { authenticated: true, canOperateApp: true, socket: { writable: true } };
  const other = { authenticated: true, canOperateApp: true, socket: { writable: true } };
  const source = { sessionKey: 'real-parent', userInputContinuationEpoch: 0, activeRequestContext: { turnId: 'turn-1' }, connectedResult: { config: { runtimeMode: 'full-access' } }, worker: { request: async (_method, payload) => { authorizations.push(payload); return { allowed: true }; } } };
  source.appFilesystemScope = { authorityProof: 'synthetic-private-proof-not-for-app-control', roots: [] };
  const authorizations = [], delivered = [];
  let sender = { senderCanonicalThreadId: 'real-origin', project: '/authorized-project', agent: null };
  let handler = async () => ({ value: 'owned-result' });
  const server = { paths: { namespaceId: 'namespace' }, threads: { sender: () => sender }, clients: new Map([['owner', desktop]]), appRequests: new Map(), send(owner, message) {
    delivered.push({ owner, message });
    assert.equal(validateAgentAppOperation(server, owner, { operationId: message.request.operationId, requestId: message.requestId }).valid, true);
    assert.equal(validateAgentAppOperation(server, owner, { operationId: message.request.operationId, requestId: 'expired-owner-request' }).valid, false, 'a new same-ID request cannot revive an expired ownership lease');
    assert.equal(validateAgentAppOperation(server, other, { operationId: message.request.operationId, requestId: message.requestId }).valid, false, 'validation cannot transfer to a different owner');
    queueMicrotask(async () => { try { completeAgentAppOperation(server, owner, { requestId: message.requestId, ok: true, result: await handler(message.request) }); } catch (error) { completeAgentAppOperation(server, owner, { requestId: message.requestId, ok: false, error: { message: error.message } }); } });
  } };
  const invoke = input => requestAgentAppOperation(server, source, { input: { dedupeKey: 'stable-call', ...input } });
  assert.equal((await invoke(request('settings', 'get', { area: 'appearance', input: { actor: { canonicalChatId: 'spoofed' } } }))).value, 'owned-result');
  const envelope = delivered.at(-1).message.request;
  assert.equal(envelope.actor.canonicalChatId, 'real-origin');
  assert.equal(envelope.actor.parentChatId, 'real-parent');
  assert.equal(envelope.actor.turnId, 'turn-1');
  assert.equal(envelope.actor.namespaceId, 'namespace');
  assert.equal(envelope.actor.project, '/authorized-project');
  assert.equal(envelope.actor.appScope, 'project');
  assert.ok(!JSON.stringify(envelope).includes('synthetic-private-proof'), 'app control never forwards filesystem authority proofs');
  await invoke(request('settings', 'apply', { patch: { assistantMemoryEnabled: true } }));
  assert.equal(authorizations.length, 1, 'full access cannot self-approve protected data sharing');
  assert.match(authorizations[0].detail, /assistantMemoryEnabled/);
  assert.equal(delivered.at(-1).message.request.actor.approved, true);
  await invoke(request('app', 'list', { area: 'chats', input: { appScope: 'installation' } }));
  assert.equal(authorizations.length, 2);
  assert.equal(delivered.at(-1).message.request.actor.appScope, 'installation');
  let approvalResolve;
  source.worker.request = () => new Promise(resolve => { approvalResolve = resolve; });
  const stopped = invoke(request('settings_action', 'run', { area: 'runtime.activate' }));
  await Promise.resolve();
  const deliveredBeforeStop = delivered.length;
  source.userInputContinuationEpoch++;
  approvalResolve({ allowed: true });
  await assert.rejects(stopped, /stopped/);
  assert.equal(delivered.length, deliveredBeforeStop, 'Stop while approval is pending prevents owner delivery');
  source.worker.request = async () => ({ allowed: false });
  await assert.rejects(invoke(request('settings_action', 'run', { area: 'runtime.activate' })), /did not approve/);
  source.worker.request = async () => ({ allowed: true });
  sender = { ...sender, agent: { permissionMode: 'full-access' } };
  await assert.rejects(invoke(request('app', 'rename', { area: 'chats' })), /Supporting/);
  sender = { ...sender, agent: null };
  server.clients.clear();
  await assert.rejects(invoke(request('usage', 'get')), error => error.code === 'APP_OWNER_UNAVAILABLE');
  server.clients.set('owner', desktop);
  const pending = { owner: desktop, timer: setTimeout(() => {}, 100), resolve() {}, reject() {} };
  server.appRequests.set('exact-owner', pending);
  assert.throws(() => completeAgentAppOperation(server, other, { requestId: 'exact-owner', ok: true }), /authenticated owner/);
  clearTimeout(pending.timer); server.appRequests.delete('exact-owner');

  const project = path.join(temporary, 'project'), directory = path.join(project, '.zyra', 'sessions');
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'source.jsonl');
  writeFileSync(file, [
    { type: 'session', version: 3, id: 'fork-source', cwd: project, timestamp: '2026-01-01T00:00:00Z' },
    { type: 'message', id: 'question', parentId: null, timestamp: '2026-01-01T00:00:01Z', message: { role: 'user', timestamp: 100, content: [{ type: 'text', text: 'Question' }] } },
    { type: 'message', id: 'answer', parentId: 'question', timestamp: '2026-01-01T00:00:02Z', message: { role: 'assistant', timestamp: 101, provider: 'test', model: 'model', content: [{ type: 'text', text: 'Answer' }] } },
  ].map(JSON.stringify).join('\n') + '\n');
  const options = { stateDirectory: path.join(temporary, 'state'), channel: 'app-test' };
  server.paths = getAgentServerPaths(options);
  server.catalog = new CanonicalChatCatalog(options);
  server.catalog.registerProject(project); await server.catalog.index.refreshProject(project);
  const phases = [];
  handler = async envelope => {
    phases.push(envelope.operation);
    if (envelope.operation === 'fork_source') return { sourceCanonicalChatId: 'fork-source' };
    if (envelope.operation === 'fork_prepare') return { sourceCanonicalChatId: 'fork-source', scope: null, workingRoot: project };
    assert.equal(envelope.operation, 'fork_attach');
    assert.equal((await server.catalog.find(envelope.params.input.canonicalChatId, { project })).forkPending, true);
    return { sessionId: 'imported-fork', selected: false };
  };
  await assert.rejects(invoke(request('app', 'fork', { area: 'chats', input: { entryId: 'missing-persisted-entry', worktree: 'isolated' } })), /persisted message boundary/);
  assert.deepEqual(phases, ['fork_source'], 'invalid persisted boundary causes zero Desktop workspace preparation');
  phases.length = 0;
  const fork = await invoke(request('app', 'fork', { area: 'chats', input: { entryId: 'answer' } }));
  assert.deepEqual(phases, ['fork_source', 'fork_prepare', 'fork_attach']);
  assert.equal(fork.scopeConfirmed, true); assert.equal(fork.autoPrompted, false);
  assert.equal((await server.catalog.find(fork.canonicalChatId, { project })).forkPending, false);
  assert.equal(readFileSync(file, 'utf8').includes(fork.canonicalChatId), false);
  phases.length = 0;
  const expandedFork = await invoke({ ...request('app', 'fork', { area: 'chats', input: { entryId: 'answer', appScope: 'installation' } }), dedupeKey: 'expanded-fork' });
  assert.equal(expandedFork.scopeConfirmed, true, 'real approved app scope is consumed as authority intent, not passed as a canonical fork option');
  assert.deepEqual(phases, ['fork_source', 'fork_prepare', 'fork_attach']);
  // A source changed after preflight fails before history claim, so only this
  // exact preparation gets a private cleanup request on the same owner lease.
  const sourceBytes = readFileSync(file, 'utf8');
  phases.length = 0;
  handler = async envelope => {
    phases.push(envelope.operation);
    if (envelope.operation === 'fork_source') return { sourceCanonicalChatId: 'fork-source' };
    if (envelope.operation === 'fork_prepare') {
      writeFileSync(file, 'invalid snapshot\n');
      return { sourceCanonicalChatId: 'fork-source', scope: { workingRoot: project }, workingRoot: project, rollbackToken: 'private-test-token' };
    }
    assert.equal(envelope.operation, 'fork_rollback');
    assert.equal(envelope.params.input.rollbackToken, 'private-test-token');
    return { rolledBack: true };
  };
  await assert.rejects(invoke({ ...request('app', 'fork', { area: 'chats', input: { entryId: 'answer', worktree: 'isolated' } }), dedupeKey: 'changed-source' }), /invalid persisted entries/);
  assert.deepEqual(phases, ['fork_source', 'fork_prepare', 'fork_rollback']);
  writeFileSync(file, sourceBytes);
  phases.length = 0;
  const updateChat = server.catalog.updateChat.bind(server.catalog);
  server.catalog.updateChat = async () => { throw new Error('synthetic catalog uncertainty'); };
  handler = async envelope => {
    phases.push(envelope.operation);
    if (envelope.operation === 'fork_source') return { sourceCanonicalChatId: 'fork-source' };
    assert.equal(envelope.operation, 'fork_prepare');
    return { sourceCanonicalChatId: 'fork-source', scope: { workingRoot: project }, workingRoot: project, rollbackToken: 'must-never-clean' };
  };
  await assert.rejects(invoke({ ...request('app', 'fork', { area: 'chats', input: { entryId: 'answer', worktree: 'isolated' } }), dedupeKey: 'uncertain-history' }), /history may be saved/);
  assert.deepEqual(phases, ['fork_source', 'fork_prepare'], 'uncertain saved history never requests workspace deletion');
  server.catalog.updateChat = updateChat;
  console.log('App tools/transport: server-derived identity, strict public operations, real approval, Stop/revocation boundary, child/read-only limits, exact owner and durable pending-scope fork handshake passed');
} finally { rmSync(temporary, { recursive: true, force: true }); }
