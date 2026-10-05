import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendCanonicalMessage, findCanonicalMessageReceipt } from "../src/agent-server/canonical-message-ledger.mjs";

class FakeSessionManager {
  constructor(entries = []) {
    this.entries = entries;
    this.next = entries.length + 1;
  }

  getEntries() {
    return this.entries;
  }

  appendMessage(message) {
    const id = `entry_${this.next++}`;
    this.entries.push({ type: "message", id, message });
    return id;
  }
}

const manager = new FakeSessionManager();
const base = {
  operationId: "op_voice_1",
  idempotencyKey: "voice:one",
  conversationId: "conversation_old_or_new",
  messageId: "voice_user_1",
  role: "user",
  producer: "user",
  modality: "voice",
  text: "This speech belongs to the existing chat.",
  attachmentIds: [],
  providerItemId: "provider_turn_1",
  providerCompletedAt: "2026-08-09T04:00:01.000Z",
  payloadSha256: "a".repeat(64),
  routeClaim: {
    foregroundRouteId: "route_voice_2",
    routeEpoch: 2,
    ownerClaimId: "claim_voice_2"
  }
};

const first = appendCanonicalMessage(manager, base);
assert.equal(first.canonicalSequence, 1);
assert.equal(first.canonicalMessageId, base.messageId);
assert.equal(manager.entries.length, 1);
assert.equal(manager.entries[0].message.role, "user");
assert.equal(manager.entries[0].message.zyraCanonicalMessage.operationId, base.operationId);

const replay = appendCanonicalMessage(manager, structuredClone(base));
assert.deepEqual(replay, first);
assert.equal(manager.entries.length, 1);
assert.deepEqual(findCanonicalMessageReceipt(manager, base.operationId), first);

const assistant = appendCanonicalMessage(manager, {
  ...base,
  operationId: "op_voice_2",
  idempotencyKey: "voice:two",
  messageId: "voice_assistant_1",
  role: "assistant",
  producer: "realtime_foreground",
  text: "And the answer is durable too.",
  providerItemId: "provider_turn_2",
  payloadSha256: "b".repeat(64)
});
assert.equal(assistant.canonicalSequence, 2);
assert.equal(manager.entries[1].message.role, "assistant");
assert.equal(manager.entries[1].message.stopReason, "stop");

const narrationManager = new FakeSessionManager();
const narration = { ...base, providerStartedAt: "2026-08-09T04:00:00.000Z" };
appendCanonicalMessage(narrationManager, narration);
assert.equal(narrationManager.entries[0].message.timestamp, Date.parse(narration.providerStartedAt), "durable history orders speech by its beginning, not its completion");
assert.equal(narrationManager.entries[0].message.zyraCanonicalMessage.providerCompletedAt, base.providerCompletedAt);
assert.throws(() => appendCanonicalMessage(new FakeSessionManager(), { ...base, providerStartedAt: "invalid" }), /timestamp is invalid/);
assert.throws(() => appendCanonicalMessage(new FakeSessionManager(), { ...base, providerStartedAt: "2026-08-09T04:00:02.000Z" }), /start.*completion/);

const reopened = new FakeSessionManager(structuredClone(manager.entries));
assert.deepEqual(findCanonicalMessageReceipt(reopened, base.operationId), first);
assert.throws(() => appendCanonicalMessage(reopened, { ...base, payloadSha256: "c".repeat(64) }), /different message payload/);
assert.throws(() => appendCanonicalMessage(reopened, {
  ...base,
  operationId: "op_voice_3",
  payloadSha256: "d".repeat(64)
}), /identity is already bound/);

// A Voice-first new thread must persist the user turn before an assistant reply exists.
const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "zyra-voice-ledger-"));
try {
  const { SessionManager } = await import("../src/runtime/engine/src/index.js");
  const piManager = SessionManager.create(temporaryDirectory, temporaryDirectory, { id: "voice-ledger-new-thread" });
  const sessionFile = piManager.getSessionFile();
  assert.equal(existsSync(sessionFile), false);
  appendCanonicalMessage(piManager, {
    ...base,
    operationId: "op_voice_new_thread_user",
    idempotencyKey: "voice:new:user",
    conversationId: "voice-ledger-new-thread",
    messageId: "voice_user_new_thread",
    providerStartedAt: narration.providerStartedAt,
    payloadSha256: "e".repeat(64)
  });
  assert.equal(existsSync(sessionFile), true, "the first completed spoken user turn must be durable immediately");
  assert.equal(readFileSync(sessionFile, "utf8").trim().split("\n").length, 2);
  appendCanonicalMessage(piManager, {
    ...base,
    operationId: "op_voice_new_thread_assistant",
    idempotencyKey: "voice:new:assistant",
    conversationId: "voice-ledger-new-thread",
    messageId: "voice_assistant_new_thread",
    role: "assistant",
    producer: "realtime_foreground",
    providerItemId: "provider_new_assistant",
    text: "The new thread remains appendable after the forced first-user flush.",
    payloadSha256: "f".repeat(64)
  });
  const reopenedPi = SessionManager.open(sessionFile, temporaryDirectory);
  const savedMessages = reopenedPi.getEntries().filter((entry) => entry.type === "message");
  assert.equal(savedMessages.length, 2);
  assert.equal(savedMessages[0].message.timestamp, Date.parse(narration.providerStartedAt), "reopening preserves speech's original position before later work");
  assert.equal(savedMessages[0].message.zyraCanonicalMessage.providerCompletedAt, base.providerCompletedAt);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log("zyra canonical message ledger tests passed");
