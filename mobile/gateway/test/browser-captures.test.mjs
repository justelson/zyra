import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HostRouter, isRead } from '../src/router.mjs';

test('machine capture library follows existing unrestricted-device authority and never leaks raw filesystem failures', async () => {
  let calls = 0;
  const captures = { list: () => { calls++; return { captures: [] }; }, get: () => { throw Error('private/path/to/capture'); } };
  for (const options of [{ allProjects: false }, { allProjects: true, hiddenProjects: ['/hidden'] }]) {
    const router = new HostRouter({ captures, ...options });
    for (const method of ['captures.list', 'captures.get', 'captures.chunk', 'captures.delete', 'captures.reference']) await assert.rejects(router.dispatch(method), /selected folders only/);
  }
  assert.equal(calls, 0);
  const router = new HostRouter({ captures, allProjects: true });
  assert.deepEqual(await router.dispatch('captures.list'), { captures: [] });
  await assert.rejects(router.dispatch('captures.get'), error => error.code === 'CAPTURE_UNAVAILABLE' && !error.message.includes('private'));
  assert(isRead('captures.list')); assert(isRead('captures.get')); assert(isRead('captures.chunk')); assert(!isRead('captures.delete'));
  await assert.rejects(new HostRouter({ allProjects: true }).dispatch('captures.list'), /Update Zyra/);
});
