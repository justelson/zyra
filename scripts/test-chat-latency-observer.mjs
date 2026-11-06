import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const directory = mkdtempSync(path.join(os.tmpdir(), 'zyra-latency-observer-'));
try {
  const adapter = path.join(directory, 'src/runtime/providers/src/api'); mkdirSync(adapter, { recursive: true });
  writeFileSync(path.join(directory, 'package.json'), '{"type":"module"}');
  writeFileSync(path.join(adapter, 'openai-codex-responses.js'), `export function getOpenAICodexRequestDiagnostics(id) {
    if (id !== 'private-session') throw Error('wrong session');
    return [{ startedAt:100, firstTextMs:42, account:'private-account', prompt:'private-prompt',
      output:2, transport:'websocket', outcome:'stop' }];
  }`);
  const destination = path.join(directory, 'measurements.jsonl');
  const protocol = { type: 'response', ok: true, result: { providerThreadId: 'private-session' } };
  const result = spawnSync(process.execPath, ['--import', pathToFileURL(path.join(import.meta.dirname,
    'response-latency/observe-provider.mjs')).href, '--input-type=module', '-e',
    `process.stdout.write(${JSON.stringify(JSON.stringify(protocol).slice(0, 12))});
     process.stdout.write(${JSON.stringify(JSON.stringify(protocol).slice(12) + '\n')});
     await new Promise(resolve => setTimeout(resolve, 500));`], {
    env: { ...process.env, ZYRA_ROOT: directory, ZYRA_LATENCY_OBSERVATIONS: destination }, encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, JSON.stringify(protocol) + '\n', 'observer preserves the exact split protocol output');
  const observations = readFileSync(destination, 'utf8');
  assert.equal(observations.includes('private'), false, 'no session, account, prompt or response identity is written');
  const row = JSON.parse(observations.trim().split('\n').at(-1));
  assert.equal(row.requests[0].firstTextMs, 42); assert.ok(row.rssBytes > 0);
  assert.equal(observations.trim().split('\n').length, 1, 'unchanged requests are not rewritten by RSS polling');
  console.log('Production-adapter observer preserves protocol output and records allowlisted measurements only.');
} finally {
  // Delete only this mkdtemp-owned fixture, never a user profile or runtime.
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(directory).startsWith('zyra-latency-observer-'));
  rmSync(directory, { recursive: true, force: true });
}
