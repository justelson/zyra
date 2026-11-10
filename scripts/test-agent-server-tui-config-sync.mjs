import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ZyraAgentServer } from '../src/agent-server/server.mjs';
import { ZyraAgentServerClient } from '../src/agent-server/client.mjs';
import { createZyraTuiClientRuntime } from '../src/agent-server/tui-runtime.mjs';

const dir = mkdtempSync(path.join(os.tmpdir(), 'zyra-tui-config-'));
const canonical = 'chat:tui-config';
const chat = { canonicalChatId: canonical, project: dir, cwd: dir, title: 'Synthetic settings sync' };
const catalog = { record: { metadata: {} }, history: async () => ({ entries: [] }), registerProject: () => dir, find: async () => chat, resolveAlias: v => v || '', recordAttachment() {},
  updateChat: async () => chat, list: async () => [chat], snapshot: () => ({ projects: [{ path: dir }] }) };
class Worker extends EventEmitter {
  config = { model: 'openai-codex/gpt-5.6-sol', thinking: 'high', runtimeMode: 'approval-required', profile: 'default', webSearch: false, webFetch: false };
  calls = []; alive = true; rejectNext = false; holdNext = false; rejectHeld = null;
  isAlive() { return this.alive; }
  publish(patch) { Object.assign(this.config, patch); this.emit('event', { type: 'session_config', ...this.config }); }
  async request(type, payload) {
    this.calls.push({ type, payload });
    if (type === 'connect') return { threadId: canonical, cwd: dir, config: { ...this.config }, messages: [], usage: { cost: .5, costComplete: true } };
    if (type === 'configure') {
      if (this.rejectNext) { this.rejectNext = false; throw new Error('Synthetic configure rejection'); }
      if (this.holdNext) { this.holdNext = false; return new Promise((_, reject) => { this.rejectHeld = reject; }); }
      this.publish(payload); return { config: { ...this.config } };
    }
    return { ok: true };
  }
  dispose() { this.alive = false; }
  sendControlResponse() {}
}
const worker = new Worker();
const server = new ZyraAgentServer({ stateDirectory: dir, root: process.cwd(), endpoint: 0, catalog, createWorker: () => worker });
async function until(predicate) {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.ok(predicate(), 'Canonical configuration did not propagate');
}
let desktop, phone, tui;
try {
  await server.start();
  desktop = new ZyraAgentServerClient({ stateDirectory: dir, autoStart: false, clientId: 'test:config-desktop', surface: 'desktop' });
  phone = new ZyraAgentServerClient({ stateDirectory: dir, autoStart: false, clientId: 'test:config-phone', surface: 'mobile' });
  await desktop.attach({ project: dir, session: canonical });
  await phone.request('session.join', { session: canonical, lastSequence: 0 });
  tui = await createZyraTuiClientRuntime({ project: dir, session: canonical, agentServer: { stateDirectory: dir, autoStart: false } });
  assert.equal(tui.session.sessionManager.getSessionUsage().cost.total, .5, 'the server numeric total includes history outside the loaded TUI page');
  const desktopEvents = [], phoneEvents = [], tuiEvents = [];
  tui.session.subscribe(event => tuiEvents.push(event));
  desktop.on('session-event', message => desktopEvents.push(message.event));
  phone.on('session-event', message => phoneEvents.push(message.event));

  tui.permissionMode = 'full-access';
  await until(() => phoneEvents.some(event => event.type === 'session_config' && event.runtimeMode === 'full-access'));
  assert.ok(desktopEvents.some(event => event.type === 'session_config' && event.runtimeMode === 'full-access'));
  assert.equal(worker.config.runtimeMode, 'full-access');

  // A newer server model exists before its socket event reaches this TUI. Editing
  // permissions must not write back the TUI's unrelated, stale model snapshot.
  worker.publish({ model: 'openai-codex/gpt-6-astra' });
  const before = worker.calls.filter(call => call.type === 'configure').length;
  tui.permissionMode = 'auto-review';
  await until(() => worker.calls.filter(call => call.type === 'configure').length > before);
  assert.equal(worker.config.model, 'openai-codex/gpt-6-astra', 'Permission edits must preserve a newer model from another surface');
  await until(() => tui.session.model.id === 'gpt-6-astra' && tui.permissionMode === 'auto-review');

  tui.thinking = 'max';
  await until(() => worker.config.thinking === 'max');
  await until(() => phoneEvents.some(event => event.thinking === 'max'));

  await tui.session.setModel({ ...tui.session.model, provider: 'openai-codex', id: 'gpt-5.6-sol' });
  await until(() => phoneEvents.some(event => event.model === 'openai-codex/gpt-5.6-sol' && event.thinking === 'max'));
  assert.equal(worker.config.runtimeMode, 'auto-review');
  assert.deepEqual(worker.calls.findLast(call => call.type === 'configure').payload, { model: 'openai-codex/gpt-5.6-sol' });
  const batchStart = worker.calls.filter(call => call.type === 'configure').length;
  tui.webSearch = true;
  tui.webFetch = true;
  await until(() => worker.config.webSearch && worker.config.webFetch);
  const batched = worker.calls.filter(call => call.type === 'configure').slice(batchStart);
  assert.equal(batched.length, 1, 'Synchronous changes coalesce without redundant full snapshots');
  assert.deepEqual(batched[0].payload, { webSearch: true, webFetch: true });
  const incomingStart = worker.calls.filter(call => call.type === 'configure').length;
  worker.publish({ runtimeMode: 'approval-required', thinking: 'high' });
  await until(() => tui.permissionMode === 'approval-required' && tui.thinking === 'high');
  assert.equal(worker.calls.filter(call => call.type === 'configure').length, incomingStart, 'Incoming settings update the TUI without an echo write');
  worker.rejectNext = true;
  tui.permissionMode = 'full-access';
  await until(() => worker.rejectNext === false);
  await until(() => tui.permissionMode === 'approval-required');
  worker.rejectNext = true;
  tui.thinking = 'max';
  await until(() => worker.rejectNext === false);
  await until(() => tui.thinking === 'high');
  assert.ok(tuiEvents.some(event => event.type === 'history_error' && event.errorMessage.includes('Synthetic configure rejection')));
  worker.holdNext = true;
  tui.permissionMode = 'full-access';
  await until(() => worker.rejectHeld !== null);
  worker.publish({ runtimeMode: 'edits-only' });
  await until(() => tui.permissionMode === 'edits-only');
  worker.rejectHeld(new Error('Older rejected permission update'));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(tui.permissionMode, 'edits-only', 'Late rejection cannot roll back newer canonical state');
  worker.rejectHeld = null;
  worker.holdNext = true;
  tui.permissionMode = 'full-access';
  await until(() => worker.rejectHeld !== null);
  const rejectOlder = worker.rejectHeld;
  worker.holdNext = true;
  tui.permissionMode = 'auto-review';
  rejectOlder(new Error('Superseded local choice'));
  await until(() => worker.rejectHeld !== rejectOlder);
  assert.equal(tui.permissionMode, 'auto-review', 'Late rejection cannot roll back a newer local choice');
  worker.rejectHeld(new Error('Latest local choice rejected'));
  await until(() => tui.permissionMode === 'edits-only');
  console.log('TUI canonical permissions/model/thinking propagation and stale-field isolation: passed');
} finally {
  await tui?.session.dispose(); phone?.close(); desktop?.close(); await server.stop();
  rmSync(dir, { recursive: true, force: true });
}
