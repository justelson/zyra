import { mkdir, readFile, stat, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ClientResponseTiming } from './client-response-timing.mjs';

export const CLIENT_TIMING_STORAGE_BYTES = 2 * 1024 * 1024;
/** Private bounded local diagnostics are independent of analytics consent. */
export function createClientResponseTimings(directory, options = {}) {
  const file = path.join(directory, 'response-timings.json');
  let timer, writes = Promise.resolve(), lastWrite = 0;
  const recorder = new ClientResponseTiming({ ...options, changed: urgent => {
    if (timer && !urgent) return;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void flush(); }, urgent ? 200 : Math.max(1000, 10_000 - (Date.now() - lastWrite)));
    timer.unref?.();
  } });
  const ready = (async () => {
    try { if ((await stat(file)).size <= CLIENT_TIMING_STORAGE_BYTES) { const bytes = await readFile(file); if (bytes.length <= CLIENT_TIMING_STORAGE_BYTES) recorder.restore(JSON.parse(bytes.toString())); } } catch { /* Diagnostics never delay or fail a chat. */ }
  })();
  async function flush() {
    clearTimeout(timer); timer = null; await ready;
    if (!recorder.records.size) return;
    const bytes = JSON.stringify(recorder.read()); if (Buffer.byteLength(bytes) > CLIENT_TIMING_STORAGE_BYTES) return;
    lastWrite = Date.now();
    writes = writes.then(async () => {
      const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
      try { await mkdir(directory, { recursive: true, mode: 0o700 }); await writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' }); await rename(temporary, file); }
      catch { await rm(temporary, { force: true }).catch(() => {}); }
    });
    await writes;
  }
  return { recorder, file, ready, flush, async dispose() { recorder.dispose(); await flush(); } };
}
