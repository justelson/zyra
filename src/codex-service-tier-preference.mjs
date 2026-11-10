export function normalizeCodexServiceTierPreference(value) {
  const mode = String(value ?? '').trim().toLowerCase();
  if (['normal', 'default', 'standard', 'off', 'none'].includes(mode)) return 'default';
  if (['fast', 'priority'].includes(mode)) return 'priority';
  if (['cheap', 'flex', 'slow', 'economy'].includes(mode)) return 'flex';
  if (mode === 'auto') return 'auto';
  return undefined;
}
