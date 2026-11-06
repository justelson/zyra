import assert from 'node:assert/strict';
import { HarnessTransport } from '../src/agent-server/harness-transport.mjs';

let starts = 0, stops = 0, releases = 0, imports = 0;
let finish;
const gate = new Promise(resolve => { finish = resolve; });
const api = {
  harnessServeStatus: () => ({ running: true }),
  findHarnessExecutable: () => '/fixture/opencode',
  prepareHarnessServe: async () => { starts++; await gate; },
  prepareHarnessClient: async (client) => { assert.equal(client.cwd, '/other-project'); assert.equal(client.apiVersion, 2); projectPreparations++; },
  ensureHarnessServe: async () => ({ baseUrl: 'http://127.0.0.1:1', client: { password: 'synthetic-local-transport', apiVersion: 2 }, release: () => { releases++; } }),
  stopHarnessServe: async () => { stops++; }
};
let projectPreparations = 0;
const load = async () => { imports++; return api; };
const cold = new HarnessTransport('/unused', load);
await cold.dispose(); assert.equal(imports, 0, 'unused harness services stay cold');
const transport = new HarnessTransport('/runtime', load);
const first = transport.get(), second = transport.get();
assert.equal(await first, await second, 'different chat workers receive the same private transport');
let prepared = false;
const preparation = transport.prepare().then(() => { prepared = true; });
await new Promise(resolve => setImmediate(resolve));
assert.equal(prepared, false, 'attachment can claim the healthy transport while project preparation is pending');
finish(); await preparation;
await Promise.all([transport.prepareProject('/other-project'), transport.prepareProject('/other-project')]);
assert.equal(projectPreparations, 1, 'project provider setup is shared between concurrent authorized attachments');
assert.equal(starts, 1, 'concurrent chats initialize one local server');
assert.deepEqual(Object.keys(await first).sort(), ['apiVersion', 'baseUrl', 'password']);
await transport.dispose();
assert.equal(releases, 1); assert.equal(stops, 1);
await assert.rejects(transport.get(), /closed/);
let attempts = 0;
const retry = new HarnessTransport('/runtime', async () => ({ ...api, ensureHarnessServe: async () => {
  if (++attempts === 1) throw new Error('Synthetic initialization failure');
  return api.ensureHarnessServe();
} }));
await assert.rejects(retry.get(), /Synthetic/);
await retry.get(); assert.equal(attempts, 2, 'a failed initialization can retry');
await retry.dispose();
const delayedFailure = new HarnessTransport('/preparation-failure', async () => ({
  ...api, prepareHarnessServe: async () => { throw new Error('Synthetic project preparation failure'); }
}));
assert.ok((await delayedFailure.get()).baseUrl, 'optional preparation failure does not discard a healthy transport');
await assert.rejects(delayedFailure.prepare(), /Synthetic project/);
await delayedFailure.dispose();
let generation = 0, running = true, recoveryReleases = 0;
const recovery = new HarnessTransport('/recovery', async () => ({
  ...api,
  harnessServeStatus: () => ({ running }),
  prepareHarnessServe: async () => {},
  ensureHarnessServe: async () => { generation++; running = true; return ({
    baseUrl: `http://127.0.0.1:${generation}`, client: { password: 'synthetic-local-transport' },
    release: () => { recoveryReleases++; }
  }); }
}));
const original = await recovery.get();
running = false;
const [replacement, concurrentReplacement] = await Promise.all([recovery.get(), recovery.get()]);
assert.notEqual(replacement.baseUrl, original.baseUrl, 'an exited local server receives a fresh endpoint');
assert.equal(replacement, concurrentReplacement, 'concurrent recovery initializes one replacement');
assert.equal(generation, 2);
assert.equal(recoveryReleases, 1, 'the exited lease releases exactly once');
await recovery.dispose();
await recovery.dispose();
assert.equal(recoveryReleases, 2, 'repeated shutdown is idempotent');
console.log('Shared harness transport: cold services, concurrent reuse, failure retry, recovery and shutdown passed.');
