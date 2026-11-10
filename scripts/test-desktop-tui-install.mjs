import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, lstat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { desktopTuiPaths, installDesktopTui, removeDesktopTui, readDesktopTuiPackage } from '../src/desktop-tui-install.mjs';

const temporary = await mkdtemp(path.join(os.tmpdir(), 'zyra-desktop-terminal-'));
async function fixture(name, platform = process.platform) {
  const home = path.join(temporary, name, 'Home with spaces Ω!');
  const env = { APPDATA: path.join(home, 'Roaming'), LOCALAPPDATA: path.join(home, 'Local'), XDG_CONFIG_HOME: path.join(home, 'Config') };
  const options = { home, env, platform, arch: 'x64', channel: 'preview' };
  const directory = path.join(temporary, name, 'package'); await mkdir(directory, { recursive: true });
  async function pack(version, contents = `native payload ${version}`) {
    const bytes = Buffer.from(contents), file = `zyra-${platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macos' : 'linux'}-x64${platform === 'win32' ? '.exe' : ''}`;
    await writeFile(path.join(directory, file), bytes);
    await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ schemaVersion: 1, channel: 'preview', version, binaries: [{ platform, arch: 'x64', file, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }] }));
  }
  await pack('0.7.1-dev.1');
  return { home, options, directory, paths: desktopTuiPaths(options), pack };
}
let running;
try {
  for (const platform of ['win32', 'darwin', 'linux']) {
    const f = await fixture(platform, platform);
    await mkdir(path.dirname(f.paths.command), { recursive: true });
    const legacy = `${platform === 'win32' ? '@echo off\r\nrem' : '#!/bin/sh\n#'} zyra-development-launcher:v1\noriginal source checkout command\n`;
    await writeFile(f.paths.command, legacy);
    const stable = desktopTuiPaths({ ...f.options, channel: 'stable' }).command;
    await writeFile(stable, 'untouched stable command');
    const first = await installDesktopTui({ ...f.options, directory: f.directory, version: '0.7.1-dev.1' });
    assert(first.installed);
    assert.equal(first.namespace.channel, 'desktop');
    assert.equal(first.namespace.stateDirectory, path.join(f.paths.appData, 'Zyra-dev', 'assistant', 'agent-server'));
    assert.equal(await readFile(stable, 'utf8'), 'untouched stable command');
    const source = f.paths.command.replace(/(?:\.cmd)?$/, platform === 'win32' ? '-source.cmd' : '-source');
    assert.equal(await readFile(source, 'utf8'), legacy, 'source command remains explicitly usable');
    const launcher = await readFile(f.paths.command, 'utf8');
    assert(!launcher.includes('node.exe') && !launcher.includes('--tui') && !launcher.includes('powershell'), 'steady-state launch does not start Desktop or a secondary runtime');
    assert(launcher.includes(platform === 'win32' ? 'if defined ZYRA_STATE_DIR' : 'if [ -z "${ZYRA_STATE_DIR:-}" ]'), 'explicit namespace overrides remain honored');
    if (platform === 'win32') { assert(launcher.includes('%~dp0')); assert(!launcher.includes('Ω')); }
    assert.equal((await installDesktopTui({ ...f.options, directory: f.directory })).executable, first.executable);
    await f.pack('0.7.1-dev.2');
    const next = await installDesktopTui({ ...f.options, directory: f.directory });
    assert.notEqual(next.executable, first.executable);
    await assert.rejects(lstat(first.executable), { code: 'ENOENT' });
    assert.deepEqual(next.namespace, first.namespace);
    assert.deepEqual(await removeDesktopTui({ ...f.options, version: '0.7.1-dev.1' }), { removed: false });
    assert((await removeDesktopTui({ ...f.options, version: '0.7.1-dev.2' })).removed);
    assert.equal(await readFile(f.paths.command, 'utf8'), legacy);
    assert.equal(await readFile(stable, 'utf8'), 'untouched stable command');
  }
  const standalone = await fixture('standalone');
  const stableOptions = { ...standalone.options, channel: 'stable' };
  const stablePaths = desktopTuiPaths(stableOptions);
  const stableManifestFile = path.join(standalone.directory, 'manifest.json');
  const stableManifest = JSON.parse(await readFile(stableManifestFile, 'utf8')); stableManifest.channel = 'stable'; await writeFile(stableManifestFile, JSON.stringify(stableManifest));
  await mkdir(path.dirname(stablePaths.command), { recursive: true });
  await writeFile(stablePaths.command, '# zyra-standalone-launcher:v2\noriginal standalone');
  await mkdir(path.join(standalone.home, '.zyra'), { recursive: true });
  const preferences = path.join(standalone.home, '.zyra', 'preferences.json'); await writeFile(preferences, '{"speed":"fast"}');
  const migrated = await installDesktopTui({ ...stableOptions, directory: standalone.directory });
  assert.equal(migrated.namespace.stateDirectory, path.join(standalone.home, '.zyra')); assert.equal(migrated.namespace.channel, 'default');
  assert.equal(await readFile(preferences, 'utf8'), '{"speed":"fast"}');
  assert.deepEqual(await removeDesktopTui({ ...stableOptions, directory: path.join(temporary, 'different-install') }), { removed: false });
  const custom = await fixture('custom');
  await mkdir(path.dirname(custom.paths.command), { recursive: true }); await writeFile(custom.paths.command, 'custom launcher');
  assert.equal((await installDesktopTui({ ...custom.options, directory: custom.directory })).reason, 'unmanaged');
  assert.equal(await readFile(custom.paths.command, 'utf8'), 'custom launcher');
  await installDesktopTui({ ...custom.options, directory: custom.directory, publishCommand: false });
  assert.equal(await readFile(custom.paths.command, 'utf8'), 'custom launcher');
  const tampered = await fixture('tampered');
  const metadata = JSON.parse(await readFile(path.join(tampered.directory, 'manifest.json'), 'utf8'));
  await writeFile(path.join(tampered.directory, metadata.binaries[0].file), 'corrupt');
  await assert.rejects(installDesktopTui({ ...tampered.options, directory: tampered.directory }), /checksum/);
  await assert.rejects(lstat(tampered.paths.command), { code: 'ENOENT' });
  metadata.binaries[0].file = '../escape'; await writeFile(path.join(tampered.directory, 'manifest.json'), JSON.stringify(metadata));
  await assert.rejects(readDesktopTuiPackage(tampered.directory, tampered.options), /missing/);
  const live = await fixture('live');
  const old = await installDesktopTui({ ...live.options, directory: live.directory });
  running = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore', windowsHide: true });
  await once(running, 'spawn');
  await mkdir(path.join(path.dirname(old.executable), 'leases')); await writeFile(path.join(path.dirname(old.executable), 'leases', `${running.pid}.json`), JSON.stringify({ pid: running.pid }));
  await live.pack('0.7.1-dev.2'); const newer = await installDesktopTui({ ...live.options, directory: live.directory });
  assert((await lstat(old.executable)).isFile(), 'a live old terminal is retained across update');
  const exited = once(running, 'exit'); running.kill(); await exited; running = null;
  await installDesktopTui({ ...live.options, directory: live.directory });
  await assert.rejects(lstat(old.executable), { code: 'ENOENT' });
  assert((await lstat(newer.executable)).isFile());
  console.log('Desktop/TUI migration: Stable/Dev isolation, preserved namespaces/source command/custom launchers, verified immutable payloads, live-process retention, cleanup and uninstall passed');
} finally {
  running?.kill();
  assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
  await rm(temporary, { recursive: true, force: true });
}
