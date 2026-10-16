import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CanonicalChatCatalog } from '../src/agent-server/catalog.mjs';
import { ZyraAgentServer } from '../src/agent-server/server.mjs';
import { ZyraAgentServerClient } from '../src/agent-server/client.mjs';
import { projectChatSettlement, automaticSettlementDeadline, AUTO_SETTLE_AFTER_MS } from '../src/agent-server/chat-settlement.mjs';

const dir = mkdtempSync(path.join(tmpdir(), 'zyra-settlement-'));
const chat = { canonicalChatId: 'settlement-fixture', title: 'Fixture', project: dir, cwd: dir, messageCount: 4, modifiedAt: new Date().toISOString() };
const index = { get: id => id === chat.canonicalChatId ? { ...chat } : null, update() {}, listProjects: async () => [{ ...chat }] };
const catalog = new CanonicalChatCatalog({ stateDirectory: dir, index });
class Worker extends EventEmitter {
  isAlive() { return true; }
  async request(type) { return type === 'connect' ? { threadId: chat.canonicalChatId, cwd: dir } : {}; }
  dispose() {}
  sendControlResponse() {}
}
const worker = new Worker();
const server = new ZyraAgentServer({ stateDirectory: dir, root: process.cwd(), endpoint: 0, catalog, createWorker: () => worker });
const clients = [];
try {
  assert.equal(projectChatSettlement({ ...chat, modifiedAt: new Date(Date.now() - AUTO_SETTLE_AFTER_MS - 1000).toISOString() }, {}), true);
  assert.equal(projectChatSettlement({ ...chat, messageCount: 0, modifiedAt: '2000-01-01' }, {}), false, 'empty chats remain active');
  assert.equal(automaticSettlementDeadline(chat, { settlement: { state: 'active', messageCount: chat.messageCount } }), null, 'Explicit current choices do not schedule automatic transitions');
  assert.equal(automaticSettlementDeadline({ ...chat, messageCount: 0 }), null);
  assert.equal(automaticSettlementDeadline({ ...chat, modifiedAt: 'not a date' }), null);
  await server.start();
  for (const surface of ['desktop', 'mobile', 'browser']) {
    const client = new ZyraAgentServerClient({ stateDirectory: dir, autoStart: false, clientId: `fixture:${surface}`, surface });
    await client.attach({ project: dir, session: chat.canonicalChatId }); clients.push(client);
    // This fixture has no external identity provider; grant only the local test workspace.
    [...server.clients.values()].find(entry => entry.clientId === `fixture:${surface}`).canOpenWorkspace = true;
  }
  const [desktop, mobile, browser] = clients;
  const read = async client => (await client.request('catalog.get', { session: chat.canonicalChatId })).chat;
  const update = (client, settled, extra = {}) => client.request('catalog.update', { session: chat.canonicalChatId, settled, ...extra });
  // Long-lived clients must learn that an automatic deadline passed without
  // another user action, reconnect or periodic caller-side catalog poll.
  const dueSignals = new Set();
  for (const client of clients) client.on('catalog-changed', message => {
    if (message.change?.settlementDue) dueSignals.add(client);
  });
  chat.modifiedAt = new Date(Date.now() - AUTO_SETTLE_AFTER_MS + 500).toISOString();
  assert.equal((await read(desktop)).settled, false);
  const timer = server.settlementTimer;
  await read(browser);
  assert.equal(server.settlementTimer, timer, 'Repeated catalog reads retain one shared earliest timer');
  const dueDeadline = Date.now() + 2_000;
  while (dueSignals.size < clients.length && Date.now() < dueDeadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(dueSignals.size, clients.length, 'Automatic settlement deadline must notify all connected surfaces without an unrelated catalog action');
  assert.equal((await read(mobile)).settled, true);
  chat.modifiedAt = new Date().toISOString();
  await update(desktop, true);
  assert.equal((await read(mobile)).settled, true);
  assert.equal((await read(browser)).settled, true, 'all surfaces read the server choice');
  const restored = new CanonicalChatCatalog({ stateDirectory: dir, index });
  assert.equal((await restored.find(chat.canonicalChatId)).settled, true, 'choice survives catalog restart');
  await update(mobile, false);
  assert.equal((await read(desktop)).settled, false, 'mobile update changes desktop state');
  await update(browser, true, { settlementIfAbsent: true });
  assert.equal((await read(desktop)).settled, false, 'a legacy migration cannot overwrite a newer server choice');
  await update(browser, true);
  chat.messageCount += 1;
  assert.equal((await read(desktop)).settled, false, 'new content revives the chat');
  for (const migratedState of [true, false]) {
    await update(desktop, !migratedState);
    chat.messageCount += 1;
    const expired = await read(mobile);
    assert.equal(expired.settlementManual, false, 'expired settlement metadata cannot claim current manual authority');
    await update(browser, migratedState, { settlementIfAbsent: true });
    for (const client of clients) {
      const current = await read(client);
      assert.equal(current.settled, migratedState, 'a current local migration replaces an expired server choice');
      assert.equal(current.settlementManual, true);
    }
    const afterMigration = new CanonicalChatCatalog({ stateDirectory: dir, index });
    assert.equal((await afterMigration.find(chat.canonicalChatId)).settled, migratedState, 'replacement of expired authority survives restart');
    await update(mobile, !migratedState, { settlementIfAbsent: true });
    assert.equal((await read(desktop)).settled, migratedState, 'a current server choice still wins over a competing migration');
  }
  await update(desktop, true);
  const session = server.sessions.get(chat.canonicalChatId);
  session.activeRequestContext = { turnId: 'new-work' };
  worker.emit('event', { type: 'agent_start' });
  assert.equal((await read(mobile)).settled, false);
  await assert.rejects(update(mobile, true), /Finish the current turn/);
  worker.emit('event', { type: 'agent_end', messages: [] });
  assert.equal((await read(browser)).settled, false, 'settlement stays cleared after completion');
  await assert.rejects(update(desktop, 'yes'), /Choose whether/);
  console.log('Canonical settlement: cross-surface updates, restart, new activity, migration ordering and busy guards passed.');
} finally {
  for (const client of clients) client.close();
  const shutdown = server.stop();
  server.projectCatalogChat({ ...chat, messageCount: chat.messageCount + 1, modifiedAt: new Date().toISOString() });
  await shutdown;
  assert.equal(server.settlementTimer, null, 'Shutdown also prevents late catalog projection from rearming the deadline timer');
  rmSync(dir, { recursive: true, force: true });
}
