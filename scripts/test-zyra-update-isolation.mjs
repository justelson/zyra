import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync(new URL('../src/zyra-app.mjs', import.meta.url), 'utf8');
const start = source.indexOf('async function runUpdate()');
const end = source.indexOf('\nfunction printDoctor(', start);
assert.ok(start >= 0 && end > start);
const body = source.slice(start, end);
for (const noPathUpdate of [undefined, '1', 'true']) {
  const calls = [];
  const exit = new Error('fixture exit');
  const env = { ZYRA_UPDATE_SOURCE_DIRECTORY: 'C:/fixture/release', ...(noPathUpdate ? { ZYRA_UPDATE_NO_PATH_UPDATE: noPathUpdate } : {}) };
  const run = new Function('deps', `const { process, path, os, defaults, copyFileSync, rmSync, spawnSync, shutdownCliAnalytics, console } = deps; ${body}; return runUpdate;`)({
    process: { env, platform: 'win32', pid: 42, chdir() {}, exit(code) { assert.equal(code, 0); throw exit; } },
    path: path.win32, os: { tmpdir: () => 'C:/fixture/tmp' }, defaults: { root: 'C:/fixture/runtime' },
    copyFileSync() {}, rmSync() { calls.push('cleanup'); },
    spawnSync(command, args) { calls.push({ command, args }); return { status: 0 }; },
    shutdownCliAnalytics: async () => {}, console: { log() {} },
  });
  await assert.rejects(run(), (error) => error === exit);
  assert.equal(calls[0].command, 'powershell.exe');
  assert.equal(calls[0].args.includes('-NoPathUpdate'), noPathUpdate === '1', 'only the explicit isolation flag suppresses the persistent user PATH update');
  assert.ok(calls[0].args.includes('-SourceDirectory'));
  assert.equal(calls[1], 'cleanup');
}
const smoke = readFileSync(new URL('./test-standalone-tui-binary.mjs', import.meta.url), 'utf8');
for (const setting of ['ZYRA_DATA_ROOT: temporaryRoot', 'ZYRA_CALLER_CWD: temporaryRoot', 'ZYRA_DISTRIBUTION: "standalone"', 'ZYRA_UPDATE_NO_PATH_UPDATE: "1"', 'ZYRA_ANALYTICS_ENABLED: "0"']) {
  assert.ok(smoke.includes(setting), `Standalone smoke must isolate ${setting}`);
}
assert.ok(smoke.includes('const binary = path.join(temporaryRoot, path.basename(sourceBinary))'));
assert.ok(smoke.includes('copyFileSync(sourceBinary, binary)'), 'standalone smoke runs a copied binary outside the checkout');
const installer = readFileSync(new URL('../install.ps1', import.meta.url), 'utf8');
assert.ok(installer.indexOf('if ($NoPathUpdate) { return }') < installer.indexOf('[Environment]::SetEnvironmentVariable("Path"'), 'the opt-out precedes persistent PATH mutation');
console.log('Standalone updater smoke isolation and unchanged normal PATH behavior: ok');
