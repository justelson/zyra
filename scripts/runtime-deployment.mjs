import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RUNTIME_ACTIVATION_VERSION } from '../src/agent-server/runtime-revision.mjs';

const revision = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null;
const namespace = value => typeof value === 'string' && /^[a-f0-9]{20}$/.test(value) ? value : null;
const instance = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value) ? value : null;
const channelName = value => typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value) ? value : null;
const compare = (a, b) => !a || !b ? 'unknown' : a === b ? 'verified' : 'mismatch';

/** Allowlisted observation, never an attestation of source/build/install/acceptance. */
export function createDeploymentReport({ desiredRevision, expectedRevision, expectedNamespaceId, channel, observation, now }) {
  const desired = revision(desiredRevision), expected = revision(expectedRevision);
  const status = observation?.status, identity = status?.instance;
  const actual = revision(status?.runtimeRevision), actualNamespace = namespace(identity?.namespaceId);
  const actualInstance = instance(identity?.instanceId), actualChannel = channelName(identity?.channel);
  const age = Date.parse(now) - Date.parse(observation?.observedAt);
  const connected = observation?.confirmed === true;
  const fresh = connected && Number.isFinite(age) && age >= 0 && age <= 5000;
  const versionMatches = status?.activationVersion === RUNTIME_ACTIVATION_VERSION;
  const checks = {
    rootMatch: compare(desired, actual),
    expectationMatch: expectedRevision == null ? 'not_requested' : compare(expected, desired),
    namespaceMatch: compare(namespace(expectedNamespaceId), actualNamespace),
    channelMatch: compare(channelName(channel), actualChannel),
    identityRevisionMatch: compare(actual, revision(identity?.runtimeRevision)),
  };
  const values = Object.values(checks);
  const state = !connected ? 'disconnected' : !versionMatches ? 'unknown' : values.includes('mismatch') ? 'mismatch'
    : fresh && actualInstance && values.every(value => value === 'verified' || value === 'not_requested') ? 'verified' : 'unknown';
  return {
    schemaVersion: 1, observedAt: fresh ? observation.observedAt : null,
    runtime: { state, connection: connected ? fresh ? 'fresh' : 'stale' : 'disconnected',
      fingerprintVersion: RUNTIME_ACTIVATION_VERSION, observedFingerprintVersion: Number.isSafeInteger(status?.activationVersion) ? status.activationVersion : null,
      desiredRevision: desired, expectedRevision: expected, actualRevision: actual, ...checks,
      namespaceId: actualNamespace, instanceId: actualInstance, channel: actualChannel,
      clientCount: fresh && Number.isSafeInteger(status?.clients) && status.clients >= 0 ? status.clients : null },
    stages: { sourceFixed: 'unknown', buildProduced: 'unknown', appInstalled: 'unknown', serverActive: state, bugVerified: 'unknown' },
  };
}

export const HELP = `Usage: node scripts/runtime-deployment.mjs --runtime-root <root> --state-directory <directory> --channel <channel> [--expected-runtime-revision <64-hex>]
Read-only fresh runtime inspection. Never starts, retires, restarts, attaches or cancels work.
Paths and raw errors are omitted. Matching runtime code does not prove source fix, build, installation or bug acceptance.
Client count includes this inspector. No active-work count is inferred.
Exit: 0 runtime verified; 1 disconnected/mismatch/unknown; 2 invalid arguments.
`;

export function parseArgs(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return { help: true };
  const names = new Map([['--runtime-root', 'root'], ['--state-directory', 'stateDirectory'], ['--channel', 'channel'], ['--expected-runtime-revision', 'expectedRevision']]);
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    const name = names.get(args[i]), value = args[i + 1];
    if (!name || name in result || !value || value.startsWith('-')) throw new Error('Invalid arguments');
    result[name] = value;
  }
  if (!result.root || !result.stateDirectory || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(result.channel || '')
    || result.expectedRevision && !revision(result.expectedRevision)) throw new Error('Invalid arguments');
  result.channel = result.channel.toLowerCase();
  return result;
}

export async function inspectDeployment(options) {
  const [{ readRuntimeRevision }, { ZyraAgentServerClient }, { getAgentServerPaths }] = await Promise.all([
    import('../src/agent-server/runtime-revision.mjs'), import('../src/agent-server/client.mjs'), import('../src/agent-server/paths.mjs'),
  ]);
  const root = path.resolve(options.root), paths = getAgentServerPaths(options);
  let desiredRevision = null;
  try { desiredRevision = await readRuntimeRevision(root); } catch { /* Unreadable files remain unknown. */ }
  const client = new ZyraAgentServerClient({ root, stateDirectory: paths.stateDirectory, channel: paths.channel,
    autoStart: false, verifyRuntimeRevision: false, requiredMethods: ['server.status'], heartbeat: false,
    surface: 'runtime-inspection', authorities: [], authorityProof: '' });
  let observation = null;
  try {
    const status = await client.request('server.status', { identityOnly: true }, { timeoutMs: 5000 });
    observation = { confirmed: true, observedAt: new Date().toISOString(), status };
  } catch { /* No successful observation cannot verify runtime. */ }
  finally { client.close(); }
  return createDeploymentReport({ desiredRevision, expectedRevision: options.expectedRevision,
    expectedNamespaceId: paths.namespaceId, channel: paths.channel, observation, now: new Date().toISOString() });
}

async function main() {
  let options;
  try { options = parseArgs(process.argv.slice(2)); }
  catch { console.log(JSON.stringify({ schemaVersion: 1, error: 'INVALID_ARGUMENTS' })); process.exitCode = 2; return; }
  if (options.help) { process.stdout.write(HELP); return; }
  try {
    const report = await inspectDeployment(options);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.runtime.state === 'verified' ? 0 : 1;
  } catch { console.log(JSON.stringify({ schemaVersion: 1, error: 'INSPECTION_UNAVAILABLE' })); process.exitCode = 1; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
