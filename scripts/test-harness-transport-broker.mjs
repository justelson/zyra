import assert from 'node:assert/strict';
import { HarnessTransportBrokerClient, borrowedHarnessHooks } from '../src/agent-server/harness-transport-broker.mjs';
import { AgentBridgeWorker } from '../src/agent-server/bridge-worker.mjs';
import { ZyraAgentServer } from '../src/agent-server/server.mjs';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
const descriptor = { baseUrl: 'http://127.0.0.1:9', password: 'private-fixture', apiVersion: 2 };
const sent = [];
const broker = new HarnessTransportBrokerClient(message => sent.push(message));
const first = broker.get(), second = broker.get();
assert.equal(JSON.stringify(sent).includes('private-fixture'), false, 'requests contain no descriptor');
broker.handleResponse({ id: sent[1].id, transport: descriptor });
broker.handleResponse({ id: sent[0].id, transport: descriptor });
assert.equal(await first, descriptor); assert.equal(await second, descriptor);
const leasePromise = borrowedHarnessHooks(() => broker.get()).ensureServe({ cwd: '/selected' });
broker.handleResponse({ id: sent.at(-1).id, transport: descriptor });
const lease = await leasePromise;
assert.equal(lease.client.cwd, '/selected');
assert.equal(lease.client.baseUrl, descriptor.baseUrl);
assert.equal(lease.client.password, descriptor.password);
assert.equal(lease.client.apiVersion, 2, 'native API version survives the private parent/worker boundary');
lease.release(); // A borrowed lease cannot stop its server-owned transport.
await assert.rejects(borrowedHarnessHooks(async () => ({ deferred: true })).ensureServe(), /still starting/);
const failed = broker.get();
broker.handleResponse({ id: sent.at(-1).id, error: 'Unavailable fixture' });
await assert.rejects(failed, /Unavailable fixture/);
const cancelled = broker.get();
broker.dispose();
await assert.rejects(cancelled, /worker closed/);
await assert.rejects(broker.get(), /worker closed/);
assert.equal(broker.pending.size, 0);
const throwing = new HarnessTransportBrokerClient(() => { throw Error('Closed pipe'); });
await assert.rejects(throwing.get(), /Closed pipe/);
assert.equal(throwing.pending.size, 0);
const timed = new HarnessTransportBrokerClient(() => {}, 5);
const keepAlive = setTimeout(() => {}, 100);
try { await assert.rejects(timed.get(), /timed out/); } finally { clearTimeout(keepAlive); }
assert.equal(timed.pending.size, 0);

const root = fileURLToPath(new URL('../', import.meta.url));
const routedWorker = new AgentBridgeWorker({ root });
const privateRequests = [], publicEvents = [], publicErrors = [];
routedWorker.on('harness-transport-request', value => privateRequests.push(value));
routedWorker.on('event', value => publicEvents.push(value));
routedWorker.on('stderr', value => publicErrors.push(value));
routedWorker.handleLine(JSON.stringify({ type: 'harness.transport.request', id: 17 }));
assert.deepEqual(privateRequests, [{ type: 'harness.transport.request', id: 17 }]);
assert.equal(publicEvents.length + publicErrors.length, 0);

class FakeWorker extends EventEmitter {
  isAlive() { return this.alive !== false; }
  sendControlResponse(message) { this.responses.push(message); }
  constructor() { super(); this.responses = []; }
}
const worker = new FakeWorker();
// No start/catalog access; the absent isolated state path prevents user reads.
const server = new ZyraAgentServer({ root, stateDirectory: path.join(tmpdir(), 'zyra-broker-unstarted-' + randomUUID()), createWorker: () => worker, catalog: {} });
let starts = 0;
server.harnessTransport = { get: async () => { starts++; return descriptor; } };
const broadcasts = [];
server.on('worker-stderr', value => broadcasts.push(value));
server.getUtilityWorker();
assert.equal(starts, 0, 'unused utility worker does not start a backend');
worker.emit('harness-transport-request', { id: 3 });
await new Promise(resolve => setImmediate(resolve));
assert.deepEqual(worker.responses, [{ type: 'harness.transport.response', id: 3, transport: descriptor }]);
assert.equal(starts, 1);
assert.equal(JSON.stringify(server.state()).includes(descriptor.password), false);
server.harnessTransport.get = async () => { throw Error(descriptor.password); };
worker.emit('harness-transport-request', { id: 4 });
await new Promise(resolve => setImmediate(resolve));
assert.deepEqual(worker.responses.at(-1), { type: 'harness.transport.response', id: 4, error: 'Shared harness transport is unavailable.' });
assert.equal(broadcasts.length, 0, 'transport failures and secrets stay off public worker events');
worker.alive = false;
worker.emit('harness-transport-request', { id: 5 });
await new Promise(resolve => setImmediate(resolve));
assert.equal(worker.responses.length, 2, 'closed workers receive no late descriptors');
console.log('Private transport broker: concurrent replies, lazy startup, timeout, disposal, descriptor validation and event privacy passed.');
