import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, utimesSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireHostLock } from '../src/process-lock.mjs';
import { prepareHostProcessIdentity, readProcessIdentity } from '../src/process-identity.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

function fixture(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'zyra-mobile-lock-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, file: path.join(directory, 'host.lock') };
}
const current = { id: 'current-process-generation', startedAtMs: Date.now() - 1000 };
const options = { readIdentity: () => current };

test('a recycled live PID does not block a different process generation', t => {
  const { directory, file } = fixture(t);
  writeFileSync(file, JSON.stringify({ pid: process.pid, nonce: 'previous-host', processIdentity: 'previous-process-generation' }));
  const release = acquireHostLock(directory, options);
  assert.equal(JSON.parse(readFileSync(file)).processIdentity, current.id);
  release(); assert.equal(existsSync(file), false);
});
test('legacy PID-only locks are recovered only when the process began after the lock', t => {
  const { directory, file } = fixture(t);
  writeFileSync(file, JSON.stringify({ pid: process.pid, nonce: 'legacy' }));
  const old = new Date(current.startedAtMs - 10000); utimesSync(file, old, old);
  const release = acquireHostLock(directory, options); release();
  writeFileSync(file, JSON.stringify({ pid: process.pid, nonce: 'active-legacy' }));
  assert.throws(() => acquireHostLock(directory, options), /already running/);
});
test('matching owners and uninspectable live processes remain protected', t => {
  const { directory, file } = fixture(t);
  const release = acquireHostLock(directory, options);
  const original = readFileSync(file, 'utf8');
  assert.throws(() => acquireHostLock(directory, options), /already running/);
  assert.throws(() => acquireHostLock(directory, { readIdentity: () => null }), /already running/);
  assert.throws(() => acquireHostLock(directory, { readIdentity: () => { throw Error('access denied'); } }), /already running/);
  assert.equal(readFileSync(file, 'utf8'), original); release();
});
test('a changed lock cannot be removed during stale-owner inspection', t => {
  const { directory, file } = fixture(t);
  writeFileSync(file, JSON.stringify({ pid: process.pid, nonce: 'old', processIdentity: 'old' }));
  const replacement = JSON.stringify({ pid: process.pid, nonce: 'replacement', processIdentity: current.id });
  assert.throws(() => acquireHostLock(directory, { readIdentity: () => { writeFileSync(file, replacement); return current; } }), /ownership changed/);
  assert.equal(readFileSync(file, 'utf8'), replacement);
});
test('malformed generation metadata is not permission to take over a live owner', t => {
  const { directory, file } = fixture(t);
  for (const processIdentity of ['', ' ', 123]) {
    const original = JSON.stringify({ pid: process.pid, nonce: 'owner', processIdentity });
    writeFileSync(file, original);
    assert.throws(() => acquireHostLock(directory, options), /Invalid/);
    assert.equal(readFileSync(file, 'utf8'), original);
  }
});
test('native process generation is stable and predates this check', async () => {
  await prepareHostProcessIdentity();
  const first = readProcessIdentity(process.pid);
  assert.ok(first && first.id && first.startedAtMs > 0 && first.startedAtMs <= Date.now());
  assert.deepEqual(readProcessIdentity(process.pid), first);
});
test('Desktop prepares native Windows identity without blocking the event loop', { skip: process.platform !== 'win32' }, async () => {
  const moduleUrl = new URL('../src/process-identity.mjs', import.meta.url).href;
  const script = `import assert from 'node:assert/strict'; import {prepareHostProcessIdentity,readProcessIdentity} from ${JSON.stringify(moduleUrl)}; let responsive=false; const ready=prepareHostProcessIdentity(); setImmediate(()=>responsive=true); await ready; assert.ok(responsive,'OS query must yield to the event loop'); const value=readProcessIdentity(process.pid); assert.ok(value?.id.startsWith('windows:')); assert.ok(value.startedAtMs<=Date.now());`;
  await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], { timeout: 25000, windowsHide: true });
});
test('releasing an earlier owner preserves a replacement lock', t => {
  const { directory, file } = fixture(t);
  const release = acquireHostLock(directory, options);
  const replacement = JSON.stringify({ pid: process.pid, nonce: 'replacement' });
  writeFileSync(file, replacement); release(); assert.equal(readFileSync(file, 'utf8'), replacement);
});
