import assert from 'node:assert/strict';
import fs, { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { AgentBridgeWorker } from '../src/agent-server/bridge-worker.mjs';
import { isolateBridgeEnvironment } from './fixtures/agent-server-bridge-env.mjs';

const root = path.resolve(import.meta.dirname, '..');
const temporary = mkdtempSync(path.join(os.tmpdir(), 'zyra-streaming-usage-'));
const fixtureRoot = path.join(temporary, 'runtime');
mkdirSync(path.join(fixtureRoot, 'src'), { recursive: true });
copyFileSync(path.join(root, 'scripts/fixtures/streaming-usage-sdk.mjs'), path.join(fixtureRoot, 'src/zyra-sdk.mjs'));
const isolation = isolateBridgeEnvironment(temporary);
const worker = new AgentBridgeWorker({ root: fixtureRoot, bridgePath: path.join(root, 'src/zyra-ui-bridge.mjs'), cwd: temporary });
// Allow a cold SDK/worker import on a contended Windows machine. Streaming
// correctness is asserted by delivered events and forbidden filesystem calls.
const requestTimeoutMs = 120_000;
const events = [];
worker.on('event', (event) => events.push(event));
let workerClosed;
try {
  await worker.request('connect', {
    cwd: temporary, model: 'fixture/streaming', thinking: 'low', profile: 'default',
    runtimeMode: 'approval-required', surface: 'memory-worker',
  }, { timeoutMs: requestTimeoutMs });
  // Uses the real production subscription, normalization and stdout protocol.
  // The synthetic SDK rejects full status work during a provider response.
  await assert.doesNotReject(worker.request('prompt', { prompt: 'synthetic', skipTitleGeneration: true }, { timeoutMs: requestTimeoutMs }));
  assert.equal(events[0].type, 'message_start');
  assert.equal(events.at(-1).type, 'agent_end');
  const updates = events.filter((event) => event.type === 'message_update');
  assert.equal(updates.length, 33, 'all reasoning and text events reach the bridge client');
  const expected = Array.from({ length: 32 }, (_, i) => `word-${i} λ `).join('');
  assert.equal(updates.map((event) => event.assistantMessageEvent).filter((event) => event.type === 'text_delta').map((event) => event.delta).join(''), expected);
  const completed = events.find((event) => event.type === 'message_end');
  assert.equal(completed.message.content[1].text, expected);
  assert.equal(completed.message.content[0].thinking, 'Synthetic reasoning');
  assert.equal(completed.message.stopReason, 'stop');
  assert.equal(completed.message.usage.total, 316);
  assert.equal(events[0].message.content[1].text, '', 'earlier protocol snapshots remain independent of later mutations');
  assert.equal(updates[0].message.content[1].text, '');
  const metered = events.filter((event) => event.sessionUsage);
  assert.ok(metered.length >= 3, 'start, periodic live update and completion retain usage/context metadata');
  for (const event of metered) {
    assert.equal(event.sessionUsage.cost, .01);
    assert.equal(event.sessionUsage.costComplete, true);
    assert.equal(event.autoCompactionEnabled, true);
    assert.equal(event.contextUsage.contextWindow, 32768);
  }
  assert.equal(completed.sessionUsage.total, 316);

  // Check the real SDK read against legacy/compaction usage shapes. Imports and
  // fixtures are initialized before rejecting any filesystem access in the read.
  process.env.ZYRA_ROOT = fixtureRoot;
  const sdk = await import('../src/zyra-sdk.mjs');
  const entries = [
    { type: 'message', message: { role: 'assistant', usage: { input: 100, output: 20, cacheRead: 50, cost: { total: .01 } } } },
    { type: 'message', message: { role: 'toolResult', usage: { input: 10, output: 5, cacheWrite: 2 } } },
    { type: 'compaction', usage: { input: 40, output: 10, cost: { total: .005 } } },
  ];
  const runtime = { session: {
    model: { contextWindow: 1000 }, messages: [{ role: 'user', content: 'Synthetic context' }],
    sessionManager: { getEntries: () => entries },
    getContextUsage: () => ({ tokens: 400, contextWindow: 1000, percent: 40 }),
  } };
  const expectedUsage = sdk.calculateSessionUsage(runtime.session.sessionManager);
  const original = {};
  for (const name of ['readFileSync', 'readdirSync', 'statSync', 'existsSync', 'mkdirSync', 'writeFileSync']) {
    original[name] = fs[name];
    fs[name] = () => { throw new Error(`Usage refresh must not call ${name}`); };
  }
  syncBuiltinESMExports();
  try {
    assert.deepEqual(sdk.getRuntimeUsageSnapshot(runtime), { usage: expectedUsage, contextUsage: { tokens: 400, contextWindow: 1000, percent: 40 } });
    assert.equal(expectedUsage.costComplete, false, 'unpriced tool usage remains visibly incomplete');
    assert.equal(expectedUsage.total, 237, 'assistant, tool and compaction usage remain cumulative');
    runtime.session.getContextUsage = () => ({ tokens: null, contextWindow: 1000, percent: null });
    const fallback = sdk.getRuntimeUsageSnapshot(runtime);
    assert.equal(fallback.contextUsage.estimated, true, 'unknown post-compaction context retains the existing estimate fallback');
    assert.ok(fallback.contextUsage.tokens > 0);
    runtime.session.messages = [];
    assert.equal(sdk.getRuntimeUsageSnapshot(runtime).contextUsage.tokens, null, 'unknown empty context stays unknown');
  } finally {
    Object.assign(fs, original); syncBuiltinESMExports();
  }
  isolation.assertOffline();
  console.log('Streaming usage: real bridge delivery, metadata, fallback and filesystem-free SDK read passed');
} finally {
  if (worker.child) workerClosed = once(worker.child, 'close');
  worker.dispose();
  await workerClosed;
  isolation.restore();
  rmSync(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
