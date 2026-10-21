import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ZyraAgentServer } from '../src/agent-server/server.mjs';
import { ZyraAgentServerClient } from '../src/agent-server/client.mjs';
import { readRuntimeRevision } from '../src/agent-server/runtime-revision.mjs';

const directory = await mkdtemp(path.join(os.tmpdir(), 'zyra-auto-activation-'));
const servers = [], clients = [];
const waitFor = async (predicate, message) => {
  const deadline = Date.now() + 3500;
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(predicate(), message);
};
try {
  const root = path.join(directory, 'runtime');
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), '{}');
  await writeFile(path.join(root, 'src/version.mjs'), 'export const version = 2;');
  const desired = await readRuntimeRevision(root);
  const options = { root, stateDirectory: path.join(directory, 'state'), channel: 'auto', endpoint: 0, desktopAuthorityToken: 'fixture-only-proof' };
  let server = new ZyraAgentServer(options); servers.push(server); await server.start();
  server.runtimeRevision = 'a'.repeat(64);
  const activity = { activeTurns: 1, backgroundChats: 0, attention: 0, requests: 0, workspaceRequests: 0, externalTools: 0 };
  server.runtimeActivity = () => ({ ...activity });
  let retired, retirements = 0, starts = 0, blockNextRetire = false;
  const handleRequest = server.handleRequest.bind(server);
  server.handleRequest = (owner, method, params) => {
    if (method === 'server.retire' && blockNextRetire) { blockNextRetire = false; activity.activeTurns = 1; }
    return handleRequest(owner, method, params);
  };
  server.once('retire', () => { retirements++; retired = server.stop(); });
  const client = new ZyraAgentServerClient({ ...options, surface: 'desktop', authorities: ['desktop-control'], authorityProof: 'fixture-only-proof', heartbeatIntervalMs: 100 });
  clients.push(client);
  client.startServer = () => { starts++; void retired.then(async () => { server = new ZyraAgentServer(options); servers.push(server); await server.start(); }); };
  await client.connect();
  const oldId = client.instance.instanceId;
  assert.equal(client.connectionStatus.updatePending, true);
  for (const blocker of Object.keys(activity)) {
    for (const key of Object.keys(activity)) activity[key] = key === blocker ? 1 : 0;
    await new Promise(resolve => setTimeout(resolve, 230));
    assert.equal(retirements, 0, `${blocker} must not be cancelled by automatic activation`);
    assert.equal(client.socket.writable, true);
  }
  // Explicit close cancels the deferred timer. Inspection and unverified clients
  // cannot activate even if the old server later becomes idle.
  client.close();
  const observer = new ZyraAgentServerClient({ ...options, autoStart: false, verifyRuntimeRevision: true, heartbeatIntervalMs: 100 });
  const unverified = new ZyraAgentServerClient({ ...options, surface: 'desktop', authorities: ['desktop-control'], authorityProof: 'wrong-proof', heartbeatIntervalMs: 100 });
  clients.push(observer, unverified);
  await observer.connect(); await unverified.connect();
  for (const key of Object.keys(activity)) activity[key] = 0;
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(retirements, 0, 'closed, read-only and unverified clients must never activate');
  activity.activeTurns = 1;
  await client.connect();
  observer.close(); unverified.close();

  // Modern missing/unknown activity stays pending, not guessed idle.
  const state = server.state.bind(server);
  server.state = input => { const result = state(input); delete result.activity; return result; };
  for (const key of Object.keys(activity)) activity[key] = 0;
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(retirements, 0, 'modern unknown activity must not trigger automatic activation');
  server.state = state;
  blockNextRetire = true;
  await waitFor(() => !blockNextRetire, 'automatic activation must recheck the idle server');
  assert.equal(retirements, 0, 'new work racing the idle observation must refuse retirement');
  assert.equal(client.socket.writable, true, 'busy recheck must not detach older Chats');

  // Replacement servers share this test's PID. Never wait for/stop the test itself.
  const descriptor = JSON.parse(readFileSync(server.paths.descriptorFile, 'utf8'));
  writeFileSync(server.paths.descriptorFile, JSON.stringify({ ...descriptor, pid: 2147483646 }));
  for (const key of Object.keys(activity)) activity[key] = 0;
  await waitFor(() => client.connectionStatus.instance?.runtimeRevision === desired, 'a busy update must activate on the first idle heartbeat without another click/reconnect');
  assert.equal(starts, 1);
  assert.equal(retirements, 1);
  assert.notEqual(client.instance.instanceId, oldId);
  assert.equal(client.connectionStatus.phase, 'ready');
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(starts, 1, 'a current runtime must not restart repeatedly');
  assert.ok(!JSON.stringify(client.connectionStatus).includes('fixture-only-proof'));

  // The real transport must admit the app-owner validation RPC, then enforce ownership.
  await assert.rejects(client.request('desktop.app.validate', { operationId: 'missing', requestId: 'missing' }), error => {
    assert.notEqual(error.code, 'AGENT_SERVER_PROTOCOL_ERROR', 'the app RPC must be registered before owner validation');
    return /owner|operation|request|expired|authority/i.test(error.message);
  });
  const appOwner = new ZyraAgentServerClient({ ...options, clientId: 'fixture-app-owner', surface: 'desktop', authorities: ['desktop-app', 'desktop-control'], authorityProof: 'fixture-only-proof', heartbeat: false });
  clients.push(appOwner); await appOwner.connect();
  const owner = [...server.clients.values()].find(value => value.clientId === 'fixture-app-owner');
  const source = { userInputContinuationEpoch: 0, activeRequestContext: { turnId: 'turn-1' } };
  server.appRequests.set('app-fixture', { owner, operationId: 'operation-fixture', source, stopEpoch: 0, turnId: 'turn-1' });
  assert.deepEqual(await appOwner.request('desktop.app.validate', { requestId: 'app-fixture', operationId: 'operation-fixture' }), { valid: true });
  source.userInputContinuationEpoch++;
  assert.deepEqual(await appOwner.request('desktop.app.validate', { requestId: 'app-fixture', operationId: 'operation-fixture' }), { valid: false }, 'Stop must revoke the real transport validation');
  server.appRequests.delete('app-fixture');
  appOwner.close();

  // Closing the owner synchronously during disconnect must not resurrect it.
  const closing = new ZyraAgentServerClient({ ...options, autoStart: false, heartbeat: false });
  clients.push(closing);
  closing.socket = { writable: true, destroy() {} };
  closing.requestConnected = async () => ({ retiring: true });
  closing.startServer = () => { throw new Error('A closed owner attempted to launch a server'); };
  closing.once('disconnect', () => closing.close());
  await assert.rejects(closing.replaceRuntime({ pid: 2147483646 }, desired, 'closed-owner-fixture'), error => error.code === 'AGENT_SERVER_DISCONNECTED');

  // Legacy servers can refuse retirement safely but do not expose activity. The
  // retry must ask that existing gate, not stall forever waiting for new fields.
  const legacyOptions = { ...options, stateDirectory: path.join(directory, 'legacy-state') };
  const legacy = new ZyraAgentServer(legacyOptions); servers.push(legacy); await legacy.start();
  legacy.runtimeRevision = 'b'.repeat(64);
  let legacyBusy = true, legacyRetired, legacyAttempts = 0;
  legacy.runtimeActivity = () => ({ ...activity, activeTurns: legacyBusy ? 1 : 0 });
  const legacyState = legacy.state.bind(legacy), legacyRequest = legacy.handleRequest.bind(legacy);
  legacy.state = input => { const result = legacyState(input); result.activationVersion = 1; delete result.activity; return result; };
  legacy.handleRequest = (owner, method, params) => {
    if (method === 'server.retire') { legacyAttempts++; assert.equal(params.activationVersion, 1); params = { ...params, activationVersion: 2 }; }
    return legacyRequest(owner, method, params);
  };
  legacy.once('retire', () => { legacyRetired = legacy.stop(); });
  const legacyClient = new ZyraAgentServerClient({ ...legacyOptions, surface: 'desktop', authorities: ['desktop-control'], authorityProof: 'fixture-only-proof', heartbeatIntervalMs: 100 });
  clients.push(legacyClient);
  legacyClient.startServer = () => { void legacyRetired.then(async () => { const next = new ZyraAgentServer(legacyOptions); servers.push(next); await next.start(); }); };
  await legacyClient.connect();
  await waitFor(() => legacyAttempts >= 2, 'legacy deferred update must retry the authoritative idle gate');
  assert.equal(legacyRetired, undefined, 'legacy active work must be retained');
  const legacyDescriptor = JSON.parse(readFileSync(legacy.paths.descriptorFile, 'utf8'));
  writeFileSync(legacy.paths.descriptorFile, JSON.stringify({ ...legacyDescriptor, pid: 2147483646 }));
  legacyBusy = false;
  await waitFor(() => legacyClient.connectionStatus.instance?.runtimeRevision === desired, 'legacy busy-to-idle must activate without another click');
  console.log('Automatic runtime update: blockers, race, unknown activity, authority, close, legacy idle retry, single replacement and real app RPC passed');
} finally {
  clients.forEach(client => client.close());
  for (const server of servers) await server.stop();
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
