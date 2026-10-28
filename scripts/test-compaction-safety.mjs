import assert from 'node:assert/strict';
import { compact, generateSummaryWithUsage } from '../src/runtime/engine/source/core/compaction/compaction.ts';
import { createFileOps } from '../src/runtime/engine/source/core/compaction/utils.ts';

// Run with bun. All completions are injected; no provider/auth/network dependency.
const model = { id: 'fixture', provider: 'fixture', api: 'fixture', name: 'Fixture', baseUrl: 'https://fixture.invalid', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, maxTokens: 1024, contextWindow: 8192 };
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const answer = (text = 'Complete synthetic checkpoint.', stopReason = 'stop', extra = {}) => ({ role: 'assistant', content: [{ type: 'text', text }], stopReason, usage, api: 'fixture', provider: 'fixture', model: 'fixture', timestamp: Date.now(), ...extra });
const preparation = (extra = {}) => ({ firstKeptEntryId: 'kept', messagesToSummarize: [], turnPrefixMessages: [{ role: 'user', content: 'Continue the same synthetic task.', timestamp: 1 }], isSplitTurn: true, tokensBefore: 1000, previousSummary: 'Prior goals, constraints, decisions, and exact/file.ts must survive.', fileOps: createFileOps(), settings: { enabled: true, reserveTokens: 1024, keepRecentTokens: 64 }, ...extra });
let calls = 0;
const result = await compact(preparation(), model, undefined, undefined, undefined, undefined, 'off', (_model, _context, options) => {
  calls++;
  assert.equal(options.toolChoice, 'none');
  assert.equal(options.cacheRetention, 'none');
  return { result: async () => answer() };
});
assert.equal(calls, 1, 'No history call is needed when only an earlier checkpoint exists');
assert.ok(result.summary.startsWith(preparation().previousSummary), 'Empty history must preserve previous summary verbatim');
assert.match(result.summary, /Turn Context/);

for (const response of [
  answer('partial', 'length'), answer('partial', 'aborted'), answer('partial', 'error'),
  answer('partial', 'toolUse'), answer('   '),
  answer('', 'stop', { content: [{ type: 'thinking', thinking: 'reasoning alone is not a checkpoint' }] }),
  answer('text', 'stop', { content: [{ type: 'toolCall', id: 'bad', name: 'bad', arguments: {} }] }),
]) {
  const stream = () => ({ result: async () => response });
  await assert.rejects(compact(preparation(), model, undefined, undefined, undefined, undefined, 'off', stream));
  await assert.rejects(generateSummaryWithUsage([{ role: 'user', content: 'Synthetic history', timestamp: 1 }], model, 1024, undefined, undefined, undefined, undefined, undefined, 'off', stream));
}
const before = new AbortController();
before.abort();
let cancelledCalls = 0;
await assert.rejects(compact(preparation(), model, undefined, undefined, undefined, before.signal, 'off', () => {
  cancelledCalls++;
  return { result: async () => answer() };
}));
assert.equal(cancelledCalls, 0);
const during = new AbortController();
await assert.rejects(compact(preparation(), model, undefined, undefined, undefined, during.signal, 'off', () => ({ result: async () => {
  during.abort();
  return answer('Text returned after cancellation');
} })));
console.log('Compaction safety: prior split-turn checkpoint, incomplete/empty/tool summaries and pre/during cancellation: ok');
