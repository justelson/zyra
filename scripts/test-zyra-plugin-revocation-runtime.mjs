import assert from 'node:assert/strict';
import { revokePluginRuntime } from '../src/plugins/revoke-runtime.mjs';
import { createManagedBashState } from '../src/managed-bash-tool.mjs';
import { CancellationTree } from '../src/agents/runtime/cancellation-tree.mjs';

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const jobs = createManagedBashState();
const command = new AbortController();
const commandExit = deferred();
// A managed job uses its real abort/done contract, without starting a process.
jobs.jobs.set('fixture-job', { abortController: command, done: commandExit.promise, status: 'running' });
const fleet = new CancellationTree();
fleet.create('root');
fleet.create('child', 'root');
fleet.create('grandchild', 'child');
const childSignal = fleet.signal('child');
const grandchildSignal = fleet.signal('grandchild');
const leaseCleanup = deferred();
let childGrantRevoked = false;
fleet.addCleanup('child', async () => { await leaseCleanup.promise; childGrantRevoked = true; });
const calls = [];
let acknowledged = false;
const stopping = revokePluginRuntime({
  managedBash: jobs,
  session: {
    clearQueue() { calls.push('clear-queue'); },
    abortCompaction() { calls.push('abort-compaction'); },
    async abort() { calls.push('abort-root'); }
  },
  fleet: { dispose: () => fleet.dispose() }
}).then(() => { acknowledged = true; });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(command.signal.aborted, true, 'managed commands receive cancellation');
assert.equal(childSignal.aborted, true);
assert.equal(grandchildSignal.aborted, true, 'cancellation reaches descendants');
assert.deepEqual(calls, ['clear-queue', 'abort-compaction', 'abort-root']);
assert.equal(acknowledged, false, 'revocation waits for child/control cleanup');
leaseCleanup.resolve();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(childGrantRevoked, true);
assert.equal(acknowledged, false, 'revocation also waits for managed command termination');
commandExit.resolve();
await stopping;
assert.equal(acknowledged, true);

let otherCleanupRan = false;
await assert.rejects(() => revokePluginRuntime({
  session: { clearQueue() { throw new Error('fixture queue failure'); }, abort() { otherCleanupRan = true; } },
  fleet: { dispose() { throw new Error('fixture fleet failure'); } }
}), /cleanup failed/);
assert.equal(otherCleanupRan, true, 'one cleanup failure does not skip the remaining cleanup');
console.log('Plugin runtime revocation: root/compaction/queue, managed jobs, descendant cancellation, cleanup acknowledgement and failure: ok');
