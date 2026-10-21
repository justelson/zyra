import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { ZyraAgentServerClient } from '../src/agent-server/client.mjs';
import { getAgentServerPaths } from '../src/agent-server/paths.mjs';
import { createAgentServerLineReader, writeAgentServerMessage, AGENT_SERVER_PROTOCOL_VERSION } from '../src/agent-server/protocol.mjs';
import { readRuntimeRevision, RUNTIME_ACTIVATION_VERSION } from '../src/agent-server/runtime-revision.mjs';
import { projectAgentServerInstance } from '../src/agent-server/connection-status.mjs';
import { formatAgentConnectionStatus } from '../src/agent-server/status-presentation.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'zyra-connection-status-'));
const stateDirectory = path.join(root, 'state');
const paths = getAgentServerPaths({ stateDirectory, channel: 'test' });
const token = randomBytes(16).toString('hex');
const sockets = new Set();
const clients = [];
let server;
try {
  await mkdir(path.join(root, 'src'));
  await mkdir(stateDirectory);
  await writeFile(path.join(root, 'src/fixture.mjs'), 'export const fixture = true;');
  await writeFile(path.join(root, 'package.json'), '{}');
  const revision = await readRuntimeRevision(root);
  const instance = { instanceId: 'server-1', namespaceId: paths.namespaceId, channel: 'test',
    protocolVersion: AGENT_SERVER_PROTOCOL_VERSION, runtimeRevision: '0'.repeat(64), startedAt: new Date().toISOString() };
  let methods = ['server.status', 'server.retire'];
  let retirementCode = 'AGENT_SERVER_UPGRADE_BUSY';
  let activationVersion = RUNTIME_ACTIVATION_VERSION;
  let retirementVersion = null;
  let dropHeartbeat = false;
  let heldCatalogRequest;
  let retireCalls = 0;
  server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    createAgentServerLineReader(socket, message => {
      if (message.type === 'hello') {
        assert.equal(message.token, token);
        writeAgentServerMessage(socket, { type: 'hello.ok', server: { version: AGENT_SERVER_PROTOCOL_VERSION,
          methods, activationVersion, runtimeRevision: instance.runtimeRevision, instance } });
      } else if (message.method === 'server.retire') {
        retireCalls++;
        retirementVersion = message.params.activationVersion;
        writeAgentServerMessage(socket, { type: 'response', id: message.id, ok: false,
          error: { code: retirementCode, message: 'Synthetic deferred update' } });
      } else if (message.method === 'server.status' && !dropHeartbeat) {
        writeAgentServerMessage(socket, { type: 'response', id: message.id, ok: true, result: { instance } });
      } else if (message.method === 'catalog.list') {
        heldCatalogRequest = { socket, id: message.id };
      }
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  await writeFile(paths.descriptorFile, JSON.stringify({ version: AGENT_SERVER_PROTOCOL_VERSION, endpoint: server.address().port,
    token, pid: process.pid, namespaceId: paths.namespaceId }));
  const makeClient = (options = {}) => {
    const client = new ZyraAgentServerClient({ root, stateDirectory, channel: 'test', heartbeat: false,
      requiredMethods: ['server.status'], ...options });
    client.startServer = () => { throw new Error('Tests must never launch a real agent server'); };
    clients.push(client); return client;
  };
  for (const code of ['AGENT_SERVER_UPGRADE_BUSY', 'AGENT_SERVER_AUTH_FAILED']) {
    retirementCode = code;
    const client = makeClient();
    const states = [];
    client.on('runtime-status', state => states.push(state));
    await client.connect();
    assert.equal(client.connectionStatus.phase, 'waiting');
    assert.equal(client.connectionStatus.connection, 'connected');
    assert.equal(client.connectionStatus.updatePending, true);
    assert.equal(client.connectionStatus.errorCode, code);
    assert.equal(client.instance.instanceId, instance.instanceId);
    assert.ok(client.connectionStatus.lastConfirmedAt);
    assert.ok(states.filter(state => state.connection === 'connected').every(state => state.phase === 'waiting'), 'never publish live before compatibility is checked');
    await client.request('server.status', {}, { timeoutMs: 500 });
    client.close();
    assert.equal(client.connectionStatus.connection, 'disconnected');
  }
  activationVersion = 1;
  const legacy = makeClient();
  await legacy.connect();
  assert.equal(legacy.connectionStatus.updatePending, true, 'legacy fingerprints are not silently treated as current');
  assert.equal(retirementVersion, 1, 'format-1 retirement remains compatible without accepting its fingerprint as format-2');
  legacy.close(); activationVersion = RUNTIME_ACTIVATION_VERSION;
  methods = ['server.status'];
  const noRetire = makeClient();
  await noRetire.connect();
  assert.equal(noRetire.connectionStatus.phase, 'waiting', 'a compatible legacy server without retirement remains usable');
  noRetire.close();
  const readOnly = makeClient({ autoStart: false, verifyRuntimeRevision: true });
  await readOnly.connect();
  assert.equal(readOnly.connectionStatus.updatePending, true);
  readOnly.close();
  const incompatible = makeClient({ autoStart: false, requiredMethods: ['missing.method'] });
  let connected = false;
  incompatible.on('connect', () => { connected = true; });
  await assert.rejects(incompatible.connect(), { code: 'AGENT_SERVER_UPGRADE_REQUIRED' });
  assert.equal(connected, false);
  assert.equal(incompatible.socket, null);
  assert.equal(incompatible.connectionStatus.phase, 'failed');
  assert.equal(retireCalls, 3, 'passive, unsupported and incompatible cases do not restart a service');

  instance.namespaceId = 'other-namespace';
  await assert.rejects(makeClient({ autoStart: false }).connect(), { code: 'AGENT_SERVER_NAMESPACE_MISMATCH' });
  instance.namespaceId = paths.namespaceId;
  instance.runtimeRevision = revision;
  const healthy = makeClient({ heartbeat: true, heartbeatIntervalMs: 100, heartbeatTimeoutMs: 100 });
  await healthy.connect();
  assert.equal(healthy.connectionStatus.phase, 'ready');
  dropHeartbeat = true;
  const waitFor = async (condition, message) => {
    const deadline = Date.now() + 3000;
    while (!condition() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(condition(), message);
  };
  const originalSocket = healthy.socket;
  const activeRequest = healthy.requestConnected('catalog.list', {}, { timeoutMs: 3000 });
  let disconnects = 0;
  healthy.on('disconnect', () => disconnects++);
  await waitFor(() => healthy.connectionStatus.errorCode === 'AGENT_SERVER_HEARTBEAT_DELAYED' || disconnects > 0,
    'missed heartbeat must report delayed status');
  assert.equal(disconnects, 0, 'a slow status response must not disconnect live agents');
  assert.equal(healthy.socket, originalSocket, 'status timeout preserves the authenticated socket');
  assert.equal(healthy.connectionStatus.connection, 'connected');
  assert.equal(healthy.connectionStatus.phase, 'checking');
  assert.ok(heldCatalogRequest, 'the active chat request remains on the retained connection');
  writeAgentServerMessage(heldCatalogRequest.socket, { type: 'response', id: heldCatalogRequest.id, ok: true, result: { chats: [] } });
  assert.deepEqual(await activeRequest, { chats: [] }, 'a missed heartbeat must not reject other in-flight requests');
  dropHeartbeat = false;
  await waitFor(() => healthy.connectionStatus.phase === 'ready', 'status must recover on the same connection');
  assert.equal(healthy.socket, originalSocket);
  assert.equal(healthy.connectionStatus.errorCode, undefined);
  instance.instanceId = 'replacement-server';
  await waitFor(() => disconnects > 0, 'a changed server identity must still close the connection');
  assert.equal(healthy.connectionStatus.connection, 'disconnected');
  assert.equal(healthy.heartbeatTimer, null);
  const projected = projectAgentServerInstance({ instance: { ...instance, token: 'secret', endpoint: '/private/socket', stateDirectory: '/private/home' } });
  assert.ok(!JSON.stringify(projected).includes('private') && !JSON.stringify(projected).includes('secret'));
  assert.notEqual(paths.namespaceId, getAgentServerPaths({ stateDirectory: path.join(root, 'prod'), channel: 'test' }).namespaceId);
  const now = Date.now();
  const status = { connection: 'connected', instance, lastConfirmedAt: new Date(now).toISOString() };
  assert.match(formatAgentConnectionStatus(status, now), /live/);
  assert.match(formatAgentConnectionStatus(status, now + 46000), /stale/);
  assert.match(formatAgentConnectionStatus({ ...status, connection: 'disconnected' }, now), /disconnected/);
} finally {
  clients.forEach(client => client.close());
  sockets.forEach(socket => socket.destroy());
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
console.log('Agent-server compatibility, identity, heartbeat and connection presentation: ok');
