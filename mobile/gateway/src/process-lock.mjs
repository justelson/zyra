import { mkdirSync, openSync, writeFileSync, closeSync, readFileSync, unlinkSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { readProcessIdentity } from './process-identity.mjs';

export function acquireHostLock(directory, { readIdentity = readProcessIdentity } = {}) {
  const inspect = pid => {
    try {
      const value = readIdentity(pid);
      return value && typeof value.id === 'string' && value.id.length > 0 && Number.isFinite(value.startedAtMs) ? value : null;
    } catch { return null; }
  };
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, 'host.lock');
  let identity, fd;
  try { fd = openSync(file, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let existing, original;
    try { original = readFileSync(file, 'utf8'); existing = JSON.parse(original); } catch { throw new Error('Mobile host lock is incomplete. Check that no other mobile host is running before removing host.lock.'); }
    if (!existing || !Number.isSafeInteger(existing.pid) || existing.pid <= 0) throw new Error('Invalid mobile host lock.');
    if (existing.processIdentity !== undefined && (typeof existing.processIdentity !== 'string' || !existing.processIdentity.trim())) throw new Error('Invalid mobile host lock.');
    let alive = true;
    try { process.kill(existing.pid, 0); }
    catch (probe) { if (probe.code !== 'ESRCH') throw probe; alive = false; }
    if (alive) {
      const owner = inspect(existing.pid);
      // Legacy locks have only a PID. A newer process birth proves that PID was recycled.
      const stale = owner && (typeof existing.processIdentity === 'string'
        ? owner.id !== existing.processIdentity
        : owner.startedAtMs > statSync(file).mtimeMs + 1000);
      if (!stale) throw new Error('Mobile access is already running for this profile.');
    }
    // Never remove a changed lock or terminate the process whose PID was recycled.
    if (readFileSync(file, 'utf8') !== original) throw new Error('Mobile host ownership changed. Try again.');
    unlinkSync(file); fd = openSync(file, 'wx', 0o600);
  }
  try {
    const owner = inspect(process.pid);
    identity = JSON.stringify({ pid: process.pid, nonce: randomUUID(), ...(owner ? { processIdentity: owner.id } : {}) });
    writeFileSync(fd, identity);
  } finally { closeSync(fd); }
  return () => {
    try { if (readFileSync(file, 'utf8') === identity) unlinkSync(file); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  };
}
