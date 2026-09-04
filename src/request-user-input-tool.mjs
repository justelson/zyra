import { Type } from "typebox";
import {
  REQUEST_USER_INPUT_TYPES,
  formatRequestUserInputAnswers,
  normalizeRequestUserInputQuestions,
} from "./request-user-input.mjs";

const QuestionTypeSchema = Type.Unsafe({
  type: "string",
  enum: [...REQUEST_USER_INPUT_TYPES],
  description: "Input control that best matches the decision.",
});

const QuestionOptionSchema = Type.Object({
  label: Type.String({ description: "Short value shown to the user and returned when selected." }),
  description: Type.Optional(Type.String({ description: "Useful distinction or consequence of this option." })),
  recommended: Type.Optional(Type.Boolean({ description: "Mark this option as the agent's recommendation." })),
});

const QuestionSchema = Type.Object({
  id: Type.String({ description: "Stable unique id for this question." }),
  header: Type.String({ description: "Short context label." }),
  question: Type.String({ description: "The decision the user needs to make." }),
  type: QuestionTypeSchema,
  options: Type.Optional(Type.Array(QuestionOptionSchema, { description: "Choices for select, file, confirm, and ranking questions." })),
  required: Type.Optional(Type.Boolean({ description: "Whether the user must answer. Defaults to true." })),
  allowOther: Type.Optional(Type.Boolean({ description: "Allow a custom typed answer for single or multi-select. Defaults to false." })),
  placeholder: Type.Optional(Type.String({ description: "Helpful placeholder for text or numeric input." })),
  multiple: Type.Optional(Type.Boolean({ description: "Allow several file choices for file_select." })),
  min: Type.Optional(Type.Number({ description: "Optional minimum for number input." })),
  max: Type.Optional(Type.Number({ description: "Optional maximum for number input." })),
  step: Type.Optional(Type.Number({ description: "Optional number increment." })),
  minSelections: Type.Optional(Type.Number({ description: "Optional minimum selections for multi_select or file_select." })),
  maxSelections: Type.Optional(Type.Number({ description: "Optional maximum selections for multi_select or file_select." })),
});

export function createRequestUserInputTool(options = {}) {
  const requestUserInput = typeof options.requestUserInput === "function" ? options.requestUserInput : null;
  return {
    name: "request_user_input",
    label: "Request user input",
    description: "Hand off one or more materially blocking questions using text, select, confirm, project-file, number, date, or ranking controls. The question set ends the current assistant turn; submitted answers arrive as a new user turn.",
    promptSnippet: "Hand off blocking questions with purpose-built interactive controls",
    promptGuidelines: [
      "Use request_user_input only after inspecting available context and only when a user decision materially blocks useful work.",
      "Before calling request_user_input, explain briefly why the answer is needed. The call ends the current assistant turn.",
      "Never use request_user_input for discoverable facts, routine progress updates, or secrets.",
      "Use as many questions as are materially necessary; batch related decisions without manufacturing extra questions.",
      "Choose text for open answers, single_select for an obvious bounded choice, multi_select for several choices, confirm for a true yes/no decision, file_select for user choice among known project paths, number or date when validation matters, and ranking when order is the decision.",
      "Set allowOther only when listed select choices may reasonably be incomplete; it is false by default.",
      "When presenting meaningful tradeoffs, mark one option recommended and explain the consequence briefly.",
    ],
    parameters: Type.Object({
      questions: Type.Array(QuestionSchema, { description: "All materially necessary questions. No arbitrary maximum." }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const questions = normalizeRequestUserInputQuestions(params?.questions);
      if (questions.length === 0) throw new Error("request_user_input requires at least one valid question.");
      if (signal?.aborted) return { content: [{ type: "text", text: "Cancelled" }], details: { questions, answers: {}, cancelled: true } };
      if (!requestUserInput) {
        return {
          content: [{ type: "text", text: "Interactive user input is unavailable on this surface. Ask the questions briefly in normal chat instead." }],
          details: { questions, answers: {}, cancelled: true, unavailable: true },
        };
      }
      const result = await requestUserInput({ questions, cwd: ctx?.cwd }, { signal });
      const answers = result && typeof result === "object" && result.answers && typeof result.answers === "object"
        ? result.answers
        : {};
      const cancelled = result?.cancelled === true;
      const deferred = result?.deferred === true;
      return {
        content: [{
          type: "text",
          text: deferred
            ? "Questions handed off to the user. End this turn now; their submitted answers will start a new user turn."
            : cancelled
              ? "The user dismissed the questions without submitting answers. Do not assume answers."
              : `User answers:\n${formatRequestUserInputAnswers(questions, answers)}`,
        }],
        details: { questions, answers, cancelled, deferred, requestId: result?.requestId },
        ...(deferred ? { terminate: true } : {}),
      };
    },
  };
}
