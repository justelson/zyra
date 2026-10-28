import { existsSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readRuntimeRevision } from './runtime-revision.mjs';
const rootKey = root => {
  let resolved = path.resolve(root);
  try { resolved = realpathSync.native(resolved); }
  catch { try { resolved = path.join(realpathSync.native(path.dirname(resolved)), path.basename(resolved)); } catch {} }
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};
const file = paths => {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(paths.channel)) throw new Error('Invalid update namespace.');
  return path.join(paths.stateDirectory, `install-handoff-${paths.channel}.json`);
};
function save(paths, value) {
  const temporary = `${file(paths)}.${randomUUID()}.tmp`;
  try { writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 }); renameSync(temporary, file(paths)); }
  finally { rmSync(temporary, { force: true }); }
}
export const installSuccessFile = (paths, version) => path.join(paths.stateDirectory, `install-success-${version}.flag`);
export function recordInstallHandoff(paths, root, lease, targetVersion, revision, receiptNonce = lease.leaseId) {
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(targetVersion || '')) throw new Error('A target update version is required.');
  if (!/^[a-f0-9{}-]{36,38}$/i.test(receiptNonce)) throw new Error('The installation receipt is invalid.');
  rmSync(installSuccessFile(paths, targetVersion), { force: true });
  save(paths, { version: 1, prepared: true, instanceId: lease.instanceId, pid: process.pid, leaseId: lease.leaseId, namespaceId: paths.namespaceId, root: rootKey(root), targetVersion, revision, receiptNonce, requiresReceipt: process.platform === 'win32' });
}
export function clearInstallHandoff(paths, leaseId) {
  try { const saved = JSON.parse(readFileSync(file(paths), 'utf8')); if (saved.leaseId === leaseId && saved.namespaceId === paths.namespaceId) rmSync(file(paths), { force: true }); } catch {}
}
const processIsAlive = pid => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
};
/** A durable completed-cleanup receipt can repair files without starting a model. */
export function readStoppedInstallHandoff(paths, root, alive = processIsAlive) {
  try {
    const saved = JSON.parse(readFileSync(file(paths), 'utf8'));
    if (saved.version !== 1 || saved.prepared !== true || saved.namespaceId !== paths.namespaceId || saved.root !== rootKey(root)
      || typeof saved.instanceId !== 'string' || !saved.instanceId || typeof saved.requiresReceipt !== 'boolean'
      || typeof saved.targetVersion !== 'string' || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(saved.targetVersion)
      || !/^[a-f0-9-]{36}$/i.test(saved.leaseId) || !/^[a-f0-9]{64}$/.test(saved.revision) || alive(saved.pid)) return null;
    for (const name of readdirSync(paths.stateDirectory).filter(name => name.startsWith('agent-server-v') && name.endsWith(`-${paths.channel}.json`))) {
      if (alive(JSON.parse(readFileSync(path.join(paths.stateDirectory, name), 'utf8')).pid)) return null;
    }
    return saved;
  } catch { return null; }
}
export function renewStoppedInstallHandoff(paths, root, input, alive = processIsAlive) {
  const prior = readStoppedInstallHandoff(paths, root, alive);
  if (!prior || prior.instanceId !== input.expectedInstanceId || prior.namespaceId !== input.expectedNamespaceId) throw new Error('A running agent or changed update receipt blocks repair.');
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(input.targetVersion) || !/^[a-f0-9{}-]{36,38}$/i.test(input.operationId || '')) throw new Error('Review this repair before continuing.');
  rmSync(installSuccessFile(paths, input.targetVersion), { force: true });
  save(paths, { ...prior, targetVersion: input.targetVersion, receiptNonce: input.operationId });
  return prior;
}
export function restoreStoppedInstallHandoff(paths, prior, receiptNonce) {
  try {
    const current = JSON.parse(readFileSync(file(paths), 'utf8'));
    if (current.namespaceId === paths.namespaceId && current.leaseId === prior.leaseId && current.receiptNonce === receiptNonce) save(paths, prior);
  } catch { /* Keep the guard closed on an unknown/failed rollback. */ }
}
export async function inspectInstallRecovery(paths, root) {
  try {
    const saved = JSON.parse(readFileSync(file(paths), 'utf8'));
    if (saved.version === 1 && saved.namespaceId === paths.namespaceId && saved.root === rootKey(root) && /^[a-f0-9]{64}$/.test(saved.revision) && /^[0-9a-zA-Z.-]+$/.test(saved.targetVersion) && await readRuntimeRevision(root) === saved.revision) return { targetVersion: saved.targetVersion, leaseId: saved.leaseId };
  } catch {}
  return null;
}
export async function recoverInstallHandoff(paths, root) {
  const saved = await inspectInstallRecovery(paths, root);
  if (!saved) throw new Error('The previous agent cannot be verified. Repair the installation first.');
  clearInstallHandoff(paths, saved.leaseId);
  return saved.targetVersion;
}
export async function assertRuntimeStartAllowed(paths, root) {
  if (!existsSync(file(paths))) return;
  try {
    const saved = JSON.parse(readFileSync(file(paths), 'utf8'));
    if (saved.version !== 1 || saved.namespaceId !== paths.namespaceId || saved.root !== rootKey(root)) throw new Error('Unknown update handoff');
    const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
    const proof = existsSync(installSuccessFile(paths, saved.targetVersion)) ? readFileSync(installSuccessFile(paths, saved.targetVersion), 'utf8') : null;
    const receipt = !saved.requiresReceipt || proof === saved.receiptNonce || proof === 'bootstrap-complete';
    const currentRevision = await readRuntimeRevision(root);
    if (receipt && version === saved.targetVersion && currentRevision && (currentRevision !== saved.revision || saved.requiresReceipt && proof === saved.receiptNonce)) { rmSync(file(paths), { force: true }); return; }
  } catch {}
  throw Object.assign(new Error('Installation is pending. The old agent will not restart.'), { code: 'AGENT_SERVER_INSTALL_PENDING' });
}
