import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { readChatGptResponseLimits } from '../src/chatgpt-account-runtime.mjs';
import { ChatGptAccountPool, CHATGPT_PROVIDER } from '../src/chatgpt-account-pool.mjs';

// Exercise the real renderer helper without a browser or renderer path aliases.
const source = await readFile(new URL('../desktop/src/renderer/src/pages/settings/providers/chatgpt-usage-groups.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { groupChatGptUsage } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const now = Date.parse('2026-01-01T00:00:00Z');
const resetAt = new Date(now + 60_000).toISOString();
const placeholder = { usedPercent: 0, resetAt: null, windowSeconds: 0 };
const confirmed = { usedPercent: 0, resetAt: null, windowSeconds: 18_000 };
const unknown = { usedPercent: 27, resetAt: null, windowSeconds: null };
const headers = (used, extra = {}) => ({ 'x-codex-secondary-used-percent': used, ...extra });

for (const raw of [0, '0', null, undefined, '', ' ', false]) {
  assert.equal(readChatGptResponseLimits(headers(raw), now).secondary, null);
}
assert.equal(readChatGptResponseLimits(new Headers({ 'x-codex-secondary-used-percent': '0', 'x-codex-secondary-window-minutes': '0' }), now).secondary, null);
assert.deepEqual(readChatGptResponseLimits(headers('0', { 'x-codex-secondary-window-minutes': '300' }), now).secondary, confirmed);
assert.deepEqual(readChatGptResponseLimits(headers('0', { 'x-codex-secondary-reset-after-seconds': '60' }), now).secondary, { ...placeholder, resetAt, windowSeconds: null });
assert.deepEqual(readChatGptResponseLimits(headers('27'), now).secondary, unknown);

let values = { [CHATGPT_PROVIDER]: { type: 'oauth', pool: { id: 'synthetic', usage: { primary: confirmed, secondary: placeholder } } } };
const store = { modifyAll: async update => { values = await update(values); } };
const pool = new ChatGptAccountPool(store, { now });
const usage = () => values[CHATGPT_PROVIDER].pool.usage;
await pool.recordUsage('synthetic', { partial: true, observedAt: null });
assert.deepEqual(usage().primary, confirmed);
assert.equal(usage().secondary, null, 'Partial fallback must sanitize cached placeholders');
assert.equal(usage().updatedAt, new Date(now).toISOString(), 'Null observation time must not become epoch zero');
for (const usedPercent of [null, undefined, '', ' ', false]) {
  await pool.recordUsage('synthetic', { secondary: { usedPercent, windowSeconds: 18_000 } });
  assert.equal(usage().secondary, null, 'Missing numeric usage must not become confirmed zero');
}
await pool.recordUsage('synthetic', { primary: confirmed, secondary: placeholder });
assert.deepEqual(usage().primary, confirmed);
assert.equal(usage().secondary, null);
await pool.recordUsage('synthetic', { secondary: unknown });
assert.deepEqual(usage().secondary, unknown);
await pool.recordUsage('synthetic', { secondary: { usedPercent: 0, resetAt, windowSeconds: null } });
assert.deepEqual(usage().secondary, { usedPercent: 0, resetAt, windowSeconds: null });

const account = (primary, secondary) => ({ id: 'synthetic', enabled: true, state: 'ready', usage: { primary, secondary } });
assert.deepEqual(groupChatGptUsage([account(confirmed, placeholder)], now).map(group => group.key), ['18000'], 'Cached placeholders must not create a secondary group');
assert.deepEqual(groupChatGptUsage([account(null, placeholder)], now).map(group => group.key), ['unavailable']);
assert.deepEqual(groupChatGptUsage([account(confirmed, unknown)], now).map(group => group.key), ['18000', 'unknown-1']);
assert.equal(groupChatGptUsage([account(null, { usedPercent: 0, resetAt, windowSeconds: null })], now)[0].entries[0].window.usedPercent, 0);
assert.deepEqual(groupChatGptUsage([account(null, { usedPercent: null, resetAt, windowSeconds: 604800 })], now).map(group => group.key), ['unavailable']);

// Parser -> pool -> renderer: a real primary and an empty secondary stay one group.
const limits = readChatGptResponseLimits({
  'x-codex-primary-used-percent': '0', 'x-codex-primary-window-minutes': '300',
  'x-codex-secondary-used-percent': '0', 'x-codex-secondary-window-minutes': '0',
}, now);
await pool.recordUsage('synthetic', limits);
assert.deepEqual(groupChatGptUsage([account(usage().primary, usage().secondary)], now).map(group => group.key), ['18000']);
console.log('ChatGPT quota placeholder parser, pool and renderer checks passed.');
