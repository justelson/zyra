import { FLEET_MODEL_ALIASES, FLEET_MODEL_PROVIDER, modelKey } from "./model-catalog.mjs";

const DEFAULT_ROUTES = Object.freeze({
  orchestration: ["sol", "openai-codex/gpt-5.5", "openai-codex/gpt-5.4"],
  security: ["sol", "terra", "openai-codex/gpt-5.5", "openai-codex/gpt-5.4"],
  architecture: ["sol", "terra", "openai-codex/gpt-5.5", "openai-codex/gpt-5.4"],
  implementation: ["terra", "openai-codex/gpt-5.5", "openai-codex/gpt-5.4", "sol"],
  debugging: ["terra", "openai-codex/gpt-5.5", "openai-codex/gpt-5.4", "sol"],
  review: ["terra", "openai-codex/gpt-5.5", "openai-codex/gpt-5.4", "sol"],
  verification: ["terra", "openai-codex/gpt-5.5", "openai-codex/gpt-5.4", "sol"],
  search: ["luna", "openai-codex/gpt-5.4-mini", "openai-codex/gpt-5.3-codex-spark", "terra"],
  extraction: ["luna", "openai-codex/gpt-5.4-mini", "openai-codex/gpt-5.3-codex-spark", "terra"],
  mechanical: ["luna", "terra", "openai-codex/gpt-5.4-mini", "openai-codex/gpt-5.4", "openai-codex/gpt-5.5"],
  synthesis: ["sol", "terra", "openai-codex/gpt-5.5"],
});

export class FleetModelRouteError extends Error {
  constructor(message, explanation) {
    super(message);
    this.name = "FleetModelRouteError";
    this.explanation = explanation;
  }
}

export class ModelRouter {
  constructor(options = {}) {
    this.catalog = Array.isArray(options.catalog) ? options.catalog : [];
    this.policy = options.policy ?? {};
  }

  setCatalog(catalog) {
    this.catalog = Array.isArray(catalog) ? catalog : [];
  }

  route(request = {}) {
    const selector = normalizeModelSelector(request.model ?? request.selector ?? "inherit");
    const envelope = normalizeTaskEnvelope(request.envelope ?? request);
    const policy = mergePolicy(this.policy, request.policy);
    const requested = selector.requested;
    const selectors = candidateSelectors(selector, envelope, request.fallbackModels);
    const considered = [];
    const candidates = [];

    for (const candidateSelector of selectors) {
      const entries = resolveSelector(candidateSelector, this.catalog, request.inheritModel);
      if (!entries.length) considered.push({ selector: candidateSelector, accepted: false, reasons: ["not_registered"] });
      for (const entry of entries) {
        const reasons = rejectionReasons(entry, envelope, policy);
        const accepted = reasons.length === 0;
        const candidate = {
          selector: candidateSelector,
          key: entry.key,
          accepted,
          reasons,
          availability: entry.availability,
          model: entry,
        };
        considered.push(candidate);
        if (accepted && !candidates.some((item) => item.key === candidate.key)) candidates.push(candidate);
      }
    }

    candidates.sort((left, right) => {
      if (requested === "inherit" && (left.selector === "inherit" || right.selector === "inherit")) return left.selector === "inherit" ? -1 : 1;
      const availability = availabilityRank(left.model.availability) - availabilityRank(right.model.availability);
      if (availability !== 0) return availability;
      return selectors.indexOf(left.selector) - selectors.indexOf(right.selector);
    });
    const selected = candidates[0];
    if (!selected) {
      throw new FleetModelRouteError("No authenticated compatible fleet model is available.", { requested, envelope, considered });
    }

    const firstResolvedKey = considered.find((item) => item.accepted)?.key;
    const fallback = selected.key !== exactSelectorKey(requested) && selected.key !== firstResolvedKey
      || requested !== selected.selector && !selectorMatchesKey(requested, selected.key);
    const fallbackReason = fallback
      ? explainFallback(requested, selected, considered)
      : null;

    return {
      requested,
      selectedModel: selected.model.model,
      selectedKey: selected.key,
      selectedTier: selected.model.tier,
      candidatesConsidered: considered.map(({ model, ...item }) => item),
      fallback,
      fallbackReason,
      escalationReason: request.escalationReason ?? null,
      envelope,
    };
  }

  escalate(previousRoute, reason, options = {}) {
    const allowedReasons = new Set(["schema_validation_failed_twice", "verifier_rejected", "unresolved_required_files", "insufficient_capability", "risk_increased"]);
    if (!allowedReasons.has(reason)) throw new FleetModelRouteError("Escalation requires a recorded quality or capability reason.", { reason });
    const previousTier = previousRoute?.selectedTier;
    const model = previousTier === "luna" || previousTier === "fast-previous" ? "terra" : "sol";
    return this.route({ ...options, model, escalationReason: reason });
  }
}

export function normalizeModelSelector(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const prefer = normalizeSelectorString(value.prefer ?? "inherit");
    return {
      requested: prefer,
      prefer,
      fallbacks: unique([...(value.fallbacks ?? []), ...(value.fallbackModels ?? [])].map(normalizeSelectorString)),
      allowPreviousGenerations: value.allowPreviousGenerations !== false,
    };
  }
  const selector = normalizeSelectorString(value ?? "inherit");
  return { requested: selector, prefer: selector, fallbacks: [], allowPreviousGenerations: true };
}

export function normalizeTaskEnvelope(input = {}) {
  const task = String(input.task ?? input.taskType ?? input.envelope ?? "implementation").trim().toLowerCase();
  const mapped = task.includes("security") ? "security"
    : task.includes("architect") ? "architecture"
      : task.includes("review") ? "review"
        : task.includes("verif") || task.includes("test") ? "verification"
          : task.includes("debug") ? "debugging"
            : task.includes("search") || task.includes("inventory") ? "search"
              : task.includes("extract") ? "extraction"
                : task.includes("mechan") ? "mechanical"
                  : task.includes("synth") ? "synthesis"
                    : task.includes("orchestrat") ? "orchestration"
                      : "implementation";
  return {
    task: mapped,
    risk: String(input.risk ?? "medium").toLowerCase(),
    tools: unique(input.tools ?? []),
    minContextWindow: Math.max(0, Number(input.minContextWindow) || 0),
    requiresReasoning: input.requiresReasoning !== false,
    requiresToolUse: (input.tools?.length ?? 0) > 0 || input.requiresToolUse === true,
    allowPreviousGenerations: input.allowPreviousGenerations !== false,
  };
}

function candidateSelectors(selector, envelope, fallbackModels = []) {
  const route = DEFAULT_ROUTES[envelope.task] ?? DEFAULT_ROUTES.implementation;
  const defaults = selector.prefer === "inherit" ? ["inherit", ...route] : [selector.prefer, ...route];
  const previousAllowed = selector.allowPreviousGenerations && envelope.allowPreviousGenerations;
  return unique([
    ...defaults,
    ...selector.fallbacks,
    ...(fallbackModels ?? []).map(normalizeSelectorString),
  ]).filter((value) => previousAllowed || aliasOrCurrent(value));
}

function resolveSelector(selector, catalog, inheritModel) {
  if (selector === "inherit") {
    const key = typeof inheritModel === "string" ? inheritModel : modelKey(inheritModel);
    return catalog.filter((entry) => entry.key === key);
  }
  if (FLEET_MODEL_ALIASES[selector]) {
    return catalog.filter((entry) => entry.id === FLEET_MODEL_ALIASES[selector]);
  }
  const key = selector.includes("/") ? selector : `${FLEET_MODEL_PROVIDER}/${selector}`;
  return catalog.filter((entry) => entry.key === key);
}

function rejectionReasons(entry, envelope, policy) {
  const reasons = [...(entry.rejectionReasons ?? [])];
  if (!entry.eligible) reasons.push("not_eligible");
  if (policy.deny.has(entry.key) || policy.deny.has(entry.id)) reasons.push("denied_by_policy");
  if (policy.allow.size && !policy.allow.has(entry.key) && !policy.allow.has(entry.id)) reasons.push("not_in_policy_allowlist");
  if (envelope.minContextWindow && entry.contextWindow < envelope.minContextWindow) reasons.push("context_too_small");
  if (envelope.requiresReasoning && !entry.reasoning) reasons.push("reasoning_unsupported");
  if (envelope.requiresToolUse && !entry.toolUse) reasons.push("tools_unsupported");
  return unique(reasons);
}

function mergePolicy(base = {}, override = {}) {
  return {
    allow: new Set(unique([...(base.allow ?? []), ...(override?.allow ?? [])])),
    deny: new Set(unique([...(base.deny ?? []), ...(override?.deny ?? [])])),
  };
}

function normalizeSelectorString(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "tera") throw new FleetModelRouteError("Unknown model alias 'tera'. Did you mean 'terra'?", { requested: text });
  if (["opus", "sonnet", "haiku", "quality", "balanced"].includes(text)) {
    throw new FleetModelRouteError(`Use inherit or a full provider/model ID instead of '${text}'.`, { requested: text });
  }
  if (["inherit", "sol", "terra", "luna"].includes(text)) return text;
  if (/^[a-z0-9_-]+\/[^\s]+$/i.test(text)) return text;
  if (/^gpt-[a-z0-9.-]+$/i.test(text)) return `${FLEET_MODEL_PROVIDER}/${text}`;
  throw new FleetModelRouteError(`Unsupported fleet model selector: ${value}.`, { requested: text });
}

function exactSelectorKey(selector) {
  return selector.includes("/") ? selector : undefined;
}

function selectorMatchesKey(selector, key) {
  if (FLEET_MODEL_ALIASES[selector]) return key === `${FLEET_MODEL_PROVIDER}/${FLEET_MODEL_ALIASES[selector]}`;
  return selector === key;
}

function explainFallback(requested, selected, considered) {
  const rejected = considered.filter((item) => !item.accepted && (item.selector === requested || selectorMatchesKey(requested, item.key ?? "")));
  if (rejected.length) return `${requested} skipped: ${unique(rejected.flatMap((item) => item.reasons)).join(", ")}; selected ${selected.key}.`;
  if (selected.model.availability === "available") return `Preferred a positively available candidate: ${selected.key}.`;
  return `Selected first compatible fallback: ${selected.key}.`;
}

function availabilityRank(value) {
  if (value === "available") return 0;
  if (value === "unknown") return 1;
  return 2;
}

function aliasOrCurrent(value) {
  return ["inherit", "sol", "terra", "luna"].includes(value) || /gpt-5\.6/i.test(value);
}

function unique(value) {
  const array = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(array.map((entry) => String(entry ?? "").trim()).filter(Boolean))];
}
