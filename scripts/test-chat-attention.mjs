import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CanonicalChatCatalog } from '../src/agent-server/catalog.mjs';
import { ZyraAgentServer } from '../src/agent-server/server.mjs';
import { ZyraAgentServerClient } from '../src/agent-server/client.mjs';

const dir = mkdtempSync(path.join(os.tmpdir(), 'zyra-chat-attention-'));
const id = 'chat:attention';
const catalog = new CanonicalChatCatalog({ stateDirectory: dir, index: {} });
const chat = { canonicalChatId: id, project: dir, cwd: dir, title: 'Synthetic attention check' };
catalog.find = async selector => [id, 'chat:other'].includes(selector) ? { ...chat, canonicalChatId: selector, ...catalog.record.metadata[selector] } : null;
catalog.list = async () => [{ ...chat, ...catalog.record.metadata[id] }];
class Worker extends EventEmitter {
  alive = true;
  isAlive() { return this.alive; }
  async request(type) { return type === 'connect' ? { threadId: id, cwd: dir } : { ok: true }; }
  dispose() { this.alive = false; }
  sendControlResponse() {}
}
const worker = new Worker();
const server = new ZyraAgentServer({ stateDirectory: dir, root: process.cwd(), endpoint: 0, catalog, createWorker: () => worker });
const clients = [];
const alerts = [];
let clock = Date.now();
server.chatAttention.now = () => clock;
try {
  await server.start();
  for (const surface of ['desktop', 'mobile', 'tui']) {
    const client = new ZyraAgentServerClient({ stateDirectory: dir, autoStart: false, clientId: `test:${surface}`, surface });
    await client.attach({ project: dir, session: id });
    clients.push(client);
  }
  const [desktop, phone, tui] = clients;
  desktop.on('chat-attention', notice => alerts.push(notice));
  // The production hello verifies authority; this isolated worker fixture has no user credentials.
  [...server.clients.values()].find(client => client.clientId === 'test:desktop').canOpenWorkspace = true;
  const flush = async () => (await desktop.request('catalog.get', { session: id })).chat;
  const view = (client, viewing, extra = {}) => client.request('session.view', { session: id, viewId: 'main', viewing, ...extra });
  const session = server.sessions.get(id);
  const begin = turnId => { session.activeRequestContext = { turnId }; worker.emit('event', { type: 'agent_start' }); };
  const end = () => worker.emit('event', { type: 'agent_end', messages: [] });

  await view(phone, true);
  begin('visible-phone'); end();
  let current = await flush();
  assert.equal(current.lastSeenCompletedTurnId, 'visible-phone', 'completion while viewed is canonically seen');
  assert.equal(alerts.length, 0, 'another surface viewing suppresses PC alerts');
  await view(phone, false);
  current = await flush();
  assert.equal(current.lastSeenCompletedTurnId, 'visible-phone', 'leaving does not revive Done');
  assert.equal(current.presence.viewers.length, 0, 'attachments are not viewers');
  const restored = new CanonicalChatCatalog({ stateDirectory: dir, index: {} });
  assert.equal(restored.record.metadata[id].lastSeenCompletedTurnId, 'visible-phone', 'read receipts survive restart');

  await desktop.request('session.view', { session: 'chat:other', viewId: 'main', viewing: true });
  await view(desktop, false);
  assert.equal((await desktop.request('catalog.get', { session: 'chat:other' })).chat.presence.viewers.length, 1, 'a stale old-chat cleanup cannot remove the new reader');
  begin('unread'); end(); await flush();
  assert.equal(alerts.length, 1);
  assert.equal((await flush()).presence.viewers.length, 0, 'viewing a different chat does not suppress this completion');
  assert.equal(alerts[0].kind, 'completed');
  end(); await flush();
  assert.equal(alerts.length, 1, 'duplicate terminal events do not alert twice');
  await view(desktop, true, { surface: 'browser' });
  current = await flush();
  assert.equal(current.presence.viewers[0].surface, 'browser');
  assert.equal(current.lastSeenCompletedTurnId, 'unread', 'opening finished content acknowledges it');
  await view(desktop, false);
  await desktop.request('session.view', { session: id, viewId: 'other-window', viewing: true });
  await view(desktop, true); await view(desktop, false);
  assert.equal((await flush()).presence.viewers.length, 1, 'closing one window does not clear a second viewer');
  await desktop.request('session.view', { session: id, viewId: 'other-window', viewing: false });

  begin('needs-input');
  worker.emit('event', { type: 'user_input_requested', requestId: 'question-one' }); await flush();
  assert.equal(alerts.at(-1).kind, 'input');
  const count = alerts.length;
  worker.emit('event', { type: 'user_input_requested', requestId: 'question-one' }); await flush();
  assert.equal(alerts.length, count);
  await view(tui, true);
  worker.emit('event', { type: 'approval_requested', requestId: 'approval-viewed' }); await flush();
  assert.equal(alerts.length, count, 'focused TUI suppresses approval alerts');
  clock += 40_000;
  worker.emit('event', { type: 'approval_requested', requestId: 'approval-expired' }); await flush();
  assert.equal(alerts.at(-1).kind, 'approval', 'abandoned foreground leases expire');
  worker.emit('event', { type: 'agent_end', willRetry: true }); await flush();
  assert.equal(alerts.at(-1).kind, 'approval', 'retry boundary is not completion');
  worker.emit('event', { type: 'agent_end', outcome: 'interrupted' }); await flush();
  assert.equal(alerts.at(-1).kind, 'approval', 'stopping a turn is not a completion alert');
  assert.equal(catalog.markCompletionSeen(id, 'stale', '2000-01-01T00:00:00Z'), false, 'late stale acknowledgments cannot undo a newer read');
  await assert.rejects(desktop.request('session.view', { session: id, viewing: true, viewId: '../invalid' }));
  await view(phone, true); phone.close();
  await new Promise(resolve => setImmediate(resolve)); await flush();
  assert.equal((await flush()).presence.viewers.length, 0, 'disconnect releases the reader');
  console.log('PASS: live canonical views, durable read receipts, cross-surface sync, one-shot PC notices, attention, retries, expiry and disconnect');
} finally { for (const client of clients) client.close(); await server.stop(); rmSync(dir, { recursive: true, force: true }); }
