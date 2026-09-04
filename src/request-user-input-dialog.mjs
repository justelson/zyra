import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, Editor, Key, matchesKey, Text, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { buildTerminalTheme } from "./terminal-theme.mjs";
import { isRequestUserInputAnswerComplete, normalizeRequestUserInputQuestions } from "./request-user-input.mjs";

const bold = "\x1b[1m";
const reset = "\x1b[0m";

function effectiveOptions(question) {
  if (question.type === "confirm" && question.options.length < 2) {
    return [
      { label: "Yes", description: "Confirm and continue" },
      { label: "No", description: "Decline" },
    ];
  }
  return question.options;
}

function answerArray(value) {
  return Array.isArray(value) ? value : typeof value === "string" && value ? [value] : [];
}

function formatAnswer(question, value) {
  if (Array.isArray(value)) return question.type === "ranking" ? value.join(" → ") : value.join(", ");
  return String(value || "Skipped");
}

export function createRequestUserInputDialog(request = {}, options = {}) {
  const questions = normalizeRequestUserInputQuestions(request.questions);
  if (questions.length === 0) return null;
  let finish = () => {};
  let finished = false;
  const result = new Promise((resolve) => {
    finish = (value) => {
      if (finished) return;
      finished = true;
      resolve(value || { answers: {}, cancelled: true });
    };
  });
  const component = new RequestUserInputDialogComponent(questions, buildTerminalTheme(options.theme), finish);
  return { component, result, cancel: () => finish({ answers: {}, cancelled: true }) };
}

export class RequestUserInputDialogComponent {
  constructor(questions, theme, done) {
    this.key = `request-user-input-${Date.now()}-${Math.random()}`;
    this.questions = questions;
    this.theme = theme;
    this.done = done;
    this.answers = {};
    this.questionIndex = 0;
    this.optionIndex = 0;
    this.inputMode = false;
    this.inputPurpose = "text";
    this.validationMessage = "";
    this.rankingByQuestionId = new Map();
    const dialog = this;
    this.tuiProxy = {
      requestRender: () => this.host?.invalidate({ fixedOnly: true, force: true }),
      terminal: {
        get columns() {
          const columns = Number(dialog.host?.width?.());
          return Number.isFinite(columns) && columns > 0 ? columns : 80;
        },
        get rows() {
          const rows = Number(dialog.host?.height?.());
          return Number.isFinite(rows) && rows > 0 ? rows : 24;
        },
      },
    };
    this.editor = new Editor(this.tuiProxy, {
      borderColor: (text) => `${theme.accent}${text}${reset}`,
      selectList: {
        selectedPrefix: (text) => `${theme.accent}${text}${reset}`,
        selectedText: (text) => `${theme.accent}${text}${reset}`,
        description: (text) => `${theme.menuDescriptionFg ?? theme.muted}${text}${reset}`,
        scrollInfo: (text) => `${theme.dimMuted}${text}${reset}`,
        noMatch: (text) => `${theme.warning}${text}${reset}`,
      },
    });
    this.editor.onSubmit = (value) => this.submitEditor(value);
    this.prepareQuestion();
  }

  setHost(host) {
    this.host = host;
  }

  currentQuestion() {
    return this.questions[this.questionIndex];
  }

  isReview() {
    return this.questionIndex >= this.questions.length;
  }

  prepareQuestion() {
    this.optionIndex = 0;
    this.validationMessage = "";
    if (this.isReview()) {
      this.inputMode = false;
      return;
    }
    const question = this.currentQuestion();
    if (question.type === "ranking" && !this.rankingByQuestionId.has(question.id)) {
      this.rankingByQuestionId.set(question.id, effectiveOptions(question).map((option) => option.label));
    }
    if (["text", "number", "date"].includes(question.type)) {
      this.inputMode = true;
      this.inputPurpose = "text";
      this.editor.setText(typeof this.answers[question.id] === "string" ? this.answers[question.id] : "");
    } else {
      this.inputMode = false;
    }
    this.host?.invalidate({ fixedOnly: true, force: true });
  }

  advance() {
    this.questionIndex += 1;
    this.prepareQuestion();
  }

  goBack() {
    if (this.questionIndex <= 0) return;
    this.questionIndex -= 1;
    this.prepareQuestion();
  }

  saveAndAdvance(question, value) {
    this.answers[question.id] = value;
    this.advance();
  }

  submitEditor(value) {
    const question = this.currentQuestion();
    if (!question) return;
    const trimmed = String(value || "").trim();
    if (this.inputPurpose === "other") {
      if (!trimmed) {
        this.validationMessage = "Write an answer or press escape to return to the choices.";
        return this.host?.invalidate({ fixedOnly: true, force: true });
      }
      if (question.type === "multi_select" || question.type === "file_select") {
        const selected = answerArray(this.answers[question.id]).filter((answer) => effectiveOptions(question).some((option) => option.label === answer));
        this.saveAndAdvance(question, [...selected, trimmed]);
      } else {
        this.saveAndAdvance(question, trimmed);
      }
      return;
    }
    if (!isRequestUserInputAnswerComplete(question, trimmed, true)) {
      this.validationMessage = question.required === false && !trimmed
        ? "Press S to skip this optional question."
        : question.type === "number" ? "Enter a number within the requested range." : question.type === "date" ? "Enter a date as YYYY-MM-DD." : "An answer is required.";
      return this.host?.invalidate({ fixedOnly: true, force: true });
    }
    this.saveAndAdvance(question, trimmed);
  }

  toggleSelected(question, label) {
    const current = answerArray(this.answers[question.id]);
    const selected = current.includes(label) ? current.filter((entry) => entry !== label) : [...current, label];
    if (question.maxSelections && selected.length > question.maxSelections) {
      this.validationMessage = `Choose at most ${question.maxSelections}.`;
      return;
    }
    this.validationMessage = "";
    this.answers[question.id] = selected;
  }

  handleInput(data) {
    const question = this.currentQuestion();
    if (this.inputMode && question) {
      if (matchesKey(data, Key.escape)) {
        if (this.inputPurpose === "other") {
          this.inputMode = false;
          this.editor.setText("");
          this.validationMessage = "";
          return this.host?.invalidate({ fixedOnly: true, force: true });
        }
        this.done({ answers: {}, cancelled: true });
        return;
      }
      this.editor.handleInput(data);
      this.host?.invalidate({ fixedOnly: true, force: true });
      return;
    }
    if (matchesKey(data, Key.escape)) {
      this.done({ answers: {}, cancelled: true });
      return;
    }
    if (this.isReview()) {
      if (matchesKey(data, Key.left) || matchesKey(data, Key.backspace)) return this.goBack();
      if (matchesKey(data, Key.enter)) this.done({ answers: { ...this.answers }, cancelled: false });
      return;
    }
    if (!question) return;
    if (matchesKey(data, "s") && question.required === false) {
      this.saveAndAdvance(question, question.type === "multi_select" || question.type === "file_select" || question.type === "ranking" ? [] : "");
      return;
    }
    if (matchesKey(data, Key.left)) return this.goBack();

    if (question.type === "ranking") {
      const ranking = [...(this.rankingByQuestionId.get(question.id) || [])];
      if (matchesKey(data, Key.up)) this.optionIndex = Math.max(0, this.optionIndex - 1);
      else if (matchesKey(data, Key.down)) this.optionIndex = Math.min(ranking.length - 1, this.optionIndex + 1);
      else if (matchesKey(data, Key.shift("up")) && this.optionIndex > 0) {
        [ranking[this.optionIndex - 1], ranking[this.optionIndex]] = [ranking[this.optionIndex], ranking[this.optionIndex - 1]];
        this.optionIndex -= 1;
      } else if (matchesKey(data, Key.shift("down")) && this.optionIndex < ranking.length - 1) {
        [ranking[this.optionIndex + 1], ranking[this.optionIndex]] = [ranking[this.optionIndex], ranking[this.optionIndex + 1]];
        this.optionIndex += 1;
      } else if (matchesKey(data, Key.enter)) return this.saveAndAdvance(question, ranking);
      this.rankingByQuestionId.set(question.id, ranking);
      return this.host?.invalidate({ fixedOnly: true, force: true });
    }

    const options = effectiveOptions(question);
    const optionCount = options.length + (question.allowOther ? 1 : 0);
    if (matchesKey(data, Key.up)) this.optionIndex = Math.max(0, this.optionIndex - 1);
    else if (matchesKey(data, Key.down)) this.optionIndex = Math.min(Math.max(0, optionCount - 1), this.optionIndex + 1);
    else if ((question.type === "multi_select" || question.type === "file_select") && matchesKey(data, Key.space)) {
      const option = options[this.optionIndex];
      if (option) this.toggleSelected(question, option.label);
    } else if (matchesKey(data, Key.enter)) {
      if (question.allowOther && this.optionIndex === options.length) {
        this.inputMode = true;
        this.inputPurpose = "other";
        this.editor.setText("");
      } else if (question.type === "multi_select" || question.type === "file_select") {
        const value = answerArray(this.answers[question.id]);
        if (isRequestUserInputAnswerComplete(question, value, true)) return this.saveAndAdvance(question, value);
        this.validationMessage = "Select the required choices before continuing.";
      } else {
        const option = options[this.optionIndex];
        if (option) return this.saveAndAdvance(question, option.label);
      }
    }
    this.host?.invalidate({ fixedOnly: true, force: true });
  }

  handleKeypress(str, key) {
    this.handleInput(key?.sequence ?? str ?? "");
  }

  render(width) {
    const safeWidth = Math.max(32, Number(width) || 80);
    const innerWidth = Math.max(24, safeWidth - 7);
    const border = () => new DynamicBorder((text) => `${this.theme.accent}${text}${reset}`);
    const container = new Container();
    container.addChild(border());
    container.addChild(new Text(`${this.theme.accent}${bold}Asked ${this.questions.length} ${this.questions.length === 1 ? "question" : "questions"}${reset}`, 1, 0));

    for (let questionIndex = 0; questionIndex < this.questions.length; questionIndex += 1) {
      const question = this.questions[questionIndex];
      const active = questionIndex === this.questionIndex && !this.isReview();
      const answered = Object.prototype.hasOwnProperty.call(this.answers, question.id);
      const marker = active ? `${this.theme.accent}›${reset}` : answered ? `${this.theme.success}✓${reset}` : `${this.theme.dimMuted}·${reset}`;
      container.addChild(new Text(`${marker} ${active ? this.theme.accent : this.theme.primary}${bold}${questionIndex + 1}. ${question.header}${reset}`, 1, 0));
      for (const line of wrapTextWithAnsi(question.question, innerWidth)) {
        container.addChild(new Text(`${active ? this.theme.primary : this.theme.muted}   ${line}${reset}`, 1, 0));
      }

      if (!active) {
        if (answered) container.addChild(new Text(`${this.theme.dimMuted}   Answer: ${formatAnswer(question, this.answers[question.id])}${reset}`, 1, 0));
        continue;
      }

      if (this.inputMode) {
        container.addChild(this.editor);
      } else if (question.type === "ranking") {
        const ranking = this.rankingByQuestionId.get(question.id) || [];
        ranking.forEach((label, index) => container.addChild(new Text(`${index === this.optionIndex ? this.theme.accent : this.theme.muted}   ${index === this.optionIndex ? "›" : " "} ${index + 1}. ${label}${reset}`, 1, 0)));
      } else {
        const options = effectiveOptions(question);
        const selected = answerArray(this.answers[question.id]);
        options.forEach((option, index) => {
          const focused = index === this.optionIndex;
          const checked = selected.includes(option.label);
          const optionMarker = question.type === "multi_select" || question.type === "file_select" ? (checked ? "[x]" : "[ ]") : focused ? "●" : "○";
          const recommended = option.recommended ? ` ${this.theme.success}Recommended${reset}` : "";
          container.addChild(new Text(`${focused ? this.theme.accent : this.theme.muted}   ${optionMarker} ${option.label}${reset}${recommended}`, 1, 0));
          if (option.description) container.addChild(new Text(`${this.theme.dimMuted}      ${option.description}${reset}`, 1, 0));
        });
        if (question.allowOther) {
          const focused = this.optionIndex === options.length;
          container.addChild(new Text(`${focused ? this.theme.accent : this.theme.muted}   ${focused ? "●" : "○"} Something else${reset}`, 1, 0));
        }
      }
    }

    if (this.isReview()) {
      container.addChild(new Text(`${this.theme.success}All questions answered.${reset} ${this.theme.dimMuted}enter submit • ← edit last • esc dismiss${reset}`, 1, 0));
    } else {
      const question = this.currentQuestion();
      if (this.validationMessage) container.addChild(new Text(`${this.theme.warning}${this.validationMessage}${reset}`, 1, 0));
      const help = this.inputMode
        ? this.inputPurpose === "other" ? "enter continue • esc choices" : "enter continue • esc dismiss"
        : question.type === "ranking"
          ? "↑↓ navigate • shift+↑↓ reorder • enter continue • ← back • esc dismiss"
          : question.type === "multi_select" || question.type === "file_select"
            ? "↑↓ navigate • space toggle • enter continue • ← back • esc dismiss"
            : "↑↓ navigate • enter choose • ← back • esc dismiss";
      const helpWithSkip = question.required !== false
        ? help
        : this.inputMode
          ? this.inputPurpose === "other" ? help : `${help} • empty enter skip`
          : `${help} • s skip`;
      container.addChild(new Text(`${this.theme.dimMuted}${helpWithSkip}${reset}`, 1, 0));
    }
    container.addChild(border());
    return container.render(safeWidth);
  }

  dispose() {}
}
