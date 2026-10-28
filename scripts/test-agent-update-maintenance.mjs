import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { prepareAgentUpdate, cancelAgentUpdate } from '../src/agent-server/update-maintenance.mjs';
const client = { canControl: true, connectionId: 'desktop-a' };
let exits = 0, released = 0, resolveExit;
const worker = { shutdown: async () => { await new Promise(resolve => { resolveExit = resolve }); exits++; }, dispose() {} };
const session = { worker, latestTurn: { id: 'turn-a', state: 'running' }, releaseUserInputContinuations() {}, dispose() {}, publish(event) { this.latestTurn = { ...this.latestTurn, state: event.outcome } } };
const server = Object.assign(new EventEmitter(), { instanceId: 'instance-a', paths: { namespaceId: 'namespace-a' }, clients: new Map(), pendingRequests: 1,
    sessions: new Map([['chat-a', session]]), memoryQueue: { active: null, pause() {}, resume() { released++ } }, sessionWorkerPool: null,
    externalTools: { sessions: new Map(), dispose() {} }, desktopWorkspaceRequests: new Map(), appRequests: new Map(),
    catalog: { persist() {} }, runtimeActivity() { return { activeTurns: this.sessions.size, requests: 0 } },
    removeSession(value) { for (const [key, item] of this.sessions) if (value === item) this.sessions.delete(key) }, notifyDesktopWorkspaceTurnEnded() {} });
server.on('retire', () => {});
const input = { expectedInstanceId: server.instanceId, expectedNamespaceId: server.paths.namespaceId, stopBlockers: true };
await assert.rejects(prepareAgentUpdate(server, { ...client, canControl: false }, input), { code: 'AGENT_SERVER_AUTH_FAILED' });
await assert.rejects(prepareAgentUpdate(server, client, { ...input, expectedInstanceId: 'changed' }), { code: 'AGENT_SERVER_INSTANCE_CHANGED' });
await assert.rejects(prepareAgentUpdate(server, client, { ...input, stopBlockers: false }), { code: 'AGENT_SERVER_UPGRADE_BUSY' });
assert.equal(exits, 0);
const pending = prepareAgentUpdate(server, client, input);
await new Promise(resolve => setTimeout(resolve, 0));
assert.ok(server.updateMaintenance, 'admission closes before awaiting shutdown');
assert.equal(session.latestTurn.state, 'running', 'requesting shutdown is not proof work stopped');
await assert.rejects(prepareAgentUpdate(server, client, input), { code: 'AGENT_SERVER_UPDATE_PENDING' });
resolveExit(); const prepared = await pending;
assert.equal(exits, 1); assert.equal(session.latestTurn.state, 'interrupted'); assert.equal(server.sessions.size, 0);
await assert.rejects(cancelAgentUpdate(server, { ...client, connectionId: 'other' }, prepared), { code: 'AGENT_SERVER_AUTH_FAILED' });
await cancelAgentUpdate(server, client, prepared); assert.equal(server.updateMaintenance, null); assert.ok(released > 0);
console.log('PASS scoped maintenance authority, identity, consent, admission freeze, awaited shutdown and reversible lease');
