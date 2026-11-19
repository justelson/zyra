export function normalizeCodexServiceTierPreference(value) {
  const mode = String(value ?? '').trim().toLowerCase();
  if (['normal', 'default', 'standard', 'off', 'none'].includes(mode)) return 'default';
  if (['fast', 'priority'].includes(mode)) return 'priority';
  if (['cheap', 'flex', 'slow', 'economy'].includes(mode)) return 'flex';
  if (mode === 'ultrafast') return 'ultrafast';
  if (mode === 'auto') return 'auto';
  return undefined;
}

function isCodexResponsesPayload(payload) {
  return Boolean(
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    typeof payload.model === "string" &&
    Array.isArray(payload.include) &&
    payload.include.includes("reasoning.encrypted_content") &&
    Object.prototype.hasOwnProperty.call(payload, "prompt_cache_key")
  );
}

export function applyCodexServiceTier(payload, preference) {
  const tier = normalizeCodexServiceTierPreference(preference);
  if (!tier || tier === 'default' || !isCodexResponsesPayload(payload)) return undefined;
  return { ...payload, service_tier: tier };
}
