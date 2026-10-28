import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ZyraCredentialStore, createZyraCredentialAuthStorage } from '../src/zyra-auth-store.mjs';
import { ChatGptAccountPool, chatGptIdentity, updateChatGptAccount, saveChatGptAccount } from '../src/chatgpt-account-pool.mjs';
import { DEFAULT_CHATGPT_ROUTING, saveChatGptRouting } from '../src/chatgpt-routing-policy.mjs';
import { getChatGptAccounts, updateChatGptAccounts } from '../src/chatgpt-pool-service.mjs';
import { buildChatGptAccountStatus, resolveChatGptAccountAuth, fetchCodexResetCredits, redeemCodexResetCredit, normalizeCodexResetCredits, normalizeCodexUsageStats } from '../src/chatgpt-account.mjs';
import { createChatGptRequestCredentials, installChatGptAccountRouting, readChatGptResponseLimits } from '../src/chatgpt-account-runtime.mjs';
import { AssistantMessageEventStream } from '../src/runtime/providers/src/utils/event-stream.js';

assert.equal(normalizeCodexResetCredits({}).availableCount, undefined, 'missing reset data is not zero');
assert.equal(normalizeCodexResetCredits({ available_count: null }).availableCount, undefined, 'null is not a reported zero');
assert.equal(normalizeCodexResetCredits({ available_count: 0 }).availableCount, 0);
assert.equal(normalizeCodexResetCredits({ credits: [] }).availableCount, 0, 'a known empty list is a real zero');
assert.equal(normalizeCodexUsageStats({ rate_limit_reset_credits: { available_count: null } }).availableResetCount, undefined);
const root = await mkdtemp(join(tmpdir(), 'zyra-account-pool-'));
let now = Date.now();
const jwt = (id, generation = 1) => `synthetic.${Buffer.from(JSON.stringify({ sub: id, generation, 'https://api.openai.com/auth': { chatgpt_account_id: id, chatgpt_plan_type: 'plus' }, 'https://api.openai.com/profile': { email: `${id}@example.test` } })).toString('base64url')}.fixture`;
const credential = (id, generation = 1) => ({ type: 'oauth', accountId: id, access: jwt(id, generation), refresh: `fixture-refresh-${id}`, expires: now + 3_600_000 });
const store = new ZyraCredentialStore({ authPath: join(root, 'credentials', 'auth.json') });
const options = { credentialStore: store, now: () => now };
const pool = new ChatGptAccountPool(store, options);
const idA = chatGptIdentity(credential('a')).id, idB = chatGptIdentity(credential('b')).id;
const policy = value => saveChatGptRouting(store.authPath, { ...DEFAULT_CHATGPT_ROUTING, ...value });
const take = async () => { const lease = await pool.acquire('model'); await lease.release(); return lease.id; };
try {
  const auth = await createZyraCredentialAuthStorage(options);
  await auth.loginApiKey('openai', 'synthetic-api-key');
  await auth.loginOAuth('openai-codex', credential('a'));
  await auth.loginOAuth('openai-codex', credential('b'));
  assert.equal((await pool.list()).length, 2, 'Adding a sign-in preserves the existing account.');
  const beforePromotion = store.read('openai-codex');
  await updateChatGptAccount(store, idB, { primary: true });
  assert.equal(store.read('openai-codex').access, credential('b').access, 'Primary selection swaps the actual credential.');
  assert.equal((await pool.list()).length, 2, 'Promotion preserves both identities.');
  assert.equal((await pool.list()).find(account => account.primary).id, idB);
  await updateChatGptAccount(store, idA, { primary: true });
  assert.equal(store.read('openai-codex').access, beforePromotion.access, 'Promoting back retains original credentials.');

  // Modal reads and approved consumption select pool credentials without promotion.
  const primaryBeforeModal = structuredClone(store.read('openai-codex'));
  const modalRequests = [];
  const modalOptions = { ...options, fetchImpl: async (url, init) => {
    modalRequests.push({ url: String(url), token: init.headers.Authorization, accountId: init.headers['ChatGPT-Account-Id'], method: init.method || 'GET' });
    if (String(url).endsWith('/consume')) {
      assert.equal(JSON.parse(init.body).credit_id, 'fixture-reset-b');
      return new Response(JSON.stringify({ windows_reset: 1 }));
    }
    if (String(url).endsWith('/rate-limit-reset-credits')) return new Response(JSON.stringify({ credits: [{ id: 'fixture-reset-b', status: 'available' }] }));
    return new Response(JSON.stringify({ rate_limit: { primary_window: { used_percent: init.headers['ChatGPT-Account-Id'] === 'b' ? 75 : 25 } } }));
  } };
  const selectedOptions = { ...modalOptions, accountId: idB };
  const selectedStatus = await buildChatGptAccountStatus('openai-codex', selectedOptions);
  assert.equal(selectedStatus.accountId, 'b');
  assert.equal(selectedStatus.poolAccountId, idB, 'targeted status attests the selected pool identity');
  assert.equal(selectedStatus.email, 'b@example.test');
  assert.equal(selectedStatus.usage.primary.usedPercent, 75, 'selected status fetches selected usage, not primary usage');
  assert.equal((await resolveChatGptAccountAuth(selectedOptions)).accessToken, jwt('b'));
  const selectedResetInventory = await fetchCodexResetCredits(selectedOptions);
  assert.equal(selectedResetInventory.credits[0].id, 'fixture-reset-b');
  assert.equal(selectedResetInventory.poolAccountId, idB, 'reset inventory independently attests the selected pool identity');
  assert.equal((await redeemCodexResetCredit('fixture-reset-b', selectedOptions)).windowsReset, 1);
  assert.deepEqual(modalRequests.map(request => ({ ...request, url: request.url.replace('https://chatgpt.com/backend-api', '') })), [
    { url: '/wham/usage', token: `Bearer ${jwt('b')}`, accountId: 'b', method: 'GET' },
    { url: '/wham/rate-limit-reset-credits', token: `Bearer ${jwt('b')}`, accountId: 'b', method: 'GET' },
    { url: '/wham/rate-limit-reset-credits/consume', token: `Bearer ${jwt('b')}`, accountId: 'b', method: 'POST' },
  ]);
  assert.deepEqual(store.read('openai-codex'), primaryBeforeModal, 'selected reads/redemption never mutate or promote primary');
  const primaryStatus = await buildChatGptAccountStatus('openai-codex', modalOptions);
  assert.equal(primaryStatus.accountId, 'a');
  assert.equal(primaryStatus.usage.primary.usedPercent, 25);
  assert.equal(modalRequests.at(-1).token, `Bearer ${jwt('a')}`);
  assert.equal(modalRequests.at(-1).accountId, 'a');
  modalRequests.length = 0;
  for (const accountId of ['unknown-account', '', '  ', ` ${idB}`, 'bad\naccount', null, 42]) {
    const invalidOptions = { ...modalOptions, accountId, accountCredential: credential('a') };
    await assert.rejects(buildChatGptAccountStatus('openai-codex', invalidOptions), /account.*(invalid|available)/i);
    await assert.rejects(resolveChatGptAccountAuth(invalidOptions), /account.*(invalid|available)/i);
    await assert.rejects(fetchCodexResetCredits(invalidOptions), /account.*(invalid|available)/i);
    await assert.rejects(redeemCodexResetCredit('fixture-reset-b', invalidOptions), /account.*(invalid|available)/i);
  }
  assert.deepEqual(modalRequests, [], 'invalid or disconnected ids never fall back, even with a supplied credential');
  assert.deepEqual(store.read('openai-codex'), primaryBeforeModal);

  // A subscription upgrade changes metadata, not the reconnect identity.
  for (const plan of ['prolite', 'pro', 'future-plan']) {
    const upgraded = { ...credential('a'), access: `synthetic.${Buffer.from(JSON.stringify({
      'https://api.openai.com/auth': { chatgpt_account_id: 'a', chatgpt_plan_type: plan },
      'https://api.openai.com/profile': { email: 'a@example.test' }
    })).toString('base64url')}.fixture` };
    await pool.markFailure(idA, '*', { status: 401 });
    await auth.loginOAuth('openai-codex', upgraded, { accountId: idA });
    const accounts = await pool.list();
    assert.equal(accounts.length, 2, 'upgrading a plan must not duplicate or remove accounts');
    assert.equal(accounts.find(account => account.id === idA).state, 'ready');
    assert.equal(accounts.find(account => account.id === idA).plan, plan, 'reconnect adopts the new plan without an allowlist');
    assert.equal(accounts.find(account => account.id === idA).primary, true);
  }
  await auth.loginOAuth('openai-codex', credential('a', 2));
  assert.equal((await pool.list()).length, 2, 'Same-account login updates rather than duplicates.');
  await assert.rejects(auth.loginOAuth('openai-codex', credential('b'), { accountId: idA }), /same ChatGPT account/);
  assert.equal(store.read('openai-codex').access, jwt('a', 2));
  await pool.recordUsage(idA, { primary: { usedPercent: 90, resetAt: new Date(now + 10000).toISOString() }, secondary: { usedPercent: 10, resetAt: new Date(now + 50000).toISOString() } });
  await pool.recordUsage(idB, { primary: { usedPercent: 20, resetAt: new Date(now + 10000).toISOString() } });
  assert.equal(await take(), idB, 'Balanced routing uses more remaining quota.');
  await policy({ strategy: 'round-robin' });
  assert.notEqual(await take(), await take(), 'Round robin rotates eligible identities.');
  // Conversation affinity survives independent workers, but never bypasses eligibility.
  const affinityTake = async (sessionId, owner = pool, excluded = new Set()) => { const lease = await owner.acquire('affinity-model', excluded, undefined, sessionId); await lease.release(); return lease.id; };
  const pinned = await affinityTake('conversation-one');
  assert.equal(await affinityTake('conversation-one'), pinned, 'Follow-up stays on its healthy account.');
  assert.equal(await affinityTake('conversation-one', new ChatGptAccountPool(store, options)), pinned, 'Affinity is shared across worker instances.');
  const otherStart = await affinityTake('conversation-two');
  assert.notEqual(otherStart, pinned, 'New conversations distribute their initial accounts fairly.');
  assert.equal(await affinityTake('conversation-one'), pinned);
  await pool.markFailure(pinned, 'affinity-model', { status: 429, resetAt: now + 1000 });
  const replacement = await affinityTake('conversation-one');
  assert.notEqual(replacement, pinned, 'A real model limit fails over the conversation.');
  now += 1001;
  assert.equal(await affinityTake('conversation-one'), replacement, 'Successful failover becomes the new affinity.');
  await updateChatGptAccount(store, replacement, { enabled: false });
  assert.equal(await affinityTake('conversation-one'), pinned, 'Paused accounts cannot retain affinity.');
  await updateChatGptAccount(store, replacement, { enabled: true });
  await policy({ accountMode: 'selected', accountIds: [replacement], strategy: 'round-robin' });
  assert.equal(await affinityTake('conversation-one'), replacement, 'Affinity never bypasses account scope.');
  assert.equal(await affinityTake('single-account-conversation'), replacement, 'One eligible account is unchanged.');
  await policy({ strategy: 'round-robin' });
  assert.equal((await pool.resolve('affinity-model', undefined, 'conversation-one')).id, replacement, 'Auth resolution honors eligible conversation affinity too.');
  await store.modifyAll(values => {
    values['openai-codex'].pool.conversationAffinities = {
      ...Object.fromEntries(Array.from({ length: 300 }, (_, i) => [i.toString(16).padStart(64, '0'), { id: idA, usedAt: now }])),
      ['e'.repeat(64)]: { id: idA, usedAt: now - 24 * 60 * 60000 },
      ['f'.repeat(64)]: { id: 'disconnected-fixture-account', usedAt: now },
    };
    return values;
  });
  await affinityTake('affinity-cap-bound');
  const boundedAffinities = store.read('openai-codex').pool.conversationAffinities;
  assert.equal(Object.keys(boundedAffinities).length, 256, 'Persisted affinities have a hard bound.');
  assert.ok(Object.keys(boundedAffinities).every(key => /^[a-f0-9]{64}$/.test(key)), 'Raw conversation ids are never persisted.');
  assert.ok(!boundedAffinities['e'.repeat(64)], 'Idle affinity expires without a restart.');
  assert.ok(!boundedAffinities['f'.repeat(64)], 'Disconnected affinity is cleaned.');
  const held = await pool.acquire('model');
  const concurrent = await pool.acquire('model');
  assert.notEqual(held.id, concurrent.id, 'Concurrent requests distribute across available accounts.');
  await held.release(); await concurrent.release();
  const isolatedPool = new ChatGptAccountPool(new ZyraCredentialStore({ authPath: store.authPath }), options);
  const firstWorker = await pool.acquire('model');
  const secondWorker = await isolatedPool.acquire('model');
  assert.notEqual(firstWorker.id, secondWorker.id, 'Separate worker instances share active reservations.');
  await firstWorker.release(); await secondWorker.release();
  const nextWorker = await isolatedPool.acquire('model');
  await nextWorker.release();
  const restartedWorker = await new ChatGptAccountPool(store, options).acquire('model');
  assert.notEqual(nextWorker.id, restartedWorker.id, 'Round-robin cursor persists across new workers.');
  await restartedWorker.release();
  await policy({ strategy: 'fill-first', preferredAccountId: idA });
  assert.equal(await take(), idA);
  assert.equal(await take(), idA, 'Drain-first keeps using the preferred account.');
  await pool.recordUsage(idA, { primary: { usedPercent: 100, resetAt: new Date(now + 10000).toISOString() }, secondary: { usedPercent: 100, resetAt: new Date(now + 20000).toISOString() } });
  assert.equal(await take(), idB);
  now += 11000;
  assert.equal(await take(), idB, 'Both exhausted windows must reset before an account resumes.');
  now += 10000;
  assert.equal(await take(), idA, 'Expired reset timestamps become eligible without restarting.');
  await policy({ accountMode: 'selected', accountIds: [idA] });
  await updateChatGptAccount(store, idA, { enabled: false });
  await assert.rejects(pool.acquire('model'), /No ChatGPT account/, 'Selected-only never falls through to another account.');
  await updateChatGptAccount(store, idA, { enabled: true });
  await policy({ accountMode: 'selected', accountIds: [] });
  await assert.rejects(pool.acquire('model'), /No ChatGPT account/, 'An empty selected set means no account.');
  await policy({});
  await pool.markFailure(idA, '*', { status: 401, expectedAccess: 'obsolete-token' });
  assert.equal((await pool.list()).find(a => a.id === idA).state, 'ready', 'An old request cannot invalidate reconnected credentials.');
  const sanitized = JSON.stringify(await getChatGptAccounts(options));
  for (const secret of ['fixture-refresh', 'synthetic-api-key', 'synthetic.']) assert.ok(!sanitized.includes(secret));
  const calls = [], resetCalls = [];
  const refreshed = await getChatGptAccounts({ ...options, refreshUsage: true, fetchImpl: async (url, init) => {
    const id = init.headers['ChatGPT-Account-Id'];
    if (String(url).endsWith('/rate-limit-reset-credits')) {
      resetCalls.push(id);
      return new Response(JSON.stringify({ available_count: 7 }));
    }
    calls.push(id);
    return new Response(JSON.stringify({ plan_type: 'plus', rate_limit: { primary_window: { used_percent: 50, reset_at: (now + 30000) / 1000 } },
      ...(id === 'a' ? { rate_limit_reset_credits: { available_count: 3 } } : {}) }));
  } });
  assert.deepEqual(calls.sort(), ['a', 'b']);
  assert.ok(refreshed.accounts.every(a => a.usage.primary.usedPercent === 50));
  assert.equal(refreshed.accounts.find(a => a.id === idA).usage.availableResetCount, 3, 'usage refresh must retain each account reset count');
  assert.equal(refreshed.accounts.find(a => a.id === idB).usage.availableResetCount, 7, 'missing usage counts use that account reset endpoint, not the primary account');
  assert.deepEqual(resetCalls, ['b'], 'do not repeat reset requests when usage already reports the count');
  await pool.recordUsage(idA, { partial: true, primary: { usedPercent: 50 } });
  assert.equal((await pool.list()).find(a => a.id === idA).usage.availableResetCount, 3, 'streamed limit headers must not erase reset credits');
  const unavailableResets = await getChatGptAccounts({ ...options, refreshUsage: true, fetchImpl: async url => {
    if (String(url).endsWith('/rate-limit-reset-credits')) throw new Error('Synthetic reset endpoint unavailable');
    return new Response(JSON.stringify({ rate_limit: { primary_window: { used_percent: 50 } } }));
  } });
  assert.ok(unavailableResets.accounts.every(a => a.usage.availableResetCount === null), 'an unavailable reset count is unknown, not a fabricated zero');
  await pool.recordUsage(idB, { primary: { usedPercent: 5 }, observedAt: now - 1000 });
  assert.equal((await pool.list()).find(a => a.id === idB).usage.primary.usedPercent, 50, 'An older quota check cannot overwrite newer usage.');
  await assert.rejects(updateChatGptAccounts({ action: 'remove', accountId: idB }, options), /Confirm/);
  await updateChatGptAccount(store, idA, { remove: true });
  assert.equal(chatGptIdentity(store.read('openai-codex')).id, idB, 'Removing primary promotes the remaining identity.');
  assert.equal(store.read('openai').key, 'synthetic-api-key');
  await assert.rejects(pool.credential(idA), /no longer available/, 'Disconnected credentials cannot be resurrected.');
  await saveChatGptAccount(store, credential('a'));
  // Real refresh helper and cross-store lock: two callers refresh just once.
  let refreshCount = 0;
  await store.modifyAll(values => { for (const key of Object.keys(values)) if (values[key]?.accountId === 'a') values[key].expires = 0; return values; });
  const refreshOptions = { now: () => now, fetchImpl: async () => { refreshCount++; return new Response(JSON.stringify({ access_token: jwt('a', 3), refresh_token: 'fixture-rotated-a', expires_in: 3600 })); } };
  const freshPools = [new ChatGptAccountPool(store, refreshOptions), new ChatGptAccountPool(new ZyraCredentialStore({ authPath: store.authPath }), refreshOptions)];
  await Promise.all(freshPools.map(p => p.credential(idA)));
  assert.equal(refreshCount, 1);

  // Native routing boundary: real serialized credentials with controlled stream events.
  await policy({ strategy: 'fill-first', preferredAccountId: idA });
  const request = createChatGptRequestCredentials(store);
  const requests = [];
  const originalAcquire = pool.acquire.bind(pool);
  const routedSessions = [];
  pool.acquire = (...args) => { routedSessions.push(args[3]); return originalAcquire(...args); };
  let partial = false, failAll = false, networkFailure = false;
  const message = content => ({ role: 'assistant', provider: 'openai-codex', model: 'model', content, stopReason: 'stop' });
  const runtime = {
    getAuth: async () => ({ auth: { apiKey: (await request.credentials.read('openai-codex')).access } }),
    stream(model, context, options) {
      const source = new AssistantMessageEventStream();
      (async () => {
        const token = (await runtime.getAuth(model)).auth.apiKey;
        requests.push(token);
        if (!networkFailure) await options.onResponse({ status: token === jwt('a', 3) || failAll ? 429 : 200, headers: new Headers({ 'retry-after': '30' }) }, model);
        source.push({ type: 'start', partial: message([]) });
        if (partial) source.push({ type: 'text_delta', delta: 'Already visible', partial: message([{ type: 'text', text: 'Already visible' }]) });
        if (networkFailure || token === jwt('a', 3) || failAll) source.push({ type: 'error', reason: 'error', error: { ...message([]), errorMessage: networkFailure ? 'WebSocket closed 1006' : 'Usage limit reached' } });
        else source.push({ type: 'done', reason: 'stop', message: message([{ type: 'text', text: 'Done' }]) });
      })().catch(error => source.push({ type: 'error', reason: 'error', error: { ...message([]), errorMessage: error.message } }));
      return source;
    },
    streamSimple(...args) { return this.stream(...args); },
  };
  installChatGptAccountRouting(runtime, pool, request.context);
  const model = { provider: 'openai-codex', id: 'model', api: 'openai-codex-responses' };
  const events = [];
  for await (const event of runtime.stream(model, {}, { sessionId: 'routed-conversation' })) events.push(event.type);
  assert.deepEqual(routedSessions, ['routed-conversation', 'routed-conversation'], 'Runtime carries the stable conversation id through account failover.');
  assert.deepEqual(requests, [jwt('a', 3), jwt('b')]);
  assert.deepEqual(events, ['start', 'done'], 'Failed startup events do not appear before the successful response.');
  assert.equal(pool.inFlight.size, 0);
  now += 31000;
  requests.length = 0; partial = true;
  const failure = await runtime.stream(model, {}, {}).result();
  assert.equal(failure.errorMessage, 'Usage limit reached');
  assert.equal(requests.length, 1, 'Partial content prevents replay on another account.');
  now += 31000; partial = false; failAll = true; requests.length = 0;
  await runtime.stream(model, {}, {}).result();
  assert.equal(requests.length, 2, 'Failover is bounded to one attempt per eligible identity.');
  const controller = new AbortController(); controller.abort(); requests.length = 0;
  const aborted = await runtime.stream(model, {}, { signal: controller.signal }).result();
  assert.equal(aborted.stopReason, 'aborted'); assert.equal(requests.length, 0);
  now += 31000; networkFailure = true; partial = true; requests.length = 0;
  const socketFailure = await runtime.stream(model, {}, {}).result();
  assert.equal(socketFailure.errorMessage, 'WebSocket closed 1006');
  assert.equal(requests.length, 1, 'A mid-response WebSocket failure never replays already-visible work on another account.');
  assert.ok((await pool.list()).every(account => account.state === 'ready'), 'A mid-response socket failure cannot persist a cooldown that stops other threads.');
  const limits = readChatGptResponseLimits(new Headers({ 'x-codex-primary-used-percent': '100', 'x-codex-primary-reset-at': String((now + 10000) / 1000), 'x-codex-primary-window-minutes': '300' }), now);
  assert.equal(Date.parse(limits.primary.resetAt), now + 10000);
  assert.equal(limits.primary.windowSeconds, 18000);
  assert.equal(Object.keys(JSON.parse(await readFile(store.authPath, 'utf8'))).filter(k => k.startsWith('openai-codex')).length, 2);
  console.log('ChatGPT account pool: separate sign-ins, rules, resets, refresh locking, secret filtering and safe bounded failover: ok');
} finally { await rm(root, { recursive: true, force: true }); }
