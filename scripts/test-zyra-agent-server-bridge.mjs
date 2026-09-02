import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ZyraAgentServerClient } from "../src/agent-server/client.mjs";
import { ZyraAgentServer } from "../src/agent-server/server.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temporary = mkdtempSync(path.join(os.tmpdir(), "zyra-agent-server-bridge-"));
const project = path.join(temporary, "project");
const stateDirectory = path.join(temporary, "state");
const correctedProject = path.join(temporary, "corrected-project");
const channel = `bridge-${process.pid}-${Date.now()}`;
const fixtureSessionId = "01900000-0000-7000-8000-000000000001";
const fixtureTimestamp = "2026-08-04T00:00:00.000Z";
const fixtureSessionPath = path.join(project, ".zyra", "sessions", `${fixtureTimestamp.replaceAll(":", "-")}_${fixtureSessionId}.jsonl`);
const filesystemScope = (revision, workingRoot = project) => ({
  projectId: "project-bridge",
  revision,
  workingRoot,
  roots: [{ id: "home:project-bridge", kind: "project-home", path: workingRoot, label: "Project home", access: "read-write" }],
  createdAt: fixtureTimestamp,
  updatedAt: fixtureTimestamp
});
mkdirSync(path.dirname(fixtureSessionPath), { recursive: true });
mkdirSync(correctedProject, { recursive: true });
writeFileSync(fixtureSessionPath, [
  { type: "session", version: 3, id: fixtureSessionId, timestamp: fixtureTimestamp, cwd: project },
  { type: "message", id: "11111111", parentId: null, timestamp: fixtureTimestamp, message: { role: "user", content: [{ type: "text", text: "bridge fixture" }], timestamp: Date.parse(fixtureTimestamp) } },
  { type: "message", id: "22222222", parentId: "11111111", timestamp: fixtureTimestamp, message: { role: "assistant", content: [{ type: "text", text: "fixture ready" }], timestamp: Date.parse(fixtureTimestamp) + 1, stopReason: "stop", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { total: 0 } } } }
].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
const server = new ZyraAgentServer({ root, stateDirectory, channel, idleTimeoutMs: 5_000 });
await server.start();
const desktop = client("desktop:bridge", "desktop");
const tui = client("tui:bridge", "tui");

try {
  await desktop.connect();
  const attached = await desktop.attach({
    project,
    cwd: project,
    session: fixtureSessionPath,
    localThreadId: "assistant-thread:bridge",
    model: "openai-codex/gpt-5.5",
    thinking: "low",
    profile: "default",
    runtimeMode: "approval-required",
    filesystemScope: filesystemScope(1)
  });
  assert.match(attached.canonicalChatId, /.+/);
  assert.equal(typeof attached.connected.model, "string", "the real bridge must return its connected runtime metadata");
  await desktop.request("session.request", {
    sessionKey: attached.sessionKey,
    type: "configure",
    payload: {
      model: attached.connected.model,
      thinking: "high",
      profile: "default",
      runtimeMode: "full-access",
      webSearch: true,
      webFetch: true
    }
  });
  const persistedConfig = readFileSync(fixtureSessionPath, "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.type === "custom" && entry.customType === "zyra.chat-config.v1")
    .at(-1)?.data;
  assert.equal(persistedConfig?.thinking, "high", "chat configuration must be recorded in canonical Pi history");
  assert.equal(persistedConfig?.runtimeMode, "full-access");
  for (const runtimeMode of ["auto-review", "edits-only"]) {
    await desktop.request("session.request", {
      sessionKey: attached.sessionKey,
      type: "configure",
      payload: {
        model: attached.connected.model,
        thinking: "high",
        profile: "default",
        runtimeMode,
        webSearch: true,
        webFetch: true
      }
    });
    const latestMode = readFileSync(fixtureSessionPath, "utf8")
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line))
      .filter((entry) => entry.type === "custom" && entry.customType === "zyra.chat-config.v1")
      .at(-1)?.data?.runtimeMode;
    assert.equal(latestMode, runtimeMode, `${runtimeMode} must persist without collapsing into another mode`);
  }
  await desktop.detach(attached.sessionKey);
  assert.equal(server.state().sessions.length, 1, "desktop detach must leave the bridge alive");
  const rebound = await desktop.attach({
    project: correctedProject,
    cwd: correctedProject,
    session: attached.canonicalChatId,
    localThreadId: "assistant-thread:bridge-stop",
    filesystemScope: filesystemScope(2, correctedProject)
  });
  assert.equal(server.state().sessions.length, 1, "a scope revision reconnect replaces rather than duplicates the canonical worker");
  assert.equal(rebound.connected.cwd, correctedProject, "the current Chat Working root overrides stale canonical installation metadata");
  await desktop.request("session.stop", { sessionKey: attached.sessionKey, reason: "prove config reload" });
  assert.equal(server.state().sessions.length, 0, "the persistence check must reopen a fresh bridge worker");
  desktop.close();

  await tui.connect();
  const reopened = await tui.attach({
    project,
    cwd: project,
    session: attached.canonicalChatId,
    localThreadId: "tui-thread:bridge"
  });
  assert.equal(reopened.canonicalChatId, attached.canonicalChatId, "TUI must reopen the desktop-created canonical chat");
  assert.equal(reopened.connected.thinking, "high", "reopened surfaces must inherit the canonical chat thinking level");
  assert.equal(reopened.connected.runtimeMode, "edits-only", "reopened surfaces must inherit the canonical permission mode");
  assert.equal(reopened.connected.model, attached.connected.model, "reopened surfaces must inherit the canonical model");
  assert.equal(server.state().sessions.length, 1, "both surfaces must resolve to the same bridge worker");
  await tui.request("session.stop", { sessionKey: reopened.sessionKey, reason: "bridge test complete" });
  tui.close();
  process.stdout.write("zyra agent-server bridge tests passed\n");
} finally {
  desktop.close();
  tui.close();
  await server.stop("test cleanup");
  rmSync(temporary, { recursive: true, force: true });
}

function client(clientId, surface) {
  return new ZyraAgentServerClient({ root, stateDirectory, channel, autoStart: false, clientId, surface });
}
