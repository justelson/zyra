import { createHash } from 'node:crypto';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
const assistant = entry => entry?.type === 'message' && entry.message?.role === 'assistant' && entry.message.usage;

/** No prompts, credentials or response identifiers leave the original session log. */
export function createRetentionBaseline(entries, now = Date.now()) {
  const last = entries.findLast(assistant)?.message;
  if (!last) throw new Error('A completed, metered response is required before recording a baseline.');
  return { version: 1, recordedAt: now, entryCount: entries.length, prefixDigest: digest(entries),
    model: `${last.provider}/${last.model}`, baselineCacheRead: finite(last.usage.cacheRead) };
}

export function evaluateRetentionContinuation(baseline, entries, minimumHours = 12) {
  if (baseline?.version !== 1 || !Number.isSafeInteger(baseline.entryCount) || baseline.entryCount < 1 || !Number.isFinite(baseline.recordedAt)
    || typeof minimumHours !== 'number' || !Number.isFinite(minimumHours) || minimumHours <= 0) throw new Error('Invalid retention check.');
  const prefixUnchanged = digest(entries.slice(0, baseline.entryCount)) === baseline.prefixDigest;
  const tail = entries.slice(baseline.entryCount);
  const hasCompaction = tail.some(entry => entry.type === 'compaction');
  // Never skip a cold first request and substitute a warm follow-up.
  const first = tail.find(assistant)?.message;
  if (!first) return { status: 'pending', reason: 'Resume this same conversation, then check again.', prefixUnchanged };
  const at = Number(first.timestamp);
  const elapsedHours = Number.isFinite(at) ? (at - baseline.recordedAt) / 3_600_000 : null;
  const sameModel = `${first.provider}/${first.model}` === baseline.model;
  const cacheRead = finite(first.usage.cacheRead);
  const cacheWrite = finite(first.usage.cacheWrite);
  const raw = finite(first.usage.input);
  const input = Math.max(0, raw - (first.usage.inputIncludesCachedTokens ? cacheRead + cacheWrite : 0));
  const denominator = input + cacheRead + cacheWrite;
  const eligible = prefixUnchanged && sameModel && !hasCompaction && elapsedHours != null && elapsedHours >= minimumHours;
  return { status: eligible ? 'observed' : 'inconclusive', elapsedHours, minimumHours, prefixUnchanged, sameModel,
    compactionObserved: hasCompaction, firstRequestCacheRead: cacheRead,
    cacheHitPercent: denominator > 0 ? cacheRead / denominator * 100 : null,
    retainedCacheObserved: eligible && cacheRead > 0,
    limitations: 'A delayed cache hit is evidence of reuse, not an indefinite retention guarantee. Session logs cannot prove account, tool-schema or system-prefix equality.' };
}
