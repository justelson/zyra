// Manual opt-in. Uses a synthetic prompt and synthetic tools, never private chats.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Type } from 'typebox';
import { Agent } from '../src/runtime/agent/src/agent.js';
import { detectHarness, ensureHarnessServe, stopHarnessServe, createHarnessStreamSimple } from '../src/opencode-harness.mjs';
import { HarnessConversation } from '../src/harness-conversation.mjs';

if (!process.argv.includes('--run')) throw new Error('Manual live check requires --run.');
const modelId = process.argv.find(arg => arg.startsWith('--model='))?.slice(8) ?? 'opencode/deepseek-v4.1-flash-free';
const cwd = await mkdtemp(path.join(tmpdir(), 'zyra-tool-bridge-live-'));
const conversation = new HarnessConversation();
let lease;
const started = performance.now(), executed = [], events = [];
try {
  const detection = await detectHarness();
  lease = await ensureHarnessServe({ cwd, executable: detection.executable });
  assert.equal(lease.client.apiVersion, 2);
  const tools = [
    { name: 'set_chat_title', description: 'Save a concise hidden chat title before any visible response.', parameters: Type.Object({ title: Type.String() }),
      execute: async (_id, input) => { executed.push('title'); return { content: [{ type: 'text', text: 'Title saved.' }] }; } },
    { name: 'read_fixture', description: 'Read the synthetic fixture value. No filesystem access.', parameters: Type.Object({}),
      execute: async () => { executed.push('read'); return { content: [{ type: 'text', text: 'Fixture value is violet-42.' }] }; } },
  ];
  const model = { id: modelId, api: 'openai-completions', provider: 'opencode-harness', harness: { toolcall: true }, reasoning: true,
    input: ['text'], contextWindow: 128000, maxTokens: 2048, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const agent = new Agent({ initialState: { model, tools, thinkingLevel: 'high', systemPrompt: 'This is a synthetic tool integration test. Call set_chat_title first, then read_fixture. Use actual tool calls. Do not use shell, filesystem or network tools. End by reporting the fixture value.' },
    streamFn: createHarnessStreamSimple({ executable: detection.executable, resolveCwd: cwd, conversation,
      ensureServe: async () => ({ client: lease.client, release() {} }) }),
    beforeToolCall: async ({ toolCall }) => assert.ok(tools.some(tool => tool.name === toolCall.name)),
  });
  agent.subscribe(event => events.push({ type: event.type, at: Math.round(performance.now() - started), toolName: event.toolName }));
  const timeout = setTimeout(() => agent.abort(), 90_000);
  try { await agent.prompt('Read the fixture value and tell me what it is.'); } finally { clearTimeout(timeout); }
  const final = agent.state.messages.at(-1);
  assert.equal(final.stopReason, 'stop', final.errorMessage);
  assert.deepEqual(executed, ['title', 'read']);
  assert.match(JSON.stringify(final.content), /violet-42/);
  console.log(JSON.stringify({ success: true, version: detection.version, model: modelId, durationMs: Math.round(performance.now() - started),
    tools: executed, firstToolMs: events.find(event => event.type === 'tool_execution_start')?.at,
    toolResultCount: agent.state.messages.filter(message => message.role === 'toolResult').length }));
} finally {
  await conversation.dispose(); lease?.release(); await stopHarnessServe(cwd);
  if (path.dirname(cwd) !== tmpdir() || !path.basename(cwd).startsWith('zyra-tool-bridge-live-')) throw new Error('Unexpected test cleanup path');
  await rm(cwd, { recursive: true, force: true });
}
