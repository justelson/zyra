#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readImageDimensions } from "../src/clipboard-image.mjs";
import { buildProfileChangePrompt, handleSlash } from "../src/slash-command-handlers.mjs";
import { getSlashCommand } from "../src/slash-commands.mjs";
import { getSlashSuggestions } from "../src/slash-suggestions.mjs";
import { markOnboardingComplete, readOnboardingState, shouldRunOnboarding } from "../src/onboarding.mjs";
import { projectHistoryEntries } from "../src/agent-server/tui-runtime.mjs";
import { AssistantMessageLifecycle, createZyraUi, mergeAssistantTextDelta } from "../src/zyra-ui.mjs";
import { ZYRA_RETRY_BASE_DELAY_MS, ZYRA_RETRY_MAX_ATTEMPTS } from "../src/network-recovery.mjs";
import { applyZyraChatRetryPolicy, getZyraAvailableThinkingLevels, getZyraModelThinkingLevels, getZyraThinkingLevel, registerZyraRuntimeModels, resolveZyraStartupPreferences, setModel, setProfile, setThinking, setWebFetch, setWebSearch, setZyraTheme, syncZyraThinkingLevel } from "../src/zyra-sdk.mjs";
import { applyGpt56ThinkingEffort, GPT_56_THINKING_LEVELS } from "../src/thinking-levels.mjs";
import { PI_SUPPORT_PENDING_STATUS } from "../src/model-compatibility.mjs";
import { renderStatusLine } from "../src/status-line.mjs";
import { buildTerminalTheme } from "../src/terminal-theme.mjs";
import { renderAccountStatusBox, renderCodexUsageBox, renderStatusBox } from "../src/terminal-blocks.mjs";
import { ZyraComponentHost, EditorComponent, StaticLinesComponent, UserMessageComponent, renderToolBlock } from "../src/tui/zyra-tui.mjs";
import { renderLinesWithinWidth, stripAnsi } from "../src/tui/render-utils.mjs";

function assistantMessage(text = "", id = "assistant-1", stopReason = "stop") {
  return { id, role: "assistant", stopReason, content: text ? [{ type: "text", text }] : [] };
}

function updateEvent(text, delta, id = "assistant-1") {
  return {
    type: "message_update",
    message: assistantMessage(text, id),
    assistantMessageEvent: delta === undefined ? { type: "text_start" } : { type: "text_delta", delta },
  };
}

function deltaOnlyEvent(delta, id = "assistant-1") {
  return {
    type: "message_update",
    message: assistantMessage("", id),
    assistantMessageEvent: { type: "text_delta", delta },
  };
}

function runDeltaStreamingRegression() {
  const lifecycle = new AssistantMessageLifecycle();
  lifecycle.start(assistantMessage());
  lifecycle.update(updateEvent("Yep.", "Yep."));
  lifecycle.update(updateEvent("Yep. Here", " Here"));

  assert.equal(lifecycle.hasTransient(), true);
  assert.equal(lifecycle.getTransient().text, "Yep. Here");

  const committed = lifecycle.end(assistantMessage("Yep. Here"));
  assert.equal(committed.text, "Yep. Here");
  assert.equal(lifecycle.hasTransient(), false);
  assert.equal(lifecycle.end(assistantMessage("Yep. Here")), null, "same final assistant message must not commit twice");
}

function runFullSnapshotRegression() {
  const lifecycle = new AssistantMessageLifecycle();
  lifecycle.start(assistantMessage());

  const snapshots = [
    "Yep. Here’s the useful recap:",
    "Yep. Here’s the useful recap:\n\nYou asked where the original Zyra project was.",
    "Yep. Here’s the useful recap:\n\nYou asked where the original Zyra project was. I found:",
  ];

  for (const snapshot of snapshots) {
    lifecycle.update(updateEvent(snapshot));
    assert.equal(lifecycle.getTransient().text, snapshot);
  }

  const committed = lifecycle.end(assistantMessage(snapshots.at(-1)));
  assert.equal(committed.text, snapshots.at(-1));
  assert.equal(lifecycle.hasTransient(), false);
}

function runRepeatedSnapshotRegression() {
  const lifecycle = new AssistantMessageLifecycle();
  lifecycle.start(assistantMessage());

  const snapshot = "```text\nC:\\Users\\dev\\my_coding_play\\zyra\n```";
  lifecycle.update(updateEvent(snapshot));
  lifecycle.update(updateEvent(snapshot));
  lifecycle.update(updateEvent(snapshot));

  assert.equal(lifecycle.getTransient().text, snapshot, "repeated identical snapshots keep one authoritative message state");
  const committed = lifecycle.end(assistantMessage(snapshot));
  assert.equal(committed.text, snapshot);
  assert.equal(lifecycle.end(assistantMessage(snapshot)), null);
}

function runMarkdownCodeBlockRegression() {
  const lifecycle = new AssistantMessageLifecycle();
  lifecycle.start(assistantMessage());
  const markdown = [
    "Strong delete candidates:",
    "",
    "```text",
    "C:\\Users\\dev\\my_coding_play\\playground\\clean-dashboard-preview",
    "C:\\Users\\dev\\my_coding_play\\playground\\docs",
    "```",
  ].join("\n");

  lifecycle.update(updateEvent(markdown));
  assert.equal(lifecycle.getTransient().text, markdown);
  assert.equal(lifecycle.end(assistantMessage(markdown)).text, markdown);
}

function runMergeHelperRegression() {
  assert.equal(mergeAssistantTextDelta("Yep.", " Yep again."), "Yep. Yep again.");
  assert.equal(mergeAssistantTextDelta("Yep.", "Yep."), "Yep.");
  assert.equal(mergeAssistantTextDelta("Yep.", "Yep. Here"), "Yep. Here");
  assert.equal(mergeAssistantTextDelta("Sure.", "Sure.\n\nThe day arrives"), "Sure.\n\nThe day arrives");
  assert.equal(mergeAssistantTextDelta("Sure.\n\nSure.", "Sure.\n\nThe day arrives"), "Sure.\n\nThe day arrives");
  assert.equal(mergeAssistantTextDelta("The day arrives", "arrives without asking"), "The day arrives without asking");
}

function runSnapshotDeltaPollutionRegression() {
  const lifecycle = new AssistantMessageLifecycle();
  lifecycle.start(assistantMessage());

  lifecycle.update(deltaOnlyEvent("Sure."));
  lifecycle.update(deltaOnlyEvent("Sure.\n\nThe day arrives without asking,"));
  lifecycle.update(deltaOnlyEvent("Sure.\n\nThe day arrives without asking,\nsoft-footed at the window,"));

  assert.equal(
    lifecycle.getTransient().text,
    "Sure.\n\nThe day arrives without asking,\nsoft-footed at the window,",
    "snapshot-shaped text_delta events must replace/overlap, not append repeated prefixes",
  );
}

function captureStdout(fn) {
  const originalWrite = process.stdout.write.bind(process.stdout);
  let captured = "";
  process.stdout.write = (chunk, encoding, callback) => {
    captured += String(chunk);
    if (typeof encoding === "function") encoding();
    if (typeof callback === "function") callback();
    return true;
  };
  try {
    fn(() => captured);
  } finally {
    process.stdout.write = originalWrite;
  }
  return captured;
}

function runUiEventCaptureRegression() {
  const captured = captureStdout((getCaptured) => {
    const ui = createZyraUi();
    ui.event({ type: "message_start", message: assistantMessage() });
    ui.event(updateEvent("Yep. Here’s the useful recap:"));
    ui.event(updateEvent("Yep. Here’s the useful recap:"));
    ui.event(updateEvent("Yep. Here’s the useful recap:\n\nYou asked where the original Zyra project was."));
    ui.event({
      type: "message_end",
      message: assistantMessage("Yep. Here’s the useful recap:"),
    });
    assert.equal(getCaptured().includes("Yep"), false, "assistant text must not print before the turn boundary");
    ui.event({
      type: "message_end",
      message: assistantMessage("Yep. Here’s the useful recap:\n\nYou asked where the original Zyra project was."),
    });
    assert.equal(getCaptured().includes("Yep"), false, "later message_end snapshots must still wait for agent_end/turn_end");
    ui.event({ type: "agent_end" });
    ui.event({ type: "agent_end" });
  });

  assert.equal(
    (captured.match(/Yep/g) ?? []).length,
    1,
    `UI event path must commit the assistant answer once, not redraw snapshots into transcript. Captured:\n${captured}`,
  );
  assert.match(captured, /You asked where the original Zyra project was/);
  const plain = stripAnsi(captured);
  assert.match(plain, /─{20,}[\s\S]*Yep/, "the final response begins below one clear divider after live work flags");
}

function runNarrationFinalDividerRegression() {
  const captured = captureStdout(() => {
    const ui = createZyraUi();
    const narration = assistantMessage("I’ll inspect the source first.", "assistant-narration", "toolUse");
    ui.event({ type: "message_start", message: narration });
    ui.event({ type: "message_end", message: narration });
    ui.event({ type: "turn_end" });

    const final = assistantMessage("The source is fixed.", "assistant-final", "stop");
    ui.event({ type: "message_start", message: final });
    ui.event({ type: "message_end", message: final });
    ui.event({ type: "agent_end" });
  });
  const plain = stripAnsi(captured);
  const narrationIndex = plain.indexOf("I’ll inspect the source first.");
  const dividerIndex = plain.search(/─{20,}/);
  const finalIndex = plain.indexOf("The source is fixed.");

  assert.equal((plain.match(/─{20,}/g) ?? []).length, 1, "one semantic divider belongs to the final response only");
  assert.equal(narrationIndex >= 0 && dividerIndex > narrationIndex, true, "narration renders before the final-response divider");
  assert.equal(finalIndex > dividerIndex, true, "the final response begins below its divider");
}

function runToolOutputStyleRegression() {
  const captured = captureStdout(() => {
    const ui = createZyraUi();
    ui.event({
      type: "tool_execution_end",
      toolName: "bash",
      toolCallId: "tool-1",
      args: { command: "git remote -v" },
      result: {
        content: [{ type: "text", text: "origin https://github.com/justelson/elxnplus.git (fetch)" }],
      },
    });
  });

  assert.equal(captured.includes("summary ..."), false);
  assert.equal(captured.includes("╭"), false, "tool output should not use the accidental new rounded-box style");
  assert.match(stripAnsi(captured), /succeeded/);
  assert.doesNotMatch(stripAnsi(captured), /bash succeeded/);
  assert.match(stripAnsi(captured), /git remote -v/);
}

function runPiLikeToolPresentationRegression() {
  const lines = renderToolBlock({
    state: "done",
    toolName: "bash",
    args: { command: "printf 'Known skill dirs named like design notes...\\n'" },
    result: { content: [{ type: "text", text: "Known skill dirs named like design notes...\nC:\\Users\\dev\\.agents\\skills\\perfect-design\\SKILL.md" }] },
    durationMs: 19600,
  }, undefined, 110).map(stripAnsi);
  const meaningful = lines.filter((line) => line.trim().length > 0);

  assert.match(meaningful[0], /^\s*\$ printf/);
  assert.match(meaningful[0], /19\.6s succeeded\s*$/);
  assert.equal(meaningful.some((line) => line.includes("Known skill dirs named like design notes")), true);
  assert.equal(meaningful.some((line) => line.includes("Took 19.6s")), false);
  assert.equal(meaningful.every((line) => line.length <= 110), true);
}

function runToolCommandInlineRunningTimeRegression() {
  const startedAt = Date.now() - 2400;
  const lines = renderToolBlock({
    state: "running",
    toolName: "bash",
    args: { command: "find \"$USERPROFILE\" -type f", timeoutMs: 30000 },
    startedAt,
  }, undefined, 96).map(stripAnsi);
  const commandLine = lines.find((line) => line.includes("$ find"));

  assert.match(commandLine, /bash running 2\.[0-9]s \(timeout 30s\)\s*$/);
  assert.equal(lines.some((line) => line.includes("status started")), false);
}

function runToolCommandMultilineRegression() {
  const startedAt = Date.now() - 1400;
  const rendered = renderToolBlock({
    state: "running",
    toolName: "bash",
    args: {
      command: "python - <<'PY'\nfrom pathlib import Path\nfrom textwrap import dedent\nout = Path.home() / 'Downloads' / 'anything-huge.md'",
      timeout: 20,
    },
    startedAt,
  }, undefined, 96);
  const lines = rendered.map(stripAnsi);
  const meaningful = lines.filter((line) => line.trim().length > 0);

  assert.equal(rendered.every((line) => !line.includes("\n")), true, "multiline commands should render as physical rows");
  assert.match(meaningful[0], /^\s*\$ python - <<'PY'/);
  assert.match(meaningful[0], /bash running 1\.[0-9]s \(timeout 20s\)\s*$/);
  assert.equal(meaningful.some((line) => line.trim() === "from pathlib import Path"), false);
  assert.equal(meaningful.some((line) => line.trim() === "from textwrap import dedent"), false);
  assert.equal(meaningful.filter((line) => line.includes("python - <<")).length, 1);
  assert.equal(lines[1].trim(), "", "tool block should include Pi-like top inner padding");
  assert.equal(lines[lines.length - 2].trim(), "", "tool block should include Pi-like bottom inner padding");
  assert.equal(lines.every((line) => line.length <= 96), true);
}

function runToolLongCommandAndHugeOutputClampRegression() {
  const hugeSourceMapLine = `C:/Users/dev/my_coding_play/zyra/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.d.ts.map:1:${"{\"version\":3,\"sourcesContent\":["}${"x".repeat(1200)}`;
  const lines = renderToolBlock({
    state: "running",
    toolName: "bash",
    args: {
      command: 'grep -R "customTools" -n C:/Users/dev/my_coding_play/zyra/node_modules/@earendil-works/pi-coding-agent/dist C:/Users/dev/my_coding_play/zyra/node_modules/@earendil-works/pi-coding-agent/src 2>/dev/null | head -40',
    },
    partialResult: { content: [{ type: "text", text: hugeSourceMapLine }] },
    startedAt: Date.now() - 1400,
  }, undefined, 96).map(stripAnsi);
  const meaningful = lines.filter((line) => line.trim().length > 0);
  const commandRows = meaningful.filter((line) => line.includes("$ grep"));
  const outputRows = meaningful.filter((line) => !line.includes("$ grep"));

  assert.equal(commandRows.length, 1, "long tool commands should stay in one compact header row");
  assert.equal(meaningful.some((line) => line.trim().startsWith("ng_play/zyra")), false, "command paths should not wrap into orphan continuation rows");
  assert.equal(outputRows.length > 0, true, "tool output should still show a bounded preview");
  assert.equal(outputRows.some((line) => line.includes("C:/Users/dev")), true, "tool output preview should keep the start of the long line");
  assert.equal(meaningful.join("\n").includes("x".repeat(400)), false, "huge single-line output should be previewed, not dumped");
  assert.equal(lines.every((line) => line.length <= 96), true);
  assert.equal(meaningful.length <= 8, true, "giant source-map output should not make the tool block huge");
}

function runToolOutputUsesFullBlockWidthRegression() {
  const longOutput = "0123456789".repeat(12);
  const lines = renderToolBlock({
    state: "done",
    toolName: "bash",
    args: { command: "printf long-output" },
    result: { content: [{ type: "text", text: longOutput }] },
    durationMs: 1200,
  }, undefined, 80).map(stripAnsi);
  const outputRows = lines.filter((line) => line.includes("0123456789"));

  assert.equal(outputRows.length, 1, "command output should stay on one bounded preview row instead of growing the card");
  assert.equal(outputRows[0].trim().startsWith(longOutput.slice(0, 30)), true, "the preview should preserve the beginning of single-line output");
  assert.equal(outputRows[0].includes("..."), true, "oversized single-line output should make truncation visible");
  assert.equal(lines.every((line) => line.length <= 80), true);
}

function runCommandCardStableHeightRegression() {
  const startedAt = Date.now() - 5000;
  const base = {
    toolName: "bash",
    args: { action: "run", command: "rg -n compact node_modules", timeout: 30 },
    startedAt,
  };
  const snapshots = [
    { ...base, state: "running" },
    { ...base, state: "running", partialResult: { content: [{ type: "text", text: "one line" }] } },
    { ...base, state: "running", partialResult: { content: [{ type: "text", text: "x".repeat(600) }] } },
    { ...base, state: "done", result: { content: [{ type: "text", text: "one\ntwo\nthree\nfour\nfive" }] }, durationMs: 16000 },
  ].map((state) => renderToolBlock(state, undefined, 80).map(stripAnsi));

  assert.equal(snapshots[0].length < snapshots[1].length, true, "an empty command result must not reserve phantom output rows");
  assert.equal(snapshots[1].length <= snapshots[2].length, true, "command cards grow only when visible output exists");
  assert.equal(snapshots[2].length < snapshots[3].length, true, "the bounded preview adapts to the actual visible output count");
  assert.equal(snapshots.every((lines) => lines.every((line) => line.length <= 80)), true, "every command-card snapshot must fit its terminal width");
  assert.equal(snapshots.some((lines) => lines.some((line) => /action: run/.test(line))), false, "command cards should omit internal managed-tool control arguments");
  assert.match(snapshots.at(-1).join("\n"), /\.\.\. 3 earlier output lines/);
  assert.match(snapshots.at(-1).join("\n"), /four\s*\n\s*five/);

  const hostile = renderToolBlock({
    ...base,
    state: "running",
    partialResult: { content: [{ type: "text", text: "\x1b[2J\x1b[Hdanger\rrewrite\tok\x1b]0;owned\x07" }] },
  }, undefined, 80);
  const hostilePlain = hostile.map(stripAnsi).join("\n");
  assert.equal(hostile.length, snapshots[1].length + 1, "sanitized multiline output adds only its one visible extra row");
  assert.equal(hostile.join("\n").includes("\x1b[2J"), false, "command output must not clear Zyra's terminal");
  assert.equal(hostile.join("\n").includes("\x1b]"), false, "command output must not emit terminal-title or OSC sequences");
  assert.equal(/[\r\t]/.test(hostile.join("\n")), false, "command output must normalize carriage returns and tabs before rendering");
  assert.match(hostilePlain, /danger/);
  assert.match(hostilePlain, /rewrite  ok/);
}

function runToolOutputWordWrapRegression() {
  const output = "alpha beta gamma delta epsilon zeta eta theta iota kappa";
  const lines = renderToolBlock({
    state: "done",
    toolName: "search",
    result: { content: [{ type: "text", text: output }] },
    durationMs: 100,
  }, undefined, 34).map(stripAnsi);
  const body = lines.map((line) => line.trim()).filter(Boolean);

  assert.equal(body.some((line) => line === "alpha beta gamma delta epsilon"), true, "tool prose output should wrap at word boundaries");
  assert.equal(body.some((line) => line === "zeta eta theta iota kappa"), true, "tool prose output should continue with whole words");
  assert.equal(body.every((line) => !/\b[a-z]{1,2}$/.test(line) || ["search succeeded", "0.1s succeeded"].includes(line)), true, "tool prose output should not leave chopped word fragments");
  assert.equal(lines.every((line) => line.length <= 34), true);
}

function runReadToolCompactPresentationRegression() {
  const lines = renderToolBlock({
    state: "done",
    toolName: "read",
    args: { path: "src/zyra-ui.mjs", offset: 41, limit: 20 },
    result: { content: [{ type: "text", text: "first line\nsecond line\nthird line" }] },
    durationMs: 100,
  }, undefined, 80).map(stripAnsi);
  const meaningful = lines.map((line) => line.trim()).filter(Boolean);

  assert.equal(meaningful.length, 1, "successful reads should render as one compact call line");
  assert.match(meaningful[0], /^read src\/zyra-ui\.mjs:41-60$/);
  assert.doesNotMatch(meaningful.join("\n"), /first line|second line|third line|succeeded/);
  assert.equal(lines.every((line) => line.length <= 80), true);
}

function runEditToolPiLikeRegression() {
  const lines = renderToolBlock({
    state: "done",
    toolName: "edit",
    args: {
      path: "C:/Users/dev/Downloads/anything-huge.md",
      edits: [{}],
    },
    result: { content: [{ type: "text", text: "Successfully replaced 1 block(s) in C:/Users/dev/Downloads/anything-huge.md." }] },
    durationMs: 100,
  }, undefined, 110).map(stripAnsi);
  const plain = lines.join("\n");

  assert.match(plain, /> edit succeeded/);
  assert.match(plain, /path C:\/Users\/dev\/Downloads\/anything-huge\.md/);
  assert.match(plain, /edit 1 replacement/);
  assert.doesNotMatch(plain, /\| path/);
  assert.doesNotMatch(plain, /\| edit 1 replacement/);
  assert.doesNotMatch(plain, /change 0b -> 0b/);
  assert.match(plain, /0\.1s succeeded/);

  const fileChangeLines = renderToolBlock({
    fileChange: {
      category: "file-change",
      toolName: "edit",
      status: "completed",
      paths: ["src/example.mjs"],
      additions: 1,
      deletions: 1,
      displayDiff: "-const value = 1;\n+const value = 2;",
    },
  }, undefined, 70).map(stripAnsi);
  assert.equal(fileChangeLines[1]?.trim(), "", "Edit has one empty surface row above its header like other tools");
  assert.equal(fileChangeLines.at(-2)?.trim(), "", "Edit has one empty surface row below its body like other tools");
}

function runWriteFileChangeMatchesEditRegression() {
  const lines = renderToolBlock({
    fileChange: {
      category: "file-change",
      toolName: "write",
      status: "completed",
      paths: ["src/new-file.mjs"],
      additions: 3,
      deletions: 0,
      displayDiff: [
        "diff --git a/src/new-file.mjs b/src/new-file.mjs",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/src/new-file.mjs",
        "@@ -0,0 +1,3 @@",
        "+const value = 1;",
        "+const ready = true;",
        "+export { value, ready };",
      ].join("\n"),
    },
  }, undefined, 80).map(stripAnsi);
  const plain = lines.join("\n");

  assert.match(plain, /> write src\/new-file\.mjs \+3\/-0/, "Write uses the same compact file-change header as Edit");
  assert.doesNotMatch(plain, /diff --git|new file mode|--- \/dev\/null|\+\+\+ b\/|@@ /, "Write hides raw patch plumbing from its compact body");
  assert.match(plain, /\+ const value = 1;/, "Write keeps the actual added content visible");
}

function runToolCallThemeStylingRegression() {
  const theme = buildTerminalTheme({
    name: "tool-style-test",
    colors: {
      primary: "#654321",
      success: "#00aa00",
      warning: "#aa7700",
      error: "#aa0000",
      muted: "#555555",
      accent: "#abcdef",
      toolCall: {
        background: "#010203",
        successBackground: "#020304",
        errorBackground: "#030405",
        rail: "#123456",
        marker: "#234567",
        title: "#ffffff",
        name: "#654321",
        running: "#abcdef",
        success: "#00ff00",
        error: "#ff0000",
        args: "#777777",
        output: "#888888",
      },
    },
  });

  const running = renderToolBlock({
    state: "running",
    toolName: "bash",
    args: { command: "git status --short" },
    partialResult: { content: [{ type: "text", text: "running" }] },
  }, theme, 80).join("\n");

  assert.match(running, /\x1b\[48;2;1;2;3m/, "running tool rows should use theme toolCall.background");
  assert.match(running, /\x1b\[38;2;35;69;103m\$/, "tool command marker should use theme toolCall.marker");
  assert.match(running, /\x1b\[1m\x1b\[38;2;255;255;255mgit status --short/, "command row should use theme toolCall.title");
  assert.equal(stripAnsi(running).includes("command: git status --short"), false, "command row should not repeat command as an arg");
  assert.match(running, /\x1b\[38;2;136;136;136mrunning/, "tool output should use theme toolCall.output");
  assert.equal(
    running.split("\n").every((line) => stripAnsi(line).length <= 80),
    true,
    "styled tool rows must still fit the render width",
  );

  const done = renderToolBlock({ state: "done", toolName: "search" }, theme, 80).join("\n");
  const failed = renderToolBlock({ state: "error", toolName: "write", isError: true }, theme, 80).join("\n");
  assert.match(done, /\x1b\[48;2;2;3;4m/, "done tool rows should use theme toolCall.successBackground");
  assert.match(done, /\x1b\[38;2;0;255;0msucceeded/, "done state should use theme toolCall.success");
  assert.match(failed, /\x1b\[48;2;3;4;5m/, "failed tool rows should use theme toolCall.errorBackground");
  assert.match(failed, /\x1b\[38;2;255;0;0mfailed/, "error state should use theme toolCall.error");

  const fallbackTheme = buildTerminalTheme({
    name: "old-theme-shape",
    colors: {
      primary: "#123123",
      success: "#00aa00",
      warning: "#aa7700",
      error: "#aa0000",
      muted: "#555555",
      accent: "#abcdef",
    },
  });
  const fallback = renderToolBlock({ state: "running", toolName: "bash" }, fallbackTheme, 80).join("\n");
  assert.match(fallback, /\x1b\[/, "older themes without toolCall should still get derived tool styling");
}

function runInteractiveAssistantComponentRegression() {
  const ui = createZyraUi();
  ui._debugBeginInteractiveForTests();
  ui.event({ type: "turn_start" });
  ui.event({ type: "message_start", message: assistantMessage() });
  ui.event(updateEvent("Yep."));
  ui.event(updateEvent("Yep."));
  ui.event(updateEvent("Yep. Here"));
  ui.event({
    type: "message_end",
    message: assistantMessage("Yep. Here"),
  });
  ui.event({ type: "turn_end" });

  const plain = ui._debugRenderLinesForTests(80).map(stripAnsi).join("\n");
  assert.equal((plain.match(/Yep/g) ?? []).length, 1, "interactive assistant snapshots mutate one component");
  assert.match(plain, /Yep\. Here/);
}

function runInteractiveNoTurnEndDuplicateRegression() {
  const ui = createZyraUi();
  ui._debugBeginInteractiveForTests();
  ui.event({ type: "turn_start" });
  ui.event({ type: "message_start", message: assistantMessage() });
  ui.event(updateEvent("Final answer"));
  ui.event({ type: "message_end", message: assistantMessage("Final answer") });
  const before = ui._debugRenderLinesForTests(80).map(stripAnsi).join("\n");
  ui.event({ type: "agent_end" });
  ui.event({ type: "turn_end" });
  const after = ui._debugRenderLinesForTests(80).map(stripAnsi).join("\n");

  assert.equal((before.match(/Final answer/g) ?? []).length, 1);
  assert.equal((after.match(/Final answer/g) ?? []).length, 1, "turn_end/agent_end must not append a delayed duplicate");
}

function runInteractiveImageUserMessageDedupRegression() {
  const ui = createZyraUi();
  ui._debugBeginInteractiveForTests();
  const text = "Review this screenshot";
  ui._debugEchoUserMessageForTests(text, [{ index: 1, mimeType: "image/png" }]);
  ui.event({
    type: "message_start",
    message: {
      id: "user-image-1",
      role: "user",
      content: [
        { type: "text", text },
        { type: "image", mimeType: "image/png", data: "fixture" },
      ],
    },
  });

  const plain = ui._debugRenderLinesForTests(80).map(stripAnsi).join("\n");
  assert.equal((plain.match(/Review this screenshot/g) ?? []).length, 1, "an image-bearing user turn must reconcile its optimistic and canonical echoes");
  assert.equal((plain.match(/Image attached/g) ?? []).length, 1, "one image should render one attachment label");
  assert.doesNotMatch(plain, /\[Image 1: image\/png\]/, "canonical image metadata must not create a second user card");

  const imageOnlyUi = createZyraUi();
  imageOnlyUi._debugBeginInteractiveForTests();
  imageOnlyUi._debugEchoUserMessageForTests("", [{ index: 1, mimeType: "image/png" }]);
  imageOnlyUi.event({
    type: "message_start",
    message: { id: "user-image-only", role: "user", content: [{ type: "image", mimeType: "image/png", data: "fixture" }] },
  });
  const imageOnly = imageOnlyUi._debugRenderLinesForTests(80).map(stripAnsi).join("\n");
  assert.equal((imageOnly.match(/Image attached/g) ?? []).length, 1, "an image-only turn must also reconcile to one user card");
}

function runTurnEndKeepsRuntimeBusyRegression() {
  const ui = createZyraUi();
  ui._debugBeginInteractiveForTests();
  ui.event({ type: "turn_start" });
  ui.event({ type: "turn_end" });
  assert.equal(ui._debugActivityLabelForTests(), "thinking", "an intermediate turn boundary must stay active while the agent can begin another tool round");
  ui.event({ type: "agent_end" });
  assert.equal(ui._debugActivityLabelForTests(), "", "agent_end should return the editor to idle");
}

function runNetworkRecoveryLifecycleRegression() {
  const ui = createZyraUi();
  ui._debugBeginInteractiveForTests();
  ui.event({ type: "turn_start" });
  ui.event({ type: "auto_retry_start", attempt: 1, maxAttempts: 10, delayMs: 100, errorMessage: "fetch failed" });
  ui.event({ type: "agent_end", willRetry: true });
  ui.event({ type: "auto_retry_start", attempt: 7, maxAttempts: 10, delayMs: 6400, errorMessage: "fetch failed" });

  const retrying = ui._debugRenderLinesForTests(80).map(stripAnsi).join("\n");
  assert.equal((retrying.match(/Reconnecting/g) ?? []).length, 1, "network retries update one TUI status component");
  assert.match(retrying, /Reconnecting 7 of 10/);
  assert.doesNotMatch(retrying, /fetch failed/i, "the primary TUI must not expose the transport implementation error");
  assert.equal(ui._debugActivityLabelForTests(), "retrying", "a retryable agent_end cannot make the TUI idle");

  ui.event({ type: "agent_end", willRetry: false });
  ui.event({ type: "auto_retry_end", success: false, attempt: 10, finalError: "fetch failed" });
  const paused = ui._debugRenderLinesForTests(80).map(stripAnsi).join("\n");
  assert.equal((paused.match(/Paused · Network issue/g) ?? []).length, 1, "retry exhaustion leaves one clear paused state");
  assert.doesNotMatch(paused, /fetch failed/i);

  const overrides = [];
  applyZyraChatRetryPolicy({ applyOverrides: (value) => overrides.push(value) });
  assert.equal(ZYRA_RETRY_MAX_ATTEMPTS, 10);
  assert.equal(ZYRA_RETRY_BASE_DELAY_MS, 100);
  assert.deepEqual(overrides, [{
    retry: {
      enabled: true,
      maxRetries: 10,
      baseDelayMs: 100,
      provider: { maxRetries: 0 }
    }
  }], "Zyra applies one bounded retry policy to TUI and Desktop chat sessions");
}

function runCompactionLifecycleRegression() {
  const ui = createZyraUi();
  ui._debugBeginInteractiveForTests();
  ui.event({ type: "compaction_start", reason: "threshold" });
  const running = ui._debugRenderLinesForTests(80).map(stripAnsi).join("\n");
  assert.match(running, /compact threshold/, "the TUI must render compaction_start immediately");

  ui.event({
    type: "compaction_end",
    reason: "threshold",
    result: { firstKeptEntryId: "kept", tokensBefore: 150000, estimatedTokensAfter: 32000 },
    aborted: false,
    willRetry: false,
  });
  const completed = ui._debugRenderLinesForTests(80).map(stripAnsi).join("\n");
  assert.match(completed, /compacted threshold/, "the TUI must render the matching compaction_end outcome");

  const failedUi = createZyraUi();
  failedUi._debugBeginInteractiveForTests();
  failedUi.event({ type: "compaction_start", reason: "overflow" });
  failedUi.event({ type: "compaction_end", reason: "overflow", aborted: false, willRetry: false, errorMessage: "quota exceeded" });
  const failed = failedUi._debugRenderLinesForTests(80).map(stripAnsi).join("\n");
  assert.match(failed, /compact failed quota exceeded/, "failed compaction must not be presented as completed");
}

function runInteractiveToolComponentRegression() {
  const ui = createZyraUi();
  ui._debugBeginInteractiveForTests();
  ui.event({
    type: "tool_execution_start",
    toolName: "bash",
    toolCallId: "tool-1",
    args: { command: "git status --short" },
  });
  ui.event({
    type: "tool_execution_update",
    toolName: "bash",
    toolCallId: "tool-1",
    args: { command: "git status --short" },
    partialResult: { content: [{ type: "text", text: "running" }] },
  });
  ui.event({
    type: "tool_execution_end",
    toolName: "bash",
    toolCallId: "tool-1",
    args: { command: "git status --short" },
    result: { content: [{ type: "text", text: "clean" }] },
  });
  const plain = ui._debugRenderLinesForTests(80).map(stripAnsi).join("\n");
  assert.equal((plain.match(/\$ git status --short/g) ?? []).length, 1, "tool start/update/end must keep one rendered command row");
  assert.match(plain, /git status --short/);
  assert.match(plain, /clean/);
}

function runManagedBashStatusReconciliationRegression() {
  const ui = createZyraUi();
  ui._debugBeginInteractiveForTests();
  ui.event({
    type: "tool_execution_start",
    toolName: "bash",
    toolCallId: "managed-original",
    args: { command: "node scripts/slow-task.mjs", timeout: 30 },
    startedAt: "2026-07-29T10:00:00.000Z",
  });
  ui.event({
    type: "tool_execution_end",
    toolName: "bash",
    toolCallId: "managed-original",
    result: {
      content: [{ type: "text", text: "Command still running (cmd-1)." }],
      details: { jobId: "cmd-1", status: "running" },
    },
  });
  const running = ui._debugRenderLinesForTests(100).map(stripAnsi).join("\n");
  assert.equal((running.match(/\$ node scripts\/slow-task\.mjs/g) ?? []).length, 1, "a managed command should keep its original card while backgrounded");
  assert.match(running, /bash running/);
  assert.doesNotMatch(running, /succeeded/);

  ui.event({
    type: "managed_bash_job_update",
    jobId: "cmd-1",
    toolCallId: "managed-original",
    command: "node scripts/slow-task.mjs",
    status: "completed",
    output: "slow task done",
    startedAt: "2026-07-29T10:00:00.000Z",
    completedAt: "2026-07-29T10:00:03.000Z",
    exitCode: 0,
  });
  const completed = ui._debugRenderLinesForTests(100).map(stripAnsi).join("\n");
  assert.equal((completed.match(/\$ node scripts\/slow-task\.mjs/g) ?? []).length, 1, "background completion should mutate the original command card");
  assert.match(completed, /slow task done/);
  assert.match(completed, /3\.0s succeeded/);

  const failedUi = createZyraUi();
  failedUi._debugBeginInteractiveForTests();
  failedUi.event({
    type: "tool_execution_start",
    toolName: "bash",
    toolCallId: "managed-failing-original",
    args: { command: "node scripts/failing-task.mjs" },
  });
  failedUi.event({
    type: "tool_execution_end",
    toolName: "bash",
    toolCallId: "managed-failing-original",
    result: {
      content: [{ type: "text", text: "Command still running (cmd-2)." }],
      details: { jobId: "cmd-2", status: "running" },
    },
  });
  failedUi.event({
    type: "tool_execution_start",
    toolName: "bash",
    toolCallId: "managed-status-poll",
    args: { action: "status", jobId: "cmd-2", wait: 10 },
  });
  failedUi.event({
    type: "tool_execution_end",
    toolName: "bash",
    toolCallId: "managed-status-poll",
    result: { content: [{ type: "text", text: "task failed with exit code 1" }] },
    isError: true,
  });
  const failed = failedUi._debugRenderLinesForTests(100).map(stripAnsi).join("\n");
  assert.equal((failed.match(/\$ node scripts\/failing-task\.mjs/g) ?? []).length, 1, "a status poll failure should finish the original command card");
  assert.match(failed, /task failed with exit code 1/);
  assert.doesNotMatch(failed, /action: status|jobId: cmd-2|wait: 10/);

  const checkUi = createZyraUi();
  checkUi._debugBeginInteractiveForTests();
  checkUi.event({ type: "tool_execution_start", toolName: "bash", toolCallId: "managed-check", args: { command: "npm run check" } });
  checkUi.event({
    type: "tool_execution_end",
    toolName: "bash",
    toolCallId: "managed-check",
    result: { content: [{ type: "text", text: "still running" }], details: { jobId: "cmd-3", status: "running" } },
  });
  checkUi.event({
    type: "managed_bash_job_update",
    jobId: "cmd-3",
    toolCallId: "managed-check",
    command: "npm run check",
    status: "completed",
    output: "all checks passed",
  });
  const checked = checkUi._debugRenderLinesForTests(100).map(stripAnsi).join("\n");
  assert.match(checked, /✓ Checked command — npm run check/);
  assert.doesNotMatch(checked, /\$ npm run check|all checks passed/);

  const failedCheckUi = createZyraUi();
  failedCheckUi._debugBeginInteractiveForTests();
  failedCheckUi.event({ type: "tool_execution_start", toolName: "bash", toolCallId: "managed-check-failed", args: { command: "npm run check" } });
  failedCheckUi.event({
    type: "tool_execution_end",
    toolName: "bash",
    toolCallId: "managed-check-failed",
    result: { content: [{ type: "text", text: "still running" }], details: { jobId: "cmd-check-failed", status: "running" } },
  });
  failedCheckUi.event({
    type: "managed_bash_job_update",
    jobId: "cmd-check-failed",
    toolCallId: "managed-check-failed",
    command: "npm run check",
    status: "failed",
    output: "privacy-check failed",
    exitCode: 1,
  });
  const failedCheck = failedCheckUi._debugRenderLinesForTests(100).map(stripAnsi).join("\n");
  assert.equal((failedCheck.match(/\$ npm run check/g) ?? []).length, 1, "a failed managed check should render against its original command");
  assert.match(failedCheck, /privacy-check failed/);
  assert.doesNotMatch(failedCheck, /! bash failed|action: status|jobId:/);

  const stoppedUi = createZyraUi();
  stoppedUi._debugBeginInteractiveForTests();
  stoppedUi.event({ type: "tool_execution_start", toolName: "bash", toolCallId: "managed-stop", args: { command: "npm run dev" } });
  stoppedUi.event({
    type: "tool_execution_end",
    toolName: "bash",
    toolCallId: "managed-stop",
    result: { content: [{ type: "text", text: "still running" }], details: { jobId: "cmd-4", status: "running" } },
  });
  stoppedUi.event({
    type: "managed_bash_job_update",
    jobId: "cmd-4",
    toolCallId: "managed-stop",
    command: "npm run dev",
    status: "stopped",
    output: "server stopped",
  });
  const stopped = stoppedUi._debugRenderLinesForTests(100).map(stripAnsi).join("\n");
  assert.equal((stopped.match(/\$ npm run dev/g) ?? []).length, 1, "a stopped managed command should retain its original card");
  assert.match(stopped, /\$ npm run dev.*stopped/, "the retained command card should update to the stopped state");
  assert.match(stopped, /server stopped/, "the retained stopped card should preserve its latest output");
  assert.match(stopped, /■ Stopped command — npm run dev/, "the stopped-command transcript line should remain visible");
}

function runToolEventsWithoutIdsReuseActiveComponentRegression() {
  const ui = createZyraUi();
  ui._debugBeginInteractiveForTests();
  ui.event({
    type: "tool_execution_start",
    toolName: "bash",
    args: { command: "node scripts/render-suite.mjs" },
  });
  ui.event({
    type: "tool_execution_update",
    toolName: "bash",
    args: { command: "node scripts/render-suite.mjs" },
    partialResult: { content: [{ type: "text", text: "running suite" }] },
  });
  ui.event({
    type: "tool_execution_end",
    toolName: "bash",
    args: { command: "node scripts/render-suite.mjs" },
    result: { content: [{ type: "text", text: "suite ok" }] },
  });
  const plain = ui._debugRenderLinesForTests(90).map(stripAnsi).join("\n");

  assert.equal((plain.match(/\$ node scripts\/render-suite\.mjs/g) ?? []).length, 1, "tool events without ids should update the running component instead of appending a second one");
  assert.match(plain, /suite ok/);
  assert.doesNotMatch(plain, /running suite/);
  assert.doesNotMatch(plain, /bash running/);
}

function runSuccessfulCheckCommandSummaryRegression() {
  const ui = createZyraUi();
  ui._debugBeginInteractiveForTests();
  ui.event({ type: "turn_start" });
  ui.event({
    type: "tool_execution_start",
    toolName: "bash",
    toolCallId: "check-1",
    args: { command: "npm run check" },
  });
  const running = ui._debugRenderLinesForTests(90).map(stripAnsi).join("\n");
  assert.equal(ui._debugActivityLabelForTests(), "checking command", "a verification command should use one generic active label");
  assert.doesNotMatch(running, /\$ npm run check/, "a running verification should not mount the full tool block");

  ui.event({
    type: "tool_execution_end",
    toolName: "bash",
    toolCallId: "check-1",
    args: { command: "npm run check" },
    result: { content: [{ type: "text", text: "verbose check output" }] },
  });
  const singular = ui._debugRenderLinesForTests(90).map(stripAnsi).join("\n");
  assert.match(singular, /✓ Checked command — npm run check/);
  assert.doesNotMatch(singular, /verbose check output/);
  assert.doesNotMatch(singular, /\$ npm run check/);

  ui.event({
    type: "tool_execution_start",
    toolName: "bash",
    toolCallId: "check-2",
    args: { command: "npm run lint" },
  });
  ui.event({
    type: "tool_execution_end",
    toolName: "bash",
    toolCallId: "check-2",
    args: { command: "npm run lint" },
    result: { content: [{ type: "text", text: "verbose lint output" }] },
  });
  const plural = ui._debugRenderLinesForTests(90).map(stripAnsi).join("\n");
  assert.equal((plural.match(/✓ Checked 2 commands/g) ?? []).length, 1);
  assert.doesNotMatch(plural, /Checked command —/);
  assert.doesNotMatch(plural, /verbose lint output/);

  const failedUi = createZyraUi();
  failedUi._debugBeginInteractiveForTests();
  failedUi.event({
    type: "tool_execution_start",
    toolName: "bash",
    toolCallId: "check-failed",
    args: { command: "npm test" },
  });
  failedUi.event({
    type: "tool_execution_end",
    toolName: "bash",
    toolCallId: "check-failed",
    args: { command: "npm test" },
    result: { content: [{ type: "text", text: "tests failed" }] },
    isError: true,
  });
  const failed = failedUi._debugRenderLinesForTests(90).map(stripAnsi).join("\n");
  assert.match(failed, /\$ npm test/);
  assert.match(failed, /tests failed/);
  assert.doesNotMatch(failed, /✓ Checked/);

  const progressUi = createZyraUi();
  progressUi._debugBeginInteractiveForTests();
  progressUi.event({ type: "turn_start" });
  progressUi.beginProgress("Inspecting", { label: "orienting", detail: "mapping the project", percent: 10 });
  for (const [toolCallId, command] of [["progress-check-1", "npm run check"], ["progress-check-2", "npm run lint"]]) {
    progressUi.event({ type: "tool_execution_start", toolName: "bash", toolCallId, args: { command } });
    progressUi.event({
      type: "tool_execution_end",
      toolName: "bash",
      toolCallId,
      args: { command },
      result: { content: [{ type: "text", text: `${command} output` }] },
    });
  }
  const progress = progressUi._debugRenderLinesForTests(90).map(stripAnsi).join("\n");
  assert.match(progress, /✓ Checked 2 commands/, "progress-mode checks should use the same compact aggregate");
  assert.match(progress, /orienting/, "check commands should not replace the higher-level progress mission");
  assert.doesNotMatch(progress, /checked bash|npm run check output|npm run lint output/);
}

function runRunningToolStartsImmediatelyRegression() {
  const ui = createZyraUi();
  ui._debugBeginInteractiveForTests();
  ui.event({
    type: "tool_execution_start",
    toolName: "edit",
    toolCallId: "edit-1",
    args: {
      path: "src/example.mjs",
      oldString: "const value = 1;",
      newString: "const value = 2;\nconst ready = true;",
    },
  });

  const plain = ui._debugRenderLinesForTests(90).map(stripAnsi).join("\n");
  assert.match(plain, /> edit running src\/example\.mjs \+2\/-1/, "tool start should render its path and diff count in one compact header");
  assert.doesNotMatch(plain, /\bpath\b|live preview/);
  assert.doesNotMatch(plain, /--- a\/|\+\+\+ b\/|@@ /, "file-change cards omit raw patch headers and hunks");
  assert.match(plain, /- const value = 1;/);
  assert.match(plain, /\+ const value = 2;/);
}

function runFileChangeAuthoritativeReconciliationRegression() {
  const ui = createZyraUi();
  ui._debugBeginInteractiveForTests();
  const args = {
    path: "src/live-edit.mjs",
    oldString: "const value = 1;",
    newString: "const value = 2;",
  };
  ui.event({
    type: "tool_execution_start",
    toolName: "edit",
    toolCallId: "edit-authoritative",
    args,
  });
  const preview = ui._debugRenderLinesForTests(54).map(stripAnsi).join("\n");
  assert.match(preview, /> edit running/);
  assert.doesNotMatch(preview, /live preview|\bpath\b/, "running edit metadata stays in the compact header");
  assert.match(preview, /\+ const value = 2;/);
  assert.equal(preview.split("\n").every((line) => line.length <= 54), true, "running edit preview must respect terminal width");

  ui.event({
    type: "tool_execution_end",
    toolName: "edit",
    toolCallId: "edit-authoritative",
    result: {
      content: [{ type: "text", text: "Successfully replaced 1 block." }],
      details: {
        diff: "  context line\n- const value = 1;\n+ const value = 3;",
        patch: "--- a/src/live-edit.mjs\n+++ b/src/live-edit.mjs\n@@ -1 +1 @@\n-const value = 1;\n+const value = 3;\n",
      },
    },
    isError: false,
  });
  const completed = ui._debugRenderLinesForTests(54).map(stripAnsi).join("\n");
  assert.equal((completed.match(/> edit src\/live-edit\.mjs \+1\/-1/g) ?? []).length, 1, "result details must replace preview inside one compact mutable card");
  assert.doesNotMatch(completed, /\bapplied\b|provider result|\bpath\b/);
  assert.match(completed, /\+\s+const value = 3;/);
  assert.doesNotMatch(completed, /\+\s+const value = 2;/, "authoritative result diff must replace provisional content");
  assert.equal(completed.split("\n").every((line) => line.length <= 54), true, "completed edit result must respect terminal width");
}

function runLateFileChangeEventsStayTerminalRegression() {
  const ui = createZyraUi();
  ui._debugBeginInteractiveForTests();
  const args = {
    path: "src/late-edit.mjs",
    oldString: "const value = 1;",
    newString: "const value = 2;",
  };
  ui.event({
    type: "tool_execution_start",
    toolName: "edit",
    toolCallId: "edit-late-event",
    args,
  });
  ui.event({
    type: "tool_execution_end",
    toolName: "edit",
    toolCallId: "edit-late-event",
    args,
    result: {
      content: [{ type: "text", text: "Successfully replaced 1 block." }],
      details: {
        patch: "--- a/src/late-edit.mjs\n+++ b/src/late-edit.mjs\n@@ -1 +1 @@\n-const value = 1;\n+const value = 2;\n",
      },
    },
  });
  ui.event({
    type: "tool_execution_update",
    toolName: "edit",
    toolCallId: "edit-late-event",
    args,
    partialResult: { content: [{ type: "text", text: "late running update" }] },
  });
  ui.event({
    type: "tool_execution_end",
    toolName: "edit",
    toolCallId: "edit-late-event",
    args,
    result: { content: [{ type: "text", text: "duplicate completion" }] },
    isError: true,
  });

  const plain = ui._debugRenderLinesForTests(70).map(stripAnsi).join("\n");
  assert.equal((plain.match(/> edit src\/late-edit\.mjs \+1\/-1/g) ?? []).length, 1, "late events must keep one completed card");
  assert.equal((plain.match(/> edit running/g) ?? []).length, 0, "late updates must not regress a completed operation");
  assert.equal((plain.match(/! edit failed/g) ?? []).length, 0, "duplicate completions must not replace terminal state");
  assert.doesNotMatch(plain, /late running update|duplicate completion/);
}

function runFailedFileChangePreviewRegression() {
  const ui = createZyraUi();
  ui._debugBeginInteractiveForTests();
  const args = { path: "src/blocked.mjs", content: "uncommitted\n" };
  ui.event({ type: "tool_execution_start", toolName: "write", toolCallId: "write-failed", args });
  ui.event({
    type: "tool_execution_end",
    toolName: "write",
    toolCallId: "write-failed",
    result: { content: [{ type: "text", text: "Permission denied" }] },
    isError: true,
  });
  const failed = ui._debugRenderLinesForTests(60).map(stripAnsi).join("\n");
  assert.equal((failed.match(/! write failed src\/blocked\.mjs \+2\/-0/g) ?? []).length, 1);
  assert.doesNotMatch(failed, /preview not applied|\bpath\b/);
  assert.match(failed, /\+ uncommitted/);
  assert.doesNotMatch(failed, /applied ·/);
}

function runSnapshotBackedWriteRenderingRegression() {
  const ui = createZyraUi();
  ui._debugBeginInteractiveForTests();
  const args = { path: "src/existing.mjs", content: "after\n" };
  ui.event({ type: "tool_execution_start", toolName: "write", toolCallId: "write-snapshot", args });
  ui.event({
    type: "tool_execution_end",
    toolName: "write",
    toolCallId: "write-snapshot",
    result: {
      content: [{ type: "text", text: "Successfully wrote file" }],
      details: {
        source: "synthetic-snapshot",
        snapshotBacked: true,
        path: args.path,
        paths: [args.path],
        patch: "--- a/src/existing.mjs\n+++ b/src/existing.mjs\n@@ -1 +1 @@\n-before\n+after\n",
        diff: "- before\n+ after",
      },
    },
  });
  const plain = ui._debugRenderLinesForTests(64).map(stripAnsi).join("\n");
  assert.equal((plain.match(/> write src\/existing\.mjs \+1\/-1/g) ?? []).length, 1);
  assert.doesNotMatch(plain, /\bapplied\b|snapshot-backed|\bpath\b/);
  assert.match(plain, /\+\s+after/);
  assert.doesNotMatch(plain, /live preview/);
}

function runFileChangeEventsWithoutIdsRegression() {
  const ui = createZyraUi();
  ui._debugBeginInteractiveForTests();
  const args = { path: "src/no-id.mjs", oldText: "old", newText: "new" };
  ui.event({ type: "tool_execution_start", toolName: "edit", args });
  ui.event({
    type: "tool_execution_end",
    toolName: "edit",
    result: {
      content: [{ type: "text", text: "ok" }],
      details: { diff: "- old\n+ final", patch: "--- a/src/no-id.mjs\n+++ b/src/no-id.mjs\n@@ -1 +1 @@\n-old\n+final\n" },
    },
  });
  const plain = ui._debugRenderLinesForTests(70).map(stripAnsi).join("\n");
  assert.equal((plain.match(/> edit src\/no-id\.mjs \+1\/-1/g) ?? []).length, 1, "no-ID file changes must reuse their one active component");
  assert.match(plain, /\+\s+final/);
  assert.doesNotMatch(plain, /\+\s+new/);
}

function runWriteToolRicherRepresentationRegression() {
  const plainLines = renderToolBlock({
    state: "running",
    toolName: "write",
    args: {
      path: "notes.md",
      content: "first line\nsecond line\nthird line",
    },
  }, undefined, 90).map(stripAnsi);
  const meaningful = plainLines.filter((line) => line.trim().length > 0);

  assert.ok(meaningful.length > 3, "write tool should render more than title/path/status");
  assert.equal(meaningful.some((line) => line.includes("write running")), true);
  assert.equal(meaningful.some((line) => line.includes("path notes.md")), true);
  assert.equal(meaningful.some((line) => line.includes("write 3 lines")), true);
  assert.equal(meaningful.some((line) => line.includes("+++ content")), true);
  assert.equal(meaningful.some((line) => line.includes("+ first line")), true);
  assert.equal(meaningful.some((line) => line.includes("status started")), true);
}

function runConsecutiveToolSpacingRegression() {
  const ui = createZyraUi();
  ui._debugBeginInteractiveForTests();
  ui.event({
    type: "tool_execution_end",
    toolName: "search",
    toolCallId: "tool-a",
    args: { query: "a-output" },
    result: { content: [{ type: "text", text: "a-output" }] },
  });
  ui.event({
    type: "tool_execution_end",
    toolName: "write",
    toolCallId: "tool-b",
    args: { path: "b.txt" },
    result: { content: [{ type: "text", text: "b-output" }] },
  });

  const lines = ui._debugRenderLinesForTests(80).map(stripAnsi);
  const firstEnd = lines.findIndex((line) => line.includes("a-output"));
  const firstFooter = lines.findIndex((line, index) => index > firstEnd && line.includes("succeeded"));
  const secondStart = lines.findIndex((line) => line.includes("> write b.txt"));
  assert.ok(firstEnd >= 0, "first tool output should render");
  assert.ok(firstFooter > firstEnd, "first tool footer should render after output");
  assert.ok(secondStart > firstEnd, "second tool should render after first tool");
  const between = lines.slice(firstFooter + 1, secondStart);
  assert.equal(between.length, 3, "a compact file change keeps its top inner padding plus one outside gap");
  assert.equal(between[0].trim(), "", "the previous tool keeps its bottom inner padding");
  assert.equal(between[1], "", "consecutive tools keep exactly one outside blank line");
  assert.equal(between[2].trim(), "", "the Edit block keeps one empty surface row above its header");
}

function runAssistantAndToolInterleaveRegression() {
  const ui = createZyraUi();
  ui._debugBeginInteractiveForTests();
  ui.event({ type: "turn_start" });
  ui.event({ type: "message_start", message: assistantMessage() });
  ui.event(updateEvent("Reading files..."));
  ui.event({
    type: "tool_execution_start",
    toolName: "read",
    toolCallId: "tool-read",
    args: { path: "src/zyra-ui.mjs" },
  });
  ui.event(updateEvent("Reading files...\n\nFound it."));
  ui.event({
    type: "tool_execution_end",
    toolName: "read",
    toolCallId: "tool-read",
    args: { path: "src/zyra-ui.mjs" },
    result: { content: [{ type: "text", text: "export function createZyraUi" }] },
  });
  const plain = ui._debugRenderLinesForTests(70).map(stripAnsi).join("\n");
  assert.equal((plain.match(/Reading files/g) ?? []).length, 1, "assistant stream should not become raw interleaved blocks");
  assert.equal((plain.match(/read/g) ?? []).length, 1, "tool output should stay in its keyed component");
}

function runHistoricalTranscriptSequenceRegression() {
  const ui = createZyraUi();
  ui.history([
    { type: "message_start", message: { role: "user", content: [{ type: "text", text: "Historical prompt" }] }, historical: true },
    { type: "message_start", message: assistantMessage("Historical narration", "history-narration"), historical: true },
    { type: "message_end", message: assistantMessage("Historical narration", "history-narration"), historical: true },
    { type: "tool_execution_start", toolName: "read", toolCallId: "history-read", args: { path: "src/a.mjs" }, historical: true },
    { type: "tool_execution_end", toolName: "read", toolCallId: "history-read", args: { path: "src/a.mjs" }, result: { content: [{ type: "text", text: "body" }] }, historical: true },
    { type: "tool_execution_start", toolName: "edit", toolCallId: "history-edit", args: { path: "src/a.mjs", oldString: "old\n", newString: "new\n" }, historical: true },
    { type: "tool_execution_end", toolName: "edit", toolCallId: "history-edit", result: { content: [{ type: "text", text: "Successfully replaced" }], details: { patch: "--- a/src/a.mjs\n+++ b/src/a.mjs\n@@ -1 +1 @@\n-old\n+new" } }, historical: true },
    { type: "message_start", message: assistantMessage("Historical final", "history-final"), historical: true },
    { type: "message_end", message: assistantMessage("Historical final", "history-final"), historical: true },
  ]);
  ui._debugBeginInteractiveForTests();
  const plain = ui._debugRenderLinesForTests(90).map(stripAnsi).join("\n");
  const positions = ["Historical prompt", "Historical narration", "read src/a.mjs", "edit src/a.mjs +1/-1", "Historical final"].map((value) => plain.indexOf(value));
  assert.equal(positions.every((position) => position >= 0), true, "resume keeps prompts, narration, tools, edits, and final text visible");
  assert.match(plain, /- old[\s\S]*\+ new/, "resumed edits retain their transcript-backed diff preview");
  assert.deepEqual([...positions].sort((left, right) => left - right), positions, "resume renders canonical transcript events in sequence");
  assert.doesNotMatch(plain, /─{20,}/, "historical assistant messages do not add live-result dividers");
}

function runHistoricalBashCommandRegression() {
  const ui = createZyraUi();
  ui.history([
    {
      type: "tool_execution_start",
      toolName: "bash",
      toolCallId: "history-bash-check",
      args: { command: "npm run check:quick", timeout: 120 },
      historical: true,
    },
    {
      type: "tool_execution_end",
      toolName: "bash",
      toolCallId: "history-bash-check",
      args: { command: "npm run check:quick", timeout: 120 },
      result: { content: [{ type: "text", text: "quick checks: ok" }] },
      historical: true,
    },
  ]);
  ui._debugBeginInteractiveForTests();
  const plain = ui._debugRenderLinesForTests(90).map(stripAnsi).join("\n");
  assert.match(plain, /\$ npm run check:quick/, "resumed Bash commands remain visible instead of being swallowed by live check aggregation");
  assert.match(plain, /quick checks: ok/, "resumed Bash result previews remain attached to their commands");
}

function runResumedFileChangeDetailsRegression() {
  const toolCallId = "history-edit-with-details";
  const entries = [
    {
      type: "message",
      id: "history-user-entry",
      message: { id: "history-user", role: "user", content: [{ type: "text", text: "Update the build command." }] },
    },
    {
      type: "message",
      id: "history-assistant-entry",
      message: {
        id: "history-assistant",
        role: "assistant",
        stopReason: "toolUse",
        content: [{
          type: "toolCall",
          id: toolCallId,
          name: "edit",
          arguments: {
            path: "desktop/package.json",
            edits: [{ oldText: "electron-vite build", newText: "node production-build.mjs" }],
          },
        }],
      },
    },
    {
      type: "message",
      id: "history-tool-result-entry",
      message: {
        role: "toolResult",
        toolCallId,
        toolName: "edit",
        content: [{ type: "text", text: "Successfully replaced 1 block." }],
        details: {
          diff: "- 13 build: electron-vite build\n+ 13 build: node production-build.mjs",
          patch: "--- desktop/package.json\n+++ desktop/package.json\n@@ -13 +13 @@\n-build: electron-vite build\n+build: node production-build.mjs",
        },
      },
    },
  ];
  const events = projectHistoryEntries(entries);
  const completedEdit = events.find((event) => event.type === "tool_execution_end" && event.toolCallId === toolCallId);
  assert.match(completedEdit?.result?.details?.patch ?? "", /electron-vite build/, "resume projection retains saved tool-result patch details");

  const ui = createZyraUi();
  ui.history(events);
  ui._debugBeginInteractiveForTests();
  const plain = ui._debugRenderLinesForTests(90).map(stripAnsi).join("\n");
  assert.match(plain, /> edit desktop\/package\.json \+1\/-1/, "resumed Edit restores authoritative diff counts");
  assert.match(plain, /- .*electron-vite build[\s\S]*\+ .*node production-build\.mjs/, "resumed Edit restores its saved before/after diff");
  assert.doesNotMatch(plain, /\+0\/-0/, "resumed file changes never collapse to null diff values when persisted details exist");
}

function runTerminalLineControlSanitizationRegression() {
  const rendered = renderLinesWithinWidth([
    "\x1b[31mred\x1b[0m\x1b[2J\x1b[H\x1b]0;owned\x07\rnext\tvalue",
  ], 80)[0];

  assert.equal(rendered.includes("\x1b[31m"), true, "host output should preserve component color styling");
  assert.equal(rendered.includes("\x1b[2J"), false, "host output must strip clear-screen controls");
  assert.equal(rendered.includes("\x1b]"), false, "host output must strip OSC controls");
  assert.equal(/[\r\t]/.test(rendered), false, "host output must normalize carriage returns and tabs");
  assert.match(stripAnsi(rendered), /red next  value/);
}

function runWidthFitRegression() {
  const ui = createZyraUi();
  ui._debugBeginInteractiveForTests();
  ui.event({ type: "message_start", message: assistantMessage() });
  ui.event(updateEvent("A very long assistant line that should wrap or clamp without exceeding the requested render width."));
  ui.event({
    type: "tool_execution_start",
    toolName: "bash",
    toolCallId: "tool-width",
    args: { command: "node scripts/test-zyra-ui-render.mjs --with-a-very-long-argument-that-needs-clamping" },
  });
  for (const width of [32, 56, 100]) {
    const lines = ui._debugRenderLinesForTests(width);
    assert.equal(
      lines.every((line) => stripAnsi(line).length <= width),
      true,
      `all component-rendered lines must fit width ${width}`,
    );
  }
}

function runStaticPanelsThroughHostRegression() {
  const ui = createZyraUi();
  ui._debugBeginInteractiveForTests();
  ui.status({
    model: "openai-codex/gpt-5.6-sol",
    project: "C:\\Users\\dev\\my_coding_play\\zyra",
    profile: "builder",
    thinking: "medium",
    terminalTheme: "rose-pine",
    webSearch: true,
    webFetch: true,
    usage: {},
  });
  ui.commands();
  const plain = ui._debugRenderLinesForTests(90).map(stripAnsi).join("\n");
  assert.match(plain, /Zyra thread/);
  assert.match(plain, /Slash commands/);
  assert.match(plain, /\/memory\s+toggle memory logging for this chat/);
  assert.match(plain, /Web\s+:\s+all on/);
  assert.match(plain, /\/web\s+choose web tools/);
  assert.match(plain, /\/websearch \[on\|off\]\s+toggle web search/);
  assert.match(plain, /\/webfetch \[on\|off\]\s+toggle page fetching/);
  assert.doesNotMatch(plain, /\/memory search/);
  assert.doesNotMatch(plain, /\/memory sources/);
  assert.doesNotMatch(plain, /\/memory jobs/);
  assert.doesNotMatch(plain, /\/memory reset/);
  assert.match(plain, /\/compact \[notes\]\s+compact active context/);
  assert.match(plain, /\/consolidate\s+consolidate Zyra memory/);
}

function runResizeFullRedrawRegression() {
  const writes = [];
  const fakeOutput = {
    columns: 42,
    rows: 18,
    write(chunk) {
      writes.push(String(chunk));
      return true;
    },
    on() {},
    off() {},
    cursorTo() {
      writes.push("[cursorTo]");
    },
    moveCursor() {
      writes.push("[moveCursor]");
    },
    clearScreenDown() {
      writes.push("[clearScreenDown]");
    },
  };
  const host = new ZyraComponentHost({ output: fakeOutput, autoRender: true });
  host.setInteractive(true);
  host.append(new StaticLinesComponent("line", ["prompt-with-a-long-tail-that-wraps-at-narrow-width"]));
  host.invalidate({ force: true });
  const narrowOutput = host.lastOutput;
  fakeOutput.columns = 90;
  host.invalidate({ force: true });
  const wideOutput = host.lastOutput;

  assert.notEqual(narrowOutput, wideOutput, "width changes must force a fresh host output snapshot");
  assert.equal(host.previousWidth, 89);
  assert.equal(
    writes.some((chunk) => chunk.includes("[clearScreenDown]") || chunk.includes("\x1b[0J") || chunk.includes("\x1b[J") || chunk.includes("\x1b[2J\x1b[H")),
    true,
    "redraw should clear stale lower screen rows",
  );
}

function runOverViewportRedrawRegression() {
  const writes = [];
  const fakeOutput = {
    columns: 80,
    rows: 8,
    write(chunk) {
      writes.push(String(chunk));
      return true;
    },
    on() {},
    off() {},
  };
  const host = new ZyraComponentHost({ output: fakeOutput, autoRender: true });
  host.setInteractive(true);
  const component = host.append(new StaticLinesComponent("long", Array.from({ length: 40 }, (_, index) => `line ${index + 1}`)));
  host.invalidate({ force: true });
  assert.equal(host.renderedLines.length > fakeOutput.rows, true, "normal-screen rendering should preserve scrollback instead of clipping to the viewport");

  const beforeSameRender = writes.length;
  host.invalidate({ force: true });
  assert.equal(writes.length, beforeSameRender, "unchanged interactive renders must not append duplicate snapshots");

  const beforeTailRender = writes.length;
  component.setLines(Array.from({ length: 41 }, (_, index) => `line ${index + 1}`));
  host.invalidate({ force: true });
  const tailWrite = writes.slice(beforeTailRender).join("");
  assert.match(tailWrite, /line 41/, "stream growth should render only the changed tail");
  assert.equal(tailWrite.includes("line 1"), false, "stream growth must not replay the full transcript");

  const beforeOffscreenRender = writes.length;
  const offscreenLines = Array.from({ length: 41 }, (_, index) => `line ${index + 1}`);
  offscreenLines[0] = "line 1 changed";
  component.setLines(offscreenLines);
  host.invalidate({ force: true });
  assert.equal(writes.length, beforeOffscreenRender, "off-viewport content changes must not replay stale snapshots into scrollback");
}

function runInteractiveHostUsesNormalScreenRegression() {
  const writes = [];
  const fakeOutput = {
    columns: 80,
    rows: 20,
    write(chunk) {
      writes.push(String(chunk));
      return true;
    },
    on() {},
    off() {},
  };
  const host = new ZyraComponentHost({ output: fakeOutput, autoRender: true });
  host.setInteractive(true);
  host.append(new StaticLinesComponent("stream", ["Sure.", "The day arrives without asking,"]));
  host.invalidate({ force: true });
  host.dispose();
  const raw = writes.join("");

  assert.equal(raw.includes("\x1b[?1049h"), false, "interactive chat should not enter the alternate screen buffer");
  assert.equal(raw.includes("\x1b[?1049l"), false, "interactive chat should leave normal terminal scrollback selectable");
  assert.equal(raw.includes("\x1b[?1000h"), false, "interactive chat must not enable mouse tracking");
  assert.equal(raw.includes("\x1b[?1006h"), false, "interactive chat must not capture mouse selection");
}

function runPreInteractivePanelsSurviveInteractiveRegression() {
  let plain = "";
  let raw = "";
  captureStdout(() => {
    const ui = createZyraUi();
    ui.banner({
      project: "C:\\Users\\dev\\my_coding_play\\zyra",
      model: "openai-codex/gpt-5.6-sol",
      profile: "builder",
      thinking: "medium",
      terminalTheme: "rose-pine",
      projectMemory: ["AGENTS.md"],
    });
    ui._debugBeginInteractiveForTests();
    const rendered = ui._debugRenderLinesForTests(90);
    raw = rendered.join("\n");
    plain = rendered.map(stripAnsi).join("\n");
  });

  assert.match(plain, /┏━━━┳┓/);
  assert.match(plain, /gpt-5\.6-sol · builder/);
  assert.match(raw, /\x1b\[38;2;196;167;231m\[Context\]/);
  assert.match(plain, /\[Context\]/);
  assert.match(plain, /AGENTS\.md/);
  assert.match(plain, /\[Runtime\]/);
  assert.match(plain, /openai-codex\/gpt-5\.6-sol · medium/);
  assert.match(plain, /\[Theme\]/);
  assert.match(plain, /rose-pine/);
  assert.equal(plain.includes("✦ Learner"), false, "startup banner should use the Zyra wordmark");
  assert.equal(plain.includes("to orient"), false, "startup banner should stay compact and not print command hints");
}

function runStartupSectionLabelsUseActiveThemeRegression() {
  let raw = "";
  captureStdout(() => {
    const ui = createZyraUi({
      terminalTheme: {
        name: "pill-test",
        colors: {
          accent: "#12ab34",
          info: "#abcdef",
        },
      },
    });
    ui.banner({
      project: "C:\\Users\\dev\\my_coding_play\\zyra",
      model: "openai-codex/gpt-5.6-sol",
      profile: "builder",
      thinking: "medium",
      terminalTheme: "pill-test",
      projectMemory: ["AGENTS.md"],
    });
    raw = ui._debugRenderLinesForTests(90).join("\n");
  });

  assert.match(raw, /\x1b\[38;2;18;171;52m\[Context\]/);
  assert.match(raw, /\x1b\[38;2;18;171;52m\[Runtime\]/);
  assert.match(raw, /\x1b\[38;2;18;171;52m\[Theme\]/);
}

function runInteractiveSessionResetRedrawRegression() {
  const writes = [];
  const fakeOutput = {
    columns: 80,
    rows: 18,
    write(chunk) {
      writes.push(String(chunk));
      return true;
    },
    on() {},
    off() {},
  };
  const host = new ZyraComponentHost({ output: fakeOutput, autoRender: true });
  host.setInteractive(true);
  host.append(new StaticLinesComponent("old", ["old transcript"]));
  host.setInputComponent(new StaticLinesComponent("input", ["> input"]));
  host.invalidate({ force: true });

  const beforeReset = writes.length;
  host.replaceComponents([new StaticLinesComponent("new", ["new banner"])], { clear: true });
  const resetWrite = writes.slice(beforeReset).join("");
  const plain = host.renderLines(79).map(stripAnsi).join("\n");

  assert.match(resetWrite, /\x1b\[2J\x1b\[H\x1b\[3J/, "session reset should clear the visible screen and scrollback");
  assert.equal(plain.includes("old transcript"), false, "session reset should drop old transcript components");
  assert.equal(plain.includes("new banner"), true, "session reset should render fresh session content");
  assert.equal(plain.includes("> input"), true, "session reset should keep the input component alive");
}

function runTranscriptScrollKeepsInputPinnedRegression() {
  const fakeOutput = {
    columns: 80,
    rows: 10,
    write() {
      return true;
    },
    on() {},
    off() {},
  };
  const host = new ZyraComponentHost({ output: fakeOutput, autoRender: true });
  host.setInteractive(true);
  host.append(new StaticLinesComponent("content", Array.from({ length: 30 }, (_, index) => `line ${index + 1}`)));
  host.setInputComponent(new StaticLinesComponent("input", ["> input", "", "status"]));

  const lines = host.renderLines(79).map(stripAnsi);
  assert.equal(lines.some((line) => line.includes("line 1")), true);
  assert.equal(lines.some((line) => line.includes("line 30")), true);
  assert.equal(lines.at(-3), "> input");
  assert.equal(lines.at(-1), "status");
  assert.equal(host.scrollBy(8), false, "normal terminal scrollback should handle scroll without app-owned mouse capture");
}

function runRestartTransitionReplacesInputRailRegression() {
  const ui = createZyraUi();
  ui._debugBeginInteractiveForTests();
  ui.restartTransition("reloading zyra");
  const lines = ui._debugRenderLinesForTests(80).map(stripAnsi);
  const plain = lines.join("\n");

  assert.match(plain, /~ reloading zyra/);
  assert.doesNotMatch(plain, /> /, "reload transition should replace the editable prompt");
  assert.doesNotMatch(plain, /STATUS/, "reload transition should not leave the status line in the input rail");
  assert.equal(lines.filter((line) => line.trim()).length, 1, "reload transition should be a single fixed line, not the full editor rail");
}

function runEditorStatusGapRegression() {
  const editor = new EditorComponent({
    statusLine: () => "STATUS",
    suggestions: () => [],
    theme: {},
  });
  const lines = editor.render(80).map(stripAnsi);
  assert.equal(lines[0], "─".repeat(80), "editor should draw an input rail above the prompt");
  assert.equal(lines[2], "─".repeat(80), "editor should draw an input rail below the prompt");
  assert.equal(lines.at(-2), "", "editor should leave one empty line between input and status line");
  assert.equal(lines.at(-1), "STATUS");
}

function runEditorBusySpacingRegression() {
  const editor = new EditorComponent({
    getBusy: () => true,
    getActivityLabel: () => "thinking",
    suggestions: () => [],
    theme: {},
  });
  editor.hasTranscript = true;

  const lines = editor.render(80).map(stripAnsi);
  const activityIndex = lines.findIndex((line) => line.includes("thinking"));
  assert.ok(activityIndex > 0, "busy activity line should render after transcript spacing");
  assert.equal(lines[activityIndex - 1], "", "busy activity line should have breathing room above");
  assert.equal(lines[activityIndex + 1], "", "busy activity line should have breathing room below");
}

function runEditorWordWrapRegression() {
  const editor = new EditorComponent({
    suggestions: () => [],
    theme: {},
  });
  editor.setText("alpha beta gamma delta epsilon zeta");

  const lines = editor.render(22).map(stripAnsi);
  assert.equal(lines[1].trimEnd(), "> alpha beta gamma");
  assert.equal(lines[2].trim(), "delta epsilon zeta");
  assert.equal(lines.every((line) => line.length <= 22), true);
}

function runEditorSoftWrapWhitespaceRegression() {
  const editor = new EditorComponent({
    suggestions: () => [],
    theme: {},
  });
  editor.setText("alpha beta gamma xx   delta");

  const lines = editor.render(22).map(stripAnsi);
  assert.equal(lines[1], "> alpha beta gamma xx", "the first input row should keep the prompt marker");
  assert.equal(lines[2], "  delta", "soft wrapping should use one clean hanging indent without carrying spaces onto the next row");
}

function runEditorWrappedCursorLayoutRegression() {
  const editor = new EditorComponent({
    suggestions: () => [],
    theme: {},
  });
  editor.setText("12345 abcdef");
  editor.cursorIndex = 9;

  const lines = editor.render(12).map(stripAnsi);
  assert.equal(lines[1], "> 12345");
  assert.equal(lines[2], "  abcdef");
  assert.deepEqual(editor.cursorPosition(12), { row: 2, col: 5 }, "hardware cursor placement must use the full wrapped layout");
}

async function runEditorWrappedArrowNavigationRegression() {
  const editor = new EditorComponent({
    suggestions: () => [],
    theme: {},
  });
  editor.setHost({
    width: () => 12,
    canScroll: () => false,
    invalidate() {},
  });
  editor.setText("12345 abcdef");
  editor.cursorIndex = 9;
  editor.render(12);

  await editor.handleKeypress("", { name: "up" });
  assert.equal(editor.cursorIndex, 3, "Up should preserve the visual column on the previous wrapped row");
  await editor.handleKeypress("", { name: "down" });
  assert.equal(editor.cursorIndex, 9, "Down should return to the matching visual column");
  await editor.handleKeypress("", { name: "home" });
  assert.equal(editor.cursorIndex, 6, "Home should move to the start of the current visual row");
  await editor.handleKeypress("", { name: "end" });
  assert.equal(editor.cursorIndex, 12, "End should move to the end of the current visual row");
}

async function runEditorStandardKeyBehaviorRegression() {
  const editor = new EditorComponent({
    suggestions: () => [{ value: "complete", label: "complete" }],
    theme: {},
  });
  editor.setText("abcd");
  editor.cursorIndex = 2;
  await editor.handleKeypress("", { name: "right" });
  assert.equal(editor.cursorIndex, 3, "Right should move the cursor when editing inside text instead of accepting a suggestion");
  assert.equal(editor.buffer, "abcd");

  editor.setText("a🙂b");
  editor.cursorIndex = 3;
  await editor.handleKeypress("", { name: "backspace" });
  assert.equal(editor.buffer, "ab", "Backspace should remove one complete grapheme");
  assert.equal(editor.cursorIndex, 1);

  editor.setText("hello");
  editor.cursorIndex = 2;
  await editor.handleKeypress("", { name: "delete" });
  assert.equal(editor.buffer, "helo", "Delete should remove the grapheme after the cursor");
  assert.equal(editor.cursorIndex, 2);

  editor.setText("alpha beta");
  await editor.handleKeypress("", { name: "w", ctrl: true });
  assert.equal(editor.buffer, "alpha ", "Ctrl+W should delete the word before the cursor");

  editor.setText("alpha beta");
  editor.cursorIndex = 5;
  await editor.handleKeypress("", { name: "k", ctrl: true });
  assert.equal(editor.buffer, "alpha", "Ctrl+K should delete from the cursor to the end");

  editor.setText("ab");
  await editor.handleKeypress("\r", { name: "return", shift: true });
  assert.equal(editor.buffer, "ab\n", "Shift+Enter should insert a newline instead of submitting");
  assert.equal(editor.pastedBlocks.length, 0, "a manual newline must not become a pasted-content block");
}

async function runEditorEscapeUsesRuntimeStateRegression() {
  let abortCalls = 0;
  const editor = new EditorComponent({
    getBusy: () => false,
    isRunActive: () => true,
    onAbortQueued: async (text) => {
      abortCalls += 1;
      return text;
    },
    suggestions: () => [],
    theme: {},
  });
  editor.setText("keep this draft");

  await editor.handleKeypress("\u001b", { name: "escape" });

  assert.equal(abortCalls, 1, "Escape should abort an active runtime even between visible TUI turn states");
  assert.equal(editor.buffer, "keep this draft", "aborting should preserve current editor text");
}

function runRepairPromptVarietyRegression() {
  const prompt = readFileSync(new URL("../prompts/zyra_system_prompt.md", import.meta.url), "utf8");
  assert.doesNotMatch(prompt, /I did X\. The rule should be Y\. I am doing Y now\./, "the public prompt must not prescribe the repeated repair formula");
  assert.match(prompt, /Vary the wording and structure/, "the public prompt should require flexible repair language");
}

function runUserMessageHangingIndentRegression() {
  const lines = new UserMessageComponent(
    "wrapped-user-message",
    "alpha beta gamma delta epsilon zeta eta",
  ).render(32).map(stripAnsi);
  const content = lines.map((line) => line.trimEnd()).filter((line) => line.trim().length > 0);

  assert.deepEqual(content, [
    "> alpha beta gamma delta epsilon",
    "  zeta eta",
  ], "wrapped transcript lines should align beneath the user text after the prompt marker");
  assert.equal(lines.every((line) => line.length <= 32), true, "wrapped user messages must stay within the terminal width");
}

function runEditorPlaceholderSpacingRegression() {
  const editor = new EditorComponent({
    suggestions: () => [],
    theme: {},
  });
  editor.placeholderText = "what should happen";

  const lines = editor.render(80).map(stripAnsi);
  assert.equal(lines[1], "> what should happen", "empty editor placeholder should start at the input cursor, not after an extra cursor spacer");
  assert.deepEqual(editor.cursorPosition(80), { row: 1, col: 2 }, "hardware cursor should stay immediately after the prompt spacer");
}

function runEditorFirstInstallPlaceholderRegression() {
  const project = mkdtempSync(path.join(os.tmpdir(), "zyra-placeholder-"));
  try {
    const editor = new EditorComponent({
      project,
      suggestions: () => [],
      theme: {},
    });
    assert.equal(editor.placeholderText, "...noted, type it", "new installs should start with the stable first-install placeholder");
    const preferences = JSON.parse(readFileSync(path.join(project, ".zyra", "preferences.json"), "utf8"));
    assert.match(preferences.placeholderFirstSeenAt, /^\d{4}-\d{2}-\d{2}T/, "first placeholder render should store a first-seen marker");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}

function runEditorMaturePlaceholderDiversityRegression() {
  const project = mkdtempSync(path.join(os.tmpdir(), "zyra-placeholder-"));
  try {
    mkdirSync(path.join(project, ".zyra"), { recursive: true });
    writeFileSync(path.join(project, ".zyra", "preferences.json"), JSON.stringify({
      placeholderFirstSeenAt: "2000-01-01T00:00:00.000Z",
    }), "utf8");
    const editor = new EditorComponent({
      project,
      suggestions: () => [],
      theme: {},
    });
    assert.notEqual(editor.placeholderText, "...noted, type it", "mature installs should rotate into the varied placeholder set");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}

function runEditorSpaceKeyPreservesTrailingSpaceRegression() {
  const editor = new EditorComponent({
    suggestions: () => [],
    theme: {},
  });
  editor.setText("hello ");

  const lines = editor.render(30).map(stripAnsi);
  assert.equal(lines[1], "> hello ", "typed trailing space should stay in the rendered input row");
  assert.deepEqual(editor.cursorPosition(30), { row: 1, col: 8 }, "cursor should advance past a typed space");
}

async function runEditorRestartSubmitPreservesRestartSignalRegression() {
  let exitStatus = null;
  const editor = new EditorComponent({
    suggestions: () => [],
    theme: {},
    onSubmit: async () => "restart",
    onExit: (status) => {
      exitStatus = status;
    },
  });
  editor.setText("/reload");

  await editor.handleKeypress("\r", { name: "return" });

  assert.equal(exitStatus, "restart", "reload submissions should tell input cleanup to preserve stdin for the replacement process");
  assert.equal(editor.exitingForRestart, true, "reload submissions should suppress the final normal editor redraw");
}

async function runEditorBracketedPasteNewlineRegression() {
  const submissions = [];
  const editor = new EditorComponent({
    suggestions: () => [],
    theme: {},
    onSubmit: async (text) => {
      submissions.push(text);
      return false;
    },
  });

  await editor.handleKeypress(undefined, { name: "paste-start" });
  await editor.handleKeypress("first line", { name: "f" });
  await editor.handleKeypress("\r", { name: "return" });
  await editor.handleKeypress("second line", { name: "s" });
  await editor.handleKeypress("\tindent", { name: "tab" });

  assert.deepEqual(submissions, [], "newlines inside bracketed paste should not submit partial messages");
  assert.equal(editor.buffer, "", "paste text should wait until the terminal sends paste-end");

  await editor.handleKeypress(undefined, { name: "paste-end" });

  assert.equal(editor.buffer, "first line\rsecond line\tindent", "bracketed paste should be inserted as one editor buffer");
  assert.equal(editor.pastedBlocks.length, 1, "multi-line bracketed paste should render as one pasted content block");

  await editor.handleKeypress("\r", { name: "return" });

  assert.equal(submissions.length, 1, "the pasted blob should submit once when the user presses Enter after paste-end");
  assert.equal(submissions[0]?.text, "first line\rsecond line\tindent", "the submitted text should preserve pasted newlines and tabs");
  assert.equal(submissions[0]?.displayText, "[Pasted Content 29 chars]", "the submitted echo should keep the pasted-content label");
}

function runClipboardImageDimensionsRegression() {
  const png = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.writeUInt32BE(1536, 16);
  png.writeUInt32BE(427, 20);
  assert.deepEqual(readImageDimensions(png, "image/png"), { width: 1536, height: 427 });
}

async function runEditorImagePastePipelineRegression() {
  const submissions = [];
  const echoes = [];
  const dimensions = [[1536, 176], [1536, 535], [1536, 356]];
  let captureIndex = 0;
  const editor = new EditorComponent({
    suggestions: () => [],
    theme: {},
    readClipboardImage: async () => {
      const [width, height] = dimensions[captureIndex++];
      return { width, height, source: "test", image: { type: "image", data: "AA==", mimeType: "image/png" } };
    },
    onUserMessage: (text, metadata) => echoes.push({ text, metadata }),
    onSubmit: async (submission) => {
      submissions.push(submission);
      return false;
    },
  });
  editor.setText("Review these screenshots");

  await editor.handleKeypress("", { ctrl: true, name: "v" });
  assert.match(editor.buffer, /\[Image 1 · loading\]/, "Ctrl+V image paste should reserve a responsive editor tag immediately");
  editor.queueImagePaste();
  editor.queueImagePaste();
  await Promise.allSettled([...editor.imagePastePromises]);

  assert.equal(editor.pastedImages.length, 3, "concurrent image pastes should retain every image instead of replacing duplicate ids");
  assert.match(editor.buffer, /\[Image 1 · 1536×176\]/);
  assert.match(editor.buffer, /\[Image 2 · 1536×535\]/);
  assert.match(editor.buffer, /\[Image 3 · 1536×356\]/);
  assert.doesNotMatch(editor.buffer, /Pasted Image/);

  await editor.submit(editor.buffer);
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0]?.text, "Review these screenshots", "editor-only image tags must not leak into the model prompt");
  assert.equal(submissions[0]?.images.length, 3);
  assert.match(submissions[0]?.displayText, /Image 3 · 1536×356/);
  assert.equal(echoes[0]?.text, "Review these screenshots");
  assert.equal(echoes[0]?.metadata.imageAttachments.length, 3);

  const userMessage = new UserMessageComponent("images", echoes[0].text, {}, {
    imageAttachments: echoes[0].metadata.imageAttachments,
  });
  const rendered = userMessage.render(90).map(stripAnsi).join("\n");
  assert.match(rendered, /3 images attached/, "submitted images should collapse into one clean transcript summary");
  assert.doesNotMatch(rendered, /Pasted Image|1536×|\[Image/, "raw image tags and dimensions should stay out of the transcript bubble");

  const legacyMessage = new UserMessageComponent(
    "legacy-images",
    "Look here [Pasted Image 1536x176] [Pasted Image 1536x535] [Pasted Image 1536x356]",
    {},
  ).render(90).map(stripAnsi).join("\n");
  assert.match(legacyMessage, /> Look here/);
  assert.match(legacyMessage, /3 images attached/, "legacy pasted-image markers should receive the same clean rendering");
  assert.doesNotMatch(legacyMessage, /Pasted Image|1536x/);
}

async function runEditorPlainPasteReturnRegression() {
  const submissions = [];
  const editor = new EditorComponent({
    suggestions: () => [],
    theme: {},
    onSubmit: async (text) => {
      submissions.push(text);
      return false;
    },
  });

  editor.setText("Use this: ");
  await editor.handleKeypress("first line", { name: "f" });
  await editor.handleKeypress("\r", { name: "return" });
  await editor.handleKeypress("second line", { name: "s" });
  await wait(25);

  assert.deepEqual(submissions, [], "return events inside a plain paste burst should not submit the prefix");
  assert.equal(editor.buffer, "Use this: first line\rsecond line", "plain pasted newlines should stay in the editor buffer");

  await wait(90);
  await editor.handleKeypress("\r", { name: "return" });

  assert.equal(submissions.length, 1, "plain pasted text should submit only once after the user presses Enter");
  assert.equal(submissions[0]?.text, "Use this: first line\rsecond line", "submission should include typed prefix plus pasted text");
  assert.equal(submissions[0]?.displayText, "Use this: [Pasted Content 22 chars]", "submitted echo should keep one pasted-content label");
}

async function runEditorDelayedPlainPasteReturnRegression() {
  const submissions = [];
  const editor = new EditorComponent({
    suggestions: () => [],
    theme: {},
    onSubmit: async (text) => {
      submissions.push(text);
      return false;
    },
  });

  editor.setText("Context: ");
  await editor.handleKeypress("alpha", { name: "a" });
  await wait(25);
  await editor.handleKeypress("\r", { name: "return" });
  await editor.handleKeypress("beta", { name: "b" });
  await wait(25);

  assert.deepEqual(submissions, [], "return shortly after deferred paste flush should still be treated as pasted text");
  assert.equal(editor.buffer, "Context: alpha\rbeta", "delayed plain paste returns should preserve multiline pasted content");

  await wait(90);
  await editor.handleKeypress("\r", { name: "return" });

  assert.equal(submissions.length, 1, "delayed plain paste should not replay pasted text as a second submission");
  assert.equal(submissions[0]?.text, "Context: alpha\rbeta", "submission should preserve delayed pasted newline");
}

function runEditorUsesHardwareCursorRegression() {
  const writes = [];
  const fakeOutput = {
    columns: 41,
    rows: 10,
    write(chunk) {
      writes.push(String(chunk));
      return true;
    },
    on() {},
    off() {},
  };
  const editor = new EditorComponent({
    suggestions: () => [],
    theme: {},
  });
  editor.setText("hi");
  const host = new ZyraComponentHost({ output: fakeOutput, autoRender: true });
  host.setInteractive(true);
  host.setInputComponent(editor);

  const raw = writes.join("");
  assert.equal(raw.includes("\x1b[7m \x1b[27m"), false, "editor should not render a fake block cursor");
  assert.match(raw, /\x1b\[1A\r\x1b\[4C\x1b\[\?2026l\x1b\[\?25h/, "host should place and show the terminal hardware cursor at input text");
  assert.deepEqual(editor.cursorPosition(40), { row: 1, col: 4 });
}

function runFixedOnlyRenderReturnsFromHardwareCursorRegression() {
  const writes = [];
  const fakeOutput = {
    columns: 41,
    rows: 10,
    write(chunk) {
      writes.push(String(chunk));
      return true;
    },
    on() {},
    off() {},
  };
  const editor = new EditorComponent({
    suggestions: () => [],
    statusLine: () => "STATUS",
    theme: {},
  });
  editor.setText("a");
  const host = new ZyraComponentHost({ output: fakeOutput, autoRender: true });
  host.setInteractive(true);
  host.setInputComponent(editor);

  const before = writes.length;
  editor.buffer = "ab";
  editor.cursorIndex = editor.buffer.length;
  host.invalidate({ fixedOnly: true, force: true });
  const raw = writes.slice(before).join("");

  assert.match(raw, /^\x1b\[\?25l\x1b\[\?2026h\x1b\[3B\r/, "fixed-only redraw should first return from input cursor to render end");
  assert.match(raw, /\x1b\[3A\r\x1b\[4C\x1b\[\?2026l\x1b\[\?25h$/, "fixed-only redraw should end back at the live input cursor");
  assert.equal((raw.match(/STATUS/g) ?? []).length, 1, "fixed-only redraw should repaint the status line once, not layer it repeatedly");
}

function runCursorOnlyMovementRegression() {
  const writes = [];
  const fakeOutput = {
    columns: 41,
    rows: 10,
    write(chunk) {
      writes.push(String(chunk));
      return true;
    },
    on() {},
    off() {},
  };
  const editor = new EditorComponent({
    suggestions: () => [],
    theme: {},
  });
  editor.setText("hello");
  const host = new ZyraComponentHost({ output: fakeOutput, autoRender: true });
  host.setInteractive(true);
  host.setInputComponent(editor);

  const before = writes.length;
  editor.cursorIndex = 4;
  host.invalidate({ fixedOnly: true, force: true });
  const raw = writes.slice(before).join("");

  assert.equal(raw.includes("\x1b[2K"), false, "cursor-only movement should not repaint unchanged input text");
  assert.match(raw, /\r\x1b\[6C/, "cursor-only movement should reposition the hardware cursor immediately");
  assert.deepEqual(host.currentCursorTarget, { row: 1, col: 6 }, "host should remember the new hardware cursor target");
}

function runEditorSessionResetRegression() {
  const editor = new EditorComponent({
    suggestions: () => [],
    theme: {},
  });
  editor.setText("/new");
  editor.hasTranscript = true;
  editor.waiting = true;
  editor.starterRecommendationDismissed = true;

  editor.resetSession();

  assert.equal(editor.buffer, "");
  assert.equal(editor.hasTranscript, false);
  assert.equal(editor.waiting, false);
  assert.equal(editor.starterRecommendationDismissed, false);
}

function runEditorImmediateSlashRegression() {
  const invalidations = [];
  const editor = new EditorComponent({
    suggestions: (text) => text === "/" ? [{ value: "/commands", label: "/commands", description: "show controls", kind: "command" }] : [],
    theme: {},
  });
  editor.setHost({
    invalidate: (options = {}) => invalidations.push(options),
  });

  editor.handleKeypress("/", {});
  assert.equal(editor.buffer, "/", "single-character input should flush immediately");
  assert.equal(invalidations.at(-1)?.fixedOnly, true, "typing should redraw fixed input lines without dirtying transcript content");
  assert.match(editor.render(80).map(stripAnsi).join("\n"), /\/commands/, "slash suggestions should activate on the slash keypress");
  editor.dispose();
}

async function runEditorArrowCursorEditingRegression() {
  const editor = new EditorComponent({
    suggestions: () => [],
    theme: {},
  });
  editor.setText("helo");

  await editor.handleKeypress("", { name: "left" });
  assert.equal(editor.cursorIndex, 3, "left arrow should move the input cursor before the previous character");

  await editor.handleKeypress("l", { name: "l" });
  assert.equal(editor.buffer, "hello", "typing after left arrow should insert at the cursor, not append at the end");
  assert.equal(editor.cursorIndex, 4, "typing in the middle should advance the cursor after the inserted text");
  assert.deepEqual(editor.cursorPosition(80), { row: 1, col: 6 }, "rendered hardware cursor should follow the editor cursor");

  await editor.handleKeypress("", { name: "backspace" });
  assert.equal(editor.buffer, "helo", "backspace should delete before the moved cursor");
  assert.equal(editor.cursorIndex, 3, "backspace should move the cursor to the deletion point");

  await editor.handleKeypress("", { name: "right" });
  await editor.handleKeypress("!", { name: "!" });
  assert.equal(editor.buffer, "helo!", "right arrow should let typing continue from the new cursor position");

  await editor.handleKeypress("", { name: "home" });
  await editor.handleKeypress("s", { name: "s" });
  assert.equal(editor.buffer, "shelo!", "home should move the cursor to the start of the input");

  await editor.handleKeypress("", { name: "end" });
  await editor.handleKeypress("?", { name: "?" });
  assert.equal(editor.buffer, "shelo!?", "end should move the cursor to the end of the input");
  editor.dispose();
}

function runProfileChangePromptRegression() {
  const prompt = buildProfileChangePrompt({
    autoProfile: "builder",
    previousProfile: "builder",
    requestedProfile: "learner",
    profile: "learner",
  });
  assert.match(prompt, /hidden from the visible transcript UI/, "profile switch prompt should mark itself as hidden UI context");
  assert.match(prompt, /configured auto profile is \"builder\"/, "profile switch prompt should include the auto profile source of truth");
  assert.match(prompt, /active profile is now \"learner\"/, "profile switch prompt should include the resolved active profile");
  assert.match(prompt, /one short, witty, human confirmation/, "profile switch prompt should ask for a short visible confirmation");
}

function runThemeSelectorStartsOnActiveThemeRegression() {
  const editor = new EditorComponent({
    suggestions: () => [
      { value: "dusk", label: "dusk", description: "theme", kind: "theme" },
      { value: "quiet", label: "quiet", description: "active", kind: "theme", selected: true },
      { value: "vivid", label: "vivid", description: "theme", kind: "theme" },
    ],
    theme: {},
  });

  editor.setText("/themes ");
  editor.render(80);
  assert.equal(editor.selectedIndex, 1, "theme selector should start on the active theme");

  editor.handleKeypress("", { name: "down" });
  editor.render(80);
  assert.equal(editor.selectedIndex, 2, "manual theme navigation should not snap back to the active theme");
  editor.dispose();
}

function runFixedOnlyInputRenderAvoidsTranscriptReplayRegression() {
  const writes = [];
  const fakeOutput = {
    columns: 80,
    rows: 16,
    write(chunk) {
      writes.push(String(chunk));
      return true;
    },
    on() {},
    off() {},
  };
  const host = new ZyraComponentHost({ output: fakeOutput, autoRender: true });
  const editor = new EditorComponent({
    suggestions: () => [],
    statusLine: () => "STATUS",
    theme: {},
  });

  host.setInteractive(true);
  host.append(new StaticLinesComponent("transcript", Array.from({ length: 40 }, (_, index) => `line ${index + 1}`)));
  host.setInputComponent(editor);
  host.invalidate({ force: true });
  writes.length = 0;

  editor.buffer = "a";
  editor.cursorIndex = editor.buffer.length;
  host.invalidate({ fixedOnly: true, force: true });
  const raw = writes.join("");

  assert.match(stripAnsi(raw), /> a/, "fixed input render should update the typed buffer");
  assert.equal(raw.includes("line 1"), false, "fixed input render must not replay transcript content");
  editor.dispose();
}

function runStatusLineColorRegression() {
  const runtime = {
    profile: "builder",
    permissionMode: "full-access",
    terminalTheme: {
      name: "status-test",
      colors: {
        primary: "#ff0000",
        warning: "#ffff00",
        muted: "#777777",
        accent: "#ff00ff",
        info: "#00ffff",
        success: "#00ff00",
        error: "#ff5555",
      },
    },
    session: {
      model: { id: "gpt-test" },
      thinkingLevel: "medium",
      getContextUsage: () => ({ percent: 72 }),
      sessionManager: {
        getCwd: () => "C:\\Users\\dev\\project",
        getEntries: () => [{ type: "message", message: { role: "assistant", usage: { cost: { total: 0.3 } } } }],
      },
      modelRegistry: {
        isUsingOAuth: () => false,
      },
    },
  };
  const line = renderStatusLine(runtime, 120);

  assert.match(line, /\x1b\[38;2;255;0;0m gpt-test/);
  assert.match(line, /\x1b\[38;2;255;255;0m medium/);
  assert.match(line, /\x1b\[38;5;213mfull access/);
  assert.doesNotMatch(stripAnsi(line), /\bbuilder\b/, "the footer shows permission mode instead of the profile overlay");
  assert.match(line, /\x1b\[38;2;255;255;0mContext 28% left/);
  assert.match(line, /\x1b\[38;5;82m\$0\.300/);

  runtime.permissionMode = "approval-required";
  runtime.session.getContextUsage = () => undefined;
  runtime.session.sessionManager.getEntries = () => [];
  const freshLine = renderStatusLine(runtime, 120);
  assert.match(freshLine, /\x1b\[38;2;255;0;255msupervised/);
  assert.match(freshLine, /\x1b\[38;2;0;255;0mContext 100% left/);
  assert.match(freshLine, /\x1b\[38;2;119;119;119m\$0\.000/);
}

function runStatusLineCostCacheRegression() {
  let iterations = 0;
  const entries = [
    { type: "message", message: { role: "assistant", usage: { cost: { total: 0.25 } } } },
  ];
  entries[Symbol.iterator] = function* iterator() {
    iterations += 1;
    yield entries[0];
  };
  const runtime = {
    profile: "builder",
    terminalTheme: "quiet",
    session: {
      model: { provider: "openai-codex", id: "gpt-test" },
      thinkingLevel: "medium",
      getContextUsage: () => ({ percent: 10 }),
      sessionManager: {
        getCwd: () => process.cwd(),
        getEntries: () => entries,
      },
      modelRegistry: {
        isUsingOAuth: () => true,
      },
    },
  };

  renderStatusLine(runtime, 120);
  renderStatusLine(runtime, 120);
  assert.equal(iterations, 1, "status line should not rescan message cost on every input render");
}

function runStatusLineBranchLookupDoesNotBlockInputRegression() {
  const runtime = {
    profile: "builder",
    terminalTheme: "quiet",
    session: {
      model: { provider: "openai-codex", id: "gpt-test" },
      thinkingLevel: "medium",
      getContextUsage: () => ({ percent: 10 }),
      sessionManager: {
        getCwd: () => process.cwd(),
        getEntries: () => [],
      },
      modelRegistry: {
        isUsingOAuth: () => true,
      },
    },
  };
  const start = performance.now();
  for (let index = 0; index < 10; index += 1) {
    renderStatusLine(runtime, 120);
  }
  const elapsed = performance.now() - start;

  assert.equal(elapsed < 300, true, `status line branch lookup should not block input renders (${elapsed.toFixed(1)}ms)`);
}

function runSystemPanelWidthRegression() {
  const widthOf = (lines) => stripAnsi(lines.find((line) => stripAnsi(line).trim()) ?? "").length;
  const canonicalThreadStatus = stripAnsi(renderStatusBox({ threadId: "thread-canonical", sessionId: "legacy-session" }, undefined, 100).join("\n"));
  assert.match(canonicalThreadStatus, /Zyra thread/);
  assert.match(canonicalThreadStatus, /Thread\s+: thread-canonical/);
  const account = {
    provider: "openai-codex",
    status: { configured: true, source: "test" },
    email: "dev@example.com",
    plan: "plus",
    updatedAt: "2026-05-24T00:00:00.000Z",
  };
  const usage = {
    source: "test",
    plan: "plus",
    account: "dev@example.com",
    availableResetCount: 2,
    updatedAt: "2026-05-24T00:00:00.000Z",
  };
  assert.match(stripAnsi(renderCodexUsageBox(usage, undefined, 100).join("\n")), /banked\s+2 resets/);

  for (const terminalColumns of [80, 120]) {
    const statusWidth = widthOf(renderStatusBox({}, undefined, terminalColumns));
    assert.equal(widthOf(renderAccountStatusBox(account, undefined, terminalColumns)), statusWidth);
    assert.equal(widthOf(renderCodexUsageBox(usage, undefined, terminalColumns)), statusWidth);
  }
}

function runThemePreferencePersistenceRegression() {
  const project = mkdtempSync(path.join(os.tmpdir(), "zyra-theme-"));
  try {
    const entries = [];
    const runtime = {
      project,
      session: {
        sessionManager: {
          getSessionFile: () => path.join(project, "session.jsonl"),
          appendCustomEntry: (customType, data) => entries.push({ customType, data }),
        },
      },
    };

    setZyraTheme(runtime, "quiet");
    const preferences = JSON.parse(readFileSync(path.join(project, ".zyra", "preferences.json"), "utf8"));

    assert.equal(preferences.terminalTheme, "quiet");
    assert.equal(runtime.terminalTheme.name, "quiet");
    assert.equal(entries.at(-1)?.data?.name, "quiet");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}

function runOnboardingStateRegression() {
  const root = mkdtempSync(path.join(os.tmpdir(), "zyra-onboarding-"));
  try {
    assert.deepEqual(readOnboardingState(root), {});
    assert.equal(shouldRunOnboarding({ root, force: true }), true);
    markOnboardingComplete(root, { terminalTheme: "quiet", webSearch: true, webFetch: false });
    const state = readOnboardingState(root);
    assert.equal(state.version, 1);
    assert.equal(state.terminalTheme, "quiet");
    assert.equal(state.webFetch, false);
    assert.equal(shouldRunOnboarding({ root, skip: true }), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runRuntimeModelOverrideRegression() {
  const models = [
    {
      provider: "openai-codex",
      id: "gpt-5.5",
      name: "GPT-5.5",
      api: "openai-codex-responses",
      baseUrl: "https://chatgpt.com/backend-api",
      reasoning: true,
      input: ["text", "image"],
      cost: { input: 1, output: 8, cacheRead: 0.1, cacheWrite: 1 },
      contextWindow: 400000,
      maxTokens: 128000,
      compat: { supportsStore: false },
    },
    {
      provider: "openai-codex",
      id: "gpt-5.4-mini",
      name: "GPT-5.4 Mini",
      api: "openai-codex-responses",
      baseUrl: "https://chatgpt.com/backend-api",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 272000,
      maxTokens: 128000,
    },
    {
      provider: "openai",
      id: "gpt-5.5",
      name: "GPT-5.5",
      api: "openai-responses",
      baseUrl: "https://api.openai.com/v1",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 400000,
      maxTokens: 128000,
    },
    {
      provider: "openai",
      id: "gpt-5.4-mini",
      name: "GPT-5.4 Mini",
      api: "openai-responses",
      baseUrl: "https://api.openai.com/v1",
      reasoning: true,
      input: ["text"],
      contextWindow: 272000,
      maxTokens: 128000,
    },
    {
      provider: "openai",
      id: "gpt-5.4-nano",
      name: "GPT-5.4 Nano",
      api: "openai-responses",
      baseUrl: "https://api.openai.com/v1",
      reasoning: true,
      input: ["text"],
      contextWindow: 128000,
      maxTokens: 64000,
    },
    {
      provider: "openai",
      id: "gpt-5.5-pro",
      name: "GPT-5.5 Pro",
      api: "openai-responses",
      baseUrl: "https://api.openai.com/v1",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 512000,
      maxTokens: 128000,
    },
  ];
  const registry = {
    getAll: () => models,
    find: (provider, id) => models.find((model) => model.provider === provider && model.id === id),
  };

  const result = registerZyraRuntimeModels(registry);
  assert.deepEqual(result.map((item) => item.status), ["registered", "registered", "registered", "registered", "registered", "registered"]);

  const expectedCosts = {
    luna: { input: 1, output: 6, cacheRead: 0.1, cacheWrite: 1.25 },
    terra: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 3.125 },
    sol: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 6.25 },
  };
  for (const provider of ["openai-codex", "openai"]) {
    for (const name of ["luna", "terra", "sol"]) {
      const model = registry.find(provider, `gpt-5.6-${name}`);
      assert.equal(model.name, `GPT-5.6 ${name[0].toUpperCase()}${name.slice(1)}`);
      assert.equal(model.reasoning, true);
      assert.deepEqual(model.input, ["text", "image"]);
      assert.equal(model.contextWindow, 400000);
      assert.deepEqual(model.cost, expectedCosts[name]);
    }
    assert.equal(registry.find(provider, "gpt-5.6-tera"), undefined);
  }
  assert.equal(registry.find("openai-codex", "gpt-5.6-sol")?.api, "openai-codex-responses");
  assert.equal(registry.find("openai", "gpt-5.6-sol")?.api, "openai-responses");
  assert.equal(registry.find("openai-codex", "gpt-5.6-luna")?.zyraCompatibility?.status, PI_SUPPORT_PENDING_STATUS);
  assert.equal(registry.find("openai", "gpt-5.6-luna")?.zyraCompatibility, undefined);

  const idempotent = registerZyraRuntimeModels(registry);
  assert.deepEqual(idempotent.map((item) => item.status), ["exists", "exists", "exists", "exists", "exists", "exists"]);

  const officialLuna = {
    provider: "openai-codex",
    id: "gpt-5.6-luna",
    name: "GPT-5.6 Luna",
    api: "openai-codex-responses",
  };
  const officialModels = [officialLuna];
  const officialRegistry = {
    getAll: () => officialModels,
    find: (provider, id) => officialModels.find((model) => model.provider === provider && model.id === id),
  };
  const officialResult = registerZyraRuntimeModels(officialRegistry);
  assert.equal(officialResult[0].status, "exists");
  assert.equal(officialLuna.zyraCompatibility, undefined, "future Pi-owned Luna entries must not inherit Zyra's temporary compatibility block");
}

function runModelPickerReleaseOrderRegression() {
  const models = [
    { provider: "anthropic", id: "claude-custom", name: "Claude Custom" },
    { provider: "openai-codex", id: "gpt-5.4", name: "GPT-5.4" },
    { provider: "openai-codex", id: "gpt-5.6-luna", name: "GPT-5.6 Luna", zyraCompatibility: { status: PI_SUPPORT_PENDING_STATUS } },
    { provider: "openai-codex", id: "gpt-5.4-mini", name: "GPT-5.4 Mini" },
    { provider: "openai-codex", id: "gpt-5.5", name: "GPT-5.5" },
    { provider: "openai-codex", id: "gpt-5.6-terra", name: "GPT-5.6 Terra" },
    { provider: "openai", id: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
    { provider: "openai-codex", id: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
  ];
  const runtime = {
    project: process.cwd(),
    session: {
      model: models[1],
      modelRegistry: { getAvailable: () => models },
    },
  };

  const suggestions = getSlashSuggestions(runtime, "/models ");
  assert.deepEqual(
    suggestions.map((item) => item.value),
    [
      "openai-codex/gpt-5.6-sol",
      "openai/gpt-5.6-sol",
      "openai-codex/gpt-5.6-terra",
      "openai-codex/gpt-5.6-luna",
      "openai-codex/gpt-5.5",
      "openai-codex/gpt-5.4",
      "openai-codex/gpt-5.4-mini",
      "anthropic/claude-custom",
      "",
    ],
    "model picker should sort GPT releases newest-first and keep the documented GPT-5.6 tier order",
  );
  assert.equal(suggestions[5].description, "active", "active state should be labeled without overriding release order");
  assert.equal(suggestions[3].description, "Pi support pending", "the picker should keep Luna visible without implying the current Pi transport can run it");
}

async function runPendingLunaSelectionRegression() {
  const model = {
    provider: "openai-codex",
    id: "gpt-5.6-luna",
    name: "GPT-5.6 Luna",
    zyraCompatibility: { status: PI_SUPPORT_PENDING_STATUS, capability: "codex-responses-lite" },
  };
  let setModelCalls = 0;
  const runtime = {
    project: process.cwd(),
    session: {
      model: null,
      modelRegistry: { getAvailable: () => [model] },
      async setModel() { setModelCalls += 1; },
    },
  };
  await assert.rejects(
    () => setModel(runtime, "openai-codex/gpt-5.6-luna"),
    /wired into Zyra.*Pi runtime does not officially support/i,
  );
  assert.equal(setModelCalls, 0);

  runtime.session.model = model;
  await assert.rejects(
    () => setModel(runtime, "gpt-5.6-luna"),
    /wired into Zyra.*Pi runtime does not officially support/i,
    "an already-active compatibility entry must not bypass the provider guard",
  );
}

function runGpt56ThinkingLevelsRegression() {
  const project = mkdtempSync(path.join(os.tmpdir(), "zyra-thinking-"));
  try {
    const session = {
      model: { provider: "openai-codex", id: "gpt-5.6-sol", reasoning: true },
      thinkingLevel: "medium",
      getAvailableThinkingLevels: () => ["off", "minimal", "low", "medium", "high", "xhigh"],
      setThinkingLevel(level) {
        this.thinkingLevel = level;
      },
      sessionManager: {
        getCwd: () => project,
        getEntries: () => [],
      },
      modelRegistry: { isUsingOAuth: () => true },
    };
    const runtime = { project, session, thinkingState: { value: "medium" } };

    assert.deepEqual(getZyraAvailableThinkingLevels(runtime), GPT_56_THINKING_LEVELS);
    assert.deepEqual(getZyraModelThinkingLevels("openai-codex/gpt-5.6-sol"), GPT_56_THINKING_LEVELS, "desktop bridge metadata must use the same full-id GPT-5.6 capability contract");
    const initialSuggestions = getSlashSuggestions(runtime, "/thinking ");
    assert.deepEqual(
      initialSuggestions.map((item) => item.value),
      GPT_56_THINKING_LEVELS,
      "GPT-5.6 should expose its documented model-specific effort levels",
    );
    assert.equal(initialSuggestions.find((item) => item.selected)?.value, "medium");
    assert.equal(setThinking(runtime, "max"), "max");
    assert.equal(session.thinkingLevel, "xhigh", "Pi should receive its highest supported internal level");
    assert.equal(getZyraThinkingLevel(runtime), "max", "Zyra should preserve the distinct GPT-5.6 max level");
    assert.equal(getSlashSuggestions(runtime, "/thinking ").find((item) => item.selected)?.value, "max");
    assert.match(stripAnsi(renderStatusLine(runtime, 100)), /gpt-5\.6-sol max/, "status line should show the real GPT-5.6 level");

    const payload = applyGpt56ThinkingEffort({
      model: "gpt-5.6-sol",
      service_tier: "priority",
      reasoning: { effort: "xhigh", summary: "auto" },
    }, getZyraThinkingLevel(runtime));
    assert.deepEqual(payload.reasoning, { effort: "max", summary: "auto" });
    assert.equal(payload.service_tier, "priority", "thinking payload changes must preserve other provider controls");

    assert.equal(setThinking(runtime), "low", "cycling after max should wrap to GPT-5.6 low");
    assert.equal(session.thinkingLevel, "low", "GPT-5.6 has no selectable no-reasoning level");

    session.model = { provider: "openai-codex", id: "gpt-5.5", reasoning: true };
    assert.deepEqual(getZyraAvailableThinkingLevels(runtime), ["low", "medium", "high", "xhigh"], "ChatGPT models should begin at low in the TUI");
    assert.equal(syncZyraThinkingLevel(runtime, "max"), "xhigh", "leaving GPT-5.6 should clamp max to the target model's highest level");
    assert.equal(getZyraThinkingLevel(runtime), "xhigh");

    session.model = { provider: "openai-codex", id: "gpt-5.6-terra", reasoning: true };
    assert.equal(syncZyraThinkingLevel(runtime, "off"), "low", "legacy off should normalize to GPT-5.6 low");
    assert.equal(resolveZyraStartupPreferences(project, { thinking: "max" }, {}).thinking, "max");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}

async function runRuntimePreferencePersistenceRegression() {
  const project = mkdtempSync(path.join(os.tmpdir(), "zyra-runtime-prefs-"));
  try {
    const model = { provider: "openai-codex", id: "gpt-test", name: "GPT Test" };
    const runtime = {
      project,
      profile: "builder",
      session: {
        agent: { state: { systemPrompt: "" } },
        activeTools: ["read", "bash", "edit", "write", "web_search", "web_fetch"],
        thinkingLevel: "medium",
        getAvailableThinkingLevels: () => ["low", "medium", "high"],
        getActiveToolNames() {
          return this.activeTools;
        },
        setActiveToolsByName(names) {
          this.activeTools = names;
          this._baseSystemPrompt = "";
          this.agent.state.systemPrompt = "";
        },
        setThinkingLevel(level) {
          this.thinkingLevel = level;
        },
        cycleThinkingLevel() {
          this.thinkingLevel = "low";
          return this.thinkingLevel;
        },
        model: null,
        setModelCalls: 0,
        async setModel(nextModel) {
          this.setModelCalls += 1;
          this.model = nextModel;
        },
        modelRegistry: {
          getAvailable: () => [model],
          find: (provider, id) => provider === model.provider && id === model.id ? model : undefined,
          hasConfiguredAuth: () => true,
        },
        sessionManager: {
          getSessionFile: () => path.join(project, "session.jsonl"),
          appendCustomEntry() {},
        },
      },
    };

    setProfile(runtime, "learner");
    setThinking(runtime, "high");
    await setModel(runtime, "gpt-test");
    await setModel(runtime, "openai-codex/gpt-test");
    setWebSearch(runtime, false);
    setWebFetch(runtime, false);

    const preferences = JSON.parse(readFileSync(path.join(project, ".zyra", "preferences.json"), "utf8"));
    assert.equal(preferences.profile, "learner");
    assert.equal(preferences.profileResolved, "learner");
    assert.equal(preferences.thinking, "high");
    assert.equal(preferences.model, "openai-codex/gpt-test");
    assert.equal(preferences.webSearch, false);
    assert.equal(preferences.webFetch, false);
    assert.equal(runtime.session.setModelCalls, 1, "selecting the active model should be a no-op");
    assert.equal(runtime.webSearch, false);
    assert.equal(runtime.webFetch, false);
    assert.equal(runtime.session.activeTools.includes("web_search"), false);
    assert.equal(runtime.session.activeTools.includes("web_fetch"), false);
    assert.match(runtime.session.agent.state.systemPrompt, /ZYRA_LEVEL_1_GUIDE/);

    const startup = resolveZyraStartupPreferences(project);
    assert.equal(startup.profile, "learner");
    assert.equal(startup.thinking, "high");
    assert.equal(startup.model, "openai-codex/gpt-test");
    assert.equal(startup.webSearch, false);
    assert.equal(startup.webFetch, false);

    const overridden = resolveZyraStartupPreferences(project, {
      profile: "builder",
      thinking: "low",
      model: "openai-codex/gpt-other",
      webSearch: true,
      webFetch: true,
    });
    assert.equal(overridden.profile, "builder");
    assert.equal(overridden.thinking, "low");
    assert.equal(overridden.model, "openai-codex/gpt-other");
    assert.equal(overridden.webSearch, true);
    assert.equal(overridden.webFetch, true);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}

async function runCompactCommandNoProgressBoxRegression() {
  let progressCalls = 0;
  let infoText = "";
  const terminalStates = [];
  const handled = await handleSlash(
    {
      session: {
        compact: async () => ({ tokensBefore: 246187 }),
        getContextUsage: () => ({ tokens: 42000, contextWindow: 272000, percent: 15 }),
      },
    },
    {
      beginProgress: () => { progressCalls += 1; },
      updateProgress: () => { progressCalls += 1; },
      endProgress: () => { progressCalls += 1; },
      info: (message) => { infoText = message; },
    },
    "/compact",
    {
      setTerminalTitleState: (state) => terminalStates.push(state),
    },
  );

  assert.equal(handled, true);
  assert.equal(progressCalls, 0, "/compact should not render the big progress box");
  assert.match(infoText, /Context compacted/);
  assert.deepEqual(terminalStates, ["compacting", "ready"]);
}

function runSessionCommandRenameRegression() {
  const runtime = { project: process.cwd(), session: {} };
  const values = getSlashSuggestions(runtime, "/").map((item) => item.value);
  const canonicalNames = values.map((value) => getSlashCommand(value)?.name ?? value);
  assert.equal(new Set(canonicalNames).size, canonicalNames.length, "the root slash menu should show each command once");
  assert.equal(values.includes("/session"), true);
  assert.equal(values.includes("/chat"), true);
  assert.equal(values.includes("/status"), false);
  assert.equal(values.includes("/memory"), true);
  assert.equal(values.includes("/web"), true);
  assert.equal(values.includes("/websearch"), true);
  assert.equal(values.includes("/webfetch"), true);
  assert.equal(values.includes("/quit"), false, "aliases should not duplicate canonical commands in the root menu");
  assert.deepEqual(getSlashSuggestions(runtime, "/q").map((item) => item.value), ["/quit"], "typing an alias should still reveal it");
  assert.deepEqual(getSlashSuggestions(runtime, "/he").map((item) => item.value), ["/help"], "aliases should remain searchable");
  assert.deepEqual(getSlashSuggestions(runtime, "/web ").map((item) => item.value), ["all", "none", "websearch", "webfetch"]);
  assert.deepEqual(getSlashSuggestions(runtime, "/websearch ").map((item) => item.value), ["on", "off"]);
  assert.deepEqual(getSlashSuggestions(runtime, "/webfetch ").map((item) => item.value), ["on", "off"]);
  assert.equal(values.some((value) => value.startsWith("/memory ")), false);
  assert.equal(values.includes("/compact"), true);
  assert.equal(values.includes("/consolidate"), true);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

runDeltaStreamingRegression();
runFullSnapshotRegression();
runRepeatedSnapshotRegression();
runMarkdownCodeBlockRegression();
runMergeHelperRegression();
runSnapshotDeltaPollutionRegression();
runUiEventCaptureRegression();
runNarrationFinalDividerRegression();
runToolOutputStyleRegression();
runPiLikeToolPresentationRegression();
runToolCommandInlineRunningTimeRegression();
runToolCommandMultilineRegression();
runToolLongCommandAndHugeOutputClampRegression();
runToolOutputUsesFullBlockWidthRegression();
runCommandCardStableHeightRegression();
runToolOutputWordWrapRegression();
runReadToolCompactPresentationRegression();
runEditToolPiLikeRegression();
runWriteFileChangeMatchesEditRegression();
runToolCallThemeStylingRegression();
runInteractiveAssistantComponentRegression();
runInteractiveNoTurnEndDuplicateRegression();
runInteractiveImageUserMessageDedupRegression();
runTurnEndKeepsRuntimeBusyRegression();
runNetworkRecoveryLifecycleRegression();
runCompactionLifecycleRegression();
runInteractiveToolComponentRegression();
runManagedBashStatusReconciliationRegression();
runToolEventsWithoutIdsReuseActiveComponentRegression();
runSuccessfulCheckCommandSummaryRegression();
runRunningToolStartsImmediatelyRegression();
runFileChangeAuthoritativeReconciliationRegression();
runLateFileChangeEventsStayTerminalRegression();
runFailedFileChangePreviewRegression();
runSnapshotBackedWriteRenderingRegression();
runFileChangeEventsWithoutIdsRegression();
runWriteToolRicherRepresentationRegression();
runConsecutiveToolSpacingRegression();
runAssistantAndToolInterleaveRegression();
runHistoricalTranscriptSequenceRegression();
runHistoricalBashCommandRegression();
runResumedFileChangeDetailsRegression();
runTerminalLineControlSanitizationRegression();
runWidthFitRegression();
runStaticPanelsThroughHostRegression();
runResizeFullRedrawRegression();
runOverViewportRedrawRegression();
runInteractiveHostUsesNormalScreenRegression();
runPreInteractivePanelsSurviveInteractiveRegression();
runStartupSectionLabelsUseActiveThemeRegression();
runInteractiveSessionResetRedrawRegression();
runTranscriptScrollKeepsInputPinnedRegression();
runRestartTransitionReplacesInputRailRegression();
runEditorStatusGapRegression();
runEditorBusySpacingRegression();
runEditorWordWrapRegression();
runEditorSoftWrapWhitespaceRegression();
runEditorWrappedCursorLayoutRegression();
await runEditorWrappedArrowNavigationRegression();
await runEditorStandardKeyBehaviorRegression();
await runEditorEscapeUsesRuntimeStateRegression();
runRepairPromptVarietyRegression();
runUserMessageHangingIndentRegression();
runEditorPlaceholderSpacingRegression();
runEditorFirstInstallPlaceholderRegression();
runEditorMaturePlaceholderDiversityRegression();
runEditorSpaceKeyPreservesTrailingSpaceRegression();
await runEditorRestartSubmitPreservesRestartSignalRegression();
await runEditorBracketedPasteNewlineRegression();
runClipboardImageDimensionsRegression();
await runEditorImagePastePipelineRegression();
await runEditorPlainPasteReturnRegression();
await runEditorDelayedPlainPasteReturnRegression();
runEditorUsesHardwareCursorRegression();
runFixedOnlyRenderReturnsFromHardwareCursorRegression();
runCursorOnlyMovementRegression();
runEditorSessionResetRegression();
runEditorImmediateSlashRegression();
await runEditorArrowCursorEditingRegression();
runProfileChangePromptRegression();
runThemeSelectorStartsOnActiveThemeRegression();
runFixedOnlyInputRenderAvoidsTranscriptReplayRegression();
runStatusLineColorRegression();
runStatusLineCostCacheRegression();
runStatusLineBranchLookupDoesNotBlockInputRegression();
runSystemPanelWidthRegression();
runThemePreferencePersistenceRegression();
runOnboardingStateRegression();
runRuntimeModelOverrideRegression();
runModelPickerReleaseOrderRegression();
await runPendingLunaSelectionRegression();
runGpt56ThinkingLevelsRegression();
await runRuntimePreferencePersistenceRegression();
await runCompactCommandNoProgressBoxRegression();
runSessionCommandRenameRegression();
console.log("zyra-ui render regression: ok");
