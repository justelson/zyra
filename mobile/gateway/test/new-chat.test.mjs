import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, realpathSync, existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionManager } from '../../../src/runtime/engine/src/core/session-manager.js';
import { getProjectSessionsDir } from '../../../src/project-paths.mjs';
import { CanonicalChatCatalog } from '../../../src/agent-server/catalog.mjs';
import { ZyraAgentServer } from '../../../src/agent-server/server.mjs';
import { ZyraAgentServerClient } from '../../../src/agent-server/client.mjs';
import { HostRouter } from '../src/router.mjs';
import { BodyCache } from '../src/projection.mjs';
import { ensureSessionDurable } from '../../../src/agent-server/session-durability.mjs';

async function fixture(t, indexed = false) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'zyra-new-chat-'));
  const projects = ['assistant/global-workspace', 'project-one'].map(p => path.join(directory, p));
  const workers = [], clients = [];
  class Worker extends EventEmitter {
    alive = true;
    isAlive() { return this.alive; }
    async request(type, payload) {
      if (type === 'connect') {
        this.manager = payload.threadId ? SessionManager.open(payload.threadId, getProjectSessionsDir(payload.project)) : SessionManager.create(payload.project, getProjectSessionsDir(payload.project));
        this.manager.appendCustomEntry('zyra-chat-config', { model: 'test/model' });
        if (payload.persistNewSession) ensureSessionDurable(this.manager);
        return { threadId: this.manager.getSessionId(), sessionFile: this.manager.getSessionFile(), cwd: payload.cwd };
      }
      if (type === 'prompt') {
        this.manager.appendMessage({ role: 'user', content: payload.prompt, timestamp: Date.now() });
        this.manager.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'Answer' }], timestamp: Date.now() });
        return {};
      }
      return {};
    }
    dispose() { this.alive = false; }
    sendControlResponse() {}
  }
  const catalog = new CanonicalChatCatalog({ stateDirectory: directory, ...(indexed ? {} : { loadSessionManager: async () => SessionManager }) });
  projects.forEach(project => catalog.registerProject(project));
  const server = new ZyraAgentServer({ stateDirectory: directory, root: process.cwd(), endpoint: 0, catalog, createWorker: () => { const worker = new Worker(); workers.push(worker); return worker; } });
  await server.start();
  t.after(async () => { clients.forEach(c => c.close()); await server.stop(); const relative = path.relative(realpathSync(os.tmpdir()), realpathSync(directory)); assert.ok(relative.startsWith('zyra-new-chat-') && !relative.includes(path.sep)); rmSync(directory, { recursive: true, force: true }); });
  async function phone(owner = 'phone', hiddenProjects = []) {
    const client = new ZyraAgentServerClient({ stateDirectory: directory, autoStart: false, clientId: 'mobile:' + owner, surface: 'mobile' });
    clients.push(client);
    const router = new HostRouter({ client, owner, projects, hiddenProjects, cache: new BodyCache() });
    return { client, router };
  }
  return { directory, projects, server, catalog, workers, phone };
}

test('fresh phone chat is catalog-visible before its first prompt for global and project workspaces', async t => {
  const f = await fixture(t), { router } = await f.phone();
  for (const project of f.projects) {
    const attached = await router.dispatch('session.attach', { project, localThreadId: 'draft-' + path.basename(project) });
    const history = await router.dispatch('catalog.history', { session: attached.canonicalChatId });
    assert.ok(history.history, 'new chat must pass normal catalog authorization before first send');
    await router.dispatch('session.request', { sessionKey: attached.sessionKey, type: 'prompt', payload: { prompt: 'Hello' } }, 'first-' + path.basename(project));
    const manager = f.workers.at(-1).manager;
    assert.equal(readFileSync(manager.getSessionFile(), 'utf8').split('\n').filter(line => line && JSON.parse(line).type === 'session').length, 1);
    assert.equal((await f.catalog.history(attached.canonicalChatId)).entries.filter(e => e.type === 'message').length, 2);
  }
});


test('real indexed catalog also discovers the empty persisted chat before first send', async t => {
  const f = await fixture(t, true), { router } = await f.phone();
  await router.dispatch('catalog.list', {});
  const attached = await router.dispatch('session.attach', { project: f.projects[0], localThreadId: 'indexed' });
  const history = await router.dispatch('catalog.history', { session: attached.sessionKey });
  assert.ok(history.history);
  assert.equal(history.history.entries.filter(e => e.type === 'message').length, 0);
});

test('creation retry reconnects to the same chat before and after its worker is retired', async t => {
  const f = await fixture(t), first = await f.phone();
  const input = { project: f.projects[1], localThreadId: 'stable-draft' };
  const created = await first.router.dispatch('session.attach', input);
  first.client.close();
  const next = await f.phone();
  const retry = await next.router.dispatch('session.attach', input);
  assert.equal(retry.canonicalChatId, created.canonicalChatId);
  assert.equal(f.workers.length, 1);
  const session = f.server.sessions.get(created.canonicalChatId);
  session.dispose('Fixture retire'); f.server.removeSession(session);
  // Reload aliases from disk as a newly started canonical server would.
  f.server.catalog = new CanonicalChatCatalog({ stateDirectory: f.directory, loadSessionManager: async () => SessionManager });
  const restored = await next.router.dispatch('session.attach', input);
  assert.equal(restored.canonicalChatId, created.canonicalChatId);
  assert.equal(f.workers.length, 2);
  assert.ok((await next.router.dispatch('catalog.history', { session: restored.sessionKey })).history);
  await next.router.dispatch('session.request', { sessionKey: restored.sessionKey, type: 'prompt', payload: { prompt: 'After reconnect' } }, 'restored-send');
  assert.equal((await f.catalog.list({ allProjects: true })).length, 1);
});

test('device, project and machine creation ownership remains isolated and hidden scopes are enforced', async t => {
  const f = await fixture(t), one = await f.phone(), two = await f.phone('other-phone');
  const input = { project: f.projects[0], localThreadId: 'same-client-generated-id' };
  const a = await one.router.dispatch('session.attach', input), b = await two.router.dispatch('session.attach', input);
  assert.notEqual(a.canonicalChatId, b.canonicalChatId);
  const c = await one.router.dispatch('session.attach', { ...input, project: f.projects[1] });
  assert.notEqual(a.canonicalChatId, c.canonicalChatId);
  const scoped = await f.phone('phone', [f.projects[0]]);
  await assert.rejects(scoped.router.dispatch('catalog.history', { session: a.sessionKey }), { code: 'CHAT_NOT_VISIBLE' });
  await assert.rejects(scoped.router.dispatch('session.attach', input));
  const otherHost = await fixture(t), remote = await otherHost.phone();
  const d = await remote.router.dispatch('session.attach', { ...input, project: otherHost.projects[0] });
  assert.notEqual(a.canonicalChatId, d.canonicalChatId);
  await assert.rejects(remote.router.dispatch('catalog.history', { session: a.sessionKey }), { code: 'CHAT_NOT_VISIBLE' });
});

test('durability never invents messages or overwrites another session and supports repeat calls', async t => {
  const f = await fixture(t);
  const manager = SessionManager.create(f.projects[0], getProjectSessionsDir(f.projects[0]));
  manager.appendCustomEntry('configuration', { enabled: true });
  assert.equal(existsSync(manager.getSessionFile()), false, 'installed Pi reproduces deferred persistence');
  ensureSessionDurable(manager); ensureSessionDurable(manager);
  const original = readFileSync(manager.getSessionFile(), 'utf8');
  assert.equal(manager.getEntries().some(e => e.type === 'message'), false);
  manager.flushed = false;
  assert.throws(() => ensureSessionDurable(manager), { code: 'EEXIST' });
  assert.equal(readFileSync(manager.getSessionFile(), 'utf8'), original);
  assert.throws(() => ensureSessionDurable(SessionManager.inMemory(f.projects[0])), /cannot be saved/);
});
