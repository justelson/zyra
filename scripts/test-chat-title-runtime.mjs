import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAgentSession, ModelRuntime, SettingsManager, DefaultResourceLoader } from '../src/runtime/engine/src/index.js';
import { AssistantMessageEventStream } from '../src/runtime/providers/src/utils/event-stream.js';
import { envApiKeyAuth } from '../src/runtime/providers/src/auth/helpers.js';
import { ZyraSessionManager } from '../src/agent-server/zyra-session-manager.mjs';
import { createChatTitleController } from '../src/chat-title-tool.mjs';

const directory = mkdtempSync(path.join(tmpdir(), 'zyra-title-runtime-'));
const previousRoot = process.env.ZYRA_DATA_ROOT;
process.env.ZYRA_DATA_ROOT = directory;
let session;
try {
  const { runZyraPrompt } = await import('../src/zyra-sdk.mjs');
  const { projectHistoryEntries } = await import('../src/agent-server/tui-runtime.mjs');
  const model = { id: 'title-fixture', provider: 'fixture', name: 'Title fixture', api: 'fixture', baseUrl: 'https://fixture.invalid', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 1024 };
  const usage = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  const titles = [], order = [];
  let calls = 0, fail = false;
  const stream = (_model, context) => {
    const result = new AssistantMessageEventStream();
    const first = calls++ === 0;
    if (first) {
      assert.doesNotMatch(context.systemPrompt, /Before any visible response or other tool call/, 'Title state must not rewrite reusable system instructions');
      assert.match(JSON.stringify(context.messages), /Before any visible response or other tool call/, 'Title context is appended with the accepted turn');
      assert.ok(context.tools.some(tool => tool.name === 'set_chat_title'));
      assert.equal(context.messages.filter(message => message.content?.[0]?.text === 'Fix renderer startup').length, 1, 'Original user prompt remains unchanged and appears once');
    }
    const message = { role: 'assistant', provider: model.provider, api: model.api, model: model.id, usage, timestamp: Date.now(),
      stopReason: fail ? 'error' : first ? 'toolUse' : 'stop',
      ...(fail ? { errorMessage: 'Synthetic provider failure' } : {}),
      content: fail ? [] : first ? [{ type: 'toolCall', id: 'foreground-title', name: 'set_chat_title', arguments: { title: 'Renderer startup repair' } }] : [{ type: 'text', text: 'I will inspect renderer startup.' }] };
    queueMicrotask(() => {
      result.push({ type: 'start', partial: message });
      result.push(fail ? { type: 'error', reason: 'error', error: message } : { type: 'done', reason: message.stopReason, message });
      result.end();
    });
    return result;
  };
  const modelRuntime = await ModelRuntime.create({ authPath: path.join(directory, 'auth.json'), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  modelRuntime.registerNativeProvider({ id: 'fixture', auth: { apiKey: envApiKeyAuth('Fixture', []) }, getModels: () => [model], stream, streamSimple: stream });
  await modelRuntime.setRuntimeApiKey('fixture', 'synthetic-key');
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const resourceLoader = new DefaultResourceLoader({ cwd: directory, agentDir: directory, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, systemPrompt: 'Synthetic title test.' });
  await resourceLoader.reload();
  const chatTitle = createChatTitleController(async title => { titles.push(title); order.push('title'); });
  const sessionManager = ZyraSessionManager.create(directory, path.join(directory, 'sessions'));
  ({ session } = await createAgentSession({ cwd: directory, agentDir: directory, modelRuntime, model, settingsManager, resourceLoader, sessionManager, tools: ['set_chat_title'], customTools: [chatTitle.tool] }));
  session.subscribe(event => {
    if (event.type === 'message_end' && event.message.role === 'assistant' && event.message.content.some(part => part.type === 'text')) order.push('response');
  });
  const runtime = { session, chatTitle, project: directory };
  await runZyraPrompt(runtime, 'Fix renderer startup', { chatTitleState: { eligible: true, title: 'New chat' } });
  assert.deepEqual(order, ['title', 'response'], 'the foreground model sets metadata before its visible response');
  assert.deepEqual(titles, [{ title: 'Renderer startup repair', titleSource: 'model', expectedTitle: 'New chat' }]);
  assert.doesNotMatch(session.agent.state.systemPrompt, /ZYRA_CHAT_TITLE/, 'per-turn instructions are cleared after completion');
  const events = projectHistoryEntries(sessionManager.getEntries());
  assert.equal(events.some(event => event.toolName === 'set_chat_title'), false, 'TUI reopening cannot display the hidden action');
  assert.equal(events.some(event => JSON.stringify(event.message?.content).includes('Renderer startup repair')), false, 'the title is absent from visible transcript messages');
  assert.ok(events.some(event => JSON.stringify(event.message?.content).includes('I will inspect renderer startup.')));
  await runZyraPrompt(runtime, 'Continue normally', { chatTitleState: { eligible: false, title: titles[0].title } });
  assert.equal(titles.length, 1);
  fail = true;
  await assert.rejects(runZyraPrompt(runtime, 'Synthetic failure', { chatTitleState: { eligible: true, title: 'New chat' } }), /Synthetic provider failure/);
  assert.doesNotMatch(session.agent.state.systemPrompt, /ZYRA_CHAT_TITLE/, 'failed turns also clear the title instruction');
  console.log('Foreground title runtime: actual provider tool loop, title before response, unchanged user prompt, hidden TUI replay and failure cleanup: ok');
} finally {
  session?.dispose();
  if (previousRoot === undefined) delete process.env.ZYRA_DATA_ROOT; else process.env.ZYRA_DATA_ROOT = previousRoot;
  rmSync(directory, { recursive: true, force: true });
}
