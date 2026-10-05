import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as managed from '../src/managed-bash-tool.mjs';

// Exercise the worker's actual Stop handler without importing the SDK or starting IPC.
const source = await readFile(new URL('../src/zyra-ui-bridge.mjs', import.meta.url), 'utf8');
const handler = source.match(/async function handleAbort\(\) \{[\s\S]*?\r?\n\}\r?\n/)[0];
const state = managed.createManagedBashState();
const makeJob = (id, background, persistent = false) => ({
  id, command: 'synthetic', toolCallId: id, background, persistent,
  startedAt: Date.now(), output: '', done: Promise.resolve(),
  abortController: new AbortController(),
});
const foreground = makeJob('foreground', false);
const adopted = makeJob('adopted', true);
const persistent = makeJob('persistent', true, true);
state.jobs.set(foreground.id, foreground);
state.jobs.set(adopted.id, adopted);
state.jobs.set(persistent.id, persistent);
let childStops = 0, agentStops = 0, compactionStops = 0;
const runtime = { managedBash: state, fleet: { cancelAll: async () => { childStops++; } }, session: {
  abort: async () => { agentStops++; }, abortCompaction: () => { compactionStops++; },
} };
const stopEvents = [];
const stop = new Function('runtime', 'declinePendingPermissions', 'abandonPendingUserInputs',
  'controlBridgeClient', 'abortManagedBashForegroundJobs', 'assertManagedBashCleanup', 'send', `${handler}; return handleAbort;`)(
  runtime, () => {}, () => {}, { cancelPending() {} }, managed.abortManagedBashForegroundJobs, managed.assertManagedBashCleanup, event => stopEvents.push(event),
);
await stop();
assert.equal(foreground.abortController.signal.aborted, true);
assert.equal(adopted.abortController.signal.aborted, false, 'Stop turn must preserve already-yielded jobs');
assert.equal(persistent.abortController.signal.aborted, false, 'Stop turn must preserve explicit background jobs');
assert.equal(childStops, 1);
assert.equal(agentStops, 1);
assert.equal(compactionStops, 1);
assert.deepEqual(stopEvents[0].event.interruption, { kind: 'stopped', source: 'user' });

// A never-ending background server cannot hold the Stop response open.
adopted.done = new Promise(() => {});
persistent.done = new Promise(() => {});
let timer;
try {
  await Promise.race([stop(), new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Stop waited for a background job')), 100);
  })]);
} finally { clearTimeout(timer); }
state.abortAll('disposed');
assert.equal(adopted.abortController.signal.aborted, true, 'Disposal must retain full cleanup authority');
assert.equal(persistent.abortController.signal.aborted, true);
assert.match(source, /message\?\.type === "managed_bash\.list"/);
assert.match(source, /message\?\.type === "managed_bash\.stop"/);
console.log('Root Stop preserves background jobs and cancels foreground/child agents.');
