/** A remote client displays host capabilities; local provider caches are not authority. */
export function createTuiModelCatalog(localRegistry, initial = []) {
  let models = [];
  const update = entries => {
    if (!Array.isArray(entries)) return false;
    models = entries.flatMap(info => {
      const identity = String(info?.id || ''); const slash = identity.indexOf('/');
      if (slash < 1 || slash === identity.length - 1) return [];
      const efforts = Array.isArray(info.supportedEfforts) ? [...new Set(info.supportedEfforts.filter(value => typeof value === 'string'))] : [];
      return [{ provider: identity.slice(0, slash), id: identity.slice(slash + 1), name: info.label || info.name || identity.slice(slash + 1),
        reasoning: efforts.length > 0, zyraSupportedEfforts: efforts, zyraModelInfo: { ...info },
        contextWindow: Number.isFinite(Number(info.contextWindow)) && Number(info.contextWindow) > 0 ? Number(info.contextWindow) : 0,
        input: Array.isArray(info.inputModes) ? [...info.inputModes] : ['text'] }];
    });
    return true;
  };
  update(initial);
  const registry = new Proxy(localRegistry, { get(target, key) {
    if (key === 'getAll' || key === 'getAvailable') return () => [...models];
    if (key === 'find') return (provider, id) => models.find(model => model.provider === provider && model.id === id);
    if (key === 'hasConfiguredAuth') return model => models.some(entry => entry.provider === model?.provider && entry.id === model?.id);
    if (key === 'zyraOpenAIModelCatalog') return new Map([...new Set(models.map(model => model.provider))].map(provider => [provider, models.filter(model => model.provider === provider).map(model => ({ ...model.zyraModelInfo, id: model.id }))]));
    // Discovery and provider composition happen on the server. Local registration
    // must not repopulate the remote picker's source of truth.
    if (['refresh', 'registerProvider', 'unregisterProvider'].includes(key)) return () => undefined;
    if (key === 'zyraOpenAIModelCatalogOptions') return undefined;
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  return { registry, update };
}

export function unknownTuiModel(selector) {
  const [provider = 'unknown', ...parts] = String(selector || '').split('/');
  const id = parts.join('/') || selector || 'unknown';
  return { provider, id, name: id, reasoning: false, zyraSupportedEfforts: [], contextWindow: 0, capabilityStatus: 'unknown' };
}
