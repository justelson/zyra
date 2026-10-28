// Source + real SDK serialization, synthetic fetch only:
//   bun scripts/test-google-groq-current-models.mjs
// After the separately owned runtime compilation:
//   node scripts/test-google-groq-current-models.mjs --compiled
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Metadata sources (current baseline reviewed 2026-10-22):
// https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash?hl=en
// https://ai.google.dev/gemini-api/docs/models/gemini-4-argon?hl=en
// https://ai.google.dev/gemini-api/docs/pricing
// https://console.groq.com/docs/models
// https://console.groq.com/docs/deprecations
const dataRoot = new URL('../src/runtime/providers/source/providers/data/', import.meta.url);
const google = JSON.parse(await readFile(new URL('google.json', dataRoot), 'utf8'))['google-generative-ai'];
const groq = JSON.parse(await readFile(new URL('groq.json', dataRoot), 'utf8'))['openai-completions'];
if (process.argv.includes('--compiled')) {
  const compiledRoot = new URL('../src/runtime/providers/src/providers/data/', import.meta.url);
  assert.deepEqual(JSON.parse(await readFile(new URL('google.json', compiledRoot), 'utf8'))['google-generative-ai'], google);
  assert.deepEqual(JSON.parse(await readFile(new URL('groq.json', compiledRoot), 'utf8'))['openai-completions'], groq);
}
const currentGoogleIds = ['gemini-3.8-flash', 'gemini-4-argon'];
for (const id of currentGoogleIds) {
  const model = google[id];
  assert.ok(model, `missing current model ${id}`);
  assert.equal(model.id, id);
  assert.equal(model.reasoning, true);
  assert.deepEqual(model.input, ['text', 'image']);
  assert.equal(model.contextWindow, 1048576);
  assert.equal(model.maxTokens, 65536);
  assert.deepEqual(model.thinkingLevelMap, { off: null, minimal: null, low: 'LOW', medium: 'MEDIUM', high: 'HIGH' });
  if (model.cost.pricing === null) {
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite']) assert.equal(model.cost[key], 0, `${id}: unknown price must not invent a rate`);
  } else {
    assert.ok(model.cost.input > 0 && model.cost.output > 0, `${id}: known paid pricing must have explicit rates`);
  }
}
for (const id of ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite', 'gemini-3.1-pro-preview', 'gemini-3.1-pro-preview-customtools', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-flash-latest', 'gemini-flash-lite-latest', 'gemma-4-26b-a4b-it', 'gemma-4-31b-it']) {
  assert.ok(google[id], `preserve legitimate legacy model/alias ${id}`);
}
for (const id of Object.keys(google)) {
  assert.ok(!/deep-research|computer-use|robotics-er-1\.6|(?:^|-)live(?:-|$)|(?:^|-)image(?:-|$)/.test(id), `specialized/shutdown endpoint in chat baseline: ${id}`);
  assert.notEqual(id, 'gemini-3.1-flash-lite-preview');
}
assert.deepEqual(Object.keys(groq).sort(), ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'].sort(), 'public Groq chat baseline excludes retired and enterprise-only models');
const qwen = groq['qwen/qwen3.8-27b'];
assert.deepEqual(qwen.input, ['text', 'image']);
assert.equal(qwen.contextWindow, 131072);
assert.equal(qwen.maxTokens, 16384);
assert.equal(qwen.cost.input, 0.8);
assert.equal(qwen.cost.output, 4);
assert.deepEqual(qwen.thinkingLevelMap, { off: 'none', minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: null, max: null });
assert.equal(google['gemini-3.8-flash'].cost.input, 0.75);
assert.equal(google['gemini-4-argon'].cost.input, 2);
for (const id of ['openai/gpt-oss-120b', 'openai/gpt-oss-20b']) {
  assert.equal(groq[id].reasoning, true);
  assert.equal(groq[id].contextWindow, 131072);
  assert.equal(groq[id].maxTokens, 65536);
}

const originalFetch = globalThis.fetch;
const requests = [];
const signature = Buffer.from('synthetic-tool-thought-signature').toString('base64');
const textSignature = Buffer.from('synthetic-text-thought-signature').toString('base64');
const normalReply = { candidates: [{ content: { role: 'model', parts: [{ text: 'fixture complete' }] }, finishReason: 'STOP' }] };
let reply = normalReply;
// Install before loading the adapter/SDK. No request ever delegates to real fetch.
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  assert.equal(new URL(request.url).origin, 'https://google-sdk.fixture.invalid');
  assert.match(request.url, /:streamGenerateContent\?alt=sse$/);
  assert.equal(request.method, 'POST');
  requests.push(JSON.parse(await request.text()));
  return new Response(`data: ${JSON.stringify(reply)}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });
};
try {
  const runtimeDirectory = process.argv.includes('--compiled') ? 'src' : 'source';
  const suffix = runtimeDirectory === 'src' ? 'js' : 'ts';
  const { stream, streamSimple } = await import(new URL(`../src/runtime/providers/${runtimeDirectory}/api/google-generative-ai.${suffix}`, import.meta.url));
  const { getSupportedThinkingLevels } = await import(new URL(`../src/runtime/providers/${runtimeDirectory}/models.${suffix}`, import.meta.url));
  const context = { messages: [{ role: 'user', content: 'Synthetic request, do not contact a provider.', timestamp: 1 }] };
  const options = { apiKey: 'synthetic-not-a-real-api-key', maxRetries: 0, maxTokens: 64 };
  const fixtureModel = id => ({ ...google[id], baseUrl: 'https://google-sdk.fixture.invalid/v1beta' });
  async function capture(run) {
    const before = requests.length;
    const result = await run().result();
    assert.equal(result.stopReason, 'stop', result.errorMessage);
    assert.equal(requests.length, before + 1, 'one SDK request per case, with no fallback');
    return requests.at(-1);
  }
  function checkThinking(body, level, includeThoughts) {
    const thinking = body.generationConfig?.thinkingConfig;
    assert.ok(thinking, 'SDK must serialize an explicit thinking config');
    assert.equal(thinking.thinkingLevel, level);
    assert.ok(!Object.hasOwn(thinking, 'thinkingBudget'), 'level models must not send token budgets');
    if (includeThoughts) assert.equal(thinking.includeThoughts, true);
    else assert.notEqual(thinking.includeThoughts, true, 'off must not expose thought summaries');
    assert.notEqual(thinking.thinkingLevel, 'MINIMAL');
  }
  for (const id of [...currentGoogleIds, 'gemini-3.7-flash', 'gemini-flash-latest']) {
    const model = fixtureModel(id);
    assert.deepEqual(getSupportedThinkingLevels(model), ['low', 'medium', 'high']);
    for (const reasoning of [undefined, 'off', 'minimal', 'low', 'medium', 'high']) {
      const body = await capture(() => streamSimple(model, context, { ...options, ...(reasoning === undefined ? {} : { reasoning }) }));
      const enabled = reasoning !== undefined && reasoning !== 'off';
      checkThinking(body, reasoning === 'medium' ? 'MEDIUM' : reasoning === 'high' ? 'HIGH' : 'LOW', enabled);
    }
    for (const thinking of [undefined, { enabled: false }, { enabled: true, level: 'MINIMAL' }, { enabled: true, level: 'LOW' }, { enabled: true, level: 'MEDIUM' }, { enabled: true, level: 'HIGH' }, { enabled: true, budgetTokens: 0 }, { enabled: true, level: 'THINKING_LEVEL_UNSPECIFIED' }]) {
      const body = await capture(() => stream(model, context, { ...options, ...(thinking === undefined ? {} : { thinking }) }));
      checkThinking(body, thinking?.level === 'MEDIUM' ? 'MEDIUM' : thinking?.level === 'HIGH' ? 'HIGH' : 'LOW', thinking?.enabled === true);
    }
  }
  // Preserve the established transports for legacy Gemini/Gemma rather than changing all models.
  for (const [id, expected] of [['gemini-3-flash-preview', { thinkingLevel: 'MINIMAL' }], ['gemini-3.1-pro-preview', { thinkingLevel: 'LOW' }], ['gemma-4-31b-it', { thinkingLevel: 'MINIMAL' }], ['gemini-2.5-flash', { thinkingBudget: 0 }]]) {
    const body = await capture(() => streamSimple(fixtureModel(id), context, options));
    assert.deepEqual(body.generationConfig.thinkingConfig, expected, `legacy off behavior: ${id}`);
  }
  // Exercise response parsing -> actual SDK replay, retaining function IDs/signatures and images.
  for (const id of currentGoogleIds) {
    const model = fixtureModel(id);
    reply = { candidates: [{ content: { role: 'model', parts: [
      { text: '', thoughtSignature: textSignature },
      { functionCall: { id: 'fixture_call_1', name: 'inspect_fixture', args: { path: 'fixture.txt' } }, thoughtSignature: signature },
    ] }, finishReason: 'STOP' }] };
    const assistant = await streamSimple(model, context, { ...options, reasoning: 'minimal' }).result();
    assert.equal(assistant.stopReason, 'toolUse', assistant.errorMessage);
    const call = assistant.content.find(part => part.type === 'toolCall');
    assert.equal(call?.id, 'fixture_call_1');
    assert.equal(call?.thoughtSignature, signature);
    reply = normalReply;
    const tool = { name: 'inspect_fixture', description: 'Inspect synthetic fixture', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } };
    const body = await capture(() => streamSimple(model, {
      ...context, tools: [tool], messages: [...context.messages, assistant, {
        role: 'toolResult', toolCallId: call.id, toolName: call.name, isError: false, timestamp: 2,
        content: [{ type: 'text', text: 'synthetic tool result' }, { type: 'image', mimeType: 'image/png', data: 'c3ludGhldGljLWltYWdl' }],
      }],
    }, { ...options, reasoning: 'off' }));
    checkThinking(body, 'LOW', false);
    const modelTurn = body.contents.find(turn => turn.role === 'model');
    assert.deepEqual(modelTurn.parts.find(part => part.functionCall), {
      functionCall: { id: 'fixture_call_1', name: 'inspect_fixture', args: { path: 'fixture.txt' } }, thoughtSignature: signature,
    });
    assert.ok(modelTurn.parts.some(part => part.text === '' && part.thoughtSignature === textSignature), 'empty signature-bearing text survives replay');
    const response = body.contents.flatMap(turn => turn.parts).find(part => part.functionResponse)?.functionResponse;
    assert.equal(response.id, 'fixture_call_1');
    assert.equal(response.name, 'inspect_fixture');
    assert.deepEqual(response.response, { output: 'synthetic tool result' });
    assert.deepEqual(response.parts, [{ inlineData: { mimeType: 'image/png', data: 'c3ludGhldGljLWltYWdl' } }]);
    assert.equal(body.tools[0].functionDeclarations[0].name, tool.name);
    assert.deepEqual(body.tools[0].functionDeclarations[0].parametersJsonSchema.required, ['path']);
  }
  console.log(`Google/Groq current baseline and real Google SDK serialization: ${requests.length} synthetic requests passed (no live inference).`);
} finally {
  globalThis.fetch = originalFetch;
}
