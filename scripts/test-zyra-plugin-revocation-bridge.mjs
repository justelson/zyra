import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentBridgeWorker } from '../src/agent-server/bridge-worker.mjs';

const fixture = await mkdtemp(path.join(os.tmpdir(), 'zyra-plugin-revoke-bridge-'));
let worker;
try {
  await mkdir(path.join(fixture, 'src'));
  const trace = path.join(fixture, 'cleanup.jsonl');
  // The production bridge imports only this fixture SDK. No provider, credentials,
  // user sessions, Plugin code, subprocess tools, or network are involved.
  await writeFile(path.join(fixture, 'src', 'zyra-sdk.mjs'), `
import { appendFileSync } from 'node:fs';
const record = (event) => appendFileSync(${JSON.stringify(trace)}, JSON.stringify(event) + '\\n');
let emit;
let finishPrompt;
let finishJob;
let requestPermission;
export async function createZyraSession(options) {
  requestPermission = options.permissionRequest;
  const job = { done: new Promise((resolve) => { finishJob = resolve; }) };
  return {
    session: {
      sessionManager: { getSessionId: () => 'fixture-chat', getSessionName: () => 'Fixture' },
      subscribe(listener) { emit = listener; return () => {}; },
      clearQueue() { record('clear-queue'); },
      abortCompaction() { record('abort-compaction'); },
      async abort() { record('abort-root'); finishPrompt?.(); },
      dispose() { record('dispose-session'); }
    },
    managedBash: {
      jobs: new Map([['fixture-job', job]]),
      abortAll() { record('abort-job'); setTimeout(() => { record('job-exited'); finishJob(); }, 40); }
    },
    fleet: {
      async dispose() { record('dispose-fleet'); await new Promise((resolve) => setTimeout(resolve, 20)); record('fleet-cleaned'); }
    }
  };
}
export function getZyraThinkingLevel() { return 'medium'; }
export function describeRuntime() { return {}; }
export function setZyraReasoningSummary() {}
export async function runZyraPrompt() {
  const result = new Promise((resolve) => { finishPrompt = resolve; });
  const approval = requestPermission({ title: 'Fixture pending approval', toolName: 'bash' });
  emit({ type: 'agent_start' });
  await result;
  record('approval-' + await approval);
}
`);
  worker = new AgentBridgeWorker({ root: fixture, cwd: fixture, bridgePath: path.resolve(import.meta.dirname, '../src/zyra-ui-bridge.mjs') });
  worker.on('stderr', (text) => process.stderr.write(`[fixture bridge] ${text}\n`));
  await worker.request('connect', { surface: 'memory-worker', cwd: fixture }, { timeoutMs: 15000 });
  const started = once(worker, 'event');
  const prompt = worker.request('prompt', { prompt: 'fixture', skipTitleGeneration: true });
  void prompt.catch(() => undefined);
  await started;
  const result = await worker.request('plugin.revoke', {}, { timeoutMs: 5000 });
  assert.equal(result.revoked, true);
  await prompt;
  const events = (await readFile(trace, 'utf8')).trim().split('\n').map(JSON.parse);
  for (const event of ['clear-queue', 'abort-compaction', 'abort-root', 'abort-job', 'dispose-fleet', 'fleet-cleaned', 'job-exited', 'approval-decline']) {
    assert.ok(events.includes(event), `bridge acknowledgement must follow ${event}`);
  }
  await assert.rejects(() => worker.request('prompt', { prompt: 'stale' }), /authority revoked/);
  console.log('Production bridge Plugin revocation protocol cancels work, awaits cleanup and rejects stale prompts: ok');
} finally {
  const child = worker?.child;
  const exited = child && child.exitCode === null ? once(child, 'exit') : Promise.resolve();
  worker?.dispose();
  await exited;
  await rm(fixture, { recursive: true, force: true });
}
