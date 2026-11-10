import assert from 'node:assert/strict';
import { Agent } from '../src/runtime/agent/src/agent.js';
import { Type } from 'typebox';
import { createHarnessStreamSimple } from '../src/opencode-harness.mjs';
import { HarnessConversation } from '../src/harness-conversation.mjs';
import { ToolMailbox, preserveNativeToolReplay } from '../src/harness-v2-plugin/tool-mailbox.js';
import { harnessToolsFixture } from './fixtures/harness-tools.mjs';
import { HarnessToolConversation } from '../src/harness-tool-turn.mjs';
import { harnessImageFiles } from '../src/harness-tool-context.mjs';
import { isRetryableAssistantError } from '../src/runtime/providers/src/utils/retry.js';

const fixture = await harnessToolsFixture({ brokenReads: 1, steps: [
  { calls: [{ id: 'title', name: 'set_chat_title', arguments: { title: 'Synthetic storage audit' } }] },
  { text: 'Inspecting a bounded folder.', calls: [{ id: 'command', name: 'bash', arguments: { command: 'fixture command' } }] },
  { text: 'Finished the synthetic audit.' },
] });
const conversation = new HarnessConversation(); conversation.tools.pollMs = 5;
const events = [], executed = [], gated = [];
const model = { id: 'fixture/model', provider: 'opencode-harness', api: 'openai-completions', harness: { toolcall: true },
  reasoning: false, input: ['text'], contextWindow: 32768, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const agent = new Agent({ initialState: { model, systemPrompt: 'Use bounded scans and the real Zyra tools.', tools: [
  { name: 'set_chat_title', description: 'Set hidden chat metadata.', parameters: Type.Object({ title: Type.String() }),
    execute: async (_id, args) => { executed.push(['title', args.title]); return { content: [{ type: 'text', text: 'Title saved.' }] }; } },
  { name: 'bash', description: 'Managed Zyra command. Timeout is seconds; jobs yield promptly.', parameters: Type.Object({ command: Type.String() }),
    execute: async () => { executed.push(['bash']); return { content: [{ type: 'text', text: 'Synthetic result.' }] }; } },
] },
  streamFn: createHarnessStreamSimple({ executable: 'fixture', conversation, fetchImpl: fixture.client.fetch,
    ensureServe: async () => ({ client: fixture.client, release() {} }) }),
  beforeToolCall: async ({ toolCall }) => { gated.push(toolCall.name); },
});
agent.subscribe(event => events.push(event));
try {
  await agent.prompt('Find synthetic cleanup candidates. Do not delete anything.');
  assert.deepEqual(executed, [['title', 'Synthetic storage audit'], ['bash']]);
  assert.deepEqual(gated, ['set_chat_title', 'bash'], 'every tool passes the standard Zyra execution gate');
  assert.deepEqual(events.filter(event => event.type === 'tool_execution_start').map(event => event.toolName), ['set_chat_title', 'bash']);
  assert.equal(agent.state.messages.filter(message => message.role === 'toolResult').length, 2, 'tool results use ordinary durable messages');
  assert.equal(agent.state.messages.at(-1).content.find(part => part.type === 'text').text, 'Finished the synthetic audit.');
  assert.equal(fixture.requests.filter(request => request.route.endsWith('/prompt')).length, 1, 'a failed read and tool continuations never restart the user request');
  assert.equal(fixture.generated, 3, 'title, command and final response each use one model step');
  const native = [...fixture.sessions.values()][0];
  assert.equal(native.contexts[0].tools.native_unsafe, undefined, 'native tools cannot leak into the model request');
  assert.match(native.contexts[0].tools.bash.description, /Timeout is seconds/);
  assert.equal(native.contexts[1].messages.find(message => message.role === 'tool').content[0].id, 'title');
  assert.equal(fixture.requests.some(request => request.route.endsWith('/wait')), false, 'tool turns never hold the five-minute HTTP wait');
  assert.equal(fixture.requests.filter(request => request.method === 'PATCH').length, 1, 'unchanged tools do not rewrite native permissions per step');
} finally { await conversation.dispose(); await fixture.cleanup(); }

const imageContext = { messages: [{ role: 'user', content: [{ type: 'image', mimeType: 'image/png', data: 'fixture-image' }] }] };
const firstImages = harnessImageFiles(imageContext);
assert.equal(firstImages.files.length, 1);
assert.equal(harnessImageFiles(imageContext, firstImages.keys).files.length, 0, 'tool continuations reuse uploaded images');
assert.equal(harnessImageFiles({ messages: [] }, firstImages.keys).keys.size, 0, 'compacted images leave the retained inventory');

const variantFixture = await harnessToolsFixture({ steps: [{ text: 'Future option accepted.' }] });
const variantConversation = new HarnessConversation();
try {
  const stream = createHarnessStreamSimple({ executable: 'fixture', conversation: variantConversation, fetchImpl: variantFixture.client.fetch,
    resolveCwd: '/fixture', ensureServe: async () => ({ client: variantFixture.client, release() {} }) })(
    { ...model, harness: { toolcall: true, variants: ['adaptive-native'] } },
    { tools: [{ name: 'read', description: 'Read', parameters: Type.Object({}) }], messages: [{ role: 'user', content: 'Future model' }] },
    { zyraReasoningChoice: 'variant:adaptive-native' });
  for await (const event of stream) assert.notEqual(event.type, 'error');
  assert.equal(variantFixture.requests.find(request => request.route === '/session').body.model.variant, 'adaptive-native', 'native variants are unwrapped at the actual tool-stream adapter boundary');
} finally { await variantConversation.dispose(); await variantFixture.cleanup(); }

const timeoutFixture = await harnessToolsFixture({ steps: [] }), timeoutConversation = new HarnessConversation();
timeoutConversation.tools.pollMs = 1;
try {
  const timedFetch = (url, init) => new URL(url).pathname.endsWith('/message')
    ? Promise.reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError')) : timeoutFixture.client.fetch(url, init);
  const stream = createHarnessStreamSimple({ executable: 'fixture', conversation: timeoutConversation, fetchImpl: timedFetch,
    ensureServe: async () => ({ client: timeoutFixture.client, release() {} }) })(model,
    { tools: [{ name: 'read', description: 'Read', parameters: Type.Object({}) }], messages: [{ role: 'user', content: 'Test timeout' }] });
  let failure;
  for await (const event of stream) if (event.type === 'error') failure = event;
  assert.equal(failure?.reason, 'error', 'transport timeouts cannot masquerade as a user Stop');
  assert.equal(failure?.error.errorRetryable, false);
} finally { await timeoutConversation.dispose(); await timeoutFixture.cleanup(); }

for (const failure of ['cancel', 'transport']) {
  const isolated = await harnessToolsFixture({ steps: [{ calls: [{ id: 'once', name: 'read', arguments: {} }] }] });
  const turn = new HarnessToolConversation({ pollMs: 1 });
  const context = { systemPrompt: 'Synthetic', tools: [{ name: 'read', description: 'Read', parameters: Type.Object({}) }], messages: [{ role: 'user', content: 'Test' }] };
  try {
    const result = await turn.step({ client: isolated.client, modelId: 'fixture/model', variant: 'future-effort', context });
    assert.equal(result.stopReason, 'toolUse');
    assert.equal(isolated.requests.find(request => request.route === '/session').body.model.variant, 'future-effort');
    if (failure === 'transport') {
      const original = isolated.client.fetch;
      isolated.client.fetch = (url, init) => new URL(url).pathname.endsWith('/message') ? Promise.reject(new TypeError('fetch failed')) : original(url, init);
      context.messages.push({ role: 'toolResult', toolCallId: 'once', toolName: 'read', content: [{ type: 'text', text: 'Retained result' }] });
      await assert.rejects(turn.step({ client: isolated.client, modelId: 'fixture/model', variant: 'future-effort', context }), error => {
        assert.equal(error.retryable, false);
        assert.equal(isRetryableAssistantError({ stopReason: 'error', errorMessage: error.message, errorRetryable: false }), false);
        return true;
      });
    } else await turn.dispose();
    assert.equal(turn.record, null, 'cancel and failed transport discard the suspended native context');
    assert.equal(isolated.sessions.size, 0, 'native sessions and mailboxes are cleaned up');
    assert.equal(isolated.requests.filter(request => request.route.endsWith('/prompt')).length, 1, 'accepted prompts cannot be replayed after failure');
  } finally { await turn.dispose(); await isolated.cleanup(); }
}

const mailbox = new ToolMailbox();
const replay = [{ role: 'assistant', content: [{ type: 'reasoning', text: 'Reason' }, { type: 'tool-call', id: 'call', name: 'read', input: { path: 'canonical' } }] }];
const nativeReplay = [{ role: 'assistant', content: [{ type: 'reasoning', text: 'Reason', providerMetadata: { anthropic: { signature: 'synthetic-proof' } } },
  { type: 'tool-call', id: 'call', name: 'read', input: { path: 'native-placeholder' }, providerMetadata: { google: { thoughtSignature: 'synthetic-call-proof' } } }] }];
const preserved = preserveNativeToolReplay(replay, nativeReplay);
assert.equal(preserved[0].content[0].providerMetadata.anthropic.signature, 'synthetic-proof');
assert.equal(preserved[0].content[1].providerMetadata.google.thoughtSignature, 'synthetic-call-proof');
assert.equal(preserved[0].content[1].input.path, 'canonical', 'native proof cannot replace canonical tool input');
assert.deepEqual(preserveNativeToolReplay(replay, [{ ...nativeReplay[0], content: nativeReplay[0].content.map(part => ({ ...part, id: 'foreign-call' })) }]), replay, 'unrelated calls cannot supply replay proof');
const opaque = preserveNativeToolReplay([{ role: 'assistant', content: [replay[0].content[1]] }], [{ role: 'assistant', content: [
  { type: 'reasoning', text: '', providerMetadata: { anthropic: { redactedData: 'synthetic-opaque-proof' } } }, nativeReplay[0].content[1] ] }]);
assert.equal(opaque[0].content[0].providerMetadata.anthropic.redactedData, 'synthetic-opaque-proof', 'tool continuation preserves opaque native reasoning even without visible text');
const binding = { sessionID: 'owned', token: 'a'.repeat(64), system: '', messages: [], tools: [{ name: 'read', description: 'read', input: { type: 'object' } }] };
mailbox.bind(binding);
assert.throws(() => mailbox.poll({ ...binding, token: 'b'.repeat(64) }), /unavailable/);
assert.throws(() => mailbox.bind({ ...binding, token: 'b'.repeat(64) }), /owned/);
const cancellation = new AbortController();
const invocation = mailbox.invoke('read', { path: 'fixture' }, { sessionID: 'owned', id: 'one', signal: cancellation.signal });
assert.throws(() => mailbox.results({ ...binding, results: [{ id: 'foreign', name: 'read', content: [] }] }), /Unowned/);
mailbox.results({ ...binding, results: [{ id: 'one', name: 'read', content: [{ type: 'text', text: 'result' }] }] });
await invocation;
assert.doesNotThrow(() => mailbox.results({ ...binding, results: [{ id: 'one', name: 'read', content: [{ type: 'text', text: 'result' }] }] }));
assert.throws(() => mailbox.results({ ...binding, results: [{ id: 'one', name: 'read', content: [] }] }), /changed/);
const aborted = mailbox.invoke('read', {}, { sessionID: 'owned', id: 'two', signal: cancellation.signal });
cancellation.abort(); await assert.rejects(aborted, /cancelled/); mailbox.dispose();
console.log('OpenCode tools: actual Zyra agent loop, title metadata, command schemas, permission gate, durable results, native isolation, read recovery, no duplicate prompt and owned mailbox cancellation passed.');
