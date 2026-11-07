import assert from 'node:assert/strict';
import { listHarnessModels, findHarnessExecutable, runHarnessTextTurn, createHarnessStreamSimple, ensureHarnessServe, stopHarnessServe } from '../src/opencode-harness.mjs';
import { HarnessConversation } from '../src/harness-conversation.mjs';
import { managedV2Config } from '../src/harness-v2-config.mjs';
import { listV2Models } from '../src/harness-v2-client.mjs';
import plugin from '../src/harness-v2-plugin/index.js';
import { harnessV2Fixture } from './fixtures/harness-v2.mjs';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { connectHarnessProvider } from '../src/provider-connections.mjs';
import { borrowedHarnessHooks } from '../src/agent-server/harness-transport-broker.mjs';

const models = [{ id: 'fixture', providerID: 'opencode', name: 'Fixture', type: 'chat', enabled: true, status: 'active',
  capabilities: { tools: true, input: ['text'], output: ['text', 'reasoning'] }, variants: [{ id: 'high' }],
  limit: { context: 32000, output: 4000 }, cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }] }];
const fetched = [];
const fetchImpl = async url => {
  const route = new URL(url).pathname; fetched.push(route);
  return route === '/api/model' ? Response.json({ location: { directory: '/project' }, data: models })
    : new Response('Not found', { status: 404 });
};
const catalog = await listHarnessModels({ apiVersion: 2, baseUrl: 'http://127.0.0.1:1234', password: 'fixture', cwd: '/project', fetch: fetchImpl });
assert.equal(catalog[0].id, 'opencode/fixture');
assert.equal(catalog[0].harness.free, true);
assert.deepEqual(fetched, ['/api/model']);
const native = 'C:\\profile\\npm\\node_modules\\@opencode\\cli\\bin\\opencode.exe';
assert.equal(findHarnessExecutable({ platform: 'win32', env: { APPDATA: 'C:\\profile', PATH: 'C:\\bin' }, exists: candidate => candidate === native || candidate === 'C:\\bin\\opencode.cmd' }), native);
console.log('OpenCode V2 catalog and native detection passed.');

const configuration = managedV2Config(JSON.stringify({ permissions: [{ action: 'shell', resource: 'rm *', effect: 'deny' }, { action: 'read', resource: '*', effect: 'allow' }], agents: { other: { system: 'preserved' } }, plugins: ['other'] }));
assert.equal(configuration.agents.other.system, 'preserved');
assert.equal(configuration.permissions[2].effect, 'ask');
assert.ok(configuration.agents['zyra-managed'].permissions.some(rule => rule.resource === 'rm *' && rule.effect === 'deny'));
assert.equal(configuration.plugins[0], 'other');
const originalMcp = { private: { type: 'local', command: ['fixture'], disabled: false } };
const processMcp = structuredClone(originalMcp);
await plugin.setup({ mcp: { transform: callback => callback({ list: () => Object.entries(processMcp), update: (name, update) => update(processMcp[name]) }) } });
assert.equal(processMcp.private.disabled, true); assert.equal(originalMcp.private.disabled, false);

let catalogAttempts = 0;
await listV2Models({ baseUrl: 'http://127.0.0.1:1234', password: 'fixture' }, { fetchImpl: async () => ++catalogAttempts === 1 ? new Response('', { status: 503 }) : Response.json({ data: models }) });
assert.equal(catalogAttempts, 2, 'retry transient plugin initialization only');
let unauthorizedAttempts = 0;
await assert.rejects(listV2Models({ baseUrl: 'http://127.0.0.1:1234', password: 'fixture' }, { fetchImpl: async () => { unauthorizedAttempts++; return new Response('', { status: 401 }); } }), /401/);
assert.equal(unauthorizedAttempts, 1);

const context = { systemPrompt: 'fixture system', messages: [{ role: 'user', content: 'history' }, { role: 'assistant', content: 'answer' }, { role: 'user', content: 'current' }] };
const fixture = harnessV2Fixture({ paginate: true });
const progress = [];
const reply = await runHarnessTextTurn({ client: fixture.client, modelId: 'opencode/fixture', variant: 'off', context, onProgress: event => progress.push(event) });
assert.equal(reply.text, 'hello');
assert.equal(reply.usage.input, 4);
assert.ok(fixture.calls.some(call => call.route.endsWith('/model') && call.body.model.variant === 'none'), 'legacy thinking-off is normalized for V2');
assert.ok(progress.some(event => event.text === 'hello'), 'real V2 SSE text reaches the public progress boundary');
assert.ok(progress.every(event => !event.text?.includes('OLD') && !event.text?.includes('FOREIGN') && event.text !== 'hellohello'), 'foreign, stale and duplicate SSE data is excluded');
assert.equal(fixture.calls.filter(call => call.route.endsWith('/synthetic')).length, 2);
assert.ok(fixture.calls.some(call => call.query.includes('cursor=opaque+cursor%262')), 'opaque native pagination is followed');
assert.equal(fixture.sessions.size, 0, 'one-shot native session is removed');
assert.ok(fixture.calls.some(call => call.method === 'PATCH' && call.body.permissions[0].effect === 'deny'), 'utility turns deny all native tools');

const reused = harnessV2Fixture({ noEvents: true });
const conversation = new HarnessConversation();
await runHarnessTextTurn({ client: reused.client, modelId: 'opencode/fixture', context: { systemPrompt: 'first system', messages: [{ role: 'user', content: 'first' }] }, conversation });
await runHarnessTextTurn({ client: reused.client, modelId: 'opencode/fixture', context: { messages: [{ role: 'user', content: 'first' }, { role: 'assistant', content: 'hello' }, { role: 'user', content: 'next' }] }, conversation });
assert.equal(reused.calls.filter(call => call.route === '/session').length, 1, 'matching follow-up retains its native session');
assert.equal(reused.calls.filter(call => call.route.endsWith('/synthetic')).length, 0, 'matching follow-up avoids history replay');
assert.ok(reused.calls.some(call => call.route.endsWith('/instructions/entries/zyra-system') && call.method === 'DELETE'), 'cleared system instructions cannot linger in a reused session');
await conversation.dispose();

for (const [tool, source, decision] of [['shell', true, 'once'], ['shell', false, 'reject'], ['external_custom', true, 'reject']]) {
  const gated = harnessV2Fixture({ tool, permissionSource: source });
  let requested = 0;
  const result = runHarnessTextTurn({ client: gated.client, modelId: 'opencode/fixture', context, onPermission: async input => {
    requested++; assert.equal(input.toolName, 'bash'); assert.equal(input.input.command, 'fixture only'); return true;
  } });
  if (tool === 'external_custom') await assert.rejects(result, /unapproved tool/); else await result;
  assert.deepEqual(gated.replies, [decision]);
  assert.equal(requested, decision === 'once' ? 1 : 0, 'only owned, correlated managed tools reach approvals');
  assert.equal(gated.sessions.size, 0);
}
const delayedTool = harnessV2Fixture({ tool: 'shell', lateTool: true });
let delayedApprovals = 0;
await runHarnessTextTurn({ client: delayedTool.client, modelId: 'opencode/fixture', context, onPermission: async () => { delayedApprovals++; return true; } });
assert.equal(delayedApprovals, 1, 'permission before its tool snapshot waits for correlation');
assert.deepEqual(delayedTool.replies, ['once']);
const aborted = harnessV2Fixture({ hold: true });
const abort = new AbortController();
const result = runHarnessTextTurn({ client: aborted.client, modelId: 'opencode/fixture', context, signal: abort.signal });
setTimeout(() => abort.abort(), 50);
await assert.rejects(result);
assert.ok(aborted.calls.some(call => call.route.endsWith('/interrupt')), 'cancel interrupts the actual native execution');
assert.equal(aborted.sessions.size, 0);
const late = harnessV2Fixture({ tool: 'shell' });
const lateAbort = new AbortController();
let enteredApproval, finishApproval;
const entered = new Promise(resolve => { enteredApproval = resolve; });
const lateResult = runHarnessTextTurn({ client: late.client, modelId: 'opencode/fixture', context, signal: lateAbort.signal,
  onPermission: () => { enteredApproval(); return new Promise(resolve => { finishApproval = resolve; }); } });
await entered;
lateAbort.abort(); await assert.rejects(lateResult);
finishApproval(true); await new Promise(resolve => setImmediate(resolve));
assert.ok(!late.replies.includes('once'), 'Stop rejects approval that resolves after native execution is cancelled');
const failing = harnessV2Fixture({ fail: true });
await assert.rejects(runHarnessTextTurn({ client: failing.client, modelId: 'opencode/fixture', context }), /fixture generation failed/);
const slowPoll = harnessV2Fixture({ slowPoll: true, noEvents: true });
await runHarnessTextTurn({ client: slowPoll.client, modelId: 'opencode/fixture', context });
assert.equal(slowPoll.cancelledPolls, 1, 'completed native reply cancels its stale background poll instead of waiting for it');
const broken = harnessV2Fixture({ hold: true, noEvents: true, brokenSnapshots: true });
await assert.rejects(runHarnessTextTurn({ client: broken.client, modelId: 'opencode/fixture', context, finalTimeoutMs: 3000 }), /503/);
assert.ok(broken.calls.some(call => call.route.endsWith('/interrupt')), 'failed recovery cannot leave an approval-blocked native execution running');

const pi = harnessV2Fixture();
const stream = createHarnessStreamSimple({ ...borrowedHarnessHooks(async () => ({ baseUrl: pi.client.baseUrl, password: pi.client.password, apiVersion: 2 })), fetchImpl: pi.client.fetch })({ id: 'opencode/fixture' }, context);
const emitted = [];
for await (const event of stream) emitted.push(event);
assert.ok(emitted.some(event => event.type === 'text_delta' && event.delta === 'hello'));
assert.equal((await stream.result()).stopReason, 'stop', 'Pi stream retains the V2 transport identity');

const directory = await mkdtemp(path.join(tmpdir(), 'zyra-harness-v2-test-'));
try {
  const transport = harnessV2Fixture();
  const child = new EventEmitter(); child.pid = 1; child.kill = () => { queueMicrotask(() => child.emit('exit', 0)); return true; };
  const file = path.join(directory, 'providers.json');
  const connection = await connectHarnessProvider({}, { file, cwd: directory,
    harness: { executable: 'v2-fixture', detect: { execFile: (_file, _args, _opts, callback) => callback(null, '2.2.5', '') }, spawn: () => child,
      fetch: (url, init) => new URL(url).pathname === '/api/model' ? Response.json({ data: models }) : transport.client.fetch(url, init) } });
  assert.equal(connection.verified, true);
  assert.equal(connection.model, 'opencode-harness/opencode/fixture');
  const persisted = await readFile(file, 'utf8');
  assert.ok(!persisted.includes('fixture-password') && !persisted.includes('Authorization'));
  assert.equal(transport.calls.some(call => call.route === '/global/health'), false, 'production provider connection uses V2 health and catalog');
  const lease = await ensureHarnessServe({ cwd: directory, executable: 'v2-fixture' });
  assert.equal(lease.client.apiVersion, 2, 'transport version survives lease reuse'); lease.release();
} finally {
  await stopHarnessServe(directory);
  if (path.dirname(directory) !== tmpdir() || !path.basename(directory).startsWith('zyra-harness-v2-test-')) throw new Error('Unexpected cleanup target');
  await rm(directory, { recursive: true, force: true });
}
console.log('OpenCode V2 policy, MCP isolation, readiness, SSE recovery, history reuse, permissions, pagination, cancellation and Pi streaming passed.');
