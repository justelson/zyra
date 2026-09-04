import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CanonicalChatCatalog } from "../src/agent-server/catalog.mjs";
import { ZyraAgentServerClient } from "../src/agent-server/client.mjs";
import { ZyraAgentServer } from "../src/agent-server/server.mjs";
import { AgentEventJournal } from "../src/agent-server/event-journal.mjs";
import { getAgentServerPaths } from "../src/agent-server/paths.mjs";
import { AGENT_SERVER_PROTOCOL_VERSION } from "../src/agent-server/protocol.mjs";
import { createZyraTuiClientRuntime, projectHistoryEntries, selectTuiResumeEntries, TUI_RESUME_HISTORY_ENTRY_LIMIT } from "../src/agent-server/tui-runtime.mjs";
import { syncZyraThinkingLevel } from "../src/zyra-sdk.mjs";

assert.equal(TUI_RESUME_HISTORY_ENTRY_LIMIT, 120, "TUI resume keeps a bounded recent transcript window");
const boundedResume = selectTuiResumeEntries([
  ...Array.from({ length: 125 }, (_, index) => ({ type: "message", message: { role: "toolResult", content: `old ${index}` } })),
  { type: "message", message: { role: "user", content: "first complete prompt" } },
  { type: "message", message: { role: "assistant", content: [{ type: "text", text: "answer" }] } }
]);
assert.equal(boundedResume[0].message.role, "user", "bounded resume starts from a complete user-turn boundary");
const orderedHistory = projectHistoryEntries([
  { type: "message", id: "user-1", message: { role: "user", content: [{ type: "text", text: "Inspect this" }] } },
  { type: "message", id: "assistant-work", message: { role: "assistant", content: [
    { type: "text", text: "I’ll inspect it." },
    { type: "toolCall", id: "tool-1", name: "read", arguments: { path: "src/a.mjs" } }
  ] } },
  { type: "message", id: "tool-result", message: { role: "toolResult", toolCallId: "tool-1", toolName: "read", content: [{ type: "text", text: "file body" }] } },
  { type: "message", id: "assistant-final", message: { role: "assistant", content: [{ type: "text", text: "The issue is fixed." }] } },
  { type: "message", id: "title-user", message: { role: "user", content: [{ type: "text", text: "Write a concise title for this coding-assistant chat.\nReturn title text only." }] } },
  { type: "message", id: "title-assistant", message: { role: "assistant", content: [{ type: "text", text: "Inspect issue" }] } }
]);
assert.deepEqual(orderedHistory.map((event) => event.type), [
  "message_start", "message_start", "message_end", "tool_execution_start", "tool_execution_end", "message_start", "message_end"
], "TUI resume replays prompts, narration, tools, and final responses in canonical order");
assert.equal(orderedHistory.some((event) => JSON.stringify(event).includes("Write a concise title")), false, "out-of-band title prompts never enter resumed chat context");

class FakeWorker extends EventEmitter {
  constructor() {
    super();
    this.activePrompt = null;
    this.controlResponses = [];
    this.requests = [];
    this.canonicalReceipts = new Map();
    this.disposed = false;
  }
  isAlive() { return !this.disposed; }
  request(type, payload = {}) {
    this.requests.push({ type, payload });
    if (type === "connect") return Promise.resolve({
      threadId: String(payload.threadId || "").includes("chat-auth-peer") ? "chat:auth-peer" : "chat:test",
      providerThreadId: sessionPath,
      events: [],
      messages: [
        { id: "connected:user", role: "user", content: "connected user" },
        { id: "connected:tool", role: "toolResult", toolCallId: "connected:call", content: [{ type: "text", text: "connected historical output" }] }
      ]
    });
    if (type === "prompt" && payload.prompt === "__compaction_cancelled__") {
      return Promise.reject(new Error("Compaction cancelled"));
    }
    if (type === "prompt") return new Promise((resolve) => { this.activePrompt = resolve; });
    if (type === "generate_text") {
      return Promise.resolve({ success: true, text: "Utility text result", model: payload.model || "openai-codex/test" });
    }
    if (type === "abort") return Promise.resolve({ aborted: true });
    if (type === "canonical_message.append") {
      const receipt = {
        receiptId: "pi_entry_voice_test",
        operationId: payload.operationId,
        canonicalMessageId: payload.messageId,
        conversationId: payload.conversationId,
        canonicalSequence: 9,
        foregroundRouteId: payload.routeClaim.foregroundRouteId,
        routeEpoch: payload.routeClaim.routeEpoch,
        ownerClaimId: payload.routeClaim.ownerClaimId,
        contentSha256: payload.payloadSha256,
        observedAt: new Date().toISOString()
      };
      this.canonicalReceipts.set(payload.operationId, receipt);
      return Promise.resolve({ receipt });
    }
    if (type === "canonical_message.find") {
      return Promise.resolve({ receipt: this.canonicalReceipts.get(payload.operationId) || null });
    }
    if (type === "approval.respond") {
      this.emit("event", { type: "approval_resolved", requestId: payload.requestId, decision: payload.decision });
      return Promise.resolve({ ok: true });
    }
    if (type === "user_input.respond") {
      this.emit("event", { type: "user_input_resolved", requestId: payload.requestId, answers: payload.answers, cancelled: payload.cancelled === true });
      return Promise.resolve({ ok: true });
    }
    return Promise.resolve({ ok: true });
  }
  finishPrompt(result) {
    const resolve = this.activePrompt;
    this.activePrompt = null;
    resolve?.(result);
  }
  sendControlResponse(message) { this.controlResponses.push(message); return true; }
  dispose() { this.disposed = true; this.removeAllListeners(); }
}

const stateDirectory = mkdtempSync(path.join(os.tmpdir(), "zyra-agent-server-test-"));
const channel = `test-${process.pid}-${Date.now()}`;
assert.ok(AGENT_SERVER_PROTOCOL_VERSION >= 3, "guided-input response support requires a fresh agent-server protocol generation");
const conflictStateDirectory = mkdtempSync(path.join(os.tmpdir(), "zyra-agent-server-client-conflict-"));
const conflictChannel = `conflict-${process.pid}`;
const previousProtocolVersion = AGENT_SERVER_PROTOCOL_VERSION - 1;
writeFileSync(
  path.join(conflictStateDirectory, `agent-server-v${previousProtocolVersion}-${conflictChannel}.json`),
  JSON.stringify({ version: previousProtocolVersion, pid: process.pid, endpoint: "unused", token: "unused" })
);
const conflictingClient = new ZyraAgentServerClient({
  root: path.resolve("."), stateDirectory: conflictStateDirectory, channel: conflictChannel, clientId: "conflict:test", autoStart: true
});
const conflictStartedAt = Date.now();
await assert.rejects(
  () => conflictingClient.connect(),
  (error) => error.code === "AGENT_SERVER_PROTOCOL_CONFLICT"
    && error.runningVersion === previousProtocolVersion
    && error.requiredVersion === AGENT_SERVER_PROTOCOL_VERSION
);
assert.ok(Date.now() - conflictStartedAt < 1_000, "a live older server must fail explicitly instead of waiting for the 30-second startup timeout");
rmSync(conflictStateDirectory, { recursive: true, force: true });
assert.match(getAgentServerPaths({ stateDirectory, channel }).descriptorFile, new RegExp(`agent-server-v${AGENT_SERVER_PROTOCOL_VERSION}-`));
const isolatedStateDirectory = `${stateDirectory}-isolated`;
assert.notEqual(
  getAgentServerPaths({ stateDirectory, channel }).endpoint,
  getAgentServerPaths({ stateDirectory: isolatedStateDirectory, channel }).endpoint,
  "Windows pipe and Unix socket identities include the installation-specific state directory"
);
assert.notEqual(
  getAgentServerPaths({ stateDirectory, channel }).catalogFile,
  getAgentServerPaths({ stateDirectory: isolatedStateDirectory, channel }).catalogFile,
  "separate installation state cannot share a canonical chat catalog"
);
const project = path.join(stateDirectory, "project");
const sessionPath = path.join(project, ".zyra", "sessions", "chat-test.jsonl");
const fakeSessions = [{
  path: sessionPath,
  id: "chat:test",
  cwd: project,
  name: "Shared desktop and TUI chat",
  created: new Date("2026-07-01T00:00:00.000Z"),
  modified: new Date("2026-07-02T00:00:00.000Z"),
  messageCount: 8,
  firstMessage: "hello"
}];
const injectedHistoryEntries = [
  { type: "message", id: "entry:user", message: { role: "user", content: "hello" } },
  ...Array.from({ length: 16 }, (_, index) => ({
    type: "message",
    id: `entry:tool:${index}`,
    message: {
      role: "toolResult",
      toolCallId: `tool:${index}`,
      toolName: "read",
      content: [{ type: "text", text: `historical output ${index}` }]
    }
  }))
];
const catalog = new CanonicalChatCatalog({
  stateDirectory,
  channel,
  loadSessionManager: async () => ({
    list: async () => fakeSessions,
    open: () => ({ getEntries: () => injectedHistoryEntries })
  })
});
const durableJournal = new AgentEventJournal(path.join(stateDirectory, "journal-test"), "chat:journal");
durableJournal.append({ sequence: 1, occurredAt: new Date().toISOString(), event: { type: "message_end" } });
durableJournal.append({
  sequence: 2,
  occurredAt: new Date().toISOString(),
  event: {
    type: "message_update",
    message: { id: "assistant:streaming", role: "assistant", content: "transient snapshot" },
    assistantMessageEvent: { type: "text_delta", delta: "snapshot" }
  }
});
const reopenedDurableJournal = new AgentEventJournal(path.join(stateDirectory, "journal-test"), "chat:journal");
assert.equal(reopenedDurableJournal.replay(0).length, 1, "token-level message updates must stay live-only instead of synchronously hitting the durable journal");
assert.equal(reopenedDurableJournal.latestSequence(), 1, "transient stream updates must not advance durable replay state");

const lateAuthorityChannel = `${channel}-late-authority`;
const lateAuthorityPaths = getAgentServerPaths({ stateDirectory, channel: lateAuthorityChannel });
const lateAuthorityServer = new ZyraAgentServer({ stateDirectory, channel: lateAuthorityChannel, endpoint: 0, catalog });
await lateAuthorityServer.start();
assert.equal(lateAuthorityServer.getDesktopAuthorityHash(), null);
const lateAuthorityHash = createHash("sha256").update("late-desktop-proof").digest("base64url");
writeFileSync(lateAuthorityPaths.desktopAuthorityFile, lateAuthorityHash, { encoding: "utf8", mode: 0o600 });
assert.equal(lateAuthorityServer.getDesktopAuthorityHash(), lateAuthorityHash, "a TUI-first server reloads Desktop authority created after startup");
await lateAuthorityServer.stop();

const workers = [];
const server = new ZyraAgentServer({
  root: path.resolve("."), stateDirectory, channel, catalog, idleTimeoutMs: 5_000,
  desktopAuthorityToken: "test-desktop-authority",
  createWorker: () => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  }
});

await server.start();
const desktop = client("desktop:test", "desktop", ["desktop-control"]);
const tui = client("tui:test", "tui");

try {
  await Promise.all([desktop.connect(), tui.connect()]);
  await desktop.request("catalog.registerProject", { project });
  const listed = await tui.request("catalog.list", {});
  assert.equal(listed.chats.length, 1);
  assert.equal(listed.chats[0].canonicalChatId, "chat:test");
  assert.equal(listed.chats[0].presence.state, "detached");
  const history = await desktop.request("catalog.history", { session: "chat:test", project });
  assert.equal(history.history.entries[0].message.content, "hello");
  const lazyHistory = await desktop.request("catalog.history", {
    session: "chat:test",
    project,
    toolResultBodies: "lazy-v1"
  });
  const deferredHistoryEntry = lazyHistory.history.entries.find((entry) => entry.historyBodyRef);
  assert.ok(deferredHistoryEntry, "the server history contract must expose deferred tool body references");
  assert.equal("content" in deferredHistoryEntry.message, false);
  const hydratedHistoryBody = await desktop.request("catalog.entry.body", {
    session: "chat:test",
    project,
    ref: deferredHistoryEntry.historyBodyRef
  });
  assert.equal(hydratedHistoryBody.body.entry.message.content[0].text, "historical output 0");
  const searchedToolOutput = await desktop.request("catalog.tool-output.search", {
    session: "chat:test",
    project,
    query: "historical output 0"
  });
  assert.equal(searchedToolOutput.matches[0].toolCallId, "tool:0", "explicit search scans deferred canonical output without rehydrating every history page");
  const archived = await desktop.request("catalog.update", { session: "chat:test", archived: true });
  assert.equal(archived.chat.archived, true);
  assert.equal((await tui.request("catalog.list", {})).chats.length, 0, "archived chats must be hidden by default");
  const archivedList = await tui.request("catalog.list", { includeArchived: true });
  assert.equal(archivedList.chats.length, 1);
  assert.equal(archivedList.chats[0].archived, true);
  const restored = await desktop.request("catalog.update", { session: "chat:test", archived: false });
  assert.equal(restored.chat.archived, false);
  const deleted = await desktop.request("catalog.update", { session: "chat:test", deleted: true });
  assert.equal(deleted.chat.deleted, true);
  assert.equal((await tui.request("catalog.list", { includeArchived: true })).chats.length, 0, "deleted chats must remain tombstoned during startup import");
  const deletedList = await tui.request("catalog.list", { includeArchived: true, includeDeleted: true });
  assert.equal(deletedList.chats.length, 1);
  assert.equal(deletedList.chats[0].deleted, true);
  const reopenedDeletedCatalog = new CanonicalChatCatalog({
    stateDirectory,
    channel,
    loadSessionManager: async () => ({
      list: async () => fakeSessions,
      open: () => ({ getEntries: () => [] })
    })
  });
  assert.equal((await reopenedDeletedCatalog.list({ includeArchived: true })).length, 0, "a deleted chat must stay hidden after the catalog process restarts");
  assert.equal((await desktop.request("catalog.history", { session: "chat:test", project })).history, null, "deleted chats must fail closed for history hydration");
  await assert.rejects(
    desktop.attach({ project, cwd: project, session: "chat:test", localThreadId: "assistant-thread:deleted" }),
    /deleted/i,
    "a known tombstoned chat must not be revived by direct attachment"
  );
  const undeleted = await desktop.request("catalog.update", { session: "chat:test", deleted: false });
  assert.equal(undeleted.chat.deleted, false);

  const desktopAttached = await desktop.attach({ project, cwd: project, session: "chat:test", localThreadId: "assistant-thread:desktop" });
  assert.equal(desktopAttached.canonicalChatId, "chat:test");
  assert.equal(desktopAttached.connected.messages.some((message) => message.role === "toolResult"), false, "Desktop attach must not duplicate historical tool bodies before paged history loads");
  const tuiAttached = await tui.attach({ project, cwd: project, session: "assistant-thread:desktop", localThreadId: "tui:local" });
  assert.equal(tuiAttached.canonicalChatId, "chat:test");
  assert.equal(tuiAttached.connected.messages.some((message) => message.role === "toolResult"), false, "TUI attach must not duplicate historical tool bodies before paged history loads");
  assert.equal(workers.length, 1, "desktop and TUI must share one server worker");
  const fleetSnapshot = {
    version: 1,
    fleetId: "fleet:test",
    rootSessionId: "chat:test",
    rootThreadId: "assistant-thread:desktop",
    lastAppliedSequence: 7,
    updatedAt: new Date().toISOString(),
    agents: { "agent:test": { agentRunId: "agent:test", createdAt: new Date().toISOString(), status: "completed" } },
    workflows: {},
    relationships: [],
    artifacts: [],
    eventWindow: [],
    usage: {},
    truncated: { agents: false, workflows: false, relationships: false, artifacts: false, events: false }
  };
  workers[0].emit("event", { type: "agent.created", fleet: fleetSnapshot });
  const fleetObserver = client("desktop:fleet-observer", "desktop", ["desktop-control"]);
  await fleetObserver.connect();
  const fleetObserverAttached = await fleetObserver.attach({ project, cwd: project, session: "chat:test", localThreadId: "assistant-thread:fleet-observer" });
  assert.equal(Object.keys(fleetObserverAttached.connected.fleet?.agents || {}).length, 1, "late Desktop attachments receive the latest full fleet snapshot instead of the original empty connect result");
  assert.equal(fleetObserverAttached.connected.fleet?.lastAppliedSequence, 7);
  fleetObserver.close();
  await waitUntil(async () => (await desktop.request("catalog.list", {})).chats[0].presence.clients.length === 2);
  const attachedList = await desktop.request("catalog.list", {});
  const attachedSingle = await desktop.request("catalog.get", { session: "chat:test", project });
  assert.equal(attachedSingle.chat.canonicalChatId, "chat:test", "single-chat lookup resolves the canonical shell without attaching another runtime");
  assert.equal(attachedSingle.chat.presence.state, "ready");
  assert.equal(attachedList.chats[0].presence.clients.length, 2);
  assert.deepEqual(new Set(attachedList.chats[0].presence.clients.map((entry) => entry.surface)), new Set(["desktop", "tui"]));
  const updated = await desktop.request("catalog.update", { session: "chat:test", title: "Editable shared title", project });
  assert.equal(updated.chat.title, "Editable shared title");
  assert.equal(updated.chat.sessionPath, sessionPath, "metadata edits must not move canonical transcript storage");

  const canonicalMessage = {
    operationId: "op_voice_server_1",
    idempotencyKey: "voice:server:1",
    conversationId: "chat:test",
    messageId: "voice_user_server_1",
    role: "user",
    producer: "user",
    modality: "voice",
    text: "durable voice turn",
    attachmentIds: [],
    providerItemId: "voice_provider_server_1",
    providerCompletedAt: new Date().toISOString(),
    payloadSha256: "a".repeat(64),
    routeClaim: { foregroundRouteId: "route_voice_server_2", routeEpoch: 2, ownerClaimId: "claim_voice_server_2" }
  };
  const canonicalAppend = await desktop.request("catalog.message.append", { session: "chat:test", message: canonicalMessage });
  assert.equal(canonicalAppend.receipt.operationId, canonicalMessage.operationId);
  const canonicalFind = await desktop.request("catalog.message.find", { session: "chat:test", operationId: canonicalMessage.operationId });
  assert.deepEqual(canonicalFind.receipt, canonicalAppend.receipt);
  const authPeerSessionPath = path.join(project, ".zyra", "sessions", "chat-auth-peer.jsonl");
  fakeSessions.push({
    path: authPeerSessionPath,
    id: "chat:auth-peer",
    cwd: project,
    name: "Auth refresh peer",
    created: new Date("2026-06-01T00:00:00.000Z"),
    modified: new Date("2026-06-02T00:00:00.000Z"),
    messageCount: 1,
    firstMessage: "peer"
  });
  const authPeer = client("tui:auth-peer", "tui");
  await authPeer.connect();
  await authPeer.attach({ project, cwd: project, session: "chat:auth-peer", localThreadId: "tui:auth-peer" });
  assert.equal(workers.length, 2, "the auth refresh test owns two independent live session workers");
  await tui.request("auth.refresh", { provider: "openai-codex" });
  for (const worker of workers) {
    assert.deepEqual(worker.requests.at(-1), {
      type: "auth.refresh",
      payload: { provider: "openai-codex" }
    }, "TUI auth changes must refresh every authoritative live session runtime");
  }
  await authPeer.request("session.stop", { sessionKey: "chat:auth-peer", reason: "auth refresh test complete" });
  authPeer.close();
  fakeSessions.pop();
  workers.splice(1, 1);
  await assert.rejects(
    tui.request("catalog.message.append", { session: "chat:test", message: canonicalMessage }),
    /verified Desktop authority/
  );

  const tuiEvents = [];
  tui.on("session-event:chat:test", (event) => tuiEvents.push(event));
  const promptResult = desktop.request("session.request", {
    sessionKey: "chat:test", type: "prompt", payload: { prompt: "keep building" },
    requestContext: { turnId: "turn:test", localThreadId: "assistant-thread:desktop" }
  }).catch((error) => ({ disconnected: error.code === "AGENT_SERVER_DISCONNECTED" }));
  await waitUntil(() => workers[0].activePrompt !== null);
  const runningCatalog = await tui.request("catalog.list", {});
  assert.equal(runningCatalog.chats[0].presence.state, "running", "catalog presence must expose unopened work as running");
  assert.equal(runningCatalog.chats[0].presence.latestTurn?.id, "turn:test", "catalog presence must identify the active canonical turn");
  assert.equal(runningCatalog.chats[0].presence.latestTurn?.state, "running", "catalog presence must expose the active turn state");
  await assert.rejects(
    desktop.request("catalog.message.append", { session: "chat:test", message: { ...canonicalMessage, operationId: "op_voice_server_busy" } }),
    /strong foreground turn is active/
  );
  workers[0].emit("event", { type: "message_update", message: { role: "assistant", content: "still working" } });
  await waitUntil(() => tuiEvents.length === 1);
  workers[0].emit("event", { type: "approval_requested", requestId: "approval:test", requestType: "command", command: "npm test" });
  await waitUntil(() => tuiEvents.some((entry) => entry.event?.type === "approval_requested"));
  assert.equal((await tui.request("catalog.list", {})).chats[0].presence.attention, "approval", "catalog presence must expose approval attention before Desktop opens the thread");
  await tui.request("session.request", {
    sessionKey: "chat:test",
    type: "approval.respond",
    payload: { requestId: "approval:test", decision: "acceptOnce" }
  });
  assert.deepEqual(workers[0].requests.at(-1), {
    type: "approval.respond",
    payload: { requestId: "approval:test", decision: "acceptOnce" }
  }, "an attached surface should resolve a canonical approval while the prompt remains active");
  await waitUntil(() => tuiEvents.some((entry) => entry.event?.type === "approval_resolved"));
  assert.equal((await tui.request("catalog.list", {})).chats[0].presence.attention, null, "catalog presence must clear resolved approval attention");
  workers[0].emit("event", {
    type: "user_input_requested",
    requestId: "user-input:test",
    questions: [{ id: "targets", header: "Targets", question: "Choose targets", type: "multi_select", options: [{ label: "Desktop" }, { label: "TUI" }] }]
  });
  await waitUntil(() => tuiEvents.some((entry) => entry.event?.type === "user_input_requested"));
  assert.equal((await tui.request("catalog.list", {})).chats[0].presence.attention, "user-input", "catalog presence must expose blocking user-input attention");
  const userInputResponse = await tui.request("session.request", {
    sessionKey: "chat:test",
    type: "user_input.respond",
    payload: { requestId: "user-input:test", answers: { targets: ["Desktop", "TUI"] }, cancelled: false }
  });
  assert.deepEqual(userInputResponse, { ok: true });
  assert.deepEqual(workers[0].requests.at(-1), {
    type: "user_input.respond",
    payload: { requestId: "user-input:test", answers: { targets: ["Desktop", "TUI"] }, cancelled: false }
  }, "an attached surface should resolve canonical user input while the prompt remains active");
  const userInputWorkerRequestCount = workers[0].requests.filter((entry) => entry.type === "user_input.respond").length;
  assert.deepEqual(await tui.request("session.request", {
    sessionKey: "chat:test",
    type: "user_input.respond",
    payload: { requestId: "user-input:test", answers: { targets: ["Desktop", "TUI"] }, cancelled: false }
  }), userInputResponse, "the owning surface may safely retry a response whose acknowledgement was lost");
  assert.equal(workers[0].requests.filter((entry) => entry.type === "user_input.respond").length, userInputWorkerRequestCount, "same-surface retries cannot resolve the request twice");
  await assert.rejects(desktop.request("session.request", {
    sessionKey: "chat:test",
    type: "user_input.respond",
    payload: { requestId: "user-input:test", answers: { targets: ["Desktop"] }, cancelled: false }
  }), /already answered by another attached surface/, "only one attached surface may own a question response");
  await waitUntil(() => tuiEvents.some((entry) => entry.event?.type === "user_input_resolved"));
  assert.equal(tuiEvents.find((entry) => entry.event?.type === "user_input_resolved")?.event?.responseOwnerClientId, "tui:test", "resolved question events retain the answering surface for safe retry recovery");
  assert.equal((await tui.request("catalog.list", {})).chats[0].presence.attention, null, "catalog presence must clear resolved user-input attention");
  workers[0].emit("event", { type: "agent_end", willRetry: true });
  await waitUntil(() => tuiEvents.some((entry) => entry.event?.type === "agent_end" && entry.event?.willRetry === true));
  const retryingCatalog = await tui.request("catalog.list", {});
  assert.equal(retryingCatalog.chats[0].presence.state, "running", "a retryable agent_end cannot settle the canonical turn");
  assert.equal(retryingCatalog.chats[0].presence.activeTurnId, "turn:test", "retry backoff retains canonical prompt ownership");
  assert.ok(server.sessions.get("chat:test")?.activeRequestContext, "another prompt cannot enter while the existing turn is retrying");
  desktop.close();
  assert.equal(server.state().sessions[0].activeRequests, 1, "closing Desktop must not stop active work");
  workers[0].emit("event", { type: "agent_end", willRetry: false });
  await waitUntil(() => server.state().sessions[0].latestTurn?.state === "completed");
  const agentEndCatalog = await tui.request("catalog.list", {});
  assert.equal(agentEndCatalog.chats[0].presence.state, "ready", "agent_end must settle the canonical turn before the prompt request unwinds");
  assert.equal(agentEndCatalog.chats[0].presence.activeTurnId, null, "settled presence cannot advertise a live turn id");
  assert.equal(server.sessions.get("chat:test")?.activeRequestContext, null, "a completed Desktop turn must release prompt ownership immediately so an attached TUI is not blocked");
  workers[0].finishPrompt({ completed: true });
  await waitUntil(() => server.state().sessions[0].activeRequests === 0);
  await promptResult;
  const completedCatalog = await tui.request("catalog.list", {});
  assert.equal(completedCatalog.chats[0].presence.state, "ready", "catalog presence must return to ready after canonical work completes");
  assert.equal(completedCatalog.chats[0].presence.latestTurn?.id, "turn:test", "catalog presence must retain the completed turn identity");
  assert.equal(completedCatalog.chats[0].presence.latestTurn?.state, "completed", "catalog presence must expose completion without opening the thread");

  const spoofedAuthority = client("tui:spoofed-authority", "tui", ["desktop-control"]);
  await spoofedAuthority.connect();
  await spoofedAuthority.attach({ project, cwd: project, session: "chat:test", localThreadId: "tui:spoof" });
  workers[0].emit("control", { type: "control.request", requestId: "control:spoof", operation: { action: "observe" } });
  await waitUntil(() => workers[0].controlResponses.length === 1);
  assert.equal(workers[0].controlResponses[0].error.code, "CONTROL_DRIVER_UNAVAILABLE", "a TUI handshake cannot self-assert Desktop authority");
  spoofedAuthority.close();

  const reconnect = client("desktop:reconnect", "desktop", ["desktop-control"]);
  await reconnect.connect();
  const replay = await reconnect.attach({ project, cwd: project, session: "chat:test", localThreadId: "assistant-thread:reconnect", lastSequence: 0 });
  assert.equal(replay.replay.length, 9, "reconnect must replay metadata, fleet, provider events, approvals, user input, retry state, and the authoritative agent completion");
  assert.equal(replay.replay[0].event.type, "agent.created");
  assert.equal(Object.keys(replay.replay[0].event.fleet.agents).length, 1);
  assert.equal(replay.replay[1].event.type, "session_metadata");
  assert.equal(replay.replay[2].event.message.content, "still working");
  assert.equal(replay.replay[2].requestContext.turnId, "turn:test");
  assert.equal(replay.replay[3].event.type, "approval_requested");
  assert.equal(replay.replay[4].event.type, "approval_resolved");
  assert.equal(replay.replay[5].event.type, "user_input_requested");
  assert.equal(replay.replay[6].event.type, "user_input_resolved");
  assert.deepEqual(replay.replay[6].event.answers.targets, ["Desktop", "TUI"]);
  assert.equal(replay.replay[7].event.type, "agent_end");
  assert.equal(replay.replay[7].event.willRetry, true);
  assert.equal(replay.replay[8].event.type, "agent_end");
  assert.equal(replay.replay[8].event.willRetry, false);
  assert.equal(replay.replay.filter((entry) => entry.event.type === "agent_end" && entry.event.willRetry !== true).length, 1, "only the final agent_end is the durable provider completion boundary");
  assert.equal(replay.replay.filter((entry) => entry.event.type === "zyra_server_turn_completed").length, 0, "prompt resolution cannot append a duplicate synthetic completion after agent_end");
  // Older journals could attribute agent_settled to the just-completed request.
  // Presence is ready, so transcript replay must never resurrect that turn in TUI state.
  const completedSession = server.sessions.get("chat:test");
  completedSession.events.push({
    sequence: ++completedSession.sequence,
    occurredAt: new Date().toISOString(),
    event: { type: "agent_settled" },
    requestContext: { turnId: "turn:test", localThreadId: "assistant-thread:desktop" }
  });

  const tuiRuntime = await createZyraTuiClientRuntime({
    project,
    session: "chat:test",
    model: "openai-codex/gpt-5.6-sol",
    thinking: "max",
    agentServer: { stateDirectory, channel, autoStart: false }
  });
  assert.equal(tuiRuntime.session.sessionManager.getSessionName(), "Editable shared title");
  assert.equal(tuiRuntime.session.isStreaming, false, "historical post-completion events cannot resurrect a completed turn when canonical presence is ready");
  assert.equal(tuiRuntime.session.thinkingLevel, "max", "an explicit resumed-chat max setting must outrank the first client's stale config")
  assert.equal(tuiRuntime.session.getAvailableThinkingLevels().includes("max"), true)
  assert.equal(
    workers[0].requests.some((entry) => entry.type === "configure" && entry.payload.thinking === "max"),
    true,
    "a later TUI attachment must synchronize its explicit max setting to the shared worker"
  );
  assert.equal(tuiRuntime.history.events()[0].message.content[0].text, "hello");
  const historicalTuiTool = tuiRuntime.history.events().find((event) => event.toolCallId === "tool:0");
  assert.equal(historicalTuiTool.result.content[0].text, "historical output 0", "TUI history remains complete until its UI has an interactive hydration path");
  const remoteEvents = [];
  tuiRuntime.session.subscribe((event) => remoteEvents.push(event));

  let approvalResolutionSignal;
  let resolveApprovalDialog;
  tuiRuntime.agentServer.setApprovalHandler((_request, options) => {
    approvalResolutionSignal = options.signal;
    return new Promise((resolve) => {
      resolveApprovalDialog = resolve;
      options.signal.addEventListener("abort", () => resolve("decline"), { once: true });
    });
  });
  const externalPrompt = reconnect.request("session.request", {
    sessionKey: "chat:test", type: "prompt", payload: { prompt: "external work" },
    requestContext: { turnId: "turn:external", localThreadId: "assistant-thread:external" }
  });
  await waitUntil(() => workers[0].activePrompt !== null);
  workers[0].emit("event", { type: "approval_requested", requestId: "approval:external", requestType: "command", command: "bun test" });
  await waitUntil(() => approvalResolutionSignal);
  assert.equal(tuiRuntime.session.isStreaming, true, "remote TUI running state must follow another surface's active turn");
  await reconnect.request("session.request", {
    sessionKey: "chat:test", type: "approval.respond",
    payload: { requestId: "approval:external", decision: "acceptOnce" }
  });
  await waitUntil(() => approvalResolutionSignal.aborted);
  assert.equal(approvalResolutionSignal.aborted, true, "an external approval resolution must cancel the mounted TUI prompt");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    workers[0].requests.filter((entry) => entry.type === "approval.respond" && entry.payload.requestId === "approval:external").length,
    1,
    "the cancelled TUI dialog must not submit a second approval decision"
  );
  const resumedActiveTui = await createZyraTuiClientRuntime({
    project,
    session: "chat:test",
    agentServer: { stateDirectory, channel, autoStart: false }
  });
  assert.equal(resumedActiveTui.session.isStreaming, true, "a resumed TUI immediately recognizes the canonical active turn");
  const attachedClientCount = server.sessions.get("chat:test")?.clients.size || 0;
  resumedActiveTui.agentServer.client.socket.destroy();
  await waitUntil(() => (server.sessions.get("chat:test")?.clients.size || 0) >= attachedClientCount && resumedActiveTui.session.isStreaming);
  assert.equal(resumedActiveTui.session.isStreaming, true, "a TUI socket reconnect reattaches to the still-running canonical turn");
  workers[0].emit("event", {
    type: "message_end",
    message: {
      id: "assistant:external",
      role: "assistant",
      content: "external complete",
      usage: { input: 900, output: 100, cacheRead: 0, cacheWrite: 0, totalTokens: 1000, cost: { total: 0.05 } }
    }
  });
  workers[0].finishPrompt({});
  await externalPrompt;
  await waitUntil(() => !tuiRuntime.session.isStreaming && !resumedActiveTui.session.isStreaming);
  resumedActiveTui.session.dispose();
  assert.equal(tuiRuntime.session.getContextUsage().tokens, 1000, "remote context status must use canonical model usage");
  assert.equal(tuiRuntime.session.sessionManager.getEntries().at(-1).message.usage.cost.total, 0.05, "remote cost status must retain usage cost");
  assert.equal(tuiRuntime.session.sessionManager.getSessionUsage().cost.total, 0.05, "remote status must expose cumulative canonical cost");
  resolveApprovalDialog?.("decline");

  tuiRuntime.session.setThinkingLevel("high");
  await waitUntil(() => workers[0].requests.some((entry) => entry.type === "configure" && entry.payload.thinking === "high"));
  const maxConfigureCount = workers[0].requests.filter((entry) => entry.type === "configure" && entry.payload.thinking === "max").length;
  assert.equal(syncZyraThinkingLevel(tuiRuntime, "max"), "max");
  await waitUntil(() => workers[0].requests.filter((entry) => entry.type === "configure" && entry.payload.thinking === "max").length > maxConfigureCount);
  assert.equal(tuiRuntime.session.thinkingLevel, "max", "remote synchronization must not down-convert max to xhigh");
  const pendingSteer = tuiRuntime.session.steer("redirect from TUI");
  const pendingFollowUp = tuiRuntime.session.followUp("continue after this turn");
  assert.deepEqual(tuiRuntime.session.getSteeringMessages(), ["redirect from TUI"]);
  assert.deepEqual(tuiRuntime.session.getFollowUpMessages(), ["continue after this turn"]);
  assert.deepEqual(tuiRuntime.session.clearQueue(), {
    steering: ["redirect from TUI"],
    followUp: ["continue after this turn"]
  }, "remote clearQueue must return queued text for Stop/Escape restoration");
  await Promise.all([pendingSteer, pendingFollowUp]);
  const remotePrompt = tuiRuntime.session.prompt("continue from TUI");
  await waitUntil(() => workers[0].activePrompt !== null);
  assert.equal(
    workers[0].requests.findLast((entry) => entry.type === "prompt")?.payload.thinking,
    "max",
    "the actual resumed-chat prompt must request max instead of xhigh"
  );
  workers[0].emit("event", { type: "message_end", message: { id: "assistant:tui", role: "assistant", content: "shared" } });
  workers[0].finishPrompt({});
  await remotePrompt;
  assert.equal(remoteEvents.at(-1).message.content, "shared");
  assert.equal(tuiRuntime.session.state.messages.at(-1).content, "shared");
  tuiRuntime.session.dispose();

  reconnect.setControlHandler(async (operation) => ({ accepted: operation.action === "observe" }));
  workers[0].emit("control", { type: "control.request", requestId: "control:1", operation: { action: "observe" } });
  await waitUntil(() => workers[0].controlResponses.length === 2);
  assert.deepEqual(workers[0].controlResponses[1].result, { accepted: true });

  const utilityText = await reconnect.request("runtime.generateText", {
    prompt: "Generate bounded Git text.",
    model: "openai-codex/test",
    timeoutMs: 12_000,
    noSession: true
  });
  assert.deepEqual(utilityText, {
    success: true,
    text: "Utility text result",
    model: "openai-codex/test"
  }, "utility text generation must cross the agent-server worker without creating a canonical chat");
  assert.equal(workers.length, 2, "utility generation must use an isolated no-session worker");
  assert.deepEqual(workers[1].requests.at(-1), {
    type: "generate_text",
    payload: {
      prompt: "Generate bounded Git text.",
      model: "openai-codex/test",
      timeoutMs: 12_000,
      noSession: true
    }
  });
  const allWorkerAuthRefresh = await reconnect.request("auth.refresh", { provider: "openai-codex" });
  assert.deepEqual(allWorkerAuthRefresh, {
    provider: "openai-codex",
    refreshedSessions: 1
  });
  assert.deepEqual(workers[0].requests.at(-1), {
    type: "auth.refresh",
    payload: { provider: "openai-codex" }
  }, "server-wide auth refresh includes every canonical chat worker");
  assert.equal(workers[1].requests.at(-1)?.type, "generate_text", "the utility bridge owns no persistent auth snapshot and must not receive chat-only auth refreshes");

  await assert.rejects(
    reconnect.request("session.request", {
      sessionKey: "chat:test",
      type: "prompt",
      payload: { prompt: "__compaction_cancelled__" },
      requestContext: { turnId: "turn:compaction-cancelled", localThreadId: "assistant-thread:reconnect" }
    }),
    /Compaction cancelled/
  );
  await waitUntil(() => server.state().sessions[0].latestTurn?.id === "turn:compaction-cancelled");
  assert.equal(
    server.state().sessions[0].latestTurn?.state,
    "interrupted",
    "cancelling automatic compaction must leave canonical presence interrupted instead of failed"
  );

  await reconnect.detach("chat:test");
  reconnect.close();
  assert.equal(workers[0].disposed, false, "detaching a client must not immediately dispose the runtime");
  const blockedJournalFleet = {
    ...fleetSnapshot,
    lastAppliedSequence: 8,
    updatedAt: new Date().toISOString(),
    agents: { "agent:test": { ...fleetSnapshot.agents["agent:test"], status: "blocked" } }
  };
  workers[0].emit("event", { type: "agent.state.changed", fleet: blockedJournalFleet });
  await waitUntil(() => server.state().sessions[0].backgroundWorkActive === true);
  const journalWatermark = server.state().sessions[0].latestSequence;
  await tui.request("session.stop", { sessionKey: "chat:test", reason: "test complete" });
  assert.equal(workers[0].disposed, true, "explicit Stop must dispose the runtime");
  const journalObserver = client("desktop:journal-fleet", "desktop", ["desktop-control"]);
  await journalObserver.connect();
  const journalAttach = await journalObserver.attach({ project, cwd: project, session: "chat:test", localThreadId: "assistant-thread:journal-fleet", lastSequence: journalWatermark });
  assert.equal(journalAttach.replay.length, 0, "a client already at the fleet event watermark does not need replay for recovery");
  assert.equal(journalAttach.connected.fleet?.lastAppliedSequence, 8, "journal reconstruction restores the latest fleet snapshot into the attach result");
  assert.equal(Object.keys(journalAttach.connected.fleet?.agents || {}).length, 1);
  assert.equal(journalAttach.connected.fleet?.agents["agent:test"]?.status, "blocked");
  assert.equal(journalAttach.presence.state, "background", "journal reconstruction restores background presence for active or blocked agents");
  await journalObserver.request("session.stop", { sessionKey: "chat:test", reason: "journal test complete" });
  journalObserver.close();
  tui.close();
  process.stdout.write("zyra agent server tests passed\n");
} finally {
  desktop.close();
  tui.close();
  await server.stop("test cleanup");
  rmSync(stateDirectory, { recursive: true, force: true });
}

function client(clientId, surface, authorities = []) {
  return new ZyraAgentServerClient({
    root: path.resolve("."), stateDirectory, channel, autoStart: false, clientId, surface, authorities,
    authorityProof: surface === "desktop" && authorities.includes("desktop-control") ? "test-desktop-authority" : undefined
  });
}

async function waitUntil(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for test state.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
