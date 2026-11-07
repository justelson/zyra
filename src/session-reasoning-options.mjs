import { coerceThinkingLevelForModel, toRuntimeThinkingLevel, resolveSessionThinkingModel } from './thinking-levels.mjs';
import { nativeReasoningValue } from './reasoning-choices.mjs';
import { applyProviderDefaultReasoning } from './provider-default-reasoning.mjs';

/** Preserve the session's choice outside the engine's legacy thinking enum.
 * Snapshot it per request; provider registrations are shared by child chats. */
export function installSessionReasoningOptions(session, getChoice) {
  const agent = session?.agent;
  if (typeof agent?.streamFunction !== 'function') return;
  const stream = agent.streamFunction;
  agent.streamFunction = (model, context, options = {}) => {
    model = resolveSessionThinkingModel(session, model);
    const choice = coerceThinkingLevelForModel(typeof getChoice === 'function' ? getChoice() : getChoice, model);
    return stream(model, context, {
      ...options,
      reasoning: toRuntimeThinkingLevel(choice),
      zyraReasoningChoice: choice,
      onPayload: async (payload, ...args) => {
        const replacement = await options.onPayload?.(payload, ...args);
        const resolved = replacement ?? payload;
        return applySessionReasoningPayload(resolved, model, choice);
      },
    });
  };
}
export function reasoningStateReader(state) { return () => state.value; }
export function applySessionReasoningPayload(payload, model, value) {
  const choice = coerceThinkingLevelForModel(value, model);
  if (choice === 'default') return applyProviderDefaultReasoning(payload);
  if (Array.isArray(model?.zyraSupportedEfforts) && payload?.model === model.id && ['openai-responses', 'openai-codex-responses', 'azure-openai-responses'].includes(model.api)) {
    return { ...payload, reasoning: { ...payload.reasoning, effort: nativeReasoningValue(choice) } };
  }
  return payload;
}
