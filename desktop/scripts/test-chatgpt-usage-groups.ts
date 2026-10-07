import assert from 'node:assert/strict'
import type { ChatGptAccountProfile, ChatGptRoutingPolicy } from '../src/shared/onboarding/contracts'
import { groupChatGptUsage, summarizeUsageGroup } from '../src/renderer/src/pages/settings/providers/chatgpt-usage-groups'

const now = Date.parse('2026-01-01T00:00:00Z')
const resetAt = new Date(now + 86400000).toISOString()
const account = (id: string, usedPercent: number, partial: Partial<ChatGptAccountProfile> = {}): ChatGptAccountProfile => ({
    id, email: id + '@example.test', plan: 'plus', primary: id === 'a', enabled: true, state: 'ready', resetAt: null, lastUsedAt: null, requestCount: 0, tokenExpiresAt: null,
    usage: { primary: { usedPercent, resetAt, windowSeconds: 604800 }, secondary: null, updatedAt: new Date(now).toISOString() }, ...partial
})
const policy: ChatGptRoutingPolicy = { strategy: 'balanced', accountMode: 'all', accountIds: [], preferredAccountId: null }
const accounts = [account('a', 15), account('b', 35)]
const groups = groupChatGptUsage(accounts, now)
assert.equal(groups.length, 1, 'weekly-only accounts share one period')
assert.equal(groups[0].label, 'Weekly', 'a weekly primary window is labelled weekly')
assert.equal(summarizeUsageGroup(groups[0], policy, now).averageUsed, 25, '75% remains on average')
assert.equal(summarizeUsageGroup(groups[0], { ...policy, accountMode: 'selected', accountIds: ['b'] }, now).averageUsed, 35, 'selected-only summary excludes other accounts')
assert.equal(summarizeUsageGroup(groupChatGptUsage([accounts[0], { ...accounts[1], enabled: false, state: 'paused' }], now)[0], policy, now).averageUsed, 15, 'paused accounts are excluded')
assert.equal(summarizeUsageGroup(groups[0], { ...policy, accountMode: 'selected', accountIds: [] }, now).averageUsed, null, 'no allowed accounts never displays fake remaining quota')
const expired = account('expired', 100); expired.usage!.primary!.resetAt = new Date(now - 1).toISOString()
assert.equal(summarizeUsageGroup(groupChatGptUsage([expired], now)[0], policy, now).averageUsed, 0, 'elapsed windows no longer show depleted usage')
const dual = account('dual', 15); dual.usage!.secondary = { usedPercent: 50, resetAt, windowSeconds: 18000 }
assert.deepEqual(groupChatGptUsage([dual], now).map(group => group.label), ['5-hour', 'Weekly'], 'different window durations form separate summaries')
const unknown = account('unknown', 0, { usage: null })
assert.equal(summarizeUsageGroup(groupChatGptUsage([unknown], now)[0], policy, now).averageUsed, null, 'unreported quota is not treated as full capacity')
assert.equal(summarizeUsageGroup(groupChatGptUsage([unknown], now)[0], policy, now).nextReset, null)
console.log('ChatGPT usage groups: period labels, averaging, selection, pause, reset and unknown usage: ok')
