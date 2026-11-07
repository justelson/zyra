/** Native IDs are encoded so a variant named default remains distinct from the
 * provider default. Nothing here depends on model names or a native enum. */
const LEGACY = new Set(['off', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
export const REASONING_LABELS = Object.freeze({ default: 'Provider default', off: 'Off', none: 'None', minimal: 'Minimal', low: 'Light', medium: 'Medium', high: 'High', xhigh: 'Extra High', max: 'Max' });
export function isNativeReasoningId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
    && value.trim() === value && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}
export function reasoningChoiceForNativeId(value) {
  if (!isNativeReasoningId(value)) return undefined;
  return LEGACY.has(value) && value !== 'off' ? value : `variant:${encodeURIComponent(value)}`;
}
export function normalizeReasoningChoice(value) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (normalized.startsWith('variant:')) {
    try {
      const native = decodeURIComponent(normalized.slice(8));
      return isNativeReasoningId(native) ? `variant:${encodeURIComponent(native)}` : undefined;
    } catch { return undefined; }
  }
  const lower = normalized.toLowerCase();
  return lower === 'default' || LEGACY.has(lower) ? lower : undefined;
}
export function nativeReasoningValue(value) {
  const choice = normalizeReasoningChoice(value);
  if (!choice || choice === 'default') return undefined;
  return choice.startsWith('variant:') ? decodeURIComponent(choice.slice(8)) : choice;
}
export function reasoningChoiceLabel(value) {
  if (Object.hasOwn(REASONING_LABELS, value)) return REASONING_LABELS[value];
  const native = nativeReasoningValue(value);
  return native ? native[0].toUpperCase() + native.slice(1) : String(value ?? '');
}
