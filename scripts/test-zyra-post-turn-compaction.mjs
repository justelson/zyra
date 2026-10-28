import assert from "node:assert/strict";
import { runZyraPrompt, runZyraPrintPrompt, compactZyraContextBeforePrompt } from "../src/zyra-sdk.mjs";

function fixture({ stopReason = "stop", afterTokens = 260_000, enabled = true, failCompaction = false } = {}) {
  const events = [];
  const entries = [];
  let tokens = 1_000;
  const finalMessage = { role: "assistant", stopReason, content: [{ type: "text", text: "Finished answer" }], errorMessage: stopReason === "error" ? "provider failed" : undefined };
  const runtime = {
    project: process.cwd(), contextCompactionThresholdTokens: 256_000,
    reasoningSummaryState: { value: "detailed" },
    session: {
      state: { messages: [] }, agent: { state: { systemPrompt: "" } },
      model: { id: 'synthetic', provider: 'test', contextWindow: 400_000, auto_compact_token_limit: 256_000 }, autoCompactionEnabled: enabled,
      isStreaming: false, isCompacting: false,
      getContextUsage: () => ({ tokens, contextWindow: 400_000, percent: tokens / 4_000 }),
      sessionManager: { getEntries: () => entries, getBranch: () => entries, getSessionId: () => undefined, getSessionFile: () => undefined },
      async prompt() {
        events.push("prompt"); this.isStreaming = true;
        await Promise.resolve();
        this.state.messages.push(finalMessage); entries.push({ type: "message", message: finalMessage });
        tokens = afterTokens; this.isStreaming = false; events.push("answer");
      },
      async compact() {
        assert.equal(this.isStreaming, false, "completed response only");
        assert.equal(runtime.reasoningSummaryState.value, "concise");
        events.push("compact");
        if (failCompaction) throw new Error("summary unavailable");
        entries.push({ type: "compaction" }); tokens = 30_000;
        this.state.messages = [{ role: "compactionSummary" }];
      },
    },
  };
  return { runtime, events };
}
const completed = fixture();
await runZyraPrompt(completed.runtime, "hello");
assert.deepEqual(completed.events, ["prompt", "answer", "compact"], "threshold maintenance happens before the previous prompt resolves");
assert.equal(completed.runtime.reasoningSummaryState.value, "detailed");
assert.equal((await compactZyraContextBeforePrompt(completed.runtime, "next prompt")).compacted, false);
assert.equal(completed.events.filter(x => x === "compact").length, 1, "next prompt avoids duplicate compaction");
const print = fixture();
assert.equal(await runZyraPrintPrompt(print.runtime, "hello"), "Finished answer", "compaction cannot replace the completed answer returned by print");
assert.deepEqual(print.events, ["prompt", "answer", "compact"]);
for (const options of [{ afterTokens: 220_000 }, { enabled: false }, { stopReason: "toolUse" }]) {
  const current = fixture(options); await runZyraPrompt(current.runtime, "hello");
  assert.deepEqual(current.events, ["prompt", "answer"]);
}
for (const stopReason of ["error", "aborted"]) {
  const current = fixture({ stopReason });
  await assert.rejects(runZyraPrompt(current.runtime, "hello"));
  assert.deepEqual(current.events, ["prompt", "answer"], "error/retry/aborted lifecycle belongs to Pi");
}
const failed = fixture({ failCompaction: true });
await assert.doesNotReject(runZyraPrompt(failed.runtime, "hello"), "failed maintenance cannot invalidate a delivered answer");
assert.equal(failed.runtime.reasoningSummaryState.value, "detailed");
await assert.rejects(compactZyraContextBeforePrompt(failed.runtime, "next prompt"), /summary unavailable/, "preflight still protects a later prompt after failed maintenance");
console.log("Post-turn compaction lifecycle checks passed.");
