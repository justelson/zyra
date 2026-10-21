const CONNECTIONS = new Set(["connecting", "connected", "disconnected"]);

export function projectAgentServerInstance(server) {
  const value = server?.instance && typeof server.instance === "object" ? server.instance : server;
  if (!value || typeof value !== "object") return null;
  const instanceId = string(value.instanceId, 128);
  const namespaceId = string(value.namespaceId, 128);
  const channel = string(value.channel, 64);
  const protocolVersion = Number(value.protocolVersion ?? value.version);
  const runtimeRevision = typeof value.runtimeRevision === 'string' && /^[a-f0-9]{64}$/.test(value.runtimeRevision) ? value.runtimeRevision : null;
  const startedAt = string(value.startedAt, 64);
  if (!/^[a-zA-Z0-9:_-]+$/.test(instanceId) || !/^[a-zA-Z0-9:_-]+$/.test(namespaceId)
    || !/^[a-zA-Z0-9._-]+$/.test(channel) || !Number.isInteger(protocolVersion) || !Number.isFinite(Date.parse(startedAt))) return null;
  return Object.freeze({ instanceId, namespaceId, channel, protocolVersion, runtimeRevision, startedAt });
}

export function projectRuntimeActivity(value) {
  const keys = ['activeTurns', 'backgroundChats', 'attention', 'requests', 'workspaceRequests', 'externalTools'];
  if (!value || typeof value !== 'object' || keys.some(key => !Number.isSafeInteger(value[key]) || value[key] < 0)) return null;
  return Object.freeze(Object.fromEntries(keys.map(key => [key, value[key]])));
}

export function createConnectionStatus({ phase, connection, instance = null, errorCode, lastConfirmedAt, updatePending, expectedRuntimeRevision, activity } = {}) {
  const normalizedConnection = CONNECTIONS.has(connection) ? connection : "disconnected";
  const status = {
    phase: String(phase || normalizedConnection),
    connection: normalizedConnection,
    instance: projectAgentServerInstance(instance),
    lastConfirmedAt: typeof lastConfirmedAt === "string" ? lastConfirmedAt : null,
  };
  if (typeof errorCode === "string" && /^[A-Z0-9_]{1,96}$/.test(errorCode)) status.errorCode = errorCode;
  if (updatePending === true) status.updatePending = true;
  if (typeof expectedRuntimeRevision === 'string' && /^[a-f0-9]{64}$/.test(expectedRuntimeRevision)) status.expectedRuntimeRevision = expectedRuntimeRevision;
  const observedActivity = projectRuntimeActivity(activity);
  if (observedActivity) status.activity = observedActivity;
  return Object.freeze(status);
}

function string(value, maximum) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized && normalized.length <= maximum ? normalized : "";
}
