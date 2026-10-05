import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentThreadCoordinator } from '../src/agent-server/thread-coordinator.mjs';
import { normalizeAgentRun } from '../src/agents/contracts.mjs';
import { FleetEventStore } from '../src/agents/event-store.mjs';
import { CanonicalChatCatalog } from '../src/agent-server/catalog.mjs';

const directory = await mkdtemp(path.join(tmpdir(), 'zyra-conversation-kind-'));
try {
  const registered = [], views = [], metadata = [];
  const server = { paths: { stateDirectory: directory, namespaceId: 'fixture' },
    catalog: { index: { registerAgentThread: (...args) => registered.push(args), get: () => null }, record: { metadata: {} },
      updateChat: async (...args) => metadata.push(args) },
    ensureAgentView: (_owner, run) => views.push(run.agentRunId), broadcastCatalogChanged() {} };
  const worker = normalizeAgentRun({ fleetId: 'fleet', agentRunId: 'worker', goal: 'Review privately', providerSessionId: 'worker-chat', sessionFile: '/fixture/worker.jsonl' });
  const thread = normalizeAgentRun({ ...worker, agentRunId: 'independent', conversationKind: 'thread', providerSessionId: 'thread-chat' });
  const owner = { sessionKey: 'parent', connectedResult: { project: directory }, latestFleetSnapshot: { agents: { worker, thread } } };
  const coordinator = new AgentThreadCoordinator(server);
  coordinator.registerAgentThreads({ ...owner, latestFleetSnapshot: { agents: { worker } } });
  assert.equal(registered.length, 0, 'Ordinary subagents must not become canonical sidebar chats');
  assert.deepEqual(views, ['worker'], 'Private workers retain an addressable owned view');
  assert.equal(worker.conversationKind, 'subagent');
  assert.equal(thread.conversationKind, 'thread', 'Explicit conversation intent survives normalization');
  const bridgeSource = await readFile(new URL('../src/zyra-ui-bridge.mjs', import.meta.url), 'utf8');
  const projectorBody = bridgeSource.match(/function projectFleetSnapshot\(snapshot\) \{([\s\S]*?)\r?\n\}\r?\n\r?\nfunction summarizeFleetEvent/)[1];
  const projectFleet = new Function('snapshot', projectorBody);
  const projected = projectFleet({ agents: { worker, independent: thread }, workflows: {} });
  assert.equal(projected.agents.worker.conversationKind, 'subagent');
  assert.equal(projected.agents.independent.conversationKind, 'thread', 'The actual worker transport preserves explicit conversation intent');
  coordinator.registerAgentThreads(owner);
  await Promise.resolve();
  assert.equal(registered.length, 1, 'Only the explicit independent thread is registered');
  assert.equal(metadata[0][1].agentConversationKind, 'thread');
  assert.equal(metadata[0][1].agentRunId, 'independent');
  coordinator.registerAgentThreads(owner);
  assert.equal(registered.length, 1, 'Repeated fleet events cannot duplicate sidebar entries');

  const store = new FleetEventStore({ project: directory, rootSessionId: 'parent', fleetId: 'fleet', rootThreadId: 'root-thread' });
  await store.initialize();
  for (const run of [worker, thread]) await store.append('agent.created', { agent: run }, { agentRunId: run.agentRunId, flush: true });
  await store.append('agent.state.changed', { status: 'completed' }, { agentRunId: thread.agentRunId, flush: true });
  await store.flush();
  const restored = new FleetEventStore({ project: directory, rootSessionId: 'parent', fleetId: 'fleet', rootThreadId: 'root-thread' });
  await restored.initialize();
  assert.equal(restored.getSnapshot().agents.worker.conversationKind, 'subagent');
  assert.equal(restored.getSnapshot().agents.independent.conversationKind, 'thread', 'State transitions and durable restore preserve classification');
  await restored.flush();

  // Existing polluted index records remain readable, but only real threads list.
  const legacyThreadId = 'thread-' + 'a'.repeat(64);
  const legacyAgents = {
    worker: { agentRunId: 'worker', providerSessionId: 'legacy-worker' },
    explicit: { agentRunId: legacyThreadId, providerSessionId: 'legacy-thread' }
  };
  await writeFile(path.join(directory, '.zyra/agent-runs/parent/fleet.snapshot.json'), JSON.stringify({ agents: legacyAgents }));
  const chats = ['root', 'legacy-worker', 'legacy-thread', 'current-thread'].map((canonicalChatId, i) => ({ canonicalChatId, project: directory, storageProject: directory, sessionPath: path.join(directory, canonicalChatId + '.jsonl'), modifiedAt: new Date(i * 1000).toISOString(), title: canonicalChatId, agentThread: i !== 0 }));
  const index = { listProjects: async () => chats, get: id => chats.find(chat => chat.canonicalChatId === id), update() {} };
  const catalog = new CanonicalChatCatalog({ stateDirectory: path.join(directory, 'catalog'), index });
  for (const id of ['legacy-worker', 'legacy-thread']) catalog.record.metadata[id] = { agentCreatedBy: 'parent' };
  catalog.record.metadata['current-thread'] = { agentCreatedBy: 'parent', agentConversationKind: 'thread', agentRunId: 'independent' };
  const listed = await catalog.list({ project: directory });
  assert.deepEqual(listed.map(chat => chat.canonicalChatId).sort(), ['current-thread', 'legacy-thread', 'root'], 'Catalog repairs legacy worker promotion without hiding legacy explicit threads');
  assert.equal((await catalog.find('legacy-worker', { project: directory })).canonicalChatId, 'legacy-worker', 'Filtering never deletes private transcript history');
  assert.equal((await catalog.list({ project: directory, includeSubagents: true })).length, 4, 'Explicit history readers can access retained worker records');
  const reopenedCatalog = new CanonicalChatCatalog({ stateDirectory: path.join(directory, 'catalog'), index });
  assert.deepEqual((await reopenedCatalog.list({ project: directory })).map(chat => chat.canonicalChatId).sort(), listed.map(chat => chat.canonicalChatId).sort(), 'Catalog restart preserves classification and legacy recovery');
  console.log('Agent conversation kinds: private registration, durable store, explicit threads and legacy catalog recovery passed');
} finally { await rm(directory, { recursive: true, force: true }); }
