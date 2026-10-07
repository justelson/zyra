import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { withProviderStoreLock, writeProviderJson } from './provider-transactions.mjs';

export const DEFAULT_CHATGPT_ROUTING = Object.freeze({ strategy: 'balanced', accountMode: 'all', accountIds: [], preferredAccountId: null });
export function validateChatGptRouting(value) {
  if (!value || !['balanced', 'round-robin', 'fill-first'].includes(value.strategy)
    || !['all', 'selected'].includes(value.accountMode) || !Array.isArray(value.accountIds)
    || value.accountIds.length > 100 || !value.accountIds.every(validId)
    || (value.preferredAccountId !== null && !validId(value.preferredAccountId))) {
    throw new TypeError('Choose a valid ChatGPT usage rule and connected accounts.');
  }
  return { strategy: value.strategy, accountMode: value.accountMode, accountIds: [...new Set(value.accountIds)], preferredAccountId: value.preferredAccountId };
}
function validId(value) { return typeof value === 'string' && /^[a-f0-9]{32}$/.test(value); }
function policyPath(authPath) { return path.join(path.dirname(authPath), 'chatgpt-routing.json'); }
export async function readChatGptRouting(authPath) {
  try { return validateChatGptRouting(JSON.parse(await readFile(policyPath(authPath), 'utf8'))); }
  catch (error) { if (error.code === 'ENOENT') return structuredClone(DEFAULT_CHATGPT_ROUTING); throw new Error('ChatGPT usage rules could not be read. Review them in Providers > Limits.', { cause: error }); }
}
export async function saveChatGptRouting(authPath, value) {
  const policy = validateChatGptRouting(value), file = policyPath(authPath);
  await withProviderStoreLock(file, () => writeProviderJson(file, policy));
  return policy;
}

export function chatGptUsageAvailability(pool, model, now) {
  const deadlines = ['*', model].map(key => Number(pool?.cooldowns?.[key]?.until || 0)).filter(until => until > now);
  let score = 0;
  for (const window of [pool?.usage?.primary, pool?.usage?.secondary]) {
    if (!window) continue;
    const reset = Date.parse(window.resetAt || '');
    if (Number.isFinite(reset) && reset <= now) continue;
    score = Math.max(score, Number(window.usedPercent) || 0);
    if (window.usedPercent >= 100) {
      // Unknown reset times expire after a short retry window, never forever.
      const until = Number.isFinite(reset) ? reset : Date.parse(pool.usage.updatedAt) + 60_000;
      if (until > now) deadlines.push(until);
    }
  }
  return { until: deadlines.length ? Math.max(...deadlines) : 0, score };
}
