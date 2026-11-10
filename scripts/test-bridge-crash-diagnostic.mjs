import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { AgentBridgeWorker } from '../src/agent-server/bridge-worker.mjs';
import { BridgeCrashDiagnostic, describeBridgeExit } from '../src/agent-server/bridge-crash-diagnostic.mjs';

const split = new BridgeCrashDiagnostic();
split.record('private prompt: never persist this\nFATAL ER');
split.record('ROR: Reached heap limit Allocation failed - JavaScript heap out of memory\nBearer fixture-secret');
const memory = split.finish(1, null);
assert.equal(memory.failureKind, 'heap-exhausted');
assert.match(describeBridgeExit(memory), /heap memory was exhausted/);
assert.doesNotMatch(JSON.stringify(memory), /private prompt|fixture-secret|Bearer/);
split.reasonAt -= 60_000;
assert.equal(split.finish(1, null).failureKind, 'unknown', 'an old handled error cannot diagnose a later unrelated crash');
const unknown = new BridgeCrashDiagnostic();
unknown.record('an unrecognized message containing private content');
assert.equal(unknown.finish(3221226505, null).failureKind, 'unknown', 'a Windows status alone does not prove memory exhaustion');
assert.match(describeBridgeExit(unknown.finish(3221226505, null)), /0xC0000409/);
assert.equal(unknown.finish(-1073740791, null).windowsStatus, '0xC0000409');
unknown.record('x'.repeat(100_000));
assert.equal(unknown.tail.length, 32_768);

const directory = await mkdtemp(join(tmpdir(), 'zyra-bridge-crash-'));
let worker;
try {
  const bridgePath = join(directory, 'bridge.mjs');
  await writeFile(bridgePath, `process.stdin.once('data',()=>{process.stderr.write('private credentials never persisted\\nFATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory\\n',()=>process.exit(1))});`);
  worker = new AgentBridgeWorker({ root: directory, cwd: directory, bridgePath });
  worker.on('stderr', () => {});
  const closed = new Promise(resolve => worker.once('exit', resolve));
  const request = worker.request('prompt', {}, { timeoutMs: 5000 });
  const result = await request.then(() => assert.fail('crashed requests must reject'), error => error);
  const exit = await closed;
  assert.match(result.message, /heap memory was exhausted/);
  assert.equal(exit.diagnostic.failureKind, 'heap-exhausted');
  assert.equal(exit.diagnostic.exitCode, 1);
  assert.doesNotMatch(JSON.stringify(exit.diagnostic), /private credentials/);
  console.log('Bridge crash diagnostics: split stderr, bounded retention, secret exclusion, Windows status and real child exit propagation: ok');
} finally {
  worker?.dispose();
  if (dirname(directory) !== resolve(tmpdir()) || !basename(directory).startsWith('zyra-bridge-crash-')) throw new Error('Unexpected diagnostic cleanup path');
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
