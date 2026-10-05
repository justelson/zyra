import assert from 'node:assert/strict';
import * as managed from '../src/managed-bash-tool.mjs';

assert.equal(typeof managed.listManagedBashJobs, 'function', 'Managed jobs need an authoritative list helper');
assert.equal(typeof managed.stopManagedBashJobs, 'function');
assert.equal(typeof managed.abortManagedBashForegroundJobs, 'function');

// Synthetic executor: no shell, servers, provider, filesystem mutation or process termination.
function fixture() {
  const state = managed.createManagedBashState();
  const executions = [];
  const updates = [];
  state.subscribe(update => updates.push(update));
  const operations = { exec(command, cwd, execution) {
    return new Promise((resolve, reject) => {
      executions.push({ command, execution, resolve, reject });
      execution.signal.addEventListener('abort', () => {
        const error = new Error(command === 'cleanup-fails' ? 'Cleanup unconfirmed' : 'aborted');
        if (command === 'cleanup-fails') error.code = 'SHELL_CLEANUP_FAILED';
        reject(error);
      }, { once: true });
    });
  } };
  const tool = managed.createManagedBashTool({ state, operations });
  return { state, tool, executions, updates, operations };
}
const f = fixture();
const turn = new AbortController();
const yielded = await f.tool.execute('call-adopt', { command: 'arbitrary silent command', wait: 0 }, turn.signal);
assert.equal(yielded.details.background, true);
assert.equal(f.updates[0].background, false, 'silent start is observable');
assert.equal(f.updates[0].status, 'running');
assert.equal(f.updates.at(-1).background, true, 'silent adoption is observable');
assert.equal(f.state.jobs.get(yielded.details.jobId).persistent, false);
assert.equal(managed.hasManagedBashAutoPollJobs(f.state), true, 'adopted finite work still polls');
turn.abort();
assert.equal(f.executions[0].execution.signal.aborted, false, 'yielded process is detached from turn abort');
const persistentTurn = new AbortController();
const persistentRun = f.tool.execute('call-server', { command: 'any name', background: true, wait: 60 }, persistentTurn.signal);
const server = await Promise.race([persistentRun, new Promise((_, reject) => {
  const timer = setTimeout(() => reject(new Error('Explicit background run did not return promptly')), 100);
  persistentRun.finally(() => clearTimeout(timer));
})]);
persistentTurn.abort();
assert.equal(f.executions[1].execution.signal.aborted, false);
assert.equal(server.details.background, true);
assert.equal(f.state.jobs.get(server.details.jobId).autoPollDone, true);
f.executions[0].resolve({ exitCode: 0 });
await f.state.jobs.get(yielded.details.jobId).done;
await managed.waitForManagedBashAutoUpdate(f.state, { waitMs: 0 });
assert.equal(managed.hasManagedBashAutoPollJobs(f.state), false, 'persistent server cannot drive auto-poll');
const listed = managed.listManagedBashJobs(f.state);
assert.equal(listed.jobs.length, 2);
assert.equal(listed.jobs[0].status, 'completed');
assert.equal(listed.jobs[1].command, 'any name');
assert.equal(listed.jobs[1].toolCallId, 'call-server');
assert.equal(listed.jobs[1].background, true);
f.state.jobs.get(server.details.jobId).output = 'large output'.repeat(10000);
assert.equal('output' in managed.listManagedBashJobs(f.state).jobs[1], false, 'process controls do not copy output tails');
assert.equal(managed.createManagedBashJobSnapshot(f.state.jobs.get(server.details.jobId)).output.length, 50000, 'lifecycle evidence retains bounded output');
managed.assertManagedBashCleanup([{ status: 'fulfilled' }], []);
assert.throws(() => managed.assertManagedBashCleanup([{ status: 'rejected', reason: new Error('agent abort failed') }], []), /agent abort failed/);
assert.throws(() => managed.assertManagedBashCleanup([], [{ error: Object.assign(new Error('cleanup unconfirmed'), { code: 'SHELL_CLEANUP_FAILED' }) }]), /cleanup unconfirmed/);
await assert.rejects(managed.stopManagedBashJobs(f.state, { jobId: 'missing' }), /No managed command/);
for (const payload of [{}, { all: false }, { all: true, jobId: server.details.jobId }]) {
  await assert.rejects(managed.stopManagedBashJobs(f.state, payload), /jobId|all/);
}
const stopped = await managed.stopManagedBashJobs(f.state, { jobId: server.details.jobId });
assert.equal(stopped.jobs.length, 2, 'Stop response retains completed and surviving jobs');
assert.equal(stopped.jobs.find(job => job.jobId === server.details.jobId).status, 'stopped');
assert.ok(stopped.jobs.find(job => job.jobId === server.details.jobId).completedAt);
assert.equal(f.executions[1].execution.signal.aborted, true);

const g = fixture();
const foregroundTurn = new AbortController();
const foregroundRun = g.tool.execute('call-fg', { command: 'finite work', wait: 1 }, foregroundTurn.signal);
const background = await g.tool.execute('call-bg', { command: 'silent', background: true });
const all = await managed.stopManagedBashJobs(g.state, { all: true });
assert.deepEqual(all.jobs.map(job => job.status), ['running', 'stopped'], 'Stop all response retains foreground work');
assert.equal(g.executions[0].execution.signal.aborted, false, 'Stop all selects background jobs only');
foregroundTurn.abort();
assert.equal((await foregroundRun).details.status, 'stopped');
assert.equal(g.executions[0].execution.signal.aborted, true);
const bad = await g.tool.execute('call-bad', { command: 'cleanup-fails', background: true });
const failure = await managed.stopManagedBashJobs(g.state, { jobId: bad.details.jobId });
const failedJob = failure.jobs.find(job => job.jobId === bad.details.jobId);
assert.equal(failedJob.status, 'failed');
assert.equal(failedJob.cleanupFailed, true);
assert.match(failedJob.errorMessage, /unconfirmed/);
assert.equal(managed.listManagedBashJobs(g.state).jobs.at(-1).status, 'failed');
// Failed cleanup cannot be silently pruned as a confirmed terminal job.
for (let i = 0; i < 70; i++) {
  const run = g.tool.execute(`finite-${i}`, { command: 'complete', wait: 0.01 });
  g.executions.at(-1).resolve({ exitCode: 0 });
  await run;
}
assert.ok(managed.listManagedBashJobs(g.state).jobs.some(job => job.jobId === bad.details.jobId));
// The forced owner option scopes both Bash actions and worker control helpers.
const owned = fixture();
const childA = managed.createManagedBashTool({ state: owned.state, ownerAgentRunId: 'child-a', operations: owned.operations });
const childB = managed.createManagedBashTool({ state: owned.state, ownerAgentRunId: 'child-b', operations: owned.operations });
const runA = await childA.execute('owner-a', { command: 'server-a', background: true });
const survivorA = await childA.execute('owner-a2', { command: 'server-a2', background: true });
const runB = await childB.execute('owner-b', { command: 'server-b', background: true });
const rootRun = await owned.tool.execute('owner-root', { command: 'server-root', background: true });
assert.equal(managed.listManagedBashJobs(owned.state).jobs.length, 4);
assert.deepEqual(managed.listManagedBashJobs(owned.state, { ownerAgentRunId: 'child-b' }).jobs.map(job => job.jobId), [runB.details.jobId]);
assert.equal(managed.listManagedBashJobs(owned.state, { ownerAgentRunId: 'unknown' }).jobs.length, 0);
for (const jobId of [runB.details.jobId, rootRun.details.jobId]) {
  await assert.rejects(childA.execute('no-status', { action: 'status', jobId, wait: 0, ownerAgentRunId: 'child-b' }), /No managed command/);
  await assert.rejects(childA.execute('no-stop', { action: 'stop', jobId, ownerAgentRunId: 'child-b' }), /No managed command/);
  await assert.rejects(managed.stopManagedBashJobs(owned.state, { jobId, ownerAgentRunId: 'child-a' }), /No managed command/);
}
assert.equal((await childA.execute('own-status', { action: 'status', jobId: runA.details.jobId, wait: 0 })).details.status, 'running');
const ownStop = await managed.stopManagedBashJobs(owned.state, { jobId: runA.details.jobId, ownerAgentRunId: 'child-a' });
assert.deepEqual(ownStop.jobs.map(job => job.status), ['stopped', 'running'], 'Owner-scoped stop keeps sibling server visible');
assert.equal(ownStop.jobs[1].jobId, survivorA.details.jobId);
const ownAll = await managed.stopManagedBashJobs(owned.state, { all: true, ownerAgentRunId: 'child-a' });
assert.ok(ownAll.jobs.every(job => job.ownerAgentRunId === 'child-a' && job.status === 'stopped'));
assert.equal(owned.executions[2].execution.signal.aborted, false, 'Owner stop all preserves sibling actor');
assert.equal(owned.executions[3].execution.signal.aborted, false, 'Owner stop all preserves root actor');
await owned.tool.execute('root-status', { action: 'status', jobId: runB.details.jobId, wait: 0 });
await managed.stopManagedBashJobs(owned.state, { all: true });
console.log('Managed Bash adoption, persistent background, list/stop, cleanup failures, retention and child ownership passed.');
