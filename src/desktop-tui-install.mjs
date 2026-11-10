import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const MARKER = 'zyra-desktop-terminal:v2:';
const VERSION = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/;
const CHANNELS = new Set(['stable', 'preview']);
export function desktopTuiPaths({ channel, platform = process.platform, home = os.homedir(), env = process.env } = {}) {
  if (!CHANNELS.has(channel)) throw new Error('Unknown Desktop terminal channel.');
  const local = platform === 'win32' ? env.LOCALAPPDATA || path.join(home, 'AppData', 'Local') : path.join(home, '.local', 'share');
  const appData = platform === 'win32' ? env.APPDATA || path.join(home, 'AppData', 'Roaming') : platform === 'darwin' ? path.join(home, 'Library', 'Application Support') : env.XDG_CONFIG_HOME || path.join(home, '.config');
  return {
    channel, platform, home, appData,
    cache: path.join(local, 'Zyra', 'terminal', channel),
    command: path.join(platform === 'win32' ? path.join(local, 'Zyra', 'bin') : path.join(home, '.local', 'bin'), `${channel === 'preview' ? 'zyra-dev' : 'zyra'}${platform === 'win32' ? '.cmd' : ''}`)
  };
}
export function desktopTuiLauncherOwner(contents, channel) {
  const markers = [...contents.matchAll(/^(?:rem|#) ([a-z0-9:-]+)\r?$/gm)].map(match => match[1]);
  if (markers.includes(`${MARKER}${channel}`)) return 'current';
  if (channel === 'preview' && markers.includes('zyra-development-launcher:v1')) return 'source';
  if (channel === 'stable' && markers.includes('zyra-desktop-managed-launcher:v1')) return 'desktop';
  if (channel === 'stable' && markers.some(marker => ['zyra-managed-launcher:v1', 'zyra-standalone-launcher:v2'].includes(marker))) return 'standalone';
  return null;
}
async function text(file) { try { return await readFile(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
async function plain(file) { const info = await lstat(file); if (!info.isFile() || info.isSymbolicLink()) throw new Error('Expected a regular terminal payload file.'); return info; }
async function hash(file) { const digest = createHash('sha256'); for await (const bytes of createReadStream(file)) digest.update(bytes); return digest.digest('hex'); }
async function atomic(file, bytes) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.next-${randomUUID()}`;
  try { await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 }); await rename(temporary, file); }
  finally { await rm(temporary, { force: true }); }
}
export async function readDesktopTuiPackage(directory, { channel, platform = process.platform, arch = process.arch, version } = {}) {
  await plain(path.join(directory, 'manifest.json'));
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || !VERSION.test(manifest.version) || !CHANNELS.has(manifest.channel)
    || channel && manifest.channel !== channel || version && manifest.version !== version) throw new Error('Desktop/TUI package identity mismatch.');
  const entry = manifest.binaries?.find(value => value.platform === platform && value.arch === arch);
  if (!entry || !/^zyra-(?:windows|macos|linux)-(?:x64|arm64)(?:\.exe)?$/.test(entry.file) || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Matching native terminal payload is missing.');
  const file = path.join(directory, entry.file);
  if ((await plain(file)).size !== entry.size || await hash(file) !== entry.sha256) throw new Error('Desktop terminal payload checksum mismatch.');
  return { manifest, entry, file };
}
/** Ordinary Desktop startup needs only the trusted package identity and file
 * size. Installation and upgrades perform full checksum verification once. */
export async function desktopTuiNeedsUpdate(directory, options) {
  try {
    const paths = desktopTuiPaths(options);
    const installed = JSON.parse(await readFile(path.join(paths.cache, 'installed.json'), 'utf8'));
    const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
    const entry = manifest.binaries.find(value => value.platform === paths.platform && value.arch === (options.arch || process.arch));
    const expected = path.join(paths.cache, 'versions', `${manifest.version}-${entry.sha256.slice(0, 12)}`, entry.file);
    return manifest.version !== options.version || manifest.channel !== options.channel || installed.version !== manifest.version || installed.sha256 !== entry.sha256
      || installed.executable !== expected || (await plain(expected)).size !== entry.size;
  } catch { return true; }
}
function initialNamespace(paths, kind, contents) {
  if (kind === 'source') return { stateDirectory: path.join(paths.appData, 'Zyra-dev', 'assistant', 'agent-server'), channel: 'desktop' };
  if (kind === 'standalone') return { stateDirectory: path.join(paths.home, '.zyra'), channel: 'default' };
  // Preserve an explicit namespace in an older Desktop-owned Windows launcher.
  const oldChannel = contents?.match(/^set "ZYRA_AGENT_SERVER_CHANNEL=([^"\r\n]+)"\r?$/m)?.[1];
  const oldState = contents?.match(/^set "ZYRA_STATE_DIR=([^"\r\n]+)"\r?$/m)?.[1];
  const expand = value => value.replace(/%USERPROFILE%/gi, paths.home).replace(/%APPDATA%/gi, paths.appData).replace(/%%/g, '%');
  return { stateDirectory: oldState ? expand(oldState) : path.join(paths.appData, paths.channel === 'preview' ? 'Zyra Preview' : 'Zyra', 'assistant', 'agent-server'), channel: oldChannel || 'desktop' };
}
export function desktopTuiLauncher(paths, registration) {
  const executable = registration.executable;
  if (paths.platform === 'win32') {
    const quote = value => { if (/["\r\n]/.test(value)) throw new Error('Invalid terminal launcher path.'); return value.replaceAll('%', '%%'); };
    const stateRelative = path.relative(paths.appData, registration.namespace.stateDirectory);
    const state = !stateRelative.startsWith('..') && !path.isAbsolute(stateRelative)
      ? `%APPDATA%\\${quote(stateRelative)}` : registration.namespace.stateDirectory === path.join(paths.home, '.zyra') ? '%USERPROFILE%\\.zyra' : quote(registration.namespace.stateDirectory);
    // Relative executable paths and environment roots preserve Unicode Windows
    // account names without changing the user's console code page on each launch.
    const binary = `%~dp0${quote(path.relative(path.dirname(paths.command), executable))}`;
    const payload = `%~dp0${quote(path.relative(path.dirname(paths.command), path.dirname(executable)))}`;
    return `@echo off\r\nrem ${MARKER}${paths.channel}\r\nsetlocal DisableDelayedExpansion\r\nset "ZYRA_STATE_DIR=${state}"\r\nset "ZYRA_AGENT_SERVER_CHANNEL=${registration.namespace.channel}"\r\nset "ZYRA_DATA_ROOT=%USERPROFILE%"\r\nset "ZYRA_DESKTOP_TUI_PAYLOAD=${payload}"\r\nset "ZYRA_DESKTOP_TUI_SOURCE_NAMESPACE=${registration.sourceNamespace ? '1' : ''}"\r\nset "ZYRA_DISTRIBUTION=desktop-bundle"\r\nset "ELECTRON_RUN_AS_NODE="\r\n"${binary}" %*\r\nexit /b %ERRORLEVEL%\r\n`;
  }
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
  return `#!/bin/sh\n# ${MARKER}${paths.channel}\nunset ELECTRON_RUN_AS_NODE\nexport ZYRA_STATE_DIR=${quote(registration.namespace.stateDirectory)}\nexport ZYRA_AGENT_SERVER_CHANNEL=${quote(registration.namespace.channel)}\nexport ZYRA_DATA_ROOT=${quote(paths.home)}\nexport ZYRA_DESKTOP_TUI_PAYLOAD=${quote(path.dirname(executable))}\nexport ZYRA_DESKTOP_TUI_SOURCE_NAMESPACE=${registration.sourceNamespace ? '1' : '0'}\nexport ZYRA_DISTRIBUTION=desktop-bundle\nexec ${quote(executable)} "$@"\n`;
}
export async function installDesktopTui({ directory, publishCommand = true, namespace: explicitNamespace, ...options }) {
  const paths = desktopTuiPaths(options);
  const current = await text(paths.command), kind = current === null ? null : desktopTuiLauncherOwner(current, paths.channel);
  if (current !== null && (await lstat(paths.command)).isSymbolicLink()) return { installed: false, reason: 'unmanaged', path: paths.command };
  if (publishCommand && current !== null && !kind) return { installed: false, reason: 'unmanaged', path: paths.command };
  const verified = await readDesktopTuiPackage(directory, options);
  const registrationFile = path.join(paths.cache, 'installed.json');
  let previous;
  try { previous = JSON.parse(await readFile(registrationFile, 'utf8')); } catch {}
  if (kind === 'current' && (!previous || previous.channel !== paths.channel || !previous.namespace)) throw new Error('Terminal registration needs repair; its data namespace was preserved.');
  const namespace = (kind === 'source' || kind === 'standalone' ? initialNamespace(paths, kind, current) : null) || (kind === 'current' && previous?.channel === paths.channel && typeof previous.namespace?.stateDirectory === 'string'
    ? previous.namespace : explicitNamespace || initialNamespace(paths, kind, current));
  if (!path.isAbsolute(namespace.stateDirectory) || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(namespace.channel)) throw new Error('Invalid terminal namespace.');
  const versionName = `${verified.manifest.version}-${verified.entry.sha256.slice(0, 12)}`;
  const payload = path.join(paths.cache, 'versions', versionName);
  for (const candidate of [paths.cache, path.join(paths.cache, 'versions')]) {
    await mkdir(candidate, { recursive: true, mode: 0o700 });
    if ((await lstat(candidate)).isSymbolicLink()) throw new Error('Terminal cache cannot be a symbolic link.');
  }
  await mkdir(payload, { recursive: true, mode: 0o700 });
  if ((await lstat(payload)).isSymbolicLink()) throw new Error('Terminal cache cannot be a symbolic link.');
  const executable = path.join(payload, verified.entry.file);
  let same = false;
  try { same = (await plain(executable)).size === verified.entry.size && await hash(executable) === verified.entry.sha256; } catch {}
  if (!same) {
    const temporary = `${executable}.next-${randomUUID()}`;
    try { await copyFile(verified.file, temporary); if (await hash(temporary) !== verified.entry.sha256) throw new Error('Terminal payload changed during installation.'); if (paths.platform !== 'win32') await chmod(temporary, 0o755); await rename(temporary, executable); }
    finally { await rm(temporary, { force: true }); }
  }
  const registration = { schemaVersion: 1, channel: paths.channel, version: verified.manifest.version, sha256: verified.entry.sha256, executable, namespace,
    ownerDirectory: path.resolve(directory), sourceNamespace: kind === 'source' || kind === 'current' && previous.sourceNamespace === true };
  if (!publishCommand) return { installed: true, path: paths.command, ...registration };
  if (kind === 'source') {
    const source = paths.command.replace(/(?:\.cmd)?$/, paths.platform === 'win32' ? '-source.cmd' : '-source');
    if (await text(source) === null) { await atomic(source, current); if (paths.platform !== 'win32') await chmod(source, 0o755); }
  }
  if (kind === 'source' || kind === 'standalone') {
    await atomic(path.join(paths.cache, 'previous-launcher'), current);
  }
  // Publish the new command only after its complete, verified payload exists.
  await atomic(registrationFile, JSON.stringify(registration));
  await atomic(paths.command, desktopTuiLauncher(paths, registration));
  if (paths.platform !== 'win32') await chmod(paths.command, 0o755);
  await pruneDesktopTui(paths, versionName);
  return { installed: true, path: paths.command, ...registration };
}
export async function pruneDesktopTui(paths, currentVersion) {
  const root = path.resolve(paths.cache, 'versions');
  for (const name of await readdir(root).catch(() => [])) {
    if (name === currentVersion || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?-[a-f0-9]{12}$/.test(name)) continue;
    const directory = path.resolve(root, name);
    if (path.dirname(directory) !== root || (await lstat(directory)).isSymbolicLink()) continue;
    let keep = false;
    const leases = path.join(directory, 'leases');
    for (const file of await readdir(leases).catch(error => { if (error.code === 'ENOENT') return []; keep = true; return []; })) {
      try {
        const record = JSON.parse(await readFile(path.join(leases, file), 'utf8'));
        if (!Number.isSafeInteger(record.pid) || record.pid < 1) { keep = true; break; }
        try { process.kill(record.pid, 0); keep = true; } catch (error) { if (error.code !== 'ESRCH') keep = true; }
      } catch { keep = true; }
    }
    if (!keep) await rm(directory, { recursive: true, force: true }).catch(() => {}); // Windows also refuses a still-locked executable.
  }
}
export async function removeDesktopTui(options) {
  const paths = desktopTuiPaths(options), current = await text(paths.command);
  if (current === null || desktopTuiLauncherOwner(current, paths.channel) !== 'current') return { removed: false };
  // A later installation at a different location must retain its command.
  const registrationFile = path.join(paths.cache, 'installed.json');
  const registration = JSON.parse(await readFile(registrationFile, 'utf8'));
  if (options.version && registration.version !== options.version) return { removed: false };
  const normalize = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  if (options.directory && (!registration.ownerDirectory || normalize(options.directory) !== normalize(registration.ownerDirectory))) return { removed: false };
  const previous = await text(path.join(paths.cache, 'previous-launcher'));
  if (previous) { await atomic(paths.command, previous); if (paths.platform !== 'win32') await chmod(paths.command, 0o755); }
  else await rm(paths.command, { force: true });
  await rm(registrationFile, { force: true });
  await pruneDesktopTui(paths, null);
  return { removed: true };
}
