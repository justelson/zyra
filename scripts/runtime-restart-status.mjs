import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ZyraAgentServerClient } from '../src/agent-server/client.mjs';
import { getAgentServerPaths } from '../src/agent-server/paths.mjs';
import { projectAgentServerInstance, projectRuntimeActivity } from '../src/agent-server/connection-status.mjs';

export function restartReadiness(state, paths, now = new Date().toISOString()) {
  const instance = projectAgentServerInstance(state), activity = projectRuntimeActivity(state?.activity);
  const identified = instance?.namespaceId === paths.namespaceId && instance?.channel === paths.channel
    && instance?.runtimeRevision === state?.runtimeRevision && /^[a-f0-9]{64}$/.test(instance?.runtimeRevision || '')
    && [1, 2].includes(state?.activationVersion) && state?.methods?.includes('server.retire');
  const known = identified && activity && Object.values(state.activity).every(count => Number.isSafeInteger(count) && count >= 0);
  const ready = Boolean(known && Object.values(state.activity).every(count => count === 0));
  const legacy = Boolean(identified && state.activationVersion === 1 && state.activity === undefined);
  return { schemaVersion: 1, ready, reason: legacy ? 'legacy-activity-unavailable' : !known ? 'unknown' : ready ? 'idle' : 'busy', observedAt: now,
    ...(legacy ? { requiresConfirmation: true } : {}),
    ...(identified ? { instanceId: instance.instanceId, namespaceId: instance.namespaceId } : {}),
    ...(known ? { activity } : {}) };
}

export async function probeRestart(options, createClient = options => new ZyraAgentServerClient(options)) {
  const paths = getAgentServerPaths(options);
  const client = createClient({ ...options, stateDirectory: paths.stateDirectory, channel: paths.channel,
    autoStart: false, verifyRuntimeRevision: false, heartbeat: false, requiredMethods: ['server.status'],
    surface: 'restart-inspection', authorities: [], authorityProof: '' });
  try {
    return restartReadiness(await client.request('server.status', { identityOnly: true }, { timeoutMs: 5000 }), paths);
  } catch {
    return { schemaVersion: 1, ready: false, reason: 'unavailable', observedAt: new Date().toISOString() };
  } finally { client.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [stateDirectory, channel] = process.argv.slice(2);
  if (!stateDirectory || !path.isAbsolute(stateDirectory) || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(channel || '') || process.argv.length !== 4) {
    console.log(JSON.stringify({ schemaVersion: 1, ready: false, reason: 'invalid-arguments' }));
    process.exitCode = 2;
  } else console.log(JSON.stringify(await probeRestart({ stateDirectory, channel })));
}
