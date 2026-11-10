// Explicit native integration test. Local synthetic model, no account or credits.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Type } from 'typebox';
import { Agent } from '../src/runtime/agent/src/agent.js';
import { detectHarness, ensureHarnessServe, stopHarnessServe, createHarnessStreamSimple } from '../src/opencode-harness.mjs';
import { HarnessConversation } from '../src/harness-conversation.mjs';
import { createChatTitleController } from '../src/chat-title-tool.mjs';
import { createUserNotificationTool } from '../src/user-notification-tool.mjs';

if (!process.argv.includes('--run')) throw new Error('Native integration requires --run.');
const directory = await mkdtemp(path.join(tmpdir(), 'zyra-native-tool-fixture-'));
const nativePlugin = path.join(directory, 'provider');
const requests = [], executed = [], notifications = [], nativeSnapshots = [];
const image = { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVR4nGNocDjwnxLMMGrAqAGjBgwXAwBJj38fuYA+PQAAAABJRU5ErkJggg==' };
let lease;
const conversation = new HarnessConversation();
const server = createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw); requests.push(body);
  const step = requests.length;
  const toolCall = step <= 3 ? { id: `fixture-call-${step}`, type: 'function', function: {
    name: step === 1 ? 'set_chat_title' : step === 2 ? 'read_fixture' : 'notify_user',
    arguments: step === 1 ? '{"title":"Native fixture"}' : step === 2 ? '{}' : '{"kind":"completed","title":"Fixture checked","body":"The fixture value was verified. Open the chat for the result."}' } } : null;
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const emit = payload => res.write(`data: ${JSON.stringify(payload)}\n\n`);
  if (step === 1) {
    for (const delta of [{ reasoning_content: 'Synthetic reasoning.' }, { content: 'Checking the fixture.' }]) {
      emit({ id: `response-${step}`, object: 'chat.completion.chunk', created: 1, model: 'model', choices: [{ index: 0, delta, finish_reason: null }] });
    }
  }
  emit({ id: `response-${step}`, object: 'chat.completion.chunk', created: 1, model: 'model', choices: [{ index: 0,
    delta: toolCall ? { role: 'assistant', tool_calls: [{ ...toolCall, index: 0 }] } : { role: 'assistant', content: 'Fixture is ' }, finish_reason: null }] });
  if (!toolCall) {
    await new Promise(resolve => setTimeout(resolve, 1200));
    emit({ id: `response-${step}`, object: 'chat.completion.chunk', created: 1, model: 'model', choices: [{ index: 0, delta: { content: 'violet-42.' }, finish_reason: null }] });
  }
  emit({ id: `response-${step}`, object: 'chat.completion.chunk', created: 1, model: 'model', choices: [{ index: 0, delta: {}, finish_reason: toolCall ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 } });
  res.end('data: [DONE]\n\n');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const previous = process.env.OPENCODE_CONFIG_CONTENT;
try {
  await mkdir(nativePlugin);
  await writeFile(path.join(nativePlugin, 'index.js'), `import { Model, Provider } from '@opencode/plugin';
export default { id: 'zyra.synthetic-model', async setup(ctx) {
  await ctx.provider.transform(editor => editor.add({
    info: { ...Provider.Info.empty('zyra-fixture'), name: 'Zyra synthetic fixture', activation: 'enabled',
      package: '@opencode/ai/providers/openai-compatible', settings: { baseURL: 'http://127.0.0.1:${server.address().port}/v1', apiKey: 'synthetic-no-secret' } },
    models: [{ ...Model.Info.default('zyra-fixture', 'model'), name: 'Synthetic model',
      capabilities: { tools: true, input: ['text', 'image'], output: ['text', 'reasoning'] }, limit: { context: 32768, output: 4096 } }]
  }));
} };`);
  process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ plugins: [nativePlugin] });
  const detected = await detectHarness();
  lease = await ensureHarnessServe({ cwd: directory, executable: detected.executable });
  if (previous === undefined) delete process.env.OPENCODE_CONFIG_CONTENT; else process.env.OPENCODE_CONFIG_CONTENT = previous;
  const title = createChatTitleController(async value => { assert.equal(value.title, 'Native fixture'); executed.push('title'); });
  title.prepare({ eligible: true, title: 'New chat' });
  let agent;
  const tools = [
    title.tool,
    createUserNotificationTool(async notice => { executed.push('notify'); notifications.push(notice); }),
    { name: 'read_fixture', description: 'Read synthetic fixture.', parameters: Type.Object({}),
      execute: async () => { executed.push('read'); agent.steer({ role: 'user', content: [{ type: 'text', text: 'Use compact output.' }], timestamp: Date.now() }); return { content: [{ type: 'text', text: 'violet-42' }, image] }; } },
  ];
  const model = { id: 'zyra-fixture/model', provider: 'opencode-harness', api: 'openai-completions', harness: { toolcall: true },
    input: ['text', 'image'], reasoning: false, contextWindow: 32768, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  agent = new Agent({ initialState: { model, tools, systemPrompt: 'Zyra synthetic system.' },
    streamFn: createHarnessStreamSimple({ executable: detected.executable, resolveCwd: directory, conversation,
      onMetric: metric => { if (['native-session', 'tool-boundary'].includes(metric.phase)) console.log(JSON.stringify(metric)); },
      fetchImpl: async (...args) => {
        const response = await fetch(...args);
        if (response.ok && /\/message\?/.test(String(args[0]))) {
          const snapshot = await response.clone().json();
          nativeSnapshots.splice(0, nativeSnapshots.length, ...(snapshot.data ?? []).filter(message => message.type === 'assistant').map(message => ({
            finish: message.finish, error: message.error, parts: message.content?.map(part => ({ type: part.type, name: part.name, text: part.text, status: part.state?.status }))
          })));
        }
        if (!response.ok && response.status !== 404) console.log('Synthetic native HTTP failure', response.status, (await response.clone().text()).replace(/data:[^\s"']+/g, '[synthetic image]').slice(0, 900));
        return response;
      },
      ensureServe: async () => ({ client: lease.client, release() {} }) }),
    beforeToolCall: async ({ toolCall }) => assert.ok(tools.some(tool => tool.name === toolCall.name)),
  });
  let firstTextAt;
  agent.subscribe(event => {
    if (requests.length === 4 && event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') firstTextAt ??= Date.now();
  });
  const timeout = setTimeout(() => agent.abort(), 60_000);
  try { await agent.prompt('Read the fixture.', [image]); } finally { clearTimeout(timeout); }
  const final = agent.state.messages.at(-1);
  if (final.stopReason !== 'stop') console.log(JSON.stringify({ syntheticFailure: true, requests: requests.length, executed, nativeSnapshots }));
  assert.equal(final.stopReason, 'stop', final.errorMessage);
  assert.deepEqual(executed, ['title', 'read', 'notify']);
  assert.equal(requests.length, 4);
  const firstAssistant = agent.state.messages.find(message => message.role === 'assistant');
  assert.equal(firstAssistant.content.find(part => part.type === 'thinking')?.thinking, 'Synthetic reasoning.');
  assert.equal(firstAssistant.content.find(part => part.type === 'text')?.text, 'Checking the fixture.');
  assert.deepEqual(requests[0].tools.map(tool => tool.function.name).sort(), ['notify_user', 'read_fixture', 'set_chat_title']);
  assert.ok(JSON.stringify(requests[1].messages).includes('Chat title metadata submitted.'));
  assert.ok(JSON.stringify(requests[0].messages).includes('image_url'), 'native image objects survive the canonical context hook');
  assert.ok(JSON.stringify(requests[2].messages).includes('Use compact output.'), 'steering reaches the next model step in the same native execution');
  assert.equal(agent.state.messages.filter(message => message.role === 'user' && JSON.stringify(message.content).includes('Use compact output.')).length, 1);
  assert.equal(notifications.length, 1); assert.equal(notifications[0].title, 'Fixture checked');
  assert.match(JSON.stringify(final.content), /violet-42/);
  assert.equal(final.content.find(part => part.type === 'text').text, 'Fixture is violet-42.', 'live snapshots and deltas cannot duplicate text');
  assert.ok(firstTextAt && Date.now() - firstTextAt >= 900, 'native first text arrives while the model is still streaming');
  console.log(JSON.stringify({ success: true, nativeVersion: detected.version, modelRequests: requests.length, tools: executed,
    canonicalResults: agent.state.messages.filter(message => message.role === 'toolResult').length, images: true, steering: true, hostedRequests: 0 }));
} finally {
  if (previous === undefined) delete process.env.OPENCODE_CONFIG_CONTENT; else process.env.OPENCODE_CONFIG_CONTENT = previous;
  await conversation.dispose(); lease?.release(); await stopHarnessServe(directory);
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  if (path.dirname(directory) !== tmpdir() || !path.basename(directory).startsWith('zyra-native-tool-fixture-')) throw new Error('Unexpected native fixture cleanup target');
  await rm(directory, { recursive: true, force: true });
}
