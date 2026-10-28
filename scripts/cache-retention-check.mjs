import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createRetentionBaseline, evaluateRetentionContinuation } from '../src/cache-retention-check.mjs';

const [action, ...args] = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const sessionFile = option('--session-file');
const checkpoint = option('--checkpoint');
if (!['start', 'check'].includes(action) || !sessionFile || !checkpoint) {
  console.error('Usage: node scripts/cache-retention-check.mjs start|check --session-file <own-session.jsonl> --checkpoint <private-check.json> [--minimum-hours 12]');
  process.exitCode = 1;
} else {
  const entries = (await readFile(sessionFile, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  if (action === 'start') {
    const baseline = createRetentionBaseline(entries);
    await mkdir(path.dirname(path.resolve(checkpoint)), { recursive: true });
    await writeFile(checkpoint, JSON.stringify(baseline, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ status: 'baseline-recorded', checkpoint: path.resolve(checkpoint), next: 'Leave the conversation idle. Resume using the same account/model after 12–24 hours, then run check. No provider call was made.' }));
  } else {
    const baseline = JSON.parse(await readFile(checkpoint, 'utf8'));
    console.log(JSON.stringify(evaluateRetentionContinuation(baseline, entries, Number(option('--minimum-hours') ?? 12)), null, 2));
  }
}
