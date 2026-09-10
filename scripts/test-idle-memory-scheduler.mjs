import assert from 'node:assert/strict';
import { createIdleMemoryScheduler } from '../src/memory/idle-memory-scheduler.mjs';
let pending, delay, clock = 0, calls = 0, signal, finish;
const scheduler = createIdleMemoryScheduler({ now: () => clock, idleMs: 10, cooldownMs: 100, setTimer(fn, ms) { pending = fn; delay = ms; return 1; }, clearTimer() { pending = undefined; }, run: s => { calls++; signal = s; return new Promise(resolve => { finish = resolve }); } });
scheduler.idle(); assert.equal(delay, 10); scheduler.busy(); assert.equal(pending, undefined);
scheduler.idle(); const running = pending(); scheduler.idle(); assert.equal(calls, 1);
scheduler.busy(); assert.equal(signal.aborted, true); finish(); await running;
clock = 30; scheduler.idle(); assert.equal(delay, 70); scheduler.dispose(); assert.equal(pending, undefined); scheduler.idle(); assert.equal(pending, undefined);
console.log('Idle memory scheduling, cancellation and cooldown passed.');
