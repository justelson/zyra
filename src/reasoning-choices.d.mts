export type ReasoningChoice = 'default' | 'off' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | `variant:${string}`;
export const REASONING_LABELS: Record<ReasoningChoice, string>;
export function isNativeReasoningId(value: unknown): value is string;
export function reasoningChoiceForNativeId(value: unknown): ReasoningChoice | undefined;
export function normalizeReasoningChoice(value: unknown): ReasoningChoice | undefined;
export function nativeReasoningValue(value: unknown): string | undefined;
export function reasoningChoiceLabel(value: unknown): string;
