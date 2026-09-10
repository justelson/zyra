import { getCachedModelAvailability } from "../model-availability.mjs";
import { isPiSupportPending } from "../model-compatibility.mjs";
import { sortModelsLatestFirst } from "../model-order.mjs";

export const FLEET_MODEL_PROVIDER = "openai-codex";
export const FLEET_MODEL_ALIASES = Object.freeze({
  sol: "gpt-5.6-sol",
  terra: "gpt-5.6-terra",
  luna: "gpt-5.6-luna",
});
export const PREVIOUS_CODEX_MODELS = Object.freeze([
  "gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex-spark",
]);

export function buildFleetModelCatalog(modelRegistry, options = {}) {
  const all = typeof modelRegistry?.getAll === "function" ? modelRegistry.getAll() : options.models ?? [];
  const availableModels = typeof modelRegistry?.getAvailable === "function" ? modelRegistry.getAvailable() : all;
  if (availableModels && typeof availableModels.then === "function") {
    throw new Error("buildFleetModelCatalog requires a resolved synchronous model registry; use buildFleetModelCatalogAsync.");
  }
  const authenticated = new Set((availableModels ?? []).map(modelKey));
  const availability = options.availability instanceof Map ? options.availability : new Map(Object.entries(options.availability ?? {}));
  return sortModelsLatestFirst((all ?? []).filter((model) => model?.provider && model?.id)).map((model) => {
    const key = modelKey(model);
    const live = availability.get(key) ?? getCachedModelAvailability(model, options) ?? {};
    const status = isPiSupportPending(model) ? "blocked" : live.availability ?? "unknown";
    const authenticatedModel = authenticated.has(key) || modelRegistry?.hasConfiguredAuth?.(model) === true;
    const reasons = [];
    if (!authenticatedModel) reasons.push("authentication_not_configured");
    if (isPiSupportPending(model)) reasons.push("pi_support_pending");
    if (status === "unavailable") reasons.push(live.reason ?? "upstream_unavailable");
    if (status === "blocked" && !reasons.includes("pi_support_pending")) reasons.push(live.reason ?? "blocked");
    return {
      key,
      provider: model.provider,
      id: model.id,
      name: model.name ?? model.id,
      model,
      authenticated: authenticatedModel,
      availability: status,
      availabilityReason: live.reason ?? (isPiSupportPending(model) ? "pi_support_pending" : undefined),
      supportPending: isPiSupportPending(model),
      contextWindow: Number(model.contextWindow) || 0,
      reasoning: model.reasoning !== false,
      toolUse: model.toolUse !== false,
      eligible: authenticatedModel && !isPiSupportPending(model) && !["blocked", "unavailable"].includes(status),
      rejectionReasons: reasons,
      generation: modelGeneration(model.id),
      tier: modelTier(model.id),
    };
  });
}

export async function buildFleetModelCatalogAsync(modelRegistry, options = {}) {
  const all = typeof modelRegistry?.getAll === "function" ? modelRegistry.getAll() : options.models ?? [];
  const resolved = await Promise.resolve(typeof modelRegistry?.getAvailable === "function" ? modelRegistry.getAvailable() : all);
  const adapter = {
    getAll: () => all,
    getAvailable: () => resolved,
    hasConfiguredAuth: (model) => modelRegistry?.hasConfiguredAuth?.(model) ?? resolved.some((entry) => modelKey(entry) === modelKey(model)),
  };
  return buildFleetModelCatalog(adapter, options);
}

export function modelKey(model) {
  return model?.provider && model?.id ? `${model.provider}/${model.id}` : "";
}

export function modelTier(modelId) {
  const id = String(modelId ?? "").toLowerCase();
  if (id.endsWith("-sol")) return "sol";
  if (id.endsWith("-terra")) return "terra";
  if (id.endsWith("-luna")) return "luna";
  if (id.includes("mini") || id.includes("spark")) return "fast-previous";
  return "general-previous";
}

export function modelGeneration(modelId) {
  const match = String(modelId ?? "").match(/^gpt-(\d+(?:\.\d+)?)/i);
  return match?.[1] ?? "unknown";
}
