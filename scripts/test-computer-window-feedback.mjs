import assert from 'node:assert/strict';
import { controlObservationPayload, formatControlObservation } from '../src/agent-control/observation-feedback.mjs';
import { formatWindowMatches, formatComputerObservation } from '../src/agent-control/computer-window-feedback.mjs';
const listed = formatWindowMatches('Google Chrome', [
  { applicationName: 'chrome', title: "Who's using Chrome?", processId: 101, windowToken: 'picker' },
  { applicationName: 'chrome', title: 'New Tab - Google Chrome', processId: 102, windowToken: 'profile' },
  { applicationName: 'chrome', title: 'Blocked private window', blocked: true, windowToken: 'blocked' }
]);
assert.match(listed, /Who's using Chrome/);
assert.match(listed, /New Tab - Google Chrome/);
assert.doesNotMatch(listed, /Blocked private/);
const observed = formatComputerObservation('Computer observation ready.', { targetState: 'closed', targetId: 'picker', revision: 3, elements: [] });
assert.match(observed, /computer_list_windows/);
assert.match(observed, /Do not replay the previous click/);
assert.doesNotMatch(observed, /observation ready/);
console.log('Computer window feedback: distinguishable bounded candidates and replacement recovery instructions: ok');

const fixture = {
  targetId: 'window:fixture', revision: 7, viewport: { width: 800, height: 600, scale: 1 }, targetState: 'ready', title: 'Drawing',
  focusedElementRef: 'window-element:7:field', redactions: ['password'],
  truncation: { truncated: true, reason: 'element-limit' },
  elements: [
    ...Array.from({ length: 80 }, (_, index) => ({ elementRef: `window-element:7:${index}`, role: 'button', name: `Drawing tool ${index}`, actions: ['click'], states: index === 0 ? ['enabled', 'checked'] : index === 1 ? ['enabled', 'selected', 'expanded'] : ['enabled'] })),
    { elementRef: 'window-element:7:field', role: 'textbox', name: 'Protected field', value: '[redacted]', sensitive: true, description: 'Account input', states: ['focused'], actions: ['type'] },
    { role: 'text', name: 'Canvas size', value: '800 by 600' },
  ],
};
const compact = formatComputerObservation('Ready.', fixture);
const payload = JSON.parse(compact.slice(compact.indexOf('\n') + 1));
assert.deepEqual(payload.viewport, fixture.viewport, 'current coordinate extent is available for drawing');
assert.deepEqual(payload.controlColumns, ['elementRef', 'role', 'name', 'actions', 'optionalDetails']);
const reconstructed = payload.controls.map(([elementRef, role, name, actions, details]) => ({
  ...(elementRef ? { elementRef } : {}), role, ...(name ? { name } : {}),
  ...(actions.length ? { actions } : {}), ...details,
}));
const original = controlObservationPayload(fixture);
assert.deepEqual(reconstructed, original.elements, 'table preserves every useful control and its semantic details');
for (const [key, value] of Object.entries(original)) {
  if (key !== 'elements' && value !== undefined) assert.deepEqual(payload[key], value, `preserves ${key}`);
}
assert.ok(compact.length < formatControlObservation('Ready.', fixture).length * 0.6, 'Windows observations remove repeated formatting and field names');
assert.deepEqual(JSON.parse(formatControlObservation('Browser.', fixture).split('\n').slice(1).join('\n')), original, 'browser observation contract stays unchanged');
console.log('Computer observations: compact lossless controls, fresh references, focus and redaction metadata: ok');
