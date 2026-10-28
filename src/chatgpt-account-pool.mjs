import { createHash, randomUUID } from 'node:crypto';
import { openAICodexCredentialNeedsRefresh, refreshOpenAICodexCredential } from './openai-codex-oauth.mjs';
import { readChatGptRouting, chatGptUsageAvailability } from './chatgpt-routing-policy.mjs';

export const CHATGPT_PROVIDER = 'openai-codex';
const ACCOUNT_PREFIX = 'openai-codex.account.';
const pools = new Map();
const AFFINITY_TTL_MS = 24 * 60 * 60_000;
const MAX_AFFINITIES = 256;
const affinityKey = sessionId => typeof sessionId === 'string' && sessionId.length > 0
  ? createHash('sha256').update(sessionId).digest('hex') : undefined;

function readAffinities(entries, now) {
  const owner = entries.find(entry => entry.key === CHATGPT_PROVIDER) || entries[0];
  const known = new Set(entries.map(entry => entry.id));
  return Object.fromEntries(Object.entries(owner?.credential.pool?.conversationAffinities || {})
    .filter(([, value]) => value?.usedAt > now - AFFINITY_TTL_MS && known.has(value.id))
    .sort((a, b) => b[1].usedAt - a[1].usedAt).slice(0, MAX_AFFINITIES));
}

function claims(token) {
  try { return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8')); }
  catch { return {}; }
}

export function chatGptIdentity(credential) {
  const access = claims(credential?.access), identity = claims(credential?.idToken);
  const auth = access['https://api.openai.com/auth'] ?? identity['https://api.openai.com/auth'] ?? {};
  const profile = access['https://api.openai.com/profile'] ?? {};
  const accountId = credential?.accountId || auth.chatgpt_account_id || identity.chatgpt_account_id;
  const stableId = credential?.pool?.id || createHash('sha256').update(String(accountId || identity.sub || access.sub || credential?.refresh || '')).digest('hex').slice(0, 32);
  return { id: stableId, accountId, email: profile.email || identity.email, plan: auth.chatgpt_plan_type };
}

export function chatGptAccountEntries(snapshot) {
  return Object.entries(snapshot).filter(([key, value]) => (key === CHATGPT_PROVIDER || key.startsWith(ACCOUNT_PREFIX)) && value?.type === 'oauth')
    .map(([key, credential]) => ({ key, credential, ...chatGptIdentity(credential) }));
}

export async function saveChatGptAccount(store, credential, options = {}) {
  const identity = chatGptIdentity(credential);
  if (options.accountId && identity.id !== options.accountId) throw new Error('Sign in to the same ChatGPT account to reconnect it. Your existing accounts were kept.');
  return store.modifyAll(values => {
    const entries = chatGptAccountEntries(values);
    const existing = entries.find(account => account.id === identity.id);
    if (options.accountId && !existing) throw new Error('This ChatGPT account was disconnected while sign-in was open.');
    const key = existing?.key || (values[CHATGPT_PROVIDER] ? `${ACCOUNT_PREFIX}${identity.id}` : CHATGPT_PROVIDER);
    values[key] = { ...credential, pool: { ...existing?.credential.pool, id: identity.id, requiresLogin: false, cooldowns: {} } };
    return values;
  }, options);
}

export async function updateChatGptAccount(store, id, update, options = {}) {
  return store.modifyAll(values => {
    const entry = chatGptAccountEntries(values).find(account => account.id === id);
    if (!entry) throw new Error('This ChatGPT account is no longer connected.');
    if (update.primary === true) {
      if (entry.key !== CHATGPT_PROVIDER) {
        const previous = values[CHATGPT_PROVIDER];
        values[CHATGPT_PROVIDER] = { ...entry.credential, pool: { ...entry.credential.pool,
          ...(previous?.pool?.lastPickedByModel ? { lastPickedByModel: previous.pool.lastPickedByModel } : {}),
          ...(previous?.pool?.conversationAffinities ? { conversationAffinities: previous.pool.conversationAffinities } : {}) } };
        if (previous) values[entry.key] = previous;
        else delete values[entry.key];
      }
    } else if (update.remove === true) {
      delete values[entry.key];
      if (entry.key === CHATGPT_PROVIDER) {
        const replacement = chatGptAccountEntries(values)[0];
        if (replacement) { values[CHATGPT_PROVIDER] = { ...replacement.credential, pool: { ...replacement.credential.pool,
          ...(entry.credential.pool?.conversationAffinities ? { conversationAffinities: entry.credential.pool.conversationAffinities } : {}) } }; delete values[replacement.key]; }
      }
    } else {
      if (typeof update.enabled !== 'boolean') throw new TypeError('Choose whether this ChatGPT account is enabled.');
      values[entry.key] = { ...entry.credential, pool: { ...entry.credential.pool, id: entry.id, disabled: !update.enabled } };
    }
    return values;
  }, options);
}

export async function removeAllChatGptAccounts(store, options = {}) {
  return store.modifyAll(values => {
    for (const { key } of chatGptAccountEntries(values)) delete values[key];
    return values;
  }, options);
}

export function getChatGptAccountPool(store, options = {}) {
  const key = store.authPath;
  if (!pools.has(key)) pools.set(key, new ChatGptAccountPool(store, options));
  return pools.get(key);
}

export class ChatGptAccountPool {
  constructor(store, options = {}) {
    this.store = store;
    this.options = options;
    this.inFlight = new Map();
  }

  now() { return typeof this.options.now === 'function' ? this.options.now() : this.options.now ?? Date.now(); }

  async resolve(model = '*', signal, sessionId) {
    const [values, policy] = await Promise.all([this.store.snapshot({ signal }), readChatGptRouting(this.store.authPath)]);
    const entries = chatGptAccountEntries(values).filter(entry => !entry.credential.pool?.disabled && !entry.credential.pool?.requiresLogin
      && (policy.accountMode === 'all' || policy.accountIds.includes(entry.id)) && !chatGptUsageAvailability(entry.credential.pool, model, this.now()).until);
    const preferredId = readAffinities(chatGptAccountEntries(values), this.now())[affinityKey(sessionId)]?.id;
    entries.sort((a, b) => Number(b.id === preferredId) - Number(a.id === preferredId));
    for (const entry of entries) {
      try { return { id: entry.id, credential: await this.credential(entry.id, { signal }) }; }
      catch (error) { signal?.throwIfAborted(); if (error.code !== 'ZYRA_AUTH_REAUTH_REQUIRED') throw error; await this.markFailure(entry.id, '*', { status: 401, expectedAccess: entry.credential.access }); }
    }
    throw Object.assign(new Error('No enabled ChatGPT account is available. Review accounts, usage rules and reset times in Providers > Limits.'), { code: 'ZYRA_CHATGPT_POOL_UNAVAILABLE' });
  }

  async list() {
    const now = this.now();
    return chatGptAccountEntries(await this.store.snapshot()).map(entry => {
      const pool = entry.credential.pool || {};
      const availability = chatGptUsageAvailability(pool, '*', now);
      const resets = Object.values(pool.cooldowns || {}).map(value => Number(value.until)).filter(until => until > now);
      if (availability.until) resets.push(availability.until);
      return {
        id: entry.id, email: entry.email || null, plan: entry.plan || null, primary: entry.key === CHATGPT_PROVIDER,
        enabled: !pool.disabled, state: pool.disabled ? 'paused' : pool.requiresLogin ? 'needs-sign-in' : resets.length ? 'limited' : 'ready',
        resetAt: resets.length ? new Date(Math.max(...resets)).toISOString() : null,
        lastUsedAt: pool.lastUsedAt || null, requestCount: pool.requestCount || 0,
        tokenExpiresAt: Number.isFinite(Number(entry.credential.expires)) ? new Date(Number(entry.credential.expires)).toISOString() : null,
        usage: pool.usage || null,
      };
    });
  }

  async acquire(model, excluded = new Set(), signal, sessionId) {
    signal?.throwIfAborted();
    let selected, credential;
    const reservation = randomUUID();
    try {
      await this.store.modifyAll(async values => {
        const now = this.now(), policy = await readChatGptRouting(this.store.authPath);
        const entries = chatGptAccountEntries(values);
        for (const entry of entries) {
          const leases = { ...entry.credential.pool?.leases };
          for (const [id, until] of Object.entries(leases)) if (!(until > now)) delete leases[id];
          entry.credential.pool = { ...entry.credential.pool, id: entry.id, leases };
        }
        const allowed = entries.filter(entry => !entry.credential.pool.disabled && !entry.credential.pool.requiresLogin && (policy.accountMode === 'all' || policy.accountIds.includes(entry.id)));
        const available = allowed.filter(entry => !excluded.has(entry.id) && !chatGptUsageAvailability(entry.credential.pool, model, now).until);
        if (!available.length) {
          const deadlines = allowed.map(entry => chatGptUsageAvailability(entry.credential.pool, model, now).until).filter(until => until > now);
          const resetAt = deadlines.length ? new Date(Math.min(...deadlines)).toISOString() : null;
          throw Object.assign(new Error(entries.length ? `No ChatGPT account is available for this model. Check accounts and usage rules in Providers > Limits.${resetAt ? ` Next retry: ${new Date(resetAt).toLocaleString()}.` : ''}` : 'Connect a ChatGPT account in Providers.'), { code: 'ZYRA_CHATGPT_POOL_UNAVAILABLE', resetAt });
        }
        const active = entry => Object.keys(entry.credential.pool.leases).length;
        const minimum = Math.min(...available.map(active));
        let ready = available.filter(entry => active(entry) === minimum).sort((a, b) => a.id.localeCompare(b.id));
        if (policy.strategy === 'balanced') {
          const bucket = entry => Math.floor(chatGptUsageAvailability(entry.credential.pool, model, now).score / 10);
          const lowest = Math.min(...ready.map(bucket));
          ready = ready.filter(entry => bucket(entry) === lowest);
        }
        const primary = entries.find(entry => entry.key === CHATGPT_PROVIDER);
        const previous = primary?.credential.pool.lastPickedByModel?.[model] || '';
        const conversation = affinityKey(sessionId);
        const affinities = readAffinities(entries, now);
        const preferred = conversation && available.find(entry => entry.id === affinities[conversation]?.id);
        selected = preferred || (policy.strategy === 'fill-first'
          ? available.find(entry => entry.id === policy.preferredAccountId) || available.find(entry => entry.key === CHATGPT_PROVIDER) || ready[0]
          : ready.find(entry => entry.id > previous) || ready[0]);
        // Selection and reservation share a file lock across session workers and processes.
        const refreshed = openAICodexCredentialNeedsRefresh(selected.credential, { now, refreshWindowMs: 300_000 })
          ? await refreshOpenAICodexCredential(selected.credential, { ...this.options, now }) : selected.credential;
        signal?.throwIfAborted();
        // Follow-ups do not advance the start cursor, so active conversations cannot skew new starts.
        if (primary) {
          if (!preferred) primary.credential.pool.lastPickedByModel = { ...primary.credential.pool.lastPickedByModel, [model]: selected.id };
          if (conversation) {
            delete affinities[conversation];
            affinities[conversation] = { id: selected.id, usedAt: now };
            primary.credential.pool.conversationAffinities = Object.fromEntries(Object.entries({ [conversation]: affinities[conversation], ...affinities })
              .sort((a, b) => b[1].usedAt - a[1].usedAt).slice(0, MAX_AFFINITIES));
          }
        }
        credential = { ...refreshed, pool: { ...selected.credential.pool, id: selected.id, lastUsedAt: new Date(now).toISOString(), requestCount: (selected.credential.pool.requestCount || 0) + 1,
          leases: { ...selected.credential.pool.leases, [reservation]: now + Math.max(1_800_000, Number(this.options.requestLeaseMs) || 0) } } };
        values[selected.key] = credential;
        return values;
      }, { signal });
    } catch (error) {
      if (selected) {
        if (error.code === 'ZYRA_AUTH_REAUTH_REQUIRED') await this.markFailure(selected.id, '*', { status: 401, expectedAccess: selected.credential.access });
        error.chatGptAccountId = selected.id;
      }
      throw error;
    }
    this.inFlight.set(selected.id, (this.inFlight.get(selected.id) || 0) + 1);
    let released = false;
    const release = async () => {
      if (released) return;
      released = true;
      const count = (this.inFlight.get(selected.id) || 1) - 1;
      if (count) this.inFlight.set(selected.id, count); else this.inFlight.delete(selected.id);
      await this.store.modifyAll(values => {
        const entry = chatGptAccountEntries(values).find(account => account.id === selected.id);
        if (entry?.credential.pool?.leases) delete entry.credential.pool.leases[reservation];
        return values;
      });
    };
    return { id: selected.id, credential, release };
  }

  async credential(id, { signal } = {}) {
    let result;
    const now = this.now();
    await this.store.modifyAll(async values => {
      const entry = chatGptAccountEntries(values).find(account => account.id === id);
      if (!entry || entry.credential.pool?.requiresLogin) throw new Error('The selected ChatGPT account is no longer available.');
      const refreshed = openAICodexCredentialNeedsRefresh(entry.credential, { now, refreshWindowMs: 300_000 })
        ? await refreshOpenAICodexCredential(entry.credential, { ...this.options, now }) : entry.credential;
      signal?.throwIfAborted();
      result = { ...refreshed, pool: { ...refreshed.pool, id } };
      values[entry.key] = result;
      return values;
    }, { signal });
    return result;
  }

  async recordUsage(id, usage, expectedAccess) {
    const numeric = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value)) ? Number(value) : null;
    const observedAt = numeric(usage.observedAt) ?? this.now();
    const sanitize = window => {
      const used = numeric(window?.usedPercent);
      if (used === null) return null;
      const usedPercent = Math.max(0, Math.min(100, used));
      const resetAt = Number.isFinite(Date.parse(window.resetAt)) ? new Date(window.resetAt).toISOString() : null;
      const seconds = numeric(window.windowSeconds);
      const windowSeconds = seconds > 0 ? seconds : null;
      return usedPercent === 0 && !resetAt && !windowSeconds ? null : { usedPercent, resetAt, windowSeconds };
    };
    await this.store.modifyAll(values => {
      const entry = chatGptAccountEntries(values).find(account => account.id === id);
      if (!entry || (expectedAccess && entry.credential.access !== expectedAccess)) return values;
      if (Date.parse(entry.credential.pool?.usage?.updatedAt || '') > observedAt) return values;
      values[entry.key] = { ...entry.credential, pool: { ...entry.credential.pool, id, usage: {
        primary: sanitize(usage.primary) || (usage.partial ? sanitize(entry.credential.pool?.usage?.primary) : null),
        secondary: sanitize(usage.secondary) || (usage.partial ? sanitize(entry.credential.pool?.usage?.secondary) : null),
        availableResetCount: Number.isFinite(usage.availableResetCount) && usage.availableResetCount >= 0
          ? Math.floor(usage.availableResetCount)
          : usage.partial ? entry.credential.pool?.usage?.availableResetCount ?? null : null,
        updatedAt: new Date(observedAt).toISOString(),
      } } };
      return values;
    });
  }

  async markFailure(id, model, failure) {
    const now = this.now();
    await this.store.modifyAll(values => {
      const entry = chatGptAccountEntries(values).find(account => account.id === id);
      if (!entry || (failure.expectedAccess && entry.credential.access !== failure.expectedAccess)) return values;
      const pool = { ...entry.credential.pool, id };
      if (failure.status === 401) pool.requiresLogin = true;
      else {
        const cooldowns = { ...pool.cooldowns };
        for (const key of Object.keys(cooldowns)) if (cooldowns[key].until <= now) delete cooldowns[key];
        cooldowns[model] = { until: failure.resetAt > now ? failure.resetAt : now + (failure.status === 429 ? 60_000 : 30_000) };
        pool.cooldowns = cooldowns;
      }
      values[entry.key] = { ...entry.credential, pool };
      return values;
    });
  }
}
