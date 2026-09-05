const GPT_RELEASE_RE = /^gpt-(\d+(?:\.\d+)*)(?:-([a-z0-9][a-z0-9.-]*))?$/i;
const PROVIDER_ORDER = new Map([
  ["openai-codex", 0],
  ["openai", 1],
]);
const GPT_56_TIER_ORDER = new Map([
  ["sol", 0],
  ["", 1],
  ["terra", 2],
  ["luna", 3],
]);

/** Orders catalog entries without changing their identity, metadata or availability. */
export function sortModelsLatestFirst(models = []) {
  return models
    .map((model, index) => ({ model, index, release: parseGptRelease(model?.id) }))
    .sort(compareModelEntries)
    .map(({ model }) => model);
}

/**
 * Latest means the highest versioned GPT entry in the supplied catalog, not a
 * global release or an automatic model switch. Unknown families have no badge:
 * display names and catalog position are not evidence of release chronology.
 */
export function getLatestModelId(models = []) {
  return sortModelsLatestFirst(models).find((model) => parseGptRelease(model?.id))?.id ?? null;
}

function compareModelEntries(a, b) {
  if (a.release && b.release) {
    const releaseOrder = compareReleaseVersions(a.release, b.release);
    if (releaseOrder !== 0) return releaseOrder;

    const tierOrder = compareDocumentedTierOrder(a.release, b.release);
    if (tierOrder !== 0) return tierOrder;

    if (modelIdentity(a.model).id === modelIdentity(b.model).id) {
      const providerOrder = providerRank(modelIdentity(a.model).provider) - providerRank(modelIdentity(b.model).provider);
      if (providerOrder !== 0) return providerOrder;
    }
  } else if (a.release) {
    return -1;
  } else if (b.release) {
    return 1;
  }

  return a.index - b.index;
}

function compareReleaseVersions(a, b) {
  for (let index = 0; index < Math.max(a.version.length, b.version.length); index += 1) {
    const difference = (b.version[index] ?? 0) - (a.version[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function compareDocumentedTierOrder(a, b) {
  if (a.version[0] !== 5 || a.version[1] !== 6 || b.version[0] !== 5 || b.version[1] !== 6) {
    return variantRank(a.suffix) - variantRank(b.suffix);
  }
  return tierRank(a.suffix) - tierRank(b.suffix);
}

// Runtime entries use { provider, id }; Desktop/Browser use provider/id selectors.
function modelIdentity(model) {
  const selector = String(model?.id ?? "").trim();
  const separator = selector.lastIndexOf("/");
  return {
    id: selector.slice(separator + 1),
    provider: model?.provider ?? (separator < 0 ? undefined : selector.slice(0, separator)),
  };
}

function parseGptRelease(id) {
  const match = GPT_RELEASE_RE.exec(modelIdentity({ id }).id);
  if (!match) return undefined;
  const version = match[1].split(".").map(Number);
  if (!version.every(Number.isSafeInteger)) return undefined;
  return { version, suffix: String(match[2] ?? "").toLowerCase() };
}

function variantRank(suffix) {
  if (/(?:^|-)mini(?:-|$)/.test(suffix)) return 1;
  if (/(?:^|-)spark(?:-|$)/.test(suffix)) return 2;
  return 0;
}

function tierRank(suffix) {
  return GPT_56_TIER_ORDER.get(suffix) ?? Number.MAX_SAFE_INTEGER;
}

function providerRank(provider) {
  return PROVIDER_ORDER.get(provider) ?? Number.MAX_SAFE_INTEGER;
}
