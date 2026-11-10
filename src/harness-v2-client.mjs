/** OpenCode 2's native HTTP contract. Credentials stay on the owned loopback. */
export async function requestV2(client, route, { method = 'GET', body, signal, timeoutMs = 30_000, fetchImpl = client.fetch ?? fetch } = {}) {
  const url = new URL(`/api${route}`, client.baseUrl);
  if (client.cwd && (['/model', '/agent', '/plugin', '/location', '/permission/request'].includes(route) || route.startsWith('/rpc/'))) url.searchParams.set('location[directory]', client.cwd);
  const response = await fetchImpl(url.href, { method, redirect: 'error',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    headers: { Authorization: `Basic ${Buffer.from(`opencode:${client.password}`).toString('base64')}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) throw Object.assign(new Error(`OpenCode 2 request ${method} ${route} failed (${response.status}).`), { status: response.status });
  return response.status === 204 ? undefined : response.json();
}

/** Convert the V2 model snapshot to the legacy catalog mapper's public input. */
export function v2CatalogPayload(payload) {
  if (!Array.isArray(payload?.data)) throw new Error('The OpenCode 2 harness returned an unrecognized model catalog.');
  const providers = new Map();
  for (const model of payload.data) {
    if (!model?.enabled || model.type !== 'chat' || typeof model.providerID !== 'string' || typeof model.id !== 'string') continue;
    if (!providers.has(model.providerID)) providers.set(model.providerID, { id: model.providerID, models: Object.create(null) });
    // Missing prices remain unknown, never free. All tiers must be zero for free inference.
    const tiers = Array.isArray(model.cost) ? model.cost : [];
    const price = key => tiers.length && tiers.every(tier => typeof tier[key] === 'number') ? Math.max(...tiers.map(tier => tier[key])) : undefined;
    providers.get(model.providerID).models[model.id] = { ...model,
      capabilities: { toolcall: model.capabilities?.tools === true, reasoning: model.capabilities?.reasoning === true
        || model.capabilities?.reasoning?.supported === true || Boolean(model.compatibility?.reasoningField)
        || model.variants?.some(variant => variant.settings?.reasoningEffort !== undefined || variant.settings?.thinkingBudget !== undefined)
        || model.capabilities?.output?.includes('reasoning') === true,
        input: { image: model.capabilities?.input?.includes('image') === true } },
      cost: { input: price('input'), output: price('output'), cache: tiers[0]?.cache },
    };
  }
  return { all: [...providers.values()], connected: [...providers.keys()] };
}

/** Location initialization can transiently return 503 before plugins settle. */
export async function listV2Models(client, options = {}) {
  const deadline = performance.now() + (options.timeoutMs ?? 30_000);
  for (;;) {
    try { return await requestV2(client, '/model', { ...options, timeoutMs: Math.max(1, Math.ceil(deadline - performance.now())) }); }
    catch (error) {
      if (error.status !== 503 || options.signal?.aborted || performance.now() >= deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
}

export async function prepareV2(client, options) {
  await listV2Models(client, options);
  const session = await requestV2(client, '/session', { ...options, method: 'POST', body: { title: 'Zyra preparation', location: { directory: client.cwd } } });
  if (typeof session?.data?.id !== 'string') throw new Error('OpenCode 2 did not return a preparation session id.');
  await requestV2(client, `/session/${encodeURIComponent(session.data.id)}`, { ...options, method: 'DELETE' });
  return { prepared: true };
}
