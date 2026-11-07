import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { isolateBridgeEnvironment } from './fixtures/agent-server-bridge-env.mjs';

for (const apiVersion of [1, 2]) {
const temporary = mkdtempSync(path.join(os.tmpdir(), 'zyra-broker-bridge-'));
const root = fileURLToPath(new URL('../', import.meta.url));
let isolation, worker;
try {
  isolation = isolateBridgeEnvironment(temporary);
  process.env.ZYRA_BROKER_FIXTURE_LOG = path.join(temporary, 'discovery.log');
  process.env.ZYRA_BROKER_FIXTURE_VERSION = String(apiVersion);
  process.env.NODE_OPTIONS += ` --import ${new URL('./fixtures/harness-broker-discovery.mjs', import.meta.url).href}`;
  const providerPath = path.join(process.env.ZYRA_DATA_ROOT, '.zyra', 'providers.json');
  mkdirSync(path.dirname(providerPath), { recursive: true });
  writeFileSync(providerPath, JSON.stringify({ 'opencode-harness': {
    label: 'Harness fixture', model: 'opencode-harness/broker-fixture/stale', config: { models: [{
      id: 'broker-fixture/stale', name: 'Stale fixture', api: 'openai-completions', baseUrl: 'http://127.0.0.1/opencode-harness',
      contextWindow: 32768, maxTokens: 4096, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    }] },
  } }));
  const { ZyraAgentServer } = await import('../src/agent-server/server.mjs');
  const { AgentBridgeWorker } = await import('../src/agent-server/bridge-worker.mjs');
  const server = new ZyraAgentServer({ root, stateDirectory: path.join(temporary, 'state'), catalog: {}, createWorker: options => new AgentBridgeWorker(options) });
  let leases = 0;
  server.harnessTransport = { get: async () => { leases++; return { baseUrl: 'http://127.0.0.1:9', password: 'private-broker-fixture', ...(apiVersion === 2 ? { apiVersion } : {}) }; } };
  worker = server.getUtilityWorker();
  const publicEvents = [];
  worker.on('event', value => publicEvents.push(value));
  const result = await worker.request('warmup', { forceRefresh: true, skipAvailability: true, serverOwnedHarness: true }, { timeoutMs: 30_000 });
  assert.ok(result.models.some(model => model.id === 'opencode-harness/broker-fixture/discovered'), 'real bridge/SDK discovery replaces a stale native catalog');
  assert.deepEqual(result.models.find(model => model.id === 'opencode-harness/broker-fixture/discovered').supportedEfforts, ['high', 'variant:Deep%20mode'], 'native variants survive actual catalog registration, bridge mapping and private worker IPC');
  assert.equal(leases, 1, 'catalog uses one server-owned lease rather than starting another backend');
  assert.equal(readFileSync(process.env.ZYRA_BROKER_FIXTURE_LOG, 'utf8'), apiVersion === 2 ? 'model\n' : 'provider\n');
  const persisted = readFileSync(providerPath, 'utf8');
  assert.ok(persisted.includes('broker-fixture/discovered'));
  assert.equal(JSON.stringify([result, publicEvents]).includes('private-broker-fixture'), false);
  assert.equal(persisted.includes('private-broker-fixture'), false, 'descriptor is not stored with models');
  isolation.assertOffline();
  console.log(`Actual V${apiVersion} bridge → private parent RPC → SDK discovery → saved catalog passed; no backend spawn or model request.`);
} finally {
  if (worker?.child) { const closed = once(worker.child, 'close'); worker.dispose(); await closed; }
  isolation?.restore();
  const resolved = path.resolve(temporary);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('zyra-broker-bridge-')) throw Error('Unexpected fixture cleanup path');
  rmSync(resolved, { recursive: true, force: true });
}
}
