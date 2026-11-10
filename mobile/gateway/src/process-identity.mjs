import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const commandOptions = { encoding: 'utf8', timeout: 5000, maxBuffer: 16384, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] };
let clockTicks, ownIdentity, preparing;
const execFileAsync = promisify(execFile);
const windowsQuery = pid => ({
  shell: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
  // Direct CLR access avoids loading PowerShell's Management/Utility cmdlets
  // for one immutable OS birth stamp. Keep the exact ticks used by old locks.
  script: `$s=[System.Diagnostics.Process]::GetProcessById(${pid}).StartTime.ToUniversalTime();$c=[System.Globalization.CultureInfo]::InvariantCulture;[Console]::Out.Write('{"id":"windows:'+$s.Ticks.ToString($c)+'","startedAtMs":'+([DateTimeOffset]$s).ToUnixTimeMilliseconds().ToString($c)+'}')`
});
const parseWindowsIdentity = stdout => {
  const value = JSON.parse(stdout.trim());
  return typeof value.id === 'string' && Number.isFinite(value.startedAtMs) ? value : null;
};

/** Prime immutable self metadata without blocking Desktop's main thread. */
export async function prepareHostProcessIdentity() {
  if (ownIdentity) return;
  const request = preparing ||= (async () => {
    if (process.platform !== 'win32') { const value = readNativeIdentity(process.pid); ownIdentity = value ? Object.freeze(value) : null; return; }
    try {
      const { shell, script } = windowsQuery(process.pid);
      const { stdout } = await execFileAsync(shell, ['-NoProfile', '-NonInteractive', '-Command', script], { ...commandOptions, timeout: 15000 });
      const value = parseWindowsIdentity(stdout);
      ownIdentity = value ? Object.freeze(value) : null;
    } catch { ownIdentity = null; }
  })();
  try { await request; } finally { if (preparing === request) preparing = undefined; }
}

/** Public OS process metadata only. Unknown identity must never authorize takeover. */
export function readProcessIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  if (pid === process.pid && ownIdentity !== undefined) return ownIdentity;
  const value = readNativeIdentity(pid);
  if (pid === process.pid) ownIdentity = value ? Object.freeze(value) : null;
  return value;
}

function readNativeIdentity(pid) {
  try {
    if (process.platform === 'win32') {
      const { shell, script } = windowsQuery(pid);
      return parseWindowsIdentity(execFileSync(shell, ['-NoProfile', '-NonInteractive', '-Command', script], commandOptions));
    }
    if (process.platform === 'linux') {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const ticks = Number(stat.slice(stat.lastIndexOf(')') + 2).split(/\s+/)[19]);
      const boot = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
      const bootSeconds = Number(readFileSync('/proc/stat', 'utf8').match(/^btime (\d+)$/m)?.[1]);
      clockTicks ??= Number(execFileSync('getconf', ['CLK_TCK'], commandOptions).trim());
      if (!Number.isFinite(ticks) || !Number.isFinite(bootSeconds) || !(clockTicks > 0)) return null;
      return { id: `linux:${boot}:${ticks}`, startedAtMs: bootSeconds * 1000 + ticks * 1000 / clockTicks };
    }
    if (process.platform === 'darwin') {
      const start = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { ...commandOptions, env: { ...process.env, LC_ALL: 'C' } }).trim();
      const startedAtMs = Date.parse(start);
      return start && Number.isFinite(startedAtMs) ? { id: `darwin:${start}`, startedAtMs } : null;
    }
  } catch { /* Access denied, missing tools and process exit all remain unknown. */ }
  return null;
}
