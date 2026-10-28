import { randomUUID } from 'node:crypto';
import { AgentServerProtocolError } from './protocol.mjs';
const error = (message, code) => new AgentServerProtocolError(message, code);
export function assertUpdateAuthority(server, client, params) {
  if (!client.canControl) throw error('Only verified Desktop can prepare an agent update.', 'AGENT_SERVER_AUTH_FAILED');
  if (params.expectedInstanceId !== server.instanceId || params.expectedNamespaceId !== server.paths.namespaceId) throw error('The agent changed. Review the update again.', 'AGENT_SERVER_INSTANCE_CHANGED');
}
export async function prepareAgentUpdate(server, client, params) {
  assertUpdateAuthority(server, client, params);
  if (server.updateMaintenance) throw error('Agent update preparation is already running.', 'AGENT_SERVER_UPDATE_PENDING');
  if (!server.listenerCount('retire')) throw error('This agent cannot hand off updates.', 'AGENT_SERVER_UPGRADE_REQUIRED');
  if ([...server.clients.values()].some(other => other !== client && other.updateMaintenanceVersion !== 1)) throw error('Close older connected clients before updating.', 'AGENT_SERVER_UPDATE_LEGACY_CLIENT');
  if (Object.values(server.runtimeActivity()).some(count => count > 0) && params.stopBlockers !== true) throw error('Work is still running. Choose Stop blockers or Later.', 'AGENT_SERVER_UPGRADE_BUSY');
  const lease = { leaseId: randomUUID(), instanceId: server.instanceId, owner: client.connectionId, preparing: true, expiresAt: null };
  server.updateMaintenance = lease;
  server.memoryQueue.pause(params.stopBlockers === true);
  if (server.sessionWorkerPool) server.sessionWorkerPool.paused = true;
  const sessions = [...new Set(server.sessions.values())];
  try {
    const shutdown = async worker => {
      if (!worker) return;
      if (typeof worker.shutdown !== 'function') throw error('A worker cannot confirm safe cleanup.', 'AGENT_SERVER_UPDATE_CLEANUP_REQUIRED');
      await worker.shutdown('Stopped for agent update.');
    };
    for (const session of sessions) session.releaseUserInputContinuations(new Error('Stopped for agent update.'));
    // Control bridges revoke their grants and reject pending actions. They are
    // not model workers and do not own operating-system application processes.
    server.externalTools.dispose();
    const cleanup = await Promise.allSettled([
      ...sessions.filter(session => !session.parentOwner).map(async session => {
        const turnId = session.latestTurn?.state === 'running' ? session.latestTurn.id : null;
        await shutdown(session.worker);
        if (turnId && session.latestTurn?.state === 'running') session.publish({ type: 'zyra_server_turn_completed', turnId, outcome: 'interrupted', interruption: { kind: 'stopped', source: 'user' } });
        if (turnId) server.notifyDesktopWorkspaceTurnEnded(session.sessionKey, turnId);
        for (const view of sessions.filter(value => value.parentOwner === session)) {
          if (view.latestTurn?.state === 'running') view.publish({ type: 'zyra_server_turn_completed', turnId: view.latestTurn.id, outcome: 'interrupted', interruption: { kind: 'stopped', source: 'user' } });
        }
        session.dispose('Stopped for agent update.'); server.removeSession(session);
      }),
      shutdown(server.utilityWorker).then(() => { server.utilityWorker = null; }),
      shutdown(server.sessionWorkerPool?.spare).then(() => { if (server.sessionWorkerPool) server.sessionWorkerPool.spare = null; })
    ]);
    const failure = cleanup.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
    // Existing operations must actually unwind. Clearing a map is not cleanup.
    const deadline = Date.now() + 10_000;
    while (server.pendingRequests > 1 || server.canonicalMessageQueues?.size || server.memoryQueue.active || server.desktopWorkspaceRequests.size || server.appRequests.size || server.externalTools.sessions.size) {
      if (Date.now() >= deadline) throw error('Some work has not stopped. Installation has not started.', 'AGENT_SERVER_UPGRADE_BUSY');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    server.catalog.persist();
    if (client.socket && (!client.socket.writable || client.socket.destroyed)) throw error('The update owner disconnected.', 'AGENT_SERVER_DISCONNECTED');
    lease.preparing = false;
    lease.expiresAt = new Date(Date.now() + 30_000).toISOString();
    lease.timer = setTimeout(() => { if (server.updateMaintenance === lease) releaseAgentUpdate(server); }, 30_000);
    lease.timer.unref?.();
    return { leaseId: lease.leaseId, expiresAt: lease.expiresAt, expectedInstanceId: server.instanceId, expectedNamespaceId: server.paths.namespaceId };
  } catch (failure) { releaseAgentUpdate(server); throw failure; }
}
export function releaseAgentUpdate(server) {
  clearTimeout(server.updateMaintenance?.timer);
  server.updateMaintenance = null;
  server.memoryQueue.resume();
  if (server.sessionWorkerPool) { server.sessionWorkerPool.paused = false; server.sessionWorkerPool.prepare(); }
}
export async function cancelAgentUpdate(server, client, params) {
  const lease = server.updateMaintenance;
  if (!lease) return { cancelled: false };
  if (!client.canControl || lease.owner !== client.connectionId || lease.leaseId !== params.leaseId) throw error('This update belongs to another confirmation.', 'AGENT_SERVER_AUTH_FAILED');
  if (lease.preparing) throw error('Cleanup is still running.', 'AGENT_SERVER_UPDATE_PENDING');
  releaseAgentUpdate(server);
  return { cancelled: true };
}
