import assert from 'node:assert/strict';
import { aggregateSessionUsage } from '../src/usage-aggregation.mjs';

const message = (timestamp, input, cacheRead, extra = {}) => ({ role: 'assistant', timestamp, provider: 'test', model: 'test', usage: { input, output: 5, cacheRead, cacheWrite: 0, cost: { total: 0.01 }, ...extra } });
const first = message(1, 100, 0);
const second = message(2, 10, 90);
const entries = [{ type: 'message', id: 'a', message: first }, { type: 'message', id: 'b', message: second }];
const totals = aggregateSessionUsage(entries, { completedMessage: structuredClone(second) });
assert.equal(totals.cacheHitPercent, 45);
assert.equal(totals.latestRequestCacheHitPercent, 90);
assert.equal(totals.cacheInputTokens, 200);
assert.equal(totals.assistantMessages, 2);
assert.equal(totals.cost, 0.02);
assert.equal(totals.costComplete, true);
assert.equal(aggregateSessionUsage([entries[0]]).cacheHitPercent, 0);

// Tool-call-only requests are billed even when no visible assistant text exists.
const tool = message(3, 20, 40, { cacheWrite: 40, reasoning: 2 });
tool.content = [{ type: 'toolCall', id: 'tool', name: 'read', arguments: {} }];
const withTool = aggregateSessionUsage([...entries, { type: 'message', id: 'tool-request', message: tool }], { completedMessage: structuredClone(tool) });
assert.equal(withTool.assistantMessages, 3);
assert.equal(withTool.cacheInputTokens, 300);
assert.equal(withTool.cacheWrite, 40);
assert.equal(withTool.reasoning, 2);
assert.equal(withTool.cacheHitPercent, 130 / 300 * 100);
assert.equal(withTool.latestRequestCacheHitPercent, 40);
assert.equal(withTool.total, 315);

const estimated = aggregateSessionUsage(entries, { costForMessage: () => ({ total: 0.2, source: 'api-equivalent' }) });
assert.equal(estimated.cost, 0.4);
assert.equal(estimated.costSource, 'api-equivalent');
const missing = message(4, 1, 0, { cost: undefined });
assert.equal(aggregateSessionUsage([{ type: 'message', message: missing }]).costComplete, false);
assert.equal(aggregateSessionUsage([{ type: 'message', message: message(5, 0, 0, { cost: { total: 0 } }) }]).costComplete, true);
assert.equal(aggregateSessionUsage([]).cacheHitPercent, null);
assert.equal(aggregateSessionUsage([]).costComplete, false);
assert.equal(aggregateSessionUsage(entries, { costForMessage: () => null }).costComplete, false);

const compaction = { type: 'compaction', id: 'compact', usage: { input: 10, output: 2, cacheRead: 40, cacheWrite: 50, reasoning: 1, cost: { total: 0.03, source: 'reported' } }, summary: 'summary' };
const branch = { type: 'branch_summary', id: 'branch', usage: { input: 10, output: 1, cacheRead: 0, cacheWrite: 0, cost: { total: 0.02, source: 'reported' } } };
const toolResult = { type: 'message', id: 'result', message: { role: 'toolResult', timestamp: 4, usage: { input: 5, output: 1, cacheRead: 5, cacheWrite: 0, cost: { total: 0.01, source: 'reported' } } } };
const all = aggregateSessionUsage([...entries, compaction, branch, toolResult]);
assert.equal(all.assistantMessages, 2);
assert.equal(all.cacheInputTokens, 320);
assert.equal(all.cacheRead, 135);
assert.equal(all.cacheWrite, 50);
assert.equal(all.total, 334);
assert.equal(all.latestRequestCacheHitPercent, 90, 'background summarization/tool usage must not overwrite latest assistant request');
assert.equal(all.costComplete, true);
assert.equal(all.cost, 0.08);
const unpriced = structuredClone(compaction);
unpriced.usage.cost = { total: 0, source: 'unpriced' };
assert.equal(aggregateSessionUsage([unpriced]).costComplete, false);
const inclusive = message(6, 100, 80, { inputIncludesCachedTokens: true, cacheWrite: 10, totalTokens: 9999, reasoning: 3 });
const normalized = aggregateSessionUsage([inclusive]);
assert.equal(normalized.input, 10);
assert.equal(normalized.total, 105, 'total must equal normalized four token categories, excluding reasoning subset');
assert.equal(normalized.cacheHitPercent, 80);
console.log('Usage aggregation regression checks passed.');
