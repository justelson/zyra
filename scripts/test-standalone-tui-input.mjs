import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { stripVTControlCharacters } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { isolateBridgeEnvironment, fixtureModel } from './fixtures/agent-server-bridge-env.mjs';

const binary = path.resolve(process.argv[2] || '');
assert.ok(existsSync(binary), 'Pass the compiled TUI binary path.');
const require = createRequire(new URL('../desktop/package.json', import.meta.url));
const pty = require('node-pty');
const temporary = mkdtempSync(path.join(os.tmpdir(), 'zyra-tui-input-'));
const isolation = isolateBridgeEnvironment(temporary);
const requests = [];
const fixtureServer = createServer((request, response) => {
  requests.push({ method: request.method, path: request.url });
  response.writeHead(500, { 'Content-Type': 'application/json' });
  response.end('{"error":"This input fixture must not generate model responses"}');
});
let child;
let exited = false;
let exitCode;
let output = '';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const text = () => stripVTControlCharacters(output);
async function waitUntil(predicate, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    if (exited) throw Error(`TUI exited before ${label}: ${exitCode}\n${text().slice(-5000)}`);
    await delay(50);
  }
  throw Error(`Timed out waiting for ${label}\n${text().slice(-5000)}`);
}
try {
  await new Promise(resolve => fixtureServer.listen(0, '127.0.0.1', resolve));
  const modelsPath = path.join(process.env.PI_CODING_AGENT_DIR, 'models.json');
  const models = JSON.parse(readFileSync(modelsPath, 'utf8'));
  models.providers['zyra-offline-fixture'].baseUrl = `http://127.0.0.1:${fixtureServer.address().port}/v1`;
  writeFileSync(modelsPath, JSON.stringify(models));
  const env = { ...process.env, ZYRA_CALLER_CWD: temporary, ZYRA_EMBEDDED_RUNTIME: '1', TERM: 'xterm-256color', FORCE_COLOR: '1' };
  // The compiled Bun binary does not use Node preload hooks. Its only configured
  // provider is this local tripwire, and the test submits no model prompt.
  delete env.NODE_OPTIONS;
  child = pty.spawn(binary, ['--no-onboarding', '--no-session', '--model', fixtureModel, '--thinking', 'low'], {
    cwd: temporary, env, cols: 120, rows: 32, name: 'xterm-256color',
  });
  child.onData(chunk => { output = (output + chunk).slice(-2_000_000); });
  child.onExit(event => { exited = true; exitCode = event.exitCode; });
  await waitUntil(() => text().includes(fixtureModel), 'fresh-session UI');
  child.write('/models ');
  await waitUntil(() => text().includes('type provider/model'), 'model picker');
  child.write('\x1b[B'); await delay(100);
  child.write('\x1b[A'); await delay(100);
  child.write('\t');
  await waitUntil(() => text().includes(`/models ${fixtureModel}`), 'applied model selection');
  assert.ok(!text().includes('query is not defined'), 'model selection must not throw in the compiled TUI');
  child.write('\x15'); await delay(100);
  child.write('/access sup');
  await waitUntil(() => text().includes('supervised'), 'permission suggestions');
  child.write('\t');
  await waitUntil(() => text().includes('/access supervised'), 'applied permission selection');
  assert.ok(!text().includes('query is not defined'), 'permission selection must not throw in the compiled TUI');
  child.write('\x15'); await delay(100);
  child.write('/quit'); await delay(350); child.write('\r');
  await waitUntil(() => exited, 'clean TUI exit', 30_000);
  assert.equal(exitCode, 0);
  assert.deepEqual(requests, [], 'picker interaction must never send a provider request');
  isolation.assertOffline();
} finally {
  if (child) {
    if (exited && process.platform === 'win32') {
      // Pinned node-pty 1.1.0 retains its socket worker after natural exit.
      // Calling kill/destroy now starts a PID-based console lookup after the
      // shell is gone. Release only our Node I/O resources instead.
      const agent = child._agent;
      assert.equal(typeof agent?._conoutSocketWorker?.dispose, 'function', 'Update the test cleanup adapter when node-pty changes');
      agent._conoutSocketWorker.dispose();
      agent._inSocket?.destroy();
      agent._outSocket?.destroy();
    } else {
      child.destroy();
      const deadline = Date.now() + 5000;
      while (!exited && Date.now() < deadline) await delay(50);
    }
  }
  await new Promise(resolve => fixtureServer.close(resolve));
  isolation.restore();
  rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
console.log('Compiled TUI fresh input: model/permission picker navigation and Tab selection, no query error, no provider calls, clean exit: ok');
