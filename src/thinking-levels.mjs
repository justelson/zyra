import { normalizeReasoningChoice, reasoningChoiceForNativeId } from './reasoning-choices.mjs';
export const GPT_56_THINKING_LEVELS = Object.freeze(["low", "medium", "high", "xhigh", "max"]);

const PI_THINKING_LEVELS = Object.freeze(["off", "minimal", "low", "medium", "high", "xhigh"]);
const KNOWN_THINKING_LEVELS = new Set([...PI_THINKING_LEVELS, "none", "max"]);
const GPT_56_MODEL_RE = /(?:^|\/)gpt-5\.6(?:-|$)/i;
const CHATGPT_MODEL_RE = /(?:^|\/)(?:gpt-|codex-)/i;

function modelIdentity(model) {
  if (typeof model === "string") return model;
  return [model?.provider, model?.id].filter(Boolean).join("/");
}

export function isGpt56Model(model) {
  const identity = String(modelIdentity(model));
  return (!identity.includes("/") || /^(?:openai-codex|openai)\//i.test(identity)) && GPT_56_MODEL_RE.test(identity);
}

export function isChatGptReasoningModel(model) {
  const identity = String(modelIdentity(model));
  return (!identity.includes("/") || /^(?:openai-codex|openai)\//i.test(identity)) && CHATGPT_MODEL_RE.test(identity);
}

export function normalizeZyraThinkingLevel(value) {
  return normalizeReasoningChoice(value);
}

/** Session model copies can predate discovery/registry composition. Resolve the
 * selected model's capabilities from the already loaded account catalog. */
export function resolveSessionThinkingModel(session, model = session?.model) {
  const metadata = session?.modelRegistry?.zyraOpenAIModelCatalog?.get(model?.provider)?.find(entry => entry.id === model?.id);
  if (!Array.isArray(metadata?.supportedEfforts)) return model;
  return { ...model, reasoning: metadata.supportedEfforts.length > 0, zyraSupportedEfforts: metadata.supportedEfforts };
}

export function getModelThinkingLevels(model, piLevels = PI_THINKING_LEVELS) {
  if (Array.isArray(model?.zyraSupportedEfforts)) return [...model.zyraSupportedEfforts];
  if (model?.provider === "opencode-harness") {
    return [...new Set((model.harness?.variants ?? []).map(reasoningChoiceForNativeId).filter(Boolean))];
  }
  if (typeof model === "object" && model?.reasoning === false) return [];
  if (isGpt56Model(model)) return [...GPT_56_THINKING_LEVELS];
  const levels = Array.isArray(piLevels) ? piLevels.filter((level) => KNOWN_THINKING_LEVELS.has(level)) : [];
  if (isChatGptReasoningModel(model)) {
    const chatGptLevels = levels.filter((level) => !["off", "none", "minimal"].includes(level));
    return chatGptLevels.length > 0 ? chatGptLevels : ["low"];
  }
  return levels.length > 0 ? [...levels] : ["off"];
}

export function coerceThinkingLevelForModel(value, model, piLevels = PI_THINKING_LEVELS) {
  const requested = normalizeZyraThinkingLevel(value) ?? "medium";
  const levels = getModelThinkingLevels(model, piLevels);
  if (requested === 'default') return requested;
  if (Array.isArray(model?.zyraSupportedEfforts) || model?.provider === 'opencode-harness') return levels.includes(requested) ? requested : 'default';
  if (!levels.length) return 'default';

  if (isGpt56Model(model)) {
    if (["off", "none", "minimal"].includes(requested)) return "low";
    return levels.includes(requested) ? requested : "medium";
  }

  const compatible = isChatGptReasoningModel(model) && ["off", "none", "minimal"].includes(requested)
    ? "low"
    : requested === "none"
      ? "off"
      : requested === "max"
        ? "xhigh"
        : requested;
  if (levels.includes(compatible)) return compatible;
  return clampToAvailablePiLevel(compatible, levels);
}

export function toRuntimeThinkingLevel(value) {
  const level = normalizeZyraThinkingLevel(value) ?? "medium";
  if (level === 'default' || level.startsWith('variant:')) return 'off';
  if (level === "none") return "off";
  if (level === "max") return "xhigh";
  return level;
}

export function applyGpt56ThinkingEffort(payload, value) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !isGpt56Model(payload.model)) {
    return payload;
  }
  const level = coerceThinkingLevelForModel(value, payload.model);
  const reasoning = payload.reasoning && typeof payload.reasoning === "object" && !Array.isArray(payload.reasoning)
    ? payload.reasoning
    : {};
  return {
    ...payload,
    reasoning: {
      ...reasoning,
      effort: level,
    },
  };
}

function clampToAvailablePiLevel(requested, levels) {
  const requestedIndex = PI_THINKING_LEVELS.indexOf(requested);
  if (requestedIndex === -1) return levels[0] ?? "off";
  for (let index = requestedIndex; index < PI_THINKING_LEVELS.length; index += 1) {
    if (levels.includes(PI_THINKING_LEVELS[index])) return PI_THINKING_LEVELS[index];
  }
  for (let index = requestedIndex - 1; index >= 0; index -= 1) {
    if (levels.includes(PI_THINKING_LEVELS[index])) return PI_THINKING_LEVELS[index];
  }
  return levels[0] ?? "off";
}
