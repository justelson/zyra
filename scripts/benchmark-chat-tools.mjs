import { createReadStream } from 'node:fs';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { createChatToolBenchmark } from '../src/benchmarks/chat-tools.mjs';

const { values } = parseArgs({ options: { corpus: { type: 'string' }, baseline: { type: 'string' }, out: { type: 'string' } }, strict: true });
if (!values.corpus || !values.baseline || !values.out) throw new Error('Usage: node scripts/benchmark-chat-tools.mjs --corpus <private manifest.json> --baseline <baseline.json> --out <private report.json>');
const corpus = JSON.parse(await readFile(values.corpus, 'utf8'));
const baseline = JSON.parse(await readFile(values.baseline, 'utf8'));
if (corpus.version !== 1 || !Array.isArray(corpus.sessions) || !baseline.actionBatchSchema) throw new Error('Unsupported benchmark manifest or baseline');
const pathIdentity = file => process.platform === 'win32' ? resolve(file).toLowerCase() : resolve(file);
if ([values.corpus, values.baseline, ...corpus.sessions.map(session => session.path)].some(file => pathIdentity(file) === pathIdentity(values.out))) throw new Error('The report must not overwrite the corpus, baseline or a session log');
const benchmark = createChatToolBenchmark(baseline);
const sources = [];
const seenPaths = new Set();
let malformedLines = 0, incompleteTailLines = 0;
for (const [index, session] of corpus.sessions.entries()) {
  const file = resolve(session.path);
  const identity = process.platform === 'win32' ? file.toLowerCase() : file;
  if (seenPaths.has(identity)) continue;
  seenPaths.add(identity);
  if (!Number.isSafeInteger(session.bytes) || session.bytes < 0 || (await stat(file)).size < session.bytes) throw new Error(`Corpus source ${index + 1} was shortened; freeze the corpus again`);
  const hash = createHash('sha256');
  // Read exactly the frozen byte range. New activity cannot shift the result.
  const stream = session.bytes ? createReadStream(file, { start: 0, end: session.bytes - 1 }) : null;
  let pending = null;
  if (stream) {
    stream.on('data', chunk => hash.update(chunk));
    const consume = async (line, final) => {
      if (!line.trim()) return;
      let entry;
      try { entry = JSON.parse(line); }
      catch { if (final) incompleteTailLines++; else malformedLines++; return; }
      await benchmark.accept(entry, index);
    };
    for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
      if (pending !== null) await consume(pending, false);
      pending = line;
    }
    if (pending !== null) await consume(pending, true);
  }
  sources.push({ index, bytes: session.bytes, sha256: hash.digest('hex') });
}
const report = { createdAt: new Date().toISOString(), selection: corpus.selection, sources, malformedLines, incompleteTailLines, ...benchmark.finish() };
await mkdir(dirname(resolve(values.out)), { recursive: true });
await writeFile(values.out, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ sessions: sources.length, calls: report.calls, results: report.results, marker: report.marker, fleet: report.fleet, malformedLines, incompleteTailLines }));
if (report.marker.regressions || report.marker.normalizationFailures || report.fleet.changedValues || malformedLines) process.exitCode = 1;
