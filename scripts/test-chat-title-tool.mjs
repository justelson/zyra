import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createChatTitleController, initialChatTitleState } from '../src/chat-title-tool.mjs';
import { describeZyraToolPermission } from '../src/zyra-permission-gate.mjs';
import { CanonicalChatCatalog } from '../src/agent-server/catalog.mjs';
import { ZyraAgentServer } from '../src/agent-server/server.mjs';
import { ZyraAgentServerClient } from '../src/agent-server/client.mjs';

assert.equal(describeZyraToolPermission({ toolName: 'set_chat_title', input: { title: 'Fix startup' } }), null);
for (const title of ['New chat', 'New Session', 'Untitled chat']) {
  assert.equal(initialChatTitleState({ title, messageCount: 0 }).eligible, true);
}
assert.equal(initialChatTitleState({ title: 'My name', messageCount: 0 }).eligible, false);
assert.equal(initialChatTitleState({ title: 'Casual Greeting', messageCount: 4 }).eligible, false, 'unknown legacy titles cannot safely be assumed automatic');
assert.equal(initialChatTitleState({ title: 'New chat', messageCount: 0 }, { title: 'New chat', titleSource: 'manual' }).eligible, false);
const proposals = [];
const controller = createChatTitleController(async title => proposals.push(title));
assert.match(controller.prepare({ eligible: true, title: 'New chat' }), /Before any visible response or other tool call/);
const result = await controller.tool.execute('title-1', { title: ' Greeting ', provisional: true });
assert.equal(result.details.hiddenFromTimeline, true);
assert.deepEqual(proposals, [{ title: 'Greeting', titleSource: 'provisional', expectedTitle: 'New chat' }]);
await controller.tool.execute('title-duplicate', { title: 'Duplicate' });
assert.equal(proposals.length, 1, 'at most one metadata proposal per prompt');
controller.prepare({ eligible: true, title: 'Greeting' });
await controller.tool.execute('title-2', { title: 'Fix sidebar title generation' });
assert.deepEqual(proposals[1], { title: 'Fix sidebar title generation', titleSource: 'model', expectedTitle: 'Greeting' });
controller.prepare({ eligible: false });
await controller.tool.execute('locked', { title: 'Do not replace' });
assert.equal(proposals.length, 2);
await assert.rejects(controller.tool.execute('bad', { title: 'https://example.com/raw-prompt' }), /not a URL/);
await assert.rejects(controller.tool.execute('long', { title: 'x'.repeat(61) }), /60 characters/);

const dir = mkdtempSync(path.join(tmpdir(), 'zyra-chat-title-'));
const chat = { canonicalChatId: 'title-fixture', title: 'New chat', project: dir, cwd: dir, messageCount: 0, modifiedAt: new Date().toISOString() };
let indexed = true;
const index = { get: id => indexed && id === chat.canonicalChatId ? { ...chat } : null, update() {}, listProjects: async () => indexed ? [{ ...chat }] : [] };
const catalog = new CanonicalChatCatalog({ stateDirectory: dir, index });
let nextTitle = { title: 'Greeting', provisional: true };
let renameDuringProposal = false;
let omitTitle = false;
const seen = [];
class Worker extends EventEmitter {
  isAlive() { return true; }
  async request(type, payload) {
    seen.push({ type, payload });
    if (type === 'connect') return { threadId: chat.canonicalChatId, cwd: dir };
    if (type !== 'prompt') return {};
    const title = createChatTitleController(async metadata => {
      if (renameDuringProposal) await catalog.updateChat(chat.canonicalChatId, { title: 'My chosen name' });
      this.emit('event', { type: 'session_title', ...metadata });
    });
    title.prepare(payload.chatTitleState);
    indexed = true;
    chat.messageCount++;
    // Session indexing starts using the first raw prompt before the title tool runs.
    chat.title = payload.prompt;
    this.emit('event', { type: 'agent_start' });
    if (!omitTitle) await title.tool.execute('synthetic-title', nextTitle);
    this.emit('event', { type: 'agent_end', messages: [] });
    return {};
  }
  dispose() {}
  sendControlResponse() {}
}
const worker = new Worker();
const server = new ZyraAgentServer({ stateDirectory: dir, root: process.cwd(), endpoint: 0, catalog, createWorker: () => worker });
const client = new ZyraAgentServerClient({ stateDirectory: dir, autoStart: false, clientId: 'fixture:titles', surface: 'desktop' });
const read = async () => (await client.request('catalog.get', { session: chat.canonicalChatId })).chat;
let turn = 0;
const send = (prompt, extra = {}) => client.request('session.request', { sessionKey: chat.canonicalChatId, type: 'prompt', payload: { prompt, ...extra }, requestContext: { turnId: `title-turn-${++turn}` } });
const waitForTitle = async expected => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await read()).title === expected) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal((await read()).title, expected);
};
try {
  await server.start();
  await client.attach({ project: dir, session: chat.canonicalChatId });
  await send('hi');
  await waitForTitle('Greeting');
  assert.equal((await read()).titleSource, 'provisional');
  const restored = new CanonicalChatCatalog({ stateDirectory: dir, index });
  assert.equal((await restored.find(chat.canonicalChatId)).titleSource, 'provisional', 'greeting ownership survives restart');
  nextTitle = { title: 'Repair startup' };
  await send('Fix startup after settings changes');
  await waitForTitle('Repair startup');
  assert.equal((await read()).titleSource, 'model');
  await send('Some unrelated later task');
  assert.equal((await read()).title, 'Repair startup', 'the foreground model cannot keep retitling an established chat');
  assert.equal(seen.filter(entry => entry.type === 'generate_text').length, 0, 'initial titles never dispatch the utility model');

  await catalog.updateChat(chat.canonicalChatId, { title: 'Greeting', titleSource: 'provisional' });
  renameDuringProposal = true;
  await send('Fix a different issue');
  await waitForTitle('My chosen name');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal((await read()).title, 'My chosen name', 'a manual rename wins an in-flight model proposal');
  await assert.rejects(catalog.updateChat(chat.canonicalChatId, { title: 'Periodic replacement', titleSource: 'refresh' }), /manually named/);
  await client.request('catalog.update', { session: chat.canonicalChatId, title: 'Manual refresh result' });
  assert.equal((await read()).title, 'Manual refresh result', 'explicit regeneration can still replace a manually named title');

  renameDuringProposal = false;
  omitTitle = true;
  await catalog.updateChat(chat.canonicalChatId, { title: 'New chat', titleSource: 'initial' });
  await send('A provider that omitted the tool');
  assert.equal((await read()).titleSource, 'initial', 'omission does not falsely finalize a seed');
  omitTitle = false;
  await send('Retry with the same foreground model');
  await waitForTitle('Repair startup');
  delete catalog.record.metadata[chat.canonicalChatId];
  chat.messageCount = 0;
  chat.title = 'New chat';
  await send('A first task', { initialManualTitle: 'Named before first Send' });
  assert.equal((await read()).title, 'Named before first Send', 'a local name chosen before canonical attachment is protected');
  assert.equal((await read()).titleSource, 'manual');
  delete catalog.record.metadata[chat.canonicalChatId];
  chat.messageCount = 0;
  chat.title = 'New chat';
  indexed = false;
  // Model a newly connected draft, not the preceding named chat's snapshot.
  server.sessions.get(chat.canonicalChatId).connectedResult = { messages: [] };
  nextTitle = { title: 'Title before first index scan' };
  await send('Start before the index has found the new session');
  await waitForTitle('Title before first index scan');
  assert.equal((await read()).titleSource, 'model', 'unindexed drafts can still initialize and commit their first title');
  console.log('Chat title tool: hidden metadata, greeting promotion, durable ownership, actual server transport, raw-prompt indexing, omission retry and manual-race protection: ok');
} finally {
  client.close();
  await server.stop();
  rmSync(dir, { recursive: true, force: true });
}
