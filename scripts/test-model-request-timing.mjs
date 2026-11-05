import assert from 'node:assert/strict';
const { ModelRequestControl } = await import(process.argv.includes('--compiled')
  ? '../src/runtime/agent/src/model-request.js' : '../src/runtime/agent/source/model-request.ts');
const originalNow = Date.now;
let clock = 1_800_000_000_000;
const events = [];
try {
  Date.now = () => clock;
  const control = new ModelRequestControl(event => events.push(event));
  await control.begin();
  assert.equal(control.progress.firstEventAt, undefined);
  clock += 100;
  await control.activity(false);
  assert.equal(control.progress.firstEventAt, clock);
  assert.equal(control.progress.firstTextAt, undefined, 'reasoning is not visible text');
  clock += 5;
  await control.activity(true, true);
  assert.equal(events.at(-1).progress.firstTextAt, clock, 'first text bypasses the ordinary one-second progress throttle');
  clock += 750;
  await control.activity(true, true);
  assert.equal(control.progress.firstTextAt, clock - 750);
  await control.end();
  assert.equal(events.at(-2).progress.maxActivityGapMs, 750, 'request completion flushes its final unthrottled statistics');
  assert.equal(events.at(-1).progress, null);
  clock += 300_000;
  await control.begin();
  clock += 10;
  await control.activity(false);
  assert.equal(control.progress.maxActivityGapMs, undefined, 'tool time between requests is excluded');
  await control.end();
  assert(!JSON.stringify(events).includes('content'));
  console.log('Provider request timing: first event/text, throttle bypass, final gaps and request isolation: ok');
} finally { Date.now = originalNow; }
