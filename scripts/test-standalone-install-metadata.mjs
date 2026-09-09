import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { getStandaloneInstallMetadata, STANDALONE_WINDOWS_ICON_RESOURCE } from '../src/standalone-install-metadata.mjs';
import { runZyraStandalone } from '../src/standalone-entry.mjs';
import { isZyraVersionRequest } from '../src/version.mjs';

const root = path.resolve(import.meta.dirname, '..');
const icon = fs.readFileSync(path.join(root, 'desktop/resources/icon.ico'));
const distribution = { version: '0.6.1', hash: 'a'.repeat(64), resources: { [STANDALONE_WINDOWS_ICON_RESOURCE]: icon.toString('base64') } };
const metadata = getStandaloneInstallMetadata(distribution);
assert.equal(metadata.format, 1);
assert.equal(metadata.version, distribution.version);
assert.deepEqual(Buffer.from(metadata.windowsIconBase64, 'base64'), icon, 'installer gets the exact Desktop ICO, including every optical-size frame');
assert.throws(() => getStandaloneInstallMetadata({ version: '0.6.1', resources: {} }), /missing|invalid/);
assert.throws(() => getStandaloneInstallMetadata({ ...distribution, resources: { [STANDALONE_WINDOWS_ICON_RESOURCE]: 'not base64!' } }), /invalid/);
const corrupt = Buffer.from(icon); corrupt.writeUInt32LE(0xffffffff, 18);
assert.throws(() => getStandaloneInstallMetadata({ ...distribution, resources: { [STANDALONE_WINDOWS_ICON_RESOURCE]: corrupt.toString('base64') } }), /frame/);
const oldArgv = process.argv;
const oldWrite = process.stdout.write;
const original = {};
const beforeEnv = { ...process.env };
let output = '';
try {
  for (const name of ['readFileSync', 'mkdirSync', 'writeFileSync', 'renameSync', 'rmSync']) {
    original[name] = fs[name];
    fs[name] = () => { throw Error('Installer metadata must not access user files'); };
  }
  syncBuiltinESMExports();
  process.argv = [process.execPath, 'standalone-fixture', '--version'];
  process.env.ZYRA_INSTALL_METADATA = '1';
  assert.equal(isZyraVersionRequest(process.argv.slice(2)), true, 'legacy binaries must recognize the exact same argv as a version request');
  assert.equal(isZyraVersionRequest(['--version', '--install-metadata']), false, 'extra flags would escape the legacy version-only path');
  process.stdout.write = (value) => { output += String(value); return true; };
  await runZyraStandalone(distribution);
} finally {
  Object.assign(fs, original); syncBuiltinESMExports();
  process.argv = oldArgv; process.stdout.write = oldWrite;
  if (beforeEnv.ZYRA_INSTALL_METADATA === undefined) delete process.env.ZYRA_INSTALL_METADATA;
  else process.env.ZYRA_INSTALL_METADATA = beforeEnv.ZYRA_INSTALL_METADATA;
}
assert.deepEqual(JSON.parse(output), metadata);
assert.deepEqual({ ...process.env }, beforeEnv, 'metadata probing does not change runtime/profile environment');
const build = fs.readFileSync(path.join(root, 'scripts/build-tui-release.mjs'), 'utf8');
assert.match(build, /windowsIcon = path\.join\(root, "desktop", "resources", "icon\.ico"\)/);
assert.ok(build.includes('`--windows-icon=${windowsIcon}`'));
assert.ok(build.includes('relativePath: STANDALONE_WINDOWS_ICON_RESOURCE, content: await readFile(windowsIcon)'));
const installer = fs.readFileSync(path.join(root, 'install.ps1'), 'utf8');
assert.ok(installer.includes('$Executable --version | Out-String'), 'older releases receive exactly one safe version argument');
assert.ok(installer.includes("$env:ZYRA_INSTALL_METADATA = '1'"));
assert.ok(installer.includes("SetEnvironmentVariable('ZYRA_INSTALL_METADATA', $previousMetadataMode, 'Process')"), 'installer restores the parent environment');
assert.ok(installer.includes('NoTerminalIntegration'));
assert.ok(installer.includes('Microsoft\\Windows Terminal\\Fragments\\Zyra'));
assert.ok(installer.includes("icon = 'zyra.ico'"));
assert.ok(installer.includes("$shortcut.IconLocation = $IconPath + ',0'"));
assert.doesNotMatch(installer, /(?:Set-Content|WriteAllText|WriteAllBytes)[^\r\n]*settings\.json/i, 'user Terminal settings remain untouched');
console.log('Standalone install metadata: exact shared ICO, no runtime/user-data startup, packaging and integration contract: ok');
