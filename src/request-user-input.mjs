export const REQUEST_USER_INPUT_TYPES = Object.freeze([
  "text",
  "single_select",
  "multi_select",
  "confirm",
  "file_select",
  "number",
  "date",
  "ranking",
]);

const QUESTION_TYPE_SET = new Set(REQUEST_USER_INPUT_TYPES);

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function finiteNumber(value) {
  const number = typeof value === "number" ? value : stringValue(value) ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : undefined;
}

export function normalizeRequestUserInputQuestions(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry, index) => {
    const record = entry && typeof entry === "object" && !Array.isArray(entry) ? entry : {};
    const seenOptionLabels = new Set();
    const options = (Array.isArray(record.options) ? record.options : []).map((option) => {
      const optionRecord = option && typeof option === "object" && !Array.isArray(option) ? option : {};
      const label = stringValue(optionRecord.label || optionRecord.value);
      if (!label || seenOptionLabels.has(label)) return null;
      seenOptionLabels.add(label);
      return {
        label,
        description: stringValue(optionRecord.description),
        recommended: optionRecord.recommended === true,
      };
    }).filter(Boolean);
    const rawType = stringValue(record.type || record.kind).toLowerCase().replace(/[ -]+/g, "_");
    const type = QUESTION_TYPE_SET.has(rawType) ? rawType : options.length > 0 ? "single_select" : "text";
    const min = finiteNumber(record.min);
    const max = finiteNumber(record.max);
    const step = finiteNumber(record.step);
    const minSelections = finiteNumber(record.minSelections ?? record.min_selections);
    const maxSelections = finiteNumber(record.maxSelections ?? record.max_selections);
    return {
      id: stringValue(record.id) || `question-${index + 1}`,
      header: stringValue(record.header || record.label) || `Question ${index + 1}`,
      question: stringValue(record.question || record.prompt),
      type,
      options,
      required: record.required !== false,
      allowOther: record.allowOther === true || record.allow_other === true,
      placeholder: stringValue(record.placeholder),
      multiple: record.multiple === true,
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
      ...(step !== undefined ? { step } : {}),
      ...(minSelections !== undefined ? { minSelections } : {}),
      ...(maxSelections !== undefined ? { maxSelections } : {}),
    };
  }).filter((question) => question.question);
}

export function isRequestUserInputAnswerComplete(question, value, hasAnswer = value !== undefined) {
  if (!hasAnswer) return false;
  if (question.required === false && (value === "" || (Array.isArray(value) && value.length === 0))) return true;
  if (question.type === "multi_select" || question.type === "file_select") {
    const answers = Array.isArray(value) ? value.filter((entry) => stringValue(entry)) : stringValue(value) ? [String(value)] : [];
    const minimum = Math.max(question.required === false ? 0 : 1, Number(question.minSelections) || 0);
    const maximum = Number(question.maxSelections);
    return answers.length >= minimum && (!Number.isFinite(maximum) || answers.length <= maximum);
  }
  if (question.type === "ranking") {
    const answers = Array.isArray(value) ? value : [];
    const expected = question.options.map((option) => option.label);
    return answers.length === expected.length && new Set(answers).size === expected.length && answers.every((answer) => expected.includes(answer));
  }
  const answer = stringValue(value);
  if (!answer) return false;
  if (question.type === "number") {
    const number = Number(answer);
    return Number.isFinite(number)
      && (question.min === undefined || number >= question.min)
      && (question.max === undefined || number <= question.max);
  }
  if (question.type === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(answer)) return false;
    return (question.min === undefined || answer >= String(question.min))
      && (question.max === undefined || answer <= String(question.max));
  }
  return true;
}

export function formatRequestUserInputAnswers(questions, answers) {
  return questions.map((question) => {
    const value = answers?.[question.id];
    const display = Array.isArray(value)
      ? question.type === "ranking" ? value.join(" → ") : value.join(", ")
      : stringValue(value) || "Skipped";
    return `${question.header}: ${display}`;
  }).join("\n");
}

export function formatRequestUserInputContinuationPrompt(questions, answers) {
  const lines = formatRequestUserInputAnswers(questions, answers)
    .split("\n")
    .filter(Boolean)
    .map((line) => `- ${line}`);
  return ["Here are my answers:", "", ...lines].join("\n");
}
