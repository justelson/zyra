export const AGENT_SERVER_PROTOCOL_VERSION = 5;
// Prompt images are already bounded to 12 inputs and roughly 28 MiB of base64 each.
// The local pipe preserves that existing contract; event writes still fail in isolation below.
export const MAX_AGENT_SERVER_MESSAGE_BYTES = 384 * 1024 * 1024;
export const MAX_AGENT_SERVER_REPLAY_EVENTS = 512;

const METHOD_NAMES = new Set([
  "server.status",
  "runtime.models",
  "runtime.generateText",
  "desktop.workspace.open",
  "auth.refresh",
  "catalog.registerProject",
  "catalog.list",
  "catalog.get",
  "catalog.history",
  "catalog.entry.body",
  "catalog.tool-output.search",
  "catalog.update",
  "catalog.message.append",
  "catalog.message.find",
  "session.attach",
  "session.pluginAuthority",
  "session.request",
  "session.detach",
  "session.stop",
]);

const IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,191}$/;

export class AgentServerProtocolError extends Error {
  constructor(message, code = "AGENT_SERVER_PROTOCOL_ERROR") {
    super(message);
    this.name = "AgentServerProtocolError";
    this.code = code;
  }
}

export function assertAgentServerIdentifier(value, label = "identifier") {
  const normalized = String(value || "");
  if (!IDENTIFIER_PATTERN.test(normalized)) throw new AgentServerProtocolError(`${label} is invalid.`);
  return normalized;
}

export function assertAgentServerMethod(value) {
  const method = String(value || "");
  if (!METHOD_NAMES.has(method)) throw new AgentServerProtocolError(`Unknown agent-server method: ${method || "missing"}.`);
  return method;
}

export function assertAgentServerMessageSize(value) {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_AGENT_SERVER_MESSAGE_BYTES) {
    throw new AgentServerProtocolError("Agent-server message exceeds the size limit.", "AGENT_SERVER_MESSAGE_TOO_LARGE");
  }
}

export function writeAgentServerMessage(stream, value) {
  assertAgentServerMessageSize(value);
  if (!stream?.writable) return false;
  return stream.write(`${JSON.stringify(value)}\n`);
}

export function createAgentServerLineReader(stream, onMessage, onError) {
  let buffer = "";
  const handleData = (chunk) => {
    buffer += String(chunk);
    if (Buffer.byteLength(buffer, "utf8") > MAX_AGENT_SERVER_MESSAGE_BYTES + 65_536) {
      onError?.(new AgentServerProtocolError("Agent-server input buffer exceeded its limit.", "AGENT_SERVER_MESSAGE_TOO_LARGE"));
      stream.destroy();
      return;
    }
    while (true) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      try {
        const value = JSON.parse(line);
        assertAgentServerMessageSize(value);
        onMessage(value);
      } catch (error) {
        onError?.(error);
      }
    }
  };
  stream.setEncoding?.("utf8");
  stream.on("data", handleData);
  return () => stream.off("data", handleData);
}
