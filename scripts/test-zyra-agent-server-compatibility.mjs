import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ZyraAgentServer } from '../src/agent-server/server.mjs';
import { ZyraAgentServerClient } from '../src/agent-server/client.mjs';
import { AGENT_SERVER_METHODS } from '../src/agent-server/protocol.mjs';
const directory = mkdtempSync(path.join(os.tmpdir(), 'zyra-server-compat-'));
const clients = [], servers = [];
const options = { stateDirectory: directory, channel: 'compat', endpoint: 0, desktopAuthorityToken: 'fixture-proof' };
const createServer = () => { const server = new ZyraAgentServer(options); servers.push(server); return server; };
const createClient = (extra = {}) => {
  const client = new ZyraAgentServerClient({ ...options, autoStart: false, surface: 'desktop', authorities: ['desktop-control'], authorityProof: 'fixture-proof', ...extra });
  clients.push(client); return client;
};
try {
  let server = createServer();
  await server.start();
  const state = server.state.bind(server);
  server.state = () => ({ ...state(), methods: undefined });
  const legacy = createClient();
  await assert.rejects(() => legacy.connect(), { code: 'AGENT_SERVER_UPGRADE_REQUIRED' });
  assert.equal(legacy.socket, null, 'reject legacy service before any action and close the connection');
  server.state = state;
  const current = createClient();
  const connected = await current.request('server.status');
  assert.deepEqual(connected.methods, AGENT_SERVER_METHODS);
  const untrusted = createClient({ surface: 'tui', authorityProof: '' });
  await assert.rejects(() => untrusted.request('server.retire'), { code: 'AGENT_SERVER_AUTH_FAILED' });
  server.sessions.set('busy', { summary: () => ({ activeRequests: 1 }), dispose() {} });
  await assert.rejects(() => current.request('server.retire'), { code: 'AGENT_SERVER_UPGRADE_BUSY' });
  server.sessions.set('busy', { summary: () => ({ activeRequests: 0, backgroundWorkActive: true }), dispose() {} });
  await assert.rejects(() => current.request('server.retire'), { code: 'AGENT_SERVER_UPGRADE_BUSY' });
  server.sessions.clear();
  server.pendingRequests = 1;
  await assert.rejects(() => current.request('server.retire'), { code: 'AGENT_SERVER_UPGRADE_BUSY' });
  server.pendingRequests = 0;
  assert.equal(server.retiring, false, 'busy or unauthorized requests cannot put the server into retirement');
  current.close(); untrusted.close();
  server.state = () => ({ ...state(), methods: AGENT_SERVER_METHODS.filter(m => m !== 'session.pluginAuthority') });
  // A fake dead PID lets the fixture exercise replacement without terminating the test process.
  const descriptor = JSON.parse(readFileSync(server.paths.descriptorFile, 'utf8'));
  writeFileSync(server.paths.descriptorFile, JSON.stringify({ ...descriptor, pid: 2147483646 }));
  let retirement;
  const retired = new Promise(resolve => { retirement = resolve; });
  server.once('retire', () => { void server.stop().then(retirement); });
  const upgrade = createClient({ autoStart: true });
  let starts = 0, replacement;
  upgrade.startServer = () => {
    starts++;
    replacement = (async () => { await retired; server = createServer(); await server.start(); })();
  };
  const [result, concurrent] = await Promise.all([upgrade.request('server.status'), upgrade.request('server.status')]);
  await replacement;
  assert.equal(starts, 1, 'concurrent callers share one bounded service replacement');
  assert.ok(result.methods.includes('session.pluginAuthority'));
  assert.deepEqual(result.methods, concurrent.methods, 'no request escapes before compatibility is checked');
  // A later reconnect must not restart another older winner over and over.
  upgrade.close();
  const replacementState = server.state.bind(server);
  server.state = () => ({ ...replacementState(), methods: AGENT_SERVER_METHODS.filter(m => m !== 'session.pluginAuthority') });
  const retry = createClient({ autoStart: true });
  retry.startServer = () => { throw Error('A reconnect must not repeat an accepted upgrade'); };
  await assert.rejects(() => retry.connect(), { code: 'AGENT_SERVER_UPGRADE_REQUIRED' });
  assert.equal(server.retiring, false, 'recovery cannot retire the same service contract repeatedly');
  server.state = replacementState;
  const serviceSource = readFileSync('desktop/src/main/assistant/service.ts', 'utf8');
  for (const name of ['setSessionProject', 'setSessionProjectPath']) {
    const body = serviceSource.slice(serviceSource.indexOf(`async ${name}(`));
    assert.ok(body.indexOf('await this.runtime.updatePluginAuthority({ chats: [] })') < body.indexOf('await this.applySessionProjectScope('), 'check permission support before saving the new project');
  }
  console.log('Agent server compatibility: legacy rejection, authenticated idle replacement, busy protection, concurrent startup and project preflight passed');
} finally {
  for (const client of clients) client.close();
  for (const server of servers) await server.stop();
  rmSync(directory, { recursive: true, force: true });
}