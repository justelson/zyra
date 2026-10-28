import assert from 'node:assert/strict'
import { summarizeAssistantThreadUsage } from '../src/renderer/src/pages/assistant/assistant-thread-details'
import type { AssistantModelInfo, AssistantSessionTurnUsageEntry } from '../src/shared/assistant/contracts'
const turns = [
    { id: 'one', threadId: 'own', model: 'openai-codex/test', usage: { inputTokens: 1000, outputTokens: 10, cachedInputTokens: 0 } },
    { id: 'two', threadId: 'own', model: 'openai-codex/test', usage: { inputTokens: 100, outputTokens: 10, cachedInputTokens: 900 } }
] as AssistantSessionTurnUsageEntry[]
const models = [{ id: 'openai-codex/test', label: 'Test', contextWindow: 500000, auto_compact_token_limit: 450000 }] as AssistantModelInfo[]
const result = summarizeAssistantThreadUsage(turns, 'own', models, { threadId: 'own', inputTokens: 1100, cachedInputTokens: 900, cacheHitPercent: 99, latestRequestCacheHitPercent: 90, contextTokens: 100000 }, {})
assert.equal(result.cacheHitPercent, 45, 'Legacy latest-response percentage cannot masquerade as whole-chat reuse')
assert.equal(result.latestRequestCacheHitPercent, 90)
assert.equal(result.turnCacheHitPercent, 90)
assert.equal(result.contextTokens, 100000, 'Context occupancy is not cumulative input processing')
assert.equal(result.contextLimit, 450000)
assert.equal(summarizeAssistantThreadUsage(turns, 'own', models, null, { 'openai-codex/test': 300000 }).contextLimit, 300000)
assert.equal(summarizeAssistantThreadUsage([], 'own', [], null, {}).contextLimit, null)
const inclusive = summarizeAssistantThreadUsage([{ ...turns[1], usage: { ...turns[1].usage, inputTokens: 1000, inputIncludesCachedTokens: true } }], 'own', models, null, {})
assert.equal(inclusive.inputTokens, 100)
assert.equal(inclusive.cacheHitPercent, 90)
console.log('Context summary: weighted/request/turn cache scopes, inclusive tokens, provider/default overrides and unknown limits: ok')
