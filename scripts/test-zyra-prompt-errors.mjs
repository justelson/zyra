import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runZyraPrintPrompt, runZyraPrompt, queueZyraMidRunInput, setProfile } from "../src/zyra-sdk.mjs";
import { convertToLlm } from '../src/runtime/engine/src/core/messages.js';

function createRuntime(finalMessage) {
  const entries = [];
  const session = {
    state: { messages: [] },
    agent: { state: { systemPrompt: "" } },
    sessionManager: {
      getEntries: () => entries,
      getSessionId: () => undefined,
      getSessionFile: () => undefined,
    },
    async prompt(text, options) {
      this.observedPrompt = text;
      this.observedPromptOptions = options;
      this.observedSystemPrompt = this.agent.state.systemPrompt;
      for (const message of options?.contextMessages || []) {
        this.observedContextMessages?.push(message);
        this.state.messages.push({ role: 'custom', timestamp: Date.now(), ...message });
      }
      this.state.messages.push({ role: 'user', content: [{ type: 'text', text }], timestamp: Date.now() });
      this.state.messages.push(finalMessage);
      entries.push({ type: "message", message: finalMessage });
    },
  };
  return { project: process.cwd(), session };
}

function createClientRuntime(project) {
  let systemPrompt = "";
  return {
    project,
    session: {
      state: { messages: [] },
      agent: {
        getSystemPrompt: () => systemPrompt,
        setSystemPrompt: (value) => { systemPrompt = String(value || ""); },
      },
      sessionManager: {
        getEntries: () => [],
        getSessionId: () => undefined,
        getSessionFile: () => undefined,
      },
    },
    get systemPrompt() { return systemPrompt; },
  };
}

const tempProject = mkdtempSync(path.join(os.tmpdir(), "zyra-client-runtime-"));
try {
  const clientRuntime = createClientRuntime(tempProject);
  for (const legacyProfile of ["default", "learner", "builder"]) {
    assert.equal(setProfile(clientRuntime, legacyProfile), "concise", 'legacy built-in profiles resolve to the current default speaking style');
  }
  assert.match(clientRuntime.systemPrompt, /ZYRA_ACTIVE_PROFILE/);
} finally {
  rmSync(tempProject, { recursive: true, force: true });
}

const usageLimitMessage = {
  role: "assistant",
  content: [],
  stopReason: "error",
  errorMessage: "Codex error: The usage limit has been reached",
};

await assert.rejects(
  runZyraPrompt(createRuntime(usageLimitMessage), "hello"),
  /Codex error: The usage limit has been reached/,
);

await assert.rejects(
  runZyraPrompt(createRuntime({ role: "assistant", content: [], stopReason: "aborted" }), "hello"),
  /Request aborted/,
);

await assert.doesNotReject(
  runZyraPrompt(createRuntime({ role: "assistant", content: [{ type: "text", text: "ok" }], stopReason: "stop" }), "hello"),
);

assert.equal(
  await runZyraPrintPrompt(
    createRuntime({ role: "assistant", content: [{ type: "text", text: "print ok" }], stopReason: "stop" }),
    "hello",
  ),
  "print ok",
);

console.log("Zyra prompt error propagation checks passed.");

const worktreeRuntime = createRuntime({ role: 'assistant', content: [{ type: 'text', text: 'ok' }], stopReason: 'stop' });
await runZyraPrompt(worktreeRuntime, 'Fix the selected file.', { startInNewWorktree: true });
assert.equal(worktreeRuntime.session.observedPrompt, 'Fix the selected file.', 'The setup preference does not alter the visible user prompt');
assert.match(worktreeRuntime.session.observedSystemPrompt, /ZYRA_NEW_WORKTREE/);
assert.match(worktreeRuntime.session.observedSystemPrompt, /create a new isolated Git worktree/);
assert.doesNotMatch(worktreeRuntime.session.agent.state.systemPrompt, /ZYRA_NEW_WORKTREE/, 'Setup context is removed after the turn');
await runZyraPrompt(worktreeRuntime, 'Continue.');
assert.doesNotMatch(worktreeRuntime.session.observedSystemPrompt, /ZYRA_NEW_WORKTREE/, 'Later prompts cannot inherit the setup request');
const failedWorktreeRuntime = createRuntime(usageLimitMessage);
await assert.rejects(runZyraPrompt(failedWorktreeRuntime, 'Fix it.', { startInNewWorktree: true }), /usage limit/);
assert.doesNotMatch(failedWorktreeRuntime.session.agent.state.systemPrompt, /ZYRA_NEW_WORKTREE/, 'A failed turn also clears the temporary request');
await assert.rejects(runZyraPrompt(worktreeRuntime, 'Fix it.', { startInNewWorktree: 'yes' }), /Invalid worktree choice/);
console.log('Hidden worktree setup context, original prompt, later prompts and failure cleanup passed.');

const skillFixture = mkdtempSync(path.join(os.tmpdir(), 'zyra-skill-context-'));
try {
  const skillPath = path.join(skillFixture, 'SKILL.md');
  writeFileSync(skillPath, '# Fixture skill\n\nSynthetic skill instructions for this test.');
  const skillRuntime = createRuntime({ role: 'assistant', content: [{ type: 'text', text: 'ok' }], stopReason: 'stop' });
  const skillMessages = [];
  skillRuntime.session.observedContextMessages = skillMessages;
  skillRuntime.resourceLoader = { getSkills: () => ({ skills: [{ name: 'fixture-skill', filePath: skillPath }] }) };
  skillRuntime.session.sendCustomMessage = async (message, options) => {
    skillMessages.push({ ...message, options });
    skillRuntime.session.state.messages.push({ role: 'custom', timestamp: Date.now(), ...message });
  };
  await runZyraPrompt(skillRuntime, '/skill:fixture-skill whats this for?');
  assert.equal(skillRuntime.session.observedPrompt, '/skill:fixture-skill whats this for?', 'The user prompt remains the visible prompt; skill instructions are not a second user message');
  assert.equal(skillMessages.length, 1);
  assert.equal(skillMessages[0].display, false);
  assert.equal(skillRuntime.session.observedPromptOptions.contextMessages.length, 1, 'Skill context is submitted as part of the accepted original prompt, not as an independent turn');
  assert.match(skillMessages[0].content, /Synthetic skill instructions/);
  assert.equal(skillRuntime.session.observedPromptOptions.expandPromptTemplates, false, 'The native SDK cannot expand the visible reference again');
  const modelRequestText = convertToLlm(skillRuntime.session.state.messages).flatMap(message => typeof message.content === 'string' ? [message.content] : message.content.filter(block => block.type === 'text').map(block => block.text)).join('\n');
  assert.equal(modelRequestText.split('whats this for?').length - 1, 1, 'Actual model context must receive the skill request only once');
  assert.match(convertToLlm(skillRuntime.session.state.messages)[0].content[0].text, /Synthetic skill instructions/, 'Hidden skill context still reaches the actual model-message transformer');
  for (const failure of ['Synthetic failed preflight compaction', 'Synthetic cancelled preflight compaction']) {
    const rejected = createRuntime({ role: 'assistant', content: [], stopReason: 'stop' });
    rejected.resourceLoader = skillRuntime.resourceLoader;
    rejected.session.model = { contextWindow: 400_000 };
    rejected.session.getContextUsage = () => ({ tokens: 390_000, contextWindow: 400_000 });
    rejected.session.sessionManager.getEntries().push({ type: 'message', message: { role: 'user', content: 'Earlier request' } });
    const pendingContext = [];
    rejected.session.sendCustomMessage = async message => { pendingContext.push(message); rejected.session.state.messages.push({ role: 'custom', ...message }); };
    rejected.session.compact = async () => { throw new Error(failure); };
    await assert.rejects(runZyraPrompt(rejected, '/skill:fixture-skill rejected request'), new RegExp(failure));
    assert.equal(pendingContext.length, 0, 'Rejected preflight must not persist orphan skill instructions');
    assert.equal(rejected.session.observedPrompt, undefined);
    assert.equal(rejected.session.state.messages.length, 0);
  }
  await runZyraPrintPrompt(skillRuntime, '/skill:fixture-skill describe it');
  assert.equal(skillRuntime.session.observedPrompt, '/skill:fixture-skill describe it', 'Print prompts retain the same context boundary');
  assert.equal(skillMessages.length, 2);
  assert.doesNotMatch(skillMessages.at(-1).content, /User: describe it/, 'Print skill context excludes the repeated user request');
  skillRuntime.session.isStreaming = true;
  for (const mode of ['steer', 'queue']) {
    assert.equal(await queueZyraMidRunInput(skillRuntime, '/skill:fixture-skill continue', { mode }), mode);
    const delivery = mode === 'queue' ? 'followUp' : 'steer';
    assert.equal(skillRuntime.session.observedPromptOptions.streamingBehavior, delivery, 'Skill context shares the original queued prompt delivery');
    assert.equal(skillRuntime.session.observedPrompt, '/skill:fixture-skill continue');
    assert.doesNotMatch(skillMessages.at(-1).content, /User: continue/, 'Queued and steering skill context excludes the repeated request');
    assert.equal(skillRuntime.session.observedPromptOptions.streamingBehavior, delivery);
    assert.equal(skillRuntime.session.observedPromptOptions.expandPromptTemplates, false);
  }
} finally {
  rmSync(skillFixture, { recursive: true, force: true });
}
console.log('Explicit skills use hidden model context and preserve the visible user prompt.');
