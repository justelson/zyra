import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { desktopTuiPaths, installDesktopTui, readDesktopTuiPackage } from '../src/desktop-tui-install.mjs';

const directory = path.resolve(process.argv[2] || 'desktop/.release/zyra-tui');
const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
const temporary = await mkdtemp(path.join(os.tmpdir(), 'zyra-native-update-'));
let child;
try {
  const home = path.join(temporary, 'Home Ω! with spaces');
  const env = { ...process.env, USERPROFILE: home, HOME: home, APPDATA: path.join(home, 'Roaming'), LOCALAPPDATA: path.join(home, 'Local'), XDG_CONFIG_HOME: path.join(home, 'Config') };
  for (const key of Object.keys(env)) if (key.startsWith('ZYRA_')) delete env[key];
  delete env.NODE_OPTIONS; delete env.ELECTRON_RUN_AS_NODE; delete env.ZYRA_INSTALL_METADATA;
  const options = { channel: manifest.channel, version: manifest.version, home, env };
  const paths = desktopTuiPaths(options);
  await mkdir(path.dirname(paths.command), { recursive: true });
  // Exercise the installed command, including Unicode account paths and a
  // previously managed launcher. Never read a provider, chat or real profile.
  const legacy = process.platform === 'win32' ? '@echo off\r\nrem zyra-desktop-managed-launcher:v1\r\nexit /b 0\r\n' : '#!/bin/sh\n# zyra-desktop-managed-launcher:v1\nexit 0\n';
  if (manifest.channel === 'stable') await writeFile(paths.command, legacy);
  const verified = await readDesktopTuiPackage(directory, options);
  const installed = await installDesktopTui({ ...options, directory });
  assert(installed.installed);
  const invoke = command => {
    const start = performance.now();
    const result = process.platform === 'win32' && command.endsWith('.cmd')
      ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${command}" --version"`], { env, encoding: 'utf8', windowsVerbatimArguments: true, windowsHide: true, timeout: 30000 })
      : spawnSync(command, ['--version'], { env, encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert(result.stdout.includes(manifest.version), result.stdout);
    return Math.round((performance.now() - start) * 100) / 100;
  };
  const firstDirect = invoke(verified.file), firstInstalled = invoke(paths.command);
  const direct = [], launcher = [];
  for (let i = 0; i < 7; i++) { direct.push(invoke(verified.file)); launcher.push(invoke(paths.command)); }
  const median = values => [...values].sort((a,b) => a-b)[Math.floor(values.length / 2)];
  const overhead = median(launcher) - median(direct);
  assert(overhead <= Math.max(150, median(direct) * .5), `Unexpected launcher overhead: ${overhead} ms`);
  // Hold the real compiled process, then update with a second verified payload
  // identity. The old executable and its process must survive installation.
  child = spawn(installed.executable, ['--internal-agent-bridge'], { env: { ...env, ZYRA_DESKTOP_TUI_PAYLOAD: path.dirname(installed.executable) }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  await once(child, 'spawn'); child.stdout.resume(); child.stderr.resume();
  const lease = path.join(path.dirname(installed.executable), 'leases', `${child.pid}.json`);
  for (let i=0;i<300;i++) { try { await lstat(lease); break; } catch { await new Promise(resolve=>setTimeout(resolve,100)); } }
  assert((await lstat(lease)).isFile(), 'compiled terminal did not register its live-version lease');
  assert.equal(child.exitCode, null);
  const alternate = path.join(temporary, 'next-package'); await mkdir(alternate);
  const { copyFile } = await import('node:fs/promises');
  const nextManifest = { ...manifest, version: `${manifest.version.split('-')[0]}-dev.65534` };
  for (const binary of manifest.binaries) await copyFile(path.join(directory, binary.file), path.join(alternate, binary.file));
  await writeFile(path.join(alternate, 'manifest.json'), JSON.stringify(nextManifest));
  const next = await installDesktopTui({ ...options, version: nextManifest.version, directory: alternate });
  assert(next.installed); assert.equal(child.exitCode, null); assert((await lstat(installed.executable)).isFile());
  // This synthetic next manifest tests replacement/retention only. Its binary
  // is intentionally the original version and is not claimed as another build.
  const exited = once(child, 'exit'); child.kill(); await exited; child = null;
  await installDesktopTui({ ...options, version: nextManifest.version, directory: alternate });
  await assert.rejects(lstat(installed.executable), { code: 'ENOENT' });
  const timings = { platform: process.platform, arch: process.arch, version: manifest.version, measurement: 'version-command process startup; first invocation is not an OS cold-cache measurement', firstDirectMs: firstDirect, firstInstalledMs: firstInstalled, directWarmMs: direct, installedWarmMs: launcher, medianOverheadMs: Math.round(overhead * 100) / 100 };
  const output = process.env.ZYRA_TUI_TIMING_OUTPUT;
  if (output) await writeFile(output, `${JSON.stringify(timings, null, 2)}\n`);
  console.log(JSON.stringify(timings));
  console.log('PASS native compiled payload, actual owned launcher, Unicode paths, live old process, atomic update and post-exit cleanup');
} finally {
  if (child) { const done = once(child, 'exit'); child.kill(); await done; }
  assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
  await rm(temporary, { recursive: true, force: true });
}
