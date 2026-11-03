import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createWorkContextController } from '../src/work-context-tool.mjs';
import { normalizeWorkContextInput, readChatWorkContext } from '../src/chat-work-context.mjs';
import { createZyraPermissionGateExtension } from '../src/zyra-permission-gate.mjs';
import { CanonicalChatCatalog } from '../src/agent-server/catalog.mjs';
import { ZyraAgentServer } from '../src/agent-server/server.mjs';
import { ZyraAgentServerClient } from '../src/agent-server/client.mjs';
import { createAgentSession, ModelRuntime, SettingsManager, DefaultResourceLoader } from '../src/runtime/engine/src/index.js';
import { AssistantMessageEventStream } from '../src/runtime/providers/src/utils/event-stream.js';
import { envApiKeyAuth } from '../src/runtime/providers/src/auth/helpers.js';
import { ZyraSessionManager } from '../src/agent-server/zyra-session-manager.mjs';
import { projectHistoryEntries } from '../src/agent-server/tui-runtime.mjs';

const directory = mkdtempSync(path.join(tmpdir(), 'zyra-work-context-'));
const folder = path.join(directory, 'app'); mkdirSync(folder);
const file = path.join(folder, 'file.txt'); writeFileSync(file, 'fixture');
const savedRoot = process.env.ZYRA_DATA_ROOT; process.env.ZYRA_DATA_ROOT = directory;
let session, server, client;
try {
  for (const bad of [{ kind: 'made-up' }, { kind: 'coding', folderPath: '../outside' }, { kind: 'music', folderPath: 'https://example.com' }, { kind: 'research', folderPath: '/a\nb' }, { kind: 'coding', folderPath: folder, target: 'another-chat' }]) assert.throws(() => normalizeWorkContextInput(bad));
  assert.equal(readChatWorkContext({ folderPath: folder, kind: 'coding', updatedAt: 'bad' }), null);
  // Semantic names are metadata, not a mechanical folder basename.
  const named = normalizeWorkContextInput({ folderPath: folder, kind: 'coding', shortName: 'Chat scroll' });
  assert.equal(named.shortName, 'Chat scroll');
  assert.equal(readChatWorkContext({ ...named, updatedAt: new Date().toISOString() }).shortName, 'Chat scroll');
  assert.ok(readChatWorkContext({ folderPath: folder, kind: 'coding', updatedAt: new Date().toISOString() }), 'legacy context remains readable');
  for (const shortName of ['', 'a'.repeat(25), '2026-10-31', 'C:/workspace', 'Assistant', 'bad\nname']) assert.throws(() => normalizeWorkContextInput({ folderPath: folder, kind: 'coding', shortName }));
  let approvals = 0;
  const gate = createZyraPermissionGateExtension({ project: folder, filesystemScope: { roots: [{ path: folder, access: 'read-only' }] }, getPermissionMode: () => 'read-only', requestPermission: async () => { approvals++; return 'decline'; } });
  assert.equal(gate.canReadWorkFolder(folder), true);
  assert.equal(gate.canReadWorkFolder(directory), false);
  const alias = path.join(folder, 'outside'); symlinkSync(directory, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(gate.canReadWorkFolder(alias), false, 'metadata cannot escape through a symlink');
  const proposals = [];
  const controller = createWorkContextController({ onUpdate: async next => proposals.push(next), canReadFolder: value => gate.canReadWorkFolder(value) });
  assert.match(controller.prepare(null), /substantial work/);
  assert.match(controller.prepare({ folderPath: folder, kind: 'coding', updatedAt: new Date().toISOString() }), /upgrade/i);
  await assert.rejects(controller.tool.execute('missing-name', { folderPath: folder, kind: 'coding' }), /shortName/);
  const first = await controller.tool.execute('work-1', { folderPath: folder, kind: 'coding', shortName: 'Chat scroll' });
  assert.equal(first.details.hiddenFromTimeline, true);
  await controller.tool.execute('same', { folderPath: folder, kind: 'coding', shortName: 'Chat scroll' }); assert.equal(proposals.length, 1);
  await controller.tool.execute('name-only', { folderPath: folder, kind: 'coding', shortName: 'Preview build' }); assert.equal(proposals.length, 2, 'same folder and category can describe different actual tasks');
  await assert.rejects(controller.tool.execute('outside', { folderPath: directory, kind: 'research', shortName: 'Scope check' }), /scope/);
  await assert.rejects(controller.tool.execute('file', { folderPath: file, kind: 'coding', shortName: 'File check' }), /not a file/);
  await assert.rejects(controller.tool.execute('aborted', { kind: 'music' }, AbortSignal.abort()), /cancelled/);
  assert.equal(approvals, 0, 'decorating a Chat never prompts for or grants folder access');
  const failing = createWorkContextController({ onUpdate: async () => { throw new Error('Owner unavailable'); }, canReadFolder: () => true });
  await assert.rejects(failing.tool.execute('failure', { kind: 'research', shortName: 'Owner check' }), /Owner unavailable/);

  // Real SDK/provider tool loop, persisted transcript, hidden per-turn instructions.
  const { runZyraPrompt } = await import('../src/zyra-sdk.mjs');
  const model = { id: 'work-context', provider: 'fixture', name: 'Fixture', api: 'fixture', baseUrl: 'https://fixture.invalid', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 1024 };
  const usage = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  let calls = 0;
  const provider = (_model, context) => {
    const events = new AssistantMessageEventStream(); const initial = calls++ === 0;
    if (initial) { assert.ok(context.tools.some(tool => tool.name === 'set_work_context')); assert.match(JSON.stringify(context.messages), /substantial work/); assert.equal(context.messages.filter(message => message.role === 'user' && message.content?.some(part => part.text === 'Repair the app')).length, 1, 'the original user prompt is unchanged and appears once alongside hidden metadata context'); }
    const message = { role: 'assistant', api: model.api, provider: model.provider, model: model.id, usage, timestamp: Date.now(), stopReason: initial ? 'toolUse' : 'stop', content: initial ? [{ type: 'toolCall', id: 'metadata', name: 'set_work_context', arguments: { folderPath: folder, kind: 'debugging', shortName: 'Chat scroll' } }] : [{ type: 'text', text: 'The repair is verified.' }] };
    queueMicrotask(() => { events.push({ type: 'start', partial: message }); events.push({ type: 'done', reason: message.stopReason, message }); events.end(); }); return events;
  };
  const modelRuntime = await ModelRuntime.create({ authPath: path.join(directory, 'auth.json'), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  modelRuntime.registerNativeProvider({ id: 'fixture', auth: { apiKey: envApiKeyAuth('Fixture', []) }, getModels: () => [model], stream: provider, streamSimple: provider });
  await modelRuntime.setRuntimeApiKey('fixture', 'synthetic-key');
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const resourceLoader = new DefaultResourceLoader({ cwd: folder, agentDir: folder, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, systemPrompt: 'Synthetic work-context test.' }); await resourceLoader.reload();
  const sessionManager = ZyraSessionManager.create(folder, path.join(directory, 'sessions'));
  ({ session } = await createAgentSession({ cwd: folder, agentDir: folder, modelRuntime, model, settingsManager, resourceLoader, sessionManager, tools: ['set_work_context'], customTools: [controller.tool] }));
  await runZyraPrompt({ session, workContext: controller, project: folder }, 'Repair the app', { workContext: null });
  assert.equal(proposals.at(-1).kind, 'debugging'); assert.equal(session.sessionManager.getCwd(), folder);
  const visible = projectHistoryEntries(sessionManager.getEntries());
  assert.ok(!visible.some(event => event.toolName === 'set_work_context'));
  assert.ok(visible.some(event => JSON.stringify(event.message?.content).includes('The repair is verified.')));

  // Real canonical server/client boundary, own Chat binding and cold catalog load.
  const chat = { canonicalChatId: 'work-origin', title: 'My chosen title', project: directory, cwd: directory, messageCount: 1, modifiedAt: new Date().toISOString() };
  const other = { ...chat, canonicalChatId: 'work-other' };
  const index = { get: id => [chat, other].find(value => value.canonicalChatId === id) || null, update() {}, listProjects: async () => [chat, other] };
  const catalog = new CanonicalChatCatalog({ stateDirectory: directory, index });
  let received;
  class Worker extends EventEmitter {
    isAlive() { return true; } dispose() {} sendControlResponse() {}
    async request(type, payload) {
      if (type === 'connect') return { threadId: chat.canonicalChatId, cwd: directory };
      if (type === 'prompt') { received = payload.workContext; this.emit('event', { type: 'session_work_context', target: other.canonicalChatId, workContext: { folderPath: folder, kind: 'coding', shortName: 'Preview build' } }); }
      return {};
    }
  }
  server = new ZyraAgentServer({ stateDirectory: directory, root: process.cwd(), endpoint: 0, catalog, createWorker: () => new Worker() });
  client = new ZyraAgentServerClient({ stateDirectory: directory, autoStart: false, clientId: 'fixture:work-context', surface: 'desktop' });
  await server.start(); await client.attach({ project: directory, session: chat.canonicalChatId });
  const send = turn => client.request('session.request', { sessionKey: chat.canonicalChatId, type: 'prompt', payload: { prompt: 'Work on the app' }, requestContext: { turnId: turn } });
  await send('first');
  for (let attempt = 0; attempt < 100 && !(await catalog.find(chat.canonicalChatId)).workContext; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
  const canonical = (await client.request('catalog.get', { session: chat.canonicalChatId })).chat;
  assert.equal(canonical.workContext.kind, 'coding'); assert.equal(canonical.workContext.folderPath, folder.replace(/\\/g, '/'));
  assert.equal(canonical.cwd, directory); assert.equal(canonical.project, directory); assert.equal(canonical.title, chat.title);
  assert.equal((await catalog.find(other.canonicalChatId)).workContext, null, 'worker metadata is bound to its own Chat, not any supplied target or selected UI');
  await send('second'); assert.equal(received.kind, 'coding', 'reconnection/next turn receives authoritative prior metadata');
  assert.equal(received.shortName, 'Preview build', 'next-turn transport retains semantic name');
  await catalog.setWorkContext(chat.canonicalChatId, { folderPath: folder, kind: 'coding', shortName: 'Chat scroll' });
  assert.equal((await catalog.find(chat.canonicalChatId)).workContext.shortName, 'Chat scroll', 'canonical duplicate detection includes name-only changes');
  await Promise.all([catalog.setWorkContext(chat.canonicalChatId, { folderPath: folder, kind: 'research', shortName: 'Model comparison' }), catalog.setWorkContext(chat.canonicalChatId, { folderPath: null, kind: 'music', shortName: 'Piano arrangement' })]);
  const cold = new CanonicalChatCatalog({ stateDirectory: directory, index });
  assert.equal((await cold.find(chat.canonicalChatId)).workContext.kind, 'music', 'ordered updates survive cold catalog load');
  assert.equal((await cold.find(chat.canonicalChatId)).workContext.shortName, 'Piano arrangement', 'cold catalog retains semantic name');
  console.log('PASS: strict self-owned metadata, scope/symlink/abort guards without grants, real SDK/provider loop, hidden history, ordered canonical transport, next-turn hydration and cold recovery');
} finally {
  client?.close(); await server?.stop(); session?.dispose();
  if (savedRoot === undefined) delete process.env.ZYRA_DATA_ROOT; else process.env.ZYRA_DATA_ROOT = savedRoot;
  rmSync(directory, { recursive: true, force: true });
}
