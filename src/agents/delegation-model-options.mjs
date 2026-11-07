import { getModelThinkingLevels } from "../thinking-levels.mjs";
import { buildDelegationGuidance, normalizeDelegationPreferences } from "./delegation-policy.mjs";

function apiCost(model) {
  const cost = model?.cost;
  if (!cost || !Number.isFinite(cost.input) || !Number.isFinite(cost.output) || cost.input < 0 || cost.output < 0 || cost.input + cost.output === 0) return null;
  return { input: cost.input, output: cost.output,
    cacheRead: Number.isFinite(cost.cacheRead) && cost.cacheRead >= 0 ? cost.cacheRead : null,
    cacheWrite: Number.isFinite(cost.cacheWrite) && cost.cacheWrite >= 0 ? cost.cacheWrite : null };
}

export function buildDelegationModelOptions(catalog, preferences, request = {}) {
  const value = normalizeDelegationPreferences(preferences);
  const limit = Math.max(1, Math.min(6, Math.floor(Number(request.limit) || 5)));
  const query = String(request.modelQuery || "").trim().toLowerCase().slice(0, 100);
  const inherited = typeof request.inheritModel === "string" ? request.inheritModel : request.inheritModel?.provider && request.inheritModel?.id ? `${request.inheritModel.provider}/${request.inheritModel.id}` : "";
  const entries = catalog.filter(entry => entry.eligible && entry.authenticated && typeof entry.key === "string" && entry.key.length <= 300
    && (!request.provider || entry.provider === request.provider)
    && (!query || `${entry.key} ${entry.name}`.toLowerCase().includes(query)));
  const costs = new Map(entries.map(entry => [entry.key, apiCost(entry.model)]));
  const score = entry => { const cost = costs.get(entry.key); return cost ? cost.input + cost.output : Infinity; };
  const ranked = entries.slice().sort((left, right) => value.preset === "cost"
    ? score(left) - score(right)
    : Number(right.key === inherited) - Number(left.key === inherited));
  const shortlist = ranked.slice(0, limit);
  const current = entries.find(entry => entry.key === inherited);
  if (current && !shortlist.includes(current) && shortlist.length > 1) shortlist[shortlist.length - 1] = current;
  return {
    preset: value.preset,
    guidance: buildDelegationGuidance(value),
    comparisonMetric: "Estimated API cost, USD per 1M tokens, also used for subscription models",
    ordering: value.preset === "cost" ? "Known input + output rates, equally weighted for shortlist discovery; estimate the actual workload before choosing" : "Current chat first, then registry order; no unmeasured quality or latency score",
    checkedAt: new Date().toISOString(),
    availabilitySource: "Current authenticated registry and cached availability checks",
    totalMatchingModels: entries.length,
    models: shortlist.map(entry => ({
      id: entry.key, provider: entry.provider, name: String(entry.name || entry.key).slice(0, 120), availability: entry.availability,
      contextWindow: entry.contextWindow || null,
      reasoning: typeof entry.model?.reasoning === "boolean" ? entry.model.reasoning : null,
      toolUse: typeof entry.model?.toolUse === "boolean" ? entry.model.toolUse : null,
      supportedEfforts: ['default', ...getModelThinkingLevels(entry.model)],
      estimatedApiCost: costs.get(entry.key),
      priceSource: costs.get(entry.key) ? "Model catalog estimate" : "Unknown",
      priceVerifiedAt: null,
      currentChatModel: entry.key === inherited
    }))
  };
}
