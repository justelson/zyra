import assert from 'node:assert/strict';
import { Compile } from 'typebox/compile';
import { createAssistantActionBatchTool, ASSISTANT_ACTION_BATCH_INTENT_MAX_LENGTH } from '../src/assistant-action-batch-tool.mjs';
import { createFleetTools } from '../src/agents/tools.mjs';

const marker = createAssistantActionBatchTool();
const validate = Compile(marker.parameters);
for (const length of [72, 73, 74, 81, 84, 1024]) {
  const input = { title: 'Reviewing '.padEnd(length, 'a') };
  assert.equal(validate.Check(input), true, `A ${length}-character intent reaches the existing display normalizer`);
  const result = await marker.execute('fixture', input);
  assert.ok(result.details.actionBatchIntent.length <= ASSISTANT_ACTION_BATCH_INTENT_MAX_LENGTH);
  assert.equal(result.details.hiddenFromTimeline, true);
}
for (const input of [{}, { title: 12 }, { title: '' }, { title: 'a'.repeat(1025) }, { title: 'valid', extra: true }]) {
  assert.equal(validate.Check(input), false, 'Malformed and oversized input stays bounded');
}
await assert.rejects(marker.execute('empty', { title: ' \n\t ' }), /title is required/);

const value = { runs: [{ id: 'fixture', status: 'completed', text: 'Spacing inside strings stays  intact.\nSecond line.', usage: { input: 123, output: 45 } }], nextCursor: null };
const [agent, workflow] = createFleetTools({ controller: { status: async () => value }, workflowRuntime: { listRuns: async () => value } });
for (const tool of [agent, workflow]) {
  const result = await tool.execute('fixture', { action: 'status' });
  assert.equal(result.content[0].text, JSON.stringify(value), 'Fleet tool output uses compact JSON');
  assert.deepEqual(JSON.parse(result.content[0].text), value, 'All values and string whitespace survive');
  assert.deepEqual(result.details, { fleet: true });
}
const largerValue = { runs: Array.from({ length: 900 }, (_, id) => ({ id, status: 'completed' })) };
assert.ok(JSON.stringify(largerValue, null, 2).length > 50 * 1024);
assert.ok(JSON.stringify(largerValue).length < 50 * 1024);
const [largerAgent] = createFleetTools({ controller: { status: () => largerValue } });
assert.deepEqual(JSON.parse((await largerAgent.execute('fixture', { action: 'status' })).content[0].text), largerValue, 'Compact formatting avoids truncation when the same data fits the existing budget');
const [boundedAgent] = createFleetTools({ controller: { status: () => ({ text: 'x'.repeat(100000) }) } });
const boundedOutput = (await boundedAgent.execute('fixture', { action: 'status' })).content[0].text;
assert.ok(boundedOutput.length < 52000, 'The existing response-size bound remains effective');
assert.match(boundedOutput, /\[truncated\]$/);
console.log('Log-supported tool improvements: bounded action labels and lossless compact fleet results: ok');
