#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequestUserInputDialog } from "../src/request-user-input-dialog.mjs";
import { createRequestUserInputTool } from "../src/request-user-input-tool.mjs";
import {
  isRequestUserInputAnswerComplete,
  normalizeRequestUserInputQuestions,
} from "../src/request-user-input.mjs";

const manyQuestions = Array.from({ length: 12 }, (_, index) => ({
  id: `q-${index}`,
  header: `Q${index + 1}`,
  question: `Question ${index + 1}?`,
  type: "text",
}));
assert.equal(normalizeRequestUserInputQuestions(manyQuestions).length, 12, "question requests have no fixed maximum");
const deduplicatedRanking = normalizeRequestUserInputQuestions([{
  id: "deduplicated-ranking",
  header: "Rank",
  question: "Order",
  type: "ranking",
  options: [{ label: "Safety" }, { label: "Safety" }, { label: "Speed" }],
}])[0];
assert.deepEqual(deduplicatedRanking.options.map((option) => option.label), ["Safety", "Speed"], "sortable option identities are unique");

const questions = normalizeRequestUserInputQuestions([
  { id: "text", header: "Text", question: "Say something", type: "text" },
  { id: "single", header: "Single", question: "Choose", type: "single_select", allowOther: true, options: [{ label: "A", recommended: true }] },
  { id: "multi", header: "Multi", question: "Choose several", type: "multi_select", options: [{ label: "A" }, { label: "B" }], minSelections: 2 },
  { id: "confirm", header: "Confirm", question: "Continue?", type: "confirm" },
  { id: "files", header: "Files", question: "Pick paths", type: "file_select", multiple: true, options: [{ label: "src/a.mjs" }] },
  { id: "number", header: "Number", question: "How many?", type: "number", min: 1, max: 4 },
  { id: "date", header: "Date", question: "When?", type: "date" },
  { id: "ranking", header: "Rank", question: "Order", type: "ranking", options: [{ label: "Safety" }, { label: "Speed" }] },
]);
assert.deepEqual(questions.map((question) => question.type), ["text", "single_select", "multi_select", "confirm", "file_select", "number", "date", "ranking"]);
assert.equal(isRequestUserInputAnswerComplete(questions[2], ["A"], true), false);
assert.equal(isRequestUserInputAnswerComplete(questions[2], ["A", "B"], true), true);
assert.equal(isRequestUserInputAnswerComplete(questions[5], "5", true), false);
assert.equal(isRequestUserInputAnswerComplete(questions[5], "3", true), true);
assert.equal(isRequestUserInputAnswerComplete(questions[6], "2026-08-19", true), true);
assert.equal(isRequestUserInputAnswerComplete(questions[7], ["Safety", "Speed"], true), true);

let receivedRequest;
const tool = createRequestUserInputTool({
  requestUserInput: async (request) => {
    receivedRequest = request;
    return { answers: { single: "A", multi: ["A", "B"] }, cancelled: false };
  },
});
assert.equal(tool.name, "request_user_input");
assert.equal(tool.parameters.properties.questions.maxItems, undefined, "the tool schema does not impose an arbitrary count limit");
const toolResult = await tool.execute("call-1", {
  questions: [
    { id: "single", header: "Single", question: "Choose", type: "single_select", options: [{ label: "A" }] },
    { id: "multi", header: "Multi", question: "Choose", type: "multi_select", options: [{ label: "A" }, { label: "B" }] },
  ],
}, undefined, undefined, { cwd: process.cwd() });
assert.equal(receivedRequest.questions.length, 2);
assert.match(toolResult.content[0].text, /Single: A/);
assert.match(toolResult.content[0].text, /Multi: A, B/);
assert.deepEqual(toolResult.details.answers.multi, ["A", "B"]);

const deferredTool = createRequestUserInputTool({
  requestUserInput: async () => ({ answers: {}, cancelled: false, deferred: true, requestId: "request:deferred" }),
});
const deferredResult = await deferredTool.execute("call-deferred", {
  questions: [{ id: "choice", header: "Choice", question: "Choose", type: "text" }],
});
assert.equal(deferredResult.terminate, true, "a UI handoff ends the current tool turn without waiting");
assert.equal(deferredResult.details.deferred, true);
assert.match(deferredResult.content[0].text, /End this turn now/);

const optionalTextDialog = createRequestUserInputDialog({ questions: [
  { id: "optional-text", header: "Optional", question: "Add a note", type: "text", required: false },
] });
optionalTextDialog.component.setHost({ invalidate() {}, width: () => 100, height: () => 40 });
optionalTextDialog.component.handleInput("s");
assert.equal(optionalTextDialog.component.editor.getText(), "s", "lowercase s must reach an optional text editor");
optionalTextDialog.component.submitEditor("small");
optionalTextDialog.component.handleInput("\r");
assert.deepEqual(await optionalTextDialog.result, { answers: { "optional-text": "small" }, cancelled: false });

const optionalOtherDialog = createRequestUserInputDialog({ questions: [
  { id: "optional-other", header: "Optional", question: "Choose or write", type: "single_select", required: false, allowOther: true, options: [{ label: "Known" }] },
] });
optionalOtherDialog.component.setHost({ invalidate() {}, width: () => 100, height: () => 40 });
optionalOtherDialog.component.handleInput("\x1b[B");
optionalOtherDialog.component.handleInput("\r");
assert.equal(optionalOtherDialog.component.inputPurpose, "other");
optionalOtherDialog.component.handleInput("s");
assert.equal(optionalOtherDialog.component.editor.getText(), "s", "lowercase s must reach an optional Something else editor");

// Exercise every supported question type through the same interaction path used by the TUI.
const dialog = createRequestUserInputDialog({ questions: [
  { id: "text", header: "Text", question: "Say something", type: "text" },
  { id: "single", header: "Single", question: "Choose", type: "single_select", allowOther: true, options: [{ label: "A" }] },
  { id: "multi", header: "Multi", question: "Choose several", type: "multi_select", options: [{ label: "A" }, { label: "B" }], minSelections: 2 },
  { id: "confirm", header: "Confirm", question: "Continue?", type: "confirm" },
  { id: "files", header: "Files", question: "Pick paths", type: "file_select", multiple: true, options: [{ label: "src/a.mjs" }] },
  { id: "number", header: "Number", question: "How many?", type: "number", min: 1, max: 4 },
  { id: "date", header: "Date", question: "When?", type: "date" },
  { id: "ranking", header: "Rank", question: "Order", type: "ranking", options: [{ label: "Safety" }, { label: "Speed" }] },
] });
assert.ok(dialog);
dialog.component.setHost({ invalidate() {}, width: () => 100, height: () => 40 });
const renderCurrentQuestion = () => assert.ok(dialog.component.render(80).length > 0);
const initialForm = dialog.component.render(80).join("\n");
assert.match(initialForm, /Asked 8 questions/, "the TUI presents one question-set form");
assert.match(initialForm, /Text/);
assert.match(initialForm, /Rank/, "later questions remain visible while the first field is active");

renderCurrentQuestion();
dialog.component.submitEditor("Hello");
renderCurrentQuestion();
dialog.component.handleInput("\x1b[B");
dialog.component.handleInput("\r");
assert.equal(dialog.component.inputPurpose, "other");
renderCurrentQuestion();
dialog.component.submitEditor("Custom choice");
renderCurrentQuestion();
dialog.component.handleInput(" ");
dialog.component.handleInput("\x1b[B");
dialog.component.handleInput(" ");
dialog.component.handleInput("\r");
renderCurrentQuestion();
dialog.component.handleInput("\r");
renderCurrentQuestion();
dialog.component.handleInput(" ");
dialog.component.handleInput("\r");
renderCurrentQuestion();
dialog.component.submitEditor("3");
renderCurrentQuestion();
dialog.component.submitEditor("2026-08-20");
renderCurrentQuestion();
dialog.component.handleInput("\r");
assert.equal(dialog.component.isReview(), true);
renderCurrentQuestion();
dialog.component.handleInput("\r");
assert.deepEqual(await dialog.result, {
  answers: {
    text: "Hello",
    single: "Custom choice",
    multi: ["A", "B"],
    confirm: "Yes",
    files: ["src/a.mjs"],
    number: "3",
    date: "2026-08-20",
    ranking: ["Safety", "Speed"],
  },
  cancelled: false,
});

const sdkSource = readFileSync(new URL("../src/zyra-sdk.mjs", import.meta.url), "utf8");
const bridgeSource = readFileSync(new URL("../src/zyra-ui-bridge.mjs", import.meta.url), "utf8");
const serverSource = readFileSync(new URL("../src/agent-server/server.mjs", import.meta.url), "utf8");
const tuiRuntimeSource = readFileSync(new URL("../src/agent-server/tui-runtime.mjs", import.meta.url), "utf8");
const systemPromptSource = readFileSync(new URL("../prompts/zyra_system_prompt.md", import.meta.url), "utf8");
const tuiSource = readFileSync(new URL("../src/zyra-ui.mjs", import.meta.url), "utf8");
assert.match(sdkSource, /createRequestUserInputTool/);
assert.match(bridgeSource, /user_input_requested/);
assert.match(bridgeSource, /user_input\.respond/);
assert.match(serverSource, /user_input\\\.respond/);
assert.match(tuiRuntimeSource, /setUserInputHandler/);
assert.match(tuiSource, /QuestionHandoffInputComponent/, "TUI question handoffs multiplex the form with the normal composer");
assert.match(tuiSource, /preserveComposer: true/, "TUI keeps the composer available while questions are pending");
assert.match(tuiSource, /✓ Answered \$\{count\}/, "submitted TUI forms collapse to an Answered N questions boundary");
assert.match(tuiSource, /=== "requestuserinput"/, "the raw question tool does not duplicate the TUI form");
assert.match(tuiRuntimeSource, /enqueueUserInputContinuation\(continuationPrompt\)/, "TUI answers enter the new-turn continuation queue");
assert.match(tuiRuntimeSource, /queuedUserInputContinuations[\s\S]*session\.prompt\(prompt\)/, "TUI answer continuations wait for the current canonical turn and then use a real prompt");
assert.match(sdkSource, /installDeferredUserInputTurnStop/, "mixed tool batches still stop after a question handoff");
assert.match(bridgeSource, /continuationPrompt/, "the bridge returns a surface-neutral continuation prompt");
assert.match(systemPromptSource, /There is no separate planning mode/);
assert.match(systemPromptSource, /Use `request_user_input` only after inspecting available context/);
assert.match(systemPromptSource, /Submitted answers return as a real user message and begin a new turn/);
assert.match(systemPromptSource, /Use a `<proposed_plan>` card/);

console.log("request_user_input Desktop and TUI contract tests passed");
