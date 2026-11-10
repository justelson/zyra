import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HostRouter } from '../src/router.mjs';

test('phone timing uploads contain only catalogued dimensions and leave consent to the Desktop owner', async () => {
  const received = [];
  const router = new HostRouter({ timingSummary: properties => received.push(properties) });
  await router.dispatch('diagnostics.summary', { model_name: 'gpt-6.1-sol', outcome: 'completed', first_display_ms: 100,
    turnId: 'private-id', prompt: 'private history', source: 'cli', endpoint: 'private endpoint', first_text_ms: Infinity });
  assert.deepEqual(received, [{ model_name: 'gpt-6.1-sol', outcome: 'completed', first_display_ms: 100 }]);
  await assert.rejects(new HostRouter({}).dispatch('diagnostics.summary'), /Update Zyra/);
});
