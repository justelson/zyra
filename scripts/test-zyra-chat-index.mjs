import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CanonicalChatCatalog } from "../src/agent-server/catalog.mjs";
import { CanonicalChatIndex } from "../src/agent-server/chat-index.mjs";
import { MAX_EAGER_HISTORY_TOOL_RESULT_BYTES, historyQuestionCallIds, projectLoadedHistoryEntries } from "../src/agent-server/history-bodies.mjs";
import { getProjectSessionsDir } from "../src/project-paths.mjs";

const catalogSource = readFileSync(new URL('../src/agent-server/catalog.mjs', import.meta.url), 'utf8');
const chatIndexSource = readFileSync(new URL('../src/agent-server/chat-index.mjs', import.meta.url), 'utf8');
assert.doesNotMatch(catalogSource, /zyra-sdk\.mjs/, 'catalog startup must not import the full Zyra runtime');
assert.doesNotMatch(chatIndexSource, /zyra-sdk\.mjs/, 'chat indexing must keep its project path helper narrow');

const root = mkdtempSync(path.join(os.tmpdir(), "zyra-chat-index-test-"));
const project = path.join(root, "project");
const reassignedProject = path.join(root, "reassigned-project");
const stateDirectory = path.join(root, "state");
const sessionsDirectory = getProjectSessionsDir(project);
const sessionPath = path.join(sessionsDirectory, "canonical.jsonl");
const partialProject = path.join(root, "partial-project");
const partialSessionsDirectory = getProjectSessionsDir(partialProject);
const partialSessionPath = path.join(partialSessionsDirectory, "partial.jsonl");
const rewriteProject = path.join(root, "rewrite-project");
const rewriteSessionsDirectory = getProjectSessionsDir(rewriteProject);
const rewriteSessionPath = path.join(rewriteSessionsDirectory, "rewrite.jsonl");
mkdirSync(sessionsDirectory, { recursive: true });
mkdirSync(partialSessionsDirectory, { recursive: true });
mkdirSync(rewriteSessionsDirectory, { recursive: true });
mkdirSync(reassignedProject, { recursive: true });

const oversizedRecent = projectLoadedHistoryEntries([{
  type: "message",
  id: "entry:oversized-recent",
  message: {
    role: "toolResult",
    toolCallId: "tool:oversized-recent",
    toolName: "read",
    content: [{ type: "text", text: "x".repeat(MAX_EAGER_HISTORY_TOOL_RESULT_BYTES + 1) }]
  }
}], 0, { toolResultBodies: "lazy-v1", canonicalChatId: "canonical:oversized" });
assert.ok(oversizedRecent[0].historyBodyRef, "a recent body larger than the eager byte budget remains on demand");
assert.ok(JSON.stringify(oversizedRecent).length < 2_000, "oversized recent bodies cannot overflow the history response");

const lines = [
  { type: "session", id: "canonical:test", timestamp: "2026-07-01T00:00:00.000Z", cwd: project },
  {
    type: "message", id: "entry:user", timestamp: "2026-07-01T00:00:01.000Z",
    message: {
      id: "message:user", role: "user", timestamp: Date.parse("2026-07-01T00:00:01.000Z"),
      content: [{ type: "text", text: "Preserve every canonical event" }, { type: "image", mimeType: "image/png", data: "aGVsbG8=" }]
    }
  },
  {
    type: "message", id: "entry:assistant", timestamp: "2026-07-01T00:00:02.000Z",
    message: {
      id: "message:assistant", role: "assistant", timestamp: Date.parse("2026-07-01T00:00:02.000Z"),
      content: [
        { type: "thinking", thinking: "Check the source." },
        { type: "toolCall", id: "tool:1", name: "read", arguments: { path: "file.ts" } },
        { type: 'toolCall', id: 'tool:hidden-title', name: 'set_chat_title', arguments: { title: 'Hidden metadata' } }
      ]
    }
  },
  {
    type: "message", id: "entry:tool", timestamp: "2026-07-01T00:00:03.000Z",
    message: {
      id: "message:tool", role: "toolResult", toolCallId: "tool:1", toolName: "read", isError: false,
      timestamp: Date.parse("2026-07-01T00:00:03.000Z"), content: [{ type: "text", text: "file contents" }]
    }
  }
];
writeFileSync(sessionPath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);

try {
  const index = new CanonicalChatIndex({ stateDirectory });
  const first = await index.listProjects([project]);
  assert.equal(first.length, 1);
  assert.equal(first[0].canonicalChatId, "canonical:test");
  assert.equal(first[0].displayMessageCount, 2);
  assert.equal(first[0].toolCallCount, 1, 'hidden title metadata is not a user-visible Action');
  assert.equal(first[0].imageCount, 1);

  const latest = index.history("canonical:test", { limit: 1 });
  assert.equal(latest.entries[0].message.role, "toolResult");
  assert.equal(latest.pageInfo.startCursor, "2");
  assert.equal(latest.pageInfo.hasOlder, true);
  const older = index.history("canonical:test", { before: latest.pageInfo.oldestCursor, limit: 2 });
  assert.equal(older.entries[0].message.role, "user");
  assert.equal(older.entries[1].message.content[1].type, "toolCall");

  appendFileSync(sessionPath, `${JSON.stringify({
    type: "message", id: "entry:error", timestamp: "2026-07-01T00:00:04.000Z",
    message: { id: "message:error", role: "assistant", stopReason: "error", errorMessage: "provider failed", content: [] }
  })}\n`);
  const appended = await index.listProjects([project]);
  assert.equal(appended[0].messageCount, 4);
  assert.equal(appended[0].errorCount, 1);

  const partialSession = JSON.stringify({ type: 'session', id: 'canonical:partial', timestamp: '2026-07-01T00:00:00.000Z', cwd: partialProject });
  const partialMessage = JSON.stringify({ type: 'message', id: 'entry:partial', message: { id: 'message:partial', role: 'user', content: [{ type: 'text', text: 'completed later' }] } });
  const partialSplit = Math.floor(partialMessage.length / 2);
  writeFileSync(partialSessionPath, `${partialSession}\n${partialMessage.slice(0, partialSplit)}`);
  let partial = await index.listProjects([partialProject]);
  assert.equal(partial[0].messageCount, 0, 'an unterminated partial JSONL tail is retained for the next scan');
  appendFileSync(partialSessionPath, `${partialMessage.slice(partialSplit)}\n`);
  partial = await index.listProjects([partialProject]);
  assert.equal(partial[0].messageCount, 1, 'completing a partial JSONL tail indexes the entry exactly once');

  const rewriteSession = JSON.stringify({ type: 'session', id: 'canonical:rewrite', timestamp: '2026-07-01T00:00:00.000Z', cwd: rewriteProject });
  const rewriteLine = (text) => JSON.stringify({ type: 'message', id: 'entry:rewrite', message: { id: 'message:rewrite', role: 'user', content: [{ type: 'text', text }] } });
  writeFileSync(rewriteSessionPath, `${rewriteSession}\n${rewriteLine('AAAA')}\n`);
  let rewritten = await index.listProjects([rewriteProject]);
  assert.equal(rewritten[0].title, 'AAAA');
  writeFileSync(rewriteSessionPath, `${rewriteSession}\n${rewriteLine('BBBB')}\n`);
  const rewriteTime = new Date(Date.now() + 2_000);
  utimesSync(rewriteSessionPath, rewriteTime, rewriteTime);
  rewritten = await index.listProjects([rewriteProject]);
  assert.equal(rewritten[0].title, 'BBBB', 'a same-size transcript rewrite forces a complete rescan');

  const catalog = new CanonicalChatCatalog({ stateDirectory });
  catalog.registerProject(project);
  const beforeUpdate = await catalog.list({ allProjects: true });
  assert.equal(beforeUpdate[0].title, "Preserve every canonical event");
  await catalog.updateChat("canonical:test", { title: "Canonical parity", project: reassignedProject });
  const afterUpdate = await catalog.find("canonical:test", { allProjects: true });
  assert.equal(afterUpdate.title, "Canonical parity");
  assert.equal(afterUpdate.project, path.resolve(reassignedProject));
  assert.equal(afterUpdate.sessionPath, path.resolve(sessionPath), "metadata changes must not move transcript storage");

  const liveMessage = { type: "message", id: "entry:live-voice", message: { id: "message:live-voice", role: "assistant", content: [{ type: "text", text: "Saved on the running PC" }] } };
  appendFileSync(sessionPath, `${JSON.stringify(liveMessage)}\n`);
  const historyAfterCommit = await catalog.history("canonical:test", { limit: 1, entryLocators: true });
  assert.deepEqual(historyAfterCommit.entries[0].message, liveMessage.message, "history must see a runtime append without a catalog listing first");
  assert.equal(historyAfterCommit.entries[0].historyEntryIndex, 4);
  assert.equal(historyAfterCommit.chat.title, "Canonical parity", "refreshing the file preserves catalog overrides");
  assert.equal(historyAfterCommit.chat.project, path.resolve(reassignedProject));

  const historicalToolEntries = [];
  for (let indexValue = 0; indexValue < 20; indexValue += 1) {
    const toolCallId = `tool:bulk:${indexValue}`;
    const toolName = indexValue === 0 ? "edit" : "read";
    historicalToolEntries.push({
      type: "message", id: `entry:bulk-assistant:${indexValue}`, timestamp: `2026-07-01T00:01:${String(indexValue).padStart(2, "0")}.000Z`,
      message: {
        id: `message:bulk-assistant:${indexValue}`, role: "assistant",
        content: [{ type: "toolCall", id: toolCallId, name: toolName, arguments: { path: `fixture-${indexValue}.txt` } }]
      }
    }, {
      type: "message", id: `entry:bulk-tool:${indexValue}`, timestamp: `2026-07-01T00:02:${String(indexValue).padStart(2, "0")}.000Z`,
      message: {
        id: `message:bulk-tool:${indexValue}`, role: "toolResult", toolCallId, toolName, isError: false,
        content: [
          { type: "text", text: `output-${indexValue}:${"x".repeat(10_000)}` },
          ...([0, 19].includes(indexValue) ? [{ type: "image", data: `fixture-image-${indexValue}`, mimeType: "image/png" }] : [])
        ]
      }
    });
  }
  appendFileSync(sessionPath, `${historicalToolEntries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
  await index.listProjects([project]);
  const eagerHistory = index.history("canonical:test", { limit: 100 });
  const lazyHistory = index.history("canonical:test", { limit: 100, toolResultBodies: "lazy-v1" });
  const deferredEntries = lazyHistory.entries.filter((entry) => entry.historyBodyRef);
  const onDemandHistory = index.history("canonical:test", { limit: 100, toolResultBodies: "lazy-desktop-v2" });
  const onDemandResults = onDemandHistory.entries.filter(entry => entry.message?.role === "toolResult");
  assert.equal(onDemandResults.length, 21);
  assert.ok(onDemandResults.every(entry => entry.historyBodyRef && !("content" in entry.message)), "Desktop defers every saved output, including the newest results");
  const onDemandLoaded = projectLoadedHistoryEntries(historicalToolEntries, 0, { toolResultBodies: "lazy-desktop-v2", canonicalChatId: "canonical:test" });
  assert.ok(onDemandLoaded.filter(entry => entry.message?.role === "toolResult").every(entry => entry.historyBodyRef), "SDK-backed history uses the same on-demand policy");
  assert.equal(deferredEntries.length, 6, "only the latest 15 of 21 tool results should keep eager bodies");
  assert.equal("content" in deferredEntries[0].message, false, "deferred history must distinguish an omitted body from a canonical empty result");
  assert.equal(deferredEntries.some((entry) => entry.historyBodyRef.toolName === "edit"), true, "old mutation results follow the same lazy-body policy");
  const deferredImageEntry = deferredEntries.find((entry) => entry.id === "entry:bulk-tool:0");
  assert.equal(deferredImageEntry.historyBodyRef.imageCount, 1, "deferred references preserve image metadata without embedding image bytes");
  assert.deepEqual(deferredImageEntry.historyBodyRef.contentTypes, ["text", "image"]);
  const eagerImageEntry = lazyHistory.entries.find((entry) => entry.id === "entry:bulk-tool:19");
  assert.equal(eagerImageEntry.message.content[1].data, "fixture-image-19", "the newest 15 tool results remain complete, including images");
  const pairedLatest = index.history("canonical:test", { limit: 1, toolResultBodies: "lazy-v1" });
  assert.deepEqual(pairedLatest.entries.map((entry) => entry.id), ["entry:bulk-assistant:19", "entry:bulk-tool:19"], "lazy pages keep a boundary tool result paired with its assistant tool call");
  const newestPage = index.history("canonical:test", { limit: 30, toolResultBodies: "lazy-v1" });
  const olderPage = index.history("canonical:test", { before: newestPage.pageInfo.oldestCursor, limit: 30, toolResultBodies: "lazy-v1" });
  assert.equal(olderPage.entries.filter((entry) => entry.message?.role === "toolResult").every((entry) => entry.historyBodyRef), true, "older pages do not create another eager-output window");
  assert.ok(JSON.stringify(lazyHistory).length < JSON.stringify(eagerHistory).length * 0.8, "deferred history must avoid transporting old tool outputs");
  const sidecar = readFileSync(path.join(stateDirectory, "chat-index-v3.json"), "utf8");
  assert.equal(sidecar.includes("output-0:"), false, "the rebuildable sidecar must never duplicate canonical output bodies");
  const hydrated = index.entryBody("canonical:test", deferredEntries[0].historyBodyRef);
  assert.match(hydrated.entry.message.content[0].text, /^file contents$|^output-/, "an indexed body reference must hydrate the exact canonical entry");
  const hydratedImage = index.entryBody("canonical:test", deferredImageEntry.historyBodyRef);
  assert.equal(hydratedImage.entry.message.content[1].data, "fixture-image-0", "on-demand hydration preserves canonical image bodies exactly");
  assert.equal((await index.searchToolResults("canonical:test", "fixture-image-0")).length, 0, "deferred search skips image payload bytes");
  assert.throws(
    () => index.entryBody("canonical:test", { ...deferredEntries[0].historyBodyRef, entryId: "wrong-entry" }),
    /does not match|stale/,
    "body hydration must reject stale or forged entry references"
  );
  assert.throws(
    () => index.entryBody("canonical:test", { ...deferredEntries[0].historyBodyRef, entrySha256: "0".repeat(64) }),
    /stale/,
    "body hydration must bind the reference to the exact canonical line"
  );

  appendFileSync(sessionPath, `${[
    { type: "message", id: "control-call", timestamp: "2026-07-01T01:00:00.000Z", message: { role: "assistant", content: [{ type: "toolCall", id: "question-call", name: "request_user_input", arguments: { questions: [] } }] } },
    { type: "message", id: "control-result", timestamp: "2026-07-01T01:00:01.000Z", message: { role: "toolResult", toolCallId: "question-call", toolName: "request_user_input", details: { requestId: "owned-question", cancelled: true }, content: [] } },
    { type: "message", id: "unnamed-control-call", timestamp: "2026-07-01T01:00:02.000Z", message: { role: "assistant", content: [{ type: "toolCall", id: "unnamed-question-call", name: "request_user_input", arguments: { questions: [] } }] } },
    { type: "custom", id: "question-wait-note", timestamp: "2026-07-01T01:00:02.500Z", customType: "session-metadata", data: { waiting: true } },
    { type: "message", id: "unnamed-control-result", timestamp: "2026-07-01T01:00:03.000Z", message: { role: "toolResult", toolCallId: "unnamed-question-call", details: { requestId: "owned-unnamed-question" }, content: [] } }
  ].map(entry => JSON.stringify(entry)).join("\n")}\n`);
  await index.listProjects([project]);
  const controlHistory = index.history("canonical:test", { limit: 4, toolResultBodies: "lazy-desktop-v2" });
  const controlResult = controlHistory.entries.find(entry => entry.id === "control-result");
  assert.equal(controlResult.message.details.requestId, "owned-question", "indexed on-demand history preserves interactive request ownership");
  assert.equal(controlResult.message.details.cancelled, true, "indexed history cannot revive cancelled question controls");
  assert.equal(controlResult.historyBodyRef, undefined, "question control results remain available independently of output disclosure");
  assert.equal(controlHistory.entries.find(entry => entry.id === "unnamed-control-result").message.details.requestId, "owned-unnamed-question", "indexed legacy control ownership follows its actual tool call");
  const gapHistory = index.history("canonical:test", { limit: 2, toolResultBodies: "lazy-desktop-v2" });
  assert.equal(gapHistory.entries.find(entry => entry.id === "unnamed-control-result")?.message.details?.requestId, "owned-unnamed-question", "a metadata-start page retains the owning question identity outside the page");
  assert.equal(gapHistory.entries.length, 2, "question ownership does not widen the requested history page");
  assert.equal(gapHistory.entries[1].message.toolName, "request_user_input", "an isolated legacy result identifies itself to receipt recovery");
  assert.equal("questionCallIds" in gapHistory.chat, false, "private question index metadata stays out of catalog DTOs");
  const reopened = new CanonicalChatIndex({ stateDirectory });
  assert.equal(reopened.history("canonical:test", { limit: 2, toolResultBodies: "lazy-desktop-v2" }).entries[1].message.details.requestId, "owned-unnamed-question", "resolved identity survives a cold index reopen");
  const oldIndex = JSON.parse(readFileSync(path.join(stateDirectory, "chat-index-v3.json"), "utf8"));
  for (const chat of Object.values(oldIndex.chats)) {
    delete chat.questionCallIds;
    delete chat.questionIdentityScanOffset;
    for (const result of chat.deferredToolResults) if (result.entryId === "unnamed-control-result") result.toolName = "tool";
  }
  writeFileSync(path.join(stateDirectory, "chat-index-v3.json"), JSON.stringify(oldIndex));
  const legacyIndex = new CanonicalChatIndex({ stateDirectory });
  assert.equal(legacyIndex.history("canonical:test", { limit: 2, toolResultBodies: "lazy-desktop-v2" }).entries[1].message.toolName, "request_user_input", "unchanged legacy indexes backfill identity when that chat opens");
  const allEntries = readFileSync(sessionPath, "utf8").trim().split("\n").map(line => JSON.parse(line)).filter(entry => entry.type !== "session");
  const sdkStart = allEntries.length - 2;
  const sdkPage = projectLoadedHistoryEntries(allEntries.slice(sdkStart), sdkStart, { toolResultBodies: "lazy-desktop-v2", canonicalChatId: "canonical:test", questionCallIds: historyQuestionCallIds(allEntries, sdkStart) });
  assert.equal(sdkPage[1].message.details.requestId, "owned-unnamed-question", "SDK fallback preserves control ownership across page gaps");
  assert.equal(sdkPage[1].message.toolName, "request_user_input");
  const unnamedOutput = projectLoadedHistoryEntries([{ type: "message", id: "unnamed-output", message: { role: "toolResult", toolCallId: "ordinary-call", content: [{ type: "text", text: "large display output" }] } }], 0, { toolResultBodies: "lazy-desktop-v2", canonicalChatId: "canonical:test" });
  assert.ok(unnamedOutput[0].historyBodyRef, "ordinary unnamed outputs remain on demand instead of making legacy history eager");
  process.stdout.write("zyra incremental chat index tests passed\n");
} finally {
  rmSync(root, { recursive: true, force: true });
}
