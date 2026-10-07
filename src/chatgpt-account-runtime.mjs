import { AsyncLocalStorage } from 'node:async_hooks';
import { AssistantMessageEventStream } from './runtime/providers/src/utils/event-stream.js';
import { chatGptAccountEntries, CHATGPT_PROVIDER } from './chatgpt-account-pool.mjs';

// Bind only this request's auth resolution; concurrent sessions never mutate the primary account.
export function createChatGptRequestCredentials(store) {
  const context = new AsyncLocalStorage();
  const credentials = {
    read: (provider, options) => provider === CHATGPT_PROVIDER && context.getStore()
      ? context.getStore().credential : store.read(provider, options),
    list: async options => (await store.list(options)).filter(entry => !entry.providerId.startsWith('openai-codex.account.')),
    delete: (provider, options) => store.delete(provider, options),
    modify: async (provider, update, options) => {
      const lease = context.getStore();
      if (provider !== CHATGPT_PROVIDER || !lease) return store.modify(provider, update, options);
      let result;
      await store.modifyAll(async values => {
        const entry = chatGptAccountEntries(values).find(account => account.id === lease.id);
        if (!entry) throw new Error('The selected ChatGPT account was disconnected.');
        result = await update(entry.credential);
        if (result) values[entry.key] = { ...result, pool: { ...entry.credential.pool, ...result.pool, id: entry.id } };
        else result = entry.credential;
        return values;
      }, options);
      lease.credential = result;
      return result;
    },
  };
  return { credentials, context };
}

function emptyFailure(model, error, signal) {
  return { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: signal?.aborted ? 'aborted' : 'error', errorMessage: error?.message || String(error), timestamp: Date.now() };
}

export function readChatGptResponseLimits(headers, now = Date.now()) {
  const get = key => headers?.get?.(key) ?? headers?.[key];
  const window = name => {
    const raw = get(`x-codex-${name}-used-percent`);
    if (raw === undefined || raw === null || !Number.isFinite(Number(raw))) return null;
    const after = Number(get(`x-codex-${name}-reset-after-seconds`));
    const absolute = Number(get(`x-codex-${name}-reset-at`));
    const deadline = absolute > 0 ? absolute * 1000 : after > 0 ? now + after * 1000 : null;
    return { usedPercent: Number(raw), resetAt: deadline ? new Date(deadline).toISOString() : null, windowSeconds: Number(get(`x-codex-${name}-window-minutes`)) * 60 || null };
  };
  const retry = get('retry-after');
  const resetAt = retry ? Number.isFinite(Number(retry)) ? now + Number(retry) * 1000 : Date.parse(retry) : 0;
  return { primary: window('primary'), secondary: window('secondary'), resetAt };
}

export function installChatGptAccountRouting(runtime, pool, context) {
  const getAuth = runtime.getAuth.bind(runtime);
  runtime.getAuth = async (model, options = {}) => {
    const provider = typeof model === 'string' ? model : model.provider;
    if (provider !== CHATGPT_PROVIDER || context.getStore()) return getAuth(model, options);
    const lease = await pool.resolve(typeof model === 'string' ? '*' : model.id, options.signal);
    return context.run(lease, () => getAuth(model, options));
  };
  for (const method of ['stream', 'streamSimple']) {
    const original = runtime[method].bind(runtime);
    runtime[method] = (model, messages, options = {}) => {
      if (model.provider !== CHATGPT_PROVIDER) return original(model, messages, options);
      const outer = new AssistantMessageEventStream();
      pool.refreshUsageInBackground?.();
      (async () => {
        const tried = new Set();
        let lastFailure;
        while (true) {
          options.signal?.throwIfAborted();
          let lease;
          try { lease = await pool.acquire(model.id, tried, options.signal); }
          catch (error) {
            if (error.chatGptAccountId) { tried.add(error.chatGptAccountId); lastFailure = error; continue; }
            throw error.resetAt ? error : lastFailure || error;
          }
          tried.add(lease.id);
          let committed = false, retry = false, status = 0, limits = {}, start, responseReset = 0, terminal, result;
          try {
            await context.run(lease, async () => {
              const source = original(model, messages, { ...options, apiKey: undefined, maxRetries: 0,
                fetch: async (...args) => {
                  const response = await (options.fetch ?? globalThis.fetch)(...args);
                  if (response.status === 429) responseReset = await readFailureReset(response, pool.now());
                  return response;
                },
                onResponse: async (response, responseModel) => {
                  status = response.status;
                  limits = readChatGptResponseLimits(response.headers, pool.now());
                  limits.resetAt = Math.max(limits.resetAt || 0, responseReset);
                  if (limits.primary || limits.secondary) await pool.recordUsage(lease.id, { ...limits, partial: true }, lease.credential.access);
                  await options.onResponse?.(response, responseModel);
                },
              });
              for await (const event of source) {
                if (event.type === 'start') { start = event; continue; }
                if (event.type === 'error') {
                  const detail = event.error.errorMessage || '';
                  const failureStatus = status >= 400 ? status : /usage limit|rate.?limit|quota exceeded|\b429\b/i.test(detail) ? 429 : /\b401\b|unauthorized/i.test(detail) ? 401 : 0;
                  const unsupportedModel = [403, 404].includes(failureStatus) && /model|permission|access.*denied/i.test(detail);
                  const eligibleFailure = unsupportedModel || [401, 429, 502, 503, 504].includes(failureStatus) || (!status && /fetch failed|network|connection|socket|ECONN/i.test(detail));
                  if (eligibleFailure && !options.signal?.aborted) {
                    const resets = [limits.resetAt, ...[limits.primary, limits.secondary].filter(w => w?.usedPercent >= 100).map(w => Date.parse(w.resetAt))].filter(t => t > pool.now());
                    await pool.markFailure(lease.id, failureStatus === 429 || failureStatus === 401 ? '*' : model.id, { status: failureStatus, resetAt: resets.length ? Math.max(...resets) : unsupportedModel ? pool.now() + 900_000 : 0, expectedAccess: lease.credential.access });
                  }
                  if (!committed && eligibleFailure && !options.signal?.aborted) { retry = true; lastFailure = new Error(detail); break; }
                }
                if (start) { outer.push(start); start = undefined; }
                committed = true;
                if (event.type === 'done' || event.type === 'error') terminal = event;
                else outer.push(event);
              }
              if (!retry) result = await source.result();
            });
          } finally { await lease.release().catch(() => {}); }
          if (!retry) { if (terminal) outer.push(terminal); outer.end(result); return; }
        }
      })().catch(error => {
        const message = emptyFailure(model, error, options.signal);
        outer.push({ type: 'error', reason: message.stopReason, error: message });
        outer.end(message);
      });
      return outer;
    };
  }
}

async function readFailureReset(response, now) {
  // Read only a bounded copy of a quota error; the provider still owns the original body.
  const reader = response.clone().body?.getReader();
  if (!reader) return 0;
  let size = 0, raw = '';
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65_536) { void reader.cancel().catch(() => {}); return 0; }
      raw += decoder.decode(value, { stream: true });
    }
    const error = JSON.parse(raw + decoder.decode()).error;
    const absolute = Number(error?.resets_at), relative = Number(error?.resets_in_seconds);
    return absolute > 0 ? absolute * 1000 : relative > 0 ? now + relative * 1000 : 0;
  } catch { return 0; }
  finally { reader.releaseLock(); }
}
