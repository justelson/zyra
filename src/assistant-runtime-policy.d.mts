export type ModelCompactionOverrides = Record<string, number>;
export interface CompactionModel {
  id?: string; provider?: string; api?: string; contextWindow?: number | null; maxTokens?: number | null;
  context_window?: number | null; max_context_window?: number | null; auto_compact_token_limit?: number | null;
  effective_context_window_percent?: number | null; metadataSource?: string | null;
  maxContextWindow?: number | null; autoCompactTokenLimit?: number | null; effectiveContextWindowPercent?: number | null;
  zyraModelInfo?: CompactionModel;
}
export interface ModelCompactionPolicy {
  selector: string; thresholdTokens: number | null; source: 'override' | 'provider' | 'fallback' | 'unknown';
  contextWindow: number | null; rawContextWindow: number | null; usableContextWindow: number | null; maxContextWindow: number | null;
  maxThresholdTokens: number | null; providerThresholdTokens: number | null; metadataSource: string | null;
}
export const DEFAULT_ASSISTANT_REASONING_SUMMARY: 'detailed';
export const DEFAULT_ASSISTANT_CONTEXT_COMPACTION_THRESHOLD_TOKENS: number;
export const MIN_ASSISTANT_CONTEXT_COMPACTION_THRESHOLD_TOKENS: number;
export const MAX_ASSISTANT_CONTEXT_COMPACTION_THRESHOLD_TOKENS: number;
export const ASSISTANT_CONTEXT_COMPACTION_OUTPUT_RESERVE_TOKENS: number;
export const ASSISTANT_CONTEXT_COMPACTION_PROMPT_HEADROOM_TOKENS: number;
export const MIN_ASSISTANT_AUTOMATIC_COMPACTION_CONTEXT_TOKENS: number;
export function normalizeAssistantReasoningSummary(value: unknown): 'auto' | 'concise' | 'detailed';
export function normalizeAssistantContextCompactionThreshold(value: unknown): number;
export function normalizeAssistantModelCompactionOverrides(value: unknown): ModelCompactionOverrides;
export const normalizeModelCompactionOverrides: typeof normalizeAssistantModelCompactionOverrides;
export function resolveModelCompactionPolicy(model?: CompactionModel | null, overrides?: ModelCompactionOverrides): ModelCompactionPolicy;
export function getModelCompactionPresets(model?: CompactionModel | null): number[];
export function resolveAssistantContextCompactionThreshold(contextWindow: unknown, configuredThreshold: unknown): number;
export function applyAssistantReasoningSummary(payload: unknown, mode: unknown): unknown;
export function shouldCompactAssistantContext(options: { contextTokens: unknown; contextWindow?: unknown; configuredThreshold?: unknown; promptTokens?: number; additionalContextTokens?: number; imageCount?: number }): boolean;
