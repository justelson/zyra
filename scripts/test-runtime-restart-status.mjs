import assert from 'node:assert/strict';
import { restartReadiness, probeRestart } from './runtime-restart-status.mjs';
import { getAgentServerPaths } from '../src/agent-server/paths.mjs';
import os from 'node:os';
import path from 'node:path';
const options = { stateDirectory: path.join(os.tmpdir(), 'zyra-restart-inspection-fixture'), channel: 'restart-test' };
const paths = getAgentServerPaths(options);
const state = {
  activationVersion: 1, runtimeRevision: 'a'.repeat(64), methods: ['server.status', 'server.retire'],
  instance: { namespaceId: paths.namespaceId, instanceId: 'fixture-instance', channel: paths.channel, protocolVersion: 5,
    runtimeRevision: 'a'.repeat(64), startedAt: new Date().toISOString() },
  activity: { activeTurns: 0, backgroundChats: 0, attention: 0, requests: 0, workspaceRequests: 0, externalTools: 0 },
  token: 'private-fixture', sessions: [{ title: 'private-fixture' }],
};
assert.equal(restartReadiness(state, paths).ready, true, 'a known legacy server may be inspected without being activated');
const legacy = restartReadiness({ ...state, activity: undefined }, paths);
assert.equal(legacy.ready, false, 'unknown legacy activity must never be labelled idle');
assert.equal(legacy.requiresConfirmation, true, 'window-only restart needs an explicit user confirmation for legacy status');
assert.equal(restartReadiness({ ...state, activationVersion: 2, activity: undefined }, paths).requiresConfirmation, undefined, 'malformed modern status has no legacy override');
for (const key of Object.keys(state.activity)) {
  assert.equal(restartReadiness({ ...state, activity: { ...state.activity, [key]: 1 } }, paths).ready, false);
  assert.equal(restartReadiness({ ...state, activity: { ...state.activity, [key]: undefined } }, paths).ready, false);
}
for (const changed of [
  { instance: { ...state.instance, namespaceId: 'other' } }, { instance: { ...state.instance, channel: 'other' } },
  { runtimeRevision: 'b'.repeat(64) }, { activationVersion: 99 }, { activity: null }, { methods: [] },
  { activity: { ...state.activity, futureWork: 1 } }, { activity: { ...state.activity, futureWork: 'unknown' } },
]) assert.equal(restartReadiness({ ...state, ...changed }, paths).ready, false);
let closed = false, calls = 0;
const result = await probeRestart(options, configuration => {
  assert.equal(configuration.autoStart, false);
  assert.equal(configuration.verifyRuntimeRevision, false);
  assert.equal(configuration.heartbeat, false);
  assert.deepEqual(configuration.authorities, []);
  assert.equal(configuration.authorityProof, '');
  return { request: async (method, params) => { calls++; assert.equal(method, 'server.status'); assert.deepEqual(params, { identityOnly: true }); return state; }, close() { closed = true; } };
});
assert.equal(result.ready, true); assert.equal(calls, 1); assert.equal(closed, true);
assert.ok(!JSON.stringify(result).includes('private-fixture'));
const unavailable = await probeRestart(options, () => ({ request() { throw new Error('private-fixture'); }, close() {} }));
assert.equal(unavailable.ready, false); assert.ok(!JSON.stringify(unavailable).includes('private-fixture'));
console.log('Restart inspection: read-only, exact namespace, all blockers/unknowns fail closed, private data omitted');
