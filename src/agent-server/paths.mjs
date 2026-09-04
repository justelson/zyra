import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { AGENT_SERVER_PROTOCOL_VERSION } from "./protocol.mjs";

const CHANNEL_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export function normalizeAgentServerChannel(value = process.env.ZYRA_AGENT_SERVER_CHANNEL || "default") {
  const channel = String(value || "default").trim();
  if (!CHANNEL_PATTERN.test(channel)) throw new Error("Zyra agent-server channel is invalid.");
  return channel.toLowerCase();
}

export function getAgentServerStateDirectory(options = {}) {
  return path.resolve(options.stateDirectory || process.env.ZYRA_STATE_DIR || path.join(os.homedir(), ".zyra"));
}

export function getAgentServerPaths(options = {}) {
  const channel = normalizeAgentServerChannel(options.channel);
  const stateDirectory = getAgentServerStateDirectory(options);
  const identity = createHash("sha256")
    .update(`${os.homedir()}\0${stateDirectory}\0${channel}\0v${AGENT_SERVER_PROTOCOL_VERSION}`)
    .digest("hex")
    .slice(0, 20);
  const endpoint = process.platform === "win32"
    ? `\\\\.\\pipe\\zyra-agent-${identity}`
    : path.join(stateDirectory, `agent-${identity}.sock`);
  return {
    channel,
    stateDirectory,
    endpoint,
    descriptorFile: path.join(stateDirectory, `agent-server-v${AGENT_SERVER_PROTOCOL_VERSION}-${channel}.json`),
    // One channel-wide owner lock prevents different protocol generations from
    // mutating the same canonical chat/catalog state concurrently.
    lockFile: path.join(stateDirectory, `agent-server-${channel}.lock`),
    desktopAuthorityFile: path.join(stateDirectory, `agent-server-${channel}.desktop-authority`),
    catalogFile: path.join(stateDirectory, "chat-catalog-v1.json"),
    journalDirectory: path.join(stateDirectory, "agent-events"),
  };
}
