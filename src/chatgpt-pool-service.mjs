import { ZyraCredentialStore, resolveZyraAuthPath } from './zyra-auth-store.mjs';
import { getChatGptAccountPool, updateChatGptAccount } from './chatgpt-account-pool.mjs';
import { readChatGptRouting, saveChatGptRouting } from './chatgpt-routing-policy.mjs';
import { fetchCodexUsageStats } from './chatgpt-account.mjs';

function poolFor(options) {
  const store = options.credentialStore ?? new ZyraCredentialStore({ authPath: options.authPath ?? resolveZyraAuthPath(options) });
  return getChatGptAccountPool(store, options);
}
const refreshing = new Map();
export async function getChatGptAccounts(options = {}) {
  const pool = poolFor(options);
  if (options.refreshUsage === true) {
    const key = pool.store.authPath;
    if (!refreshing.has(key)) {
      const request = (async () => {
        const accounts = await pool.list();
        for (let index = 0; index < accounts.length; index += 3) {
          await Promise.allSettled(accounts.slice(index, index + 3).filter(account => account.state !== 'needs-sign-in'
            && !(options.usageMaxAgeMs > 0 && pool.now() - Date.parse(account.usage?.updatedAt || '') < options.usageMaxAgeMs)).map(async account => {
            let credential;
            try {
              credential = await pool.credential(account.id);
              const observedAt = pool.now();
              const usage = await fetchCodexUsageStats({ ...options, accountCredential: credential, signal: AbortSignal.timeout(6_000) });
              await pool.recordUsage(account.id, { ...usage, observedAt }, credential.access);
            } catch (error) {
              if (error.status === 401 || error.code === 'ZYRA_AUTH_REAUTH_REQUIRED') await pool.markFailure(account.id, '*', { status: 401, expectedAccess: credential?.access });
              // Keep the last known limits on a failed check; do not invent fresh quota.
            }
          }));
        }
      })().finally(() => refreshing.delete(key));
      refreshing.set(key, request);
    }
    await refreshing.get(key);
  }
  return { accounts: await pool.list(), policy: await readChatGptRouting(pool.store.authPath), checkedAt: new Date(pool.now()).toISOString() };
}

export async function updateChatGptAccounts(input, options = {}) {
  if (!input || typeof input !== 'object') throw new TypeError('Choose an account or usage rule to update.');
  const pool = poolFor(options);
  if (input.action === 'policy') {
    const accounts = await pool.list();
    const ids = new Set(accounts.map(account => account.id));
    if (input.policy?.accountIds?.some(id => !ids.has(id)) || (input.policy?.preferredAccountId && !ids.has(input.policy.preferredAccountId))) throw new Error('Choose accounts that are still connected.');
    await saveChatGptRouting(pool.store.authPath, input.policy);
  } else if (input.action === 'enabled') {
    await updateChatGptAccount(pool.store, input.accountId, { enabled: input.enabled });
  } else if (input.action === 'remove' && input.confirmed === true) {
    await updateChatGptAccount(pool.store, input.accountId, { remove: true });
  } else throw new TypeError('Confirm the account action before continuing.');
  return getChatGptAccounts({ ...options, refreshUsage: false });
}
