import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { readChatGptResponseLimits } from '../../src/chatgpt-account-runtime.mjs'
import { ChatGptAccountPool, chatGptIdentity } from '../../src/chatgpt-account-pool.mjs'
import { groupChatGptUsage } from '../src/renderer/src/pages/settings/providers/chatgpt-usage-groups'
import { buildAccountUsageResults } from '../src/renderer/src/components/command-palette-account-usage'
let now = Date.now()
const credential = { type: 'oauth', accountId: 'synthetic-usage-repro', access: 'synthetic', expires: now + 3600000 }
let values: any = { 'openai-codex': credential }
const store = { snapshot: async () => structuredClone(values), modifyAll: async (fn: any) => { values = await fn(structuredClone(values)) } }
const pool = new ChatGptAccountPool(store, { now: () => now })
const id = chatGptIdentity(credential).id
const weekly = { usedPercent: 12, resetAt: new Date(now + 604800000).toISOString(), windowSeconds: 604800 }
async function rendered() {
    const accounts = await pool.list()
    const snapshot = { accounts, policy: { accountMode: 'all', accountIds: [], strategy: 'balanced', preferredAccountId: null }, checkedAt: new Date(now).toISOString() } as any
    const rows = buildAccountUsageResults(snapshot, () => {})
    return { labels: groupChatGptUsage(accounts).map(group => group.label), html: rows.map(row => renderToStaticMarkup(row.trailing as any)).join('') }
}
await pool.recordUsage(id, { primary: weekly, secondary: null, observedAt: now })
const initial = await rendered()
assert.deepEqual(initial.labels, ['Weekly'])
const headers = new Headers({ 'x-codex-primary-used-percent': '12', 'x-codex-primary-window-minutes': '10080', 'x-codex-primary-reset-at': String(Math.floor(now / 1000) + 604800), 'x-codex-secondary-used-percent': '0' })
const partial = readChatGptResponseLimits(headers, now)
assert.equal(partial.secondary, null, 'An empty secondary header is not evidence of a second quota')
now += 100
await pool.recordUsage(id, { ...partial, partial: true, observedAt: now })
assert.deepEqual((await rendered()).labels, ['Weekly'], 'Cache and fresh reads have the same one-column layout')
// Legacy caches from the old parser remain safe before any network request.
values['openai-codex'].pool.usage.secondary = { usedPercent: 0, resetAt: null, windowSeconds: 0 }
assert.deepEqual((await rendered()).labels, ['Weekly'])
headers.set('x-codex-secondary-window-minutes', '300')
const dual = readChatGptResponseLimits(headers, now)
assert.equal(dual.secondary?.usedPercent, 0)
now += 100
await pool.recordUsage(id, { ...dual, observedAt: now })
const valid = await rendered()
assert.deepEqual(valid.labels, ['5-hour', 'Weekly'])
assert.match(valid.html, /100% left/, 'A confirmed zero-usage window really has 100% remaining')
for (const invalid of [null, '', false, NaN, Infinity]) {
    now += 100
    await pool.recordUsage(id, { primary: weekly, secondary: { usedPercent: invalid, resetAt: weekly.resetAt, windowSeconds: 18000 }, observedAt: now })
    assert.deepEqual((await rendered()).labels, ['Weekly'], 'Missing or malformed usage never invents full remaining capacity')
}
console.log('Usage preview: no phantom cached secondary column; confirmed zero quota preserved; null/invalid values stay unknown')
