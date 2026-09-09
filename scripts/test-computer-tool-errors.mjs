import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { computerToolError } from '../src/agent-control/computer-tool-error.mjs';
import { createComputerToolSet } from '../src/agent-control/computer-toolset.mjs';
const sdkRequire = createRequire(import.meta.resolve('@earendil-works/pi-coding-agent'));
const { runAgentLoop } = await import(new URL('./dist/agent-loop.js', pathToFileURL(sdkRequire.resolve('@earendil-works/pi-agent-core/package.json'))));

async function executeWithInstalledPi(client) {
  const tool = createComputerToolSet({ client }).find(tool => tool.name === 'computer_observe');
  const message = { role: 'assistant', content: [{ type: 'toolCall', id: 'fixture:call', name: tool.name,
    arguments: { targetId: 'fixture:target', grantId: 'fixture:grant' } }], stopReason: 'toolUse', timestamp: 0 };
  const events = [];
  await runAgentLoop([{ role: 'user', content: 'Observe the fixture.', timestamp: 0 }],
    { systemPrompt: '', messages: [], tools: [tool] },
    { model: { provider: 'fixture', id: 'fixture' }, convertToLlm: messages => messages, shouldStopAfterTurn: () => true },
    event => events.push(event), undefined,
    async () => ({ async *[Symbol.asyncIterator]() { yield { type: 'done', message }; }, result: async () => message }));
  return events;
}
const failure = Object.assign(new Error('The observation revision is stale.'), { code: 'CONTROL_STALE_OBSERVATION', retryable: true, freshRevision: 7 });
const failed = await executeWithInstalledPi({ request: async () => { throw failure; } });
const ended = failed.find(event => event.type === 'tool_execution_end');
assert.equal(ended.isError, true, 'the installed Pi runtime must record computer failures as errors');
assert.match(ended.result.content[0].text, /CONTROL_STALE_OBSERVATION/);
assert.match(ended.result.content[0].text, /freshRevision.*7/);
const unavailable = await executeWithInstalledPi(undefined);
assert.equal(unavailable.find(event => event.type === 'tool_execution_end').isError, true);
const succeeded = await executeWithInstalledPi({ request: async () => ({ observation: { targetState: 'ready', revision: 1, elements: [] } }) });
assert.equal(succeeded.find(event => event.type === 'tool_execution_end').isError, false);
console.log('Installed Pi computer-tool failure status, recovery metadata, unavailable bridge and success semantics passed.');

const covered = computerToolError(Object.assign(new Error('Pointer coordinates are obscured or no longer belong to the selected window.'), { code: 'CONTROL_TARGET_BLOCKED' }));
assert.equal(covered.retryable, true);
assert.match(covered.message, /window.focus/);
assert.match(covered.message, /exact candidate/);
assert.match(covered.message, /Never click the obstructing window or replay a failed sequence/);
const protectedTarget = computerToolError(Object.assign(new Error('The selected control is sensitive.'), { code: 'CONTROL_TARGET_BLOCKED' }));
assert.equal(protectedTarget.retryable, false, 'sensitive-target denial must not acquire focus recovery guidance');
assert.doesNotMatch(protectedTarget.message, /computer_focus/);
