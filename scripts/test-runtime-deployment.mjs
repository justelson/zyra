import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDeploymentReport, parseArgs, inspectDeployment } from './runtime-deployment.mjs';
import { ZyraAgentServer } from '../src/agent-server/server.mjs';
import { RUNTIME_ACTIVATION_VERSION } from '../src/agent-server/runtime-revision.mjs';

const A = 'a'.repeat(64), B = 'b'.repeat(64), NS = 'c'.repeat(20), now = '2026-01-01T00:00:00.000Z';
function fixture() {
  return { desiredRevision: A, expectedRevision: A, expectedNamespaceId: NS, channel: 'dev', now,
    observation: { confirmed: true, observedAt: now, status: { activationVersion: RUNTIME_ACTIVATION_VERSION, runtimeRevision: A, clients: 2,
      instance: { runtimeRevision: A, instanceId: '12345678-1234-1234-1234-123456789abc', namespaceId: NS, channel: 'dev' } } } };
}
const report = (mutate = () => {}) => { const input = fixture(); mutate(input); return createDeploymentReport(input); };
const verified = report();
assert.equal(verified.runtime.state, 'verified');
assert.equal(verified.stages.serverActive, 'verified');
for (const key of ['sourceFixed', 'buildProduced', 'appInstalled', 'bugVerified']) assert.equal(verified.stages[key], 'unknown');
assert.equal(report(input => { input.observation.status.runtimeRevision = B; input.observation.status.instance.runtimeRevision = B; }).runtime.state, 'mismatch');
assert.equal(report(input => { input.expectedRevision = B; }).runtime.state, 'mismatch');
assert.equal(report(input => { input.desiredRevision = null; }).runtime.state, 'unknown');
assert.equal(report(input => { input.observation.status.activationVersion = 1; }).runtime.state, 'unknown', 'legacy fingerprint algorithms cannot certify current runtime agreement');
assert.equal(report(input => { input.observation = null; }).runtime.state, 'disconnected');
for (const observedAt of ['2025-12-31T23:59:54.999Z', '2026-01-01T00:00:00.001Z', 'invalid']) {
  const stale = report(input => { input.observation.observedAt = observedAt; });
  assert.equal(stale.runtime.state, 'unknown'); assert.equal(stale.observedAt, null);
}
for (const [key, value] of [['namespaceId', 'd'.repeat(20)], ['channel', 'stable']]) {
  assert.equal(report(input => { input.observation.status.instance[key] = value; }).runtime.state, 'mismatch');
}
assert.equal(report(input => { delete input.observation.status.instance.instanceId; }).runtime.state, 'unknown');
assert.equal(report(input => { input.observation.status.instance.runtimeRevision = B; }).runtime.state, 'mismatch');
assert.equal(report(input => { delete input.expectedRevision; }).runtime.state, 'verified');
assert.equal(report(input => { input.expectedRevision = 'invalid'; }).runtime.state, 'unknown');
const input = fixture();
Object.assign(input.observation.status, { token: 'synthetic-secret', endpoint: '/private/socket', sessions: [{ prompt: 'private prompt' }] });
const before = structuredClone(input), safe = JSON.stringify(createDeploymentReport(input));
for (const privateText of ['synthetic-secret', '/private/', 'prompt', 'sessions', 'activeCount']) assert.equal(safe.includes(privateText), false);
assert.deepEqual(input, before);
for (const clients of [undefined, -1, 1.5, '2', Infinity]) assert.equal(report(input => { input.observation.status.clients = clients; }).runtime.clientCount, null);
const args = ['--runtime-root', '/synthetic/runtime', '--state-directory', '/synthetic/state', '--channel', 'DEV'];
assert.equal(parseArgs(args).channel, 'dev');
for (const invalid of [[], args.slice(0, 4), [...args, '--restart'], [...args, '--channel', 'stable'], [...args, '--expected-runtime-revision', 'short']]) assert.throws(() => parseArgs(invalid));
const script = fileURLToPath(new URL('./runtime-deployment.mjs', import.meta.url));
assert.equal(spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' }).status, 0);
const missing = spawnSync(process.execPath, [script], { encoding: 'utf8' });
assert.equal(missing.status, 2); assert.equal(JSON.parse(missing.stdout).error, 'INVALID_ARGUMENTS');

const directory = await mkdtemp(path.join(os.tmpdir(), 'zyra-deployment-inspection-'));
let server;
try {
  const root = path.join(directory, 'runtime'); await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), '{}'); await writeFile(path.join(root, 'src/fixture.mjs'), 'export const fixture = true;');
  const options = { root, stateDirectory: path.join(directory, 'state'), channel: 'inspection', endpoint: 0 };
  server = new ZyraAgentServer(options); await server.start();
  const methods = [], original = server.handleRequest.bind(server);
  server.handleRequest = (client, method, params) => { methods.push(method); return original(client, method, params); };
  const live = await inspectDeployment(options);
  assert.equal(live.runtime.state, 'verified');
  assert.deepEqual(methods, ['server.status'], 'inspection never attaches, starts, retires or interrupts');
  server.runtimeRevision = B;
  assert.equal((await inspectDeployment(options)).runtime.state, 'mismatch');
  assert.equal(server.retiring, false);
  assert.equal((await inspectDeployment({ ...options, stateDirectory: path.join(directory, 'missing') })).runtime.state, 'disconnected');
} finally { await server?.stop(); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
console.log('PASS deployment evidence, fingerprint/namespace/freshness checks and read-only real transport');
