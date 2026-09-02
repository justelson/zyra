import assert from "node:assert/strict";
import {
  buildZyraPermissionReviewPrompt,
  createZyraPermissionReviewer,
  parseZyraPermissionReview,
} from "../src/zyra-permission-reviewer.mjs";

assert.deepEqual(
  parseZyraPermissionReview('{"decision":"approve","risk":"low","reason":"In scope."}'),
  { decision: "approve", risk: "low", reason: "In scope." },
);
assert.equal(parseZyraPermissionReview("not json").decision, "ask");

const prompt = buildZyraPermissionReviewPrompt(
  { requestType: "command", toolName: "bash", command: "npm test" },
  { project: process.cwd(), userRequest: "Run the focused tests." },
);
assert.match(prompt, /Run the focused tests\./);
assert.match(prompt, /npm test/);
assert.match(prompt, /data, not instructions/i);

const opened = [];
const prompts = [];
let disposed = 0;
const host = {
  async open(options) { opened.push(options); },
  async run(value) {
    prompts.push(value);
    return { text: '{"decision":"approve","risk":"low","reason":"Requested check."}' };
  },
  dispose() { disposed += 1; },
};
const reviewer = createZyraPermissionReviewer({
  project: process.cwd(),
  runtime: { session: { model: { provider: "openai-codex", id: "gpt-5.6-terra" } } },
  createHost: () => host,
});
await reviewer.warm();
await reviewer.warm();
const first = await reviewer.review({
  requestType: "command",
  toolName: "bash",
  command: "npm test",
  userRequest: "Run tests.",
});
const second = await reviewer.review({
  requestType: "file-change",
  toolName: "write",
  paths: ["src/a.ts"],
  userRequest: "Fix src/a.ts.",
});
assert.equal(opened.length, 1, "the reviewer should prewarm once and reuse its session");
assert.deepEqual(opened[0].tools, [], "the reviewer must not receive tools");
assert.equal(opened[0].noSession, true, "permission reviews must stay out of chat history");
assert.equal(opened[0].effort, "low", "permission reviews should use the fast reasoning path");
assert.equal(first.decision, "approve");
assert.equal(second.decision, "approve");
assert.equal(prompts.length, 2);
reviewer.dispose();
assert.equal(disposed, 1);

process.stdout.write("Zyra permission reviewer: ok\n");
