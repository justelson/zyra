import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HostRouter, isRead } from '../src/router.mjs';
import { BodyCache } from '../src/projection.mjs';

test('phone views resolve project-scoped canonical identity and cannot impersonate another view', async () => {
  const calls = [];
  const router = new HostRouter({ owner: 'phone', projects: ['/shared'], cache: new BodyCache(), client: {
    request: async (method, params) => {
      if (method === 'catalog.get') return { chat: { canonicalChatId: `canonical:${params.session}`, project: params.session === 'private' ? '/private' : '/shared' } };
      calls.push({ method, params }); return { viewing: params.viewing };
    }
  } });
  assert.equal(isRead('session.view'), true, 'view reports are fresh, never replayed from a durable mutation receipt');
  await assert.rejects(router.dispatch('session.view', { session: 'private', viewing: true }), { code: 'CHAT_NOT_VISIBLE' });
  await assert.rejects(router.dispatch('session.view', { session: 'visible', viewing: 'yes' }));
  await router.dispatch('session.view', { session: 'visible', viewing: true, viewId: 'someone-else', surface: 'desktop' });
  assert.deepEqual(calls, [{ method: 'session.view', params: { session: 'canonical:visible', viewId: 'main', viewing: true } }]);
});
