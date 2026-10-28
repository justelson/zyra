export const DEFAULT_ASSISTANT_REASONING_SUMMARY = "detailed";
export const DEFAULT_ASSISTANT_CONTEXT_COMPACTION_THRESHOLD_TOKENS = 256_000;
export const MIN_ASSISTANT_CONTEXT_COMPACTION_THRESHOLD_TOKENS = 64_000;
export const MAX_ASSISTANT_CONTEXT_COMPACTION_THRESHOLD_TOKENS = 372_000;
export const ASSISTANT_CONTEXT_COMPACTION_OUTPUT_RESERVE_TOKENS = 16_000;
export const ASSISTANT_CONTEXT_COMPACTION_PROMPT_HEADROOM_TOKENS = 16_000;
export const MIN_ASSISTANT_AUTOMATIC_COMPACTION_CONTEXT_TOKENS = 32_000;

export function normalizeAssistantReasoningSummary(value) {
  return value === "auto" || value === "concise" || value === "detailed"
    ? value
    : DEFAULT_ASSISTANT_REASONING_SUMMARY;
}

export function normalizeAssistantContextCompactionThreshold(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_ASSISTANT_CONTEXT_COMPACTION_THRESHOLD_TOKENS;
  // Legacy preference only: preserve the saved value, without a global cap.
  return Math.max(1, Math.round(parsed));
}

export function applyAssistantReasoningSummary(payload, mode) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  if (!payload.reasoning || typeof payload.reasoning !== "object" || Array.isArray(payload.reasoning)) return undefined;
  if (!Array.isArray(payload.include) || !payload.include.includes("reasoning.encrypted_content")) return undefined;
  return {
    ...payload,
    reasoning: {
      ...payload.reasoning,
      summary: normalizeAssistantReasoningSummary(mode),
    },
  };
}

const positiveTokens = value => typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;

export function normalizeAssistantModelCompactionOverrides(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([selector, tokens]) =>
    selector.length <= 512 && /^[^\s/]+\/[^\s]+$/.test(selector) && typeof tokens === 'number' && Number.isSafeInteger(tokens) && tokens > 0
  ).slice(0, 200).map(([selector, tokens]) => [selector, Math.round(tokens)]));
}

export const normalizeModelCompactionOverrides = normalizeAssistantModelCompactionOverrides;

/** Provider metadata is authoritative. Maximum/extended capacity is informational,
 * never enabled by changing a compaction threshold. Unknown capacity stays null. */
export function resolveModelCompactionPolicy(model, overrides = {}) {
  const metadata = model?.zyraModelInfo ?? model ?? {};
  const id = model?.id ?? metadata.id ?? '';
  const provider = model?.provider ?? metadata.provider ?? (id.includes('/') ? id.split('/')[0] : '');
  const hasProviderMetadata = model?.zyraModelInfo != null;
  const runtimeModel = hasProviderMetadata || typeof model?.api === 'string';
  const selector = provider && id && (runtimeModel || !id.startsWith(`${provider}/`)) ? `${provider}/${id}` : id;
  const rawContextWindow = positiveTokens(metadata.context_window ?? metadata.contextWindow)
    ?? (!hasProviderMetadata ? positiveTokens(model?.contextWindow) : null);
  const percent = metadata.effective_context_window_percent ?? metadata.effectiveContextWindowPercent;
  const effectivePercent = typeof percent === 'number' && Number.isFinite(percent) && percent > 0 && percent <= 100 ? percent : null;
  const contextWindow = rawContextWindow;
  const usableContextWindow = rawContextWindow == null ? null : Math.floor(rawContextWindow * (effectivePercent && effectivePercent <= 100 ? effectivePercent / 100 : 1));
  const maxContextWindow = positiveTokens(metadata.max_context_window ?? metadata.maxContextWindow);
  const providerThresholdTokens = positiveTokens(metadata.auto_compact_token_limit ?? metadata.autoCompactTokenLimit);
  const codex = provider === 'openai-codex';
  const outputReserve = Math.min(positiveTokens(metadata.maxTokens ?? model?.maxTokens) ?? ASSISTANT_CONTEXT_COMPACTION_OUTPUT_RESERVE_TOKENS, ASSISTANT_CONTEXT_COMPACTION_OUTPUT_RESERVE_TOKENS);
  // Codex's automatic threshold and usable-context percent are independent.
  // Apply 90% to the resolved window once, not to an already reduced window.
  const safeWindow = usableContextWindow == null ? null : codex ? usableContextWindow
    : usableContextWindow - Math.min(outputReserve, usableContextWindow * 0.2);
  const maxThresholdTokens = contextWindow == null ? null : Math.max(1, Math.floor(Math.min(contextWindow * 0.9, safeWindow)));
  const recommended = providerThresholdTokens == null ? maxThresholdTokens
    : maxThresholdTokens == null ? providerThresholdTokens : Math.min(providerThresholdTokens, maxThresholdTokens);
  const override = positiveTokens(normalizeAssistantModelCompactionOverrides(overrides)[selector]);
  // An override cannot establish capacity that discovery did not report.
  const thresholdTokens = override != null && maxThresholdTokens != null ? Math.min(override, maxThresholdTokens) : recommended;
  return { selector, thresholdTokens, source: override != null && maxThresholdTokens != null ? 'override'
    : providerThresholdTokens != null ? 'provider' : contextWindow != null ? 'fallback' : 'unknown',
    contextWindow, rawContextWindow, usableContextWindow, maxContextWindow, maxThresholdTokens, providerThresholdTokens,
    metadataSource: metadata.metadataSource ?? null };
}

export function getModelCompactionPresets(model) {
  const policy = resolveModelCompactionPolicy(model);
  if (policy.maxThresholdTokens == null) return [];
  return [...new Set([0.5, 0.7, 0.85, 1].map(ratio => Math.max(1, Math.floor(policy.maxThresholdTokens * ratio)))
    .concat(policy.thresholdTokens == null ? [] : [policy.thresholdTokens]))].sort((a, b) => a - b);
}

export function resolveAssistantContextCompactionThreshold(contextWindow, configuredThreshold) {
  const threshold = normalizeAssistantContextCompactionThreshold(configuredThreshold);
  const windowTokens = Number(contextWindow);
  if (!Number.isFinite(windowTokens) || windowTokens <= 0) return threshold;
  return Math.min(
    threshold,
    Math.max(1, Math.floor(windowTokens - Math.min(ASSISTANT_CONTEXT_COMPACTION_OUTPUT_RESERVE_TOKENS, windowTokens * 0.2))),
  );
}

export function shouldCompactAssistantContext({
  contextTokens,
  contextWindow,
  configuredThreshold,
  promptTokens = 0,
  additionalContextTokens = 0,
  imageCount = 0,
}) {
  const tokens = Number(contextTokens);
  if (!Number.isFinite(tokens) || tokens <= 0) return false;
  const threshold = resolveAssistantContextCompactionThreshold(contextWindow, configuredThreshold);
  if (tokens < Math.min(MIN_ASSISTANT_AUTOMATIC_COMPACTION_CONTEXT_TOKENS, Math.max(1, threshold * 0.25))) return false;
  const projectedTokens = tokens
    + Math.max(0, Number(promptTokens) || 0)
    + Math.max(0, Number(additionalContextTokens) || 0)
    + Math.max(0, Number(imageCount) || 0) * 8_192
    + ASSISTANT_CONTEXT_COMPACTION_PROMPT_HEADROOM_TOKENS;
  return projectedTokens >= threshold;
}
