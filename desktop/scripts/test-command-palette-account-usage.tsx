import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ChatGptPoolSnapshot, ChatGptAccountProfile } from '../src/shared/onboarding/contracts'
import { buildAccountUsageResults } from '../src/renderer/src/components/command-palette-account-usage'
import { CommandPaletteResults } from '../src/renderer/src/components/CommandPaletteResults'

const future = new Date(Date.now() + 3600000).toISOString()
const account = (id: string, primary: boolean): ChatGptAccountProfile => ({
    id, alias: primary ? 'Quiet Comet 123' : 'Silver Otter 456', email: `${id}@example.test`, primary, plan: 'plus', enabled: true, state: 'ready', resetAt: null,
    lastUsedAt: null, requestCount: 0, tokenExpiresAt: null,
    usage: { primary: { usedPercent: 15, resetAt: future, windowSeconds: 18000 },
        secondary: { usedPercent: 45, resetAt: future, windowSeconds: 604800 }, updatedAt: new Date().toISOString() }
})
const pool: ChatGptPoolSnapshot = { accounts: [account('second', false), account('first', true)],
    policy: { strategy: 'balanced', accountMode: 'selected', accountIds: ['first'], preferredAccountId: null }, checkedAt: future }
let opened = 0
const results = () => buildAccountUsageResults(pool, () => opened++)
const html = () => renderToStaticMarkup(createElement(CommandPaletteResults, {
    query: 'usage', results: results(), selectedIndex: 0, setSelectedIndex: () => {}, selectResult: () => {},
    loading: false, searchFailed: false, indexingOlderChats: false
}))
assert.equal(results().length, 3)
assert.equal(results()[1].title, 'Quiet Comet 123', 'Primary account alias comes first without mutating the snapshot.')
assert.doesNotMatch(html(), /example\.test/, 'Hidden emails are absent from markup, tooltips and accessibility labels.')
const primaryAccount = pool.accounts.find(account => account.primary)!
const savedAlias = primaryAccount.alias
delete primaryAccount.alias
assert.equal(results()[1].title, 'Account first', 'Older snapshots get an opaque label rather than exposing email.')
assert.doesNotMatch(html(), /example\.test/)
primaryAccount.alias = savedAlias
let buttonDepth = 0
for (const tag of html().match(/<\/?button\b[^>]*>/g) || []) {
    buttonDepth += tag.startsWith('</') ? -1 : 1
    assert.ok(buttonDepth <= 1, 'Usage identity actions do not nest buttons.')
}
assert.equal(buttonDepth, 0)
assert.equal(pool.accounts[0].id, 'second')
assert.equal(results()[0].title, 'Average usage')
assert.match(html(), /data-usage-pie/)
assert.match(html(), /5-hour/)
assert.match(html(), /Weekly/)
assert.match(html(), /85% left/)
assert.match(html(), /55% left/)
assert.match(html(), /Resets /)
assert.match(html(), /Excluded/)
assert.equal((html().match(/role="option"/g) || []).length, 3, 'Average row plus one selectable row per account.')
results()[0].action(); assert.equal(opened, 1)
pool.accounts[0].usage!.primary!.resetAt = new Date(Date.now() - 1000).toISOString()
assert.match(html(), /100% left/, 'Expired windows reset before the next network refresh.')
pool.accounts[0].usage!.secondary = null
assert.match(html(), /Unavailable/, 'Missing weekly usage is not invented from another account.')
pool.accounts[0].enabled = false; pool.accounts[0].state = 'needs-sign-in'
assert.match(html(), /Sign in again/, 'An unusable secondary stays visible.')
pool.accounts[0].state = 'paused'
assert.match(html(), /Paused/)
pool.accounts[0].usage!.primary!.usedPercent = NaN
assert.doesNotMatch(html(), /NaN%/)
pool.accounts = []
assert.deepEqual(results(), [])
console.log('Command palette account usage passed: two accounts, both windows, reset, missing usage, routing state, Limits action.')
